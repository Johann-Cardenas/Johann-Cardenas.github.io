/* ============================================================
   Gear3D — PBR materials
   ------------------------------------------------------------
   Every material exposes the same five controls as Cross-Section
   Studio — tint, brightness, roughness, texture scale, relief
   strength — so the two apps feel like one toolkit and a figure
   pair can be matched by eye.

   Two things here are doing most of the visual work:

   1. TREAD AND SIDEWALL ARE SEPARATE MATERIALS. They are
      genuinely different surfaces: a tread face is scuffed and
      matte, a sidewall is smoother and picks up a soft sheen
      along its bulge. Giving them one shared roughness is most of
      what makes a procedural tire look like a black doughnut.

   2. EVERYTHING RECEIVES THE ENVIRONMENT MAP. Machined aluminium
      is defined by what it reflects; without image-based lighting
      no roughness value will make it read as metal.

   Colours stay restrained. A publication figure is read for its
   geometry, and saturated rubber or chrome-bright rims fight the
   dimension overlay for attention.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { buildTreadMaps, buildSidewallMaps } from '../geometry/tire.js';
import { TextureLibrary } from './textures.js';

/**
 * @typedef {Object} MaterialSpec
 * @property {string} name
 * @property {number} color
 * @property {number} roughness
 * @property {number} metalness
 * @property {number} [normalScale]
 * @property {number} [clearcoat]
 * @property {number} [clearcoatRoughness]
 * @property {number} [envIntensity]
 * @property {string} description
 */

/** @type {Record<string, MaterialSpec>} */
export const MATERIAL_SPECS = Object.freeze({
    rubberTread: {
        name: 'Tread rubber',
        color: 0x2a2f35, roughness: 0.90, metalness: 0.0, normalScale: 0.9, envIntensity: 0.55,
        description: 'The running face. Scuffed and matte — it spends its life abrading against '
            + 'aggregate. Held a little lighter than a photograph: against publication white a '
            + 'truly black tire loses all of its form and reads as a silhouette.'
    },
    rubberSidewall: {
        name: 'Sidewall rubber',
        color: 0x24282e, roughness: 0.74, metalness: 0.0, normalScale: 0.7, envIntensity: 0.8,
        description: 'Smoother and slightly glossier than the tread, with a soft sheen along the '
            + 'bulge. Carries the moulded ribbing and lettering relief.'
    },
    aluminium: {
        name: 'Machined aluminium rim',
        color: 0xb9bfc6, roughness: 0.30, metalness: 0.92,
        clearcoat: 0.30, clearcoatRoughness: 0.24, envIntensity: 1.0,
        description: 'Polished forged aluminium wheel disc — the face you actually see, with a '
            + 'light clearcoat for the lacquer.'
    },
    rimBarrel: {
        name: 'Rim barrel',
        color: 0x5d646b, roughness: 0.68, metalness: 0.55, envIntensity: 0.45,
        description: 'The inside of the wheel well. Deliberately NOT the polished disc material: '
            + 'the barrel sits inside the tire, in shadow, and is painted rather than machined. '
            + 'Given the polished treatment it reads as a chrome spool and becomes the brightest '
            + 'object in the figure, which is exactly backwards — it should recede behind the '
            + 'tread and the disc face.'
    },
    steelWheel: {
        name: 'Painted steel rim',
        color: 0x8d9299, roughness: 0.52, metalness: 0.70, envIntensity: 0.85,
        description: 'Painted steel disc wheel, the budget fitment.'
    },
    hub: {
        name: 'Painted steel hub',
        color: 0x6d757e, roughness: 0.58, metalness: 0.60, envIntensity: 0.9,
        description: 'Hub, cap and lug nuts.'
    },
    drum: {
        name: 'Cast brake drum',
        color: 0x59524c, roughness: 0.86, metalness: 0.40, envIntensity: 0.7,
        description: 'Cast iron, lightly oxidised.'
    },
    axleBeam: {
        name: 'Galvanised axle beam',
        color: 0x7e858c, roughness: 0.66, metalness: 0.72, envIntensity: 0.95,
        description: 'Axle housing and spring pads.'
    },
    strut: {
        name: 'Landing gear strut',
        color: 0xb2b9c0, roughness: 0.30, metalness: 0.90,
        clearcoat: 0.25, clearcoatRoughness: 0.18, envIntensity: 1.1,
        description: 'Cadmium-plated / polished oleo strut and bogie beam.'
    },
    chassis: {
        name: 'Chassis',
        color: 0x4a5560, roughness: 0.58, metalness: 0.35, envIntensity: 0.85,
        description: 'Frame rails and body silhouette.'
    }
});

/**
 * @typedef {Object} MaterialOverride
 * @property {string}  [tint]
 * @property {number}  [brightness]
 * @property {number}  [roughness]
 * @property {number}  [textureScale]
 * @property {number}  [relief]
 */

