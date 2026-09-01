/* ============================================================
   Stride Lab — shared types, constants and small helpers.
   Pure. No DOM, no framework. Imported by the browser and by
   the Node validation suite alike.
   ============================================================ */

/**
 * @typedef {Object} PoseSeries
 * @property {string[]} names      Canonical keypoint names, in order.
 * @property {number} n            Frame count.
 * @property {Float64Array} t      Frame times, seconds, strictly increasing.
 * @property {Float64Array} xy     [frame][kp][2], normalised image coords, y DOWN.
 * @property {Float64Array} vis    [frame][kp].
 * @property {number} width        Source frame width, px.
 * @property {number} height       Source frame height, px.
 *
 * @typedef {Object} GaitEvent
 * @property {'strike'|'toeoff'} kind
 * @property {'L'|'R'} side
 * @property {number} t            Seconds, sub-frame refined.
 * @property {number} spreadMs     Inter-method spread; the event's uncertainty.
 * @property {number} weight       Summed weight of the voting methods.
 * @property {string[]} methods    Method ids that voted.
 *
 * @typedef {Object} MetricValue
 * @property {number|null} value
 * @property {number|null} sd
 * @property {number|null} ci95    Half-width of the 95% interval, same unit.
 * @property {number} n            Strides contributing.
 * @property {string} unit
 * @property {'high'|'medium'|'low'|'unavailable'} confidence
 * @property {'sagittal'|'frontal'} view
 * @property {string} method
 * @property {string} [note]
 */

/** Confidence ordering, so code can compare levels. */
export const CONFIDENCE_RANK = { unavailable: 0, low: 1, medium: 2, high: 3 };

/** @param {string} a @param {string} b */
export function atLeast(a, b) {
    return (CONFIDENCE_RANK[a] || 0) >= (CONFIDENCE_RANK[b] || 0);
}

/** Weakest of a set of confidence levels. @param {...string} levels */
export function weakest(...levels) {
    let out = 'high';
    for (const l of levels) if ((CONFIDENCE_RANK[l] || 0) < CONFIDENCE_RANK[out]) out = l;
    return out;
}

/* ---------------- Canonical skeleton ---------------- */

/**
 * The one keypoint vocabulary the whole engine speaks. Every backend maps onto
 * this in pose/skeleton.js; no metric code may reference a raw index.
 */
export const CANONICAL = [
    /* head — the ears are the reference for head posture and head stability,
       and they survive a profile view far better than the eyes do */
    'nose', 'earL', 'earR', 'eyeL', 'eyeR',
    /* upper body */
    'shoulderL', 'shoulderR',
    'elbowL', 'elbowR',
    'wristL', 'wristR',
    /* hand centroid, from whichever finger landmarks the backend provides.
       Carries hand height and whether the hands cross the midline, both of
       which are ordinary coaching cues and neither of which the wrist alone
       distinguishes from a rotated forearm. */
    'handL', 'handR',
    /* lower body */
    'hipL', 'hipR',
    'kneeL', 'kneeR',
    'ankleL', 'ankleR',
    'heelL', 'heelR',
    'toeL', 'toeR',
    /* lateral forefoot. Turns each foot from a LINE into a PLANE, which is
       what a foot progression angle needs. BlazePose has no such landmark and
       maps it to nothing; Halpe-26 does. Metrics that need it report
       themselves unavailable rather than guessing, which is the honest way for
       a backend difference to surface. */
    'footOuterL', 'footOuterR'
];

/** Landmarks that some backends genuinely do not provide. */
export const OPTIONAL_KEYPOINTS = ['footOuterL', 'footOuterR', 'eyeL', 'eyeR', 'handL', 'handR'];

/* ---------------- Winter anthropometry ---------------- */

/**
 * Segment lengths as fractions of standing height, from Winter, "Biomechanics
 * and Motor Control of Human Movement" (segment-length table / Fig. 4.1).
 * Used for the pixel-to-metre scaling in calib/scale.js and for the
 * leg-length normalisation every dimensionless metric divides by.
 */
export const WINTER = {
    /** greater trochanter -> femoral condyle */
    thigh: 0.245,
    /** femoral condyle -> medial malleolus */
    shank: 0.246,
    /** thigh + shank */
    leg: 0.491,
    /** shoulder height 0.818 H minus hip height 0.530 H */
    torso: 0.288,
    /** biacromial breadth */
    shoulderWidth: 0.259
};

/**
 * Segment inertial parameters, Winter Table 4.1.
 *
 * `mass` is the fraction of total body mass; `com` is the position of the
 * segment centre of mass along the segment, as a fraction of segment length
 * from the PROXIMAL end. The fractions sum to 1.000 and a test asserts it.
 *
 * These are what turn a set of tracked joints into a whole-body centre of
 * mass. That matters because the strongest evidenced link between running
 * technique and running economy is the vertical oscillation of the centre of
 * mass (Van Hooren et al. 2024, moderate association), and a pelvis landmark
 * is an approximation of it rather than the thing itself — it misses the
 * counter-motion of the swinging limbs entirely.
 */
