/* ============================================================
   Stride Lab — Stages F and G.
   View identification, direction of travel, and the pixel-to-meter
   scale that every length metric divides by.
   ============================================================ */

import {
    CANONICAL, WINTER, VISIBILITY_TRUST, VIEW_SAGITTAL_MAX, VIEW_FRONTAL_MIN,
    SCALE_DISAGREEMENT_LIMIT, CENTRAL_BAND, median, mad
} from '../types.js';
import { filtfilt, fillGaps } from '../signal/filter.js';

/**
 * Direction of travel, decided from the raw series so the mirror can be applied
 * once, before conditioning.
 *
 * The primary cue is the FOOT ORIENTATION: the toe is in front of the heel, in
 * every frame, for every runner moving forward. It is an anatomical invariant
 * rather than a kinematic inference, it needs no assumption about the surface,
 * and it is available on every frame rather than only during one phase.
 *
 * Hip velocity is the obvious alternative and it is the one that fails. It is
 * zero on a treadmill by construction. Foot velocity fails too, and less
 * obviously: on a treadmill the planted foot travels backward at belt speed
 * for two thirds of the cycle while the swing lasts about a tenth of a second,
 * so once the trajectories are low-pass filtered the sustained backward stance
 * velocity is LARGER in magnitude than the brief forward swing peak, and
 * "whichever way the foot moves fastest" points backward. Hip velocity is
 * still computed here, and used to cross-check.
 *
 * @param {import('../types.js').PoseSeries} series
 * @returns {{dir: 1|-1, method: string, speedNormPerSec: number, agrees: boolean}}
 */
export function travelDirection(series) {
    const K = CANONICAL.length;
    const idx = (name) => CANONICAL.indexOf(name);
    const hipL = idx('hipL'), hipR = idx('hipR');

    /* hip velocity: decisive overground, silent on a treadmill */
    const dx = [];
    for (let f = 1; f < series.n; f++) {
        const prev = 0.5 * (series.xy[((f - 1) * K + hipL) * 2] + series.xy[((f - 1) * K + hipR) * 2]);
        const cur = 0.5 * (series.xy[(f * K + hipL) * 2] + series.xy[(f * K + hipR) * 2]);
        const dt = series.t[f] - series.t[f - 1];
        if (dt > 0 && Number.isFinite(prev) && Number.isFinite(cur)) dx.push((cur - prev) / dt);
    }
    const hipV = median(dx);

    /* foot orientation: toe ahead of heel */
    const spans = [];
    for (const pair of [['heelL', 'toeL'], ['heelR', 'toeR']]) {
        const h = idx(pair[0]), tp = idx(pair[1]);
        for (let f = 0; f < series.n; f++) {
            if (!(series.vis[f * K + h] >= VISIBILITY_TRUST)) continue;
            if (!(series.vis[f * K + tp] >= VISIBILITY_TRUST)) continue;
            const d = series.xy[(f * K + tp) * 2] - series.xy[(f * K + h) * 2];
            if (Number.isFinite(d)) spans.push(d);
        }
    }
    const footSpan = median(spans);

    let dir = 1, method = 'foot-orientation';
    if (Number.isFinite(footSpan) && Math.abs(footSpan) > 1e-4) {
        dir = footSpan < 0 ? -1 : 1;
    } else if (Number.isFinite(hipV) && Math.abs(hipV) > 1e-4) {
        dir = hipV < 0 ? -1 : 1;
        method = 'hip-velocity';
    }

    /* Do the two cues agree? Only meaningful when the hips actually translate. */
    const hipMeaningful = Number.isFinite(hipV) && Math.abs(hipV) > 0.02;
    const agrees = !hipMeaningful || (hipV < 0 ? -1 : 1) === dir;

    return { dir, method, speedNormPerSec: Number.isFinite(hipV) ? hipV : 0, agrees };
}

/**
 * Sagittal or frontal, from the projected shoulder width relative to torso
 * height. A true frontal view sits near WINTER.shoulderWidth / WINTER.torso
 * = 0.90; a sagittal view collapses the shoulders toward each other.
 *
 * The band between the thresholds is reported "oblique" rather than guessed:
 * a 3/4 view breaks the planar assumption behind every angle in the report,
 * and the user is the only one who can see that it happened.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 */
export function classifyView(cond) {
    const { kp, n } = cond;
    const ratios = [];
    for (let f = 0; f < n; f++) {
        const sw = Math.abs(kp.shoulderR.x[f] - kp.shoulderL.x[f]);
        const th = kp.shoulderMid.y[f] - kp.hipMid.y[f];
        if (Number.isFinite(sw) && Number.isFinite(th) && th > 1) ratios.push(sw / th);
    }
    const r = median(ratios);
    let view = 'oblique';
    if (r <= VIEW_SAGITTAL_MAX) view = 'sagittal';
    else if (r >= VIEW_FRONTAL_MIN) view = 'frontal';
    /* How far into the band, 0 at a threshold and 1 at the extremes. Drives the
       "we are fairly sure" wording and the confidence downgrade for oblique. */
    const margin = view === 'sagittal'
        ? Math.min(1, (VIEW_SAGITTAL_MAX - r) / VIEW_SAGITTAL_MAX)
        : view === 'frontal'
            ? Math.min(1, (r - VIEW_FRONTAL_MIN) / VIEW_FRONTAL_MIN)
            : 0;
    return { view, ratio: r, margin };
}

