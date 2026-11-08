import { group, test, assert, assertClose, assertEqual } from './harness.mjs';
import { runPipeline } from '../src/engine/analyze.js';
import { synthGait } from '../src/synth/gait.js';
import { condition } from '../src/engine/signal/condition.js';
import { uniformTimebase } from '../src/engine/signal/timebase.js';
import { filtfiltFinite, derivativeFinite } from '../src/engine/signal/filter.js';
import { fitKinematicModel } from '../src/engine/model/kinematic.js';
import { energyCurves, workOver } from '../src/engine/model/energetics.js';
import { CANONICAL, sampleAt } from '../src/engine/types.js';
import { computeMetrics } from '../src/engine/metrics/compute.js';
import { graphicsSupport } from '../src/engine/pose/mediapipe.js';

export function robustnessTests() {
    group('Engine adversarial audit');
    const options = { heightM: 1.75, surface: 'treadmill', speedMs: 3 };
    const base = synthGait({ fps: 120, durationS: 4, seed: 31, rigidLegs: true }).series;
    test('malformed pose buffers and landmark order fail before processing', () => {
        const variants = [null, {}, { ...base, n: -1 }, { ...base, n: 2.5 },
            { ...base, width: Infinity }, { ...base, height: 0 },
            { ...base, xy: base.xy.slice(1) }, { ...base, vis: [] },
            { ...base, names: [...CANONICAL].reverse() }];
        for (const s of variants) assertEqual(runPipeline(s, options).code, 'invalid-series');
    });
    test('duplicate, backward and non-finite timestamps are rejected', () => {
        for (const value of [NaN, Infinity, base.t[49], base.t[49] - 1]) {
            const t = Float64Array.from(base.t); t[50] = value;
            assertEqual(runPipeline({ ...base, t }, options).code, 'no-timebase');
        }
    });
    test('invalid calibration and unstable filter cutoffs are rejected', () => {
        for (const heightM of [0, -1, NaN, Infinity]) assertEqual(runPipeline(base, { ...options, heightM }).code, 'invalid-calibration');
        for (const speedMs of [0, -1, Infinity]) assertEqual(runPipeline(base, { ...options, speedMs }).code, 'invalid-calibration');
        for (const cutoffHz of [-1, 0, 60, Infinity, NaN]) assertEqual(runPipeline(base, { ...options, cutoffHz }).code, 'invalid-cutoff');
    });
    test('claimed metadata cannot promote a 30 fps recording to high precision', () => {
        const s = synthGait({ fps: 30, durationS: 6 }).series;
        const r = runPipeline(s, { ...options, fps: 240 });
        assert(r.ok, r.message);
        assertEqual(r.capture.fps, 30);
        assertEqual(r.metrics.gct.sides.L.value, null);
        assert(r.warnings.some(w => w.code === 'fps-metadata-mismatch'));
    });
    test('resampling uses presentation time and preserves affine trajectories', () => {
        const t = base.t.map((v, i) => v + (i % 2 ? 0.001 : 0));
        const xy = Float64Array.from(base.xy);
        for (let f = 0; f < base.n; f++) xy[f * CANONICAL.length * 2] = 0.2 + 0.01 * t[f];
        const res = uniformTimebase({ ...base, t, xy }, 120);
        assert(res.resampled);
        for (let f = 0; f < res.series.n; f++) {
            assertClose(res.series.xy[f * CANONICAL.length * 2], 0.2 + 0.01 * res.series.t[f], 1e-12);
            if (f) assertClose(res.series.t[f] - res.series.t[f - 1], 1 / 120, 1e-12);
        }
    });
    test('long camera gaps remain missing and pathological expansion is bounded', () => {
        const t = base.t.map((v, i) => v + (i >= 120 ? 0.5 : 0));
        const res = uniformTimebase({ ...base, t }, 120);
        assert(res.resampled);
        const f = res.series.t.findIndex(time => time >= 1.2);
        assert(Number.isNaN(res.series.xy[f * CANONICAL.length * 2]));
        assertEqual(res.series.vis[f * CANONICAL.length], 0);
        const extreme = Float64Array.from(base.t); extreme[extreme.length - 1] += 100000;
        assert(uniformTimebase({ ...base, t: extreme }, 120).error);
    });
    test('sampling never borrows a neighboring observation for a missing event', () => {
        assert(Number.isNaN(sampleAt([1, NaN, 3], 1)));
        assert(Number.isNaN(sampleAt([1, NaN, 3], 0.5)));
        assert(Number.isNaN(sampleAt([1, NaN, 3], 1.5)));
        assertEqual(sampleAt([1, NaN, 3], 0), 1);
        assertEqual(sampleAt([1, NaN, 3], 2), 3);
    });
    test('long gaps isolate filtering and eliminate reacquisition velocity spikes', () => {
        const x = new Float64Array(200).fill(1);
        x.fill(NaN, 80, 100); x.fill(100, 100);
        const filtered = filtfiltFinite(x, 12, 120);
        const velocity = derivativeFinite(x, 1 / 120, 12, 120);
        for (let f = 0; f < x.length; f++) {
            if (f >= 80 && f < 100) { assert(Number.isNaN(filtered[f])); assert(Number.isNaN(velocity[f])); }
            else { assertClose(filtered[f], x[f], 1e-9); assertClose(velocity[f], 0, 1e-9); }
        }
    });
    test('an occluded parent masks descendant measurements and mechanical work', () => {
        const c = condition(base, { fps: 120 });
        for (let f = 100; f < 140; f++) for (const name of ['shoulderL', 'shoulderR', 'shoulderMid'])
            c.kp[name].x[f] = c.kp[name].y[f] = NaN;
        const m = fitKinematicModel(c, { temporal: true });
        assert(m.available);
        assert(Number.isFinite(m.tracks.ankleL.x[120]), 'display can retain a connected skeleton');
        assert(Number.isNaN(m.measurementTracks.ankleL.x[120]), 'measurements cannot use the held parent');
        assert(Number.isNaN(m.angles.L.kneeFlex[120]));
        const e = energyCurves(m, c, 0.003, { groundVxMs: 3 });
        assert(e);
        assert(Number.isNaN(e.Ev[120]));
        assert(Number.isNaN(workOver(e, 95, 145).internal.total));
    });
    test('analysis does not mutate source visibility while gating bad anatomy', () => {
        const xy = Float64Array.from(base.xy), vis = Float64Array.from(base.vis);
        const knee = CANONICAL.indexOf('kneeL');
        for (let f = 100; f < 120; f++) xy[(f * CANONICAL.length + knee) * 2] += 0.5;
        const s = { ...base, xy, vis }, snapshot = Float64Array.from(vis);
        runPipeline(s, options);
        for (let i = 0; i < vis.length; i++) assertEqual(vis[i], snapshot[i]);
    });
    test('temporal reconstruction cannot hide large local observation errors', () => {
        const c = condition(synthGait({ fps: 120, durationS: 4, seed: 41, rigidLegs: true, noiseFrac: 0.04 }).series, { fps: 120 });
        const original = fitKinematicModel(c, { temporal: false });
        const temporal = fitKinematicModel(c, { temporal: true });
        assert(temporal.temporal.changed > 0);
        for (let f = 0; f < c.n; f++) {
            const limit = Math.max(1.1 * original.residualPx[f], original.residualPx[f] + 0.002 * original.geom.legPx);
            assert(temporal.residualPx[f] <= limit + 1e-8, `observation fit at frame ${f}`);
        }
    });
    test('a resampled grid cannot promote irregular observations to precise timing', () => {
        const s = synthGait({ fps: 60, durationS: 6 }).series;
        const t = new Float64Array(s.n);
        for (let i = 1; i < s.n; i++) t[i] = t[i - 1] + [0.75, 1, 1.25][i % 3] / 60;
        const r = runPipeline({ ...s, t }, options);
        assert(r.ok, r.message);
        assert(r.capture.timebaseResampled);
        assertClose(r.capture.fps, 60, 1e-8);
        assertClose(r.capture.observationFps, 48, 1e-8);
        assertEqual(r.metrics.gct.sides.L.value, null);
        assertEqual(r.series.n, r._internal.cond.n);
        assertEqual(r.series.t, r._internal.cond.t);
    });
    test('local missing landmarks cannot hide behind good clip-wide coverage', () => {
        const r = runPipeline(base, options);
        assert(r.ok);
        const original = r.movementSamples.find(sample => sample.side === 'L' && Number.isFinite(sample.values.kneeFlexionContact));
        assert(original);
        const c = condition(base, { fps: 120 });
        for (let f = original.i0 + 4; f < original.i1 - 4; f++) c.kp.kneeL.x[f] = c.kp.kneeL.y[f] = NaN;
        const computed = computeMetrics(c, r._internal.scale, r.events, { ...options, view: 'sagittal', spatialFromDisplacement: false });
        const sample = computed.samples.find(s => s.side === 'L' && s.end === original.end);
        assert(sample);
        assertEqual(sample.values.kneeFlexionContact, undefined);
    });
    test('software graphics selects CPU without confusing it with hardware acceleration', () => {
        const previous = globalThis.OffscreenCanvas;
        try {
            for (const [renderer, software] of [['ANGLE SwiftShader', true], ['llvmpipe', true], ['NVIDIA hardware renderer', false]]) {
                globalThis.OffscreenCanvas = class { getContext() { return {
                    RENDERER: 0, getExtension: name => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : null,
                    getParameter: () => renderer
                }; } };
                assertEqual(graphicsSupport().software, software);
            }
            globalThis.OffscreenCanvas = class { getContext() { return null; } };
            assertEqual(graphicsSupport().available, false);
        } finally {
            if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous;
        }
    });
}
