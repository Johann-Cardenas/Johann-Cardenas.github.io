/* ============================================================
   Gear3D — axle beams and landing gear struts
   ------------------------------------------------------------
   Built directly in the ENGINEERING frame and converted once by
   the assembly module, because an axle's defining dimension —
   track width — is an engineering quantity that appears in the
   dimension engine and in exports.

   These parts are structural context, not measured geometry. The
   numbers that matter (track, dual spacing, axle height) come from
   the data; the beam diameter and the shape of a bogie are chosen
   to read correctly at figure scale and are documented as such.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/** Axle beam diameter as a fraction of the tire's rim diameter. */
const BEAM_DIA_RATIO = 0.24;
/** Differential housing diameter as a fraction of the tire's free radius. */
const DIFF_DIA_RATIO = 0.66;

/**
 * @typedef {Object} AxleBeamOptions
 * @property {boolean} [differential=false] drive axles carry a centre housing
 * @property {number}  [innerLimit]         beam stops this far from the centreline (mm)
 * @property {number}  [radialSegments=20]
 */

/**
 * Build an axle beam spanning the track, in the RENDER frame.
 *
 * The beam runs along engineering y, which is render x. It sits at the
 * axle centre height, which is the tire's static loaded radius.
 *
 * @param {number} trackWidth mm, centre to centre of the wheel positions
 * @param {import('../core/tires.js').TireGeometry} g tire geometry, for scale
 * @param {THREE.Material} material
 * @param {AxleBeamOptions} [opts]
 * @returns {THREE.Group} positioned at the axle's origin (render frame)
 */
export function buildAxleBeam(trackWidth, g, material, opts = {}) {
    const seg = opts.radialSegments ?? 20;
    const grp = new THREE.Group();
    grp.name = 'axle-beam';

    const dia = g.rimDiameter * BEAM_DIA_RATIO;
    const span = trackWidth;

    // Main beam: a cylinder along render x.
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(dia / 2, dia / 2, span, seg),
        material
    );
    beam.geometry.rotateZ(Math.PI / 2);
    beam.name = 'beam';
    beam.castShadow = true;
    beam.receiveShadow = true;
    grp.add(beam);

    // Spring pads where the suspension clamps the beam.
    const padW = dia * 1.5;
    for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(
            new THREE.BoxGeometry(padW, dia * 0.5, dia * 1.35),
            material
        );
        pad.position.set(side * span * 0.31, dia * 0.5, 0);
        pad.name = 'spring-pad';
        pad.castShadow = true;
        grp.add(pad);
    }

    if (opts.differential) {
        const dr = g.freeRadius * DIFF_DIA_RATIO * 0.5;
        const diff = new THREE.Mesh(new THREE.SphereGeometry(dr, seg, seg), material);
        diff.scale.set(0.78, 1, 1.05);
        diff.name = 'differential';
        diff.castShadow = true;
        grp.add(diff);

        // Pinion nose, pointing forward along render -z (engineering -x).
        const nose = new THREE.Mesh(
            new THREE.CylinderGeometry(dr * 0.34, dr * 0.42, dr * 1.15, seg),
            material
        );
        nose.geometry.rotateX(Math.PI / 2);
        nose.position.set(0, 0, -dr * 0.95);
        nose.name = 'pinion';
        nose.castShadow = true;
        grp.add(nose);
    }

    return grp;
}

/**
 * Build a landing gear strut: an oleo leg with a bogie beam when the gear
 * has more than one tandem row.
 *
 * @param {{axleHeight: number, tandemRows: number, tandemSpacing: number, trackSpan: number}} spec
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {THREE.Material} material
 * @param {{radialSegments?: number}} [opts]
 * @returns {THREE.Group} render frame, origin at the gear's ground reference
 */
export function buildGearStrut(spec, g, material, opts = {}) {
    const seg = opts.radialSegments ?? 20;
    const grp = new THREE.Group();
    grp.name = 'gear-strut';

    // A widebody oleo is a substantial forging — roughly half a metre across
    // on a 777. At 0.16 it rendered as a thin rod that read as a support pin
    // rather than the structural member carrying the aircraft.
    const legR = g.rimDiameter * 0.26;
    // The leg runs from the axle up to roughly two tire diameters, which is
    // enough to read as a strut without pretending to model the actual
    // retraction geometry — that is out of scope by design.
    const legLen = g.overallDiameter * 1.35;

    const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.82, legR, legLen, seg),
        material
    );
    leg.position.set(0, spec.axleHeight + legLen / 2, 0);
    leg.name = 'oleo-leg';
    leg.castShadow = true;
    grp.add(leg);

    // Polished slider section just above the axle.
    const slider = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.62, legR * 0.62, legLen * 0.28, seg),
        material
    );
    slider.position.set(0, spec.axleHeight + legLen * 0.14, 0);
    slider.name = 'oleo-slider';
    grp.add(slider);

    if (spec.tandemRows > 1) {
        const bogieLen = spec.tandemSpacing * (spec.tandemRows - 1) + g.sectionWidth * 0.9;
        const bogie = new THREE.Mesh(
            new THREE.BoxGeometry(legR * 0.85, legR * 1.5, bogieLen),
            material
        );
        bogie.position.set(0, spec.axleHeight, 0);
        bogie.name = 'bogie-beam';
        bogie.castShadow = true;
        grp.add(bogie);
    }

    // Axle stubs across the wheels of each row.
    const stub = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.5, legR * 0.5, spec.trackSpan, seg),
        material
    );
    stub.geometry.rotateZ(Math.PI / 2);
    for (let row = 0; row < spec.tandemRows; row++) {
        const z = (row - (spec.tandemRows - 1) / 2) * spec.tandemSpacing;
        const s = stub.clone();
        s.position.set(0, spec.axleHeight, z);
        s.name = `axle-stub-${row}`;
        s.castShadow = true;
        grp.add(s);
    }

    return grp;
}
