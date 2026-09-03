/* ============================================================
   Stride Lab — Stage H', the learned gait-phase model.

   READ THIS BEFORE LOOKING FOR THE MODEL FILE. There isn't one.

   What ships in this build is the GEOMETRIC detector in detect.js,
   and it ships alone. No stance-phase model is included, because
   training one honestly needs running video with force-plate or
   instrumented-treadmill ground truth, split by SUBJECT rather than
   by clip, and none was available here. Shipping a model trained on
   nothing, or quoting an accuracy figure from somebody else's paper
   as though it were ours, would be the dishonest options.

   What ships instead is this: the complete inference and fusion
   path, so a model can be dropped in and be a first-class voter the
   day one exists, plus a training script under training/ that says
   exactly how to make it. `loadStage2` returns null when the file is
   absent, every caller handles null, and the analysis metadata
   records `stage2: 'not-shipped'` so a result can never imply a
   capability the build does not have.

   What NOT to build, and why it was rejected outright: a black-box
   model that outputs a "running form score". There is no labeled
   ground truth for good form, the output would be unauditable, and
   explainability is the entire product.

   The model this is designed for, per the specification:

     Model A — per-frame gait phase segmentation
       Input   [B, 14, 128] at a fixed 200 Hz, every channel
               scale-invariant: lengths over leg length, velocities
               over sqrt(g * legLength). Feeding raw pixels teaches
               the model the camera instead of the gait.
       Output  [B, 2, 128] logits -> sigmoid -> P(stance left/right)
       Post    threshold 0.5, morphological open/close to remove
               segments under 80 ms, then rising and falling edges
               are foot strike and toe-off, refined to sub-frame by
               interpolating the probability crossing.
       Fusion  one more weighted voter in detect.js at weight 1.5,
               and geometry-only when it is absent or uncertain.
   ============================================================ */

import { G, indexAtTime, sampleAt } from '../types.js';
import { kneeInteriorSeries } from '../metrics/angles.js';

export const STAGE2_CHANNELS = [
    'heelL_y', 'heelR_y', 'toeL_y', 'toeR_y',
    'ankleL_vy', 'ankleR_vy', 'ankleL_vx', 'ankleR_vx',
    'kneeL_angle', 'kneeR_angle', 'hipMid_vy',
    'footL_vx_rel_hip', 'footR_vx_rel_hip', 'ankle_angle_diff'
];
export const STAGE2_WINDOW = 128;
export const STAGE2_RATE_HZ = 200;
export const MIN_STANCE_MS = 80;

/**
 * Try to load a stage-2 ONNX model. Returns null — quietly and by design —
 * when no model file is present, which is the case in this build.
 *
 * @param {string} url
 * @returns {Promise<{session:any, run:(t:Float32Array)=>Promise<Float32Array>}|null>}
 */
export async function loadStage2(url) {
    if (!url) return null;
    try {
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok) return null;
    } catch {
        return null;
    }
    try {
        const ort = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.mjs');
        /* WASM, not WebGPU: this is a 120k-parameter model and the
           compatibility risk buys nothing. One session, created once. */
        const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
        return {
            session,
            async run(input) {
                const tensor = new ort.Tensor('float32', input, [1, STAGE2_CHANNELS.length, STAGE2_WINDOW]);
                const out = await session.run({ [session.inputNames[0]]: tensor });
                return out[session.outputNames[0]].data;
            }
        };
    } catch {
        return null;
    }
}

/**
 * Build the scale-invariant input tensor for one window.
 *
 * Every channel is normalized: lengths by leg length, velocities by
 * sqrt(g * legLength), angles by 180 degrees. A model fed unnormalized pixel
 * coordinates learns the camera distance of its training set and generalizes
 * to nothing.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {number} legLengthPx
 * @param {number} startS
 * @returns {Float32Array}
 */
