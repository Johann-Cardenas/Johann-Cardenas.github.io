/* ============================================================
   Gear3D — geometry export (glTF / OBJ)
   ------------------------------------------------------------
   For taking the gear into a CAD or FEM pre-processor, or into a
   renderer for a figure this app cannot compose.

   TWO DECISIONS MATTER MORE THAN THE FILE FORMAT.

   1. THE ENGINEERING FRAME, NOT THE RENDER FRAME.
      Internally the scene is three.js Y-up, where render (x,y,z)
      is engineering (y,z,x). Exporting that would hand out
      geometry rotated relative to every other output this app
      produces. A glTF and a footprint.csv describing the same
      truck have to agree, so the export is transformed back:

          x  longitudinal, positive REARWARD
          y  transverse, positive RIGHT of travel
          z  vertical, positive UP, z = 0 at the pavement

      The mapping render -> engineering is (x,y,z) -> (z,x,y), a
      cyclic permutation with determinant +1, so handedness is
      preserved and no normals are inverted.

   2. MILLIMETRES, NOT METRES.
      glTF's convention is metres, and this deliberately departs
      from it. Millimetres is the app's canonical unit and the one
      the footprint CSV, the Abaqus table and every dimension use.
      Someone importing a .glb next to a footprint.csv and finding
      a 1000x mismatch has been handed a trap; a viewer showing a
      22 000-unit truck has been handed an inconvenience. The unit
      is stated in the glTF asset extras and in the OBJ header.

   Instances are baked to nodes that SHARE their geometry, so the
   exporter emits one mesh referenced many times rather than 34
   copies of a tyre.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { APP_NAME, APP_VERSION } from '../core/version.js';
import { renderToEngMatrix } from '../core/coords.js';

/**
 * Render frame -> engineering frame, and metres -> millimetres.
 * @returns {THREE.Matrix4}
 */
export function engineeringTransform() {
    // Defined in core/coords.js, beside engToRender, so the two cannot drift.
    return new THREE.Matrix4().fromArray(renderToEngMatrix(1000));
}

/**
 * Collect the visible model as a plain scene graph, in the engineering frame.
 *
 * Only the model is taken. The ground shadow catcher, the reference grid and
 * the lights are viewport furniture — exporting them would put a 60 m
 * invisible plane and a construction grid into someone's FEM pre-processor.
 *
 * @param {import('../scene/renderer.js').Viewport} viewport
 * @param {{includeChassis?: boolean}} [opts]
 * @returns {{root: THREE.Group, meshCount: number, triangleCount: number}}
 */
export function buildExportScene(viewport, opts = {}) {
    const root = new THREE.Group();
    root.name = 'Gear3D';
    root.applyMatrix4(engineeringTransform());

    const assembly = viewport.assembly;
    if (!assembly) return { root, meshCount: 0, triangleCount: 0 };

    let meshCount = 0;
    let triangleCount = 0;
    const matrix = new THREE.Matrix4();

    assembly.root.traverse((o) => {
        const any = /** @type {any} */ (o);
        if (!any.isMesh && !any.isInstancedMesh) return;
        if (!o.visible) return;
        // Ghosts are context for the screen, not geometry anyone wants.
        if (o.name.startsWith('ghost:')) return;
        if (!opts.includeChassis && o.name.startsWith('chassis')) return;

        const tris = any.geometry?.index
            ? any.geometry.index.count / 3
            : (any.geometry?.attributes?.position?.count ?? 0) / 3;

        if (any.isInstancedMesh) {
            for (let i = 0; i < any.count; i++) {
                any.getMatrixAt(i, matrix);
                // Sharing the geometry means the exporter writes ONE mesh and
                // references it from N nodes, instead of 34 copies of a tyre.
                const mesh = new THREE.Mesh(any.geometry, any.material);
                mesh.name = `${o.name.replace(/[:|]/g, '_')}_${i}`;
                // world = matrixWorld * instanceMatrix, composed EXPLICITLY.
                // Two successive applyMatrix4 calls premultiply, giving
                // instance * world — which applies the assembly's 1/1000 scale
                // before a translation already expressed in millimetres, and
                // the export comes out a thousand times too large.
                mesh.applyMatrix4(
                    new THREE.Matrix4().multiplyMatrices(any.matrixWorld, matrix)
                );
                root.add(mesh);
                meshCount++;
                triangleCount += tris;
            }
        } else {
            const mesh = new THREE.Mesh(any.geometry, any.material);
            mesh.name = o.name.replace(/[:|]/g, '_') || 'part';
            mesh.applyMatrix4(any.matrixWorld);
            root.add(mesh);
            meshCount++;
            triangleCount += tris;
        }
    });

    return { root, meshCount, triangleCount };
}

