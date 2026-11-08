/* ============================================================
   Stride Lab — segmental energetics.

   Where the mechanical work of running goes, computed from the
   rigid-body model the way the classic laboratory studies did it
   from film (Cavagna & Kaneko 1977; Winter 1979; Willems, Cavagna &
   Heglund 1995):

     EXTERNAL work  — to raise and re-accelerate the whole-body
                      center of mass. Split into the VERTICAL part
                      (potential energy plus vertical kinetic energy)
                      and the FORWARD part (horizontal kinetic energy,
                      i.e. the speed lost braking and regained pushing).
     INTERNAL work  — to move the segments RELATIVE to the center of
                      mass: swinging the legs and arms through and
                      back, and rotating each segment. By König's
                      theorem this is independent of the reference
                      frame, so it needs no speed at all.

   Work is the sum of the POSITIVE increments of each energy curve
   over a stride. Energy may be exchanged freely between the segments
   of one limb (a thigh slowing while its shank speeds up costs
   nothing), but not between limbs or between a limb and the center
   of mass — the convention of Willems et al. (1995), which is the
   one the comparison values in the literature use.

   Units are per kilogram of body mass throughout, so none of this
   needs the runner's weight. Per-meter values (J/kg/m) need the
   distance covered, which on a treadmill means the belt speed.

   Three things this is not, stated where they cannot be missed:

     - It is MECHANICAL work, not metabolic cost. Muscles convert
       metabolic energy at roughly a quarter efficiency, tendons
       return some of the work elastically for free, and isometric
       force costs energy while doing no work. Mechanical work is the
       part of the cost that can be seen; it is not the cost.
     - It is two-dimensional. Out-of-plane limb motion and axial
       rotation are absent, so internal work is underestimated.
     - Segment masses and radii of gyration are population tables
       (Winter), not this person.
   ============================================================ */

import { SEGMENTS, G, DEG } from '../types.js';
import { derivativeFinite } from '../signal/filter.js';

/**
 * Radius of gyration about the segment center of mass, as a fraction of
 * segment length. Winter, Biomechanics and Motor Control of Human Movement,
 * Table 4.1. Winter gives none for the trunk segment used here (greater
 * trochanter to glenohumeral joint); 0.30 is ASSUMED. The trunk barely rotates
 * in running — a few degrees either side of its lean — and the suite checks
 * that its rotational term is a negligible share of internal work, which is
 * what makes an assumed value acceptable.
 */
export const GYRATION = {
    headNeck: 0.495, trunk: 0.30,
    upperArmL: 0.322, upperArmR: 0.322,
    forearmL: 0.303, forearmR: 0.303,
    handL: 0.297, handR: 0.297,
    thighL: 0.323, thighR: 0.323,
    shankL: 0.302, shankR: 0.302,
    footL: 0.475, footR: 0.475
};
export const GYRATION_ASSUMED = ['trunk'];

/** Which model coordinate each inertial segment rotates with. */
const ROTATES_WITH = {
    headNeck: 'head', trunk: 'trunk',
    upperArmL: 'upperArmL', upperArmR: 'upperArmR',
    forearmL: 'forearmL', forearmR: 'forearmR',
    handL: 'forearmL', handR: 'forearmR',
    thighL: 'thighL', thighR: 'thighR',
    shankL: 'shankL', shankR: 'shankR',
    footL: 'footL', footR: 'footR'
};

/** Energy may be exchanged within a group, never between groups. */
export const LIMB_GROUPS = {
    legL: ['thighL', 'shankL', 'footL'],
    legR: ['thighR', 'shankR', 'footR'],
    armL: ['upperArmL', 'forearmL', 'handL'],
    armR: ['upperArmR', 'forearmR', 'handR'],
    hat: ['trunk', 'headNeck']
};

/**
 * Per-frame energy curves, per kilogram of body mass.
 *
 * @param {ReturnType<import('./kinematic.js').fitKinematicModel>} model
 * @param {{fps:number, cutoffHz:number, n:number}} cond
 * @param {number} mPerPx           the clip's median scale
 * @param {{groundVxMs:number|null}} opts
 *        `groundVxMs`: what to ADD to a camera-frame horizontal velocity to
 *        get it relative to the ground. The belt speed on a treadmill, zero
 *        for a fixed camera overground, null when the camera frame is not
 *        tied to the ground at all (a panning camera, or a treadmill whose
 *        speed was not entered) — the forward terms are then unavailable.
 */
