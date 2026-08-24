/* ============================================================
   Gear3D — validation suite
   ------------------------------------------------------------
   Run with:  node test/run.mjs      (or: npm test)

   Covers, per the build spec:
     - coordinate round-trip
     - unit conversion
     - tire designation parsing, every format in the library
     - contact-patch area conservation
     - data-provenance walk: every JSON in src/data, every number
       traced to a source
     - class 9 3-S2 regression against hard-coded expected values
     - Federal Bridge Formula compliance for every unit that
       claims it
   ============================================================ */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { group, test, assert, assertClose, assertEqual, assertThrows, summary } from './harness.mjs';

import {
    engToRender, renderToEng, eng, distance, bounds, orbitToEng, engToOrbit, LOCKED_VIEWS,
    renderToEngMatrix, applyMatrix16
} from '../src/core/coords.js';
import {
    MM_PER_IN, MM_PER_FT, KG_PER_LB, lengthFromMm, lengthToMm, forceFromKn, forceToKn,
    pressureFromKpa, pressureToKpa, massFromKg, canonical, formatLength, formatNumber, massToForceKn,
    GROUP_SEPARATOR, UNIT_SPACE
} from '../src/core/units.js';
import { Rng, rng } from '../src/core/prng.js';
import { parseTire, tireGeometry, setNominalTable, checkTire, resolveTire } from '../src/core/tires.js';
import { validateUnit, validateLibrary, tireCount, tiresOnAxle, SCHEMA_VERSION } from '../src/core/schema.js';
import {
    contactArea, rectangularPatch, huangPatch, ellipticalPatch, patchOutline,
    overridePatch, equivalentRadius, HUANG_K
} from '../src/contact/models.js';
import { checkBridgeFormula, bridgeAllowanceLb, knToLb, minimumSpreadMm } from '../src/core/bridge.js';
import { resolveLayout, swapToWideBase } from '../src/core/layout.js';
import { computePatches, patchTotals, DEFAULT_INFLATION_KPA } from '../src/contact/patch.js';
import {
    buildSnapPoints, nearestSnapPoint, inferAxis, dimensionFromSnaps
} from '../src/annotate/snapping.js';
import { dimensionValue } from '../src/annotate/dimensions.js';
import { rotatedBox, overlaps, declutter } from '../src/annotate/projection.js';
import {
    chassisEnvelope, profileFor, WIDTH_LIMIT_MM, HEIGHT_LIMIT_MM
} from '../src/geometry/chassis.js';
import { quadLayout, paneAt, QUAD_ORDER } from '../src/views/quadview.js';
import {
    parseGearCode, formatGearCode, describeGearCode, gearWheelCount, wheelsPerMainStrut,
    wheelPlan, genericConfigurations, tableRowsFor, representativeAircraft, isTabulated,
    GEAR_TYPES, TIRE_PRESSURE_CODES, SPECIAL_CODES, FAA_TABLE_3
} from '../src/core/gearcode.js';
import { toCSV, toAbaqus } from '../src/contact/export.js';
import { serializeProject, parseProject } from '../src/io/project.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'src', 'data');

/** @param {string} p @returns {any} */
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** @param {string} p @returns {string} */
const readText = (p) => readFileSync(p, 'utf8');
const ROOT = join(HERE, '..');

/* ---------- load the data library once ---------- */

const tireTable = readJson(join(DATA, 'tires.json'));
setNominalTable(tireTable.nominal);

const truckIndex = readJson(join(DATA, 'trucks', 'index.json'));
/** @type {any[]} */
const truckUnits = [];
for (const f of truckIndex.files) {
    const file = readJson(join(DATA, 'trucks', f));
    truckUnits.push(...file.units);
}

/** @type {any[]} */
const aircraftUnits = [];
let aircraftIndex = null;
try {
    aircraftIndex = readJson(join(DATA, 'aircraft', 'index.json'));
    for (const f of aircraftIndex.files) {
        const file = readJson(join(DATA, 'aircraft', f));
        aircraftUnits.push(...file.units);
    }
} catch {
    // Aircraft library is optional at M0-M6; validated when present.
}

const allUnits = [...truckUnits, ...aircraftUnits];

/* ============================================================
   1. Coordinates
   ============================================================ */

group('1. Coordinate system');

test('engToRender / renderToEng round-trip on arbitrary points', () => {
    const pts = [eng(0, 0, 0), eng(1234.5, -678.9, 543.2), eng(-1e5, 1e5, 0.001)];
    for (const p of pts) {
        const back = renderToEng(engToRender(p));
        assertClose(back.x, p.x, 1e-9, 'x');
        assertClose(back.y, p.y, 1e-9, 'y');
        assertClose(back.z, p.z, 1e-9, 'z');
    }
});

test('render mapping is the documented cyclic permutation (x,y,z)->(y,z,x)', () => {
    const r = engToRender(eng(1, 2, 3));
    assertEqual(r.x, 2, 'render x should be engineering y');
    assertEqual(r.y, 3, 'render y should be engineering z');
    assertEqual(r.z, 1, 'render z should be engineering x');
});

test('render mapping preserves distances (it is a rotation, not a scaling)', () => {
    const a = eng(100, 200, 300), b = eng(-50, 75, 900);
    const dEng = distance(a, b);
    const ra = engToRender(a), rb = engToRender(b);
    const dRen = Math.hypot(ra.x - rb.x, ra.y - rb.y, ra.z - rb.z);
    assertClose(dRen, dEng, 1e-9, 'distance');
});

test('orbit angles round-trip', () => {
    for (const [az, el] of [[0, 20], [45, 35.264], [-30, 20], [150, 22], [179, 80]]) {
        const v = orbitToEng(az, el);
        const back = engToOrbit(v);
        assertClose(back.azimuth, az, 1e-6, `azimuth ${az}`);
        assertClose(back.elevation, el, 1e-6, `elevation ${el}`);
    }
});

test('locked views form right-handed screen bases', () => {
    for (const [name, v] of Object.entries(LOCKED_VIEWS)) {
        // right x up should equal -lookAlong (camera looks along -normal)
        const c = {
            x: v.right.y * v.up.z - v.right.z * v.up.y,
            y: v.right.z * v.up.x - v.right.x * v.up.z,
            z: v.right.x * v.up.y - v.right.y * v.up.x
        };
        assertClose(c.x, -v.lookAlong.x, 1e-9, `${name} basis x`);
        assertClose(c.y, -v.lookAlong.y, 1e-9, `${name} basis y`);
        assertClose(c.z, -v.lookAlong.z, 1e-9, `${name} basis z`);
    }
});

test('bounds() reports centre and size', () => {
    const b = bounds([eng(0, -100, 0), eng(1000, 100, 500)]);
    assertEqual(b.center.x, 500, 'centre x');
    assertEqual(b.size.y, 200, 'size y');
    assertEqual(b.size.z, 500, 'size z');
});

/* ============================================================
   2. Units
   ============================================================ */

group('2. Unit conversion');

test('inch and foot factors are exact', () => {
    assertEqual(MM_PER_IN, 25.4, 'mm per inch');
    assertEqual(MM_PER_FT, 304.8, 'mm per foot');
    assertEqual(KG_PER_LB, 0.45359237, 'kg per lb');
});

test('length conversions round-trip', () => {
    for (const u of ['mm', 'cm', 'm', 'in', 'ft']) {
        assertClose(lengthToMm(lengthFromMm(1372, u), u), 1372, 1e-9, u);
    }
});

test('1372 mm is 54.02 in', () => {
    assertClose(lengthFromMm(1372, 'in'), 54.0157, 1e-3, 'in');
});

test('AASHTOWare tandem default 51.6 in is 1310.64 mm', () => {
    assertClose(lengthToMm(51.6, 'in'), 1310.64, 1e-9, 'mm');
});

test('force and pressure conversions round-trip', () => {
    assertClose(forceToKn(forceFromKn(151.2, 'kip'), 'kip'), 151.2, 1e-9, 'kip');
    assertClose(pressureToKpa(pressureFromKpa(827.4, 'psi'), 'psi'), 827.4, 1e-9, 'psi');
});

test('120 psi is 827.4 kPa (the MEPDG default tire pressure)', () => {
    assertClose(pressureToKpa(120, 'psi'), 827.371, 1e-2, 'kPa');
});

test('34 000 lb tandem limit is 151.24 kN', () => {
    assertClose(massToForceKn(34000 * KG_PER_LB), 151.24, 0.01, 'kN');
});

test('80 000 lb is 36 287 kg', () => {
    assertClose(80000 * KG_PER_LB, 36287.4, 0.1, 'kg');
});

test('canonical() converts a data-file quantity', () => {
    assertClose(canonical({ value: 34000, unit: 'lb' }, 'mass'), 15422.14, 0.01, 'kg');
    assertEqual(canonical(null, 'mass'), null, 'null quantity');
});

test('formatLength renders the dual-unit form', () => {
    const S = GROUP_SEPARATOR, U = UNIT_SPACE;
    assertEqual(
        formatLength(1311, 'mm', { precision: 0, alt: 'in', altPrecision: 1 }),
        `1${S}311${U}mm (51.6${U}in)`
    );
    assertEqual(formatLength(1311, 'mm', { precision: 0, unit: false }), `1${S}311`, 'bare number');
    assertEqual(formatLength(null, 'mm'), '—', 'unknown value');
});

test('value/unit and digit-group separators are both non-breaking', () => {
    assertEqual(UNIT_SPACE, '\u202F', 'unit space must be U+202F');
    assertEqual(GROUP_SEPARATOR, '\u202F', 'group separator must be U+202F');
});

test('formatNumber groups thousands with a narrow no-break space', () => {
    const S = GROUP_SEPARATOR;
    assertEqual(S, '\u202F', 'separator must be U+202F, not an ordinary space');
    assertEqual(formatNumber(36287.4, 0), `36${S}287`);
    assertEqual(formatNumber(-1054.25, 2), `-1${S}054.25`);
    assertEqual(formatNumber(999, 0), '999', 'no separator below 1000');
});

/* ============================================================
   3. Determinism
   ============================================================ */

group('3. Deterministic PRNG');

test('same key gives an identical stream', () => {
    const a = new Rng('gear3d-01:tread:11R22.5');
    const b = new Rng('gear3d-01:tread:11R22.5');
    for (let i = 0; i < 200; i++) assertEqual(a.unit(), b.unit(), `draw ${i}`);
});

test('different keys diverge', () => {
    const a = new Rng('seed-a'); const b = new Rng('seed-b');
    let same = 0;
    for (let i = 0; i < 50; i++) if (a.unit() === b.unit()) same++;
    assert(same === 0, 'streams should not coincide');
});

test('draws stay in range', () => {
    const r = rng('range-check');
    for (let i = 0; i < 500; i++) {
        const u = r.unit();
        assert(u >= 0 && u < 1, `unit() out of range: ${u}`);
    }
    const r2 = rng('int-check');
    for (let i = 0; i < 500; i++) {
        const v = r2.int(3, 7);
        assert(v >= 3 && v <= 7 && Number.isInteger(v), `int() out of range: ${v}`);
    }
});

test('shuffle is a permutation and is reproducible', () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = rng('shuffle').shuffle(base.slice());
    const b = rng('shuffle').shuffle(base.slice());
    assertEqual(a.join(','), b.join(','), 'reproducible');
    assertEqual(a.slice().sort((x, y) => x - y).join(','), base.join(','), 'permutation');
});

/* ============================================================
   4. Tire parsing
   ============================================================ */

group('4. Tire designation parsing');

test('metric truck: 445/50R22.5', () => {
    const t = parseTire('445/50R22.5');
    assertEqual(t.family, 'metric', 'family');
    assertEqual(t.sectionWidth, 445, 'section width');
    assertClose(t.rimDiameter, 571.5, 1e-9, 'rim');
    assertClose(t.overallDiameter, 571.5 + 445, 1e-9, 'overall diameter');
    assertEqual(t.complete, true, 'complete');
});

test('metric truck: 295/75R22.5 derives 1014 mm overall diameter', () => {
    const t = parseTire('295/75R22.5');
    assertClose(t.overallDiameter, 571.5 + 2 * 295 * 0.75, 1e-9, 'OD');
    assertClose(t.overallDiameter, 1014.0, 0.001, 'OD');
});

test('passenger prefix is recorded and does not change geometry', () => {
    const p = parseTire('P225/60R16');
    const bare = parseTire('225/60R16');
    assertEqual(p.family, 'passenger', 'family');
    assertEqual(p.servicePrefix, 'P', 'prefix');
    assertClose(p.overallDiameter, bare.overallDiameter, 1e-9, 'OD unaffected');
});

test('inch-nominal 11R22.5 resolves from the size table', () => {
    const t = parseTire('11R22.5');
    assertEqual(t.family, 'inch-nominal', 'family');
    assertEqual(t.complete, true, 'complete');
    assertEqual(t.sectionWidth, 279, 'section width');
    assertEqual(t.overallDiameter, 1054, 'overall diameter');
});

test('inch-nominal is case- and space-insensitive', () => {
    assertEqual(parseTire(' 11r22.5 ').overallDiameter, 1054, 'normalised lookup');
});

test('an inch-nominal size absent from the table is reported unknown, never guessed', () => {
    const t = parseTire('13R22.5');
    assertEqual(t.complete, false, 'complete');
    assertEqual(t.overallDiameter, null, 'overall diameter must be null');
    assert(/not in the size table/.test(t.note || ''), 'explains the gap');
    assertThrows(() => tireGeometry(t), 'geometry must refuse to invent dimensions');
});

