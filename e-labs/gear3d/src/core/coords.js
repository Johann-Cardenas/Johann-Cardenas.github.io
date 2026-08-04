/* ============================================================
   Gear3D — coordinate system
   ------------------------------------------------------------
   ENGINEERING FRAME (canonical — all data, all exports, all
   dimensions, all contact patches are expressed in this frame):

     x  longitudinal, POSITIVE REARWARD.
        Origin at the FIRST (front-most) axle centreline.
     y  transverse, POSITIVE TO THE RIGHT of the direction
        of travel. Origin on the vehicle centreline.
     z  vertical, POSITIVE UP. z = 0 at the PAVEMENT SURFACE.

   Right-handed. Units: millimetres.

   RENDER FRAME (three.js, Y-up):
        (x, y, z)_eng  ->  (y, z, x)_three

   This is a cyclic permutation, so handedness is preserved
   (three.js is also right-handed). Conversion happens ONLY at
   the scene boundary. Render coordinates must never appear in
   data files, dimensions, or exports.
   ============================================================ */

'use strict';

/**
 * @typedef {{x:number, y:number, z:number}} Vec3
 */

/** Canonical unit of every stored length. */
export const CANONICAL_LENGTH_UNIT = 'mm';

/** Human-readable axis metadata, used by axis badges and UI copy. */
export const ENG_AXES = Object.freeze({
    x: { label: 'X', name: 'longitudinal', positive: 'rearward', origin: 'front-most axle centreline' },
    y: { label: 'Y', name: 'transverse', positive: 'right of travel', origin: 'vehicle centreline' },
    z: { label: 'Z', name: 'vertical', positive: 'up', origin: 'pavement surface' }
});

/**
 * Engineering -> render (three.js) frame.
 * @param {Vec3} p engineering-frame point, mm
 * @returns {Vec3} render-frame point, mm
 */
export function engToRender(p) {
    return { x: p.y, y: p.z, z: p.x };
}

/**
 * Render (three.js) -> engineering frame. Exact inverse of {@link engToRender}.
 * @param {Vec3} p render-frame point, mm
 * @returns {Vec3} engineering-frame point, mm
 */
export function renderToEng(p) {
    return { x: p.z, y: p.x, z: p.y };
}

/**
 * Engineering point -> flat array in render order, for direct use with
 * `three` constructors such as `new THREE.Vector3(...engToArray(p))`.
 * @param {Vec3} p engineering-frame point, mm
 * @returns {[number, number, number]}
 */
export function engToArray(p) {
    return [p.y, p.z, p.x];
}

/**
 * Build an engineering-frame point. Missing components default to 0.
 * @param {number} [x]
 * @param {number} [y]
 * @param {number} [z]
 * @returns {Vec3}
 */
export function eng(x = 0, y = 0, z = 0) {
    return { x, y, z };
}

/* ---------- small vector helpers, engineering frame ---------- */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

/** @param {Vec3} a @param {number} s @returns {Vec3} */
export function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} midpoint */
export function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }

/** @param {Vec3} a @returns {number} magnitude, mm */
export function length(a) { return Math.hypot(a.x, a.y, a.z); }

/** @param {Vec3} a @param {Vec3} b @returns {number} distance, mm */
export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

/** @param {Vec3} a @returns {Vec3} unit vector (zero vector returns zero) */
export function normalize(a) {
    const m = length(a);
    return m === 0 ? { x: 0, y: 0, z: 0 } : { x: a.x / m, y: a.y / m, z: a.z / m };
}

/** @param {Vec3} a @param {Vec3} b @returns {number} */
export function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

/**
 * Unit vector along an engineering axis.
 * @param {'x'|'y'|'z'} axis
 * @returns {Vec3}
 */
export function axisVector(axis) {
    return { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 };
}

/**
 * Axis-aligned bounding box over a set of engineering points.
 * @param {Vec3[]} points
 * @returns {{min:Vec3, max:Vec3, center:Vec3, size:Vec3}|null} null when empty
 */
export function bounds(points) {
    if (!points || points.length === 0) return null;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of points) {
        if (p.x < min.x) min.x = p.x;
        if (p.y < min.y) min.y = p.y;
        if (p.z < min.z) min.z = p.z;
        if (p.x > max.x) max.x = p.x;
        if (p.y > max.y) max.y = p.y;
        if (p.z > max.z) max.z = p.z;
    }
    return {
        min, max,
        center: mid(min, max),
        size: sub(max, min)
    };
}

