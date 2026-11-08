import { median, atLeast } from '../types.js';
import { METRIC_BY_ID } from '../metrics/catalog.js';
import { bandFor, STRENGTH_WEIGHT } from './norms.js';
import { scoreValue } from './score.js';

// Completed cycles only: deterministic when playing, seeking or stepping backward.
// A four-second median rejects isolated tracking spikes without hiding changes
// behind a whole-clip average. Both feet must contribute before judging form.
export function movementAt(result, time) {
    const samples = (result.movementSamples || []).filter(s => s.end <= time && s.end + 4 > time);
    const ctx = { speedMs: result.capture.speedMs, sex: null };
    const empty = { stride: null, cadence: null, spm: null, cycles: samples.length };
    if (!['L', 'R'].every(side => samples.some(s => s.side === side))) return empty;
    const trusted = m => m && m.value != null && atLeast(m.confidence, 'medium');
    let total = 0, weight = 0;
    for (const [id, metric] of Object.entries(result.metrics)) {
        if (METRIC_BY_ID[id]?.dimension !== 'contact') continue;
        const band = bandFor(id, ctx);
        if (!band) continue;
        const sides = [];
        for (const side of ['L', 'R']) {
            if (!trusted(metric.sides?.[side])) continue;
            const values = samples.filter(s => s.side === side).map(s => s.values[id]).filter(Number.isFinite);
            if (values.length) sides.push(scoreValue(median(values), band));
        }
        if (sides.length !== 2) continue;
        const w = STRENGTH_WEIGHT[band.strength] ?? 0.3;
        total += w * (sides[0] + sides[1]) / 2;
        weight += w;
    }
    const durations = samples.map(s => s.values.strideTime).filter(v => Number.isFinite(v) && v > 0);
    const spm = trusted(result.metrics.cadence?.combined) && durations.length
        ? 120000 / median(durations) : null;
    return {
        stride: weight ? total / weight : null,
        cadence: spm == null ? null : scoreValue(spm, bandFor('cadence', ctx)),
        spm, cycles: samples.length
    };
}

// Scores change only at cycle completions and four-second window expirations.
// Precompute those boundaries once; playback and sparklines share this model.
export function movementTimeline(result) {
    const boundaries = new Set([result.series?.t?.[0] ?? 0]);
    for (const sample of result.movementSamples || []) if (Number.isFinite(sample.end)) {
        boundaries.add(sample.end); boundaries.add(sample.end + 4);
    }
    return [...boundaries].sort((a, b) => a - b).map(time => ({ time, ...movementAt(result, time) }));
}

export function timelineIndex(timeline, time) {
    let lo = 0, hi = timeline.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (timeline[mid].time <= time) lo = mid + 1; else hi = mid;
    }
    return Math.max(0, lo - 1);
}