export function energyCurves(model, cond, mPerPx, opts = {}) {
    if (!model || !model.available || !Number.isFinite(mPerPx) || !(mPerPx > 0)) return null;
    const { n, fps, cutoffHz } = cond;
    const dt = 1 / fps;
    const T = model.measurementTracks || model.tracks;
    const groundVx = Number.isFinite(opts.groundVxMs) ? opts.groundVxMs : null;

    /* segment centers of mass, meters */
    const seg = {};
    let massSum = 0;
    for (const s of SEGMENTS) {
        const a = T[s.from], b = T[s.to] || (s.to.startsWith('hand') ? T['wrist' + s.to.slice(-1)] : null);
        if (!a || !b) return null;
        const x = new Float64Array(n), y = new Float64Array(n), len = [];
        for (let f = 0; f < n; f++) {
            x[f] = (a.x[f] + (b.x[f] - a.x[f]) * s.com) * mPerPx;
            y[f] = (a.y[f] + (b.y[f] - a.y[f]) * s.com) * mPerPx;
            const l = Math.hypot(b.x[f] - a.x[f], b.y[f] - a.y[f]) * mPerPx;
            if (Number.isFinite(l)) len.push(l);
        }
        len.sort((p, q) => p - q);
        const L = len.length ? len[len.length >> 1] : NaN;
        seg[s.id] = {
            mass: s.mass, x, y, lengthM: L,
            vx: derivativeFinite(x, dt, cutoffHz, fps),
            vy: derivativeFinite(y, dt, cutoffHz, fps),
            omega: model.rate[ROTATES_WITH[s.id]],
            inertia: s.mass * (GYRATION[s.id] * L) ** 2
        };
        massSum += s.mass;
    }

    /* whole-body center of mass from the model, and its velocity */
    const cx = new Float64Array(n), cy = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        let sx = 0, sy = 0;
        for (const s of SEGMENTS) { sx += s.mass * seg[s.id].x[f]; sy += s.mass * seg[s.id].y[f]; }
        cx[f] = sx / massSum; cy[f] = sy / massSum;
    }
    const cvx = derivativeFinite(cx, dt, cutoffHz, fps);
    const cvy = derivativeFinite(cy, dt, cutoffHz, fps);

    /* the curves */
    const Ev = new Float64Array(n), Ef = new Float64Array(n);
    const groups = {};
    for (const gName of Object.keys(LIMB_GROUPS)) groups[gName] = new Float64Array(n);
    const rotational = new Float64Array(n), trunkRot = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        Ev[f] = G * cy[f] + 0.5 * cvy[f] * cvy[f];
        Ef[f] = groundVx == null ? NaN : 0.5 * (cvx[f] + groundVx) ** 2;
        let rotSum = 0;
        for (const [gName, members] of Object.entries(LIMB_GROUPS)) {
            let e = 0;
            for (const id of members) {
                const s = seg[id];
                const rvx = s.vx[f] - cvx[f], rvy = s.vy[f] - cvy[f];
                const w = s.omega ? s.omega[f] : 0;
                const rot = 0.5 * s.inertia * w * w;
                e += 0.5 * s.mass * (rvx * rvx + rvy * rvy) + rot;
                rotSum += rot;
                if (id === 'trunk') trunkRot[f] = rot;
            }
            groups[gName][f] = e / massSum;
        }
        rotational[f] = rotSum / massSum;
    }
    return {
        Ev, Ef, groups, rotational, trunkRot,
        com: { x: cx, y: cy, vx: cvx, vy: cvy },
        forwardAvailable: groundVx != null,
        segments: Object.fromEntries(Object.entries(seg).map(([k, s]) => [k, { mass: s.mass, lengthM: s.lengthM, inertia: s.inertia }]))
    };
}

/**
 * Work over the frame window [i0, i1], per kilogram.
 * Returns null when too much of the window is unusable to sum honestly.
 *
 * `splits` are the frame indices of the foot strikes INSIDE the window (for a
 * stride, the opposite foot's strike). Given them, the EXTERNAL terms are
 * measured per step as the rise of the energy curve from its minimum to the
 * maximum that follows it, rather than as a sum of frame-to-frame increments.
 *
 * Why: the forward kinetic energy is (v + vx)^2/2, so a velocity error of
 * sigma enters it LINEARLY, multiplied by the running speed, and a sum of
 * positive increments adds that noise up frame after frame — at 1% landmark
 * noise and 120 fps it more than doubled the forward work of a runner whose
 * true value was known. In running the external energy curves have one dip
 * per step (the center of mass is slowest and lowest together, at mid-stance),
 * so rise-from-minimum is the same quantity for a clean curve and is bounded
 * by the noise amplitude, not its sum, for a noisy one. Internal work keeps
 * the increment sum: limb energy curves legitimately have several humps per
 * stride, and their larger velocities make the noise term small.
 */
