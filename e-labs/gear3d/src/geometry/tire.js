/* ============================================================
   Gear3D — procedural tire geometry and tread maps
   ------------------------------------------------------------
   A tire is a surface of revolution. We build its meridian profile
   in (radius, axial) millimetres from the real tire dimensions,
   then lathe it.

   LOCAL FRAME (matches the asset-slot contract in ASSETS.md):
     origin        wheel centre, on the rotation axis
     rotation axis local +X
     units         millimetres here; the scene scales to metres once

   The profile runs bead -> lower sidewall -> upper sidewall ->
   shoulder -> across the tread -> back down the far side, so the
   lathe closes on itself and needs no cap geometry.

   Tread is a TEXTURE, never geometry. At the sizes these figures
   are rendered, modelled tread blocks cost tens of thousands of
   triangles per tire and read no better than a good normal map —
   and a class 13 unit carries 34 tires.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { Rng } from '../core/prng.js';

/** Texture resolution for the seeded tread maps. */
export const TREAD_TEX = 1024;

/**
 * @typedef {Object} TireBuildOptions
 * @property {number}  [radialSegments=64]  segments around the circumference
 * @property {number}  [profileDetail=1]    multiplier on meridian point count
 * @property {number}  [shoulderRadius=0.18] shoulder rounding, fraction of section width
 * @property {number}  [sidewallBulge=0.055] sidewall bulge, fraction of section width
 * @property {boolean} [flatSpot=true]      flatten the contact patch onto z = 0
 * @property {number}  [flatSpotSoftness=0.55] how gradually the flat blends in
 */

/**
 * Meridian profile of a tire, in the local frame.
 * Returns points as THREE.Vector2(radius, axial) suitable for LatheGeometry.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {TireBuildOptions} [opts]
 * @returns {THREE.Vector2[]}
 */
export function tireProfile(g, opts = {}) {
    const detail = opts.profileDetail ?? 1;
    const shoulder = (opts.shoulderRadius ?? 0.18) * g.sectionWidth;
    const bulge = (opts.sidewallBulge ?? 0.055) * g.sectionWidth;

    const rBead = g.rimRadius;
    const rOuter = g.freeRadius;
    const halfW = g.sectionWidth / 2;
    const halfTread = g.treadWidth / 2;

    /** @type {THREE.Vector2[]} */
    const pts = [];
    const add = (r, a) => pts.push(new THREE.Vector2(r, a));

    // --- near bead, sitting on the rim flange ---
    add(rBead, -halfW * 0.62);
    add(rBead + g.sectionHeight * 0.06, -halfW * 0.74);

    // --- near sidewall: bulges outward, then curves in to the shoulder ---
    const swSteps = Math.max(6, Math.round(8 * detail));
    for (let i = 1; i <= swSteps; i++) {
        const t = i / swSteps;                       // 0 at bead, 1 at shoulder
        const r = rBead + (rOuter - shoulder - rBead) * easeSidewall(t);
        // bulge peaks near mid-sidewall
        const a = -halfW * (0.74 + (bulge / halfW) * Math.sin(Math.PI * t))
            + (halfW - halfTread) * smoothstep(0.55, 1, t);
        add(r, a);
    }

    // --- shoulder radius into the tread ---
    const shSteps = Math.max(4, Math.round(5 * detail));
    for (let i = 1; i <= shSteps; i++) {
        const t = i / shSteps;
        const ang = (t * Math.PI) / 2;
        add(rOuter - shoulder * (1 - Math.sin(ang)), -halfTread - shoulder * (1 - Math.sin(ang)) * 0.15 + shoulder * 0 * t);
    }

    // --- crown: a very slight crown radius across the tread ---
    const crSteps = Math.max(6, Math.round(10 * detail));
    const crown = g.sectionWidth * 0.012;
    for (let i = 0; i <= crSteps; i++) {
        const t = i / crSteps;
        const a = -halfTread + t * g.treadWidth;
        const r = rOuter - crown * Math.pow(2 * t - 1, 2);
        add(r, a);
    }

    // --- mirror the shoulder and sidewall on the far side ---
    for (let i = shSteps; i >= 1; i--) {
        const t = i / shSteps;
        const ang = (t * Math.PI) / 2;
        add(rOuter - shoulder * (1 - Math.sin(ang)), halfTread + shoulder * (1 - Math.sin(ang)) * 0.15);
    }
    for (let i = swSteps; i >= 1; i--) {
        const t = i / swSteps;
        const r = rBead + (rOuter - shoulder - rBead) * easeSidewall(t);
        const a = halfW * (0.74 + (bulge / halfW) * Math.sin(Math.PI * t))
            - (halfW - halfTread) * smoothstep(0.55, 1, t);
        add(r, a);
    }
    add(rBead + g.sectionHeight * 0.06, halfW * 0.74);
    add(rBead, halfW * 0.62);

    return pts;
}

