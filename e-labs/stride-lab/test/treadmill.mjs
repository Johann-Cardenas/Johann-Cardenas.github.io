import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { group, test, assert, assertEqual, assertThrows } from './harness.mjs';
import { auditTreadmill } from './treadmill-audit.mjs';

const review = JSON.parse(readFileSync(new URL('./fixtures/treadmill-review.json', import.meta.url)));
function validRecord() {
    const names = ['nose', 'shoulderL', 'shoulderR', 'hipL', 'hipR', 'ankleL', 'ankleR'], n = 363;
    const t = Float64Array.from({ length: n }, (_, f) => 0.466667 + f / 30);
    const xy = new Float64Array(n * names.length * 2), vis = new Float64Array(n * names.length).fill(1);
    for (let f = 0; f < n; f++) {
        const time = t[f], hip = 0.53 + 0.02 * Math.sin(time), swing = 0.24 * Math.sin(2 * Math.PI * 1.5 * time);
        const head = review.samples.reduce((best, s) => Math.abs(s.time - time) < Math.abs(best.time - time) ? s : best);
        const hx = (head.head[0] + head.head[2]) / 2, hy = (head.head[1] + head.head[3]) / 2;
        const points = [[hx, hy], [hip - 0.04, 0.3], [hip + 0.04, 0.3], [hip - 0.04, 0.44], [hip + 0.04, 0.44],
            [hip + swing, 0.68], [hip - swing, 0.68]];
        points.forEach((p, j) => xy.set(p, (f * names.length + j) * 2));
    }
    return { keypoints: { n, names, t, xy, vis }, capture: { sourceFrameCount: n },
        engine: { processing: { frames: n } }, metrics: { cadence: { combined: { value: 180 } } },
        model: { available: true, dof: 14, coverage: 1, residualPct: 6, residualP90Pct: 11 } };
}

export function treadmillTests() {
    group('Independent treadmill audit and mutation detection');
    test('review annotations are tied to the exact shipped video', () => {
        const bytes = readFileSync(new URL('../demo/treadmill-30fps.mp4', import.meta.url));
        assertEqual(createHash('sha256').update(bytes).digest('hex'), review.sha256);
    });
    test('independent audit accepts a moving runner and recovers its known cadence', () => {
        const report = auditTreadmill(validRecord(), review);
        assert(Math.abs(report.rawCadence - 180) < 1);
        assertEqual(report.anchors.filter(a => a.head && a.torso).length, 6);
    });
    const mutations = {
        'fully frozen tracking': r => { for (let f = 1; f < r.keypoints.n; f++) r.keypoints.xy.copyWithin(f * 14, 0, 14); },
        'a temporary frozen segment': r => { for (let f = 120; f < 150; f++) r.keypoints.xy.copyWithin(f * 14, 119 * 14, 120 * 14); },
        'moving torso hiding frozen legs': r => { for (let f = 0; f < r.keypoints.n; f++) { r.keypoints.xy[f * 14 + 10] = 0.4; r.keypoints.xy[f * 14 + 12] = 0.6; } },
        'one second of torso dropout': r => { for (let f = 90; f < 120; f++) r.keypoints.vis.fill(0, f * 7, f * 7 + 5); },
        'one second of visible-leg dropout': r => { for (let f = 90; f < 120; f++) r.keypoints.vis[f * 7 + 5] = 0; },
        'a confident nonfinite landmark': r => { r.keypoints.xy[70] = NaN; },
        'duplicate timestamps': r => { r.keypoints.t[100] = r.keypoints.t[99]; },
        'missing decoded frames': r => { r.keypoints.n -= 30; },
        'mirrored source coordinates': r => { for (let i = 0; i < r.keypoints.xy.length; i += 2) r.keypoints.xy[i] = 1 - r.keypoints.xy[i]; },
        'sideways source coordinates': r => { for (let i = 0; i < r.keypoints.xy.length; i += 2) [r.keypoints.xy[i], r.keypoints.xy[i + 1]] = [r.keypoints.xy[i + 1], r.keypoints.xy[i]]; },
        'a plausible but incorrect cadence': r => { r.metrics.cadence.combined.value = 199; },
        'a poor kinematic fit': r => { r.model.residualPct = 99; },
        'incorrect frame provenance': r => { r.engine.processing.frames++; },
        'duplicate landmark names': r => { r.keypoints.names[0] = 'hipL'; }
    };
    for (const [name, mutate] of Object.entries(mutations)) test(`audit rejects ${name}`, () => {
        const record = validRecord(); mutate(record);
        assertThrows(() => auditTreadmill(record, review));
    });
}