export const SEGMENTS = [
    { id: 'headNeck', mass: 0.081, com: 1.000, from: 'neck', to: 'headCentre' },
    { id: 'trunk', mass: 0.497, com: 0.500, from: 'pelvis', to: 'neck' },
    { id: 'upperArmL', mass: 0.028, com: 0.436, from: 'shoulderL', to: 'elbowL' },
    { id: 'upperArmR', mass: 0.028, com: 0.436, from: 'shoulderR', to: 'elbowR' },
    { id: 'forearmL', mass: 0.016, com: 0.430, from: 'elbowL', to: 'wristL' },
    { id: 'forearmR', mass: 0.016, com: 0.430, from: 'elbowR', to: 'wristR' },
    { id: 'handL', mass: 0.006, com: 0.506, from: 'wristL', to: 'handL' },
    { id: 'handR', mass: 0.006, com: 0.506, from: 'wristR', to: 'handR' },
    { id: 'thighL', mass: 0.100, com: 0.433, from: 'hipL', to: 'kneeL' },
    { id: 'thighR', mass: 0.100, com: 0.433, from: 'hipR', to: 'kneeR' },
    { id: 'shankL', mass: 0.0465, com: 0.433, from: 'kneeL', to: 'ankleL' },
    { id: 'shankR', mass: 0.0465, com: 0.433, from: 'kneeR', to: 'ankleR' },
    { id: 'footL', mass: 0.0145, com: 0.500, from: 'heelL', to: 'toeL' },
    { id: 'footR', mass: 0.0145, com: 0.500, from: 'heelR', to: 'toeR' }
];

/**
 * Fallbacks for a segment whose distal landmark the backend does not provide.
 * A missing hand landmark must not delete 0.6% of body mass from the model and
 * shift the centre of mass; the forearm is extended instead.
 */
export const SEGMENT_FALLBACK = { handL: 'wristL', handR: 'wristR' };

/* ---------------- Physical / numeric constants ---------------- */

export const G = 9.80665;
export const DEG = 180 / Math.PI;

/* Signal conditioning */
export const VISIBILITY_GATE = 0.5;      /* below this a sample is "missing"       */
export const VISIBILITY_TRUST = 0.7;     /* scaling only uses samples above this   */
export const MAX_GAP_FRAMES = 3;         /* linear fill spans no longer than this  */
export const HAMPEL_WINDOW = 7;
export const HAMPEL_SIGMAS = 3;
export const DEFAULT_CUTOFF_HZ = 12;     /* effective, after the filtfilt fix      */
export const MISSING_FRACTION_LIMIT = 0.25;

/* View classification. Ratio = shoulderWidth_px / torsoHeight_px, median over
   frames. A true frontal view sits near WINTER.shoulderWidth / WINTER.torso
   = 0.90; a true sagittal view collapses the shoulders towards each other.
   Between the two thresholds the view is reported "oblique" and the user is
   asked to confirm, because a 3/4 view breaks every planar assumption. */
export const VIEW_SAGITTAL_MAX = 0.45;
export const VIEW_FRONTAL_MIN = 0.70;

/* Event detection */
export const CLUSTER_WINDOW_MS = 40;      /* candidates within this are one event  */
export const EVENT_SPREAD_LIMIT_MS = 25;  /* above this the stride is low-confidence */
export const STANCE_MS = [100, 400];
export const STRIDE_MS = [500, 1100];
export const DUTY_FACTOR_RANGE = [0.20, 0.50];
export const SAME_FOOT_MIN_MS = 400;
export const CADENCE_CROSSCHECK_TOL = 0.05;  /* 5% events-vs-FFT disagreement      */

/* Frame-rate gates (spec 5.2 / 5.11) */
export const FPS_REJECT_BELOW = 30;
export const FPS_TIMING_MIN = 60;         /* below this, timing metrics are suppressed */
export const FPS_FULL_PRECISION = 120;

/* Scaling */
export const SCALE_DISAGREEMENT_LIMIT = 0.20;  /* anthropometric vs world landmarks */
export const CENTRAL_BAND = 0.60;         /* analyse only the middle 60% of width   */
/* Subject height as a fraction of frame height. Below this the landmarks are
   being estimated from too few pixels to be worth much, and every angle
   inherits that. The capture guidance asks for 60-80%. */
export const SUBJECT_FILL_MIN = 0.40;

/* Foot-strike angle class boundaries, degrees, toe-up positive.
   Boundaries after Altman & Davis (2012), "A kinematic method for footstrike
   pattern detection in barefoot and shod runners", Gait and Posture 35(2). */