export function buildWindow(cond, legLengthPx, startS) {
    const C = STAGE2_CHANNELS.length;
    const out = new Float32Array(C * STAGE2_WINDOW);
    const { kp, t } = cond;
    const L = legLengthPx > 0 ? legLengthPx : 1;
    /* velocity scale: sqrt(g * legLength) in pixel units, so the normalization
       is dimensionless and independent of how big the runner is in frame */
    const legM = 0.491 * 1.75;
    const pxPerM = L / legM;
    const vScale = Math.sqrt(G * legM) * pxPerM;

    const kneeL = kneeInteriorSeries(cond, 'L');
    const kneeR = kneeInteriorSeries(cond, 'R');

    const hipY0 = sampleAt(kp.hipMid.y, indexAtTime(startS, t));

    for (let k = 0; k < STAGE2_WINDOW; k++) {
        const tt = startS + k / STAGE2_RATE_HZ;
        const i = indexAtTime(tt, t);
        const g = (arr) => sampleAt(arr, i);
        const ch = [
            (g(kp.heelL.y) - hipY0) / L, (g(kp.heelR.y) - hipY0) / L,
            (g(kp.toeL.y) - hipY0) / L, (g(kp.toeR.y) - hipY0) / L,
            g(kp.ankleL.vy) / vScale, g(kp.ankleR.vy) / vScale,
            g(kp.ankleL.vx) / vScale, g(kp.ankleR.vx) / vScale,
            g(kneeL) / 180, g(kneeR) / 180,
            g(kp.hipMid.vy) / vScale,
            (g(kp.footL.vx) - g(kp.hipMid.vx)) / vScale,
            (g(kp.footR.vx) - g(kp.hipMid.vx)) / vScale,
            (g(kneeL) - g(kneeR)) / 180
        ];
        for (let c = 0; c < C; c++) out[c * STAGE2_WINDOW + k] = Number.isFinite(ch[c]) ? ch[c] : 0;
    }
    return out;
}

/**
 * Turn per-frame stance probabilities into events.
 * Morphological cleanup first — a three-frame blip is not a stance phase — then
 * the rising and falling edges, refined to sub-frame by interpolating where the
 * probability crossed 0.5.
 *
 * @param {Float32Array} probs  [2 * T], left then right
 * @param {number} startS
 * @returns {{strikes:{t:number,side:'L'|'R'}[], toeoffs:{t:number,side:'L'|'R'}[]}}
 */
export function decodeStance(probs, startS) {
    const T = probs.length / 2;
    const strikes = [], toeoffs = [];
    const minRun = Math.round(MIN_STANCE_MS / 1000 * STAGE2_RATE_HZ);

    for (const [c, side] of [[0, 'L'], [1, 'R']]) {
        const p = new Float64Array(T);
        for (let i = 0; i < T; i++) p[i] = 1 / (1 + Math.exp(-probs[c * T + i]));
        const on = new Uint8Array(T);
        for (let i = 0; i < T; i++) on[i] = p[i] >= 0.5 ? 1 : 0;
        removeShortRuns(on, 1, minRun);
        removeShortRuns(on, 0, minRun);

        for (let i = 1; i < T; i++) {
            if (on[i] && !on[i - 1]) {
                strikes.push({ t: startS + subFrame(p, i, true) / STAGE2_RATE_HZ, side });
            } else if (!on[i] && on[i - 1]) {
                toeoffs.push({ t: startS + subFrame(p, i, false) / STAGE2_RATE_HZ, side });
            }
        }
    }
    return { strikes, toeoffs };
}

function removeShortRuns(arr, value, minRun) {
    let i = 0;
    while (i < arr.length) {
        if (arr[i] !== value) { i++; continue; }
        let j = i;
        while (j < arr.length && arr[j] === value) j++;
        if (j - i < minRun) for (let k = i; k < j; k++) arr[k] = value ? 0 : 1;
        i = j;
    }
}

/** Where the probability crossed 0.5 between samples i-1 and i. */
function subFrame(p, i, rising) {
    const a = p[i - 1], b = p[i];
    const span = b - a;
    void rising;
    return span !== 0 ? (i - 1) + (0.5 - a) / span : i;
}

/**
 * Run the model over a whole clip and produce candidate events for the vote.
 * Returns null whenever the model is absent, which is how this build runs.
 */
export async function runStage2(model, cond, legLengthPx) {
    if (!model) return null;
    const duration = cond.t[cond.n - 1] - cond.t[0];
    const windowS = STAGE2_WINDOW / STAGE2_RATE_HZ;
    const hop = windowS * 0.5;
    const strikes = [], toeoffs = [];
    for (let s = cond.t[0]; s + windowS <= cond.t[0] + duration; s += hop) {
        const input = buildWindow(cond, legLengthPx, s);
        const probs = await model.run(input);
        const ev = decodeStance(probs, s);
        /* keep only the middle half of each window: the edges see less context
           and the windows overlap, so the interior is both better and enough */
        const lo = s + windowS * 0.25, hi = s + windowS * 0.75;
        strikes.push(...ev.strikes.filter(e => e.t >= lo && e.t < hi));
        toeoffs.push(...ev.toeoffs.filter(e => e.t >= lo && e.t < hi));
    }
    return { strikes, toeoffs };
}
