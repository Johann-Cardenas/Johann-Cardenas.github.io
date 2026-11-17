"""Post-process a wind-tunnel case into data/cfd/<case>.json + .bin for the website.

  slices       |U|/U_inf and Cp on the side (z = 0), plan (y = 0.30 m) and wake (x = 0.15 m behind the rear tyre) planes, uint8
  streamlines  RK2 through the time-averaged field from an upstream seed grid; float16 points + uint8 speed
  surface      Cp just off every CAD vertex of the wind-tunnel parts (parts.json order), uint8
  volume       speed, Cp, |vorticity| and Q on a 16 mm grid round the bike and its wake (tunnel frame,
               x fastest), uint8 with per-field ranges: scrubbable slices and isosurfaces in the browser
  profile      time-averaged drag and side force per 16 mm x-slab and drag group (runs with fprof)
  cases.json   one row per post-processed case, for the yaw sweep
Run:  python cad/cfd_post.py yaw00_dx8
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates, gaussian_filter

sys.path.insert(0, str(Path(__file__).parent))
import wind_tunnel as WT  # noqa: E402

ROOT = WT.ROOT
CP_RANGE, SPEED_RANGE = (-1.6, 1.0), (0.0, 1.5)
VALIDATION = {"sphere_Re": 5e4, "reference_Cd": "0.47-0.50 (subcritical sphere)",
              "Cd_24_cells_per_D": 0.597, "Cd_12_cells_per_D": 0.694,
              "note": "Same solver and wall treatment. At the bike's resolution (main tubes about 6-8 cells across) absolute drag reads high; differences between configurations are the reliable output."}


def q8(a, lo, hi):
    return np.clip(np.round((a - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)


def main(case_name):
    case = WT.OUT / case_name
    r = np.load(case / "result.npz")
    summary = json.loads((case / "summary.json").read_text(encoding="utf-8"))
    rho = r["rho"].astype(np.float32)
    u = np.stack([r["ux"], r["uy"], r["uz"]]).astype(np.float32)
    solid = r["solid"].astype(bool)
    origin, dx, ulb, R = r["origin"], float(r["dx"]), float(r["ulb"]), r["R"]
    nx, ny, nz = solid.shape
    rho_ref = float(np.median(rho[-3:, :, :][~solid[-3:, :, :]]))
    cp = ((rho - rho_ref) / 3.0) / (0.5 * ulb * ulb)
    speed = np.linalg.norm(u, axis=0) / ulb
    cp[solid], speed[solid] = 0.0, 0.0
    idx = lambda p: (np.asarray(p, float) - origin) / dx - 0.5  # metres -> fractional cell index

    blob = bytearray()

    def put(a, align=4):
        while len(blob) % align:
            blob.append(0)
        off = len(blob)
        blob.extend(np.ascontiguousarray(a).tobytes())
        return off

    # ------------------------------------------------------------------ slices
    meshes = WT.load_cad()
    allv = np.vstack([m[1] for m in meshes]) @ R.T
    lo, hi = allv.min(0), allv.max(0)
    slices = []
    k = int(round(idx([0, 0, 0])[2]))
    slices.append({"name": "side", "axis": "z", "at_m": 0.0, "w": nx, "h": ny, "box": [origin[0], origin[1], origin[0] + nx * dx, origin[1] + ny * dx],
                   "speed": put(q8(speed[:, :, k].T, *SPEED_RANGE)), "cp": put(q8(cp[:, :, k].T, *CP_RANGE)), "solid": put(solid[:, :, k].T.astype(np.uint8))})
    j = int(round(idx([0, 0.30, 0])[1]))
    slices.append({"name": "plan", "axis": "y", "at_m": 0.30, "w": nx, "h": nz, "box": [origin[0], origin[2], origin[0] + nx * dx, origin[2] + nz * dx],
                   "speed": put(q8(speed[:, j, :].T, *SPEED_RANGE)), "cp": put(q8(cp[:, j, :].T, *CP_RANGE)), "solid": put(solid[:, j, :].T.astype(np.uint8))})
    xw = lo[0] - 0.15
    i = int(round(idx([xw, 0, 0])[0]))
    slices.append({"name": "wake", "axis": "x", "at_m": xw, "w": nz, "h": ny, "box": [origin[2], origin[1], origin[2] + nz * dx, origin[1] + ny * dx],
                   "speed": put(q8(speed[i, :, :], *SPEED_RANGE)), "cp": put(q8(cp[i, :, :], *CP_RANGE)), "solid": put(solid[i, :, :].astype(np.uint8))})

    # ------------------------------------------------------------------ streamlines (mean field)
    def vel(p):
        c = idx(p).T
        return np.stack([map_coordinates(u[a], c, order=1, mode="nearest") for a in range(3)], 1) / ulb  # in U_inf

    seeds = [[hi[0] + 0.25, y, z] for y in np.linspace(lo[1] + 0.02, hi[1] - 0.02, 26) for z in np.linspace(-0.26, 0.26, 14)]
    pts = np.array(seeds, float)
    h = 0.6 * dx
    lines = [[p.copy()] for p in pts]
    sp = [[1.0] for _ in pts]
    alive = np.ones(len(pts), bool)
    bounds_lo, bounds_hi = origin + dx, origin + np.array([nx, ny, nz]) * dx - dx
    for _ in range(1400):
        if not alive.any():
            break
        p = pts[alive]
        v1 = vel(p)
        v2 = vel(p + 0.5 * h * v1 / np.maximum(np.linalg.norm(v1, axis=1, keepdims=True), 1e-3))
        n2 = np.maximum(np.linalg.norm(v2, axis=1, keepdims=True), 1e-3)
        p = p + h * v2 / n2
        pts[alive] = p
        ids = np.flatnonzero(alive)
        for q, pp, s in zip(ids, p, n2[:, 0]):
            lines[q].append(pp.copy())
            sp[q].append(float(s))
        out = (p < bounds_lo).any(1) | (p > bounds_hi).any(1) | (p[:, 0] < lo[0] - 1.1)
        stuck = n2[:, 0] < 0.03
        alive[ids[out | stuck]] = False
    keep = [(np.array(l[::3]), np.array(s[::3])) for l, s in zip(lines, sp) if len(l) > 40]
    off_pts = []
    for l, s in keep:
        off_pts.append({"n": len(l), "pts": put(l.astype(np.float16), 2), "speed": put(q8(s, *SPEED_RANGE), 1)})

    # ------------------------------------------------------------------ surface Cp at the CAD vertices
    doc = json.loads((ROOT / "data/cad/parts.json").read_text(encoding="utf-8"))
    cad = (ROOT / "data/cad/parts.bin").read_bytes()
    off, sc = np.array(doc["offset"]), np.array(doc["scale"])
    surf = []
    for p in doc["parts"]:
        if not p["aero"]:
            continue
        v = ((np.frombuffer(cad, np.int16, p["pos"][1] * 3, p["pos"][0]).reshape(-1, 3).astype(np.float64) + 32767) * sc + off) / 1000.0
        t = np.frombuffer(cad, np.uint32, p["idx"][1], p["idx"][0]).reshape(-1, 3)
        nrm = np.zeros_like(v)
        fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
        for a in range(3):
            np.add.at(nrm, t[:, a], fn)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
        probe = (v + nrm * 1.6 * dx) @ R.T
        c = idx(probe).T
        val = map_coordinates(cp, c, order=1, mode="nearest")
        surf.append({"name": p["name"], "n": len(v), "cp": put(q8(val, *CP_RANGE), 1)})

    # ------------------------------------------------------------------ volume
    VDX = 0.016
    vlo = np.array([lo[0] - 1.2, lo[1] - 0.10, lo[2] - 0.30])
    vhi = np.array([hi[0] + 0.20, hi[1] + 0.15, hi[2] + 0.30])
    vn = np.maximum(((vhi - vlo) / VDX).astype(int), 2)
    i0 = np.maximum(np.floor(idx(vlo)).astype(int) - 3, 0)
    i1 = np.minimum(np.ceil(idx(vhi)).astype(int) + 4, [nx, ny, nz])
    crop = tuple(slice(a, b) for a, b in zip(i0, i1))
    uc = u[(slice(None),) + crop] / ulb  # U_inf = 1
    sol = solid[crop]
    from scipy.ndimage import binary_dilation
    near = binary_dilation(sol, iterations=2)
    g = [np.gradient(uc[a], dx) for a in range(3)]  # g[a][b] = d u_a / d x_b, 1/m with U_inf = 1
    wx, wy, wz = g[2][1] - g[1][2], g[0][2] - g[2][0], g[1][0] - g[0][1]
    Uinf = 40 / 3.6
    wn2 = wx * wx + wy * wy + wz * wz
    vort = np.sqrt(wn2) * Uinf  # 1/s
    S2 = sum((0.5 * (g[a][b] + g[b][a])) ** 2 for a in range(3) for b in range(3))
    Q = 0.5 * (0.5 * wn2 - S2) * Uinf ** 2  # 0.5(|Omega|^2 - |S|^2), 1/s^2
    del wn2
    vort[near], Q[near] = 0, 0
    del g, wx, wy, wz, S2
    gx, gy, gz = [vlo[a] + (np.arange(vn[a]) + 0.5) * VDX for a in range(3)]
    Zg, Yg, Xg = np.meshgrid(gz, gy, gx, indexing="ij")  # (nz, ny, nx): x fastest in memory
    pc = (np.stack([Xg, Yg, Zg], -1).reshape(-1, 3) - origin) / dx - 0.5 - i0
    def samp(a, sigma=0.7):
        return map_coordinates(gaussian_filter(a, sigma), pc.T, order=1, mode="nearest").reshape(Zg.shape)
    vfields = {"speed": (samp(speed[crop]), SPEED_RANGE), "cp": (samp(cp[crop]), CP_RANGE)}
    vs = samp(vort, 0.9)
    vfields["vort"] = (vs, (0.0, float(np.percentile(vs[vs > 0], 99.5)) if (vs > 0).any() else 1.0))
    qs = np.maximum(samp(Q, 1.0), 0)
    vfields["q"] = (qs, (0.0, float(np.percentile(qs[qs > 0], 99.5)) if (qs > 0).any() else 1.0))
    vsolid = samp(sol.astype(np.float32), 0) > 0.5
    volume = {"lo_m": vlo.tolist(), "dx_m": VDX, "n": vn.tolist(), "fields": {}, "solid": put(np.packbits(vsolid.reshape(-1), bitorder="little"), 1)}
    for k, (a, rng) in vfields.items():
        volume["fields"][k] = {"range": list(rng), "off": put(q8(a, *rng), 1)}
    del uc, vort, Q, vfields

    # ------------------------------------------------------------------ drag build-up along the tunnel
    profile = None
    if "fprof" in r.files:
        fp = r["fprof"].astype(np.float64)  # (groups, nx, 3) N, tunnel frame
        k2 = 2
        m = fp.shape[1] // k2 * k2
        fb = fp[:, :m].reshape(fp.shape[0], -1, k2, 3).sum(2)
        side_b = fb @ R  # back to bike axes per bin for the side force
        profile = {"x0_m": float(origin[0]), "dx_m": dx * k2, "n": int(fb.shape[1]),
                   "drag": put((-fb[:, :, 0]).astype(np.float32)), "side": put(side_b[:, :, 2].astype(np.float32))}

    hist = r["hist"]
    hist_out = hist[:: max(1, len(hist) // 400), :]
    groups = list(WT.GROUPS)
    out = {"schema": "synapse-cfd/1", "case": case_name, "summary": summary, "validation": VALIDATION,
           "ranges": {"cp": CP_RANGE, "speed": SPEED_RANGE}, "bike_box_m": [lo.tolist(), hi.tolist()], "yaw_R": R.tolist(),
           "slices": slices, "streamlines": off_pts, "surface": surf, "groups": groups, "volume": volume, "profile": profile,
           "history": {"t_s": hist_out[:, 0].tolist(), "drag_N": (-hist_out[:, 1::3][:, :len(groups)].sum(1)).tolist()}}
    while len(blob) % 4:
        blob.append(0)
    out["bytes"] = len(blob)
    dst = ROOT / "data" / "cfd"
    dst.mkdir(parents=True, exist_ok=True)
    (dst / f"{case_name}.bin").write_bytes(bytes(blob))
    (dst / f"{case_name}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    cases = []
    for f in sorted(dst.glob("yaw*_dx*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        sm = d["summary"]
        cases.append({"case": d["case"], "yaw_deg": sm["assumptions"]["yaw_deg"], "dx_mm": sm["grid"]["dx_mm"], "CdA_m2": sm["CdA_m2"], "drag_N": sm["drag_N"],
                      "side_force_N": sm["side_force_N"], "lift_N": sm["lift_N"], "drag_by_group_N": sm["drag_by_group_N"],
                      "force_by_group_N": sm.get("force_by_group_N"), "profile": bool(d.get("profile"))})
    cases.sort(key=lambda c: (c["dx_mm"], c["yaw_deg"]))
    (dst / "cases.json").write_text(json.dumps({"schema": "synapse-cfd-cases/1", "speed_kmh": 40, "cases": cases}, indent=1), encoding="utf-8")
    print(f"{len(off_pts)} streamlines, {len(surf)} surface parts, {len(blob) / 1e6:.2f} MB, CdA {summary['CdA_m2']:.4f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "yaw00_dx8")
