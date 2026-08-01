/* ============================================================
   Gear3D — deterministic pseudo-random number generation
   ------------------------------------------------------------
   `Math.random()` is banned in this application. Every stochastic
   detail (tread noise, sidewall lettering jitter, aggregate speckle)
   draws from a seeded generator whose seed is exposed in the UI and
   stored in the project file, so the same project always renders
   byte-identically.

   Algorithm: xmur3 string hash to seed mulberry32. Same pair used
   by Cross-Section Studio, so a shared seed produces matched grain
   across the two apps.
   ============================================================ */

'use strict';

/**
 * xmur3 string hash. Returns a function producing successive 32-bit seeds.
 * @param {string} str
 * @returns {() => number}
 */
export function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}

/**
 * mulberry32 — small, fast, good enough for texture grain.
 * @param {number} a 32-bit seed
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A seeded generator with the helpers the geometry and texture code needs.
 * Construct one per texture / per feature, keyed by a stable string, so
 * that adding a new tire never shifts the grain of an existing one.
 */
export class Rng {
    /**
     * @param {string|number} key stable identity, e.g. `${seed}:tread:11R22.5`
     */
    constructor(key) {
        const s = typeof key === 'number' ? String(key) : key;
        this._next = mulberry32(xmur3(s)());
        this.key = s;
    }

    /** @returns {number} uniform in [0, 1) */
    unit() { return this._next(); }

    /**
     * @param {number} lo
     * @param {number} hi
     * @returns {number} uniform in [lo, hi)
     */
    range(lo, hi) { return lo + (hi - lo) * this._next(); }

    /**
     * @param {number} lo inclusive
     * @param {number} hi inclusive
     * @returns {number} integer
     */
    int(lo, hi) { return Math.floor(this.range(lo, hi + 1)); }

    /**
     * @param {number} [p=0.5]
     * @returns {boolean}
     */
    bool(p = 0.5) { return this._next() < p; }

    /**
     * @template T
     * @param {T[]} arr
     * @returns {T}
     */
    pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }

    /**
     * Approximately normal deviate via the sum of 3 uniforms (Bates).
     * Bounded, which is what texture work wants — no rare huge outliers.
     * @param {number} [mean=0]
     * @param {number} [sd=1]
     * @returns {number}
     */
    normal(mean = 0, sd = 1) {
        const u = (this._next() + this._next() + this._next()) / 3;
        return mean + (u - 0.5) * 3.4641016151377544 * sd;
    }

    /**
     * Deterministic Fisher-Yates shuffle, in place.
     * @template T
     * @param {T[]} arr
     * @returns {T[]} the same array
     */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this._next() * (i + 1));
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }
}

/**
 * Convenience factory.
 * @param {string|number} key
 * @returns {Rng}
 */
export function rng(key) { return new Rng(key); }

/** Default project seed. Surfaced in the UI and stored in the project file. */
export const DEFAULT_SEED = 'gear3d-01';
