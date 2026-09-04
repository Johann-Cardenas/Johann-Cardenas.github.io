/* ============================================================
   Gear3D — FAA Order 5300.7 gear nomenclature
   ------------------------------------------------------------
   The naming convention for aircraft landing gear configurations,
   as an executable grammar rather than a lookup table.

   FAA Order 5300.7, effective 6 October 2005, replaced three
   mutually untranslatable systems — the FAA's own, the Air Force's
   and the Navy's — with one. Its section 6 defines a name as up to
   three variables:

       # X #  /  # X #  ( P )
       │ │ │     │ │ │    └── optional ICAO tire pressure code
       │ │ │     │ │ └────── TOTAL number of body/belly gears
       │ │ │     │ └──────── gear type, S D T or Q
       │ │ │     └────────── gear types in tandem
       │ │ └──────────────── number of main gears in line, ONE SIDE
       │ └────────────────── gear type, S D T or Q
       └──────────────────── gear types in tandem

   Two elisions make the common cases short, and both are in the
   Order: a leading tandem count of 1 is omitted, and a main-gear
   in-line count of 1 is omitted. The body-gear count is NEVER
   omitted, "because body gear arrangement may not be symmetrical"
   (§6f) — so `D1` and `D` mean different things, and a parser that
   defaulted the body count to 1 would silently accept the latter.

   The historical tandem designation "T" is gone: §6d states that
   "T" now indicates TRIPLE wheels. `2D` is two duals in tandem,
   not a dual-tandem-anything. This module therefore refuses to
   guess at legacy strings; it parses the current convention only,
   and carries the legacy names as cross-reference data instead.

   Pure domain logic: no three.js, no DOM. Runs under Node for the
   test suite.
   ============================================================ */

'use strict';

/**
 * Gear type codes and the number of wheels across one axle line.
 * FAA Order 5300.7 §6c.
 * @type {Readonly<Record<string, number>>}
 */
export const GEAR_TYPES = Object.freeze({ S: 1, D: 2, T: 3, Q: 4 });

/** Prose name of each gear type, §6c. */
export const GEAR_TYPE_NAMES = Object.freeze({
    S: 'single', D: 'dual', T: 'triple', Q: 'quadruple'
});

/**
 * ICAO tire pressure categories, FAA Order 5300.7 Table 1.
 * The code is appended in parentheses, e.g. `2D/2D1(Z)` — Table 2.
 */
export const TIRE_PRESSURE_CODES = Object.freeze({
    W: { category: 'High', psi: 'No limit', mpa: 'No limit', maxPsi: null },
    X: { category: 'Medium', psi: '146 – 217', mpa: '1.01 – 1.5', maxPsi: 217 },
    Y: { category: 'Low', psi: '74 – 145', mpa: '0.51 – 1.0', maxPsi: 145 },
    Z: { category: 'Very low', psi: '0 – 73', mpa: '0.0 – 0.5', maxPsi: 73 }
});

/**
 * Configurations the Order itself declines to name by the convention.
 * §6h: "The Lockheed C-5 Galaxy has a unique gear type and is difficult
 * to name using the proposed method. This aircraft will not be classified
 * using the new naming convention and will continue to be referred to
 * directly as the C5."
 */
export const SPECIAL_CODES = Object.freeze({
    C5: {
        code: 'C5',
        wheels: 24,
        description: 'Complex gear: a dual wheel and quadruple wheel combination, four struts',
        reason: 'FAA Order 5300.7 §6h names this aircraft directly rather than by the convention.'
    }
});

/** Ordinal words for tandem counts, so descriptions read as the Order writes them. */
const ORDINALS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten'];

/** @param {number} n @returns {string} */
function count(n) { return ORDINALS[n] ?? String(n); }

/** @param {number} n @param {string} singular @returns {string} */
function plural(n, singular) { return n === 1 ? singular : `${singular}s`; }

/**
 * @typedef {Object} GearTerm
 * @property {number} tandem   axle lines in tandem (1 when elided)
 * @property {'S'|'D'|'T'|'Q'} type
 * @property {number} multiple main: gears in line ONE SIDE. body: TOTAL gears.
 * @property {boolean} multipleStated  was the trailing digit written out?
 */

