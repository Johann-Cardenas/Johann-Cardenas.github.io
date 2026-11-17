/* ============================================================
   Cross-Section Studio — SI and English
   (Same logic as the CEE 406 port's units.ts, without the types.)

   Every length in the studio's state is stored in MILLIMETERS, always, and
   the renderer never sees anything else. The unit switch is a presentation
   layer over that, plus the one thing it would be dishonest to leave out: it
   re-rounds the numbers.

   A pavement thickness is a DESIGNATION, not a measurement. FAA P-401 is
   specified as "75 mm (3 in.)" and those are the same lift; nobody builds
   2.953 in. So switching to English does not relabel a 75-mm layer as
   2.95 in, it makes it a 3-in layer, and switching back makes it a 75-mm
   layer again. The table is the soft conversion the specifications
   themselves print, 25 mm to the inch:

       40  1.5     125  5      300  12
       50  2       150  6      350  14
       75  3       200  8      400  16
       100 4       250  10     500  20

   Two constants doing two different jobs, and neither can stand in for the
   other:

     NOMINAL_MM_PER_IN (25)  rounds a designation, and only the unit switch
                             touches it.
     MM_PER_IN (25.4)        draws one. What is stored for a 3-in layer is
                             3 x 25.4, so a section a student labels 3 in is
                             exactly 3 in tall in the figure and in the
                             exported PNG.

   This module has no import of any kind: no THREE, no React, no state. The
   round trips it promises are asserted in units.test.mjs against every
   thickness the studio actually ships, which is the only way to know the two
   constants have not been crossed.
   ============================================================ */

/** Exact. The renderer's constant. */
export const MM_PER_IN = 25.4;

/** Nominal. The unit switch's constant. */
export const NOMINAL_MM_PER_IN = 25;

/**
 * The inch designation a metric length stands for.
 *
 * The step coarsens with size the way the trade does: quarter-inches for a
 * chip seal, half-inches for a surface course, whole inches once you are into
 * base and subbase. A quarter-inch step on a 20-in subbase would offer a
 * precision that no specification, and no compactor, has.
 */
export function nominalInches(mmValue) {
    const raw = mmValue / NOMINAL_MM_PER_IN;
    const step = raw < 1 ? 0.25 : raw < 6 ? 0.5 : 1;
    return Math.round(raw / step) * step;
}

/**
 * ...and the metric designation an inch one stands for.
 *
 * The quarter-inch snap on the way in is not tidying: what arrives here is a
 * designation divided by 25.4 and multiplied by it again, so 1.5 in comes
 * through as 1.4999999999999998. Left alone that lands on the wrong side of
 * a half-way rounding and a 40-mm surface course returns as 35.
 */
export function nominalMm(inValue) {
    const designation = Math.round(inValue * 4) / 4;
    return Math.round((designation * NOMINAL_MM_PER_IN) / 5) * 5;
}

/**
 * Re-express one stored millimeter length as a designation in `to`.
 *
 * Not idempotent, and it must not be: applying the metric-to-English map
 * twice would inflate a length by 1.6% each time, which is exactly the
 * mistake that having two conversion constants invites. Call it on a real
 * switch, and on metric numbers arriving from a template or a reset while
 * English is showing. Zero is zero in both systems and is left alone.
 */
export function redesignate(mmValue, to) {
    if (!(mmValue > 0)) return mmValue;
    return to === 'in'
        ? nominalInches(mmValue) * MM_PER_IN
        : nominalMm(mmValue / MM_PER_IN);
}

/**
 * min / max / step for every length field, in each system.
 *
 * Not decoration. A thickness spinner stepping by 5 in a field showing 3
 * would jump to 8, and the browser's own validation would refuse anything
 * under 5 inches.
 */
export const FIELD_LIMITS = {
    thickness: { mm: [5, 3000, 5], in: [0.25, 120, 0.25] },
    plan: { mm: [500, 20000, 50], in: [20, 800, 1] },
    recess: { mm: [0, 2000, 25], in: [0, 80, 0.5] },
    subgrade: { mm: [50, 2000, 25], in: [2, 80, 0.5] },
};

/** A stored millimeter length, read in `units`. */
export const inUnits = (mmValue, units) =>
    units === 'in' ? mmValue / MM_PER_IN : mmValue;

/** ...and back, for a number the reader typed into a field. */
export const toMm = (v, units) =>
    units === 'in' ? v * MM_PER_IN : v;

/** For a field or a readout. Trailing zeros go, so 3 reads "3" not "3.00". */
export const formatLength = (mmValue, units) =>
    String(Math.round(inUnits(mmValue, units) * 100) / 100);

export const unitLabelOf = (units) => (units === 'in' ? 'in' : 'mm');
export const unitWordOf = (units) => (units === 'in' ? 'inches' : 'millimeters');
