/* ============================================================
   Gear3D — unit layout resolver
   ------------------------------------------------------------
   Turns a unit definition into a flat list of tires with real
   engineering-frame positions, plus the derived dimensions the
   annotation engine draws.

   Deliberately free of three.js and of the DOM. The renderer,
   the dimension engine and the FEM footprint export all consume
   the SAME output of this module, which is the only way those
   three can be guaranteed to agree about where a tire is.
   ============================================================ */

'use strict';

import { resolveTire } from './tires.js';
import { canonical, massToForceKn } from './units.js';
import { TIRE_CONFIGS } from './schema.js';

/**
 * @typedef {Object} Wheel
 * @property {string} id            unique, e.g. 'A2-R-out'
 * @property {string} axleId        owning axle or gear
 * @property {string} groupId       owning axle group ('' for aircraft)
 * @property {string} positionId    wheel position, e.g. 'A2-R'
 * @property {'L'|'R'|'C'} side
 * @property {number} x             mm, engineering longitudinal
 * @property {number} y             mm, engineering transverse
 * @property {number} z             mm, wheel CENTRE height above pavement
 * @property {string} tire          designation
 * @property {import('./tires.js').TireGeometry} geometry
 * @property {number|null} loadKn   load carried by THIS tire
 * @property {string} config        STA | DTA | WBT | gear type
 * @property {number} [row]         tandem row index, aircraft only
 * @property {1|-1} discSign        which way along +y the wheel DISC faces
 */

/**
 * @typedef {Object} ResolvedAxle
 * @property {string} id
 * @property {string} role
 * @property {number} x
 * @property {number} trackWidth
 * @property {number} axleHeight    mm, centre height = tire static loaded radius
 * @property {string} tireConfig
 * @property {number|null} dualSpacing
 * @property {number} wheelPositions
 * @property {import('./tires.js').TireGeometry} geometry
 * @property {number|null} loadKn   total on the axle
 * @property {string} groupId
 */

/**
 * @typedef {Object} Layout
 * @property {object} unit    the source definition this layout was built from
 * @property {Wheel[]} wheels
 * @property {ResolvedAxle[]} axles
 * @property {Array<{id:string, type:string, axles:string[], spacing:number|null}>} groups
 * @property {'truck'|'aircraft'} domain
 * @property {{minX:number, maxX:number, minY:number, maxY:number, maxZ:number}} extents
 * @property {Object} derived  named dimensions for the annotation engine
 */

/**
 * Resolve a unit into wheels and derived dimensions.
 *
 * @param {object} unit
 * @param {{slr?: object}} [opts] forwarded to the tire geometry model
 * @returns {Layout}
 */
export function resolveLayout(unit, opts = {}) {
    return unit.domain === 'aircraft'
        ? resolveAircraft(unit, opts)
        : resolveTruck(unit, opts);
}

/* ------------------------------------------------------------
   Trucks
   ------------------------------------------------------------ */

/**
 * @param {object} unit
 * @param {object} opts
 * @returns {Layout}
 */
