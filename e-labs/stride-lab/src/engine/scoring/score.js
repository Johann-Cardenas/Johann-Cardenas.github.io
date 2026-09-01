/* ============================================================
   Stride Lab — Stage K. Scoring.

   Transparent, auditable, reversible. Every score decomposes into
   "this metric, this measured value, this reference band, this
   source, this evidence weight", and the UI shows that decomposition
   rather than a number to be taken on trust.

   There is deliberately NO single 0-100 form score. Compressing
   independent, non-commensurable dimensions into one figure invites
   comparison between people that the measurement cannot support, and
   it cannot be explained when somebody asks why it moved. Four
   dimension scores, each expandable into the metrics that produced
   it, say strictly more and claim strictly less.
   ============================================================ */

import { DIMENSIONS, SYMMETRY_SOURCES, METRIC_BY_ID } from '../metrics/catalog.js';
import { bandFor, STRENGTH_WEIGHT } from './norms.js';
import { atLeast, clamp, ASYMMETRY_ATTENTION, ASYMMETRY_NOTABLE } from '../types.js';

/**
 * Score one measured value against its band.
 *
 *   s = clamp(1 - |value - centre(optimal)| / halfWidth(acceptable), 0, 1)
 *
 * so a value in the middle of the optimal band scores 1, a value at the edge
 * of the acceptable band scores 0, and everything outside scores 0 rather than
 * going negative.
 */
export function scoreValue(value, band) {
    if (!band || !Number.isFinite(value)) return null;
    const centre = (band.optimal[0] + band.optimal[1]) / 2;
    const half = Math.max(1e-9, (band.acceptable[1] - band.acceptable[0]) / 2);
    return clamp(1 - Math.abs(value - centre) / half, 0, 1);
}

/** Where a value sits relative to its bands, for the UI's range bar. */
export function bandStatus(value, band) {
    if (!band || !Number.isFinite(value)) return 'unscored';
    if (value >= band.optimal[0] && value <= band.optimal[1]) return 'optimal';
    if (value >= band.acceptable[0] && value <= band.acceptable[1]) return 'acceptable';
    return 'outside';
}

/**
 * @param {Record<string, any>} metrics  output of computeMetrics
 * @param {{speedMs:number|null, sex?:string}} ctx
 */
export function scoreAnalysis(metrics, ctx) {
    /** @type {Record<string, any>} */
    const perMetric = {};

    for (const id of Object.keys(metrics)) {
        const m = metrics[id];
        const spec = METRIC_BY_ID[id];
        if (!spec) continue;
        const band = bandFor(id, ctx);
        const entry = { id, band: band || null, sides: {}, combined: null };

        for (const side of ['L', 'R']) {
            const v = m.sides[side];
            /* A score is not computed at all below medium confidence. A
               low-confidence measurement scored against a band produces a
               confident-looking judgement resting on a number the engine has
               already said it does not trust. */
            const eligible = v && v.value != null && atLeast(v.confidence, 'medium');
            entry.sides[side] = {
                score: eligible ? scoreValue(v.value, band) : null,
                status: eligible ? bandStatus(v.value, band) : 'unscored',
                reason: !v || v.value == null
                    ? 'not measured'
                    : !atLeast(v.confidence, 'medium')
                        ? `confidence is ${v.confidence}`
                        : !band ? 'no reference band for this metric' : null
            };
        }
        if (m.combined) {
            const eligible = m.combined.value != null && atLeast(m.combined.confidence, 'medium');
            entry.combined = {
                score: eligible ? scoreValue(m.combined.value, band) : null,
                status: eligible ? bandStatus(m.combined.value, band) : 'unscored'
            };
        }
        perMetric[id] = entry;
    }

    /* ---- symmetry, built from the asymmetry indices -------------------- */
    const asym = [];
    for (const id of SYMMETRY_SOURCES) {
        const m = metrics[id];
        if (!m || m.asymmetryIndex == null || !atLeast(m.confidence, 'medium')) continue;
        asym.push({ id, label: m.label, ai: m.asymmetryIndex });
    }
    const worstAi = asym.length ? Math.max(...asym.map(a => a.ai)) : null;

    /* ---- dimension scores ---------------------------------------------- */
    const dimensions = {};
    for (const dim of DIMENSIONS) {
        if (dim.id === 'symmetry') {
            const score = worstAi == null ? null
                : clamp(1 - worstAi / (2 * ASYMMETRY_NOTABLE), 0, 1);
            dimensions.symmetry = {
                id: 'symmetry', label: dim.label, blurb: dim.blurb,
                score,
                contributors: asym.map(a => ({
                    id: a.id, label: a.label, value: a.ai,
                    status: a.ai <= ASYMMETRY_ATTENTION ? 'optimal'
                        : a.ai <= ASYMMETRY_NOTABLE ? 'acceptable' : 'outside'
                })),
                available: score != null,
                note: score == null
                    ? 'Needs both sides measured at medium confidence or better.'
                    : `Largest side-to-side difference: ${worstAi.toFixed(1)}%.`
            };
            continue;
        }

        const contributors = [];
        let num = 0, den = 0;
        for (const id of Object.keys(perMetric)) {
            const spec = METRIC_BY_ID[id];
            if (!spec || spec.dimension !== dim.id) continue;
            const e = perMetric[id];
            if (!e.band) continue;
            const w = STRENGTH_WEIGHT[e.band.strength] ?? 0.3;
            const scores = spec.sided
                ? ['L', 'R'].map(s => e.sides[s].score).filter(v => v != null)
                : (e.combined && e.combined.score != null ? [e.combined.score] : []);
            if (!scores.length) continue;
            const s = scores.reduce((a, b) => a + b, 0) / scores.length;
            num += w * s; den += w;
            contributors.push({
                id, label: metrics[id].label, score: s, weight: w,
                strength: e.band.strength, source: e.band.source,
                status: spec.sided ? e.sides.L.status : e.combined.status
            });
        }
        dimensions[dim.id] = {
            id: dim.id, label: dim.label, blurb: dim.blurb,
            score: den > 0 ? num / den : null,
            contributors: contributors.sort((a, b) => a.score - b.score),
            available: den > 0,
            note: den > 0 ? null : 'No metric in this dimension was measured confidently enough to score.'
        };
    }

    return { perMetric, dimensions, worstAsymmetry: worstAi, asymmetries: asym };
}
