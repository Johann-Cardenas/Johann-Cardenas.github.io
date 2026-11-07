/* ============================================================
   Stride Lab — the efficiency report.

   The question a runner actually asks is not "what is my knee
   angle" but "what would make this cheaper". This module answers
   the part of that question mechanics can answer, and says plainly
   where mechanics stops.

   Three pieces:

   1. WHERE THE WORK GOES. The measured mechanical work per meter,
      split into vertical (bounce), forward (braking and re-launch)
      and internal (legs, arms, trunk), from energetics.js.

   2. A CADENCE SWEEP. Two classical models with opposite slopes:
        - the spring-mass model (Morin et al. 2005): at a fixed speed
          and contact time, a higher step rate means shorter flights,
          a smaller bounce, less vertical work;
        - Minetti's internal-work equation (Minetti 1998): a higher
          step rate means swinging the limbs more often, more internal
          work.
      Their sum has a minimum. Both are CALIBRATED to this runner
      where the clip measured the quantity they predict, so the curve
      passes through the runner's own numbers and the models supply
      only the slopes. The result is the step rate at which the two
      trade off, the flat region around it, and what a 5% change in
      either direction would do.

   3. LEVERS, RANKED BY EVIDENCE. Each variable that plausibly moves
      the cost, with the pooled association it actually has with
      running economy (Van Hooren et al. 2024) and, where a model
      exists, a priced effect. Evidence first, because a large modeled
      saving on a variable the literature cannot connect to economy is
      a hypothesis, and a small one on a variable it can is a lead.

   What this cannot say, and the report repeats: mechanical work is
   not metabolic cost; technique explains a small share (4-12%) of the
   economy differences between people; and a model optimum is a
   prediction about a person who changes ONE thing, which nobody does.
   ============================================================ */

import { G, mean, trimmedMean, median } from '../types.js';
import { minettiInternalWork, springMassExcursion, MINETTI_Q } from './energetics.js';

/** Pooled correlations with running economy, Van Hooren et al. (2024). */
export const ECONOMY_EVIDENCE = {
    comVerticalOscillation: { r: 0.35, strength: 'moderate', significant: true, better: 'lower' },
    verticalStiffness: { r: -0.31, strength: 'moderate', significant: true, better: 'higher' },
    legStiffness: { r: -0.28, strength: 'small', significant: true, better: 'higher' },
    cadence: { r: -0.20, strength: 'small', significant: true, better: 'higher' },
    gct: { r: -0.02, strength: 'trivial', significant: false },
    dutyFactor: { r: -0.06, strength: 'trivial', significant: false },
    braking: { r: null, strength: 'trivial', significant: false },
    internalWork: { r: null, strength: 'untested', significant: false }
};
const EVIDENCE_RANK = { moderate: 3, small: 2, trivial: 1, untested: 0 };

/** Sweep range, as a fraction of the runner's own cadence. */
export const SWEEP_SPAN = 0.20;
/** Calibration factors outside this range mean the model does not describe
    the runner, and the uncalibrated model is used instead (and said so). */
const CALIB_LIMITS = [1 / 3, 3];

/**
 * Model mechanical work per meter as a function of step rate.
 *
 * @param {{speedMs:number, contactS:number, userSpm:number,
 *          kVertical?:number, qInternal?:number, forwardJkgm?:number}} o
 */