/**
 * @typedef {Object} GearCode
 * @property {string} raw               the input, trimmed
 * @property {string} canonical         re-emitted in the Order's own form
 * @property {GearTerm} main
 * @property {GearTerm|null} body       null when no body/belly gear
 * @property {'W'|'X'|'Y'|'Z'|null} pressure
 * @property {string|null} special      'C5' for a directly-named configuration
 * @property {boolean} nonUniformBody   the §6g hyphen form, e.g. 2D/2D2-D
 * @property {string|null} bodySuffix   the raw text after the hyphen
 */

const TERM = /^(\d*)([SDTQ])(\d*)$/;

/**
 * Parse a gear designation.
 *
 * Throws rather than returning a partial result: a half-understood gear name
 * is worse than a refusal, because every downstream wheel position would be
 * derived from the half that was guessed.
 *
 * @param {string} designation
 * @returns {GearCode}
 * @throws {Error} with a message naming the specific rule that was broken
 */
export function parseGearCode(designation) {
    if (typeof designation !== 'string' || designation.trim() === '') {
        throw new Error('Gear designation must be a non-empty string');
    }
    const raw = designation.trim();

    // Tire pressure code, Table 2. Stripped first so the rest of the grammar
    // never has to know about it.
    let body = raw;
    /** @type {'W'|'X'|'Y'|'Z'|null} */
    let pressure = null;
    const pm = body.match(/\(([A-Za-z])\)\s*$/);
    if (pm) {
        const c = pm[1].toUpperCase();
        if (!TIRE_PRESSURE_CODES[c]) {
            throw new Error(`"${pm[1]}" is not an ICAO tire pressure code (W, X, Y or Z — Table 1)`);
        }
        pressure = /** @type {'W'|'X'|'Y'|'Z'} */ (c);
        body = body.slice(0, pm.index).trim();
    }

    const upper = body.toUpperCase();

    // Directly-named configurations, §6h. They carry no internal grammar.
    if (SPECIAL_CODES[upper]) {
        return {
            raw, canonical: upper + (pressure ? `(${pressure})` : ''),
            main: { tandem: 1, type: 'D', multiple: 1, multipleStated: false },
            body: null, pressure, special: upper,
            nonUniformBody: false, bodySuffix: null
        };
    }

    // §6g: a hyphen marks a nonuniform body gear, e.g. `2D/2D2-D`. The suffix
    // is carried but not interpreted — the Order gives it as an extension
    // point for future aircraft, not a closed grammar.
    let bodySuffix = null;
    const hy = upper.indexOf('-');
    let work = upper;
    if (hy >= 0) {
        bodySuffix = upper.slice(hy + 1);
        work = upper.slice(0, hy);
        if (!bodySuffix) throw new Error('A hyphen must be followed by the nonuniform body gear term (§6g)');
    }

    const parts = work.split('/');
    if (parts.length > 2) {
        throw new Error('A gear name has at most one slash: main gear / body gear (§6f)');
    }

    const main = parseTerm(parts[0], 'main');
    const bodyTerm = parts.length === 2 ? parseTerm(parts[1], 'body') : null;

    const code = {
        raw,
        canonical: '',
        main,
        body: bodyTerm,
        pressure,
        special: null,
        nonUniformBody: bodySuffix != null,
        bodySuffix
    };
    code.canonical = formatGearCode(code);
    return code;
}

/**
 * @param {string} s
 * @param {'main'|'body'} role
 * @returns {GearTerm}
 */
