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
    a = ap.parse_args()
    dx = a.dx / 1000.0
    case = OUT / f"yaw{int(round(a.yaw)):02d}_dx{a.dx:g}"
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
    n_acc, hist = 0, []
    k0 = 18.0 * math.sqrt(2.0) * 0.17 ** 2
    fscale = RHO * dx ** 4 / dt ** 2  # lattice force -> N
    t0 = time.time()
    for s in range(steps):
        force[:] = 0
        K.ghosts(f, a.ulb)
        K.step(f, g, solid_p, part_p, tau0, k0, force)
        f, g = g, f
        fg = force.sum(1) * fscale  # (groups, xyz) in N
        if s % 10 == 0:
            hist.append([s * dt] + fg[1:].reshape(-1).tolist())
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
    gforce = hist[window, 1:].mean(0).reshape(-1, 3)  # N, per group: drag is -Fx in the bike frame
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
    }
    (case / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    np.savez_compressed(case / "result.npz", rho=mean[0].astype(np.float16), ux=mean[1].astype(np.float16), uy=mean[2].astype(np.float16),
                        uz=mean[3].astype(np.float16), solid=solid, part=part.astype(np.uint8), origin=lo_d, dx=dx, ulb=a.ulb, R=R, hist=hist.astype(np.float32))
    print(json.dumps({k: summary[k] for k in ("drag_N", "CdA_m2", "drag_by_group_N")}, indent=1))


if __name__ == "__main__":
    main()
