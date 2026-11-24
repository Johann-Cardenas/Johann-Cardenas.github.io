"""Virtual wind tunnel for the bike: LBM-LES on the CAD geometry (the parts SolidWorks holds).

Bike-only protocol, after common wind-tunnel practice (bike with no rider, wheels spun at road speed,
yaw sweep -15..+15 deg in 5 deg steps, CdA at 40 km/h):
  air 1.204 kg/m3, nu 1.516e-5 m2/s (20 C); 40 km/h apparent wind; yaw by turning the bike about +Y
  standard (default): wheels spin at road speed U cos(yaw) and the ground moves under them at the same
    speed along the bike's heading (moving-wall bounce-back), so the road does not grow a boundary layer
  --static: the earlier protocol, free stream with no ground and the wheels still
  spokes, chain, cables and bolts are omitted (cad/bike_cad.py aero=False); spokes are modelled
    separately (js/model/study.js, blade element) because 1-2 mm spokes do not resolve at 8 mm
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
DEBUG = bool(os.environ.get("ROADBIKE_DEBUG"))
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


def cad_doc(pack="data/cad/parts"):
    return json.loads((ROOT / (pack + ".json")).read_text(encoding="utf-8"))


def reference_force(solid, part, nparts):
    """Momentum exchange of the rest state (rho 1, u 0) on every part, per padded x index, lattice units.

    A body wholly in fluid feels none: the reference pressure cancels around it. A wheel standing on the
    moving ground does: its contact patch is covered by ground cells, so the reference pressure (about
    4.9 kPa at 8 mm) pushes it into the road with no balancing force - about 22 N a wheel. The kernel adds
    c_o (f_o + f_i) per wall link; at rest that is 2 w_i c_o, which is subtracted every step.
    """
    C = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1), (1, 1, 0), (-1, -1, 0), (1, -1, 0), (-1, 1, 0),
         (1, 0, 1), (-1, 0, -1), (1, 0, -1), (-1, 0, 1), (0, 1, 1), (0, -1, -1), (0, 1, -1), (0, -1, 1)]
    NX = solid.shape[0]
    fluid = solid == 0
    inner = np.zeros(solid.shape, bool)
    inner[1:-1, 1:-1, 1:-1] = True
    fluid &= inner
    ref = np.zeros((nparts, NX, 3))
    for c in C:
        w = 1 / 18 if sum(map(abs, c)) == 1 else 1 / 36
        m = fluid & (np.roll(solid, c, axis=(0, 1, 2)) != 0)  # wall at x - c: population c bounces back into the cell
        if not m.any():
            continue
        xs = np.nonzero(m)[0]
        ps = np.roll(part, c, axis=(0, 1, 2))[m].astype(np.int64)
        cnt = np.bincount(ps * NX + xs, minlength=nparts * NX).reshape(nparts, NX)
        for k in range(3):
            if c[k]:
                ref[:, :, k] += -2.0 * w * c[k] * cnt  # c_o = -c
    return ref


def case_name(yaw, dx, tag=""):
    y = int(round(yaw))
    return f"yaw{'m' if y < 0 else ''}{abs(y):02d}_dx{dx:g}" + (f"_{tag}" if tag else "")


def load_cad(pack="data/cad/parts"):
    doc = cad_doc(pack)
    blob = (ROOT / (pack + ".bin")).read_bytes()
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
    ap.add_argument("--cad", default="data/cad/parts", help="CAD pack (repo-relative, no extension), e.g. data/cad/variants/st28/parts")
    ap.add_argument("--label", default="", help="configuration label shown with the case")
    ap.add_argument("--static", action="store_true", help="earlier protocol: no ground, wheels still")
    ap.add_argument("--shift", type=float, default=0.0, help="move the lattice by this fraction of a cell (discretisation check)")
    ap.add_argument("--shift-axes", default="xyz", help="axes the shift applies to, e.g. xz keeps the tyre-ground contact")
    a = ap.parse_args()
    dx = a.dx / 1000.0
    case = OUT / case_name(a.yaw, a.dx, a.tag)
    spin = not a.static
    case.mkdir(parents=True, exist_ok=True)

    meshes = load_cad(a.cad)
    yaw = math.radians(a.yaw)
    R = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])  # bike turned about +Y
    meshes = [(g, v @ R.T, t, n) for g, v, t, n in meshes]
    allv = np.vstack([m[1] for m in meshes])
    lo, hi = allv.min(0), allv.max(0)
    lo_d = lo - np.array([1.6, 0.55, 0.62])  # downstream (-X) 1.6 m, below/beside 0.55-0.62 m
    sv = np.array([a.shift * dx if ax in a.shift_axes else 0.0 for ax in "xyz"])
    lo_d = lo_d + sv  # sub-cell offset: same bike, different voxels
    doc = cad_doc(a.cad)
    ground_y = doc["ground_y"] / 1000.0  # tyre contact height (bike frame; unchanged by yaw about +Y)
    if spin:
        lo_d[1] = ground_y - 3 * dx + sv[1]  # the domain stops three cells into the moving ground (plus any --shift)
    hi_d = hi + np.array([0.8, 0.55, 0.62])  # upstream (+X) 0.8 m
    shape = tuple(int(math.ceil(s / dx)) for s in hi_d - lo_d)
    nx, ny, nz = shape
    solid, part = lbm.voxelise([(g, v, t) for g, v, t, n in meshes], lo_d, dx, shape)
    ng = len(GROUPS) + 1
    GROUND = ng  # its own force row, never counted in the bike's drag
    mw = np.zeros((ng + 1, 10), np.float64)  # [flag, centre xyz, omega xyz, v0 xyz] per part, padded lattice units
    if spin:
        Vg = a.ulb * math.cos(yaw)  # road speed: the along-heading part of the apparent wind
        yc = lo_d[1] + (np.arange(ny) + 0.5) * dx
        below = (yc < ground_y)[None, :, None] & (solid == 0)
        solid[below] = 1
        part[below] = GROUND
        mw[GROUND, 0] = 1.0
        mw[GROUND, 7:10] = R @ np.array([-Vg, 0.0, 0.0])
        Rw = doc["wheel_radius_mm"] / 1000.0
        for name in ("rim_front", "rim_rear"):
            vv = next(v for g_, v, t, n in meshes if n == name)
            centre = (vv.min(0) + vv.max(0)) / 2  # rims are lathes about the axle
            gid = group_of(name)
            mw[gid, 0] = 1.0
            mw[gid, 1:4] = (centre - lo_d) / dx - 0.5 + 1  # +1: the padding layer
            mw[gid, 4:7] = R @ np.array([0.0, 0.0, -Vg / (Rw / dx)])  # top of the tyre moves forward, contact patch matches the road
        # Contact-patch plinth, as in automotive CFD: the wedge between a turning tyre and the road is one
        # or two cells high for ~100 mm either side of the contact, and fluid trapped between two staircase
        # moving walls there pumps mass until the run diverges. Gaps of PLINTH cells or less become ground.
        PLINTH = 2
        wheel = (part == group_of("rim_front")) | (part == group_of("rim_rear"))
        jg = int(np.searchsorted(yc, ground_y))  # first row above the ground
        band = wheel[:, jg:jg + PLINTH + 1, :]
        has = band.any(1)
        first = np.where(has, band.argmax(1), -1)
        fill = np.zeros(solid.shape, bool)
        for k in range(PLINTH):
            fill[:, jg + k, :] = has & (k < first)
        fill &= solid == 0
        solid[fill] = 1
        part[fill] = GROUND
        print(f"moving ground from row {jg}, contact plinth {int(fill.sum())} cells", flush=True)
    # Sealed fluid pockets (between a yawed tyre and its rim the staircase can close a cavity) have no way to
    # relax: ringed by moving walls they drift in density until the run diverges. They become solid, of the
    # nearest part, so the domain keeps one connected fluid region.
    from scipy import ndimage
    npocket = 0
    lab, nlab = ndimage.label(solid == 0, structure=ndimage.generate_binary_structure(3, 2))
    if nlab > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        pocket = (lab != 0) & (lab != sizes.argmax())
        near = ndimage.distance_transform_edt(solid == 0, return_distances=False, return_indices=True)
        part[pocket] = part[tuple(ix[pocket] for ix in near)]
        solid[pocket] = 1
        npocket = int(pocket.sum())
        print(f"sealed fluid pockets: {nlab - 1}, {int(pocket.sum())} cells filled, parts {np.unique(part[pocket]).tolist()}", flush=True)
        del near
    del lab
    # Fluid slivers in a moving wall: at yaw the voxelised wheel leaves single fluid cells with most of their
    # 26 neighbours wheel; nearly every link is a moving wall, the Ladd terms drain them and the run diverges.
    # A cell with >= SLIVER solid neighbours, at least one moving, joins the majority neighbouring part.
    SLIVER = 18
    movp = np.flatnonzero(mw[:, 0] != 0)
    nfill = 0
    while True:
        sp = np.pad(solid, 1, mode="edge"); pp = np.pad(part, 1, mode="edge")
        cnt = sum(sp[1 + i:1 + i + nx, 1 + j:1 + j + ny, 1 + k:1 + k + nz].astype(np.int8) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if i or j or k)
        cand = (solid == 0) & (cnt >= SLIVER)
        if not cand.any():
            break
        cx_ = np.argwhere(cand)
        nb_parts = np.stack([pp[cx_[:, 0] + 1 + i, cx_[:, 1] + 1 + j, cx_[:, 2] + 1 + k] for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if i or j or k], 1)
        nb_solid = np.stack([sp[cx_[:, 0] + 1 + i, cx_[:, 1] + 1 + j, cx_[:, 2] + 1 + k] for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if i or j or k], 1) != 0
        moving_nb = (np.isin(nb_parts, movp) & nb_solid).any(1)
        if not moving_nb.any():
            break
        cx_, nb_parts, nb_solid = cx_[moving_nb], nb_parts[moving_nb], nb_solid[moving_nb]
        maj = np.array([np.bincount(r[m_]).argmax() for r, m_ in zip(nb_parts, nb_solid)])
        solid[tuple(cx_.T)] = 1; part[tuple(cx_.T)] = maj
        nfill += len(cx_)
    print(f"moving-wall slivers filled: {nfill}", flush=True)
    dt = a.ulb * dx / U
    nu_lb = NU * dt / dx ** 2
    tau0 = 3 * nu_lb + 0.5
    steps_flow = int(round((hi_d[0] - lo_d[0]) / dx / a.ulb))
    steps = int(a.flows * steps_flow)
    avg_from = steps - int(a.avg * steps_flow)
    print(f"grid {nx}x{ny}x{nz} = {nx * ny * nz / 1e6:.1f} M, solid {int(solid.sum()):,}, dt {dt * 1e6:.1f} us, "
          f"tau0-0.5 = {tau0 - 0.5:.2e}, {steps} steps ({steps_flow}/flow-through)", flush=True)

    # The ground runs into the padding: edge-padded, its ghost cells stay solid (and moving) instead of
    # fluid ghosts that copy the zeroed solid values, which leaked mass at the outlet and pushed a
    # pressure gradient along the floor. Nothing else touches the domain faces, so 'edge' is safe.
    pad = "edge" if spin else "constant"
    solid_p, part_p = np.pad(solid, 1, mode=pad), np.pad(part, 1, mode=pad)
    f = np.empty((19, nx + 2, ny + 2, nz + 2), np.float32)
    lbm.init(f, solid_p, a.ulb)
    g = f.copy()
    force = np.zeros((ng + 1, nx + 2, 3), np.float64)
    fref = reference_force(solid_p, part_p, ng + 1)
    print("reference force removed (N, x y z): " + ", ".join(f"{n} {np.round(fref[i + 1].sum(0) * RHO * dx ** 4 / dt ** 2, 2).tolist()}" for i, n in enumerate(list(GROUPS)) if np.abs(fref[i + 1]).sum()), flush=True)
    gacc = np.zeros(3)  # mean force on the moving ground over the window (should stay near zero)
    acc = np.zeros((4, nx + 2, ny + 2, nz + 2), np.float32)
    fprof = np.zeros((ng - 1, nx, 3), np.float64)  # time-averaged force per lattice x-slab and group (drag build-up, centre of pressure)
    n_acc, n_prof, hist = 0, 0, []
    fblock = np.zeros((ng + 1, 3))
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
        K.step(f, g, solid_p, part_p, tau0, k0, force, mw)
        force -= fref
        f, g = g, f
        fg = force.sum(1) * fscale  # (groups, xyz) in N
        # The wall force on some parts alternates from one step to the next (a period-2 lattice mode), so
        # history rows are 10-step block means, never point samples: sampling every 10th step reads one phase.
        fblock += fg
        if s % 10 == 9:
            hist.append([(s - 4.5) * dt] + (fblock[1:ng] / 10).reshape(-1).tolist())
            fblock[:] = 0
        if s >= avg_from:
            fprof += force[1:ng, 1:-1, :]
            gacc += force[ng].sum(0)
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
        if DEBUG and s % 25 == 0:
            rho = f[:, 1:-1, 1:-1, 1:-1].sum(0)
            bad = (~np.isfinite(rho) | (np.abs(rho - 1) > 0.3)) & (solid == 0)
            ff = np.abs(fg).max(1)
            print(f"  dbg {s}: rho [{np.nanmin(rho[solid == 0]):.3f},{np.nanmax(rho[solid == 0]):.3f}] bad {int(bad.sum())} maxF/group {np.round(ff,1).tolist()}", flush=True)
            if bad.any():
                ix = np.argwhere(bad)
                c = ix[np.argmax(np.abs(np.nan_to_num(rho[bad], nan=99) - 1))]
                x0, y0, z0 = c
                nb_ = part[max(x0-3,0):x0+4, max(y0-3,0):y0+4, max(z0-3,0):z0+4]
                print(f"  dbg BAD at cell {c.tolist()} of {[nx,ny,nz]}, pos {(lo_d + (c + 0.5) * dx).round(3).tolist()} m, ground_y {ground_y:.3f}, parts nearby {np.unique(nb_).tolist()} (ground={GROUND}), bbox {ix.min(0).tolist()}-{ix.max(0).tolist()}", flush=True)
                for c_ in ix[:5]:
                    xs, ys, zs = c_
                    blk_ = solid[xs-1:xs+2, ys-1:ys+2, zs-1:zs+2]; pb_ = part[xs-1:xs+2, ys-1:ys+2, zs-1:zs+2]
                    print(f"  dbg cell {c_.tolist()} rho {rho[xs, ys, zs]:.3f} solid nbrs {int(blk_.sum())}/26 parts {pb_.ravel().tolist()}", flush=True)
                raise RuntimeError("diverged")
        if s % 500 == 0:
            el = time.time() - t0
            drag = -fg[1:ng, 0].sum()
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
        "assumptions": {"air_density": RHO, "kinematic_viscosity": NU, "speed_kmh": 40, "yaw_deg": a.yaw, "ground": "moving at road speed, 2-cell contact plinth" if spin else "none (free stream)", "wheels": "spinning at road speed" if spin else "static", "protocol": "standard" if spin else "static", "reference_pressure": "rest-state momentum exchange subtracted per part (contact patches)", "voxel_cleanup": {"moving_wall_slivers_filled": nfill, "sealed_pocket_cells_filled": npocket},
                        "omitted": "spokes, chain, cables, bolts, rider", "turbulence": "LES, laminar inflow"},
        "grid": {"dx_mm": a.dx, "cells": [nx, ny, nz], "cells_total": nx * ny * nz, "solid_cells": int(solid.sum()), "domain_m": [lo_d.tolist(), hi_d.tolist()],
                 "lattice_speed": a.ulb, "dt_s": dt, "steps": steps, "averaged_steps": int(window.sum() * 10), "flow_throughs": a.flows, "wall_time_s": time.time() - t0},
        "drag_N": total, "CdA_m2": 2 * total / (RHO * U * U), "drag_by_group_N": drag,
        "side_force_N": float(gforce_bike[:, 2].sum()), "lift_N": float(gforce[:, 1].sum()),
        "power_W_at_40kmh": total * U,
        "force_by_group_N": {n: gforce_bike[i].tolist() for i, n in enumerate(names)},  # bike frame [x fwd, y up, z drive side]
        "force_average": "every step of the window",
        "ground_force_N": (gacc * fscale / max(n_prof, 1)).tolist() if spin else None,
        "lattice_shift_cells": a.shift, "lattice_shift_axes": a.shift_axes,
        "cad_pack": a.cad, "config_label": a.label or ("Installed build" if a.cad == "data/cad/parts" else a.cad),
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