test('aircraft inch: H44.5x16.5-21', () => {
    const t = parseTire('H44.5x16.5-21');
    assertEqual(t.family, 'aircraft-inch', 'family');
    assertEqual(t.domain, 'aircraft', 'domain');
    assertEqual(t.servicePrefix, 'H', 'H-series flag');
    assertClose(t.overallDiameter, 44.5 * 25.4, 1e-9, 'OD');
    assertClose(t.sectionWidth, 16.5 * 25.4, 1e-9, 'section');
    assertClose(t.rimDiameter, 21 * 25.4, 1e-9, 'rim');
    assertEqual(t.construction, 'bias', 'construction');
});

test('aircraft inch radial: 52x21.0R22', () => {
    const t = parseTire('52x21.0R22');
    assertEqual(t.construction, 'radial', 'construction');
    assertClose(t.overallDiameter, 1320.8, 1e-9, 'OD');
});

test('aircraft metric: 1400x530R23 is read as millimetres', () => {
    const t = parseTire('1400x530R23');
    assertEqual(t.family, 'aircraft-metric', 'family');
    assertClose(t.overallDiameter, 1400, 1e-9, 'OD in mm');
    assertClose(t.sectionWidth, 530, 1e-9, 'section in mm');
    assertClose(t.rimDiameter, 23 * 25.4, 1e-9, 'rim still in inches');
});

test('aircraft nose tire: 27x7.75-15', () => {
    const t = parseTire('27x7.75-15');
    assertClose(t.overallDiameter, 685.8, 1e-9, 'OD');
    assertClose(t.sectionWidth, 196.85, 1e-9, 'section');
});

test('garbage designations throw rather than returning nonsense', () => {
    for (const bad of ['', 'hello', '22.5', 'R22.5', '445//50R22.5']) {
        assertThrows(() => parseTire(bad), `should reject "${bad}"`);
    }
});

test('every preset designation in tires.json parses and is complete', () => {
    const presets = [...tireTable.presets.truck, ...tireTable.presets.aircraft];
    for (const p of presets) {
        const r = checkTire(p.designation);
        assert(r.ok, `${p.designation}: ${r.reason}`);
    }
});

test('static loaded radius: radius-ratio model', () => {
    const t = resolveTire('11R22.5');
    assertClose(t.geometry.freeRadius, 527, 1e-9, 'free radius');
    assertClose(t.geometry.staticLoadedRadius, 527 * 0.97, 1e-9, 'SLR at default 0.97');
});

test('static loaded radius: section-deflection model matches the TRA form', () => {
    const spec = parseTire('H44.5x16.5-21');
    const g = tireGeometry(spec, { model: 'sectionDeflection', sectionDeflection: 0.32 });
    const expected = g.freeRadius - 0.32 * g.sectionHeight;
    assertClose(g.staticLoadedRadius, expected, 1e-9, 'SLR');
    assert(g.staticLoadedRadius < g.freeRadius, 'must be less than free radius');
});

/* ============================================================
   5. Contact patch
   ============================================================ */

group('5. Contact patch models');

test('area = load / pressure, in consistent units', () => {
    // 75.6 kN at 827.4 kPa -> 0.09137 m^2 -> 91 370 mm^2
    assertClose(contactArea(75.6, 827.4), (75.6 / 827.4) * 1e6, 1e-6, 'mm^2');
    assertClose(contactArea(75.6, 827.4), 91370.6, 0.1, 'mm^2');
});

test('rectangular patch conserves area', () => {
    const p = rectangularPatch(75.6, 827.4, 279);
    assertClose(p.length * p.width, p.area, 1e-6, 'length x width');
    assertClose(p.width, 279 * 0.85, 1e-9, 'width ratio');
});

test('Huang patch reproduces A = 0.5227 L^2 and width 0.6 L', () => {
    const p = huangPatch(75.6, 827.4);
    assertClose(p.area, HUANG_K * p.length * p.length, 1e-6, 'A = 0.5227 L^2');
    assertClose(p.width, 0.6 * p.length, 1e-9, 'width = 0.6 L');
    // and the shape's own area, computed from its parts, must agree
    const r = p.width / 2;
    const geometric = Math.max(0, p.length - 2 * r) * p.width + Math.PI * r * r;
    assertClose(geometric, p.area, 1e-6, 'rectangle + two semicircles');
});

test('elliptical patch conserves area', () => {
    const p = ellipticalPatch(75.6, 827.4, 279);
    assertClose((Math.PI / 4) * p.length * p.width, p.area, 1e-6, 'pi/4 a b');
});

test('all three models give the same area for the same load and pressure', () => {
    const a = rectangularPatch(75.6, 827.4, 279).area;
    const b = huangPatch(75.6, 827.4).area;
    const c = ellipticalPatch(75.6, 827.4, 279).area;
    assertClose(a, b, 1e-6, 'rect vs huang');
    assertClose(a, c, 1e-6, 'rect vs ellipse');
});

test('patch outlines close and match their nominal extents', () => {
    for (const p of [rectangularPatch(75.6, 827.4, 279), huangPatch(75.6, 827.4), ellipticalPatch(75.6, 827.4, 279)]) {
        const pts = patchOutline(p, 32);
        assert(pts.length >= 4, `${p.model}: too few points`);
        const maxX = Math.max(...pts.map((q) => q.x));
        const maxY = Math.max(...pts.map((q) => q.y));
        assertClose(maxX, p.length / 2, 1e-6, `${p.model} half length`);
        assertClose(maxY, p.width / 2, 1e-6, `${p.model} half width`);
    }
});

test('polygon area of the outline agrees with the reported area', () => {
    for (const p of [rectangularPatch(75.6, 827.4, 279), ellipticalPatch(75.6, 827.4, 279)]) {
        const pts = patchOutline(p, 256);
        let a2 = 0;
        for (let i = 0; i < pts.length; i++) {
            const q = pts[i], r = pts[(i + 1) % pts.length];
            a2 += q.x * r.y - r.x * q.y;
        }
        const polyArea = Math.abs(a2) / 2;
        // discretised curves under-report slightly; 0.1 % is ample at 256 segments
        assertClose(polyArea / p.area, 1, 1e-3, `${p.model} discretised area`);
    }
});

test('override back-computes the implied pressure', () => {
    const p = rectangularPatch(75.6, 827.4, 279);
    const o = overridePatch(p, { length: 300, width: 250 });
    assertEqual(o.overridden, true, 'flagged');
    assertClose(o.area, 75000, 1e-9, 'area');
    assertClose(o.pressure, (75.6 / 75000) * 1e6, 1e-6, 'implied pressure');
    assertClose(o.pressure * o.area / 1e6, o.load, 1e-9, 'load is conserved');
});

test('equivalent circular radius matches the area', () => {
    const p = huangPatch(75.6, 827.4);
    const r = equivalentRadius(p.area);
    assertClose(Math.PI * r * r, p.area, 1e-6, 'pi r^2');
});

test('zero or negative inputs give zero area rather than NaN', () => {
    assertEqual(contactArea(0, 827.4), 0, 'zero load');
    assertEqual(contactArea(75.6, 0), 0, 'zero pressure');
    assertEqual(contactArea(-5, 827.4), 0, 'negative load');
});

/* ============================================================
   6. Schema and provenance
   ============================================================ */

group('6. Schema and data provenance');

test('the truck library loads and covers all 13 FHWA classes', () => {
    assert(truckUnits.length >= 13, `only ${truckUnits.length} units`);
    const classes = new Set(truckUnits.map((u) => u.classification.class));
    for (let c = 1; c <= 13; c++) assert(classes.has(c), `class ${c} missing`);
});

test('classes 8-13 each have at least one unit, with variants where required', () => {
    const byClass = new Map();
    for (const u of truckUnits) {
        const c = u.classification.class;
        byClass.set(c, (byClass.get(c) || 0) + 1);
    }
    for (let c = 8; c <= 13; c++) assert((byClass.get(c) || 0) >= 1, `class ${c} has no unit`);
    assert((byClass.get(8) || 0) >= 2, 'class 8 should have variants');
    assert((byClass.get(9) || 0) >= 2, 'class 9 should have variants');
});

test('every unit passes structural validation', () => {
    const r = validateLibrary(allUnits);
    assert(r.ok, 'validation errors:\n        ' + r.errors.join('\n        '));
});

test('every unit declares the current schema version', () => {
    for (const u of allUnits) assertEqual(u.schemaVersion, SCHEMA_VERSION, `${u.id} schemaVersion`);
});

test('PROVENANCE: every axle and gear carries a source', () => {
    const missing = [];
    for (const u of allUnits) {
        for (const a of u.axles || []) if (!a.source || !a.source.trim()) missing.push(`${u.id}/${a.id}`);
        for (const g of u.gears || []) if (!g.source || !g.source.trim()) missing.push(`${u.id}/${g.id}`);
    }
    assert(missing.length === 0, 'no source on: ' + missing.join(', '));
});

test('PROVENANCE: every stated load, GVW, MTOW and pressure carries a basis', () => {
    const missing = [];
    const checkQ = (where, q) => {
        if (q == null) return;
        if (!q.basis || !q.basis.trim()) missing.push(where);
    };
    for (const u of allUnits) {
        checkQ(`${u.id}.gvw`, u.gvw);
        checkQ(`${u.id}.mtow`, u.mtow);
        checkQ(`${u.id}.tirePressure`, u.tirePressure);
        for (const a of u.axles || []) checkQ(`${u.id}/${a.id}.load`, a.load);
        for (const g of u.gears || []) checkQ(`${u.id}/${g.id}.load`, g.load);
    }
    assert(missing.length === 0, 'no basis on: ' + missing.join(', '));
});

test('PROVENANCE: every unit cites at least one source document', () => {
    for (const u of allUnits) {
        assert(Array.isArray(u.sources) && u.sources.length > 0, `${u.id} has no sources[]`);
        for (const s of u.sources) {
            assert(s.title && s.title.trim(), `${u.id} has a source with no title`);
            assert(s.publisher && s.publisher.trim(), `${u.id} source "${s.title}" has no publisher`);
        }
    }
});

test('PROVENANCE: every multi-axle group cites the basis for its spacing', () => {
    const missing = [];
    for (const u of truckUnits) {
        for (const g of u.axleGroups || []) {
            if ((g.axles || []).length > 1 && !(g.source && g.source.trim())) missing.push(`${u.id}/${g.id}`);
        }
    }
    assert(missing.length === 0, 'no spacing source on: ' + missing.join(', '));
});

test('every tire designation used in the library resolves to real dimensions', () => {
    const bad = [];
    for (const u of allUnits) {
        for (const a of u.axles || []) {
            const r = checkTire(a.tire);
            if (!r.ok) bad.push(`${u.id}/${a.id} "${a.tire}": ${r.reason}`);
        }
        for (const g of u.gears || []) {
            const r = checkTire(g.tire);
            if (!r.ok) bad.push(`${u.id}/${g.id} "${g.tire}": ${r.reason}`);
        }
    }
    assert(bad.length === 0, bad.join('\n        '));
});

test('the validator actually rejects a missing source (negative control)', () => {
    const good = JSON.parse(JSON.stringify(truckUnits.find((u) => u.id === 'fhwa-c09-3S2')));
    assert(validateUnit(good).ok, 'control unit should be valid to begin with');
    const bad = JSON.parse(JSON.stringify(good));
    delete bad.axles[2].source;
    const r = validateUnit(bad);
    assert(!r.ok, 'validator must fail when an axle loses its source');
    assert(r.errors.some((e) => /no source/.test(e)), 'error should name the missing source');
});

test('the validator rejects an axle group whose type contradicts its axle count', () => {
    const bad = JSON.parse(JSON.stringify(truckUnits.find((u) => u.id === 'fhwa-c09-3S2')));
    bad.axleGroups[1].type = 'tridem';
    assert(!validateUnit(bad).ok, 'tridem with two axles must fail');
});

test('tire counting handles STA, DTA and single-wheel-position axles', () => {
    assertEqual(tiresOnAxle({ tireConfig: 'STA' }), 2, 'STA');
    assertEqual(tiresOnAxle({ tireConfig: 'DTA' }), 4, 'DTA');
    assertEqual(tiresOnAxle({ tireConfig: 'WBT' }), 2, 'WBT');
    assertEqual(tiresOnAxle({ tireConfig: 'STA', wheelPositions: 1 }), 1, 'motorcycle');
    const c9 = truckUnits.find((u) => u.id === 'fhwa-c09-3S2');
    assertEqual(tireCount(c9), 18, 'class 9 has 18 tires');
    const c13 = truckUnits.find((u) => u.id === 'fhwa-c13-3S2-4-turnpike');
    assertEqual(tireCount(c13), 34, 'class 13 turnpike double has 34 tires');
});

/* ============================================================
   7. Class 9 regression — the reference case
   ============================================================ */

group('7. Class 9 3-S2 regression');

const c9 = truckUnits.find((u) => u.id === 'fhwa-c09-3S2');

test('the reference unit exists and is flagged as such', () => {
    assert(c9, 'fhwa-c09-3S2 not found');
    assertEqual(c9.classification.class, 9, 'class');
    assertEqual(c9.designation, '3-S2', 'designation');
    assertEqual(c9.reference, true, 'reference flag');
});

