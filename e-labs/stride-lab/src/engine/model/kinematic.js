/* ============================================================
   Stride Lab — the rigid-body kinematic model.

   Until v1.1 every angle in the report was read straight off the
   landmarks: three points, one angle, every frame on its own. That
   treats the body as a cloud of unrelated dots, and it lets each
   dot's error land in full on whatever angle it touches. The body is
   not a cloud. It is a linkage of rigid segments whose lengths do
   not change during a run, and a pose estimate that says otherwise
   is wrong in exactly the way a constraint can correct.

   So the landmarks are now explained by a model:

     14 degrees of freedom, sagittal plane
       pelvis position (2)       trunk orientation (1)
       head orientation (1)      thigh, shank, foot  x 2 sides (6)
       upper arm, forearm x 2 sides (4)

   with every segment's geometry — lengths, and where each landmark
   sits on its segment — calibrated from THIS runner's own clip as a
   robust median, never from a population table. Each frame is then
   fitted by weighted least squares (Gauss-Newton with a small
   Levenberg damping and a temporal prior), which is inverse
   kinematics in the sense OpenSim uses the word: find the posture of
   a fixed skeleton that best explains the observed landmarks.

   What that buys, concretely:

     - Every landmark constrains every angle it is connected to. The
       foot angle is fitted from heel, toe AND ankle, not from heel and
       toe alone; the thigh is pulled by the knee and by the shank's
       need to reach the ankle at its own fixed length.
     - Segment lengths are constant by construction, so the radial
       component of landmark noise — which a free-floating skeleton
       turns into breathing limbs — is absorbed rather than reported.
     - The coordinates are the real degrees of freedom, so angular
       VELOCITY is a derivative of one smooth signal rather than of an
       angle recomputed from three noisy points per frame. Thigh
       retraction speed, swing knee velocity and the segmental energy
       analysis in `energetics.js` all depend on this.
     - The residual between model and observation is a direct,
       per-landmark measure of how well the pose estimate is explained
       by a human body. It is reported, because a fit that does not
       fit is information.

   What it does not buy: anything out of the image plane. This is a
   planar model of a sagittal view, and it is only run on one.
   ============================================================ */

import { median, DEG } from '../types.js';
import { derivativeFinite, missingFraction } from '../signal/filter.js';
import { smoothTrajectory } from './temporal.js';

/* ---------------- Generalized coordinates ---------------- */

/** Index of each degree of freedom in the coordinate vector. */
export const Q = {
    px: 0, py: 1, trunk: 2, head: 3,
    thighL: 4, shankL: 5, footL: 6,
    thighR: 7, shankR: 8, footR: 9,
    upperArmL: 10, forearmL: 11,
    upperArmR: 12, forearmR: 13
};
export const NQ = 14;

/**
 * The segment tree. Angles are ABSOLUTE orientations in the conditioned
 * frame (+x = direction of travel, +y = up), radians, measured CCW from +x.
 * Absolute rather than relative coordinates because they keep the Jacobian
 * trivially simple and make every joint angle a single subtraction.
 *
 * `origin`  the landmark at which the segment's frame is anchored when the
 *           geometry is CALIBRATED from observations
 * `axis`    the landmark (or [from, to] pair) that fixes the frame's x axis
 * `joint`   the parent's point the segment hangs from in the MODEL
 * `points`  observed landmarks rigidly attached to this segment
 * `virtual` model points that are not observed but are needed downstream
 */