export const STRIKE_ANGLE_REARFOOT_ABOVE = 8;
export const STRIKE_ANGLE_FOREFOOT_BELOW = -2;

/* Asymmetry flags, percent */
export const ASYMMETRY_ATTENTION = 5;
export const ASYMMETRY_NOTABLE = 10;

/* ---------------- Small vector / statistics helpers ---------------- */

/** @typedef {{x:number,y:number}} Vec2 */

/** Signed angle in degrees from u to v, CCW positive, range (-180, 180]. */
export function signedAngle(u, v) {
    return Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * DEG;
}

/** Interior angle at `b` of the chain a-b-c, degrees, range [0, 180]. */
export function interiorAngle(a, b, c) {
    const u = { x: a.x - b.x, y: a.y - b.y };
    const w = { x: c.x - b.x, y: c.y - b.y };
    const nu = Math.hypot(u.x, u.y), nw = Math.hypot(w.x, w.y);
    if (!(nu > 0) || !(nw > 0)) return NaN;
    const cos = Math.min(1, Math.max(-1, (u.x * w.x + u.y * w.y) / (nu * nw)));
    return Math.acos(cos) * DEG;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Median of the finite entries. NaN if there are none. */
export function median(values) {
    const a = [];
    for (const v of values) if (Number.isFinite(v)) a.push(v);
    if (!a.length) return NaN;
    a.sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}

/** Median absolute deviation, scaled to be a consistent sigma estimate. */
/**
 * Linear-interpolated quantile. Used where a RANGE would be wrong: the spread
 * of a set that may contain a couple of outliers, such as frame intervals over
 * a clip that skipped a frame.
 *
 * @param {number[]} values
 * @param {number} q  in [0, 1]
 */
export function quantile(values, q) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    if (v.length === 1) return v[0];
    const pos = clamp(q, 0, 1) * (v.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function mad(values, med) {
    const m = Number.isFinite(med) ? med : median(values);
    const d = [];
    for (const v of values) if (Number.isFinite(v)) d.push(Math.abs(v - m));
    if (!d.length) return NaN;
    return 1.4826 * median(d);
}

export function mean(values) {
    let s = 0, n = 0;
    for (const v of values) if (Number.isFinite(v)) { s += v; n++; }
    return n ? s / n : NaN;
}

/** Sample standard deviation (n-1). */
export function sd(values) {
    const a = [];
    for (const v of values) if (Number.isFinite(v)) a.push(v);
    if (a.length < 2) return NaN;
    const m = mean(a);
    let s = 0;
    for (const v of a) s += (v - m) * (v - m);
    return Math.sqrt(s / (a.length - 1));
}

/**
 * Trimmed mean, `frac` from each tail. With few samples the trim is skipped
 * rather than emptying the set — an aggregate over three strides must still
 * produce a number.
 */
export function trimmedMean(values, frac = 0.1) {
    const a = [];
    for (const v of values) if (Number.isFinite(v)) a.push(v);
    if (!a.length) return NaN;
    a.sort((p, q) => p - q);
    const k = Math.floor(a.length * frac);
    const slice = (a.length - 2 * k) >= 1 ? a.slice(k, a.length - k) : a;
    return mean(slice);
}

/** Weighted median. Ties resolve to the lower of the bracketing samples. */
export function weightedMedian(values, weights) {
    const pairs = [];
    let total = 0;
    for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i])) continue;
        pairs.push([values[i], weights[i]]);
        total += weights[i];
    }
    if (!pairs.length) return NaN;
    pairs.sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const pair of pairs) {
        acc += pair[1];
        if (acc >= total / 2) return pair[0];
    }
    return pairs[pairs.length - 1][0];
}

/** Asymmetry index, percent: 200|L-R| / (|L|+|R|). */
export function asymmetryIndex(l, r) {
    if (!Number.isFinite(l) || !Number.isFinite(r)) return NaN;
    const s = Math.abs(l) + Math.abs(r);
    if (s === 0) return 0;
    return 200 * Math.abs(l - r) / s;
}

/** Linear interpolation of `arr` at fractional index `i`. */
export function sampleAt(arr, i) {
    if (!(i >= 0) || i > arr.length - 1) return NaN;
    const i0 = Math.floor(i);
    const i1 = Math.min(arr.length - 1, i0 + 1);
    const f = i - i0;
    const a = arr[i0], b = arr[i1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isFinite(a) ? a : b;
    return a + (b - a) * f;
}

/** Fractional frame index for time `t` given a strictly increasing time base. */
export function indexAtTime(t, times) {
    const n = times.length;
    if (!n) return NaN;
    if (t <= times[0]) return 0;
    if (t >= times[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid; else hi = mid;
    }
    const span = times[hi] - times[lo];
    return span > 0 ? lo + (t - times[lo]) / span : lo;
}
