/* ============================================================
   Stride Lab — validation suite
   ------------------------------------------------------------
   Run with:  node test/run.mjs      (or: npm test)

   The engine is pure, so it can be tested hard, and it is the only
   part of this app where being wrong is invisible: a plausible
   ground-contact time computed from a mirrored coordinate frame
   looks exactly like a correct one. Everything below exists to make
   that class of error impossible to ship quietly.

   Covers, per the build specification section 13:
     - filter design, including the forward-backward cutoff
       correction that is routinely got wrong
     - the coordinate-convention regression test: a runner leaning
       forward must produce a POSITIVE trunk lean
     - gait-event detection against a synthetic runner with known
       events, across frame rates AND across strike patterns
     - every metric recovered from ground truth it was told to have
     - mirror invariance: a right-to-left clip must produce the same
       numbers as a left-to-right one
     - suppression rules, confidence propagation, error budget
     - data integrity: every normative band resolves to a reference,
       every rule resolves to real exercises
   ============================================================ */

import {
    group, test, note, assert, assertClose, assertEqual, assertBetween, assertThrows, summary
} from './harness.mjs';

import {
    signedAngle, interiorAngle, median, mad, mean, sd, trimmedMean, weightedMedian,
    asymmetryIndex, clamp, weakest, atLeast, CANONICAL, WINTER, sampleAt, indexAtTime,
    OPTIONAL_KEYPOINTS, SEGMENTS, SEGMENT_FALLBACK, G
} from '../src/engine/types.js';
import {
    butter2LowpassCoeffs, filtfilt, lfilter, lfilterZi, hampel, fillGaps, derivative,
    FILTFILT_CUTOFF_CORRECTION, designCutoff, missingFraction
} from '../src/engine/signal/filter.js';
import { localMinima, localMaxima, zeroCrossings, plateauOnset, range, dominantFrequency } from '../src/engine/signal/peaks.js';
import { condition } from '../src/engine/signal/condition.js';
import { adaptFrame, makeSeries, BLAZEPOSE_33, HALPE_26, kp, backendCoverage } from '../src/engine/pose/skeleton.js';
import { travelDirection, classifyView, perFrameScale } from '../src/engine/calib/scale.js';
import { detectEvents, intervalUncertaintyMs, instantUncertaintyMs, STRIKE_METHODS, TOEOFF_METHODS } from '../src/engine/events/detect.js';
import { trunkLeanSeries, footAngleSeries, shankAngleSeries, upperArmAngleSeries } from '../src/engine/metrics/angles.js';
import { METRICS, METRIC_BY_ID, DIMENSIONS, SYMMETRY_SOURCES } from '../src/engine/metrics/catalog.js';
import { classifyStrike } from '../src/engine/metrics/compute.js';
import { bodyCoM, springMassStiffness } from '../src/engine/metrics/com.js';
import { NORMS, bandFor, STRENGTH_WEIGHT } from '../src/engine/scoring/norms.js';
import { REFERENCES, REFERENCE_BY_ID } from '../src/engine/scoring/references.js';
import { scoreValue, bandStatus, scoreAnalysis } from '../src/engine/scoring/score.js';
import { RULES, MAX_FINDINGS, recommend } from '../src/engine/recommend/rules.js';
import { EXERCISES, EXERCISE_BY_ID } from '../src/engine/recommend/exercises.js';
import { parseMp4, displaySize, measuredFps } from '../src/engine/decode/mp4.js';
import { gateImplausibleSegments, frameIsWorldFixed, LENGTH_TOLERANCE } from '../src/engine/pose/plausible.js';
import { runPipeline, gaitCycleCurves } from '../src/engine/analyze.js';
import { synthGait, DEFAULTS, rng, STANCE_ALIGN_FRACTION } from '../src/synth/gait.js';
import { ENGINE_VERSION } from '../src/engine/version.js';

/* ============================================================
   1. Statistics and geometry primitives
   ============================================================ */

group('Primitives — statistics');

test('median handles odd, even and non-finite entries', () => {
    assertEqual(median([3, 1, 2]), 2);
    assertEqual(median([4, 1, 2, 3]), 2.5);
    assertEqual(median([1, NaN, 3]), 2);
    assert(Number.isNaN(median([NaN, NaN])), 'all-NaN gives NaN');
});

test('mad is a consistent sigma estimate for normal data', () => {
    const u = rng(7);
    const x = [];
    for (let i = 0; i < 20000; i++) {
        const a = Math.max(1e-12, u());
        x.push(Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()) * 3);
    }
    assertClose(mad(x), 3, 0.12, 'MAD of sigma=3 normal data');
});

test('trimmed mean removes the tails but never empties the set', () => {
    assertClose(trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1), 5.5, 1e-9, '10% trim of one outlier');
    assertClose(trimmedMean([5, 7], 0.1), 6, 1e-9, 'two samples still return a value');
});

test('weighted median is dragged by weight, not by count', () => {
    assertEqual(weightedMedian([1, 2, 100], [1, 1, 1]), 2);
    assertEqual(weightedMedian([1, 2, 100], [1, 1, 10]), 100);
});

test('asymmetry index is symmetric and zero for equal sides', () => {
    assertEqual(asymmetryIndex(10, 10), 0);
    assertClose(asymmetryIndex(9, 11), 20, 1e-9, '200|L-R|/(L+R)');
    assertEqual(asymmetryIndex(9, 11), asymmetryIndex(11, 9));
});

test('confidence ordering helpers', () => {
    assertEqual(weakest('high', 'low', 'medium'), 'low');
    assert(atLeast('medium', 'medium'), 'medium is at least medium');
    assert(!atLeast('low', 'medium'), 'low is not at least medium');
});

group('Primitives — geometry');

test('signedAngle is CCW positive and antisymmetric', () => {
    assertClose(signedAngle({ x: 1, y: 0 }, { x: 0, y: 1 }), 90, 1e-9, 'x to y');
    assertClose(signedAngle({ x: 0, y: 1 }, { x: 1, y: 0 }), -90, 1e-9, 'y to x');
    assertClose(signedAngle({ x: 1, y: 0 }, { x: 1, y: 0 }), 0, 1e-9, 'identity');
    assertClose(Math.abs(signedAngle({ x: 1, y: 0 }, { x: -1, y: 0 })), 180, 1e-9, 'opposite');
});

test('interiorAngle is unsigned and in [0,180]', () => {
    assertClose(interiorAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90, 1e-9, 'right angle');
    assertClose(interiorAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180, 1e-9, 'straight');
    assert(Number.isNaN(interiorAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 'degenerate is NaN');
});

/* ============================================================
   2. Filtering — the part that is routinely got wrong
   ============================================================ */

group('Signal — Butterworth and filtfilt');

test('the dual-pass cutoff correction is (sqrt(2)-1)^(1/4)', () => {
    assertClose(FILTFILT_CUTOFF_CORRECTION, 0.802, 0.001, 'C for n=2 passes, order=2');
    assertClose(designCutoff(12), 12 / 0.8022, 0.02, 'design cutoff for a 12 Hz effective cutoff');
    assertClose(designCutoff(12), 14.96, 0.05, '12 Hz effective at 240 fps designs at ~14.96 Hz');
});

test('butter2 coefficients are normalised and stable', () => {
    const { b, a } = butter2LowpassCoeffs(12, 240);
    assertEqual(a[0], 1, 'a0 normalised');
    /* DC gain must be exactly 1 for a low-pass */
    assertClose((b[0] + b[1] + b[2]) / (a[0] + a[1] + a[2]), 1, 1e-12, 'DC gain');
    /* poles inside the unit circle: |a2| < 1 and |a1| < 1 + a2 */
    assert(Math.abs(a[2]) < 1, 'stable');
    assert(Math.abs(a[1]) < 1 + a[2], 'stable');
});

test('lfilterZi settles a constant input immediately', () => {
    const { b, a } = butter2LowpassCoeffs(12, 240);
    const zi = lfilterZi(b, a);
    const x = new Float64Array(50).fill(5);
    const y = lfilter(x, b, a, [zi[0] * 5, zi[1] * 5]);
    for (let i = 0; i < y.length; i++) assertClose(y[i], 5, 1e-9, `constant input, sample ${i}`);
});

test('filtfilt: 2 Hz preserved to within 1%, 30 Hz attenuated below 5%', () => {
    /* The specification's own acceptance test, at 240 fps through a 12 Hz
       EFFECTIVE cutoff. The two components are measured on their own as well
       as in sum: peak amplitude of the filtered SUM is not a clean measure of
       the 2 Hz gain, because whatever survives of the 30 Hz term adds to it. */
    const fs = 240, n = 2400;
    const mk = (f) => {
        const x = new Float64Array(n);
        for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / fs);
        return x;
    };
    const amp = (y) => {
        let m = 0;
        for (let i = 300; i < n - 300; i++) m = Math.max(m, Math.abs(y[i]));
        return m;
    };
    const gain2 = amp(filtfilt(mk(2), 12, fs));
    const gain30 = amp(filtfilt(mk(30), 12, fs));
    assertClose(gain2, 1, 0.01, '2 Hz passes through untouched');
    assert(gain30 < 0.05, `30 Hz must be attenuated below 5%, got ${gain30.toFixed(4)}`);

    /* And the filter must superpose: filtering the SUM has to give the same
       answer as filtering the parts. The bound is the 30 Hz leakage plus the
       2 Hz gain error and cannot be tighter than that, so it is stated in
       terms of them rather than as a second, accidentally stricter, 5%. */
    const sum = new Float64Array(n);
    const pure2 = mk(2);
    const pure30 = mk(30);
    for (let i = 0; i < n; i++) sum[i] = pure2[i] + pure30[i];
    const y = filtfilt(sum, 12, fs);
    let maxErr = 0;
    for (let i = 300; i < n - 300; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - pure2[i]));
    const bound = gain30 + Math.abs(gain2 - 1) + 1e-3;
    assert(maxErr <= bound,
        `worst reconstruction error ${maxErr.toFixed(4)} must not exceed the leakage bound ${bound.toFixed(4)}`);
    note(`2 Hz gain ${gain2.toFixed(4)}, 30 Hz gain ${gain30.toFixed(4)}, worst residual ${maxErr.toFixed(4)}`);
});

