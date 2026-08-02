/* ============================================================
   Gear3D — hub, brake drum and lug nuts
   ------------------------------------------------------------
   Local frame matches the tire and rim: origin at the wheel
   centre, rotation axis +X, millimetres.

   Emitted as ONE merged geometry rather than a Group, so the hub
   can be instanced alongside the tire and rim. A class 13 unit
   has 34 wheels; a Group per wheel would be 34 separate draw
   calls for the smallest part in the frame.

   This is not decoration. Without a hub the wheel disc's centre
   bore is an open hole, and a viewer looking into an isolated
   wheel sees straight through it to the axle beam and the
   differential behind — which reads as a modelling error even to
   someone who could not say what is missing.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * @typedef {Object} HubOptions
 * @property {number} [lugs=10]           wheel studs (10 is the US truck standard)
 * @property {number} [lugRingRatio=0.42] stud circle diameter, fraction of rim diameter
 * @property {number} [drumRatio=0.48]    brake drum diameter, fraction of rim diameter.
 *           Kept well inside the wheel disc's hand-hole circle: at 0.62 the
 *           drum sits exactly behind the holes and blocks every one of them,
 *           which quietly removes the most recognisable feature of a truck
 *           wheel and leaves the disc looking like a blank plate.
 * @property {boolean} [drum=true]        include a brake drum
 * @property {'draft'|'standard'|'high'} [quality='standard']
 * @property {number} [radialSegments]
 * @property {1|-1} [sign=1]          which way along local +X the hub faces
 */

/** Segments per quality level. */
export const HUB_QUALITY = Object.freeze({ draft: 16, standard: 28, high: 44 });

/**
 * Build the hub assembly as a single merged geometry.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {HubOptions} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildHubGeometry(g, opts = {}) {
    const seg = opts.radialSegments ?? HUB_QUALITY[opts.quality ?? 'standard'] ?? HUB_QUALITY.standard;
    const rimR = g.rimRadius;

    // Which way the hub faces along local +X. Handedness is applied by
    // negating the axial placements rather than by scaling the finished
    // geometry by -1: a negative scale reverses triangle winding, and the
    // resulting inside-out normals light the part as though it were a hole.
    const s = (opts.sign ?? 1) >= 0 ? 1 : -1;

    const bossR = rimR * 0.28;
    const bossLen = rimR * 0.34;

    /** @type {THREE.BufferGeometry[]} */
    const parts = [];

    // Centre boss — closes the wheel's bore.
    const boss = new THREE.CylinderGeometry(bossR, bossR * 1.08, bossLen, seg);
    boss.rotateZ(s * Math.PI / 2);
    parts.push(boss);

    // Domed cap on the outboard face.
    const cap = new THREE.SphereGeometry(bossR * 0.94, seg, Math.max(6, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
    cap.rotateZ(-s * Math.PI / 2);
    cap.translate(s * bossLen / 2, 0, 0);
    parts.push(cap);

    // Flat back so the boss is not an open tube when seen from inboard.
    const back = new THREE.CircleGeometry(bossR * 1.08, seg);
    back.rotateY(-s * Math.PI / 2);
    back.translate(-s * bossLen / 2, 0, 0);
    parts.push(back);

    // Brake drum, inboard of the wheel.
    if (opts.drum !== false) {
        const drumR = rimR * (opts.drumRatio ?? 0.48);
        const drumW = g.sectionWidth * 0.24;
        const drumX = -s * g.sectionWidth * 0.20;

        const shell = new THREE.CylinderGeometry(drumR, drumR, drumW, seg * 2, 1, true);
        shell.rotateZ(Math.PI / 2);
        shell.translate(drumX, 0, 0);
        parts.push(shell);

        const face = new THREE.CircleGeometry(drumR, seg * 2);
        face.rotateY(-s * Math.PI / 2);
        face.translate(drumX - s * drumW / 2, 0, 0);
        parts.push(face);
    }

    // Lug nuts on the stud circle.
    const lugs = opts.lugs ?? 10;
    const lugRing = rimR * (opts.lugRingRatio ?? 0.42);
    const lugR = rimR * 0.048;
    const lugH = rimR * 0.058;
    for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        const nut = new THREE.CylinderGeometry(lugR, lugR, lugH, 6);
        nut.rotateZ(Math.PI / 2);
        nut.translate(s * bossLen * 0.40, Math.cos(a) * lugRing, Math.sin(a) * lugRing);
        parts.push(nut);
    }

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();

    if (!merged) {
        throw new Error('Hub geometry merge failed — the parts have mismatched attributes.');
    }
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
}
