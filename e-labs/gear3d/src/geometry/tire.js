/* ============================================================
   Gear3D — procedural tire geometry
   ------------------------------------------------------------
   LOCAL FRAME (matches the asset-slot contract in ASSETS.md):
     origin        wheel center, on the rotation axis
     rotation axis local +X
     units         millimeters; the scene applies one 1/1000 scale

   WHY THIS IS NOT A LATHE
   A surface of revolution gives a perfectly circular outline, and
   a perfect circle is the single loudest "this is CG" tell in a
   tire render — real tread breaks the silhouette. So the tire is
   built as a custom revolve whose OUTER RADIUS IS MODULATED by
   the tread pattern: grooves and lug blocks are cut into the
   geometry, not painted on. They show in the outline, they catch
   the key light on their edges, and they self-shadow.

   Tread textures still exist, but their job is now the fine
   detail the geometry cannot afford — rubber grain, siping, mold
   flash — rather than the pattern itself.

   The meridian is a Catmull-Rom through hand-placed control
   points describing a real radial cross-section: bead seat, bead
   flange, sidewall bulging to maximum section width at roughly
   60 % of section height, shoulder radius, and a slightly crowned
   tread. The full profile is mirrored from a half, so the tire is
   symmetric by construction rather than by arithmetic luck.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { Rng } from '../core/prng.js';
import { wheelStations } from './rim.js';

/** Texture resolution for the fine-detail maps. */
export const TREAD_TEX = 1024;
export const SIDEWALL_TEX = 1024;

/**
 * Circumferential segment counts.
 *
 * The binding constraint is the LATERAL GROOVE, not the overall roundness.
 * A groove occupying a fraction f of a block pitch, with P pitches around
 * the tire, needs roughly `3 * P / f` segments to land three samples inside
 * it. Below that the groove collapses to a one-vertex notch and the tread
 * reads as spiky noise rather than blocks — worse than no relief at all.
 *
 * With P ~ 17 and f = 0.20 that is about 255 segments, hence `standard`.
 *
 * Geometry is instanced, so the cost is one upload per tire SIZE regardless
 * of how many wheels use it; what scales with wheel count is triangles
 * rasterized, which is why `pickQuality` steps down for large units.
 */
export const QUALITY = Object.freeze({
    draft: { radialSegments: 112, profileDetail: 0.7 },
    standard: { radialSegments: 240, profileDetail: 1 },
    high: { radialSegments: 352, profileDetail: 1.4 }
});

/** Quality levels, cheapest first — the order `minLevel` is compared against. */
export const QUALITY_ORDER = Object.freeze(['draft', 'standard', 'high']);

/**
 * Choose a quality level from how many tires have to be drawn.
 *
 * A nine-axle turnpike double carries 34 tires and the gear matrix renders
 * four assemblies at once; at `high` that is several million triangles per
 * frame with a shadow pass on top, which will not hold 60 fps on integrated
 * graphics. An isolated axle, by contrast, can afford everything.
 *
 * @param {number} tireCount
 * @param {string} [override] an explicit level always wins
 * @param {string} [minLevel] floor imposed by the render tier
 * @returns {keyof typeof QUALITY}
 */
export function pickQuality(tireCount, override, minLevel) {
    if (override && QUALITY[override]) return /** @type {any} */ (override);
    let level = tireCount > 20 ? 'draft' : tireCount > 8 ? 'standard' : 'high';
    // A render tier can raise the floor. Resolution and geometry have to move
    // together: a 4K drawing buffer does not hide a 112-segment silhouette,
    // it resolves the faceting more clearly than 1x ever did, so asking for
    // UHD and getting draft tires is worse than not asking.
    if (minLevel && QUALITY[minLevel]
        && QUALITY_ORDER.indexOf(minLevel) > QUALITY_ORDER.indexOf(level)) {
        level = minLevel;
    }
    return /** @type {any} */ (level);
}

/** Geometry group indices — group 0 is sidewall, group 1 is tread. */
export const GROUP_SIDEWALL = 0;
export const GROUP_TREAD = 1;

/**
 * @typedef {'rib'|'lug'|'aircraft'} TreadPattern
 */

/**
 * @typedef {Object} TireBuildOptions
 * @property {keyof typeof QUALITY} [quality='standard']
 * @property {number}  [radialSegments]        overrides the quality preset
 * @property {TreadPattern} [pattern='rib']
 * @property {string}  [seed='gear3d-01']
 * @property {string}  [designation='tire']
 * @property {boolean} [flatSpot=true]
 * @property {number}  [flatSpotSoftness=0.55]
 * @property {number}  [treadDepth]            mm; defaults from section height
 */

/* ============================================================
   1. Meridian profile
   ============================================================ */