test('filtfilt is ZERO PHASE — no sample of lag', () => {
    /* Phase lag is disqualifying: it shifts every gait event by the same
       amount, so the bias survives averaging over any number of strides. */
    const fs = 240, n = 2400;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 2 * i / fs);
    const y = filtfilt(x, 12, fs);
    /* cross-correlate at lags -3..3 and require the peak to be at zero */
    let bestLag = 99, best = -Infinity;
    for (let lag = -3; lag <= 3; lag++) {
        let s = 0;
        for (let i = 300; i < n - 300; i++) s += x[i] * y[i + lag];
        if (s > best) { best = s; bestLag = lag; }
    }
    assertEqual(bestLag, 0, 'peak cross-correlation lag');

    /* and the causal single pass must NOT be zero phase, or the test above
       proves nothing about filtfilt */
    const { b, a } = butter2LowpassCoeffs(12, fs);
    const single = lfilter(x, b, a);
    let bl = 99, bs = -Infinity;
    for (let lag = -6; lag <= 6; lag++) {
        let s = 0;
        for (let i = 300; i < n - 300; i++) s += x[i] * single[i + lag];
        if (s > bs) { bs = s; bl = lag; }
    }
    assert(bl !== 0, `a single causal pass must lag; measured ${bl} samples`);
    note(`single causal pass lags by ${bl} samples; filtfilt by ${bestLag}`);
});

test('hampel removes single-sample spikes without touching the signal', () => {
    const n = 200;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(i / 10);
    const clean = Float64Array.from(x);
    x[50] = 40; x[120] = -40;          /* the limb-swap flips a low-pass would smear */
    const { y, replaced } = hampel(x);
    assert(replaced >= 2, `expected at least the two spikes replaced, got ${replaced}`);
    assertClose(y[50], clean[50], 0.2, 'spike replaced by the local median');
    assertClose(y[120], clean[120], 0.2, 'spike replaced by the local median');
    let worst = 0;
    for (let i = 5; i < n - 5; i++) if (i !== 50 && i !== 120) worst = Math.max(worst, Math.abs(y[i] - clean[i]));
    assert(worst < 0.05, `untouched samples must stay put; worst drift ${worst}`);
});

test('gap fill bridges short gaps and refuses long ones', () => {
    const x = Float64Array.from([1, 2, NaN, 4, 5, NaN, NaN, NaN, NaN, NaN, 11]);
    const y = fillGaps(x, 3);
    assertClose(y[2], 3, 1e-9, 'a one-sample gap is interpolated');
    for (let i = 5; i <= 9; i++) assert(!Number.isFinite(y[i]), `a five-sample gap must stay missing at ${i}`);
});

test('derivative of a sine is its cosine, at the right amplitude', () => {
    const fs = 240, n = 1200, f = 2;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / fs);
    const d = derivative(x, 1 / fs, 12, fs);
    const expect = 2 * Math.PI * f;
    let amp = 0;
    for (let i = 200; i < n - 200; i++) amp = Math.max(amp, Math.abs(d[i]));
    assertClose(amp, expect, expect * 0.01, 'derivative amplitude 2*pi*f');
});

group('Signal — extrema, plateaus and the FFT cross-check');

test('localMinima refines to sub-frame with a parabola', () => {
    const n = 100;
    const x = new Float64Array(n);
    /* minimum deliberately placed at 50.5 so an integer answer is wrong */
    for (let i = 0; i < n; i++) x[i] = (i - 50.5) * (i - 50.5);
    const m = localMinima(x, 1);
    assertEqual(m.length, 1, 'exactly one minimum');
    assertClose(m[0].index, 50.5, 0.01, 'sub-frame minimum');
});

test('plateauOnset finds the START of a flat bottom, not its end', () => {
    /* This is the difference between detecting foot contact and detecting the
       moment the foot leaves the ground, and it is worth a whole test. */
    const n = 120;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = i < 40 ? (40 - i) : i > 80 ? (i - 80) : 0;
    const m = localMinima(x, 1);
    assert(m.length >= 1, 'a minimum exists');
    const naive = m[0].index;
    const onset = plateauOnset(x, naive, 0.02 * range(x), 60);
    assert(naive > 60, `the naive minimum lands late in the plateau, got ${naive}`);
    assertClose(onset, 40, 1.5, 'plateau onset is where the descent stopped');
});

test('zeroCrossings interpolate the crossing linearly', () => {
    const x = Float64Array.from([-2, -1, 1, 2]);
    const z = zeroCrossings(x, 'up');
    assertEqual(z.length, 1, 'one upward crossing');
    assertClose(z[0].index, 1.5, 1e-9, 'crossing halfway between samples 1 and 2');
});

test('dominantFrequency recovers a known frequency through a trend', () => {
    const fs = 240, n = 1440, f = 2.8;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / fs) + 0.02 * i;
    const d = dominantFrequency(x, fs, 1.0, 3.6);
    assertClose(d.freq, f, 0.03, 'dominant frequency, with the linear trend removed');
    assert(d.snr > 5, `peak must stand out; snr ${d.snr.toFixed(1)}`);
});

/* ============================================================
   3. Coordinate conventions — the most damaging class of bug
   ============================================================ */

group('Conventions');

test('both backends cover the shared skeleton, and differ only where expected', () => {
    const core = CANONICAL.filter(n => !OPTIONAL_KEYPOINTS.includes(n));
    for (const name of core) {
        assert(BLAZEPOSE_33[name] != null, `BlazePose must define ${name}`);
        assert(HALPE_26[name] != null, `Halpe-26 must define ${name}`);
    }
    /* the reason BlazePose is the default: it has heel and toe */
    assertEqual(BLAZEPOSE_33.heelL, 29);
    assertEqual(BLAZEPOSE_33.toeR, 32);

    const bp = backendCoverage('mediapipe-blazepose');
    const hp = backendCoverage('rtmpose-halpe26');
    /* BlazePose has hands and no lateral forefoot; Halpe-26 is the reverse.
       That asymmetry is the whole reason the adapter exists, and the metrics
       that depend on either report themselves unavailable rather than
       approximating. */
    assert(bp.includes('handL') && bp.includes('handR'), 'BlazePose supplies a hand centroid');
    assert(!bp.includes('footOuterL'), 'BlazePose has no lateral forefoot landmark');
    assert(hp.includes('footOuterL') && hp.includes('footOuterR'), 'Halpe-26 supplies a lateral forefoot');
    assert(bp.length >= 19, `BlazePose should cover most of the skeleton, covers ${bp.length}`);
    assertThrows(() => kp('elbowMiddle'), 'unknown keypoint names must throw, not return -1');
    note(`BlazePose covers ${bp.length} of ${CANONICAL.length}, Halpe-26 covers ${hp.length}`);
});

test('adaptFrame re-indexes a raw frame onto canonical order', () => {
    const K = 33;
    const rawXY = new Float64Array(K * 2);
    const rawVis = new Float64Array(K).fill(0.9);
    rawXY[29 * 2] = 0.11; rawXY[29 * 2 + 1] = 0.22;   /* left heel */
    const outXY = new Float64Array(CANONICAL.length * 2);
    const outVis = new Float64Array(CANONICAL.length);
    adaptFrame(rawXY, rawVis, 'mediapipe-blazepose', outXY, outVis);
    const i = CANONICAL.indexOf('heelL');
    assertClose(outXY[i * 2], 0.11, 1e-12, 'heel x carried across');
    assertClose(outXY[i * 2 + 1], 0.22, 1e-12, 'heel y carried across');
    assertThrows(() => adaptFrame(rawXY, rawVis, 'nope', outXY, outVis), 'unknown backend');
});

test('REGRESSION: y is flipped to point UP during conditioning', () => {
    /* MediaPipe hands back y increasing DOWNWARD. If the flip is ever dropped,
       every angle in the report mirrors, plausibly and silently. */
    const s = makeSeries(4, 1000, 800);
    const K = CANONICAL.length;
    for (let f = 0; f < 4; f++) {
        s.t[f] = f / 240;
        for (let c = 0; c < K; c++) {
            s.xy[(f * K + c) * 2] = 0.5;
            s.xy[(f * K + c) * 2 + 1] = 0.25;     /* near the TOP of the image */
            s.vis[f * K + c] = 0.9;
        }
        /* put the hips near the BOTTOM of the image */
        for (const name of ['hipL', 'hipR']) {
            const c = CANONICAL.indexOf(name);
            s.xy[(f * K + c) * 2 + 1] = 0.75;
        }
    }
    const c = condition(s, { fps: 240 });
    assert(c.kp.shoulderMid.y[1] > c.kp.hipMid.y[1],
        'shoulders are above the hips in image terms, so they must have the LARGER y after the flip');
    assertClose(c.kp.hipMid.y[1], 800 * 0.25, 1, 'y_up = (1 - y_norm) * height');
});

