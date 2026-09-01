/* ============================================================
   Stride Lab — Stage J. Per-stride metrics, then robust aggregates.

   Rules that apply to every metric here:
     - computed per stride, then aggregated as a 10% trimmed mean
       with the SD across strides, first and last stride discarded;
     - left and right are ALWAYS reported separately, plus an
       asymmetry index. Averaging the two sides away is the commonest
       mistake in consumer running apps and it discards the most
       clinically interesting thing in the report;
     - every value carries its confidence and, where the error can be
       quantified, a 95% interval. A number without its interval is a
       fabrication dressed as an instrument reading.
   ============================================================ */

import {
    WINTER, STRIKE_ANGLE_REARFOOT_ABOVE, STRIKE_ANGLE_FOREFOOT_BELOW,
    FPS_TIMING_MIN, FPS_FULL_PRECISION, MISSING_FRACTION_LIMIT,
    median, sd, trimmedMean, asymmetryIndex, weakest, sampleAt, indexAtTime, mean
} from '../types.js';
import { METRICS, METRIC_BY_ID } from './catalog.js';
import { intervalUncertaintyMs, instantUncertaintyMs } from '../events/detect.js';
import { bodyCoM, springMassStiffness, brakingProfile } from './com.js';
import {
    kneeFlexionSeries, trunkLeanSeries, footAngleSeries, shankAngleSeries,
    hipExtensionSeries, ankleDorsiflexionSeries, elbowAngleSeries,
    upperArmAngleSeries, headAngleSeries, pelvicObliquitySeries, fppaSeries,
    lateralLeanSeries, rearfootProxySeries, axialRotationSeries
} from './angles.js';

/**
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {ReturnType<import('../calib/scale.js').perFrameScale>} scale
 * @param {ReturnType<import('../events/detect.js').detectEvents>} events
 * @param {{view:'sagittal'|'frontal', surface:string, speedMs:number|null,
 *          heightM:number, facing:'rear'|'front'}} ctx
 */