test('axle positions match the expected layout exactly', () => {
    const expected = [
        ['A1', 'steer', 0],
        ['A2', 'drive', 5486],
        ['A3', 'drive', 6797],
        ['A4', 'trailer', 16200],
        ['A5', 'trailer', 17511]
    ];
    assertEqual(c9.axles.length, 5, 'axle count');
    expected.forEach(([id, role, x], i) => {
        assertEqual(c9.axles[i].id, id, `axle ${i} id`);
        assertEqual(c9.axles[i].role, role, `axle ${i} role`);
        assertEqual(c9.axles[i].x, x, `axle ${i} x`);
    });
});

test('track widths and dual spacings match', () => {
    assertEqual(c9.axles[0].trackWidth, 2032, 'steer track');
    assertEqual(c9.axles[0].tireConfig, 'STA', 'steer config');
    assertEqual(c9.axles[0].dualSpacing, null, 'steer has no dual spacing');
    for (let i = 1; i < 5; i++) {
        assertEqual(c9.axles[i].trackWidth, 1829, `axle ${i} track`);
        assertEqual(c9.axles[i].tireConfig, 'DTA', `axle ${i} config`);
        assertEqual(c9.axles[i].dualSpacing, 330, `axle ${i} dual spacing`);
        assertEqual(c9.axles[i].tire, '11R22.5', `axle ${i} tire`);
    }
});

test('both tandem groups use the AASHTOWare default spacing of 51.6 in', () => {
    const tandems = c9.axleGroups.filter((g) => g.type === 'tandem');
    assertEqual(tandems.length, 2, 'two tandem groups');
    for (const g of tandems) {
        assertEqual(g.spacing, 1311, `${g.id} spacing`);
        assertClose(lengthFromMm(g.spacing, 'in'), 51.6, 0.02, `${g.id} in inches`);
    }
    assertEqual(c9.axles[2].x - c9.axles[1].x, 1311, 'drive tandem spacing matches the group');
    assertEqual(c9.axles[4].x - c9.axles[3].x, 1311, 'trailer tandem spacing matches the group');
});

test('the 12/34/34 kip axle split sums to the 80 000 lb legal gross', () => {
    const lb = c9.axles.map((a) => knToLb(a.load.value));
    assertClose(lb[0], 12000, 15, 'steer');
    assertClose(lb[1] + lb[2], 34000, 25, 'drive tandem');
    assertClose(lb[3] + lb[4], 34000, 25, 'trailer tandem');
    assertClose(lb.reduce((s, v) => s + v, 0), 80000, 50, 'gross');
    assertClose(c9.gvw.value, 36287, 1, 'gvw in kg');
});

test('geometry is self-consistent: overall width stays inside the 102 in federal limit', () => {
    for (const a of c9.axles) {
        const t = resolveTire(a.tire);
        const outer = a.trackWidth / 2
            + (a.tireConfig === 'DTA' ? a.dualSpacing / 2 : 0)
            + t.geometry.sectionWidth / 2;
        const overall = 2 * outer;
        assert(overall <= 2591, `${a.id} overall width ${overall.toFixed(0)} mm exceeds 2591 mm`);
    }
});

/* ============================================================
   8. Federal Bridge Formula
   ============================================================ */

group('8. Federal Bridge Formula');

test('the formula reproduces the statutory 34 000 lb tandem threshold', () => {
    // The bridge formula is exactly why the tandem limit is 34 000 lb: a
    // two-axle group spanning 4 ft is allowed precisely 34 000 lb, and less
    // if it is closer. Real tandems sit just over 4 ft for this reason.
    assertClose(bridgeAllowanceLb(4, 2), 34000, 1e-9, '4 ft tandem');
    assertClose(bridgeAllowanceLb(3, 2), 33000, 1e-9, '3 ft tandem');
    // The library's 1311 mm (51.6 in = 4.30 ft) tandem clears 34 000 lb.
    assert(bridgeAllowanceLb(1311 / MM_PER_FT, 2) > 34000,
        'the AASHTOWare default tandem spacing must permit a full 34 000 lb group');
});

test('the formula reproduces the 51 ft / five-axle / 80 000 lb threshold', () => {
    assertClose(bridgeAllowanceLb(51.2, 5), 80000, 25, '51.2 ft, 5 axles');
});

test('minimumSpreadMm inverts the formula', () => {
    for (const [w, n] of [[68000, 4], [80000, 5], [42000, 3]]) {
        const mm = minimumSpreadMm(w, n);
        assertClose(bridgeAllowanceLb(mm / MM_PER_FT, n), w, 1e-6, `${w} lb on ${n} axles`);
    }
});

test('every unit that claims compliance actually complies, over every axle subset', () => {
    const failures = [];
    for (const u of truckUnits) {
        const mode = u.federalBridgeFormula
            ?? (u.classification.class >= 5 ? 'compliant' : 'n/a');
        if (mode !== 'compliant') continue;
        const r = checkBridgeFormula(u);
        if (!r.ok) {
            const detail = r.violations
                .map((v) => `${v.from}-${v.to} (${v.axles} axles, ${v.lengthFt.toFixed(1)} ft): `
                    + `${v.loadLb.toFixed(0)} lb vs ${v.allowedLb.toFixed(0)} allowed`)
                .join('; ');
            failures.push(`${u.id}: ${detail || `gross ${r.grossLb.toFixed(0)} lb`}`);
        }
    }
    assert(failures.length === 0, failures.join('\n        '));
});

test('the class 9 reference clears the binding A2-A5 subset with margin', () => {
    const r = checkBridgeFormula(c9);
    assert(r.ok, 'class 9 must be compliant');
    const spreadFt = (c9.axles[4].x - c9.axles[1].x) / MM_PER_FT;
    const allowed = bridgeAllowanceLb(spreadFt, 4);
    const carried = knToLb(c9.axles[1].load.value) + knToLb(c9.axles[2].load.value)
        + knToLb(c9.axles[3].load.value) + knToLb(c9.axles[4].load.value);
    assert(allowed > carried, `A2-A5 allowance ${allowed.toFixed(0)} must exceed ${carried.toFixed(0)}`);
    assert(allowed - carried > 100, `margin is only ${(allowed - carried).toFixed(0)} lb; too tight to be robust`);
});

test('units flagged permit or exempt are not silently claimed as compliant', () => {
    const c13 = truckUnits.find((u) => u.id === 'fhwa-c13-3S2-4-turnpike');
    assertEqual(c13.federalBridgeFormula, 'permit', 'class 13 must declare permit status');
    const r = checkBridgeFormula(c13);
    assert(!r.ok, 'the turnpike double genuinely does not meet the federal formula — '
        + 'if this ever passes, the declared loads or geometry have drifted');
    assert(/permit/i.test(c13.gvw.basis), 'the GVW basis must say so in plain words');
});

/* ============================================================
   9. Data files are well-formed
   ============================================================ */

group('9. Data files');

test('every JSON file under src/data parses', () => {
    /** @param {string} dir */
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.json')) {
                try { JSON.parse(readFileSync(p, 'utf8')); }
                catch (err) { throw new Error(`${p}: ${/** @type {Error} */(err).message}`); }
            }
        }
    };
    walk(DATA);
});

test('the truck manifest lists every class and every file resolves', () => {
    assertEqual(truckIndex.classes.length, 13, 'thirteen classes');
    for (const f of truckIndex.files) {
        const file = readJson(join(DATA, 'trucks', f));
        assert(Array.isArray(file.units) && file.units.length > 0, `${f} has no units`);
    }
});

test('unit ids are unique across the whole library', () => {
    const seen = new Set();
    for (const u of allUnits) {
        assert(!seen.has(u.id), `duplicate unit id ${u.id}`);
        seen.add(u.id);
    }
});

test('the inch-nominal tire table carries a source and a confidence for every entry', () => {
    for (const [k, v] of Object.entries(tireTable.nominal)) {
        assert(v.source && v.source.trim(), `${k} has no source`);
        assert(['high', 'medium', 'low'].includes(v.confidence), `${k} has no confidence rating`);
        assert(v.sectionWidth > 0 && v.overallDiameter > v.sectionWidth, `${k} dimensions look wrong`);
    }
});

/* ============================================================
   10. Layout resolver
   ============================================================ */

group('10. Layout resolver');

const c9layout = resolveLayout(c9);

test('the class 9 resolves to 18 tires on 5 axles', () => {
    assertEqual(c9layout.wheels.length, 18, 'wheels');
    assertEqual(c9layout.axles.length, 5, 'axles');
    assertEqual(c9layout.domain, 'truck', 'domain');
});

test('the steer axle carries one tire per side, on the track centreline', () => {
    const steer = c9layout.wheels.filter((w) => w.axleId === 'A1');
    assertEqual(steer.length, 2, 'steer tires');
    assertClose(steer.find((w) => w.side === 'L').y, -1016, 1e-9, 'left');
    assertClose(steer.find((w) => w.side === 'R').y, 1016, 1e-9, 'right');
});

test('dual pairs straddle the wheel position by half the dual spacing', () => {
    const right = c9layout.wheels.filter((w) => w.axleId === 'A2' && w.side === 'R');
    assertEqual(right.length, 2, 'two tires');
    const ys = right.map((w) => w.y).sort((a, b) => a - b);
    assertClose(ys[0], 1829 / 2 - 165, 1e-9, 'inner tire');
    assertClose(ys[1], 1829 / 2 + 165, 1e-9, 'outer tire');
    assertClose(ys[1] - ys[0], 330, 1e-9, 'centre-to-centre equals the dual spacing');
});

test('the dual pair is symmetric about the vehicle centreline', () => {
    const left = c9layout.wheels.filter((w) => w.axleId === 'A2' && w.side === 'L').map((w) => w.y).sort((a, b) => a - b);
    const right = c9layout.wheels.filter((w) => w.axleId === 'A2' && w.side === 'R').map((w) => w.y).sort((a, b) => a - b);
    assertClose(left[0], -right[1], 1e-9, 'outermost mirror');
    assertClose(left[1], -right[0], 1e-9, 'innermost mirror');
});

test('dual wheels are mounted back to back, so their discs face each other', () => {
    for (const side of ['L', 'R']) {
        const pair = c9layout.wheels.filter((w) => w.positionId === `A2-${side}`);
        assertEqual(pair.length, 2, `${side} pair size`);
        const inner = pair.find((w) => w.id.endsWith('-in'));
        const outer = pair.find((w) => w.id.endsWith('-out'));
        assertEqual(inner.discSign, -outer.discSign, `${side}: the two discs must be opposed`);
        // Each disc faces the other tire of its own pair.
        assertEqual(Math.sign(outer.y - inner.y), inner.discSign, `${side} inner faces outward-of-pair`);
        assertEqual(Math.sign(inner.y - outer.y), outer.discSign, `${side} outer faces inward-of-pair`);
    }
});

test('the two sides of an axle are mirror images of each other', () => {
    const l = c9layout.wheels.filter((w) => w.positionId === 'A2-L');
    const r = c9layout.wheels.filter((w) => w.positionId === 'A2-R');
    const byRole = (list, suffix) => list.find((w) => w.id.endsWith(suffix));
    assertEqual(byRole(l, '-in').discSign, -byRole(r, '-in').discSign, 'inner tires mirror');
    assertEqual(byRole(l, '-out').discSign, -byRole(r, '-out').discSign, 'outer tires mirror');
});

test('a single-tire axle faces its disc outboard, away from the centreline', () => {
    const steer = c9layout.wheels.filter((w) => w.axleId === 'A1');
    for (const w of steer) {
        assertEqual(w.discSign, Math.sign(w.y), `${w.id} must face away from the centreline`);
    }
});

test('every wheel carries a valid handedness', () => {
    for (const u of truckUnits) {
        for (const w of resolveLayout(u).wheels) {
            assert(w.discSign === 1 || w.discSign === -1,
                `${u.id}/${w.id} has discSign ${w.discSign}`);
        }
    }
});

test('every tire centre sits at its own static loaded radius, so it touches z = 0', () => {
    for (const w of c9layout.wheels) {
        assertClose(w.z, w.geometry.staticLoadedRadius, 1e-9, `${w.id} centre height`);
        assert(w.z > 0, `${w.id} must be above the pavement`);
    }
});

test('axle load is divided equally over the tires on that axle', () => {
    const a2 = c9layout.axles.find((a) => a.id === 'A2');
    const tires = c9layout.wheels.filter((w) => w.axleId === 'A2');
    assertEqual(tires.length, 4, 'four tires on a DTA axle');
    const sum = tires.reduce((s, w) => s + w.loadKn, 0);
    assertClose(sum, a2.loadKn, 1e-9, 'tire loads sum to the axle load');
    for (const w of tires) assertClose(w.loadKn, a2.loadKn / 4, 1e-9, `${w.id}`);
});

test('derived dimensions agree with the source data', () => {
    const d = c9layout.derived;
    assertEqual(d.tireCount, 18, 'tire count');
    assertEqual(d.outerBridge, 17511, 'outer bridge');
    assertEqual(d.axleSpacings.length, 4, 'four gaps');
    assertEqual(d.axleSpacings[0].value, 5486, 'A1-A2');
    assertEqual(d.axleSpacings[1].value, 1311, 'A2-A3');
    assertEqual(d.axleSpacings[2].value, 9403, 'A3-A4');
    assertEqual(d.axleSpacings[3].value, 1311, 'A4-A5');
    // Overall width is taken over the WIDEST axle, which is a drive/trailer
    // axle (1829 track + 330 dual + 279 section = 2438), not the steer axle
    // (2032 + 279 = 2311).
    assertClose(d.overallWidth, 1829 + 330 + 279, 1, 'overall width over the widest axle');
    assert(d.overallWidth <= 2591, 'must stay within the 102 in federal width limit');
});