/** @param {number} t @returns {number} */
function easeSidewall(t) {
    // Fast rise near the bead, flattening toward the shoulder — the shape a
    // radial carcass actually takes.
    return 1 - Math.pow(1 - t, 1.7);
}

/** @param {number} a @param {number} b @param {number} x @returns {number} */
function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/**
 * Build a tire mesh geometry in the local frame (rotation axis = +X).
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {TireBuildOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildTireGeometry(g, opts = {}) {
    const segments = opts.radialSegments ?? 64;
    const profile = tireProfile(g, opts);

    // LatheGeometry revolves about +Y. Rotate -90 deg about Z so the axis
    // becomes +X, matching the asset contract.
    const geo = new THREE.LatheGeometry(profile, segments);
    geo.rotateZ(-Math.PI / 2);

    if (opts.flatSpot !== false) applyFlatSpot(geo, g, opts.flatSpotSoftness ?? 0.55);

    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
}

/**
 * Flatten the bottom of the tire onto the pavement plane.
 *
 * The tire is drawn at its FREE radius but stands on its STATIC LOADED
 * radius, so without this the tire either floats or sinks. Rather than
 * scale the whole tire (which would misreport its diameter), we push the
 * vertices below the loaded radius up onto the contact plane and blend the
 * displacement out over the neighbouring arc. Overall diameter therefore
 * remains exactly the published value everywhere except in the contact
 * patch, which is the physically correct thing to show.
 *
 * @param {THREE.BufferGeometry} geo local frame, axis +X, centre at origin
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {number} softness 0 = hard crease, 1 = very gradual
 */
export function applyFlatSpot(geo, g, softness = 0.55) {
    const deflection = g.freeRadius - g.staticLoadedRadius;
    if (deflection <= 0) return;

    const pos = geo.attributes.position;
    // Blend zone: the arc over which the deflection eases to zero.
    const blend = Math.max(1e-6, deflection * (6 + 18 * softness));

    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const r = Math.hypot(y, z);
        if (r < 1e-6) continue;
        // Local "down" is -Y in the wheel frame (the scene puts +Y up).
        const depthBelow = -y - g.staticLoadedRadius;
        if (depthBelow <= 0) continue;
        const w = smoothstep(0, 1, Math.min(1, depthBelow / blend));
        pos.setY(i, y + depthBelow * w);
    }
    pos.needsUpdate = true;
}

/* ============================================================
   Seeded tread maps
   ============================================================ */

/**
 * @typedef {'rib'|'lug'|'aircraft'} TreadPattern
 */

/**
 * Generate a tread normal + roughness map pair.
 *
 * The maps tile around the circumference (U) and across the tread (V).
 * Everything stochastic draws from a seeded Rng keyed on the seed, the
 * pattern and the tire designation, so adding a tire never disturbs the
 * grain of an existing one.
 *
 * @param {TreadPattern} pattern
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{seed?: string, designation?: string, repeatU?: number}} [opts]
 * @returns {{normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture}}
 */
export function buildTreadMaps(pattern, g, opts = {}) {
    const seed = opts.seed ?? 'gear3d-01';
    const designation = opts.designation ?? 'tire';
    const rng = new Rng(`${seed}:tread:${pattern}:${designation}`);

    const size = TREAD_TEX;
    const height = renderTreadHeight(pattern, size, rng, g);

    const normalCanvas = heightToNormal(height, size, 2.2);
    const roughCanvas = heightToRoughness(height, size, pattern);

    const normalMap = new THREE.CanvasTexture(normalCanvas);
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    for (const t of [normalMap, roughnessMap]) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 8;
        t.needsUpdate = true;
    }
    normalMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.colorSpace = THREE.NoColorSpace;
    return { normalMap, roughnessMap };
}