/**
 * Rear or front view, for the frontal case. The runner moving away shrinks in
 * frame; moving toward, grows. Only the sign of the torso-height trend is
 * used, which survives a lot of noise.
 */
export function frontalFacing(cond) {
    const { kp, n } = cond;
    const xs = [], ys = [];
    for (let f = 0; f < n; f++) {
        const th = kp.shoulderMid.y[f] - kp.hipMid.y[f];
        if (Number.isFinite(th) && th > 1) { xs.push(f); ys.push(th); }
    }
    if (ys.length < 8) return { facing: 'rear', slope: 0 };
    const nn = xs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < nn; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = nn * sxx - sx * sx;
    const slope = den !== 0 ? (nn * sxy - sx * sy) / den : 0;
    return { facing: slope < 0 ? 'rear' : 'front', slope };
}

/**
 * Per-frame pixel-to-meter scale from segment-length anthropometry.
 *
 * Per-frame, not global, and that is the whole point. In overground video the
 * runner traverses the frame and their apparent size changes with perspective.
 * A single global scale makes vertical oscillation appear to grow or shrink as
 * the runner crosses the frame — an artifact indistinguishable, in the output,
 * from a real change in technique. Rescaling from the runner's own segments at
 * every frame cancels that drift to first order, and it does so without an
 * uncalibrated single-camera homography that could not be trusted anyway.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {number} heightM standing height, meters
 * @param {{worldLegLengthM?: number}} [xcheck]
 */
export function perFrameScale(cond, heightM, xcheck) {
    const { kp, n, fps, width } = cond;
    const thighM = WINTER.thigh * heightM;
    const shankM = WINTER.shank * heightM;

    const raw = new Float64Array(n);
    const segPx = { thighL: [], thighR: [], shankL: [], shankR: [] };

    for (let f = 0; f < n; f++) {
        const cands = [];
        const pairs = [
            ['hipL', 'kneeL', thighM, 'thighL'], ['hipR', 'kneeR', thighM, 'thighR'],
            ['kneeL', 'ankleL', shankM, 'shankL'], ['kneeR', 'ankleR', shankM, 'shankR']
        ];
        for (const [a, b, lenM, key] of pairs) {
            const A = kp[a], B = kp[b];
            if (!(A.v[f] >= VISIBILITY_TRUST) || !(B.v[f] >= VISIBILITY_TRUST)) continue;
            const px = Math.hypot(A.x[f] - B.x[f], A.y[f] - B.y[f]);
            if (!(px > 1)) continue;
            segPx[key].push(px);
            cands.push(lenM / px);
        }
        raw[f] = cands.length ? median(cands) : NaN;
    }

    /* Fill and smooth with the same filter the kinematics get, so the scale
       does not inject its own high-frequency content into a length metric. */
    const filled = fillGaps(raw, Math.max(3, Math.round(fps * 0.15)));
    const globalMed = median(filled);
    const patched = Float64Array.from(filled);
    for (let f = 0; f < n; f++) if (!Number.isFinite(patched[f])) patched[f] = globalMed;
    const smooth = Number.isFinite(globalMed) ? filtfilt(patched, 3, fps) : patched;

    /* Confidence. Two independent things can go wrong: the segment estimate can
       be noisy frame to frame, and it can be biased (wrong height, foreshortened
       limb). The first shows up as scatter, the second only as disagreement with
       the backend's own metric-space landmarks. */
    const scatter = mad(raw, globalMed) / (globalMed || 1);
    let confidence = scatter < 0.06 ? 'high' : scatter < 0.12 ? 'medium' : 'low';
    let worldRatio = null;
    if (xcheck && Number.isFinite(xcheck.worldLegLengthM) && xcheck.worldLegLengthM > 0) {
        const legPx = median(segPx.thighL.concat(segPx.thighR)) + median(segPx.shankL.concat(segPx.shankR));
        const anthroLegM = WINTER.leg * heightM;
        worldRatio = xcheck.worldLegLengthM / anthroLegM;
        if (Math.abs(worldRatio - 1) > SCALE_DISAGREEMENT_LIMIT) confidence = 'low';
        void legPx;
    }

    /* Analyze only the central band. Lens distortion and oblique viewing angle
       are worst at the frame edges, and a stride that straddles the edge picks
       up both. */
    const lo = width * (0.5 - CENTRAL_BAND / 2);
    const hi = width * (0.5 + CENTRAL_BAND / 2);
    const inBand = new Uint8Array(n);
    for (let f = 0; f < n; f++) {
        const x = cond.kp.hipMid.x[f];
        inBand[f] = Number.isFinite(x) && x >= lo && x <= hi ? 1 : 0;
    }

    return {
        mPerPx: smooth,
        mPerPxMedian: globalMed,
        scatter,
        confidence,
        worldRatio,
        inBand,
        legLengthPx: Number.isFinite(globalMed) ? (WINTER.leg * heightM) / globalMed : NaN,
        heightPx: Number.isFinite(globalMed) ? heightM / globalMed : NaN
    };
}