export function cadenceSweep(o) {
    const { speedMs: v, contactS: tc, userSpm } = o;
    if (!(v > 0) || !(tc > 0) || !(userSpm > 0)) return null;
    const kv = o.kVertical ?? 1;
    const q = o.qInternal ?? MINETTI_Q;
    const wf = Number.isFinite(o.forwardJkgm) ? o.forwardJkgm : 0;
    const at = (spm) => {
        const ts = 60 / spm;
        const tf = ts - tc;
        if (!(tf >= 0)) return null;
        const h = springMassExcursion(tc, tf) * kv;
        const vertical = G * h / (v * ts);
        const duty = tc / (2 * ts);
        const internal = minettiInternalWork(1 / (2 * ts), v, duty, q);
        return { spm, excursionCm: h * 100, vertical, internal, forward: wf, total: vertical + internal + wf };
    };
    const lo = Math.ceil(userSpm * (1 - SWEEP_SPAN)), hi = Math.floor(userSpm * (1 + SWEEP_SPAN));
    const points = [];
    for (let spm = lo; spm <= hi; spm++) { const p = at(spm); if (p) points.push(p); }
    if (points.length < 5) return null;
    let best = points[0];
    for (const p of points) if (p.total < best.total) best = p;
    /* the flat region: every step rate within 1% of the minimum */
    const flat = points.filter(p => p.total <= best.total * 1.01).map(p => p.spm);
    const user = at(userSpm);
    const up = at(userSpm * 1.05), down = at(userSpm * 0.95);
    const pct = (a, b) => (a && b ? 100 * (a.total - b.total) / b.total : null);
    return {
        points,
        optimumSpm: best.spm,
        optimum: best,
        flatBand: [Math.min(...flat), Math.max(...flat)],
        user,
        userPenaltyPct: user ? 100 * (user.total - best.total) / best.total : null,
        plus5: up ? { deltaPct: pct(up, user), excursionCm: up.excursionCm - user.excursionCm, vertical: up.vertical - user.vertical, internal: up.internal - user.internal } : null,
        minus5: down ? { deltaPct: pct(down, user), excursionCm: down.excursionCm - user.excursionCm } : null,
        assumptions: [
            'contact time is held at the measured value while step rate changes',
            'forward (braking) work is held at the measured value — the sweep moves only the bounce and the limb swing',
            `internal work follows Minetti (1998) with q = ${q.toFixed(3)}${o.qInternal != null ? ', calibrated to this clip' : ''}`
        ]
    };
}

/**
 * @param {Record<string, any>} metrics          aggregated metrics
 * @param {{speedMs:number|null, model:any, workPerStride:any[], springCheck:any,
 *          fps:number, view:string}} ctx
 */
