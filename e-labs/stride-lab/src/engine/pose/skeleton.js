/* ============================================================
   Stride Lab — normalised skeleton adapter.

   Two backends produce two different keypoint sets. Everything
   downstream addresses landmarks by NAME through this module, so
   swapping the backend cannot silently re-point a metric at the
   wrong joint. No metric file may contain a raw landmark index.
   ============================================================ */

import { CANONICAL } from '../types.js';

/**
 * BlazePose / MediaPipe PoseLandmarker, 33 landmarks.
 * The heel (29/30) and foot index (31/32) are the reason this is the default
 * backend: without both, foot-strike angle cannot be computed at all and the
 * best kinematic contact detectors have nothing to key off.
 */
export const BLAZEPOSE_33 = {
    nose: 0,
    eyeL: 2, eyeR: 5,
    earL: 7, earR: 8,
    shoulderL: 11, shoulderR: 12,
    elbowL: 13, elbowR: 14,
    wristL: 15, wristR: 16,
    hipL: 23, hipR: 24,
    kneeL: 25, kneeR: 26,
    ankleL: 27, ankleR: 28,
    heelL: 29, heelR: 30,
    toeL: 31, toeR: 32
    /* handL/handR are a centroid, not an index — see BLAZEPOSE_CENTROIDS.
       footOuterL/R do not exist in this keypoint set at all. */
};

/**
 * Landmarks assembled from several raw indices. BlazePose reports three points
 * per hand (pinky, index, thumb); their centroid is a more stable hand
 * position than any one of them and is what the hand segment needs.
 */
export const BLAZEPOSE_CENTROIDS = {
    handL: [17, 19, 21],
    handR: [18, 20, 22]
};

/**
 * Halpe-26, the RTMPose research backend.
 * Halpe describes the foot better than BlazePose (big toe, small toe and heel
 * per side) and carries a genuine pelvis centre at 19. `toe*` maps to the big
 * toe, which is the closest analogue of BlazePose's foot index.
 */
export const HALPE_26 = {
    nose: 0,
    eyeL: 1, eyeR: 2,
    earL: 3, earR: 4,
    shoulderL: 5, shoulderR: 6,
    elbowL: 7, elbowR: 8,
    wristL: 9, wristR: 10,
    hipL: 11, hipR: 12,
    kneeL: 13, kneeR: 14,
    ankleL: 15, ankleR: 16,
    heelL: 24, heelR: 25,
    toeL: 20, toeR: 21,
    /* the one thing this keypoint set has that BlazePose does not: a second
       forefoot point, which makes the foot a plane rather than a line */
    footOuterL: 22, footOuterR: 23
    /* no hand landmarks; handL/R fall back to the wrist */
};

/** Extra points some backends provide natively rather than as a midpoint. */
export const NATIVE_MIDPOINTS = {
    'rtmpose-halpe26': { hipMid: 19, neckMid: 18 }
};

export const BACKEND_MAPS = {
    'mediapipe-blazepose': BLAZEPOSE_33,
    'rtmpose-halpe26': HALPE_26
};

/**
 * Re-index a raw per-frame landmark array onto the canonical order.
 *
 * @param {Float32Array|number[]} rawXY   [kp][2], normalised image coords
 * @param {Float32Array|number[]} rawVis  [kp]
 * @param {string} backendId
 * @param {Float64Array} outXY  destination slice, 2 * CANONICAL.length
 * @param {Float64Array} outVis destination slice, CANONICAL.length
 */
export const BACKEND_CENTROIDS = {
    'mediapipe-blazepose': BLAZEPOSE_CENTROIDS,
    'rtmpose-halpe26': {}
};

export function adaptFrame(rawXY, rawVis, backendId, outXY, outVis) {
    const map = BACKEND_MAPS[backendId];
    if (!map) throw new Error(`unknown pose backend: ${backendId}`);
    const centroids = BACKEND_CENTROIDS[backendId] || {};
    for (let c = 0; c < CANONICAL.length; c++) {
        const name = CANONICAL[c];
        const group = centroids[name];
        if (group) {
            /* mean of the contributing landmarks, weighted by nothing: they are
               the same anatomical structure seen three ways */
            let sx = 0, sy = 0, sv = 0, n = 0;
            for (const i of group) {
                if (!Number.isFinite(rawXY[i * 2])) continue;
                sx += rawXY[i * 2]; sy += rawXY[i * 2 + 1]; sv += rawVis[i]; n++;
            }
            if (n) { outXY[c * 2] = sx / n; outXY[c * 2 + 1] = sy / n; outVis[c] = sv / n; }
            else { outXY[c * 2] = NaN; outXY[c * 2 + 1] = NaN; outVis[c] = 0; }
            continue;
        }
        const src = map[name];
        if (src == null) { outXY[c * 2] = NaN; outXY[c * 2 + 1] = NaN; outVis[c] = 0; continue; }
        outXY[c * 2] = rawXY[src * 2];
        outXY[c * 2 + 1] = rawXY[src * 2 + 1];
        outVis[c] = rawVis[src];
    }
}

/** Which canonical landmarks a backend can actually supply. */
export function backendCoverage(backendId) {
    const map = BACKEND_MAPS[backendId] || {};
    const centroids = BACKEND_CENTROIDS[backendId] || {};
    return CANONICAL.filter(n => map[n] != null || centroids[n]);
}

/**
 * Allocate an empty canonical PoseSeries.
 * @returns {import('../types.js').PoseSeries}
 */
export function makeSeries(n, width, height) {
    return {
        names: CANONICAL.slice(),
        n,
        t: new Float64Array(n),
        xy: new Float64Array(n * CANONICAL.length * 2),
        vis: new Float64Array(n * CANONICAL.length),
        width,
        height
    };
}

/** Index of a canonical name; throws rather than silently returning -1. */
export function kp(name) {
    const i = CANONICAL.indexOf(name);
    if (i < 0) throw new Error(`not a canonical keypoint: ${name}`);
    return i;
}
