/* ============================================================
   Gear3D — engineering space -> screen space
   ------------------------------------------------------------
   Pure math over a plain 4x4 view-projection matrix (column-major,
   the same layout three.js uses). No three.js import, no DOM, so
   the projection and decluttering logic is testable under Node.

   The caller extracts the matrix once per frame:
       camera.updateMatrixWorld();
       const vp = new THREE.Matrix4().multiplyMatrices(
           camera.projectionMatrix, camera.matrixWorldInverse);
   and passes `vp.elements` in.

   IMPORTANT: dimensions are defined in the ENGINEERING frame in
   millimeters. The transform to the render frame and the meter
   scale are folded in here, so a dimension definition never has to
   know that three.js exists.
   ============================================================ */

'use strict';

/** Millimeters to scene meters — must match geometry/assembly.js. */
const MM_TO_SCENE = 0.001;

/**
 * @typedef {{x:number, y:number, z:number}} Vec3
 * @typedef {{x:number, y:number, depth:number, behind:boolean}} ScreenPoint
 */

/**
 * Project an engineering-frame point (mm) to pixel coordinates.
 *
 * @param {Vec3} p engineering millimeters
 * @param {ArrayLike<number>} vp column-major 4x4 view-projection matrix
 * @param {{width:number, height:number}} viewport pixels
 * @returns {ScreenPoint}
 */
export function projectEng(p, vp, viewport) {
    // engineering (x,y,z) -> render (y,z,x), then to meters
    const rx = p.y * MM_TO_SCENE;
    const ry = p.z * MM_TO_SCENE;
    const rz = p.x * MM_TO_SCENE;

    const e = vp;
    const cx = e[0] * rx + e[4] * ry + e[8] * rz + e[12];
    const cy = e[1] * rx + e[5] * ry + e[9] * rz + e[13];
    const cz = e[2] * rx + e[6] * ry + e[10] * rz + e[14];
    const cw = e[3] * rx + e[7] * ry + e[11] * rz + e[15];

    const w = cw === 0 ? 1e-9 : cw;
    const ndcX = cx / w;
    const ndcY = cy / w;
    const ndcZ = cz / w;

    return {
        x: (ndcX * 0.5 + 0.5) * viewport.width,
        y: (-ndcY * 0.5 + 0.5) * viewport.height,
        depth: ndcZ,
        behind: cw < 0
    };
}

/**
 * Screen-space direction and length of an engineering-space segment.
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {ArrayLike<number>} vp
 * @param {{width:number, height:number}} viewport
 * @returns {{a: ScreenPoint, b: ScreenPoint, dx: number, dy: number, lengthPx: number, angle: number}}
 */