export function efficiencyReport(metrics, ctx) {
    const missing = [];
    const valueOf = (id, side) => {
        const m = metrics[id];
        if (!m) return null;
        const slot = side ? m.sides[side] : (m.combined || null);
        if (slot && slot.value != null) return slot.value;
        if (!side && m.sided) {
            const vals = ['L', 'R'].map(s => m.sides[s].value).filter(v => v != null);
            return vals.length ? mean(vals) : null;
        }
        return null;
    };
    const confOf = (id) => (metrics[id] ? metrics[id].confidence : 'unavailable');

    if (ctx.view !== 'sagittal') {
        return { available: false, reason: 'The efficiency analysis needs a side-on (sagittal) view.' };
    }
    if (!ctx.model || !ctx.model.available) {
        return { available: false, reason: (ctx.model && ctx.model.reason) || 'The rigid-body model could not be fitted to this clip.' };
    }

    const v = ctx.speedMs;
    const cadence = valueOf('cadence');
    const gct = valueOf('gct');
    const duty = valueOf('dutyFactor');
    const comOsc = valueOf('comVerticalOscillation');

    /* ---- where the work goes ---- */
    let work = null;
    const ws = ctx.workPerStride || [];
    if (ws.length) {
        const agg = (fn) => trimmedMean(ws.map(fn), 0.1);
        work = {
            n: ws.length,
            vertical: agg(w => w.vertical),
            forward: agg(w => w.forward),
            external: agg(w => w.external),
            internal: {
                total: agg(w => w.internal.total),
                legs: agg(w => w.internal.legs),
                arms: agg(w => w.internal.arms),
                hat: agg(w => w.internal.hat)
            },
            trunkRotationShare: agg(w => w.internal.total > 0 ? w.trunkRot / w.internal.total : NaN)
        };
        work.total = work.external + work.internal.total;
        /* shares of the total; the external split uses its components'
           proportions, since vertical + forward can exceed their combined
           increments by whatever energy they exchanged */
        if (Number.isFinite(work.total) && work.total > 0) {
            const extParts = work.vertical + work.forward;
            const extScale = extParts > 0 ? work.external / extParts : 1;
            work.shares = {
                vertical: 100 * work.vertical * extScale / work.total,
                forward: 100 * work.forward * extScale / work.total,
                legs: 100 * work.internal.legs / work.total,
                arms: 100 * work.internal.arms / work.total,
                hat: 100 * work.internal.hat / work.total
            };
        }
        work.confidence = confOf('totalMechanicalWork') !== 'unavailable' ? confOf('totalMechanicalWork') : confOf('internalWork');
    } else {
        missing.push(Number.isFinite(v) ? 'the mechanical work could not be summed over any stride' : 'work per meter needs the speed — enter the belt speed on a treadmill');
    }

    /* ---- Minetti cross-check ---- */
    let minetti = null;
    if (Number.isFinite(v) && cadence && duty) {
        const predicted = minettiInternalWork(cadence / 120, v, duty);
        const measured = work ? work.internal.total : null;
        minetti = {
            predicted,
            measured,
            ratio: measured && predicted ? measured / predicted : null,
            q: MINETTI_Q
        };
    }

    /* ---- the sweep ---- */
    let sweep = null;
    if (Number.isFinite(v) && cadence && gct) {
        const tc = gct / 1000;
        /* calibrate the vertical term to the measured bounce */
        const base = cadenceSweep({ speedMs: v, contactS: tc, userSpm: cadence });
        let kv = null, qi = null;
        const calibration = [];
        if (base && base.user && comOsc != null) {
            const k = (comOsc) / base.user.excursionCm;
            if (k >= CALIB_LIMITS[0] && k <= CALIB_LIMITS[1]) { kv = k; calibration.push('vertical'); }
            else calibration.push(`vertical not calibrated (measured bounce is ${k.toFixed(2)}x the model's)`);
        }
        if (minetti && minetti.ratio != null) {
            const k = minetti.ratio;
            if (k >= CALIB_LIMITS[0] && k <= CALIB_LIMITS[1]) { qi = MINETTI_Q * k; calibration.push('internal'); }
            else calibration.push(`internal not calibrated (measured is ${k.toFixed(2)}x Minetti)`);
        }
        sweep = cadenceSweep({
            speedMs: v, contactS: tc, userSpm: cadence,
            kVertical: kv ?? undefined, qInternal: qi ?? undefined,
            forwardJkgm: work && Number.isFinite(work.forward) ? work.forward : undefined
        });
        if (sweep) {
            sweep.calibration = calibration;
            sweep.calibrated = { vertical: kv != null, internal: qi != null };
            sweep.inFlatBand = cadence >= sweep.flatBand[0] && cadence <= sweep.flatBand[1];
        }
    } else {
        if (!Number.isFinite(v)) missing.push('the cadence sweep needs the running speed');
        else if (!gct) missing.push('the cadence sweep needs contact time, which needs 60 fps or more');
    }

    /* ---- levers ---- */
    const levers = [];
    const stepLen = Number.isFinite(v) && cadence ? v * 60 / cadence : null;
    const totalRef = work && Number.isFinite(work.total) ? work.total : (sweep && sweep.user ? sweep.user.total : null);

    if (comOsc != null) {
        const perCm = stepLen ? G * 0.01 / stepLen : null;
        levers.push({
            id: 'bounce', title: 'Bounce', metric: 'comVerticalOscillation', value: comOsc, unit: 'cm',
            evidence: { ...ECONOMY_EVIDENCE.comVerticalOscillation, source: 'vanhooren-2024' },
            confidence: confOf('comVerticalOscillation'),
            modeled: perCm ? {
                perUnit: perCm,
                deltaPct: totalRef ? -100 * perCm / totalRef : null,
                text: `−1 cm bounce ≈ −${perCm.toFixed(3)} J/kg/m`
                    + (totalRef ? ` (−${(100 * perCm / totalRef).toFixed(1)}% of your mechanical work).` : '.')
            } : null,
            advice: 'Less is associated with better economy. Bounce is mostly set by flight time, so it falls when step rate rises at the same speed; it is not something to suppress directly.'
        });
    }
    if (cadence != null) {
        levers.push({
            id: 'cadence', title: 'Step rate', metric: 'cadence', value: cadence, unit: 'steps/min',
            evidence: { ...ECONOMY_EVIDENCE.cadence, source: 'vanhooren-2024' },
            confidence: confOf('cadence'),
            modeled: sweep && sweep.plus5 ? {
                deltaPct: sweep.plus5.deltaPct,
                text: (sweep.inFlatBand
                    ? `In the flat zone (${sweep.flatBand[0]}–${sweep.flatBand[1]} steps/min).`
                    : `Model minimum ${sweep.optimumSpm} steps/min; now ${sweep.userPenaltyPct.toFixed(1)}% above it.`)
                    + ` +5% step rate: ${fmtPct(sweep.plus5.deltaPct)} work, −${Math.abs(sweep.plus5.excursionCm).toFixed(1)} cm bounce.`
            } : null,
            advice: 'Higher is associated with better economy, weakly. Change it in steps of about 5% at the same speed, not all at once.'
        });
    }
    for (const id of ['verticalStiffness', 'legStiffness']) {
        const val = valueOf(id);
        if (val == null) continue;
        levers.push({
            id, title: id === 'verticalStiffness' ? 'Vertical stiffness' : 'Leg stiffness', metric: id, value: val, unit: 'kN/m',
            evidence: { ...ECONOMY_EVIDENCE[id], source: 'vanhooren-2024' },
            confidence: confOf(id),
            modeled: null,
            check: ctx.springCheck || null,
            advice: 'Higher is associated with better economy. Stiffness responds to plyometric and strength training more reliably than to a running cue.'
        });
    }
    if (work && Number.isFinite(work.forward) && work.shares) {
        const fs = valueOf('footSpeedContact');
        levers.push({
            id: 'braking', title: 'Braking and re-launch', metric: 'externalWorkForward', value: work.forward, unit: 'J/kg/m',
            evidence: { ...ECONOMY_EVIDENCE.braking, source: 'vanhooren-2024' },
            confidence: confOf('externalWorkForward'),
            modeled: { deltaPct: null, share: work.shares.forward, text: `${work.shares.forward.toFixed(0)}% of your mechanical work${fs != null ? `; foot ${fs.toFixed(1)} m/s forward just before contact` : ''}.` },
            advice: 'Mechanically real, but the pooled evidence finds braking measures unrelated to running economy, so this is a description, not a target.'
        });
    }
    if (work && Number.isFinite(work.internal.total)) {
        const kneeSwing = valueOf('peakKneeFlexionSwing');
        levers.push({
            id: 'limbs', title: 'Swinging the limbs', metric: 'internalWork', value: work.internal.total, unit: 'J/kg/m',
            evidence: { ...ECONOMY_EVIDENCE.internalWork, source: 'minetti-1998' },
            confidence: confOf('internalWork'),
            modeled: {
                deltaPct: null,
                share: work.shares ? work.shares.legs + work.shares.arms : null,
                text: `${work.shares ? (work.shares.legs + work.shares.arms).toFixed(0) + '% of your mechanical work (' : '('}legs ${work.internal.legs.toFixed(2)}, arms ${work.internal.arms.toFixed(2)} J/kg/m)`
                    + (kneeSwing != null ? `; swing knee ${kneeSwing.toFixed(0)}°.` : '.')
            },
            advice: 'Internal work rises with step rate — it is the cost the sweep trades against bounce. Its link to economy has not been tested in the pooled literature.'
        });
    }
    levers.sort((a, b) => (EVIDENCE_RANK[b.evidence.strength] - EVIDENCE_RANK[a.evidence.strength])
        || (Math.abs(b.modeled && b.modeled.deltaPct || 0) - Math.abs(a.modeled && a.modeled.deltaPct || 0)));

    return {
        available: true,
        speedMs: Number.isFinite(v) ? v : null,
        cadence, work, minetti, sweep, levers,
        springCheck: ctx.springCheck || null,
        fit: ctx.model.fit,
        missing,
        caveats: [
            'Mechanical work is not metabolic cost: muscle efficiency, elastic return and the cost of holding force sit between them.',
            'Technique explains roughly 4-12% of the differences in economy between runners (Van Hooren et al. 2024).',
            'Two-dimensional: motion out of the camera plane is not counted, so internal work is underestimated.'
        ]
    };
}

function fmtPct(p) {
    if (p == null || !Number.isFinite(p)) return '—';
    return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export { median };
