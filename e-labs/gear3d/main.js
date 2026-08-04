/* ============================================================
   Gear3D — application entry point
   ------------------------------------------------------------
   Wires the data library, the scene, the annotation engine, the
   contact-patch module and the export pipeline to the DOM.

   Deliberately one controller module rather than a tree of small
   ui/ files: the state here is a single document plus a handful of
   view flags, every panel reads and writes that same state, and
   splitting it across six files would spread one flow of control
   over six places without making any of them independently
   testable. The genuinely testable logic already lives under
   src/core, src/contact and src/annotate, none of which touch the
   DOM. Recorded in DECISIONS.md.
   ============================================================ */

import * as THREE from 'three';

import { setNominalTable } from './src/core/tires.js';
import { resolveLayout, swapToWideBase } from './src/core/layout.js';
import { validateUnit, tireCount } from './src/core/schema.js';
import { Store } from './src/core/store.js';
import { checkBridgeFormula } from './src/core/bridge.js';
import {
    UNIT_SYSTEMS, formatLength, formatForce, formatMass, formatArea,
    formatPressure, lengthFromMm, lengthToMm, canonical
} from './src/core/units.js';
import { DEFAULT_SEED } from './src/core/prng.js';
import { APP_REVISION } from './src/core/version.js';
import { CAMERA_PRESETS, ENG_AXES } from './src/core/coords.js';

import { MaterialLibrary, MATERIAL_SPECS } from './src/scene/materials.js';
import { LIGHTING_PRESETS } from './src/scene/lighting.js';
import { Viewport } from './src/scene/renderer.js';
import { VIEW_META } from './src/scene/cameras.js';
import { buildAssembly } from './src/geometry/assembly.js';

import {
    autoDimensions, renderDimensions, renderCallouts, renderScaleBar, dimensionValue
} from './src/annotate/dimensions.js';
import { projectEng } from './src/annotate/projection.js';
import { buildSnapPoints, nearestSnapPoint, dimensionFromSnaps } from './src/annotate/snapping.js';

import { computePatches, patchTotals, patchOutlineAbsolute, DEFAULT_INFLATION_KPA } from './src/contact/patch.js';
import { toCSV, toJSON as footprintJSON, toAbaqus } from './src/contact/export.js';

import { paneAt } from './src/views/quadview.js';
import {
    defaultIsolation, wheelPredicate, ISOLATION_LEVELS, ISOLATION_META,
    drillInto, stepOut, describeIsolation, isolationBounds, showChassis
} from './src/views/isolation.js';

import {
    renderToCanvas, renderSupersampled, compositeOverlay, canvasToBlob, RESOLUTION_PRESETS
} from './src/io/exportRaster.js';
import { buildHybridSVG, buildHybridPDF } from './src/io/exportVector.js';
import {
    serializeProject, parseProject, serializeUnit, download, readFileText,
    filenameFor, autosave, loadAutosave
} from './src/io/project.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

/* ============================================================
   1. State
   ============================================================ */

const app = {
    /** @type {any} */ library: { trucks: [], aircraft: [], index: null },
    /** @type {Store|null} */ store: null,
    /** @type {Viewport|null} */ viewport: null,
    /** @type {MaterialLibrary|null} */ materials: null,
    /** @type {any} */ assembly: null,
    /** @type {any} */ layout: null,
    /** @type {any} */ selection: { axleId: null, positionId: null },
    /** @type {any[]} */ patches: [],
    /** @type {import('./src/annotate/snapping.js').SnapPoint[]} */ snapPoints: [],
    /** Measurement mode: click two snap targets to create a dimension. */
    measure: { active: false, first: null, hover: null, cursor: null },
    /** Last frame's projection, so pointer handlers can snap against exactly
     *  what is on screen rather than recomputing a camera state. */
    lastFrame: null,
    dirtyOverlay: true
};

/** Everything that is not the document: view flags, not undoable. */
function defaultView() {
    return {
        mode: '3d',
        unitSystem: 'SI',
        precision: 0,
        dualUnits: false,
        // Annotations start deliberately sparse. A full class 9 with every
        // set enabled puts around twenty dimension lines over the model and
        // the geometry stops being readable; the point of the app is the
        // gear, with the numbers available on demand.
        annotations: true,
        dimensionSets: ['longitudinal', 'custom'],
        showCallouts: false,
        showScaleBar: true,
        showGrid: true,
        showPatches: false,
        patchModel: 'rectangular',
        inflationKpa: DEFAULT_INFLATION_KPA,
        /** Measured footprint dimensions, keyed by tire id. Kept beside the
         *  other contact settings, which also change exported numbers. */
        contactOverrides: {},
        isolation: defaultIsolation(),
        lighting: { ...LIGHTING_PRESETS.studio },
        background: 'white',
        backgroundColor: '#eef1f4',
        exportFormat: 'png',
        exportSize: '2400x1800',
        exportW: 2400,
        exportH: 1800,
        quality: 'standard',
        supersample: 2,
        /** Appearance overrides per material family. View state, not document:
         *  they cannot affect a dimension, a patch or an export. */
        materials: {}
    };
}

/* ============================================================
   2. Boot
   ============================================================ */

boot().catch((err) => {
    console.error(err);
    toast(`Gear3D could not start: ${err.message}`, 'error');
});

async function boot() {
    await loadLibrary();

    app.store = new Store(
        { unit: null, seed: DEFAULT_SEED, meta: {}, modifiedFrom: null, customDimensions: [], calloutOffsets: {} },
        defaultView()
    );

    setupViewport();
    setupToolbar();
    setupUnitPanel();
    setupIsolationPanel();
    setupDimensionPanel();
    setupContactPanel();
    setupCameraPanel();
    setupLightingPanel();
    setupMaterialPanel();
    setupBackgroundPanel();
    setupExportPanel();
    setupProjectPanel();
    setupMeasure();
    setupCallouts();
    setupKeyboard();

    const saved = loadAutosave();
    if (saved && saved.unit) {
        try {
            applyProject(saved);
            toast('Restored your last session.');
        } catch {
            loadUnitById('fhwa-c09-3S2');
        }
    } else {
        loadUnitById('fhwa-c09-3S2');
    }

    app.viewport.start();

    // Debug handle. Exposed deliberately: this app's whole claim is that its
    // numbers are real, and being able to read the resolved layout straight
    // out of the console is how you check that without trusting the UI.
    window.gear3d = app;
}

async function loadLibrary() {
    const base = new URL('./src/data/', import.meta.url);
    const get = async (p) => {
        const r = await fetch(new URL(p, base));
        if (!r.ok) throw new Error(`Could not load ${p} (HTTP ${r.status})`);
        return r.json();
    };

    const tires = await get('tires.json');
    setNominalTable(tires.nominal);
    app.library.tires = tires;

    const index = await get('trucks/index.json');
    app.library.index = index;
    const files = await Promise.all(index.files.map((f) => get(`trucks/${f}`)));
    app.library.trucks = files.flatMap((f) => f.units);

    // The aircraft library ships in v1.1; the code paths are already in
    // place, so an aircraft/index.json dropped in here is picked up with no
    // further changes.
    try {
        const ai = await get('aircraft/index.json');
        const af = await Promise.all(ai.files.map((f) => get(`aircraft/${f}`)));
        app.library.aircraft = af.flatMap((f) => f.units);
    } catch {
        app.library.aircraft = [];
    }

    $('g3-unit-count').textContent = String(app.library.trucks.length + app.library.aircraft.length);
    $('g3-tb-rev').textContent = APP_REVISION;
}

/* ============================================================
   3. Viewport
   ============================================================ */

function setupViewport() {
    app.materials = new MaterialLibrary({ seed: DEFAULT_SEED });
    // CC0 surface detail arrives asynchronously; redraw when it lands.
    app.materials.onTextureUpgrade = () => app.viewport?.invalidate();
    app.viewport = new Viewport(
        /** @type {HTMLCanvasElement} */($('g3-canvas')),
        /** @type {any} */($('g3-overlay')),
        $('g3-viewport')
    );

    // The viewport owns the environment map; the library owns the materials
    // it has to be pushed onto.
    app.viewport.setMaterialLibrary(app.materials);

    app.viewport.onFrame = (info) => drawOverlay(info);
    app.viewport.onContextLost = () => {
        toast('The WebGL context was lost. Reload the page to continue — your work is autosaved.', 'error');
    };

    app.viewport.onHover = (hit) => {
        if (app.measure.active) { updateMeasureHover(hit); return; }
        const el = $('g3-status-coords');
        if (hit.point) {
            // render (x,y,z) metres -> engineering millimetres
            const e = { x: hit.point.z * 1000, y: hit.point.x * 1000, z: hit.point.y * 1000 };
            el.textContent = `x ${e.x.toFixed(0)}  y ${e.y.toFixed(0)}  z ${e.z.toFixed(0)} mm`;
        } else {
            el.textContent = '—';
        }
    };

    app.viewport.onPick = (hit) => {
        // Measuring takes the click. Drilling isolation at the same time
        // would move the camera out from under a half-placed dimension.
        if (app.measure.active) { placeMeasurePoint(); return; }

        // In quad view a click means "open this pane", which is the only
        // interpretation that makes sense: isolation drilling would apply to
        // whichever pane happened to be under the cursor while three others
        // silently changed with it.
        if (app.panes && hit.px != null) {
            const pane = paneAt(app.panes, hit.px, hit.py);
            if (pane) setViewMode(pane.mode);
            return;
        }
        if (!hit.axleId) return;
        app.selection = { axleId: hit.axleId, positionId: hit.positionId };
        const view = app.store.view;
        app.store.view.isolation = drillInto(view.isolation, hit);
        applyIsolation({ frame: true });
        renderTree();
        renderProperties();
    };
}

/* ============================================================
   4. Unit loading
   ============================================================ */

/** @param {string} id */
function loadUnitById(id) {
    const unit = [...app.library.trucks, ...app.library.aircraft].find((u) => u.id === id);
    if (!unit) { toast(`Unit "${id}" is not in the library.`, 'error'); return; }
    app.store.replaceDoc({
        ...app.store.doc,
        unit: structuredClone(unit),
        modifiedFrom: null
    }, 'load unit');
    rebuild({ frame: true });
    syncUnitSelectors();
}

/**
 * Rebuild the layout, the scene and everything derived from them.
 * @param {{frame?: boolean}} [opts]
 */
function rebuild(opts = {}) {
    const unit = app.store.doc.unit;
    if (!unit) return;

    const check = validateUnit(unit);
    if (!check.ok) {
        toast(`This unit has ${check.errors.length} validation problem(s); see the console.`, 'warn');
        console.warn('[Gear3D] unit validation:', check.errors);
    }

    app.layout = resolveLayout(unit);
    app.assembly = buildAssembly(app.layout, app.materials, {
        showAxles: true,
        quality: app.store.view.quality,
        seed: app.store.doc.seed
    });
    app.viewport.setAssembly(app.assembly);

    applyIsolation({ frame: opts.frame });
    recomputePatches();
    renderTree();
    renderProperties();
    renderUnitMeta();
    renderCustomList();
    updateStatus();
    scheduleAutosave();
}

