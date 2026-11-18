"""Virtual wind tunnel for the bike: LBM-LES on the CAD geometry (the parts SolidWorks holds).

Standard bicycle-CFD assumptions, bike only:
  air 1.204 kg/m3, nu 1.516e-5 m2/s (20 C); 40 km/h head-on (optional yaw by turning the bike about +Y)
  free stream, no ground, static wheels; spokes, chain, cables and bolts omitted (cad/bike_cad.py aero=False)
  wall-resolved neither: Smagorinsky LES (Cs 0.17) on a uniform 9 mm lattice

Writes <build>/cfd_lbm/<case>/result.npz (time-averaged fields, part forces) and summary.json.
Run:  python cad/wind_tunnel.py --yaw 0 --dx 9 --flows 2.5
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import lbm  # noqa: E402
import lbm_kernel as K  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("ROADBIKE_BUILD", Path(os.environ["LOCALAPPDATA"]) / "road-bike-cad" / "build")) / "cfd_lbm"
RHO, NU, U = 1.204, 1.516e-5, 40 / 3.6
GROUPS = {  # drag breakdown groups (catalog-facing names)
    "Frame": ["frame", "headset_cover"], "Fork": ["fork"],
    "Front wheel": ["rim_front", "tyre_front", "hub_front"], "Rear wheel": ["rim_rear", "tyre_rear", "hub_rear"],
    "Drivetrain": ["crankset", "chainring_", "cassette", "rear_derailleur", "front_derailleur", "pedal_"],
    "Cockpit": ["stem", "handlebar", "levers", "light"], "Saddle & post": ["saddle", "seatpost"],
    "Brakes": ["brake_"], "Bottles": ["bottle_"],
}


def group_of(name):
    for gi, (g, keys) in enumerate(GROUPS.items(), 1):
        if any(name == k or (k.endswith("_") and name.startswith(k)) or name.startswith(k + "_") for k in keys):
            return gi
    raise KeyError(name)


VOL_DX = 0.016  # flow-volume grid shared with cfd_post.py (m)


def volume_grid(lo, hi):
    """The flow volume round the bike and its wake (tunnel frame): lower corner and cell counts."""
    vlo = np.array([lo[0] - 1.2, lo[1] - 0.10, lo[2] - 0.30])
    vhi = np.array([hi[0] + 0.20, hi[1] + 0.15, hi[2] + 0.30])
    return vlo, vhi, np.maximum(((vhi - vlo) / VOL_DX).astype(int), 2)


def q_criterion(u, dx):
    """Q = 0.5(|Omega|^2 - |S|^2) and |omega| for a velocity block u (3, ...) in U_inf units; 1/m^2 and 1/m."""
    g = [np.gradient(u[a], dx) for a in range(3)]
    wx, wy, wz = g[2][1] - g[1][2], g[0][2] - g[2][0], g[1][0] - g[0][1]
    wn2 = wx * wx + wy * wy + wz * wz
    S2 = sum((0.5 * (g[a][b] + g[b][a])) ** 2 for a in range(3) for b in range(3))
    return 0.5 * (0.5 * wn2 - S2), np.sqrt(wn2), wz


def load_cad():
    doc = json.loads((ROOT / "data/cad/parts.json").read_text(encoding="utf-8"))
    blob = (ROOT / "data/cad/parts.bin").read_bytes()
    off, sc = np.array(doc["offset"]), np.array(doc["scale"])
    meshes = []
    for p in doc["parts"]:
        if not p["aero"]:
            continue
        q = np.frombuffer(blob, np.int16, p["pos"][1] * 3, p["pos"][0]).reshape(-1, 3).astype(np.float64)
        v = (q + 32767) * sc + off
        t = np.frombuffer(blob, np.uint32, p["idx"][1], p["idx"][0]).reshape(-1, 3)
        meshes.append((group_of(p["name"]), v / 1000.0, t, p["name"]))
    return meshes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--dx", type=float, default=9.0, help="lattice spacing, mm")
    ap.add_argument("--ulb", type=float, default=0.1, help="lattice free-stream speed")
    ap.add_argument("--flows", type=float, default=2.5, help="run length in flow-throughs")
    ap.add_argument("--avg", type=float, default=1.0, help="averaging window in flow-throughs (at the end)")
    ap.add_argument("--snaps", type=int, default=0, help="instantaneous snapshots at the end of the run (Q volume + side plane)")
    ap.add_argument("--snap-every", type=int, default=25, help="steps between snapshots")
    ap.add_argument("--tag", default="", help="suffix for the case folder")
    a = ap.parse_args()
    dx = a.dx / 1000.0
    case = OUT / (f"yaw{int(round(a.yaw)):02d}_dx{a.dx:g}" + (f"_{a.tag}" if a.tag else ""))
    case.mkdir(parents=True, exist_ok=True)

    meshes = load_cad()
    yaw = math.radians(a.yaw)
    R = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])  # bike turned about +Y
    meshes = [(g, v @ R.T, t, n) for g, v, t, n in meshes]
    allv = np.vstack([m[1] for m in meshes])
    lo, hi = allv.min(0), allv.max(0)
    lo_d = lo - np.array([1.6, 0.55, 0.62])  # downstream (-X) 1.6 m, below/beside 0.55-0.62 m
    hi_d = hi + np.array([0.8, 0.55, 0.62])  # upstream (+X) 0.8 m
    shape = tuple(int(math.ceil(s / dx)) for s in hi_d - lo_d)
    nx, ny, nz = shape
    solid, part = lbm.voxelise([(g, v, t) for g, v, t, n in meshes], lo_d, dx, shape)
    dt = a.ulb * dx / U
    nu_lb = NU * dt / dx ** 2
    tau0 = 3 * nu_lb + 0.5
    steps_flow = int(round((hi_d[0] - lo_d[0]) / dx / a.ulb))
    steps = int(a.flows * steps_flow)
    avg_from = steps - int(a.avg * steps_flow)
    print(f"grid {nx}x{ny}x{nz} = {nx * ny * nz / 1e6:.1f} M, solid {int(solid.sum()):,}, dt {dt * 1e6:.1f} us, "
          f"tau0-0.5 = {tau0 - 0.5:.2e}, {steps} steps ({steps_flow}/flow-through)", flush=True)

    solid_p, part_p = np.pad(solid, 1), np.pad(part, 1)
    f = np.empty((19, nx + 2, ny + 2, nz + 2), np.float32)
    lbm.init(f, solid_p, a.ulb)
    g = f.copy()
    ng = len(GROUPS) + 1
    force = np.zeros((ng, nx + 2, 3), np.float64)
    acc = np.zeros((4, nx + 2, ny + 2, nz + 2), np.float32)
    fprof = np.zeros((ng - 1, nx, 3), np.float64)  # time-averaged force per lattice x-slab and group (drag build-up, centre of pressure)
    n_acc, n_prof, hist = 0, 0, []
    fblock = np.zeros((ng, 3))
    k0 = 18.0 * math.sqrt(2.0) * 0.17 ** 2
    fscale = RHO * dx ** 4 / dt ** 2  # lattice force -> N
    # instantaneous snapshots: Q on the 16 mm flow volume, side-plane speed and spanwise vorticity at full resolution
    snap_from = steps - a.snaps * a.snap_every if a.snaps else steps + 1
    if a.snaps:
        from scipy.ndimage import map_coordinates
        vlo, vhi, vn = volume_grid(lo, hi)
        cidx = lambda p: (np.asarray(p, float) - lo_d) / dx - 0.5
        i0 = np.maximum(np.floor(cidx(vlo)).astype(int) - 3, 0)
        i1 = np.minimum(np.ceil(cidx(vhi)).astype(int) + 4, [nx, ny, nz])
        gx, gy, gz = [vlo[k] + (np.arange(vn[k]) + 0.5) * VOL_DX for k in range(3)]
        Zg, Yg, Xg = np.meshgrid(gz, gy, gx, indexing="ij")
        pc = ((np.stack([Xg, Yg, Zg], -1).reshape(-1, 3) - lo_d) / dx - 0.5 - i0).T
        del Zg, Yg, Xg
        kz = int(round(cidx([0, 0, 0])[2])) - i0[2]
        inst = np.zeros((4, nx + 2, ny + 2, nz + 2), np.float32)
        snapQ, snapW, snapS, snapT = [], [], [], []
    t0 = time.time()
    for s in range(steps):
        force[:] = 0
        K.ghosts(f, a.ulb)
        K.step(f, g, solid_p, part_p, tau0, k0, force)
        f, g = g, f
        fg = force.sum(1) * fscale  # (groups, xyz) in N
        # The wall force on some parts alternates from one step to the next (a period-2 lattice mode), so
        # history rows are 10-step block means, never point samples: sampling every 10th step reads one phase.
        fblock += fg
        if s % 10 == 9:
            hist.append([(s - 4.5) * dt] + (fblock[1:] / 10).reshape(-1).tolist())
            fblock[:] = 0
        if s >= avg_from:
            fprof += force[1:, 1:-1, :]
            n_prof += 1
        if s >= snap_from and (s - snap_from) % a.snap_every == 0:
            inst[:] = 0
            lbm.accumulate(f, solid_p, inst)
            blk = inst[1:4, 1 + i0[0]:1 + i1[0], 1 + i0[1]:1 + i1[1], 1 + i0[2]:1 + i1[2]] / a.ulb
            q, wn, wz = q_criterion(blk, dx)
            q[solid[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]]] = 0
            snapQ.append(map_coordinates(q, pc, order=1, mode="nearest").reshape(vn[::-1]).astype(np.float16))
            snapW.append(wz[:, :, kz].T.astype(np.float16))
            snapS.append(np.linalg.norm(blk[:, :, :, kz], axis=0).T.astype(np.float16))
            snapT.append(s * dt)
            del blk, q, wn, wz
        if s >= avg_from and s % 5 == 0:
            lbm.accumulate(f, solid_p, acc)
            n_acc += 1
        if s % 500 == 0:
            el = time.time() - t0
            drag = -fg[1:, 0].sum()
            print(f"  step {s:6d}/{steps}  t={s * dt:.3f}s  drag {drag:6.2f} N  CdA {2 * drag / (RHO * U * U):.4f} m2  "
                  f"{el / max(s, 1):.3f} s/step  ETA {(steps - s) * el / max(s, 1) / 60:.0f} min", flush=True)
            if not np.isfinite(drag):
                raise RuntimeError("diverged")
    hist = np.array(hist)
    mean = acc[:, 1:-1, 1:-1, 1:-1] / n_acc
    window = hist[:, 0] >= avg_from * dt
    gforce = (fprof * fscale / max(n_prof, 1)).sum(1)  # N, per group, mean over every step of the window (tunnel frame)
    names = list(GROUPS)
    # back to the bike frame for lateral force at yaw
    gforce_bike = gforce @ R
    drag = {n: float(-gforce[i, 0]) for i, n in enumerate(names)}
    total = sum(drag.values())
    summary = {
        "method": "Lattice Boltzmann D3Q19, regularized BGK + Smagorinsky LES (Cs 0.17), half-way bounce-back walls, momentum-exchange forces",
        "assumptions": {"air_density": RHO, "kinematic_viscosity": NU, "speed_kmh": 40, "yaw_deg": a.yaw, "ground": "none (free stream)", "wheels": "static",
                        "omitted": "spokes, chain, cables, bolts, rider", "turbulence": "LES, laminar inflow"},
        "grid": {"dx_mm": a.dx, "cells": [nx, ny, nz], "cells_total": nx * ny * nz, "solid_cells": int(solid.sum()), "domain_m": [lo_d.tolist(), hi_d.tolist()],
                 "lattice_speed": a.ulb, "dt_s": dt, "steps": steps, "averaged_steps": int(window.sum() * 10), "flow_throughs": a.flows, "wall_time_s": time.time() - t0},
        "drag_N": total, "CdA_m2": 2 * total / (RHO * U * U), "drag_by_group_N": drag,
        "side_force_N": float(gforce_bike[:, 2].sum()), "lift_N": float(gforce[:, 1].sum()),
        "power_W_at_40kmh": total * U,
        "force_by_group_N": {n: gforce_bike[i].tolist() for i, n in enumerate(names)},  # bike frame [x fwd, y up, z drive side]
        "force_average": "every step of the window",
    }
    fprof = fprof * fscale / max(n_prof, 1)
    (case / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    np.savez_compressed(case / "result.npz", rho=mean[0].astype(np.float16), ux=mean[1].astype(np.float16), uy=mean[2].astype(np.float16),
                        uz=mean[3].astype(np.float16), solid=solid, part=part.astype(np.uint8), origin=lo_d, dx=dx, ulb=a.ulb, R=R, hist=hist.astype(np.float32), fprof=fprof.astype(np.float32))
    if a.snaps:
        np.savez_compressed(case / "snaps.npz", q=np.array(snapQ), wz=np.array(snapW), speed=np.array(snapS), t=np.array(snapT),
                            vlo=vlo, vn=vn, vdx=VOL_DX, crop_lo=lo_d + (i0 + 0.5) * dx, dx=dx, Uinf=U)
    print(json.dumps({k: summary[k] for k in ("drag_N", "CdA_m2", "drag_by_group_N")}, indent=1))


if __name__ == "__main__":
    main()
