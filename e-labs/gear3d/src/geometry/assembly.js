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
import { buildTireGeometry, treadPatternFor, pickQuality } from './tire.js';
import { buildRimBarrel, buildRimDisc } from './rim.js';
import { buildHubGeometry } from './hub.js';
import { chassisEnvelope } from './chassis.js';
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
 * @param {{ghost?: boolean, showAxles?: boolean, radialSegments?: number, quality?: string, minQuality?: string}} [opts]
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
    const chassisGroup = new THREE.Group();
    chassisGroup.name = 'chassis';
    chassisGroup.visible = false;
    root.add(wheelsGroup, structureGroup, chassisGroup);

    /** @type {THREE.BufferGeometry[]} */
    const ownedGeometries = [];
    /** Materials this assembly creates itself, as opposed to borrowing from
     *  the shared MaterialLibrary — only these may be disposed here. */
    /** @type {THREE.Material[]} */
    const ownedMaterials = [];
    /** @type {Array<{mesh: THREE.InstancedMesh, wheels: import('../core/layout.js').Wheel[]}>} */
    const instanceSets = [];
    /** @type {Array<{mesh: THREE.InstancedMesh, wheels: import('../core/layout.js').Wheel[]}>} */
    const ghostSets = [];

    /* ---------- group wheels by what they can share ---------- */

    // Detail is chosen from how many tires actually have to be rasterised,
    // so a single isolated axle gets the full treatment and a 34-tire
    // turnpike double stays interactive.
    const quality = pickQuality(layout.wheels.length, opts.quality, opts.minQuality);

    /** @type {Map<string, import('../core/layout.js').Wheel[]>} */
    const byKind = new Map();
    for (const w of layout.wheels) {
        const axle = layout.axles.find((a) => a.id === w.axleId);
        const pattern = treadPatternFor({ role: axle?.role, domain: layout.domain });
        // Handedness is part of the key: a left-facing wheel and a
        // right-facing one are mirror images and cannot share geometry.
        const key = `${w.tire}|${pattern}|${w.discSign ?? 1}`;
        if (!byKind.has(key)) byKind.set(key, []);
        byKind.get(key).push(w);
    }

    for (const [key, wheels] of byKind) {
        const [designation, pattern, signStr] = key.split('|');
        const sign = /** @type {1|-1} */ (Number(signStr) < 0 ? -1 : 1);
        const g = wheels[0].geometry;
        const tp = /** @type {import('./tire.js').TreadPattern} */ (pattern);

        // Tread relief is cut into the geometry, so the pattern has to be
        // known here rather than only at material time.
        const tireGeo = buildTireGeometry(g, {
            quality,
            radialSegments: opts.radialSegments,
            pattern: tp,
            seed: opts.seed,
            designation
        });
        const barrelGeo = buildRimBarrel(g, { quality });
        // The disc sits near the OUTBOARD face of the rim, not at its centre.
        // Left at the centre it is buried behind a section-width of sidewall
        // and the wheel reads as a hollow ring.
        const discGeo = buildRimDisc(g, { quality, offsetRatio: 0.30 * sign });
        const hubGeo = buildHubGeometry(g, { quality, sign });
        ownedGeometries.push(tireGeo, barrelGeo, discGeo, hubGeo);

        // Two materials, ordered to match the geometry groups: sidewall, tread.
        const rubber = materials.tireMaterials(tp, g, designation);
        // Barrel and disc get DIFFERENT metals on purpose — see the rimBarrel
        // material note.
        const barrelMat = materials.get('rimBarrel');
        const discMat = materials.get('aluminium');

        const tireMesh = makeInstanced(tireGeo, rubber, wheels.length, `tires:${key}`);
        const barrelMesh = makeInstanced(barrelGeo, barrelMat, wheels.length, `rim-barrel:${key}`);
        const discMesh = makeInstanced(discGeo, discMat, wheels.length, `rim-disc:${key}`);
        const hubMesh = makeInstanced(hubGeo, materials.get('hub'), wheels.length, `hub:${key}`);

        // Ghost twin: same tire geometry, flat translucent material, showing
        // exactly the wheels the isolation filter REJECTS. One extra mesh per
        // tire kind, drawn only when ghosting is on.
        const ghostMesh = makeInstanced(tireGeo, materials.ghost(), wheels.length, `ghost:${key}`);
        ghostMesh.castShadow = false;
        ghostMesh.receiveShadow = false;
        ghostMesh.userData.pickable = false;
        ghostMesh.visible = false;
        ghostMesh.renderOrder = -1;

        wheelsGroup.add(tireMesh, barrelMesh, discMesh, hubMesh, ghostMesh);
        instanceSets.push(
            { mesh: tireMesh, wheels },
            { mesh: barrelMesh, wheels },
            { mesh: discMesh, wheels },
            { mesh: hubMesh, wheels }
        );
        ghostSets.push({ mesh: ghostMesh, wheels });
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

    /* ---------- chassis silhouette ---------- */

    // Built once and hidden; the isolation level toggles it. Drawn as
    // translucent panels with picked-out edges so it reads unmistakably as a
    // schematic envelope rather than as measured bodywork — see chassis.js
    // for why it must not look like a modelled vehicle.
    const envelope = chassisEnvelope(layout, layout.unit || opts.unit);
    if (envelope) {
        const panel = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x7d8894),
            roughness: 0.85,
            metalness: 0.0,
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const edge = new THREE.LineBasicMaterial({
            color: new THREE.Color(0x5a6674),
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        });
        ownedMaterials.push(panel, edge);

        for (const b of envelope.boxes) {
            const w = b.y1 - b.y0, h = b.z1 - b.z0, d = b.x1 - b.x0;
            if (!(w > 0 && h > 0 && d > 0)) continue;
            // Engineering (x,y,z) -> render (y,z,x).
            const geo = new THREE.BoxGeometry(w, h, d);
            ownedGeometries.push(geo);
            const centre = engToRender({
                x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: (b.z0 + b.z1) / 2
            });

            const mesh = new THREE.Mesh(geo, panel);
            mesh.position.set(centre.x, centre.y, centre.z);
            mesh.name = `chassis:${b.id}`;
            mesh.userData.pickable = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 2;

            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
            edges.position.copy(mesh.position);
            edges.name = `chassis-edge:${b.id}`;
            edges.userData.pickable = false;
            edges.renderOrder = 3;
            ownedGeometries.push(edges.geometry);

            chassisGroup.add(mesh, edges);
        }
    }

    /* ---------- instance placement ---------- */

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    /** @type {Map<THREE.InstancedMesh, import('../core/layout.js').Wheel[]>} */
    const visibleMap = new Map();

    /**
     * Pack a set of instances to match a selection.
     * @param {Array<{mesh: THREE.InstancedMesh, wheels: import('../core/layout.js').Wheel[]}>} sets
     * @param {(w: import('../core/layout.js').Wheel) => boolean} pred
     * @param {boolean} enabled
     */
    function packSets(sets, pred, enabled) {
        for (const { mesh, wheels } of sets) {
            const chosen = enabled ? wheels.filter(pred) : [];
            visibleMap.set(mesh, chosen);
            chosen.forEach((w, i) => {
                const p = engToRender({ x: w.x, y: w.y, z: w.z });
                matrix.compose(new THREE.Vector3(p.x, p.y, p.z), quat, scale);
                mesh.setMatrixAt(i, matrix);
            });
            mesh.count = chosen.length;
            mesh.instanceMatrix.needsUpdate = true;
            mesh.visible = chosen.length > 0;
            mesh.computeBoundingSphere();
        }
    }

    /**
     * Rewrite every instance matrix, packing the wheels that pass the
     * predicate to the front and setting `count` to how many passed.
     *
     * @param {(w: import('../core/layout.js').Wheel) => boolean} pred
     * @param {{ghost?: boolean}} [opts] when ghosting, the wheels that FAIL
     *        the predicate are drawn translucently for context
     */
    function setWheelFilter(pred, opts = {}) {
        packSets(instanceSets, pred, true);
        packSets(ghostSets, (w) => !pred(w), !!opts.ghost);
        chassisGroup.visible = !!opts.chassis && chassisGroup.children.length > 0;

        // Axle beams and struts follow their own wheels. Deriving the set
        // rather than filtering structure separately makes it impossible for
        // the two to disagree — a beam floating in an isolated figure with no
        // wheels on it is both wrong and, in an exported figure, quietly
        // misleading about what was measured.
        const shownAxles = new Set(layout.wheels.filter(pred).map((w) => w.axleId));
        for (const node of structureGroup.children) {
            const id = node.userData?.axleId;
            node.visible = id == null ? true : shownAxles.has(id);
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
        for (const m of ownedMaterials) m.dispose();
        root.traverse((o) => {
            const anyO = /** @type {any} */ (o);
            if (anyO.geometry && !ownedGeometries.includes(anyO.geometry)) anyO.geometry.dispose?.();
        });
        root.clear();
    }

    return {
        root, layout, setWheelFilter, wheelAt, bounds, dispose,
        /** The chassis envelope actually built, or null. Lets the UI say what
         *  was drawn from cited data and what was representative. */
        chassis: envelope,
        hasChassis: () => chassisGroup.children.length > 0
    };
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Material|THREE.Material[]} mat a material array pairs with the
 *        geometry's groups, which is how the tire gets separate sidewall and
 *        tread surfaces from one instanced draw
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
