import { group, test, assert, assertEqual, assertThrows } from './harness.mjs';
import { synthGait } from '../src/synth/gait.js';
import { CANONICAL } from '../src/engine/types.js';
import { playbackReliability, poseTrail } from '../src/ui/pose-reliability.js';
import { drawOverlay } from '../src/ui/overlay.js';

export function rotateLeg(series, from, count) {
    const K = CANONICAL.length, hip = CANONICAL.indexOf('hipL');
    for (let f = from; f < from + count; f++) {
        const hx = series.xy[(f * K + hip) * 2] * series.width, hy = series.xy[(f * K + hip) * 2 + 1] * series.height;
        for (const name of ['kneeL', 'ankleL', 'heelL', 'toeL']) {
            const offset = (f * K + CANONICAL.indexOf(name)) * 2;
            const x = series.xy[offset] * series.width - hx, y = series.xy[offset + 1] * series.height - hy;
            series.xy[offset] = (hx - y) / series.width; series.xy[offset + 1] = (hy + x) / series.height;
        }
    }
}

export function poseReliabilityTests() {
    group('Playback reliability without invented coordinates');
    const gait = () => synthGait({ fps: 30, durationS: 6, rigidLegs: true }).series;
    test('malformed buffer sizes are rejected before mask allocation', () => {
        const s = gait(); s.n = Number.MAX_SAFE_INTEGER;
        assertThrows(() => playbackReliability(s));
    });
    test('clean movement survives across frame rates and cadences', () => {
        for (const fps of [30, 60, 120, 240]) for (const cadenceSpm of [150, 210]) {
            const s = synthGait({ fps, cadenceSpm, durationS: 4, rigidLegs: true }).series;
            assertEqual(playbackReliability(s).mask.some(Boolean), false, `${fps} fps / ${cadenceSpm} spm`);
        }
    });
    test('a brief rigid-leg jump masks descendants, preserving raw observations', () => {
        const s = gait(); rotateLeg(s, 60, 2);
        const xy = Float64Array.from(s.xy), vis = Float64Array.from(s.vis), r = playbackReliability(s), K = CANONICAL.length;
        for (const f of [60, 61]) for (const name of ['kneeL', 'ankleL', 'heelL', 'toeL']) {
            const i = f * K + CANONICAL.indexOf(name); assertEqual(r.mask[i], 1); assertEqual(r.vis[i], 0);
        }
        assertEqual(r.sides.R.some(Boolean), false);
        assert(s.xy.every((v, i) => Object.is(v, xy[i]))); assert(s.vis.every((v, i) => Object.is(v, vis[i])));
    });
    test('camera translation cannot look like a relative leg jump', () => {
        const s = gait(), K = CANONICAL.length;
        for (let f = 60; f < 62; f++) for (let c = 0; c < K; c++) s.xy[(f * K + c) * 2] += 0.3;
        assertEqual(playbackReliability(s).mask.some(Boolean), false);
    });
    test('missing bracketing evidence is not treated as a measured return', () => {
        const s = gait(); rotateLeg(s, 60, 2);
        const K = CANONICAL.length, hip = CANONICAL.indexOf('hipL');
        for (let f = 58; f <= 59; f++) s.vis[f * K + hip] = 0;
        assertEqual(playbackReliability(s).sides.L[60], 0);
    });
    test('sustained postures are outside the brief-jump detector', () => {
        const s = gait(); rotateLeg(s, 60, 15);
        assertEqual(playbackReliability(s).mask.some(Boolean), false);
    });
    test('a camera gap cannot corroborate a return from a jump', () => {
        const s = synthGait({ fps: 60, durationS: 6, rigidLegs: true }).series;
        rotateLeg(s, 120, 2);
        for (let f = 122; f < s.n; f++) s.t[f] += 0.02;
        assertEqual(playbackReliability(s).sides.L[120], 0);
    });
    test('confidence masking leaves gaps in optional foot trails', () => {
        const s = gait(); rotateLeg(s, 60, 2); const r = playbackReliability(s);
        const pts = poseTrail({ ...s, vis: r.vis }, 'toeL', 59, 62);
        assert(Number.isFinite(pts[0])); assert(pts.slice(2, 6).every(Number.isNaN)); assert(Number.isFinite(pts[6]));
    });
    test('trail drawing starts a new path after missing samples', () => {
        const calls = [], ctx = new Proxy({}, { get: (_t, name) => ['moveTo', 'lineTo'].includes(name)
            ? (...args) => calls.push([name, ...args]) : () => {}, set: () => true });
        drawOverlay(ctx, { xy: new Float64Array(CANONICAL.length * 2).fill(NaN), vis: new Float64Array(CANONICAL.length),
            w: 100, h: 100, theme: { accent: '#fff' },
            layers: { skeleton: false, mechanics: false, phase: false, guides: false, angles: false, com: false, events: false, measures: false, readout: false, trails: true },
            trails: [{ side: 'L', pts: [0.1, 0.1, 0.2, 0.2, NaN, NaN, 0.5, 0.5, 0.6, 0.6] }] });
        assertEqual(JSON.stringify(calls), JSON.stringify([['moveTo', 10, 10], ['lineTo', 20, 20], ['moveTo', 50, 50], ['lineTo', 60, 60]]));
    });
}
