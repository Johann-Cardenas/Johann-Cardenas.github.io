/* ============================================================
   Stride Lab — extrema, zero crossings, and the FFT used for the
   independent cadence cross-check.

   Every locator here returns SUB-FRAME positions where it can.
   At 60 fps one frame is 16.7 ms and ground contact is ~230 ms,
   so recovering a fraction of a frame is not a nicety: it is a
   measurable part of the error budget for nearly free.
   ============================================================ */

/**
 * Local minima of `x`, sub-frame refined by fitting a parabola through the
 * three samples around each minimum.
 *
 * @param {Float64Array} x
 * @param {number} minSeparation  samples; suppresses the weaker of two minima
 *                                closer than this
 * @returns {{index:number, value:number}[]}
 */
export function localMinima(x, minSeparation = 1) {
    const raw = [];
    for (let i = 1; i < x.length - 1; i++) {
        const a = x[i - 1], b = x[i], c = x[i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
        if (b <= a && b < c) {
            const denom = a - 2 * b + c;
            const delta = denom !== 0 ? 0.5 * (a - c) / denom : 0;
            raw.push({
                index: i + (Math.abs(delta) <= 1 ? delta : 0),
                value: b - 0.25 * (a - c) * (Math.abs(delta) <= 1 ? delta : 0)
            });
        }
    }
    return suppress(raw, minSeparation, (p, q) => p.value - q.value);
}

/** Local maxima, same contract as localMinima. */
export function localMaxima(x, minSeparation = 1) {
    const neg = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) neg[i] = Number.isFinite(x[i]) ? -x[i] : NaN;
    return localMinima(neg, minSeparation).map(p => ({ index: p.index, value: -p.value }));
}

/**
 * Keep the best candidate within every `minSeparation` window.
 * `better(p, q) < 0` means p wins.
 */
function suppress(list, minSeparation, better) {
    if (minSeparation <= 1 || list.length < 2) return list;
    const sorted = list.slice().sort(better);
    /** @type {{index:number,value:number}[]} */
    const kept = [];
    for (const cand of sorted) {
        let clash = false;
        for (const k of kept) if (Math.abs(k.index - cand.index) < minSeparation) { clash = true; break; }
        if (!clash) kept.push(cand);
    }
    return kept.sort((p, q) => p.index - q.index);
}

/**
 * Zero crossings of `x`, sub-frame refined by linear interpolation between the
 * bracketing samples.
 * @param {Float64Array} x
 * @param {'up'|'down'|'both'} dir
 */