/* ============================================================
   5. Isolation
   ============================================================ */

function applyIsolation(opts = {}) {
    if (!app.assembly) return;
    const iso = app.store.view.isolation;
    app.assembly.setWheelFilter(wheelPredicate(iso), {
        ghost: iso.ghost,
        chassis: showChassis(iso)
    });
    // Snap targets follow visibility — see rebuildSnapPoints. The chassis is
    // deliberately NOT snappable: it is a schematic envelope, so measuring to
    // it would produce a number with no sourced meaning.
    rebuildSnapPoints();
    renderChassisNotice();

    if (opts.frame) {
        const b = isolationBounds(iso, app.layout);
        if (b) app.viewport.frameEngineering(b);
    }
    app.viewport.invalidate();
    updateStatus();
    renderTree();
}

/* ============================================================
   6. Overlay drawing
   ============================================================ */

/**
 * @param {{vp: number[], viewport: {width: number, height: number}}} info
 */
function drawOverlay(info) {
    const svg = /** @type {SVGSVGElement} */ ($('g3-overlay'));
    if (!app.layout) return;

    const v = app.store.view;

    // Cached first, so the pointer handlers can snap against exactly this
    // projection even when nothing is drawn.
    app.lastFrame = { vp: info.vp, viewport: info.viewport };
    app.panes = info.panes || null;

    if (info.panes) { drawQuadOverlay(svg, info); return; }

    // Master switch: one control that clears the view completely.
    if (!v.annotations && !app.measure.active) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        updateAxisBadge();
        return;
    }
    const iso = v.isolation;
    const pred = wheelPredicate(iso);
    const visibleAxles = new Set(app.layout.wheels.filter(pred).map((w) => w.axleId));

    // Only dimension what is actually shown, or the figure claims to measure
    // parts that are not in it.
    const shownLayout = {
        ...app.layout,
        wheels: app.layout.wheels.filter(pred),
        axles: app.layout.axles.filter((a) => visibleAxles.has(a.id))
    };
    if (!shownLayout.wheels.length) return;
    shownLayout.extents = {
        ...app.layout.extents,
        minY: Math.min(...shownLayout.wheels.map((w) => w.y - w.geometry.sectionWidth / 2)),
        maxY: Math.max(...shownLayout.wheels.map((w) => w.y + w.geometry.sectionWidth / 2))
    };

    const dims = [
        ...autoDimensions(shownLayout, { sets: v.dimensionSets }),
        ...(v.dimensionSets.includes('custom') ? (app.store.doc.customDimensions || []) : [])
    ];

    const highlight = new Set(
        app.selection.axleId
            ? dims.filter((d) => (d.note || '').includes(app.selection.axleId)).map((d) => d.id)
            : []
    );

    // Annotation contrast is set by the FIGURE background, not by the app's
    // light/dark theme. Working in dark mode and exporting on publication
    // white must not produce pale annotations that vanish on the page.
    const ink = figureInk();
    const svgEl = /** @type {any} */ (svg);
    svgEl.style.color = ink.color;

    const opts = {
        vp: info.vp,
        viewport: info.viewport,
        unitSystem: v.unitSystem,
        precision: v.precision,
        dualUnits: v.dualUnits,
        fontSize: 12,
        color: ink.color,
        halo: ink.halo,
        accent: ink.accent,
        highlight
    };

    renderDimensions(svg, v.annotations ? dims : [], opts);
    if (v.annotations && v.showPatches) drawPatches(svg, opts);
    if (v.annotations && v.showCallouts) {
        renderCallouts(svg, shownLayout, { ...opts, offsets: app.store.doc.calloutOffsets });
    }
    if (v.annotations && v.showScaleBar) renderScaleBar(svg, opts);
    if (app.measure.active) drawMeasureLayer(svg, opts);

    updateAxisBadge();
}

/**
 * @param {SVGSVGElement} svg
 * @param {any} o
 */
function drawPatches(svg, o) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'g3-patches');
    const pred = wheelPredicate(app.store.view.isolation);
    const visible = new Set(app.layout.wheels.filter(pred).map((w) => w.id));

    for (const rec of app.patches) {
        if (!visible.has(rec.tireId)) continue;
        const pts = patchOutlineAbsolute(rec, 28)
            .map((p) => projectEng(p, o.vp, o.viewport))
            .filter((p) => !p.behind);
        if (pts.length < 3) continue;
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
        poly.setAttribute('fill', cssVar('--g3-signal'));
        poly.setAttribute('fill-opacity', '0.16');
        poly.setAttribute('stroke', cssVar('--g3-signal'));
        poly.setAttribute('stroke-width', '1');
        const t = document.createElementNS(SVG_NS, 'title');
        t.textContent = `${rec.tireId}: ${rec.patch.length.toFixed(0)} × ${rec.patch.width.toFixed(0)} mm, `
            + `${rec.patch.area.toFixed(0)} mm², ${rec.patch.pressure.toFixed(0)} kPa`;
        poly.appendChild(t);
        g.appendChild(poly);
    }
    svg.appendChild(g);
}

/**
 * Annotate a quad frame: one clipped group per pane, each projected with that
 * pane's own camera.
 *
 * Everything is clipped to its pane. Without that, a dimension running off
 * the side of the plan view would draw straight across the 3D pane beside it
 * and the sheet would be unreadable — the single most likely way a
 * multi-viewport overlay goes wrong.
 *
 * @param {SVGSVGElement} svg
 * @param {{panes: any[], paneVp: Record<string, number[]>, viewport: {width:number,height:number}}} info
 */
function drawQuadOverlay(svg, info) {
    const v = app.store.view;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${info.viewport.width} ${info.viewport.height}`);

    const ink = figureInk();
    svg.style.color = ink.color;

    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);

    const pred = wheelPredicate(v.isolation);
    const visibleAxles = new Set(app.layout.wheels.filter(pred).map((w) => w.axleId));
    const shown = {
        ...app.layout,
        wheels: app.layout.wheels.filter(pred),
        axles: app.layout.axles.filter((a) => visibleAxles.has(a.id))
    };
    if (!shown.wheels.length) return;
    shown.extents = {
        ...app.layout.extents,
        minY: Math.min(...shown.wheels.map((w) => w.y - w.geometry.sectionWidth / 2)),
        maxY: Math.max(...shown.wheels.map((w) => w.y + w.geometry.sectionWidth / 2))
    };

    for (const pane of info.panes) {
        // Pane separators, drawn as the app's hairlines.
        const frame = document.createElementNS(SVG_NS, 'rect');
        frame.setAttribute('x', String(pane.x));
        frame.setAttribute('y', String(pane.y));
        frame.setAttribute('width', String(pane.w));
        frame.setAttribute('height', String(pane.h));
        frame.setAttribute('fill', 'none');
        frame.setAttribute('stroke', ink.color);
        frame.setAttribute('stroke-width', '1');
        frame.setAttribute('opacity', '0.22');
        svg.appendChild(frame);

        // Pane label, in the app's uppercase datum idiom.
        const lab = document.createElementNS(SVG_NS, 'text');
        lab.setAttribute('x', String(pane.x + 10));
        lab.setAttribute('y', String(pane.y + 18));
        lab.setAttribute('font-size', '10');
        lab.setAttribute('letter-spacing', '1.6');
        lab.setAttribute('fill', ink.color);
        lab.setAttribute('opacity', '0.62');
        lab.textContent = pane.label.toUpperCase();
        svg.appendChild(lab);

        if (!v.annotations) continue;

        const clipId = `g3-pane-${pane.mode}`;
        const clip = document.createElementNS(SVG_NS, 'clipPath');
        clip.setAttribute('id', clipId);
        const cr = document.createElementNS(SVG_NS, 'rect');
        cr.setAttribute('x', String(pane.x));
        cr.setAttribute('y', String(pane.y));
        cr.setAttribute('width', String(pane.w));
        cr.setAttribute('height', String(pane.h));
        clip.appendChild(cr);
        defs.appendChild(clip);

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('clip-path', `url(#${clipId})`);
        g.setAttribute('transform', `translate(${pane.x} ${pane.y})`);
        svg.appendChild(g);

        const opts = {
            vp: info.paneVp[pane.mode],
            // Pane-local: the group's transform puts it in place, so the
            // projection must work in pane coordinates, not frame ones.
            viewport: { width: pane.w, height: pane.h },
            unitSystem: v.unitSystem,
            precision: v.precision,
            dualUnits: v.dualUnits,
            fontSize: 11,
            color: ink.color,
            halo: ink.halo,
            accent: ink.accent,
            container: g
        };

        const dims = [
            ...autoDimensions(shown, { sets: v.dimensionSets }),
            ...(v.dimensionSets.includes('custom') ? (app.store.doc.customDimensions || []) : [])
        ];
        renderDimensions(svg, dims, opts);
        if (v.showScaleBar) renderScaleBar(g, opts);
    }

    updateAxisBadge();
}

function updateAxisBadge() {
    const v = app.store.view;
    const label = v.mode === 'quad' ? 'Quad' : VIEW_META[v.mode].label;
    $('g3-axisbadge').innerHTML =
        `<b>${label}</b><br>x ${ENG_AXES.x.positive}<br>y ${ENG_AXES.y.positive}<br>z ${ENG_AXES.z.positive}`;
}

/**
 * Say, in the interface, exactly what the chassis silhouette is.
 *
 * It is drawn only when "Full unit" is selected, and it is the one thing on
 * screen that is not derived from cited dimensions. Its outer envelope comes
 * from the unit's own overall length and the federal width and height
 * limits; its internal subdivision is representative. A reader who cannot
 * tell those apart could mistake a schematic for a measurement, so the app
 * states it rather than relying on the documentation.
 */
function renderChassisNotice() {
    const box = $('g3-chassis-notice');
    if (!box) return;
    const iso = app.store.view.isolation;
    const env = app.assembly?.chassis;

    if (iso.level !== 'unit') { box.hidden = true; return; }

    if (!env) {
        box.hidden = false;
        box.innerHTML = '<i class="fas fa-info-circle"></i><span>'
            + (app.layout?.domain === 'aircraft'
                ? 'No fuselage silhouette: nothing in the sourced data constrains an aircraft body, '
                + 'so drawing one would be invention. The gear is shown alone.'
                : 'This unit has no chassis silhouette.')
            + '</span>';
        return;
    }

    box.hidden = false;
    box.innerHTML = '<i class="fas fa-drafting-compass"></i><span>'
        + '<strong>Schematic envelope, not bodywork.</strong> Length is the unit\'s cited '
        + 'overall length; width and height are the 102 in and 13 ft 6 in legal limits. '
        + `Representative: ${esc(env.representative.join(', '))}. `
        + 'Not measurable — the silhouette carries no snap targets.'
        + '</span>';
}

/* ============================================================
   6b. Measurement — click two features to create a dimension
   ============================================================ */

/**
 * Rebuild the snap targets. Only what is currently VISIBLE is snappable: a
 * dimension anchored to a hidden wheel would draw to a point the reader
 * cannot see, and would silently change meaning when isolation changed.
 */
