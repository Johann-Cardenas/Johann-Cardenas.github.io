/* ============================================================
   Stride Lab — Stage H. Gait event detection.

   Two events per foot per stride: foot strike and toe-off.

   Why a vote rather than one good detector. Against force-plate
   ground truth and using MARKER data, the best kinematic methods
   land at roughly 22-25 ms for foot strike and 5 ms for toe-off
   (Fellin et al. 2010; Milner & Paquette 2015). Pose estimation
   adds error on top of that, so those figures are a floor, not a
   target. Two consequences drive this design:

     - Foot strike is 4-5x harder than toe-off, so it dominates
       the ground-contact-time error budget.
     - Heel-based strike detectors carry a strike-pattern-DEPENDENT
       offset. That offset is precisely the population difference
       the product exists to measure, so a heel-only detector would
       bias forefoot strikers' contact times in the direction that
       matters most.

   Hence: several methods with different failure modes, a weighted
   vote, and the inter-method spread carried forward as the event's
   own uncertainty rather than discarded.
   ============================================================ */

import {
    CLUSTER_WINDOW_MS, EVENT_SPREAD_LIMIT_MS, STANCE_MS, STRIDE_MS,
    DUTY_FACTOR_RANGE, SAME_FOOT_MIN_MS, CADENCE_CROSSCHECK_TOL,
    median, weightedMedian, sampleAt, quantile
} from '../types.js';
import {
    localMinima, localMaxima, zeroCrossings, dominantFrequency,
    plateauOnset, plateauEnd, argExtremum, range
} from '../signal/peaks.js';
import { kneeInteriorSeries } from '../metrics/angles.js';

/** A cluster needs this much summed weight to become an event: in practice,
 *  two independent methods, or one strong method plus corroboration. */
export const MIN_CLUSTER_WEIGHT = 1.4;

/** Plateau tolerance, as a fraction of a landmark's own excursion. */
export const PLATEAU_TOL_FRACTION = 0.01;

/**
 * "Who arrived first" (D54). A heel minimum is evidence of contact only if the
 * heel was the first part of the foot down; if the toe was already on the
 * ground this long before it, the heel minimum is the foot FLATTENING, which
 * happens after contact, and its weight is cut to ARRIVAL_DISCOUNT. The same in
 * reverse for the toe method on a rearfoot strike.
 *
 * Why it is needed: M1 and M2 are the same landmark seen twice, so on a
 * forefoot strike two late heel votes plus one late pelvis vote outweigh the
 * two on-time votes from the toe and the lowest point. That was latent while
 * the pelvis method happened to be exact on the synthetic runner; on the
 * physically driven one, whose pelvis velocity minimum trails contact by
 * ~30 ms as a sine-shaped ground force says it must, every forefoot strike
 * was placed 55 ms late.
 */
export const ARRIVAL_LEAD_MS = 25;
export const ARRIVAL_DISCOUNT = 0.25;

/**
 * ...and never less than this many sigmas of the noise still in the filtered
 * track (D53).
 *
 * The plateau walk-back used to start from the signal's own minimum and stop
 * at the first sample more than 1% of the excursion above it. Both halves of
 * that assume a clean plateau. On pose data the stance plateau wobbles — the
 * filtered noise is slow, so it wobbles rather than jitters — and its minimum
 * is a noise trough somewhere in mid-stance. The walk-back then stopped at the
 * first wobble, and the strongest strike detector placed contact a median
 * 75 ms late at 0.3% landmark noise. Two changes, both of which reduce to the
 * old behavior on a clean signal (so the golden values did not move):
 *
 *   - the floor is the ROBUST ground level (median of the lowest quarter of
 *     the signal, which for a foot is all stance), not the noisy minimum;
 *   - the tolerance is at least PLATEAU_NOISE_SIGMAS of the track's measured
 *     noise, from residual analysis in conditioning.
 */
export const PLATEAU_NOISE_SIGMAS = 3;

/**
 * Where the noise-aware path takes over: once three noise sigmas reach a
 * quarter of the fixed 1% tolerance. Below that the plateau is clean for every
 * practical purpose — a synthetic clip with no added noise measures about 2%
 * of it — and the original walk-back is kept unchanged, which is what keeps
 * the golden values where they were. The quarter, rather than the full
 * tolerance, because at 240 fps the filtered noise is small enough to stay
 * under 1% while still breaking the old walk-back on forefoot strikes
 * (measured: up to 35 ms of contact-time error at 0.3% landmark noise).
 */
export const NOISE_PATH_FRACTION = 0.25;
function noiseMatters(x, noisePx) {
    return PLATEAU_NOISE_SIGMAS * (noisePx || 0) > NOISE_PATH_FRACTION * PLATEAU_TOL_FRACTION * range(x);
}

