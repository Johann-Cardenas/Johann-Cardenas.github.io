"""Parametric B-rep model of the bicycle (CadQuery / OpenCascade).

One geometry source for SolidWorks, the wind tunnel and Abaqus. It reads the same
data/geometry.json and data/components.json as the web model and follows the same
construction (frame paths, fork bend, rim and tyre profiles, tooth forms), so the CAD
and the browser model agree. Millimetres; BB origin, +X forward, +Y up, +Z drive side.

The frame is one monocoque solid: the tubes are fused one at a time and every new
intersection edge chain is filleted (largest radius that OpenCascade accepts), so there
are no seams at the junctions. The fork is built the same way.

Every part carries: slot (catalog slot), colour, and `aero` (kept in the wind-tunnel
model) / `fe` (meshed by Abaqus) flags. Parts with aero=True must belong to a group in
cad/wind_tunnel.py GROUPS (name or name prefix).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import cadquery as cq
import numpy as np
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedMapOfShape, TopTools_ListOfShape

ROOT = Path(__file__).resolve().parents[1]
V = cq.Vector
LOG = []  # fillet report, filled by blend_fuse()


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


def bar(points, r, n=None):
    """Round wire through points: straight segments with spherical joints (robust where a loft would fold)."""
    P = catmull(points, n) if n else np.asarray(points, float)
    return fuse([rod(P[i], P[i + 1], r) for i in range(len(P) - 1)] + [cq.Solid.makeSphere(r, V(*q)) for q in P[1:-1]])


def _area(pts):
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))


def extrude_xy(points, depth, z=0.0, holes=()):
    """Extrude a closed XY outline (with optional hole outlines) along +Z, centred on z.
    The outline is made counter-clockwise and the holes clockwise, whatever order they came in."""
    points = list(points) if _area(list(points)) > 0 else list(points)[::-1]
    holes = [list(h) if _area(list(h)) < 0 else list(h)[::-1] for h in holes]
    outer = cq.Wire.makePolygon([V(x, y, 0) for x, y in points], close=True)
    inner = [cq.Wire.makePolygon([V(x, y, 0) for x, y in h], close=True) for h in holes]
    face = cq.Face.makeFromWires(outer, inner)
    return cq.Solid.extrudeLinear(face, V(0, 0, depth)).translate(V(0, 0, z - depth / 2))


def box(center, size, xdir=(1, 0, 0), zdir=(0, 0, 1)):
    """Box of size (lx, ly, lz) centred on `center`, local x along xdir and z along zdir."""
    lx, ly, lz = size
    b = cq.Solid.makeBox(lx, ly, lz, V(-lx / 2, -ly / 2, -lz / 2))
    return b.moved(cq.Location(cq.Plane(origin=V(*map(float, center)), xDir=V(*map(float, xdir)), normal=V(*map(float, zdir)))))


def in_frame(shape, origin, xdir, ydir):
    """Place a shape built in local coordinates: local x -> xdir, local y -> ydir, local z -> xdir x ydir."""
    x, y = np.asarray(xdir, float), np.asarray(ydir, float)
    x = x / np.linalg.norm(x); y = y - x * y.dot(x); y /= np.linalg.norm(y)
    return shape.moved(cq.Location(cq.Plane(origin=V(*map(float, origin)), xDir=V(*x), normal=V(*np.cross(x, y)))))


def circle_pts(r, n=40, cx=0, cy=0, reverse=False):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return pts[::-1] if reverse else pts


def hull(points):
    """Convex hull of 2D points (monotone chain), counter-clockwise."""
    P = sorted(set((round(x, 6), round(y, 6)) for x, y in points))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def disc_hull(discs, n=40):
    """Outline around several (cx, cy, r) discs: a cage plate, a hanger, a stadium."""
    return hull([p for cx, cy, r in discs for p in circle_pts(r, n, cx, cy)])


def repair(shape):
    """ShapeFix any shape that fails BRepCheck (boolean cuts on lofts can leave bad edges)."""
    if shape.isValid():
        return shape
    from OCP.ShapeFix import ShapeFix_Shape
    fixer = ShapeFix_Shape(shape.wrapped)
    fixer.Perform()
    fixed = cq.Shape.cast(fixer.Shape())
    if not fixed.isValid():
        raise RuntimeError("Shape is invalid and ShapeFix could not repair it")
    return fixed


def fuse(solids):
    """Union of many solids in one general-fuse pass."""
    if len(solids) == 1:
        return solids[0]
    return solids[0].fuse(*solids[1:]).clean()


def one_solid(shape):
    sols = shape.Solids() if hasattr(shape, "Solids") else [shape]
    return sols[0] if len(sols) == 1 else shape


# ---------------------------------------------------------------------------- seamless junctions
def _edge_map(shape):
    m = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape.wrapped, TopAbs_EDGE, m)
    return m


def _chains(edges, tol=1e-3):
    """Group intersection edges into connected chains (one chain per tube junction, usually)."""
    ends = []
    for e in edges:
        ce = cq.Edge(e)
        ends.append((np.array(ce.startPoint().toTuple()), np.array(ce.endPoint().toTuple())))
    parent = list(range(len(edges)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            if min(np.linalg.norm(a - b) for a in ends[i] for b in ends[j]) < tol:
                parent[find(i)] = find(j)
    groups = {}
    for i, e in enumerate(edges):
        groups.setdefault(find(i), []).append(e)
    return list(groups.values())


def _try_fillet(solid, edges, r):
    try:
        mk = BRepFilletAPI_MakeFillet(solid.wrapped)
        for e in edges:
            mk.Add(r, TopoDS.Edge_s(e))
        mk.Build()
        if not mk.IsDone():
            return None, None
        out = cq.Shape.cast(mk.Shape())
    except Exception:  # noqa: BLE001 -- OCC raises StdFail_NotDone and friends on a failed blend
        return None, None
    sols = out.Solids()
    if len(sols) != 1 or not sols[0].isValid():
        return None, None
    v0, v1 = solid.Volume(), sols[0].Volume()
    if abs(v1 - v0) > 0.03 * v0:
        return None, None
    return sols[0], mk


def blend_fuse(base, tool, radii=(6, 4, 2.5), label=""):
    """Fuse `tool` into `base` and fillet each new intersection chain with the largest radius that works."""
    vb, vt = base.Volume(), tool.Volume()
    for fuzzy in (0.0, 1e-3, 1e-2):
        op = BRepAlgoAPI_Fuse()
        a, b = TopTools_ListOfShape(), TopTools_ListOfShape()
        a.Append(base.wrapped); b.Append(tool.wrapped)
        op.SetArguments(a); op.SetTools(b)
        if fuzzy:
            op.SetFuzzyValue(fuzzy)
        op.Build()
        if not op.IsDone():
            continue
        res = cq.Shape.cast(op.Shape())
        sols = res.Solids()
        v = sum(s.Volume() for s in sols)
        # a sound union is one connected solid no smaller than either input and no larger than both
        if len(sols) == 1 and sols[0].isValid() and v > max(vb, vt) - 1.0 and v < vb + vt + 1.0:
            break
    else:
        raise RuntimeError(f"fuse failed: {label} (union is not one valid solid)")
    solid = sols[0]
    queue = _chains(list(op.SectionEdges()))
    done = []
    while queue:
        g = queue.pop(0)
        m = _edge_map(solid)
        g = [e for e in g if m.Contains(e)]
        if not g:
            continue
        for r in radii:
            out, mk = _try_fillet(solid, g, r)
            if out is not None:
                solid = out
                m = _edge_map(solid)
                remapped = []
                for q in queue:
                    nq = []
                    for e in q:
                        if m.Contains(e):
                            nq.append(e)
                        else:
                            nq += [x for x in mk.Modified(e) if m.Contains(x)]
                    remapped.append(nq)
                queue = remapped
                done.append(r)
                break
        else:
            done.append(0)
    LOG.append((label, done))
    return solid


def surface_along(solid, p, d, far=90.0):
    """Distance from p (inside the solid) along d to the solid's surface (bisection on point-in-solid)."""
    p, d = np.asarray(p, float), np.asarray(d, float) / np.linalg.norm(d)
    lo, hi = 0.0, far
    for _ in range(30):
        mid = (lo + hi) / 2
        if solid.isInside(V(*(p + d * mid)), 1e-4):
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------------------------------------------------------------------- sprockets and chain
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