/**
 * Render a greyscale height field for the tread. U wraps around the
 * circumference; V runs across the tread with the shoulders at the edges.
 *
 * @param {TreadPattern} pattern
 * @param {number} size
 * @param {Rng} rng
 * @param {import('../core/tires.js').TireGeometry} g
 * @returns {ImageData}
 */
function renderTreadHeight(pattern, size, rng, g) {
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    if (pattern === 'lug') {
        // Chunky transverse blocks with a central rib — a drive-axle pattern.
        const rows = rng.int(14, 18);
        const rowH = size / rows;
        ctx.fillStyle = '#ffffff';
        for (let r = 0; r < rows; r++) {
            const y = r * rowH;
            const skew = rng.range(-0.18, 0.18) * size;
            for (const side of [-1, 1]) {
                const w = size * rng.range(0.3, 0.36);
                const x = size / 2 + side * size * 0.13 + skew * 0.05;
                roundRect(ctx, side < 0 ? x - w : x, y + rowH * 0.12, w, rowH * 0.72, rowH * 0.18);
                ctx.fill();
            }
        }
        // central rib
        ctx.fillRect(size * 0.47, 0, size * 0.06, size);
    } else if (pattern === 'aircraft') {
        // Circumferential ribs only — aircraft tires are ribbed, never lugged.
        const ribs = rng.int(4, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#101010';
        const grooveW = size * 0.035;
        for (let i = 1; i < ribs; i++) {
            const x = (i / ribs) * size + rng.range(-2, 2);
            ctx.fillRect(x - grooveW / 2, 0, grooveW, size);
        }
    } else {
        // Rib pattern: circumferential grooves plus fine sipes. Steer axles,
        // trailer axles and most line-haul fitments.
        const ribs = rng.int(4, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#141414';
        const grooveW = size * 0.045;
        for (let i = 1; i < ribs; i++) {
            const x = (i / ribs) * size + rng.range(-3, 3);
            ctx.fillRect(x - grooveW / 2, 0, grooveW, size);
        }
        // sipes: short transverse cuts inside each rib
        ctx.strokeStyle = '#3a3a3a';
        ctx.lineWidth = Math.max(1, size * 0.004);
        const sipes = rng.int(48, 70);
        for (let i = 0; i < sipes; i++) {
            const rib = rng.int(0, ribs - 1);
            const x0 = (rib / ribs) * size + grooveW;
            const x1 = ((rib + 1) / ribs) * size - grooveW;
            const y = rng.range(0, size);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y + rng.range(-4, 4));
            ctx.stroke();
        }
    }

    // Fine rubber grain over everything, so the surface is never plastic-flat.
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (rng.unit() - 0.5) * 16;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
    }
    return img;
}

/**
 * Sobel the height field into a tangent-space normal map.
 * @param {ImageData} height
 * @param {number} size
 * @param {number} strength
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
            nx /= m; ny /= m; nz /= m;
            const i = (y * size + x) * 4;
            out.data[i] = (nx * 0.5 + 0.5) * 255;
            out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
            out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
            out.data[i + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
    return cv;
}

/**
 * Groove floors are slightly glossier than the tread face (they wear less),
 * so roughness follows height inversely with a shallow range.
 * @param {ImageData} height
 * @param {number} size
 * @param {TreadPattern} pattern
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
function heightToRoughness(height, size, pattern) {
    const base = pattern === 'aircraft' ? 0.78 : 0.86;
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(size, size);
    for (let i = 0; i < out.data.length; i += 4) {
        const hv = height.data[i] / 255;
        const r = base - 0.14 * (1 - hv);
        const v = Math.round(Math.max(0, Math.min(1, r)) * 255);
        out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return cv;
}

/* ---------- small helpers ---------- */

/**
 * @param {number} w @param {number} h
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
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