/**
 * Contact time from a descent seen crossing two levels above the floor.
 *
 * A threshold above the floor fires BEFORE the foot arrives, by however long
 * the last `tol` of the descent takes — and that depends on how the foot
 * comes in. Near the ground the height above the floor behaves locally like
 * h = a (t* - t)^p: p = 1 for a foot that hits at speed, p = 2 for one that
 * settles tangentially. The slope there is v = p h / (t* - t), so two
 * crossings, at h1 = tol and h2 = 2 tol, with their slopes, give
 *
 *     p  = (t1 - t2) / (h2 / v2 - h1 / v1)
 *     t* = t1 + p h1 / v1
 *
 * which adapts to the approach rather than assuming one. p is clamped to
 * [1, 2.5] and the extrapolation to a quarter of the descent, so a noisy slope
 * cannot throw the event into the middle of stance.
 */
export function extrapolateContact(x, iCross, floor, tol, maxBack) {
    const h1 = tol, h2 = 2 * tol;
    const i2 = onsetBelow(x, iCross, floor + h2, maxBack);
    if (!(i2 < iCross)) return iCross;
    const slope = (fi) => {
        const k = Math.round(fi);
        if (k < 1 || k >= x.length - 1) return NaN;
        return (x[k - 1] - x[k + 1]) / 2;          /* descending: positive */
    };
    const v1 = slope(iCross), v2 = slope(i2);
    if (!(v1 > 0) || !(v2 > 0)) return iCross;
    const denom = h2 / v2 - h1 / v1;
    let pExp = denom > 0 ? (iCross - i2) / denom : 1;
    pExp = Math.min(2.5, Math.max(1, pExp));
    const ahead = Math.min(pExp * h1 / v1, 0.25 * maxBack, 2 * (iCross - i2) + 1);
    return iCross + ahead;
}

/** Robust floor of a signal: the median of its lowest quarter. */
export function robustFloor(x) {
    const v = [];
    for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i])) v.push(x[i]);
    if (!v.length) return NaN;
    v.sort((a, b) => a - b);
    return median(v.slice(0, Math.max(1, Math.floor(v.length / 4))));
}

/**
 * Walk back from a minimum while the signal stays within `level`, then return
 * the sub-frame crossing of `level` on the way in. `plateauOnset` with the
 * floor fixed rather than taken from the sample at `index`.
 */
export function onsetBelow(x, index, level, maxBack) {
    const i = Math.round(index);
    if (!(i >= 0) || i >= x.length || !Number.isFinite(x[i]) || !(x[i] <= level)) return index;
    const stop = Math.max(0, i - maxBack);
    let j = i;
    while (j > stop && Number.isFinite(x[j - 1]) && x[j - 1] <= level) j--;
    if (j === i) return index;
    const a = x[j - 1], b = x[j];
    if (Number.isFinite(a) && a > b) {
        const f = (level - b) / (a - b);
        return j - Math.min(1, Math.max(0, f));
    }
    return j;
}

export const STRIKE_METHODS = {
    M0: { w: 1.3, label: 'lowest point of the foot reaching the ground' },
    M1: { w: 1.0, label: 'heel vertical position minimum' },
    M2: { w: 1.0, label: 'heel vertical velocity zero crossing' },
    M3: { w: 0.8, label: 'toe vertical position minimum' },
    M4: { w: 0.6, label: 'foot horizontal speed minimum' },
    M5: { w: 0.9, label: 'pelvis vertical velocity minimum' },
    S2: { w: 1.5, label: 'learned stance model' }
};

export const TOEOFF_METHODS = {
    N1: { w: 1.2, label: 'peak knee extension' },
    N2: { w: 0.8, label: 'toe lift-off' },
    N3: { w: 0.6, label: 'peak foot forward acceleration' },
    S2: { w: 1.5, label: 'learned stance model' }
};

/**
 * @param {import('../signal/condition.js').Conditioned} cond
 * @param {{stage2?: {strikes: {t:number,side:'L'|'R'}[], toeoffs: {t:number,side:'L'|'R'}[]}}} [opts]
 */