/**
 * @typedef {Object} MeridianPoint
 * @property {number} a  axial position, mm (0 = tire centerline)
 * @property {number} r  base radius, mm
 * @property {number} v  across-tread parameter 0..1, or -1 outside the tread
 * @property {number} taper 0..1, how strongly tread relief applies here
 * @property {number} s  arc length along the meridian, normalized bead to bead
 */

/**
 * Build the full meridian, bead to bead.
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {TireBuildOptions} [opts]
 * @returns {MeridianPoint[]}
 */
export function tireMeridian(g, opts = {}) {
    const detail = opts.profileDetail ?? QUALITY[opts.quality ?? 'standard'].profileDetail;

    const rOuter = g.freeRadius;
    const rimR = g.rimRadius;
    const sectionH = g.sectionHeight;
    const halfSection = g.sectionWidth / 2;
    const halfTread = g.treadWidth / 2;
    // The bead seat comes from the RIM, because that is what defines it. Taken
    // as the barrel's half-width instead, the tire's bead landed wherever the
    // barrel's own profile happened to be and the two surfaces interpenetrated
    // into a ring of alternating rubber-and-rim teeth around every wheel.
    //
    // `beadClear` is the small radial gap that keeps the bead just proud of the
    // seat. Landing it exactly on the seat is the physically right answer and
    // the numerically wrong one: two coincident surfaces z-fight, and this pair
    // is drawn at different circumferential resolutions (352 against 112), so
    // the fight resolves differently every few degrees and reads as a saw.
    const rimSt = wheelStations(g);
    const halfRim = rimSt.beadSeatX;
    const beadClear = rimSt.flange * 0.35;
    const crownDrop = g.sectionWidth * 0.014;
    const shoulderR = g.sectionWidth * 0.17;

    // Half profile, from the crown centerline outward to the bead seat.
    // Axial rises to maximum section width then comes back in to the rim,
    // so this is a polyline, not a function of `a`.
    //
    // A radial truck tire is much SQUARER than intuition suggests: the
    // sidewall runs close to vertical from bead to shoulder and the shoulder
    // turns over in a short radius. Control points spaced too unevenly here
    // make Catmull-Rom overshoot at the shoulder, which rounds the whole
    // carcass into a balloon — the tire ends up looking like a cushion
    // instead of a class 8 fitment. They are therefore kept roughly evenly
    // spaced along the curve.
    /** @type {[number, number][]} */
    const control = [
        [0, rOuter],
        [halfTread * 0.60, rOuter - crownDrop * 0.36],
        [halfTread, rOuter - crownDrop],                        // tread edge
        // The two neighbors of the maximum-width point sit at the SAME axial
        // station, and that is what makes the section width exact.
        //
        // A Catmull-Rom tangent at a control point is proportional to the
        // chord between its neighbors, so while the polygon's widest point
        // was flanked by 0.930 and 0.988 of the half-width, the tangent there
        // still had a positive axial component: the curve was heading outboard
        // as it passed the widest control point and had to overshoot before
        // turning back. It did, by 0.6-1.1 mm, on every tire in the library,
        // and the true maximum landed 11 mm below where the profile says it is.
        // Equal axial stations make that tangent purely radial, so the widest
        // control point IS the widest point of the curve.
        //
        // The asymmetry a real radial carcass has near its maximum — the
        // shoulder turning in faster above than the sidewall falls away below
        // — is carried by the RADII (0.22 and 0.20 of the section height),
        // which is where it belongs; a maximum is locally symmetric in the
        // direction it is a maximum in.
        [halfSection * 0.958, rOuter - sectionH * 0.16],        // shoulder turn
        [halfSection, rOuter - sectionH * 0.38],                // maximum section width
        [halfSection * 0.958, rimR + sectionH * 0.42],          // sidewall, near vertical
        [halfSection * 0.920, rimR + sectionH * 0.22],
        // Both of these are placed relative to the RIM FLANGE, because that is
        // what they have to clear. Scaled off the section height instead, they
        // worked on a truck tire — whose section height is 20 times its
        // flange — and failed on a 120/70R17 motorcycle tire, where the flange
        // is an eighth of the section height and reached straight through the
        // bead: the carcass came out 0.46 mm inside the rim.
        [halfRim + rimSt.flange * 1.15, rimR + Math.max(sectionH * 0.075, rimSt.flange * 1.7)],
        [halfRim, rimR + beadClear]                             // bead seat
    ];

    // Both tolerances are scaled off the section height rather than fixed, so
    // a 27x7.75 nose tire and a 1400x530 main gear tire get the same SILHOUETTE
    // QUALITY rather than the same point count.
    const half = catmullRom(control, {
        tolerance: (sectionH * 0.0006) / detail,
        maxChord: (sectionH * 0.045) / detail,
        maxTurn: 7
    });

    /** @type {MeridianPoint[]} */
    const pts = [];
    const classify = (a, r) => {
        const abs = Math.abs(a);
        if (abs <= halfTread) {
            return { v: (a + halfTread) / (2 * halfTread), taper: 1 };
        }
        // Taper the tread relief out across the shoulder so grooves do not
        // cut into the sidewall and leave a ragged edge.
        const t = (abs - halfTread) / (shoulderR * 0.9);
        return { v: a < 0 ? 0 : 1, taper: Math.max(0, 1 - t) };
    };

    // Inner side: mirror of the half, walked from bead to centerline.
    for (let i = half.length - 1; i >= 0; i--) {
        const [a, r] = half[i];
        const c = classify(-a, r);
        pts.push({ a: -a, r, v: c.v, taper: c.taper, s: 0 });
    }
    // Outer side: the half itself, skipping the duplicated centerline point.
    for (let i = 1; i < half.length; i++) {
        const [a, r] = half[i];
        const c = classify(a, r);
        pts.push({ a, r, v: c.v, taper: c.taper, s: 0 });
    }

    // ARC LENGTH, NOT ROW INDEX, is the texture coordinate across the meridian.
    // It always was the right parameter — the maps are drawn in millimeters of
    // developed profile — but with an evenly-divided point budget the index was
    // a fair approximation of it. Adaptive sampling ends that: rows now bunch
    // where the curve bends, so an index-based v would compress a third of the
    // sidewall map into the shoulder radius and stretch the rest over the
    // sidewall. Measuring the profile makes the mapping exact instead.
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i].a - pts[i - 1].a, pts[i].r - pts[i - 1].r);
        pts[i].s = len;
    }
    if (len > 0) for (const p of pts) p.s /= len;

    return pts;
}

