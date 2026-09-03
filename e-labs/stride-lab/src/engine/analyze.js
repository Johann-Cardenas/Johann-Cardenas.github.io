/* ============================================================
   Stride Lab — the pipeline, stages D to L.

   PURE. No DOM, no worker, no fetch. It takes a PoseSeries in and
   returns a result object. That is what makes it testable against
   synthetic signals in Node, which is the only way to know the math
   is right, and it is why the browser code around it is a thin shell
   rather than the product.
   ============================================================ */

import { condition } from './signal/condition.js';
import { gateImplausibleSegments, frameIsWorldFixed } from './pose/plausible.js';
import { travelDirection, classifyView, frontalFacing, perFrameScale } from './calib/scale.js';
import { detectEvents } from './events/detect.js';
import { computeMetrics } from './metrics/compute.js';
import { scoreAnalysis } from './scoring/score.js';
import { recommend } from './recommend/rules.js';
import { ENGINE_VERSION } from './version.js';
import {
    DEFAULT_CUTOFF_HZ, FPS_REJECT_BELOW, FPS_TIMING_MIN, SUBJECT_FILL_MIN,
    median, mean, quantile
} from './types.js';

/**
 * @param {import('./types.js').PoseSeries} series
 * @param {Object} opts
 * @param {number} opts.heightM              required; drives the scaling
 * @param {number} [opts.fps]                measured fps; derived if absent
 * @param {'auto'|'sagittal'|'frontal'} [opts.view]
 * @param {string} [opts.surface]            'treadmill' | 'road' | 'track' | 'trail' | 'other'
 * @param {number|null} [opts.speedMs]       treadmill belt speed, if known
 * @param {number} [opts.cutoffHz]
 * @param {string} [opts.backend]
 * @param {{strikes:any[], toeoffs:any[]}} [opts.stage2]
 * @param {number} [opts.worldLegLengthM]    cross-check from the backend's
 *                                           metric-space landmarks, if provided
 */