test('every unit in the library resolves without throwing', () => {
    for (const u of truckUnits) {
        const l = resolveLayout(u);
        assert(l.wheels.length > 0, `${u.id} produced no wheels`);
        assertEqual(l.wheels.length, tireCount(u), `${u.id} wheel count disagrees with tireCount()`);
    }
});

test('the class 1 motorcycle resolves to one wheel per axle on the centreline', () => {
    const moto = resolveLayout(truckUnits.find((u) => u.classification.class === 1));
    assertEqual(moto.wheels.length, 2, 'two wheels');
    for (const w of moto.wheels) {
        assertEqual(w.y, 0, 'on the centreline');
        assertEqual(w.side, 'C', 'centre');
    }
});

/* ============================================================
   11. Wide-base swap
   ============================================================ */

group('11. Wide-base tire swap');

test('the swap holds the outer tire edge, which moves the load centroid outboard', () => {
    const a2 = structuredClone(c9.axles[1]);
    const { axle, report } = swapToWideBase(a2, '445/50R22.5');

    const before = resolveTire('11R22.5');
    const after = resolveTire('445/50R22.5');
    const outerEdgeBefore = a2.trackWidth / 2 + a2.dualSpacing / 2 + before.geometry.sectionWidth / 2;
    const outerEdgeAfter = axle.trackWidth / 2 + after.geometry.sectionWidth / 2;

    assertClose(outerEdgeAfter, outerEdgeBefore, 0.06, 'outer edge is held');
    assertEqual(axle.tireConfig, 'WBT', 'config');
    assertEqual(axle.dualSpacing, null, 'a wide-base single has no dual spacing');
    assertEqual(report.tiresBefore, 4, 'tires before');
    assertEqual(report.tiresAfter, 2, 'tires after');

    // Holding the outer edge WIDENS the track, and that is the physically
    // correct consequence rather than a bug. The outer tire of a dual pair
    // sits half a dual spacing outboard of the pair's centreline, so its
    // centre is much further out than the pair's. A single wide tire whose
    // outer edge lands in the same place has its centre only half its own
    // section inboard of that edge — further outboard than the pair's
    // centreline was. The load centroid therefore moves outboard, which is
    // exactly the effect a wide-base retrofit study needs reported.
    assert(axle.trackWidth > a2.trackWidth,
        `track should widen: ${a2.trackWidth} -> ${axle.trackWidth}`);
    assert(report.loadCentroidShift > 0, 'centroid shift must be reported as outboard');
    assertClose(report.loadCentroidShift, (axle.trackWidth - a2.trackWidth) / 2, 1e-6, 'shift magnitude');
});

test('the swap does not change the vehicle overall width', () => {
    const a2 = structuredClone(c9.axles[1]);
    const { axle } = swapToWideBase(a2, '445/50R22.5');
    const width = (ax) => {
        const t = resolveTire(ax.tire);
        return 2 * (ax.trackWidth / 2 + (ax.dualSpacing ? ax.dualSpacing / 2 : 0) + t.geometry.sectionWidth / 2);
    };
    assertClose(width(axle), width(a2), 0.12, 'overall width');
});

test('the swap refuses a non-dual axle rather than producing nonsense', () => {
    assertThrows(() => swapToWideBase(structuredClone(c9.axles[0]), '445/50R22.5'),
        'a steer STA axle must be rejected');
});

test('the swap carries the original citation forward and records what changed', () => {
    const { axle } = swapToWideBase(structuredClone(c9.axles[1]), '445/50R22.5');
    assert(axle.source.includes('wide-base retrofit'), 'source must record the retrofit');
    assert(axle.source.includes(c9.axles[1].tire), 'source must name the tire it replaced');
    assert(validateUnit({ ...structuredClone(c9), axles: [c9.axles[0], axle, ...c9.axles.slice(2)] }).ok,
        'the swapped unit must still validate');
});

/* ============================================================
   12. Contact patches over a whole unit
   ============================================================ */

group('12. Contact patches over a unit');

test('patches are produced for every tire', () => {
    const p = computePatches(c9layout, c9, { model: 'rectangular' });
    assertEqual(p.length, 18, 'one patch per tire');
    for (const rec of p) {
        assert(rec.patch.area > 0, `${rec.tireId} has no area`);
        assertClose(rec.patch.pressure, rec.inflationKpa, 1e-6, `${rec.tireId} pressure`);
    }
});

test('total patch load equals the vehicle gross weight', () => {
    const p = computePatches(c9layout, c9, { model: 'rectangular' });
    const t = patchTotals(p);
    const axleSum = c9.axles.reduce((s, a) => s + a.load.value, 0);
    assertClose(t.totalLoadKn, axleSum, 1e-6, 'patch loads sum to the axle loads');
    assertClose(knToLb(t.totalLoadKn), 80000, 50, 'and to the 80 000 lb legal gross');
});

test('total area is load divided by pressure, whichever shape is used', () => {
    for (const model of ['rectangular', 'huang', 'elliptical']) {
        const t = patchTotals(computePatches(c9layout, c9, { model, inflationKpa: 827.371 }));
        assertClose(t.meanPressureKpa, 827.371, 1e-6, `${model} mean pressure`);
    }
});

test('the default inflation pressure is the AASHTOWare default of 120 psi', () => {
    assertClose(DEFAULT_INFLATION_KPA, 827.371, 1e-3, 'kPa');
    assertClose(DEFAULT_INFLATION_KPA / 6.894757293168361, 120, 1e-3, 'psi');
});

test('a wide-base swap redistributes contact area without inventing any', () => {
    const swapped = structuredClone(c9);
    swapped.axles[1] = swapToWideBase(structuredClone(c9.axles[1]), '445/50R22.5').axle;
    const before = patchTotals(computePatches(c9layout, c9, { model: 'rectangular' }));
    const after = patchTotals(computePatches(resolveLayout(swapped), swapped, { model: 'rectangular' }));
    assertClose(after.totalAreaMm2, before.totalAreaMm2, 1e-6,
        'at equal load and pressure the TOTAL area cannot change — only its distribution');
    assertEqual(after.tires, before.tires - 2, 'two tires fewer');
});

/* ============================================================
   12b. Measurement snapping
   ============================================================ */

group('12b. Measurement snapping');

const snaps = buildSnapPoints(c9layout);

test('every wheel and axle contributes snap targets', () => {
    const kinds = new Set(snaps.map((s) => s.kind));
    for (const k of ['tire-centre', 'tire-edge', 'contact', 'axle-centreline', 'axle-end']) {
        assert(kinds.has(k), `no ${k} targets`);
    }
    // One centre per tire.
    assertEqual(snaps.filter((s) => s.kind === 'tire-centre').length, 18, 'tire centres');
});

test('contact targets sit exactly on the pavement', () => {
    for (const s of snaps.filter((x) => x.kind === 'contact')) {
        assertEqual(s.point.z, 0, `${s.id} must be at z = 0`);
    }
});

test('tire edge targets are half a section width from the centre', () => {
    const w = c9layout.wheels.find((x) => x.id === 'A2-R-out');
    const edges = snaps.filter((s) => s.ownerId === w.id && s.kind === 'tire-edge');
    assertEqual(edges.length, 2, 'two edges');
    const ys = edges.map((e) => e.point.y).sort((a, b) => a - b);
    assertClose(ys[1] - ys[0], w.geometry.sectionWidth, 1e-9, 'edge separation is the section width');
});

test('coincident targets are deduplicated, keeping the more meaningful one', () => {
    // A motorcycle axle has zero track, so its ends land on its centreline.
    const moto = resolveLayout(truckUnits.find((u) => u.classification.class === 1));
    const pts = buildSnapPoints(moto);
    const seen = new Set();
    for (const p of pts) {
        const key = `${Math.round(p.point.x)}|${Math.round(p.point.y)}|${Math.round(p.point.z)}`;
        assert(!seen.has(key), `duplicate target at ${key}`);
        seen.add(key);
    }
    assertEqual(pts.filter((p) => p.kind === 'axle-end').length, 0,
        'zero-track axles must not emit end targets');
});

test('hidden wheels contribute no snap targets', () => {
    const only = buildSnapPoints(c9layout, { visible: (w) => w.axleId === 'A2' });
    assert(only.every((s) => s.ownerId.startsWith('A2')), 'only A2 targets');
    assert(only.length > 0 && only.length < snaps.length, 'a strict subset');
});

test('nearestSnapPoint finds the target under the cursor', () => {
    // Fake projector: engineering x,y -> screen, scaled down.
    const project = (p) => ({ x: p.x / 10, y: -p.z / 10 + 200, behind: false });
    const target = snaps.find((s) => s.kind === 'tire-centre' && s.ownerId === 'A1-R');
    const s = project(target.point);
    const hit = nearestSnapPoint(snaps, project, s.x, s.y, 26);
    assert(hit, 'expected a hit');
    assertClose(hit.distance, 0, 1e-6, 'exact hit distance');
});

test('nearestSnapPoint returns null outside the pick radius', () => {
    const project = (p) => ({ x: p.x / 10, y: -p.z / 10 + 200, behind: false });
    assertEqual(nearestSnapPoint(snaps, project, 99999, 99999, 26), null, 'far away');
});

test('nearestSnapPoint ignores targets behind the camera', () => {
    const project = () => ({ x: 10, y: 10, behind: true });
    assertEqual(nearestSnapPoint(snaps, project, 10, 10, 26), null, 'all behind');
});

test('a near-tie prefers the more meaningful target', () => {
    /** @type {any[]} */
    const pair = [
        { id: 'edge', kind: 'tire-edge', label: 'edge', point: { x: 0, y: 0, z: 0 }, ownerId: 'w', priority: 4 },
        { id: 'centre', kind: 'tire-centre', label: 'centre', point: { x: 1, y: 0, z: 0 }, ownerId: 'w', priority: 6 }
    ];
    // The edge is marginally nearer, but within the tie window.
    const project = (p) => ({ x: p.x, y: p.y, behind: false });
    const hit = nearestSnapPoint(pair, project, 0, 0, 26);
    assertEqual(hit.snap.id, 'centre', 'the centre should win a near-tie');
});

test('inferAxis recognises axis-aligned measurements and diagonals', () => {
    assertEqual(inferAxis({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }), 'x', 'pure x');
    assertEqual(inferAxis({ x: 0, y: 0, z: 0 }, { x: 0, y: -250, z: 0 }), 'y', 'pure y');
    assertEqual(inferAxis({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 520 }), 'z', 'pure z');
    assertEqual(inferAxis({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 0 }), 'free', 'diagonal');
    assertEqual(inferAxis({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }), 'free', 'degenerate');
});

test('a dimension built from two snaps measures the true distance', () => {
    const a = snaps.find((s) => s.kind === 'tire-centre' && s.ownerId === 'A1-L');
    const b = snaps.find((s) => s.kind === 'tire-centre' && s.ownerId === 'A1-R');
    const d = dimensionFromSnaps(a, b);
    assertEqual(d.set, 'custom', 'set');
    assertEqual(d.axis, 'y', 'a track measurement is transverse');
    assertClose(dimensionValue(d), 2032, 1e-6, 'steer track');
    assert(d.note.includes('tire centre'), 'note records what was measured');
    assert(d.offset !== 0, 'must stand off the feature');
});

test('a diagonal measurement is marked free so it can be offset perpendicular', () => {
    const a = snaps.find((s) => s.kind === 'contact' && s.ownerId === 'A1-L');
    const b = snaps.find((s) => s.kind === 'tire-centre' && s.ownerId === 'A5-R-out');
    const d = dimensionFromSnaps(a, b);
    assertEqual(d.axis, 'free', 'not axis aligned');
    const expected = Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y, b.point.z - a.point.z);
    assertClose(dimensionValue(d), expected, 1e-6, 'true 3D distance');
});

test('every snap target of the whole library projects to a finite point', () => {
    // Guards against a NaN leaking in from a degenerate geometry and
    // poisoning the picker for a whole unit.
    for (const u of [...truckUnits, ...aircraftUnits]) {
        for (const s of buildSnapPoints(resolveLayout(u))) {
            assert(Number.isFinite(s.point.x) && Number.isFinite(s.point.y) && Number.isFinite(s.point.z),
                `${u.id}/${s.id} has a non-finite coordinate`);
        }
    }
});

/* ============================================================
   12b-ii. Project round trip
   ============================================================ */

group('12b-ii. Project round trip');

test('EVERY view flag survives save and reopen', () => {
    // This exists because it did not. serializeProject re-listed the view
    // fields, so anything added afterwards was written by the caller and
    // dropped by the writer — the grid and annotation toggles came back on
    // after reopening a project that had them off. A whitelist nobody
    // remembers to update is worse than no whitelist.
    const view = {
        mode: 'plan',
        camera: { mode: 'plan', fov: 35, states: {} },
        lighting: { preset: 'daylight', keyIntensity: 3.4 },
        background: 'color', backgroundColor: '#101820',
        unitSystem: 'US', precision: 2, dualUnits: true,
        dimensionSets: ['transverse', 'custom'],
        showCallouts: true, showScaleBar: false,
        annotations: false, showGrid: false,
        materials: { rubberTread: { tint: '#ff3333', roughness: 0.7 } },
        isolation: { level: 'axle', targetId: 'A2', ghost: true }
    };
    const round = parseProject(serializeProject({
        meta: { title: 't' }, seed: 'x', unit: c9,
        customDimensions: [], calloutOffsets: {}, contact: {}, view
    }));
    for (const [k, v] of Object.entries(view)) {
        assertEqual(JSON.stringify(round.view[k]), JSON.stringify(v), `view.${k} must survive`);
    }
});