/**
 * Sample a CENTRIPETAL Catmull-Rom spline through control points, subdividing
 * each span until the polyline is within a tolerance of the true curve.
 *
 * TWO DEPARTURES FROM THE OBVIOUS IMPLEMENTATION, BOTH LOAD-BEARING.
 *
 * 1. CENTRIPETAL, NOT UNIFORM (alpha = 1/2). Uniform Catmull-Rom overshoots
 *    between control points that are unevenly spaced, and the meridian's are
 *    deliberately uneven: the step from maximum section width to the top of
 *    the sidewall is 1.2% of the section half-width while the one across the
 *    crown is 60% of it, a fifty-to-one ratio. That overshoot pushed the
 *    widest point of the carcass 0.6-1.1 mm OUTBOARD of the section width, on
 *    every tire in the library. Section width is a published dimension that
 *    the dimension engine draws and the footprint export writes out, so a
 *    tire quietly a millimeter too wide is not a cosmetic matter. Centripetal
 *    parameterization is the standard cure and removes the overshoot exactly.
 *
 * 2. SAMPLES FOLLOW CURVATURE, NOT SPAN COUNT. Dividing a fixed budget equally
 *    between spans gave the short, tightly curved shoulder the same four
 *    points as the long, nearly flat crown, and the polyline through them
 *    turned the shoulder into a few flat facets meeting at up to 30 degrees.
 *    Vertex normals are averaged from those facets, so the tire carried a
 *    terraced shading band around each sidewall — a stack of washers rather
 *    than one carcass, and the loudest artifact on a close render. Each span
 *    is instead bisected until the sagitta (the deviation of the curve from
 *    its chord) falls below `tolerance`, which puts points exactly where the
 *    curve bends and nowhere else. `maxChord` then holds a floor under the
 *    flat runs, because a sidewall three rows tall reflects the environment
 *    map in three steps.
 *
 * `maxTurn` is the third criterion and the one the shading actually cares
 * about: a sagitta tolerance in millimeters is a statement about SHAPE, and at
 * the draft profile detail — a fifth of the row budget, chosen because a
 * 34-tire unit has to stay interactive — a tolerance loose enough to be cheap
 * still left 13-degree creases on the smallest tires in the library. Bounding
 * the angle directly bounds the artifact.
 *
 * @param {[number, number][]} pts control points
 * @param {{tolerance?: number, maxChord?: number, maxTurn?: number, maxDepth?: number}} [opts]
 * @returns {[number, number][]}
 */