function resolveTruck(unit, opts) {
    /** @type {Wheel[]} */
    const wheels = [];
    /** @type {ResolvedAxle[]} */
    const axles = [];

    const groupOf = new Map();
    for (const g of unit.axleGroups || []) {
        for (const a of g.axles || []) groupOf.set(a, g.id);
    }

    for (const a of unit.axles) {
        const t = resolveTire(a.tire, opts.slr);
        const geometry = t.geometry;
        const positions = a.wheelPositions ?? 2;
        const perPosition = TIRE_CONFIGS[a.tireConfig]?.tiresPerPosition ?? 1;
        const totalTires = positions * perPosition;
        const axleLoadKn = canonical(a.load, 'force');
        const perTireKn = axleLoadKn == null ? null : axleLoadKn / totalTires;

        axles.push({
            id: a.id,
            role: a.role,
            x: a.x,
            trackWidth: a.trackWidth,
            axleHeight: geometry.staticLoadedRadius,
            tireConfig: a.tireConfig,
            dualSpacing: a.dualSpacing ?? null,
            wheelPositions: positions,
            geometry,
            loadKn: axleLoadKn,
            groupId: groupOf.get(a.id) || ''
        });

        const sides = positions === 1 ? [{ s: 'C', sign: 0 }] : [{ s: 'L', sign: -1 }, { s: 'R', sign: 1 }];
        for (const { s, sign } of sides) {
            const yPos = sign * (a.trackWidth / 2);
            const positionId = `${a.id}-${s}`;

            if (a.tireConfig === 'DTA') {
                // Inner and outer tire of the dual pair, straddling the
                // wheel-position centreline by half the dual spacing.
                const half = (a.dualSpacing || 0) / 2;
                // "Inner" is the one nearer the vehicle centreline.
                const inner = yPos - sign * half;
                const outer = yPos + sign * half;
                // Dual wheels bolt together BACK TO BACK, so each disc faces
                // the other tire of the pair — the two wheels of a dual are
                // mirror images, not copies. Getting this wrong puts both
                // wheel faces on the same side and the assembly stops
                // reading as a dual.
                const d = /** @type {1|-1} */ (sign > 0 ? 1 : -1);
                wheels.push(makeWheel(`${positionId}-in`, a, positionId, s, inner, geometry, perTireKn, groupOf, d));
                wheels.push(makeWheel(`${positionId}-out`, a, positionId, s, outer, geometry, perTireKn, groupOf, /** @type {1|-1} */(-d)));
            } else {
                // A single wheel's disc faces outboard, away from the
                // vehicle centreline.
                const d = /** @type {1|-1} */ (sign >= 0 ? 1 : -1);
                wheels.push(makeWheel(`${positionId}`, a, positionId, s, yPos, geometry, perTireKn, groupOf, d));
            }
        }
    }

    return finish(unit, wheels, axles, unit.axleGroups || [], 'truck');
}

/**
 * @param {string} id
 * @param {object} a axle
 * @param {string} positionId
 * @param {'L'|'R'|'C'} side
 * @param {number} y
 * @param {import('./tires.js').TireGeometry} geometry
 * @param {number|null} loadKn
 * @param {Map<string,string>} groupOf
 * @param {1|-1} [discSign=1]
 * @returns {Wheel}
 */
function makeWheel(id, a, positionId, side, y, geometry, loadKn, groupOf, discSign = 1) {
    return {
        id,
        axleId: a.id,
        groupId: groupOf.get(a.id) || '',
        positionId,
        side,
        x: a.x,
        y,
        z: geometry.staticLoadedRadius,
        tire: a.tire,
        geometry,
        loadKn,
        config: a.tireConfig,
        discSign
    };
}

/* ------------------------------------------------------------
   Aircraft
   ------------------------------------------------------------ */

/**
 * @param {object} unit
 * @param {object} opts
 * @returns {Layout}
 */