export const MODEL_SEGMENTS = [
    { id: 'trunk', q: Q.trunk, parent: null, origin: 'hipMid', axis: 'shoulderMid',
        points: ['hipL', 'hipR', 'shoulderL', 'shoulderR'], virtual: { neck: 'axis', pelvis: 'origin' } },
    { id: 'head', q: Q.head, parent: 'trunk', joint: 'neck', origin: 'shoulderMid', axis: 'headCenter',
        points: ['earL', 'earR', 'nose'], virtual: { headCenter: 'axis' } },
    ...['L', 'R'].flatMap(s => [
        { id: 'thigh' + s, q: Q['thigh' + s], parent: 'trunk', joint: 'hip' + s, origin: 'hip' + s, axis: 'knee' + s,
            points: ['knee' + s], side: s },
        { id: 'shank' + s, q: Q['shank' + s], parent: 'thigh' + s, joint: 'knee' + s, origin: 'knee' + s, axis: 'ankle' + s,
            points: ['ankle' + s], side: s },
        /* The foot's frame is anchored at the ankle but its axis is the
           heel-to-toe line, so its orientation IS the foot's plantar line. That
           is what makes a foot-plane ankle angle possible: a flat foot under a
           vertical shank reads zero by definition, with no assumed neutral. */
        { id: 'foot' + s, q: Q['foot' + s], parent: 'shank' + s, joint: 'ankle' + s, origin: 'ankle' + s, axis: ['heel' + s, 'toe' + s],
            points: ['heel' + s, 'toe' + s], side: s },
        { id: 'upperArm' + s, q: Q['upperArm' + s], parent: 'trunk', joint: 'shoulder' + s, origin: 'shoulder' + s, axis: 'elbow' + s,
            points: ['elbow' + s], side: s },
        { id: 'forearm' + s, q: Q['forearm' + s], parent: 'upperArm' + s, joint: 'elbow' + s, origin: 'elbow' + s, axis: 'wrist' + s,
            points: ['wrist' + s, 'hand' + s], side: s }
    ])
];
export const MODEL_SEGMENT_BY_ID = Object.fromEntries(MODEL_SEGMENTS.map(s => [s.id, s]));

/** Every observed landmark the model explains. */
export const MODEL_LANDMARKS = MODEL_SEGMENTS.flatMap(s => s.points);

/* Fit settings. Exposed so the suite can state what it tested. */
export const IK = {
    /** Gauss-Newton iterations per frame; converges in 3-4 from a warm start */
    iterations: 8,
    /** stop when the largest step is below this many radians / pixels */
    tolerance: 1e-6,
    /** Levenberg damping, relative to the mean diagonal of the normal matrix */
    damping: 1e-6,
    /** Temporal prior weight. Small enough to be invisible when a segment is
        observed, large enough to hold a segment still through a short gap
        instead of letting it spin freely in the null space. */
    prior: 1e-3,
    /** a landmark must be present in this share of frames to calibrate from */
    minCalibrationShare: 0.25,
    /** robust re-weighting: residuals beyond this many median residuals are
        down-weighted (Cauchy), so one hallucinated landmark cannot drag the
        whole skeleton toward it */
    robustScale: 3,
    /** ...but never below this share of leg length. Without a floor, a frame
        the model explains almost exactly has a median residual near zero, every
        point that is merely a pixel off reads as an outlier, its weight goes to
        zero, and the temporal prior quietly drags that limb back toward the
        previous frame's posture. That is what a 22-degree knee error on a
        noise-free clip turned out to be. */
    robustFloor: 0.02
};

/* ---------------- small 2D helpers ---------------- */

const rot = (th, x, y) => {
    const c = Math.cos(th), s = Math.sin(th);
    return { x: c * x - s * y, y: s * x + c * y };
};
/* Arithmetic, never a loop: a loop that subtracts 2 pi until in range takes
   forever on a large or infinite input, and a hung tab is a worse failure than
   a NaN. */
const wrapPi = (a) => {
    if (!Number.isFinite(a)) return NaN;
    const v = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
    return v === -Math.PI ? Math.PI : v;
};
export const wrapDeg = (a) => wrapPi(a / DEG) * DEG;

function obs(kp, name, f) {
    const t = kp[name];
    if (!t) return null;
    const x = t.x[f], y = t.y[f];
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Observed frame of a segment at frame f: origin point and axis angle. */
function observedFrame(kp, seg, f) {
    const o = obs(kp, seg.origin, f);
    if (!o) return null;
    let a, b;
    if (Array.isArray(seg.axis)) { a = obs(kp, seg.axis[0], f); b = obs(kp, seg.axis[1], f); }
    else { a = o; b = obs(kp, seg.axis, f); }
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!(Math.hypot(dx, dy) > 1e-6)) return null;
    return { o, th: Math.atan2(dy, dx) };
}

/* ---------------- Calibration ---------------- */

/**
 * The runner's own geometry: for every segment, the local coordinates of each
 * attached landmark and of each child's joint, as medians over the clip.
 *
 * Medians, not means, for the reason the plausibility gate gives: a pose
 * estimator's failures are gross and occasional, and a mean would let one
 * hallucinated knee lengthen the thigh for the whole clip.
 *
 * @returns {{local: Record<string, Record<string, {x:number,y:number}>>,
 *            lengths: Record<string, number>, missing: string[], legPx:number}}
 */
