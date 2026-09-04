/* ============================================================
   Gear3D — cameras and view modes
   ------------------------------------------------------------
   Four view modes, each with its OWN persisted camera state, so
   switching Plan -> 3D -> Plan returns you to the plan view you
   left rather than to a default.

   In the three locked orthographic modes, orbit is disabled at
   the controls level, not merely discouraged. Accidentally
   tumbling out of a plan view is the single most common
   frustration in tools like this, and the fix is to make it
   impossible rather than reversible.

   Every camera value the user can change is a number the UI shows
   in a field, so a figure caption can state the exact view.
   ============================================================ */

'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LOCKED_VIEWS, CAMERA_PRESETS, orbitToEng, engToRender } from '../core/coords.js';

/** @typedef {'3d'|'plan'|'side'|'front'} ViewMode */

/** All four modes, in UI order. */
export const VIEW_MODES = Object.freeze(['3d', 'plan', 'side', 'front']);

/** @type {Record<ViewMode, {label: string, purpose: string, locked: boolean}>} */
export const VIEW_META = Object.freeze({
    '3d': { label: '3D', purpose: 'Inspection and hero figures', locked: false },
    plan: { label: 'Plan', purpose: LOCKED_VIEWS.plan.purpose, locked: true },
    side: { label: 'Side', purpose: LOCKED_VIEWS.side.purpose, locked: true },
    front: { label: 'Front', purpose: LOCKED_VIEWS.front.purpose, locked: true }
});

/**
 * @typedef {Object} ModeState
 * @property {THREE.Vector3} target scene meters
 * @property {number} zoom          orthographic zoom
 * @property {number} azimuth       degrees, 3D only
 * @property {number} elevation     degrees, 3D only
 * @property {number} distance      meters, 3D perspective only
 * @property {'ortho'|'persp'} projection
 */

export class CameraRig {
    /**
     * @param {HTMLElement} domElement
     * @param {{fov?: number}} [opts]
     */
    constructor(domElement, opts = {}) {
        this.dom = domElement;
        this.aspect = 1;
        this.fov = opts.fov ?? 35;

        this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
        this.persp = new THREE.PerspectiveCamera(this.fov, 1, 0.01, 5000);

        /** @type {ViewMode} */
        this.mode = '3d';

        /** @type {Record<ViewMode, ModeState>} */
        this.states = {
            '3d': makeState({ azimuth: CAMERA_PRESETS.front34Left.azimuth, elevation: CAMERA_PRESETS.front34Left.elevation, projection: 'ortho' }),
            plan: makeState({ projection: 'ortho' }),
            side: makeState({ projection: 'ortho' }),
            front: makeState({ projection: 'ortho' })
        };

        this.controls = new OrbitControls(this.camera, domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.12;
        this.controls.screenSpacePanning = true;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };

        /** @type {THREE.Box3|null} last fitted bounds, for re-fits on resize */
        this._box = null;
        /** @type {(() => void)|null} */
        this.onChange = null;

        this.controls.addEventListener('change', () => {
            this._syncStateFromControls();
            if (this.onChange) this.onChange();
        });
    }

    /** @returns {THREE.Camera} the camera currently in use */
    get camera() {
        return this.states[this.mode].projection === 'persp' && this.mode === '3d'
            ? this.persp
            : this.ortho;
    }

    /** @returns {boolean} */
    get isLocked() { return VIEW_META[this.mode].locked; }

    /**
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        this.aspect = Math.max(1e-6, width / height);
        this.persp.aspect = this.aspect;
        this.persp.updateProjectionMatrix();
        this._updateOrthoFrustum();
    }

    /** Recompute the orthographic frustum from the fitted bounds and zoom. */
    _updateOrthoFrustum() {
        // Half-height is stored PER MODE. It used to be a single value fitted
        // for whichever mode was active when fit() last ran, so switching
        // Plan -> Front framed the front elevation using the plan's extents —
        // a 22 m truck's length deciding the zoom for a 2.4 m wide view.
        const half = this.states[this.mode]?.halfHeight ?? 2;
        this.ortho.top = half;
        this.ortho.bottom = -half;
        this.ortho.left = -half * this.aspect;
        this.ortho.right = half * this.aspect;
        this.ortho.near = -(this._depth ?? 1000);
        this.ortho.far = this._depth ?? 1000;
        this.ortho.updateProjectionMatrix();
    }

    /**
     * Which way a mode looks, and which way is up for it.
     * Shared by the interactive camera and the quad-view cameras so the two
     * can never disagree about what "Plan" means.
     *
     * @param {ViewMode} mode
     * @returns {{dir: THREE.Vector3, up: THREE.Vector3}} dir points from the
     *          target toward the camera, in the three.js frame
     */
    _orientation(mode) {
        if (VIEW_META[mode].locked) {
            const v = LOCKED_VIEWS[mode];
            const la = engToRender(v.lookAlong);
            const u = engToRender(v.up);
            return {
                dir: new THREE.Vector3(-la.x, -la.y, -la.z).normalize(),
                up: new THREE.Vector3(u.x, u.y, u.z).normalize()
            };
        }
        const s = this.states[mode];
        const r = engToRender(orbitToEng(s.azimuth, s.elevation));
        return {
            dir: new THREE.Vector3(r.x, r.y, r.z).normalize(),
            up: new THREE.Vector3(0, 1, 0)
        };
    }