function resolveAircraft(unit, opts) {
    /** @type {Wheel[]} */
    const wheels = [];
    /** @type {ResolvedAxle[]} */
    const axles = [];

    const mtowKg = canonical(unit.mtow, 'mass');
    const totalKn = mtowKg == null ? null : massToForceKn(mtowKg);
    const pctMain = unit.percentOnMainGear;

    const mains = unit.gears.filter((g) => isMain(g));
    const noses = unit.gears.filter((g) => !isMain(g));

    // Tire count on each side of the main/nose split, so a stated
    // percent-on-main-gear can be turned into a per-tire load.
    const mainTires = mains.reduce((n, g) => n + wheelsOnGear(g), 0);
    const noseTires = noses.reduce((n, g) => n + wheelsOnGear(g), 0);

    const mainPerTireKn = (totalKn != null && pctMain != null && mainTires > 0)
        ? (totalKn * (pctMain / 100)) / mainTires
        : null;
    const nosePerTireKn = (totalKn != null && pctMain != null && noseTires > 0)
        ? (totalKn * (1 - pctMain / 100)) / noseTires
        : null;

    for (const g of unit.gears) {
        const t = resolveTire(g.tire, opts.slr);
        const geometry = t.geometry;
        const across = g.wheelsAcross ?? (g.type === 'dual' ? 2 : 1);
        const rows = g.tandemRows ?? 1;
        const dual = g.dualSpacing || 0;
        const tandem = g.tandemSpacing || 0;
        const main = isMain(g);
        // A bogie is not always evenly spaced. The C-5's quadruple axle sits
        // in two pairs with a wider gap up the middle (34 in, 53 in, 34 in),
        // the IL-76's is 620/820/620 mm, and the C-17's triple is 1079.5 and
        // 1028.7 mm. `wheelOffsets` carries those positions as published;
        // absent it the wheels are spread evenly at `dualSpacing`, which is
        // every other gear in the library.
        const offsets = Array.isArray(g.wheelOffsets) && g.wheelOffsets.length === across
            ? g.wheelOffsets
            : null;
        const explicit = canonical(g.load, 'force');
        const perTireKn = explicit != null
            ? explicit / (across * rows)
            : (main ? mainPerTireKn : nosePerTireKn);

        axles.push({
            id: g.id,
            role: main ? 'main' : 'nose',
            x: g.x,
            trackWidth: offsets
                ? Math.max(...offsets) - Math.min(...offsets)
                : dual * (across - 1),
            axleHeight: geometry.staticLoadedRadius,
            tireConfig: across > 1 ? 'DTA' : 'STA',
            dualSpacing: dual || null,
            wheelPositions: across,
            geometry,
            loadKn: perTireKn == null ? null : perTireKn * across * rows,
            groupId: ''
        });

        for (let row = 0; row < rows; row++) {
            const x = g.x + (row - (rows - 1) / 2) * tandem;
            // Some bogies are not a constant width. The A380's body gear is a
            // tridem whose middle axle is 20 mm wider than the outer two
            // (1550 vs 1530 mm), which is published and therefore represented
            // rather than averaged away. Absent the array every row uses the
            // single dualSpacing, which is every other gear in the library.
            const rowDual = Array.isArray(g.dualSpacingByRow)
                ? (g.dualSpacingByRow[row] ?? dual)
                : dual;
            for (let i = 0; i < across; i++) {
                // Explicit offsets win over the even spread. They are absolute
                // positions relative to the strut centreline, so they are NOT
                // scaled by the row's dual spacing — a bogie that states both
                // is stating the offsets and a nominal pitch, and the offsets
                // are the measurement.
                const off = offsets ? offsets[i] : (i - (across - 1) / 2) * rowDual;
                const y = g.y + off;
                wheels.push({
                    id: `${g.id}-r${row + 1}-w${i + 1}`,
                    axleId: g.id,
                    groupId: '',
                    positionId: `${g.id}-r${row + 1}`,
                    side: y < 0 ? 'L' : y > 0 ? 'R' : 'C',
                    x, y,
                    z: geometry.staticLoadedRadius,
                    tire: g.tire,
                    geometry,
                    loadKn: perTireKn,
                    config: g.type || (across > 1 ? 'dual' : 'single'),
                    row,
                    discSign: /** @type {1|-1} */ (off >= 0 ? 1 : -1)
                });
            }
        }
    }

    return finish(unit, wheels, axles, [], 'aircraft');
}

/** @param {object} g @returns {boolean} */
function isMain(g) {
    if (g.role) return g.role !== 'nose';
    return !/^N/i.test(g.id);
}

/** @param {object} g @returns {number} */
function wheelsOnGear(g) {
    const across = g.wheelsAcross ?? (g.type === 'dual' ? 2 : 1);
    return across * (g.tandemRows ?? 1);
}