export function computeMetrics(cond, scale, events, ctx) {
    const { fps, kp, t: times } = cond;
    const view = ctx.view;

    /* Which anatomical side sits at larger x in the image. Every frontal-plane
       sign convention hangs off this, so it is measured once and reused. */
    const sideSign = Math.sign(median(diff(kp.hipR.x, kp.hipL.x))) || 1;

    /* ---- angle series, computed once ---------------------------------- */
    const S = {
        kneeFlex: { L: kneeFlexionSeries(cond, 'L'), R: kneeFlexionSeries(cond, 'R') },
        trunkLean: trunkLeanSeries(cond),
        footAngle: { L: footAngleSeries(cond, 'L'), R: footAngleSeries(cond, 'R') },
        shank: { L: shankAngleSeries(cond, 'L'), R: shankAngleSeries(cond, 'R') },
        hipExt: { L: hipExtensionSeries(cond, 'L'), R: hipExtensionSeries(cond, 'R') },
        ankleDf: { L: ankleDorsiflexionSeries(cond, 'L'), R: ankleDorsiflexionSeries(cond, 'R') },
        elbow: { L: elbowAngleSeries(cond, 'L'), R: elbowAngleSeries(cond, 'R') },
        upperArm: { L: upperArmAngleSeries(cond, 'L'), R: upperArmAngleSeries(cond, 'R') },
        head: headAngleSeries(cond),
        obliquity: pelvicObliquitySeries(cond),
        fppa: { L: fppaSeries(cond, 'L', sideSign), R: fppaSeries(cond, 'R', -sideSign) },
        lateral: lateralLeanSeries(cond),
        rearfoot: { L: rearfootProxySeries(cond, 'L'), R: rearfootProxySeries(cond, 'R') },
        shoulderRot: axialRotationSeries(cond, 'shoulderL', 'shoulderR'),
        pelvisRot: axialRotationSeries(cond, 'hipL', 'hipR')
    };

    /* The whole-body centre of mass, from a fourteen-segment inertial model.
       This is the reference for the best-evidenced technique variable in the
       literature, and it is not the pelvis: the swinging limbs move opposite
       to the trunk and partly cancel it. */
    const com = bodyCoM(cond);

    const val = (series, tSec) => sampleAt(series, indexAtTime(tSec, times));
    const scaleAt = (tSec) => sampleAt(scale.mPerPx, indexAtTime(tSec, times));

    /* ---- select the strides that count --------------------------------- */
    /* First and last strides go, always: a stride that touches the clip
       boundary has one event detected from a truncated trajectory. */
    const usable = events.strides.filter(s => s.valid && !s.lowConfidence);
    const bySide = { L: dropEnds(usable.filter(s => s.side === 'L')), R: dropEnds(usable.filter(s => s.side === 'R')) };

    /* ---- per-stride values --------------------------------------------- */
    /** @type {Record<string, {L:number[], R:number[]}>} */
    const per = {};
    const push = (id, side, v) => {
        if (!per[id]) per[id] = { L: [], R: [] };
        if (Number.isFinite(v)) per[id][side].push(v);
    };

    for (const side of ['L', 'R']) {
        const other = side === 'L' ? 'R' : 'L';
        for (const st of bySide[side]) {
            const t0 = st.strike.t;
            const t1 = st.nextStrike.t;
            const tOff = st.toeoff ? st.toeoff.t : NaN;
            const tOpp = st.oppStrike ? st.oppStrike.t : NaN;
            const tMid = Number.isFinite(tOff) ? t0 + (tOff - t0) / 2 : (t0 + t1) / 2;
            const mpp = scaleAt(tMid);
            const legPx = scale.legLengthPx;
            const heightPx = scale.heightPx;

            push('strideTime', side, st.strideTime * 1000);
            push('stepTime', side, st.stepTime * 1000);
            push('gct', side, st.stanceTime * 1000);
            push('flightTime', side, st.flightTime * 1000);
            push('dutyFactor', side, st.dutyFactor);

            /* --- spatial ------------------------------------------------ */
            const i0 = indexAtTime(t0, times), i1 = indexAtTime(t1, times);
            const vo = excursion(kp.hipMid.y, i0, i1) * mpp;
            push('verticalOscillation', side, vo * 100);

            /* Spatial measurements come from displacement, and displacement
               only exists when the frame is fixed to the world. On a treadmill
               it is not, and neither is it when a hand-held camera follows the
               runner — the two are indistinguishable in the data and both make
               a measured step length meaningless rather than merely noisy. */
            let stepLen, strideLen, speed;
            if (ctx.spatialFromDisplacement) {
                const xa = val(kp['ankle' + side].x, t0);
                const xb = val(kp['ankle' + other].x, tOpp);
                stepLen = Math.abs(xb - xa) * mpp;
                strideLen = Math.abs(val(kp['ankle' + side].x, t1) - val(kp['ankle' + side].x, t0)) * mpp;
                speed = strideLen / st.strideTime;
            } else {
                stepLen = Number.isFinite(ctx.speedMs) ? ctx.speedMs * st.stepTime : NaN;
                strideLen = Number.isFinite(stepLen) ? 2 * stepLen : NaN;
                speed = ctx.speedMs;
            }
            push('stepLength', side, stepLen);
            push('strideLength', side, strideLen);
            push('speed', side, speed);
            push('verticalRatio', side, Number.isFinite(stepLen) && stepLen > 0 ? 100 * vo / stepLen : NaN);

            /* --- sagittal angles ---------------------------------------- */
            push('trunkLean', side, val(S.trunkLean, tMid));
            push('footStrikeAngle', side, val(S.footAngle[side], t0));
            push('shankAngleContact', side, val(S.shank[side], t0));
            push('overstride', side, heightPx > 0
                ? 100 * (val(kp['ankle' + side].x, t0) - val(kp.hipMid.x, t0)) / heightPx
                : NaN);
            push('kneeFlexionContact', side, val(S.kneeFlex[side], t0));
            push('peakKneeFlexionStance', side, Number.isFinite(tOff)
                ? extremum(S.kneeFlex[side], indexAtTime(t0, times), indexAtTime(tOff, times), 'max')
                : NaN);
            push('kneeFlexionToeoff', side, val(S.kneeFlex[side], tOff));
            push('hipExtensionToeoff', side, val(S.hipExt[side], tOff));
            push('ankleDorsiflexionContact', side, val(S.ankleDf[side], t0));
            push('heelRecovery', side, Number.isFinite(tOff) && legPx > 0
                ? 100 * extremumOf(
                    diff(kp.hipMid.y, kp['heel' + side].y),
                    indexAtTime(tOff, times), indexAtTime(t1, times), 'min') / legPx
                : NaN);
            push('elbowAngle', side, windowMean(S.elbow[side], i0, i1));
            push('armSwingAmplitude', side, excursion(S.upperArm[side], i0, i1));
            push('headAngle', side, windowMean(S.head, i0, i1));

            /* --- frontal ------------------------------------------------- */
            /* Contralateral drop: positive when the SWING-side hip has fallen
               below the stance side. The sign flips with the stance side and
               with which anatomical side the camera puts at larger x, so both
               are folded in here rather than left to the reader. */
            const obliq = val(S.obliquity, tMid);
            push('pelvicDrop', side, (side === 'L' ? -1 : 1) * obliq * sideSign);
            push('fppa', side, Number.isFinite(tOff)
                ? val(S.fppa[side], peakTime(S.kneeFlex[side], times, t0, tOff))
                : NaN);
            push('trunkLateralLean', side, val(S.lateral, tMid) * sideSign * (side === 'L' ? -1 : 1));
            push('rearfootProxy', side, val(S.rearfoot[side], tMid));
            push('shoulderRotation', side, excursion(S.shoulderRot, i0, i1));
            push('pelvisRotation', side, excursion(S.pelvisRot, i0, i1));

            /* --- whole-body model ---------------------------------------- */
            push('comVerticalOscillation', side, excursion(com.y, i0, i1) * mpp * 100);
            push('headOscillation', side, excursion(kp.headCentre.y, i0, i1) * mpp * 100);
            push('forwardHeadPosture', side, heightPx > 0
                ? 100 * windowMean(diff(kp.headCentre.x, kp.shoulderMid.x), i0, i1) / heightPx
                : NaN);

            const brake = brakingProfile(com, st, times, scaleAt);
            if (brake) push('brakingLoss', side, brake.brakingMs);

            /* Spring-mass stiffness. Every input is required; without body mass
               or speed there is no estimate, and substituting a population
               average for the person's own mass would be inventing the answer. */
            const vForK = Number.isFinite(ctx.speedMs) ? ctx.speedMs
                : (ctx.spatialFromDisplacement && Number.isFinite(speed) ? speed : NaN);
            if (Number.isFinite(ctx.massKg) && Number.isFinite(vForK)) {
                const k = springMassStiffness({
                    massKg: ctx.massKg,
                    speedMs: vForK,
                    contactS: st.stanceTime,
                    flightS: Math.max(0, st.flightTime),
                    legLengthM: legPx > 0 ? legPx * mpp : NaN
                });
                if (k) {
                    push('verticalStiffness', side, k.kVert);
                    push('legStiffness', side, k.kLeg);
                }
            }

            /* --- frontal-plane additions --------------------------------- */
            const shoulderPx = Math.abs(val(kp.shoulderR.x, tMid) - val(kp.shoulderL.x, tMid));
            if (shoulderPx > 1) {
                /* most medial hand position over the stride, relative to the
                   body midline; negative means it crossed to the other side */
                const rel = diff(kp['hand' + side].x, kp.hipMid.x);
                const signed = new Float64Array(rel.length);
                const own = sideSign * (side === 'L' ? -1 : 1);
                for (let i = 0; i < rel.length; i++) signed[i] = rel[i] * own;
                push('handCrossing', side, 100 * extremumOf(signed, i0, i1, 'min') / shoulderPx);
            }

            /* Foot progression needs the foot as a PLANE. The default backend
               has no lateral forefoot landmark, so this stays unavailable and
               says why rather than approximating it from a line. */
            const outer = kp['footOuter' + side];
            if (outer && cond.missing['footOuter' + side] <= MISSING_FRACTION_LIMIT) {
                const dx = val(outer.x, tMid) - val(kp['toe' + side].x, tMid);
                const dy = val(outer.y, tMid) - val(kp['toe' + side].y, tMid);
                const lateral = sideSign * (side === 'L' ? -1 : 1);
                push('footProgressionAngle', side, Math.atan2(dy, dx * lateral) * (180 / Math.PI));
            }

            if (Number.isFinite(tOpp) && legPx > 0) {
                const w = (val(kp['ankle' + other].x, tOpp) - val(kp['ankle' + side].x, t0))
                    * sideSign * (side === 'L' ? 1 : -1);
                push('stepWidth', side, 100 * w / legPx);
            }
        }
    }

    /* Cadence is estimated once from all step intervals rather than per stride:
       a step time is an interval BETWEEN feet and belongs to neither. */
    const rawStepTimes = [];
    const allStrikes = events.strikes.slice().sort((a, b) => a.t - b.t);
    for (let i = 1; i < allStrikes.length; i++) {
        if (allStrikes[i].side !== allStrikes[i - 1].side) rawStepTimes.push(allStrikes[i].t - allStrikes[i - 1].t);
    }
    /* Drop step intervals far from the median before the spread is measured.
       An interval that straddles a missed strike is roughly twice as long as a
       real one; leaving it in does not move the median estimate at all but
       inflates the standard deviation enormously, so the reported interval on
       cadence balloons for a reason that has nothing to do with how variable
       the running actually was. */
    const stepMedian = median(rawStepTimes);
    const stepTimes = Number.isFinite(stepMedian)
        ? rawStepTimes.filter(v => Math.abs(v - stepMedian) <= 0.35 * stepMedian)
        : rawStepTimes;

    /* ---- aggregate ------------------------------------------------------ */
    /* The error budget wants the standard error of each event's consensus,
       not the disagreement between the methods that produced it. */
    const meanSpread = {
        strike: mean(usable.map(s => s.strike.sigmaMs)),
        toeoff: mean(usable.map(s => (s.toeoff ? s.toeoff.sigmaMs : NaN)))
    };
    const fpsClass = fps >= FPS_FULL_PRECISION ? 'high' : fps >= FPS_TIMING_MIN ? 'medium' : 'low';
    const strideMs = median(usable.map(s => s.strideTime * 1000));

    /** @type {Record<string, any>} */
    const out = {};
    for (const spec of METRICS) {
        out[spec.id] = aggregate(spec, per[spec.id], {
            cond, scale, events, ctx, view, fps, fpsClass, meanSpread, stepTimes, sideSign,
            strideMs, viewMargin: ctx.viewMargin
        });
    }

    /* Strike pattern is a class, not a number, so it is derived from the
       aggregated foot-strike angle rather than averaged. */
    for (const side of ['L', 'R']) {
        const a = out.footStrikeAngle.sides[side];
        if (a && Number.isFinite(a.value)) {
            out.strikePattern.sides[side] = {
                ...out.strikePattern.sides[side],
                value: null,
                klass: classifyStrike(a.value),
                confidence: a.confidence,
                n: a.n
            };
        }
    }
    out.strikePattern.confidence = weakest(
        out.strikePattern.sides.L.confidence, out.strikePattern.sides.R.confidence);

    return {
        metrics: out,
        strideCount: { L: bySide.L.length, R: bySide.R.length, usable: usable.length, total: events.strides.length },
        sideSign,
        series: S,
        strides: bySide,
        com
    };
}