export function detectEvents(cond, opts = {}) {
    const { fps, t, n, kp } = cond;

    /* ---- 0. An independent estimate of step frequency ------------------
       The pelvis rises and falls once per STEP, so the dominant frequency of
       hipMid_y IS the step frequency, arrived at without looking at a single
       gait event. It sets the peak-separation windows below and, at the end,
       cross-checks the answer the events give. */
    const spectral = dominantFrequency(kp.hipMid.y, fps, 1.0, 3.6);
    const stepHz = Number.isFinite(spectral.freq) && spectral.snr > 2 ? spectral.freq : 2.75;
    const stepFrames = fps / stepHz;
    const strideFrames = 2 * stepFrames;
    const sepSame = Math.max(3, 0.55 * strideFrames);
    const sepStep = Math.max(2, 0.55 * stepFrames);
    const plateauBack = Math.max(2, Math.round(0.45 * strideFrames));
    /* separation that merges noise ripple without merging two real instants */
    const sepFine = Math.max(3, Math.round(0.06 * strideFrames));

    const kneeInterior = { L: kneeInteriorSeries(cond, 'L'), R: kneeInteriorSeries(cond, 'R') };

    /* ---- 1. Foot-strike candidates -------------------------------------- */
    /** @type {{t:number, side:'L'|'R', method:string, w:number}[]} */
    const strikeCands = [];

    const tAt = (idx) => sampleAt(t, idx);

    for (const side of ['L', 'R']) {
        const heel = kp['heel' + side];
        const toe = kp['toe' + side];
        const foot = kp['foot' + side];

        /* Plateau tolerance, as a fraction of the landmark's own excursion so it
           survives a change of camera distance. Small: the walk-back is looking
           for the moment the descent stops, and a generous tolerance walks past
           it into the approach. */
        const heelTol = Math.max(PLATEAU_TOL_FRACTION * range(heel.y), PLATEAU_NOISE_SIGMAS * (heel.noisePx || 0));
        const toeTol = Math.max(PLATEAU_TOL_FRACTION * range(toe.y), PLATEAU_NOISE_SIGMAS * (toe.noisePx || 0));
        const heelFloor = robustFloor(heel.y), toeFloor = robustFloor(toe.y);
        /* the noise the min of two tracks carries is about the larger of theirs */
        const footNoise = Math.max(heel.noisePx || 0, toe.noisePx || 0);

        /* M0 — the lowest point of the FOOT reaching the ground.
           This is the primary strike detector and the only one here that is
           strike-pattern independent by construction, so it is worth being
           precise about why it exists.

           The heel methods below (M1, M2) are not independent of each other —
           they are the same landmark seen through position and through its
           derivative — and together they outweigh everything else. On a
           forefoot striker the heel does not reach the ground until roughly
           70 ms after the foot does, so a vote dominated by heel evidence puts
           every contact 70 ms late and shortens every measured contact time by
           the same amount. Measured on the synthetic forefoot runner before
           this method was added: 72 ms mean absolute error, against 6 ms for
           the rearfoot runner. That is not noise, it is a bias applied to one
           population and not the other, and it falls precisely on the
           distinction the product exists to measure.

           Contact is the moment ANY part of the foot arrives. Tracking the
           lower of heel and toe makes that literal, and which of the two it
           turns out to be is the strike pattern itself. */
        const footLow = new Float64Array(n);
        for (let f = 0; f < n; f++) {
            const a = heel.y[f], b = toe.y[f];
            footLow[f] = Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b)
                : Number.isFinite(a) ? a : b;
        }
        const lowTol = Math.max(PLATEAU_TOL_FRACTION * range(footLow), PLATEAU_NOISE_SIGMAS * footNoise);
        const lowFloor = robustFloor(footLow);
        for (const pk of localMinima(footLow, sepSame)) {
            const idx = noiseMatters(footLow, footNoise)
                ? arrival(footLow, pk.index, lowFloor, lowTol, plateauBack)
                : plateauOnset(footLow, pk.index, lowTol, plateauBack);
            strikeCands.push({ t: tAt(idx), side, method: 'M0', w: STRIKE_METHODS.M0.w });
        }

        /* M1 — heel vertical position minimum, taken at the ONSET of the
           plateau rather than at its far end (see plateauOnset). */
        for (const p of localMinima(heel.y, sepSame)) {
            const idx = noiseMatters(heel.y, heel.noisePx)
                ? arrival(heel.y, p.index, heelFloor, heelTol, plateauBack)
                : plateauOnset(heel.y, p.index, heelTol, plateauBack);
            strikeCands.push({ t: tAt(idx), side, method: 'M1', w: STRIKE_METHODS.M1.w });
        }

        /* M2 — the heel's descent being ARRESTED, i.e. its vertical velocity
           returning upward through zero.
           Taken literally, "the zero crossing of heel_vy" is unusable: once the
           heel is down, vy sits on zero for the rest of stance and ripples
           across it repeatedly, so a bare crossing test produces several
           candidates per stance and no way to choose. What identifies contact
           is the FIRST crossing after a genuine descent, so each candidate is
           anchored on a strongly negative heel_vy minimum. Same event as M1
           seen through the derivative, and it fails differently — M1 is blunt
           when the heel dwells, M2 is sharp there and noisy under motion blur. */
        for (const idx of arrestPoints(heel.vy, sepSame)) {
            strikeCands.push({ t: tAt(idx), side, method: 'M2', w: STRIKE_METHODS.M2.w });
        }

        /* M3 — toe vertical position minimum. This is the one that carries
           forefoot strikers, whose heel never reaches the ground at contact at
           all. For a rearfoot striker it lands late, by the time it takes the
           foot to flatten, and the median vote below discards it rather than
           averaging it in. */
        for (const p of localMinima(toe.y, sepSame)) {
            const idx = noiseMatters(toe.y, toe.noisePx)
                ? arrival(toe.y, p.index, toeFloor, toeTol, plateauBack)
                : plateauOnset(toe.y, p.index, toeTol, plateauBack);
            strikeCands.push({ t: tAt(idx), side, method: 'M3', w: STRIKE_METHODS.M3.w });
        }

        /* M4 — the foot settling to its stance velocity.
           Not to ZERO velocity: on a treadmill the planted foot travels
           backward at belt speed for the whole of stance, so a detector
           looking for a stationary foot finds nothing at all. What is invariant
           is that stance velocity is CONSTANT, whatever its value, so the
           reference is estimated from the data (the slow half of the foot's
           own velocity distribution, which stance dominates) and the detector
           looks for the onset of the plateau in the departure from it. */
        const stanceVx = estimateStanceVx(foot.vx);
        const dev = new Float64Array(n);
        for (let f = 0; f < n; f++) dev[f] = Math.abs(foot.vx[f] - stanceVx);
        const devTol = PLATEAU_TOL_FRACTION * range(dev);
        for (const p of localMinima(dev, sepSame)) {
            const idx = plateauOnset(dev, p.index, devTol, plateauBack);
            strikeCands.push({ t: tAt(idx), side, method: 'M4', w: STRIKE_METHODS.M4.w });
        }
    }

    /* M5 — pelvis vertical velocity minimum. During flight the body is in free
       fall and the pelvis accelerates downward; at contact the ground reaction
       force begins to arrest it, so the most negative pelvis vertical velocity
       marks contact. This method knows nothing about the foot, which is exactly
       why it is here: it is strike-pattern INDEPENDENT, so it does not share
       the heel methods' bias. It cannot tell left from right on its own, so
       each candidate is assigned to whichever heel is lower at that instant. */
    for (const p of localMinima(kp.hipMid.vy, sepStep)) {
        const f = Math.round(p.index);
        if (f < 0 || f >= n) continue;
        const yl = kp.heelL.y[f], yr = kp.heelR.y[f];
        if (!Number.isFinite(yl) && !Number.isFinite(yr)) continue;
        const side = (!Number.isFinite(yr) || yl < yr) ? 'L' : 'R';
        strikeCands.push({ t: tAt(p.index), side, method: 'M5', w: STRIKE_METHODS.M5.w });
    }

    /* Stage-2 model, when one is present, is simply another voter — a heavy
       one. It is never load-bearing on its own: with no model file shipped the
       geometric detector is unchanged. */
    if (opts.stage2) {
        for (const s of opts.stage2.strikes || []) {
            strikeCands.push({ t: s.t, side: s.side, method: 'S2', w: STRIKE_METHODS.S2.w });
        }
    }

    /* ---- 1b. Who arrived first ------------------------------------------ */
    for (const side of ['L', 'R']) {
        const heel = kp['heel' + side], toe = kp['toe' + side];
        /* The ground level of each landmark from a LOW PERCENTILE, not the
           median of its lowest quarter: a forefoot striker's heel is on the
           ground for well under a quarter of the cycle, so the quarter's median
           sits centimeters above the heel's real contact height. */
        const downMask = (trk) => {
            const floor = quantile(Array.from(trk.y), 0.08);
            const tol = Math.max(PLATEAU_TOL_FRACTION * range(trk.y), PLATEAU_NOISE_SIGMAS * (trk.noisePx || 0));
            const m = new Uint8Array(n);
            for (let f = 0; f < n; f++) m[f] = Number.isFinite(trk.y[f]) && trk.y[f] <= floor + tol ? 1 : 0;
            return m;
        };
        const heelDown = downMask(heel), toeDown = downMask(toe);
        /* When did this landmark's current ground contact begin? Walk back from
           the candidate through the frames it is down. NaN if it is not down. */
        const landedAt = (mask, tSec) => {
            let f = Math.round(indexOf(tSec, t));
            if (f < 0 || f >= n || !mask[f]) return NaN;
            const stop = Math.max(0, f - plateauBack);
            while (f > stop && mask[f - 1]) f--;
            return t[f];
        };
        const lead = ARRIVAL_LEAD_MS / 1000;
        for (const c of strikeCands) {
            if (c.side !== side) continue;
            if (c.method !== 'M1' && c.method !== 'M2' && c.method !== 'M3') continue;
            /* look a little past the candidate so a heel that is about to settle
               still counts as landed */
            const probeT = c.t + lead;
            const th = landedAt(heelDown, probeT), tt = landedAt(toeDown, probeT);
            if (!Number.isFinite(th) || !Number.isFinite(tt)) continue;
            if ((c.method === 'M1' || c.method === 'M2') && tt < th - lead) c.w *= ARRIVAL_DISCOUNT;
            else if (c.method === 'M3' && th < tt - lead) c.w *= ARRIVAL_DISCOUNT;
        }
    }

    /* ---- 2. Vote, then enforce same-foot separation --------------------- */
    const strikes = [];
    for (const side of ['L', 'R']) {
        strikes.push(...vote(strikeCands.filter(c => c.side === side), side, 'strike'));
    }
    strikes.sort((a, b) => a.t - b.t);
    const keptStrikes = enforceSeparation(strikes, SAME_FOOT_MIN_MS / 1000);

    /* ---- 3. Toe-off, searched INSIDE each stance window ------------------
       Toe-off is not detected independently and then matched to a strike: it is
       defined relative to one. The knee reaches full extension twice per
       stride, once approaching toe-off and again in terminal swing, and the two
       peaks are the same height — no amount of prominence ranking separates
       them. Searching only the interval [strike + 100 ms, strike + 400 ms],
       which is the plausible stance duration the sanity constraints already
       assert, removes the terminal-swing peak by construction rather than by
       hoping the vote outweighs it. */
    const keptToeoffs = [];
    for (const strike of keptStrikes) {
        const side = strike.side;
        const foot = kp['foot' + side];
        const toe = kp['toe' + side];
        const lo = strike.t + STANCE_MS[0] / 1000;
        const hi = strike.t + STANCE_MS[1] / 1000;
        /** @type {{t:number, side:'L'|'R', method:string, w:number}[]} */
        const cands = [];

        /* Candidates are suppressed at `sepFine`, a real fraction of the
           stride rather than three samples. Three samples merges nothing: on
           noisy landmarks each of these signals ripples across its own
           threshold repeatedly, producing a dozen candidates per window where
           there is one event. `sepFine` is wide enough to collapse that ripple
           and narrow enough to keep two genuinely different instants apart. */
        const wLo = indexOf(lo, t), wHi = indexOf(hi, t) + 1;
        const inWin = (idx) => idx >= wLo && idx <= wHi;

        /* N1 — peak knee extension: the most accurate kinematic toe-off cue in
           the literature, and the reason toe-off is the cheap half of the
           contact-time error budget. */
        for (const pk of localMaxima(kneeInterior[side], sepFine)) {
            if (inWin(pk.index)) cands.push({ t: tAt(pk.index), side, method: 'N1', w: TOEOFF_METHODS.N1.w });
        }

        /* N2 — the toe starting to rise.
           TODO(spec): the specification words this as "local maximum of toe_y
           after the stance minimum", which is peak SWING height — well after
           the foot has left the ground, and roughly 150 ms late. The simplest
           correct reading is the instant the toe begins to leave the ground. */
        for (const z of zeroCrossings(toe.vy, 'up')) {
            if (inWin(z.index)) cands.push({ t: tAt(z.index), side, method: 'N2', w: TOEOFF_METHODS.N2.w });
        }

        /* N3 — peak forward acceleration of the foot, as the ankle
           plantarflexes and the leg is thrown into swing. */
        for (const pk of localMaxima(foot.ax, sepFine)) {
            if (inWin(pk.index)) cands.push({ t: tAt(pk.index), side, method: 'N3', w: TOEOFF_METHODS.N3.w });
        }

        if (opts.stage2) {
            for (const s of opts.stage2.toeoffs || []) {
                if (s.side === side && s.t >= lo && s.t <= hi) {
                    cands.push({ t: s.t, side, method: 'S2', w: TOEOFF_METHODS.S2.w });
                }
            }
        }
        const voted = vote(cands, side, 'toeoff');
        if (voted.length) {
            voted.sort((a, b) => b.weight - a.weight || a.spreadMs - b.spreadMs);
            keptToeoffs.push(voted[0]);
        }
    }
    keptToeoffs.sort((a, b) => a.t - b.t);

    /* ---- 4. Alternation ------------------------------------------------ */
    const alternation = checkAlternation(keptStrikes);

    /* ---- 5. Strides ---------------------------------------------------- */
    const strides = buildStrides(keptStrikes, keptToeoffs, cond);

    /* ---- 6. Cadence cross-check ---------------------------------------- */
    const stepTimes = [];
    for (let i = 1; i < keptStrikes.length; i++) {
        if (keptStrikes[i].side !== keptStrikes[i - 1].side) {
            stepTimes.push(keptStrikes[i].t - keptStrikes[i - 1].t);
        }
    }
    const medStep = median(stepTimes);
    const cadenceEvents = Number.isFinite(medStep) && medStep > 0 ? 60 / medStep : NaN;
    const cadenceSpectral = 60 * stepHz;
    const disagreement = Number.isFinite(cadenceEvents) && Number.isFinite(cadenceSpectral)
        ? Math.abs(cadenceEvents - cadenceSpectral) / cadenceSpectral
        : NaN;

    return {
        strikes: keptStrikes,
        toeoffs: keptToeoffs,
        strides,
        cadenceEvents,
        cadenceSpectral,
        spectralSnr: spectral.snr,
        cadenceDisagreement: disagreement,
        cadenceAgrees: Number.isFinite(disagreement) && disagreement <= CADENCE_CROSSCHECK_TOL,
        alternation,
        candidateCount: { strike: strikeCands.length, toeoff: keptToeoffs.length },
        ...(opts.debug ? { _strikeCandidates: strikeCands } : {})
    };
}