function parseTerm(s, role) {
    const t = s.trim();
    if (!t) throw new Error(`Missing the ${role} gear term`);
    const m = t.match(TERM);
    if (!m) {
        throw new Error(
            `"${t}" is not a gear term. Expected [tandem]TYPE[multiple] `
            + `with TYPE one of S, D, T or Q (§6c).`
        );
    }
    const tandem = m[1] ? Number(m[1]) : 1;
    const type = /** @type {'S'|'D'|'T'|'Q'} */ (m[2]);
    const multipleStated = m[3] !== '';
    const multiple = multipleStated ? Number(m[3]) : 1;

    if (tandem < 1) throw new Error(`Tandem count must be 1 or more, got ${tandem}`);
    if (multiple < 1) throw new Error(`Gear multiple must be 1 or more, got ${multiple}`);

    // §6f. The body-gear count is the TOTAL number of body gears and "a value
    // of 1 is not omitted if only one gear exists", precisely because the
    // arrangement may be asymmetric. Accepting a bare `D` after the slash
    // would make `2D/D` and `2D/D1` synonyms, and they are not.
    if (role === 'body' && !multipleStated) {
        throw new Error(
            'The body gear term must state its total count — `D1`, not `D` (§6f). '
            + 'The count is never omitted because a body gear may be asymmetric.'
        );
    }
    return { tandem, type, multiple, multipleStated };
}

/**
 * Re-emit a parsed code in the Order's own form, applying both elisions.
 * parse(format(x)) === x for every valid x, which the test suite asserts.
 *
 * @param {GearCode} code
 * @returns {string}
 */
export function formatGearCode(code) {
    if (code.special) return code.special + (code.pressure ? `(${code.pressure})` : '');
    let s = term(code.main, false);
    if (code.body) s += '/' + term(code.body, true);
    if (code.bodySuffix) s += '-' + code.bodySuffix;
    if (code.pressure) s += `(${code.pressure})`;
    return s;

    /** @param {GearTerm} t @param {boolean} isBody */
    function term(t, isBody) {
        const lead = t.tandem > 1 ? String(t.tandem) : '';
        // §6e: "a value of 1 is assumed and is omitted from the main gear
        // designation". §6f: the body count is always written.
        const trail = isBody ? String(t.multiple) : (t.multiple > 1 ? String(t.multiple) : '');
        return lead + t.type + trail;
    }
}

/**
 * Total wheels on the main and body gear, excluding the nose gear —
 * the quantity Table 3 tabulates as "Total # Wheels, Excluding Nose".
 *
 * The main-gear multiple counts gears on ONE SIDE and the gear is
 * symmetric (§6e), so it is doubled. The body-gear multiple is already
 * the total (§6f), so it is not.
 *
 * @param {GearCode|string} code
 * @returns {number}
 */
export function gearWheelCount(code) {
    const c = typeof code === 'string' ? parseGearCode(code) : code;
    if (c.special) return SPECIAL_CODES[c.special].wheels;
    const wheels = (t, sides) => sides * t.multiple * t.tandem * GEAR_TYPES[t.type];
    return wheels(c.main, 2) + (c.body ? wheels(c.body, 1) : 0);
}

/** Wheels on one main gear strut. @param {GearCode|string} code @returns {number} */
export function wheelsPerMainStrut(code) {
    const c = typeof code === 'string' ? parseGearCode(code) : code;
    return c.main.tandem * GEAR_TYPES[c.main.type];
}

/**
 * The Order's own prose, assembled from the parsed parts.
 *
 * The phrasing follows the figure captions of Figures 3–20 rather than being
 * invented here, so a description generated for `2D/2D2` reads the way
 * Figure 12's caption reads.
 *
 * @param {GearCode|string} code
 * @returns {string}
 */
