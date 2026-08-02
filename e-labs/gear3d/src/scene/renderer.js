/* ============================================================
   Gear3D — renderer, render loop and picking
   ------------------------------------------------------------
   Owns the WebGL context, the scene, the camera rig, the lighting
   rig and the SVG annotation overlay, and keeps them in step.

   The overlay is a plain <svg> sitting on top of the canvas at the
   same pixel size. Because the annotation layer is projected from
   the same camera matrices the WebGL pass uses, a label can never
   drift from the feature it measures.

   Context loss is handled rather than ignored: losing the context
   during a large export and silently producing a black PNG is the
   classic failure of tools like this.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { CameraRig } from './cameras.js';
import { LightingRig, LIGHTING_PRESETS } from './lighting.js';
import { EnvironmentRig } from './environment.js';

/** Background modes. */
export const BACKGROUND_MODES = Object.freeze({
    white: { label: 'Publication white', color: '#ffffff', alpha: 1 },
    color: { label: 'Custom colour', color: '#eef1f4', alpha: 1 },
    transparent: { label: 'Transparent', color: '#000000', alpha: 0 }
});

export class Viewport {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {SVGSVGElement} overlay
     * @param {HTMLElement} container
     */
    constructor(canvas, overlay, container) {
        this.canvas = canvas;
        this.overlay = overlay;
        this.container = container;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true    // required for toDataURL exports
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.cameras = new CameraRig(container);
        this.lighting = new LightingRig(this.scene);
        this.environment = new EnvironmentRig(this.renderer);

        /** @type {import('./materials.js').MaterialLibrary|null} */
        this.materials = null;

        /** @type {import('../geometry/assembly.js').Assembly|null} */
        this.assembly = null;

        this.background = 'white';
        this.backgroundColor = '#ffffff';

        this._raycaster = new THREE.Raycaster();
        this._pointer = new THREE.Vector2();
        this._dirty = true;
        this._running = false;
        this._contextLost = false;

        /** @type {((info: {vp: Float32Array|number[], viewport: {width:number, height:number}}) => void)|null} */
        this.onFrame = null;
        /** @type {((hit: any) => void)|null} */
        this.onPick = null;
        /** @type {((hit: any) => void)|null} */
        this.onHover = null;
        /** @type {(() => void)|null} */
        this.onContextLost = null;

        this.cameras.onChange = () => this.invalidate();

        this._observer = new ResizeObserver(() => this.resize());
        this._observer.observe(container);

        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._contextLost = true;
            this._running = false;
            if (this.onContextLost) this.onContextLost();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this._contextLost = false;
            this.renderer.shadowMap.needsUpdate = true;
            this.invalidate();
            this.start();
        });

        canvas.addEventListener('pointermove', (e) => this._handlePointer(e, 'hover'));
        canvas.addEventListener('pointerdown', (e) => { this._downAt = { x: e.clientX, y: e.clientY }; });
        canvas.addEventListener('pointerup', (e) => {
            // Only treat it as a click if the pointer barely moved — otherwise
            // every orbit drag would also re-select something.
            const d = this._downAt ? Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) : 99;
            if (d < 4) this._handlePointer(e, 'pick');
        });

        this.resize();
        this.setBackground('white');
    }

    /** @returns {{width: number, height: number}} CSS pixels */
    get size() {
        const r = this.container.getBoundingClientRect();
        return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    }

    resize() {
        const { width, height } = this.size;
        this.renderer.setSize(width, height, false);
        this.cameras.setSize(width, height);
        this.overlay.setAttribute('width', String(width));
        this.overlay.setAttribute('height', String(height));
        this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
        this.invalidate();
    }

    /**
     * @param {keyof typeof BACKGROUND_MODES} mode
     * @param {string} [color]
     */
    setBackground(mode, color) {
        this.background = mode;
        if (color) this.backgroundColor = color;
        const m = BACKGROUND_MODES[mode] || BACKGROUND_MODES.white;
        const c = mode === 'color' ? this.backgroundColor : m.color;
        this.renderer.setClearColor(new THREE.Color(c), m.alpha);
        this.scene.background = m.alpha === 0 ? null : new THREE.Color(c);
        this.invalidate();
    }

    /**
     * Install an assembly, replacing any previous one.
     * @param {import('../geometry/assembly.js').Assembly} assembly
     */
    setAssembly(assembly) {
        if (this.assembly) {
            this.scene.remove(this.assembly.root);
            this.assembly.dispose();
        }
        this.assembly = assembly;
        this.scene.add(assembly.root);

        const box = assembly.bounds();
        this.lighting.fit(box);
        // Let the rig size its own shadow catcher: it is the only thing that
        // knows how far the shadow camera actually reaches.
        this.lighting.makeGround();
        this.cameras.fit(box);
        this.invalidate();
    }

    /**
     * Frame a box given in ENGINEERING millimetres.
     * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} b
     */
    frameEngineering(b) {
        // engineering (x,y,z) -> render (y,z,x), then mm -> m
        const box = new THREE.Box3(
            new THREE.Vector3(b.minY / 1000, b.minZ / 1000, b.minX / 1000),
            new THREE.Vector3(b.maxY / 1000, b.maxZ / 1000, b.maxX / 1000)
        );
        this.cameras.fit(box);
        this.invalidate();
    }

    /**
     * Bind the material library so the environment map can be pushed onto it
     * whenever the lighting changes.
     * @param {import('./materials.js').MaterialLibrary} library
     */
    setMaterialLibrary(library) {
        this.materials = library;
        this._refreshEnvironment();
    }

    /** @param {import('./lighting.js').LightingState} state */
    setLighting(state) {
        this.lighting.apply(state);
        this._refreshEnvironment();
        this.invalidate();
    }

    /**
     * Regenerate the studio environment from the current lighting and push it
     * onto every material.
     *
     * The reflections have to agree with the cast shadows — a rim mirroring a
     * softbox on its left while its shadow falls to the left looks subtly
     * wrong in a way that is hard to name and impossible to unsee, so the
     * environment is driven by the same azimuth and elevation as the key
     * light rather than being a fixed backdrop.
     */
    _refreshEnvironment() {
        const s = this.lighting.state;
        const tex = this.environment.build({
            intensity: 0.55 + s.ambient * 0.55,
            azimuth: s.azimuth,
            elevation: s.elevation,
            contrast: 0.6 + s.keyIntensity * 0.22,
            blur: s.shadowSoftness > 6 ? 0.06 : 0.035
        });
        this.scene.environment = tex;
        if (this.materials) this.materials.setEnvironment(tex, 1);
    }

    /** @param {string} preset */
    setLightingPreset(preset) {
        const p = LIGHTING_PRESETS[preset];
        if (p) this.setLighting({ ...p });
    }

    invalidate() { this._dirty = true; }

    start() {
        if (this._running) return;
        this._running = true;
        const loop = () => {
            if (!this._running) return;
            requestAnimationFrame(loop);
            // OrbitControls damping needs continuous updates while settling;
            // `update()` returns true when it actually moved the camera.
            const moved = this.cameras.controls.update();
            if (moved) this._dirty = true;
            if (this._dirty && !this._contextLost) {
                this._dirty = false;
                this.render();
            }
        };
        requestAnimationFrame(loop);
    }

    stop() { this._running = false; }

    render() {
        this.renderer.render(this.scene, this.cameras.camera);
        if (this.onFrame) {
            this.onFrame({ vp: this.viewProjection(), viewport: this.size });
        }
    }

    /**
     * View-projection matrix elements for the annotation layer.
     * @returns {number[]}
     */
    viewProjection() {
        const cam = this.cameras.camera;
        cam.updateMatrixWorld();
        const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        return m.elements;
    }

    /* ---------------- picking ---------------- */

    /**
     * @param {PointerEvent} e
     * @param {'pick'|'hover'} kind
     */
    _handlePointer(e, kind) {
        const cb = kind === 'pick' ? this.onPick : this.onHover;
        if (!cb || !this.assembly) return;
        const rect = this.canvas.getBoundingClientRect();
        this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        cb(this.pickAt(this._pointer));
    }

    /**
     * Raycast into the assembly.
     * @param {THREE.Vector2} ndc
     * @returns {{wheel: object|null, axleId: string|null, groupId: string|null, positionId: string|null, point: THREE.Vector3|null}}
     */
    pickAt(ndc) {
        const empty = { wheel: null, axleId: null, groupId: null, positionId: null, point: null };
        if (!this.assembly) return empty;

        this._raycaster.setFromCamera(ndc, this.cameras.camera);
        const hits = this._raycaster.intersectObject(this.assembly.root, true);

        for (const h of hits) {
            const obj = h.object;
            if (obj.userData && obj.userData.pickable === false) continue;

            if (/** @type {any} */(obj).isInstancedMesh && h.instanceId != null) {
                const wheel = this.assembly.wheelAt(/** @type {any} */(obj), h.instanceId);
                if (wheel) {
                    return {
                        wheel,
                        axleId: wheel.axleId,
                        groupId: wheel.groupId,
                        positionId: wheel.positionId,
                        point: h.point
                    };
                }
                continue;
            }

            // Walk up to an axle group node.
            let n = /** @type {THREE.Object3D|null} */ (obj);
            while (n) {
                if (n.userData && n.userData.kind === 'axle') {
                    return {
                        wheel: null,
                        axleId: n.userData.axleId,
                        groupId: n.userData.groupId || null,
                        positionId: null,
                        point: h.point
                    };
                }
                n = n.parent;
            }
        }
        return empty;
    }

    /* ---------------- capabilities ---------------- */

    /**
     * GL limits, queried before allocating a large framebuffer for export.
     * @returns {{maxRenderbuffer: number, maxTexture: number, maxViewport: number[]}}
     */
    capabilities() {
        const gl = this.renderer.getContext();
        return {
            maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096, 4096])
        };
    }

    dispose() {
        this.stop();
        this._observer.disconnect();
        if (this.assembly) this.assembly.dispose();
        this.lighting.dispose();
        this.environment.dispose();
        this.cameras.dispose();
        this.renderer.dispose();
    }
}