export function zeroCrossings(x, dir = 'both') {
    const out = [];
    for (let i = 0; i < x.length - 1; i++) {
        const a = x[i], b = x[i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const up = a < 0 && b >= 0;
        const down = a > 0 && b <= 0;
        if ((dir === 'up' && !up) || (dir === 'down' && !down) || (dir === 'both' && !up && !down)) continue;
        const span = b - a;
        out.push({ index: span !== 0 ? i + (0 - a) / span : i, rising: up });
    }
    return out;
}

/**
 * Walk back from a minimum to the START of the flat region around it.
 *
 * This matters more than it looks. A foot on the ground does not trace a sharp
 * minimum in heel height — it descends, arrives, and then DWELLS for most of
 * stance. `localMinima` reports the far end of that plateau, so a naive
 * "minimum of heel_y" detector fires tens of milliseconds after contact: at
 * 240 fps that is many frame periods, and it is a systematic bias rather than
 * noise, so averaging more strides will not remove it. Contact is the moment
 * the plateau BEGINS.
 *
 * @param {Float64Array} x
 * @param {number} index    a minimum, possibly fractional
 * @param {number} tol      absolute tolerance defining "still on the plateau"
 * @param {number} maxBack  never walk back further than this many samples
 */
export function plateauOnset(x, index, tol, maxBack) {
    const i = Math.round(index);
    if (!(i >= 0) || i >= x.length || !Number.isFinite(x[i])) return index;
    const floor = x[i];
    const stop = Math.max(0, i - maxBack);
    let j = i;
    while (j > stop && Number.isFinite(x[j - 1]) && x[j - 1] <= floor + tol) j--;
    if (j === i) return index;
    /* sub-frame: linear crossing of the (floor + tol) level on the way in */
    const a = x[j - 1];
    const b = x[j];
    if (Number.isFinite(a) && a > b) {
        const f = (floor + tol - b) / (a - b);
        return j - Math.min(1, Math.max(0, f));
    }
    return j;
}

/**
 * Walk forward from a minimum to the END of the flat region around it: the
 * moment the signal leaves its floor. The mirror of plateauOnset, and what
 * identifies the foot LEAVING the ground.
 */
export function plateauEnd(x, index, tol, maxAhead) {
    const i = Math.round(index);
    if (!(i >= 0) || i >= x.length || !Number.isFinite(x[i])) return index;
    const floor = x[i];
    const stop = Math.min(x.length - 1, i + maxAhead);
    let j = i;
    while (j < stop && Number.isFinite(x[j + 1]) && x[j + 1] <= floor + tol) j++;
    if (j === i) return index;
    const a = x[j], b = x[j + 1];
    if (Number.isFinite(b) && b > a) {
        const f = (floor + tol - a) / (b - a);
        return j + Math.min(1, Math.max(0, f));
    }
    return j;
}

/**
 * The single largest (or smallest) sample in an index window, refined to
 * sub-frame by a parabola through its neighbors.
 *
 * Used instead of a local-extremum search wherever the quantity has exactly
 * ONE extremum in the window by definition — peak knee extension during
 * stance, for instance. On noisy data a local-extremum search returns a dozen
 * candidates scattered across the window and the earliest one wins the vote,
 * which drags the event systematically early. There is no such failure mode
 * when the answer is "the largest".
 */
export function argExtremum(x, i0, i1, kind = 'max') {
    const lo = Math.max(1, Math.ceil(Math.min(i0, i1)));
    const hi = Math.min(x.length - 2, Math.floor(Math.max(i0, i1)));
    let best = NaN, bestI = NaN;
    for (let i = lo; i <= hi; i++) {
        const v = x[i];
        if (!Number.isFinite(v)) continue;
        if (!Number.isFinite(best) || (kind === 'max' ? v > best : v < best)) { best = v; bestI = i; }
    }
    if (!Number.isFinite(bestI)) return { index: NaN, value: NaN };
    const a = x[bestI - 1], b = x[bestI], c = x[bestI + 1];
    if (Number.isFinite(a) && Number.isFinite(c)) {
        const den = a - 2 * b + c;
        const delta = den !== 0 ? 0.5 * (a - c) / den : 0;
        if (Math.abs(delta) <= 1) return { index: bestI + delta, value: b };
    }
    return { index: bestI, value: b };
}

/** Peak-to-trough range of the finite entries. */
export function range(x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return hi > lo ? hi - lo : 0;
}

/* ---------------- FFT ---------------- */

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` must be a power of two.
 */
export function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const ur = re[i + k], ui = im[i + k];
                const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                const ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}

/**
 * Dominant frequency of `x` inside [fLo, fHi], in Hz.
 *
 * Used for the cadence cross-check: the pelvis rises and falls once per STEP,
 * so the dominant frequency of hipMid_y is the step frequency, arrived at
 * without ever looking at a gait event. If it disagrees with the event-derived
 * cadence, the event detection is wrong and the report says so instead of
 * printing a confident number.
 *
 * @returns {{freq:number, power:number, snr:number}}
 */
export function dominantFrequency(x, fsHz, fLo = 1.0, fHi = 3.6) {
    const finite = [];
    for (let i = 0; i < x.length; i++) finite.push(Number.isFinite(x[i]) ? x[i] : 0);
    const n = finite.length;
    if (n < 16) return { freq: NaN, power: 0, snr: 0 };

    /* remove the mean and any linear trend — a runner traversing the frame adds
       a ramp that would otherwise dominate the low bins */
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += finite[i]; sxx += i * i; sxy += i * finite[i]; }
    const denom = n * sxx - sx * sx;
    const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    const intercept = (sy - slope * sx) / n;

    let size = 1;
    while (size < n * 4) size <<= 1;          /* zero-pad x4 for bin resolution */
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));   /* Hann */
        re[i] = (finite[i] - (intercept + slope * i)) * w;
    }
    fft(re, im);

    const df = fsHz / size;
    const lo = Math.max(1, Math.floor(fLo / df));
    const hi = Math.min(size / 2 - 2, Math.ceil(fHi / df));
    let best = -1, bestP = 0, sumP = 0, count = 0;
    for (let k = lo; k <= hi; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        sumP += p; count++;
        if (p > bestP) { bestP = p; best = k; }
    }
    if (best < 1) return { freq: NaN, power: 0, snr: 0 };

    /* parabolic interpolation on the log-magnitude, standard peak refinement */
    const pm = Math.log(1e-30 + re[best - 1] * re[best - 1] + im[best - 1] * im[best - 1]);
    const p0 = Math.log(1e-30 + bestP);
    const pp = Math.log(1e-30 + re[best + 1] * re[best + 1] + im[best + 1] * im[best + 1]);
    const d = pm - 2 * p0 + pp;
    const delta = d !== 0 ? 0.5 * (pm - pp) / d : 0;

    const meanP = count ? sumP / count : 0;
    return {
        freq: (best + (Math.abs(delta) <= 1 ? delta : 0)) * df,
        power: bestP,
        snr: meanP > 0 ? bestP / meanP : 0
    };
}