export function describeGearCode(code) {
    const c = typeof code === 'string' ? parseGearCode(code) : code;
    if (c.special) return SPECIAL_CODES[c.special].description;

    let s = cap(mainPhrase(c.main)) + ' main gear';
    if (c.body) s += ' with ' + bodyPhrase(c.body);
    if (c.nonUniformBody) s += `, plus a nonuniform ${c.bodySuffix} body gear (§6g)`;
    if (c.pressure) {
        const p = TIRE_PRESSURE_CODES[c.pressure];
        const range = p.maxPsi == null ? 'no limit' : `${p.psi} psi`;
        s += `, ${p.category.toLowerCase()} tire pressure (${range})`;
    }
    return s;

    /**
     * The main gear, phrased as Figures 3–20 caption it: "Dual Wheel Main
     * Gear" (Fig 5), "Two Triple wheels in Tandem Main Gear" (Fig 8),
     * "Dual Wheel Gear Two Struts per Side Main Gear" (Fig 18).
     * @param {GearTerm} t
     */
    function mainPhrase(t) {
        const type = GEAR_TYPE_NAMES[t.type];
        const core = t.tandem > 1
            ? `${count(t.tandem)} ${type} wheels in tandem`
            : `${type} wheel`;
        // §6e's in-line multiple. The Order captions it as struts per side,
        // which is what the number physically counts.
        return t.multiple > 1 ? `${core}, ${count(t.multiple)} struts per side` : core;
    }

    /**
     * The body gear. Its count is the TOTAL across the aircraft (§6f), so it
     * leads, and the tandem depth qualifies each one — "Three Dual Wheels in
     * Tandem Body Gear" of Figure 16, times two.
     * @param {GearTerm} t
     */
    function bodyPhrase(t) {
        const type = GEAR_TYPE_NAMES[t.type];
        const n = t.multiple;
        const head = `${count(n)} body ${plural(n, 'gear')}`;
        if (t.tandem === 1) return `${head}, ${type} ${plural(GEAR_TYPES[t.type], 'wheel')}`;
        return `${head}, ${n === 1 ? '' : 'each '}${count(t.tandem)} ${type} wheels in tandem`;
    }

    /** @param {string} s */
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
}

/**
 * Normalized wheel plan for a code, as coordinates.
 *
 * Positions are in an abstract unit grid — transverse in wheel pitches,
 * longitudinal in axle pitches, origin at the center of the gear. Deliberately
 * scale-free: Figure 2 draws twelve configurations at one size so that the
 * PATTERN is what differs between cells, which is exactly what a thumbnail
 * wants too.
 *
 * SCOPE. The Order draws its configurations at two different scopes and the
 * distinction is not cosmetic. Figure 2 draws ONE GEAR — `2D` is four ellipses
 * in a square, not eight across an aircraft — because for those configurations
 * the strut IS the configuration. Figures 10-12, 16, 18 and 20 draw the WHOLE
 * AIRCRAFT, because for those the arrangement OF struts is the thing being
 * named: nothing about a single bogie distinguishes `2D` from `2D/2D2`.
 *
 * `scope: 'auto'` therefore follows that rule rather than picking one and
 * living with it — a whole-aircraft drawing of a plain `S` is two dots either
 * side of a lot of nothing, and a single-strut drawing of a `2D/2D2` omits the
 * only feature that makes it a 2D/2D2.
 *
 * @param {GearCode|string} code
 * @param {{gap?: number, scope?: 'auto'|'strut'|'aircraft'}} [opts]
 * @returns {{wheels: Array<{u:number, v:number, role:'main'|'body'}>,
 *            uSpan: number, vSpan: number, scope: 'strut'|'aircraft'}}
 */