function catmullRom(pts, opts = {}) {
    const tol = Math.max(1e-4, opts.tolerance ?? 0.5);
    const maxChord = Math.max(tol * 4, opts.maxChord ?? Infinity);
    const maxTurn = Math.cos(((opts.maxTurn ?? 180) * Math.PI) / 180);
    const maxDepth = opts.maxDepth ?? 9;

    // Phantom end points by REFLECTION, not duplication. A duplicated endpoint
    // has a zero-length chord, and the centripetal knot interval is the square
    // root of that chord, so every Barry-Goldman weight below would divide by
    // zero. Reflecting keeps the interval finite and gives the natural end
    // tangent, which is what the duplicate was reaching for in the first place.
    const n = pts.length;
    const p = [
        [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
        ...pts,
        [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]
    ];

    /** @type {[number, number][]} */
    const out = [[pts[0][0], pts[0][1]]];
    for (let i = 0; i < n - 1; i++) {
        const q = /** @type {[number, number][]} */ ([p[i], p[i + 1], p[i + 2], p[i + 3]]);
        const t = centripetalKnots(q);
        flattenSpan(out, q, t, 0, 1, out[out.length - 1],
            /** @type {[number, number]} */([pts[i + 1][0], pts[i + 1][1]]),
            tol, maxChord, maxTurn, maxDepth);
    }
    return out;
}

/**
 * Centripetal knot vector: t[i+1] = t[i] + |P[i+1] - P[i]| ** 0.5.
 * @param {[number, number][]} q four control points
 * @returns {number[]}
 */
function centripetalKnots(q) {
    const t = [0, 0, 0, 0];
    for (let i = 1; i < 4; i++) {
        const d = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
        // A repeated control point still gives a zero interval; a floor keeps
        // the weights finite rather than producing NaN geometry.
        t[i] = t[i - 1] + Math.max(1e-6, Math.sqrt(d));
    }
    return t;
}

/**
 * Evaluate the span between q[1] and q[2] at u in [0, 1].
 *
 * The Barry-Goldman pyramid rather than the cubic basis, because it is the
 * formulation that accepts a NON-UNIFORM knot vector — which is the whole
 * point of going centripetal.
 *
 * @param {[number, number][]} q
 * @param {number[]} t
 * @param {number} u
 * @returns {[number, number]}
 */
function evalSpan(q, t, u) {
    const tt = t[1] + u * (t[2] - t[1]);
    /** @param {number[]} a @param {number[]} b @param {number} ta @param {number} tb */
    const lerp = (a, b, ta, tb) => {
        const w = (tb - tt) / (tb - ta);
        return [a[0] * w + b[0] * (1 - w), a[1] * w + b[1] * (1 - w)];
    };
    const a1 = lerp(q[0], q[1], t[0], t[1]);
    const a2 = lerp(q[1], q[2], t[1], t[2]);
    const a3 = lerp(q[2], q[3], t[2], t[3]);
    const b1 = lerp(a1, a2, t[0], t[2]);
    const b2 = lerp(a2, a3, t[1], t[3]);
    return /** @type {[number, number]} */ (lerp(b1, b2, t[1], t[2]));
}

/**
 * Bisect a span until its chord is within `tol` of the curve, appending each
 * accepted point. `p0` is already in `out`; `p1` is what this call emits.
 *
 * @param {[number, number][]} out
 * @param {[number, number][]} q
 * @param {number[]} t
 * @param {number} u0 @param {number} u1
 * @param {[number, number]} p0 @param {[number, number]} p1
 * @param {number} tol @param {number} maxChord
 * @param {number} maxTurn cosine of the largest crease allowed
 * @param {number} depth
 */
function flattenSpan(out, q, t, u0, u1, p0, p1, tol, maxChord, maxTurn, depth) {
    const um = 0.5 * (u0 + u1);
    const pm = evalSpan(q, t, um);
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    // The turn is checked at the far end of the chord being accepted AND at
    // the near end, against the chord already emitted. The near end is the one
    // that matters at a SPAN JOINT: the curve is tangent-continuous there, so
    // the two chords meeting at a knot are only as collinear as they are
    // short, and one long chord from a lightly-subdivided neighbor reopened
    // a 13-degree crease that every within-span test had already passed.
    const prev = out.length > 1 ? out[out.length - 2] : null;
    const smooth = turnCos(p0, pm, p1) >= maxTurn
        && (!prev || turnCos(prev, p0, p1) >= maxTurn);
    if (depth <= 0 || (chord <= maxChord && sagitta(pm, p0, p1) <= tol && smooth)) {
        out.push(p1);
        return;
    }
    flattenSpan(out, q, t, u0, um, p0, pm, tol, maxChord, maxTurn, depth - 1);
    flattenSpan(out, q, t, um, u1, pm, p1, tol, maxChord, maxTurn, depth - 1);
}

/**
 * Cosine of the angle the polyline would turn through at `b` — which is the
 * crease a smooth-shaded surface will show there.
 * @param {[number, number]} a @param {[number, number]} b @param {[number, number]} c
 * @returns {number} 1 for straight, falling as the turn opens
 */
function turnCos(a, b, c) {
    const ax = b[0] - a[0], ay = b[1] - a[1];
    const bx = c[0] - b[0], by = c[1] - b[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return 1;
    return Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
}

/**
 * Perpendicular distance from `p` to the line through a and b.
 * @param {[number, number]} p @param {[number, number]} a @param {[number, number]} b
 * @returns {number}
 */
function sagitta(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/**
 * Where the tread band sits in the meridian's texture coordinate.
 *
 * The detail maps below are drawn in ONE canvas spanning the whole developed
 * profile, bead to bead, and what belongs on the tread (siping, mold flash)
 * is not what belongs on the sidewall (ribbing, lettering). Both used to be
 * placed at hard-coded fractions — 0.30/0.70 for the ribbing, 0.16/0.84 for
 * the lettering ring — which were fair guesses while v was the row index and
 * the rows were evenly divided between spans. They are not fair guesses now
 * that v is measured arc length, and they were never right for a wide-base
 * tire, whose tread is a far larger share of its developed profile than a
 * standard one's. Measuring the band is both exact and size-independent.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {TireBuildOptions} [opts]
 * @returns {{treadStart: number, treadEnd: number}}
 */
export function meridianBands(g, opts = {}) {
    const m = tireMeridian(g, opts);
    let lo = 1, hi = 0;
    for (const p of m) {
        if (p.taper > 0.5) { lo = Math.min(lo, p.s); hi = Math.max(hi, p.s); }
    }
    return hi > lo ? { treadStart: lo, treadEnd: hi } : { treadStart: 0.35, treadEnd: 0.65 };
}

/* ============================================================
   2. Tread pattern — the depth field cut into the geometry
   ============================================================ */

/**
 * @typedef {Object} TreadSpec
 * @property {TreadPattern} pattern
 * @property {number} depth              mm
 * @property {{c:number, hw:number}[]} grooves  circumferential grooves in v
 * @property {number} blocks             lateral block count (lug only)
 * @property {number} blockGroove        fraction of the block pitch that is groove
 * @property {number} skew               lateral groove skew across the tread
 * @property {number} sipes              siping count around the circumference
 */

/**
 * Derive a deterministic tread specification.
 * @param {TreadPattern} pattern
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{seed?: string, designation?: string, depth?: number}} [opts]
 * @returns {TreadSpec}
 */
export function treadSpec(pattern, g, opts = {}) {
    const rng = new Rng(`${opts.seed ?? 'gear3d-01'}:treadspec:${pattern}:${opts.designation ?? ''}`);

    // New truck tread depth is roughly 15-20/32 in (12-16 mm). Scaled off
    // section height so a small tire does not get a canyon cut into it.
    const depth = opts.depth ?? Math.min(16, Math.max(4, g.sectionHeight * 0.055));

    /** @type {{c:number, hw:number}[]} */
    const grooves = [];
    if (pattern === 'aircraft') {
        // Aircraft tires are ribbed only — never lugged. Typically 3 to 5
        // circumferential grooves, evenly spaced.
        const n = rng.int(3, 5);
        for (let i = 1; i <= n; i++) grooves.push({ c: i / (n + 1), hw: 0.035 });
    } else if (pattern === 'rib') {
        const n = rng.int(4, 5);
        for (let i = 1; i <= n; i++) grooves.push({ c: i / (n + 1) + rng.range(-0.012, 0.012), hw: rng.range(0.040, 0.052) });
    } else {
        // Lug: one central circumferential groove plus the lateral blocks.
        grooves.push({ c: 0.5, hw: 0.045 });
    }

    return {
        pattern,
        depth,
        grooves,
        // BLOCK COUNT FROM THE CIRCUMFERENCE, NOT A BARE RANDOM INTEGER.
        // A fixed 16-19 gave a 700 mm tire and a 1400 mm tire the same number
        // of blocks, so the big one's were twice the size — a 200 mm lug,
        // which is a quarry tire, not a drive axle. The count now follows a
        // roughly constant physical pitch.
        //
        // The pitch is 170 mm rather than the 40-50 mm a real drive tire has,
        // and that is a RESOLUTION limit, not a modeling choice: a groove
        // taking a fifth of the pitch needs about three circumferential
        // samples inside it to survive, so a true pitch would want close to a
        // thousand segments. The true pitch is carried by the tread normal
        // map instead — which is exactly the division of labor this file's
        // header describes — and the geometry keeps the coarse relief that
        // has to break the silhouette.
        blocks: pattern === 'lug'
            ? Math.max(14, Math.min(22, Math.round((Math.PI * g.overallDiameter) / 170)))
            : 0,
        // A highway drive tire is not an off-road tire. Its lateral grooves
        // take roughly a sixth of the block pitch, not a quarter — at 0.26
        // the tread reads as an aggressive mud pattern and the whole
        // assembly looks like a toy rather than a class 8 fitment.
        blockGroove: 0.20,
        skew: pattern === 'lug' ? rng.range(0.08, 0.16) : 0,
        sipes: pattern === 'rib' ? rng.int(52, 68) : 0
    };
}

/**
 * Depth cut into the tread at a point, in millimeters.
 *
 * @param {TreadSpec} s
 * @param {number} theta01 position around the circumference, 0..1
 * @param {number} v across-tread position, 0..1
 * @returns {number} mm to subtract from the base radius
 */
export function treadDepthAt(s, theta01, v) {
    let d = 0;

    // Circumferential grooves. Flat-bottomed with sloped walls, which is
    // what a real groove looks like and what keeps the normals sane.
    for (const gr of s.grooves) {
        const x = Math.abs(v - gr.c) / gr.hw;
        if (x < 1) d = Math.max(d, s.depth * grooveProfile(x));
    }

    if (s.pattern === 'lug' && s.blocks > 0) {
        // Lateral grooves between tread blocks, skewed across the tread.
        //
        // SHALLOWER than the circumferential grooves, at 60%. On a real drive
        // tire the lateral slots do not go to the belt; cut to full depth here
        // they scalloped the silhouette so hard that the tire's outline read as
        // a gear rather than a circle, which is the opposite of what modeling
        // the tread into the geometry is for.
        const phase = frac(theta01 * s.blocks + (v - 0.5) * s.skew);
        const half = s.blockGroove / 2;
        const near = Math.min(phase, 1 - phase) / half;
        if (near < 1) d = Math.max(d, s.depth * 0.60 * grooveProfile(near));
    }

    if (s.sipes > 0) {
        // Sipes are shallow slits, about a fifth of the groove depth.
        const phase = frac(theta01 * s.sipes);
        if (phase < 0.10) d = Math.max(d, s.depth * 0.20 * grooveProfile(phase / 0.10));
    }

    return d;
}

/**
 * Groove cross-section: 1 at the center, easing to 0 at the wall.
 * @param {number} x 0 at center, 1 at the edge
 * @returns {number}
 */
function grooveProfile(x) {
    const t = Math.max(0, Math.min(1, 1 - x));
    return t < 0.35 ? (t / 0.35) * (t / 0.35) * (3 - 2 * (t / 0.35)) * 1 : 1;
}

/** @param {number} x @returns {number} */
function frac(x) { return x - Math.floor(x); }

/* ============================================================
   3. The revolve
   ============================================================ */

/**
 * Build a tire mesh with geometric tread relief.
 *
 * Emits two geometry groups so the sidewall and the tread can carry
 * different materials — they are genuinely different surfaces, and giving
 * the tread its own roughness is most of what makes it read as tread.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {TireBuildOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildTireGeometry(g, opts = {}) {
    const q = QUALITY[opts.quality ?? 'standard'] ?? QUALITY.standard;
    const segments = opts.radialSegments ?? q.radialSegments;
    const pattern = opts.pattern ?? 'rib';

    const meridian = tireMeridian(g, { ...opts, profileDetail: q.profileDetail });
    const spec = treadSpec(pattern, g, opts);

    const rows = meridian.length;
    const cols = segments + 1;                 // duplicated seam column for UVs
    const vertCount = rows * cols;

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);

    // Circumferential repeat for the fine-detail maps. Keeps the grain at a
    // roughly constant physical scale across tire sizes.
    const uRepeat = Math.max(4, Math.round((Math.PI * g.overallDiameter) / 300));

    for (let j = 0; j < cols; j++) {
        const theta01 = (j % segments) / segments;
        const theta = theta01 * Math.PI * 2;
        const cos = Math.cos(theta), sin = Math.sin(theta);

        for (let i = 0; i < rows; i++) {
            const m = meridian[i];
            let r = m.r;
            if (m.taper > 0) r -= treadDepthAt(spec, theta01, m.v) * m.taper;

            const k = (i * cols + j) * 3;
            positions[k] = m.a;            // local +X is the rotation axis
            positions[k + 1] = r * cos;
            positions[k + 2] = r * sin;

            const u = (j / segments) * uRepeat;
            uvs[(i * cols + j) * 2] = u;
            uvs[(i * cols + j) * 2 + 1] = m.s;
        }
    }

    // Indices, split into sidewall and tread groups.
    /** @type {number[]} */
    const sidewallIdx = [];
    /** @type {number[]} */
    const treadIdx = [];
    for (let i = 0; i < rows - 1; i++) {
        const onTread = meridian[i].taper > 0.5 && meridian[i + 1].taper > 0.5;
        const target = onTread ? treadIdx : sidewallIdx;
        for (let j = 0; j < segments; j++) {
            const a = i * cols + j;
            const b = a + cols;
            target.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex([...sidewallIdx, ...treadIdx]);
    geo.addGroup(0, sidewallIdx.length, GROUP_SIDEWALL);
    geo.addGroup(sidewallIdx.length, treadIdx.length, GROUP_TREAD);

    if (opts.flatSpot !== false) applyFlatSpot(geo, g, opts.flatSpotSoftness ?? 0.55);

    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
}

/**
 * Flatten the bottom of the tire onto the pavement plane.
 *
 * The tire is DRAWN at its free radius but STANDS on its static loaded
 * radius, so without this it either floats or sinks. Rather than scale the
 * whole tire — which would misreport its diameter — the vertices below the
 * loaded radius are pushed up onto the contact plane and the displacement is
 * blended out over the neighboring arc. Overall diameter therefore stays
 * exactly the published value everywhere except inside the contact patch,
 * which is the physically correct thing to show.
 *
 * @param {THREE.BufferGeometry} geo local frame, axis +X
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {number} softness 0 = hard crease, 1 = very gradual
 */
export function applyFlatSpot(geo, g, softness = 0.55) {
    const deflection = g.freeRadius - g.staticLoadedRadius;
    if (deflection <= 0) return;

    const pos = geo.attributes.position;
    const blend = Math.max(1e-6, deflection * (6 + 18 * softness));

    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const depthBelow = -y - g.staticLoadedRadius;
        if (depthBelow <= 0) continue;
        const t = Math.min(1, depthBelow / blend);
        pos.setY(i, y + depthBelow * (t * t * (3 - 2 * t)));
    }
    pos.needsUpdate = true;
}

/* ============================================================
   4. Fine-detail maps
   ============================================================ */

/**
 * Tread detail maps — grain and mold texture, NOT the pattern (which is
 * now geometry). Deliberately subtle: doubling up a painted pattern on top
 * of a modeled one produces a moiré that looks like a rendering error.
 *
 * @param {TreadPattern} pattern
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{seed?: string, designation?: string}} [opts]
 * @returns {{normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture}}
 */
export function buildTreadMaps(pattern, g, opts = {}) {
    const rng = new Rng(`${opts.seed ?? 'gear3d-01'}:treadmap:${pattern}:${opts.designation ?? ''}`);
    const size = TREAD_TEX;
    const band = meridianBands(g, opts);

    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    // Fine circumferential mold lines left by the tread mold. u is around the
    // tire, so these run horizontally.
    ctx.strokeStyle = 'rgba(140,140,140,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
        const y = rng.range(0, size);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + rng.range(-2, 2));
        ctx.stroke();
    }

    // SIPING, which is the detail the geometry provably cannot carry.
    //
    // A sipe is a 0.5 mm slit at roughly a 10 mm pitch. Resolving that as
    // geometry would want tens of thousands of circumferential segments, so it
    // belongs here — and it is the ONE fine feature that can be painted on
    // without moire, because it is more than an order of magnitude finer than
    // the block pitch the geometry cuts. Repainting the block pattern itself
    // would beat against the modeled one, which is the trap this file's
    // header warns about; nothing below draws a block edge.
    //
    // One texture tile spans `tileMm` of circumference — the same figure the
    // geometry uses to pick its UV repeat — so the pitch below is a real
    // physical pitch on every tire size rather than a count that happens to
    // look right on one of them.
    const tileMm = (Math.PI * g.overallDiameter)
        / Math.max(4, Math.round((Math.PI * g.overallDiameter) / 300));
    const y0 = band.treadStart * size;
    const y1 = band.treadEnd * size;

    if (pattern !== 'aircraft') {
        const count = Math.max(8, Math.round(tileMm / 10.5));
        ctx.lineCap = 'round';
        for (let i = 0; i < count; i++) {
            // Real siping is a zigzag, not a straight cut — it is what keeps
            // the block edges from closing up under load — and the wave is
            // what makes it read as siping rather than as a scratch.
            const x = ((i + 0.5) / count) * size;
            const amp = size * 0.004;
            ctx.strokeStyle = `rgba(60,60,60,${rng.range(0.42, 0.60).toFixed(3)})`;
            ctx.lineWidth = Math.max(1.5, size * 0.0022);
            ctx.beginPath();
            const steps = 12;
            for (let k = 0; k <= steps; k++) {
                const t = k / steps;
                const y = y0 + (y1 - y0) * t;
                const wobble = Math.sin(t * Math.PI * 5 + i) * amp;
                if (k === 0) ctx.moveTo(x + wobble, y); else ctx.lineTo(x + wobble, y);
            }
            ctx.stroke();
        }
    }

    // Mold flash: the thin raised bead left along the mold's parting line,
    // one on each shoulder. Small, but it is the thing that stops the shoulder
    // edge reading as a machined chamfer.
    ctx.strokeStyle = 'rgba(178,178,178,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.0018);
    for (const y of [y0, y1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, size, size);
    addGrain(img, rng, 18);
    const normal = heightToNormal(img, size, 1.1);
    const rough = heightToRoughness(img, size, pattern === 'aircraft' ? 0.80 : 0.88, 0.10);

    return finishMaps(normal, rough);
}

/**
 * Sidewall maps: concentric ribbing, a molded lettering ring and rubber
 * grain. The lettering is deliberately abstract — legible as text at a
 * glance, never a specific manufacturer's mark, because this app renders
 * generic engineering configurations and should not appear to endorse or
 * reproduce a brand.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{seed?: string, designation?: string}} [opts]
 * @returns {{normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture}}
 */
export function buildSidewallMaps(g, opts = {}) {
    const rng = new Rng(`${opts.seed ?? 'gear3d-01'}:sidewall:${opts.designation ?? ''}`);
    const size = SIDEWALL_TEX;

    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    // v runs bead-to-bead across the whole meridian; the sidewalls are whatever
    // is OUTSIDE the measured tread band, which is what `meridianBands` returns
    // and what the hard-coded 0.30/0.70 below used to approximate. Ribbing runs
    // circumferentially, which is the u direction, so it appears here as
    // horizontal bands.
    const band = meridianBands(g, opts);
    ctx.strokeStyle = 'rgba(168,168,168,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.0022);
    for (let i = 0; i < 130; i++) {
        const v = rng.unit();
        // concentrate the ribbing away from the tread band
        if (v > band.treadStart && v < band.treadEnd) continue;
        const y = v * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }

    // Molded lettering ring: raised glyph-like marks on a smooth band, placed
    // a third of the way down each sidewall from the shoulder — where a tire's
    // size marking actually is, and, unlike a fixed 0.16/0.84, where it stays
    // when the tread is 70% of the developed profile instead of 40%.
    const lettering = [
        band.treadStart * 0.62,
        band.treadEnd + (1 - band.treadEnd) * 0.38
    ];
    for (const b of lettering) {
        const y = b * size;
        ctx.save();
        ctx.fillStyle = 'rgba(198,198,198,0.85)';
        const marks = 40;
        for (let i = 0; i < marks; i++) {
            const x = (i / marks) * size + rng.range(-3, 3);
            const w = rng.range(size * 0.008, size * 0.020);
            const h = size * 0.026;
            roundRect(ctx, x, y - h / 2, w, h, h * 0.22);
            ctx.fill();
        }
        ctx.restore();
    }

    const img = ctx.getImageData(0, 0, size, size);
    addGrain(img, rng, 14);
    const normal = heightToNormal(img, size, 0.85);
    const rough = heightToRoughness(img, size, 0.92, 0.06);
    return finishMaps(normal, rough);
}

/* ---------- shared texture helpers ---------- */

/**
 * @param {HTMLCanvasElement|OffscreenCanvas} normal
 * @param {HTMLCanvasElement|OffscreenCanvas} rough
 */
function finishMaps(normal, rough) {
    const normalMap = new THREE.CanvasTexture(normal);
    const roughnessMap = new THREE.CanvasTexture(rough);
    for (const t of [normalMap, roughnessMap]) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 16;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
    }
    return { normalMap, roughnessMap };
}

/**
 * @param {ImageData} img @param {Rng} rng @param {number} amount
 */
function addGrain(img, rng, amount) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (rng.unit() - 0.5) * amount;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
    }
}

