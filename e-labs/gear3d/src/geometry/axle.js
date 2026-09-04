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

   NOTHING HERE MAY END IN A RAW FLAT CAP. Every member used to be
   a bare cylinder or box: the oleo leg stopped in mid-air above
   the wheels, the axle stubs ran out past the outer tire and
   simply stopped, the pinion was a cone with a disc on the end,
   and the differential was a sphere with that cone stuck into it
   — a snowman. A cut tube is the cheapest tell that a part was
   not modeled but merely placed, and in a figure that is asking
   to be read as an engineering drawing it undoes the rest of the
   render. Each member below therefore terminates in something
   that says what it is: a trunnion, a flange, a saddle, a cap.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/** Axle beam diameter as a fraction of the tire's rim diameter. */
const BEAM_DIA_RATIO = 0.24;
/** Differential housing diameter as a fraction of the tire's free radius. */
const DIFF_DIA_RATIO = 0.66;

/**
 * @typedef {Object} AxleBeamOptions
 * @property {boolean} [differential=false] drive axles carry a center housing
 * @property {number}  [innerLimit]         beam stops this far from the centerline (mm)
 * @property {number}  [radialSegments=20]
 */

/**
 * A capsule: a cylinder closed with a spherical cap at each end.
 *
 * This is the default termination for a structural member. A `CylinderGeometry`
 * is closed by a flat disc, which under a raking key light reads exactly like a
 * pipe that has been sawn off; a rounded end reads as a forging.
 *
 * @param {number} r radius
 * @param {number} len length of the cylindrical part
 * @param {number} seg
 * @param {{ends?: 1|2, capScale?: number}} [opts] `ends` 1 rounds only +Y
 * @returns {THREE.BufferGeometry[]} parts, in the local frame with +Y along the member
 */
function capsuleParts(r, len, seg, opts = {}) {
    const capScale = opts.capScale ?? 0.45;
    /** @type {THREE.BufferGeometry[]} */
    const parts = [new THREE.CylinderGeometry(r, r, len, seg)];
    const ends = opts.ends === 1 ? [1] : [1, -1];
    for (const e of ends) {
        const cap = new THREE.SphereGeometry(r, seg, Math.max(5, seg >> 2), 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, capScale, 1);
        if (e < 0) cap.rotateX(Math.PI);
        cap.translate(0, e * len / 2, 0);
        parts.push(cap);
    }
    return parts;
}

/**
 * Add every part of a capsule to a group as one mesh each, oriented along a
 * given axis and positioned. Kept as separate meshes rather than merged so the
 * caller can still name and pick individual members.
 *
 * @param {THREE.Group} grp
 * @param {THREE.BufferGeometry[]} parts
 * @param {THREE.Material} material
 * @param {string} name
 * @param {(geo: THREE.BufferGeometry) => void} place applied to each part
 */
function addParts(grp, parts, material, name, place) {
    for (const geo of parts) {
        place(geo);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, material);
        m.name = name;
        m.castShadow = true;
        m.receiveShadow = true;
        grp.add(m);
    }
}