export class MaterialLibrary {
    /** @param {{seed?: string, quality?: string}} [opts] */
    constructor(opts = {}) {
        this.seed = opts.seed ?? 'gear3d-01';
        /** @type {Map<string, THREE.Material>} */
        this._materials = new Map();
        /** @type {Map<string, MaterialOverride>} */
        this._overrides = new Map();
        /** @type {Map<string, any>} */
        this._mapCache = new Map();
        /** @type {THREE.Texture[]} */
        this._textures = [];
        /** @type {THREE.Texture|null} */
        this._env = null;
        this._envIntensity = 1;

        // CC0 surface detail. Optional by construction: materials are always
        // created with their procedural maps first, and these are swapped in
        // only if they load.
        this.textures = opts.textures ?? new TextureLibrary();
        this.useCC0 = opts.useCC0 !== false;
        /** @type {(() => void)|null} fired when a swap lands, so the host can redraw */
        this.onTextureUpgrade = null;
    }

    /**
     * Swap CC0 micro-detail onto a material once it has loaded.
     *
     * THE ROUGHNESS MULTIPLY IS THE TRAP HERE. three.js computes final
     * roughness as `material.roughness * roughnessMap.g`, so attaching a
     * scanned map to a material whose roughness was already tuned darkens
     * it twice: a 0.90 tread against a map averaging ~0.5 lands at 0.45 and
     * the rubber renders wet and plasticky. When a scanned map is attached
     * the base is therefore set to 1.0 and the measured data is allowed to
     * speak for itself, which is the physically meaningful choice anyway.
     *
     * The user's roughness override still works: `_apply` runs after this
     * and re-asserts whatever they set.
     *
     * @param {THREE.Material} m
     * @param {keyof typeof import('./textures.js').TEXTURE_SETS} name
     * @param {number} ru repeat along U
     * @param {number} rv repeat along V
     */
    _upgrade(m, name, ru, rv) {
        if (!this.useCC0) return;
        this.textures.load(name).then((set) => {
            if (!set || !m) return;
            const t = this.textures.tiled(set, ru, rv);
            const any = /** @type {any} */ (m);
            any.normalMap = t.normal;
            any.roughnessMap = t.rough;
            any.roughness = 1.0;
            any.needsUpdate = true;
            if (this.onTextureUpgrade) this.onTextureUpgrade();
        });
    }

    /**
     * Install the environment map on every material, current and future.
     * @param {THREE.Texture|null} texture
     * @param {number} [intensity=1]
     */
    setEnvironment(texture, intensity = 1) {
        this._env = texture;
        this._envIntensity = intensity;
        for (const [key, m] of this._materials) this._applyEnv(key, m);
    }

    /**
     * @param {string} key
     * @param {THREE.Material} m
     */
    _applyEnv(key, m) {
        const family = key.split(':')[0];
        const spec = MATERIAL_SPECS[family];
        const any = /** @type {any} */ (m);
        any.envMap = this._env;
        any.envMapIntensity = (spec?.envIntensity ?? 1) * this._envIntensity;
        m.needsUpdate = true;
    }

    /**
     * Get (and lazily create) a base material.
     * @param {keyof typeof MATERIAL_SPECS} key
     * @returns {THREE.Material}
     */
    get(key) {
        if (this._materials.has(key)) return this._materials.get(key);
        const spec = MATERIAL_SPECS[key];
        if (!spec) throw new Error(`Unknown material: ${key}`);

        const params = {
            color: new THREE.Color(spec.color),
            roughness: spec.roughness,
            metalness: spec.metalness
        };
        const m = spec.clearcoat != null
            ? new THREE.MeshPhysicalMaterial({
                ...params,
                clearcoat: spec.clearcoat,
                clearcoatRoughness: spec.clearcoatRoughness ?? 0.2
            })
            : new THREE.MeshStandardMaterial(params);

        m.name = key;
        this._materials.set(key, m);
        this._applyEnv(key, m);
        this._apply(key);

        // METALS DELIBERATELY KEEP THEIR DESIGNED MATERIALS.
        //
        // A scanned metal set was evaluated and rejected on the evidence: the
        // candidate's normal map is almost perfectly flat (a smooth metal, so
        // it contributes no visible machining detail) while its roughness map
        // dropped the rims and axle beams to a wet, plastic-looking gloss that
        // was plainly worse than the tuned values. Rubber gains from measured
        // micro-detail because rubber IS micro-detailed; a machined rim is
        // characterised by what it reflects, which the studio environment map
        // already supplies. Recorded in assets/textures/CREDITS.md.
        return m;
    }

