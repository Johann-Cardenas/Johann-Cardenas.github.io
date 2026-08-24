/* ============================================================
   Gear3D — procedural tire geometry
   ------------------------------------------------------------
   LOCAL FRAME (matches the asset-slot contract in ASSETS.md):
     origin        wheel centre, on the rotation axis
     rotation axis local +X
     units         millimetres; the scene applies one 1/1000 scale

   WHY THIS IS NOT A LATHE
   A surface of revolution gives a perfectly circular outline, and
   a perfect circle is the single loudest "this is CG" tell in a
   tire render — real tread breaks the silhouette. So the tire is
   built as a custom revolve whose OUTER RADIUS IS MODULATED by
   the tread pattern: grooves and lug blocks are cut into the
   geometry, not painted on. They show in the outline, they catch
   the key light on their edges, and they self-shadow.

   Tread textures still exist, but their job is now the fine
   detail the geometry cannot afford — rubber grain, siping, mould
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
 * rasterised, which is why `pickQuality` steps down for large units.
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
    // UHD and getting draft tyres is worse than not asking.
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
 * @property {number} a  axial position, mm (0 = tire centreline)
 * @property {number} r  base radius, mm
 * @property {number} v  across-tread parameter 0..1, or -1 outside the tread
 * @property {number} taper 0..1, how strongly tread relief applies here
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
    const halfRim = (g.sectionWidth * 0.72) / 2;
    const crownDrop = g.sectionWidth * 0.014;
    const shoulderR = g.sectionWidth * 0.17;

    // Half profile, from the crown centreline outward to the bead seat.
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
        [halfSection * 0.930, rOuter - sectionH * 0.16],        // shoulder turn
        [halfSection, rOuter - sectionH * 0.38],                // maximum section width
        [halfSection * 0.988, rimR + sectionH * 0.42],          // sidewall, near vertical
        [halfSection * 0.920, rimR + sectionH * 0.22],
        [halfRim * 1.15, rimR + sectionH * 0.070],              // bead flange
        [halfRim, rimR]                                         // bead seat
    ];

    const samples = Math.max(20, Math.round(30 * detail));
    const half = catmullRom(control, samples);

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

    // Inner side: mirror of the half, walked from bead to centreline.
    for (let i = half.length - 1; i >= 0; i--) {
        const [a, r] = half[i];
        const c = classify(-a, r);
        pts.push({ a: -a, r, v: c.v, taper: c.taper });
    }
    // Outer side: the half itself, skipping the duplicated centreline point.
    for (let i = 1; i < half.length; i++) {
        const [a, r] = half[i];
        const c = classify(a, r);
        pts.push({ a, r, v: c.v, taper: c.taper });
    }
    return pts;
}

/**
 * Uniform Catmull-Rom through control points, with duplicated endpoints so
 * the curve starts and ends exactly on the first and last control point.
 * @param {[number, number][]} pts
 * @param {number} samples total output points
 * @returns {[number, number][]}
 */
function catmullRom(pts, samples) {
    const p = [pts[0], ...pts, pts[pts.length - 1]];
    /** @type {[number, number][]} */
    const out = [];
    const spans = pts.length - 1;
    for (let s = 0; s < spans; s++) {
        const p0 = p[s], p1 = p[s + 1], p2 = p[s + 2], p3 = p[s + 3];
        const n = Math.max(2, Math.round(samples / spans));
        for (let i = 0; i < n; i++) {
            const t = i / n;
            out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

/** @returns {number} */
function cr(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
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
        // A highway drive tire is not an off-road tire. Its lateral grooves
        // take roughly a sixth of the block pitch, not a quarter — at 0.26
        // the tread reads as an aggressive mud pattern and the whole
        // assembly looks like a toy rather than a class 8 fitment.
        blocks: pattern === 'lug' ? rng.int(16, 19) : 0,
        blockGroove: 0.20,
        skew: pattern === 'lug' ? rng.range(0.08, 0.16) : 0,
        sipes: pattern === 'rib' ? rng.int(52, 68) : 0
    };
}

/**
 * Depth cut into the tread at a point, in millimetres.
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
        const phase = frac(theta01 * s.blocks + (v - 0.5) * s.skew);
        const half = s.blockGroove / 2;
        const x = Math.abs(phase - 0.5 < 0 ? phase : phase - 1) / half;
        const near = Math.min(phase, 1 - phase) / half;
        if (near < 1) d = Math.max(d, s.depth * grooveProfile(near));
    }

    if (s.sipes > 0) {
        // Sipes are shallow slits, about a fifth of the groove depth.
        const phase = frac(theta01 * s.sipes);
        if (phase < 0.10) d = Math.max(d, s.depth * 0.20 * grooveProfile(phase / 0.10));
    }

    return d;
}

/**
 * Groove cross-section: 1 at the centre, easing to 0 at the wall.
 * @param {number} x 0 at centre, 1 at the edge
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
            uvs[(i * cols + j) * 2 + 1] = i / (rows - 1);
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
 * blended out over the neighbouring arc. Overall diameter therefore stays
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
 * Tread detail maps — grain and mould texture, NOT the pattern (which is
 * now geometry). Deliberately subtle: doubling up a painted pattern on top
 * of a modelled one produces a moiré that looks like a rendering error.
 *
 * @param {TreadPattern} pattern
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{seed?: string, designation?: string}} [opts]
 * @returns {{normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture}}
 */
export function buildTreadMaps(pattern, g, opts = {}) {
    const rng = new Rng(`${opts.seed ?? 'gear3d-01'}:treadmap:${pattern}:${opts.designation ?? ''}`);
    const size = TREAD_TEX;

    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    // Fine radial mould lines left by the tread mould.
    ctx.strokeStyle = 'rgba(140,140,140,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
        const y = rng.range(0, size);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + rng.range(-2, 2));
        ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, size, size);
    addGrain(img, rng, 18);
    const normal = heightToNormal(img, size, 1.1);
    const rough = heightToRoughness(img, size, pattern === 'aircraft' ? 0.80 : 0.88, 0.10);

    return finishMaps(normal, rough);
}

/**
 * Sidewall maps: concentric ribbing, a moulded lettering ring and rubber
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

    // v runs bead-to-bead across the whole meridian, so the sidewalls sit in
    // roughly the outer thirds. Ribbing runs circumferentially, which is the
    // u direction, so it appears here as horizontal bands.
    ctx.strokeStyle = 'rgba(168,168,168,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.0022);
    for (let i = 0; i < 130; i++) {
        const v = rng.unit();
        // concentrate the ribbing away from the tread band
        if (v > 0.30 && v < 0.70) continue;
        const y = v * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }

    // Moulded lettering ring: raised glyph-like marks on a smooth band.
    for (const band of [0.16, 0.84]) {
        const y = band * size;
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
