/* ============================================================
   Gear3D — hub, brake drum and lug nuts
   ------------------------------------------------------------
   Local frame matches the tire and rim: origin at the wheel
   center, rotation axis +X, millimeters.

   Emitted as ONE merged geometry rather than a Group, so the hub
   can be instanced alongside the tire and rim. A class 13 unit
   has 34 wheels; a Group per wheel would be 34 separate draw
   calls for the smallest part in the frame.

   This is not decoration. Without a hub the wheel disc's center
   bore is an open hole, and a viewer looking into an isolated
   wheel sees straight through it to the axle beam and the
   differential behind — which reads as a modeling error even to
   someone who could not say what is missing.

   THE HUB IS LAID OUT FROM THE WHEEL, NOT FROM ITSELF. Every
   axial station and every radius below comes from
   `wheelStations()` in rim.js, because both of the things this
   module has to line up with — the disc face the nuts stand on,
   the bore the boss has to close — are the disc's dimensions,
   not the hub's. Deriving them here independently is exactly
   what went wrong before: the boss was sized at 0.28 of the rim
   radius against a 0.30 bore, leaving a 5.7 mm ring of daylight
   into the barrel on every wheel in the library, and the nuts
   were placed off the boss length rather than off the disc, which
   buried all ten of them 24 to 74 mm inside it.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wheelStations } from './rim.js';

/**
 * @typedef {Object} HubOptions
 * @property {number} [lugs=10]           wheel studs (10 is the US truck standard)
 * @property {number} [drumRatio=0.733]  brake drum radius, fraction of rim radius.
 *           A 16.5 in drum inside a 22.5 in wheel — the standard North American
 *           heavy pairing, and it lands at 0.733. The earlier 0.48 was chosen
 *           to keep the drum clear of the wheel's hand holes on the reasoning
 *           that a blocked hole stops reading; at that size the drum was a
 *           small cylinder lost inside the wheel, and the holes it was making
 *           room for looked through the whole wheel to the background anyway.
 *           At the real proportion it fills the wheel, backs most of each hand
 *           hole, and reads as what it is.
 * @property {boolean} [drum=true]        include a brake drum
 * @property {'draft'|'standard'|'high'} [quality='standard']
 * @property {number} [radialSegments]
 * @property {number} [offsetRatio=0]     the wheel's disc offset — the same value
 *           the rim is built with. Its SIGN is the hub's handedness.
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
    const w = wheelStations(g, opts);

    // Which way the hub faces along local +X. Handedness is applied by
    // negating the axial placements rather than by scaling the finished
    // geometry by -1: a negative scale reverses triangle winding, and the
    // resulting inside-out normals light the part as though it were a hole.
    const s = w.sign;

    // The boss has to CLOSE THE BORE, so it is sized from the bore and not
    // from a ratio of its own — with a little overlap, because a boss that
    // exactly matches the hole it plugs leaves a z-fighting seam right where
    // the eye is drawn.
    const bossR = w.boreR * 1.06;
    const bossLen = rimR * 0.34;

    /** @type {THREE.BufferGeometry[]} */
    const parts = [];

    // Center boss — closes the wheel's bore. It runs from behind the disc out
    // to the hub pad face, so there is no station at which the bore is open.
    const bossOuter = w.faceX;
    const bossInner = bossOuter - s * bossLen;
    const boss = new THREE.CylinderGeometry(bossR, bossR * 1.08, bossLen, seg);
    boss.rotateZ(s * Math.PI / 2);
    boss.translate((bossOuter + bossInner) / 2, 0, 0);
    parts.push(boss);

    // Domed cap over the bore, standing just proud of the hub pad.
    //
    // FLATTENED to a third of a hemisphere. A true hemisphere on a bore this
    // size is a 220 mm ball sitting on the wheel: it read as a bowling ball
    // bolted to the disc and hid the studs and the hand holes behind it. A
    // hub cap is a shallow pressing, so the sphere is scaled down its own
    // axis; the merge recomputes normals afterward, so the non-uniform scale
    // costs nothing.
    const capR = bossR * 0.94;
    const cap = new THREE.SphereGeometry(capR, seg, Math.max(6, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.34, 1);
    cap.rotateZ(-s * Math.PI / 2);
    cap.translate(bossOuter + s * w.webThickness * 0.55, 0, 0);
    parts.push(cap);

    // Flat back so the boss is not an open tube when seen from inboard.
    const back = new THREE.CircleGeometry(bossR * 1.08, seg);
    back.rotateY(-s * Math.PI / 2);
    back.translate(bossInner, 0, 0);
    parts.push(back);

    // Brake drum, inboard of the wheel.
    if (opts.drum !== false) {
        const drumR = rimR * (opts.drumRatio ?? 0.733);
        const drumW = g.sectionWidth * 0.30;
        const drumX = bossInner + s * drumW * 0.35;

        const shell = new THREE.CylinderGeometry(drumR, drumR, drumW, seg * 2, 1, true);
        shell.rotateZ(Math.PI / 2);
        shell.translate(drumX, 0, 0);
        parts.push(shell);

        // Both ends closed. The inboard face was the only one drawn, so from
        // outboard — through the hand holes, which is the one view that looks
        // into the drum — the drum was an open tube.
        for (const end of [-1, 1]) {
            const face = new THREE.CircleGeometry(drumR, seg * 2);
            face.rotateY(end * s * Math.PI / 2);
            face.translate(drumX + end * s * drumW / 2, 0, 0);
            parts.push(face);
        }
    }

    // Lug nuts, standing ON the hub pad face — which is where a wheel nut is,
    // and the only place one is visible.
    const lugs = opts.lugs ?? 10;
    const lugRing = w.studCircleR;
    const lugR = rimR * 0.042;
    const lugH = rimR * 0.052;
    const padRise = w.webThickness * 0.55;
    for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        const nut = new THREE.CylinderGeometry(lugR, lugR, lugH, 6);
        nut.rotateZ(Math.PI / 2);
        nut.translate(w.faceX + s * (padRise + lugH / 2),
            Math.cos(a) * lugRing, Math.sin(a) * lugRing);
        parts.push(nut);

        // Closed outboard end — a six-sided tube reads as a socket, not a nut.
        const crown = new THREE.CircleGeometry(lugR, 6);
        crown.rotateY(s * Math.PI / 2);
        crown.translate(w.faceX + s * (padRise + lugH),
            Math.cos(a) * lugRing, Math.sin(a) * lugRing);
        parts.push(crown);
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
