// SI and English in the Cross-Section Studio. Run:
//   node --experimental-strip-types --test src/components/react/crosssection/units.test.mjs
//
// Two constants live in units.ts and they are one letter apart in effect:
// 25 rounds a designation and 25.4 draws one. Crossing them is silent — the
// figure is 1.6% wrong, which nobody sees — and compounding, because the
// switch would inflate every length a little on each pass. So what is
// asserted here is the behavior the switch promises: the soft-conversion
// table the specifications print, a round trip that comes back where it
// started, and geometry that is exactly the size of its own label.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MM_PER_IN, NOMINAL_MM_PER_IN,
    nominalInches, nominalMm, redesignate, FIELD_LIMITS,
    inUnits, toMm, formatLength, unitLabelOf, unitWordOf,
} from '../units.js';

/* Every metric thickness the studio ships: the FAA and highway templates,
   the default section, and the section geometry. If one of these stops
   reading as the inch designation it is specified alongside, the switch has
   stopped being a soft conversion and started being arithmetic. */
const SHIPPED_MM = [40, 50, 75, 100, 125, 150, 200, 250, 280, 300, 330, 350, 400, 510];
const SECTION_MM = [1600, 1400, 150, 500];

test('the soft-conversion table the specifications print', () => {
    // FAA P-401 is "75 mm (3 in.)" and those are the same lift. This is that
    // sentence, for every designation the tool can put on screen.
    const TABLE = [
        [40, 1.5], [50, 2], [75, 3], [100, 4], [125, 5], [150, 6],
        [200, 8], [250, 10], [280, 11], [300, 12], [330, 13], [350, 14],
        [400, 16], [500, 20], [510, 20],
    ];
    for (const [mm, inches] of TABLE) {
        assert.equal(nominalInches(mm), inches,
            `${mm} mm should read as ${inches} in, got ${nominalInches(mm)}`);
    }
    // ...and the plan dimensions, which are round metric numbers rather than
    // spec designations, come back as round inch ones.
    assert.equal(nominalInches(1600), 64);
    assert.equal(nominalInches(1400), 56);
});

test('what is STORED for an inch designation is exactly that many inches', () => {
    // The whole promise of the tool is that the figure is true to scale. A
    // 3-in layer has to be 3 in tall in the render and in the exported PNG,
    // which means the stored millimeters are 3 x 25.4 and not 3 x 25.
    for (const mm of SHIPPED_MM) {
        const stored = redesignate(mm, 'in');
        const inches = nominalInches(mm);
        assert.ok(Math.abs(stored - inches * MM_PER_IN) < 1e-9,
            `${mm} mm stored as ${stored}, which is not ${inches} in`);
        // and reading it back gives the designation with no drift
        assert.ok(Math.abs(inUnits(stored, 'in') - inches) < 1e-9,
            `${mm} mm reads back as ${inUnits(stored, 'in')} rather than ${inches}`);
    }
    assert.notEqual(MM_PER_IN, NOMINAL_MM_PER_IN,
        'the two constants must stay different, or the figure stops being to scale');
});

test('a round trip comes back where it started, or stays put after one pass', () => {
    // Three FAA metric designations are not multiples of 25 -- 280, 330 and
    // 510 -- so a trip through English returns them as the nearest one that
    // is. That is the documented price of round numbers in both systems. It
    // has to happen ONCE and then hold: a switch that kept nudging a
    // thickness every time you pressed it would be a bug.
    const DRIFTS = new Map([[280, 275], [330, 325], [510, 500]]);

    for (const mm of [...SHIPPED_MM, ...SECTION_MM]) {
        const there = redesignate(mm, 'in');
        const back = redesignate(there, 'mm');
        const expected = DRIFTS.get(mm) ?? mm;
        assert.equal(back, expected,
            `${mm} mm came back as ${back}, expected ${expected}`);

        // Second and third passes must not move it again.
        const there2 = redesignate(back, 'in');
        const back2 = redesignate(there2, 'mm');
        assert.equal(back2, back, `${mm} mm is still drifting: ${back} then ${back2}`);
        assert.equal(redesignate(back2, 'in'), there2, `${mm} mm drifts in English too`);
    }
});

