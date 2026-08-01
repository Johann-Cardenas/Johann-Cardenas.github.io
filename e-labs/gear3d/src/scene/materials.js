/* ============================================================
   Gear3D — PBR materials
   ------------------------------------------------------------
   Every material exposes the same five controls as Cross-Section
   Studio — tint, brightness, roughness, texture scale, relief
   strength — so the two apps feel like one toolkit and a figure
   pair can be matched by eye.

   Colours are deliberately restrained. A publication figure is
   read for its geometry; saturated rubber and chrome-bright rims
   fight the dimension overlay for attention.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { buildTreadMaps } from '../geometry/tire.js';

/**
 * @typedef {Object} MaterialSpec
 * @property {string} name
 * @property {number} color        base colour
 * @property {number} roughness
 * @property {number} metalness
 * @property {number} [normalScale]
 * @property {number} [clearcoat]
 * @property {string} description
 */

/** @type {Record<string, MaterialSpec>} */
export const MATERIAL_SPECS = Object.freeze({
    rubber: {
        name: 'Tire rubber',
        color: 0x2c3238, roughness: 0.85, metalness: 0.0, normalScale: 1.0,
        description: 'Near-black with a faint blue-grey cast. Real tire rubber is never pure black '
            + 'and photographs as a very dark, slightly cool grey. Held a little lighter than a '
            + 'photograph would be: against publication white, a truly black tire loses all of its '
            + 'tread and sidewall form and reads as a silhouette.'
    },
    aluminium: {
        name: 'Machined aluminium rim',
        color: 0xb8bdc4, roughness: 0.32, metalness: 0.92,
        description: 'Polished forged aluminium wheel.'
    },
    steelWheel: {
        name: 'Painted steel rim',
        color: 0x8d9299, roughness: 0.55, metalness: 0.65,
        description: 'Painted steel disc wheel, the budget fitment.'
    },
    hub: {
        name: 'Painted steel hub',
        color: 0x6d757e, roughness: 0.62, metalness: 0.55,
        description: 'Hub, cap and lug nuts.'
    },
    drum: {
        name: 'Cast brake drum',
        color: 0x59524c, roughness: 0.88, metalness: 0.35,
        description: 'Cast iron, lightly oxidised.'
    },
    axleBeam: {
        name: 'Galvanised axle beam',
        color: 0x7e858c, roughness: 0.70, metalness: 0.70,
        description: 'Axle housing and spring pads.'
    },
    strut: {
        name: 'Landing gear strut',
        color: 0xa9b0b7, roughness: 0.38, metalness: 0.85,
        description: 'Cadmium-plated / polished oleo strut and bogie beam.'
    },
    chassis: {
        name: 'Chassis',
        color: 0x4a5560, roughness: 0.6, metalness: 0.3,
        description: 'Frame rails and body silhouette.'
    }
});

/**
 * Live, user-adjustable overrides applied on top of a spec.
 * @typedef {Object} MaterialOverride
 * @property {string}  [tint]        hex string, multiplied into the base colour
 * @property {number}  [brightness]  0.5 - 1.5
 * @property {number}  [roughness]   absolute
 * @property {number}  [textureScale]
 * @property {number}  [relief]      normal map strength
 */

export class MaterialLibrary {
    /**
     * @param {{seed?: string}} [opts]
     */
    constructor(opts = {}) {
        this.seed = opts.seed ?? 'gear3d-01';
        /** @type {Map<string, THREE.MeshStandardMaterial>} */
        this._materials = new Map();
        /** @type {Map<string, MaterialOverride>} */
        this._overrides = new Map();
        /** @type {Map<string, {normalMap: THREE.Texture, roughnessMap: THREE.Texture}>} */
        this._treadCache = new Map();
        /** @type {THREE.Texture[]} */
        this._disposables = [];
    }