/* ------------------------------------------------------------------ */

function aggregate(spec, values, env) {
    const { ctx, fps, fpsClass, meanSpread, scale, stepTimes, cond } = env;
    const viewMargin = env.viewMargin;
    const sides = {};
    const base = {
        id: spec.id, label: spec.label, unit: spec.unit, view: spec.view,
        sided: spec.sided, dimension: spec.dimension, decimals: spec.decimals ?? 1
    };

    /* A metric measured in the wrong plane is not "low confidence", it is
       simply not measured. Saying so is more useful than a hedged number. */
    const viewMismatch = spec.view !== ctx.view;

    for (const side of ['L', 'R']) {
        const raw = (values && values[side]) || [];
        const n = raw.length;
        let value = spec.id === 'cadence'
            ? (stepTimes.length ? 60 / median(stepTimes) : NaN)
            : trimmedMean(raw, 0.1);
        let spread = spec.id === 'cadence' ? sdOfCadence(stepTimes) : sd(raw);
        const nEff = spec.id === 'cadence' ? stepTimes.length : n;

        let confidence = 'high';
        const notes = [];

        if (viewMismatch) {
            confidence = 'unavailable';
            notes.push(`needs a ${spec.view} view; this clip was analysed as ${ctx.view}`);
        } else if (!Number.isFinite(value) || nEff < 1) {
            confidence = 'unavailable';
            /* Say WHICH landmark is missing where one is. "No complete strides
               produced this measurement" is true of a metric the backend
               cannot form at all, and it is the least useful way to say it. */
            const absent = requiredLandmarks(spec.id, side)
                .filter(nm => !(cond.missing[nm] <= MISSING_FRACTION_LIMIT));
            /* A metric whose INPUTS were never supplied is not a metric that
               failed to measure; the difference matters to whoever is trying to
               get a number out of it. */
            const spatialIds = ['stepLength', 'strideLength', 'speed', 'verticalRatio'];
            if (spatialIds.includes(spec.id) && !ctx.spatialFromDisplacement && !Number.isFinite(ctx.speedMs)) {
                notes.push(ctx.surface === 'treadmill'
                    ? 'on a treadmill there is no displacement to measure, so this needs the belt speed'
                    : `the runner barely moves across the frame (${Number.isFinite(ctx.travelLegs) ? ctx.travelLegs.toFixed(1) : '?'} leg lengths), so this is either a treadmill or a camera that followed them — select Treadmill and enter the speed`);
            } else if ((spec.id === 'verticalStiffness' || spec.id === 'legStiffness') && !Number.isFinite(ctx.massKg)) {
                notes.push('needs your body mass — the spring-mass model scales with it, and a population average would be inventing the answer');
            } else if ((spec.id === 'verticalStiffness' || spec.id === 'legStiffness') && !Number.isFinite(ctx.speedMs)) {
                notes.push('needs your running speed');
            } else if (absent.length) {
                notes.push(`this needs the ${absent.join(' and ')} landmark${absent.length > 1 ? 's' : ''}, which the pose model did not provide for this clip`);
            } else {
                notes.push('no complete strides produced this measurement');
            }
        } else {
            /* frame-rate gate: the timing metrics are suppressed outright below
               60 fps rather than shown with a +/-14% interval, because a number
               that uncertain is not a measurement of anything */
            if (spec.timingGated && fps < FPS_TIMING_MIN) {
                confidence = 'unavailable';
                notes.push(`suppressed below ${FPS_TIMING_MIN} fps: at ${fps.toFixed(0)} fps one frame is ${(1000 / fps).toFixed(0)} ms and contact is only about 230 ms`);
            } else {
                if (spec.dimension === 'timing') confidence = fpsClass;
                if (spec.scaleDependent) confidence = weakest(confidence, scale.confidence);
                if (nEff < 3) confidence = weakest(confidence, 'low');
                else if (nEff < 5) confidence = weakest(confidence, 'medium');
                if (viewMargin != null && viewMargin < 0.15) confidence = weakest(confidence, 'medium');
                /* An oblique camera does not make a planar angle noisy, it makes
                   it wrong: the angle is measured in a plane the movement did
                   not happen in, and averaging more strides cannot help. Every
                   plane-sensitive measurement is therefore capped below the
                   threshold at which anything gets scored or advised on. */
                if (ctx.viewQuality === 'oblique' && spec.planeSensitive) {
                    confidence = weakest(confidence, 'low');
                    notes.push('the camera is not square to the plane of motion, so this angle is measured in the wrong plane');
                }
                /* landmark availability for the joints this metric touches */
                const lm = requiredLandmarks(spec.id, side);
                for (const name of lm) {
                    const miss = cond.missing[name];
                    if (!(miss <= MISSING_FRACTION_LIMIT)) {
                        confidence = 'unavailable';
                        notes.push(`the ${name} landmark is missing in ${(100 * miss).toFixed(0)}% of frames`);
                        break;
                    }
                    if (miss > 0.10) confidence = weakest(confidence, 'medium');
                }
                if (spec.id === 'ankleDorsiflexionContact') {
                    confidence = weakest(confidence, 'medium');
                    notes.push('the neutral ankle position is assumed, not measured');
                }
                if (spec.id === 'rearfootProxy') {
                    confidence = 'low';
                    notes.push('a proxy only — rearfoot eversion needs markers on the shoe and shank');
                }
                if (spec.id === 'speed' && ctx.surface === 'treadmill' && !Number.isFinite(ctx.speedMs)) {
                    confidence = 'unavailable';
                    notes.push('enter the treadmill speed to get speed and step length');
                }
                if ((spec.id === 'verticalStiffness' || spec.id === 'legStiffness')) {
                    if (!Number.isFinite(ctx.massKg)) {
                        confidence = 'unavailable';
                        notes.push('needs your body mass — the spring-mass model scales with it and a population average would be inventing the answer');
                    } else if (!Number.isFinite(ctx.speedMs)) {
                        confidence = 'unavailable';
                        notes.push('needs your running speed');
                    } else {
                        confidence = weakest(confidence, 'medium');
                        notes.push('a spring-mass model estimate, not a force measurement');
                    }
                }
                if (spec.id === 'footProgressionAngle' && nEff < 1) {
                    notes.push('the default pose model has no lateral forefoot landmark, so the foot is a line rather than a plane and this angle cannot be formed');
                }
            }
        }

        /* 95% interval. Three independent contributions where they apply:
           frame-rate quantisation, the inter-method event spread, and the
           stride-to-stride standard error. Pose-estimation error is NOT in
           here and the science page says so. */
        let ci95 = null;
        if (confidence !== 'unavailable' && Number.isFinite(value)) {
            const se = Number.isFinite(spread) && nEff > 1 ? spread / Math.sqrt(nEff) : 0;
            if (spec.unit === 'ms' && spec.dimension === 'timing') {
                const sigma = spec.id === 'gct'
                    ? intervalUncertaintyMs(fps, meanSpread.strike, meanSpread.toeoff)
                    : intervalUncertaintyMs(fps, meanSpread.strike, meanSpread.strike);
                ci95 = 1.96 * Math.hypot(sigma, se);
            } else if (spec.id === 'dutyFactor') {
                /* duty factor is a ratio of two measured intervals; the contact
                   time carries essentially all of the timing uncertainty */
                const sigma = intervalUncertaintyMs(fps, meanSpread.strike, meanSpread.toeoff);
                ci95 = env.strideMs > 0 ? 1.96 * Math.hypot(sigma / env.strideMs, se) : 1.96 * se;
            } else if (spec.id === 'cadence') {
                /* cadence = 60 / stepTime, so a step-time error of sigma
                   propagates as cadence * sigma / stepTime */
                const sigma = intervalUncertaintyMs(fps, meanSpread.strike, meanSpread.strike);
                const stepMs = 60000 / value;
                ci95 = 1.96 * Math.hypot(value * sigma / stepMs, se);
            } else if (spec.scaleDependent) {
                ci95 = 1.96 * Math.hypot(se, Math.abs(value) * scale.scatter);
            } else {
                ci95 = 1.96 * se;
            }
        }

        sides[side] = {
            value: Number.isFinite(value) && confidence !== 'unavailable' ? value : null,
            sd: Number.isFinite(spread) ? spread : null,
            ci95: Number.isFinite(ci95) ? ci95 : null,
            n: nEff,
            confidence,
            note: notes.length ? notes.join('; ') : undefined
        };
    }

    /* Unsided metrics are one measurement seen from two stride sets; pool them
       rather than pretending there is a left cadence and a right cadence. */
    let combined;
    if (!spec.sided) {
        const both = ((values && values.L) || []).concat((values && values.R) || []);
        const v = spec.id === 'cadence'
            ? (stepTimes.length ? 60 / median(stepTimes) : NaN)
            : trimmedMean(both, 0.1);
        combined = {
            value: Number.isFinite(v) && sides.L.confidence !== 'unavailable' ? v : (Number.isFinite(v) && sides.R.confidence !== 'unavailable' ? v : null),
            sd: spec.id === 'cadence' ? sdOfCadence(stepTimes) : sd(both),
            ci95: sides.L.ci95 ?? sides.R.ci95 ?? null,
            /* cadence is estimated from step INTERVALS, which belong to neither
               side, so its sample size is the number of intervals */
            n: spec.id === 'cadence' ? stepTimes.length : both.length,
            confidence: bestOf(sides.L.confidence, sides.R.confidence),
            note: sides.L.note || sides.R.note
        };
    }

    const ai = spec.sided && sides.L.value != null && sides.R.value != null
        ? asymmetryIndex(sides.L.value, sides.R.value)
        : null;

    return {
        ...base,
        sides,
        combined: combined || null,
        asymmetryIndex: ai,
        confidence: spec.sided ? weakest(sides.L.confidence, sides.R.confidence) : (combined ? combined.confidence : 'unavailable')
    };
}

