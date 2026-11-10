/* Robust local cubic trajectory model. Centered windows use both directions
 * of an already decoded clip; this is offline smoothing, not live prediction.
 * Missing samples split the trajectory, so an occlusion cannot become data.
 * Time is normalized to the window radius to keep the normal matrix stable. */
import { median } from '../types.js';

export function smoothTrajectory(values, times, { radius = 0.045 } = {}) {
    const out = Float64Array.from(values);
    const normal = Array.from({ length: 4 }, () => new Float64Array(5));
    let changed = 0;
    for (let start = 0; start < values.length;) {
        if (!Number.isFinite(values[start])) { start++; continue; }
        let end = start + 1;
        while (end < values.length && Number.isFinite(values[end])
            && times[end] > times[end - 1] && times[end] - times[end - 1] <= radius) end++;
        for (let f = start; f < end; f++) {
            // Leave boundaries unchanged: one-sided fits can distort contacts.
            if (times[f] - times[start] < radius || times[end - 1] - times[f] < radius) continue;
            const rows = [];
            for (let k = f; k >= start && times[f] - times[k] <= radius; k--)
                rows.push({ x: (times[k] - times[f]) / radius, y: values[k] });
            for (let k = f + 1; k < end && times[k] - times[f] <= radius; k++)
                rows.push({ x: (times[k] - times[f]) / radius, y: values[k] });
            if (rows.length < 7) continue;
            for (const r of rows) r.p = [1, r.x, r.x ** 2, r.x ** 3];
            let weights = rows.map(() => 1), beta;
            for (let pass = 0; pass < 3; pass++) {
                beta = fitCubic(rows, weights, normal);
                if (!beta) break;
                const residuals = rows.map(r => r.y - evaluate(beta, r.x));
                const center = median(residuals);
                const scale = Math.max(1e-9, 1.4826 * median(residuals.map(r => Math.abs(r - center))));
                weights = residuals.map(r => 1 / (1 + ((r - center) / (3 * scale)) ** 2));
            }
            if (beta && Number.isFinite(beta[0])) { out[f] = beta[0]; changed++; }
        }
        start = end;
    }
    return { values: out, changed };
}

const evaluate = (b, x) => b[0] + x * (b[1] + x * (b[2] + x * b[3]));

function fitCubic(rows, weights, a) {
    for (let i = 0; i < 4; i++) a[i].fill(0);
    for (let k = 0; k < rows.length; k++) {
        const r = rows[k], p = r.p;
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) a[i][j] += weights[k] * p[i] * p[j];
            a[i][4] += weights[k] * p[i] * r.y;
        }
    }
    for (let i = 0; i < 4; i++) {
        let pivot = i;
        for (let j = i + 1; j < 4; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
        [a[i], a[pivot]] = [a[pivot], a[i]];
        if (Math.abs(a[i][i]) < 1e-10) return null;
        const d = a[i][i];
        for (let k = i; k <= 4; k++) a[i][k] /= d;
        for (let j = 0; j < 4; j++) if (j !== i) {
            const m = a[j][i];
            for (let k = i; k <= 4; k++) a[j][k] -= m * a[i][k];
        }
    }
    return a.map(r => r[4]);
}
