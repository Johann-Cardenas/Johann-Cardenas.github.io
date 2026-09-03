/* ============================================================
   Gear3D — tire designation parsing and derived dimensions
   ------------------------------------------------------------
   Turns a tire designation string into real millimeter dimensions.
   Pure domain logic: no three.js, no DOM. Runs under Node for the
   test suite.

   Four designation families are recognized:

   1. metric truck / bus      445/50R22.5, 295/75R22.5, 315/80R22.5
        section width (mm) / aspect (%) R rim diameter (in)
        Overall diameter is DERIVED exactly from the designation:
            OD = rim + 2 * (section * aspect)

   2. passenger / light truck  P225/60R16, LT245/75R16, 235/85R16
        Same arithmetic as (1); the service-type prefix is recorded
        but does not change the geometry.

   3. inch-nominal truck       11R22.5, 11.00R20, 10.00-20
        nominal section width (in) R rim diameter (in)
        The designation does NOT encode overall diameter, so these
        require a lookup table (`src/data/tires.json`). A size that
        is not in the table is reported as unknown rather than
        guessed — see `parseTire().complete`.

   4. aircraft                 H44.5x16.5-21, 46x17.0R20, 52x21R22,
                               27x7.75-15, 1400x530R23
        overall diameter x section width - rim diameter
        Per the Tire and Rim Association three-part aircraft tire
        naming convention, so all three dimensions come straight
        from the designation. Two sub-cases:
          - inch:   numbers are in inches (46x17.0R20)
          - metric: overall diameter and section width in mm, rim
                    still in inches (1400x530R23)
        They are told apart by magnitude: an overall diameter of
        100 or more is millimeters. No real aircraft tire is 100 in
        (2.54 m) in diameter, and none is under 100 mm, so the test
        is unambiguous across the whole domain.
        A leading `H` marks the high-flotation ("H-series") family;
        recorded, geometrically inert.

   NOTE ON NOMINAL vs GROWN DIMENSIONS
   Designation arithmetic yields NOMINAL new-tire dimensions. Real
   tires grow with speed and service and manufacturers publish
   slightly different "design" and "maximum grown" figures. Gear3D
   reports nominal values and says so; a user who needs a specific
   manufacturer's grown dimension can override per tire.
   ============================================================ */

'use strict';

import { MM_PER_IN } from './units.js';

/**
 * @typedef {Object} TireSpec
 * @property {string}  designation      the input string, normalized
 * @property {'metric'|'passenger'|'inch-nominal'|'aircraft-inch'|'aircraft-metric'} family
 * @property {'radial'|'bias'} construction
 * @property {number|null} sectionWidth  mm
 * @property {number|null} overallDiameter mm
 * @property {number}  rimDiameter      mm
 * @property {number|null} aspectRatio   fraction (0.5 = 50 series), null when not encoded
 * @property {boolean} complete          false when a dimension could not be determined
 * @property {boolean} nominal           true when dimensions come from designation arithmetic
 * @property {string}  [servicePrefix]   'P', 'LT', 'H', …
 * @property {string}  [note]
 * @property {'truck'|'aircraft'} domain
 */

/**
 * Static loaded radius models.
 *
 * `radiusRatio`  SLR = deflectionRatio * freeRadius.
 *                Simple, and the model this app defaults to.
 * `sectionDeflection`
 *                SLR = freeRadius - deflection * sectionHeight, where
 *                sectionHeight = (OD - rim) / 2. This is the form the
 *                Tire and Rim Association uses for aircraft tires,
 *                which are rated at a nominal 32 % deflection.
 *
 * Both are exposed so a user can state in a caption exactly which was
 * used. See `data/SOURCES.md` for the provenance of each default.
 */
export const SLR_MODELS = Object.freeze({
    radiusRatio: 'radiusRatio',
    sectionDeflection: 'sectionDeflection'
});

/** Default parameters for the static-loaded-radius calculation. */
export const SLR_DEFAULTS = Object.freeze({
    truck: { model: SLR_MODELS.radiusRatio, deflectionRatio: 0.97 },
    aircraft: { model: SLR_MODELS.radiusRatio, deflectionRatio: 0.965 }
});

/**
 * Fraction of section width taken as the molded tread (rendering only).
 * The contact-patch module uses its own, separately documented ratio.
 */
export const TREAD_WIDTH_RATIO = 0.82;

/* ---------- inch-nominal lookup table (injected) ---------- */

/** @type {Record<string, {sectionWidth:number, overallDiameter:number, source?:string}>} */
let NOMINAL_TABLE = {};