test('custom dimensions and callout offsets survive save and reopen', () => {
    const dims = [{ id: 'custom:1', set: 'custom', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 100, z: 0 }, axis: 'y', offset: -200 }];
    const offs = { A1: { dx: 120, dy: -80 } };
    const round = parseProject(serializeProject({
        meta: {}, seed: 'x', unit: c9, customDimensions: dims, calloutOffsets: offs,
        contact: {}, view: { mode: '3d', isolation: {} }
    }));
    assertEqual(round.customDimensions.length, 1, 'dimension count');
    assertClose(round.calloutOffsets.A1.dx, 120, 1e-9, 'callout dx');
});

test('a project written by a newer format major version is refused', () => {
    const good = JSON.parse(serializeProject({
        meta: {}, seed: 'x', unit: c9, view: { mode: '3d' }
    }));
    good.formatVersion = '99.0';
    assertThrows(() => parseProject(JSON.stringify(good)), 'newer major must be refused');
});

/* ============================================================
   12b-iii. Quad view layout
   ============================================================ */

group('12b-iii. Quad view layout');

test('four panes tile the frame without overlapping', () => {
    const panes = quadLayout(1000, 600, 2);
    assertEqual(panes.length, 4, 'four panes');
    for (let i = 0; i < panes.length; i++) {
        for (let j = i + 1; j < panes.length; j++) {
            const a = panes[i], b = panes[j];
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w
                && a.y < b.y + b.h && b.y < a.y + a.h;
            assert(!overlap, `${a.mode} overlaps ${b.mode}`);
        }
    }
});

test('panes reach every edge of the frame', () => {
    const W = 1000, H = 600;
    const panes = quadLayout(W, H, 2);
    assertEqual(Math.min(...panes.map((p) => p.x)), 0, 'left edge');
    assertEqual(Math.min(...panes.map((p) => p.y)), 0, 'top edge');
    assertEqual(Math.max(...panes.map((p) => p.x + p.w)), W, 'right edge');
    assertEqual(Math.max(...panes.map((p) => p.y + p.h)), H, 'bottom edge');
});

test('every pane shares the frame aspect, which is what lets one fit serve all four', () => {
    const panes = quadLayout(1200, 800, 2);
    const frame = 1200 / 800;
    for (const p of panes) {
        assertClose(p.w / p.h, frame, 0.02, `${p.mode} aspect`);
    }
});

test('the GL origin is derived, never left to the caller', () => {
    // WebGL measures its viewport from the BOTTOM-left, CSS from the top.
    // Deriving one from the other at each call site is how a vertically
    // mirrored quad view happens.
    const H = 600;
    for (const p of quadLayout(1000, H, 2)) {
        assertEqual(p.glY, H - p.y - p.h, `${p.mode} glY`);
    }
});

test('plan sits above side so they share a longitudinal axis', () => {
    const panes = quadLayout(1000, 600, 2);
    const plan = panes.find((p) => p.mode === 'plan');
    const side = panes.find((p) => p.mode === 'side');
    const front = panes.find((p) => p.mode === 'front');
    assertEqual(plan.x, side.x, 'plan and side share a column');
    assert(plan.y < side.y, 'plan above side');
    assertEqual(side.y, front.y, 'side and front share a row');
});

test('paneAt finds the pane under a point, and nothing outside the frame', () => {
    const panes = quadLayout(1000, 600, 2);
    for (const p of panes) {
        const hit = paneAt(panes, p.x + p.w / 2, p.y + p.h / 2);
        assertEqual(hit?.mode, p.mode, `centre of ${p.mode}`);
    }
    assertEqual(paneAt(panes, 5000, 5000), null, 'outside the frame');
});

test('the layout survives odd and tiny frame sizes', () => {
    for (const [w, h] of [[1, 1], [3, 7], [1001, 603], [10000, 17]]) {
        const panes = quadLayout(w, h, 2);
        assertEqual(panes.length, 4, `${w}x${h} pane count`);
        for (const p of panes) {
            assert(p.w >= 1 && p.h >= 1, `${w}x${h} ${p.mode} collapsed`);
            assert(Number.isFinite(p.glY), `${w}x${h} ${p.mode} glY not finite`);
        }
    }
});

test('QUAD_ORDER covers all four modes exactly once', () => {
    assertEqual([...QUAD_ORDER].sort().join(','), '3d,front,plan,side', 'modes');
});

/* ============================================================
   12b-iv. Geometry export transform
   ============================================================ */

group('12b-iv. Geometry export transform');

test('the export transform maps the render frame back to engineering mm', () => {
    // Internally the scene is three.js Y-up, where render (x,y,z) is
    // engineering (y,z,x) in METRES. A geometry export has to undo both or it
    // will not line up with footprint.csv, which is the whole point of having
    // one coordinate system.
    const m = renderToEngMatrix(1000);
    /** @param {number[]} v @returns {number[]} */
    const apply = (v) => {
        const r = applyMatrix16(m, { x: v[0], y: v[1], z: v[2] });
        return [r.x, r.y, r.z].map((n) => Math.round(n * 1e6) / 1e6);
    };

    // A wheel at engineering (5486, 1079.5, 511.2) mm sits at render
    // (1.0795, 0.5112, 5.486) m. Round-tripping must return the original.
    assertEqual(apply([1.0795, 0.5112, 5.486]).join(','), '5486,1079.5,511.2', 'wheel centre');
    assertEqual(apply([0, 0, 0]).join(','), '0,0,0', 'origin is preserved');
    // Unit render axes land on the right engineering axes, scaled to mm.
    assertEqual(apply([1, 0, 0]).join(','), '0,1000,0', 'render x is engineering y');
    assertEqual(apply([0, 1, 0]).join(','), '0,0,1000', 'render y is engineering z');
    assertEqual(apply([0, 0, 1]).join(','), '1000,0,0', 'render z is engineering x');
});

test('the export transform preserves handedness, so no normal is inverted', () => {
    const e = renderToEngMatrix(1000);
    // 3x3 determinant of the linear part; must be positive.
    const a = [e[0], e[1], e[2]], b = [e[4], e[5], e[6]], c = [e[8], e[9], e[10]];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0]);
    assert(det > 0, `determinant must be positive, got ${det}`);
    assertClose(det, 1e9, 1, 'a pure rotation scaled by 1000 in each axis');
});

/* ============================================================
   12b-v. Annotation label placement
   ------------------------------------------------------------
   projection.js is pure by design so this can run under Node.
   It had no coverage until the rotated-footprint fix.
   ============================================================ */

group('12b-v. Annotation label placement');

test('a rotated label reports the footprint it actually occupies', () => {
    // Unrotated, the box is itself.
    let b = rotatedBox(70, 12, 0);
    assertClose(b.w, 70, 1e-9, 'width at 0 deg');
    assertClose(b.h, 12, 1e-9, 'height at 0 deg');

    // At 90 degrees it is on its side.
    b = rotatedBox(70, 12, Math.PI / 2);
    assertClose(b.w, 12, 1e-9, 'width at 90 deg');
    assertClose(b.h, 70, 1e-9, 'height at 90 deg');

    // At 45 degrees a long thin label becomes very nearly square, and much
    // TALLER than the 12 px the glyph box claims. This is the case that let
    // dimension values pile up on each other in three-quarter views.
    b = rotatedBox(70, 12, Math.PI / 4);
    assertClose(b.w, (70 + 12) / Math.SQRT2, 1e-9, 'width at 45 deg');
    assertClose(b.h, (70 + 12) / Math.SQRT2, 1e-9, 'height at 45 deg');
    assert(b.h > 12 * 4, 'the rotated height must dwarf the glyph height');

    // Sign of the angle cannot matter — a box rotated -30 covers the same
    // area as one rotated +30.
    const p = rotatedBox(70, 12, Math.PI / 6);
    const n = rotatedBox(70, 12, -Math.PI / 6);
    assertClose(p.w, n.w, 1e-9, 'width is symmetric in the angle');
    assertClose(p.h, n.h, 1e-9, 'height is symmetric in the angle');
});

test('the rotated footprint is what makes declutter separate angled labels', () => {
    // Two 70x12 labels 20 px apart vertically, both rotated 45 degrees. As
    // flat glyph boxes they do not overlap, so nothing moves and they render
    // on top of one another. As rotated footprints they clearly overlap.
    const flatA = { id: 'a', x: 100, y: 100, w: 70, h: 12, ox: 0, oy: 1 };
    const flatB = { id: 'b', x: 100, y: 120, w: 70, h: 12, ox: 0, oy: 1 };
    assert(!overlaps(flatA, flatB, 2), 'flat boxes 20 px apart do not overlap');

    const r = rotatedBox(70, 12, Math.PI / 4);
    const rotA = { id: 'a', x: 100, y: 100, w: r.w, h: r.h, ox: 0, oy: 1 };
    const rotB = { id: 'b', x: 100, y: 120, w: r.w, h: r.h, ox: 0, oy: 1 };
    assert(overlaps(rotA, rotB, 2), 'the same labels, rotated, do overlap');

    // And declutter must then actually separate them.
    declutter([rotA, rotB], { step: 16 });
    assert(!overlaps(rotA, rotB, 2),
        `declutter must resolve the overlap, got a at ${rotA.y} and b at ${rotB.y}`);
});

test('declutter leaves a hand-placed label where it was put', () => {
    // Dragging a callout and having the layout shove it back is the bug this
    // priority exists to prevent; it is worth a test of its own.
    const pinned = { id: 'user', x: 200, y: 200, w: 80, h: 16, ox: 1, oy: -1, priority: 100 };
    const auto = { id: 'auto', x: 205, y: 204, w: 80, h: 16, ox: 1, oy: -1, priority: 0 };
    declutter([auto, pinned], { step: 14 });
    assertEqual(pinned.x, 200, 'pinned x');
    assertEqual(pinned.y, 200, 'pinned y');
    assert(!overlaps(pinned, auto, 2), 'the automatic label must be the one that moved');
});

/* ============================================================
   12c. Chassis silhouette
   ============================================================ */

group('12c. Chassis silhouette');

test('the class 9 gets a silhouette bounded by its cited overall length', () => {
    const env = chassisEnvelope(c9layout, c9);
    assert(env, 'expected an envelope');
    assertClose(env.extent.length, c9.overallLength, 1e-6, 'length is the cited value');
    const x0 = Math.min(...env.boxes.map((b) => b.x0));
    const x1 = Math.max(...env.boxes.map((b) => b.x1));
    assertClose(x1 - x0, c9.overallLength, 1e-6, 'boxes span exactly the overall length');
});

test('the silhouette never exceeds the federal width or height limits', () => {
    for (const u of truckUnits) {
        const env = chassisEnvelope(resolveLayout(u), u);
        if (!env) continue;
        const halfW = Math.max(...env.boxes.map((b) => Math.max(Math.abs(b.y0), Math.abs(b.y1))));
        const top = Math.max(...env.boxes.map((b) => b.z1));
        assert(halfW * 2 <= WIDTH_LIMIT_MM + 1, `${u.id} width ${halfW * 2} exceeds 2591 mm`);
        assert(top <= HEIGHT_LIMIT_MM + 1, `${u.id} height ${top} exceeds 4115 mm`);
    }
});

test('the silhouette encloses the running gear it belongs to', () => {
    const env = chassisEnvelope(c9layout, c9);
    const x0 = Math.min(...env.boxes.map((b) => b.x0));
    const x1 = Math.max(...env.boxes.map((b) => b.x1));
    for (const a of c9layout.axles) {
        assert(a.x >= x0 && a.x <= x1, `axle ${a.id} at ${a.x} falls outside [${x0}, ${x1}]`);
    }
});

test('every box sits above the pavement and has positive volume', () => {
    for (const u of truckUnits) {
        const env = chassisEnvelope(resolveLayout(u), u);
        if (!env) continue;
        for (const b of env.boxes) {
            assert(b.z0 >= 0, `${u.id}/${b.id} starts below the pavement at ${b.z0}`);
            assert(b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0, `${u.id}/${b.id} is degenerate`);
        }
    }
});

test('a motorcycle gets no silhouette, because one would be meaningless', () => {
    const moto = truckUnits.find((u) => u.classification.class === 1);
    assertEqual(chassisEnvelope(resolveLayout(moto), moto), null, 'class 1');
});

test('aircraft get no silhouette — no sourced dimension constrains a fuselage', () => {
    for (const u of aircraftUnits) {
        assertEqual(chassisEnvelope(resolveLayout(u), u), null, u.id);
    }
});

test('body profiles are selected from the unit\'s body type', () => {
    assertEqual(profileFor('tractor-semitrailer').key, 'truck', 'tractor');
    assertEqual(profileFor('transit bus').key, 'bus', 'bus');
    assertEqual(profileFor('passenger car').key, 'car', 'car');
    assertEqual(profileFor('pickup truck').key, 'pickup', 'pickup');
    assertEqual(profileFor('motorcycle').key, 'motorcycle', 'motorcycle');
    assertEqual(profileFor('something unheard of').key, 'truck', 'unknown falls back to truck');
});

