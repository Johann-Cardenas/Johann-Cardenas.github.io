/* ============================================================
   Gear3D — lighting presets
   ------------------------------------------------------------
   Four presets matching Cross-Section Studio, each fully described
   by numbers so a figure caption can state the exact setup.

   Every control has a numeric field beside its slider in the UI —
   a reproducible-views requirement, not a nicety.

   Scene units are METERS (the renderer scales millimeter geometry
   by 1/1000 once, at the root), so light distances and shadow
   camera extents below are in meters.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/**
 * @typedef {Object} LightingState
 * @property {string} preset
 * @property {number} keyIntensity
 * @property {number} ambient
 * @property {number} azimuth      degrees, about vertical
 * @property {number} elevation    degrees above the pavement
 * @property {number} shadowOpacity 0-1
 * @property {number} shadowSoftness 0-12
 * @property {boolean} groundShadow
 */

/** @type {Record<string, LightingState>} */
export const LIGHTING_PRESETS = Object.freeze({
    studio: {
        preset: 'studio',
        keyIntensity: 2.6, ambient: 0.85, azimuth: -38, elevation: 44,
        shadowOpacity: 0.32, shadowSoftness: 3.5, groundShadow: true
    },
    daylight: {
        preset: 'daylight',
        keyIntensity: 3.4, ambient: 0.55, azimuth: -60, elevation: 58,
        shadowOpacity: 0.46, shadowSoftness: 1.5, groundShadow: true
    },
    softbox: {
        preset: 'softbox',
        keyIntensity: 1.9, ambient: 1.35, azimuth: -20, elevation: 35,
        shadowOpacity: 0.18, shadowSoftness: 8.0, groundShadow: true
    },
    threepoint: {
        preset: 'threepoint',
        keyIntensity: 2.9, ambient: 0.5, azimuth: -45, elevation: 40,
        shadowOpacity: 0.38, shadowSoftness: 2.5, groundShadow: true
    }
});

export class LightingRig {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;

        this.ambient = new THREE.AmbientLight(0xffffff, 1);
        this.hemi = new THREE.HemisphereLight(0xdfe7ef, 0x3a3f45, 1);
        this.key = new THREE.DirectionalLight(0xffffff, 1);
        this.fill = new THREE.DirectionalLight(0xdce6f0, 0.35);
        this.rim = new THREE.DirectionalLight(0xffffff, 0.0);

        this.key.castShadow = true;
        /** Baseline the softness radius is calibrated against — see setShadowMapSize. */
        this.shadowMapSize = 2048;
        this.key.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
        this.key.shadow.bias = -0.0006;
        this.key.shadow.normalBias = 0.02;

        this.ground = null;
        this._radius = 10;

