/* ============================================================
   Stride Lab — anatomical plausibility gating.

   Visibility is not the same thing as correctness, and this is the
   gap that lets a bad analysis look like a good one.

   A pose estimator asked for a landmark it cannot see does not
   decline. It guesses, and it often reports a comfortable
   confidence while doing so. The far leg of a runner filmed at an
   angle is the standard case: occluded for much of the cycle,
   hallucinated somewhere below the body, and delivered with a
   visibility score high enough to pass a confidence gate. Every
   downstream measurement on that side is then computed from a limb
   that was never there.

   What a confidence score cannot know, but geometry can: bones do
   not change length. A shank that measures 1.7 times its own median
   across the clip is not an unusual posture, it is a tracking
   failure, and it can be identified without any reference to how
   sure the model claims to be.

   So each rigid segment is measured against its OWN median over the
   clip — the runner's own proportions, not a population's — and the
   distal landmark of any frame that disagrees is marked missing.
   The existing gating then treats it as missing, which is the
   behaviour that was always wanted.
   ============================================================ */

import { CANONICAL, median } from '../types.js';

/**
 * Segments treated as rigid. Ordered proximal to distal, so gating a
 * landmark cascades correctly: an unusable knee makes the shank unusable too.
 */
export const RIGID_SEGMENTS = [
    { from: 'shoulderL', to: 'elbowL' }, { from: 'shoulderR', to: 'elbowR' },
    { from: 'elbowL', to: 'wristL' }, { from: 'elbowR', to: 'wristR' },
    { from: 'hipL', to: 'kneeL' }, { from: 'hipR', to: 'kneeR' },
    { from: 'kneeL', to: 'ankleL' }, { from: 'kneeR', to: 'ankleR' },
    { from: 'heelL', to: 'toeL' }, { from: 'heelR', to: 'toeR' },
    { from: 'ankleL', to: 'heelL' }, { from: 'ankleR', to: 'heelR' }
];

/**
 * How far a segment may depart from its own median before the frame is
 * disbelieved. Generous on purpose: real foreshortening in a slightly oblique
 * view shortens a limb legitimately, and the target here is the gross failure
 * — a limb placed somewhere it anatomically cannot be — not the honest few
 * per cent of perspective.
 */
export const LENGTH_TOLERANCE = 0.40;

/** A segment needs this many usable frames before its median means anything. */
const MIN_SAMPLES = 12;

/**
 * Mark implausible samples as missing, in place.
 *
 * @param {import('../types.js').PoseSeries} series  modified in place
 * @returns {{gated:number, total:number, bySegment:Record<string,number>}}
 */
export function gateImplausibleSegments(series) {
    const K = CANONICAL.length;
    const idx = Object.fromEntries(CANONICAL.map((n, i) => [n, i]));
    const { n, width, height } = series;

    const lengthAt = (f, a, b) => {
        const ia = idx[a], ib = idx[b];
        if (ia == null || ib == null) return NaN;
        if (!(series.vis[f * K + ia] >= 0.5) || !(series.vis[f * K + ib] >= 0.5)) return NaN;
        /* pixels, not normalised units: normalised coordinates are scaled
           differently on each axis, so a length computed in them changes with
           the aspect ratio of the frame */
        const dx = (series.xy[(f * K + ia) * 2] - series.xy[(f * K + ib) * 2]) * width;
        const dy = (series.xy[(f * K + ia) * 2 + 1] - series.xy[(f * K + ib) * 2 + 1]) * height;
        return Math.hypot(dx, dy);
    };

    let gated = 0, total = 0;
    /** @type {Record<string, number>} */
    const bySegment = {};

    for (const seg of RIGID_SEGMENTS) {
        const lens = new Float64Array(n);
        const finite = [];
        for (let f = 0; f < n; f++) {
            lens[f] = lengthAt(f, seg.from, seg.to);
            if (Number.isFinite(lens[f])) finite.push(lens[f]);
        }
        if (finite.length < MIN_SAMPLES) continue;
        const med = median(finite);
        if (!(med > 0)) continue;

        const distal = idx[seg.to];
        let count = 0;
        for (let f = 0; f < n; f++) {
            if (!Number.isFinite(lens[f])) continue;
            total++;
            if (Math.abs(lens[f] - med) / med > LENGTH_TOLERANCE) {
                series.vis[f * K + distal] = 0;
                count++; gated++;
            }
        }
        if (count) bySegment[`${seg.from}->${seg.to}`] = count;
    }

    return { gated, total, bySegment };
}

/**
 * Does the runner actually travel across the frame?
 *
 * Overground step length and speed are measured as displacement between foot
 * strikes, and that only means anything if the frame is fixed to the world. It
 * is not fixed when the runner is on a treadmill, and it is not fixed when a
 * hand-held camera follows them. Both look identical in the data: the body
 * stays put while the legs cycle.
 *
 * Getting this wrong is not a small error. A runner who does not translate
 * measures a step length near zero and a speed near zero, and those then feed
 * the vertical ratio, the stiffness model and the choice of speed-conditional
 * reference band — so one undetected condition quietly corrupts a whole column
 * of the report with numbers that are not merely imprecise but meaningless.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {number} legLengthPx
 */
export function frameIsWorldFixed(cond, legLengthPx) {
    if (!(legLengthPx > 0)) return { worldFixed: false, travelLegs: NaN };
    let lo = Infinity, hi = -Infinity;
    for (let f = 0; f < cond.n; f++) {
        const x = cond.kp.hipMid.x[f];
        if (!Number.isFinite(x)) continue;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
    }
    if (!(hi > lo)) return { worldFixed: false, travelLegs: 0 };
    const travelLegs = (hi - lo) / legLengthPx;
    /* Two leg lengths is about one stride of travel. Anything less over a
       whole clip is not a runner crossing a fixed frame. */
    return { worldFixed: travelLegs >= 2, travelLegs };
}
