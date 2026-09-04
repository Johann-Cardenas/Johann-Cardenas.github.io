/* ============================================================
   Stride Lab — proposing the analysis window.

   The specification asks for the window that maximizes landmark
   confidence times subject size. That cannot be known before running
   pose estimation over the whole clip, which is the expensive thing a
   proposal exists to avoid. What IS already available is the scrubber
   filmstrip: a dozen-odd thumbnails that had to be decoded anyway, and
   the difference between consecutive ones is a usable stand-in for
   "where is the running".

   It gets the case that matters right — skipping the walk to the
   treadmill, the fumbling with the phone and the standing about at the
   end, which is where "just take the middle" lands on a long clip —
   and it is deliberately unwilling to act on a weak signal.

   Kept here, apart from the DOM, so it can be tested. The measuring is
   in app.js because that is where the canvas is; the deciding is here
   because deciding is the part that can be wrong.
   ============================================================ */

/** How much livelier than the typical sample a window must be to be worth moving to. */
export const MOTION_MARGIN = 1.15;

/**
 * Mean absolute luma difference between consecutive thumbnails.
 * @typedef {{t: number, energy: number}} MotionSample
 */

/**
 * Choose the `want`-second window carrying the most motion.
 *
 * @param {MotionSample[]} samples  in time order; energy 0 means "not measured"
 * @param {number} durationS        the whole clip
 * @param {number} wantS            the window length asked for
 * @param {number} [stepS]          search resolution
 * @returns {{startS: number, endS: number, score: number, median: number} | null}
 *          null when there is nothing to say, and the caller should leave the
 *          window where it is rather than move it on noise.
 */
export function bestMotionWindow(samples, durationS, wantS, stepS = 0.25) {
    if (!Array.isArray(samples) || !(durationS > 0) || !(wantS > 0)) return null;
    /* An energy of 0 is the "could not measure" value: the first thumbnail has
       no predecessor, and a tainted canvas throws before one is recorded. */
    const usable = samples.filter(s => s && Number.isFinite(s.energy) && s.energy > 0);
    if (usable.length < 4 || durationS <= wantS) return null;

    let best = null;
    for (let start = 0; start <= durationS - wantS + 1e-9; start += stepS) {
        const end = start + wantS;
        let sum = 0, n = 0;
        for (const s of usable) if (s.t >= start && s.t <= end) { sum += s.energy; n++; }
        if (n < 2) continue;
        const score = sum / n;
        if (!best || score > best.score) best = { startS: start, endS: end, score };
    }
    if (!best) return null;

    /* The median, not the mean: one very lively thumbnail should not be able to
       drag the bar it has to clear up past itself. */
    const sorted = usable.map(s => s.energy).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    /* A clip of somebody running the whole way through has no quiet part to
       skip, and every window scores about the same. Moving the selection then
       is worse than leaving it: it looks like a decision and it is a coin toss. */
    if (!(best.score > median * MOTION_MARGIN)) return null;
    return { ...best, median };
}