/**
 * @typedef {Object} SceneExportResult
 * @property {Blob} blob
 * @property {string} extension
 * @property {number} meshCount
 * @property {number} triangleCount
 */

/**
 * Export the visible geometry as binary glTF.
 *
 * @param {import('../scene/renderer.js').Viewport} viewport
 * @param {{includeChassis?: boolean, unitId?: string}} [opts]
 * @returns {Promise<SceneExportResult>}
 */
export function exportGLTF(viewport, opts = {}) {
    const { root, meshCount, triangleCount } = buildExportScene(viewport, opts);
    if (!meshCount) return Promise.reject(new Error('Nothing visible to export.'));

    return new Promise((resolve, reject) => {
        new GLTFExporter().parse(
            root,
            (result) => {
                const blob = new Blob([/** @type {ArrayBuffer} */(result)], {
                    type: 'model/gltf-binary'
                });
                resolve({ blob, extension: 'glb', meshCount, triangleCount });
            },
            (err) => reject(new Error(`glTF export failed: ${err?.message ?? err}`)),
            {
                binary: true,
                onlyVisible: true,
                // The unit and frame travel INSIDE the file. A geometry export
                // whose scale can only be recovered from a README is a geometry
                // export somebody will import wrongly.
                extras: {
                    generator: `${APP_NAME} ${APP_VERSION}`,
                    units: 'millimetre',
                    coordinateSystem:
                        'x longitudinal positive rearward; y transverse positive right of travel; '
                        + 'z vertical positive up, z=0 at the pavement surface. Right-handed. '
                        + 'Matches Gear3D footprint.csv and the Abaqus patch table exactly.',
                    unit: opts.unitId ?? null,
                    note: 'Millimetres, not the glTF metre convention — deliberately, so this '
                        + 'file shares one coordinate system and one scale with the footprint export.'
                }
            }
        );
    });
}

/**
 * Export the visible geometry as Wavefront OBJ.
 *
 * OBJ has no instancing and no unit convention, so this is the larger and
 * blunter of the two. It is here because it is still the format most FEM
 * pre-processors will read without argument.
 *
 * @param {import('../scene/renderer.js').Viewport} viewport
 * @param {{includeChassis?: boolean, unitId?: string}} [opts]
 * @returns {Promise<SceneExportResult>}
 */
export function exportOBJ(viewport, opts = {}) {
    const { root, meshCount, triangleCount } = buildExportScene(viewport, opts);
    if (!meshCount) return Promise.reject(new Error('Nothing visible to export.'));

    const body = new OBJExporter().parse(root);
    const header = [
        `# ${APP_NAME} ${APP_VERSION} — geometry export`,
        opts.unitId ? `# Unit: ${opts.unitId}` : null,
        '#',
        '# UNITS: millimetres.',
        '# COORDINATE SYSTEM:',
        '#   x  longitudinal, positive REARWARD, origin at the front-most axle centreline',
        '#   y  transverse, positive RIGHT of the direction of travel, origin on the centreline',
        '#   z  vertical, positive UP, z = 0 at the pavement surface',
        '#   Right-handed. Matches Gear3D footprint.csv and the Abaqus patch table exactly.',
        '#',
        '# OBJ carries no instancing, so every tyre is a full copy of its geometry.',
        '# Prefer the .glb if your importer accepts it.',
        '#'
    ].filter(Boolean).join('\n') + '\n';

    return Promise.resolve({
        blob: new Blob([header, body], { type: 'model/obj' }),
        extension: 'obj',
        meshCount,
        triangleCount
    });
}