export function calibrateGeometry(cond) {
    const { kp, n } = cond;
    const local = {};
    const lengths = {};
    const missing = [];
    for (const seg of MODEL_SEGMENTS) {
        local[seg.id] = {};
        const names = [...seg.points];
        /* the axis landmark of a segment (where it is a single point) is the
           point its length is measured to */
        if (typeof seg.axis === 'string' && !names.includes(seg.axis)) names.push(seg.axis);
        /* the joints this segment's children hang from */
        for (const child of MODEL_SEGMENTS) {
            if (child.parent === seg.id && !names.includes(child.joint)) names.push(child.joint);
        }
        for (const name of names) {
            const xs = [], ys = [];
            for (let f = 0; f < n; f++) {
                const fr = observedFrame(kp, seg, f);
                const p = obs(kp, name, f);
                if (!fr || !p) continue;
                const l = rot(-fr.th, p.x - fr.o.x, p.y - fr.o.y);
                xs.push(l.x); ys.push(l.y);
            }
            if (xs.length >= Math.max(8, IK.minCalibrationShare * n)) {
                local[seg.id][name] = { x: median(xs), y: median(ys) };
            } else if (seg.points.includes(name) || name === seg.axis) {
                missing.push(name);
            }
        }
        /* An axis landmark lies ON the axis by definition; force y = 0 so a
           median that came out at 1e-14 cannot tilt the segment. */
        if (typeof seg.axis === 'string' && local[seg.id][seg.axis]) {
            const a = local[seg.id][seg.axis];
            local[seg.id][seg.axis] = { x: Math.hypot(a.x, a.y), y: 0 };
            lengths[seg.id] = local[seg.id][seg.axis].x;
        } else if (Array.isArray(seg.axis)) {
            const h = local[seg.id][seg.axis[0]], t = local[seg.id][seg.axis[1]];
            lengths[seg.id] = h && t ? Math.hypot(t.x - h.x, t.y - h.y) : NaN;
        }
    }
    /* A hand landmark the backend does not provide puts the hand mass at the
       wrist, exactly as the center-of-mass model has always done. */
    for (const s of ['L', 'R']) {
        const fl = local['forearm' + s];
        if (fl && !fl['hand' + s] && fl['wrist' + s]) fl['hand' + s] = { ...fl['wrist' + s], fallback: true };
    }
    const legPx = (lengths.thighL + lengths.shankL + lengths.thighR + lengths.shankR) / 2;
    return { local, lengths, missing, legPx };
}

/* ---------------- Forward kinematics ---------------- */

/**
 * Positions of every model point for one coordinate vector.
 * Returns world points plus, per segment, its origin and orientation — the
 * two things the Jacobian needs.
 */
