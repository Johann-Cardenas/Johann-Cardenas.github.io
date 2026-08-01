/* ============================================================
   Gear3D — scene assembly
   ------------------------------------------------------------
   Turns a resolved Layout into a three.js scene graph.

   SCENE UNITS ARE METRES. Geometry is authored in millimetres, so
   the assembly root carries a single 1/1000 scale. Nothing below
   the root ever thinks about metres, and nothing above it ever
   thinks about millimetres.

   INSTANCING is mandatory here, not an optimisation: a class 13
   turnpike double carries 34 tires and the gear-matrix sheet
   renders four assemblies at once. Tires, rims and hubs are each
   drawn with one InstancedMesh per distinct tire designation.

   Isolation is implemented by PACKING visible instances to the
   front of each InstancedMesh and lowering `count`, rather than by
   hiding them with a zero matrix. A zero-scaled instance still
   sits at the origin and still answers the raycaster, which is
   how "I clicked empty space and something got selected" bugs
   happen.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { engToRender } from '../core/coords.js';
import { buildTireGeometry, treadPatternFor } from './tire.js';
import { buildRimBarrel, buildRimDisc } from './rim.js';
import { buildAxleBeam, buildGearStrut } from './axle.js';

/** Millimetres to scene metres. */
export const MM_TO_SCENE = 0.001;

/**
 * @typedef {Object} Assembly
 * @property {THREE.Group} root
 * @property {import('../core/layout.js').Layout} layout
 * @property {(pred: (w: import('../core/layout.js').Wheel) => boolean) => void} setWheelFilter
 * @property {(mesh: THREE.InstancedMesh, instanceId: number) => import('../core/layout.js').Wheel|null} wheelAt
 * @property {() => THREE.Box3} bounds
 * @property {() => void} dispose
 */

/**
 * @param {import('../core/layout.js').Layout} layout
 * @param {import('../scene/materials.js').MaterialLibrary} materials
 * @param {{ghost?: boolean, showAxles?: boolean, radialSegments?: number}} [opts]
 * @returns {Assembly}
 */
