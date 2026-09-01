/* ============================================================
   Stride Lab — normative bands, as reviewable DATA.

   A domain reviewer must be able to read this file, check every
   threshold against its cited source, and disagree with it — without
   reading any TypeScript or JavaScript elsewhere. That is the whole
   point of keeping it here rather than inline in the scoring code.

   Bands are SPEED-CONDITIONAL where the target genuinely moves with
   speed. Cadence is the obvious case: a fixed "180 steps per minute"
   rule is folklore, it comes from a count of elite athletes racing,
   and applying it to somebody running at 2.8 m/s gives bad advice.
   Where a band is not conditioned, it says so by carrying a single
   entry with an open speed range.

   `strength` drives how much a metric contributes to its dimension
   score. `consensus-only` bands cite `indicative-unsourced` and are
   scored at the lowest weight, because that is what they are worth.
   ============================================================ */

/**
 * @typedef {Object} NormBand
 * @property {string} metric
 * @property {{speedMs?: [number, number], sex?: 'm'|'f'|'any', side?: 'L'|'R'|'any'}} conditions
 * @property {[number, number]} optimal
 * @property {[number, number]} acceptable
 * @property {'higher-better'|'lower-better'|'target-range'} direction
 * @property {string} source           must resolve in scoring/references.js
 * @property {'strong'|'moderate'|'weak'|'consensus-only'} strength
 * @property {string} [comment]
 */

const ANY = { speedMs: [0, 99], sex: 'any' };

