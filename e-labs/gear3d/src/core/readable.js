/* ============================================================
   Gear3D — readable English
   ------------------------------------------------------------
   units.js converts. This rounds.

   Every stored value is canonical: millimeters, kilograms,
   kilonewtons, kilopascals, square millimeters. SI therefore
   SHOWS the cited number, and these wrappers hand it to
   units.js untouched.

   English cannot. A dimension cited in metric has no exact
   inch, so an English reading is an approximation however many
   decimals it carries, and printing two of them is a false
   precision that is also harder to read: a 1854 mm track came
   out as 72.99 in. English is rounded to three significant
   figures.

   Three, and not more, because three is what recovers the
   SOURCE's own magnitude wherever the citation was itself
   converted from English — which in this library is most of it:

       4572 mm  -> 180 in     (15 ft)
       2591 mm  -> 102 in     (the 23 CFR 658.15 width limit)
       1829 mm  -> 72 in      (a class 8 steer track)
       1372 mm  -> 54 in      (dual spacing)
        279 mm  -> 11 in      (11R22.5 section width)
       1054 mm  -> 41.5 in    (11R22.5 overall diameter)
       44.5 kN  -> 10 kip
      13608 kg  -> 30 000 lb

   Swept over every length, load and weight the shipped library
   cites, nothing round in English is lost and the worst
   distortion is 0.4%. Both halves of that sentence are measured
   again in test/run.mjs §15, so a library that grows a
   dimension this rule would mangle fails there rather than in
   somebody's report.

   Where the citation really IS metric the reading stays honest
   rather than tidy: a 300 mm tire section reads 11.8 in, not
   the data book's nominal 12. Recovering the 12 would mean
   trusting the designation, and a designation is not a
   dimension — the 9.00 in a 9.00R20 is a series number, and
   that tire's section is 10.2 in.

   Lengths carry a floor of one whole inch, because length is
   the only family here that reaches four digits: a 75-ft double
   is 1124 in, and three figures alone would show it as 1120.

   Two things deliberately do NOT come through here. The
   annotation engine formats from units.js directly, so a
   figure's dimension labels stay the reader's own precision
   setting. And every data export stays canonical, in
   millimeters, and says so in its own header.

   No DOM, no THREE, no app state: this module imports units.js
   and nothing else.
   ============================================================ */

'use strict';

import {
    UNIT_LABEL, UNIT_SPACE, formatNumber,
    lengthFromMm, forceFromKn, pressureFromKpa, massFromKg, areaFromMm2,
    formatLength as citedLength, formatForce as citedForce,
    formatMass as citedMass, formatArea as citedArea,
    formatPressure as citedPressure
} from './units.js';

/** Significant figures an English reading is rounded to. */
export const READABLE_SIG = 3;

/** The display units that cannot be exact, because the citation is metric. */
export const ENGLISH_UNITS = new Set(['in', 'ft', 'lb', 'kip-mass', 'kip', 'lbf', 'psi', 'in2']);

/** Coarsest step a length may be rounded to, per display unit. */
export const LENGTH_FLOOR = { in: 1, ft: 0.1 };

/**
 * Round a value that is ALREADY in its display unit.
 *
 * @param {number} v
 * @param {number} [floor] coarsest step allowed, e.g. 1 whole inch
 * @returns {number}
 */
export function readable(v, floor) {
    if (!Number.isFinite(v) || v === 0) return v;
    let step = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - READABLE_SIG + 1);
    if (floor != null) step = Math.min(step, floor);
    // toPrecision clears the binary-floating-point dust that
    // Math.round(v / 0.1) * 0.1 leaves behind, which would otherwise make
    // 41.5 need four decimals to print.
    return Number((Math.round(v / step) * step).toPrecision(12));
}

/**
 * The decimals a rounded value actually needs, so 73 prints as 73 and not
 * as 73.00.
 *
 * @param {number} v
 * @param {number} [max]
 * @returns {number}
 */
export function readableDecimals(v, max = 4) {
    for (let d = 0; d < max; d++) {
        if (Math.abs(v - Number(v.toFixed(d))) < 1e-9) return d;
    }
    return max;
}

/**
 * @param {number} display value already in the display unit
 * @param {string} to display unit key
 * @param {object} opts
 * @param {number} [floor]
 * @returns {string}
 */
function format(display, to, opts, floor) {
    const v = readable(display, floor);
    // `precision` CAPS rather than fixes. A caller that asks for none gets
    // whatever the rounding earned; one that asks for a count gets at most
    // that many, so a panel restating a figure's dimension cannot print
    // more decimals than the figure does.
    const dec = Math.min(readableDecimals(v), opts.precision == null ? Infinity : opts.precision);
    return formatNumber(v, dec) + (opts.unit === false ? '' : UNIT_SPACE + UNIT_LABEL[to]);
}

/* The five wrappers. In SI they ARE units.js — same string, same grouping,
   same honoring of `precision`. An `alt` (dual units) request is handed
   straight back, because units.js owns that format. */

/** @param {number} mm @param {string} to @param {object} [opts] @returns {string} */
export function formatLength(mm, to, opts = {}) {
    if (!ENGLISH_UNITS.has(to) || opts.alt || !Number.isFinite(mm)) return citedLength(mm, to, opts);
    return format(lengthFromMm(mm, to), to, opts, LENGTH_FLOOR[to]);
}

/** @param {number} kN @param {string} to @param {object} [opts] @returns {string} */
export function formatForce(kN, to, opts = {}) {
    if (!ENGLISH_UNITS.has(to) || !Number.isFinite(kN)) return citedForce(kN, to, opts);
    return format(forceFromKn(kN, to), to, opts);
}

/** @param {number} kPa @param {string} to @param {object} [opts] @returns {string} */
export function formatPressure(kPa, to, opts = {}) {
    if (!ENGLISH_UNITS.has(to) || !Number.isFinite(kPa)) return citedPressure(kPa, to, opts);
    return format(pressureFromKpa(kPa, to), to, opts);
}

/** @param {number} kg @param {string} to @param {object} [opts] @returns {string} */
export function formatMass(kg, to, opts = {}) {
    if (!ENGLISH_UNITS.has(to) || !Number.isFinite(kg)) return citedMass(kg, to, opts);
    return format(massFromKg(kg, to), to, opts);
}

/** @param {number} mm2 @param {string} to @param {object} [opts] @returns {string} */
export function formatArea(mm2, to, opts = {}) {
    if (!ENGLISH_UNITS.has(to) || !Number.isFinite(mm2)) return citedArea(mm2, to, opts);
    return format(areaFromMm2(mm2, to), to, opts);
}

/**
 * A rounded length with NO unit and no thousands separator.
 *
 * Two callers, and the first is why it exists: formatNumber groups
 * thousands with U+202F, which is not a valid value for an
 * `<input type="number">` and would silently blank the field. The second is
 * the hover readout, where three numbers sit two spaces apart and a narrow
 * space inside them would make the fields hard to tell from each other.
 *
 * @param {number} mm
 * @param {string} to display unit key
 * @returns {string}
 */
export function plainLength(mm, to) {
    const v = lengthFromMm(mm, to);
    return String(ENGLISH_UNITS.has(to) ? readable(v, LENGTH_FLOOR[to]) : Math.round(v));
}
