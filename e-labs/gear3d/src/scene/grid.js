/* ============================================================
   Gear3D — ground reference grid
   ------------------------------------------------------------
   A CAD-style ground grid, sized to the model and faded at its
   edges so it reads as a reference plane rather than as a lid on
   the scene.

   Two things make it useful rather than decorative:

   1. SPACING IS A ROUND NUMBER IN THE DISPLAY UNIT, chosen so
      that roughly two dozen divisions span the model. The grid is
      therefore a readable scale in its own right — a viewer can
      count squares. A grid at an arbitrary pitch is just texture.

   2. IT IS PART OF THE SCENE, so it exports exactly as it appears.
      A viewport decoration that vanishes on export would break
      the promise that what you frame is what you get.

   Drawn a fraction of a millimeter below z = 0 so it never
   z-fights with the contact patches, which live exactly on the
   pavement plane.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { MM_TO_SCENE } from '../geometry/assembly.js';

/** How far below the pavement plane the grid sits, in scene meters. */
const GRID_DROP = 0.0015;

/**
 * Round a length to a 1 / 2 / 5 x 10^n value.
 * @param {number} v
 * @returns {number}
 */
function niceStep(v) {
    const exp = Math.floor(Math.log10(Math.max(1e-6, v)));
    const base = Math.pow(10, exp);
    const n = v / base;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * base;
}

/**
 * @typedef {Object} GridOptions
 * @property {number} [targetDivisions=24] approximate minor divisions across the model
 * @property {number} [majorEvery=5]       heavier line every N minor lines
 * @property {string} [color='#16202b']    line color
 * @property {number} [minorOpacity=0.16]
 * @property {number} [majorOpacity=0.34]
 * @property {number} [extentFactor=1.9]   grid size relative to the model
 */

/**
 * Build the grid for a model of a given horizontal extent.
 *
 * @param {number} extentMm largest horizontal dimension of the model
 * @param {GridOptions} [opts]
 * @returns {{object: THREE.LineSegments, spacingMm: number}}
 */
export function buildGrid(extentMm, opts = {}) {
    const targetDiv = opts.targetDivisions ?? 24;
    const majorEvery = opts.majorEvery ?? 5;
    const extentFactor = opts.extentFactor ?? 1.9;

    const spacingMm = niceStep(Math.max(1, extentMm) / targetDiv);
    const halfMm = Math.ceil((extentMm * extentFactor) / 2 / spacingMm) * spacingMm;
    const lines = Math.round((halfMm * 2) / spacingMm);

    const color = new THREE.Color(opts.color ?? '#16202b');
    const minorA = opts.minorOpacity ?? 0.16;
    const majorA = opts.majorOpacity ?? 0.34;

    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const colors = [];

    const half = halfMm * MM_TO_SCENE;
    const step = spacingMm * MM_TO_SCENE;

    /**
     * Alpha falls off with distance from the center so the grid dissolves
     * instead of ending in a hard square edge.
     * @param {number} x @param {number} z @param {number} base
     */
    const push = (x, z, base) => {
        const r = Math.hypot(x, z) / half;
        const fade = Math.max(0, 1 - Math.pow(Math.min(1, r), 1.7));
        positions.push(x, -GRID_DROP, z);
        colors.push(color.r, color.g, color.b, base * fade);
    };

    // Each grid line is SUBDIVIDED rather than drawn as a single segment.
    // A full-length segment has both of its endpoints on the outer edge of
    // the fade, where alpha is zero — and since the color attribute is
    // interpolated between endpoints, the whole line renders invisible.
    // Subdividing lets the alpha rise through the middle, which is the
    // entire point of a faded grid.
    const SUB = 40;
    for (let i = 0; i <= lines; i++) {
        const t = -half + i * step;
        const isMajor = (i - lines / 2) % majorEvery === 0;
        const a = isMajor ? majorA : minorA;
        for (let s = 0; s < SUB; s++) {
            const u0 = -half + (s / SUB) * half * 2;
            const u1 = -half + ((s + 1) / SUB) * half * 2;
            // Lines running along z, at x = t.
            push(t, u0, a); push(t, u1, a);
            // Lines running along x, at z = t.
            push(u0, t, a); push(u1, t, a);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));

    const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false
    });

    const object = new THREE.LineSegments(geo, mat);
    // The grid is generated about its own origin and positioned by the
    // caller: a truck's engineering origin is its FRONT AXLE, not its
    // center, so a grid left at the world origin would sit under only the
    // front half of the vehicle.
    object.name = 'ground-grid';
    object.userData.pickable = false;
    object.renderOrder = -2;
    object.frustumCulled = false;

    return { object, spacingMm };
}