test('the map is deliberately not idempotent, and that is why it is called once', () => {
    // Applying metric-to-English twice inflates by the ratio of the two
    // constants each time. This is not a defect to fix in the map, it is the
    // reason `convertLengths` is only ever called on a real switch -- so the
    // test pins the hazard rather than pretending it is not there.
    const once = redesignate(1600, 'in');           // 64 in
    const twice = redesignate(once, 'in');          // reads 65 in, wrongly
    assert.ok(twice > once * 1.01,
        'expected a double application to inflate; if it no longer does, the ' +
        'guard in convertLengths may have become unnecessary -- check before removing it');
});

test('zero stays zero, and negatives are left alone', () => {
    // recessZ is 0 by default and means "no step". Zero is zero in both
    // systems, and a conversion that turned it into 0.25 in would put a
    // staircase on a section that asked for a flush block.
    for (const to of ['mm', 'in']) {
        assert.equal(redesignate(0, to), 0);
        assert.equal(redesignate(-5, to), -5);
    }
});

test('a thin lift keeps a quarter-inch of resolution', () => {
    // The step coarsens with size. A 5-mm chip seal must not be rounded up
    // to half an inch, and a 20-in subbase must not offer quarter-inches no
    // compactor could hit.
    assert.equal(nominalInches(5), 0.25);
    assert.equal(nominalInches(20), 0.75);
    assert.equal(nominalInches(40), 1.5);
    assert.equal(nominalInches(75), 3);
    assert.equal(nominalInches(510), 20);
    // ...and every result is a clean number in its own system.
    for (const mm of [...SHIPPED_MM, ...SECTION_MM]) {
        const inches = nominalInches(mm);
        assert.equal(Math.round(inches * 4), inches * 4,
            `${mm} mm gives ${inches} in, which is not a quarter-inch designation`);
        assert.equal(nominalMm(inches) % 5, 0,
            `${inches} in gives ${nominalMm(inches)} mm, which is not a 5 mm designation`);
    }
});

test('reading and typing are inverses in both systems', () => {
    for (const units of ['mm', 'in']) {
        for (const mm of [76.2, 152.4, 1625.6, 75, 150, 1600]) {
            assert.ok(Math.abs(toMm(inUnits(mm, units), units) - mm) < 1e-9,
                `${mm} does not survive a read-and-type in ${units}`);
        }
    }
});

test('a value prints without a tail of zeros', () => {
    assert.equal(formatLength(76.2, 'in'), '3');
    assert.equal(formatLength(38.1, 'in'), '1.5');
    assert.equal(formatLength(508, 'in'), '20');
    assert.equal(formatLength(75, 'mm'), '75');
    assert.equal(formatLength(1600, 'mm'), '1600');
    // 76.2 / 25.4 is 3.0000000000000004 in binary floating point, and a field
    // showing that would be absurd.
    assert.equal(formatLength(redesignate(75, 'in'), 'in'), '3');
    assert.equal(unitLabelOf('in'), 'in');
    assert.equal(unitLabelOf('mm'), 'mm');
    assert.equal(unitWordOf('in'), 'inches');
    assert.equal(unitWordOf('mm'), 'millimeters');
});

test('every field can reach the designations the templates use', () => {
    // A limit tighter than the data is a field that refuses its own default.
    const reach = (kind, units, value) => {
        const [lo, hi, step] = FIELD_LIMITS[kind][units];
        assert.ok(value >= lo && value <= hi,
            `${kind} in ${units}: ${value} is outside [${lo}, ${hi}]`);
        assert.ok(Math.abs(Math.round(value / step) * step - value) < 1e-9,
            `${kind} in ${units}: ${value} is not a multiple of the ${step} step`);
    };
    for (const mm of SHIPPED_MM) {
        reach('thickness', 'mm', mm);
        reach('thickness', 'in', nominalInches(mm));
    }
    for (const mm of [1600, 1400]) {
        reach('plan', 'mm', mm);
        reach('plan', 'in', nominalInches(mm));
    }
    reach('recess', 'mm', 150); reach('recess', 'in', nominalInches(150));
    reach('subgrade', 'mm', 500); reach('subgrade', 'in', nominalInches(500));
    // And the steps themselves are usable numbers in each system.
    for (const kind of Object.keys(FIELD_LIMITS)) {
        assert.ok(FIELD_LIMITS[kind].in[2] < FIELD_LIMITS[kind].mm[2],
            `${kind}: the inch step should be finer in number than the mm one`);
    }
});