/**
 * Install the inch-nominal size table. The app loads it from
 * `src/data/tires.json`; the test suite reads the same file from disk.
 * @param {Record<string, {sectionWidth:number, overallDiameter:number, source?:string}>} table
 */
export function setNominalTable(table) {
    NOMINAL_TABLE = table || {};
}

/** @returns {Record<string, object>} the installed table (for UI listings) */
export function getNominalTable() { return NOMINAL_TABLE; }

/* ---------- parsing ---------- */

const RE_METRIC = /^(P|LT|ST|T)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*(R|-|B|D)\s*(\d{1,2}(?:\.\d)?)$/i;
const RE_INCH_NOMINAL = /^(\d{1,2}(?:\.\d{1,2})?)\s*(R|-)\s*(\d{1,2}(?:\.\d)?)$/i;
const RE_AIRCRAFT = /^(H)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*[xX]\s*(\d{1,4}(?:\.\d{1,2})?)\s*(R|-)\s*(\d{1,2}(?:\.\d)?)$/;

/**
 * Threshold that separates inch aircraft designations from metric ones.
 * See the header note — the two ranges do not overlap in any real size.
 */
const AIRCRAFT_METRIC_THRESHOLD = 100;

/**
 * Parse a tire designation into millimeter dimensions.
 *
 * @param {string} designation
 * @param {{domainHint?: 'truck'|'aircraft'}} [opts]
 * @returns {TireSpec}
 * @throws {Error} when the string matches no known designation family
 */
export function parseTire(designation, opts = {}) {
    if (typeof designation !== 'string' || designation.trim() === '') {
        throw new Error('Tire designation must be a non-empty string');
    }
    const s = designation.trim().replace(/\s+/g, '');

    // --- aircraft three-part (checked first: contains an 'x') ---
    const air = RE_AIRCRAFT.exec(s);
    if (air) {
        const [, hFlag, odRaw, swRaw, constr, rimRaw] = air;
        const od = parseFloat(odRaw);
        const sw = parseFloat(swRaw);
        const rimIn = parseFloat(rimRaw);
        const isMetric = od >= AIRCRAFT_METRIC_THRESHOLD;
        const overallDiameter = isMetric ? od : od * MM_PER_IN;
        const sectionWidth = isMetric ? sw : sw * MM_PER_IN;
        const rimDiameter = rimIn * MM_PER_IN;
        return {
            designation: s,
            family: isMetric ? 'aircraft-metric' : 'aircraft-inch',
            construction: constr.toUpperCase() === 'R' ? 'radial' : 'bias',
            sectionWidth,
            overallDiameter,
            rimDiameter,
            aspectRatio: sectionWidth > 0
                ? (overallDiameter - rimDiameter) / 2 / sectionWidth
                : null,
            complete: true,
            nominal: true,
            servicePrefix: hFlag ? 'H' : undefined,
            note: hFlag ? 'H-series (high flotation)' : undefined,
            domain: 'aircraft'
        };
    }

    // --- metric / passenger ---
    const met = RE_METRIC.exec(s);
    if (met) {
        const [, prefix, swRaw, arRaw, constr, rimRaw] = met;
        const sectionWidth = parseFloat(swRaw);
        const aspectRatio = parseFloat(arRaw) / 100;
        const rimDiameter = parseFloat(rimRaw) * MM_PER_IN;
        const overallDiameter = rimDiameter + 2 * sectionWidth * aspectRatio;
        const isPassenger = !!prefix && /^(P|LT|ST|T)$/i.test(prefix);
        return {
            designation: s,
            family: isPassenger ? 'passenger' : 'metric',
            construction: /R/i.test(constr) ? 'radial' : 'bias',
            sectionWidth,
            overallDiameter,
            rimDiameter,
            aspectRatio,
            complete: true,
            nominal: true,
            servicePrefix: prefix ? prefix.toUpperCase() : undefined,
            domain: 'truck'
        };
    }

    // --- inch-nominal (table lookup) ---
    const inch = RE_INCH_NOMINAL.exec(s);
    if (inch) {
        const [, swRaw, constr, rimRaw] = inch;
        const rimDiameter = parseFloat(rimRaw) * MM_PER_IN;
        const key = normalizeKey(s);
        const entry = NOMINAL_TABLE[key];
        const nominalSectionIn = parseFloat(swRaw);
        return {
            designation: s,
            family: 'inch-nominal',
            construction: /R/i.test(constr) ? 'radial' : 'bias',
            sectionWidth: entry ? entry.sectionWidth : null,
            overallDiameter: entry ? entry.overallDiameter : null,
            rimDiameter,
            aspectRatio: entry && entry.sectionWidth
                ? (entry.overallDiameter - rimDiameter) / 2 / entry.sectionWidth
                : null,
            complete: !!entry,
            nominal: false,
            note: entry
                ? undefined
                : `Nominal section ${nominalSectionIn} in; overall diameter not in the size table. `
                + 'Add it to src/data/tires.json with a source, or override the dimensions on the tire.',
            domain: 'truck'
        };
    }

    throw new Error(
        `Unrecognized tire designation: "${designation}". Expected metric (295/75R22.5), `
        + 'inch-nominal (11R22.5), or aircraft (H44.5x16.5-21, 1400x530R23).'
    );
}