test('REGRESSION: a runner leaning FORWARD produces a POSITIVE trunk lean', () => {
    /* The single test that catches the most damaging bug in the system. */
    for (const dir of [1, -1]) {
        const { series } = synthGait({ fps: 240, durationS: 3, trunkLeanDeg: 9, direction: dir });
        const r = runPipeline(series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
        assert(r.ok, 'the pipeline must run');
        const lean = r.metrics.trunkLean.combined.value;
        assert(lean > 0, `direction ${dir}: forward lean must be positive, got ${lean}`);
        assertClose(lean, 9, 1.0, `direction ${dir}: trunk lean recovered`);
    }
});

test('a runner leaning BACKWARD produces a negative trunk lean', () => {
    const { series } = synthGait({ fps: 240, durationS: 3, trunkLeanDeg: -6 });
    const r = runPipeline(series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assertClose(r.metrics.trunkLean.combined.value, -6, 1.0, 'backward lean is negative');
});

test('foot-strike angle is POSITIVE for toe-up (rearfoot)', () => {
    const { series } = synthGait({ fps: 240, durationS: 3, strikeAngleDeg: 14 });
    const r = runPipeline(series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    const a = r.metrics.footStrikeAngle.sides.L.value;
    assert(a > 0, `rearfoot must give a positive angle, got ${a}`);
    assertEqual(classifyStrike(a), 'rearfoot');
    assertEqual(classifyStrike(-6), 'forefoot');
    assertEqual(classifyStrike(3), 'midfoot');
});

test('upper-arm angle does not straddle the +-180 wrap', () => {
    /* Measured from the wrong vertical, a hanging arm sits at 180 degrees and
       the swing RANGE comes out near 360. */
    const { series } = synthGait({ fps: 240, durationS: 3 });
    const r = runPipeline(series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    const amp = r.metrics.armSwingAmplitude.sides.L.value;
    assertBetween(amp, 10, 120, 'arm swing amplitude in a plausible range');
});

test('travelDirection uses foot orientation, which survives a treadmill', () => {
    for (const mode of ['treadmill', 'overground']) {
        for (const dir of [1, -1]) {
            const { series } = synthGait({ fps: 120, durationS: 3, mode, direction: dir });
            const d = travelDirection(series);
            assertEqual(d.dir, dir, `${mode}, direction ${dir}`);
            assert(d.agrees, 'the two direction cues must agree on clean data');
        }
    }
});

test('view classification separates sagittal from frontal', () => {
    for (const view of ['sagittal', 'frontal']) {
        const { series } = synthGait({ fps: 120, durationS: 3, view });
        const cond = condition(series, { fps: 120 });
        const c = classifyView(cond);
        assertEqual(c.view, view, `a ${view} clip must classify as ${view} (ratio ${c.ratio.toFixed(2)})`);
    }
});


/* ============================================================
   3b. Container orientation
   ============================================================ */

group('Container — rotation and mirroring');

/**
 * A minimal but structurally valid MP4, built here so the parser can be tested
 * against a display matrix whose meaning is known exactly.
 *
 * This fixture exists because of a real bug. The track-header matrix was being
 * read four bytes early, so EVERY rotation parsed as zero, and a clip recorded
 * in portrait on a phone was analysed on its side — the pose model given a
 * runner lying down. Nothing threw, nothing looked wrong in the code, and the
 * numbers that came out were confident and meaningless. The offsets below are
 * spelled out for the same reason.
 */
function buildMp4({ matrix, codedW = 848, codedH = 480, version = 0 }) {
    const chunks = [];
    const box = (type, body) => {
        const b = new Uint8Array(8 + body.length);
        const dv = new DataView(b.buffer);
        dv.setUint32(0, b.length);
        for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
        b.set(body, 8);
        return b;
    };
    const cat = (...arrs) => {
        const total = arrs.reduce((a, x) => a + x.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const a of arrs) { out.set(a, o); o += a.length; }
        return out;
    };
    const u8a = (n) => new Uint8Array(n);
    const be32 = (...vals) => {
        const b = new Uint8Array(vals.length * 4);
        const dv = new DataView(b.buffer);
        vals.forEach((v, i) => dv.setInt32(i * 4, v));
        return b;
    };
    const be16 = (...vals) => {
        const b = new Uint8Array(vals.length * 2);
        const dv = new DataView(b.buffer);
        vals.forEach((v, i) => dv.setUint16(i * 2, v));
        return b;
    };

    /* tkhd: version+flags, times, track_ID, reserved, duration, reserved[2],
       layer, alternate_group, volume, reserved, matrix[9], width, height */
    const tkhdBody = version === 1
        ? cat(be32(0x01000000), u8a(8), u8a(8), be32(1), be32(0), u8a(8),
            u8a(8), be16(0, 0, 0, 0), be32(...matrix), be32(codedW << 16, codedH << 16))
        : cat(be32(0x00000000), be32(0), be32(0), be32(1), be32(0), be32(0),
            u8a(8), be16(0, 0, 0, 0), be32(...matrix), be32(codedW << 16, codedH << 16));

    const hdlrBody = cat(be32(0), be32(0), new Uint8Array([118, 105, 100, 101]), u8a(12), new Uint8Array([0]));
    const mdhdBody = cat(be32(0), be32(0), be32(0), be32(600), be32(600), be16(0, 0));

    /* one avc1 sample entry: 78 bytes of visual fields, then avcC */
    const avcC = box('avcC', new Uint8Array([1, 0x42, 0x00, 0x1f, 0xff, 0xe0, 0, 0, 0]));
    const avc1Body = cat(
        u8a(6), be16(1),                       /* reserved, data_reference_index */
        be16(0, 0), u8a(12),                   /* pre_defined, reserved, pre_defined[3] */
        be16(codedW, codedH),                  /* width, height at +24, +26 */
        be32(0x00480000, 0x00480000), be32(0), /* resolutions, reserved */
        be16(1), u8a(32), be16(0x0018), be16(0xffff),
        avcC
    );
    const stsd = box('stsd', cat(be32(0), be32(1), box('avc1', avc1Body)));
    const stts = box('stts', cat(be32(0), be32(1), be32(2), be32(300)));
    const stsc = box('stsc', cat(be32(0), be32(1), be32(1), be32(2), be32(1)));
    const stsz = box('stsz', cat(be32(0), be32(0), be32(2), be32(100), be32(100)));
    const stco = box('stco', cat(be32(0), be32(1), be32(4096)));
    const stbl = box('stbl', cat(stsd, stts, stsc, stsz, stco));
    const minf = box('minf', stbl);
    const mdia = box('mdia', cat(box('mdhd', mdhdBody), box('hdlr', hdlrBody), minf));
    const trak = box('trak', cat(box('tkhd', tkhdBody), mdia));
    const moov = box('moov', trak);
    const ftyp = box('ftyp', new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0]));
    chunks.push(ftyp, moov, box('mdat', u8a(200)));
    const all = cat(...chunks);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const M = {
    /* 16.16 fixed point; the third column is the fixed 2.30 perspective row */
    none: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
    rot90: [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000],
    rot180: [-0x10000, 0, 0, 0, -0x10000, 0, 0, 0, 0x40000000],
    rot270: [0, -0x10000, 0, 0x10000, 0, 0, 0, 0, 0x40000000],
    flipped: [-0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]
};

test('the fixture parses at all, so the rest of this group means something', () => {
    const r = parseMp4(buildMp4({ matrix: M.none }));
    assert(r.ok, `the hand-built fixture must parse; got ${r.reason}`);
    assertEqual(r.track.codec, 'avc1.42001f');
    assertEqual(r.track.width, 848);
    assertEqual(r.track.height, 480);
    assertEqual(r.track.samples.length, 2);
    assertClose(measuredFps(r.track), 2, 1e-9, '600 ticks per second, 300 per sample');
});

test('REGRESSION: every quarter turn in the display matrix is read', () => {
    /* The bug this guards: the matrix was read four bytes early and every
       rotation came back as zero. */
    for (const [name, deg] of [['none', 0], ['rot90', 90], ['rot180', 180], ['rot270', 270]]) {
        const r = parseMp4(buildMp4({ matrix: M[name] }));
        assert(r.ok, `${name} must parse`);
        assertEqual(r.track.rotationDeg, deg, `${name}`);
        assertEqual(r.track.mirrored, false, `${name} is not mirrored`);
    }
});

test('the matrix offset is right for version 1 track headers too', () => {
    const r = parseMp4(buildMp4({ matrix: M.rot90, version: 1 }));
    assert(r.ok, 'version 1 tkhd must parse');
    assertEqual(r.track.rotationDeg, 90, 'a 64-bit track header shifts the matrix by 12 bytes');
});

test('a quarter turn swaps the display dimensions', () => {
    /* The size the user recognises. A phone recording in portrait stores
       landscape pixels; reporting the coded size would tell them their 9:16
       clip is 16:9. */
    const upright = displaySize(parseMp4(buildMp4({ matrix: M.none })).track);
    assertEqual(upright.width, 848);
    assertEqual(upright.height, 480);
    for (const name of ['rot90', 'rot270']) {
        const d = displaySize(parseMp4(buildMp4({ matrix: M[name] })).track);
        assertEqual(d.width, 480, `${name} display width`);
        assertEqual(d.height, 848, `${name} display height`);
        assert(d.height > d.width, `${name} must come out portrait`);
    }
    const half = displaySize(parseMp4(buildMp4({ matrix: M.rot180 })).track);
    assertEqual(half.width, 848, 'a half turn does not swap the axes');
});

test('a mirrored source is detected, and is not mistaken for a rotation', () => {
    /* A flip swaps the runner's left and right sides. Every per-side
       measurement and every asymmetry index would then be reported
       confidently for the wrong leg — which looks entirely normal in the
       output, and is the reason this is detected rather than ignored. */
    const r = parseMp4(buildMp4({ matrix: M.flipped }));
    assert(r.ok, 'a mirrored track must still parse');
    assertEqual(r.track.mirrored, true, 'the negative determinant must be seen');
    assertEqual(r.track.rotationDeg, 0, 'and must not read as a 180 degree turn');
});

test('a malformed container is refused rather than half-read', () => {
    assertEqual(parseMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer).ok, false, 'not ISO-BMFF');
    const noVideo = parseMp4(buildMp4({ matrix: M.none }));
    assert(noVideo.ok, 'sanity');
});

/* ============================================================
   4. Scaling
   ============================================================ */

group('Scaling');

test('the per-frame scale recovers the true pixels-per-metre', () => {
    const H = 1.82, imageH = 720, fill = 0.72;
    const { series } = synthGait({ fps: 120, durationS: 3, heightM: H, imageH, fillFrac: fill });
    const cond = condition(series, { fps: 120 });
    const s = perFrameScale(cond, H);
    const truePxPerM = (fill * imageH) / H;
    assertClose(1 / s.mPerPxMedian, truePxPerM, truePxPerM * 0.02, 'pixels per metre');
    assertEqual(s.confidence, 'high', 'clean synthetic data scales confidently');
});

test('a wrong height scales every distance by the same wrong factor', () => {
    const { series, truth } = synthGait({ fps: 120, durationS: 4, heightM: 1.75 });
    const right = runPipeline(series, { heightM: 1.75, surface: 'overground' });
    const wrong = runPipeline(series, { heightM: 1.75 * 1.10, surface: 'overground' });
    const a = right.metrics.verticalOscillation.combined.value;
    const b = wrong.metrics.verticalOscillation.combined.value;
    assertClose(b / a, 1.10, 0.01, 'a 10% height error is a 10% distance error');
    void truth;
});

test('the world-landmark cross-check downgrades a disagreeing scale', () => {
    const { series } = synthGait({ fps: 120, durationS: 3, heightM: 1.75 });
    const cond = condition(series, { fps: 120 });
    const ok = perFrameScale(cond, 1.75, { worldLegLengthM: WINTER.leg * 1.75 });
    const bad = perFrameScale(cond, 1.75, { worldLegLengthM: WINTER.leg * 1.75 * 1.5 });
    assertEqual(ok.confidence, 'high', 'agreeing estimates stay confident');
    assertEqual(bad.confidence, 'low', 'a 50% disagreement must downgrade the scale');
});

/* ============================================================
   5. Gait events
   ============================================================ */

group('Events — accuracy against known ground truth');

function eventError(detected, truth) {
    const errs = [];
    for (const d of detected) {
        let best = Infinity;
        for (const t of truth) if (t.side === d.side) best = Math.min(best, Math.abs(t.t - d.t));
        if (best < 0.15) errs.push(best * 1000);
    }
    return { mae: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : Infinity, n: errs.length };
}

for (const fps of [60, 120, 240]) {
    test(`foot strike and toe-off at ${fps} fps, all three strike patterns`, () => {
        for (const [label, angle] of [['rearfoot', 13], ['midfoot', 3], ['forefoot', -8]]) {
            const { series, truth } = synthGait({ fps, durationS: 6, strikeAngleDeg: angle });
            const cond = condition(series, { fps });
            const ev = detectEvents(cond);
            const s = eventError(ev.strikes, truth.strikes);
            const o = eventError(ev.toeoffs, truth.toeoffs);
            assert(s.n >= 10, `${label}: expected at least 10 matched strikes, got ${s.n}`);
            assert(s.mae < 20, `${label} @${fps}fps: foot-strike MAE ${s.mae.toFixed(1)} ms must be under 20 ms`);
            assert(o.mae < 40, `${label} @${fps}fps: toe-off MAE ${o.mae.toFixed(1)} ms`);
            note(`${label}: strike ${s.mae.toFixed(1)} ms, toe-off ${o.mae.toFixed(1)} ms`);
        }
    });
}

test('foot-strike detection is NOT strike-pattern dependent', () => {
    /* The whole reason for the multi-method vote. A heel-only detector fires
       when the heel arrives, which on a forefoot striker is ~70 ms after the
       foot does — a bias applied to one population and not the other, falling
       exactly on the distinction the product exists to measure. */
    const errs = {};
    for (const [label, angle] of [['rearfoot', 13], ['forefoot', -8]]) {
        const { series, truth } = synthGait({ fps: 240, durationS: 6, strikeAngleDeg: angle });
        const cond = condition(series, { fps: 240 });
        errs[label] = eventError(detectEvents(cond).strikes, truth.strikes).mae;
    }
    const gap = Math.abs(errs.rearfoot - errs.forefoot);
    assert(gap < 12, `rearfoot ${errs.rearfoot.toFixed(1)} ms vs forefoot ${errs.forefoot.toFixed(1)} ms: the between-pattern gap ${gap.toFixed(1)} ms must stay small`);
    note(`rearfoot ${errs.rearfoot.toFixed(1)} ms, forefoot ${errs.forefoot.toFixed(1)} ms`);
});

test('a strike-pattern-independent method is actually present and weighted', () => {
    assert(STRIKE_METHODS.M0, 'M0 (lowest point of the foot) must exist');
    assert(STRIKE_METHODS.M5, 'M5 (pelvis vertical velocity) must exist');
    assert(STRIKE_METHODS.M0.w >= STRIKE_METHODS.M1.w,
        'the pattern-independent detector must not be outweighed by the heel detector');
});

test('detected events obey every sanity constraint', () => {
    const { series } = synthGait({ fps: 240, durationS: 6 });
    const cond = condition(series, { fps: 240 });
    const ev = detectEvents(cond);
    assert(ev.alternation.ok, `foot strikes must alternate; ${ev.alternation.violations} violations`);
    for (const st of ev.strides.filter(s => s.valid)) {
        assertBetween(st.stanceTime * 1000, 100, 400, 'stance duration');
        assertBetween(st.strideTime * 1000, 500, 1100, 'stride duration');
        assertBetween(st.dutyFactor, 0.20, 0.50, 'duty factor');
    }
});

test('cadence from events agrees with cadence from the FFT', () => {
    for (const cad of [150, 168, 186]) {
        const { series } = synthGait({ fps: 240, durationS: 6, cadenceSpm: cad });
        const cond = condition(series, { fps: 240 });
        const ev = detectEvents(cond);
        assertClose(ev.cadenceEvents, cad, cad * 0.02, `events cadence at ${cad}`);
        assertClose(ev.cadenceSpectral, cad, cad * 0.02, `spectral cadence at ${cad}`);
        assert(ev.cadenceAgrees, 'the two independent estimates must agree');
    }
});

test('event uncertainty reproduces the specified error budget', () => {
    /* At 30 fps two events give 1.96 * 33.3/sqrt(6) = 26.7 ms, the "+/- one
       frame" figure the specification tabulates. */
    for (const [fps, expected] of [[30, 33.3], [60, 16.7], [120, 8.3], [240, 4.2]]) {
        const sigma = intervalUncertaintyMs(fps, 0, 0);
        const ci = 1.96 * sigma;
        assertClose(ci, expected * 0.8, expected * 0.12, `${fps} fps quantisation interval`);
    }
    assert(intervalUncertaintyMs(240, 10, 10) > intervalUncertaintyMs(240, 0, 0),
        'method disagreement must widen the interval');
    assert(instantUncertaintyMs(240, 0) < intervalUncertaintyMs(240, 0, 0),
        'one event is more certain than an interval between two');
});

/* ============================================================
   6. Metrics against ground truth
   ============================================================ */

group('Metrics — recovery from a known runner');

const GT = synthGait({ fps: 240, durationS: 6, mode: 'treadmill' });
const GTR = runPipeline(GT.series, { heightM: 1.75, surface: 'treadmill', speedMs: GT.params.speedMs });

test('the pipeline completes and reports the capture honestly', () => {
    assert(GTR.ok, GTR.message);
    assertEqual(GTR.capture.view, 'sagittal');
    assertClose(GTR.capture.fps, 240, 0.5, 'fps measured from the timestamps, not declared');
    assertEqual(GTR.capture.frameCount, 1440);
    assert(GTR.strideCount.usable >= 8, `expected plenty of usable strides, got ${GTR.strideCount.usable}`);
});

test('cadence', () => {
    assertClose(GTR.metrics.cadence.combined.value, GT.truth.cadenceSpm, 2, 'cadence within 2 spm');
});

test('ground contact time, both sides', () => {
    for (const side of ['L', 'R']) {
        assertClose(GTR.metrics.gct.sides[side].value, GT.truth.gctMs[side], 12,
            `${side} ground contact time`);
    }
    note(`L ${GTR.metrics.gct.sides.L.value.toFixed(1)} ms, R ${GTR.metrics.gct.sides.R.value.toFixed(1)} ms, truth ${GT.truth.gctMs.L.toFixed(1)} ms`);
});

test('duty factor and flight time follow from contact time', () => {
    assertClose(GTR.metrics.dutyFactor.sides.L.value, GT.truth.dutyFactor.L, 0.02, 'duty factor');
    assertClose(GTR.metrics.flightTime.sides.L.value, GT.truth.flightTimeMs.L, 15, 'flight time');
    const gct = GTR.metrics.gct.sides.L.value;
    const stride = GTR.metrics.strideTime.sides.L.value;
    assertClose(GTR.metrics.dutyFactor.sides.L.value, gct / stride, 0.005, 'duty factor is internally consistent');
});

test('step time and stride time', () => {
    assertClose(GTR.metrics.stepTime.sides.L.value, GT.truth.stepTimeMs, 8, 'step time');
    assertClose(GTR.metrics.strideTime.sides.L.value, GT.truth.strideTimeMs, 8, 'stride time');
});

test('step length and speed on a treadmill come from the entered speed', () => {
    assertClose(GTR.metrics.stepLength.sides.L.value, GT.truth.stepLengthM, 0.02, 'step length');
    assertClose(GTR.metrics.speed.combined.value, GT.truth.speedMs, 0.01, 'speed');
});

test('vertical oscillation and vertical ratio', () => {
    assertClose(GTR.metrics.verticalOscillation.combined.value, GT.truth.vertOscStrideM * 100, 0.4,
        'vertical oscillation, cm');
    const expectedRatio = 100 * (GT.truth.vertOscStrideM) / GT.truth.stepLengthM;
    assertClose(GTR.metrics.verticalRatio.combined.value, expectedRatio, 0.6, 'vertical ratio');
});

test('trunk lean and foot-strike angle', () => {
    assertClose(GTR.metrics.trunkLean.combined.value, GT.truth.trunkLeanDeg, 0.6, 'trunk lean');
    assertClose(GTR.metrics.footStrikeAngle.sides.L.value, GT.truth.strikeAngleDeg, 2.0, 'foot-strike angle');
});

test('overstride matches the geometry the runner was built with', () => {
    assertClose(GTR.metrics.overstride.sides.L.value, GT.truth.overstrideFracHeight, 3,
        'ankle ahead of hip at contact, % of height');
});

test('every metric reports value, unit, n, confidence and a 95% interval', () => {
    for (const spec of METRICS) {
        const m = GTR.metrics[spec.id];
        assert(m, `metric ${spec.id} must be present in the result`);
        assertEqual(m.unit, spec.unit, `${spec.id} unit`);
        for (const side of ['L', 'R']) {
            const s = m.sides[side];
            assert(s, `${spec.id}.${side} must exist`);
            assert(['high', 'medium', 'low', 'unavailable'].includes(s.confidence), `${spec.id}.${side} confidence`);
            if (s.value != null) {
                assert(Number.isFinite(s.value), `${spec.id}.${side} value must be finite`);
                assert(s.ci95 != null && s.ci95 >= 0, `${spec.id}.${side} must carry an interval`);
                assert(s.n >= 1, `${spec.id}.${side} must say how many strides it used`);
            }
        }
    }
});

test('left and right are always reported separately, with an asymmetry index', () => {
    const asym = synthGait({ fps: 240, durationS: 6, asymmetry: 0.10 });
    const r = runPipeline(asym.series, { heightM: 1.75, surface: 'treadmill', speedMs: asym.params.speedMs });
    const L = r.metrics.gct.sides.L.value, R = r.metrics.gct.sides.R.value;
    assert(L != null && R != null, 'both sides measured');
    assert(R > L, `the side given the longer contact must measure longer: L ${L.toFixed(0)} R ${R.toFixed(0)}`);
    assert(r.metrics.gct.asymmetryIndex > 3, `asymmetry must be detected, got ${r.metrics.gct.asymmetryIndex.toFixed(1)}%`);
    note(`built with 10% duty asymmetry; measured AI ${r.metrics.gct.asymmetryIndex.toFixed(1)}%`);
});

test('MIRROR INVARIANCE: right-to-left gives the same numbers as left-to-right', () => {
    const a = synthGait({ fps: 240, durationS: 5, direction: 1 });
    const b = synthGait({ fps: 240, durationS: 5, direction: -1 });
    const ra = runPipeline(a.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    const rb = runPipeline(b.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assertEqual(ra.capture.mirrored, false);
    assertEqual(rb.capture.mirrored, true);
    for (const id of ['cadence', 'trunkLean', 'verticalOscillation']) {
        assertClose(rb.metrics[id].combined.value, ra.metrics[id].combined.value,
            Math.abs(ra.metrics[id].combined.value) * 0.03 + 0.2, `${id} must be direction invariant`);
    }
    /* Sided metrics are NOT expected to match side-for-side, and it is worth
       being clear why rather than loosening a tolerance and moving on. Running
       the other way round swaps which anatomical side faces the camera: the near
       leg is nearer, so it projects slightly larger and its landmarks sit a
       little differently. What must be invariant is the pair taken together. */
    for (const id of ['footStrikeAngle', 'overstride', 'shankAngleContact']) {
        const pair = (r) => (r.metrics[id].sides.L.value + r.metrics[id].sides.R.value) / 2;
        assertClose(pair(rb), pair(ra), Math.abs(pair(ra)) * 0.06 + 0.5, `${id} (L/R mean) must be direction invariant`);
    }
});

test('overground clips measure speed instead of being told it', () => {
    const g = synthGait({ fps: 240, durationS: 3, mode: 'overground' });
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'road' });
    assert(r.ok, r.message);
    assert(r.metrics.speed.combined.value != null, 'speed must be measured overground');
    assertClose(r.metrics.speed.combined.value, g.truth.speedMs, g.truth.speedMs * 0.15, 'measured speed');
    assertClose(r.metrics.stepLength.sides.L.value, g.truth.stepLengthM, g.truth.stepLengthM * 0.15, 'measured step length');
});


/* ============================================================
   6b. The whole-body model
   ============================================================ */

group('Whole-body model — centre of mass and stiffness');

test('segment masses are a complete body', () => {
    const total = SEGMENTS.reduce((a, s) => a + s.mass, 0);
    assertClose(total, 1.0, 1e-9, "Winter's segment mass fractions must sum to the whole body");
    for (const seg of SEGMENTS) {
        assert(seg.mass > 0, `${seg.id} must have mass`);
        assertBetween(seg.com, 0, 1, `${seg.id} centre of mass along the segment`);
        assert(seg.from && seg.to, `${seg.id} must name both endpoints`);
    }
    /* every endpoint must be a landmark the conditioning stage produces */
    const known = new Set([...CANONICAL, 'hipMid', 'shoulderMid', 'pelvis', 'neck', 'headCentre', 'thorax', 'footL', 'footR']);
    for (const seg of SEGMENTS) {
        assert(known.has(seg.from), `${seg.id} proximal endpoint ${seg.from} is not a landmark`);
        assert(known.has(seg.to) || SEGMENT_FALLBACK[seg.to], `${seg.id} distal endpoint ${seg.to} is not a landmark and has no fallback`);
    }
});

test('the centre of mass uses the whole body when the whole body is visible', () => {
    const { series } = synthGait({ fps: 240, durationS: 4 });
    const cond = condition(series, { fps: 240 });
    const com = bodyCoM(cond);
    assertEqual(com.segmentsUsed.length, SEGMENTS.length, 'all fourteen segments');
    assertClose(com.massCovered, 1.0, 1e-9, 'all of the mass');
    assertClose(com.missing, 0, 1e-9, 'no missing frames on a clean clip');
});

test('the centre of mass is NOT the pelvis, and oscillates less', () => {
    /* The whole point of the inertial model. The swinging limbs move opposite
       to the trunk and partly cancel its rise and fall, so the centre of mass
       moves less than the pelvis landmark that is usually substituted for it.
       If this ever inverts, the model is wrong. */
    const { series } = synthGait({ fps: 240, durationS: 6 });
    const cond = condition(series, { fps: 240 });
    const com = bodyCoM(cond);
    const span = (a) => {
        let lo = Infinity, hi = -Infinity;
        for (const v of a) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        return hi - lo;
    };
    const comSpan = span(com.y);
    const pelvisSpan = span(cond.kp.hipMid.y);
    assert(comSpan < pelvisSpan, `centre of mass ${comSpan.toFixed(1)} px must move less than the pelvis ${pelvisSpan.toFixed(1)} px`);
    assert(comSpan > 0.5 * pelvisSpan, 'but not absurdly less — they are still the same body');
    note(`centre of mass ${comSpan.toFixed(1)} px, pelvis ${pelvisSpan.toFixed(1)} px`);
});

test('a lost hand does not delete mass from the body', () => {
    const g = synthGait({ fps: 240, durationS: 4 });
    const K = CANONICAL.length;
    const hand = CANONICAL.indexOf('handL');
    for (let f = 0; f < g.series.n; f++) g.series.vis[f * K + hand] = 0;
    const cond = condition(g.series, { fps: 240 });
    const com = bodyCoM(cond);
    assertClose(com.massCovered, 1.0, 1e-9, 'the hand segment falls back to the wrist rather than vanishing');
    assert(com.segmentsUsed.includes('handL'), 'the segment is still modelled');
});

test('Morin spring-mass stiffness reproduces known values', () => {
    /* 70 kg runner at 3.0 m/s, 226 ms contact, 114 ms flight, 0.859 m leg.
       Published typical ranges: vertical 25-35 kN/m, leg 10-14 kN/m, centre of
       mass drop 5-7 cm during contact, model peak force around 2.2-2.6 body
       weights. Hand-checked against the paper's equations. */
    const k = springMassStiffness({ massKg: 70, speedMs: 3.0, contactS: 0.226, flightS: 0.114, legLengthM: 0.859 });
    assert(k, 'the estimate must be produced');
    assertClose(k.kVert, 28.3, 0.5, 'vertical stiffness, kN/m');
    assertClose(k.kLeg, 12.8, 0.5, 'leg stiffness, kN/m');
    assertClose(k.comDropM * 100, 5.7, 0.3, 'centre-of-mass drop during contact, cm');
    assertClose(k.modelPeakForceBW, 2.36, 0.05, 'model peak force, body weights');
    note(`Kvert ${k.kVert.toFixed(1)} kN/m, Kleg ${k.kLeg.toFixed(1)} kN/m, drop ${(k.comDropM * 100).toFixed(1)} cm`);
});

test('stiffness rises with a shorter contact time, as the model requires', () => {
    const base = { massKg: 70, speedMs: 3.0, flightS: 0.114, legLengthM: 0.859 };
    const slow = springMassStiffness({ ...base, contactS: 0.260 });
    const fast = springMassStiffness({ ...base, contactS: 0.190 });
    assert(fast.kVert > slow.kVert, 'shorter contact means a stiffer vertical spring');
    assert(fast.kLeg > slow.kLeg, 'and a stiffer leg spring');
});

test('stiffness refuses to guess a missing input', () => {
    const base = { massKg: 70, speedMs: 3.0, contactS: 0.226, flightS: 0.114, legLengthM: 0.859 };
    assertEqual(springMassStiffness({ ...base, massKg: NaN }), null, 'no body mass, no estimate');
    assertEqual(springMassStiffness({ ...base, speedMs: NaN }), null, 'no speed, no estimate');
    assertEqual(springMassStiffness({ ...base, contactS: 0 }), null, 'no contact time, no estimate');
    /* horizontal travel during contact longer than the leg can span */
    assertEqual(springMassStiffness({ ...base, speedMs: 12 }), null, 'a stride the spring-mass model does not describe');
});

test('stiffness is reported only when body mass is given, and says why', () => {
    const g = synthGait({ fps: 240, durationS: 6 });
    const withMass = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: g.params.speedMs });
    const without = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: g.params.speedMs });
    assert(withMass.metrics.verticalStiffness.combined.value != null, 'with mass, an estimate');
    assertBetween(withMass.metrics.verticalStiffness.combined.value, 15, 50, 'vertical stiffness, kN/m');
    assertBetween(withMass.metrics.legStiffness.combined.value, 6, 22, 'leg stiffness, kN/m');
    assertEqual(without.metrics.verticalStiffness.combined.value, null, 'without mass, nothing');
    assert(/body mass/.test(without.metrics.verticalStiffness.sides.L.note || ''), 'and it says why');
    /* never presented as a measurement */
    assert(/not a force measurement/.test(withMass.metrics.verticalStiffness.sides.L.note || ''),
        'a model estimate must announce itself as one');
    assert(!/force/i.test(METRIC_BY_ID.verticalStiffness.label), 'and must not be labelled a force');
});