/**
 * Weighted vote over candidates for one foot and one event kind.
 *
 * Greedy and seeded by weight: the strongest unassigned candidate anchors a
 * cluster and absorbs everything within the window. Anchoring on the strong
 * methods rather than on whatever came first makes the result independent of
 * candidate ordering.
 */
function vote(cands, side, kind) {
    const win = CLUSTER_WINDOW_MS / 1000;
    /* A candidate without a finite time can never fall inside its own window,
       so it would be chosen as a seed, absorb nothing, stay unused, and be
       chosen again forever. Dropped here, whatever produced it. */
    const pool = cands.filter(c => Number.isFinite(c.t) && Number.isFinite(c.w)).sort((a, b) => a.t - b.t);
    const used = new Array(pool.length).fill(false);
    /** @type {import('../types.js').GaitEvent[]} */
    const out = [];

    /* Seed each cluster on the candidate with the heaviest NEIGHBORHOOD, not
       on the heaviest candidate and not on the first one.

       This is where an earlier version of this went wrong, and the failure was
       instructive: seeding on "the heaviest, earliest" candidate meant that
       when noise scattered several candidates of one method across the window,
       the earliest of them anchored the cluster and dragged the event early.
       The bias therefore GREW with noise, which is exactly backward for
       something meant to be robust. Asking which candidate has the most
       agreement around it is a mode-seeking choice and does not depend on
       ordering at all. */
    const neighborWeight = pool.map((c, i) => {
        let s = 0;
        for (let j = 0; j < pool.length; j++) if (Math.abs(pool[j].t - c.t) <= win) s += pool[j].w;
        void i;
        return s;
    });

    while (true) {
        let best = -1, bestScore = -1;
        for (let i = 0; i < pool.length; i++) {
            if (used[i]) continue;
            const score = neighborWeight[i] + pool[i].w * 1e-3;
            if (score > bestScore) { bestScore = score; best = i; }
        }
        if (best < 0) break;
        const seed = pool[best];
        used[best] = true;
        const members = [seed];
        for (let j = 0; j < pool.length; j++) {
            if (used[j]) continue;
            if (Math.abs(pool[j].t - seed.t) <= win) { members.push(pool[j]); used[j] = true; }
        }
        /* one vote per method: duplicates of the same method inside a window
           are the same observation seen twice, not corroboration */
        const byMethod = new Map();
        for (const m of members) {
            const prev = byMethod.get(m.method);
            if (!prev || Math.abs(m.t - seed.t) < Math.abs(prev.t - seed.t)) byMethod.set(m.method, m);
        }
        const uniq = [...byMethod.values()];
        const weight = uniq.reduce((s, m) => s + m.w, 0);
        /* members are already marked used, so skipping here cannot loop */
        if (weight < MIN_CLUSTER_WEIGHT) continue;

        const times = uniq.map(m => m.t);
        const weights = uniq.map(m => m.w);
        /* Weighted median first, for its breakdown point: a method that fires
           in the wrong place cannot move it. Then the weighted MEAN of the
           members that survive a window around that median, because once the
           outliers are gone the mean uses all of the information and the median
           throws most of it away. */
        const med = weightedMedian(times, weights);
        let num = 0, den = 0;
        for (let m = 0; m < times.length; m++) {
            if (Math.abs(times[m] - med) <= win) { num += times[m] * weights[m]; den += weights[m]; }
        }
        const tEvent = den > 0 ? num / den : med;

        /* Three numbers, and the distinction between them matters.

           `rangeMs`  — max minus min. What the specification names, and the
                        wrong thing to gate on: it grows with the number of
                        methods that voted, so adding a corroborating detector
                        makes a well-determined event look worse.

           `spreadMs` — the weighted SD about the voted time. How much the
                        methods DISAGREE. Independent of how many voted, and
                        the right diagnostic to show.

           `sigmaMs`  — the standard error of the weighted mean, using Kish's
                        effective sample size. How well the CONSENSUS is
                        determined, which is the quantity the confidence gate
                        and the error budget actually want.

           Gating on the spread rather than the standard error reintroduces the
           same perverse incentive in a subtler form. A midfoot strike is seen
           by five detectors instead of three, because heel and toe arrive
           together; they disagree by a little more, so the SD rises past the
           limit and every stride is thrown away — better evidence producing a
           worse answer. The standard error falls, correctly, as it should when
           five independent estimates agree on a value. */
        let ss = 0, sw2 = 0;
        for (let m = 0; m < times.length; m++) {
            ss += weights[m] * (times[m] - tEvent) ** 2;
            sw2 += weights[m] * weights[m];
        }
        const spreadMs = Math.sqrt(ss / weight) * 1000;
        const nEff = sw2 > 0 ? (weight * weight) / sw2 : 1;
        const sigmaMs = spreadMs / Math.sqrt(Math.max(1, nEff));
        const rangeMs = (Math.max(...times) - Math.min(...times)) * 1000;
        out.push({
            kind, side, t: tEvent, spreadMs, sigmaMs, rangeMs, weight, nEff,
            methods: uniq.map(m => m.method).sort()
        });
    }
    return out.sort((a, b) => a.t - b.t);
}