function bestOf(a, b) {
    const rank = { unavailable: 0, low: 1, medium: 2, high: 3 };
    return rank[a] >= rank[b] ? a : b;
}

function sdOfCadence(stepTimes) {
    if (stepTimes.length < 2) return NaN;
    return sd(stepTimes.map(s => 60 / s));
}

export function classifyStrike(angleDeg) {
    if (!Number.isFinite(angleDeg)) return null;
    if (angleDeg > STRIKE_ANGLE_REARFOOT_ABOVE) return 'rearfoot';
    if (angleDeg < STRIKE_ANGLE_FOREFOOT_BELOW) return 'forefoot';
    return 'midfoot';
}

/** Landmarks a metric cannot be computed without. */
function requiredLandmarks(id, side) {
    const s = side;
    switch (id) {
        case 'footStrikeAngle': case 'strikePattern': return ['heel' + s, 'toe' + s];
        case 'ankleDorsiflexionContact': return ['knee' + s, 'ankle' + s, 'toe' + s];
        case 'rearfootProxy': return ['heel' + s, 'knee' + s];
        case 'heelRecovery': return ['heel' + s, 'hipMid'];
        case 'shankAngleContact': return ['ankle' + s, 'knee' + s];
        case 'kneeFlexionContact': case 'peakKneeFlexionStance': case 'kneeFlexionToeoff': case 'fppa':
            return ['hip' + s, 'knee' + s, 'ankle' + s];
        case 'elbowAngle': return ['shoulder' + s, 'elbow' + s, 'wrist' + s];
        case 'armSwingAmplitude': return ['shoulder' + s, 'elbow' + s];
        case 'headAngle': return ['nose', 'shoulderMid', 'hipMid'];
        case 'trunkLean': case 'trunkLateralLean': return ['shoulderMid', 'hipMid'];
        case 'headOscillation': case 'forwardHeadPosture': return ['headCentre', 'shoulderMid'];
        case 'handCrossing': return ['hand' + s, 'hipMid'];
        case 'footProgressionAngle': return ['toe' + s, 'footOuter' + s];
        case 'comVerticalOscillation': case 'brakingLoss': return ['hipMid', 'shoulderMid', 'knee' + s];
        case 'pelvicDrop': case 'pelvisRotation': return ['hipL', 'hipR'];
        case 'shoulderRotation': return ['shoulderL', 'shoulderR'];
        case 'overstride': case 'stepLength': case 'strideLength': case 'stepWidth':
            return ['ankle' + s, 'hipMid'];
        default: return [];
    }
}

