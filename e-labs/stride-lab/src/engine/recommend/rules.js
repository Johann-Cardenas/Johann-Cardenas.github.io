/* ============================================================
   Stride Lab — Stage L. The recommendation rules, as data.

   Deterministic predicates over the scored metrics. No language
   model, no opaque classifier: a person has to be able to read the
   rule that fired, see the number that triggered it, and disagree.

   Two constraints that are not negotiable:

     1. A rule may only fire on metrics at MEDIUM confidence or
        better. Advice built on a measurement the engine has already
        flagged as unreliable is worse than no advice, because it
        looks the same as advice that is not.
     2. The plan is capped at THREE findings. A report listing eleven
        faults is the standard failure mode of automated gait
        analysis: it is not actionable, and a runner given eleven
        things to fix changes nothing.
   ============================================================ */

import { atLeast, ASYMMETRY_NOTABLE } from '../types.js';

/** Read a metric's value only if it is trustworthy enough to act on. */
function v(m, id, side) {
    const met = m[id];
    if (!met) return null;
    const slot = side ? met.sides[side] : (met.combined || met.sides.L);
    if (!slot || slot.value == null) return null;
    if (!atLeast(slot.confidence, 'medium')) return null;
    return slot.value;
}

/** Worst of the two sides for a metric, by a comparator. */
function worst(m, id, cmp) {
    const l = v(m, id, 'L'), r = v(m, id, 'R');
    if (l == null && r == null) return null;
    if (l == null) return { side: 'R', value: r };
    if (r == null) return { side: 'L', value: l };
    return cmp(l, r) ? { side: 'L', value: l } : { side: 'R', value: r };
}
const higher = (a, b) => a >= b;

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {number} priority          1 = address first
 * @property {(m:any, ctx:any) => (false | {evidence: string, detail?: object})} when
 * @property {string} finding           plain language, no jargon
 * @property {string} mechanism         why it matters, one sentence, sourced
 * @property {string} cue               one thing to try while running
 * @property {string[]} exercises
 * @property {string[]} references
 * @property {(m:any, ctx:any) => boolean} [guard]  suppress if this is true
 */

