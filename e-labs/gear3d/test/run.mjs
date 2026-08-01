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
    engToRender, renderToEng, eng, distance, bounds, orbitToEng, engToOrbit, LOCKED_VIEWS
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
import { toCSV, toAbaqus } from '../src/contact/export.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'src', 'data');

/** @param {string} p @returns {any} */
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

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
    assertEqual(dataRows[0].split(',').length, 13, 'column count');
});

test('the Abaqus export states that it is not a runnable deck', () => {
    const p = computePatches(c9layout, c9, { model: 'huang' });
    const inp = toAbaqus(p, { unitId: c9.id, unitLabel: '3-S2', model: 'huang', timestamp: '2026-01-01T00:00:00Z' });
    assert(inp.includes('PARAMETER TABLE'), 'must say what it is');
    assert(inp.includes('area_ratio'), 'must expose the bounding-rectangle area ratio');
    assert(inp.split('\n').filter((l) => /^[A-Za-z]/.test(l)).length >= 18, 'one data row per tire');
});

process.exit(summary());