/* ---------------- small array helpers ---------------- */

function dropEnds(list) {
    return list.length > 2 ? list.slice(1, -1) : list;
}

function diff(a, b) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
    return out;
}

function excursion(series, i0, i1) {
    const lo = Math.max(0, Math.floor(Math.min(i0, i1)));
    const hi = Math.min(series.length - 1, Math.ceil(Math.max(i0, i1)));
    let mn = Infinity, mx = -Infinity;
    for (let i = lo; i <= hi; i++) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    return mx > mn ? mx - mn : NaN;
}

function extremum(series, i0, i1, kind) {
    return extremumOf(series, i0, i1, kind);
}

function extremumOf(series, i0, i1, kind) {
    const lo = Math.max(0, Math.floor(Math.min(i0, i1)));
    const hi = Math.min(series.length - 1, Math.ceil(Math.max(i0, i1)));
    let best = NaN;
    for (let i = lo; i <= hi; i++) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        if (!Number.isFinite(best) || (kind === 'max' ? v > best : v < best)) best = v;
    }
    return best;
}

function windowMean(series, i0, i1) {
    const lo = Math.max(0, Math.floor(Math.min(i0, i1)));
    const hi = Math.min(series.length - 1, Math.ceil(Math.max(i0, i1)));
    const buf = [];
    for (let i = lo; i <= hi; i++) buf.push(series[i]);
    return mean(buf);
}

function peakTime(series, times, t0, t1) {
    const lo = Math.max(0, Math.floor(indexAtTime(t0, times)));
    const hi = Math.min(series.length - 1, Math.ceil(indexAtTime(t1, times)));
    let best = -Infinity, bestI = lo;
    for (let i = lo; i <= hi; i++) {
        if (Number.isFinite(series[i]) && series[i] > best) { best = series[i]; bestI = i; }
    }
    return times[bestI];
}
