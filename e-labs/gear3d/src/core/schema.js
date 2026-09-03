/* ============================================================
   Gear3D — document schema and validation
   ------------------------------------------------------------
   Two jobs:

   1. STRUCTURAL validation — is this a well-formed unit?
   2. PROVENANCE validation — does every published number carry a
      citation?

   (2) is the one that matters. The app's whole claim is that its
   dimensions are real engineering values, not artistic choices.
   A number whose origin cannot be stated is a liability, so the
   test suite fails the build when one appears.

   The provenance rule: every geometry-bearing numeric field must
   be covered either by a non-empty `source` on its containing
   object, or — for `{value, unit, basis}` quantities — by a
   non-empty `basis`. A field that is genuinely unknown must be
   `null`, which is allowed and is surfaced in the UI as "unknown".
   Inventing a plausible value to fill a gap is the one thing this
   validator exists to prevent.
   ============================================================ */

'use strict';

import { parseTire } from './tires.js';
import {
    parseGearCode, describeGearCode, gearWheelCount, FAA_TABLE_3, genericConfigurations
} from './gearcode.js';

export const SCHEMA_VERSION = '1.0';

/**
 * Section width of a tire, in millimeters, from its designation.
 * Aircraft designations encode it directly, so this needs no lookup table.
 * @param {string} designation
 * @returns {number|null}
 */
function sectionWidthOf(designation) {
    const spec = parseTire(designation);
    return spec.sectionWidth;
}

/** Axle roles, truck domain. */
export const AXLE_ROLES = Object.freeze(['steer', 'drive', 'trailer', 'lift', 'tag', 'pusher']);

/** Tire configuration codes. */
export const TIRE_CONFIGS = Object.freeze({
    STA: { code: 'STA', name: 'Single tire assembly', tiresPerPosition: 1 },
    DTA: { code: 'DTA', name: 'Dual tire assembly', tiresPerPosition: 2 },
    WBT: { code: 'WBT', name: 'Wide-base tire', tiresPerPosition: 1 }
});

/** Axle group types and the number of axles each implies. */
export const GROUP_TYPES = Object.freeze({
    single: 1, tandem: 2, tridem: 3, quad: 4
});

/**
 * FAA landing gear designation codes, per FAA Order 5300.7.
 *
 * This table used to be hand-maintained, and had drifted: it carried twelve
 * codes, described `2D` as "Dual wheel, tandem" in a vocabulary the Order
 * had retired (§6d: the tandem designation "T" no longer appears in a gear
 * name; "T" now means TRIPLE), and had no way to answer a code it had not
 * been told about. It is now GENERATED from the convention itself — every
 * configuration the Order tabulates in Table 3, plus Figure 2's generic
 * grid — and a code outside it is validated by parsing rather than by
 * membership. `3Q` is a legal gear name whether or not anyone has built one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GEAR_CODES = Object.freeze(Object.fromEntries(
    [...new Set([...FAA_TABLE_3.map((r) => r.code), ...genericConfigurations(3)])]
        .map((code) => [code, describeGearCode(code)])
));

/**
 * Is this a designation the naming convention admits?
 * Membership of GEAR_CODES is sufficient but not necessary — the convention
 * is open-ended ("Increase numeric value for additional tandem axles",
 * Figure 2), so anything that parses is valid.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isValidGearCode(code) {
    try { parseGearCode(code); return true; } catch { return false; }
}

/**
 * Wheels the designation implies, excluding the nose gear — Table 3's
 * "Total # Wheels, Excluding Nose" column. Null when the name is one the
 * Order declines to decompose (`C5`, §6h).
 *
 * @param {string} code
 * @returns {number|null}
 */
function wheelsFromDesignation(code) {
    try {
        const c = parseGearCode(code);
        return c.special ? null : gearWheelCount(c);
    } catch { return null; }
}

/* ------------------------------------------------------------
   Fields that must carry provenance, per object kind.
   ------------------------------------------------------------ */

const REQUIRED_PROVENANCE = {
    truckUnit: ['overallLength'],
    axle: ['x', 'trackWidth', 'dualSpacing'],
    axleGroup: ['spacing'],
    aircraftUnit: ['wheelbase', 'mainGearOuterWidth', 'mainGearTrack', 'percentOnMainGear'],
    gear: ['x', 'y', 'dualSpacing', 'tandemSpacing']
};

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {string[]} errors    structural or provenance failures
 * @property {string[]} warnings  things worth flagging that do not fail a build
 */

