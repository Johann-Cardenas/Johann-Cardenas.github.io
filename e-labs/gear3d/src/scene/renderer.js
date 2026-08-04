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
import { buildGrid } from './grid.js';
import { quadLayout } from '../views/quadview.js';

/** Hairline between quad panes, CSS pixels. */
export const QUAD_GAP = 2;

/**
 * Relative luminance of a hex colour, 0 (black) to 1 (white).
 * @param {string} hex
 * @returns {number}
 */
function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

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
        this.showGrid = true;
        /** Quad view: all four modes rendered in one frame. */
        this.quad = false;
        /** @type {THREE.LineSegments|null} */
        this._grid = null;

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
        // The grid's contrast depends on what it is drawn over.
        if (this._grid) this.rebuildGrid();
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
        this.rebuildGrid(box);
        this.cameras.fit(box);
        this.invalidate();
    }

    /**
     * Rebuild the ground grid for the current model extent.
     * @param {THREE.Box3} [box] scene metres; defaults to the assembly bounds
     */
    rebuildGrid(box) {
        if (this._grid) {
            this.scene.remove(this._grid);
            this._grid.geometry.dispose();
            /** @type {any} */(this._grid.material).dispose();
            this._grid = null;
        }
        if (!this.showGrid || !this.assembly) return;

        const b = box || this.assembly.bounds();
        const size = b.getSize(new THREE.Vector3());
        // Grid colour follows the FIGURE background, not the UI theme, for
        // the same reason the annotations do.
        const dark = this.background === 'color'
            ? luminance(this.backgroundColor) < 0.45
            : false;
        const { object } = buildGrid(Math.max(size.x, size.z) * 1000, {
            color: dark ? '#e8edf2' : '#16202b',
            minorOpacity: dark ? 0.20 : 0.15,
            majorOpacity: dark ? 0.38 : 0.30
        });
        // Centre it under the model. The engineering origin is the front
        // axle, so a grid left at the world origin covers only the front of
        // a long vehicle and its fade is centred on the wrong place.
        const centre = b.getCenter(new THREE.Vector3());
        object.position.set(centre.x, 0, centre.z);
        this._grid = object;
        this.scene.add(object);
        this.invalidate();
    }

    /** @param {boolean} on */
    setGrid(on) {
        this.showGrid = on;
        this.rebuildGrid();
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

    /**
     * The actual GL work, single-view or quad. Split out from render() so the
     * export path can drive exactly the same drawing rather than reaching for
     * `renderer.render` and silently losing the quad layout.
     *
     * @returns {{panes: import('../views/quadview.js').Pane[]}|null} pane
     *          rects when quad is active, so the annotation overlay can be
     *          drawn per pane against the same layout the GL pass used
     */
    renderScene() {
        const r = this.renderer;
        if (!this.quad) {
            r.setScissorTest(false);
            r.render(this.scene, this.cameras.camera);
            return null;
        }

        const size = r.getSize(new THREE.Vector2());
        const panes = quadLayout(size.x, size.y, QUAD_GAP);
        const aspect = panes[0].w / Math.max(1, panes[0].h);
        const cams = this.cameras.quadCameras(aspect);

        // Clear the WHOLE frame first, with the scissor off. Left to the
        // per-pane renders, each pane would clear only its own rect and the
        // hairline gaps between them would keep last frame's pixels.
        r.setScissorTest(false);
        r.clear();
        const prevAutoClear = r.autoClear;
        r.autoClear = false;
        r.setScissorTest(true);
        for (const p of panes) {
            r.setViewport(p.x, p.glY, p.w, p.h);
            r.setScissor(p.x, p.glY, p.w, p.h);
            r.render(this.scene, cams[p.mode]);
        }
        r.setScissorTest(false);
        r.autoClear = prevAutoClear;
        r.setViewport(0, 0, size.x, size.y);
        return { panes };
    }

    render() {
        const quad = this.renderScene();
        if (this.onFrame) {
            this.onFrame({
                vp: this.viewProjection(),
                viewport: this.size,
                panes: quad ? quad.panes : null,
                paneVp: quad ? this.paneProjections(quad.panes) : null
            });
        }
    }

    /**
     * View-projection matrices for each quad pane, keyed by mode.
     * @param {import('../views/quadview.js').Pane[]} panes
     * @returns {Record<string, number[]>}
     */
    paneProjections(panes) {
        const aspect = panes[0].w / Math.max(1, panes[0].h);
        const cams = this.cameras.quadCameras(aspect);
        /** @type {Record<string, number[]>} */
        const out = {};
        for (const p of panes) {
            const c = cams[p.mode];
            c.updateMatrixWorld();
            out[p.mode] = new THREE.Matrix4()
                .multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).elements;
        }
        return out;
    }

    /** @param {boolean} on */
    setQuad(on) {
        this.quad = !!on;
        // Orbit belongs to a single camera; in quad view the controls would
        // silently drive only the 3D pane while the user aimed at another.
        this.cameras.controls.enabled = !this.quad;
        this.invalidate();
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
        // Pixel coordinates travel with the hit as well as NDC: the SVG
        // annotation overlay works in CSS pixels, so anything that has to
        // agree with what is drawn there — snapping, in particular — needs
        // the same units rather than a second conversion that could drift.
        const hit = this.pickAt(this._pointer);
        hit.px = e.clientX - rect.left;
        hit.py = e.clientY - rect.top;
        cb(hit);
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
        if (this._grid) {
            this.scene.remove(this._grid);
            this._grid.geometry.dispose();
            /** @type {any} */(this._grid.material).dispose();
        }
        if (this.assembly) this.assembly.dispose();
        this.lighting.dispose();
        this.environment.dispose();
        this.cameras.dispose();
        this.renderer.dispose();
    }
}
