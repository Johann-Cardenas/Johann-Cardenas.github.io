/* ============================================================
   Gear3D — procedural studio environment (image-based lighting)
   ------------------------------------------------------------
   Machined aluminium is defined almost entirely by what it
   reflects. Lit by directional lights alone it reads as flat grey
   plastic, no matter how the roughness is tuned — there is simply
   nothing in the scene for it to mirror. Image-based lighting is
   what makes a rim look like metal.

   The environment is BUILT AT RUNTIME rather than loaded from an
   HDRI file. That keeps three promises the app already makes:

     - no asset dependency, so nothing can 404 into a broken render
     - no third-party licence travelling inside the repository
     - deterministic output, because the environment is a pure
       function of the lighting parameters

   A conventional studio: neutral cyclorama, a large key softbox,
   a weaker fill opposite, an overhead strip and a cool rim panel
   behind. The panels move with the lighting rig's azimuth and
   elevation, so the reflections in the rims agree with the
   direction of the cast shadows. When they disagree, an otherwise
   good figure looks subtly wrong and it is hard to say why.
   ============================================================ */

'use strict';

import * as THREE from 'three';

/**
 * @typedef {Object} EnvOptions
 * @property {number} [intensity=1]   overall brightness multiplier
 * @property {number} [azimuth=-38]   degrees, matches the key light
 * @property {number} [elevation=44]  degrees
 * @property {number} [contrast=1]    softbox brightness vs. cyclorama
 * @property {number} [blur=0.035]    PMREM roughness pre-blur
 */

/**
 * Build the environment scene. Exported separately so the geometry can be
 * inspected or unit-reasoned about without a renderer.
 *
 * @param {EnvOptions} [opts]
 * @returns {THREE.Scene}
 */
export function buildEnvironmentScene(opts = {}) {
    const intensity = opts.intensity ?? 1;
    const contrast = opts.contrast ?? 1;
    const az = ((opts.azimuth ?? -38) * Math.PI) / 180;
    const el = ((opts.elevation ?? 44) * Math.PI) / 180;

    const scene = new THREE.Scene();

    // --- cyclorama: an inverted box, brighter above than below, so a
    // horizontal surface picks up a sky/ground gradient the way it would
    // in a real studio.
    const room = new THREE.Mesh(
        new THREE.BoxGeometry(24, 14, 24),
        gradientMaterial(0x9aa4ad, 0x30363c, intensity * 0.55)
    );
    room.geometry.scale(-1, 1, 1);   // face inward
    room.position.y = 4;
    scene.add(room);

    /**
     * @param {number} w @param {number} h @param {number} lum
     * @param {THREE.Vector3} pos
     * @param {number} [tint=0xffffff]
     */
    const panel = (w, h, lum, pos, tint = 0xffffff) => {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(lum) })
        );
        m.position.copy(pos);
        m.lookAt(0, 1.2, 0);
        scene.add(m);
        return m;
    };

    // Direction the key light comes from, in the three.js frame.
    const dir = new THREE.Vector3(
        Math.cos(el) * Math.sin(az),
        Math.sin(el),
        Math.cos(el) * Math.cos(az)
    );

    // Key softbox: large and close, so it reads as a broad highlight band
    // across the rim barrel rather than a point glint.
    panel(9, 6, intensity * contrast * 3.2, dir.clone().multiplyScalar(8).setY(dir.y * 8 + 1.5));

    // Fill: opposite side, weaker and cooler.
    const fillDir = new THREE.Vector3(-dir.x, Math.max(0.3, dir.y * 0.55), -dir.z).normalize();
    panel(7, 5, intensity * 0.85, fillDir.multiplyScalar(9).setY(2.5), 0xdce8f5);

    // Overhead strip: puts a long highlight along the top of the tire crown,
    // which is what separates the crown from the sidewall in a photograph.
    panel(14, 2.2, intensity * contrast * 1.9, new THREE.Vector3(0, 9, 0));

    // Rim panel behind, cool, to lift the far edge of dark rubber off the
    // background.
    const rimDir = new THREE.Vector3(-dir.x * 0.7, 0.42, -dir.z).normalize();
    panel(8, 4, intensity * 0.7, rimDir.multiplyScalar(10).setY(3.2), 0xc7d8ea);

    // Ground bounce: a dim upward-facing panel so the underside of the tires
    // is not a dead black void.
    const bounce = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8e959b).multiplyScalar(intensity * 0.42) })
    );
    bounce.rotation.x = -Math.PI / 2;
    bounce.position.y = -0.6;
    scene.add(bounce);

    return scene;
}

/**
 * Vertical gradient, built as a small canvas texture on a basic material.
 * @param {number} top @param {number} bottom @param {number} lum
 * @returns {THREE.MeshBasicMaterial}
 */
function gradientMaterial(top, bottom, lum) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    const hex = (v) => '#' + new THREE.Color(v).multiplyScalar(lum).getHexString();
    g.addColorStop(0, hex(top));
    g.addColorStop(0.55, hex(top));
    g.addColorStop(1, hex(bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex });
}

/**
 * Manages the PMREM-filtered environment texture for a renderer.
 *
 * Rebuilding on every lighting tweak would stall the UI, so the generator
 * and the render target are reused and only regenerated when a parameter
 * that actually changes the environment moves.
 */
export class EnvironmentRig {
    /** @param {THREE.WebGLRenderer} renderer */
    constructor(renderer) {
        this.renderer = renderer;
        this._pmrem = new THREE.PMREMGenerator(renderer);
        this._pmrem.compileEquirectangularShader();
        /** @type {THREE.WebGLRenderTarget|null} */
        this._target = null;
        /** @type {string} */
        this._key = '';
    }

    /**
     * Generate (or reuse) the environment texture for these options.
     * @param {EnvOptions} opts
     * @returns {THREE.Texture}
     */
    build(opts = {}) {
        const key = JSON.stringify([
            round(opts.intensity ?? 1), round(opts.azimuth ?? -38),
            round(opts.elevation ?? 44), round(opts.contrast ?? 1), opts.blur ?? 0.035
        ]);
        if (this._target && key === this._key) return this._target.texture;

        const scene = buildEnvironmentScene(opts);
        const next = this._pmrem.fromScene(scene, opts.blur ?? 0.035);

        // Dispose the previous target only after the new one exists, so a
        // failed generation never leaves the scene without an environment.
        if (this._target) this._target.dispose();
        this._target = next;
        this._key = key;

        disposeScene(scene);
        return next.texture;
    }

    dispose() {
        if (this._target) { this._target.dispose(); this._target = null; }
        this._pmrem.dispose();
    }
}

/** @param {number} v @returns {number} */
function round(v) { return Math.round(v * 100) / 100; }

/** @param {THREE.Object3D} root */
function disposeScene(root) {
    root.traverse((o) => {
        const m = /** @type {any} */ (o);
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            }
        }
    });
}
