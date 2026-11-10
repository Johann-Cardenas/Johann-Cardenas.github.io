import { CANONICAL, median } from '../engine/types.js';

// Offline playback can inspect both sides of a short excursion. Reject only
// a rapid departure AND return with a large deviation from the endpoint chord.
// This is a display confidence mask, not a corrected trajectory or measurement.
export function playbackReliability(series) {
    const K = CANONICAL.length, { n, t, xy, vis, width, height } = series;
    if (!Number.isSafeInteger(n) || n < 0 || t?.length !== n || xy?.length !== n * K * 2 || vis?.length !== n * K
        || !(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
        throw new RangeError('Invalid playback pose buffers.');
    }
    const mask = new Uint8Array(n * K), sides = { L: new Uint8Array(n), R: new Uint8Array(n) };
    const idx = name => CANONICAL.indexOf(name);
    const intervals = [];
    for (let f = 1; f < n; f++) if (t[f] > t[f - 1]) intervals.push(t[f] - t[f - 1]);
    const maxStep = 1.5 * median(intervals);
    for (const side of ['L', 'R']) {
        if (!(maxStep > 0)) break;
        const hip = idx('hip' + side), knee = idx('knee' + side), ankle = idx('ankle' + side);
        const valid = (f, c) => vis[f * K + c] >= 0.5 && Number.isFinite(xy[(f * K + c) * 2]) && Number.isFinite(xy[(f * K + c) * 2 + 1]);
        const point = (f, c) => [xy[(f * K + c) * 2] * width, xy[(f * K + c) * 2 + 1] * height];
        const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const lengths = [], p = new Array(n);
        for (let f = 0; f < n; f++) {
            if (!valid(f, hip) || !valid(f, knee)) continue;
            const h = point(f, hip), k = point(f, knee);
            p[f] = [k[0] - h[0], k[1] - h[1]];
            if (valid(f, ankle)) lengths.push(distance(h, k) + distance(k, point(f, ankle)));
        }
        const leg = median(lengths);
        if (lengths.length < 12 || !(leg > 0)) continue;
        for (let start = 1; start < n - 1; start++) {
            if (!p[start - 1] || !p[start] || !(t[start] > t[start - 1]) || t[start] - t[start - 1] > maxStep) continue;
            if (distance(p[start], p[start - 1]) / (t[start] - t[start - 1]) <= 8 * leg) continue;
            for (let end = start + 1; end < n && t[end] - t[start - 1] <= 0.12; end++) {
                if (!p[end] || !(t[end] > t[end - 1]) || t[end] - t[end - 1] > maxStep) break;
                if (distance(p[end], p[end - 1]) / (t[end] - t[end - 1]) <= 8 * leg) continue;
                const span = t[end] - t[start - 1];
                if (span < 0.05 || distance(p[end], p[start - 1]) / span > 4 * leg) continue;
                let displaced = true;
                for (let f = start; f < end; f++) {
                    const a = (t[f] - t[start - 1]) / span;
                    const expected = p[end].map((v, j) => p[start - 1][j] + (v - p[start - 1][j]) * a);
                    if (distance(p[f], expected) <= 0.2 * leg) { displaced = false; break; }
                }
                if (!displaced) continue;
                for (let f = start; f < end; f++) {
                    sides[side][f] = 1;
                    for (const name of ['knee', 'ankle', 'heel', 'toe', 'footOuter']) {
                        const c = idx(name + side); if (c >= 0) mask[f * K + c] = 1;
                    }
                }
                break;
            }
        }
    }
    return { mask, sides, vis: Float64Array.from(vis, (v, i) => mask[i] ? 0 : v) };
}

export function poseTrail(series, name, from, to) {
    const K = CANONICAL.length, c = CANONICAL.indexOf(name), pts = [];
    for (let f = Math.max(0, from); f <= Math.min(to, series.n - 1); f++) {
        const offset = (f * K + c) * 2;
        const valid = c >= 0 && series.vis[f * K + c] >= 0.5;
        pts.push(valid ? series.xy[offset] : NaN, valid ? series.xy[offset + 1] : NaN);
    }
    return pts;
}