def chain_loop(circles):
    """Pitch line of a chain wrapped on circles [(centre_xy, r, sense, z)], sense +1 ccw / -1 cw, in loop order.

    For a run leaving circle A and arriving on circle B in the direction d, both contact normals are
    n = -s * perp(d); the run is a common tangent when (cB - cA) . perp(d) = rB sB - rA sA.
    Returns a dense closed polyline (x, y, z)."""
    perp = lambda v: np.array([-v[1], v[0]])
    runs = []
    for i, (cA, rA, sA_, zA) in enumerate(circles):
        cB, rB, sB_, zB = circles[(i + 1) % len(circles)]
        D = np.asarray(cB, float) - np.asarray(cA, float)
        k = rB * sB_ - rA * sA_
        th = math.atan2(D[1], D[0]) - math.asin(k / np.linalg.norm(D))
        d = np.array([math.cos(th), math.sin(th)])
        pA, pB = np.asarray(cA) - rA * sA_ * perp(d), np.asarray(cB) - rB * sB_ * perp(d)
        assert (pB - pA).dot(d) > 0, "chain run reversed"
        runs.append((pA, pB, zA, zB))
    pts = []
    for i, (c, r, s, z) in enumerate(circles):
        arrive, leave = runs[i - 1][1], runs[i][0]
        a0 = math.atan2(*(arrive - c)[::-1]); a1 = math.atan2(*(leave - c)[::-1])
        sweep = (a1 - a0) % (2 * math.pi) if s > 0 else -((a0 - a1) % (2 * math.pi))
        for t in np.linspace(0, 1, max(2, int(abs(sweep) / math.radians(2)))):
            a = a0 + sweep * t
            pts.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), z))
        pA, pB, zA, zB = runs[i]
        for t in np.linspace(0, 1, 30)[1:-1]:
            q = pA + (pB - pA) * t
            pts.append((q[0], q[1], zA + (zB - zA) * t))
    return np.array(pts)


def chain_solid(loop):
    """Roller chain on a closed pitch line: alternating inner and outer link plate pairs, rollers on pins."""
    P = np.vstack([loop, loop[:1]])
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1))])
    N = int(round(s[-1] / PITCH / 2)) * 2
    us = np.arange(N) * s[-1] / N
    pins = np.array([[np.interp(u, s, P[:, k]) for k in range(3)] for u in us])
    pin = [(0.01, -3.0), (1.75, -3.0), (1.75, -1.25), (3.875, -1.25), (3.875, 1.25), (1.75, 1.25), (1.75, 3.0), (0.01, 3.0)]
    bodies = [lathe(pin, q) for q in pins]
    for j in range(N):
        a, b = pins[j], pins[(j + 1) % N]
        e = (b - a)[:2]; L = np.linalg.norm(e); e /= L
        nrm = np.array([-e[1], e[0]])
        outer = j % 2 == 1
        re, waist = (4.1, 3.05) if outer else (4.35, 3.35)
        outline = []
        for k in range(10):  # left end arc
            ang = math.pi / 2 + math.pi * k / 9
            outline.append((re * math.cos(ang), re * math.sin(ang)))
        for x in np.linspace(0, L, 9)[1:-1]:
            outline.append((x, -(waist + (re - waist) * (math.cos(2 * math.pi * x / L) + 1) / 2)))
        for k in range(10):  # right end arc
            ang = -math.pi / 2 + math.pi * k / 9
            outline.append((L + re * math.cos(ang), re * math.sin(ang)))
        for x in np.linspace(L, 0, 9)[1:-1]:
            outline.append((x, waist + (re - waist) * (math.cos(2 * math.pi * x / L) + 1) / 2))
        world = [tuple(a[:2] + e * x + nrm * y) for x, y in outline]
        zc = (a[2] + b[2]) / 2
        z0, z1 = (1.95, 2.85) if outer else (1.2, 2.0)
        for sgn in (-1, 1):
            bodies.append(extrude_xy(world, z1 - z0, zc + sgn * (z0 + z1) / 2))
    return bodies[0].fuse(*bodies[1:]), N


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


hexc = lambda h: tuple(round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5))
# the web model's materials (js/geo/materials.js), so the CAD tab and the Build tab read the same
WHITE, RED, BLACK = hexc("#f3f3f0"), hexc("#c41230"), hexc("#111214")
ALU, ALU_DARK, SILVER, MACHINED = hexc("#1b1c1f"), hexc("#2a2c30"), hexc("#c9ccd0"), hexc("#9da2a8")
STEEL, BOLT, PLASTIC, RUBBER = hexc("#8f9399"), hexc("#8d9197"), hexc("#161719"), hexc("#141414")
SADDLE, CHAIN, BOTTLE, LENS = hexc("#131314"), hexc("#8f9398"), hexc("#f2f4f6"), hexc("#ece9df")


