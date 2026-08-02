/* ============================================================
   Gear3D — glTF asset-slot loader
   ------------------------------------------------------------
   Implements the contract in ASSETS.md so higher-fidelity meshes
   can replace procedural parts WITHOUT touching any layout code.

   Three rules make that safe, and all three are enforced here
   rather than trusted:

   1. AN ASSET NEVER SUPPLIES A DIMENSION. Every measured value
      still comes from the tire designation and the unit
      definition. The mesh is scaled to fit those numbers. If a
      mesh and the data disagree, the data wins — silently
      trusting a mesh would mean dimensioning a figure with one
      number and drawing it with another, which is the worst
      thing this app could do.

   2. DISTORTION IS CAPPED. Non-uniform scaling beyond 1.6x on
      any axis is rejected and the procedural part is used
      instead. Stretching an 11R22.5 into a 445/50R22.5 is 1.60x
      on width and it looks it.

   3. THE FALLBACK CHAIN ALWAYS TERMINATES. Exact designation ->
      family + rim -> family -> procedural. A missing file, a
      malformed file, a failed fetch or a distortion rejection
      all land on procedural. The app must never show a hole
      where a wheel should be.

   No assets ship with the app. This module is inert until an
   `assets/manifest.json` appears, and the app is fully functional
   without one.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Reject a mesh that would have to be distorted more than this on any axis. */
export const MAX_DISTORTION = 1.6;

/** glTF is authored in metres; Gear3D geometry is in millimetres. */
const M_TO_MM = 1000;

/**
 * @typedef {Object} AssetEntry
 * @property {string} slot
 * @property {{designation?: string, family?: string, rimDiameter?: number}} match
 * @property {string} file
 * @property {{overallDiameter: number, sectionWidth: number}} reference
 * @property {boolean} [draco]
 * @property {string} [credit]
 */

/**
 * @typedef {Object} ResolvedAsset
 * @property {THREE.BufferGeometry} geometry  in millimetres, axis +X
 * @property {THREE.Material|null} material
 * @property {AssetEntry} entry
 * @property {[number, number, number]} scale  the factors that were applied
 */

export class AssetLibrary {
    /**
     * @param {{basePath?: string}} [opts]
     */
    constructor(opts = {}) {
        this.basePath = opts.basePath ?? new URL('../../assets/', import.meta.url).href;
        /** @type {AssetEntry[]} */
        this.entries = [];
        /** @type {Map<string, Promise<any>>} */
        this._files = new Map();
        /** @type {string[]} */
        this.log = [];
        this.available = false;
        this._loader = null;
    }

    /**
     * Load the manifest, if there is one. A missing manifest is the normal
     * case and is not an error.
     * @returns {Promise<boolean>} whether any assets are available
     */
    async init() {
        try {
            const res = await fetch(new URL('manifest.json', this.basePath));
            if (!res.ok) { this.available = false; return false; }
            const json = await res.json();
            this.entries = Array.isArray(json.assets) ? json.assets : [];
            this.available = this.entries.length > 0;
            this._note(`manifest loaded: ${this.entries.length} asset(s)`);
        } catch {
            this.available = false;
        }
        return this.available;
    }

    /**
     * Resolve a slot for a given tire, or null to use procedural geometry.
     *
     * @param {string} slot
     * @param {import('../core/tires.js').TireSpec} spec
     * @param {import('../core/tires.js').TireGeometry} g
     * @returns {Promise<ResolvedAsset|null>}
     */
    async resolve(slot, spec, g) {
        if (!this.available) return null;

        const entry = this._match(slot, spec);
        if (!entry) return null;

        let gltf;
        try {
            gltf = await this._file(entry.file);
        } catch (err) {
            this._note(`FALLBACK ${entry.file}: ${/** @type {Error} */(err).message}`);
            return null;
        }

        const source = findFirstMesh(gltf.scene);
        if (!source) {
            this._note(`FALLBACK ${entry.file}: contains no mesh`);
            return null;
        }

        // Scale the authored reference size onto the real tire's dimensions.
        const ref = entry.reference || {};
        const sx = safeRatio(g.sectionWidth, ref.sectionWidth);
        const syz = safeRatio(g.overallDiameter, ref.overallDiameter);
        const scale = /** @type {[number, number, number]} */ ([sx, syz, syz]);

        const worst = Math.max(...scale.map((s) => Math.max(s, 1 / s)));
        if (!Number.isFinite(worst) || worst > MAX_DISTORTION) {
            this._note(
                `FALLBACK ${entry.file}: would need ${worst.toFixed(2)}x distortion for `
                + `${spec.designation} (cap ${MAX_DISTORTION}). Author a dedicated asset for this size.`
            );
            return null;
        }

        const geometry = source.geometry.clone();
        // glTF metres -> Gear3D millimetres, then the fit scale.
        geometry.scale(M_TO_MM * scale[0], M_TO_MM * scale[1], M_TO_MM * scale[2]);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();

        this._note(
            `${slot} <- ${entry.file} for ${spec.designation} `
            + `(scale ${scale.map((s) => s.toFixed(3)).join(', ')})`
            + (entry.credit ? ` [${entry.credit}]` : '')
        );

        return {
            geometry,
            material: Array.isArray(source.material) ? source.material[0] : source.material,
            entry,
            scale
        };
    }

    /**
     * First matching entry, following the documented precedence.
     * @param {string} slot
     * @param {import('../core/tires.js').TireSpec} spec
     * @returns {AssetEntry|null}
     */
    _match(slot, spec) {
        const pool = this.entries.filter((e) => e.slot === slot);
        const key = (spec.designation || '').toUpperCase();

        return pool.find((e) => (e.match?.designation || '').toUpperCase() === key)
            || pool.find((e) => e.match?.family === spec.family
                && near(e.match?.rimDiameter, spec.rimDiameter))
            || pool.find((e) => e.match?.family === spec.family && e.match?.rimDiameter == null)
            || null;
    }

    /**
     * @param {string} file
     * @returns {Promise<any>}
     */
    _file(file) {
        if (!this._files.has(file)) {
            if (!this._loader) this._loader = new GLTFLoader();
            const url = new URL(file, this.basePath).href;
            this._files.set(file, new Promise((resolve, reject) => {
                this._loader.load(url, resolve, undefined,
                    () => reject(new Error(`could not load ${url}`)));
            }));
        }
        return this._files.get(file);
    }

    /** @param {string} msg */
    _note(msg) {
        this.log.push(msg);
        // Scale factors and fallbacks are logged, not swallowed: a figure
        // rendered with a silently substituted or silently stretched mesh is
        // a figure whose provenance nobody can reconstruct afterwards.
        console.info(`[Gear3D assets] ${msg}`);
    }
}

/**
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh|null}
 */
function findFirstMesh(root) {
    /** @type {THREE.Mesh|null} */
    let found = null;
    root.traverse((o) => {
        if (!found && /** @type {any} */ (o).isMesh) found = /** @type {any} */ (o);
    });
    return found;
}

/**
 * @param {number} target
 * @param {number|undefined} reference
 * @returns {number}
 */
function safeRatio(target, reference) {
    if (!reference || !Number.isFinite(reference) || reference <= 0) return NaN;
    return target / reference;
}

/**
 * @param {number|undefined} a
 * @param {number|undefined} b
 * @returns {boolean}
 */
function near(a, b) {
    if (a == null || b == null) return false;
    return Math.abs(a - b) < 1.0;
}
