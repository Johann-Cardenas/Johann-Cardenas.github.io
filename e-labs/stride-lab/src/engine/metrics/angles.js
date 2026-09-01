/* ============================================================
   Stride Lab — per-frame angle series.

   Sign conventions are fixed HERE and nowhere else, so there is a
   single place to check them and a single place for the regression
   test in test/run.mjs to point at.

   The frame is y-UP and, for sagittal analysis, mirrored so that
   +x is always the direction of travel. Every "forward" below means
   +x.
   ============================================================ */

import { signedAngle, interiorAngle, DEG } from '../types.js';

const UP = { x: 0, y: 1 };
const DOWN = { x: 0, y: -1 };

/** Read a keypoint as a Vec2 at frame f. */
export function at(track, f) { return { x: track.x[f], y: track.y[f] }; }

/**
 * Knee FLEXION, degrees. 0 = straight leg, larger = more bent.
 * The interior hip-knee-ankle angle is 180 with the leg straight, so flexion
 * is its complement — which is the quantity every normative band is stated in.
 */
export function kneeFlexionSeries(cond, side) {
    const { n, kp } = cond;
    const hip = kp['hip' + side], knee = kp['knee' + side], ankle = kp['ankle' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) out[f] = 180 - interiorAngle(at(hip, f), at(knee, f), at(ankle, f));
    return out;
}

/** Interior hip-knee-ankle angle, degrees. 180 = straight. */
export function kneeInteriorSeries(cond, side) {
    const { n, kp } = cond;
    const hip = kp['hip' + side], knee = kp['knee' + side], ankle = kp['ankle' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) out[f] = interiorAngle(at(hip, f), at(knee, f), at(ankle, f));
    return out;
}

/**
 * Trunk lean, degrees, POSITIVE FORWARD.
 *
 * Definition: the trunk SEGMENT (hip centre to shoulder centre) relative to
 * vertical. This is not "whole-body lean from the ankle", which is a different
 * and considerably larger number; the UI states which one it shows.
 *
 * Note the sign. `signedAngle(vertical, hipMid->shoulderMid)` is NEGATIVE for a
 * forward lean in a frame where +x is the direction of travel, because a
 * forward lean rotates the trunk vector clockwise. The spec asks for that
 * expression in the metric table and for a positive value on forward lean in
 * the regression test; the report follows the regression test, because
 * "positive means leaning forward" is what a reader will assume. The negation
 * is applied once, here.
 */
export function trunkLeanSeries(cond) {
    const { n, kp } = cond;
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        const v = { x: kp.shoulderMid.x[f] - kp.hipMid.x[f], y: kp.shoulderMid.y[f] - kp.hipMid.y[f] };
        out[f] = -signedAngle(UP, v);
    }
    return out;
}

/**
 * Foot-strike angle, degrees. POSITIVE = toe up = rearfoot.
 * `signedAngle(horizontal, heel->toe)` with horizontal pointing forwards.
 */
export function footAngleSeries(cond, side) {
    const { n, kp } = cond;
    const heel = kp['heel' + side], toe = kp['toe' + side];
    const out = new Float64Array(n);
    const FWD = { x: 1, y: 0 };
    for (let f = 0; f < n; f++) {
        out[f] = signedAngle(FWD, { x: toe.x[f] - heel.x[f], y: toe.y[f] - heel.y[f] });
    }
    return out;
}

/**
 * Shank angle relative to vertical, degrees.
 * POSITIVE = knee BEHIND the ankle, i.e. the overstriding direction. A shank
 * near vertical at contact means the foot landed under the body.
 */
export function shankAngleSeries(cond, side) {
    const { n, kp } = cond;
    const ankle = kp['ankle' + side], knee = kp['knee' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        const dx = knee.x[f] - ankle.x[f];
        const dy = knee.y[f] - ankle.y[f];
        out[f] = Math.atan2(-dx, dy) * DEG;
    }
    return out;
}

/**
 * Hip angle of the thigh relative to the trunk axis, degrees.
 * POSITIVE = thigh BEHIND the trunk = hip extension.
 */
export function hipExtensionSeries(cond, side) {
    const { n, kp } = cond;
    const hip = kp['hip' + side], knee = kp['knee' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        /* trunk axis pointing DOWN the body, so a neutral thigh is colinear */
        const trunkDown = { x: kp.hipMid.x[f] - kp.shoulderMid.x[f], y: kp.hipMid.y[f] - kp.shoulderMid.y[f] };
        const thigh = { x: knee.x[f] - hip.x[f], y: knee.y[f] - hip.y[f] };
        /* negated so that a thigh trailing BEHIND the trunk axis, which is what
           hip extension means, reads positive */
        out[f] = -signedAngle(trunkDown, thigh);
    }
    return out;
}

/**
 * Ankle dorsiflexion, degrees, relative to an assumed neutral.
 *
 * TODO(spec): the specification says "interior knee-ankle-toe angle at foot
 * strike, minus the neutral offset" without defining the offset. A shank
 * perpendicular to the foot LONG AXIS is not 90 degrees when the foot is
 * described by ankle->toe-tip rather than by a rearfoot marker cluster, so the
 * offset chosen here (NEUTRAL_ANKLE_DEG) is a modelling assumption, not a
 * measurement. The metric is capped at medium confidence for that reason and
 * the UI says so.
 */
export const NEUTRAL_ANKLE_DEG = 100;

export function ankleDorsiflexionSeries(cond, side) {
    const { n, kp } = cond;
    const knee = kp['knee' + side], ankle = kp['ankle' + side], toe = kp['toe' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        out[f] = NEUTRAL_ANKLE_DEG - interiorAngle(at(knee, f), at(ankle, f), at(toe, f));
    }
    return out;
}