    /**
     * Get (and lazily create) a base material.
     * @param {keyof typeof MATERIAL_SPECS} key
     * @returns {THREE.MeshStandardMaterial}
     */
    get(key) {
        if (this._materials.has(key)) return this._materials.get(key);
        const spec = MATERIAL_SPECS[key];
        if (!spec) throw new Error(`Unknown material: ${key}`);
        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(spec.color),
            roughness: spec.roughness,
            metalness: spec.metalness
        });
        m.name = key;
        this._materials.set(key, m);
        this._apply(key);
        return m;
    }

    /**
     * A rubber material carrying the seeded tread maps for a given pattern
     * and tire size. Cached, so a class 13 unit with 34 identical tires
     * builds the maps once.
     *
     * @param {import('../geometry/tire.js').TreadPattern} pattern
     * @param {import('../core/tires.js').TireGeometry} g
     * @param {string} designation
     * @returns {THREE.MeshStandardMaterial}
     */
    rubberFor(pattern, g, designation) {
        const key = `rubber:${pattern}:${designation}`;
        if (this._materials.has(key)) return this._materials.get(key);

        const spec = MATERIAL_SPECS.rubber;
        const maps = this._treadMaps(pattern, g, designation);
        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(spec.color),
            roughness: spec.roughness,
            metalness: 0,
            normalMap: maps.normalMap,
            roughnessMap: maps.roughnessMap
        });
        m.normalScale = new THREE.Vector2(1, 1);
        m.name = key;
        // Tread repeats many times around the circumference; the lathe's U
        // runs around the tire, so repeat U by a count that keeps the block
        // pitch roughly constant across tire sizes.
        const repeatU = Math.max(6, Math.round((Math.PI * g.overallDiameter) / 260));
        maps.normalMap.repeat.set(repeatU, 1);
        maps.roughnessMap.repeat.set(repeatU, 1);

        this._materials.set(key, m);
        this._apply(key, 'rubber');
        return m;
    }

    /**
     * @param {import('../geometry/tire.js').TreadPattern} pattern
     * @param {import('../core/tires.js').TireGeometry} g
     * @param {string} designation
     */
    _treadMaps(pattern, g, designation) {
        const key = `${pattern}:${designation}`;
        if (this._treadCache.has(key)) {
            // Clone so each material can carry its own repeat without
            // disturbing the others that share the same source canvas.
            const src = this._treadCache.get(key);
            const n = src.normalMap.clone(); n.needsUpdate = true;
            const r = src.roughnessMap.clone(); r.needsUpdate = true;
            this._disposables.push(n, r);
            return { normalMap: n, roughnessMap: r };
        }
        const maps = buildTreadMaps(pattern, g, { seed: this.seed, designation });
        this._treadCache.set(key, maps);
        this._disposables.push(maps.normalMap, maps.roughnessMap);
        return maps;
    }

    /**
     * Set a user override and re-apply it.
     * @param {string} key
     * @param {MaterialOverride} override
     */
    setOverride(key, override) {
        this._overrides.set(key, { ...(this._overrides.get(key) || {}), ...override });
        // Apply to the base key and to every derived rubber variant.
        for (const k of this._materials.keys()) {
            if (k === key || k.startsWith(key + ':')) this._apply(k, key);
        }
    }

    /** @param {string} key @returns {MaterialOverride} */
    getOverride(key) { return this._overrides.get(key) || {}; }

    /** @param {string} key */
    resetOverride(key) {
        this._overrides.delete(key);
        for (const k of this._materials.keys()) {
            if (k === key || k.startsWith(key + ':')) this._apply(k, key);
        }
    }

    /**
     * @param {string} materialKey
     * @param {string} [specKey] which spec/override family this belongs to
     */
    _apply(materialKey, specKey) {
        const m = this._materials.get(materialKey);
        if (!m) return;
        const family = specKey || materialKey.split(':')[0];
        const spec = MATERIAL_SPECS[family];
        if (!spec) return;
        const o = this._overrides.get(family) || {};

        const base = new THREE.Color(spec.color);
        if (o.tint) base.multiply(new THREE.Color(o.tint));
        const b = o.brightness ?? 1;
        base.multiplyScalar(b);
        m.color.copy(base);
        m.roughness = o.roughness ?? spec.roughness;

        if (m.normalScale) {
            const rel = o.relief ?? spec.normalScale ?? 1;
            m.normalScale.set(rel, rel);
        }
        if (m.normalMap && o.textureScale) {
            const s = o.textureScale;
            m.normalMap.repeat.set(m.normalMap.repeat.x * 0 + s * 12, 1);
            if (m.roughnessMap) m.roughnessMap.repeat.copy(m.normalMap.repeat);
        }
        m.needsUpdate = true;
    }

    /** Free every GPU resource this library owns. */
    dispose() {
        for (const m of this._materials.values()) m.dispose();
        for (const t of this._disposables) t.dispose();
        this._materials.clear();
        this._treadCache.clear();
        this._disposables.length = 0;
    }
}