/* ---------- locked view definitions ----------
   Each locked orthographic view is defined by the engineering
   direction the camera LOOKS ALONG, plus which engineering axis
   maps to screen-right and screen-up. Keeping these here (rather
   than in the camera module) means the dimension engine and the
   camera module cannot disagree about what "Plan" means.
------------------------------------------------------------- */

/**
 * @typedef {Object} ViewAxes
 * @property {Vec3}   lookAlong  direction the camera looks along, engineering frame
 * @property {Vec3}   right      engineering direction that appears to screen-right
 * @property {Vec3}   up         engineering direction that appears to screen-up
 * @property {string} label
 * @property {string} purpose
 */

/** @type {Record<'plan'|'side'|'front', ViewAxes>} */
export const LOCKED_VIEWS = Object.freeze({
    // Looking straight down with engineering +x to screen-right, a right-handed
    // camera basis forces engineering +y to screen-up: right x up must equal
    // the camera's backward direction, -lookAlong. The vehicle's right-hand
    // side therefore appears at the top of a plan view.
    plan: {
        lookAlong: { x: 0, y: 0, z: -1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        label: 'Plan',
        purpose: 'Track widths, dual spacings, axle spacings, footprint layout'
    },
    side: {
        lookAlong: { x: 0, y: 1, z: 0 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        label: 'Side',
        purpose: 'Wheelbase, axle spacings, tire diameters'
    },
    front: {
        lookAlong: { x: -1, y: 0, z: 0 },
        right: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        label: 'Front',
        purpose: 'Track width, dual spacing, overall width'
    }
});

/**
 * Camera presets for the free 3D view, as azimuth/elevation in degrees.
 * Azimuth is measured about the engineering +z axis, 0 deg looking from
 * directly ahead of the vehicle (-x), increasing toward the vehicle's
 * right (+y). Elevation is above the pavement plane.
 *
 * `front34Left` reproduces the reference figure: an orthographic
 * front-three-quarter view from the vehicle's left.
 */
export const CAMERA_PRESETS = Object.freeze({
    isometric: { azimuth: 45, elevation: 35.264, label: 'Isometric' },
    dimetric: { azimuth: 45, elevation: 20, label: 'Dimetric' },
    front34Left: { azimuth: -30, elevation: 20, label: 'Front 3/4 Left' },
    front34Right: { azimuth: 30, elevation: 20, label: 'Front 3/4 Right' },
    rear34: { azimuth: 150, elevation: 22, label: 'Rear 3/4' }
});

/**
 * Spherical (azimuth/elevation) -> engineering-frame unit offset from target.
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @returns {Vec3} unit vector from target toward the camera
 */
export function orbitToEng(azimuthDeg, elevationDeg) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const c = Math.cos(el);
    return {
        x: -c * Math.cos(az),
        y: c * Math.sin(az),
        z: Math.sin(el)
    };
}

/**
 * Inverse of {@link orbitToEng}.
 * @param {Vec3} v offset from target toward the camera
 * @returns {{azimuth:number, elevation:number}} degrees
 */
export function engToOrbit(v) {
    const n = normalize(v);
    const elevation = (Math.asin(Math.max(-1, Math.min(1, n.z))) * 180) / Math.PI;
    const azimuth = (Math.atan2(n.y, -n.x) * 180) / Math.PI;
    return { azimuth, elevation };
}

/* ------------------------------------------------------------
   Export transform
   ------------------------------------------------------------ */

/**
 * Render frame (three.js, metres) -> engineering frame (millimetres), as a
 * COLUMN-MAJOR 4x4 suitable for `THREE.Matrix4.fromArray`.
 *
 * This lives here, with the rest of the frame conversion, rather than in the
 * exporter: it is pure arithmetic, it is the inverse of {@link engToRender},
 * and it must never be allowed to disagree with it. Keeping it three-free
 * also means the test suite can check it without a browser.
 *
 * The linear part is the cyclic permutation (x,y,z) -> (z,x,y), determinant
 * +1, so handedness is preserved and no surface normal is inverted.
 *
 * @param {number} [scale=1000] metres to millimetres
 * @returns {number[]} 16 elements, column-major
 */
export function renderToEngMatrix(scale = 1000) {
    const s = scale;
    return [
        0, s, 0, 0,
        0, 0, s, 0,
        s, 0, 0, 0,
        0, 0, 0, 1
    ];
}

/**
 * Apply a column-major 4x4 to a point. For tests and for anything that needs
 * the transform without pulling in three.js.
 * @param {number[]} m column-major 4x4
 * @param {Vec3} p
 * @returns {Vec3}
 */
export function applyMatrix16(m, p) {
    return {
        x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
        y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
        z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
    };
}