test('the extra head and hand landmarks produce measurements', () => {
    const g = synthGait({ fps: 240, durationS: 6, headForwardDeg: 7 });
    const r = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: 3.0 });
    assert(r.metrics.headOscillation.combined.value != null, 'head oscillation needs the ears');
    assert(r.metrics.forwardHeadPosture.combined.value != null, 'forward head position needs the ears');
    const flat = synthGait({ fps: 240, durationS: 6, headForwardDeg: 0 });
    const rf = runPipeline(flat.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: 3.0 });
    assert(r.metrics.forwardHeadPosture.combined.value > rf.metrics.forwardHeadPosture.combined.value,
        'a head carried further forward must measure further forward');
    note(`head forward: ${r.metrics.forwardHeadPosture.combined.value.toFixed(2)}% at 7 deg, ${rf.metrics.forwardHeadPosture.combined.value.toFixed(2)}% at 0 deg`);
});

test('a metric the backend cannot form says which landmark is missing', () => {
    /* Foot progression angle needs the foot to be a plane. BlazePose has no
       lateral forefoot landmark, so the honest answer is not "no strides
       produced this" — it is which landmark is absent. */
    const g = synthGait({ fps: 240, durationS: 6, view: 'frontal' });
    const r = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: 3.0, view: 'frontal' });
    const fp = r.metrics.footProgressionAngle.sides.L;
    assertEqual(fp.confidence, 'unavailable');
    assert(/footOuterL/.test(fp.note || ''), `the reason must name the landmark, got: ${fp.note}`);
    /* and the metric it CAN form on a frontal view still works */
    assert(r.metrics.handCrossing.sides.L.value != null, 'hand crossing needs only what BlazePose has');
});