/**
 * @param {ImageData} height @param {number} size @param {number} strength
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
function heightToNormal(height, size, strength) {
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(size, size);
    const h = (x, y) => {
        const xi = ((x % size) + size) % size;
        const yi = Math.max(0, Math.min(size - 1, y));
        return height.data[(yi * size + xi) * 4] / 255;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
            const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
            let nx = -dx, ny = -dy, nz = 1;
            const m = Math.hypot(nx, ny, nz);
            const i = (y * size + x) * 4;
            out.data[i] = ((nx / m) * 0.5 + 0.5) * 255;
            out.data[i + 1] = ((ny / m) * 0.5 + 0.5) * 255;
            out.data[i + 2] = ((nz / m) * 0.5 + 0.5) * 255;
            out.data[i + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
    return cv;
}

/**
 * @param {ImageData} height @param {number} size @param {number} base @param {number} range
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
function heightToRoughness(height, size, base, range) {
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(size, size);
    for (let i = 0; i < out.data.length; i += 4) {
        const hv = height.data[i] / 255;
        const v = Math.round(Math.max(0, Math.min(1, base - range * (1 - hv))) * 255);
        out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return cv;
}

/** @param {number} w @param {number} h @returns {HTMLCanvasElement|OffscreenCanvas} */
function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

/** @param {number} v @returns {number} */
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/**
 * Choose a tread pattern from the axle role and domain.
 * @param {{role?: string, domain?: string}} ctx
 * @returns {TreadPattern}
 */
export function treadPatternFor(ctx) {
    if (ctx.domain === 'aircraft') return 'aircraft';
    return ctx.role === 'drive' ? 'lug' : 'rib';
}
