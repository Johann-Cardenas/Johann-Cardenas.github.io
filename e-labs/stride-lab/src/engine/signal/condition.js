/* ============================================================
   Stride Lab — Stage E. Turn a raw PoseSeries into conditioned,
   y-UP, filtered tracks plus their derivatives.

   Order matters and is not negotiable:
     1. coordinate convention   (y up, pixels)
     2. confidence gating       (drop, do not smooth over)
     3. gap fill                (short gaps only)
     4. Hampel                  (kill limb-swap flips)
     5. zero-phase Butterworth  (filtfilt, corrected cutoff)
     6. derivatives             (from the FILTERED signal)
   ============================================================ */

import {
    CANONICAL, VISIBILITY_GATE, MAX_GAP_FRAMES, DEFAULT_CUTOFF_HZ,
    MISSING_FRACTION_LIMIT, median
} from '../types.js';
import { filtfilt, hampel, fillGaps, derivative, missingFraction } from './filter.js';

/**
 * @typedef {Object} Track
 * @property {Float64Array} x   pixels, +x = direction of travel after mirroring
 * @property {Float64Array} y   pixels, +y = UP
 * @property {Float64Array} vx  px/s
 * @property {Float64Array} vy  px/s
 * @property {Float64Array} ax  px/s^2
 * @property {Float64Array} v   visibility 0..1
 * @property {number} missing   fraction of frames gated out
 */

/**
 * @typedef {Object} Conditioned
 * @property {Record<string, Track>} kp    keypoint tracks, plus the derived
 *                                         hipMid / shoulderMid / footCentre*
 * @property {Float64Array} t              seconds
 * @property {number} fps
 * @property {number} n
 * @property {number} width
 * @property {number} height
 * @property {number} cutoffHz
 * @property {boolean} mirrored
 * @property {Record<string, number>} missing
 */

/**
 * @param {import('../types.js').PoseSeries} series
 * @param {{fps:number, cutoffHz?:number, mirror?:boolean}} opts
 * @returns {Conditioned}
 */