export function wheelPlan(code, opts = {}) {
    const c = typeof code === 'string' ? parseGearCode(code) : code;
    const gap = opts.gap ?? 2.2;
    /** @type {Array<{u:number, v:number, role:'main'|'body'}>} */
    const wheels = [];

    const requested = opts.scope ?? 'auto';
    const scope = requested !== 'auto' ? requested
        : (c.special || c.body || c.main.multiple > 1) ? 'aircraft' : 'strut';

    // One gear, as Figure 2 draws it: a single bogie, centered on itself.
    if (scope === 'strut' && !c.special) {
        const across = GEAR_TYPES[c.main.type];
        for (let r = 0; r < c.main.tandem; r++) {
            for (let i = 0; i < across; i++) {
                wheels.push({
                    u: i - (across - 1) / 2,
                    v: r - (c.main.tandem - 1) / 2,
                    role: 'main'
                });
            }
        }
        return span(wheels);
    }

    if (c.special === 'C5') {
        // Figure 17: four struts, each a quadruple axle and a dual axle.
        for (const side of [-1, 1]) {
            for (const strut of [-1, 1]) {
                const u0 = side * 3.1;
                const v0 = strut * 1.6;
                for (const du of [-1.5, -0.5, 0.5, 1.5]) wheels.push({ u: u0 + du, v: v0 - 0.5, role: 'main' });
                for (const du of [-0.5, 0.5]) wheels.push({ u: u0 + du, v: v0 + 0.5, role: 'main' });
            }
        }
        return span(wheels);
    }

    place(c.main, 'main');
    if (c.body) place(c.body, 'body');
    return span(wheels);

    /**
     * @param {GearTerm} t
     * @param {'main'|'body'} role
     */
    function place(t, role) {
        const across = GEAR_TYPES[t.type];
        // Body gears sit inboard and aft of the main gear — Figures 10-12 and
        // 16, and corroborated by the 747's published 3073 mm aft offset.
        const base = role === 'main' ? across / 2 + 2.6 : 0;
        const vShift = role === 'body' ? t.tandem / 2 + 1.1 : 0;

        // The main multiple counts gears IN LINE on one side and is mirrored;
        // the body multiple is the total across the aircraft and is laid out
        // about the centerline.
        //
        // "In line" means along the aircraft, not across it. Figure 18's B-52
        // and Figure 20's IL-76 both put their second strut BEHIND the first,
        // which is the only reading that makes D2 a different configuration
        // from a wider bogie. Spreading them sideways instead drew a Q2 as an
        // eight-wheel axle line, which is a gear that does not exist.
        const inLinePitch = t.tandem + 1.8;
        const lanes = role === 'main'
            ? [-1, 1].map((s) => s * base)
            : centeredLanes(t.multiple, across + 1.6);
        const files = role === 'main'
            ? Array.from({ length: t.multiple }, (_, k) => (k - (t.multiple - 1) / 2) * inLinePitch)
            : [0];

        for (const u0 of lanes) {
            for (const v0 of files) {
                for (let r = 0; r < t.tandem; r++) {
                    const v = v0 + (r - (t.tandem - 1) / 2) + vShift;
                    for (let i = 0; i < across; i++) {
                        wheels.push({ u: u0 + (i - (across - 1) / 2), v, role });
                    }
                }
            }
        }
    }

    /** Body gears, distributed symmetrically about the centerline. */
    function centeredLanes(n, pitch) {
        if (n === 1) return [0];
        return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
    }

    /** @param {Array<{u:number,v:number,role:'main'|'body'}>} ws */
    function span(ws) {
        const us = ws.map((w) => w.u);
        const vs = ws.map((w) => w.v);
        return {
            wheels: ws,
            uSpan: Math.max(...us) - Math.min(...us) + 1,
            vSpan: Math.max(...vs) - Math.min(...vs) + 1,
            scope: /** @type {'strut'|'aircraft'} */ (scope === 'strut' ? 'strut' : 'aircraft')
        };
    }
}

/* ============================================================
   FAA Order 5300.7 Table 3
   ------------------------------------------------------------
   The whole table, transcribed. Its value is that it is the ONLY
   published concordance between the current convention and the
   three legacy systems, so an engineer holding a drawing marked
   "T-TA" or "DDT" can find out what it is. Blank cells in the
   Order are `null` here rather than guessed at.
   ============================================================ */

/**
 * @typedef {Object} FaaTableRow
 * @property {string} code           proposed nomenclature
 * @property {number} figure         reference figure in the Order
 * @property {number} wheels         total wheels excluding the nose gear
 * @property {string} noseGear       nose gear description
 * @property {{name:string|null, main:string|null, belly:string|null, bellyCount:number|null}} faa
 *           historic FAA designation
 * @property {{designation:string|null, type:string|null, name:string|null}} airForce
 * @property {{name:string|null, designation:string|null}} navy
 * @property {string|null} dod
 * @property {string[]} aircraft     typical aircraft, as the Order lists them
 */