/** Interior shoulder-elbow-wrist angle, degrees. 180 = straight arm. */
export function elbowAngleSeries(cond, side) {
    const { n, kp } = cond;
    const sh = kp['shoulder' + side], el = kp['elbow' + side], wr = kp['wrist' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) out[f] = interiorAngle(at(sh, f), at(el, f), at(wr, f));
    return out;
}

/**
 * Upper-arm angle from vertical, degrees. POSITIVE = elbow forward of shoulder.
 *
 * Measured from the DOWNWARD vertical, because that is where a hanging arm
 * points. Measuring it from up would put a resting arm at 180 degrees and the
 * swing would then straddle the +-180 wrap, so the RANGE over a stride would
 * come out near 360 instead of near 60.
 */
export function upperArmAngleSeries(cond, side) {
    const { n, kp } = cond;
    const sh = kp['shoulder' + side], el = kp['elbow' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        out[f] = signedAngle(DOWN, { x: el.x[f] - sh.x[f], y: el.y[f] - sh.y[f] });
    }
    return out;
}

/** Head angle relative to the trunk, degrees. POSITIVE = head forward. */
export function headAngleSeries(cond) {
    const { n, kp } = cond;
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        const trunk = { x: kp.shoulderMid.x[f] - kp.hipMid.x[f], y: kp.shoulderMid.y[f] - kp.hipMid.y[f] };
        const head = { x: kp.nose.x[f] - kp.shoulderMid.x[f], y: kp.nose.y[f] - kp.shoulderMid.y[f] };
        out[f] = -signedAngle(trunk, head);
    }
    return out;
}

/* ---------------- Frontal plane ---------------- */

/**
 * Pelvic obliquity, degrees: the hip line relative to horizontal.
 * Reported per stance side by the metric layer as CONTRALATERAL DROP, i.e. a
 * positive number means the swing-side hip has dropped below the stance side.
 */
export function pelvicObliquitySeries(cond) {
    const { n, kp } = cond;
    const out = new Float64Array(n);
    const FWD = { x: 1, y: 0 };
    for (let f = 0; f < n; f++) {
        out[f] = signedAngle(FWD, { x: kp.hipR.x[f] - kp.hipL.x[f], y: kp.hipR.y[f] - kp.hipL.y[f] });
    }
    return out;
}

/**
 * Frontal-plane knee PROJECTION angle, degrees. 0 = hip, knee and ankle
 * colinear in the image; positive = knee displaced medially (valgus-like).
 *
 * It is a projection angle. It is not true knee valgus, it cannot be, and no
 * label in the UI is allowed to imply otherwise.
 */
export function fppaSeries(cond, side, medialSign) {
    const { n, kp } = cond;
    const hip = kp['hip' + side], knee = kp['knee' + side], ankle = kp['ankle' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        /* magnitude: departure from a colinear hip-knee-ankle */
        const dev = 180 - interiorAngle(at(hip, f), at(knee, f), at(ankle, f));
        /* sign: which side of the hip-ankle line the knee sits on */
        const dy = ankle.y[f] - hip.y[f];
        const u = dy !== 0 ? (knee.y[f] - hip.y[f]) / dy : 0;
        const lineX = hip.x[f] + u * (ankle.x[f] - hip.x[f]);
        const offset = knee.x[f] - lineX;
        out[f] = Number.isFinite(dev) && Number.isFinite(offset)
            ? medialSign * Math.sign(offset) * dev
            : NaN;
    }
    return out;
}

/** Trunk lateral lean from vertical, degrees. POSITIVE = lean towards +x. */
export function lateralLeanSeries(cond) {
    const { n, kp } = cond;
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        const v = { x: kp.shoulderMid.x[f] - kp.hipMid.x[f], y: kp.shoulderMid.y[f] - kp.hipMid.y[f] };
        out[f] = -signedAngle(UP, v);
    }
    return out;
}

/**
 * Rearfoot alignment PROXY, degrees: heel-to-knee relative to vertical.
 *
 * Deliberately not called pronation. Rearfoot eversion needs markers on the
 * shoe heel counter and the shank; a single rear-view camera without them
 * cannot resolve it. This is shipped as a low-confidence alignment proxy and
 * labelled as one everywhere it appears.
 */
export function rearfootProxySeries(cond, side) {
    const { n, kp } = cond;
    const heel = kp['heel' + side], knee = kp['knee' + side];
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        out[f] = -signedAngle(UP, { x: knee.x[f] - heel.x[f], y: knee.y[f] - heel.y[f] });
    }
    return out;
}

/**
 * Apparent axial rotation of a horizontal body line seen in the frontal plane,
 * degrees. The projected width shortens as the line rotates away from the
 * image plane, so acos(width / widthMax) recovers the rotation magnitude.
 */
export function axialRotationSeries(cond, leftName, rightName) {
    const { n, kp } = cond;
    const w = new Float64Array(n);
    let wMax = 0;
    for (let f = 0; f < n; f++) {
        w[f] = Math.hypot(kp[rightName].x[f] - kp[leftName].x[f], kp[rightName].y[f] - kp[leftName].y[f]);
        if (Number.isFinite(w[f]) && w[f] > wMax) wMax = w[f];
    }
    const out = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        const r = wMax > 0 ? Math.min(1, w[f] / wMax) : NaN;
        out[f] = Number.isFinite(r) ? Math.acos(r) * DEG : NaN;
    }
    return out;
}