def build(geom=None, cfg=None, params=None, detail=True):
    if geom is None:
        geom, cfg = load_inputs()
    LOG.clear()
    p = dict(geom["fit_defaults"]); p.update(params or {})
    hp = hardpoints(geom)
    tb, itf = geom["tubes"], geom["interfaces"]
    bb, ra, fa, ht, hb, st, up, fwd, sA = (hp[k] for k in ("bb", "ra", "fa", "ht", "hb", "st", "up", "fwd", "s_axis"))
    tire_w = cfg["tires"]["provides"].get("tire_width_mm", 23)
    R = 311 + tire_w
    ft = fit(geom, hp, p)
    parts: list[Part] = []

    def add(name, slot, solid, *a, **k):
        solid = repair(one_solid(solid))
        pieces = solid.Solids() if hasattr(solid, "Solids") else [solid]
        if len(pieces) > 6:
            raise RuntimeError(f"{name}: {len(pieces)} disconnected bodies")
        if len(pieces) == 1:
            parts.append(Part(name, slot, pieces[0], *a, **k))
        else:  # disconnected bodies become separate parts in the same slot (one body per SolidWorks part)
            for i, piece in enumerate(sorted(pieces, key=lambda q: q.Center().z), 1):
                parts.append(Part(f"{name}_{i}", slot, piece, *a, **k))

    # ------------------------------------------------------------------ frame (one monocoque solid)
    z0 = np.array([0, 0, 1.0])
    lines = []  # (name, part, centreline points, wall mm) for the Abaqus shell model

    def track(name, part_name, pts, wall):
        lines.append({"name": name, "part": part_name, "path": np.asarray(pts, float).tolist(), "wall": wall})
        return pts
    dt_top = hb + up * 34
    tt_front, tt_rear = ht - up * 26, bb + sA * (geom["seat_tube_mm"] - 30)
    tt_mid = (tt_rear + tt_front) / 2 + np.array([1.5, 8, 0])
    sec = lambda spec, **k: (lambda u: (*section_of(spec, **k)(u), pick(spec, u, "n")))
    head = tube(track("head_tube", "frame", catmull([hb - up * 3, (hb + ht) / 2, ht + up * 3], 12), tb["head_tube"]["wall_mm"]), lambda u: (pick(tb["head_tube"], u, "a"), pick(tb["head_tube"], u, "b"), 2.0), stations=7)
    down = tube(track("down_tube", "frame", catmull([bb, (bb + dt_top) / 2 + np.array([3, -3, 0]), dt_top], 40), tb["down_tube"]["wall_mm"]), sec(tb["down_tube"], flare0=0.10, flare1=0.16, len0=0.08, len1=0.10))
    top_t = tube(track("top_tube", "frame", catmull([tt_rear, tt_mid, tt_front], 40), tb["top_tube"]["wall_mm"]), sec({"start": tb["top_tube"]["end"], "mid": tb["top_tube"]["mid"], "end": tb["top_tube"]["start"]}, flare0=0.22, flare1=0.20, len0=0.09, len1=0.10))
    # the seat tube runs to the top of the frame; the clamp is its own part
    seat = tube(track("seat_tube", "frame", catmull([bb, (bb + st) / 2, st + sA * 2], 36), tb["seat_tube"]["wall_mm"]), lambda u: (*section_of(tb["seat_tube"], flare0=0.12, len0=0.1)(u), max(pick(tb["seat_tube"], u, "n"), 2.1)))  # n > 2 keeps every station a spline section: an ellipse end station starts at a different seam and the loft twists (a waist below the clamp)
    w, bore = itf["bb_shell_width_mm"] / 2, itf["bb_bore_mm"] / 2
    shell = lathe([(bore, -w), (bore + 5.5, -w), (bore + 8.5, -w + 4), (bore + 10, 0), (bore + 8.5, w - 4), (bore + 5.5, w), (bore, w)])
    frame_solid = blend_fuse(head, down, (10, 7, 5), "head|down")
    frame_solid = blend_fuse(frame_solid, top_t, (8, 6, 4, 3), "top")
    frame_solid = blend_fuse(frame_solid, seat, (9, 7, 5, 3.5), "seat")
    frame_solid = blend_fuse(frame_solid, shell, (5, 3.5, 2), "bb shell")

    slope = (ra[1] - bb[1]) / (ra[0] - bb[0])
    ss_top = bb + sA * (geom["seat_tube_mm"] - 40)
    drop_top, drop_front = np.array([ra[0] + 5, ra[1] + 17, 0]), np.array([ra[0] + 24, ra[1] - 2, 0])
    stay_dir = (ss_top - drop_top) / np.linalg.norm(ss_top - drop_top)
    perp = np.array([-stay_dir[1], stay_dir[0], 0])
    tB = next(i for i in range(400) if np.linalg.norm(drop_top + stay_dir * i - ra) >= 316.5 - 5.8 + itf["brake_reach_mm"])
    bridge = drop_top + stay_dir * tB
    drop_z = itf["rear_oln_mm"] / 2 + 3
    sides = {}
    for s in (-1, 1):
        cs = [np.array([x, y if y is not None else -slope * x, s * zz]) for x, y, zz in [(-6, 1, 21), (-42, 7, 28), (-88, 15, 33), (-210, 36, 47), (-320, 57, 59)]]
        cs.append(np.array([drop_front[0], drop_front[1], s * 63.5]))
        cstay = tube(track("chainstay", "frame", catmull(cs, 44), tb["chainstay"]["wall_mm"]), sec(tb["chainstay"], flare0=0.2, len0=0.07))
        sides[s] = [cstay]
    for s in (-1, 1):
        at = lambda f, z, off=0: np.append(((1 - f) * ss_top + f * drop_top + perp * off)[:2], s * z)
        # the stays run into the seat tube just below the top tube, their ends buried inside it, and
        # flare broad and flat there so the fillet reads as one moulded transition
        ss = [at(-0.035, 3), at(0.0, 7), at(0.09, 18, 1), at(0.28, 29, 4), at(0.55, 43, 1), at(0.82, 56, -3), at(1, 62.5)]
        sspec = tb["seat_stay"]
        stay = tube(track("seat_stay", "frame", catmull(ss, 48), sspec["wall_mm"]),
                    lambda u, sspec=sspec: (pick(sspec, u, "a") * (1 + 0.55 * (1 - smooth(u / 0.16))), pick(sspec, u, "b") * (1 + 0.25 * (1 - smooth(u / 0.16))), pick(sspec, u, "n")))
        sides[s].append(stay)
    for s in (-1, 1):
        # dropout: a plate joining both stays around the axle slot
        outline = [(drop_front[0] + 6, drop_front[1] + 7), (drop_top[0] + 7, drop_top[1] + 6), (drop_top[0] - 6, drop_top[1] + 4),
                   (ra[0] - 15, ra[1] + 2), (ra[0] - 11, ra[1] - 10), (ra[0] + 4, ra[1] - 13), (drop_front[0] + 2, drop_front[1] - 8)]
        sides[s].append(extrude_xy(outline, 6, s * drop_z, holes=[circle_pts(5.2, 20, ra[0], ra[1], True)]))
    # the rear triangle (stays, dropouts, bridge) is united first, then blended into the front triangle:
    # fusing small plates into the already-filleted frame trips the boolean
    rear = _fuse_seq([_fuse_seq(sides[-1]), _fuse_seq(sides[1]), rod(np.append(bridge[:2], -31), np.append(bridge[:2], 31), 6.5)])
    frame_solid = blend_fuse(frame_solid, one_solid(rear), (6, 4.5, 3, 2), "rear triangle")
    # seatpost bore and BB bore
    frame_solid = frame_solid.cut(rod(st - sA * 120, st + sA * 20, 13.6)).cut(rod((0, 0, -w - 1), (0, 0, w + 1), bore))
    # the bore trims the buried tips of the seat stays loose inside the tube; they are not frame material
    frame_solid = max(frame_solid.Solids(), key=lambda q: q.Volume())
    add("frame", "frameset", frame_solid, WHITE, fe=True, note="Carbon monocoque: tubes fused and filleted into one solid")
    sF = np.array([sA[1], -sA[0], 0])  # forward normal of the seat tube in the frame plane
    # clamp collar over the top of the seat tube; built about local Z (= seat axis), local x forward, ear at the back
    clamp = [lathe([(17.4, -14), (20.4, -14), (21.2, -12.5), (21.2, 2.5), (20.4, 4), (17.4, 4)]),
             box((-24.5, 0, -5), (9, 17, 18)), rod((-24.5, -9.5, -5), (-24.5, 9.5, -5), 3.2)]
    add("seatpost_clamp", "frameset", place(fuse(clamp), sA, st, xdir=sF), ALU, note="Seat clamp collar")

    # ------------------------------------------------------------------ fork
    L_ac = (fa - hb).dot(np.array([math.cos(math.radians(geom["head_angle_deg"])), -math.sin(math.radians(geom["head_angle_deg"])), 0]))
    rake = geom["fork_rake_mm"]
    at = lambda d, f, z: np.append((hb - up * d + fwd * f)[:2], z)
    bend = lambda d: rake * max(0.0, (d - 90) / (L_ac - 90)) ** 2.1
    d_end = L_ac - 17
    top = ht + up * (15 + p["spacers_mm"] + 41)
    crown = tube(catmull([hb + up * 1, hb - up * 6, hb - up * 22], 8), lambda u: (26 - 6 * u, 26 - 2 * u, 2.3), side=fwd, stations=5)
    legs = []
    for s in (-1, 1):
        pts = [at(9, 0, 0), at(11, 0, s * 16), at(19, 0, s * 34), at(34, 0, s * 46), at(60, 0, s * 51)]
        pts += [at(d, bend(d), s * 52.5) for d in (110, 170, 230, 280, 320)] + [at(d_end, bend(d_end), s * 53)]
        bspec = tb["fork_blade"]
        blade = tube(track("fork_blade", "fork", catmull(pts, 64), bspec["wall_mm"]), lambda u, bspec=bspec: (
            15 + (pick(bspec, u, "a") - 15) * smooth(u / 0.16), 23 + (pick(bspec, u, "b") - 23) * smooth(u / 0.16), 2.3 + (pick(bspec, u, "n") - 2.3) * smooth(u / 0.16)),
            side=fwd, transport=True, stations=13)
        legs.append(blade)
        tip = at(d_end, bend(d_end), 0)
        fz = s * (itf["front_oln_mm"] / 2 + 2.75)
        tipb = fuse([rod(np.append(tip[:2], fz - 2.75), np.append(tip[:2], fz + 2.75), 7.5),
                     tube([np.append(tip[:2], fz), np.append(fa[:2], fz)], lambda u: (2.75, 9.5 - 1.5 * u, 2.0), side=z0, stations=3)])
        legs.append(tipb)
    fork_solid = blend_fuse(crown, one_solid(_fuse_seq(legs)), (6, 4, 2.5), "fork blades")
    fork_solid = blend_fuse(fork_solid, rod(hb - up * 2, top, itf["steerer_mm"] / 2), (3, 2), "steerer")
    add("fork", "frameset", fork_solid, WHITE, fe=True, note="Carbon fork with steerer, one filleted solid")
    add("headset_cover", "frameset", place(lathe([(14.4, 0), (26, 0), (25.5, 2), (20, 11), (17.6, 15), (14.4, 15)]), up, ht), ALU)

    # ------------------------------------------------------------------ wheels: rims, tyres, hubs, spokes, quick releases
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
        # hollow axle (the skewer runs through it), locknuts on the dropout faces, two spoke flanges;
        # the rear body carries the freehub the cassette slides on
        body = ([(3, -half), (8.5, -half), (8.5, -half + 3), (7, -half + 4), (7, -half + 6), (11, -half + 9), (11, zL - 3.5), (fr + 3, zL - 2.2), (fr + 3, zL + 2.2), (13, zL + 6), (12, 0),
                 (13, zR - 6), (fr + 3, zR - 2.2), (fr + 3, zR + 2.2), (11, zR + 3.5), (11, half - 9), (7, half - 6), (7, half - 4), (8.5, half - 3), (8.5, half), (3, half)]
                if front else
                [(3, -half), (9.5, -half), (9.5, -half + 3), (8, -half + 4), (8, -half + 7), (12, -half + 10), (12, zL - 3.5), (fr + 3, zL - 2.2), (fr + 3, zL + 2.2), (15, zL + 7), (14, -6),
                 (16, zR - 7), (fr + 3, zR - 2.2), (fr + 3, zR + 2.2), (17.4, zR + 3.5), (17.4, half - 5.5), (9.5, half - 5.5), (9.5, half), (3, half)])
        hub = lathe(body, axle)
        add(f"hub_{tag}", "wheels", hub, ALU, note="Hub shell, flanges and hollow axle")
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
                    hub_p = axle + np.array([fr * math.cos(a + k * 2 * math.pi / m), fr * math.sin(a + k * 2 * math.pi / m), z])
                    rim_p = axle + np.array([(rn + 1.5) * math.cos(a), (rn + 1.5) * math.sin(a), 0])
                    d = rim_p - hub_p; L = np.linalg.norm(d); d /= L
                    radial = np.array([math.cos(a), math.sin(a), 0])
                    tang = np.cross(z0, radial); tang -= d * tang.dot(d); tang /= np.linalg.norm(tang)
                    if wv.get("bladed"):  # bladed (aero) spoke, flat across the direction of travel
                        bn = np.cross(d, tang)
                        ell = [V(*(hub_p + tang * 1.55 * math.cos(2 * math.pi * j / 10) + bn * 0.75 * math.sin(2 * math.pi * j / 10))) for j in range(10)]
                        blade_ = cq.Solid.extrudeLinear(cq.Face.makeFromWires(cq.Wire.makePolygon(ell, close=True)), V(*(d * L)))  # faceted: a few triangles, not thousands
                        sp.append(blade_)
                    else:
                        sp.append(rod(hub_p, rim_p, 1.0))
                    sp.append(rod(rim_p - d * 12, rim_p + d * 1.5, 1.9))  # nipple
                add(f"spokes_{tag}_{'drive' if side else 'left'}", "wheels", fuse(sp), ALU, aero=False, note="Bladed spokes and nipples; left out of the wind-tunnel model", extra={"tess": (0.6, 0.9)})
        # quick-release skewer: rod through the axle, cam lever on the left, nut on the right
        zl = half + 5.5 if front else drop_z + 3         # outer face of the left dropout
        zr = zl if front else drop_z + 3 + 4            # drive side: the derailleur hanger sits under the nut
        if front:
            ldir = up.copy()
        else:
            ldir = (bb - ra) / np.linalg.norm(bb - ra) + (ss_top - ra) / np.linalg.norm(ss_top - ra); ldir /= np.linalg.norm(ldir)
        lv = [axle + ldir * t + z0 * zz for t, zz in ((0, -zl - 6.5), (22, -zl - 7.5), (44, -zl - 6), (58, -zl - 2.5))]
        qr = [rod(axle - z0 * (zl + 9), axle + z0 * (zr + 10.5), 2.5),
              lathe([(2.4, -zl - 11), (8.5, -zl - 11), (10, -zl - 9), (10, -zl - 2), (8, -zl), (2.4, -zl)], axle),
              tube(catmull(lv, 16), lambda u: (7.5 - 3 * u, 2.8 - 0.5 * u, 3.0), side=z0, stations=6),
              lathe([(2.4, zr), (8.0, zr), (9.5, zr + 1.5), (9.5, zr + 8.5), (8.0, zr + 10), (2.4, zr + 10)], axle)]
        add(f"qr_{tag}", "wheels", fuse(qr), SILVER, aero=False, note="Quick-release skewer: lever, cam, rod and nut")

    # ------------------------------------------------------------------ drivetrain
    rings = [cfg["crankset"]["provides"].get("ring_big", 50), cfg["crankset"]["provides"].get("ring_small", 34)]
    cogs = cfg["cassette"].get("visual", {}).get("cogs", [11, 12, 13, 14, 15, 17, 19, 21, 24, 28])
    cl = itf["chainline_mm"]
    zb, zs, tr = cl + 3.5, cl - 3.5, 2.3
    ang = math.radians(-20)
    bolt_a = [ang + k * 2 * math.pi / 5 for k in range(5)]
    BCD_R = 55.0
    bolt_holes = [circle_pts(5.2, 20, BCD_R * math.cos(a), BCD_R * math.sin(a), True) for a in bolt_a]

    def pocket(a_c, n=12):
        """Rounded trapezoidal pocket between two spider arms, laid out in (arc length, radius)."""
        r0, r1, rm, hw, cr = 61.0, 85.0, 73.0, 30.0, 8.0
        out = []
        for cx, cy, a0 in ((hw - cr, r1 - cr, 0), (-(hw - cr), r1 - cr, 90), (-(hw - cr), r0 + cr, 180), (hw - cr, r0 + cr, 270)):
            for k in range(n):
                t = math.radians(a0 + 90 * k / (n - 1))
                sx, rr = cx + cr * math.cos(t), cy + cr * math.sin(t)
                th = a_c + sx / rm * (rr / rm) ** 0.15
                out.append((rr * math.cos(th), rr * math.sin(th)))
        return out[::-1]
    big = extrude_xy(sprocket_pts(rings[0]), tr, zb, holes=[circle_pts(46, 64, reverse=True)] + bolt_holes + [pocket(a + math.pi / 5) for a in bolt_a])
    add(f"chainring_{rings[0]}", "crankset", big, ALU, note="110 BCD outer ring with five pockets")
    small = extrude_xy(sprocket_pts(rings[1]), tr, zs, holes=[circle_pts(47, 64, reverse=True)] + bolt_holes)
    add(f"chainring_{rings[1]}", "crankset", small, ALU)
    for i, a in enumerate(bolt_a, 1):
        c = np.array([BCD_R * math.cos(a), BCD_R * math.sin(a), 0])
        add(f"chainring_bolt_{i}", "crankset", lathe([(0.01, zs - tr / 2 - 2.6), (5.6, zs - tr / 2 - 2.6), (5.6, zs - tr / 2), (5.0, zs - tr / 2), (5.0, zb + tr / 2 + 5.4),
                                                     (6.0, zb + tr / 2 + 5.4), (6.0, zb + tr / 2 + 7.6), (0.01, zb + tr / 2 + 7.6)], c), MACHINED, aero=False)
    # crankset: spindle, five-arm spider integral with the drive arm, two arms
    zsp = zb + tr / 2
    crank = [rod((0, 0, -62), (0, 0, 66), 15), lathe([(14, zsp), (27, zsp), (27, zsp + 6), (23, zsp + 12), (14, zsp + 12)])]
    for a in bolt_a:
        u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
        arm = [tuple(u * r_ + v * w_) for r_, w_ in ((20, -10.5), (BCD_R, -7.2), (BCD_R, 7.2), (20, 10.5))]
        crank.append(extrude_xy(arm, 5.4, zsp + 2.7))
        crank.append(extrude_xy(circle_pts(7.6, 28, *(u * BCD_R)), 5.4, zsp + 2.7))
    Lc = p["crank_length_mm"]
    for sgn, za, zp in ((1, 58, 68), (-1, -52, -68)):
        a = ang if sgn > 0 else ang + math.pi
        u = np.array([math.cos(a), math.sin(a), 0])
        end = u * Lc + z0 * zp
        path = [z0 * za, u * Lc * 0.5 + z0 * (za + (zp - za) * 0.65), end]
        crank.append(tube(path, lambda q: (16.5 - 4.5 * q, 7.6 - 0.9 * q, 3.4), side=(0, 0, 1), stations=6))
        crank.append(rod(end - z0 * 7.5, end + z0 * 7.5, 12.5))
        crank.append(rod(z0 * (za - sgn * 9), z0 * (za + sgn * 9), 22))
    add("crankset", "crankset", fuse(crank), ALU, note="FSA Gossamer: arms, five-arm spider, BB30 spindle")
    add("bottom_bracket", "bottom_bracket", lathe([(15.2, -41), (23.5, -41), (23.5, -35), (21, -35), (21, -27), (16.2, -27), (16.2, 27), (21, 27), (21, 35), (23.5, 35), (23.5, 41), (15.2, 41)]),
        BLACK, aero=False, note="BB30 bearings and sleeve")
    for sgn in (1, -1):
        a = ang if sgn > 0 else ang + math.pi
        c = np.array([Lc * math.cos(a), Lc * math.sin(a), sgn * 74])
        body = extrude_xy([(34, 4), (34, 10), (22, 62), (-30, 66), (-50, 52), (-52, 14), (-38, 4)], 11, 0).rotate(V(0, 0, 0), V(1, 0, 0), -90 if sgn > 0 else 90)
        add(f"pedal_{'right' if sgn > 0 else 'left'}", "pedals", body.translate(V(*c)), PLASTIC)
    cz = [cl + ((len(cogs) - 1) / 2 - i) * 3.95 for i in range(len(cogs))]
    cas = [extrude_xy(sprocket_pts(N), 1.75, cz[i], holes=[circle_pts(17.6, 28, reverse=True)]) for i, N in enumerate(cogs)]
    cas.append(lathe([(17.5, cz[-1] - 1.5), (22, cz[-1] - 1.5), (22, cz[0] + 0.5), (17.5, cz[0] + 0.5)]))
    cas.append(lathe([(17.5, cz[0] + 0.3), (19.5, cz[0] + 0.3), (19.5, cz[0] + 3.6), (17.5, cz[0] + 3.6)]))  # lockring
    add("cassette", "cassette", fuse(cas).translate(V(*ra)), STEEL)

    # rear derailleur (105 RD-5700 SS): hanger, B-knuckle, parallelogram, P-knuckle, cage, two jockey wheels
    ci = 4
    zc = cz[ci]
    guide = ra + np.array([7, -(tip_r(cogs[ci]) + 9 + tip_r(11)), 0]); guide[2] = 0
    tension = guide + np.array([60 * math.cos(math.radians(-74)), 60 * math.sin(math.radians(-74)), 0])
    H = ra + np.array([-8, -28, 0]); H[2] = 0
    Pk = guide + np.array([-11, 13, 0])
    zh = drop_z + 3
    rd = [extrude_xy(disc_hull([(ra[0], ra[1], 10.5), (H[0], H[1], 9)]), 4, zh + 2, holes=[circle_pts(5.1, 20, ra[0], ra[1], True)]),
          rod(H + z0 * (zh + 3.5), H + z0 * (zh + 20), 10.5),
          tube([H + np.array([-1, -4, 0]) + z0 * (zh + 11), (H + Pk) / 2 + np.array([-4, 0, 0]) + z0 * (zc + 18), Pk + np.array([1, 3, 0]) + z0 * (zc + 11)],
               lambda u: (9.5 - 1.5 * u, 6.5, 3.0), side=(0, 0, 1), stations=5),
          rod(Pk + z0 * (zc + 5.4), Pk + z0 * (zc + 17), 9),
          rod(H + np.array([-1, 9, 0]) + z0 * (zh + 13), H + np.array([-15, 15, 0]) + z0 * (zh + 13), 3.4)]  # barrel adjuster
    rd.append(extrude_xy(disc_hull([(guide[0], guide[1], 12.5), (tension[0], tension[1], 14), (Pk[0], Pk[1], 9.5)]), 2.0, zc + 4.6))
    rd.append(extrude_xy(disc_hull([(guide[0], guide[1], 11.5), (tension[0], tension[1], 13)]), 2.0, zc - 4.6))
    for c in (guide, tension):
        rd.append(extrude_xy([(c[0] + x, c[1] + y) for x, y in sprocket_pts(11, relief=0.6)], 2.6, zc))
        rd.append(rod(c + z0 * (zc - 3.65), c + z0 * (zc + 3.65), 8.5))
        rd.append(rod(c + z0 * (zc - 6.6), c + z0 * (zc + 7.2), 2.6))
        rd.append(rod(c + z0 * (zc + 5.6), c + z0 * (zc + 7.2), 4.6))
    add("rear_derailleur", "rear_derailleur", fuse(rd), ALU, note="With the derailleur hanger")

    # chain on the 50 x 15: ring -> lower jockey -> upper jockey -> cog, S-wrapped through the cage
    loop = chain_loop([((0, 0), pitch_r(rings[0]), -1, zb), (tension[:2], pitch_r(11), -1, zc), (guide[:2], pitch_r(11), 1, zc), (ra[:2], pitch_r(cogs[ci]), -1, zc)])
    ch, n_links = chain_solid(loop)
    add("chain", "chain", ch, CHAIN, aero=False, note=f"{n_links} links on {rings[0]} x {cogs[ci]}", extra={"tess": (1.0, 1.0)})

    # front derailleur (105 FD-5700, braze-on): tab on the seat tube, linkage, cage over the big ring
    Rt = tip_r(rings[0])
    q = bb + sA * (Rt + 38)
    zt = surface_along(frame_solid, q, z0)
    tab = box(q + z0 * (zt + 1.5) - sF * 3, (34, 16, 5), xdir=sA)
    cage_a = [math.radians(a) for a in np.linspace(68, 118, 16)]
    arc = lambda r0, r1: [(r0 * math.cos(a), r0 * math.sin(a)) for a in cage_a] + [(r1 * math.cos(a), r1 * math.sin(a)) for a in cage_a[::-1]]
    co, cin = zb + 5.0, zb - 5.0
    top_pt = np.array([(Rt + 16) * math.cos(math.radians(100)), (Rt + 16) * math.sin(math.radians(100)), co])
    fd = [tab, extrude_xy(arc(Rt - 3, Rt + 23), 1.6, co), extrude_xy(arc(Rt - 1, Rt + 21), 1.6, cin),
          rod(np.array([(Rt + 18) * math.cos(cage_a[-1]), (Rt + 18) * math.sin(cage_a[-1]), cin - 0.8]), np.array([(Rt + 18) * math.cos(cage_a[-1]), (Rt + 18) * math.sin(cage_a[-1]), co + 0.8]), 2.6),
          rod(np.array([(Rt + 6) * math.cos(cage_a[0]), (Rt + 6) * math.sin(cage_a[0]), cin - 0.8]), np.array([(Rt + 6) * math.cos(cage_a[0]), (Rt + 6) * math.sin(cage_a[0]), co + 0.8]), 2.6),
          tube([q + z0 * (zt + 3) - sF * 3, (q + z0 * (zt + 3) + top_pt) / 2 + np.array([0, 8, 4]), top_pt], lambda u: (8 - 2 * u, 5.5, 3.0), side=(0, 0, 1), stations=5),
          rod(top_pt - z0 * 1, top_pt + z0 * 7, 7)]
    add("front_derailleur", "front_derailleur", fuse(fd), SILVER, note="Braze-on mount, linkage and cage")

    # ------------------------------------------------------------------ brakes (105 BR-5700 dual pivot)
    def caliper(bolt, axis, axle):
        axis = axis / np.linalg.norm(axis)
        to = axle - bolt; Y = to - axis * to.dot(axis); Y /= np.linalg.norm(Y)
        X = np.cross(Y, axis)
        k = 21
        d = bolt + axis * k - axle
        bq, cq_ = d.dot(Y), d.dot(d) - (316.5 - 5.8) ** 2
        reach = -bq - math.sqrt(max(bq * bq - cq_, 0))
        P = lambda x, y, z=k: bolt + X * x + Y * y + axis * z
        xs = width / 2 + 1.2          # pad face, just off the brake track
        xp = xs + 13                  # arm centre at the pad
        body = []
        for s in (-1, 1):
            # each arm leaves the pivot, shoulders out wide over the tyre and drops to its pad
            path = catmull([P(s * 3, -4), P(s * 20, -1), P(s * (xp + 8), 14), P(s * (xp + 3), reach * 0.62), P(s * xp, reach)], 30)
            body.append(tube(path, lambda u: (6.2 - 1.6 * u, 4.8 - 0.8 * u, 3.0), side=axis, stations=8))
            shoe = box(P(s * (xs + 6.5), reach), (3, 12, 46), xdir=X, zdir=axis)
            pad = box(P(s * (xs + 2.5), reach + 0.5), (5, 9, 40), xdir=X, zdir=axis)
            body += [shoe, pad, rod(P(s * (xs + 4), reach), P(s * (xp + 4), reach), 3.0), rod(P(s * (xp + 3), reach), P(s * (xp + 6), reach), 5.0)]
        body.append(rod(bolt - axis * 4, bolt + axis * (k + 6), 4))
        body.append(rod(P(0, -2, k - 6.5), P(0, -2, k + 6.5), 10.5))
        body.append(rod(P(0, -2, k + 6.5), P(0, -2, k + 9), 6))                       # centre nut
        body.append(rod(P(19, -3), P(19, -24), 3.6))                                   # barrel adjuster
        body.append(box(P(23, -10), (10, 8, 9), xdir=X, zdir=axis))                    # release lever
        body.append(rod(P(-20, 1, k - 6), P(-20, 1, k + 7), 4.2))                      # cable anchor bolt
        return fuse(body)
    add("brake_front", "brakes", caliper(hb - up * 14 + fwd * 23, fwd.copy(), fa), ALU, note="Dual-pivot caliper with pads")
    rb_axis = -perp if perp[0] > 0 else perp
    add("brake_rear", "brakes", caliper(bridge.copy(), rb_axis * -1 if rb_axis[0] > 0 else rb_axis, ra), ALU, note="Dual-pivot caliper with pads")

    # ------------------------------------------------------------------ cockpit
    base, sd, C = ft["stem_base"], ft["stem_dir"], ft["bar"]
    cock = [rod(base - up * 20, base + up * 20, 19.8),
            tube([base + sd * 12, base + sd * p["stem_length_mm"] * 0.5, C - sd * 14], lambda u: (15.5 + u, 16 + 1.5 * u, 2.9), side=(0, 0, 1), stations=4),
            rod(np.append(C[:2], -20), np.append(C[:2], 20), 21.2)]
    if p["spacers_mm"] > 0:
        cock.append(rod(ht + up * 15, ht + up * (15 + p["spacers_mm"]), 17.6))
    add("stem", "stem", _fuse_seq(cock), BLACK)
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
    BAR_R = 13.9
    centre = rod(np.append(C[:2], -(W - 40)), np.append(C[:2], W - 40), BAR_R)
    add("handlebar", "handlebar", _fuse_seq([centre] + bars), BLACK, note="Bar with tape")
    add("levers", "shifters", _fuse_seq(hoods), BLACK)

    # ------------------------------------------------------------------ seat
    S = ft["saddle"]
    rail_y = S[1] - 50
    clampS = np.array([S[0] + 6, rail_y, 0])
    t_top = (rail_y - 14 - bb[1]) / sA[1]
    post_top = bb + sA * t_top
    add("seatpost", "seatpost", _fuse_seq([rod(st - sA * 70, post_top, 13.6),
                                           tube([post_top - sA * 6, (post_top + clampS) / 2 + np.array([0, 2, 0]), clampS - np.array([0, 3, 0])], lambda u: (13.6 - 4.6 * u, 13.6 + 1.4 * u, 2.6), stations=4),
                                           rod(clampS - np.array([0, 0, 21]), clampS + np.array([0, 0, 21]), 9.5)]), BLACK)
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
    rail_path = [rp(-1, S[0] + 12 + Lg * 0.40, S[1] - 14, 9), rp(-1, clampS[0] + 46, rail_y, 22), rp(-1, clampS[0] - 46, rail_y, 22),
                 rp(-1, S[0] + 12 - Lg * 0.32, S[1] - 22, Wd * 0.45), np.array([S[0] + 12 - Lg * 0.40, S[1] - 18, 0]),
                 rp(1, S[0] + 12 - Lg * 0.32, S[1] - 22, Wd * 0.45), rp(1, clampS[0] - 46, rail_y, 22), rp(1, clampS[0] + 46, rail_y, 22), rp(1, S[0] + 12 + Lg * 0.40, S[1] - 14, 9)]
    # tight rear bend: straight segments with spherical joints (a loft's sections cross there)
    rp_ = catmull(rail_path, 36)
    add("saddle_rails", "saddle", _fuse_seq([rod(rp_[i], rp_[i + 1], 3.5) for i in range(len(rp_) - 1)] + [cq.Solid.makeSphere(3.5, V(*q)) for q in rp_[1:-1]]), STEEL, aero=detail)

    # ------------------------------------------------------------------ bottle cages and bottles (bolted to the frame bosses)
    dt_dir = (dt_top - bb) / np.linalg.norm(dt_top - bb)
    dt_up = np.array([-dt_dir[1], dt_dir[0], 0])
    if cfg.get("cages"):
        cage_col = hexc(cfg["cages"].get("visual", {}).get("color", "#17181a"))
        for name, axis_, out_, d0 in (("bottle_down", dt_dir, dt_up, 150), ("bottle_seat", sA, sF, 118)):
            # the cage's back strip lies on the tube surface at both bosses (64 mm apart)
            b1, b2 = bb + axis_ * d0, bb + axis_ * (d0 + 64)
            s1, s2 = b1 + out_ * surface_along(frame_solid, b1, out_), b2 + out_ * surface_along(frame_solid, b2, out_)
            dirc = (s2 - s1) / np.linalg.norm(s2 - s1)
            outc = out_ - dirc * out_.dot(dirc); outc /= np.linalg.norm(outc)
            L = lambda al, o, z=0.0: np.array([al, o, z])
            Rb, rw = 37.5, 2.6                     # bottle radius, cage wire radius
            oc = 4.4 + 2.6 + Rb                    # bottle axis: strip (4.4) + bolt-head clearance + radius
            ring = lambda al, phi, extra=0.0: L(al, oc - (Rb + rw + extra) * math.cos(math.radians(phi)), (Rb + rw + extra) * math.sin(math.radians(phi)))
            g = [box((46, 2.2, 0), (148, 4.4, 17))]
            for s in (-1, 1):
                g.append(bar([L(96, 3.5, s * 7)] + [ring(al, s * ph) for al, ph in ((94, 25), (88, 60), (68, 105), (42, 145), (30, 180))], rw, 18))
                g.append(bar([L(-20, 3.5, s * 7)] + [ring(al, s * ph) for al, ph in ((-18, 35), (-16, 80), (-14, 130), (-13, 180))], rw, 14))
            g.append(bar([L(-22, 2.5, 0), L(-26.7, 6, 0), L(-26.7, 26, 0)], rw))   # base tab the bottle stands on
            cage = in_frame(fuse(g), s1, dirc, outc)
            add(f"{name}_cage", "cages", cage, cage_col, note="Bottle cage, back strip on the frame", extra={"tess": (0.6, 0.8)})
            for i, al in enumerate((0.0, float(np.linalg.norm(s2 - s1))), 1):
                bolt_ = fuse([rod(L(al, -7, 0), L(al, 4.6, 0), 2.5), rod(L(al, 4.4, 0), L(al, 6.8, 0), 4.2)])
                add(f"{name}_bolt_{i}", "cages", in_frame(bolt_, s1, dirc, outc), BOLT, aero=False)
            c = s1 + dirc * 0 + outc * oc
            prof = [(0.01, -24), (34, -24), (Rb, -19), (Rb, 96), (Rb - 2.5, 104), (Rb - 2.5, 112), (Rb, 118), (Rb, 132), (30, 150), (19, 156), (19, 163), (0.01, 163)]
            add(name, "cages", place(lathe(prof), dirc, c), BOTTLE, note="Bottle")
            add(f"{name}_cap", "cages", place(lathe([(0.01, 163), (17, 163), (18, 166), (14, 178), (9, 186), (0.01, 186)]), dirc, c), PLASTIC)

    # ------------------------------------------------------------------ Magicshine light on an out-front mount
    if cfg.get("light"):
        zc_ = 30.0
        hx = C[0] + 84
        mount = [lathe([(BAR_R, zc_ - 7), (18, zc_ - 7), (18, zc_ + 7), (BAR_R, zc_ + 7)], (C[0], C[1], 0)),
                 box((C[0] + 9, C[1] + 20, zc_), (9, 8, 14)),                                         # clamp lug and bolt
                 rod((C[0] + 9, C[1] + 20, zc_ - 9), (C[0] + 9, C[1] + 20, zc_ + 9), 2.5),
                 tube(catmull([np.array([C[0] + 16, C[1] + 6, zc_]), np.array([C[0] + 50, C[1] + 7, zc_ * 0.55]), np.array([hx - 2, C[1] + 8, 0])], 16),
                      lambda u: (9, 4.5, 3.0), side=(0, 1, 0), stations=6),
                 rod((hx, C[1] + 2, 0), (hx, C[1] + 13, 0), 16)]
        for s in (-1, 1):  # two-prong clevis under the head
            mount.append(box((hx, C[1] - 2, s * 3.3), (14, 9, 3.4)))
        mount.append(rod((hx, C[1] - 3, -8.5), (hx, C[1] - 3, 9), 2.5))     # thumb bolt
        mount.append(rod((hx, C[1] - 3, 9), (hx, C[1] - 3, 13), 6))          # thumb knob
        add("light_mount", "light", fuse(mount), ALU, note="Out-front bar mount with clevis")
        top_y = C[1] - 8
        lc = np.array([C[0] + 96, top_y - 15, 0])
        body = box(lc, (100, 30, 46))
        body = body.fillet(8, [e for e in body.Edges() if abs((e.endPoint() - e.startPoint()).normalized().x) > 0.99])
        fins = [box((lc[0] - 44 + 9 * i, top_y - 1, 0), (4, 3, 47)) for i in range(5)]
        for f_ in fins:
            body = body.cut(f_)
        light = fuse([body, box((hx, top_y + 3.5, 0), (14, 9, 3.2)), rod((hx, top_y + 3, -1.6), (hx, top_y + 3, 1.6), 7)])
        add("light", "light", light, ALU_DARK, note="Magicshine head, hangs from the mount on its tongue")
        add("light_lens", "light", box((lc[0] + 51.5, lc[1], 0), (3, 24, 40)), LENS)

    track("bb_shell", "frame", [[0, 0, -w], [0, 0, w]], 3.0)
    track("seat_collar", "frame", [st - sA * 9, st + sA * 2], 2.5)
    track("brake_bridge", "frame", [np.append(bridge[:2], -31), np.append(bridge[:2], 31)], 2.0)
    track("steerer", "fork", [hb - up * 2, top], 2.5)
    track("fork_crown", "fork", [hb + up * 1, hb - up * 22], 3.0)
    return parts, {"centrelines": lines, "dropouts": {"rear": [ra.tolist()], "front": [fa.tolist()]}, "hp": {k: v.tolist() for k, v in hp.items()}, "R": R, "tire_w": tire_w,
                   "fit": {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in ft.items()}, "fillets": [{"join": j, "radii_mm": r} for j, r in LOG]}