test('the evidence-based bands say what the evidence says', () => {
    /* Van Hooren et al. 2024 found duty factor and contact time to have
       trivial, non-significant associations with running economy. An earlier
       version of this app described duty factor as well-evidenced. It is not,
       and the band must not imply otherwise. */
    const duty = NORMS.find(b => b.metric === 'dutyFactor');
    assertEqual(duty.strength, 'consensus-only', 'duty factor cannot claim moderate evidence');
    assert(/trivial/i.test(duty.comment || ''), 'and the comment must say so plainly');

    const com = NORMS.find(b => b.metric === 'comVerticalOscillation');
    assertEqual(com.source, 'vanhooren-2024');
    assertEqual(com.strength, 'moderate');
    assertEqual(com.direction, 'lower-better');

    for (const id of ['verticalStiffness', 'legStiffness']) {
        const b = NORMS.find(x => x.metric === id);
        assert(b, `${id} needs a band`);
        assertEqual(b.direction, 'higher-better', `${id}: more stiffness is associated with better economy`);
        assertEqual(b.source, 'vanhooren-2024');
    }
    /* the honest caveat about effect size has to be somewhere a reader meets it */
    assert(/4-12%/.test(REFERENCE_BY_ID['vanhooren-2024'].used),
        'the reference must carry how little of running economy technique explains');
});