test('every truck in the library produces a usable silhouette or an explicit null', () => {
    for (const u of truckUnits) {
        const env = chassisEnvelope(resolveLayout(u), u);
        if (env === null) {
            assertEqual(u.classification.class, 1, `only class 1 may be null, ${u.id} was not`);
            continue;
        }
        assert(env.boxes.length > 0, `${u.id} produced an empty envelope`);
        assert(Array.isArray(env.representative) && env.representative.length > 0,
            `${u.id} must declare what is representative rather than sourced`);
    }
});

test('heavy trucks carry frame rails at the 34 in standard spacing', () => {
    const env = chassisEnvelope(c9layout, c9);
    const rails = env.boxes.filter((b) => b.kind === 'frame');
    assertEqual(rails.length, 2, 'two rails');
    const centres = rails.map((b) => (b.y0 + b.y1) / 2).sort((a, b) => a - b);
    assertClose(centres[1] - centres[0], 864, 1e-6, '34 in between rail centres');
});

/* ============================================================
   12b. FAA Order 5300.7 gear nomenclature
   ------------------------------------------------------------
   Table 3 of the Order is the ground truth: it publishes, for
   eighteen configurations, both the name and the wheel count.
   A parser that reproduces all eighteen from the names alone is
   a parser that has understood the grammar.
   ============================================================ */

group('12b. Gear nomenclature');

test('every Table 3 row round-trips through parse and format', () => {
    for (const r of FAA_TABLE_3) {
        const c = parseGearCode(r.code);
        assertEqual(c.canonical, r.code, `${r.code} canonical form`);
        // And again from the formatted output, so the two elisions of section
        // 6e cannot drift apart: a leading 1 and a trailing 1 are both dropped
        // on the main gear, and re-parsing has to put them back.
        assertEqual(parseGearCode(c.canonical).canonical, r.code, `${r.code} re-parse`);
    }
});

test('GROUND TRUTH: wheel counts reproduce Table 3 for all eighteen rows', () => {
    // Table 3's "Total # Wheels, Excluding Nose" column, transcribed into the
    // table and derived independently by the parser. They must agree without
    // exception — this is the check that the grammar is understood rather
    // than merely tolerated.
    for (const r of FAA_TABLE_3) {
        assertEqual(gearWheelCount(r.code), r.wheels,
            `${r.code} (Figure ${r.figure}) wheel count`);
    }
});

test('the main multiple is doubled and the body multiple is not', () => {
    // The asymmetry is section 6e against section 6f, and getting it backwards
    // is the single most plausible way to misread the convention: the main
    // count is PER SIDE of a symmetric gear, the body count is the TOTAL.
    assertEqual(gearWheelCount('D2'), 8, 'D2: 2 sides x 2 struts x 2 wheels');
    assertEqual(gearWheelCount('2D/2D2'), 16, '2D/2D2: 8 main + 8 body');
    assertEqual(gearWheelCount('2D/2D1'), 12, '2D/2D1: 8 main + 4 body');
    assertEqual(gearWheelCount('2D/D1'), 10, '2D/D1: 8 main + 2 body');
    // If the body count were doubled too, 2D/D1 would come out at 12 and
    // 2D/2D2 at 24. Both are Table 3 rows, so both would have been caught.
});

test('a bare body term is refused, because 6f never omits the count', () => {
    // "Because body gear arrangement may not be symmetrical, the gear code
    // must identify the total number of gears present, and a value of 1 is
    // not omitted if only one gear exists."  Accepting `2D/D` would make it a
    // synonym for `2D/D1`, and they are not synonyms.
    assertThrows(() => parseGearCode('2D/D'), /never omitted|total count/i,
        'a body term with no count must be refused');
    assertEqual(parseGearCode('2D/D1').body.multiple, 1, '2D/D1 states its count');
});

test('the tandem designation T means TRIPLE, per section 6d', () => {
    // The retired vocabulary is the trap. Under the old naming, "T" meant
    // tandem; under this Order it means triple wheels, so `2T` is twelve
    // wheels and not eight.
    assertEqual(GEAR_TYPES.T, 3, 'T is three wheels across');
    assertEqual(gearWheelCount('2T'), 12, '2T is two triples in tandem');
    assertEqual(wheelsPerMainStrut('2T'), 6, 'six wheels on a C-17 strut');
    assertEqual(gearWheelCount('2D'), 8, '2D is two duals in tandem, not dual-tandem-anything');
});

test('ICAO tire pressure codes parse, round-trip and do not affect geometry', () => {
    for (const [code, spec] of Object.entries(TIRE_PRESSURE_CODES)) {
        const c = parseGearCode(`2D/2D1(${code})`);
        assertEqual(c.pressure, code, `${code} parsed`);
        assertEqual(c.canonical, `2D/2D1(${code})`, `${code} round-trip`);
        assertEqual(gearWheelCount(c), 12, `${code} must not change the wheel count`);
        assert(spec.category.length > 0, `${code} has a category`);
    }
    assertThrows(() => parseGearCode('2D(Q)'), /not an ICAO tire pressure code/,
        'a gear-type letter is not a pressure code');
    // Table 2's own examples, verbatim.
    for (const s of ['S(W)', '2S(X)', '2D/2D1(Z)', 'Q2(Y)', '2D/3D2(Z)']) {
        assertEqual(parseGearCode(s).canonical, s, `Table 2 sample ${s}`);
    }
});

test('the C-5 is named directly and carries no internal grammar', () => {
    // Section 6h: "This aircraft will not be classified using the new naming
    // convention and will continue to be referred to directly as the C5."
    const c = parseGearCode('C5');
    assertEqual(c.special, 'C5', 'C5 is a special code');
    assertEqual(gearWheelCount(c), 24, 'C5 wheel count comes from the table, not the grammar');
    assertEqual(SPECIAL_CODES.C5.wheels, 24, 'and matches Table 3');
});

test('malformed names are refused rather than half-understood', () => {
    for (const bad of ['', '  ', '2', 'X', '2X', 'D/', '/D1', '2D/2D1/D1', '0D', 'D0', '2-']) {
        assertThrows(() => parseGearCode(bad), /.*/, `"${bad}" must be refused`);
    }
});

test('the convention is open-ended, exactly as Figure 2 says', () => {
    // "Increase numeric value for additional tandem axles." A name nobody has
    // built is still a legal name, and the parser must not gatekeep on
    // membership of Table 3.
    assertEqual(gearWheelCount('9Q'), 72, '9Q is nine quadruples in tandem, both sides');
    assert(!isTabulated('9Q'), '9Q is not in Table 3');
    assert(isTabulated('2D/2D2'), '2D/2D2 is in Table 3');
    assertEqual(genericConfigurations(3).length, 12, 'Figure 2 draws twelve cells');
    assertEqual(genericConfigurations(3)[0], 'S', 'first cell');
    assertEqual(genericConfigurations(3)[11], '3Q', 'last cell');
});

test('descriptions name the type, the tandem depth and the body gear', () => {
    assertEqual(describeGearCode('S'), 'Single wheel main gear');
    assertEqual(describeGearCode('2T'), 'Two triple wheels in tandem main gear');
    assertEqual(describeGearCode('D2'), 'Dual wheel, two struts per side main gear');
    assert(/two body gears, each three dual wheels in tandem/.test(describeGearCode('2D/3D2')),
        `2D/3D2 body phrase: ${describeGearCode('2D/3D2')}`);
    assert(/one body gear, dual wheels/.test(describeGearCode('2D/D1')),
        `2D/D1 body phrase: ${describeGearCode('2D/D1')}`);
});

test('Table 3 carries the legacy concordance, which is why it is transcribed', () => {
    // The Order is the only published cross-reference between this convention
    // and the three it replaced. A row that lost its legacy names would still
    // look fine on screen, so the distinctive ones are pinned.
    const c17 = tableRowsFor('2T')[0];
    assertEqual(c17.airForce.designation, 'TR-TA', 'C-17 Air Force designation');
    assertEqual(c17.navy.designation, 'TRT', 'C-17 Navy designation');
    const b747 = tableRowsFor('2D/2D2')[0];
    assertEqual(b747.faa.name, 'Double Dual Tandem', '747 historic FAA name');
    assertEqual(b747.navy.designation, 'DDT', '747 Navy designation');
    assertEqual(tableRowsFor('S').length, 2, 'S has two rows, differing only in the nose gear');
    assert(representativeAircraft('5D').some((a) => /An-124/.test(a)), '5D names the An-124');
    assert(/No Nose Gear|None/i.test(tableRowsFor('D2')[0].noseGear), 'the B-52 has no nose gear');
});

test('wheel plans draw the right number of wheels at the right scope', () => {
    // The scope rule: draw one strut when the strut IS the configuration
    // (Figure 2), draw the aircraft when the arrangement of struts is what is
    // being named (Figures 10-12, 16, 18, 20).
    for (const code of [...new Set([...genericConfigurations(3), ...FAA_TABLE_3.map((r) => r.code)])]) {
        const p = wheelPlan(code);
        const total = code === 'C5' ? 24 : gearWheelCount(code);
        if (p.scope === 'strut') {
            assertEqual(p.wheels.length * 2, total, `${code} strut plan is half the aircraft`);
        } else {
            assertEqual(p.wheels.length, total, `${code} aircraft plan draws every wheel`);
        }
        assert(p.wheels.every((w) => Number.isFinite(w.u) && Number.isFinite(w.v)),
            `${code} produced a non-finite coordinate`);
    }
    // A body gear must be distinguishable, or the diagram cannot show what
    // makes a 2D/2D2 different from a 2D.
    assert(wheelPlan('2D/2D2').wheels.some((w) => w.role === 'body'), '2D/2D2 has body wheels');
    assert(wheelPlan('2D').wheels.every((w) => w.role === 'main'), '2D has none');
});

test('COVERAGE: every configuration the Order names is loadable', () => {
    // Twenty-one codes: Figure 2's twelve generic cells plus the Table 3 rows
    // Figure 2 does not already cover. Each must resolve to something in the
    // library — a measured aircraft where one exists, a schematic otherwise.
    //
    // This is the check that would have caught the v1.9 defect where the Gear
    // configuration picker listed only the schematics: all twenty-one codes
    // WERE present in the library, but five of them (D, 2D, 3D, 2D/2D2,
    // 2D/3D2) were answered only by measured aircraft, so a list built from
    // the schematics alone silently dropped them. Asserting at the LIBRARY
    // level rather than the picker level is deliberate — it is the invariant
    // the picker depends on, and it holds however the picker is written.
    const conventions = [...new Set([
        ...genericConfigurations(3),
        ...FAA_TABLE_3.map((r) => r.code)
    ])];
    assertEqual(conventions.length, 21, 'the Order names twenty-one distinct configurations');

    const missing = conventions.filter(
        (c) => !aircraftUnits.some((u) => u.gearDesignation === c)
    );
    assertEqual(missing.length, 0,
        `no unit answers ${missing.join(', ')} — every FAA configuration must be loadable`);

    // And the reverse: nothing in the library carries a designation the Order's
    // own grammar cannot read.
    for (const u of aircraftUnits) {
        assertEqual(parseGearCode(u.gearDesignation).canonical, u.gearDesignation,
            `${u.id} carries a non-canonical gear designation`);
    }
});

test('gears in line are drawn ALONG the aircraft, not across it', () => {
    // Figures 18 and 20 both put the second strut BEHIND the first. Drawing
    // them side by side instead turns a Q2 into an eight-wheel axle line,
    // which is a gear that does not exist.
    const q2 = wheelPlan('Q2');
    const perSide = q2.wheels.filter((w) => w.u < 0);
    const files = new Set(perSide.map((w) => w.v.toFixed(3)));
    assertEqual(files.size, 2, 'Q2 has two longitudinal files on each side');
    const lanes = new Set(q2.wheels.map((w) => Math.sign(w.u)));
    assertEqual(lanes.size, 2, 'and two sides, with nothing on the centreline');
});

/* ============================================================
   13. Aircraft library
   ============================================================ */

group('13. Aircraft library');

test('the aircraft library loads and covers several gear codes', () => {
    assert(aircraftUnits.length >= 4, `only ${aircraftUnits.length} aircraft`);
    const codes = new Set(aircraftUnits.map((u) => u.gearDesignation));
    for (const c of ['D', '2D', '3D']) assert(codes.has(c), `gear code ${c} missing`);
});

test('every aircraft declares which of its numbers are assumed', () => {
    for (const u of aircraftUnits) {
        assert(Array.isArray(u.assumedFields),
            `${u.id} must declare assumedFields[] — an empty array asserts that nothing was assumed`);
    }
});

test('DERIVATION: main gear geometry reproduces the FAA outer width exactly', () => {
    // The FAA publishes the distance between OUTER TIRES, not the centreline
    // track. Gear positions are derived from it, so the two must close. If
    // this ever fails, either the outer width or a dual spacing has drifted
    // and every main wheel is in the wrong place.
    for (const u of aircraftUnits) {
        if (u.mainGearOuterWidth == null) continue;
        const l = resolveLayout(u);
        assertClose(l.derived.mainGearOuterWidth, u.mainGearOuterWidth, 2,
            `${u.id}: derived outer width must reproduce the stated FAA value`);
    }
});