export function runPipeline(series, opts) {
    const warnings = [];
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    /* ---- fps: from the DATA, not from the container ---------------------
       Variable-frame-rate phone video is common and the container metadata
       lies about it. The median inter-frame interval of the decoded
       presentation timestamps does not. */
    const intervals = [];
    for (let i = 1; i < series.n; i++) intervals.push(series.t[i] - series.t[i - 1]);
    const dtMed = median(intervals);
    const measuredFps = dtMed > 0 ? 1 / dtMed : NaN;
    const fps = Number.isFinite(opts.fps) ? opts.fps : measuredFps;
    if (!Number.isFinite(fps) || fps <= 0) {
        return fail('no-timebase', 'The clip has no usable frame timestamps.');
    }
    /* Spread between the 10th and 90th percentile, NOT max minus min.
       A range is the least robust statistic there is: one skipped frame makes
       one interval twice the others and reports 100% variation, which is what a
       genuinely variable-frame-rate recording looks like too. The two need
       telling apart, because they call for different things — VFR means the
       timing metrics rest on a median rate, a single skip means almost nothing.
       Everything else in this engine gates on a robust statistic (D10, D12);
       this was the exception, and it fired on healthy 30 fps clips. */
    const jitter = intervals.length > 3
        ? (quantile(intervals, 0.9) - quantile(intervals, 0.1)) / dtMed
        : 0;
    const skips = intervals.filter(dt => dt > dtMed * 1.5).length;
    if (jitter > 0.5) {
        warnings.push({
            code: 'variable-frame-rate',
            message: `Frame intervals vary by ${(jitter * 100).toFixed(0)}%, so this was recorded at a variable frame rate. Timing metrics use the measured median rate of ${fps.toFixed(1)} fps.`
        });
    } else if (skips > 0 && skips <= intervals.length * 0.1) {
        warnings.push({
            code: 'frames-skipped',
            message: `${skips} frame${skips === 1 ? ' was' : 's were'} skipped in an otherwise steady ${fps.toFixed(0)} fps clip. `
                + 'Too few to affect the measurements; the gaps are interpolated over.'
        });
    }
    if (fps < FPS_REJECT_BELOW) {
        /* Blame the right thing. `fps` here is measured from the timestamps of
           the frames that ARRIVED, so when the playback fallback could not keep
           up with the model it is our sampling rate, not the camera's — and
           telling somebody to re-record at 60 fps when they already shot at 30
           sends them to do something that cannot help. */
        const lost = opts.droppedFrames > 0 && Number.isFinite(opts.sourceFps)
            && opts.sourceFps > fps * 1.25;
        return fail('fps-too-low', lost
            ? `Only ${fps.toFixed(0)} of this clip's ${opts.sourceFps.toFixed(0)} frames per second reached the analysis: `
              + 'this browser had to decode by playing the clip rather than frame by frame, and could not keep up with the '
              + 'pose model. The recording is fine. An MP4 (rather than WebM) will take the fast path, and so will a browser with WebCodecs.'
            : `This clip is ${fps.toFixed(0)} fps. Below ${FPS_REJECT_BELOW} fps there is not enough time resolution for any of these measurements. Record at 60 fps or higher.`);
    }
    if (fps < FPS_TIMING_MIN) {
        warnings.push({
            code: 'timing-suppressed',
            message: `At ${fps.toFixed(0)} fps a single frame is ${(1000 / fps).toFixed(0)} ms and ground contact is only about 230 ms, so contact time, flight time and duty factor are not reported. Cadence and the joint angles are.`
        });
    }

    /* ---- anatomical plausibility ---------------------------------------
       Before anything is measured: a pose estimator asked for a landmark it
       cannot see guesses, and reports a comfortable confidence while doing so.
       Bones do not change length, so a segment that disagrees with its own
       median across the clip identifies the guess without reference to how
       sure the model claimed to be. */
    const plausibility = gateImplausibleSegments(series);
    if (plausibility.total > 0 && plausibility.gated / plausibility.total > 0.10) {
        const worst = Object.entries(plausibility.bySegment)
            .sort((x, y) => y[1] - x[1])[0];
        warnings.push({
            code: 'implausible-landmarks',
            message: `${(100 * plausibility.gated / plausibility.total).toFixed(0)}% of limb positions were anatomically impossible — a segment changing length — and were discarded${worst ? `, worst on ${worst[0].replace('->', ' to ')}` : ''}. That normally means one side of the body is hidden from the camera for much of the clip. Measurements for that side will be sparse or missing.`
        });
    }

    /* ---- direction, then condition once in the travel frame -------------
       Sagittal analysis runs in a frame where +x is always the direction of
       travel, so downstream code never handles both cases and no sign
       convention has to be stated twice. A frontal view is never mirrored: its
       x axis is mediolateral and the backend already labels left and right
       anatomically, so flipping it would invert every side label. */
    const dir = travelDirection(series);
    const probe = condition(series, { fps, cutoffHz: opts.cutoffHz || DEFAULT_CUTOFF_HZ, mirror: false });
    const probeView = classifyView(probe);
    const isFrontal = (opts.view && opts.view !== 'auto') ? opts.view === 'frontal' : probeView.view === 'frontal';
    const mirrored = !isFrontal && dir.dir < 0;
    if (!dir.agrees) {
        warnings.push({
            code: 'direction-ambiguous',
            message: 'Foot orientation and body motion point opposite ways. That normally means the video has been mirrored, or the runner is moving backward. Check the clip before trusting the angles.'
        });
    }
    const cond = mirrored
        ? condition(series, { fps, cutoffHz: opts.cutoffHz || DEFAULT_CUTOFF_HZ, mirror: true })
        : probe;

    /* ---- view ----------------------------------------------------------- */
    const auto = mirrored ? classifyView(cond) : probeView;
    const view = (opts.view && opts.view !== 'auto') ? opts.view
        : auto.view === 'oblique' ? 'sagittal' : auto.view;
    if (auto.view === 'oblique') {
        warnings.push({
            code: 'oblique-view',
            message: `The camera looks to be at an angle rather than square on (shoulder-to-torso ratio ${auto.ratio.toFixed(2)}). Angles measured out of the plane of motion are systematically wrong. Confirm the view, or re-record square to the running path.`
        });
    } else if (opts.view && opts.view !== 'auto' && opts.view !== auto.view) {
        warnings.push({
            code: 'view-override',
            message: `You selected a ${opts.view} view; the clip looks ${auto.view}. Using your choice.`
        });
    }
    const facing = view === 'frontal' ? frontalFacing(cond).facing : null;

    /* ---- scaling -------------------------------------------------------- */
    const scale = perFrameScale(cond, opts.heightM, {
        worldLegLengthM: opts.worldLegLengthM
    });
    if (scale.confidence === 'low') {
        warnings.push({
            code: 'scale-low',
            message: scale.worldRatio != null && Math.abs(scale.worldRatio - 1) > 0.2
                ? `The two independent estimates of your size in the frame disagree by ${((scale.worldRatio - 1) * 100).toFixed(0)}%. Every distance below is downgraded. Check the height you entered.`
                : 'Limb lengths measured in the frame vary more than expected, so distances are less reliable. This usually means the camera moved or the runner was partly out of frame.'
        });
    }

    /* ---- how much of the frame does the runner actually fill? -----------
       Landmark precision is a fraction of subject size, not an absolute: a
       runner 200 px tall gets the same relative jitter as one 800 px tall, and
       every angle and every distance inherits it. The capture guidance asks for
       60-80% of frame height for this reason. */
    const subjectFill = Number.isFinite(scale.heightPx) && cond.height > 0
        ? scale.heightPx / cond.height
        : NaN;
    if (Number.isFinite(subjectFill) && subjectFill < SUBJECT_FILL_MIN) {
        warnings.push({
            code: 'subject-too-small',
            message: `The runner fills only ${(subjectFill * 100).toFixed(0)}% of the frame height. Below ${(SUBJECT_FILL_MIN * 100).toFixed(0)}% the landmarks are estimated from too few pixels for the angles to be worth much. Move the camera closer, or zoom in, and aim for 60 to 80%.`
        });
    }

    /* ---- is the frame fixed to the world? ------------------------------- */
    const travel = frameIsWorldFixed(cond, scale.legLengthPx);
    const spatialFromDisplacement = (opts.surface || 'treadmill') !== 'treadmill' && travel.worldFixed;
    if ((opts.surface || 'treadmill') !== 'treadmill' && !travel.worldFixed) {
        warnings.push({
            code: 'camera-not-world-fixed',
            message: `You selected ${opts.surface}, but the runner barely moves across the frame (${travel.travelLegs.toFixed(1)} leg lengths over the whole clip). Either this is a treadmill, or the camera followed the runner. Step length, stride length and speed cannot be measured from displacement that is not there — select Treadmill and enter the belt speed to get them.`
        });
    }

    /* ---- events --------------------------------------------------------- */
    const events = detectEvents(cond, { stage2: opts.stage2 });
    if (!events.alternation.ok) {
        warnings.push({
            code: 'alternation',
            message: `${events.alternation.violations} of ${events.alternation.total} consecutive foot strikes were detected on the same foot. Strides that do not alternate are excluded.`
        });
    }
    if (!events.cadenceAgrees && Number.isFinite(events.cadenceDisagreement)) {
        warnings.push({
            code: 'cadence-mismatch',
            message: `Cadence from the detected foot strikes (${events.cadenceEvents.toFixed(0)}) disagrees with cadence from pelvis motion (${events.cadenceSpectral.toFixed(0)}) by ${(events.cadenceDisagreement * 100).toFixed(0)}%. The event detection is probably wrong; treat the timing numbers with suspicion.`
        });
    }

    const usable = events.strides.filter(s => s.valid && !s.lowConfidence);
    if (usable.length < 4) {
        warnings.push({
            code: 'few-strides',
            message: `Only ${usable.length} clean stride${usable.length === 1 ? '' : 's'} could be measured. Aggregates over so few strides carry wide intervals. A longer clip, or one with the runner nearer the middle of the frame, gives a firmer answer.`
        });
    }
    if (!usable.length) {
        return fail('no-strides',
            'No complete stride could be measured in this clip. Check that the whole body, including the feet, stays in frame.',
            { warnings, cond, events, fps, view });
    }

    /* ---- metrics, scores, findings --------------------------------------- */
    const ctx = {
        view,
        /* Whether displacement across the frame is measurable at all. A
           treadmill and a camera that pans with the runner are the same
           situation as far as spatial measurement is concerned. */
        spatialFromDisplacement,
        travelLegs: travel.travelLegs,
        viewQuality: auto.view === 'oblique' ? 'oblique' : 'planar',
        subjectFill,
        surface: opts.surface || 'treadmill',
        speedMs: Number.isFinite(opts.speedMs) ? opts.speedMs : null,
        heightM: opts.heightM,
        massKg: Number.isFinite(opts.massKg) ? opts.massKg : null,
        facing,
        viewMargin: auto.margin
    };
    const computed = computeMetrics(cond, scale, events, ctx);

    /* Overground speed is measured, not entered, so it becomes available only
       after the metrics run — and the speed-conditional norm bands need it. */
    const speedForNorms = ctx.speedMs != null ? ctx.speedMs
        : (computed.metrics.speed.combined && computed.metrics.speed.combined.value) || null;

    const scores = scoreAnalysis(computed.metrics, { speedMs: speedForNorms, sex: opts.sex });
    const plan = recommend(computed.metrics, { ...ctx, speedMs: speedForNorms });

    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    return {
        ok: true,
        engine: {
            version: ENGINE_VERSION,
            backend: opts.backend || 'unknown',
            filterCutoffHz: opts.cutoffHz || DEFAULT_CUTOFF_HZ,
            stage2: opts.stage2 ? 'present' : 'not-shipped',
            elapsedMs: elapsed
        },
        capture: {
            view,
            viewAuto: auto.view,
            viewOverridden: !!(opts.view && opts.view !== 'auto' && opts.view !== auto.view),
            travelLegs: travel.travelLegs,
            subjectFill,
            spatialFromDisplacement,
            viewRatio: auto.ratio,
            facing,
            surface: ctx.surface,
            fps,
            measuredFps,
            frameCount: series.n,
            resolution: [series.width, series.height],
            durationMs: (series.t[series.n - 1] - series.t[0]) * 1000,
            mirrored,
            speedMs: speedForNorms
        },
        scale: {
            mPerPxMedian: scale.mPerPxMedian,
            scatter: scale.scatter,
            confidence: scale.confidence,
            worldRatio: scale.worldRatio,
            legLengthPx: scale.legLengthPx
        },
        events,
        plausibility,
        strideCount: computed.strideCount,
        metrics: computed.metrics,
        scores,
        findings: plan.findings,
        findingsSuppressed: plan.suppressed,
        warnings,
        /* kept for the charts and the overlay, not part of the stored record */
        _internal: { cond, series: computed.series, strides: computed.strides, scale, com: computed.com }
    };
}