/**
 * The noise-aware arrival.
 *
 * Walking BACK from the minimum through the plateau fails on real data even
 * with a noise-scaled tolerance: the filtered noise is slow, so the stance
 * plateau wobbles by up to three sigmas over a few frames, and the walk-back
 * stops at whichever wobble is nearest the minimum — measured at 1% landmark
 * noise, one strike in five placed 50-100 ms late. So the search runs the
 * other way. Find the last sample before the minimum that is unambiguously
 * still in the air (a quarter of the excursion up, and well clear of the
 * noise), then walk FORWARD to the first arrival within `tol` of the floor.
 * Whatever the plateau does after the foot has arrived cannot move that.
 * Then extrapolate the descent to the floor itself.
 */
function arrival(x, index, robust, tol, maxBack) {
    const r = arrivalRaw(x, index, robust, tol, maxBack);
    /* the extrapolation can run past the last frame for a strike at the very
       end of the clip; clamp it so the candidate keeps a real time */
    return Number.isFinite(r) ? Math.min(x.length - 1, Math.max(0, r)) : index;
}
function arrivalRaw(x, index, robust, tol, maxBack) {
    const i = Math.round(index);
    if (!(i >= 0) || i >= x.length || !Number.isFinite(x[i])) return index;
    const floor = robust;
    const high = floor + Math.max(0.25 * range(x), 2 * tol);
    const stop = Math.max(1, i - maxBack);
    let j = i;
    while (j > stop && !(x[j] > high)) j--;
    if (!(x[j] > high)) return onsetBelow(x, index, Math.max(floor, x[i]) + tol, maxBack);
    let k = j;
    while (k < i && !(x[k] <= floor + tol)) k++;
    /* sub-frame crossing of floor + tol between k-1 and k */
    const a = x[k - 1], b = x[k];
    let cross = k;
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
        cross = k - Math.min(1, Math.max(0, (floor + tol - b) / (a - b)));
    }
    return extrapolateContact(x, cross, floor, tol, maxBack);
}