/** @type {NormBand[]} */
export const NORMS = [
    /* ---------------- Timing ---------------- */
    {
        metric: 'cadence',
        conditions: { speedMs: [0, 3.0], sex: 'any' },
        optimal: [155, 172], acceptable: [145, 182],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Easy pace. Cadence rises with speed, so this band is deliberately lower than the one above it; a single 180 target applied here would be wrong for most runners.'
    },
    {
        metric: 'cadence',
        conditions: { speedMs: [3.0, 4.0], sex: 'any' },
        optimal: [166, 182], acceptable: [156, 192],
        direction: 'target-range',
        source: 'vanhooren-2024', strength: 'weak',
        comment: 'The DIRECTION here is sourced: a higher cadence has a small but significant association with better running economy (r = -0.20). The band EDGES are not sourced, and they are the part that decides whether your number is called typical.'
    },
    {
        metric: 'cadence',
        conditions: { speedMs: [4.0, 99], sex: 'any' },
        optimal: [176, 194], acceptable: [166, 204],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'gct',
        conditions: { speedMs: [0, 3.0], sex: 'any' },
        optimal: [225, 290], acceptable: [190, 330],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Contact time shortens with speed. Deliberately NOT scored as lower-is-better: Lussiana et al. show shorter contact is not universally more economical, and Van Hooren et al. found contact time to have a trivial, non-significant association with running economy across the pooled literature.'
    },
    {
        metric: 'gct',
        conditions: { speedMs: [3.0, 4.0], sex: 'any' },
        optimal: [195, 255], acceptable: [165, 295],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'gct',
        conditions: { speedMs: [4.0, 99], sex: 'any' },
        optimal: [160, 210], acceptable: [140, 245],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'flightTime',
        conditions: ANY,
        optimal: [85, 145], acceptable: [60, 180],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'dutyFactor',
        conditions: ANY,
        optimal: [0.30, 0.38], acceptable: [0.26, 0.44],
        direction: 'target-range',
        source: 'vanhooren-2024', strength: 'consensus-only',
        comment: 'This band described duty factor as a well-evidenced economy correlate until the 2024 meta-analysis was read properly. It is not one: pooled across studies, duty factor has a TRIVIAL and non-significant association with running economy (r = -0.06), as does ground contact time (r = -0.02). The range is retained because it describes an ordinary running stride and because the stiffness model needs contact time, but it is weighted at the lowest evidence level and nothing in this app should suggest that moving it improves anything.'
    },

    /* ---------------- Spatial ---------------- */
    {
        metric: 'verticalOscillation',
        conditions: ANY,
        optimal: [6.5, 10.5], acceptable: [5.0, 13.0],
        direction: 'target-range',
        source: 'folland-2017', strength: 'weak',
        comment: 'Pelvis excursion, which approximates the centre of mass without being it. The centre-of-mass version below is the quantity the evidence is about, and it is the one to read.'
    },
    {
        metric: 'verticalRatio',
        conditions: ANY,
        optimal: [5.5, 8.5], acceptable: [4.0, 11.0],
        direction: 'lower-better',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Vertical oscillation normalised by step length. More informative than raw oscillation because it does not punish a long stride.'
    },

    /* ---------------- Contact ---------------- */
    {
        metric: 'shankAngleContact',
        conditions: ANY,
        optimal: [0, 8], acceptable: [-4, 14],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'A near-vertical shank at contact indicates the foot landed under the body rather than out in front.'
    },
    {
        metric: 'overstride',
        conditions: ANY,
        optimal: [0, 8], acceptable: [-2, 13],
        direction: 'lower-better',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Ankle ahead of the hip at contact, as a percentage of standing height.'
    },
    {
        metric: 'kneeFlexionContact',
        conditions: ANY,
        optimal: [12, 24], acceptable: [6, 32],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'A knee that arrives almost straight has little left to absorb with.'
    },
    {
        metric: 'peakKneeFlexionStance',
        conditions: ANY,
        optimal: [35, 48], acceptable: [28, 56],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },

    /* ---------------- Posture ---------------- */
    {
        metric: 'trunkLean',
        conditions: ANY,
        optimal: [4, 10], acceptable: [0, 15],
        direction: 'target-range',
        source: 'folland-2017', strength: 'weak',
        comment: 'Trunk SEGMENT relative to vertical. Definitions differ widely between studies and a number measured from the ankle is much larger; comparing this figure with one from another tool is only meaningful if both use the same definition.'
    },
    {
        metric: 'pelvicDrop',
        conditions: ANY,
        optimal: [0, 5], acceptable: [-2, 10],
        direction: 'lower-better',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Pelvic drop is the frontal-plane variable most often reported alongside running injury, and that literature is real. These THRESHOLDS are not traced to it here, so the band is weighted as consensus-only even though the underlying variable is better evidenced than most. Note also what the association means: it is a population-level association with injury, and this app measures an angle. It does not predict injury.'
    },
    {
        metric: 'stepWidth',
        conditions: ANY,
        optimal: [2, 14], acceptable: [-2, 22],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'Negative means the feet cross the midline. Crossover gait is a commonly described pattern, not a diagnosis.'
    },
    {
        metric: 'comVerticalOscillation',
        conditions: ANY,
        optimal: [5.5, 9.0], acceptable: [4.0, 11.5],
        direction: 'lower-better',
        source: 'vanhooren-2024', strength: 'moderate',
        comment: 'The DIRECTION is the best-evidenced finding available to this app: less vertical displacement of the centre of mass is associated with better running economy, moderate effect (r = 0.35), pooled across the observational literature. The band EDGES are not sourced. Note also the size of the effect the same review reports: technique variables together explain 4-12% of the differences in running economy between people.'
    },
    {
        metric: 'verticalStiffness',
        conditions: ANY,
        optimal: [26, 40], acceptable: [18, 50],
        direction: 'higher-better',
        source: 'vanhooren-2024', strength: 'moderate',
        comment: 'Higher vertical stiffness is associated with better running economy, moderate effect (r = -0.31). The value itself is a spring-mass model estimate (Morin et al. 2005), not a measurement, and it moves with body mass and speed as much as with technique.'
    },
    {
        metric: 'legStiffness',
        conditions: ANY,
        optimal: [10, 16], acceptable: [7, 20],
        direction: 'higher-better',
        source: 'vanhooren-2024', strength: 'moderate',
        comment: 'Higher leg stiffness is associated with better running economy, moderate effect (r = -0.28). Same caveat: a model estimate, not a measurement.'
    },
    {
        metric: 'headOscillation',
        conditions: ANY,
        optimal: [4.0, 9.0], acceptable: [3.0, 12.0],
        direction: 'lower-better',
        source: 'indicative-unsourced', strength: 'consensus-only',
        comment: 'A head that moves less than the pelvis is what people describe as running smoothly. Included because it is measurable and interpretable, not because a study says it matters.'
    },
    {
        metric: 'forwardHeadPosture',
        conditions: ANY,
        optimal: [-1, 4], acceptable: [-3, 8],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'elbowAngle',
        conditions: ANY,
        optimal: [72, 100], acceptable: [55, 120],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    },
    {
        metric: 'headAngle',
        conditions: ANY,
        optimal: [-4, 10], acceptable: [-12, 20],
        direction: 'target-range',
        source: 'indicative-unsourced', strength: 'consensus-only'
    }
];

/**
 * The band that applies to a value, given the covariates.
 * Returns null when no band covers this metric — which is a legitimate answer
 * and is displayed as "no reference band", not as a perfect score.
 */
export function bandFor(metricId, ctx) {
    const speed = Number.isFinite(ctx && ctx.speedMs) ? ctx.speedMs : null;
    const candidates = NORMS.filter(b => b.metric === metricId);
    if (!candidates.length) return null;
    if (speed == null) {
        /* Without a speed we cannot pick a speed-conditional band. Rather than
           guessing the middle one, refuse: a cadence scored against the wrong
           speed band is worse than an unscored cadence. */
        const open = candidates.find(b => !b.conditions.speedMs || (b.conditions.speedMs[0] === 0 && b.conditions.speedMs[1] >= 99));
        return open || null;
    }
    return candidates.find(b => {
        const s = b.conditions.speedMs;
        return !s || (speed >= s[0] && speed < s[1]);
    }) || null;
}

/** Evidence weight applied to a metric's contribution to its dimension score. */
export const STRENGTH_WEIGHT = {
    strong: 1.0,
    moderate: 0.75,
    weak: 0.5,
    'consensus-only': 0.3
};