/** @type {readonly FaaTableRow[]} */
export const FAA_TABLE_3 = Object.freeze([
    {
        code: 'S', figure: 3, wheels: 2, noseGear: 'Single wheel',
        faa: { name: 'Single Wheel', main: 'SW', belly: null, bellyCount: null },
        airForce: { designation: 'S', type: 'A', name: 'Single, Tricycle' },
        navy: { name: 'Single Tricycle', designation: 'ST' }, dod: 'S',
        aircraft: ['Grumman F-14', 'McDonnell Douglas F-15']
    },
    {
        code: 'S', figure: 4, wheels: 2, noseGear: 'Dual wheel',
        faa: { name: 'Single Wheel', main: 'SW', belly: null, bellyCount: null },
        airForce: { designation: 'S', type: 'B', name: 'Single, Tricycle' },
        navy: { name: null, designation: null }, dod: null,
        aircraft: []
    },
    {
        code: 'D', figure: 5, wheels: 4, noseGear: 'Single wheel',
        faa: { name: 'Dual wheel', main: 'DW', belly: null, bellyCount: null },
        airForce: { designation: 'T', type: 'C', name: 'Twin, Tricycle' },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Beechcraft 1900']
    },
    {
        code: 'D', figure: 6, wheels: 4, noseGear: 'Dual wheel',
        faa: { name: 'Dual wheel', main: 'DW', belly: null, bellyCount: null },
        airForce: { designation: 'T', type: 'D', name: 'Twin, Tricycle' },
        navy: { name: 'Dual Tricycle', designation: 'DT' }, dod: 'T',
        aircraft: ['Boeing 737', 'Lockheed P-3 (C-9)']
    },
    {
        code: '2S', figure: 7, wheels: 4, noseGear: 'Dual wheel',
        faa: { name: 'Single Tandem', main: null, belly: null, bellyCount: null },
        airForce: { designation: 'S-TA', type: 'E', name: 'Single, Tandem Tricycle' },
        navy: { name: 'Single Tandem Tricycle', designation: 'STT' }, dod: 'ST',
        aircraft: ['Lockheed C-130']
    },
    {
        code: '2T', figure: 8, wheels: 12, noseGear: 'Dual wheel',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: 'TR-TA', type: 'L', name: 'Twin-Tandem, Tricycle' },
        navy: { name: 'Triple Tandem', designation: 'TRT' }, dod: 'TRT',
        aircraft: ['Boeing C-17']
    },
    {
        code: '2D', figure: 9, wheels: 8, noseGear: 'Dual wheel',
        faa: { name: 'Dual Tandem', main: 'DT', belly: null, bellyCount: null },
        airForce: { designation: 'T-TA', type: 'F', name: 'Twin-Tandem, Tricycle' },
        navy: { name: 'Dual Tandem Tricycle', designation: 'DTT' }, dod: 'TT',
        aircraft: ['Boeing 757', 'Boeing KC-135', 'Lockheed C-141']
    },
    {
        code: '2D/D1', figure: 10, wheels: 10, noseGear: 'Dual wheel',
        faa: { name: 'Dual tandem', main: 'DT', belly: 'DW', bellyCount: 1 },
        airForce: { designation: 'T-TA', type: 'H', name: 'Twin-Tandem, Tricycle' },
        navy: { name: 'Single Belly Twin Tandem', designation: 'SBTT' }, dod: 'SBTT',
        aircraft: ['Lockheed L-1011', 'McDonnell Douglas DC-10']
    },
    {
        code: '2D/2D1', figure: 11, wheels: 12, noseGear: 'Dual wheel',
        faa: { name: 'Dual Tandem', main: 'DT', belly: 'DT', bellyCount: 1 },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Airbus A340-600']
    },
    {
        code: '2D/2D2', figure: 12, wheels: 16, noseGear: 'Dual wheel',
        faa: { name: 'Double Dual Tandem', main: 'DT', belly: 'DT', bellyCount: 2 },
        airForce: { designation: 'T-TA', type: 'J', name: 'Twin-Tandem, Tricycle' },
        navy: { name: 'Double Dual Tandem', designation: 'DDT' }, dod: 'DDT',
        aircraft: ['Boeing 747', 'Boeing E-4']
    },
    {
        code: '3D', figure: 13, wheels: 12, noseGear: 'Dual wheel',
        faa: { name: 'Triple dual Tandem', main: 'TDT', belly: null, bellyCount: null },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Boeing 777']
    },
    {
        code: '5D', figure: 14, wheels: 20, noseGear: 'Quadruple (4 across)',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Antonov An-124']
    },
    {
        code: '7D', figure: 15, wheels: 28, noseGear: 'Quadruple (4 across)',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Antonov An-225']
    },
    {
        code: '2D/3D2', figure: 16, wheels: 20, noseGear: 'Dual wheel',
        faa: { name: null, main: 'DT', belly: 'TDT', bellyCount: 2 },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Airbus A380']
    },
    {
        code: 'C5', figure: 17, wheels: 24, noseGear: 'Quadruple (4 across)',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: 'T-D-TA', type: 'K', name: 'Twin-Delta-Tandem, Tricycle' },
        navy: { name: 'Twin Delta Tandem', designation: 'TDT' }, dod: 'TDT',
        aircraft: ['Lockheed C-5 Galaxy']
    },
    {
        code: 'D2', figure: 18, wheels: 8, noseGear: 'None — bicycle gear with wingtip outriggers',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: 'T-T', type: 'G', name: 'Twin-Twin, Bicycle' },
        navy: { name: 'Twin Twin Tricycle', designation: 'TT' }, dod: 'TT',
        aircraft: ['Boeing B-52']
    },
    {
        code: 'Q', figure: 19, wheels: 8, noseGear: 'Dual wheel',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Hawker Siddeley HS-121 Trident']
    },
    {
        code: 'Q2', figure: 20, wheels: 16, noseGear: 'Quadruple (4 across)',
        faa: { name: null, main: null, belly: null, bellyCount: null },
        airForce: { designation: null, type: null, name: null },
        navy: { name: null, designation: null }, dod: null,
        aircraft: ['Ilyushin IL-76']
    }
]);