/**
 * Build an axle beam spanning the track, in the RENDER frame.
 *
 * The beam runs along engineering y, which is render x. It sits at the
 * axle center height, which is the tire's static loaded radius.
 *
 * @param {number} trackWidth mm, center to center of the wheel positions
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
    const r = dia / 2;
    const span = trackWidth;

    // Main beam along render x. Both ends run inside the hubs, so they get a
    // spindle rather than a cap: a short step down in diameter, which is what
    // the bearing seat looks like and what makes the beam read as entering the
    // wheel instead of being clipped by it.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r, r, span * 0.995, seg), material);
    beam.geometry.rotateZ(Math.PI / 2);
    beam.name = 'beam';
    beam.castShadow = true;
    beam.receiveShadow = true;
    grp.add(beam);

    for (const side of [-1, 1]) {
        // Hub flange, then the spindle stub that carries the wheel.
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 1.28, r * 1.28, dia * 0.16, seg), material);
        flange.geometry.rotateZ(Math.PI / 2);
        flange.position.x = side * (span / 2 - dia * 0.30);
        flange.name = 'hub-flange';
        flange.castShadow = true;
        grp.add(flange);

        const spindle = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 0.62, r * 0.78, dia * 0.62, seg), material);
        spindle.geometry.rotateZ(-side * Math.PI / 2);
        spindle.position.x = side * (span / 2 + dia * 0.10);
        spindle.name = 'spindle';
        spindle.castShadow = true;
        grp.add(spindle);
    }

    // Spring saddles. A bare box floating on the beam read as a block that had
    // been dropped there; a real seat wraps the beam and carries a flat pad, so
    // this is a collar plus a plate and the two are visibly one part.
    const padW = dia * 1.5;
    for (const side of [-1, 1]) {
        const x = side * span * 0.31;

        const collar = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 1.22, r * 1.22, padW * 0.72, seg), material);
        collar.geometry.rotateZ(Math.PI / 2);
        collar.position.set(x, 0, 0);
        collar.name = 'spring-saddle';
        collar.castShadow = true;
        grp.add(collar);

        const seat = new THREE.Mesh(
            new THREE.BoxGeometry(padW, dia * 0.34, dia * 1.35), material);
        seat.position.set(x, r * 1.05, 0);
        seat.name = 'spring-pad';
        seat.castShadow = true;
        grp.add(seat);
    }

    if (opts.differential) {
        const dr = g.freeRadius * DIFF_DIA_RATIO * 0.5;

        // Carrier: a flattened bowl rather than a ball. A sphere with a cone
        // driven into it is a snowman, not a differential; the housing on a
        // drive axle is much shallower across the vehicle than it is tall.
        const bowl = new THREE.Mesh(new THREE.SphereGeometry(dr, seg, seg), material);
        bowl.scale.set(0.74, 1, 0.92);
        bowl.name = 'differential';
        bowl.castShadow = true;
        grp.add(bowl);

        // Bolted inspection cover on the rear face, which is the feature that
        // says "differential" at a glance.
        const cover = new THREE.Mesh(
            new THREE.CylinderGeometry(dr * 0.74, dr * 0.68, dr * 0.30, seg), material);
        cover.geometry.rotateX(Math.PI / 2);
        cover.position.set(0, 0, dr * 0.80);
        cover.name = 'diff-cover';
        cover.castShadow = true;
        grp.add(cover);

        // Pinion nose forward along render -z (engineering -x), ending in an
        // input flange rather than in a bare disc.
        const nose = new THREE.Mesh(
            new THREE.CylinderGeometry(dr * 0.34, dr * 0.46, dr * 1.05, seg), material);
        nose.geometry.rotateX(Math.PI / 2);
        nose.position.set(0, 0, -dr * 0.92);
        nose.name = 'pinion';
        nose.castShadow = true;
        grp.add(nose);

        const yoke = new THREE.Mesh(
            new THREE.CylinderGeometry(dr * 0.44, dr * 0.44, dr * 0.20, seg), material);
        yoke.geometry.rotateX(Math.PI / 2);
        yoke.position.set(0, 0, -dr * 1.50);
        yoke.name = 'pinion-flange';
        yoke.castShadow = true;
        grp.add(yoke);
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

    // A widebody oleo is a substantial forging — roughly half a meter across
    // on a 777. At 0.16 it rendered as a thin rod that read as a support pin
    // rather than the structural member carrying the aircraft.
    const legR = g.rimDiameter * 0.26;
    // The leg runs from the axle up to roughly two tire diameters, which is
    // enough to read as a strut without pretending to model the actual
    // retraction geometry — that is out of scope by design.
    const legLen = g.overallDiameter * 1.35;
    const topY = spec.axleHeight + legLen;

    const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.82, legR, legLen, seg),
        material
    );
    leg.position.set(0, spec.axleHeight + legLen / 2, 0);
    leg.name = 'oleo-leg';
    leg.castShadow = true;
    grp.add(leg);

    // TRUNNION at the top. The leg used to stop dead in mid-air, which reads
    // as an unfinished model rather than as a gear that has been cut off at
    // the wing root — the pin across the top says the leg pivots about
    // something, and that is all the figure needs to claim.
    const trunnion = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.42, legR * 0.42, legR * 3.4, seg),
        material
    );
    trunnion.geometry.rotateZ(Math.PI / 2);
    trunnion.position.set(0, topY, 0);
    trunnion.name = 'trunnion';
    trunnion.castShadow = true;
    grp.add(trunnion);

    const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.95, legR * 0.80, legR * 0.9, seg),
        material
    );
    collar.position.set(0, topY - legR * 0.45, 0);
    collar.name = 'trunnion-collar';
    collar.castShadow = true;
    grp.add(collar);

    // Polished slider section just above the axle.
    const sliderLen = legLen * 0.28;
    const sliderY = spec.axleHeight + legLen * 0.14;
    const slider = new THREE.Mesh(
        new THREE.CylinderGeometry(legR * 0.62, legR * 0.62, sliderLen, seg),
        material
    );
    slider.position.set(0, sliderY, 0);
    slider.name = 'oleo-slider';
    grp.add(slider);

    // TORQUE LINK — the scissor between the fixed leg and the sliding piston.
    // It is the single most recognizable feature of a landing gear, and it is
    // also what tells a reader which part of the leg telescopes.
    const linkTop = sliderY + sliderLen * 0.55;
    const linkMid = sliderY + sliderLen * 0.05;
    const linkBot = spec.axleHeight + legR * 0.30;
    const linkR = legR * 0.24;
    const arm = (y0, y1, name) => {
        const h = y1 - y0;
        const reach = legR * 0.95;
        const len = Math.hypot(h, reach);
        const a = new THREE.Mesh(
            new THREE.BoxGeometry(linkR * 0.7, len, linkR * 2.0), material);
        a.position.set(0, (y0 + y1) / 2, -reach / 2 - legR * 0.55);
        a.rotation.x = Math.atan2(reach, h);
        a.name = name;
        a.castShadow = true;
        grp.add(a);
    };
    arm(linkTop, linkMid, 'torque-link-upper');
    arm(linkMid, linkBot, 'torque-link-lower');

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

        // Pivot boss where the leg meets the beam, so the two read as jointed
        // rather than as one box passing through another.
        const pivot = new THREE.Mesh(
            new THREE.CylinderGeometry(legR * 0.68, legR * 0.68, legR * 1.9, seg), material);
        pivot.geometry.rotateZ(Math.PI / 2);
        pivot.position.set(0, spec.axleHeight, 0);
        pivot.name = 'bogie-pivot';
        pivot.castShadow = true;
        grp.add(pivot);
    }

    // Axle stubs across the wheels of each row, domed at both ends so they do
    // not run past the outer tire and stop as a cut tube.
    const stubR = legR * 0.5;
    for (let row = 0; row < spec.tandemRows; row++) {
        const z = (row - (spec.tandemRows - 1) / 2) * spec.tandemSpacing;
        addParts(grp, capsuleParts(stubR, spec.trackSpan, seg), material,
            `axle-stub-${row}`, (geo) => {
                geo.rotateZ(Math.PI / 2);
                geo.translate(0, spec.axleHeight, z);
            });
    }

    return grp;
}
