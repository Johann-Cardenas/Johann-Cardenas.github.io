"""Parametric B-rep model of the bicycle (CadQuery / OpenCascade).

One geometry source for SolidWorks, Flow Simulation and Abaqus. It reads the same
data/geometry.json and data/components.json as the web model and follows the same
construction (frame paths, fork bend, rim and tyre profiles, tooth forms), so the CAD
and the browser model agree. Millimetres; BB origin, +X forward, +Y up, +Z drive side.

Every part carries: slot (catalog slot), colour, and `aero` (kept in the wind-tunnel
model) / `fe` (meshed by Abaqus) flags.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import cadquery as cq
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
V = cq.Vector


# ---------------------------------------------------------------------------- inputs
def load_inputs():
    geom = json.loads((ROOT / "data/geometry.json").read_text(encoding="utf-8"))
    cat = json.loads((ROOT / "data/components.json").read_text(encoding="utf-8"))
    parts = {p["id"]: p for p in cat["components"]}
    cfg = {slot: parts[i] for slot, i in cat["default_config"].items()}
    return geom, cfg


def hardpoints(g):
    ha, sa = math.radians(g["head_angle_deg"]), math.radians(g["seat_angle_deg"])
    ht = np.array([g["reach_mm"], g["stack_mm"], 0.0])
    hb = ht + np.array([g["head_tube_mm"] * math.cos(ha), -g["head_tube_mm"] * math.sin(ha), 0])
    front = (ht[1] - g["bb_drop_mm"]) * math.cos(ha) / math.sin(ha) + ht[0] + g["fork_rake_mm"] / math.sin(ha)
    return {
        "bb": np.zeros(3), "ht": ht, "hb": hb,
        "ra": np.array([-math.sqrt(g["chainstay_mm"] ** 2 - g["bb_drop_mm"] ** 2), g["bb_drop_mm"], 0]),
        "fa": np.array([front, g["bb_drop_mm"], 0]),
        "st": np.array([-g["seat_tube_mm"] * math.cos(sa), g["seat_tube_mm"] * math.sin(sa), 0]),
        "up": np.array([-math.cos(ha), math.sin(ha), 0]), "fwd": np.array([math.sin(ha), math.cos(ha), 0]),
        "s_axis": np.array([-math.cos(sa), math.sin(sa), 0]),
    }


def fit(g, hp, p):
    sa = math.radians(g["seat_angle_deg"])
    saddle = np.array([-p["saddle_height_mm"] * math.cos(sa) - p["saddle_setback_mm"], p["saddle_height_mm"] * math.sin(sa), 0])
    base = hp["ht"] + hp["up"] * (15 + p["spacers_mm"] + 20)
    a = math.radians(p["stem_angle_deg"])
    d = hp["fwd"] * math.cos(a) + hp["up"] * math.sin(a)
    return {"saddle": saddle, "stem_base": base, "stem_dir": d, "bar": base + d * p["stem_length_mm"]}


# ---------------------------------------------------------------------------- curves
def catmull(points, n=48):
    """Uniform Catmull-Rom (tension 0.5) through points, resampled at equal arc length."""
    P = np.array(points, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    dense = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, 40, endpoint=False):
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(P[-2])
    dense = np.array(dense)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))])
    u = np.linspace(0, s[-1], n)
    return np.array([np.interp(u, s, dense[:, k]) for k in range(3)]).T


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def pick(spec, u, k):
    if "mid" in spec:
        if u <= 0.5:
            return spec["start"][k] + (spec["mid"][k] - spec["start"][k]) * smooth(u / 0.5)
        return spec["mid"][k] + (spec["end"][k] - spec["mid"][k]) * smooth((u - 0.5) / 0.5)
    return spec["start"][k] + (spec["end"][k] - spec["start"][k]) * u


def section_of(spec, flare0=0.0, flare1=0.0, len0=0.1, len1=0.1):
    def f(u):
        k = 1 + flare0 * (1 - smooth(u / len0)) + flare1 * (1 - smooth((1 - u) / len1))
        return pick(spec, u, "a") * k, pick(spec, u, "b") * k
    return f


def superellipse_wire(c, N, B, a, b, n=2.0, m=36):
    pts = []
    for j in range(m):
        ph = 2 * math.pi * j / m
        cs, sn = math.cos(ph), math.sin(ph)
        x = a * math.copysign(abs(cs) ** (2 / n), cs)
        y = b * math.copysign(abs(sn) ** (2 / n), sn)
        pts.append(V(*(c + N * x + B * y)))
    return cq.Wire.assembleEdges([cq.Edge.makeSpline(pts + [pts[0]], periodic=False)])


def tube(path, section, side=(0, 0, 1), stations=11, n_exp=None, transport=False):
    """Loft superelliptical sections placed normal to a sampled path."""
    path = np.asarray(path, float)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    us = np.linspace(0, 1, stations)
    wires, Bprev = [], None
    for u in us:
        i = int(np.clip(np.searchsorted(s / s[-1], u), 1, len(path) - 1))
        f = (u * s[-1] - s[i - 1]) / max(s[i] - s[i - 1], 1e-9)
        c = path[i - 1] + (path[i] - path[i - 1]) * f
        j0, j1 = max(i - 2, 0), min(i + 1, len(path) - 1)
        t = path[j1] - path[j0]; t /= np.linalg.norm(t)
        B = np.array(Bprev if (transport and Bprev is not None) else side, float)
        B = B - t * B.dot(t)
        if np.linalg.norm(B) < 0.2:
            B = np.array([0, 1.0, 0]) - t * t[1]
        B /= np.linalg.norm(B); Bprev = B
        N = np.cross(B, t); N /= np.linalg.norm(N)
        sec = section(u)
        a, b = sec[0], sec[1]
        n = sec[2] if len(sec) > 2 else (n_exp or 2.0)
        if abs(n - 2.0) < 0.05:
            w = cq.Wire.makeEllipse(max(a, b), min(a, b), V(*c), V(*t), V(*(N if a >= b else B)))
        else:
            w = superellipse_wire(c, N, B, a, b, n)
        wires.append(w)
    return cq.Solid.makeLoft(wires, ruled=False)


def sweep_circle(path, r):
    """Round bar swept along a sampled 3D path (corrected-Frenet frame; straight runs have no Frenet normal)."""
    path = np.asarray(path, float)
    spine = cq.Wire.assembleEdges([cq.Edge.makeSpline([V(*q) for q in path])])
    t = path[1] - path[0]; t /= np.linalg.norm(t)
    prof = cq.Wire.makeCircle(r, V(*path[0]), V(*t))
    solid = cq.Solid.sweep(prof, [], spine, makeSolid=True, isFrenet=False, mode=None, transitionMode="right")
    if solid.Volume() < 0:  # OpenCascade can return the pipe inside out; flip it so booleans and exports agree
        solid = cq.Solid(solid.wrapped.Reversed())
    return solid


def revolve(profile, axis_point=(0, 0, 0)):
    """Solid of revolution about the global Z axis through axis_point. Profile is [(r, z), ...]."""
    pts = [(r, z) for r, z in profile]
    wp = cq.Workplane("XZ").polyline(pts).close()
    solid = wp.revolve(360, (0, 0, 0), (0, 1, 0)).val()   # XZ plane: local Y is global -Z... revolve about local Y
    # The XZ workplane maps local (x, y) to global (x, z) with local y along global -Z? Align explicitly:
    return solid


def lathe(profile, center=(0, 0, 0)):
    """Revolve a closed (radius, z) profile about global Z, then move to `center`."""
    edges_pts = [V(r, 0, z) for r, z in profile]
    wire = cq.Wire.makePolygon(edges_pts, close=True)
    face = cq.Face.makeFromWires(wire)
    solid = cq.Solid.revolve(face, 360, V(0, 0, 0), V(0, 0, 1))
    return solid.translate(V(*center))


def rod(a, b, r):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    return cq.Solid.makeCylinder(r, float(np.linalg.norm(d)), V(*a), V(*(d / np.linalg.norm(d))))


def extrude_xy(points, depth, z=0.0, holes=()):
    """Extrude a closed XY outline (with optional hole outlines) along +Z, centred on z."""
    outer = cq.Wire.makePolygon([V(x, y, 0) for x, y in points], close=True)
    inner = [cq.Wire.makePolygon([V(x, y, 0) for x, y in h], close=True) for h in holes]
    face = cq.Face.makeFromWires(outer, inner)
    return cq.Solid.extrudeLinear(face, V(0, 0, depth)).translate(V(0, 0, z - depth / 2))


def circle_pts(r, n=40, cx=0, cy=0, reverse=False):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return pts[::-1] if reverse else pts


def repair(shape):
    """ShapeFix any shape that fails BRepCheck (boolean cuts on lofts can leave bad edges)."""
    if isinstance(shape, cq.Compound) or shape.isValid():
        return shape
    from OCP.ShapeFix import ShapeFix_Shape
    fixer = ShapeFix_Shape(shape.wrapped)
    fixer.Perform()
    fixed = cq.Shape.cast(fixer.Shape())
    if not fixed.isValid():
        raise RuntimeError("Shape is invalid and ShapeFix could not repair it")
    return fixed


def fuse(solids):
    out = solids[0]
    for s in solids[1:]:
        out = out.fuse(s)
    return out.clean()


# ---------------------------------------------------------------------------- sprockets
PITCH, ROLLER = 12.7, 7.75
pitch_r = lambda N: PITCH / (2 * math.sin(math.pi / N))
tip_r = lambda N: PITCH * (0.6 + 1 / math.tan(math.pi / N)) / 2


def sprocket_pts(N, relief=0.0):
    R, Ro, rr = pitch_r(N), tip_r(N) - relief, ROLLER / 2 + 0.12
    seat, tip = math.radians(62), min(0.55 / Ro, math.pi / N * 0.22)
    pts = []
    for i in range(N):
        th = 2 * math.pi * i / N
        cx, cy = R * math.cos(th), R * math.sin(th)
        for k in range(7):
            d = seat - k / 6 * 2 * seat
            a = th + math.pi + d
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        mid = th + math.pi / N
        pts += [(Ro * math.cos(mid - tip), Ro * math.sin(mid - tip)), (Ro * math.cos(mid + tip), Ro * math.sin(mid + tip))]
    return pts


# ---------------------------------------------------------------------------- model
@dataclass
class Part:
    name: str
    slot: str
    solid: cq.Shape
    color: tuple
    aero: bool = True
    fe: bool = False
    note: str = ""
    extra: dict = field(default_factory=dict)


WHITE, RED, BLACK = (0.94, 0.94, 0.92), (0.77, 0.07, 0.19), (0.07, 0.07, 0.08)
ALU, STEEL, RUBBER, PLASTIC = (0.12, 0.12, 0.13), (0.62, 0.64, 0.67), (0.08, 0.08, 0.08), (0.1, 0.1, 0.11)


def build(geom=None, cfg=None, params=None, detail=True):
    if geom is None:
        geom, cfg = load_inputs()
    p = dict(geom["fit_defaults"]); p.update(params or {})
    hp = hardpoints(geom)
    tb, itf = geom["tubes"], geom["interfaces"]
    bb, ra, fa, ht, hb, st, up, fwd, sA = (hp[k] for k in ("bb", "ra", "fa", "ht", "hb", "st", "up", "fwd", "s_axis"))
    tire_w = cfg["tires"]["provides"].get("tire_width_mm", 23)
    R = 311 + tire_w
    ft = fit(geom, hp, p)
    parts: list[Part] = []
    def add(name, slot, solid, *a, **k):
        solid = repair(solid)
        pieces = solid.Solids() if hasattr(solid, "Solids") else [solid]
        if len(pieces) == 1:
            parts.append(Part(name, slot, pieces[0], *a, **k))
        else:  # disconnected bodies become separate parts in the same slot (one body per SolidWorks part)
            for i, piece in enumerate(sorted(pieces, key=lambda q: q.Center().z), 1):
                parts.append(Part(f"{name}_{i}", slot, piece, *a, **k))

    # ------------------------------------------------------------------ frame
    z0 = np.array([0, 0, 1.0])
    lines = []  # (name, part, centreline points, wall mm) for the Abaqus shell model
    def track(name, part_name, pts, wall):
        lines.append({"name": name, "part": part_name, "path": np.asarray(pts, float).tolist(), "wall": wall})
        return pts
    dt_top = hb + up * 34
    tt_front, tt_rear = ht - up * 26, bb + sA * (geom["seat_tube_mm"] - 30)
    tt_mid = (tt_rear + tt_front) / 2 + np.array([1.5, 8, 0])
    sec = lambda spec, **k: (lambda u: (*section_of(spec, **k)(u), pick(spec, u, "n")))
    frame = [
        tube(track("head_tube", "frame", catmull([hb - up * 3, (hb + ht) / 2, ht + up * 3], 12), tb["head_tube"]["wall_mm"]), lambda u: (pick(tb["head_tube"], u, "a"), pick(tb["head_tube"], u, "b"), 2.0), stations=7),
        tube(track("down_tube", "frame", catmull([bb, (bb + dt_top) / 2 + np.array([3, -3, 0]), dt_top], 40), tb["down_tube"]["wall_mm"]), sec(tb["down_tube"], flare0=0.10, flare1=0.16, len0=0.08, len1=0.10)),
        tube(track("top_tube", "frame", catmull([tt_rear, tt_mid, tt_front], 40), tb["top_tube"]["wall_mm"]), sec({"start": tb["top_tube"]["end"], "mid": tb["top_tube"]["mid"], "end": tb["top_tube"]["start"]}, flare0=0.22, flare1=0.20, len0=0.09, len1=0.10)),
        tube(track("seat_tube", "frame", catmull([bb, (bb + st) / 2, st + sA * 6], 36), tb["seat_tube"]["wall_mm"]), sec(tb["seat_tube"], flare0=0.12, len0=0.1)),
    ]
    w, bore = itf["bb_shell_width_mm"] / 2, itf["bb_bore_mm"] / 2
    frame.append(lathe([(bore, -w), (bore + 5.5, -w), (bore + 8, -w + 4), (bore + 9, 0), (bore + 8, w - 4), (bore + 5.5, w), (bore, w)]))
    slope = (ra[1] - bb[1]) / (ra[0] - bb[0])
    ss_top = bb + sA * (geom["seat_tube_mm"] - 40)
    drop_top, drop_front = np.array([ra[0] + 5, ra[1] + 17, 0]), np.array([ra[0] + 24, ra[1] - 2, 0])
    stay_dir = (ss_top - drop_top) / np.linalg.norm(ss_top - drop_top)
    perp = np.array([-stay_dir[1], stay_dir[0], 0])
    brake_r = 316.5 - 5.8 + itf["brake_reach_mm"]
    tB = next(i for i in range(400) if np.linalg.norm(drop_top + stay_dir * i - ra) >= brake_r)
    bridge = drop_top + stay_dir * tB
    for s in (-1, 1):
        cs = [np.array([x, y if y is not None else -slope * x, s * zz]) for x, y, zz in [(-6, 1, 21), (-42, 7, 28), (-88, 15, 33), (-210, 36, 47), (-320, 57, 59)]]
        cs.append(np.array([drop_front[0], drop_front[1], s * 63.5]))
        frame.append(tube(track("chainstay", "frame", catmull(cs, 44), tb["chainstay"]["wall_mm"]), sec(tb["chainstay"], flare0=0.2, len0=0.07)))
        at = lambda f, z, off=0: np.append(((1 - f) * ss_top + f * drop_top + perp * off)[:2], s * z)
        ss = [at(0, 9), at(0.09, 19, 1), at(0.28, 29, 4), at(0.55, 43, 1), at(0.82, 56, -3), at(1, 62.5)]
        frame.append(tube(track("seat_stay", "frame", catmull(ss, 48), tb["seat_stay"]["wall_mm"]), sec(tb["seat_stay"], flare0=0.35, len0=0.08)))
        # dropout: a plate joining both stays around the axle slot
        dz = s * (itf["rear_oln_mm"] / 2 + 3)
        outline = [(drop_front[0] + 6, drop_front[1] + 7), (drop_top[0] + 7, drop_top[1] + 6), (drop_top[0] - 6, drop_top[1] + 4),
                   (ra[0] - 15, ra[1] + 2), (ra[0] - 11, ra[1] - 10), (ra[0] + 4, ra[1] - 13), (drop_front[0] + 2, drop_front[1] - 8)]
        frame.append(extrude_xy(outline, 6, dz, holes=[circle_pts(5.2, 20, ra[0], ra[1], True)]))
    frame.append(rod(np.append(bridge[:2], -31), np.append(bridge[:2], 31), 6.5))
    collar = st.copy()
    frame.append(rod(collar - sA * 9, collar + sA * 11, 19.6))
    frame_solid = fuse(frame)
    # seatpost bore and BB bore
    frame_solid = frame_solid.cut(rod(st - sA * 120, st + sA * 20, 13.6)).cut(rod((0, 0, -w - 1), (0, 0, w + 1), bore)).clean()
    add("frame", "frameset", frame_solid, WHITE, fe=True, note="Carbon frame, unioned tubes")

    # ------------------------------------------------------------------ fork
    L_ac = (fa - hb).dot(np.array([math.cos(math.radians(geom["head_angle_deg"])), -math.sin(math.radians(geom["head_angle_deg"])), 0]))
    rake = geom["fork_rake_mm"]
    at = lambda d, f, z: np.append((hb - up * d + fwd * f)[:2], z)
    bend = lambda d: rake * max(0.0, (d - 90) / (L_ac - 90)) ** 2.1
    d_end = L_ac - 17
    fork = []
    for s in (-1, 1):
        pts = [at(9, 0, 0), at(11, 0, s * 16), at(19, 0, s * 34), at(34, 0, s * 46), at(60, 0, s * 51)]
        pts += [at(d, bend(d), s * 52.5) for d in (110, 170, 230, 280, 320)] + [at(d_end, bend(d_end), s * 53)]
        bspec = tb["fork_blade"]
        fork.append(tube(track("fork_blade", "fork", catmull(pts, 64), bspec["wall_mm"]), lambda u, bspec=bspec: (
            15 + (pick(bspec, u, "a") - 15) * smooth(u / 0.16), 23 + (pick(bspec, u, "b") - 23) * smooth(u / 0.16), 2.3 + (pick(bspec, u, "n") - 2.3) * smooth(u / 0.16)),
            side=fwd, transport=True, stations=13))
        tip = at(d_end, bend(d_end), 0)
        fz = s * (itf["front_oln_mm"] / 2 + 2.75)
        fork.append(rod(np.append(tip[:2], fz - 2.75), np.append(tip[:2], fz + 2.75), 7.5))
        fork.append(tube([np.append(tip[:2], fz), np.append(fa[:2], fz)], lambda u: (2.75, 9.5 - 1.5 * u, 2.0), side=z0, stations=3))
    fork.append(tube(catmull([hb + up * 1, hb - up * 6, hb - up * 22], 8), lambda u: (26 - 6 * u, 26 - 2 * u, 2.3), side=fwd, stations=5))
    top = ht + up * (15 + p["spacers_mm"] + 41)
    fork.append(rod(hb - up * 2, top, itf["steerer_mm"] / 2))
    add("fork", "frameset", fuse(fork), WHITE, fe=True, note="Carbon fork with steerer")
    add("headset_cover", "frameset", place(lathe([(14.4, 0), (26, 0), (25.5, 2), (20, 11), (17.6, 15), (14.4, 15)]), up, ht), ALU)

    # ------------------------------------------------------------------ wheels and tyres
    wv = cfg["wheels"].get("visual", {})
    width = wv.get("width", 20.5)
    for front, axle in ((True, fa), (False, ra)):
        tag = "front" if front else "rear"
        depth = (wv.get("depthRear") if not front else None) or wv.get("depth", 24)
        Ro, h = 316.5, width / 2
        rt, rn = Ro - 11.3, Ro - depth
        side_pts = [(rn + 0.6 + (rt - rn - 0.6) * t, 2.6 + (h - 2.6) * t ** 0.6) for t in np.linspace(0, 1, 9)]
        prof = [(rn, 0)] + [(r, -z) for r, z in side_pts] + [(Ro, -h), (Ro, -h + 1.7), (Ro - 5.2, -h + 2.2), (Ro - 5.2, h - 2.2), (Ro, h - 1.7), (Ro, h)] + [(r, z) for r, z in side_pts[::-1]]
        add(f"rim_{tag}", "wheels", lathe(prof, axle), ALU, extra={"axle": axle.tolist()})
        rc = R - tire_w / 2
        tp = [(Ro - 2.5, -(width / 2 - 1.2))] + [(rc + tire_w / 2 * math.cos(math.radians(a)), tire_w / 2 * 1.02 * math.sin(math.radians(a))) for a in np.linspace(-138, 138, 27)] + [(Ro - 2.5, width / 2 - 1.2)]
        add(f"tyre_{tag}", "tires", lathe(tp, axle), RUBBER)
        half = (itf["front_oln_mm"] if front else itf["rear_oln_mm"]) / 2
        fr, zL, zR = (19, -34, 34) if front else (24, -36, 20)
        body = ([(0.01, -half), (8.5, -half), (8.5, -half + 6), (11, -half + 9), (11, zL - 3.5), (fr + 2.5, zL - 2), (fr + 2.5, zL + 2), (12.5, zL + 6), (11.5, 0), (12.5, zR - 6), (fr + 2.5, zR - 2), (fr + 2.5, zR + 2), (11, zR + 3.5), (11, half - 9), (8.5, half - 6), (8.5, half), (0.01, half)]
                if front else
                [(0.01, -half), (9.5, -half), (9.5, -half + 7), (12, -half + 10), (12, zL - 3.5), (fr + 2.5, zL - 2), (fr + 2.5, zL + 2), (15, zL + 7), (14, -6), (16, zR - 7), (fr + 2.5, zR - 2), (fr + 2.5, zR + 2), (17.4, zR + 3.5), (17.4, half - 5.5), (9.5, half - 5.5), (9.5, half), (0.01, half)])
        add(f"hub_{tag}", "wheels", lathe(body, axle), ALU)
        if detail:
            n = wv.get("spokes", [18, 20])[0 if front else 1]
            cross = wv.get("cross", [0, 2])[0 if front else 1]
            m = n // 2
            for side in (0, 1):
                z = zR if side else zL
                # spoke heads seat in the flange: a ring there makes each side one connected solid
                sp = [lathe([(fr - 2.2, z - 1.2), (fr + 2.2, z - 1.2), (fr + 2.2, z + 1.2), (fr - 2.2, z + 1.2)], axle)]
                for i in range(m):
                    a = 2 * math.pi * (2 * i + side) / n
                    k = (cross if isinstance(cross, int) else 0) * (-1 if i % 2 else 1)
                    hub = axle + np.array([fr * math.cos(a + k * 2 * math.pi / m), fr * math.sin(a + k * 2 * math.pi / m), z])
                    rim = axle + np.array([(rn + 1.5) * math.cos(a), (rn + 1.5) * math.sin(a), 0])
                    sp.append(rod(hub, rim, 1.0))
                add(f"spokes_{tag}_{'drive' if side else 'left'}", "wheels", fuse(sp), STEEL, aero=False, note="Spokes are left out of the wind-tunnel model")

    # ------------------------------------------------------------------ drivetrain
    rings = [cfg["crankset"]["provides"].get("ring_big", 50), cfg["crankset"]["provides"].get("ring_small", 34)]
    cogs = cfg["cassette"].get("visual", {}).get("cogs", [11, 12, 13, 14, 15, 17, 19, 21, 24, 28])
    cl = itf["chainline_mm"]
    for N, z in ((rings[0], cl + 3.5), (rings[1], cl - 3.5)):
        add(f"chainring_{N}", "crankset", extrude_xy(sprocket_pts(N), 2.3, z, holes=[circle_pts(48 if N > 40 else 48, 48, reverse=True)]), ALU)
    spider = [(max([30] + [63 - 33 * min(1, (min(abs(a - k * 2 * math.pi / 5), 2 * math.pi - abs(a - k * 2 * math.pi / 5)) / math.radians(18)) ** 2.2) for k in range(1, 5)]) * math.cos(a),
               max([30] + [63 - 33 * min(1, (min(abs(a - k * 2 * math.pi / 5), 2 * math.pi - abs(a - k * 2 * math.pi / 5)) / math.radians(18)) ** 2.2) for k in range(1, 5)]) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 120, endpoint=False)]
    ang = math.radians(-20)
    crank = [extrude_xy(spider, 5, cl - 3.5 - 2.5).rotate(V(0, 0, 0), V(0, 0, 1), math.degrees(ang))]
    Lc = p["crank_length_mm"]
    for sgn, z0_, z1_ in ((1, 57, 67), (-1, -51, -67)):
        a = ang if sgn > 0 else ang + math.pi
        end = np.array([Lc * math.cos(a), Lc * math.sin(a), z1_])
        crank.append(tube([np.array([0, 0, z0_]), np.array([Lc * 0.5 * math.cos(a), Lc * 0.5 * math.sin(a), (z0_ + z1_) / 2]), end],
                          lambda u: (19 - 6.5 * u ** 0.8, 8.5 - 1.9 * u, 3.0), side=(0, 0, 1), stations=5))
        crank.append(rod(end - np.array([0, 0, 7.2]), end + np.array([0, 0, 7.2]), 14))
        crank.append(rod((0, 0, z0_ - 9 * sgn), (0, 0, z0_ + 9 * sgn), 23))
    crank.append(rod((0, 0, -60), (0, 0, 66), 15))
    add("crankset", "crankset", fuse(crank), ALU, note="Arms, spider and spindle")
    for sgn in (1, -1):
        a = ang if sgn > 0 else ang + math.pi
        c = np.array([Lc * math.cos(a), Lc * math.sin(a), sgn * 74])
        body = extrude_xy([(34, 4), (34, 10), (22, 62), (-30, 66), (-50, 52), (-52, 14), (-38, 4)], 11, 0).rotate(V(0, 0, 0), V(1, 0, 0), -90 if sgn > 0 else 90)
        add(f"pedal_{'right' if sgn > 0 else 'left'}", "pedals", body.translate(V(*c)), PLASTIC)
    cz = [cl + ((len(cogs) - 1) / 2 - i) * 3.95 for i in range(len(cogs))]
    cas = [extrude_xy(sprocket_pts(N), 1.75, cz[i], holes=[circle_pts(16.2, 28, reverse=True)]) for i, N in enumerate(cogs)]
    cas.append(rod((0, 0, cz[-1] - 1.5), (0, 0, cz[0] + 3.4), 19.5))
    add("cassette", "cassette", fuse(cas).translate(V(*ra)), STEEL)

    # rear derailleur (block approximation of the 105 body and cage), front derailleur
    ci = 4
    guide = ra + np.array([7, -(tip_r(cogs[ci]) + 9 + tip_r(11)), 0]); guide[2] = cz[ci]
    tension = guide + np.array([60 * math.cos(math.radians(-74)), 60 * math.sin(math.radians(-74)), 0])
    hanger = ra + np.array([-8, -28, 0])
    zH = itf["rear_oln_mm"] / 2 + 5
    rd = [rod(np.append(hanger[:2], zH), np.append(hanger[:2], zH + 16), 11),
          tube([np.append(hanger[:2] + [3, -13], zH + 9), np.append(guide[:2] + [3, 15], cz[ci] + 15)], lambda u: (8, 7, 3.2), side=(0, 0, 1), stations=3),
          rod(np.append(guide[:2], cz[ci] - 5.5), np.append(guide[:2], cz[ci] + 5.5), tip_r(11)),
          rod(np.append(tension[:2], cz[ci] - 5.5), np.append(tension[:2], cz[ci] + 5.5), tip_r(11)),
          tube([np.append(guide[:2], cz[ci] + 4.6), np.append(tension[:2], cz[ci] + 4.6)], lambda u: (12, 0.9, 2.0), side=(0, 0, 1), stations=3)]
    add("rear_derailleur", "rear_derailleur", fuse(rd), BLACK)
    Rt = tip_r(rings[0])
    fd_c = bb + sA * (Rt + 46)
    add("front_derailleur", "front_derailleur", fuse([rod(fd_c - sA * 16, fd_c + sA * 16, 20.5),
        tube([np.append((fd_c - sA * 12 + np.array([6, 0, 0]))[:2], 28), np.array([(Rt + 8) * math.cos(math.radians(95)), (Rt + 8) * math.sin(math.radians(95)), cl + 3.5])], lambda u: (12 - 4 * u, 9, 3), side=(0, 0, 1), stations=3)]), ALU)

    # ------------------------------------------------------------------ brakes (dual pivot, block approximation)
    def caliper(bolt, axis, axle):
        axis = axis / np.linalg.norm(axis)
        to = axle - bolt; Y = to - axis * to.dot(axis); Y /= np.linalg.norm(Y)
        X = np.cross(Y, axis)
        k = 21
        d = bolt + axis * k - axle
        bq, cq_ = d.dot(Y), d.dot(d) - (316.5 - 5.8) ** 2
        reach = -bq - math.sqrt(max(bq * bq - cq_, 0))
        P = lambda x, y, z=k: bolt + X * x + Y * y + axis * z
        xp = width / 2 + 7.5
        arms = [tube(catmull([P(s * xp, reach + 3), P(s * (xp + 9), reach - 25), P(s * 22, -5), P(0, -2)], 24), lambda u: (5.5, 3.0, 3.5), side=axis, stations=7) for s in (-1, 1)]
        arms.append(rod(bolt - axis * 4, bolt + axis * (k + 6), 4))
        arms.append(rod(P(0, -2, k - 6), P(0, -2, k + 6), 11))
        return fuse(arms)
    add("brake_front", "brakes", caliper(hb - up * 14 + fwd * 23, fwd.copy(), fa), BLACK)
    rb_axis = -perp if perp[0] > 0 else perp
    add("brake_rear", "brakes", caliper(bridge.copy(), rb_axis * -1 if rb_axis[0] > 0 else rb_axis, ra), BLACK)

    # ------------------------------------------------------------------ cockpit
    base, sd, C = ft["stem_base"], ft["stem_dir"], ft["bar"]
    cock = [rod(base - up * 20, base + up * 20, 19.8),
            tube([base + sd * 12, base + sd * p["stem_length_mm"] * 0.5, C - sd * 14], lambda u: (15.5 + u, 16 + 1.5 * u, 2.9), side=(0, 0, 1), stations=4),
            rod(np.append(C[:2], -20), np.append(C[:2], 20), 21.2)]
    if p["spacers_mm"] > 0:
        cock.append(rod(ht + up * 15, ht + up * (15 + p["spacers_mm"]), 17.6))
    add("stem", "stem", fuse(cock), BLACK)
    W, reach, drop = p["bar_width_mm"] / 2, p["bar_reach_mm"], p["bar_drop_mm"]
    bar_pts = lambda s: [C + np.array([x, y, s * z]) for x, y, z in [(0, 0, 0), (0, 0, W - 46), (3, 0, W - 22), (20, -1.5, W - 5), (46, -4.5, W), (reach - 4, -8, W), (reach + 11, -27, W),
                                                                    (reach + 9, -58, W), (reach - 9, -(drop - 33), W), (reach - 40, -(drop - 9), W), (reach - 76, -drop, W), (reach - 112, -drop - 1, W)]]
    bars, hoods = [], []
    for s in (-1, 1):
        bars.append(tube(catmull([C + np.array([0, 0, s * 10.0])] + bar_pts(s)[1:], 120), lambda u: (13.9, 13.9, 2.0), stations=34))
        o = lambda x, y: C + np.array([x, y, s * W])
        hoods.append(tube(catmull([o(reach - 28, -11), o(reach - 2, -5), o(reach + 24, 0), o(reach + 43, 9), o(reach + 52, 25)], 30),
                          lambda u: ((16 + 3.5 * smooth(u / 0.3)) * (1 - 0.64 * smooth((u - 0.45) / 0.55)), (15 + 1.5 * smooth(u / 0.3)) * (1 - 0.54 * smooth((u - 0.5) / 0.5)), 2.6), stations=9))
        hoods.append(tube(catmull([o(reach + 44, 6), o(reach + 55, -18), o(reach + 56, -50), o(reach + 49, -84), o(reach + 39, -112)], 30), lambda u: (5.5 - 2 * u, 10 - 2.5 * u, 2.8), stations=7))
    # straight centre section plus one sweep per side; they overlap by volume, never face to face
    centre = rod(np.append(C[:2], -(W - 40)), np.append(C[:2], W - 40), 13.9)
    add("handlebar", "handlebar", fuse([centre] + bars), BLACK, note="Bar with tape")
    add("levers", "shifters", fuse(hoods), BLACK)

    # ------------------------------------------------------------------ seat
    S = ft["saddle"]
    rail_y = S[1] - 50
    clamp = np.array([S[0] + 6, rail_y, 0])
    t_top = (rail_y - 14 - bb[1]) / sA[1]
    post_top = bb + sA * t_top
    add("seatpost", "seatpost", fuse([rod(st - sA * 70, post_top, 13.6),
                                      tube([post_top - sA * 6, (post_top + clamp) / 2 + np.array([0, 2, 0]), clamp - np.array([0, 3, 0])], lambda u: (13.6 - 4.6 * u, 13.6 + 1.4 * u, 2.6), stations=4),
                                      rod(clamp - np.array([0, 0, 21]), clamp + np.array([0, 0, 21]), 9.5)]), BLACK)
    sv = cfg["saddle"].get("visual", {})
    Wd, Lg = sv.get("width", 155) / 2, sv.get("length", 262)
    stn = [(-0.50, 0.55, 5), (-0.46, 0.78, 7), (-0.37, 1.0, 6), (-0.22, 0.94, 3), (-0.04, 0.64, 1), (0.12, 0.40, 0), (0.30, 0.27, 0), (0.44, 0.23, -1), (0.49, 0.17, -3)]
    wires = []
    for i, (x, wf, dz) in enumerate(stn):
        f = i / (len(stn) - 1)
        th = (15 + (9.5 - 15) * smooth(f)) * (0.55 + 0.45 * smooth(f / 0.12))
        c = np.array([S[0] + 12 + x * Lg, S[1] - th + dz * 0.9 - 2, 0])
        # elliptical sections: superelliptical spline sections on this loft import into SolidWorks ~7 % fuller
        wires.append(cq.Wire.makeEllipse(max(th, wf * Wd), min(th, wf * Wd), V(*c), V(1, 0, 0), V(0, 1, 0) if th >= wf * Wd else V(0, 0, 1)))
    saddle = cq.Solid.makeLoft(wires)
    # The centre channel is surface detail only: a boolean groove on this loft does not survive STEP
    # import into SolidWorks (it heals the cut away), and it has no aerodynamic or structural effect.
    add("saddle", "saddle", saddle, (0.1, 0.1, 0.1))
    # one bent rod: front of the left rail, back under the shell, forward along the right rail
    rp = lambda sgn, x, y, z: np.array([x, y, sgn * z])
    rail_path = [rp(-1, S[0] + 12 + Lg * 0.40, S[1] - 14, 9), rp(-1, clamp[0] + 46, rail_y, 22), rp(-1, clamp[0] - 46, rail_y, 22),
                 rp(-1, S[0] + 12 - Lg * 0.32, S[1] - 22, Wd * 0.45), np.array([S[0] + 12 - Lg * 0.40, S[1] - 18, 0]),
                 rp(1, S[0] + 12 - Lg * 0.32, S[1] - 22, Wd * 0.45), rp(1, clamp[0] - 46, rail_y, 22), rp(1, clamp[0] + 46, rail_y, 22), rp(1, S[0] + 12 + Lg * 0.40, S[1] - 14, 9)]
    # tight rear bend: straight segments with spherical joints (a loft's sections cross there)
    rp_ = catmull(rail_path, 36)
    rails = [fuse([rod(rp_[i], rp_[i + 1], 3.5) for i in range(len(rp_) - 1)] + [cq.Solid.makeSphere(3.5, V(*q)) for q in rp_[1:-1]])]
    add("saddle_rails", "saddle", rails[0], STEEL, aero=detail)

    # ------------------------------------------------------------------ bottles and light
    dt_dir = (dt_top - bb) / np.linalg.norm(dt_top - bb)
    dt_up = np.array([-dt_dir[1], dt_dir[0], 0])
    s_front = -np.array([-sA[1], sA[0], 0])
    if cfg.get("cages"):
        for name, base_, d_, out_, r_ in (("bottle_down", bb + dt_dir * 150, dt_dir, dt_up, 28), ("bottle_seat", bb + sA * 118, sA, s_front, 21)):
            prof = [(0.01, -24), (34, -24), (37.5, -19), (37.5, 96), (35, 104), (35, 112), (37.5, 118), (37.5, 132), (30, 150), (19, 156), (19, 175), (0.01, 175)]
            c = base_ + out_ * (r_ + 40)
            add(name, "cages", place(lathe(prof), d_, c), (0.92, 0.93, 0.95), note="Bottle and cage as one envelope")
    if cfg.get("light"):
        add("light", "light", fuse([extrude_xy([(-50, -15), (50, -15), (50, 15), (-50, 15)], 46, 0).translate(V(C[0] + 96, C[1] - 17, 0)), rod((C[0] + 84, C[1] - 2, 0), (C[0] + 84, C[1] + 8, 0), 12)]), ALU)

    track("bb_shell", "frame", [[0, 0, -w], [0, 0, w]], 3.0)
    track("seat_collar", "frame", [st - sA * 9, st + sA * 11], 2.5)
    track("brake_bridge", "frame", [np.append(bridge[:2], -31), np.append(bridge[:2], 31)], 2.0)
    track("steerer", "fork", [hb - up * 2, top], 2.5)
    track("fork_crown", "fork", [hb + up * 1, hb - up * 22], 3.0)
    return parts, {"centrelines": lines, "dropouts": {"rear": [ra.tolist()], "front": [fa.tolist()]}, "hp": {k: v.tolist() for k, v in hp.items()}, "R": R, "tire_w": tire_w, "fit": {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in ft.items()}}


def place(shape, z_axis, origin):
    """Move a shape built about the global Z axis so local Z lies along z_axis at origin."""
    z = np.asarray(z_axis, float); z /= np.linalg.norm(z)
    x = np.cross([0, 0, 1.0], z) if abs(z[2]) < 0.99 else np.array([1.0, 0, 0])
    x /= np.linalg.norm(x)
    return shape.moved(cq.Location(cq.Plane(origin=V(*map(float, origin)), xDir=V(*x), normal=V(*z))))


if __name__ == "__main__":
    import time
    t = time.time()
    parts, meta = build()
    for pt in parts:
        vol = pt.solid.Volume() if hasattr(pt.solid, "Volume") else 0
        print(f"{pt.name:18s} {pt.slot:16s} valid={pt.solid.isValid()} vol={vol/1000:10.1f} cm3 aero={pt.aero}")
    print(f"{len(parts)} parts in {time.time()-t:.1f}s")