export function buildAssembly(layout, materials, opts = {}) {
    const root = new THREE.Group();
    root.name = 'assembly';
    root.scale.setScalar(MM_TO_SCENE);

    const wheelsGroup = new THREE.Group();
    wheelsGroup.name = 'wheels';
    const structureGroup = new THREE.Group();
    structureGroup.name = 'structure';
    root.add(wheelsGroup, structureGroup);

    /** @type {THREE.BufferGeometry[]} */
    const ownedGeometries = [];
    /** @type {Array<{mesh: THREE.InstancedMesh, wheels: import('../core/layout.js').Wheel[]}>} */
    const instanceSets = [];

    /* ---------- group wheels by what they can share ---------- */

    /** @type {Map<string, import('../core/layout.js').Wheel[]>} */
    const byKind = new Map();
    for (const w of layout.wheels) {
        const axle = layout.axles.find((a) => a.id === w.axleId);
        const pattern = treadPatternFor({ role: axle?.role, domain: layout.domain });
        const key = `${w.tire}|${pattern}`;
        if (!byKind.has(key)) byKind.set(key, []);
        byKind.get(key).push(w);
    }

    for (const [key, wheels] of byKind) {
        const [designation, pattern] = key.split('|');
        const g = wheels[0].geometry;

        const tireGeo = buildTireGeometry(g, { radialSegments: opts.radialSegments ?? 64 });
        const barrelGeo = buildRimBarrel(g);
        const discGeo = buildRimDisc(g);
        ownedGeometries.push(tireGeo, barrelGeo, discGeo);

        const rubber = materials.rubberFor(
            /** @type {import('./tire.js').TreadPattern} */(pattern), g, designation
        );
        const metal = materials.get(layout.domain === 'aircraft' ? 'aluminium' : 'aluminium');

        const tireMesh = makeInstanced(tireGeo, rubber, wheels.length, `tires:${key}`);
        const barrelMesh = makeInstanced(barrelGeo, metal, wheels.length, `rim-barrel:${key}`);
        const discMesh = makeInstanced(discGeo, metal, wheels.length, `rim-disc:${key}`);

        wheelsGroup.add(tireMesh, barrelMesh, discMesh);
        instanceSets.push(
            { mesh: tireMesh, wheels },
            { mesh: barrelMesh, wheels },
            { mesh: discMesh, wheels }
        );
    }

    /* ---------- axle beams / struts ---------- */

    if (opts.showAxles !== false) {
        for (const a of layout.axles) {
            const node = layout.domain === 'aircraft'
                ? buildGearStrut(
                    {
                        axleHeight: a.axleHeight,
                        tandemRows: rowsForGear(layout, a.id),
                        tandemSpacing: tandemSpacingForGear(layout, a.id),
                        trackSpan: Math.max(a.trackWidth, a.geometry.sectionWidth)
                    },
                    a.geometry,
                    materials.get('strut')
                )
                : buildAxleBeam(
                    a.trackWidth,
                    a.geometry,
                    materials.get('axleBeam'),
                    { differential: a.role === 'drive' }
                );

            // Place at the axle's engineering position.
            const p = engToRender({ x: a.x, y: gearCentreY(layout, a.id), z: a.axleHeight });
            node.position.set(p.x, layout.domain === 'aircraft' ? 0 : p.y, p.z);
            node.userData = { kind: 'axle', axleId: a.id, groupId: a.groupId };
            node.name = `axle:${a.id}`;
            structureGroup.add(node);
        }
    }

    /* ---------- instance placement ---------- */

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    /** @type {Map<THREE.InstancedMesh, import('../core/layout.js').Wheel[]>} */
    const visibleMap = new Map();

    /**
     * Rewrite every instance matrix, packing the wheels that pass the
     * predicate to the front and setting `count` to how many passed.
     * @param {(w: import('../core/layout.js').Wheel) => boolean} pred
     */
    function setWheelFilter(pred) {
        for (const { mesh, wheels } of instanceSets) {
            const visible = wheels.filter(pred);
            visibleMap.set(mesh, visible);
            visible.forEach((w, i) => {
                const p = engToRender({ x: w.x, y: w.y, z: w.z });
                matrix.compose(new THREE.Vector3(p.x, p.y, p.z), quat, scale);
                mesh.setMatrixAt(i, matrix);
            });
            mesh.count = visible.length;
            mesh.instanceMatrix.needsUpdate = true;
            mesh.visible = visible.length > 0;
            mesh.computeBoundingSphere();
        }
    }

    setWheelFilter(() => true);

    /**
     * @param {THREE.InstancedMesh} mesh
     * @param {number} instanceId
     * @returns {import('../core/layout.js').Wheel|null}
     */
    function wheelAt(mesh, instanceId) {
        const list = visibleMap.get(mesh);
        return list && list[instanceId] ? list[instanceId] : null;
    }

    /** @returns {THREE.Box3} */
    function bounds() {
        return new THREE.Box3().setFromObject(root);
    }

    function dispose() {
        for (const g of ownedGeometries) g.dispose();
        root.traverse((o) => {
            const anyO = /** @type {any} */ (o);
            if (anyO.geometry && !ownedGeometries.includes(anyO.geometry)) anyO.geometry.dispose?.();
        });
        root.clear();
    }

    return { root, layout, setWheelFilter, wheelAt, bounds, dispose };
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} mat
 * @param {number} count
 * @param {string} name
 * @returns {THREE.InstancedMesh}
 */
function makeInstanced(geo, mat, count, name) {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;   // instances move on isolation; culling by the
    // source geometry's sphere would pop them
    m.userData.pickable = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
}

/** @param {import('../core/layout.js').Layout} l @param {string} gearId @returns {number} */
function rowsForGear(l, gearId) {
    const rows = new Set(l.wheels.filter((w) => w.axleId === gearId).map((w) => w.row ?? 0));
    return Math.max(1, rows.size);
}

/** @param {import('../core/layout.js').Layout} l @param {string} gearId @returns {number} */
function tandemSpacingForGear(l, gearId) {
    const xs = [...new Set(l.wheels.filter((w) => w.axleId === gearId).map((w) => w.x))].sort((a, b) => a - b);
    return xs.length > 1 ? xs[1] - xs[0] : 0;
}

/** @param {import('../core/layout.js').Layout} l @param {string} axleId @returns {number} */
function gearCentreY(l, axleId) {
    const ws = l.wheels.filter((w) => w.axleId === axleId);
    if (!ws.length) return 0;
    return ws.reduce((s, w) => s + w.y, 0) / ws.length;
}