export function workOver(curves, i0, i1, splits) {
    if (!curves) return null;
    const lo = Math.max(0, Math.floor(i0)), hi = Math.min(curves.Ev.length - 1, Math.ceil(i1));
    if (!(hi > lo + 2)) return null;
    const pos = (arr) => {
        let w = 0, used = 0;
        for (let i = lo; i < hi; i++) {
            const d = arr[i + 1] - arr[i];
            if (!Number.isFinite(d)) continue;
            used++;
            if (d > 0) w += d;
        }
        return used >= 0.9 * (hi - lo) ? w : NaN;
    };
    const ext = new Float64Array(hi - lo + 1);
    for (let i = lo; i <= hi; i++) ext[i - lo] = curves.Ev[i] + curves.Ef[i];
    const internal = {};
    let total = 0;
    for (const g of Object.keys(curves.groups)) {
        internal[g] = pos(curves.groups[g]);
        total += internal[g];
    }
    internal.total = total;
    internal.legs = internal.legL + internal.legR;
    internal.arms = internal.armL + internal.armR;
    const cuts = Array.isArray(splits) ? splits.filter(k => Number.isFinite(k) && k > lo + 2 && k < hi - 2).map(Math.round) : null;
    if (cuts && cuts.length) {
        const bounds = [lo, ...cuts.sort((a, b) => a - b), hi];
        const rise = (get) => {
            let w = 0;
            for (let b = 0; b < bounds.length - 1; b++) {
                const r = riseFromMin(get, bounds[b], bounds[b + 1]);
                if (!Number.isFinite(r)) return NaN;
                w += r;
            }
            return w;
        };
        const vertical = rise(i => curves.Ev[i]);
        const forward = curves.forwardAvailable ? rise(i => curves.Ef[i]) : NaN;
        const externalSum = curves.forwardAvailable ? rise(i => curves.Ev[i] + curves.Ef[i]) : NaN;
        return { vertical, forward, external: externalSum, internal, trunkRotWork: trunkRot(curves, lo, hi), method: 'per-step rise' };
    }
    const vertical = pos(curves.Ev);
    const forward = curves.forwardAvailable ? pos(curves.Ef) : NaN;
    let externalSum = NaN;
    if (curves.forwardAvailable) {
        let w = 0, used = 0;
        for (let i = 0; i < ext.length - 1; i++) {
            const d = ext[i + 1] - ext[i];
            if (!Number.isFinite(d)) continue;
            used++;
            if (d > 0) w += d;
        }
        externalSum = used >= 0.9 * (ext.length - 1) ? w : NaN;
    }
    return { vertical, forward, external: externalSum, internal, trunkRotWork: trunkRot(curves, lo, hi), method: 'increments' };
}

/** Trunk rotational work, kept for the suite's check on the assumed radius. */
function trunkRot(curves, lo, hi) {
    let w = 0;
    for (let i = lo; i < hi; i++) {
        const d = curves.trunkRot[i + 1] - curves.trunkRot[i];
        if (d > 0) w += d;
    }
    return w;
}

/** Rise of a curve from its minimum to the largest value after it, over [a, b]. */
function riseFromMin(get, a, b) {
    let mn = Infinity, iMin = -1, finite = 0;
    for (let i = a; i <= b; i++) {
        const v = get(i);
        if (!Number.isFinite(v)) continue;
        finite++;
        if (v < mn) { mn = v; iMin = i; }
    }
    if (finite < 0.9 * (b - a + 1) || iMin < 0) return NaN;
    let mx = -Infinity;
    for (let i = iMin; i <= b; i++) { const v = get(i); if (Number.isFinite(v) && v > mx) mx = v; }
    return mx - mn;
}

/**
 * Minetti's prediction of internal work, J/kg/m (Minetti 1998):
 *
 *   Wint = q · SF · v · (1 + (d / (1 − d))²)
 *
 * SF stride frequency (Hz), v speed (m/s), d duty factor, q = 0.10 for humans.
 * An independent check on the video-derived figure: it uses none of the
 * segment kinematics, only timing and speed.
 */
export const MINETTI_Q = 0.10;
export function minettiInternalWork(strideFreqHz, speedMs, duty, q = MINETTI_Q) {
    if (!(strideFreqHz > 0) || !(speedMs > 0) || !(duty > 0 && duty < 1)) return NaN;
    return q * strideFreqHz * speedMs * (1 + (duty / (1 - duty)) ** 2);
}

/**
 * Center-of-mass drop during stance predicted by the spring-mass model of
 * Morin et al. (2005), meters. Body mass and speed cancel out of it:
 *
 *   Δy = g·tc² · [ (tf/tc + 1) / (2π) − 1/8 ]
 */
export function springMassDrop(contactS, flightS) {
    if (!(contactS > 0) || !(flightS >= 0)) return NaN;
    return G * contactS * contactS * ((flightS / contactS + 1) / (2 * Math.PI) - 1 / 8);
}

/**
 * Peak-to-trough vertical excursion of the center of mass over one step under
 * the same model: the stance compression plus the ballistic rise of flight.
 */
export function springMassExcursion(contactS, flightS) {
    const dy = springMassDrop(contactS, flightS);
    return Number.isFinite(dy) ? dy + G * flightS * flightS / 8 : NaN;
}

export { DEG };