test('CROSS-CHECK: the derived track matches each manufacturer\'s published tread', () => {
    // Independent corroboration that the dual spacings are right: nothing in
    // the derivation uses the published tread, so agreement is a real check
    // rather than a tautology.
    //
    // TOLERANCE IS 15 mm, AND THAT NUMBER IS THE POINT. This assertion
    // originally allowed 40 mm, on the reasoning that the treads are quoted to
    // the nearest inch. But the 767-400ER was out by 26 mm and passed —
    // a corroboration test whose tolerance exceeds the error it exists to
    // catch corroborates nothing. The 26 mm was a wrong dual spacing (1143 mm,
    // taken as a round 45 in because no document stated it; FAARFIELD gives
    // 45.800 in), and it was visibly the worst of the four the whole time.
    //
    // Rounding to the nearest inch can only account for about 13 mm here, and
    // the four residuals are +12.3, -12.9, +6.0 and -10.4. 15 mm admits the
    // rounding and nothing else. Widening this bound to make a future aircraft
    // pass would be reintroducing exactly this bug.
    const publishedTread = {
        'b737-800': 5715,      // Boeing: 18 ft 9 in
        'b757-200': 7315,      // Boeing: 24 ft 0 in
        'b767-400er': 9296,    // Boeing: 30 ft 6 in
        'b777-300er': 10973    // Boeing: 36 ft 0 in
    };
    for (const [id, tread] of Object.entries(publishedTread)) {
        const u = aircraftUnits.find((x) => x.id === id);
        assert(u, `${id} missing from the library`);
        const l = resolveLayout(u);
        assertClose(l.derived.mainGearTrack, tread, 15,
            `${id}: derived track vs published tread`);
    }
});

test('the 767-400ER dual spacing is the FAARFIELD value, not a rounded guess', () => {
    // Pinned deliberately. This is the number the v1.6.1 correction turned on,
    // and because the track is DERIVED from it, a silent revert would move
    // every 767 main wheel 10 mm per side while every other check still passed.
    const u = aircraftUnits.find((x) => x.id === 'b767-400er');
    const mlg = u.gears.filter((g) => g.role === 'main');
    for (const g of mlg) {
        assertEqual(g.dualSpacing, 1163, `${g.id} dual spacing (45.800 in per FAARFIELD)`);
        assertEqual(Math.abs(g.y), 4651, `${g.id} strut centreline re-derived from the corrected spacing`);
    }
    // And the geometry must still close the authoritative outer width exactly.
    assert(validateUnit(u).ok, '767-400ER must validate after the correction');
    const l = resolveLayout(u);
    assertClose(l.derived.mainGearTrack, 9302, 1, 'derived track');

    // The property that makes correcting a dual spacing safe: the FAA outer
    // width is held, so the change is absorbed INSIDE it. The outboard tire
    // edge does not move. Before the correction the outer tire sat at the same
    // 5232.5 mm it does now; only the inboard tire and the strut moved.
    const ys = l.wheels.filter((w) => w.axleId !== 'NLG').map((w) => Math.abs(w.y));
    assertClose(Math.max(...ys), 5232.5, 0.1, 'outboard tire centre is unmoved');
    assertClose(Math.min(...ys), 4069.5, 0.1, 'inboard tire moved 20 mm inboard');
    const sec = 508;  // 50x20.0R22 section width, mm
    assertClose(2 * (Math.max(...ys) + sec / 2), u.mainGearOuterWidth, 1,
        'outer tire EDGES still reproduce the authoritative outer width');
});

test('aircraft wheelbase is measured to the main gear centroid', () => {
    for (const u of aircraftUnits) {
        const l = resolveLayout(u);
        if (u.wheelbase == null) {
            // A null wheelbase is an honest "unknown" and the schema allows it,
            // but only for one reason: the quantity is measured FROM the nose
            // gear, so an aircraft that has none — the B-52's bicycle gear —
            // has no wheelbase to state. A unit that simply forgot to state one
            // must still fail, so the null has to be corroborated by the
            // absence it claims.
            const noses = u.gears.filter((g) => g.role === 'nose' || /^N/i.test(g.id));
            assertEqual(noses.length, 0,
                `${u.id} states wheelbase: null but carries a nose gear — the wheelbase is derivable`);
            assertEqual(l.derived.wheelbase, undefined, `${u.id} must derive no wheelbase either`);
            continue;
        }
        assertClose(l.derived.wheelbase, u.wheelbase, 1, `${u.id} wheelbase`);
    }
});

test('a stated main gear track is reproduced by the geometry', () => {
    // The counterpart of the outer-width derivation, for the units that state a
    // track instead. The schematic configurations are sourced the other way
    // round from the real aircraft — their track is the measured quantity and
    // their outer width would depend on a nominal tire — so this is the check
    // that stops a transcription slip moving every strut.
    for (const u of aircraftUnits) {
        if (u.mainGearTrack == null) continue;
        const l = resolveLayout(u);
        assertClose(l.derived.mainGearTrack, u.mainGearTrack, 1,
            `${u.id}: derived track must reproduce the stated one`);
    }
});

test('schematic configurations state no outer width, because theirs would be nominal', () => {
    // On a real aircraft the FAA outer width is the datum and the track is
    // derived from it. On a schematic the track is measured and the outer
    // width would fall out of a NOMINAL tire, so publishing one would dress a
    // placeholder as a datum. Every schematic must decline to state it.
    for (const u of aircraftUnits.filter((x) => x.kind === 'schematic')) {
        assertEqual(u.mainGearOuterWidth, null,
            `${u.id} is schematic and must not state a mainGearOuterWidth`);
        assert(u.mainGearTrack > 0, `${u.id} must state the track it does know`);
        assert((u.assumedFields || []).some((f) => /\.tire$/.test(f)),
            `${u.id} must declare its nominal tire in assumedFields`);
    }
});

test('percent on main gear is the design value and load splits accordingly', () => {
    for (const u of aircraftUnits) {
        // 95 % is the FAA thickness-design value (AC 150/5320-6G G.1.3) and is
        // what every aircraft here uses ABSENT a manufacturer figure. The A380
        // publishes 95.1 % for its weight variant, which is more specific, so
        // the assertion is a band around the design value rather than equality
        // to it — a unit outside this band is a transcription error, not a
        // legitimately different aircraft.
        const l = resolveLayout(u);
        if (u.percentOnMainGear == null) {
            // Null is allowed for one reason only: the figure exists to split
            // load between the nose gear and the main gear, so it is undefined
            // for an aircraft with no nose gear. Anything else stating null is
            // an omission, not an honest unknown.
            const noses = u.gears.filter((g) => g.role === 'nose' || /^N/i.test(g.id));
            assertEqual(noses.length, 0,
                `${u.id} states percentOnMainGear: null but carries a nose gear`);
            // And the null must propagate: no tire may be given a load derived
            // from a split that was never stated.
            assert(l.wheels.every((w) => w.loadKn == null),
                `${u.id} states no load split, so no tire may carry a derived load`);
            continue;
        }
        assert(u.percentOnMainGear >= 94 && u.percentOnMainGear <= 96,
            `${u.id} percentOnMainGear ${u.percentOnMainGear} outside 94-96`);

        // A configuration with no stated weight has nothing to split. That is
        // legitimate for the pure Figure 2 patterns, which are drawings rather
        // than aircraft — but the absence must be total, not a silent zero.
        if (u.mtow == null) {
            assert(l.wheels.every((w) => w.loadKn == null),
                `${u.id} states no weight, so no tire may carry a load`);
            continue;
        }

        const mainIds = new Set(l.axles.filter((a) => a.role === 'main').map((a) => a.id));
        const mainLoad = l.wheels.filter((w) => mainIds.has(w.axleId))
            .reduce((s, w) => s + (w.loadKn ?? 0), 0);
        const total = l.wheels.reduce((s, w) => s + (w.loadKn ?? 0), 0);
        // Whatever the stated figure, the layout must actually split the load
        // that way. This is the half of the test that catches real breakage.
        assertClose((mainLoad / total) * 100, u.percentOnMainGear, 0.01,
            `${u.id} main gear load share`);
    }
});

test('tire counts match the gear designation', () => {
    const expected = {
        'b737-800': 6, 'b757-200': 10, 'b767-400er': 10, 'b777-300er': 14,
        // Wing-plus-body gear: nose 2 plus four bogies. The 747s carry four
        // tires on every bogie; the A380 carries four on each wing bogie and
        // six on each body bogie.
        'b747-400': 18, 'b747-8': 18, 'a380-800': 22
    };
    for (const [id, n] of Object.entries(expected)) {
        const u = aircraftUnits.find((x) => x.id === id);
        assertEqual(resolveLayout(u).wheels.length, n, `${id} tire count`);
    }
});

test('the validator rejects an aircraft whose geometry contradicts its outer width', () => {
    const good = structuredClone(aircraftUnits.find((u) => u.id === 'b737-800'));
    assert(validateUnit(good).ok, 'control must be valid');
    const bad = structuredClone(good);
    bad.gears.find((g) => g.id === 'MLG-R').y += 250;   // move one strut outboard
    const r = validateUnit(bad);
    assert(!r.ok, 'a strut moved off the derived track must fail validation');
    assert(r.errors.some((e) => /mainGearOuterWidth/.test(e)), 'the error must name the datum');
});

/* ============================================================
   13b. Wing-plus-body gear (2D/2D2 and 2D/3D2)
   ------------------------------------------------------------
   These aircraft were kept out of the library for two releases
   because a single outer width cannot close a four-bogie
   layout. The geometry now comes from the manufacturers' own
   footprint figures, so these tests check the things a summary
   table would have let slide.
   ============================================================ */

group('13b. Wing-plus-body gear');

const WING_BODY = ['b747-400', 'b747-8', 'a380-800'];

test('wing-plus-body aircraft have four main struts, body gear aft and inboard', () => {
    for (const id of WING_BODY) {
        const u = aircraftUnits.find((x) => x.id === id);
        assert(u, `${id} must be in the library`);
        const mains = u.gears.filter((g) => g.role === 'main');
        assertEqual(mains.length, 4, `${id} main strut count`);

        const wing = mains.filter((g) => g.id.startsWith('WLG'));
        const body = mains.filter((g) => g.id.startsWith('BLG'));
        assertEqual(wing.length, 2, `${id} wing struts`);
        assertEqual(body.length, 2, `${id} body struts`);

        // The whole reason these aircraft were deferred: the body gear is
        // displaced in BOTH axes, and neither displacement is recoverable
        // from an outer width.
        assert(body[0].x > wing[0].x, `${id} body gear must sit aft of the wing gear`);
        assert(Math.abs(body[0].y) < Math.abs(wing[0].y),
            `${id} body gear must sit inboard of the wing gear`);
    }
});

test('nothing on a wing-plus-body aircraft rests on an assumed spacing', () => {
    // On the two-strut aircraft the tandem and nose dual spacings are assumed,
    // because no consulted source constrains them. The footprint figures used
    // for these publish every spacing, so an assumption here would mean a
    // number was not actually read off the figure.
    for (const id of ['b747-8', 'a380-800']) {
        const u = aircraftUnits.find((x) => x.id === id);
        assertEqual(u.assumedFields.length, 0, `${id} should assume nothing`);
        for (const g of u.gears) {
            if ((g.tandemRows ?? 1) > 1) assert(g.tandemSpacing > 0, `${id} ${g.id} tandem spacing`);
            if ((g.wheelsAcross ?? 1) > 1) assert(g.dualSpacing > 0, `${id} ${g.id} dual spacing`);
        }
    }
    // The 747-400's one assumption is the nose tire's rim diameter, because
    // Boeing states that size in the two-part form that omits it.
    const b744 = aircraftUnits.find((x) => x.id === 'b747-400');
    assertEqual(b744.assumedFields.join(','), 'NLG.tire.rimDiameter', '747-400 assumptions');
});

test('body gear offsets reproduce the published footprint figures', () => {
    // Read straight off the ACAP and AC drawings. If a transcription slips,
    // the whole rear of the aircraft moves and nothing else complains.
    const cases = [
        ['b747-400', 24067, 27140, 5499, 1918],
        ['b747-8', 28118, 31191, 5499, 1918],
        ['a380-800', 28605, 31881, 6228, 2632]
    ];
    for (const [id, wx, bx, wy, by] of cases) {
        const u = aircraftUnits.find((x) => x.id === id);
        const wing = u.gears.find((g) => g.id === 'WLG-L');
        const body = u.gears.find((g) => g.id === 'BLG-L');
        assertEqual(wing.x, wx, `${id} wing gear x`);
        assertEqual(body.x, bx, `${id} body gear x`);
        assertEqual(Math.abs(wing.y), wy, `${id} wing strut centreline`);
        assertEqual(Math.abs(body.y), by, `${id} body strut centreline`);
    }
    // Both 747 figures state the same body-gear offset, independently.
    for (const id of ['b747-400', 'b747-8']) {
        const u = aircraftUnits.find((x) => x.id === id);
        const d = u.gears.find((g) => g.id === 'BLG-L').x - u.gears.find((g) => g.id === 'WLG-L').x;
        assertEqual(d, 3073, `${id} body gear offset (10 ft 1 in)`);
    }
});

