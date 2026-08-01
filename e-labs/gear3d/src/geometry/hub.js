/* ============================================================
   Gear3D — hub, brake drum and lug nuts
   ------------------------------------------------------------
   Local frame matches the tire and rim: origin at the wheel
   centre, rotation axis +X, millimetres.

   These parts are small in the frame but they are what make an
   isolated axle read as a real assembly rather than a pair of
   floating discs, so they are worth the few hundred triangles.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/**
 * @typedef {Object} HubOptions
 * @property {number} [lugs=10]           wheel studs (10 is the US truck standard)
 * @property {number} [lugRingRatio=0.42] stud circle diameter, fraction of rim diameter
 * @property {number} [drumRatio=0.62]    brake drum diameter, fraction of rim diameter
 * @property {boolean} [drum=true]        include a brake drum
 * @property {number} [radialSegments=24]
 */

/**
 * Build the hub assembly: centre boss, optional brake drum, and a ring of
 * lug nuts merged into a single geometry so the whole thing is one draw.
 *
 * @param {import('../core/tires.js').TireGeometry} g
 * @param {{hub: THREE.Material, drum: THREE.Material}} materials
 * @param {HubOptions} [opts]
 * @returns {THREE.Group}
 */
export function buildHub(g, materials, opts = {}) {
    const seg = opts.radialSegments ?? 24;
    const grp = new THREE.Group();
    grp.name = 'hub';

    const rimR = g.rimRadius;
    const bossR = rimR * 0.26;
    const bossLen = rimR * 0.30;

    // Centre boss — the hub cap face.
    const boss = new THREE.Mesh(
        new THREE.CylinderGeometry(bossR, bossR * 1.06, bossLen, seg),
        materials.hub
    );
    boss.geometry.rotateZ(Math.PI / 2);
    boss.name = 'hub-boss';
    grp.add(boss);

    // Domed cap on the outboard face.
    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(bossR * 0.92, seg, Math.max(6, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2),
        materials.hub
    );
    cap.geometry.rotateZ(-Math.PI / 2);
    cap.geometry.translate(bossLen / 2, 0, 0);
    cap.name = 'hub-cap';
    grp.add(cap);

    // Brake drum, sitting inboard of the wheel.
    if (opts.drum !== false) {
        const drumR = rimR * (opts.drumRatio ?? 0.62);
        const drumW = g.sectionWidth * 0.22;
        const drum = new THREE.Mesh(
            new THREE.CylinderGeometry(drumR, drumR, drumW, seg * 2, 1, true),
            materials.drum
        );
        drum.geometry.rotateZ(Math.PI / 2);
        drum.geometry.translate(-g.sectionWidth * 0.20, 0, 0);
        drum.name = 'brake-drum';
        drum.castShadow = true;
        grp.add(drum);

        const back = new THREE.Mesh(
            new THREE.CircleGeometry(drumR, seg * 2),
            materials.drum
        );
        back.geometry.rotateY(-Math.PI / 2);
        back.geometry.translate(-g.sectionWidth * 0.20 - drumW / 2, 0, 0);
        back.name = 'brake-drum-back';
        grp.add(back);
    }

    // Lug nuts.
    const lugs = opts.lugs ?? 10;
    const lugRing = rimR * (opts.lugRingRatio ?? 0.42);
    const lugR = rimR * 0.045;
    const lugH = rimR * 0.055;
    const lugGeo = new THREE.CylinderGeometry(lugR, lugR, lugH, 6);
    lugGeo.rotateZ(Math.PI / 2);
    const lugMesh = new THREE.InstancedMesh(lugGeo, materials.hub, lugs);
    lugMesh.name = 'lug-nuts';
    const m = new THREE.Matrix4();
    for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        m.makeTranslation(bossLen * 0.42, Math.cos(a) * lugRing, Math.sin(a) * lugRing);
        lugMesh.setMatrixAt(i, m);
    }
    lugMesh.instanceMatrix.needsUpdate = true;
    lugMesh.castShadow = true;
    grp.add(lugMesh);

    return grp;
}
