/* ============================================================
   Stride Lab — whole-body centre of mass, and the spring-mass
   stiffness that follows from it.

   Why this exists, and why it is worth the extra machinery.

   Van Hooren et al. (2024) meta-analysed the observational
   literature on running biomechanics and running economy. Of every
   technique variable examined, the ones with significant
   associations were:

     vertical oscillation   r =  0.35  moderate   (less is better)
     vertical stiffness     r = -0.31  moderate   (more is better)
     leg stiffness          r = -0.28  moderate   (more is better)
     cadence                r = -0.20  small      (more is better)

   and the ones WITHOUT were ground contact time (r = -0.02), duty
   factor (r = -0.06), stride length, foot-strike pattern, knee
   flexion, trunk lean and braking — all trivial and
   non-significant.

   Three consequences, and all three shape this file.

   First, vertical oscillation is the best-evidenced thing this app
   can measure, so it should be measured properly. A pelvis landmark
   is an APPROXIMATION of the centre of mass; it misses the
   counter-motion of the swinging limbs, which is exactly the part
   that differs between runners. A fourteen-segment inertial model
   built from the landmarks already being tracked gives the real
   thing, and costs one more pass over data that is already in
   memory.

   Second, the two stiffness terms are the next best evidenced, and
   Morin et al. (2005) give a validated way to estimate both from
   contact time, flight time, speed, leg length and body mass —
   every one of which this app already has. That converts timing
   measurements the app was already making into the variables the
   evidence actually cares about.

   Third, and least comfortable: the app reports contact time and
   duty factor prominently, and the best available evidence says
   neither is associated with running economy. They are still worth
   measuring — they describe the stride and they feed the stiffness
   model — but the reference bands say what the evidence says.
   ============================================================ */

import { SEGMENTS, SEGMENT_FALLBACK, G, mean, median } from '../types.js';
import { derivative, missingFraction } from '../signal/filter.js';

/**
 * Whole-body centre of mass, per frame, in pixels.
 *
 * Segment masses are renormalised over the segments actually available, so a
 * lost hand shifts the estimate slightly rather than deleting mass from the
 * body and dragging the centre of mass towards the feet.
 *
 * @param {import('../signal/condition.js').Conditioned} cond
 * @returns {{x:Float64Array, y:Float64Array, vx:Float64Array, vy:Float64Array,
 *            missing:number, segmentsUsed:string[], massCovered:number}}
 */
export function bodyCoM(cond) {
    const { kp, n, fps, cutoffHz } = cond;

    const usable = [];
    for (const seg of SEGMENTS) {
        const from = kp[seg.from];
        let to = kp[seg.to];
        if (!to || missingFraction(to.x) > 0.5) {
            const fb = SEGMENT_FALLBACK[seg.to];
            if (fb && kp[fb]) to = kp[fb];
        }
        if (!from || !to) continue;
        if (missingFraction(from.x) > 0.5 || missingFraction(to.x) > 0.5) continue;
        usable.push({ seg, from, to });
    }

    const massCovered = usable.reduce((a, u) => a + u.seg.mass, 0);
    const x = new Float64Array(n);
    const y = new Float64Array(n);

    for (let f = 0; f < n; f++) {
        let sx = 0, sy = 0, m = 0;
        for (const { seg, from, to } of usable) {
            const ax = from.x[f], ay = from.y[f], bx = to.x[f], by = to.y[f];
            if (!Number.isFinite(ax) || !Number.isFinite(bx)) continue;
            sx += seg.mass * (ax + (bx - ax) * seg.com);
            sy += seg.mass * (ay + (by - ay) * seg.com);
            m += seg.mass;
        }
        /* Require most of the body before reporting a centre of mass at all.
           A COM computed from half the segments is not a noisy COM, it is a
           different quantity. */
        if (m >= 0.75 * massCovered && m > 0) { x[f] = sx / m; y[f] = sy / m; }
        else { x[f] = NaN; y[f] = NaN; }
    }

    const dt = 1 / fps;
    return {
        x, y,
        vx: maskLike(derivative(patch(x), dt, cutoffHz, fps), x),
        vy: maskLike(derivative(patch(y), dt, cutoffHz, fps), x),
        missing: missingFraction(x),
        segmentsUsed: usable.map(u => u.seg.id),
        massCovered
    };
}