function rebuildSnapPoints() {
    if (!app.layout) { app.snapPoints = []; return; }
    app.snapPoints = buildSnapPoints(app.layout, {
        visible: wheelPredicate(app.store.view.isolation)
    });
}

/** @param {boolean} [on] */
function setMeasureMode(on) {
    const next = on ?? !app.measure.active;
    app.measure = { active: next, first: null, hover: null, cursor: null };
    $('g3-measure').classList.toggle('is-active', next);
    $('g3-measure-hint').hidden = !next;
    $('g3-viewport').classList.toggle('is-measuring', next);
    // Orbiting while measuring makes the second click land somewhere the user
    // did not intend, so the controls are parked for the duration.
    app.viewport.cameras.controls.enabled = !next;
    updateStatus();
    app.viewport.invalidate();
}

/** @param {any} hit pointer hit, carrying px/py in CSS pixels */
function updateMeasureHover(hit) {
    if (!app.lastFrame || hit.px == null) return;
    const { vp, viewport } = app.lastFrame;
    app.measure.cursor = { x: hit.px, y: hit.py };
    app.measure.hover = nearestSnapPoint(
        app.snapPoints,
        (p) => projectEng(p, vp, viewport),
        hit.px, hit.py, 28
    );
    $('g3-status-coords').textContent = app.measure.hover
        ? app.measure.hover.snap.label
        : 'no snap target within reach';
    app.viewport.invalidate();
}

/** Commit the hovered snap target as the next endpoint. */
function placeMeasurePoint() {
    const hover = app.measure.hover;
    if (!hover) { toast('Move onto a snap target — tire centre, edge, contact patch or axle centreline.', 'warn'); return; }

    if (!app.measure.first) {
        app.measure.first = hover.snap;
        app.viewport.invalidate();
        updateStatus();
        return;
    }
    if (app.measure.first.id === hover.snap.id) {
        toast('Pick a different second point.', 'warn');
        return;
    }

    const dim = dimensionFromSnaps(app.measure.first, hover.snap, {
        id: `custom:${Date.now().toString(36)}`
    });
    app.store.update((d) => {
        if (!Array.isArray(d.customDimensions)) d.customDimensions = [];
        d.customDimensions.push(dim);
    }, 'add dimension');

    app.measure.first = null;
    renderCustomList();
    scheduleAutosave();
    app.viewport.invalidate();
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    toast(`Added ${formatLength(dimensionValue(dim), sys.length, { precision: app.store.view.precision })}.`);
}

/** Draw snap targets, the pending endpoint and the rubber band. */
function drawMeasureLayer(svg, o) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'g3-measure');
    const ink = figureInk();

    // All available targets, small and faint, so they read as a field of
    // options rather than as annotation.
    for (const p of app.snapPoints) {
        const s = projectEng(p.point, o.vp, o.viewport);
        if (s.behind) continue;
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', s.x.toFixed(1));
        dot.setAttribute('cy', s.y.toFixed(1));
        dot.setAttribute('r', '1.7');
        dot.setAttribute('fill', ink.color);
        dot.setAttribute('opacity', '0.32');
        g.appendChild(dot);
    }

    const mark = (pt, filled, label) => {
        const s = projectEng(pt, o.vp, o.viewport);
        if (s.behind) return null;
        const ring = document.createElementNS(SVG_NS, 'circle');
        ring.setAttribute('cx', s.x.toFixed(1));
        ring.setAttribute('cy', s.y.toFixed(1));
        ring.setAttribute('r', '6');
        ring.setAttribute('fill', filled ? ink.accent : 'none');
        ring.setAttribute('stroke', ink.accent);
        ring.setAttribute('stroke-width', '1.8');
        g.appendChild(ring);
        if (label) {
            const halo = document.createElementNS(SVG_NS, 'text');
            halo.setAttribute('x', (s.x + 10).toFixed(1));
            halo.setAttribute('y', (s.y - 9).toFixed(1));
            halo.setAttribute('font-size', '11');
            halo.setAttribute('stroke', ink.halo);
            halo.setAttribute('stroke-width', '3.5');
            halo.setAttribute('stroke-linejoin', 'round');
            halo.setAttribute('fill', 'none');
            halo.textContent = label;
            const txt = halo.cloneNode(true);
            txt.removeAttribute('stroke');
            txt.setAttribute('fill', ink.color);
            g.appendChild(halo);
            g.appendChild(txt);
        }
        return s;
    };

    if (app.measure.first) mark(app.measure.first.point, true, null);
    const hover = app.measure.hover;
    if (hover) mark(hover.snap.point, false, hover.snap.label);

    // Rubber band from the placed endpoint to wherever the cursor is.
    if (app.measure.first) {
        const a = projectEng(app.measure.first.point, o.vp, o.viewport);
        const b = hover
            ? projectEng(hover.snap.point, o.vp, o.viewport)
            : app.measure.cursor;
        if (a && b && !a.behind) {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', a.x.toFixed(1));
            line.setAttribute('y1', a.y.toFixed(1));
            line.setAttribute('x2', b.x.toFixed(1));
            line.setAttribute('y2', b.y.toFixed(1));
            line.setAttribute('stroke', ink.accent);
            line.setAttribute('stroke-width', '1.2');
            line.setAttribute('stroke-dasharray', '5 4');
            g.appendChild(line);
        }
    }

    svg.appendChild(g);
}

/** The list of user-created dimensions, with delete. */
function renderCustomList() {
    const box = $('g3-custom-list');
    if (!box) return;
    const dims = app.store.doc.customDimensions || [];
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    box.innerHTML = '';

    for (const d of dims) {
        const row = document.createElement('div');
        row.className = 'g3-dimrow';
        row.innerHTML =
            `<span class="g3-dimrow-value">${esc(formatLength(dimensionValue(d), sys.length, { precision: app.store.view.precision }))}</span>`
            + `<span class="g3-dimrow-note" title="${esc(d.note || '')}">${esc(d.note || '')}</span>`;
        const del = document.createElement('button');
        del.className = 'g3-dimrow-del';
        del.innerHTML = '<i class="fas fa-times"></i>';
        del.title = 'Delete this dimension';
        del.setAttribute('aria-label', `Delete dimension ${d.note || d.id}`);
        del.addEventListener('click', () => {
            app.store.update((doc) => {
                doc.customDimensions = (doc.customDimensions || []).filter((x) => x.id !== d.id);
            }, 'delete dimension');
            renderCustomList();
            scheduleAutosave();
            app.viewport.invalidate();
        });
        row.appendChild(del);
        box.appendChild(row);
    }
}

/* ============================================================
   6c. Draggable callouts
   ============================================================ */

/**
 * Let axle callouts be dragged, and remember where they were put.
 *
 * The annotation engine auto-places callouts and staggers them apart, which
 * is right most of the time and wrong exactly when a figure matters most —
 * a label sitting over the feature it describes, or over another label, in
 * the one view being exported. `calloutOffsets` has always been saved into
 * the project file; until now nothing could write it.
 *
 * The SVG overlay is `pointer-events: none` so the canvas underneath keeps
 * orbit and click-to-select. Only callouts opt back in, and the handlers are
 * DELEGATED to the overlay because the annotation layer is rebuilt from
 * scratch on every frame — per-element listeners would be reattached dozens
 * of times a second and leak.
 */
function setupCallouts() {
    const svg = $('g3-overlay');
    /** @type {{id: string, x0: number, y0: number, dx0: number, dy0: number, before: object}|null} */
    let drag = null;

    const localPoint = (e) => {
        const r = $('g3-canvas').getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    svg.addEventListener('pointerdown', (e) => {
        const g = /** @type {Element} */ (e.target).closest?.('.g3-callout');
        if (!g) return;
        const id = g.getAttribute('data-axle-id');
        if (!id) return;

        e.preventDefault();
        e.stopPropagation();

        const p = localPoint(e);
        const cur = app.store.doc.calloutOffsets?.[id] || {};
        drag = {
            id,
            x0: p.x, y0: p.y,
            dx0: cur.dx ?? 46,
            dy0: cur.dy ?? -34,
            // Snapshot for a single clean undo step covering the whole drag.
            before: structuredClone(app.store.doc.calloutOffsets || {})
        };
        svg.setPointerCapture?.(e.pointerId);
        svg.classList.add('is-dragging');
    });

    svg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = localPoint(e);
        // Mutated directly, WITHOUT an undo entry: pushing one per pointermove
        // would bury the history under hundreds of one-pixel steps.
        if (!app.store.doc.calloutOffsets) app.store.doc.calloutOffsets = {};
        app.store.doc.calloutOffsets[drag.id] = {
            dx: drag.dx0 + (p.x - drag.x0),
            dy: drag.dy0 + (p.y - drag.y0)
        };
        app.viewport.invalidate();
    });

    const endDrag = (e) => {
        if (!drag) return;
        const final = app.store.doc.calloutOffsets[drag.id];
        const { id, before } = drag;
        drag = null;
        svg.classList.remove('is-dragging');
        svg.releasePointerCapture?.(e.pointerId);

        // Rewind to the pre-drag state so the undo snapshot is taken from
        // there, then apply the final position as one atomic change.
        app.store.doc.calloutOffsets = before;
        app.store.update((d) => {
            if (!d.calloutOffsets) d.calloutOffsets = {};
            d.calloutOffsets[id] = final;
        }, 'move callout');
        scheduleAutosave();
        app.viewport.invalidate();
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    // Double-click returns a callout to its automatic position.
    svg.addEventListener('dblclick', (e) => {
        const g = /** @type {Element} */ (e.target).closest?.('.g3-callout');
        const id = g?.getAttribute('data-axle-id');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        app.store.update((d) => { delete d.calloutOffsets?.[id]; }, 'reset callout');
        scheduleAutosave();
        app.viewport.invalidate();
        toast(`${id} callout returned to its automatic position.`);
    });
}

function setupMeasure() {
    $('g3-measure').addEventListener('click', () => setMeasureMode());
    $('g3-clear-custom').addEventListener('click', () => {
        if (!(app.store.doc.customDimensions || []).length) return;
        app.store.update((d) => { d.customDimensions = []; }, 'clear dimensions');
        renderCustomList();
        scheduleAutosave();
        app.viewport.invalidate();
        toast('Custom dimensions cleared. Ctrl+Z restores them.');
    });
}

/* ============================================================
   7. Panels
   ============================================================ */