    /**
     * The two materials a tire needs, ordered to match the geometry groups
     * emitted by `buildTireGeometry`: [sidewall, tread].
     *
     * Cached per designation and pattern, so a class 13 unit with 34
     * identical tires builds its maps exactly once.
     *
     * @param {import('../geometry/tire.js').TreadPattern} pattern
     * @param {import('../core/tires.js').TireGeometry} g
     * @param {string} designation
     * @returns {THREE.Material[]}
     */
    tireMaterials(pattern, g, designation) {
        return [
            this._tirePart('rubberSidewall', pattern, g, designation),
            this._tirePart('rubberTread', pattern, g, designation)
        ];
    }

    /**
     * @param {'rubberTread'|'rubberSidewall'} family
     * @param {import('../geometry/tire.js').TreadPattern} pattern
     * @param {import('../core/tires.js').TireGeometry} g
     * @param {string} designation
     * @returns {THREE.Material}
     */
    _tirePart(family, pattern, g, designation) {
        const key = `${family}:${pattern}:${designation}`;
        if (this._materials.has(key)) return this._materials.get(key);

        const spec = MATERIAL_SPECS[family];
        const maps = family === 'rubberTread'
            ? this._cachedMaps(`tread:${pattern}:${designation}`, () => buildTreadMaps(pattern, g, { seed: this.seed, designation }))
            : this._cachedMaps(`side:${designation}`, () => buildSidewallMaps(g, { seed: this.seed, designation }));

        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(spec.color),
            roughness: spec.roughness,
            metalness: 0,
            normalMap: maps.normalMap,
            roughnessMap: maps.roughnessMap
        });
        m.normalScale = new THREE.Vector2(spec.normalScale ?? 1, spec.normalScale ?? 1);
        m.name = key;

        this._materials.set(key, m);
        this._applyEnv(key, m);
        this._apply(key, family);

        // Real physical tiling. The tyre's own UVs already repeat `uRepeat`
        // times around the circumference (see geometry/tire.js), so the
        // texture repeat has to be divided by that or the grain would be
        // multiplied twice and turn to noise.
        const circumference = Math.PI * g.overallDiameter;
        const uRepeat = Math.max(4, Math.round(circumference / 300));
        const developed = 2 * g.sectionHeight + g.sectionWidth;
        this._upgrade(
            m, 'rubber',
            this.textures.tilesAcross('rubber', circumference) / uRepeat,
            this.textures.tilesAcross('rubber', developed)
        );
        return m;
    }

    /**
     * @param {string} key
     * @param {() => {normalMap: THREE.Texture, roughnessMap: THREE.Texture}} build
     */
    _cachedMaps(key, build) {
        if (!this._mapCache.has(key)) {
            const maps = build();
            this._textures.push(maps.normalMap, maps.roughnessMap);
            this._mapCache.set(key, maps);
        }
        return this._mapCache.get(key);
    }

    /**
     * The material used to draw parts that isolation has hidden.
     *
     * Deliberately flat and unlit rather than a faded copy of the real
     * material: a ghost is context, not a measurement, and it must never be
     * mistaken for something that is actually in the figure. `depthWrite` is
     * off so ghosts never occlude the parts under study.
     *
     * @returns {THREE.Material}
     */
    ghost() {
        if (this._materials.has('__ghost')) return this._materials.get('__ghost');
        const m = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0x8894a0),
            transparent: true,
            opacity: 0.15,
            depthWrite: false
        });
        m.name = '__ghost';
        this._materials.set('__ghost', m);
        return m;
    }

    /**
     * @param {string} key
     * @param {MaterialOverride} override
     */
    setOverride(key, override) {
        this._overrides.set(key, { ...(this._overrides.get(key) || {}), ...override });
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
     * @param {string} [specKey]
     */
    _apply(materialKey, specKey) {
        const m = /** @type {any} */ (this._materials.get(materialKey));
        if (!m) return;
        const family = specKey || materialKey.split(':')[0];
        const spec = MATERIAL_SPECS[family];
        if (!spec) return;
        const o = this._overrides.get(family) || {};

        const base = new THREE.Color(spec.color);
        if (o.tint) base.multiply(new THREE.Color(o.tint));
        base.multiplyScalar(o.brightness ?? 1);
        m.color.copy(base);
        m.roughness = o.roughness ?? spec.roughness;

        if (m.normalScale) {
            const rel = o.relief ?? spec.normalScale ?? 1;
            m.normalScale.set(rel, rel);
        }
        if (m.normalMap && o.textureScale != null) {
            const s = Math.max(0.05, o.textureScale);
            m.normalMap.repeat.set(s, s);
            if (m.roughnessMap) m.roughnessMap.repeat.copy(m.normalMap.repeat);
        }
        m.needsUpdate = true;
    }

    /** Free every GPU resource this library owns. */
    dispose() {
        for (const m of this._materials.values()) m.dispose();
        for (const t of this._textures) t.dispose();
        this.textures.dispose();
        this._materials.clear();
        this._mapCache.clear();
        this._textures.length = 0;
    }
}