test('the wheelbase is the tire-weighted centroid, which only the A380 distinguishes', () => {
    // Every 747 bogie carries four tires, so its centroid is the midpoint
    // between wing and body gear. The A380's body gear carries twelve of the
    // twenty main tires and pulls the centroid aft of that midpoint. A plain
    // mean over struts would put it 328 mm too far forward — and would be
    // right on every other aircraft in the library, which is exactly what
    // makes that kind of error survive.
    for (const id of WING_BODY) {
        const u = aircraftUnits.find((x) => x.id === id);
        assertClose(resolveLayout(u).derived.wheelbase, u.wheelbase, 1, `${id} wheelbase`);
    }
    const a380 = aircraftUnits.find((x) => x.id === 'a380-800');
    const mains = a380.gears.filter((g) => g.role === 'main');
    const plainMean = mains.reduce((s, g) => s + g.x, 0) / mains.length;
    assertClose(plainMean, 30243, 1, 'unweighted mean over struts');
    assertClose(resolveLayout(a380).derived.wheelbase - plainMean, 328, 1,
        'tire weighting must move the centroid aft');
});

test('the A380 body bogie keeps its 20 mm wider middle axle', () => {
    // Published as 1.530 / 1.550 / 1.530 m, corroborated to the millimetre by
    // the FAARFIELD library. Averaging it to one dual spacing would be
    // invisible on screen and wrong in a footprint file.
    const u = aircraftUnits.find((x) => x.id === 'a380-800');
    const g = u.gears.find((x) => x.id === 'BLG-L');
    assertEqual(g.dualSpacingByRow.join(','), '1530,1550,1530', 'published per-row dual spacing');

    const wheels = resolveLayout(u).wheels.filter((w) => w.axleId === 'BLG-L');
    assertEqual(wheels.length, 6, 'six wheels on a dual-tridem body bogie');
    const byRow = new Map();
    for (const w of wheels) byRow.set(w.row, Math.round(Math.abs(w.y - g.y) * 100) / 100);

    // FAARFIELD: +/-764.54 mm on the outer axles, +/-774.70 on the middle.
    assertClose(byRow.get(0), 765, 0.6, 'front axle half-offset vs FAARFIELD 764.54');
    assertClose(byRow.get(1), 775, 0.6, 'middle axle half-offset vs FAARFIELD 774.70');
    assertClose(byRow.get(2), 765, 0.6, 'rear axle half-offset vs FAARFIELD 764.54');
    assert(byRow.get(1) > byRow.get(0), 'the middle axle must be the wider one');
});

test('the outermost strut closes the outer width, not whichever is listed first', () => {
    // The A380's body gear has a WIDER dual spacing than its wing gear
    // (1530 vs 1350), so a check reaching for the first main gear would
    // misjudge the outer width by 180 mm while looking entirely reasonable.
    const u = aircraftUnits.find((x) => x.id === 'a380-800');
    assert(validateUnit(u).ok, 'A380 must validate as shipped');

    const body = u.gears.find((g) => g.id === 'BLG-L');
    const wing = u.gears.find((g) => g.id === 'WLG-L');
    assert(body.dualSpacing > wing.dualSpacing,
        'this test only bites while the body bogie is the wider one');

    const bad = structuredClone(u);
    bad.gears.find((g) => g.id === 'WLG-R').y += 250;
    const r = validateUnit(bad);
    assert(!r.ok, 'a wing strut moved off the published track must fail');
    assert(r.errors.some((e) => /mainGearOuterWidth/.test(e)), 'the error must name the datum');
});

test('wing-plus-body aircraft carry provenance on every gear and cite the cross-check', () => {
    for (const id of WING_BODY) {
        const u = aircraftUnits.find((x) => x.id === id);
        const r = validateUnit(u);
        assert(r.ok, `${id} must validate: ${(r.errors || []).join('; ')}`);
        for (const g of u.gears) {
            assert(typeof g.source === 'string' && g.source.length > 40,
                `${id} ${g.id} needs a source saying where the number came from`);
        }
        const ids = (u.sources || []).map((x) => x.id);
        assert(ids.includes('faarfield-aclib'), `${id} must cite the FAARFIELD cross-check`);
    }
});

test('stated quantities convert correctly from their source units', () => {
    // Data files quote MTOW in pounds and tire pressure in psi because that
    // is how the source documents state them. Anything that displays or
    // computes with those numbers must go through canonical() first — reading
    // 775 000 lb as 775 000 kg is a factor-2.2 error that looks entirely
    // plausible on screen.
    const b777 = aircraftUnits.find((u) => u.id === 'b777-300er');
    assertEqual(b777.mtow.unit, 'lb', 'stored in the source unit');
    assertClose(canonical(b777.mtow, 'mass'), 351534, 2, 'MTOW in kg');
    assertEqual(b777.tirePressure.unit, 'psi', 'stored in the source unit');
    assertClose(canonical(b777.tirePressure, 'pressure'), 1523.7, 0.5, 'tire pressure in kPa');

    // And the contact model must see the converted value, not the raw one.
    const patches = computePatches(resolveLayout(b777), b777, { model: 'rectangular' });
    assertClose(patches[0].inflationKpa, 1523.7, 0.5, 'patch inflation pressure');
});

test('the validator rejects an aircraft that does not declare assumedFields', () => {
    const bad = structuredClone(aircraftUnits[0]);
    delete bad.assumedFields;
    assert(!validateUnit(bad).ok, 'undeclared assumptions must fail validation');
});

test('footprint CSV carries its assumptions and one row per tire', () => {
    const p = computePatches(c9layout, c9, { model: 'huang' });
    const csv = toCSV(p, { unitId: c9.id, unitLabel: '3-S2', model: 'huang', timestamp: '2026-01-01T00:00:00Z' });
    const lines = csv.split('\n');
    const header = lines.findIndex((l) => l.startsWith('tire_id,'));
    assert(header > 10, 'the assumption header must precede the data');
    assert(csv.includes('UNIFORM'), 'the uniform-pressure idealisation must be stated');
    assert(csv.includes('EQUAL TO INFLATION PRESSURE'), 'the pressure assumption must be stated');
    const dataRows = lines.slice(header + 1).filter((l) => l && !l.startsWith('#'));
    assertEqual(dataRows.length, 18, 'one row per tire');
    assertEqual(dataRows[0].split(',').length, 14, 'column count');
    assert(dataRows[0].endsWith(',model:huang'), 'every row names its provenance');
});

test('a measured patch keeps its load and implies a new pressure', () => {
    // The override direction matters: the wheel still carries what it carries,
    // so measured dimensions imply a contact pressure rather than the pressure
    // implying dimensions.
    const base = computePatches(c9layout, c9, { model: 'rectangular' });
    const target = base[0].tireId;
    const ov = computePatches(c9layout, c9, {
        model: 'rectangular',
        overrides: { [target]: { length: 300, width: 250 } }
    });
    const before = base.find((p) => p.tireId === target);
    const after = ov.find((p) => p.tireId === target);

    assertEqual(after.patch.overridden, true, 'flagged as overridden');
    assertClose(after.patch.length, 300, 1e-9, 'measured length');
    assertClose(after.patch.width, 250, 1e-9, 'measured width');
    assertClose(after.patch.area, 75000, 1e-9, 'area follows the measurement');
    assertClose(after.loadKn, before.loadKn, 1e-9, 'load is HELD');
    assertClose(after.patch.pressure * after.patch.area / 1e6, after.loadKn, 1e-9,
        'pressure x area must reproduce the load');
    assert(Math.abs(after.patch.pressure - after.inflationKpa) > 1,
        'an overridden patch no longer sits at inflation pressure');

    // and every other patch is untouched
    for (const p of ov.filter((x) => x.tireId !== target)) {
        assertEqual(p.patch.overridden, false, `${p.tireId} must be untouched`);
    }
});

test('the CSV distinguishes measured patches from modelled ones', () => {
    const p = computePatches(c9layout, c9, {
        model: 'huang',
        overrides: { [c9layout.wheels[0].id]: { length: 300, width: 250 } }
    });
    const csv = toCSV(p, { unitId: c9.id, model: 'huang', timestamp: 'now' });
    const lines = csv.split(String.fromCharCode(10));
    const hdr = lines.findIndex((l) => l.startsWith('tire_id,'));
    assert(lines[hdr].endsWith(',source'), 'a source column must exist');

    const rows = lines.slice(hdr + 1).filter((l) => l && !l.startsWith('#'));
    const measured = rows.filter((l) => l.endsWith(',measured'));
    const modelled = rows.filter((l) => l.endsWith(',model:huang'));
    assertEqual(measured.length, 1, 'one measured row');
    assertEqual(modelled.length, rows.length - 1, 'the rest modelled');

    // and the header must warn, because assumption 1 no longer holds for all rows
    assert(/MEASURED PATCHES PRESENT/.test(csv), 'header must flag measured patches');
    assert(/1 of 18 patches/.test(csv), 'header must count them');
});

test('with no overrides the header makes no measured-patch claim', () => {
    const csv = toCSV(computePatches(c9layout, c9, { model: 'huang' }),
        { unitId: c9.id, model: 'huang', timestamp: 'now' });
    assert(!/MEASURED PATCHES PRESENT/.test(csv), 'no spurious warning');
    assert(/,model:huang/.test(csv), 'rows still name their model');
});

test('the Abaqus export states that it is not a runnable deck', () => {
    const p = computePatches(c9layout, c9, { model: 'huang' });
    const inp = toAbaqus(p, { unitId: c9.id, unitLabel: '3-S2', model: 'huang', timestamp: '2026-01-01T00:00:00Z' });
    assert(inp.includes('PARAMETER TABLE'), 'must say what it is');
    assert(inp.includes('area_ratio'), 'must expose the bounding-rectangle area ratio');
    assert(inp.split('\n').filter((l) => /^[A-Za-z]/.test(l)).length >= 18, 'one data row per tire');
});


/* ============================================================
   14. Design tokens — text contrast
   ------------------------------------------------------------
   styles.css is data as far as this check is concerned: the
   theme blocks are parsed and the colour pairs are computed.
   No DOM, no browser.

   This exists because --g3-muted spent five releases at 2.72:1
   on the light panel — below the WCAG AA minimum on EVERY
   background in that theme, across 55 elements — and nothing
   could tell. A token is one edit away from regressing, and a
   regression here is invisible to every other test in this file.
   ============================================================ */

group('14. Design tokens — text contrast');

/** @param {number[]} c @returns {number} */
function relLuminance(c) {
    const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} h @returns {number[]} */
function hexRGB(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    if (!m) throw new Error(`not a hex colour: ${h}`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {string} a @param {string} b @returns {number} */
function contrast(a, b) {
    const l1 = relLuminance(hexRGB(a));
    const l2 = relLuminance(hexRGB(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Pull one theme's custom properties out of the stylesheet.
 * @param {string} css
 * @param {string} selector
 * @returns {Record<string,string>}
 */
function themeTokens(css, selector) {
    const i = css.indexOf(selector);
    if (i < 0) throw new Error(`theme block not found: ${selector}`);
    const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
    /** @type {Record<string,string>} */
    const out = {};
    for (const m of body.matchAll(/(--g3-[\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
    return out;
}

const CSS = readText(join(ROOT, 'styles.css'));

test('body text tokens clear WCAG AA on every surface they are drawn on', () => {
    // 4.5:1 is the AA minimum for text below 18.66px bold / 24px regular, and
    // everything these two tokens colour is small.
    const AA = 4.5;
    for (const [theme, sel] of [['light', '[data-theme="light"]'], ['dark', '[data-theme="dark"]']]) {
        const t = themeTokens(CSS, sel);
        const surfaces = ['--g3-surface', '--g3-surface-2', '--g3-paper', '--g3-inset'];
        for (const ink of ['--g3-muted', '--g3-graphite', '--g3-ink']) {
            for (const bg of surfaces) {
                assert(t[ink] && t[bg], `${theme}: missing ${ink} or ${bg}`);
                const c = contrast(t[ink], t[bg]);
                assert(c >= AA,
                    `${theme}: ${ink} (${t[ink]}) on ${bg} (${t[bg]}) is ${c.toFixed(2)}:1, needs ${AA}`);
            }
        }
    }
});

test('the muted/graphite hierarchy stays visibly two steps wide', () => {
    // Raising muted to clear AA could have collapsed it onto graphite, which
    // would make every "secondary" label look primary. Graphite must stay
    // clearly the stronger of the two.
    for (const [theme, sel] of [['light', '[data-theme="light"]'], ['dark', '[data-theme="dark"]']]) {
        const t = themeTokens(CSS, sel);
        const g = contrast(t['--g3-graphite'], t['--g3-surface']);
        const m = contrast(t['--g3-muted'], t['--g3-surface']);
        assert(g > m * 1.15,
            `${theme}: graphite ${g.toFixed(2)}:1 must stay clearly above muted ${m.toFixed(2)}:1`);
    }
});

test('chrome drawn on the figure clears AA against the figure, not the theme', () => {
    // --g3-fig-* colour the HUD and axis badge, which sit on the white plate
    // whatever the interface theme is. They are declared once, outside the
    // theme blocks, and must be judged against the figure's own paper.
    const i = CSS.indexOf('--g3-fig-paper');
    assert(i > 0, '--g3-fig-paper must be declared');
    const block = CSS.slice(i - 400, i + 600);
    /** @type {Record<string,string>} */
    const fig = {};
    for (const m of block.matchAll(/(--g3-fig-[\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)) fig[m[1]] = m[2];

    for (const ink of ['--g3-fig-ink', '--g3-fig-muted', '--g3-fig-datum']) {
        assert(fig[ink], `${ink} must be declared`);
        const c = contrast(fig[ink], fig['--g3-fig-paper']);
        assert(c >= 4.5,
            `${ink} (${fig[ink]}) on the figure is ${c.toFixed(2)}:1, needs 4.5`);
    }
});

process.exit(summary());