function setupToolbar() {
    for (const b of document.querySelectorAll('.g3-vtab')) {
        b.addEventListener('click', () => setViewMode(b.getAttribute('data-view')));
    }
    for (const b of document.querySelectorAll('.g3-uswitch')) {
        b.addEventListener('click', () => {
            app.store.view.unitSystem = b.getAttribute('data-units');
            for (const x of document.querySelectorAll('.g3-uswitch')) x.classList.toggle('is-active', x === b);
            syncInflationField();
            renderProperties();
            renderUnitMeta();
            renderPatchSummary();
            renderOverrideStatus();
            syncOverrideUnits();
            renderCustomList();
            app.viewport.invalidate();
        });
    }

    // Master annotation switch and grid, both in the toolbar rather than
    // buried in a panel: they are the two controls a user reaches for most
    // when a figure is too busy to read.
    const syncToggle = (el, on) => {
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', String(on));
    };
    $('g3-annot').addEventListener('click', () => {
        app.store.view.annotations = !app.store.view.annotations;
        syncToggle($('g3-annot'), app.store.view.annotations);
        app.viewport.invalidate();
    });
    $('g3-grid').addEventListener('click', () => {
        app.store.view.showGrid = !app.store.view.showGrid;
        syncToggle($('g3-grid'), app.store.view.showGrid);
        app.viewport.setGrid(app.store.view.showGrid);
    });

    $('g3-fit').addEventListener('click', () => {
        const b = isolationBounds(app.store.view.isolation, app.layout);
        if (b) app.viewport.frameEngineering(b);
    });
    $('g3-undo').addEventListener('click', () => { if (app.store.undo()) rebuild(); });
    $('g3-redo').addEventListener('click', () => { if (app.store.redo()) rebuild(); });
    $('g3-reset').addEventListener('click', revertToReference);

    $('g3-save').addEventListener('click', saveProject);
    $('g3-open').addEventListener('click', () => $('g3-file-input').click());
    $('g3-file-input').addEventListener('change', async (e) => {
        const f = /** @type {HTMLInputElement} */(e.target).files?.[0];
        if (!f) return;
        try {
            applyProject(parseProject(await readFileText(f)));
            toast(`Opened ${f.name}`);
        } catch (err) {
            toast(err.message, 'error');
        }
        /** @type {HTMLInputElement} */(e.target).value = '';
    });

    $('g3-export').addEventListener('click', runExport);
}

/** @param {string} mode one of the four view modes, or 'quad' */
function setViewMode(mode) {
    app.store.view.mode = mode;

    // 'quad' is a LAYOUT, not a camera mode: the rig keeps whatever single
    // mode was last active so returning from quad lands where you left.
    const quad = mode === 'quad';
    app.viewport.setQuad(quad);
    if (!quad) app.viewport.cameras.setMode(mode);

    for (const b of document.querySelectorAll('.g3-vtab')) {
        const on = b.getAttribute('data-view') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
    }
    $('g3-hud-right').textContent = quad
        ? 'four views · click a pane to open it full size'
        : VIEW_META[mode].locked
            ? 'locked view · zoom: wheel · pan: drag · click an axle to isolate'
            : 'orbit: drag · zoom: wheel · pan: right-drag · click an axle to isolate';

    const b = isolationBounds(app.store.view.isolation, app.layout);
    if (b) app.viewport.frameEngineering(b);
    updateStatus();
}

function setupUnitPanel() {
    // Changing Domain or Class must LOAD something, not merely repopulate the
    // Model list. Without autoLoad the Model dropdown shows one vehicle while
    // the viewport still holds the previous one, and the app looks frozen.
    $('g3-domain').addEventListener('change', () => {
        syncCategories();
        syncUnits({ autoLoad: true });
    });
    $('g3-category').addEventListener('change', () => syncUnits({ autoLoad: true }));
    $('g3-unit').addEventListener('change', () => loadUnitById($('g3-unit').value));
    $('g3-revert-inline').addEventListener('click', revertToReference);
    syncCategories();
    syncUnits();

    $('g3-wbt').addEventListener('change', (e) => {
        const designation = /** @type {HTMLSelectElement} */(e.target).value;
        if (!designation) return;
        applyWideBaseSwap(designation);
        /** @type {HTMLSelectElement} */(e.target).value = '';
    });
}

function syncCategories() {
    const domain = $('g3-domain').value;
    const sel = $('g3-category');
    sel.innerHTML = '';
    if (domain === 'truck') {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = 'All classes';
        sel.appendChild(opt);
        for (const c of app.library.index.classes) {
            const o = document.createElement('option');
            o.value = String(c.class);
            o.textContent = `Class ${c.class} — ${c.label}`;
            sel.appendChild(o);
        }
    } else {
        const codes = [...new Set(app.library.aircraft.map((u) => u.gearDesignation))];
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = codes.length ? 'All gear codes' : 'Aircraft library ships in v1.1';
        sel.appendChild(opt);
        for (const c of codes) {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            sel.appendChild(o);
        }
    }
}

/**
 * Repopulate the Model dropdown for the current Domain and Class.
 *
 * @param {{autoLoad?: boolean}} [opts] when true, load the first matching
 *        unit if the currently loaded one is filtered out. Callers that run
 *        AFTER a load (syncUnitSelectors) must leave this false or they will
 *        re-enter loadUnitById.
 */
function syncUnits(opts = {}) {
    const domain = $('g3-domain').value;
    const cat = $('g3-category').value;
    const pool = domain === 'truck' ? app.library.trucks : app.library.aircraft;
    const filtered = pool.filter((u) => !cat
        || (domain === 'truck' ? String(u.classification.class) === cat : u.gearDesignation === cat));

    const sel = $('g3-unit');
    sel.innerHTML = '';
    if (!filtered.length) {
        const o = document.createElement('option');
        o.textContent = domain === 'aircraft'
            ? 'No aircraft units yet — see README'
            : 'No units match this filter';
        o.disabled = true;
        sel.appendChild(o);
        return;
    }
    for (const u of filtered) {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = domain === 'truck'
            ? `${u.designation} — ${u.bodyType}`
            : `${u.manufacturer} ${u.model} (${u.gearDesignation})`;
        sel.appendChild(o);
    }
    // Keep the loaded unit selected when it survives the new filter. When it
    // does not, the dropdown would otherwise fall to its first option while
    // the viewport kept showing something else entirely — so load it.
    const current = app.store?.doc?.unit?.id;
    if (current && filtered.some((u) => u.id === current)) {
        sel.value = current;
    } else if (opts.autoLoad && filtered.length) {
        sel.value = filtered[0].id;
        loadUnitById(filtered[0].id);
    }
}

function syncUnitSelectors() {
    const u = app.store.doc.unit;
    if (!u) return;
    $('g3-domain').value = u.domain;
    syncCategories();
    $('g3-category').value = u.domain === 'truck' ? String(u.classification.class) : (u.gearDesignation || '');
    syncUnits();
    $('g3-unit').value = u.id;
}

function renderUnitMeta() {
    const u = app.store.doc.unit;
    if (!u) return;
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const rows = [];

    if (u.domain === 'truck') {
        rows.push(['Class', `${u.classification.class} — ${u.classification.label}`]);
        rows.push(['Designation', u.designation]);
        rows.push(['Axles', String(u.axles.length)]);
        rows.push(['Tires', String(tireCount(u))]);
        if (u.gvw) rows.push(['GVW', formatMass(canonical(u.gvw, 'mass'), sys.mass, { precision: 0 })]);
        rows.push(['Overall length', formatLength(u.overallLength, sys.length, { precision: 0 })]);

        const bridge = checkBridgeFormula(u);
        const mode = u.federalBridgeFormula
            ?? (u.classification.class >= 5 ? 'compliant' : 'n/a');
        const verdict = mode === 'permit' ? 'permit / grandfathered'
            : mode === 'exempt' ? 'exempt'
                : mode === 'n/a' ? '—'
                    : bridge.ok ? 'compliant' : `${bridge.violations.length} violation(s)`;
        rows.push(['Bridge formula', verdict]);
    } else {
        // Data files state quantities in whatever unit the SOURCE uses — MTOW
        // in pounds, tire pressure in psi — so the citation stays faithful to
        // the document. Everything must therefore go through canonical()
        // before it is formatted, or a value stated in pounds gets a kilogram
        // label pinned to it.
        rows.push(['Gear code', u.gearDesignation]);
        if (u.mtow) rows.push(['MTOW', formatMass(canonical(u.mtow, 'mass'), sys.mass, { precision: 0 })]);
        if (u.maxTaxiWeight) {
            rows.push(['Max taxi', formatMass(canonical(u.maxTaxiWeight, 'mass'), sys.mass, { precision: 0 })]);
        }
        if (u.tirePressure) {
            rows.push(['Tire pressure', formatPressure(canonical(u.tirePressure, 'pressure'), sys.pressure, { precision: 0 })]);
        }
        if (u.percentOnMainGear != null) rows.push(['On main gear', `${u.percentOnMainGear} %`]);
        rows.push(['Tires', String(tireCount(u))]);
        if (app.layout?.derived?.mainGearTrack) {
            rows.push(['Main gear track', formatLength(app.layout.derived.mainGearTrack, sys.length, { precision: 0 })]);
        }
        if (u.mainGearOuterWidth) {
            rows.push(['Outer width', formatLength(u.mainGearOuterWidth, sys.length, { precision: 0 })]);
        }
        rows.push(['Wheelbase', formatLength(u.wheelbase, sys.length, { precision: 0 })]);
    }

    $('g3-unit-meta').innerHTML = '<dl>'
        + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
        + '</dl>';

    const badge = $('g3-modified-badge');
    if (app.store.doc.modifiedFrom) {
        badge.hidden = false;
        badge.querySelector('span').textContent = `Modified from ${app.store.doc.modifiedFrom}`;
    } else {
        badge.hidden = true;
    }

    renderAssumptionNotice(u);

    renderTitleBlock(u);
}

/**
 * The title block's subject — the drawing title of the sheet.
 *
 * The classification is the small label above; the designation and body type
 * are the title itself. A flag appears when the loaded unit is not simply its
 * cited reference: edited away from it, or carrying assumed values. That is
 * what a revision box on a drawing is for, and it is the first thing a reader
 * should check before trusting a figure.
 *
 * @param {object} u
 */
function renderTitleBlock(u) {
    const cls = $('g3-tb-class');
    const loaded = $('g3-tb-loaded');
    const flag = $('g3-tb-flag');
    const tires = $('g3-tb-tires');
    if (!loaded) return;

    if (u.domain === 'truck') {
        cls.textContent = `FHWA Class ${u.classification.class}`;
        loaded.textContent = `${u.designation} — ${u.bodyType}`;
    } else {
        cls.textContent = `${u.manufacturer} · Gear ${u.gearDesignation}`;
        loaded.textContent = `${u.model}`;
    }
    loaded.title = loaded.textContent;
    if (tires) tires.textContent = String(tireCount(u));

    if (app.store.doc.modifiedFrom) {
        flag.hidden = false;
        flag.textContent = 'Modified';
        flag.title = `Modified from ${app.store.doc.modifiedFrom}`;
    } else if ((u.assumedFields || []).length) {
        flag.hidden = false;
        flag.textContent = `${u.assumedFields.length} assumed`;
        flag.title = `Assumed values: ${u.assumedFields.join(', ')}`;
    } else {
        flag.hidden = true;
    }
}

/**
 * Surface, unmissably, any value in the loaded unit that was assumed rather
 * than read from a source.
 *
 * The app's claim is that its dimensions are real. Where one is not, saying
 * so in the interface — not only in a documentation file nobody opens — is
 * what keeps that claim true. The aircraft units carry authoritative gear
 * envelopes but a small number of unconstrained internal spacings, and a user
 * comparing output against FAARFIELD needs to know which is which before they
 * conclude the app is wrong.
 *
 * @param {object} u
 */
