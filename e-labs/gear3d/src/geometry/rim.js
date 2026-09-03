/* ============================================================
   Gear3D — procedural wheel rim
   ------------------------------------------------------------
   Local frame matches the tire: origin at the wheel center,
   rotation axis +X, millimeters.

   The rim is built from two parts:
     - the barrel, a lathed rim section running from the inboard
       flange tip to the outboard flange tip
     - the disc, a DISHED plate: a flat outboard web carrying the
       hub pad and the hand holes, sweeping back on a cone to
       where it welds into the drop-center well

   Truck wheels are dished: the disc sits offset from the barrel
   centerline. That offset is what makes a dual pair's two wheels
   mount back-to-back with the correct spacing, so it is a real
   parameter, not decoration.

   WHERE THE DISC FACE IS, IS PUBLISHED HERE AND NOWHERE ELSE.
   The disc and the hub are built by different modules, and they
   used to derive that station independently — rim.js from
   `offsetRatio`, hub.js from the boss length, which is not a
   function of it at all. They disagreed, silently, by 24 to
   74 mm on every tire in the library, and the lug nuts were
   therefore drawn INSIDE the disc, where nothing could ever see
   them. {@link wheelStations} is now the single answer to "how
   is this wheel laid out", and both modules read it.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Wheel proportions, as fractions of the RIM RADIUS.
 *
 * Taken off a 22.5 x 8.25 hub-piloted disc wheel, the North American heavy
 * truck standard — a 335 mm stud circle and a 220 mm hub bore on a 572 mm rim,
 * which is where 0.586 and 0.385 come from. They are held as ratios so that an
 * aircraft wheel and a passenger wheel stay plausible without a second table.
 * Nothing here is a measured dimension of any particular wheel, and nothing in
 * the app reports one: the wheel is drawn to make the tire and the axle
 * readable, and the dimensions that ARE reported all come from the layout.
 */
export const WHEEL = Object.freeze({
    flange: 0.048,       // flange height above the bead seat
    drop: 0.062,         // drop-center well depth below the bead seat
    bore: 0.385,         // hub bore
    pad: 0.630,          // raised hub-pad face, outer radius
    studCircle: 0.586,   // stud circle — 335 mm on a 572 mm rim
    webOuter: 0.865,     // outer radius of the flat web
    // A hand hole has to READ as a hole, which means clearing the raised hub
    // pad and the nuts standing on it, and staying inside the rim of the web.
    // What it does NOT have to do is hide behind the brake drum: these were
    // briefly pulled in to 0.660 so the drum could back every one of them, on
    // the evidence that an unbacked hole rendered as a white disc — a line of
    // sight through the wheel, through the far sidewall and out to the
    // background. That was a real defect with the wrong cause. On a real wheel
    // the holes DO reach past the drum; what stops the light is the inside of
    // the tire, and the fix is to draw it (see the `rubberSidewall` material).
    handHoleRing: 0.745, // hand-hole centers
    handHole: 0.095,     // hand-hole radius
    webThickness: 0.035, // web plate thickness
    dishDepth: 0.20      // web-to-weld offset, as a fraction of RIM WIDTH
});

/**
 * @typedef {Object} RimOptions
 * @property {number} [widthRatio=0.72]   rim width as a fraction of tire section width
 * @property {number} [offsetRatio=0.0]   disc offset from barrel center, fraction of rim width
 * @property {number} [handHoles=5]       lightening holes in the disc
 * @property {number} [handHoleRatio]     hole radius, fraction of rim radius
 * @property {number} [boreRatio]         hub bore radius, fraction of rim radius
 * @property {number} [radialSegments]   overrides the quality preset
 * @property {'draft'|'standard'|'high'} [quality='standard']
 * @property {'steel'|'aluminum'} [style='aluminum']
 */

/** Circumferential segments per quality level. A rim is a wide, smooth,
 *  specular band — it shows faceting far more readily than rubber does. */
export const RIM_QUALITY = Object.freeze({ draft: 40, standard: 72, high: 112 });

/**
 * @param {RimOptions} opts
 * @returns {number}
 */
function rimSegments(opts) {
    return opts.radialSegments ?? RIM_QUALITY[opts.quality ?? 'standard'] ?? RIM_QUALITY.standard;
}