/** Drop the weaker of any two same-foot events closer than `minSep` seconds. */
function enforceSeparation(events, minSep) {
    const bySide = { L: [], R: [] };
    for (const e of events) bySide[e.side].push(e);
    const kept = [];
    for (const side of ['L', 'R']) {
        const ranked = bySide[side].slice().sort((a, b) => (b.weight - a.weight) || (a.spreadMs - b.spreadMs));
        /** @type {import('../types.js').GaitEvent[]} */
        const acc = [];
        for (const e of ranked) {
            if (acc.some(k => Math.abs(k.t - e.t) < minSep)) continue;
            acc.push(e);
        }
        kept.push(...acc);
    }
    return kept.sort((a, b) => a.t - b.t);
}

/** Foot strikes must alternate L, R, L, R. Report the violations. */
function checkAlternation(strikes) {
    let violations = 0;
    for (let i = 1; i < strikes.length; i++) {
        if (strikes[i].side === strikes[i - 1].side) violations++;
    }
    return { violations, total: Math.max(0, strikes.length - 1), ok: violations === 0 };
}

/**
 * Assemble strides and apply the sanity constraints.
 * A stride runs from one foot strike to the NEXT strike of the same foot and
 * must contain that foot's toe-off and the contralateral strike.
 */
function buildStrides(strikes, toeoffs, cond) {
    const out = [];
    const bySide = { L: strikes.filter(s => s.side === 'L'), R: strikes.filter(s => s.side === 'R') };

    for (const side of ['L', 'R']) {
        const list = bySide[side];
        const other = side === 'L' ? 'R' : 'L';
        for (let i = 0; i < list.length - 1; i++) {
            const a = list[i], b = list[i + 1];
            const strideS = b.t - a.t;
            const toeoff = toeoffs.find(o => o.side === side && o.t > a.t + STANCE_MS[0] / 1000 && o.t < a.t + STANCE_MS[1] / 1000);
            const oppStrike = strikes.find(s => s.side === other && s.t > a.t && s.t < b.t);

            const reasons = [];
            if (!toeoff) reasons.push('no toe-off inside the plausible stance window');
            if (!oppStrike) reasons.push('no contralateral strike inside the stride');
            const stance = toeoff ? toeoff.t - a.t : NaN;
            const duty = toeoff ? stance / strideS : NaN;
            if (!(strideS * 1000 >= STRIDE_MS[0] && strideS * 1000 <= STRIDE_MS[1])) {
                reasons.push(`stride time ${(strideS * 1000).toFixed(0)} ms outside ${STRIDE_MS[0]}-${STRIDE_MS[1]} ms`);
            }
            if (toeoff && !(stance * 1000 >= STANCE_MS[0] && stance * 1000 <= STANCE_MS[1])) {
                reasons.push(`stance ${(stance * 1000).toFixed(0)} ms outside ${STANCE_MS[0]}-${STANCE_MS[1]} ms`);
            }
            if (toeoff && !(duty >= DUTY_FACTOR_RANGE[0] && duty <= DUTY_FACTOR_RANGE[1])) {
                reasons.push(`duty factor ${duty.toFixed(2)} outside ${DUTY_FACTOR_RANGE[0]}-${DUTY_FACTOR_RANGE[1]}`);
            }

            const spread = Math.max(a.spreadMs, toeoff ? toeoff.spreadMs : 0);
            const sigma = Math.max(a.sigmaMs, toeoff ? toeoff.sigmaMs : 0);
            const lowConfidence = sigma > EVENT_SPREAD_LIMIT_MS;

            out.push({
                side,
                strike: a,
                nextStrike: b,
                toeoff: toeoff || null,
                oppStrike: oppStrike || null,
                strideTime: strideS,
                stanceTime: stance,
                dutyFactor: duty,
                stepTime: oppStrike ? oppStrike.t - a.t : NaN,
                flightTime: toeoff && oppStrike ? oppStrike.t - toeoff.t : NaN,
                spreadMs: spread,
                sigmaMs: sigma,
                valid: reasons.length === 0,
                lowConfidence,
                reasons,
                i0: Math.round(indexOf(a.t, cond.t)),
                i1: Math.round(indexOf(b.t, cond.t))
            });
        }
    }
    return out.sort((a, b) => a.strike.t - b.strike.t);
}