/**
 * @param {*} v
 * @returns {boolean} true when v is a usable citation string
 */
function hasSource(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Is this a `{value, unit, basis}` quantity with provenance?
 * @param {*} q
 * @returns {boolean}
 */
function quantityHasProvenance(q) {
    return !!q && typeof q === 'object' && hasSource(q.basis);
}

/**
 * Validate one unit (truck or aircraft) structurally and for provenance.
 *
 * @param {object} unit
 * @param {{strict?: boolean}} [opts] strict also fails on warnings
 * @returns {ValidationResult}
 */
export function validateUnit(unit, opts = {}) {
    const errors = [];
    const warnings = [];
    const id = unit && unit.id ? unit.id : '<no id>';
    const E = (m) => errors.push(`[${id}] ${m}`);
    const W = (m) => warnings.push(`[${id}] ${m}`);

    if (!unit || typeof unit !== 'object') {
        return { ok: false, errors: ['Unit is not an object'], warnings: [] };
    }
    if (unit.schemaVersion !== SCHEMA_VERSION) {
        E(`schemaVersion must be "${SCHEMA_VERSION}", got "${unit.schemaVersion}"`);
    }
    if (!hasSource(unit.id)) E('Missing id');
    if (unit.domain !== 'truck' && unit.domain !== 'aircraft') {
        E(`domain must be "truck" or "aircraft", got "${unit.domain}"`);
        return { ok: false, errors, warnings };
    }
    if (!Array.isArray(unit.sources) || unit.sources.length === 0) {
        E('sources[] is required and must not be empty');
    }

    if (unit.domain === 'truck') validateTruck(unit, E, W);
    else validateAircraft(unit, E, W);

    const ok = errors.length === 0 && (!opts.strict || warnings.length === 0);
    return { ok, errors, warnings };
}

/**
 * @param {object} u
 * @param {(m:string)=>void} E
 * @param {(m:string)=>void} W
 */
function validateTruck(u, E, W) {
    if (!Array.isArray(u.axles) || u.axles.length === 0) {
        E('truck unit requires a non-empty axles[]');
        return;
    }
    if (!u.classification || typeof u.classification.class !== 'number') {
        E('truck unit requires classification.class (FHWA Scheme F, 1-13)');
    } else if (u.classification.class < 1 || u.classification.class > 13) {
        E(`classification.class out of range: ${u.classification.class}`);
    }

    checkProvenanceFields(u, REQUIRED_PROVENANCE.truckUnit, u.sources?.length ? 'unit sources' : null, E);

    const ids = new Set();
    let firstAxleX = null;
    u.axles.forEach((a, i) => {
        const tag = `axle[${i}]${a && a.id ? ' ' + a.id : ''}`;
        if (!a || typeof a !== 'object') { E(`${tag} is not an object`); return; }
        if (!hasSource(a.id)) E(`${tag} missing id`);
        if (ids.has(a.id)) E(`${tag} duplicate id "${a.id}"`);
        ids.add(a.id);
        if (!AXLE_ROLES.includes(a.role)) E(`${tag} role "${a.role}" not one of ${AXLE_ROLES.join('|')}`);
        if (typeof a.x !== 'number') E(`${tag} x must be a number (mm from front axle)`);
        if (i === 0) firstAxleX = a.x;

        // Class 1 motorcycles carry a single wheel on the vehicle centerline,
        // so an axle may legitimately have one wheel position and zero track.
        const positions = a.wheelPositions ?? 2;
        if (positions !== 1 && positions !== 2) {
            E(`${tag} wheelPositions must be 1 or 2, got ${positions}`);
        }
        if (positions === 1) {
            if (a.trackWidth !== 0) E(`${tag} single-wheel-position axle must have trackWidth 0`);
        } else if (typeof a.trackWidth !== 'number' || a.trackWidth <= 0) {
            E(`${tag} trackWidth must be > 0`);
        }
        if (!TIRE_CONFIGS[a.tireConfig]) E(`${tag} tireConfig "${a.tireConfig}" not one of STA|DTA|WBT`);
        if (!hasSource(a.tire)) E(`${tag} missing tire designation`);

        if (a.tireConfig === 'DTA') {
            if (typeof a.dualSpacing !== 'number' || a.dualSpacing <= 0) {
                E(`${tag} DTA requires a positive dualSpacing`);
            }
        } else if (a.dualSpacing != null) {
            W(`${tag} has dualSpacing but tireConfig is ${a.tireConfig}; it will be ignored`);
        }

        if (!hasSource(a.source)) {
            E(`${tag} has no source. Every axle's geometry must carry a citation.`);
        }
        if (a.load != null && !quantityHasProvenance(a.load)) {
            E(`${tag} load is present but has no basis. State where the load comes from, or omit it.`);
        }
    });

    if (firstAxleX !== null && firstAxleX !== 0) {
        E(`first axle x must be 0 (origin is the front-most axle centerline), got ${firstAxleX}`);
    }

    const sorted = u.axles.every((a, i, arr) => i === 0 || arr[i - 1].x <= a.x);
    if (!sorted) E('axles[] must be ordered front to rear by x');

    if (Array.isArray(u.axleGroups)) {
        u.axleGroups.forEach((g, i) => {
            const tag = `axleGroup[${i}]${g && g.id ? ' ' + g.id : ''}`;
            if (!GROUP_TYPES[g.type]) E(`${tag} type "${g.type}" not one of ${Object.keys(GROUP_TYPES).join('|')}`);
            if (!Array.isArray(g.axles) || g.axles.length === 0) { E(`${tag} axles[] required`); return; }
            if (GROUP_TYPES[g.type] && g.axles.length !== GROUP_TYPES[g.type]) {
                E(`${tag} type "${g.type}" implies ${GROUP_TYPES[g.type]} axles, has ${g.axles.length}`);
            }
            for (const ref of g.axles) {
                if (!ids.has(ref)) E(`${tag} references unknown axle "${ref}"`);
            }
            if (g.axles.length > 1) {
                if (typeof g.spacing !== 'number' || g.spacing <= 0) E(`${tag} multi-axle group requires spacing > 0`);
                if (!hasSource(g.source)) E(`${tag} spacing has no source`);
            }
        });
        const grouped = new Set(u.axleGroups.flatMap((g) => g.axles || []));
        for (const aid of ids) if (!grouped.has(aid)) W(`axle "${aid}" belongs to no axle group`);
    } else {
        W('no axleGroups[]; group dimensions and isolation by group will be unavailable');
    }

    if (u.gvw != null && !quantityHasProvenance(u.gvw)) {
        E('gvw is present but has no basis');
    }
}

/**
 * @param {object} u
 * @param {(m:string)=>void} E
 * @param {(m:string)=>void} W
 */
function validateAircraft(u, E, W) {
    if (!Array.isArray(u.gears) || u.gears.length === 0) {
        E('aircraft unit requires a non-empty gears[]');
        return;
    }
    if (!hasSource(u.gearDesignation)) E('aircraft unit requires gearDesignation');
    else if (!isValidGearCode(u.gearDesignation)) {
        // A designation that does not parse is an ERROR, not a warning. The
        // gear name is how every downstream reader — a pavement engineer, an
        // export header, this app's own catalog — identifies the
        // configuration, and one that the naming convention cannot read is
        // simply wrong. Being absent from Table 3 is a different matter and
        // is not flagged at all: the convention is open-ended by design.
        let why = '';
        try { parseGearCode(u.gearDesignation); } catch (err) { why = ` — ${err.message}`; }
        E(`gearDesignation "${u.gearDesignation}" is not a valid FAA Order 5300.7 gear name${why}`);
    } else {
        // The name and the geometry must agree. A unit labeled 2D that
        // carries three tandem rows is a transcription error in one of the
        // two, and which one it is cannot be decided here — but that they
        // disagree can.
        const stated = wheelsFromDesignation(u.gearDesignation);
        const actual = (u.gears || [])
            .filter((g) => g.role !== 'nose' && !/^N/i.test(g.id || ''))
            .reduce((n, g) => n + (g.wheelsAcross ?? (g.type === 'dual' ? 2 : 1)) * (g.tandemRows ?? 1), 0);
        if (stated != null && actual !== stated) {
            E(`gear designation "${u.gearDesignation}" implies ${stated} wheels excluding the nose gear, `
                + `but gears[] carries ${actual}`);
        }
    }

    checkProvenanceFields(u, REQUIRED_PROVENANCE.aircraftUnit, u.sources?.length ? 'unit sources' : null, E);

    if (u.mtow != null && !quantityHasProvenance(u.mtow)) E('mtow is present but has no basis');
    if (u.maxTaxiWeight != null && !quantityHasProvenance(u.maxTaxiWeight)) {
        E('maxTaxiWeight is present but has no basis');
    }
    if (u.tirePressure != null && !quantityHasProvenance(u.tirePressure)) {
        E('tirePressure is present but has no basis');
    }

    // An aircraft unit must state, explicitly, which of its numbers are
    // assumed rather than sourced.
    //
    // The published record for an aircraft constrains its gear envelope — the
    // outer width and the wheelbase — but not necessarily every spacing
    // inside it. Where a value had to be chosen rather than read, saying so is
    // the difference between a modeling assumption and a fabricated
    // measurement. An empty array is a valid and meaningful answer: it asserts
    // that nothing was assumed.
    if (!Array.isArray(u.assumedFields)) {
        E('aircraft unit must declare assumedFields[] (use [] if nothing was assumed)');
    }

    // The outer width is the load-bearing datum: gear transverse positions are
    // derived from it, so it must be present and cited.
    if (u.mainGearOuterWidth == null && u.mainGearTrack == null) {
        E('aircraft unit requires mainGearOuterWidth (preferred) or mainGearTrack');
    }
    if (u.percentOnMainGear != null) {
        if (typeof u.percentOnMainGear !== 'number' || u.percentOnMainGear <= 0 || u.percentOnMainGear >= 100) {
            E(`percentOnMainGear must be between 0 and 100, got ${u.percentOnMainGear}`);
        }
    }

    const ids = new Set();
    u.gears.forEach((g, i) => {
        const tag = `gear[${i}]${g && g.id ? ' ' + g.id : ''}`;
        if (!hasSource(g.id)) E(`${tag} missing id`);
        if (ids.has(g.id)) E(`${tag} duplicate id "${g.id}"`);
        ids.add(g.id);
        if (typeof g.x !== 'number') E(`${tag} x must be a number`);
        if (typeof g.y !== 'number') E(`${tag} y must be a number`);
        if (!hasSource(g.tire)) E(`${tag} missing tire designation`);
        if (!hasSource(g.source)) E(`${tag} has no source`);
        const wheelsAcross = g.wheelsAcross ?? (g.type === 'dual' ? 2 : g.type === 'single' ? 1 : null);
        if (wheelsAcross == null) E(`${tag} cannot determine wheelsAcross from type "${g.type}"`);

        // A bogie states its lateral geometry either as an even pitch or, where
        // the published one is not even, as explicit offsets. Exactly one has
        // to be there. Offsets must describe every wheel on the axle and must
        // be centered on the strut, or the strut's own y stops meaning what the
        // track derivation assumes it means.
        const offsets = g.wheelOffsets;
        if (offsets != null) {
            if (!Array.isArray(offsets) || !offsets.every((v) => typeof v === 'number')) {
                E(`${tag} wheelOffsets must be an array of numbers, mm from the strut centerline`);
            } else if (offsets.length !== wheelsAcross) {
                E(`${tag} wheelOffsets has ${offsets.length} entries but the axle carries ${wheelsAcross} wheels`);
            } else {
                const mean = offsets.reduce((s, v) => s + v, 0) / offsets.length;
                if (Math.abs(mean) > 0.5) {
                    E(`${tag} wheelOffsets are not centered on the strut (mean ${mean.toFixed(2)} mm). `
                        + 'They are measured from the strut centerline, so they must sum to zero.');
                }
                if (!offsets.every((v, i, a) => i === 0 || a[i - 1] < v)) {
                    E(`${tag} wheelOffsets must be ordered left to right and distinct`);
                }
            }
        } else if (wheelsAcross > 1 && !(g.dualSpacing > 0)) {
            E(`${tag} multi-wheel gear requires dualSpacing > 0, or explicit wheelOffsets`);
        }
        const rows = g.tandemRows ?? 1;
        if (rows > 1 && !(g.tandemSpacing > 0)) E(`${tag} tandemRows ${rows} requires tandemSpacing > 0`);
        if (g.pressure != null && !quantityHasProvenance(g.pressure)) {
            E(`${tag} pressure is present but has no basis`);
        }
    });

    // The derived track must reproduce the stated outer width exactly. This is
    // the check that stops a transcription slip in either number from quietly
    // moving every main wheel: the two are related by the tire's own section
    // width, so they cannot be edited independently without the geometry
    // becoming self-contradictory.
    if (u.mainGearOuterWidth != null) {
        const mains = u.gears.filter((g) => g.role === 'main');
        if (mains.length >= 2) {
            const ys = mains.map((g) => g.y);
            const span = Math.max(...ys) - Math.min(...ys);
            // The outer width is measured at the OUTERMOST tires, so the dual
            // spacing and tire that close the sum are the outermost strut's,
            // not whichever main gear happens to be listed first. On a two-strut
            // aircraft these are the same thing. On a wing-plus-body gear they
            // are not: the A380's body gear is 1550 mm dual against the wing
            // gear's 1350 mm, and taking the first would misjudge the width by
            // 200 mm while looking entirely reasonable.
            const outer = mains.reduce((a, b) => (Math.abs(b.y) > Math.abs(a.y) ? b : a), mains[0]);
            const across = outer.wheelsAcross ?? 2;
            const dual = outer.dualSpacing || 0;
            let section = null;
            try {
                section = sectionWidthOf(outer.tire);
            } catch { /* tire checked elsewhere */ }
            if (section != null) {
                const implied = span + (across - 1) * dual + section;
                if (Math.abs(implied - u.mainGearOuterWidth) > 2) {
                    E(`main gear geometry does not reproduce mainGearOuterWidth: `
                        + `track ${span} + dual ${(across - 1) * dual} + section ${section.toFixed(1)} `
                        + `= ${implied.toFixed(1)} mm, but mainGearOuterWidth is ${u.mainGearOuterWidth} mm`);
                }
            }
        }
    }

    const noseGears = u.gears.filter((g) => /^N/i.test(g.id) || g.role === 'nose');
    if (noseGears.length === 0) W('no gear identified as the nose gear');
}

/**
 * Fail any listed field that holds a number but whose object carries no source.
 * @param {object} obj
 * @param {string[]} fields
 * @param {string|null} coveringSource
 * @param {(m:string)=>void} E
 */
function checkProvenanceFields(obj, fields, coveringSource, E) {
    for (const f of fields) {
        const v = obj[f];
        if (v == null) continue;                 // null is an honest "unknown"
        if (typeof v === 'object') {
            if (!quantityHasProvenance(v)) E(`${f} has no basis`);
            continue;
        }
        if (typeof v === 'number' && !coveringSource && !hasSource(obj.source)) {
            E(`${f} = ${v} has no source`);
        }
    }
}

/**
 * Walk a whole library and report every provenance failure.
 * Used by the data-validation test.
 *
 * @param {object[]} units
 * @param {{strict?: boolean}} [opts]
 * @returns {ValidationResult & {byUnit: Record<string, ValidationResult>}}
 */
export function validateLibrary(units, opts = {}) {
    const errors = [];
    const warnings = [];
    /** @type {Record<string, ValidationResult>} */
    const byUnit = {};
    const seen = new Set();

    for (const u of units) {
        const r = validateUnit(u, opts);
        byUnit[u && u.id ? u.id : `<index ${units.indexOf(u)}>`] = r;
        errors.push(...r.errors);
        warnings.push(...r.warnings);
        if (u && u.id) {
            if (seen.has(u.id)) errors.push(`Duplicate unit id "${u.id}" in library`);
            seen.add(u.id);
        }
    }
    return { ok: errors.length === 0 && (!opts.strict || warnings.length === 0), errors, warnings, byUnit };
}

/**
 * Number of tires on an axle.
 * @param {object} axle
 * @returns {number}
 */
export function tiresOnAxle(axle) {
    const per = TIRE_CONFIGS[axle.tireConfig]?.tiresPerPosition ?? 1;
    return per * (axle.wheelPositions ?? 2);
}

/**
 * Total tire count for a unit, either domain.
 * @param {object} unit
 * @returns {number}
 */
export function tireCount(unit) {
    if (unit.domain === 'truck') {
        return (unit.axles || []).reduce((n, a) => n + tiresOnAxle(a), 0);
    }
    return (unit.gears || []).reduce((n, g) => {
        const across = g.wheelsAcross ?? (g.type === 'dual' ? 2 : 1);
        return n + across * (g.tandemRows ?? 1);
    }, 0);
}