/* ============================================================
   6c. Refusing to measure what cannot be measured
   ============================================================ */

group('Refusal — capture conditions the app must not measure through');

test('a limb that changes length is a tracking failure, and is discarded', () => {
    /* A pose estimator asked for a landmark it cannot see guesses, and reports
       a comfortable confidence while doing so. Visibility cannot catch that.
       Bone length can: this is the far leg of a runner filmed at an angle,
       hallucinated somewhere below the body. */
    const g = synthGait({ fps: 120, durationS: 5 });
    const K = CANONICAL.length;
    const ankle = CANONICAL.indexOf('ankleR');
    const bad = [];
    for (let f = 20; f < g.series.n; f += 3) {
        /* put the right ankle somewhere anatomically impossible, and claim to
           be confident about it */
        g.series.xy[(f * K + ankle) * 2] = 0.92;
        g.series.xy[(f * K + ankle) * 2 + 1] = 0.98;
        g.series.vis[f * K + ankle] = 0.95;
        bad.push(f);
    }
    const report = gateImplausibleSegments(g.series);
    assert(report.gated > 0, 'the implanted failures must be caught');
    let caught = 0;
    for (const f of bad) if (g.series.vis[f * K + ankle] === 0) caught++;
    assert(caught / bad.length > 0.9,
        `most implanted failures must be gated; caught ${caught} of ${bad.length}`);
    /* and it must not gate a clean clip */
    const clean = synthGait({ fps: 120, durationS: 5 });
    const cleanReport = gateImplausibleSegments(clean.series);
    assert(cleanReport.gated / Math.max(1, cleanReport.total) < 0.02,
        `a clean clip must survive; gated ${cleanReport.gated} of ${cleanReport.total}`);
    note(`tolerance ${(LENGTH_TOLERANCE * 100).toFixed(0)}%, caught ${caught}/${bad.length}, clean clip gated ${cleanReport.gated}`);
});

test('a runner who does not cross the frame has no measurable displacement', () => {
    const tread = synthGait({ fps: 120, durationS: 5, mode: 'treadmill' });
    const over = synthGait({ fps: 120, durationS: 5, mode: 'overground' });
    const condT = condition(tread.series, { fps: 120 });
    const condO = condition(over.series, { fps: 120 });
    const legPx = perFrameScale(condT, 1.75).legLengthPx;
    const t1 = frameIsWorldFixed(condT, legPx);
    const t2 = frameIsWorldFixed(condO, perFrameScale(condO, 1.75).legLengthPx);
    assertEqual(t1.worldFixed, false, 'a treadmill runner stays put');
    assertEqual(t2.worldFixed, true, 'an overground runner crosses the frame');
    note(`treadmill ${t1.travelLegs.toFixed(2)} leg lengths, overground ${t2.travelLegs.toFixed(2)}`);
});

test('REGRESSION: a treadmill clip labelled overground refuses to invent a speed', () => {
    /* The failure this guards produced "0.10 m/s, 166:36 per km" on a real
       clip: a treadmill recording marked as road, where displacement between
       foot strikes is near zero. That number then feeds the vertical ratio,
       the stiffness model and the choice of speed-conditional reference band,
       so one undetected condition corrupts a whole column of the report. */
    const g = synthGait({ fps: 240, durationS: 6, mode: 'treadmill' });
    const r = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'road' });
    assert(r.ok, r.message);
    assertEqual(r.capture.spatialFromDisplacement, false, 'displacement is not measurable here');
    for (const id of ['speed', 'stepLength', 'strideLength']) {
        assertEqual(r.metrics[id].sides.L.value, null, `${id} must not be reported`);
        assert(/treadmill|followed them/i.test(r.metrics[id].sides.L.note || ''),
            `${id} must say what to do instead, got: ${r.metrics[id].sides.L.note}`);
    }
    assert(r.warnings.some(w => w.code === 'camera-not-world-fixed'), 'and the clip must be flagged');
    /* stiffness depends on speed, so it must go too rather than use a zero */
    assertEqual(r.metrics.verticalStiffness.combined.value, null,
        'stiffness must not be computed from a speed that does not exist');
    /* cadence and the angles do not depend on displacement and must survive */
    assert(r.metrics.cadence.combined.value != null, 'cadence is unaffected');
    assertClose(r.metrics.cadence.combined.value, g.truth.cadenceSpm, 3, 'and is still right');
});

test('the same clip labelled treadmill, with a speed, measures everything', () => {
    const g = synthGait({ fps: 240, durationS: 6, mode: 'treadmill' });
    const r = runPipeline(g.series, {
        heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: g.params.speedMs
    });
    assert(r.metrics.speed.combined.value != null, 'the entered speed is used');
    assert(r.metrics.stepLength.sides.L.value != null, 'and step length follows from it');
    assert(r.metrics.verticalStiffness.combined.value != null, 'and so does stiffness');
    assert(!r.warnings.some(w => w.code === 'camera-not-world-fixed'), 'no complaint when told the truth');
});

test('an oblique camera makes planar angles wrong, not noisy, and they are capped', () => {
    /* A three-quarter view measures every angle in a plane the movement did
       not happen in. That is not a precision problem — averaging more strides
       cannot help — so nothing plane-sensitive may reach the confidence at
       which it gets scored or advised on. */
    const g = synthGait({ fps: 240, durationS: 6, view: 'oblique' });
    const r = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: 3.0 });
    assert(r.ok, r.message);
    assertEqual(r.capture.viewAuto, 'oblique', 'the camera angle must be detected');
    assert(r.warnings.some(w => w.code === 'oblique-view'), 'and reported');

    for (const spec of METRICS.filter(m => m.planeSensitive)) {
        const slot = spec.sided ? r.metrics[spec.id].sides.L : r.metrics[spec.id].combined;
        assert(!atLeast(slot.confidence, 'medium'),
            `${spec.id} is plane-sensitive and must not exceed low confidence on an oblique view, got ${slot.confidence}`);
    }
    /* nothing plane-sensitive may be scored, and no rule may cite one */
    for (const spec of METRICS.filter(m => m.planeSensitive)) {
        const e = r.scores.perMetric[spec.id];
        if (!e) continue;
        assertEqual(e.sides.L.score, null, `${spec.id} must not be scored`);
    }
    for (const f of r.findings) {
        if (!f.detail || !f.detail.metric) continue;
        const spec = METRIC_BY_ID[f.detail.metric];
        assert(!spec || !spec.planeSensitive,
            `finding ${f.id} rests on ${f.detail.metric}, measured in the wrong plane`);
    }
    /* cadence does not care which way the camera points */
    assert(r.metrics.cadence.combined.value != null, 'cadence survives an oblique view');
    assertClose(r.metrics.cadence.combined.value, g.truth.cadenceSpm, 4, 'and is still right');
});

test('a square-on view is not penalised', () => {
    const g = synthGait({ fps: 240, durationS: 6, view: 'sagittal' });
    const r = runPipeline(g.series, { heightM: 1.75, massKg: 70, surface: 'treadmill', speedMs: 3.0 });
    assertEqual(r.capture.viewAuto, 'sagittal');
    assert(!r.warnings.some(w => w.code === 'oblique-view'), 'no complaint about a good capture');
    assert(atLeast(r.metrics.trunkLean.combined.confidence, 'medium'),
        'and planar angles keep their confidence');
});