function indexOf(tSec, times) {
    let lo = 0, hi = times.length - 1;
    if (tSec <= times[0]) return 0;
    if (tSec >= times[hi]) return hi;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= tSec) lo = mid; else hi = mid;
    }
    return lo;
}

/**
 * The instants at which a strong downward motion is arrested: for each clearly
 * negative minimum of `v`, the first upward zero crossing after it.
 * Sub-frame by the linear interpolation zeroCrossings already does.
 */
function arrestPoints(v, minSep) {
    let vMin = 0;
    for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i]) && v[i] < vMin) vMin = v[i];
    if (!(vMin < 0)) return [];
    const gate = 0.30 * vMin;                 /* "a genuine descent", not ripple */
    const ups = zeroCrossings(v, 'up');
    const out = [];
    for (const m of localMinima(v, minSep || 3)) {
        if (!(m.value <= gate)) continue;
        const next = ups.find(z => z.index >= m.index);
        if (next && out[out.length - 1] !== next.index) out.push(next.index);
    }
    return out;
}

/**
 * The foot's stance-phase horizontal velocity, estimated from the data.
 * Zero overground, minus the belt speed on a treadmill. Stance occupies most of
 * the cycle and is the slow half of the distribution, so the median of the
 * slower half recovers it without being told which surface this is.
 */