/**
 * Table keys are upper-case with whitespace removed, so `11r22.5` and
 * `11R22.5` resolve to the same entry.
 * @param {string} s
 * @returns {string}
 */
export function normalizeKey(s) {
    return s.trim().replace(/\s+/g, '').toUpperCase();
}

/* ---------- derived dimensions ---------- */

/**
 * @typedef {Object} TireGeometry
 * @property {number} overallDiameter mm
 * @property {number} freeRadius      mm
 * @property {number} sectionWidth    mm
 * @property {number} sectionHeight   mm — (OD - rim) / 2
 * @property {number} rimDiameter     mm
 * @property {number} rimRadius       mm
 * @property {number} staticLoadedRadius mm
 * @property {number} treadWidth      mm
 * @property {string} slrModel
 * @property {number} slrParameter
 */

/**
 * Derive the geometry a renderer and a contact model need.
 *
 * @param {TireSpec} spec
 * @param {{model?: string, deflectionRatio?: number, sectionDeflection?: number,
 *          treadWidthRatio?: number, overrides?: Partial<TireGeometry>}} [opts]
 * @returns {TireGeometry}
 * @throws {Error} when the spec is incomplete and no overrides supply the gaps
 */
export function tireGeometry(spec, opts = {}) {
    const od = opts.overrides?.overallDiameter ?? spec.overallDiameter;
    const sw = opts.overrides?.sectionWidth ?? spec.sectionWidth;
    if (od == null || sw == null) {
        throw new Error(
            `Tire "${spec.designation}" has no known overall diameter or section width. `
            + 'Supply overrides or add the size to src/data/tires.json.'
        );
    }
    const rimDiameter = spec.rimDiameter;
    const freeRadius = od / 2;
    const sectionHeight = (od - rimDiameter) / 2;

    const defaults = SLR_DEFAULTS[spec.domain] || SLR_DEFAULTS.truck;
    const model = opts.model ?? defaults.model;
    let staticLoadedRadius;
    let slrParameter;
    if (model === SLR_MODELS.sectionDeflection) {
        // TRA convention: aircraft tires are rated at a nominal 32 % deflection
        // of section height. Truck tires deflect far less at rated load.
        slrParameter = opts.sectionDeflection ?? (spec.domain === 'aircraft' ? 0.32 : 0.12);
        staticLoadedRadius = freeRadius - slrParameter * sectionHeight;
    } else {
        slrParameter = opts.deflectionRatio ?? defaults.deflectionRatio;
        staticLoadedRadius = freeRadius * slrParameter;
    }

    return {
        overallDiameter: od,
        freeRadius,
        sectionWidth: sw,
        sectionHeight,
        rimDiameter,
        rimRadius: rimDiameter / 2,
        staticLoadedRadius: opts.overrides?.staticLoadedRadius ?? staticLoadedRadius,
        treadWidth: opts.overrides?.treadWidth ?? sw * (opts.treadWidthRatio ?? TREAD_WIDTH_RATIO),
        slrModel: model,
        slrParameter
    };
}

/**
 * Parse and derive in one step.
 * @param {string} designation
 * @param {object} [opts] forwarded to {@link tireGeometry}
 * @returns {TireSpec & {geometry: TireGeometry}}
 */
export function resolveTire(designation, opts = {}) {
    const spec = parseTire(designation);
    return Object.assign({}, spec, { geometry: tireGeometry(spec, opts) });
}

/**
 * Is this designation understood, and are its dimensions fully known?
 * Used by the data-validation test and by the UI to flag unknown sizes.
 * @param {string} designation
 * @returns {{ok:boolean, reason?:string, spec?:TireSpec}}
 */
export function checkTire(designation) {
    try {
        const spec = parseTire(designation);
        if (!spec.complete) return { ok: false, reason: spec.note, spec };
        return { ok: true, spec };
    } catch (err) {
        return { ok: false, reason: /** @type {Error} */(err).message };
    }
}