def _fuse_seq(solids):
    """Sequential union, kept for the parts whose tessellation the published wind-tunnel surface maps onto."""
    out = solids[0]
    for s in solids[1:]:
        out = out.fuse(s)
    return out.clean()


def place(shape, z_axis, origin, xdir=None):
    """Move a shape built about the global Z axis so local Z lies along z_axis at origin."""
    z = np.asarray(z_axis, float); z /= np.linalg.norm(z)
    if xdir is None:
        x = np.cross([0, 0, 1.0], z) if abs(z[2]) < 0.99 else np.array([1.0, 0, 0])
    else:
        x = np.asarray(xdir, float) - z * np.dot(xdir, z)
    x /= np.linalg.norm(x)
    return shape.moved(cq.Location(cq.Plane(origin=V(*map(float, origin)), xDir=V(*x), normal=V(*z))))


if __name__ == "__main__":
    import time
    t = time.time()
    parts, meta = build()
    for pt in parts:
        vol = pt.solid.Volume() if hasattr(pt.solid, "Volume") else 0
        print(f"{pt.name:22s} {pt.slot:16s} valid={pt.solid.isValid()} vol={vol/1000:10.1f} cm3 aero={pt.aero}")
    for j, r in LOG:
        print(f"  fillet {j:18s} {r}")
    print(f"{len(parts)} parts in {time.time()-t:.1f}s")