function estimateStanceVx(vx) {
    const finite = [];
    for (let i = 0; i < vx.length; i++) if (Number.isFinite(vx[i])) finite.push(vx[i]);
    if (!finite.length) return 0;
    const mags = finite.map(Math.abs).sort((a, b) => a - b);
    const cut = mags[Math.floor(mags.length * 0.5)];
    const slow = finite.filter(v => Math.abs(v) <= cut);
    return slow.length ? median(slow) : 0;
}

/**
 * Quantization and method uncertainty for an interval measured between two
 * detected events.
 *
 *   sigma_total = sqrt(sigma_quant^2 + sigma_a^2 + sigma_b^2)
 *
 * The quantization term is the uniform-distribution sigma T/sqrt(12) per event,
 * which reproduces the spec's error table: two events at 30 fps give
 * 1.96 * 33.3/sqrt(6) = 26.7 ms, i.e. the stated "+/- one frame".
 */
export function intervalUncertaintyMs(fps, sigmaA_ms, sigmaB_ms) {
    const T = 1000 / fps;
    const quant = 2 * (T * T) / 12;
    const sa = Number.isFinite(sigmaA_ms) ? sigmaA_ms * sigmaA_ms : 0;
    const sb = Number.isFinite(sigmaB_ms) ? sigmaB_ms * sigmaB_ms : 0;
    return Math.sqrt(quant + sa + sb);
}

/** Same, for a quantity read at a single instant. */
export function instantUncertaintyMs(fps, sigma_ms) {
    const T = 1000 / fps;
    return Math.sqrt((T * T) / 12 + (Number.isFinite(sigma_ms) ? sigma_ms * sigma_ms : 0));
}
