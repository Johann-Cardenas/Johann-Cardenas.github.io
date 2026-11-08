// Paired deterministic trials. No downloads or dependencies. Output JSON for
// inspection or redirection; runtime depends on the machine, error does not.
import { synthGait } from '../src/synth/gait.js';
import { condition } from '../src/engine/signal/condition.js';
import { fitKinematicModel } from '../src/engine/model/kinematic.js';
import { kneeFlexionSeries } from '../src/engine/metrics/angles.js';

function rms(a, b, fps) {
    if (a.length !== b.length) throw new Error('Benchmark trajectory lengths differ.');
    let sum = 0, count = 0;
    for (let i = Math.round(fps / 2); i < a.length - fps / 2; i++) {
        if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
        sum += (a[i] - b[i]) ** 2; count++;
    }
    if (count < 0.9 * (a.length - fps)) throw new Error('Benchmark has insufficient finite trajectory support.');
    const error = Math.sqrt(sum / count);
    if (!Number.isFinite(error)) throw new Error('Benchmark produced a non-finite error.');
    return error;
}
const cells = [];
for (const fps of [60, 120, 240]) for (const noiseFrac of [0, 0.01, 0.02, 0.04]) {
    const totals = { framewise: { error: 0, ms: 0 }, adaptive: { error: 0, ms: 0 } };
    for (const seed of [3, 7, 14, 23, 41]) {
        const opts = { fps, durationS: 4, seed, rigidLegs: true, cadenceSpm: 155 + seed % 40 };
        const clean = condition(synthGait(opts).series, { fps });
        const noisy = condition(synthGait({ ...opts, noiseFrac }).series, { fps });
        const truth = ['L', 'R'].map(s => kneeFlexionSeries(clean, s));
        for (const [name, temporal] of [['framewise', false], ['adaptive', 'adaptive']]) {
            const start = performance.now();
            const model = fitKinematicModel(noisy, { temporal });
            if (!model.available) throw new Error(`Benchmark model unavailable: ${model.reason}`);
            totals[name].ms += performance.now() - start;
            totals[name].error += (rms(model.angles.L.kneeFlex, truth[0], fps)
                + rms(model.angles.R.kneeFlex, truth[1], fps)) / 2;
        }
    }
    const cell = { fps, noiseFrac, trials: 5,
        framewiseKneeRmsDeg: totals.framewise.error / 5,
        adaptiveKneeRmsDeg: totals.adaptive.error / 5,
        framewiseMs: totals.framewise.ms / 5, adaptiveMs: totals.adaptive.ms / 5 };
    if (noiseFrac === 0 && Math.abs(cell.adaptiveKneeRmsDeg - cell.framewiseKneeRmsDeg) > 1e-9)
        throw new Error(`Clean trajectory changed at ${fps} fps.`);
    if (cell.adaptiveKneeRmsDeg > cell.framewiseKneeRmsDeg * 1.01 + 0.01)
        throw new Error(`Adaptive model regressed at ${fps} fps, noise ${noiseFrac}.`);
    cells.push(cell);
}
console.log(JSON.stringify({ passed: true, reference: 'direct knee angles from conditioned noise-free synthetic rigid runners; not clinical validation', cells }, null, 2));
