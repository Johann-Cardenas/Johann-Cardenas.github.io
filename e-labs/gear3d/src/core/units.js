/* ============================================================
   Gear3D — units
   ------------------------------------------------------------
   Canonical internal units, used by every stored value:

     length    millimetre  (mm)
     mass      kilogram    (kg)
     force     kilonewton  (kN)
     pressure  kilopascal  (kPa)
     area      square millimetre (mm^2)

   Display units are a view-layer concern. Conversion happens
   ONCE, at the display boundary, through `format*` below.
   Nothing upstream of the UI ever sees inches or pounds.

   All conversion factors are exact by definition where an exact
   definition exists (international yard & pound agreement, 1959;
   NIST SP 811).
   ============================================================ */

'use strict';

/** Exact: 1 inch = 25.4 mm (international agreement, 1959). */
export const MM_PER_IN = 25.4;
/** Exact: 1 foot = 12 in = 304.8 mm. */
export const MM_PER_FT = 304.8;
/** Exact: 1 pound (avoirdupois) = 0.45359237 kg. */
export const KG_PER_LB = 0.45359237;
/** Standard gravity, exact by definition (CGPM 1901): 9.80665 m/s^2. */
export const G0 = 9.80665;
/** 1 kip = 1000 lbf = 4.4482216152605 kN (derived from lb and g0). */
export const KN_PER_KIP = (1000 * KG_PER_LB * G0) / 1000;
/** 1 psi = 6.894757293168361 kPa (derived from lbf and in^2). */
export const KPA_PER_PSI = (KG_PER_LB * G0) / (MM_PER_IN * MM_PER_IN) * 1000;

/* ---------------------------------------------------------- */

/** @typedef {'mm'|'cm'|'m'|'in'|'ft'} LengthUnit */
/** @typedef {'kg'|'t'|'lb'|'kip-mass'} MassUnit */
/** @typedef {'kN'|'N'|'kip'|'lbf'} ForceUnit */
/** @typedef {'kPa'|'MPa'|'psi'} PressureUnit */
/** @typedef {'mm2'|'cm2'|'m2'|'in2'} AreaUnit */
/** @typedef {'SI'|'US'} UnitSystem */

/** Multiply a canonical mm value by this to get the display unit. */
const LENGTH_FROM_MM = { mm: 1, cm: 0.1, m: 0.001, in: 1 / MM_PER_IN, ft: 1 / MM_PER_FT };
const MASS_FROM_KG = { kg: 1, t: 0.001, lb: 1 / KG_PER_LB, 'kip-mass': 1 / (1000 * KG_PER_LB) };
const FORCE_FROM_KN = { kN: 1, N: 1000, kip: 1 / KN_PER_KIP, lbf: 1000 / KN_PER_KIP };
const PRESSURE_FROM_KPA = { kPa: 1, MPa: 0.001, psi: 1 / KPA_PER_PSI };
const AREA_FROM_MM2 = { mm2: 1, cm2: 0.01, m2: 1e-6, in2: 1 / (MM_PER_IN * MM_PER_IN) };

/** Human labels for display units. */
export const UNIT_LABEL = Object.freeze({
    mm: 'mm', cm: 'cm', m: 'm', in: 'in', ft: 'ft',
    kg: 'kg', t: 't', lb: 'lb', 'kip-mass': 'kip',
    kN: 'kN', N: 'N', kip: 'kip', lbf: 'lbf',
    kPa: 'kPa', MPa: 'MPa', psi: 'psi',
    mm2: 'mm²', cm2: 'cm²', m2: 'm²', in2: 'in²'
});

/**
 * Preferred display units for each unit system. The app switches all
 * four families together so a figure is never half-metric.
 */
export const UNIT_SYSTEMS = Object.freeze({
    SI: { length: 'mm', mass: 'kg', force: 'kN', pressure: 'kPa', area: 'mm2', label: 'SI' },
    US: { length: 'in', mass: 'lb', force: 'kip', pressure: 'psi', area: 'in2', label: 'US customary' }
});

/* ---------------------------------------------------------- */

/** @param {number} mm @param {LengthUnit} to @returns {number} */
export function lengthFromMm(mm, to) {
    const f = LENGTH_FROM_MM[to];
    if (f === undefined) throw new Error(`Unknown length unit: ${to}`);
    return mm * f;
}

/** @param {number} v @param {LengthUnit} from @returns {number} millimetres */
export function lengthToMm(v, from) {
    const f = LENGTH_FROM_MM[from];
    if (f === undefined) throw new Error(`Unknown length unit: ${from}`);
    return v / f;
}

/** @param {number} kg @param {MassUnit} to @returns {number} */
export function massFromKg(kg, to) { return kg * MASS_FROM_KG[to]; }
/** @param {number} v @param {MassUnit} from @returns {number} kilograms */
export function massToKg(v, from) { return v / MASS_FROM_KG[from]; }

/** @param {number} kN @param {ForceUnit} to @returns {number} */
export function forceFromKn(kN, to) { return kN * FORCE_FROM_KN[to]; }
/** @param {number} v @param {ForceUnit} from @returns {number} kilonewtons */
export function forceToKn(v, from) { return v / FORCE_FROM_KN[from]; }

/** @param {number} kPa @param {PressureUnit} to @returns {number} */
export function pressureFromKpa(kPa, to) { return kPa * PRESSURE_FROM_KPA[to]; }
/** @param {number} v @param {PressureUnit} from @returns {number} kilopascals */
export function pressureToKpa(v, from) { return v / PRESSURE_FROM_KPA[from]; }

/** @param {number} mm2 @param {AreaUnit} to @returns {number} */
export function areaFromMm2(mm2, to) { return mm2 * AREA_FROM_MM2[to]; }
/** @param {number} v @param {AreaUnit} from @returns {number} square millimetres */
export function areaToMm2(v, from) { return v / AREA_FROM_MM2[from]; }