/**
 * Every station and radius the wheel is built from, in the local frame.
 *
 * `offsetRatio` carries the handedness: the assembly gives a left-hand wheel a
 * negative offset, and everything axial below follows its sign, so a dual pair
 * mounts back to back without anything being mirrored. (A negative scale would
 * reverse the triangle winding and light the wheel inside out — the same trap
 * hub.js documents for its own handedness.)
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 */
export function wheelStations(g, opts = {}) {
    const r = g.rimRadius;
    const rimWidth = g.sectionWidth * (opts.widthRatio ?? 0.72);
    const offset = opts.offsetRatio ?? 0;
    const sign = offset < 0 ? -1 : 1;

    const webThickness = Math.max(6, r * WHEEL.webThickness);
    const webX = rimWidth * offset;

    return {
        sign,
        rimWidth,
        half: rimWidth / 2,
        beadR: r,
        flange: r * WHEEL.flange,
        wellR: r - r * WHEEL.drop,
        boreR: r * (opts.boreRatio ?? WHEEL.bore),
        padR: r * WHEEL.pad,
        studCircleR: r * WHEEL.studCircle,
        webOuterR: r * WHEEL.webOuter,
        handHoleRingR: r * WHEEL.handHoleRing,
        handHoleR: r * (opts.handHoleRatio ?? WHEEL.handHole),
        webThickness,
        /** Where the tire's bead sits on the rim — see rimProfile. The TIRE
         *  needs this: its meridian has to end on the bead seat and inside the
         *  flange, and a tire that ends at the barrel's half-width instead
         *  pushes its bead 2 mm proud of the flange tip, where the two
         *  surfaces very nearly coincide and z-fight into a stippled ring
         *  around every wheel. */
        beadSeatX: rimWidth / 2 - r * WHEEL.flange * 1.25,
        /** Mid-plane of the flat web. */
        webX,
        /** The outboard face of the disc — the plane a lug nut has to stand ON. */
        faceX: webX + sign * webThickness / 2,
        /** Where the dish cone meets the drop-center well. */
        weldX: webX - sign * rimWidth * WHEEL.dishDepth
    };
}

/**
 * Meridian profile of the rim barrel, in (radius, axial) millimeters.
 *
 * A RIM SECTION, NOT A PULLEY. Both ends used to turn in to 0.60 of the rim
 * radius, which closed the silhouette but drew a pair of deep cones that were
 * the largest and brightest thing on the wheel — the assembly read as a spool
 * with tires on it rather than as a wheel. A real rim is a thin shell that
 * ends at its flange tip, so this one does too, and the barrel is drawn
 * double-sided (see the `rimBarrel` material) so that its inside is there to
 * be seen through the hand holes, which is where a viewer looks for it.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 * @returns {THREE.Vector2[]}
 */
export function rimProfile(g, opts = {}) {
    const s = wheelStations(g, opts);
    const half = s.half;
    const r = s.beadR;
    const flange = s.flange;
    const drop = r * WHEEL.drop;
    const width = s.rimWidth;

    /** @type {THREE.Vector2[]} */
    const p = [];
    const add = (rr, a) => p.push(new THREE.Vector2(rr, a));

    // THE TWO BEAD SEATS ARE SYMMETRIC. Only the WELL is offset.
    //
    // They were not: the inboard seat sat a flange-height in from its flange
    // while the outboard one sat at 0.755 of the width, which is 52 mm further
    // in — so the barrel rose gently from the outboard seat to its flange over
    // a fifth of the rim's width. A tire is symmetric by construction (its
    // meridian is mirrored from a half, which is the guarantee tire.js is
    // built on), so no tire could seat on both: whichever bead was placed
    // correctly, the other one crossed the barrel, and the two surfaces
    // interpenetrated into a ring of alternating rubber-and-rim teeth around
    // every wheel. A real rim's seats ARE symmetric — both beads seat at the
    // same diameter, the same distance from their own flange — and it is only
    // the drop-center well that is offset, so that is what is offset here.
    const seat = half - flange * 1.25;

    // Inboard flange, rolled over its tip.
    add(r + flange * 0.62, -half - flange * 0.14);
    add(r + flange, -half + flange * 0.16);       // inboard flange tip
    add(r + flange * 0.72, -half + flange * 0.72);
    add(r, -seat);                                // inboard bead seat
    add(r - drop * 0.55, -half + width * 0.24);
    add(r - drop, -half + width * 0.34);          // into the drop-center well
    add(r - drop, -half + width * 0.56);
    add(r - drop * 0.45, -half + width * 0.68);
    add(r, seat);                                 // outboard bead seat
    // The outboard flange is the polished lip that catches the key light and is
    // the single most legible piece of a wheel in a three-quarter view, so it
    // gets extra points to keep the highlight band smooth.
    add(r + flange * 0.72, half - flange * 0.72);
    add(r + flange, half - flange * 0.16);
    add(r + flange * 1.02, half + flange * 0.02);
    add(r + flange * 0.62, half + flange * 0.14);

    return p;
}