function renderAssumptionNotice(u) {
    const box = $('g3-assumption-notice');
    if (!box) return;
    const fields = u.assumedFields || [];
    if (!fields.length) { box.hidden = true; return; }

    box.hidden = false;
    box.innerHTML =
        '<i class="fas fa-exclamation-triangle"></i>'
        + `<span><strong>${fields.length} assumed value${fields.length > 1 ? 's' : ''}:</strong> `
        + `${fields.map(esc).join(', ')}. Everything else on this aircraft — gear code, `
        + 'wheelbase, main gear outer width, MTOW, tire size and pressure — is taken from the '
        + 'FAA Aircraft Characteristics Database and the manufacturer ACAP. Set the assumed '
        + 'spacings from FAARFIELD before using this figure for pavement work; the track '
        + 're-derives so the published outer width is preserved.</span>';
}

function setupIsolationPanel() {
    const sel = $('g3-isolation');
    for (const lvl of ISOLATION_LEVELS) {
        const o = document.createElement('option');
        o.value = lvl;
        o.textContent = ISOLATION_META[lvl].label;
        sel.appendChild(o);
    }
    sel.value = app.store.view.isolation.level;
    sel.addEventListener('change', () => {
        app.store.view.isolation = { ...app.store.view.isolation, level: sel.value, targetId: null };
        applyIsolation({ frame: true });
    });
    $('g3-ghost').addEventListener('change', (e) => {
        app.store.view.isolation.ghost = /** @type {HTMLInputElement} */(e.target).checked;
        applyIsolation();
    });
}

function setupDimensionPanel() {
    for (const cb of document.querySelectorAll('.g3-dimset')) {
        cb.addEventListener('change', () => {
            app.store.view.dimensionSets = Array.from(document.querySelectorAll('.g3-dimset'))
                .filter((x) => /** @type {HTMLInputElement} */(x).checked)
                .map((x) => x.getAttribute('data-set'));
            app.viewport.invalidate();
        });
    }
    $('g3-precision').addEventListener('change', (e) => {
        app.store.view.precision = Number(/** @type {HTMLSelectElement} */(e.target).value);
        app.viewport.invalidate();
    });
    for (const [id, key] of [['g3-dual-units', 'dualUnits'], ['g3-callouts', 'showCallouts'], ['g3-scalebar', 'showScaleBar']]) {
        $(id).addEventListener('change', (e) => {
            app.store.view[key] = /** @type {HTMLInputElement} */(e.target).checked;
            app.viewport.invalidate();
        });
    }
}

function setupContactPanel() {
    $('g3-show-patches').addEventListener('change', (e) => {
        app.store.view.showPatches = /** @type {HTMLInputElement} */(e.target).checked;
        app.viewport.invalidate();
    });
    $('g3-patch-model').addEventListener('change', (e) => {
        app.store.view.patchModel = /** @type {HTMLSelectElement} */(e.target).value;
        recomputePatches();
    });
    $('g3-inflation').addEventListener('change', (e) => {
        const raw = Number(/** @type {HTMLInputElement} */(e.target).value);
        const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
        app.store.view.inflationKpa = sys.pressure === 'psi' ? raw * 6.894757293168361 : raw;
        recomputePatches();
    });
    $('g3-exp-csv').addEventListener('click', () => exportFootprint('csv'));
    $('g3-exp-fem').addEventListener('click', () => exportFootprint('abaqus'));

    $('g3-ov-apply').addEventListener('click', applyPatchOverride);
    $('g3-ov-clear').addEventListener('click', () => {
        const n = Object.keys(app.store.view.contactOverrides || {}).length;
        if (!n) return;
        app.store.view.contactOverrides = {};
        recomputePatches();
        scheduleAutosave();
        toast(`Cleared ${n} measured patch${n > 1 ? 'es' : ''}; back to the ${app.store.view.patchModel} model.`);
    });

    syncInflationField();
}

/**
 * Which tires the override scope selects.
 * @returns {{ids: string[], label: string}}
 */
function overrideTargets() {
    const scope = $('g3-ov-scope').value;
    const all = app.patches.map((p) => p.tireId);
    if (scope === 'axle') {
        const id = app.selection.axleId;
        return {
            ids: app.patches.filter((p) => p.axleId === id).map((p) => p.tireId),
            label: id ? `axle ${id}` : ''
        };
    }
    if (scope === 'position') {
        const id = app.selection.positionId;
        return {
            ids: app.patches.filter((p) => p.positionId === id).map((p) => p.tireId),
            label: id ? `position ${id}` : ''
        };
    }
    return { ids: all, label: 'all tires' };
}

/**
 * Replace modelled patch dimensions with measured ones.
 *
 * This is the escape hatch from the app's own idealisation. Every patch it
 * computes assumes contact pressure equals inflation pressure and is uniform
 * — stated plainly in the export header and true enough for far-field
 * response. A researcher holding real footprint dimensions, from an
 * impression or a stress-in-motion rig, should be able to use them instead of
 * a model, and the exports must then say which numbers are which.
 *
 * Load is held, not the pressure: the wheel still carries what it carries, so
 * a measured area implies a contact pressure and `overridePatch` back-computes
 * it. That is the physically meaningful direction.
 */
function applyPatchOverride() {
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const L = Number($('g3-ov-len').value);
    const W = Number($('g3-ov-wid').value);
    if (!(L > 0 && W > 0)) {
        toast('Enter a positive length and width to apply.', 'warn');
        return;
    }

    const { ids, label } = overrideTargets();
    if (!ids.length) {
        toast('Nothing selected for that scope — pick an axle or wheel position in the structure tree.', 'warn');
        return;
    }

    const lengthMm = lengthToMm(L, sys.length);
    const widthMm = lengthToMm(W, sys.length);

    if (!app.store.view.contactOverrides) app.store.view.contactOverrides = {};
    for (const id of ids) {
        app.store.view.contactOverrides[id] = { length: lengthMm, width: widthMm };
    }
    recomputePatches();
    scheduleAutosave();
    toast(`Measured footprint applied to ${ids.length} tire${ids.length > 1 ? 's' : ''} (${label}).`);
}

/** Report how many patches are measured rather than modelled. */
function renderOverrideStatus() {
    const box = $('g3-ov-status');
    if (!box) return;
    const n = app.patches.filter((p) => p.patch.overridden).length;
    if (!n) { box.hidden = true; return; }

    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const ov = app.patches.filter((p) => p.patch.overridden);
    const lo = Math.min(...ov.map((p) => p.patch.pressure));
    const hi = Math.max(...ov.map((p) => p.patch.pressure));
    box.hidden = false;
    box.innerHTML = '<i class="fas fa-ruler-combined"></i><span>'
        + `<strong>${n} of ${app.patches.length} patches are measured</strong>, not modelled. `
        + 'Their contact pressure is implied by load over the measured area — '
        + (Math.abs(hi - lo) < 0.5
            ? `${formatPressure(lo, sys.pressure, { precision: 0 })}`
            : `${formatPressure(lo, sys.pressure, { precision: 0 })} to ${formatPressure(hi, sys.pressure, { precision: 0 })}`)
        + `, against an inflation pressure of ${formatPressure(app.store.view.inflationKpa, sys.pressure, { precision: 0 })}. `
        + 'Exports flag them individually.</span>';
}

/** Keep the override unit labels in step with the display unit system. */
function syncOverrideUnits() {
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    for (const id of ['g3-ov-unit-l', 'g3-ov-unit-w']) {
        const el = $(id);
        if (el) el.textContent = sys.length;
    }
}

function syncInflationField() {
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const el = /** @type {HTMLInputElement} */ ($('g3-inflation'));
    const kPa = app.store.view.inflationKpa;
    if (sys.pressure === 'psi') {
        el.value = (kPa / 6.894757293168361).toFixed(0);
        el.min = '30'; el.max = '360'; el.step = '1';
        el.nextElementSibling.textContent = 'psi';
    } else {
        el.value = kPa.toFixed(0);
        el.min = '200'; el.max = '2500'; el.step = '5';
        el.nextElementSibling.textContent = 'kPa';
    }
}

function recomputePatches() {
    if (!app.layout) return;
    app.patches = computePatches(app.layout, app.store.doc.unit, {
        model: app.store.view.patchModel,
        inflationKpa: app.store.view.inflationKpa,
        overrides: app.store.view.contactOverrides
    });
    renderPatchSummary();
    renderOverrideStatus();
    app.viewport.invalidate();
}

function renderPatchSummary() {
    const t = patchTotals(app.patches);
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    $('g3-patch-summary').innerHTML =
        `<div><strong>${t.tires}</strong> tires · <strong>${formatForce(t.totalLoadKn, sys.force, { precision: 1 })}</strong> total</div>`
        + `<div>Total area <strong>${formatArea(t.totalAreaMm2, sys.area, { precision: 0 })}</strong></div>`
        + `<div>Mean contact pressure <strong>${formatPressure(t.meanPressureKpa, sys.pressure, { precision: 0 })}</strong></div>`;
}

function setupCameraPanel() {
    $('g3-proj').addEventListener('change', (e) => {
        app.viewport.cameras.setProjection(/** @type {HTMLSelectElement} */(e.target).value);
        app.viewport.invalidate();
    });
    linkRange('g3-cam-az', 'g3-cam-az-n', (v) => {
        const o = app.viewport.cameras.getOrbit();
        app.viewport.cameras.setOrbit(v, o.elevation);
        app.viewport.invalidate();
    });
    linkRange('g3-cam-el', 'g3-cam-el-n', (v) => {
        const o = app.viewport.cameras.getOrbit();
        app.viewport.cameras.setOrbit(o.azimuth, v);
        app.viewport.invalidate();
    });

    const row = $('g3-presets');
    for (const [key, p] of Object.entries(CAMERA_PRESETS)) {
        const b = document.createElement('button');
        b.className = 'g3-btn';
        b.textContent = p.label;
        b.title = `Azimuth ${p.azimuth}°, elevation ${p.elevation}°`;
        b.addEventListener('click', () => {
            setViewMode('3d');
            app.viewport.cameras.setPreset(key);
            syncCameraFields();
            app.viewport.invalidate();
        });
        row.appendChild(b);
    }
}

function syncCameraFields() {
    const o = app.viewport.cameras.getOrbit();
    setPair('g3-cam-az', 'g3-cam-az-n', o.azimuth.toFixed(0));
    setPair('g3-cam-el', 'g3-cam-el-n', o.elevation.toFixed(1));
}

function setupLightingPanel() {
    $('g3-light-preset').addEventListener('change', (e) => {
        const p = LIGHTING_PRESETS[/** @type {HTMLSelectElement} */(e.target).value];
        app.store.view.lighting = { ...p };
        app.viewport.setLighting(app.store.view.lighting);
        syncLightingFields();
    });
    const map = [
        ['g3-light-key', 'g3-light-key-n', 'keyIntensity'],
        ['g3-light-amb', 'g3-light-amb-n', 'ambient'],
        ['g3-light-az', 'g3-light-az-n', 'azimuth'],
        ['g3-light-el', 'g3-light-el-n', 'elevation'],
        ['g3-shadow-op', 'g3-shadow-op-n', 'shadowOpacity'],
        ['g3-shadow-soft', 'g3-shadow-soft-n', 'shadowSoftness']
    ];
    for (const [r, n, key] of map) {
        linkRange(r, n, (v) => {
            app.store.view.lighting[key] = v;
            app.viewport.setLighting(app.store.view.lighting);
        });
    }
    syncLightingFields();
}