        scene.add(this.ambient, this.hemi, this.key, this.key.target, this.fill, this.rim);
        this.apply(LIGHTING_PRESETS.studio);
    }

    /**
     * Size the rig to the scene so shadows stay crisp on a motorcycle and
     * still cover a nine-axle turnpike double.
     * @param {THREE.Box3} box scene bounds in meters
     */
    fit(box) {
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const r = Math.max(size.x, size.y, size.z) * 0.75 + 0.5;
        this._radius = r;
        this._center = center;

        const cam = /** @type {THREE.OrthographicCamera} */ (this.key.shadow.camera);
        cam.left = -r * 1.6; cam.right = r * 1.6;
        cam.top = r * 1.6; cam.bottom = -r * 1.6;
        cam.near = 0.05; cam.far = r * 8;
        cam.updateProjectionMatrix();

        this.key.target.position.copy(center);
        this._place();
    }

    /**
     * @param {LightingState} s
     */
    apply(s) {
        this.state = { ...s };
        this.key.intensity = s.keyIntensity;
        // The studio environment map supplies most of the ambient term now,
        // so the analytic ambient and hemisphere lights are held well down.
        // Left at their pre-IBL values they double-count and wash the tread
        // relief flat — the shading that makes grooves read is exactly the
        // shading that excess ambient destroys.
        this.ambient.intensity = s.ambient * 0.16;
        this.hemi.intensity = s.ambient * 0.24;

        // Preset-specific secondary lights.
        //
        // Every preset except softbox carries some rim light. A tire is a
        // near-black object usually rendered against publication white, and
        // without a rim its far edge dissolves into the background — the
        // shape stops reading and the figure looks like a silhouette with
        // detail painted on the near side only. The rim light is what puts
        // the outline back.
        if (s.preset === 'threepoint') {
            this.fill.intensity = s.keyIntensity * 0.30;
            this.rim.intensity = s.keyIntensity * 0.60;
        } else if (s.preset === 'softbox') {
            this.fill.intensity = s.keyIntensity * 0.55;
            this.rim.intensity = s.keyIntensity * 0.12;
        } else if (s.preset === 'daylight') {
            this.fill.intensity = s.keyIntensity * 0.16;
            this.rim.intensity = s.keyIntensity * 0.30;
        } else {
            this.fill.intensity = s.keyIntensity * 0.20;
            this.rim.intensity = s.keyIntensity * 0.38;
        }

        // Shadow softness is expressed in the same 0-12 range as
        // Cross-Section Studio; three.js maps it to PCF radius.
        //
        // The radius is in SHADOW TEXELS, so the same number gives a visibly
        // crisper edge on a bigger map. Scaling by the map size keeps the
        // softness the user asked for looking the same at every render tier,
        // which is the whole point of raising the map: more samples across the
        // same penumbra, not a different penumbra.
        this.key.shadow.radius = Math.max(1, s.shadowSoftness) * (this.shadowMapSize / 2048);
        this.key.castShadow = s.groundShadow;

        this._place();
        if (this.ground) this.ground.material.opacity = s.shadowOpacity;
    }

    /**
     * Resize the shadow map. Driven by the render tier: a 4K drawing buffer
     * resolves shadow-map aliasing that a 2048 map hides at 1x, so the map has
     * to grow with the buffer or the crisper render just shows its stairsteps
     * more clearly.
     *
     * three.js allocates the depth target lazily and caches it, so the old one
     * must be disposed or the new size is ignored.
     *
     * @param {number} size
     */
    setShadowMapSize(size) {
        const n = Math.max(512, Math.min(8192, Math.round(size)));
        if (n === this.shadowMapSize) return;
        this.shadowMapSize = n;
        this.key.shadow.mapSize.set(n, n);
        if (this.key.shadow.map) {
            this.key.shadow.map.dispose();
            this.key.shadow.map = null;
        }
        // Re-apply so the softness radius is recalculated against the new map.
        if (this.state) this.apply(this.state);
    }

    /** Reposition the lights from the current azimuth/elevation. */
    _place() {
        const s = this.state;
        const r = this._radius * 2.4;
        const az = (s.azimuth * Math.PI) / 180;
        const el = (s.elevation * Math.PI) / 180;
        const c = this._center || new THREE.Vector3();

        // Scene frame is three.js Y-up: x right, y up, z toward viewer.
        const dir = new THREE.Vector3(
            Math.cos(el) * Math.sin(az),
            Math.sin(el),
            Math.cos(el) * Math.cos(az)
        );
        this.key.position.copy(c).addScaledVector(dir, r);
        this.key.target.position.copy(c);
        this.key.target.updateMatrixWorld();

        // Fill from the opposite side and lower.
        const fillDir = new THREE.Vector3(-dir.x, Math.max(0.25, dir.y * 0.45), -dir.z).normalize();
        this.fill.position.copy(c).addScaledVector(fillDir, r);

        // Rim from behind and slightly above, so it grazes the far edge of
        // the tires rather than lighting their faces.
        const rimDir = new THREE.Vector3(-dir.x * 0.85, 0.30, -dir.z * 0.95).normalize();
        this.rim.position.copy(c).addScaledVector(rimDir, r);
    }

    /**
     * A shadow-catching ground plane. Uses ShadowMaterial so the plane is
     * invisible except where it is shadowed — which is exactly what a
     * transparent-background export needs.
     *
     * The plane MUST stay inside the shadow camera's coverage. Outside the
     * shadow map, the depth lookup clamps to the border texel, and if that
     * texel reads as occluded the entire overhanging area renders fully
     * shadowed — a plane larger than the shadow frustum turns the whole
     * background into a gray slab. The shadow camera spans +/- 1.6 r, so the
     * plane is capped at a half-extent of 1.4 r with margin to spare.
     *
     * IT ALSO HAS TO BE UNDER THE MODEL. The plane used to be left at the
     * world origin, which was invisibly fine only because the rig was fitted
     * once to the whole vehicle and the plane was therefore vehicle-sized. Fit
     * it to an isolated rear axle instead — five meters down a semitrailer —
     * and a three-meter plane at the origin is nowhere near the shadow it is
     * supposed to catch, so the axle renders with no shadow at all. It is
     * centered on the fit, and stays on the pavement plane.
     *
     * @param {number} [size] meters; clamped to the shadow camera's coverage
     * @returns {THREE.Mesh}
     */
    makeGround(size) {
        const maxSize = this._radius * 2.8;
        size = Math.min(size ?? maxSize, maxSize);
        return this._makeGround(size);
    }

    /**
     * @param {number} size
     * @returns {THREE.Mesh}
     */
    _makeGround(size) {
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
        }
        const geo = new THREE.PlaneGeometry(size, size);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.ShadowMaterial({ opacity: this.state.shadowOpacity });
        const mesh = new THREE.Mesh(geo, mat);
        const c = this._center;
        if (c) mesh.position.set(c.x, 0, c.z);
        mesh.receiveShadow = true;
        mesh.name = 'ground-shadow';
        mesh.userData.pickable = false;
        this.ground = mesh;
        this.scene.add(mesh);
        return mesh;
    }

    dispose() {
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
            this.ground = null;
        }
        for (const l of [this.ambient, this.hemi, this.key, this.fill, this.rim]) this.scene.remove(l);
    }
}