/** @type {Rule[]} */
export const RULES = [
    {
        id: 'overstride',
        priority: 1,
        when: (m) => {
            const w = worst(m, 'overstride', higher);
            const shank = worst(m, 'shankAngleContact', higher);
            if (!w || w.value <= 13) return false;
            return {
                evidence: `Your foot lands about ${w.value.toFixed(0)}% of your height ahead of your hips on the ${side(w.side)}`
                    + (shank ? `, with the shin tilted ${shank.value.toFixed(0)} degrees back from vertical` : '') + '.',
                detail: { metric: 'overstride', side: w.side, value: w.value }
            };
        },
        finding: 'You land with your foot well ahead of your hips',
        mechanism: 'A foot planted far in front of the body arrives with the shin angled backward, which lengthens the braking phase of each step; landing closer to underneath the hips shortens it.',
        cue: 'Think about picking the feet up quicker rather than reaching them further forward. The stride shortens by itself.',
        exercises: ['high-cadence-strides', 'ankling', 'wall-drill-posture'],
        references: ['pagnon-2024', 'indicative-unsourced']
    },
    {
        id: 'low-cadence',
        priority: 2,
        when: (m, ctx) => {
            const c = v(m, 'cadence');
            if (c == null) return false;
            const target = ctx.speedMs != null && ctx.speedMs >= 4.0 ? 166
                : ctx.speedMs != null && ctx.speedMs >= 3.0 ? 156 : 145;
            if (c >= target) return false;
            return {
                evidence: `Your cadence is ${c.toFixed(0)} steps per minute`
                    + (ctx.speedMs != null ? ` at ${ctx.speedMs.toFixed(1)} m/s` : '') + '.',
                detail: { metric: 'cadence', value: c, target }
            };
        },
        finding: 'Your step rate is low for the speed you were running',
        mechanism: 'Step rate and step length trade off at a given speed, so a low turnover generally means a longer reach in front of the body.',
        cue: 'Run 20 seconds at a metronome set 5% above your current cadence, at the same speed, a few times in an easy run.',
        exercises: ['high-cadence-strides', 'ankling'],
        references: ['moore-2016', 'indicative-unsourced'],
        /* Do not tell somebody to raise a cadence that is only low because we
           could not measure their speed and picked the wrong reference band. */
        guard: (m, ctx) => ctx.speedMs == null
    },
    {
        id: 'pelvic-drop',
        priority: 1,
        when: (m) => {
            const w = worst(m, 'pelvicDrop', higher);
            if (!w || w.value <= 10) return false;
            return {
                evidence: `While you are on your ${side(w.side)} leg, the opposite hip drops about ${w.value.toFixed(0)} degrees.`,
                detail: { metric: 'pelvicDrop', side: w.side, value: w.value }
            };
        },
        finding: 'Your hip drops on the swing side during single-leg support',
        mechanism: 'Pelvic drop is the frontal-plane variable most consistently reported alongside running injury in the literature. That is an association in a population, not a prediction about you.',
        cue: 'Run tall and think about keeping the hips level, as though carrying a tray on your waistband.',
        exercises: ['single-leg-glute-bridge', 'side-plank-hip-abduction', 'step-down'],
        references: ['indicative-unsourced']
    },
    {
        id: 'crossover',
        priority: 2,
        when: (m) => {
            const w = worst(m, 'stepWidth', (a, b) => a <= b);
            if (!w || w.value >= -1) return false;
            return {
                evidence: `Your feet land about ${Math.abs(w.value).toFixed(0)}% of a leg length across the midline.`,
                detail: { metric: 'stepWidth', side: w.side, value: w.value }
            };
        },
        finding: 'Your feet cross the midline as you land',
        mechanism: 'A narrow or crossing foot placement increases the sideways lever between the foot and the body center, which is described alongside iliotibial band problems in the literature.',
        cue: 'Imagine running with one foot either side of a narrow line rather than along it.',
        exercises: ['lateral-band-walk', 'single-leg-balance', 'step-down'],
        references: ['indicative-unsourced']
    },
    {
        id: 'excessive-vertical',
        priority: 3,
        when: (m) => {
            const vr = v(m, 'verticalRatio');
            const vo = v(m, 'verticalOscillation');
            if (vr == null || vr <= 11) return false;
            return {
                evidence: `You move up and down ${vo != null ? vo.toFixed(1) + ' cm, which is ' : ''}${vr.toFixed(1)}% of your step length.`,
                detail: { metric: 'verticalRatio', value: vr }
            };
        },
        finding: 'More of your effort goes upward than forward',
        mechanism: 'Vertical oscillation relative to step length is one of the technique variables associated with running economy; some bounce is unavoidable and useful, but a high ratio means the energy is not going into travel.',
        cue: 'Aim to run quietly and keep the head at a steady height, as if under a low ceiling.',
        exercises: ['high-cadence-strides', 'a-skip'],
        references: ['folland-2017', 'moore-2016']
    },
    {
        id: 'stiff-landing',
        priority: 2,
        when: (m) => {
            const w = worst(m, 'kneeFlexionContact', (a, b) => a <= b);
            if (!w || w.value >= 6) return false;
            return {
                evidence: `Your ${side(w.side)} knee is only ${w.value.toFixed(0)} degrees bent at the moment of landing.`,
                detail: { metric: 'kneeFlexionContact', side: w.side, value: w.value }
            };
        },
        finding: 'You land on a nearly straight knee',
        mechanism: 'A knee arriving close to straight has little range left to absorb the landing with, so more of it is taken by the skeleton than by the muscles.',
        cue: 'Let the knee soften as the foot arrives. This usually follows on its own from landing closer under the hips.',
        exercises: ['step-down', 'high-cadence-strides', 'calf-raise-eccentric'],
        references: ['indicative-unsourced']
    },
    {
        id: 'asymmetry',
        priority: 1,
        when: (m) => {
            let worstId = null, worstAi = 0;
            for (const id of ['gct', 'stepLength', 'peakKneeFlexionStance', 'pelvicDrop', 'footStrikeAngle']) {
                const met = m[id];
                if (!met || met.asymmetryIndex == null || !atLeast(met.confidence, 'medium')) continue;
                if (met.asymmetryIndex > worstAi) { worstAi = met.asymmetryIndex; worstId = id; }
            }
            if (!worstId || worstAi <= ASYMMETRY_NOTABLE) return false;
            return {
                evidence: `Left and right differ by ${worstAi.toFixed(0)}% on ${m[worstId].label.toLowerCase()}.`,
                detail: { metric: worstId, value: worstAi }
            };
        },
        finding: 'Your two sides are doing noticeably different things',
        mechanism: 'A side-to-side difference of this size is larger than the stride-to-stride variation in this clip, so it is unlikely to be measurement noise. It says nothing on its own about why.',
        cue: 'Record a second clip on another day before acting on this — a single clip cannot separate a habit from how you felt that morning.',
        exercises: ['single-leg-balance', 'step-down', 'single-leg-glute-bridge'],
        references: ['stenum-2021']
    },
    {
        id: 'trunk-upright',
        priority: 3,
        when: (m) => {
            const t = v(m, 'trunkLean');
            if (t == null || t >= 2) return false;
            return {
                evidence: `Your trunk sits ${t.toFixed(0)} degrees from vertical at mid-stance.`,
                detail: { metric: 'trunkLean', value: t }
            };
        },
        finding: 'You run very upright, or slightly behind vertical',
        mechanism: 'A small forward lean from the ankles is associated with landing closer under the body; leaning back tends to go with reaching the foot forward.',
        cue: 'Lean forward a little from the ankles, not the waist, keeping the body in one line.',
        exercises: ['wall-drill-posture', 'hip-flexor-stretch'],
        references: ['folland-2017']
    },
    {
        id: 'limited-hip-extension',
        priority: 3,
        when: (m) => {
            const w = worst(m, 'hipExtensionToeoff', (a, b) => a <= b);
            if (!w || w.value >= 5) return false;
            return {
                evidence: `Your ${side(w.side)} thigh only reaches ${w.value.toFixed(0)} degrees behind the trunk at toe-off.`,
                detail: { metric: 'hipExtensionToeoff', side: w.side, value: w.value }
            };
        },
        finding: 'The leg does not travel far behind you before it swings through',
        mechanism: 'Limited hip extension shortens the part of stance that pushes you forward, and is often accompanied by a compensating arch in the lower back.',
        cue: 'Think about finishing each step behind you rather than reaching for the next one.',
        exercises: ['hip-flexor-stretch', 'single-leg-glute-bridge', 'a-skip'],
        references: ['indicative-unsourced']
    },
    {
        id: 'arm-crossing',
        priority: 4,
        when: (m) => {
            const w = worst(m, 'elbowAngle', higher);
            if (!w || w.value <= 125) return false;
            return {
                evidence: `Your ${side(w.side)} elbow stays at about ${w.value.toFixed(0)} degrees, close to straight.`,
                detail: { metric: 'elbowAngle', side: w.side, value: w.value }
            };
        },
        finding: 'Your arms swing long and low',
        mechanism: 'A long arm has a larger moment of inertia, so swinging it costs more and tends to pull the trunk into rotation.',
        cue: 'Carry the hands a little higher with the elbows nearer a right angle, swinging from the shoulder.',
        exercises: ['arm-swing-drill'],
        references: ['indicative-unsourced']
    }
];

function side(s) { return s === 'L' ? 'left' : 'right'; }

/** Findings are capped at this many, deliberately. */
export const MAX_FINDINGS = 3;

/**
 * Run the rules and return at most MAX_FINDINGS findings, highest priority
 * first and, within a priority, the ones with the strongest evidence.
 */
export function recommend(metrics, ctx) {
    const fired = [];
    for (const rule of RULES) {
        if (rule.guard && rule.guard(metrics, ctx)) continue;
        let hit;
        try { hit = rule.when(metrics, ctx); } catch { hit = false; }
        if (!hit) continue;
        fired.push({
            id: rule.id,
            priority: rule.priority,
            finding: rule.finding,
            mechanism: rule.mechanism,
            cue: rule.cue,
            evidence: hit.evidence,
            detail: hit.detail || null,
            exercises: rule.exercises,
            references: rule.references
        });
    }
    fired.sort((a, b) => a.priority - b.priority);
    return { findings: fired.slice(0, MAX_FINDINGS), suppressed: Math.max(0, fired.length - MAX_FINDINGS) };
}