function syncLightingFields() {
    const l = app.store.view.lighting;
    setPair('g3-light-key', 'g3-light-key-n', l.keyIntensity);
    setPair('g3-light-amb', 'g3-light-amb-n', l.ambient);
    setPair('g3-light-az', 'g3-light-az-n', l.azimuth);
    setPair('g3-light-el', 'g3-light-el-n', l.elevation);
    setPair('g3-shadow-op', 'g3-shadow-op-n', l.shadowOpacity);
    setPair('g3-shadow-soft', 'g3-shadow-soft-n', l.shadowSoftness);
    $('g3-light-preset').value = l.preset;
}

/**
 * Material controls.
 *
 * `MaterialLibrary` has carried a full override system — tint, brightness,
 * roughness, relief — since v1.0 with nothing wired to it. These are the
 * same five controls Cross-Section Studio exposes, so a figure pair from the
 * two apps can be matched by eye.
 *
 * Overrides are strictly APPEARANCE. Nothing here can move a dimension,
 * resize a contact patch or alter an export, which is why they live in the
 * view state rather than in the undoable document.
 */
function setupMaterialPanel() {
    const sel = $('g3-mat-target');
    // Only the surfaces a user would actually reach for. The internal
    // per-tire rubber variants are driven by these same families.
    const targets = ['rubberTread', 'rubberSidewall', 'aluminium', 'rimBarrel', 'hub', 'axleBeam', 'drum', 'strut'];
    for (const key of targets) {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = MATERIAL_SPECS[key]?.name ?? key;
        sel.appendChild(o);
    }
    sel.value = 'rubberTread';

    const controls = () => ({
        tint: $('g3-mat-tint'), bright: $('g3-mat-bright'), brightN: $('g3-mat-bright-n'),
        rough: $('g3-mat-rough'), roughN: $('g3-mat-rough-n'),
        relief: $('g3-mat-relief'), reliefN: $('g3-mat-relief-n')
    });

    /** Push the stored override (or the spec default) into the controls. */
    function syncFields() {
        const key = sel.value;
        const spec = MATERIAL_SPECS[key] || {};
        const o = app.store.view.materials?.[key] || {};
        const c = controls();
        c.tint.value = o.tint || '#ffffff';
        const set = (r, n, v) => { r.value = String(v); n.value = String(v); };
        set(c.bright, c.brightN, o.brightness ?? 1);
        set(c.rough, c.roughN, o.roughness ?? spec.roughness ?? 0.5);
        set(c.relief, c.reliefN, o.relief ?? spec.normalScale ?? 1);
        $('g3-mat-desc').innerHTML = `<p style="margin:0">${esc(spec.description || '')}</p>`;
    }

    /** @param {string} field @param {*} value */
    function apply(field, value) {
        const key = sel.value;
        if (!app.store.view.materials) app.store.view.materials = {};
        if (!app.store.view.materials[key]) app.store.view.materials[key] = {};
        app.store.view.materials[key][field] = value;
        app.materials.setOverride(key, { [field]: value });
        app.viewport.invalidate();
        scheduleAutosave();
    }

    sel.addEventListener('change', syncFields);
    $('g3-mat-tint').addEventListener('input', (e) => apply('tint', /** @type {HTMLInputElement} */(e.target).value));
    $('g3-mat-tint-clear').addEventListener('click', () => {
        $('g3-mat-tint').value = '#ffffff';
        apply('tint', '#ffffff');
    });
    linkRange('g3-mat-bright', 'g3-mat-bright-n', (v) => apply('brightness', v));
    linkRange('g3-mat-rough', 'g3-mat-rough-n', (v) => apply('roughness', v));
    linkRange('g3-mat-relief', 'g3-mat-relief-n', (v) => apply('relief', v));

    $('g3-mat-reset').addEventListener('click', () => {
        const key = sel.value;
        delete app.store.view.materials?.[key];
        app.materials.resetOverride(key);
        syncFields();
        app.viewport.invalidate();
        scheduleAutosave();
    });
    $('g3-mat-reset-all').addEventListener('click', () => {
        for (const key of Object.keys(app.store.view.materials || {})) app.materials.resetOverride(key);
        app.store.view.materials = {};
        syncFields();
        app.viewport.invalidate();
        scheduleAutosave();
        toast('All surfaces returned to their designed appearance.');
    });

    /** Re-apply stored overrides onto a freshly built material library. */
    app.reapplyMaterials = () => {
        for (const [key, o] of Object.entries(app.store.view.materials || {})) {
            app.materials.setOverride(key, o);
        }
    };

    syncFields();
}

function setupBackgroundPanel() {
    const mode = $('g3-bg-mode');
    const field = $('g3-bg-color-field');
    const sync = () => { field.hidden = mode.value !== 'color'; };
    mode.addEventListener('change', () => {
        app.store.view.background = mode.value;
        app.viewport.setBackground(mode.value, $('g3-bg-color').value);
        sync();
    });
    $('g3-bg-color').addEventListener('input', (e) => {
        app.store.view.backgroundColor = /** @type {HTMLInputElement} */(e.target).value;
        app.viewport.setBackground('color', app.store.view.backgroundColor);
    });
    sync();
}

function setupExportPanel() {
    const sel = $('g3-exp-size');
    for (const p of RESOLUTION_PRESETS) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.label;
        sel.appendChild(o);
    }
    sel.value = '2400x1800';
    sel.addEventListener('change', () => {
        app.store.view.exportSize = sel.value;
        $('g3-exp-custom').hidden = sel.value !== 'custom';
    });
    $('g3-exp-format').addEventListener('change', (e) => {
        app.store.view.exportFormat = /** @type {HTMLSelectElement} */(e.target).value;
    });
    $('g3-exp-unit').addEventListener('click', () => {
        const u = app.store.doc.unit;
        download(serializeUnit(u), `${filenameFor(u)}.unit.json`, 'application/json');
    });
    $('g3-exp-matrix').addEventListener('click', exportGearMatrix);
}

function setupProjectPanel() {
    $('g3-seed').addEventListener('change', (e) => {
        const seed = /** @type {HTMLInputElement} */(e.target).value || DEFAULT_SEED;
        app.store.update((d) => { d.seed = seed; }, 'seed');
        app.materials.dispose();
        app.materials = new MaterialLibrary({ seed });
        app.materials.onTextureUpgrade = () => app.viewport?.invalidate();
        app.reapplyMaterials?.();
        rebuild();
    });
    for (const [id, key] of [['g3-meta-title', 'title'], ['g3-meta-author', 'author'], ['g3-meta-notes', 'notes']]) {
        $(id).addEventListener('change', (e) => {
            app.store.doc.meta[key] = /** @type {HTMLInputElement} */(e.target).value;
            scheduleAutosave();
        });
    }
}

/* ============================================================
   8. Tree and properties
   ============================================================ */

function renderTree() {
    const tree = $('g3-tree');
    tree.innerHTML = '';
    if (!app.layout) return;

    const iso = app.store.view.isolation;
    const pred = wheelPredicate(iso);
    const shown = new Set(app.layout.wheels.filter(pred).map((w) => w.axleId));

    /**
     * @param {string} label @param {number} depth @param {string} tag
     * @param {object} data
     */
    const node = (label, depth, tag, data) => {
        const el = document.createElement('div');
        el.className = 'g3-node';
        el.setAttribute('role', 'treeitem');
        el.setAttribute('data-depth', String(depth));
        el.tabIndex = 0;
        if (data.axleId && !shown.has(data.axleId)) el.classList.add('is-dim');
        if (data.axleId && data.axleId === app.selection.axleId && !data.groupOnly) el.classList.add('is-selected');
        el.innerHTML = `<span>${esc(label)}</span><span class="g3-node-tag">${esc(tag)}</span>`;

        const iso2 = document.createElement('button');
        iso2.className = 'g3-node-iso';
        iso2.innerHTML = '<i class="fas fa-crosshairs"></i>';
        iso2.title = 'Isolate';
        iso2.addEventListener('click', (ev) => {
            ev.stopPropagation();
            app.store.view.isolation = { ...iso, level: data.level, targetId: data.targetId };
            $('g3-isolation').value = data.level;
            applyIsolation({ frame: true });
        });
        el.appendChild(iso2);

        el.addEventListener('click', () => {
            app.selection = { axleId: data.axleId || null, positionId: data.positionId || null };
            renderTree();
            renderProperties();
            updateStatus();
        });
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); }
        });
        tree.appendChild(el);
        return el;
    };

    const u = app.store.doc.unit;
    node(u.domain === 'truck' ? `${u.designation} · ${u.bodyType}` : `${u.manufacturer} ${u.model}`,
        0, `${app.layout.wheels.length} tires`, { level: 'running-gear', targetId: null });

    const groups = app.layout.groups.length
        ? app.layout.groups
        : app.layout.axles.map((a) => ({ id: a.id, type: 'single', axles: [a.id] }));

    for (const g of groups) {
        node(`${g.id} — ${g.type}`, 1, g.spacing ? `${g.spacing} mm` : '',
            { level: 'group', targetId: g.id, groupOnly: true });
        for (const aid of g.axles) {
            const a = app.layout.axles.find((x) => x.id === aid);
            if (!a) continue;
            node(`${a.id} · ${a.role}`, 2, `${a.tireConfig} ${a.trackWidth} mm`,
                { level: 'axle', targetId: a.id, axleId: a.id });
            const positions = [...new Set(app.layout.wheels.filter((w) => w.axleId === a.id).map((w) => w.positionId))];
            for (const p of positions) {
                const tires = app.layout.wheels.filter((w) => w.positionId === p);
                node(p, 3, `${tires.length} tire${tires.length > 1 ? 's' : ''}`,
                    { level: 'position', targetId: p, axleId: a.id, positionId: p });
            }
        }
    }

    $('g3-tree-total').textContent = `${app.layout.axles.length} axles · ${app.layout.wheels.length} tires`;
}