export function condition(series, opts) {
    const { n, width, height } = series;
    const fps = opts.fps;
    const cutoffHz = opts.cutoffHz || DEFAULT_CUTOFF_HZ;
    const mirror = !!opts.mirror;
    const dt = 1 / fps;
    const K = CANONICAL.length;

    /** @type {Record<string, Track>} */
    const kpOut = {};
    /** @type {Record<string, number>} */
    const missing = {};

    for (let c = 0; c < K; c++) {
        const name = CANONICAL[c];
        const rx = new Float64Array(n);
        const ry = new Float64Array(n);
        const rv = new Float64Array(n);

        for (let f = 0; f < n; f++) {
            const vis = series.vis[f * K + c];
            rv[f] = vis;
            /* 1. Coordinate convention. MediaPipe hands back normalised image
               coordinates with y increasing DOWNWARD. Convert once, here, to a
               right-handed frame with y increasing upward. Every angle in the
               report is mirrored if this is skipped, and it is mirrored
               plausibly, which is why it has its own regression test. */
            const nx = series.xy[(f * K + c) * 2];
            const ny = series.xy[(f * K + c) * 2 + 1];
            /* 2. Confidence gating: below the gate the sample is MISSING, not
               zero and not the last good value. */
            if (!(vis >= VISIBILITY_GATE) || !Number.isFinite(nx) || !Number.isFinite(ny)) {
                rx[f] = NaN; ry[f] = NaN;
            } else {
                rx[f] = (mirror ? (1 - nx) : nx) * width;
                ry[f] = (1 - ny) * height;
            }
        }

        missing[name] = missingFraction(rx);

        /* 3. short-gap fill (long gaps stay NaN), 4. Hampel, 5. filtfilt.
           A single NaN poisons an IIR filter for the rest of the signal, so
           the long gaps are bridged with a hold ONLY to keep the filter fed,
           and are masked straight back out afterwards. They must not survive
           as usable samples: a metric that lands in one has to report itself
           unavailable rather than read interpolated fiction. */
        const gapX = hampel(fillGaps(rx, MAX_GAP_FRAMES)).y;
        const gapY = hampel(fillGaps(ry, MAX_GAP_FRAMES)).y;
        const fx = filtfilt(patchForFilter(gapX), cutoffHz, fps);
        const fy = filtfilt(patchForFilter(gapY), cutoffHz, fps);
        for (let f = 0; f < n; f++) {
            if (!Number.isFinite(gapX[f])) { fx[f] = NaN; fy[f] = NaN; }
        }

        kpOut[name] = {
            x: fx, y: fy,
            vx: derivative(patchForFilter(fx), dt, cutoffHz, fps),
            vy: derivative(patchForFilter(fy), dt, cutoffHz, fps),
            ax: new Float64Array(n),
            v: rv,
            missing: missing[name]
        };
        /* mask derivatives where the position was unusable */
        for (let f = 0; f < n; f++) {
            if (!Number.isFinite(fx[f])) { kpOut[name].vx[f] = NaN; kpOut[name].vy[f] = NaN; }
        }
        kpOut[name].ax = derivative(patchForFilter(kpOut[name].vx), dt, cutoffHz, fps);
        for (let f = 0; f < n; f++) if (!Number.isFinite(fx[f])) kpOut[name].ax[f] = NaN;
    }

    /* Derived points. hipMid is the reference for trunk lean, vertical
       oscillation and the strike-pattern-independent contact detector, so it
       gets the same treatment as a measured landmark. */
    kpOut.hipMid = midpoint(kpOut.hipL, kpOut.hipR, n);
    kpOut.shoulderMid = midpoint(kpOut.shoulderL, kpOut.shoulderR, n);
    kpOut.footL = midpoint(kpOut.heelL, kpOut.toeL, n);
    kpOut.footR = midpoint(kpOut.heelR, kpOut.toeR, n);

    /* Segment endpoints for the inertial model. Winter's segments are defined
       between anatomical landmarks that a pose estimator does not report
       directly, so they are constructed here, once, rather than inside every
       metric that needs them:
         pelvis      the hip-joint midpoint, proximal end of the trunk
         neck        the glenohumeral midpoint, distal end of the trunk
         headCentre  the ear midpoint, which is where Winter puts the centre of
                     mass of the head-and-neck segment
         thorax      mid-trunk, used for the trunk-versus-pelvis separation */
    kpOut.pelvis = kpOut.hipMid;
    kpOut.neck = kpOut.shoulderMid;
    kpOut.headCentre = midpoint(kpOut.earL, kpOut.earR, n);
    kpOut.thorax = midpoint(kpOut.shoulderMid, kpOut.hipMid, n);

    for (const name of ['hipMid', 'shoulderMid', 'footL', 'footR', 'pelvis', 'neck', 'headCentre', 'thorax']) {
        missing[name] = missingFraction(kpOut[name].x);
    }
    /* The ears are the only source for the head centre. If the backend loses
       them — a hood, a cap, a very low resolution — fall back to the nose,
       which is worse but bounded, and record that it happened. */
    if (!(missing.headCentre <= 0.5)) {
        kpOut.headCentre = kpOut.nose;
        missing.headCentre = missingFraction(kpOut.nose.x);
        kpOut.headCentreFallback = true;
    }

    return {
        kp: kpOut, t: series.t, fps, n, width, height, cutoffHz,
        mirrored: mirror, missing
    };
}

/**
 * Bridge NaN runs so filtfilt has finite input: forward-fill, then back-fill
 * the leading run, then fall back to the series median if the track is empty.
 * The result is only ever fed to the filter — the caller re-masks.
 */
function patchForFilter(x) {
    const out = Float64Array.from(x);
    const n = out.length;
    let last = NaN;
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(out[i])) last = out[i]; else out[i] = last;
    }
    let first = NaN;
    for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) { first = out[i]; break; }
    if (!Number.isFinite(first)) {
        const m = median(x);
        first = Number.isFinite(m) ? m : 0;
    }
    for (let i = 0; i < n; i++) { if (!Number.isFinite(out[i])) out[i] = first; else break; }
    for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) out[i] = first;
    return out;
}

function midpoint(a, b, n) {
    const mk = () => new Float64Array(n);
    const out = { x: mk(), y: mk(), vx: mk(), vy: mk(), ax: mk(), v: mk(), missing: 0 };
    for (let i = 0; i < n; i++) {
        out.x[i] = 0.5 * (a.x[i] + b.x[i]);
        out.y[i] = 0.5 * (a.y[i] + b.y[i]);
        out.vx[i] = 0.5 * (a.vx[i] + b.vx[i]);
        out.vy[i] = 0.5 * (a.vy[i] + b.vy[i]);
        out.ax[i] = 0.5 * (a.ax[i] + b.ax[i]);
        out.v[i] = Math.min(a.v[i], b.v[i]);
    }
    out.missing = missingFraction(out.x);
    return out;
}

/**
 * Is a landmark reliable enough for a metric that depends on it?
 * The gate is deliberately on the fraction MISSING, not on mean visibility:
 * a landmark that is perfect for 70% of frames and absent for 30% produces a
 * confident-looking mean and an unusable trajectory.
 */
export function landmarkUsable(cond, name, limit = MISSING_FRACTION_LIMIT) {
    const m = cond.missing[name];
    return Number.isFinite(m) && m <= limit;
}
