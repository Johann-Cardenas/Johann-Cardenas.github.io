/* ============================================================
   Gear3D — CC0 surface texture library
   ------------------------------------------------------------
   Real scanned/authored PBR micro-detail, replacing the
   procedural canvas maps for surface grain only.

   WHAT THESE MAPS DO AND DO NOT DO

   They carry MICRO-DETAIL: the fine pebbling of molded rubber,
   the machining marks on an aluminum rim. That is detail below
   the scale of any modeled geometry, and it is what makes a
   surface read as a material rather than as shaded plastic.

   They carry NO dimensional meaning whatsoever. Tread pattern is
   geometry (see geometry/tire.js), tire size comes from the
   designation, and base color comes from the material spec so
   the user's tint and brightness controls stay meaningful. A
   scanned photograph's baked-in lighting must never contaminate
   a figure, which is why the Color map is deliberately not used.

   FAILURE IS NOT AN OPTION HERE, so it is not a possibility:
   every material is created with its procedural maps immediately
   and the CC0 set is swapped in only if and when it loads. A
   missing file, an offline visit or a slow network costs some
   surface refinement and nothing else. The procedural path
   remains the reference implementation.

   PHYSICAL SCALE IS HONORED. Each set records the real-world
   size of one tile, so the repeat count is computed from the
   actual dimensions of the part rather than guessed. Rubber
   grain is therefore the same physical size on a motorcycle tire
   and on an aircraft tire, as it is in life.

   Provenance for every file is in assets/textures/CREDITS.md.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/**
 * @typedef {Object} TextureSet
 * @property {string} id
 * @property {string} normal    file name, relative to the texture directory
 * @property {string} rough
 * @property {number} tileMm    real-world size of one tile, millimeters
 * @property {string} source
 * @property {string} license
 */

/** @type {Record<string, TextureSet>} */
export const TEXTURE_SETS = Object.freeze({
    rubber: {
        id: 'Rubber004',
        normal: 'rubber004_normal.jpg',
        rough: 'rubber004_rough.jpg',
        tileMm: 75,
        source: 'https://ambientcg.com/view?id=Rubber004',
        license: 'CC0 1.0 Universal'
    },
    // No metal set. One was evaluated and rejected — see CREDITS.md. Machined
    // metal is characterized by what it REFLECTS, which the studio
    // environment map already supplies; a scanned roughness map on top only
    // made the rims look wet.
});

/**
 * Loads and caches the CC0 texture sets.
 *
 * One instance per app. Textures are shared by reference across every
 * material that uses them; per-material tiling is applied by cloning, which
 * shares the underlying GPU image while allowing independent repeats.
 */
export class TextureLibrary {
    /** @param {{basePath?: string}} [opts] */
    constructor(opts = {}) {
        this.basePath = opts.basePath
            ?? new URL('../../assets/textures/', import.meta.url).href;
        this._loader = new THREE.TextureLoader();
        /** @type {Map<string, Promise<{normal: THREE.Texture, rough: THREE.Texture}|null>>} */
        this._sets = new Map();
        /** @type {THREE.Texture[]} */
        this._owned = [];
        this.available = false;
        /** @type {string[]} */
        this.log = [];
    }

    /**
     * Load a named set. Resolves to null when unavailable — callers treat
     * that as "keep the procedural maps", never as an error.
     *
     * @param {keyof typeof TEXTURE_SETS} name
     * @returns {Promise<{normal: THREE.Texture, rough: THREE.Texture}|null>}
     */
    load(name) {
        if (this._sets.has(name)) return this._sets.get(name);

        const spec = TEXTURE_SETS[name];
        if (!spec) return Promise.resolve(null);

        const p = Promise.all([
            this._one(spec.normal, THREE.NoColorSpace),
            this._one(spec.rough, THREE.NoColorSpace)
        ]).then(([normal, rough]) => {
            if (!normal || !rough) {
                this._note(`${spec.id}: unavailable, keeping procedural maps`);
                return null;
            }
            this.available = true;
            this._note(`${spec.id} loaded (${spec.license})`);
            return { normal, rough };
        }).catch(() => null);

        this._sets.set(name, p);
        return p;
    }

    /**
     * @param {string} file
     * @param {any} colorSpace
     * @returns {Promise<THREE.Texture|null>}
     */
    _one(file, colorSpace) {
        return new Promise((resolve) => {
            this._loader.load(
                new URL(file, this.basePath).href,
                (tex) => {
                    tex.colorSpace = colorSpace;
                    tex.wrapS = THREE.RepeatWrapping;
                    tex.wrapT = THREE.RepeatWrapping;
                    tex.anisotropy = 16;
                    this._owned.push(tex);
                    resolve(tex);
                },
                undefined,
                () => resolve(null)
            );
        });
    }

    /**
     * How many times a tile fits across a real span. The caller turns this
     * into a `repeat`, because only the caller knows whether the mesh's UVs
     * already carry a repeat of their own — the tire's do, the rim's do not.
     *
     * @param {keyof typeof TEXTURE_SETS} name
     * @param {number} spanMm
     * @returns {number}
     */
    tilesAcross(name, spanMm) {
        return Math.max(1, spanMm / TEXTURE_SETS[name].tileMm);
    }

    /**
     * A per-use clone with explicit repeats.
     *
     * Cloning shares the GPU image, so a class 13 unit with 34 tires uploads
     * the bitmap once no matter how many distinct repeats it needs.
     *
     * @param {{normal: THREE.Texture, rough: THREE.Texture}} set
     * @param {number} ru repeat along U
     * @param {number} rv repeat along V
     * @returns {{normal: THREE.Texture, rough: THREE.Texture}}
     */
    tiled(set, ru, rv) {
        const out = {};
        for (const k of /** @type {const} */ (['normal', 'rough'])) {
            const t = set[k].clone();
            t.needsUpdate = true;
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(ru, rv);
            t.anisotropy = 16;
            this._owned.push(t);
            out[k] = t;
        }
        return /** @type {any} */ (out);
    }

    /** @param {string} msg */
    _note(msg) {
        this.log.push(msg);
        console.info(`[Gear3D textures] ${msg}`);
    }

    dispose() {
        for (const t of this._owned) t.dispose();
        this._owned.length = 0;
        this._sets.clear();
    }
}
