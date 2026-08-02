/* ============================================================
   Gear3D — procedural wheel rim
   ------------------------------------------------------------
   Local frame matches the tire: origin at the wheel centre,
   rotation axis +X, millimetres.

   The rim is built from two parts:
     - the barrel, a lathed surface of revolution from the inner
       flange to the outer flange
     - the disc face, an extruded shape with hand holes and a
       central bore

   Truck wheels are dished: the disc sits offset from the barrel
   centreline. That offset is what makes a dual pair's two wheels
   mount back-to-back with the correct spacing, so it is a real
   parameter, not decoration.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/**
 * @typedef {Object} RimOptions
 * @property {number} [widthRatio=0.72]   rim width as a fraction of tire section width
 * @property {number} [offsetRatio=0.0]   disc offset from barrel centre, fraction of rim width
 * @property {number} [handHoles=5]       lightening holes in the disc
 * @property {number} [handHoleRatio=0.17] hole diameter, fraction of rim diameter
 * @property {number} [boreRatio=0.30]    central bore diameter, fraction of rim diameter
 * @property {number} [radialSegments]   overrides the quality preset
 * @property {'draft'|'standard'|'high'} [quality='standard']
 * @property {'steel'|'aluminium'} [style='aluminium']
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
 * Meridian profile of the rim barrel, in (radius, axial) millimetres.
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 * @returns {THREE.Vector2[]}
 */
export function rimProfile(g, opts = {}) {
    const width = g.sectionWidth * (opts.widthRatio ?? 0.72);
    const half = width / 2;
    const r = g.rimRadius;
    const flange = r * 0.048;      // flange height above the bead seat
    const drop = r * 0.062;        // drop-centre well depth

    /** @type {THREE.Vector2[]} */
    const p = [];
    const add = (rr, a) => p.push(new THREE.Vector2(rr, a));

    // Inner lip, tucked under so the barrel reads as a closed section.
    add(r * 0.60, -half);
    add(r + flange * 0.55, -half - flange * 0.10);
    add(r + flange, -half + flange * 0.18);    // inner flange tip, rolled
    add(r + flange * 0.72, -half + flange * 0.72);
    add(r, -half + flange * 1.25);             // inner bead seat
    add(r - drop * 0.55, -half + width * 0.22);
    add(r - drop, -half + width * 0.34);       // into the drop-centre well
    add(r - drop, -half + width * 0.56);
    add(r - drop * 0.45, -half + width * 0.66);
    add(r, -half + width * 0.755);             // outer bead seat
    // The outer flange is the polished lip that catches the key light and is
    // the single most legible piece of a wheel in a three-quarter view, so it
    // gets extra points to keep the highlight band smooth.
    add(r + flange * 0.72, half - flange * 0.80);
    add(r + flange, half - flange * 0.22);
    add(r + flange * 1.02, half + flange * 0.06);
    add(r + flange * 0.60, half + flange * 0.14);
    add(r * 0.60, half);

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
 * Build the rim disc face: a flat annulus with a central bore and a ring
 * of hand holes, extruded to a realistic disc thickness.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {RimOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildRimDisc(g, opts = {}) {
    const rOuter = g.rimRadius * 0.94;
    const rBore = g.rimRadius * (opts.boreRatio ?? 0.30);
    const holes = opts.handHoles ?? 5;
    const rHole = g.rimRadius * (opts.handHoleRatio ?? 0.17);
    const rHoleRing = (rOuter + rBore) / 2;
    const thickness = Math.max(6, g.rimRadius * 0.035);

    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);

    const bore = new THREE.Path();
    bore.absarc(0, 0, rBore, 0, Math.PI * 2, true);
    shape.holes.push(bore);

    for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2;
        const h = new THREE.Path();
        h.absarc(Math.cos(a) * rHoleRing, Math.sin(a) * rHoleRing, rHole, 0, Math.PI * 2, true);
        shape.holes.push(h);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: thickness * 0.20,
        bevelSize: thickness * 0.20,
        bevelSegments: opts.quality === 'high' ? 4 : 2,
        curveSegments: Math.max(24, Math.round(rimSegments(opts) * 0.55))
    });

    // Extrude builds along +Z; rotate so the disc's normal is the wheel axis.
    geo.translate(0, 0, -thickness / 2);
    geo.rotateY(Math.PI / 2);

    const width = g.sectionWidth * (opts.widthRatio ?? 0.72);
    geo.translate(width * (opts.offsetRatio ?? 0) , 0, 0);

    geo.computeVertexNormals();
    return geo;
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