group('Metrics — suppression and confidence');

test('below 60 fps, the timing metrics are suppressed rather than hedged', () => {
    const g = synthGait({ fps: 30, durationS: 6 });
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assert(r.ok, r.message || 'a 30 fps clip is accepted but restricted');
    for (const id of ['gct', 'flightTime', 'dutyFactor']) {
        assertEqual(r.metrics[id].sides.L.confidence, 'unavailable', `${id} must be suppressed at 30 fps`);
        assertEqual(r.metrics[id].sides.L.value, null, `${id} must not report a number at 30 fps`);
        assert(/60 fps/.test(r.metrics[id].sides.L.note || ''), `${id} must say why it is missing`);
    }
    assert(r.metrics.cadence.combined.value != null, 'cadence survives at 30 fps');
    assert(r.warnings.some(w => w.code === 'timing-suppressed'), 'the user must be told');
});

test('below 30 fps, the clip is rejected outright', () => {
    const g = synthGait({ fps: 24, durationS: 6 });
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assertEqual(r.ok, false, 'a 24 fps clip must be rejected');
    assertEqual(r.code, 'fps-too-low');
    assert(/60 fps/.test(r.message), 'the rejection must say what to do instead');
});

test('frontal metrics are unavailable on a sagittal clip, and vice versa', () => {
    assertEqual(GTR.metrics.pelvicDrop.sides.L.confidence, 'unavailable', 'pelvic drop needs a frontal view');
    assert(/frontal/.test(GTR.metrics.pelvicDrop.sides.L.note || ''), 'and must say so');
    const f = synthGait({ fps: 240, durationS: 5, view: 'frontal' });
    const rf = runPipeline(f.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0, view: 'frontal' });
    assert(rf.ok, rf.message);
    assertEqual(rf.metrics.footStrikeAngle.sides.L.confidence, 'unavailable', 'strike angle needs a sagittal view');
    assert(rf.metrics.pelvicDrop.sides.L.value != null, 'pelvic drop is measured on a frontal clip');
});

test('the rearfoot proxy never claims more than low confidence', () => {
    const f = synthGait({ fps: 240, durationS: 5, view: 'frontal' });
    const rf = runPipeline(f.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0, view: 'frontal' });
    assertEqual(rf.metrics.rearfootProxy.sides.L.confidence, 'low',
        'a proxy for something that needs shoe markers must be labelled low confidence');
    assert(!/pronation/i.test(METRIC_BY_ID.rearfootProxy.label), 'and must not be called pronation');
    assert(/proxy/i.test(METRIC_BY_ID.rearfootProxy.label), 'the label must say it is a proxy');
});

test('missing landmarks make a metric unavailable rather than estimated', () => {
    const g = synthGait({ fps: 240, durationS: 6 });
    const K = CANONICAL.length;
    const heel = CANONICAL.indexOf('heelL');
    for (let f = 0; f < g.series.n; f++) {
        if (f % 3 !== 0) g.series.vis[f * K + heel] = 0.05;   /* 67% missing */
    }
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assertEqual(r.metrics.footStrikeAngle.sides.L.confidence, 'unavailable',
        'a metric that needs the left heel must refuse when the heel is mostly missing');
    assert(r.metrics.footStrikeAngle.sides.R.value != null, 'the other side is unaffected');
});

test('noise and dropout widen the intervals without breaking the pipeline', () => {
    const g = synthGait({ fps: 240, durationS: 6, noiseFrac: 0.015, dropout: 0.03, seed: 42 });
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    assert(r.ok, r.message);
    assertClose(r.metrics.cadence.combined.value, g.truth.cadenceSpm, 6, 'cadence survives realistic noise');
    assert(r.metrics.gct.sides.L.ci95 >= GTR.metrics.gct.sides.L.ci95 * 0.8,
        'noisy data must not report a tighter interval than clean data');
    note(`noisy cadence ${r.metrics.cadence.combined.value.toFixed(1)}, GCT CI +-${r.metrics.gct.sides.L.ci95.toFixed(0)} ms`);
});

test('gait-cycle curves are produced for the results charts', () => {
    const c = gaitCycleCurves(GTR, 'kneeFlex', 'L');
    assert(c, 'knee flexion curve must exist');
    assertEqual(c.mean.length, 101, 'normalised to 0-100% of the gait cycle');
    assert(c.n >= 3, `expected several strides in the mean curve, got ${c.n}`);
    assertBetween(c.stanceFraction, 0.20, 0.50, 'stance fraction shading');
    assert(Math.max(...c.mean) > Math.min(...c.mean) + 20, 'the knee must actually move');
});

/* ============================================================
   7. Scoring and recommendations
   ============================================================ */

group('Scoring');

test('scoreValue peaks in the middle of the optimal band and falls to zero', () => {
    const band = { optimal: [10, 20], acceptable: [5, 25], direction: 'target-range' };
    assertClose(scoreValue(15, band), 1, 1e-9, 'centre of optimal');
    assertClose(scoreValue(5, band), 0, 1e-9, 'edge of acceptable');
    assertClose(scoreValue(25, band), 0, 1e-9, 'other edge of acceptable');
    assertEqual(scoreValue(1000, band), 0, 'far outside clamps to zero, never negative');
    assertEqual(scoreValue(NaN, band), null, 'no value, no score');
    assertEqual(scoreValue(15, null), null, 'no band, no score');
});

test('bandStatus labels optimal, acceptable and outside', () => {
    const band = { optimal: [10, 20], acceptable: [5, 25] };
    assertEqual(bandStatus(15, band), 'optimal');
    assertEqual(bandStatus(22, band), 'acceptable');
    assertEqual(bandStatus(30, band), 'outside');
    assertEqual(bandStatus(30, null), 'unscored');
});

test('normative bands are speed-conditional where the target moves with speed', () => {
    const slow = bandFor('cadence', { speedMs: 2.5 });
    const fast = bandFor('cadence', { speedMs: 4.5 });
    assert(slow && fast, 'both bands must resolve');
    assert(fast.optimal[0] > slow.optimal[0],
        'the cadence target must rise with speed; a fixed 180 rule is folklore');
    note(`cadence optimal ${slow.optimal.join('-')} at 2.5 m/s, ${fast.optimal.join('-')} at 4.5 m/s`);
});

test('without a speed, a speed-conditional band refuses rather than guessing', () => {
    assertEqual(bandFor('cadence', { speedMs: null }), null,
        'scoring cadence against the wrong speed band is worse than not scoring it');
    assert(bandFor('trunkLean', { speedMs: null }) != null, 'unconditional bands still resolve');
});

test('a low-confidence metric is never scored', () => {
    const metrics = {
        trunkLean: {
            label: 'Trunk lean', sides: { L: { value: 7, confidence: 'low' }, R: { value: 7, confidence: 'low' } },
            combined: { value: 7, confidence: 'low' }, asymmetryIndex: null, confidence: 'low'
        }
    };
    const s = scoreAnalysis(metrics, { speedMs: 3.0 });
    assertEqual(s.perMetric.trunkLean.combined.score, null, 'no score from an untrusted number');
    assertEqual(s.perMetric.trunkLean.sides.L.score, null);
    assert(/confidence is low/.test(s.perMetric.trunkLean.sides.L.reason), 'and it must say why');
});

test('there are four dimension scores and NO single overall score', () => {
    const ids = Object.keys(GTR.scores.dimensions).sort();
    assertEqual(ids.join(','), 'contact,posture,symmetry,timing');
    assertEqual(DIMENSIONS.length, 4);
    assert(GTR.scores.overall === undefined, 'the result must not carry an overall form score');
    assert(!('formScore' in GTR), 'no form score out of 100, by design');
    for (const id of ids) {
        const d = GTR.scores.dimensions[id];
        if (d.score != null) assertBetween(d.score, 0, 1, `${id} score in [0,1]`);
        assert(Array.isArray(d.contributors), `${id} must decompose into its contributors`);
    }
});

test('every dimension score decomposes into named, sourced contributors', () => {
    for (const id of ['timing', 'posture', 'contact']) {
        const d = GTR.scores.dimensions[id];
        if (!d.available) continue;
        assert(d.contributors.length > 0, `${id} must list what produced it`);
        for (const c of d.contributors) {
            assert(METRIC_BY_ID[c.id], `${id} contributor ${c.id} must be a real metric`);
            assert(REFERENCE_BY_ID[c.source], `${id} contributor ${c.id} cites ${c.source}, which must resolve`);
            assert(STRENGTH_WEIGHT[c.strength] != null, `evidence strength ${c.strength} must be known`);
        }
    }
});

test('the symmetry dimension is built from asymmetry indices', () => {
    const asym = synthGait({ fps: 240, durationS: 6, asymmetry: 0.12 });
    const r = runPipeline(asym.series, { heightM: 1.75, surface: 'treadmill', speedMs: asym.params.speedMs });
    const sym = r.scores.dimensions.symmetry;
    const clean = GTR.scores.dimensions.symmetry;
    assert(sym.score < clean.score, `an asymmetric runner must score lower on symmetry (${sym.score} vs ${clean.score})`);
});

group('Data integrity — reviewable without reading code');

test('every normative band resolves to a real reference', () => {
    for (const b of NORMS) {
        assert(REFERENCE_BY_ID[b.source], `band for ${b.metric} cites unknown source ${b.source}`);
        assert(METRIC_BY_ID[b.metric], `band references unknown metric ${b.metric}`);
        assert(STRENGTH_WEIGHT[b.strength] != null, `unknown evidence strength ${b.strength}`);
    }
});

test('every band has optimal inside acceptable, and ordered', () => {
    for (const b of NORMS) {
        assert(b.optimal[0] < b.optimal[1], `${b.metric}: optimal band must be ordered`);
        assert(b.acceptable[0] < b.acceptable[1], `${b.metric}: acceptable band must be ordered`);
        assert(b.acceptable[0] <= b.optimal[0] && b.acceptable[1] >= b.optimal[1],
            `${b.metric}: optimal must sit inside acceptable`);
    }
});

