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
import { CAMERA_PRESETS, ENG_AXES } from './src/core/coords.js';

import { MaterialLibrary } from './src/scene/materials.js';
import { LIGHTING_PRESETS } from './src/scene/lighting.js';
import { Viewport } from './src/scene/renderer.js';
import { VIEW_META } from './src/scene/cameras.js';
import { buildAssembly } from './src/geometry/assembly.js';

import {
    autoDimensions, renderDimensions, renderCallouts, renderScaleBar, dimensionValue
} from './src/annotate/dimensions.js';
import { projectEng } from './src/annotate/projection.js';

import { computePatches, patchTotals, patchOutlineAbsolute, DEFAULT_INFLATION_KPA } from './src/contact/patch.js';
import { toCSV, toJSON as footprintJSON, toAbaqus } from './src/contact/export.js';

import {
    defaultIsolation, wheelPredicate, ISOLATION_LEVELS, ISOLATION_META,
    drillInto, stepOut, describeIsolation, isolationBounds
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
    dirtyOverlay: true
};

/** Everything that is not the document: view flags, not undoable. */
function defaultView() {
    return {
        mode: '3d',
        unitSystem: 'SI',
        precision: 0,
        dualUnits: false,
        dimensionSets: ['longitudinal', 'transverse'],
        showCallouts: false,
        showScaleBar: true,
        showPatches: false,
        patchModel: 'rectangular',
        inflationKpa: DEFAULT_INFLATION_KPA,
        isolation: defaultIsolation(),
        lighting: { ...LIGHTING_PRESETS.studio },
        background: 'white',
        backgroundColor: '#eef1f4',
        exportFormat: 'png',
        exportSize: '2400x1800',
        exportW: 2400,
        exportH: 1800,
        quality: 'standard',
        supersample: 2
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
    setupBackgroundPanel();
    setupExportPanel();
    setupProjectPanel();
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
}

/* ============================================================
   3. Viewport
   ============================================================ */

function setupViewport() {
    app.materials = new MaterialLibrary({ seed: DEFAULT_SEED });
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
    updateStatus();
    scheduleAutosave();
}

/* ============================================================
   5. Isolation
   ============================================================ */

function applyIsolation(opts = {}) {
    if (!app.assembly) return;
    const iso = app.store.view.isolation;
    app.assembly.setWheelFilter(wheelPredicate(iso), { ghost: iso.ghost });

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
        ...(app.store.doc.customDimensions || [])
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

    renderDimensions(svg, dims, opts);
    if (v.showPatches) drawPatches(svg, opts);
    if (v.showCallouts) renderCallouts(svg, shownLayout, { ...opts, offsets: app.store.doc.calloutOffsets });
    if (v.showScaleBar) renderScaleBar(svg, opts);

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

function updateAxisBadge() {
    const v = app.store.view;
    const meta = VIEW_META[v.mode];
    $('g3-axisbadge').innerHTML =
        `<b>${meta.label}</b><br>x ${ENG_AXES.x.positive}<br>y ${ENG_AXES.y.positive}<br>z ${ENG_AXES.z.positive}`;
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
            app.viewport.invalidate();
        });
    }

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

/** @param {string} mode */
function setViewMode(mode) {
    app.store.view.mode = mode;
    app.viewport.cameras.setMode(mode);
    for (const b of document.querySelectorAll('.g3-vtab')) {
        const on = b.getAttribute('data-view') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
    }
    $('g3-hud-right').textContent = VIEW_META[mode].locked
        ? 'locked view · zoom: wheel · pan: drag · click an axle to isolate'
        : 'orbit: drag · zoom: wheel · pan: right-drag · click an axle to isolate';
    const b = isolationBounds(app.store.view.isolation, app.layout);
    if (b) app.viewport.frameEngineering(b);
    updateStatus();
}

function setupUnitPanel() {
    $('g3-domain').addEventListener('change', () => { syncCategories(); syncUnits(); });
    $('g3-category').addEventListener('change', syncUnits);
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

function syncUnits() {
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
    const current = app.store?.doc?.unit?.id;
    if (current && filtered.some((u) => u.id === current)) sel.value = current;
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
    syncInflationField();
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
        inflationKpa: app.store.view.inflationKpa
    });
    renderPatchSummary();
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
        contact: { model: v.patchModel, inflationKpa: v.inflationKpa, show: v.showPatches },
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
        isolation: p.view?.isolation || defaultIsolation(),
        patchModel: p.contact?.model || 'rectangular',
        inflationKpa: p.contact?.inflationKpa ?? DEFAULT_INFLATION_KPA,
        showPatches: !!p.contact?.show
    });

    if (app.store.doc.seed !== DEFAULT_SEED) {
        app.materials.dispose();
        app.materials = new MaterialLibrary({ seed: app.store.doc.seed });
    }

    rebuild({ frame: true });
    if (p.view?.camera) app.viewport.cameras.fromJSON(p.view.camera);
    app.viewport.setLighting(app.store.view.lighting);
    app.viewport.setBackground(app.store.view.background, app.store.view.backgroundColor);

    syncUnitSelectors();
    syncLightingFields();
    syncCameraFields();
    syncInflationField();
    setViewMode(app.store.view.mode);
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

        if (pendingV && '1234'.includes(e.key)) {
            setViewMode(['3d', 'plan', 'side', 'front'][Number(e.key) - 1]);
            pendingV = false;
            e.preventDefault();
            return;
        }
        pendingV = false;

        if (e.key === 'v' || e.key === 'V') { pendingV = true; return; }
        if (e.key === 'Escape') {
            app.store.view.isolation = stepOut(app.store.view.isolation, app.layout);
            $('g3-isolation').value = app.store.view.isolation.level;
            applyIsolation({ frame: true });
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
    $('g3-status-sel').textContent = app.selection.axleId
        ? `Selected ${app.selection.positionId || app.selection.axleId}`
        : 'No selection';
    const o = app.viewport.cameras.getOrbit();
    const v = app.store.view;
    $('g3-status-view').textContent = v.mode === '3d'
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