function patch(a) {
    const out = Float64Array.from(a);
    let last = NaN;
    for (let i = 0; i < out.length; i++) {
        if (Number.isFinite(out[i])) last = out[i]; else out[i] = last;
    }
    let first = NaN;
    for (let i = 0; i < out.length; i++) if (Number.isFinite(out[i])) { first = out[i]; break; }
    if (!Number.isFinite(first)) first = 0;
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = first;
    return out;
}

function maskLike(a, ref) {
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(ref[i])) a[i] = NaN;
    return a;
}

/**
 * Spring-mass stiffness by the "simple method" of Morin, Dalleau, Kyrolainen,
 * Jeannin and Belli (2005), which needs no force plate:
 *
 *   Fmax  = m·g·(π/2)·(tf/tc + 1)
 *   Δy    = −Fmax·tc²/(m·π²) + g·tc²/8         COM drop during contact
 *   Kvert = Fmax / |Δy|
 *   ΔL    = L0 − √(L0² − (v·tc/2)²) + |Δy|     leg compression
 *   Kleg  = Fmax / ΔL
 *
 * `Fmax` is an OUTPUT OF THE MODEL, not a measurement, and this function does
 * not return it as one. You cannot measure ground reaction force from video,
 * and nothing in this app is labelled as though you could — the sine-wave
 * approximation to the force trace is a modelling assumption that happens to
 * predict stiffness well, not a force sensor.
 *
 * Every input is required. Without body mass and speed there is no estimate,
 * and the honest response is to return null rather than to substitute a
 * population average for the person's own mass.
 *
 * @param {{massKg:number, speedMs:number, contactS:number, flightS:number, legLengthM:number}} o
 */
export function springMassStiffness(o) {
    const { massKg, speedMs, contactS, flightS, legLengthM } = o;
    if (!(massKg > 20) || !(speedMs > 0.5) || !(contactS > 0.05) || !(legLengthM > 0.3)) return null;
    if (!(flightS >= 0)) return null;

    const fMax = massKg * G * (Math.PI / 2) * (flightS / contactS + 1);
    const dy = Math.abs(-fMax * contactS * contactS / (massKg * Math.PI * Math.PI)
        + G * contactS * contactS / 8);
    if (!(dy > 1e-4)) return null;

    const half = speedMs * contactS / 2;
    const inner = legLengthM * legLengthM - half * half;
    /* If the horizontal travel during contact exceeds what the leg can span,
       the spring-mass model does not describe this stride and no number is
       better than a complex one. */
    if (!(inner > 0)) return null;
    const dL = legLengthM - Math.sqrt(inner) + dy;
    if (!(dL > 1e-4)) return null;

    return {
        kVert: fMax / dy / 1000,        /* kN/m */
        kLeg: fMax / dL / 1000,         /* kN/m */
        comDropM: dy,
        legCompressionM: dL,
        /* kept for diagnostics, deliberately not surfaced as a measurement */
        modelPeakForceN: fMax,
        modelPeakForceBW: fMax / (massKg * G)
    };
}

/**
 * Braking and propulsion, from the horizontal velocity of the centre of mass.
 *
 * Reported because it is mechanically informative and it is what people mean
 * by "braking": the body slows through early stance and speeds up again
 * through late stance. Not reported as an economy variable — the same
 * meta-analysis found braking measures non-significantly associated with
 * running economy, and this app does not get to imply otherwise.
 */
export function brakingProfile(com, stride, times, scaleAt) {
    if (!stride || !stride.toeoff) return null;
    const i0 = idxAt(stride.strike.t, times);
    const iOff = idxAt(stride.toeoff.t, times);
    if (!(iOff > i0)) return null;
    let vMin = Infinity, vMax = -Infinity, vIn = NaN, vOut = NaN;
    for (let i = i0; i <= iOff; i++) {
        const v = com.vx[i];
        if (!Number.isFinite(v)) continue;
        if (!Number.isFinite(vIn)) vIn = v;
        vOut = v;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
    }
    if (!Number.isFinite(vIn) || !Number.isFinite(vOut)) return null;
    const mpp = scaleAt(stride.strike.t);
    return {
        /* how much horizontal speed is lost between touchdown and the slowest
           instant of stance, in metres per second */
        brakingMs: (vIn - vMin) * mpp,
        propulsionMs: (vOut - vMin) * mpp,
        rangeMs: (vMax - vMin) * mpp
    };
}

function idxAt(tSec, times) {
    let lo = 0, hi = times.length - 1;
    if (tSec <= times[0]) return 0;
    if (tSec >= times[hi]) return hi;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (times[m] <= tSec) lo = m; else hi = m;
    }
    return lo;
}

export { mean, median };