/* ------------------------------------------------------------
   Shared tail: extents and derived dimensions
   ------------------------------------------------------------ */

/**
 * @param {object} unit
 * @param {Wheel[]} wheels
 * @param {ResolvedAxle[]} axles
 * @param {any[]} groups
 * @param {'truck'|'aircraft'} domain
 * @returns {Layout}
 */
function finish(unit, wheels, axles, groups, domain) {
    const extents = {
        minX: Math.min(...wheels.map((w) => w.x - w.geometry.sectionWidth * 0.1)),
        maxX: Math.max(...wheels.map((w) => w.x + w.geometry.sectionWidth * 0.1)),
        minY: Math.min(...wheels.map((w) => w.y - w.geometry.sectionWidth / 2)),
        maxY: Math.max(...wheels.map((w) => w.y + w.geometry.sectionWidth / 2)),
        maxZ: Math.max(...wheels.map((w) => w.z + w.geometry.freeRadius))
    };

    const derived = {
        /** Outside-to-outside width over the widest axle. */
        overallWidth: extents.maxY - extents.minY,
        /** First to last axle centreline. */
        outerBridge: axles.length > 1 ? axles[axles.length - 1].x - axles[0].x : 0,
        /** Consecutive axle spacings, front to rear. */
        axleSpacings: axles.slice(1).map((a, i) => ({
            from: axles[i].id, to: a.id, value: a.x - axles[i].x
        })),
        /** Group spacings, centre of first axle to centre of last within a group. */
        groupSpans: groups
            .filter((g) => (g.axles || []).length > 1)
            .map((g) => {
                const xs = g.axles.map((id) => axles.find((a) => a.id === id)?.x).filter((v) => v != null);
                return { id: g.id, type: g.type, value: Math.max(...xs) - Math.min(...xs), spacing: g.spacing };
            }),
        tireCount: wheels.length
    };

    if (domain === 'aircraft') {
        const mains = axles.filter((a) => a.role === 'main');
        const noses = axles.filter((a) => a.role === 'nose');
        if (mains.length && noses.length) {
            // Weighted by the number of tires on each strut, not a plain mean
            // over struts. On every two-strut aircraft, and on a 747 where all
            // four bogies carry four tires, the two agree. On an A380 they do
            // not: the body gear carries twelve of the twenty main tires, so
            // the load centroid sits 328 mm aft of the midpoint between wing
            // and body gear. Since every main tire carries the same load, tire
            // count is the correct weight.
            let num = 0;
            let den = 0;
            for (const a of mains) {
                const n = wheels.filter((w) => w.axleId === a.id).length || 1;
                num += a.x * n;
                den += n;
            }
            derived.wheelbase = num / den - noses[0].x;
        }
        if (mains.length >= 2) {
            // Centreline-to-centreline track between the main gear struts.
            const ys = mains.map((a) => mainGearY(a, wheels));
            derived.mainGearTrack = Math.max(...ys) - Math.min(...ys);

            // Outside-to-outside over the main gear tires. This is the
            // quantity the FAA Aircraft Characteristics Database publishes,
            // and it is NOT the track — the database defines it as the
            // distance between outer tires. Reporting both, explicitly
            // labelled, is what stops the two being confused.
            const mainWheels = wheels.filter((w) => mains.some((a) => a.id === w.axleId));
            if (mainWheels.length) {
                const lo = Math.min(...mainWheels.map((w) => w.y - w.geometry.sectionWidth / 2));
                const hi = Math.max(...mainWheels.map((w) => w.y + w.geometry.sectionWidth / 2));
                derived.mainGearOuterWidth = hi - lo;
            }
        }
        if (unit.mainGearOuterWidth != null) {
            derived.statedMainGearOuterWidth = unit.mainGearOuterWidth;
        }
        derived.assumedFields = unit.assumedFields || [];
    }

    // The unit travels with its layout. Consumers that need to reach back to
    // the source definition — the chassis silhouette needs bodyType and
    // overallLength — should not have to be handed it separately and risk
    // being given a different one than the layout was built from.
    return { unit, wheels, axles, groups, domain, extents, derived };
}