function renderProperties() {
    const box = $('g3-props');
    const a = app.layout?.axles.find((x) => x.id === app.selection.axleId);
    if (!a) {
        box.innerHTML = '<p class="g3-note">Select an axle to edit its geometry. '
            + 'Every value is a real engineering dimension; editing one marks the unit as modified.</p>';
        return;
    }
    const src = app.store.doc.unit.axles?.find((x) => x.id === a.id);
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const L = (mm) => lengthFromMm(mm, sys.length).toFixed(sys.length === 'in' ? 2 : 0);

    box.innerHTML = `
        <h4>${esc(a.id)} — ${esc(a.role)}</h4>
        <div class="g3-field"><label for="p-x">Position x</label>
            <input type="number" id="p-x" class="g3-num" value="${L(a.x)}" step="any"><span class="g3-unit">${sys.length}</span></div>
        <div class="g3-field"><label for="p-track">Track</label>
            <input type="number" id="p-track" class="g3-num" value="${L(a.trackWidth)}" step="any"><span class="g3-unit">${sys.length}</span></div>
        ${a.dualSpacing != null ? `
        <div class="g3-field"><label for="p-dual">Dual spacing</label>
            <input type="number" id="p-dual" class="g3-num" value="${L(a.dualSpacing)}" step="any"><span class="g3-unit">${sys.length}</span></div>` : ''}
        <div class="g3-field"><label>Tire</label><span class="g3-mono" style="font-size:.76rem">${esc(a.tireConfig)} · ${esc(src?.tire || '')}</span></div>
        <div class="g3-field"><label>Loaded radius</label><span class="g3-mono" style="font-size:.76rem">${formatLength(a.axleHeight, sys.length, { precision: 1 })}</span></div>
        ${a.loadKn != null ? `<div class="g3-field"><label>Axle load</label><span class="g3-mono" style="font-size:.76rem">${formatForce(a.loadKn, sys.force, { precision: 1 })}</span></div>` : ''}
        ${src?.source ? `<div class="g3-source"><b>Source</b>${esc(src.source)}</div>` : ''}
        ${src?.load?.basis ? `<div class="g3-source"><b>Load basis</b>${esc(src.load.basis)}</div>` : ''}
    `;

    const bind = (id, field) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('change', () => {
            const mm = lengthToMm(Number(el.value), sys.length);
            editAxle(a.id, field, Math.round(mm * 10) / 10);
        });
    };
    bind('p-x', 'x');
    bind('p-track', 'trackWidth');
    bind('p-dual', 'dualSpacing');
}

/**
 * @param {string} axleId
 * @param {string} field
 * @param {number} valueMm
 */
function editAxle(axleId, field, valueMm) {
    const unit = app.store.doc.unit;
    const ref = unit.id;
    app.store.update((d) => {
        const ax = d.unit.axles.find((x) => x.id === axleId);
        if (!ax) return;
        ax[field] = valueMm;
        if (!d.modifiedFrom) {
            d.modifiedFrom = unit.classification
                ? `FHWA class ${unit.classification.class} reference (${ref})`
                : ref;
        }
    }, `edit ${axleId}.${field}`);
    rebuild();
}

function revertToReference() {
    const id = app.store.doc.unit?.id;
    if (!id) return;
    loadUnitById(id);
    toast('Reverted to the cited reference configuration.');
}

/** @param {string} designation */
function applyWideBaseSwap(designation) {
    const axleId = app.selection.axleId;
    if (!axleId) { toast('Select a dual-tire axle in the structure tree first.', 'warn'); return; }
    const unit = app.store.doc.unit;
    const src = unit.axles?.find((x) => x.id === axleId);
    if (!src) return;
    if (src.tireConfig !== 'DTA') {
        toast(`${axleId} carries ${src.tireConfig}, not a dual tire assembly. Only a DTA can be swapped.`, 'warn');
        return;
    }

    let result;
    try {
        result = swapToWideBase(src, designation);
    } catch (err) {
        toast(err.message, 'error');
        return;
    }

    const before = computePatches(app.layout, unit, {
        model: app.store.view.patchModel, inflationKpa: app.store.view.inflationKpa
    }).filter((p) => p.axleId === axleId);

    app.store.update((d) => {
        const i = d.unit.axles.findIndex((x) => x.id === axleId);
        d.unit.axles[i] = result.axle;
        if (!d.modifiedFrom) d.modifiedFrom = `${unit.id} reference`;
    }, `wide-base swap on ${axleId}`);
    rebuild();

    const after = app.patches.filter((p) => p.axleId === axleId);
    const areaBefore = before.reduce((s, p) => s + p.patch.area, 0);
    const areaAfter = after.reduce((s, p) => s + p.patch.area, 0);
    const r = result.report;
    const sys = UNIT_SYSTEMS[app.store.view.unitSystem];
    const cls = (v) => (v > 0 ? 'g3-delta-up' : 'g3-delta-down');

    const box = $('g3-wbt-report');
    box.hidden = false;
    box.innerHTML =
        `<div><strong>${esc(axleId)}</strong>: ${esc(r.from)} → ${esc(r.to)}</div>`
        + `<div>Track ${formatLength(r.trackWidthBefore, sys.length, { precision: 0 })} → `
        + `<strong>${formatLength(r.trackWidthAfter, sys.length, { precision: 0 })}</strong> `
        + `(<span class="${cls(r.trackWidthChange)}">${r.trackWidthChange > 0 ? '+' : ''}${r.trackWidthChange.toFixed(0)} mm</span>)</div>`
        + `<div>Tires ${r.tiresBefore} → <strong>${r.tiresAfter}</strong></div>`
        + `<div>Section width ${r.sectionWidthBefore} → <strong>${r.sectionWidthAfter} mm</strong> `
        + `(<span class="${cls(r.sectionWidthChange)}">${r.sectionWidthChangePct.toFixed(1)}%</span>)</div>`
        + `<div>Contact area ${formatArea(areaBefore, sys.area, { precision: 0 })} → `
        + `<strong>${formatArea(areaAfter, sys.area, { precision: 0 })}</strong></div>`
        + `<div>Load centroid shift <strong>${Math.abs(r.loadCentroidShift).toFixed(1)} mm</strong> `
        + `${r.loadCentroidShift >= 0 ? 'outboard' : 'inboard'}</div>`
        + `<div style="margin-top:.35rem;color:var(--g3-muted)">${esc(r.note)}</div>`;
}

/* ============================================================
   9. Export
   ============================================================ */

function exportSize() {
    const v = app.store.view;
    if (v.exportSize === 'custom') {
        return { width: Number($('g3-exp-w').value), height: Number($('g3-exp-h').value) };
    }
    const p = RESOLUTION_PRESETS.find((x) => x.id === v.exportSize) || RESOLUTION_PRESETS[1];
    return { width: p.width, height: p.height };
}

async function runExport() {
    const v = app.store.view;
    const { width, height } = exportSize();
    const source = app.viewport.size;
    const unit = app.store.doc.unit;
    const stem = filenameFor(unit, v.isolation.targetId || v.mode);

    showProgress(true, 'Preparing export…');
    try {
        const canvas = await renderSupersampled(app.viewport, {
            width, height,
            supersample: v.supersample,
            format: v.exportFormat === 'jpeg' ? 'jpeg' : v.exportFormat === 'png-alpha' ? 'png-alpha' : 'png',
            onProgress: (stage, done, total) => showProgress(
                true,
                stage === 'tile' ? `Rendering tile ${done} of ${total}…`
                    : stage === 'downsample' ? 'Resolving…' : 'Rendering…',
                done / total
            )
        });

        const overlay = /** @type {SVGSVGElement} */ ($('g3-overlay'));

        if (v.exportFormat === 'svg') {
            const svg = buildHybridSVG(canvas, overlay, {
                width, height, sourceWidth: source.width, sourceHeight: source.height,
                title: app.store.doc.meta.title || unit.id
            });
            download(svg, `${stem}.svg`, 'image/svg+xml');
        } else if (v.exportFormat === 'pdf') {
            const pdf = buildHybridPDF(canvas, overlay, {
                width, height, sourceWidth: source.width, sourceHeight: source.height,
                title: app.store.doc.meta.title || unit.id
            });
            download(pdf, `${stem}.pdf`);
        } else {
            await compositeOverlay(canvas, overlay, {
                width, height, sourceWidth: source.width, sourceHeight: source.height
            });
            const blob = await canvasToBlob(canvas, /** @type {any} */(v.exportFormat));
            download(blob, `${stem}.${v.exportFormat === 'jpeg' ? 'jpg' : 'png'}`);
        }
        toast(`Exported ${width} × ${height}.`);
    } catch (err) {
        console.error(err);
        toast(err.message, 'error');
    } finally {
        showProgress(false);
    }
}

/**
 * Gear matrix: an N x M comparison sheet with a shared camera, shared
 * lighting and a shared scale, so the cells are genuinely comparable.
 */
async function exportGearMatrix() {
    if (!app.layout) return;
    const groups = app.layout.groups.filter((g) => g.axles?.length);
    const cells = (groups.length ? groups : app.layout.axles.map((a) => ({ id: a.id, type: 'single', axles: [a.id] })))
        .slice(0, 4);
    if (cells.length < 2) { toast('This unit has only one axle group; a matrix needs at least two.', 'warn'); return; }

    const cols = cells.length <= 2 ? cells.length : 2;
    const rows = Math.ceil(cells.length / cols);
    const cellW = 900, cellH = 700, capH = 46, pad = 16;

    const sheet = document.createElement('canvas');
    sheet.width = cols * cellW + pad * (cols + 1);
    sheet.height = rows * (cellH + capH) + pad * (rows + 1);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sheet.width, sheet.height);

    const savedIso = { ...app.store.view.isolation };
    const savedMode = app.store.view.mode;

    // A shared framing box: the largest cell's extents, applied to all of
    // them, so a tandem does not silently render bigger than a single.
    let shared = null;
    for (const c of cells) {
        const b = isolationBounds({ level: 'group', targetId: c.id, ghost: false }, app.layout);
        if (!b) continue;
        shared = shared ? {
            minX: Math.min(shared.minX, b.minX), maxX: Math.max(shared.maxX, b.maxX),
            minY: Math.min(shared.minY, b.minY), maxY: Math.max(shared.maxY, b.maxY),
            minZ: 0, maxZ: Math.max(shared.maxZ, b.maxZ)
        } : b;
    }

    showProgress(true, 'Building gear matrix…');
    try {
        setViewMode('3d');
        app.viewport.cameras.setPreset('front34Left');

        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            app.store.view.isolation = { level: 'group', targetId: c.id, ghost: false };
            app.assembly.setWheelFilter(wheelPredicate(app.store.view.isolation));

            // Centre each cell's content but keep the shared extent, so scale
            // is identical across cells.
            const b = isolationBounds(app.store.view.isolation, app.layout);
            const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
            const halfX = (shared.maxX - shared.minX) / 2, halfY = (shared.maxY - shared.minY) / 2;
            app.viewport.frameEngineering({
                minX: cx - halfX, maxX: cx + halfX,
                minY: cy - halfY, maxY: cy + halfY,
                minZ: 0, maxZ: shared.maxZ
            });
            app.viewport.render();

            const cell = await renderToCanvas(app.viewport, { width: cellW, height: cellH, format: 'png' });
            const col = i % cols, row = Math.floor(i / cols);
            const x = pad + col * (cellW + pad);
            const y = pad + row * (cellH + capH + pad);
            ctx.drawImage(cell, x, y);

            const axle = app.layout.axles.find((a) => a.id === c.axles[0]);
            const caption = `${String.fromCharCode(97 + i)}) ${c.type} · ${axle?.tireConfig || ''} · ${axle?.role || ''}`;
            ctx.fillStyle = '#16202b';
            ctx.font = '500 20px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(caption, x, y + cellH + 28);

            showProgress(true, `Cell ${i + 1} of ${cells.length}…`, (i + 1) / cells.length);
        }

        const blob = await canvasToBlob(sheet, 'png');
        download(blob, `${filenameFor(app.store.doc.unit, 'gear-matrix')}.png`);
        toast(`Gear matrix exported (${cells.length} cells).`);
    } catch (err) {
        console.error(err);
        toast(err.message, 'error');
    } finally {
        app.store.view.isolation = savedIso;
        setViewMode(savedMode);
        applyIsolation({ frame: true });
        showProgress(false);
    }
}