function fail(code, message, extra) {
    return { ok: false, code, message, warnings: (extra && extra.warnings) || [], ...(extra || {}) };
}

/** Mean joint-angle curve over the gait cycle, for the results charts. */
export function gaitCycleCurves(result, seriesName, side, samples = 101) {
    const inner = result._internal;
    if (!inner) return null;
    const src = inner.series[seriesName];
    const arr = src && src[side] ? src[side] : src;
    if (!arr) return null;
    const strides = inner.strides[side] || [];
    const times = inner.cond.t;
    const curves = [];
    for (const st of strides) {
        const c = new Float64Array(samples);
        for (let k = 0; k < samples; k++) {
            const tt = st.strike.t + (st.nextStrike.t - st.strike.t) * (k / (samples - 1));
            c[k] = interp(arr, times, tt);
        }
        curves.push(c);
    }
    if (!curves.length) return null;
    const m = new Float64Array(samples), s = new Float64Array(samples);
    for (let k = 0; k < samples; k++) {
        const col = curves.map(c => c[k]).filter(Number.isFinite);
        m[k] = mean(col);
        s[k] = col.length > 1 ? Math.sqrt(col.reduce((a, b) => a + (b - m[k]) ** 2, 0) / (col.length - 1)) : 0;
    }
    /* stance fraction, so the chart can shade it */
    const stance = strides.map(st => st.stanceTime / st.strideTime).filter(Number.isFinite);
    return { mean: m, sd: s, n: curves.length, curves, stanceFraction: mean(stance) };
}

function interp(arr, times, tSec) {
    const n = times.length;
    if (tSec <= times[0]) return arr[0];
    if (tSec >= times[n - 1]) return arr[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= tSec) lo = mid; else hi = mid;
    }
    const span = times[hi] - times[lo];
    const f = span > 0 ? (tSec - times[lo]) / span : 0;
    const a = arr[lo], b = arr[hi];
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    return a + (b - a) * f;
}