test('unsourced bands are labelled unsourced and weighted lowest', () => {
    const placeholder = REFERENCE_BY_ID['indicative-unsourced'];
    assert(placeholder, 'the honest placeholder must exist');
    assert(/not traced to a primary source/i.test(placeholder.title + placeholder.used),
        'and it must say plainly what it is');
    for (const b of NORMS) {
        if (b.source !== 'indicative-unsourced') continue;
        assertEqual(b.strength, 'consensus-only', `${b.metric}: an unsourced band must be consensus-only`);
    }
    assert(STRENGTH_WEIGHT['consensus-only'] < STRENGTH_WEIGHT.moderate, 'and must count for least');
});

test('the metric catalogue is complete and self-describing', () => {
    assertEqual(new Set(METRICS.map(m => m.id)).size, METRICS.length, 'metric ids are unique');
    assert(METRICS.length >= 30, `expected the full metric set, got ${METRICS.length}`);
    for (const m of METRICS) {
        assert(m.label && m.definition && m.formula, `${m.id} must carry a label, a definition and a formula`);
        assert(['sagittal', 'frontal'].includes(m.view), `${m.id} view`);
        assert(DIMENSIONS.some(d => d.id === m.dimension) || m.dimension === 'spatial',
            `${m.id} dimension ${m.dimension} must be known`);
    }
    for (const id of SYMMETRY_SOURCES) assert(METRIC_BY_ID[id], `symmetry source ${id} must be a real metric`);
});

test('the projection angle and the proxy are never described as what they are not', () => {
    assert(/projection/i.test(METRIC_BY_ID.fppa.definition), 'FPPA must state it is a projection angle');
    assert(/not true knee valgus/i.test(METRIC_BY_ID.fppa.definition), 'and must say what it is not');
    assert(/proxy/i.test(METRIC_BY_ID.rearfootProxy.definition), 'the rearfoot metric must call itself a proxy');
});

test('every rule resolves to real exercises and real references', () => {
    assertEqual(new Set(RULES.map(r => r.id)).size, RULES.length, 'rule ids are unique');
    for (const r of RULES) {
        assert(r.finding && r.mechanism && r.cue, `${r.id} must state a finding, a mechanism and a cue`);
        assert(r.exercises.length >= 1 && r.exercises.length <= 4, `${r.id} must prescribe 1-4 exercises`);
        for (const e of r.exercises) assert(EXERCISE_BY_ID[e], `${r.id} prescribes unknown exercise ${e}`);
        for (const ref of r.references) assert(REFERENCE_BY_ID[ref], `${r.id} cites unknown reference ${ref}`);
        assert(typeof r.priority === 'number', `${r.id} must have a priority`);
    }
});

test('every exercise carries dosage, cues and a contraindication', () => {
    assertEqual(new Set(EXERCISES.map(e => e.id)).size, EXERCISES.length, 'exercise ids are unique');
    for (const e of EXERCISES) {
        assert(e.dosage, `${e.id} must state a dosage`);
        assert(e.cues.length >= 2, `${e.id} must give cues`);
        assert(e.contraindications && /stop|hold|back off/i.test(e.contraindications),
            `${e.id} must carry a safety line`);
    }
});

test('the plan is capped at three findings', () => {
    assertEqual(MAX_FINDINGS, 3, 'a report listing eleven faults is not actionable');
    /* a deliberately poor runner should trip several rules and still be capped */
    const bad = synthGait({
        fps: 240, durationS: 8, cadenceSpm: 140, dutyFactor: 0.42,
        trunkLeanDeg: -3, strikeAngleDeg: 22, vertOscM: 0.16, asymmetry: 0.14, speedMs: 3.2
    });
    const r = runPipeline(bad.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.2 });
    assert(r.ok, r.message);
    assert(r.findings.length <= MAX_FINDINGS, `got ${r.findings.length} findings`);
    for (const f of r.findings) assert(f.evidence && f.cue, 'every finding must show its evidence and give a cue');
    note(`poor runner: ${r.findings.length} shown, ${r.findingsSuppressed} suppressed`);
});

test('rules never fire on a metric the engine does not trust', () => {
    /* At 30 fps the timing metrics are unavailable, so no rule may cite one. */
    const g = synthGait({ fps: 30, durationS: 8, cadenceSpm: 140 });
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 });
    for (const f of r.findings) {
        if (!f.detail || !f.detail.metric) continue;
        const m = r.metrics[f.detail.metric];
        assert(m.confidence !== 'unavailable' && m.confidence !== 'low',
            `finding ${f.id} cites ${f.detail.metric}, which is ${m.confidence}`);
    }
});

test('the low-cadence rule is suppressed when speed is unknown', () => {
    const slow = synthGait({ fps: 240, durationS: 6, cadenceSpm: 140, speedMs: 3.0 });
    const withSpeed = recommend(runPipeline(slow.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 }).metrics, { speedMs: 3.0 });
    const noSpeed = recommend(runPipeline(slow.series, { heightM: 1.75, surface: 'treadmill' }).metrics, { speedMs: null });
    assert(withSpeed.findings.some(f => f.id === 'low-cadence'), 'with a speed, the rule can fire');
    assert(!noSpeed.findings.some(f => f.id === 'low-cadence'),
        'without a speed there is no right cadence band, so the rule must stay silent');
});

/* ============================================================
   8. Golden values — any change here must be justified
   ============================================================ */

group('Golden values');

test('a fixed synthetic clip produces the committed numbers', () => {
    /* Two assertions per quantity, and they check different things.

       Against GOLDEN: pins the engine. If one of these moves, the engine
       changed. That is allowed — but it has to be recorded in DECISIONS.md
       with a reason, not quietly re-baselined until the suite goes green.

       Against TRUTH: pins the engine to reality. A golden file alone will
       happily preserve a bug forever, because it only ever asks whether today
       matches yesterday. */
    const g = synthGait({
        seed: 20260831, fps: 240, durationS: 6, heightM: 1.78, speedMs: 3.2,
        cadenceSpm: 172, dutyFactor: 0.33, strikeAngleDeg: 11, trunkLeanDeg: 6,
        vertOscM: 0.082, asymmetry: 0.04
    });
    const r = runPipeline(g.series, { heightM: 1.78, surface: 'treadmill', speedMs: 3.2 });
    assert(r.ok, r.message);

    const got = {
        cadence: r.metrics.cadence.combined.value,
        gctL: r.metrics.gct.sides.L.value,
        gctR: r.metrics.gct.sides.R.value,
        dutyL: r.metrics.dutyFactor.sides.L.value,
        stepLengthL: r.metrics.stepLength.sides.L.value,
        verticalOscillation: r.metrics.verticalOscillation.combined.value,
        trunkLean: r.metrics.trunkLean.combined.value,
        footStrikeAngleL: r.metrics.footStrikeAngle.sides.L.value,
        overstrideL: r.metrics.overstride.sides.L.value
    };

    /* engine golden — tight */
    const golden = {
        cadence: 171.95, gctL: 217.83, gctR: 228.98, dutyL: 0.3120,
        stepLengthL: 1.1163, verticalOscillation: 8.596, trunkLean: 6.000,
        footStrikeAngleL: 10.851, overstrideL: 11.197
    };
    const goldenTol = {
        cadence: 0.05, gctL: 0.5, gctR: 0.5, dutyL: 0.001, stepLengthL: 0.002,
        verticalOscillation: 0.02, trunkLean: 0.02, footStrikeAngleL: 0.05, overstrideL: 0.05
    };
    for (const k of Object.keys(golden)) assertClose(got[k], golden[k], goldenTol[k], `golden ${k}`);

    /* physical truth — looser, because this is where real error lives */
    const truth = {
        cadence: g.truth.cadenceSpm,
        gctL: g.truth.gctMs.L, gctR: g.truth.gctMs.R,
        dutyL: g.truth.dutyFactor.L,
        stepLengthL: g.truth.stepLengthM,
        verticalOscillation: g.truth.vertOscStrideM * 100,
        trunkLean: g.truth.trunkLeanDeg,
        footStrikeAngleL: g.truth.strikeAngleDeg,
        overstrideL: g.truth.overstrideFracHeight
    };
    const truthTol = {
        cadence: 1.5, gctL: 12, gctR: 12, dutyL: 0.02, stepLengthL: 0.02,
        verticalOscillation: 0.4, trunkLean: 0.5, footStrikeAngleL: 1.5, overstrideL: 2.0
    };
    for (const k of Object.keys(truth)) assertClose(got[k], truth[k], truthTol[k], `truth ${k}`);

    note(Object.keys(got).map(k => `${k}=${got[k].toFixed(3)}`).join('  '));
});

test('the engine reports its own version and settings with every result', () => {
    assertEqual(GTR.engine.version, ENGINE_VERSION);
    assertEqual(GTR.engine.filterCutoffHz, 12);
    assertEqual(GTR.engine.stage2, 'not-shipped', 'no learned model ships in this build, and the result says so');
    assert(GTR.capture.measuredFps > 0, 'the measured frame rate is recorded, not the declared one');
});

test('the stage-2 hook accepts a model when one is supplied', () => {
    /* No model ships, but the fusion path must be real and exercised, or it
       will not work the day one is trained. */
    const g = synthGait({ fps: 240, durationS: 5 });
    const stage2 = {
        strikes: g.truth.strikes.map(s => ({ t: s.t, side: s.side })),
        toeoffs: g.truth.toeoffs.map(s => ({ t: s.t, side: s.side }))
    };
    const r = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0, stage2 });
    assert(r.ok, r.message);
    assertEqual(r.engine.stage2, 'present');
    const withModel = r.metrics.gct.sides.L.value;
    const without = runPipeline(g.series, { heightM: 1.75, surface: 'treadmill', speedMs: 3.0 }).metrics.gct.sides.L.value;
    assertClose(withModel, g.truth.gctMs.L, 10, 'a perfect stage-2 model must not make the answer worse');
    note(`geometry only ${without.toFixed(1)} ms, with a perfect stage-2 voter ${withModel.toFixed(1)} ms, truth ${g.truth.gctMs.L.toFixed(1)} ms`);
});

summary();