export function forwardKinematics(q, geom) {
    const P = {};
    const frames = {};
    for (const seg of MODEL_SEGMENTS) {
        const th = q[seg.q];
        const c = Math.cos(th), s = Math.sin(th);
        let o;
        if (!seg.parent) o = { x: q[Q.px], y: q[Q.py] };
        else o = P[seg.joint];
        if (!o) continue;
        frames[seg.id] = { o, th };
        const loc = geom.local[seg.id];
        for (const name of Object.keys(loc)) {
            const lx = loc[name].x, ly = loc[name].y;
            /* a child joint lives on this segment; do not let a later segment
               that merely OBSERVES the same name overwrite it */
            if (P[name] && name !== seg.axis && !seg.points.includes(name)) continue;
            P[name] = { x: o.x + (c * lx - s * ly), y: o.y + (s * lx + c * ly) };
        }
        if (seg.virtual) {
            for (const [vn, kind] of Object.entries(seg.virtual)) {
                if (kind === 'origin') P[vn] = { ...o };
                else if (kind === 'axis' && typeof seg.axis === 'string' && P[seg.axis]) P[vn] = { ...P[seg.axis] };
            }
        }
    }
    /* derived midpoints the rest of the engine speaks in */
    if (P.hipL && P.hipR) P.hipMid = mid(P.hipL, P.hipR);
    if (P.shoulderL && P.shoulderR) P.shoulderMid = mid(P.shoulderL, P.shoulderR);
    return { P, frames };
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The chain of segments from the root down to `segId`. */
function chainOf(segId) {
    const out = [];
    let s = MODEL_SEGMENT_BY_ID[segId];
    while (s) { out.unshift(s); s = s.parent ? MODEL_SEGMENT_BY_ID[s.parent] : null; }
    return out;
}
const CHAINS = Object.fromEntries(MODEL_SEGMENTS.map(s => [s.id, chainOf(s.id)]));

/* ---------------- The fit ---------------- */

/**
 * Inverse kinematics over the whole clip.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {{view?:string, temporal?:boolean|'adaptive'}} [opts]
 */
export function fitKinematicModel(cond, opts = {}) {
    const { kp, n, fps, cutoffHz } = cond;
    if (opts.view && opts.view !== 'sagittal') {
        return { available: false, reason: 'The rigid-body model is planar and is fitted to sagittal views only.' };
    }
    const geom = calibrateGeometry(cond);
    const essential = ['knee', 'ankle'].flatMap(b => ['L', 'R'].map(s => b + s));
    const lost = essential.filter(nm => geom.missing.includes(nm));
    if (lost.length || !Number.isFinite(geom.legPx) || !(geom.legPx > 0)) {
        return {
            available: false, geom,
            reason: `The model needs both legs to calibrate; ${lost.length ? lost.join(', ') : 'the leg lengths'} could not be measured often enough.`
        };
    }

    /* observation list: every landmark that has a calibrated local position */
    const pointsOf = [];
    for (const seg of MODEL_SEGMENTS) {
        for (const name of seg.points) {
            const loc = geom.local[seg.id][name];
            if (loc && !loc.fallback) {
                const chain = CHAINS[seg.id];
                pointsOf.push({ seg, name, loc, chain,
                    columns: [Q.px, Q.py, ...chain.map(s => s.q)] });
            }
        }
    }
    /* Prior scale per coordinate: a length so an angular prior is in pixels. */
    const priorLen = new Float64Array(NQ);
    priorLen[Q.px] = priorLen[Q.py] = 1;
    for (const seg of MODEL_SEGMENTS) {
        const L = geom.lengths[seg.id];
        priorLen[seg.q] = Number.isFinite(L) && L > 0 ? L : geom.legPx / 2;
    }

    const qs = new Float64Array(n * NQ).fill(NaN);
    const fitted = new Uint8Array(n);
    const segObserved = {};
    for (const seg of MODEL_SEGMENTS) segObserved[seg.id] = new Uint8Array(n);
    const residual = new Float64Array(n).fill(NaN);
    const perLandmarkSq = {}; const perLandmarkN = {};
    for (const p of pointsOf) { perLandmarkSq[p.name] = 0; perLandmarkN[p.name] = 0; }

    let prev = null;
    let iterTotal = 0, framesFit = 0, rejectedSteps = 0;
    // Scratch storage is private to this fit, never shared with returned tracks.
    const H = new Float64Array(NQ * NQ), g = new Float64Array(NQ);
    const jx = new Float64Array(NQ), jy = new Float64Array(NQ);
    const candidate = new Float64Array(NQ);
    for (let f = 0; f < n; f++) {
        /* ---- initial guess: direct observation where it exists ---- */
        const q0 = new Float64Array(NQ);
        const root = obs(kp, 'hipMid', f);
        if (!root && !prev) continue;
        q0[Q.px] = root ? root.x : prev[Q.px];
        q0[Q.py] = root ? root.y : prev[Q.py];
        let anyLimb = false;
        for (const seg of MODEL_SEGMENTS) {
            const fr = observedFrame(kp, seg, f);
            if (fr) {
                /* keep the continuous branch of the angle so the temporal
                   prior never sees a 2-pi jump */
                q0[seg.q] = prev ? prev[seg.q] + wrapPi(fr.th - prev[seg.q]) : fr.th;
                segObserved[seg.id][f] = 1;
                if (seg.parent) anyLimb = true;
            } else if (prev) {
                q0[seg.q] = prev[seg.q];
            } else {
                q0[seg.q] = defaultAngle(seg);
            }
        }
        if (!anyLimb && !prev) continue;

        /* ---- observations at this frame ---- */
        const zs = [];
        for (const p of pointsOf) {
            const z = obs(kp, p.name, f);
            if (z) zs.push({ ...p, z });
        }
        if (zs.length < 6) { if (prev) { qs.set(prev, f * NQ); } continue; }

        const q = Float64Array.from(q0);
        const qPrior = prev || q0;
        let weights = zs.map(() => 1);
        for (let it = 0; it < IK.iterations; it++) {
            iterTotal++;
            const { P, frames } = forwardKinematics(q, geom);
            H.fill(0); g.fill(0);
            const res = [];
            for (let k = 0; k < zs.length; k++) {
                const ob = zs[k];
                const x = P[ob.name];
                if (!x) { res.push(NaN); continue; }
                const rx = x.x - ob.z.x, ry = x.y - ob.z.y;
                res.push(Math.hypot(rx, ry));
                const w = weights[k];
                /* Jacobian columns for this point: root translation, then one
                   angle per segment on the chain. d/dtheta of R(theta)l is the
                   perpendicular of the lever from the segment origin. */
                jx[0] = 1; jy[0] = 0; jx[1] = 0; jy[1] = 1;
                const chain = ob.chain, cols = ob.columns;
                for (let c = 0; c < chain.length; c++) {
                    const s = chain[c];
                    const fr = frames[s.id];
                    const end = c === chain.length - 1 ? x : P[chain[c + 1].joint];
                    const lx = end.x - fr.o.x, ly = end.y - fr.o.y;
                    jx[c + 2] = -ly; jy[c + 2] = lx;
                }
                for (let a = 0; a < cols.length; a++) {
                    const i = cols[a], ax = jx[a], ay = jy[a];
                    g[i] += w * (ax * rx + ay * ry);
                    for (let b = 0; b < cols.length; b++) {
                        const j = cols[b], bx = jx[b], by = jy[b];
                        H[i * NQ + j] += w * (ax * bx + ay * by);
                    }
                }
            }
            /* temporal prior, in pixel-equivalent units */
            for (let i = 0; i < NQ; i++) {
                const L = priorLen[i];
                const w = IK.prior * L * L;
                H[i * NQ + i] += w;
                g[i] += w * (i < 2 ? q[i] - qPrior[i] : wrapPi(q[i] - qPrior[i]));
            }
            let tr = 0; for (let i = 0; i < NQ; i++) tr += H[i * NQ + i];
            const mu = IK.damping * tr / NQ;
            for (let i = 0; i < NQ; i++) H[i * NQ + i] += mu;
            const step = solveSPD(H, g, NQ);
            if (!step || !step.every(Number.isFinite)) break;
            // Trust-region cap plus backtracking against the actual nonlinear
            // weighted objective. An unconstrained GN step can increase error
            // or flip a limb when observations are nearly singular.
            const loss = (candidate, points = forwardKinematics(candidate, geom).P) => {
                let value = 0;
                for (let k = 0; k < zs.length; k++) {
                    const p = points[zs[k].name];
                    if (p) value += weights[k] * ((p.x - zs[k].z.x) ** 2 + (p.y - zs[k].z.y) ** 2);
                }
                for (let i = 0; i < NQ; i++) {
                    const d = i < 2 ? candidate[i] - qPrior[i] : wrapPi(candidate[i] - qPrior[i]);
                    value += IK.prior * priorLen[i] ** 2 * d * d;
                }
                return value;
            };
            const before = loss(q, P);
            let fraction = 1;
            for (let i = 0; i < NQ; i++) fraction = Math.min(fraction,
                (i < 2 ? 0.15 * geom.legPx : 0.5) / Math.max(1e-12, Math.abs(step[i])));
            let accepted = false;
            for (let attempt = 0; attempt < 10; attempt++, fraction *= 0.5) {
                for (let i = 0; i < NQ; i++) candidate[i] = q[i] - fraction * step[i];
                const after = loss(candidate);
                if (Number.isFinite(after) && after <= before + 1e-10 * Math.max(1, before)) { accepted = true; break; }
            }
            if (!accepted) { rejectedSteps++; break; }
            let maxStep = 0;
            for (let i = 0; i < NQ; i++) {
                q[i] = candidate[i];
                maxStep = Math.max(maxStep, fraction * Math.abs(step[i]) / (i < 2 ? geom.legPx : 1));
            }
            /* robust re-weighting from the residuals of this iteration */
            const finite = res.filter(Number.isFinite);
            const scale = Math.max(IK.robustFloor * geom.legPx, median(finite) * IK.robustScale);
            weights = res.map(r => Number.isFinite(r) ? 1 / (1 + (r / scale) ** 2) : 0);
            if (maxStep < IK.tolerance) break;
        }

        /* ---- book-keeping ---- */
        const { P } = forwardKinematics(q, geom);
        let ss = 0, cnt = 0;
        for (const ob of zs) {
            const x = P[ob.name];
            if (!x) continue;
            const d2 = (x.x - ob.z.x) ** 2 + (x.y - ob.z.y) ** 2;
            ss += d2; cnt++;
            perLandmarkSq[ob.name] += d2; perLandmarkN[ob.name]++;
        }
        residual[f] = cnt ? Math.sqrt(ss / cnt) : NaN;
        qs.set(q, f * NQ);
        fitted[f] = 1;
        prev = q;
        framesFit++;
    }

    /* ---- coordinate series, unwrapped, with derivatives ---- */
    const dt = 1 / fps;
    const coord = {};
    const rate = {};
    for (const [name, i] of Object.entries(Q)) {
        const s = new Float64Array(n);
        for (let f = 0; f < n; f++) s[f] = qs[f * NQ + i];
        if (i >= 2) unwrapInPlace(s);
        coord[name] = s;
    }
    /* A segment that was not observed in a frame is held by the prior, which
       is right for the FIT (the rest of the body still needs somewhere to hang
       from) and wrong for a MEASUREMENT. Mask held frames back out of the
       per-segment series so a metric that lands in one reports itself
       unavailable rather than reading the prior. Short holds (the same three
       frames the landmark gap-fill bridges) are kept. */
    const held = {};
    for (const seg of MODEL_SEGMENTS) {
        const obsArr = segObserved[seg.id];
        const mask = new Uint8Array(n);
        let run = 0;
        for (let f = 0; f <= n; f++) {
            if (f < n && !obsArr[f]) { run++; continue; }
            if (run > 3) for (let k = f - run; k < f; k++) mask[k] = 1;
            run = 0;
        }
        held[seg.id] = mask;
        const name = seg.id;
        for (let f = 0; f < n; f++) if (mask[f]) coord[name][f] = NaN;
    }
    const baselineResidualPct = 100 * median(residual) / geom.legPx;
    // Missing ancestors invalidate downstream model measurements too.
    for (const seg of MODEL_SEGMENTS) for (let f = 0; f < n; f++) {
        if (!fitted[f] || CHAINS[seg.id].some(parent => held[parent.id][f])) coord[seg.id][f] = NaN;
    }
    for (let f = 0; f < n; f++) if (!fitted[f] || held.trunk[f]) coord.px[f] = coord.py[f] = NaN;
    const temporal = { method: 'framewise', changed: 0, constrainedFrames: 0, baselineResidualPct, radiusMs: 0 };
    // Clean fits need no extra smoothing. Very poor fits need a confidence
    // downgrade, not a smoother that disguises an incompatible observation.
    const useTemporal = fps >= 100 && (opts.temporal === true || (opts.temporal !== false
        && baselineResidualPct >= 0.4 && baselineResidualPct <= 3));
    if (useTemporal) {
        const radius = baselineResidualPct >= 1.5 ? 0.045 : 0.03;
        temporal.method = 'robust-local-cubic';
        temporal.radiusMs = radius * 1000;
        for (const name of Object.keys(Q)) {
            const smoothed = smoothTrajectory(coord[name], cond.t, { radius });
            coord[name] = smoothed.values;
            temporal.changed += smoothed.changed;
        }
        // Reconstruct from generalized coordinates, retaining rigid lengths.
        // Masked coordinates keep their original fit for drawing only.
        for (let f = 0; f < n; f++) {
            const original = qs.slice(f * NQ, (f + 1) * NQ);
            if (!original.every(Number.isFinite)) continue;
            const delta = new Float64Array(NQ), candidate = new Float64Array(NQ);
            for (const [name, i] of Object.entries(Q)) if (Number.isFinite(coord[name][f]))
                delta[i] = i < 2 ? coord[name][f] - original[i] : wrapPi(coord[name][f] - original[i]);
            let fraction = 1;
            // Temporal smoothness cannot purchase an arbitrarily worse match
            // to this frame's observations. Backtrack in generalized space,
            // retaining the rigid skeleton at every trial.
            const limit = Math.max(1.1 * residual[f], residual[f] + 0.002 * geom.legPx);
            for (let attempt = 0; attempt <= 8; attempt++) {
                if (attempt === 8) fraction = 0;
                for (let i = 0; i < NQ; i++) candidate[i] = original[i] + fraction * delta[i];
                const P = forwardKinematics(candidate, geom).P;
                let sum = 0, count = 0;
                for (const ob of pointsOf) {
                    const z = obs(kp, ob.name, f), p = P[ob.name];
                    if (z && p) { sum += (p.x - z.x) ** 2 + (p.y - z.y) ** 2; count++; }
                }
                const rms = count ? Math.sqrt(sum / count) : NaN;
                if (fraction === 0 || (Number.isFinite(rms) && rms <= limit)) break;
                fraction *= 0.5;
            }
            if (fraction < 1) temporal.constrainedFrames++;
            qs.set(candidate, f * NQ);
            for (const [name, i] of Object.entries(Q)) if (Number.isFinite(coord[name][f])) coord[name][f] = candidate[i];
        }
    }
    for (const name of Object.keys(Q)) {
        rate[name] = derivativeFinite(coord[name], dt, cutoffHz, fps);
    }

    /* model point tracks, for the overlay and the energetics */
    const tracks = {};
    if (useTemporal) for (const name of Object.keys(perLandmarkSq)) {
        perLandmarkSq[name] = 0;
        perLandmarkN[name] = 0;
    }
    const qf = new Float64Array(NQ);
    for (let f = 0; f < n; f++) {
        let ok = true;
        for (let i = 0; i < NQ; i++) { qf[i] = qs[f * NQ + i]; if (!Number.isFinite(qf[i])) ok = false; }
        if (!ok) continue;
        const { P } = forwardKinematics(qf, geom);
        if (useTemporal) {
            let sum = 0, count = 0;
            for (const ob of pointsOf) {
                const z = obs(kp, ob.name, f), p = P[ob.name];
                if (z && p) {
                    const d2 = (p.x - z.x) ** 2 + (p.y - z.y) ** 2;
                    sum += d2; count++;
                    perLandmarkSq[ob.name] += d2;
                    perLandmarkN[ob.name]++;
                }
            }
            residual[f] = count ? Math.sqrt(sum / count) : NaN;
        }
        for (const [name, p] of Object.entries(P)) {
            if (!tracks[name]) tracks[name] = { x: new Float64Array(n).fill(NaN), y: new Float64Array(n).fill(NaN) };
            tracks[name].x[f] = p.x; tracks[name].y[f] = p.y;
        }
    }

    // Keep drawing holds separate from coordinates eligible for measurement.
    // A child depends on every upstream segment, not just its own endpoints.
    const measurementTracks = {};
    for (const seg of MODEL_SEGMENTS) {
        for (const name of [...seg.points, ...Object.keys(seg.virtual || {})]) {
            if (!tracks[name]) continue;
            const x = Float64Array.from(tracks[name].x), y = Float64Array.from(tracks[name].y);
            for (let f = 0; f < n; f++) {
                if (!fitted[f] || CHAINS[seg.id].some(parent => held[parent.id][f])) x[f] = y[f] = NaN;
            }
            measurementTracks[name] = { x, y };
        }
    }

    const perLandmark = {};
    for (const nm of Object.keys(perLandmarkSq)) {
        perLandmark[nm] = perLandmarkN[nm] ? 100 * Math.sqrt(perLandmarkSq[nm] / perLandmarkN[nm]) / geom.legPx : null;
    }
    const resMed = median(residual);
    return {
        available: true,
        geom,
        coord, rate, held, observed: segObserved, tracks, measurementTracks,
        residualPx: residual,
        fit: {
            /* RMS model-to-landmark distance, % of leg length */
            residualPct: 100 * resMed / geom.legPx,
            residualP90Pct: 100 * quantileOf(residual, 0.9) / geom.legPx,
            perLandmarkPct: perLandmark,
            framesFit,
            meanIterations: framesFit ? iterTotal / framesFit : NaN,
            rejectedSteps,
            coverage: framesFit / n,
            dof: NQ
        },
        temporal,
        angles: jointAngles(coord, rate, n)
    };
}

function defaultAngle(seg) {
    if (seg.id === 'trunk' || seg.id === 'head') return Math.PI / 2;
    if (seg.id.startsWith('foot')) return 0;
    return -Math.PI / 2;
}

/**
 * Joint angles from the coordinates, degrees, in the sign conventions of
 * `metrics/angles.js` so a model angle and a direct angle can be compared.
 */
export function jointAngles(c, r, n) {
    const out = {};
    const mk = () => new Float64Array(n);
    const DOWN_OFFSET = Math.PI;   /* trunk axis points up; trunk-down = trunk - pi */
    out.trunkLean = mk();
    for (let f = 0; f < n; f++) out.trunkLean[f] = (Math.PI / 2 - c.trunk[f]) * DEG;
    for (const s of ['L', 'R']) {
        const th = c['thigh' + s], sh = c['shank' + s], ft = c['foot' + s];
        const ua = c['upperArm' + s], fa = c['forearm' + s];
        const a = {
            thigh: mk(), hipFlex: mk(), kneeFlex: mk(), ankle: mk(), shank: mk(),
            footPitch: mk(), shoulderFlex: mk(), elbowFlex: mk(),
            thighVel: mk(), kneeVel: mk(), hipVel: mk(), ankleVel: mk()
        };
        for (let f = 0; f < n; f++) {
            const td = c.trunk[f] - DOWN_OFFSET;
            /* thigh from the downward vertical, positive = knee ahead of hip */
            a.thigh[f] = wrapDeg((th[f] + Math.PI / 2) * DEG);
            a.hipFlex[f] = wrapDeg((th[f] - td) * DEG);
            a.kneeFlex[f] = wrapDeg((th[f] - sh[f]) * DEG);
            /* foot-plane ankle angle: 0 = plantar line perpendicular to the
               shank, positive = dorsiflexed (toe toward the shin) */
            a.ankle[f] = wrapDeg((ft[f] - sh[f]) * DEG - 90);
            /* shank from vertical, positive = knee behind ankle (angles.js) */
            a.shank[f] = wrapDeg((sh[f] + Math.PI / 2) * DEG);
            a.footPitch[f] = wrapDeg(ft[f] * DEG);
            a.shoulderFlex[f] = wrapDeg((ua[f] - td) * DEG);
            a.elbowFlex[f] = wrapDeg((fa[f] - ua[f]) * DEG);
            /* rates, deg/s */
            a.thighVel[f] = r['thigh' + s][f] * DEG;
            a.hipVel[f] = (r['thigh' + s][f] - r.trunk[f]) * DEG;
            a.kneeVel[f] = (r['thigh' + s][f] - r['shank' + s][f]) * DEG;
            a.ankleVel[f] = (r['foot' + s][f] - r['shank' + s][f]) * DEG;
        }
        out[s] = a;
    }
    return out;
}

/* ---------------- numerics ---------------- */

/** Solve H x = g for symmetric positive definite H (Cholesky). */
export function solveSPD(H, g, m) {
    const L = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
        for (let j = 0; j <= i; j++) {
            let s = H[i * m + j];
            for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k];
            if (i === j) {
                if (!(s > 0)) return null;
                L[i * m + i] = Math.sqrt(s);
            } else {
                L[i * m + j] = s / L[j * m + j];
            }
        }
    }
    const y = new Float64Array(m);
    for (let i = 0; i < m; i++) {
        let s = g[i];
        for (let k = 0; k < i; k++) s -= L[i * m + k] * y[k];
        y[i] = s / L[i * m + i];
    }
    const x = new Float64Array(m);
    for (let i = m - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < m; k++) s -= L[k * m + i] * x[k];
        x[i] = s / L[i * m + i];
    }
    return x;
}

function unwrapInPlace(s) {
    let last = NaN;
    for (let i = 0; i < s.length; i++) {
        if (!Number.isFinite(s[i])) continue;
        if (Number.isFinite(last)) s[i] = last + wrapPi(s[i] - last);
        last = s[i];
    }
}



function quantileOf(arr, q) {
    const v = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const pos = q * (v.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export { missingFraction };
