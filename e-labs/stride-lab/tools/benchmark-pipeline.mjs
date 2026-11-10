// Deterministic whole-pipeline workloads. Optional reference JSON verifies every
// serialized output, except elapsedMs, before reporting paired speed ratios.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { synthGait } from '../src/synth/gait.js';
import { runPipeline } from '../src/engine/analyze.js';

const expected = JSON.parse(readFileSync(new URL('../test/fixtures/pipeline-digests.json', import.meta.url), 'utf8'));
const reference = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : null;
const cases = [];
for (const fps of [30, 120, 240]) for (const noiseFrac of [0, 0.02]) {
    const { series } = synthGait({ fps, durationS: 6, seed: 23, rigidLegs: true, noiseFrac });
    const opts = { heightM: 1.75, fps, surface: 'treadmill', speedMs: 3.3, view: 'sagittal' };
    const name = `${fps}fps-noise${noiseFrac}`;
    let result;
    for (let i = 0; i < 2; i++) result = runPipeline(series, opts);
    const times = [];
    for (let i = 0; i < 7; i++) {
        const start = performance.now();
        result = runPipeline(series, opts);
        times.push(performance.now() - start);
    }
    if (!result.ok) throw new Error(`${name}: ${result.message}`);
    const digest = createHash('sha256').update(JSON.stringify(result,
        (key, value) => key === 'elapsedMs' ? undefined : value)).digest('hex');
    const prior = reference?.cases.find(c => c.name === name);
    if (expected.cases.find(c => c.name === name)?.digest !== digest
        || (reference && (!prior || prior.digest !== digest))) throw new Error(`${name}: numerical output changed`);
    times.sort((a, b) => a - b);
    cases.push({ name, frames: series.n, medianMs: times[3], minMs: times[0], digest,
        ...(prior ? { speedup: prior.medianMs / times[3] } : {}) });
}
console.log(JSON.stringify({ node: process.version, runs: 7, cases }, null, 2));