/**
 * Convert a mass to the force it exerts under standard gravity.
 * Used to turn a published axle mass rating into a wheel load.
 * @param {number} kg
 * @returns {number} kilonewtons
 */
export function massToForceKn(kg) { return (kg * G0) / 1000; }

/**
 * Inverse of {@link massToForceKn}.
 * @param {number} kN
 * @returns {number} kilograms
 */
export function forceToMassKg(kN) { return (kN * 1000) / G0; }

/* ---------------------------------------------------------- */

/**
 * Separator between a numeric value and its unit symbol:
 * U+202F NARROW NO-BREAK SPACE.
 *
 * ISO 80000-1 puts a space between value and unit. It must not break,
 * or a dimension label can wrap as "1 311" / "mm" across two lines.
 */
export const UNIT_SPACE = '\u202F';

/**
 * Thousands separator: U+202F NARROW NO-BREAK SPACE.
 *
 * The ISO 80000-1 digit-grouping convention, and it will not break across
 * a line inside a dimension label. Written as an escape rather than typed
 * literally, because a narrow no-break space and an ordinary space are
 * indistinguishable in a diff, in terminal output, and in a failing test's
 * error message.
 */
export const GROUP_SEPARATOR = '\u202F';

/**
 * Format a number with a fixed number of decimals and no exponent,
 * grouping thousands with {@link GROUP_SEPARATOR}.
 * @param {number} v
 * @param {number} precision decimals
 * @returns {string}
 */
export function formatNumber(v, precision) {
    if (!Number.isFinite(v)) return '—';
    const s = v.toFixed(precision);
    const [intPart, frac] = s.split('.');
    const sign = intPart.startsWith('-') ? '-' : '';
    const digits = sign ? intPart.slice(1) : intPart;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
    return sign + grouped + (frac ? '.' + frac : '');
}

/**
 * @typedef {Object} FormatOptions
 * @property {number}  [precision=0]   decimals
 * @property {boolean} [unit=true]     append the unit label
 * @property {LengthUnit} [alt]        also show this unit in parentheses
 * @property {number}  [altPrecision=1]
 */

/**
 * Format a canonical millimetre value for display.
 * @param {number} mm
 * @param {LengthUnit} to
 * @param {FormatOptions} [opts]
 * @returns {string} e.g. `1372 mm (54.0 in)`
 */
export function formatLength(mm, to, opts = {}) {
    const { precision = 0, unit = true, alt = null, altPrecision = 1 } = opts;
    if (mm == null || !Number.isFinite(mm)) return '—';
    let s = formatNumber(lengthFromMm(mm, to), precision);
    if (unit) s += UNIT_SPACE + UNIT_LABEL[to];
    if (alt && alt !== to) {
        s += ' (' + formatNumber(lengthFromMm(mm, alt), altPrecision) + UNIT_SPACE + UNIT_LABEL[alt] + ')';
    }
    return s;
}

/** @param {number} kN @param {ForceUnit} to @param {FormatOptions} [opts] @returns {string} */
export function formatForce(kN, to, opts = {}) {
    const { precision = 1, unit = true } = opts;
    if (kN == null || !Number.isFinite(kN)) return '—';
    return formatNumber(forceFromKn(kN, to), precision) + (unit ? UNIT_SPACE + UNIT_LABEL[to] : '');
}

/** @param {number} kPa @param {PressureUnit} to @param {FormatOptions} [opts] @returns {string} */
export function formatPressure(kPa, to, opts = {}) {
    const { precision = 0, unit = true } = opts;
    if (kPa == null || !Number.isFinite(kPa)) return '—';
    return formatNumber(pressureFromKpa(kPa, to), precision) + (unit ? UNIT_SPACE + UNIT_LABEL[to] : '');
}

/** @param {number} kg @param {MassUnit} to @param {FormatOptions} [opts] @returns {string} */
export function formatMass(kg, to, opts = {}) {
    const { precision = 0, unit = true } = opts;
    if (kg == null || !Number.isFinite(kg)) return '—';
    return formatNumber(massFromKg(kg, to), precision) + (unit ? UNIT_SPACE + UNIT_LABEL[to] : '');
}

/** @param {number} mm2 @param {AreaUnit} to @param {FormatOptions} [opts] @returns {string} */
export function formatArea(mm2, to, opts = {}) {
    const { precision = 0, unit = true } = opts;
    if (mm2 == null || !Number.isFinite(mm2)) return '—';
    return formatNumber(areaFromMm2(mm2, to), precision) + (unit ? UNIT_SPACE + UNIT_LABEL[to] : '');
}

/**
 * Normalize a `{value, unit}` quantity from a data file into canonical
 * units. Data files are allowed to state a load in kip or a GVW in lb
 * because that is how the source document states it — the citation stays
 * honest, and this function does the one conversion.
 *
 * @param {{value:number, unit:string}|null|undefined} q
 * @param {'length'|'mass'|'force'|'pressure'} family
 * @returns {number|null} canonical value, or null when the quantity is unknown
 */
export function canonical(q, family) {
    if (!q || q.value == null || !Number.isFinite(q.value)) return null;
    switch (family) {
        case 'length': return lengthToMm(q.value, /** @type {LengthUnit} */(q.unit));
        case 'mass': return massToKg(q.value, /** @type {MassUnit} */(q.unit));
        case 'force': return forceToKn(q.value, /** @type {ForceUnit} */(q.unit));
        case 'pressure': return pressureToKpa(q.value, /** @type {PressureUnit} */(q.unit));
        default: throw new Error(`Unknown unit family: ${family}`);
    }
}
