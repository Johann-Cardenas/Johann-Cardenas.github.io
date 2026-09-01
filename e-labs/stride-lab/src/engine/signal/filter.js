/* ============================================================
   Stride Lab — signal conditioning primitives.

   Everything here is zero-phase or explicitly labelled otherwise.
   Phase lag is disqualifying in this application: a lagged signal
   shifts every gait event in time and therefore biases every
   timing metric by the same amount, invisibly.
   ============================================================ */

import { median, mad, HAMPEL_WINDOW, HAMPEL_SIGMAS, MAX_GAP_FRAMES } from '../types.js';

/**
 * Cutoff correction for a dual (forward-backward) pass.
 *
 *   C = (2^(1/n) - 1)^(1/(2*order))   with n = 2 passes, order = 2
 *     = (sqrt(2) - 1)^(1/4) ~ 0.802
 *
 * Applying a filter twice narrows the passband, so the DESIGN cutoff must be
 * raised by 1/C to land on the intended EFFECTIVE cutoff. Skipping this is the
 * single commonest error in biomechanics filtering code.
 */
export const FILTFILT_CUTOFF_CORRECTION = Math.pow(Math.SQRT2 - 1, 0.25);

/** Design cutoff that yields `effectiveFc` after a forward-backward pass. */
export function designCutoff(effectiveFc) {
    return effectiveFc / FILTFILT_CUTOFF_CORRECTION;
}

/**
 * 2nd-order Butterworth low-pass, bilinear transform with frequency pre-warping.
 * Returns normalised coefficients (a0 = 1).
 */
export function butter2LowpassCoeffs(fcHz, fsHz) {
    const w = Math.tan(Math.PI * fcHz / fsHz);       /* pre-warped */
    const w2 = w * w;
    const a0 = 1 + Math.SQRT2 * w + w2;
    return {
        b: [w2 / a0, 2 * w2 / a0, w2 / a0],
        a: [1, 2 * (w2 - 1) / a0, (1 - Math.SQRT2 * w + w2) / a0]
    };
}

/**
 * Steady-state filter memory for a constant unit input, direct-form-II
 * transposed. Seeding the state with `zi * x[0]` stops the filter from
 * ringing through the first samples, which is what scipy's filtfilt does and
 * what makes the padded edges behave.
 */
export function lfilterZi(b, a) {
    const g = (b[0] + b[1] + b[2]) / (1 + a[1] + a[2]);
    const z1 = b[2] - a[2] * g;
    const z0 = b[1] - a[1] * g + z1;
    return [z0, z1];
}

/**
 * Direct-form-II transposed IIR, single pass (causal, so it HAS phase lag —
 * only ever call it from filtfilt or when the lag is wanted).
 *
 *   y[n]  = b0*x[n] + z0[n-1]
 *   z0[n] = b1*x[n] - a1*y[n] + z1[n-1]
 *   z1[n] = b2*x[n] - a2*y[n]
 */
export function lfilter(x, b, a, zi) {
    const n = x.length;
    const y = new Float64Array(n);
    let z0 = zi ? zi[0] : 0;
    let z1 = zi ? zi[1] : 0;
    for (let i = 0; i < n; i++) {
        const xi = x[i];
        const yi = b[0] * xi + z0;
        z0 = b[1] * xi - a[1] * yi + z1;
        z1 = b[2] * xi - a[2] * yi;
        y[i] = yi;
    }
    return y;
}

/** Odd (antisymmetric) reflection padding, as scipy's filtfilt uses. */
function oddPad(x, pad) {
    const n = x.length;
    const out = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) out[i] = 2 * x[0] - x[pad - i];
    out.set(x, pad);
    for (let i = 0; i < pad; i++) out[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i];
    return out;
}

/**
 * Zero-phase 2nd-order Butterworth, applied forward and backward.
 * `fcHz` is the EFFECTIVE cutoff; the correction above is applied internally,
 * so callers state what they want and get it.
 */
export function filtfilt(x, fcHz, fsHz, pad) {
    const n = x.length;
    if (n < 9) return Float64Array.from(x);
    const p = Math.min(n - 1, pad != null ? pad : Math.max(12, Math.round(n * 0.1)));
    const { b, a } = butter2LowpassCoeffs(designCutoff(fcHz), fsHz);
    const zi = lfilterZi(b, a);

    const padded = oddPad(Float64Array.from(x), p);

    /* forward */
    let y = lfilter(padded, b, a, [zi[0] * padded[0], zi[1] * padded[0]]);
    /* reverse, filter again, reverse back */
    y.reverse();
    y = lfilter(y, b, a, [zi[0] * y[0], zi[1] * y[0]]);
    y.reverse();

    return y.slice(p, p + n);
}

/**
 * Hampel filter: replace a sample by the local median when it lies more than
 * `nSigma` robust deviations from it.
 *
 * This runs BEFORE the low-pass, and the order matters. Pose estimators produce
 * single-frame left/right limb swaps — a genuine outlier, not noise. A low-pass
 * would smear one bad frame across its neighbours instead of removing it.
 *
 * Returns `{ y, replaced }`.
 */
export function hampel(x, window = HAMPEL_WINDOW, nSigma = HAMPEL_SIGMAS) {
    const n = x.length;
    const y = Float64Array.from(x);
    const half = Math.max(1, window >> 1);
    let replaced = 0;
    const buf = [];
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(x[i])) continue;
        buf.length = 0;
        const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
        for (let j = lo; j <= hi; j++) if (Number.isFinite(x[j])) buf.push(x[j]);
        if (buf.length < 3) continue;
        const m = median(buf);
        const s = mad(buf, m);
        if (s > 0 && Math.abs(x[i] - m) > nSigma * s) { y[i] = m; replaced++; }
    }
    return { y, replaced };
}

/**
 * Linear interpolation across gaps no longer than `maxGap` samples. Longer gaps
 * stay NaN: a metric that needs them will report itself unavailable rather than
 * quietly resting on invented data.
 */
export function fillGaps(x, maxGap = MAX_GAP_FRAMES) {
    const n = x.length;
    const y = Float64Array.from(x);
    let i = 0;
    while (i < n) {
        if (Number.isFinite(y[i])) { i++; continue; }
        let j = i;
        while (j < n && !Number.isFinite(y[j])) j++;
        const len = j - i;
        const hasLeft = i > 0, hasRight = j < n;
        if (hasLeft && hasRight && len <= maxGap) {
            const a = y[i - 1], b = y[j];
            for (let k = 0; k < len; k++) y[i + k] = a + (b - a) * (k + 1) / (len + 1);
        }
        i = j;
    }
    return y;
}

/**
 * Central-difference derivative, then re-filter at the same cutoff.
 * Never differentiate raw keypoints: differentiation multiplies noise by omega,
 * so an unfiltered derivative is dominated by whatever the pose estimator got
 * wrong on the previous frame.
 */
export function derivative(x, dtSec, fcHz, fsHz) {
    const n = x.length;
    const d = new Float64Array(n);
    if (n < 2) return d;
    d[0] = (x[1] - x[0]) / dtSec;
    d[n - 1] = (x[n - 1] - x[n - 2]) / dtSec;
    for (let i = 1; i < n - 1; i++) d[i] = (x[i + 1] - x[i - 1]) / (2 * dtSec);
    return fcHz && fsHz ? filtfilt(d, fcHz, fsHz) : d;
}

/** Fraction of samples that are not finite. */
export function missingFraction(x) {
    let miss = 0;
    for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) miss++;
    return x.length ? miss / x.length : 1;
}