export function projectSegment(a, b, vp, viewport) {
    const pa = projectEng(a, vp, viewport);
    const pb = projectEng(b, vp, viewport);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    return { a: pa, b: pb, dx, dy, lengthPx: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

/**
 * How close to edge-on a dimension is, as the angle in DEGREES between the
 * dimension's own direction and the view direction's perpendicular.
 *
 * A dimension viewed nearly along its own axis projects to almost nothing
 * and draws as garbage; the engine fades it out below a threshold rather
 * than emitting an unreadable label. Returns 90 for a dimension square to
 * the camera and 0 for one seen exactly end-on.
 *
 * @param {Vec3} a engineering
 * @param {Vec3} b engineering
 * @param {ArrayLike<number>} vp
 * @param {{width:number, height:number}} viewport
 * @returns {number} degrees, 0..90
 */
export function foreshorteningDeg(a, b, vp, viewport) {
    const seg = projectSegment(a, b, vp, viewport);
    const trueLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (trueLen < 1e-9) return 0;

    // Compare the projected length against the length the same segment would
    // have if it were square to the camera. Rather than reconstruct that,
    // probe with a second segment of equal length along a screen-aligned
    // direction and take the ratio — cheap and robust for any projection.
    const probeLen = seg.lengthPx / (trueLen * MM_TO_SCENE || 1e-9);
    const reference = referenceScale(vp, viewport, a);
    if (reference < 1e-9) return 90;
    const ratio = Math.max(0, Math.min(1, probeLen / reference));
    return (Math.asin(ratio) * 180) / Math.PI;
}

/**
 * Pixels per scene meter at a given point, measured along the screen X axis.
 * Used for the scale bar and as the reference for foreshortening.
 *
 * @param {ArrayLike<number>} vp
 * @param {{width:number, height:number}} viewport
 * @param {Vec3} nearPoint engineering mm, where the scale is sampled
 * @returns {number} pixels per scene meter
 */
export function referenceScale(vp, viewport, nearPoint = { x: 0, y: 0, z: 0 }) {
    const step = 100; // mm probe
    // Probe along engineering y and z and take the larger — one of them is
    // always reasonably square to the camera in every supported view.
    const p0 = projectEng(nearPoint, vp, viewport);
    const py = projectEng({ ...nearPoint, y: nearPoint.y + step }, vp, viewport);
    const pz = projectEng({ ...nearPoint, z: nearPoint.z + step }, vp, viewport);
    const dy = Math.hypot(py.x - p0.x, py.y - p0.y);
    const dz = Math.hypot(pz.x - p0.x, pz.y - p0.y);
    return Math.max(dy, dz) / (step * MM_TO_SCENE);
}

/**
 * Pixels per millimeter at a point — what the scale bar needs.
 * @param {ArrayLike<number>} vp
 * @param {{width:number, height:number}} viewport
 * @param {Vec3} at
 * @returns {number}
 */
export function pixelsPerMm(vp, viewport, at = { x: 0, y: 0, z: 0 }) {
    return referenceScale(vp, viewport, at) * MM_TO_SCENE;
}

/* ============================================================
   Label decluttering
   ============================================================ */

/**
 * @typedef {Object} LabelBox
 * @property {string} id
 * @property {number} x      center, pixels
 * @property {number} y      center, pixels
 * @property {number} w
 * @property {number} h
 * @property {number} [priority] higher wins the contested position
 * @property {number} [ox]   offset direction x, unit
 * @property {number} [oy]   offset direction y, unit
 */

/**
 * Resolve overlapping labels by STAGGERING them along their own offset
 * direction, never by hiding one.
 *
 * A hidden dimension is worse than a crowded one: the reader cannot tell
 * the difference between "not measured" and "measured but suppressed".
 * So every label keeps its place in the output; only its offset changes.
 *
 * @param {LabelBox[]} boxes mutated in place with resolved x/y
 * @param {{step?: number, maxPasses?: number, padding?: number}} [opts]
 * @returns {LabelBox[]} the same array, with x/y adjusted
 */
export function declutter(boxes, opts = {}) {
    const step = opts.step ?? 14;
    const maxPasses = opts.maxPasses ?? 12;
    const pad = opts.padding ?? 2;

    // Stable order: higher priority keeps its position, others move.
    const order = boxes
        .map((b, i) => ({ b, i }))
        .sort((p, q) => (q.b.priority ?? 0) - (p.b.priority ?? 0) || p.i - q.i)
        .map((p) => p.b);

    for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (let i = 1; i < order.length; i++) {
            const a = order[i];
            for (let j = 0; j < i; j++) {
                const b = order[j];
                if (!overlaps(a, b, pad)) continue;
                // Push `a` along its own offset direction; fall back to
                // straight down when it has none.
                const ox = a.ox ?? 0;
                const oy = a.oy ?? (ox === 0 ? 1 : 0);
                const m = Math.hypot(ox, oy) || 1;
                a.x += (ox / m) * step;
                a.y += (oy / m) * step;
                moved = true;
                break;
            }
        }
        if (!moved) break;
    }
    return boxes;
}

/**
 * @param {LabelBox} a
 * @param {LabelBox} b
 * @param {number} pad
 * @returns {boolean}
 */
export function overlaps(a, b, pad = 0) {
    return Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2
        && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;
}

/**
 * Estimate a text label's pixel box. Deliberately a cheap approximation:
 * measuring real text for every label every frame is far more expensive
 * than the small amount of extra padding this costs.
 * @param {string} text
 * @param {number} fontSize
 * @returns {{w: number, h: number}}
 */
export function estimateTextBox(text, fontSize) {
    return { w: text.length * fontSize * 0.56 + 10, h: fontSize + 8 };
}

/**
 * Axis-aligned bounding box of a w x h box rotated by `angleRad`.
 *
 * Dimension labels are rotated to lie along their own dimension line, but
 * {@link declutter} and {@link overlaps} reason about axis-aligned boxes. Given
 * the unrotated glyph box, those two would consider a steeply rotated label to
 * be a thin horizontal sliver and let it sit on top of anything it is not
 * parallel to — which is exactly what a three-quarter view is full of. Feeding
 * them this box instead makes the footprint honest.
 *
 * A 70 x 12 label at 45 degrees occupies a 58 x 58 square, not 70 x 12.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} angleRad
 * @returns {{w: number, h: number}}
 */
export function rotatedBox(w, h, angleRad) {
    const c = Math.abs(Math.cos(angleRad));
    const s = Math.abs(Math.sin(angleRad));
    return { w: w * c + h * s, h: w * s + h * c };
}
