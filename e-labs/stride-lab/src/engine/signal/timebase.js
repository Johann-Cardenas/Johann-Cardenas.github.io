import { CANONICAL, MAX_GAP_FRAMES, VISIBILITY_GATE } from '../types.js';

export const MAX_ANALYSIS_FRAMES = 120000;

export function validateInput(series, opts) {
    const K = CANONICAL.length;
    if (series?.n > MAX_ANALYSIS_FRAMES)
        return { code: 'analysis-limit', message: `Analysis is limited to ${MAX_ANALYSIS_FRAMES} pose frames. Trim the clip before analyzing it.` };
    if (!series || !Number.isSafeInteger(series.n) || series.n < 2 || series.n > MAX_ANALYSIS_FRAMES
        || !Number.isFinite(series.width) || series.width <= 0
        || !Number.isFinite(series.height) || series.height <= 0
        || series.t?.length !== series.n || series.xy?.length !== series.n * K * 2
        || series.vis?.length !== series.n * K
        || (series.names && (!Array.isArray(series.names) || series.names.length !== K || series.names.some((name, i) => name !== CANONICAL[i])))) {
        return { code: 'invalid-series', message: 'The pose data has invalid dimensions, landmark order or buffer lengths.' };
    }
    for (let f = 0; f < series.n; f++) {
        if (!Number.isFinite(series.t[f]) || (f > 0 && !(series.t[f] > series.t[f - 1])))
            return { code: 'no-timebase', message: 'Frame timestamps must be finite and strictly increasing.' };
    }
    if (!opts || !Number.isFinite(opts.heightM) || opts.heightM <= 0
        || (opts.massKg != null && (!Number.isFinite(opts.massKg) || opts.massKg <= 0))
        || (opts.speedMs != null && (!Number.isFinite(opts.speedMs) || opts.speedMs <= 0))) {
        return { code: 'invalid-calibration', message: 'Height, and any supplied mass or running speed, must be finite positive values.' };
    }
    return null;
}

// Uniform sampling is required by the Butterworth filters, finite differences
// and spectral event detector. Interpolate on actual presentation timestamps,
// never by frame index. Long camera gaps stay missing; no extrapolation.
export function uniformTimebase(series, fps) {
    const dt = 1 / fps, K = CANONICAL.length;
    let irregular = false;
    for (let i = 1; i < series.n; i++) {
        if (Math.abs(series.t[i] - series.t[i - 1] - dt) > dt * 1e-3) { irregular = true; break; }
    }
    if (!irregular) return { series, resampled: false };
    const start = series.t[0], span = series.t[series.n - 1] - start;
    const n = Math.floor(span * fps + 1e-7) + 1;
    if (!Number.isSafeInteger(n) || n > MAX_ANALYSIS_FRAMES || n > 4 * series.n)
        return { error: 'The clip has too much missing time to reconstruct a reliable sampling grid.' };
    const t = new Float64Array(n), xy = new Float64Array(n * K * 2).fill(NaN), vis = new Float64Array(n * K);
    let left = 0;
    for (let f = 0; f < n; f++) {
        const time = start + f * dt;
        t[f] = time;
        while (left + 1 < series.n && series.t[left + 1] < time - dt * 1e-7) left++;
        let a = left, b = Math.min(left + 1, series.n - 1);
        if (Math.abs(series.t[a] - time) < dt * 1e-7) b = a;
        else if (Math.abs(series.t[b] - time) < dt * 1e-7) a = b;
        if (a !== b && series.t[b] - series.t[a] > (MAX_GAP_FRAMES + 1.01) * dt) continue;
        const alpha = a === b ? 0 : (time - series.t[a]) / (series.t[b] - series.t[a]);
        for (let k = 0; k < K; k++) {
            const ia = a * K + k, ib = b * K + k, io = f * K + k;
            const confidence = Math.min(series.vis[ia], series.vis[ib]);
            if (!Number.isFinite(confidence) || confidence < VISIBILITY_GATE) continue;
            const ax = series.xy[ia * 2], ay = series.xy[ia * 2 + 1];
            const bx = series.xy[ib * 2], by = series.xy[ib * 2 + 1];
            if (![ax, ay, bx, by].every(Number.isFinite)) continue;
            xy[io * 2] = ax + alpha * (bx - ax);
            xy[io * 2 + 1] = ay + alpha * (by - ay);
            vis[io] = Math.min(1, confidence);
        }
    }
    return { series: { ...series, n, t, xy, vis }, resampled: true };
}