/** @param {'csv'|'abaqus'} kind */
function exportFootprint(kind) {
    if (!app.patches.length) { toast('No contact patches to export.', 'warn'); return; }
    const unit = app.store.doc.unit;
    const ctx = {
        unitId: unit.id,
        unitLabel: unit.domain === 'truck' ? `${unit.designation} — ${unit.bodyType}` : `${unit.manufacturer} ${unit.model}`,
        model: app.store.view.patchModel,
        timestamp: new Date().toISOString()
    };
    const stem = filenameFor(unit, 'footprint');
    if (kind === 'csv') {
        download(toCSV(app.patches, ctx), `${stem}.csv`, 'text/csv');
        download(footprintJSON(app.patches, ctx), `${stem}.json`, 'application/json');
        toast('Exported footprint.csv and footprint.json.');
    } else {
        download(toAbaqus(app.patches, ctx), `${stem}.abaqus.inp`, 'text/plain');
        toast('Exported the Abaqus parameter table. Read its header before use.');
    }
}

/* ============================================================
   10. Project I/O
   ============================================================ */

function currentState() {
    const v = app.store.view;
    return {
        meta: app.store.doc.meta,
        seed: app.store.doc.seed,
        unit: app.store.doc.unit,
        modifiedFrom: app.store.doc.modifiedFrom,
        customDimensions: app.store.doc.customDimensions,
        calloutOffsets: app.store.doc.calloutOffsets,
        contact: {
            model: v.patchModel, inflationKpa: v.inflationKpa, show: v.showPatches,
            overrides: v.contactOverrides || {}
        },
        view: {
            mode: v.mode,
            camera: app.viewport.cameras.toJSON(),
            lighting: v.lighting,
            background: v.background,
            backgroundColor: v.backgroundColor,
            unitSystem: v.unitSystem,
            precision: v.precision,
            dualUnits: v.dualUnits,
            dimensionSets: v.dimensionSets,
            showCallouts: v.showCallouts,
            showScaleBar: v.showScaleBar,
            annotations: v.annotations,
            showGrid: v.showGrid,
            materials: v.materials,
            isolation: v.isolation
        }
    };
}

function saveProject() {
    const u = app.store.doc.unit;
    download(serializeProject(currentState()), `${filenameFor(u)}.gear3d`, 'application/json');
    toast('Project saved.');
}

/** @param {any} p */
function applyProject(p) {
    app.store.replaceDoc({
        unit: p.unit,
        seed: p.seed || DEFAULT_SEED,
        meta: p.meta || {},
        modifiedFrom: p.modifiedFrom || null,
        customDimensions: p.customDimensions || [],
        calloutOffsets: p.calloutOffsets || {}
    }, 'open project');

    Object.assign(app.store.view, {
        mode: p.view?.mode || '3d',
        lighting: p.view?.lighting || { ...LIGHTING_PRESETS.studio },
        background: p.view?.background || 'white',
        backgroundColor: p.view?.backgroundColor || '#eef1f4',
        unitSystem: p.view?.unitSystem || 'SI',
        precision: p.view?.precision ?? 0,
        dualUnits: !!p.view?.dualUnits,
        dimensionSets: p.view?.dimensionSets || ['longitudinal', 'transverse'],
        showCallouts: !!p.view?.showCallouts,
        showScaleBar: p.view?.showScaleBar !== false,
        annotations: p.view?.annotations !== false,
        showGrid: p.view?.showGrid !== false,
        materials: p.view?.materials || {},
        isolation: p.view?.isolation || defaultIsolation(),
        patchModel: p.contact?.model || 'rectangular',
        inflationKpa: p.contact?.inflationKpa ?? DEFAULT_INFLATION_KPA,
        showPatches: !!p.contact?.show,
        contactOverrides: p.contact?.overrides || {}
    });

    if (app.store.doc.seed !== DEFAULT_SEED) {
        app.materials.dispose();
        app.materials = new MaterialLibrary({ seed: app.store.doc.seed });
        app.materials.onTextureUpgrade = () => app.viewport?.invalidate();
        app.reapplyMaterials?.();
    }

    rebuild({ frame: true });
    if (p.view?.camera) app.viewport.cameras.fromJSON(p.view.camera);
    app.viewport.setLighting(app.store.view.lighting);
    app.viewport.setBackground(app.store.view.background, app.store.view.backgroundColor);

    syncUnitSelectors();
    syncLightingFields();
    syncCameraFields();
    syncInflationField();
    syncOverrideUnits();
    renderCustomList();
    app.viewport.setGrid(app.store.view.showGrid);
    for (const cb of document.querySelectorAll('.g3-dimset')) {
        const el = /** @type {HTMLInputElement} */ (cb);
        el.checked = app.store.view.dimensionSets.includes(el.getAttribute('data-set'));
    }
    for (const [id, on] of [['g3-annot', app.store.view.annotations], ['g3-grid', app.store.view.showGrid]]) {
        $(id).classList.toggle('is-on', !!on);
        $(id).setAttribute('aria-pressed', String(!!on));
    }
    setViewMode(app.store.view.mode || '3d');
    $('g3-seed').value = app.store.doc.seed;
    $('g3-meta-title').value = app.store.doc.meta.title || '';
    $('g3-meta-author').value = app.store.doc.meta.author || '';
    $('g3-meta-notes').value = app.store.doc.meta.notes || '';
}

let _autosaveTimer = null;
function scheduleAutosave() {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
        if (app.store?.doc?.unit) autosave(currentState());
    }, 900);
}

/* ============================================================
   11. Keyboard
   ============================================================ */

function setupKeyboard() {
    let pendingV = false;
    document.addEventListener('keydown', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;

        if (pendingV && '12345'.includes(e.key)) {
            setViewMode(['3d', 'plan', 'side', 'front', 'quad'][Number(e.key) - 1]);
            pendingV = false;
            e.preventDefault();
            return;
        }
        pendingV = false;

        if (e.key === 'v' || e.key === 'V') { pendingV = true; return; }
        if (e.key === 'm' || e.key === 'M') { setMeasureMode(); e.preventDefault(); return; }
        if (e.key === 'a' || e.key === 'A') { $('g3-annot').click(); e.preventDefault(); return; }
        if (e.key === 'g' || e.key === 'G') { $('g3-grid').click(); e.preventDefault(); return; }
        if (e.key === 'Escape') {
            // Escape unwinds the innermost thing first: a half-placed
            // measurement, then measure mode, then isolation.
            if (app.measure.active && app.measure.first) {
                app.measure.first = null;
                app.viewport.invalidate();
                updateStatus();
            } else if (app.measure.active) {
                setMeasureMode(false);
            } else {
                app.store.view.isolation = stepOut(app.store.view.isolation, app.layout);
                $('g3-isolation').value = app.store.view.isolation.level;
                applyIsolation({ frame: true });
            }
            e.preventDefault();
        } else if (e.key === 'f' || e.key === 'F') {
            $('g3-fit').click();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            if (app.store.undo()) rebuild();
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            if (app.store.redo()) rebuild();
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            saveProject();
            e.preventDefault();
        }
    });
}

/* ============================================================
   12. Small helpers
   ============================================================ */

function updateStatus() {
    if (!app.layout) return;
    $('g3-status-iso').textContent = describeIsolation(app.store.view.isolation, app.layout);
    if (app.measure.active) {
        $('g3-status-sel').textContent = app.measure.first
            ? 'Measuring — click the second feature (Esc to cancel)'
            : `Measuring — click the first feature (${app.snapPoints.length} snap targets)`;
    } else {
        $('g3-status-sel').textContent = app.selection.axleId
            ? `Selected ${app.selection.positionId || app.selection.axleId}`
            : 'No selection';
    }
    const o = app.viewport.cameras.getOrbit();
    const v = app.store.view;
    $('g3-status-view').textContent = v.mode === 'quad'
        ? 'Quad · plan / 3D / side / front'
        : v.mode === '3d'
            ? `az ${o.azimuth.toFixed(0)}° · el ${o.elevation.toFixed(0)}°`
            : `${VIEW_META[v.mode].label} · locked`;
    $('g3-hud').textContent = `${app.store.doc.unit?.designation || app.store.doc.unit?.model || ''} · `
        + `${app.layout.wheels.length} tires`;
    syncCameraFields();
}

/**
 * @param {string} rangeId @param {string} numId @param {(v:number)=>void} onChange
 */
function linkRange(rangeId, numId, onChange) {
    const r = /** @type {HTMLInputElement} */ ($(rangeId));
    const n = /** @type {HTMLInputElement} */ ($(numId));
    const fire = (val) => { r.value = String(val); n.value = String(val); onChange(Number(val)); };
    r.addEventListener('input', () => fire(r.value));
    n.addEventListener('change', () => fire(n.value));
}

/** @param {string} rangeId @param {string} numId @param {number|string} value */
function setPair(rangeId, numId, value) {
    const r = /** @type {HTMLInputElement} */ ($(rangeId));
    const n = /** @type {HTMLInputElement} */ ($(numId));
    if (r) r.value = String(value);
    if (n) n.value = String(value);
}

/** @param {string} name @returns {string} */
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#16202b';
}

/**
 * Annotation ink, halo and accent for the CURRENT FIGURE BACKGROUND.
 *
 * A transparent background is treated as light, because a transparent figure
 * is placed on a page, and pages are white far more often than not.
 *
 * @returns {{color: string, halo: string, accent: string}}
 */
function figureInk() {
    const v = app.store.view;
    const bg = v.background === 'color' ? v.backgroundColor
        : v.background === 'white' ? '#ffffff'
            : '#ffffff';
    const dark = relativeLuminance(bg) < 0.45;
    return dark
        ? { color: '#f2f6f9', halo: '#10161d', accent: '#ff8a63' }
        : { color: '#16202b', halo: '#ffffff', accent: '#c8452a' };
}

/**
 * @param {string} hex
 * @returns {number} 0 (black) to 1 (white)
 */
function relativeLuminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** @param {boolean} on @param {string} [label] @param {number} [frac] */
function showProgress(on, label = '', frac = 0) {
    const el = $('g3-progress');
    el.hidden = !on;
    if (on) {
        el.querySelector('.g3-progress-label').textContent = label;
        /** @type {HTMLElement} */(el.querySelector('.g3-progress-bar span')).style.width = `${Math.round(frac * 100)}%`;
    }
}

/**
 * @param {string} msg
 * @param {'info'|'warn'|'error'} [kind]
 */
function toast(msg, kind = 'info') {
    const wrap = $('g3-toast-wrap');
    const el = document.createElement('div');
    el.className = `g3-toast${kind === 'info' ? '' : ` g3-toast--${kind}`}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 9000 : 4200);
}

/** @param {string} s @returns {string} */
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