/**
 * Figure 2's generic configurations: every gear type in one, two and three
 * tandem axle lines. The figure's own caption — "Increase numeric value for
 * additional tandem axles" — is why this is generated rather than listed.
 *
 * @param {number} [maxTandem=3] as drawn in Figure 2
 * @returns {string[]}
 */
export function genericConfigurations(maxTandem = 3) {
    /** @type {string[]} */
    const out = [];
    for (let t = 1; t <= maxTandem; t++) {
        for (const type of ['S', 'D', 'T', 'Q']) {
            out.push(formatGearCode({
                main: { tandem: t, type, multiple: 1, multipleStated: false },
                body: null, pressure: null, special: null,
                bodySuffix: null, nonUniformBody: false, raw: '', canonical: ''
            }));
        }
    }
    return out;
}

/**
 * Every Table 3 row whose code matches, in figure order.
 * A code can appear more than once — `S` has two rows, differing only in the
 * nose gear, which is exactly the distinction Figures 3 and 4 exist to draw.
 *
 * @param {string} code
 * @returns {FaaTableRow[]}
 */
export function tableRowsFor(code) {
    const want = String(code).trim().toUpperCase();
    return FAA_TABLE_3.filter((r) => r.code.toUpperCase() === want);
}

/**
 * Aircraft the Order names against a code, deduplicated across its rows.
 * @param {string} code
 * @returns {string[]}
 */
export function representativeAircraft(code) {
    return [...new Set(tableRowsFor(code).flatMap((r) => r.aircraft))];
}

/**
 * Is this a configuration the Order actually tabulates, or one the grammar
 * merely permits? Both are legitimate; the UI labels them differently, because
 * "3Q" is a pattern from Figure 2 and "2D/2D2" is a Boeing 747.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isTabulated(code) {
    return tableRowsFor(code).length > 0;
}

/**
 * Human-readable summary of everything the Order says about a code.
 * @param {string} designation
 * @returns {{code: string, description: string, wheels: number,
 *            rows: FaaTableRow[], aircraft: string[], generic: boolean}}
 */
export function gearCodeSummary(designation) {
    const c = parseGearCode(designation);
    const rows = tableRowsFor(c.canonical.replace(/\([WXYZ]\)$/, ''));
    return {
        code: c.canonical,
        description: describeGearCode(c),
        wheels: gearWheelCount(c),
        rows,
        aircraft: rows.flatMap((r) => r.aircraft),
        generic: rows.length === 0
    };
}