/**
 * Transverse centre of a gear, taken from its wheels.
 * @param {ResolvedAxle} a
 * @param {Wheel[]} wheels
 * @returns {number}
 */
function mainGearY(a, wheels) {
    const ws = wheels.filter((w) => w.axleId === a.id);
    if (!ws.length) return 0;
    return ws.reduce((s, w) => s + w.y, 0) / ws.length;
}

/**
 * Swap an axle's dual tire assembly for a wide-base single, and report the
 * consequences a pavement researcher actually wants to see.
 *
 * The retrofit keeps the OUTER edge of the tire envelope where it was, which
 * is what happens in practice: the wheel offset changes but the vehicle's
 * legal width does not.
 *
 * The wheel-position centreline consequently moves OUTBOARD, and the reported
 * track widens. That is not a bug and it is the number a wide-base study is
 * after: the outer tire of a dual pair sits half a dual spacing outboard of
 * the pair's centreline, so a single wide tire whose outer edge lands in the
 * same place has its centre further out than the pair's centreline was. The
 * load centroid moves outboard with it.
 *
 * @param {object} axle a truck axle definition (not mutated)
 * @param {string} wbtDesignation e.g. '445/50R22.5'
 * @param {object} [opts]
 * @returns {{axle: object, report: object}}
 */
export function swapToWideBase(axle, wbtDesignation, opts = {}) {
    if (axle.tireConfig !== 'DTA') {
        throw new Error(`Axle ${axle.id} is ${axle.tireConfig}; only a DTA can be swapped to a wide-base tire.`);
    }
    const before = resolveTire(axle.tire, opts.slr);
    const after = resolveTire(wbtDesignation, opts.slr);

    const half = (axle.dualSpacing || 0) / 2;
    // Outer edge of the outer dual, measured from the vehicle centreline.
    const outerEdge = axle.trackWidth / 2 + half + before.geometry.sectionWidth / 2;
    // Put the wide-base tire's outer edge in the same place.
    const newTrackWidth = 2 * (outerEdge - after.geometry.sectionWidth / 2);

    const newAxle = {
        ...axle,
        tireConfig: 'WBT',
        tire: wbtDesignation,
        dualSpacing: null,
        trackWidth: Math.round(newTrackWidth * 10) / 10,
        source: `${axle.source} — wide-base retrofit: dual ${axle.tire} replaced by ${wbtDesignation}, `
            + 'outer tire edge held at its original transverse position so the vehicle\'s overall '
            + 'width is unchanged. Track width is a derived consequence, not an independent input.'
    };

    // Two tires became one, so the per-position contact width changes.
    const widthBefore = 2 * before.geometry.sectionWidth;
    const widthAfter = after.geometry.sectionWidth;
    const centroidBefore = axle.trackWidth / 2;
    const centroidAfter = newTrackWidth / 2;

    return {
        axle: newAxle,
        report: {
            from: axle.tire,
            to: wbtDesignation,
            trackWidthBefore: axle.trackWidth,
            trackWidthAfter: newAxle.trackWidth,
            trackWidthChange: newAxle.trackWidth - axle.trackWidth,
            sectionWidthBefore: widthBefore,
            sectionWidthAfter: widthAfter,
            sectionWidthChange: widthAfter - widthBefore,
            sectionWidthChangePct: (widthAfter / widthBefore - 1) * 100,
            loadCentroidShift: centroidAfter - centroidBefore,
            tiresBefore: 4,
            tiresAfter: 2,
            note: 'Contact AREA depends on load and inflation pressure, not on section width alone. '
                + 'Open the contact-patch panel for the area comparison at the stated load and pressure.'
        }
    };
}