    /**
     * Configure an arbitrary camera for a mode, without disturbing the
     * interactive state. Used to render all four quad panes in one frame.
     *
     * @param {THREE.OrthographicCamera} cam
     * @param {ViewMode} mode
     * @param {number} aspect
     * @returns {THREE.OrthographicCamera}
     */
    configureCamera(cam, mode, aspect) {
        const s = this.states[mode];
        const { dir, up } = this._orientation(mode);
        const half = s.halfHeight ?? 2;
        const depth = this._depth ?? 1000;

        cam.top = half;
        cam.bottom = -half;
        cam.left = -half * aspect;
        cam.right = half * aspect;
        cam.near = -depth;
        cam.far = depth;
        cam.zoom = s.zoom;
        cam.updateProjectionMatrix();

        cam.position.copy(s.target).addScaledVector(dir, Math.max(10, depth * 0.35));
        cam.up.copy(up);
        cam.lookAt(s.target);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * Four cameras, one per pane, configured for the given pane aspect.
     * Pooled: quad view re-renders on every interaction and allocating four
     * cameras a frame would churn needlessly.
     *
     * @param {number} aspect
     * @returns {Record<string, THREE.OrthographicCamera>}
     */
    quadCameras(aspect) {
        if (!this._pool) {
            this._pool = {};
            for (const m of VIEW_MODES) this._pool[m] = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
        }
        for (const m of VIEW_MODES) this.configureCamera(this._pool[m], m, aspect);
        return this._pool;
    }

    /**
     * Switch mode, restoring that mode's saved camera state.
     * @param {ViewMode} mode
     */
    setMode(mode) {
        if (!VIEW_MODES.includes(mode)) throw new Error(`Unknown view mode: ${mode}`);
        this._syncStateFromControls();
        this.mode = mode;
        this.controls.object = this.camera;
        this.controls.enableRotate = !this.isLocked;
        this._applyState();
    }

    /**
     * @param {'ortho'|'persp'} projection 3D mode only; locked views are always orthographic
     */
    setProjection(projection) {
        if (this.mode !== '3d') return;
        this.states['3d'].projection = projection;
        this.controls.object = this.camera;
        this._applyState();
    }

    /**
     * Apply a named 3D preset.
     * @param {keyof typeof CAMERA_PRESETS} name
     */
    setPreset(name) {
        const p = CAMERA_PRESETS[name];
        if (!p) return;
        if (this.mode !== '3d') this.setMode('3d');
        const s = this.states['3d'];
        s.azimuth = p.azimuth;
        s.elevation = p.elevation;
        this._applyState();
    }

    /**
     * @param {number} azimuth degrees
     * @param {number} elevation degrees
     */
    setOrbit(azimuth, elevation) {
        const s = this.states['3d'];
        s.azimuth = azimuth;
        s.elevation = Math.max(-89, Math.min(89, elevation));
        if (this.mode === '3d') this._applyState();
    }

    /** @returns {{azimuth: number, elevation: number}} */
    getOrbit() {
        const s = this.states['3d'];
        return { azimuth: s.azimuth, elevation: s.elevation };
    }

    /**
     * Frame a bounding box in the current mode.
     * @param {THREE.Box3} box scene meters
     * @param {number} [padding=1.14] multiplier on the fitted extent
     */
    fit(box, padding = 1.14) {
        if (box.isEmpty()) return;
        this._box = box.clone();
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        this._depth = Math.max(size.x, size.y, size.z) * 6 + 10;

        // Fit EVERY mode, not just the active one. Each view direction sees a
        // different silhouette — plan sees length by width, front sees width
        // by height — so each needs its own half-height. Quad view renders all
        // four at once and would otherwise show three of them mis-framed.
        for (const m of VIEW_MODES) {
            const s = this.states[m];
            s.target.copy(center);
            const { horizontal, vertical } = this._extentsFor(m, size);
            const needH = vertical * padding;
            const needW = (horizontal * padding) / this.aspect;
            s.halfHeight = Math.max(needH, needW) / 2;
            s.distance = Math.max(size.x, size.y, size.z) * 2.2 + 1;
            s.zoom = 1;
        }

        // THE THREE ORTHOGRAPHIC VIEWS SHARE ONE SCALE.
        //
        // Fitted independently, the front elevation of a 22 m truck comes out
        // roughly seven times larger than its side elevation — each pane is
        // correctly framed and the sheet is useless, because the whole point
        // of plan/side/front together is that a reader can carry a dimension
        // between them by eye. Drafting practice puts all three at one scale
        // and so does this. 3D is a pictorial reference, not an elevation, so
        // it keeps its own fit.
        const shared = Math.max(
            this.states.plan.halfHeight,
            this.states.side.halfHeight,
            this.states.front.halfHeight
        );
        for (const m of ['plan', 'side', 'front']) this.states[m].halfHeight = shared;

        this._updateOrthoFrustum();
        this._applyState();
    }

    /**
     * Extent of the model across the screen for a given mode.
     * @param {ViewMode} mode
     * @param {THREE.Vector3} size scene meters, three.js axes
     * @returns {{horizontal: number, vertical: number}}
     */
    _extentsFor(mode, size) {
        // three.js axes: x = engineering y, y = engineering z, z = engineering x
        switch (mode) {
            case 'plan':  return { horizontal: size.z, vertical: size.x };
            case 'side':  return { horizontal: size.z, vertical: size.y };
            case 'front': return { horizontal: size.x, vertical: size.y };
            default: {
                const d = Math.hypot(size.x, size.z);
                return { horizontal: d, vertical: Math.max(size.y, d * 0.6) };
            }
        }
    }

    /** Move the actual cameras to match the current mode state. */
    _applyState() {
        const s = this.states[this.mode];
        const cam = this.camera;

        const { dir, up } = this._orientation(this.mode);

        const dist = s.projection === 'persp' && this.mode === '3d'
            ? s.distance
            : Math.max(10, (this._depth ?? 1000) * 0.35);

        cam.position.copy(s.target).addScaledVector(dir, dist);
        cam.up.copy(up);
        cam.lookAt(s.target);

        if (cam === this.ortho) {
            this.ortho.zoom = s.zoom;
            this.ortho.updateProjectionMatrix();
        } else {
            this.persp.fov = this.fov;
            this.persp.updateProjectionMatrix();
        }

        this.controls.target.copy(s.target);
        this.controls.enableRotate = !this.isLocked;
        this.controls.update();
    }

    /** Read the controls back into the current mode's saved state. */
    _syncStateFromControls() {
        const s = this.states[this.mode];
        s.target.copy(this.controls.target);
        if (this.camera === this.ortho) s.zoom = this.ortho.zoom;
        if (!this.isLocked) {
            const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
            s.distance = off.length();
            // three.js -> engineering, then to azimuth/elevation
            const engDir = { x: off.z, y: off.x, z: off.y };
            const m = Math.hypot(engDir.x, engDir.y, engDir.z) || 1;
            s.elevation = (Math.asin(engDir.z / m) * 180) / Math.PI;
            s.azimuth = (Math.atan2(engDir.y, -engDir.x) * 180) / Math.PI;
        }
    }

    /** @param {number} fov degrees */
    setFov(fov) {
        this.fov = fov;
        this.persp.fov = fov;
        this.persp.updateProjectionMatrix();
    }

    /** @param {number} zoom */
    setZoom(zoom) {
        const s = this.states[this.mode];
        s.zoom = Math.max(0.02, zoom);
        if (this.camera === this.ortho) {
            this.ortho.zoom = s.zoom;
            this.ortho.updateProjectionMatrix();
        }
    }

    update() { this.controls.update(); }

    /** Serialize every mode's camera state into a project file. */
    toJSON() {
        /** @type {any} */
        const out = { mode: this.mode, fov: this.fov, states: {} };
        for (const m of VIEW_MODES) {
            const s = this.states[m];
            out.states[m] = {
                target: [s.target.x, s.target.y, s.target.z],
                zoom: s.zoom, azimuth: s.azimuth, elevation: s.elevation,
                distance: s.distance, projection: s.projection, halfHeight: s.halfHeight
            };
        }
        return out;
    }

    /** @param {any} json */
    fromJSON(json) {
        if (!json) return;
        this.fov = json.fov ?? this.fov;
        for (const m of VIEW_MODES) {
            const j = json.states?.[m];
            if (!j) continue;
            const s = this.states[m];
            s.target.set(j.target[0], j.target[1], j.target[2]);
            s.zoom = j.zoom; s.azimuth = j.azimuth; s.elevation = j.elevation;
            s.distance = j.distance; s.projection = j.projection;
            if (j.halfHeight != null) s.halfHeight = j.halfHeight;
        }
        this.setMode(json.mode || '3d');
    }

    dispose() { this.controls.dispose(); }
}

/**
 * @param {Partial<ModeState>} [init]
 * @returns {ModeState}
 */
function makeState(init = {}) {
    return {
        target: new THREE.Vector3(),
        zoom: 1,
        azimuth: init.azimuth ?? -30,
        elevation: init.elevation ?? 20,
        distance: 10,
        halfHeight: 2,
        projection: init.projection ?? 'ortho'
    };
}