/**
 * Build the rim barrel.
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildRimBarrel(g, opts = {}) {
    const geo = new THREE.LatheGeometry(rimProfile(g, opts), rimSegments(opts));
    geo.rotateZ(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Build the rim disc: a dished plate, welded into the drop-center well at its
 * outer edge and carrying the hub pad and the hand holes on its flat face.
 *
 * Three pieces, merged so the whole wheel stays one instanced draw:
 *   - the WEB, an extruded annulus with the hand holes cut through it
 *   - the DISH, a lathed cone from the web's rim out to the barrel weld
 *   - the HUB PAD, a short raised boss around the bore, which is the face the
 *     studs and nuts stand on
 *
 * The dish is what makes the wheel read as a wheel rather than as a washer
 * suspended inside a tire: the disc used to be a flat plate whose outer edge
 * stopped in mid-air at 0.94 of the rim radius, touching nothing at all.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildRimDisc(g, opts = {}) {
    const s = wheelStations(g, opts);
    const seg = rimSegments(opts);
    const curve = Math.max(24, Math.round(seg * 0.55));
    const holes = opts.handHoles ?? 5;

    /** @type {THREE.BufferGeometry[]} */
    const parts = [];

    /* ---- web: the flat outboard plate, hand holes cut through ---- */
    const shape = new THREE.Shape();
    shape.absarc(0, 0, s.webOuterR, 0, Math.PI * 2, false);
    const bore = new THREE.Path();
    bore.absarc(0, 0, s.boreR, 0, Math.PI * 2, true);
    shape.holes.push(bore);
    for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2;
        const h = new THREE.Path();
        h.absarc(Math.cos(a) * s.handHoleRingR, Math.sin(a) * s.handHoleRingR,
            s.handHoleR, 0, Math.PI * 2, true);
        shape.holes.push(h);
    }

    const web = new THREE.ExtrudeGeometry(shape, {
        depth: s.webThickness,
        bevelEnabled: true,
        bevelThickness: s.webThickness * 0.20,
        bevelSize: s.webThickness * 0.20,
        bevelSegments: opts.quality === 'high' ? 4 : 2,
        curveSegments: curve
    });
    // Extrude builds along +Z; rotate so the plate's normal is the wheel axis.
    web.translate(0, 0, -s.webThickness / 2);
    web.rotateY(Math.PI / 2);
    web.translate(s.webX, 0, 0);
    parts.push(web);

    /* ---- dish: the cone from the web's rim out to the drop-center weld ---- */
    const dish = new THREE.LatheGeometry([
        new THREE.Vector2(s.webOuterR, s.webX),
        new THREE.Vector2(s.webOuterR + (s.wellR - s.webOuterR) * 0.45,
            s.webX + (s.weldX - s.webX) * 0.62),
        new THREE.Vector2(s.wellR, s.weldX)
    ], seg);
    dish.rotateZ(-Math.PI / 2);
    parts.push(dish);

    /* ---- hub pad: the raised face the studs stand on ---- */
    const padRise = s.webThickness * 0.55;
    const padFace = new THREE.RingGeometry(s.boreR, s.padR, seg, 1);
    padFace.rotateY(s.sign * Math.PI / 2);
    padFace.translate(s.faceX + s.sign * padRise, 0, 0);
    parts.push(padFace);

    const padWall = new THREE.CylinderGeometry(s.padR, s.padR, padRise, seg, 1, true);
    padWall.rotateZ(Math.PI / 2);
    padWall.translate(s.faceX + s.sign * padRise / 2, 0, 0);
    parts.push(padWall);

    // mergeGeometries refuses a mix of indexed and non-indexed inputs, and this
    // disc is exactly that mix: ExtrudeGeometry emits no index, while Lathe,
    // Ring and Cylinder all do. Flattening the indexed ones first is the cheap
    // side of the choice — these are small parts, and the alternative is
    // re-indexing the extrusion, which has to weld vertices to do it.
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const merged = mergeGeometries(flat, false);
    for (const p of new Set([...parts, ...flat])) p.dispose();
    if (!merged) throw new Error('Rim disc merge failed — the parts have mismatched attributes.');

    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
}

/**
 * Both rim parts as one group.
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {THREE.Material} material
 * @param {RimOptions} [opts]
 * @returns {THREE.Group}
 */
export function buildRim(g, material, opts = {}) {
    const grp = new THREE.Group();
    grp.name = 'rim';
    const barrel = new THREE.Mesh(buildRimBarrel(g, opts), material);
    barrel.name = 'rim-barrel';
    const disc = new THREE.Mesh(buildRimDisc(g, opts), material);
    disc.name = 'rim-disc';
    for (const m of [barrel, disc]) { m.castShadow = true; m.receiveShadow = true; }
    grp.add(barrel, disc);
    return grp;
}
