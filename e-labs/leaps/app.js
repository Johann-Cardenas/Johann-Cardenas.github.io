/* =====================================================================
 * LEAPS — Linear Elastic Analysis of Pavement Structures
 * Application shell: model panels, CAD-style section viewport,
 * results studio, exports. The numerical engine lives in solver.js
 * and runs inside a Web Worker (worker.js).
 *
 * Internal units: mm, N, MPa. UI converts per selected unit system.
 * ===================================================================== */
(function () {
    'use strict';

    /* =================== small utilities =================== */
    var $ = function (id) { return document.getElementById(id); };

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function debounce(fn, ms) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
    }
    function sig(x, n) {
        n = n || 4;
        if (x == null || !isFinite(x)) return '—';
        if (x === 0) return '0';
        var a = Math.abs(x);
        if (a >= 1e6 || a < 1e-3) return x.toExponential(2);
        return String(parseFloat(x.toPrecision(n)));
    }
    function mulberry32(seed) {
        var t0 = seed >>> 0;
        return function () {
            t0 += 0x6D2B79F5;
            var t = t0;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function quantile(sorted, q) {
        if (!sorted.length) return 0;
        var i = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
        var lo = Math.floor(i), hi = Math.ceil(i);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    }
    function cssVar(name) {
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }
    function download(filename, text, mime) {
        var blob = new Blob([text], { type: mime || 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }

    /* =================== unit system =================== */
    var UNITS = {
        SI: {
            len: { k: 1, u: 'mm' }, stress: { k: 1000, u: 'kPa' }, modulus: { k: 1, u: 'MPa' },
            force: { k: 1, u: 'kN' }, defl: { k: 1, u: 'mm' }, strain: { k: 1e6, u: 'µε' },
            kitf: { k: 1, u: 'MPa/mm' }
        },
        US: {
            len: { k: 1 / 25.4, u: 'in' }, stress: { k: 145.038, u: 'psi' }, modulus: { k: 0.145038, u: 'ksi' },
            force: { k: 224.809, u: 'lbf' }, defl: { k: 39.3701, u: 'mil' }, strain: { k: 1e6, u: 'µε' },
            kitf: { k: 3688.7, u: 'psi/in' }
        }
    };
    function U() { return UNITS[state.settings.units] || UNITS.SI; }
    function toDisp(q, v) { return v * U()[q].k; }
    function fromDisp(q, v) { return v / U()[q].k; }
    function unit(q) { return U()[q].u; }

    /* =================== material database =================== */
    /* Typical values compiled from FAA AC 150/5320-6, AASHTO MEPDG,
     * Huang (2004). E in MPa, editable everywhere. */
    var MATERIALS = [
        { id: 'ac-dense', name: 'HMA — dense graded', group: 'Asphalt', E: 3000, range: [1500, 6000], nu: 0.35, color: '#33363d', tex: 'asphalt' },
        { id: 'ac-sma', name: 'SMA surface', group: 'Asphalt', E: 3800, range: [2000, 6500], nu: 0.35, color: '#282b31', tex: 'asphalt' },
        { id: 'ac-p401', name: 'FAA P-401 HMA', group: 'Asphalt', E: 1379, range: [1000, 3500], nu: 0.35, color: '#3a3d44', tex: 'asphalt' },
        { id: 'atb', name: 'Asphalt-treated base', group: 'Asphalt', E: 1800, range: [800, 3000], nu: 0.35, color: '#46484e', tex: 'asphalt' },
        { id: 'pcc', name: 'PCC — paving concrete', group: 'Concrete', E: 27600, range: [20700, 41400], nu: 0.15, color: '#b9bdc4', tex: 'concrete' },
        { id: 'lcb', name: 'Lean concrete base', group: 'Concrete', E: 10000, range: [6900, 17000], nu: 0.18, color: '#a6abb3', tex: 'concrete' },
        { id: 'ctb', name: 'Cement-treated base (P-304)', group: 'Stabilized', E: 3450, range: [1700, 6900], nu: 0.20, color: '#8f948d', tex: 'stabilized' },
        { id: 'lime', name: 'Lime-stabilized soil', group: 'Stabilized', E: 250, range: [100, 500], nu: 0.30, color: '#a99e84', tex: 'stabilized' },
        { id: 'p209', name: 'Crushed aggregate (P-209)', group: 'Granular', E: 350, range: [150, 500], nu: 0.35, color: '#8b8378', tex: 'granular' },
        { id: 'base', name: 'Crushed stone base', group: 'Granular', E: 300, range: [100, 500], nu: 0.35, color: '#95897a', tex: 'granular' },
        { id: 'p154', name: 'Granular subbase (P-154)', group: 'Granular', E: 150, range: [100, 300], nu: 0.35, color: '#a29380', tex: 'granular' },
        { id: 'subbase', name: 'Gravel subbase', group: 'Granular', E: 150, range: [70, 300], nu: 0.35, color: '#ab9c86', tex: 'granular' },
        { id: 'sg-sand', name: 'Sandy subgrade', group: 'Subgrade', E: 100, range: [50, 170], nu: 0.40, color: '#b7a179', tex: 'soil' },
        { id: 'sg-silt', name: 'Silty subgrade', group: 'Subgrade', E: 60, range: [30, 100], nu: 0.40, color: '#a08b6b', tex: 'soil' },
        { id: 'sg-clay', name: 'Clay subgrade', group: 'Subgrade', E: 40, range: [15, 80], nu: 0.45, color: '#8d7355', tex: 'soil' },
        { id: 'rock', name: 'Weathered rock', group: 'Subgrade', E: 5000, range: [1000, 20000], nu: 0.25, color: '#7d7f84', tex: 'rock' }
    ];
    function matById(id) {
        for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].id === id) return MATERIALS[i];
        return MATERIALS[0];
    }

    /* =================== templates =================== */
    var TEMPLATES = [
        {
            id: 'aashto-flex', name: 'Highway flexible — AASHTO',
            layers: [
                { mat: 'ac-dense', h: 100 }, { mat: 'base', h: 200 },
                { mat: 'subbase', h: 300 }, { mat: 'sg-silt', h: 0 }
            ],
            wheels: 'dual', gear: { F: 20, p: 700, Sd: 350, St: 1300 }
        },
        {
            id: 'faa-flex', name: 'Airfield flexible — FAA (B737 duals)',
            layers: [
                { mat: 'ac-p401', h: 127 }, { mat: 'p209', h: 305 },
                { mat: 'p154', h: 305 }, { mat: 'sg-silt', h: 0, E: 83 }
            ],
            wheels: 'dual', gear: { F: 185, p: 1413, Sd: 864, St: 1473 }
        },
        {
            id: 'rigid', name: 'Rigid — PCC on CTB (unbonded)',
            layers: [
                { mat: 'pcc', h: 300 }, { mat: 'ctb', h: 150 }, { mat: 'sg-silt', h: 0, E: 80 }
            ],
            interfaces: [{ bond: 'unbonded' }, { bond: 'bonded' }],
            wheels: 'dual', gear: { F: 20, p: 700, Sd: 350, St: 1300 }
        },
        {
            id: 'composite', name: 'Composite — AC over PCC',
            layers: [
                { mat: 'ac-dense', h: 100 }, { mat: 'pcc', h: 250 },
                { mat: 'base', h: 150 }, { mat: 'sg-sand', h: 0 }
            ],
            wheels: 'dual', gear: { F: 20, p: 700, Sd: 350, St: 1300 }
        },
        {
            id: 'perpetual', name: 'Perpetual — deep asphalt',
            layers: [
                { mat: 'ac-sma', h: 50 }, { mat: 'ac-dense', h: 150 },
                { mat: 'atb', h: 100 }, { mat: 'base', h: 150 }, { mat: 'sg-silt', h: 0 }
            ],
            wheels: 'dual', gear: { F: 22, p: 750, Sd: 350, St: 1300 }
        },
        {
            id: 'halfspace', name: 'Halfspace — Boussinesq check',
            layers: [{ mat: 'sg-sand', h: 0, E: 100, nu: 0.35 }],
            wheels: 'single', gear: { F: 49.48, p: 700, Sd: 350, St: 1300 }
        }
    ];

    /* =================== response fields =================== */
    var FIELDS = [
        { id: 'szz', label: 'σz — vertical stress', q: 'stress', div: true, get: function (p) { return p.sig.zz; } },
        { id: 'sxx', label: 'σx — horizontal stress', q: 'stress', div: true, get: function (p) { return p.sig.xx; } },
        { id: 'syy', label: 'σy — transverse stress', q: 'stress', div: true, get: function (p) { return p.sig.yy; } },
        { id: 'sxz', label: 'τxz — shear stress', q: 'stress', div: true, get: function (p) { return p.sig.xz; } },
        { id: 's1', label: 'σ1 — major principal', q: 'stress', div: true, get: function (p) { return p.principal.s1; } },
        { id: 's3', label: 'σ3 — minor principal', q: 'stress', div: true, get: function (p) { return p.principal.s3; } },
        { id: 'vm', label: 'von Mises stress', q: 'stress', div: false, get: function (p) { return p.vm; } },
        { id: 'tmax', label: 'τmax — max shear', q: 'stress', div: false, get: function (p) { return p.tauMax; } },
        { id: 'exx', label: 'εx — horizontal strain', q: 'strain', div: true, get: function (p) { return p.eps.xx; } },
        { id: 'ezz', label: 'εz — vertical strain', q: 'strain', div: true, get: function (p) { return p.eps.zz; } },
        { id: 'uz', label: 'w — deflection', q: 'defl', div: false, get: function (p) { return p.disp.uz; } }
    ];
    function fieldById(id) {
        for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].id === id) return FIELDS[i];
        return FIELDS[0];
    }

    /* =================== colormaps =================== */
    var VIRIDIS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'];
    var RDBU = ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'];
    function hex2rgb(h) {
        return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    }
    function makeLUT(anchors) {
        var rgb = anchors.map(hex2rgb), N = 256, lut = new Uint8ClampedArray(N * 3);
        for (var i = 0; i < N; i++) {
            var t = i / (N - 1) * (rgb.length - 1);
            var j = Math.min(Math.floor(t), rgb.length - 2), f = t - j;
            for (var c = 0; c < 3; c++) lut[i * 3 + c] = rgb[j][c] + (rgb[j + 1][c] - rgb[j][c]) * f;
        }
        return lut;
    }
    var LUT_SEQ = makeLUT(VIRIDIS), LUT_DIV = makeLUT(RDBU);

    /* =================== state =================== */
    var uid = 1;
    function nid() { return uid++; }

    var state = {
        name: 'Untitled analysis',
        ySec: 0,
        layers: [],           /* {id, mat, name, h, E, nu, color, tex} */
        interfaces: [],       /* {bond, k} */
        wheels: [],           /* {id, x, y, F(kN), p(kPa)} */
        points: [],           /* {id, x, y, z} */
        settings: {
            units: 'SI', tol: '1e-6', res: '61x43', autorun: true,
            showBasin: true, showContour: true, field: 'szz', alpha: 0.85
        }
    };

    var results = { key: null, user: null, profiles: null, basin: null, grid: null, stats: null };
    var view = { scale: 0.5, ox: 0, oy: 0 };
    var selPoint = null;
    var history = [], future = [];

    function wheelA(w) { /* contact radius mm from F kN, p kPa */
        return Math.sqrt((w.F * 1000) / ((w.p / 1000) * Math.PI));
    }
    function layerFromMat(matId, over) {
        var m = matById(matId);
        var L = {
            id: nid(), mat: m.id, name: m.name, h: 150,
            E: m.E, nu: m.nu, color: m.color, tex: m.tex
        };
        if (over) for (var k in over) if (over[k] != null) L[k] = over[k];
        return L;
    }
    function depthFinite() {
        var d = 0;
        for (var i = 0; i < state.layers.length - 1; i++) d += state.layers[i].h;
        return d;
    }
    function maxA() {
        var a = 60;
        state.wheels.forEach(function (w) { a = Math.max(a, wheelA(w)); });
        return a;
    }
    function worldBox() {
        var df = depthFinite();
        var subExt = state.layers.length > 1 ? clamp(0.55 * df, 300, 2200) : Math.max(4 * maxA(), 900);
        var zMax = df + subExt;
        var xw = 0;
        state.wheels.forEach(function (w) { xw = Math.max(xw, Math.abs(w.x)); });
        var xHalf = Math.max(xw + 3.0 * maxA(), 0.9 * zMax, 700);
        return { xL: -xHalf, xR: xHalf, zMax: zMax, df: df };
    }

    function serialize() {
        return {
            app: 'LEAPS', version: '1.0', name: state.name, ySec: state.ySec,
            layers: state.layers, interfaces: state.interfaces,
            wheels: state.wheels, points: state.points, settings: state.settings
        };
    }
    function deserialize(d) {
        if (!d || d.app !== 'LEAPS') throw new Error('Not a LEAPS project file');
        state.name = d.name || 'Untitled analysis';
        state.ySec = d.ySec || 0;
        state.layers = d.layers || [];
        state.interfaces = d.interfaces || [];
        state.wheels = d.wheels || [];
        state.points = d.points || [];
        var s = d.settings || {};
        for (var k in state.settings) if (s[k] != null) state.settings[k] = s[k];
        state.layers.forEach(function (L) { L.id = nid(); });
        state.wheels.forEach(function (w) { w.id = nid(); });
        state.points.forEach(function (p) { p.id = nid(); });
    }

    /* ---------- history ---------- */
    function snapshot() { return JSON.stringify(serialize()); }
    function pushHistory() {
        history.push(snapshot());
        if (history.length > 80) history.shift();
        future = [];
        updateHistoryButtons();
        saveLocal();
    }
    function restore(json) {
        deserialize(JSON.parse(json));
        renderAll();
        scheduleRun();
    }
    function undo() {
        if (history.length < 2) return;
        future.push(history.pop());
        restore(history[history.length - 1]);
        updateHistoryButtons();
    }
    function redo() {
        if (!future.length) return;
        var s = future.pop();
        history.push(s);
        restore(s);
        updateHistoryButtons();
    }
    function updateHistoryButtons() {
        $('lp-undo').disabled = history.length < 2;
        $('lp-redo').disabled = !future.length;
    }
    var saveLocal = debounce(function () {
        try { localStorage.setItem('leaps-autosave', snapshot()); } catch (e) { /* quota */ }
    }, 600);

    /* mutate wrapper: apply fn, record, re-render, schedule solve */
    function mutate(fn, opts) {
        fn(state);
        syncStructures();
        pushHistory();
        renderPanels();
        invalidateResults(opts && opts.keepResults);
        drawViewport();
        scheduleRun();
    }
    function syncStructures() {
        var n = state.layers.length;
        while (state.interfaces.length < n - 1) state.interfaces.push({ bond: 'bonded', k: 1 });
        state.interfaces.length = Math.max(0, n - 1);
    }
    function invalidateResults(keep) {
        if (keep) return;
        results = { key: null, user: null, profiles: null, basin: null, grid: null, stats: null };
    }

    /* =================== templates & gears =================== */
    function gearLayout(type, g) {
        var w = [];
        function add(x, y) { w.push({ id: nid(), x: x, y: y, F: g.F, p: g.p }); }
        if (type === 'single') add(0, 0);
        else if (type === 'dual') { add(-g.Sd / 2, 0); add(g.Sd / 2, 0); }
        else if (type === 'dual-tandem') {
            add(-g.Sd / 2, -g.St / 2); add(g.Sd / 2, -g.St / 2);
            add(-g.Sd / 2, g.St / 2); add(g.Sd / 2, g.St / 2);
        } else if (type === 'tridem') { add(0, -g.St); add(0, 0); add(0, g.St); }
        return w;
    }
    function applyTemplate(tpl) {
        state.name = tpl.name;
        state.ySec = 0;
        state.layers = tpl.layers.map(function (Ld) {
            return layerFromMat(Ld.mat, { h: Ld.h, E: Ld.E, nu: Ld.nu });
        });
        state.interfaces = [];
        for (var i = 0; i < state.layers.length - 1; i++) {
            var d = tpl.interfaces && tpl.interfaces[i];
            state.interfaces.push({ bond: d ? d.bond : 'bonded', k: d && d.k != null ? d.k : 1 });
        }
        state.wheels = gearLayout(tpl.wheels, tpl.gear);
        state.points = [];
        gearParams = { F: tpl.gear.F, p: tpl.gear.p, Sd: tpl.gear.Sd, St: tpl.gear.St };
    }
    var gearParams = { F: 20, p: 700, Sd: 350, St: 1300 };

    /* =================== worker bridge =================== */
    var worker = null, workerReady = false, jobGen = 0, jobsInFlight = 0;
    var solverFallback = null;

    function setEngineBadge(ok, text) {
        var b = $('lp-engine');
        b.className = 'lp-status-badge ' + (ok ? 'is-ok' : 'is-bad');
        b.innerHTML = '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-exclamation-triangle') + '"></i> ' + text;
    }

    function initWorker() {
        try {
            worker = new Worker('worker.js');
            worker.onmessage = onWorkerMessage;
            worker.onerror = function () { workerFailed(); };
            worker.postMessage({ type: 'hello' });
        } catch (e) { workerFailed(); }
    }
    function workerFailed() {
        worker = null; workerReady = false;
        /* main-thread fallback: load solver.js directly */
        if (!solverFallback && !document.getElementById('lp-solver-fallback')) {
            var s = document.createElement('script');
            s.id = 'lp-solver-fallback';
            s.src = 'solver.js';
            s.onload = function () {
                solverFallback = window.LEAPS;
                var st = solverFallback.selfTest();
                setEngineBadge(st.pass, 'LEAF-JS v' + solverFallback.version + ' · main thread · self-check ' + (st.pass ? '✓' : '✗'));
                scheduleRun();
            };
            document.head.appendChild(s);
        }
    }
    var jobCallbacks = {};
    function onWorkerMessage(e) {
        var m = e.data || {};
        if (m.type === 'ready') {
            workerReady = true;
            setEngineBadge(m.selfTest.pass, 'LEAF-JS v' + m.version + ' · self-check ' + (m.selfTest.pass ? '✓ (Boussinesq closed forms)' : '✗ ' + m.selfTest.errors[0]));
            scheduleRun();
            return;
        }
        if (m.type === 'progress') { setProgress(m.kind, m.p); return; }
        if (m.gen !== jobGen) return;      /* stale generation */
        if (m.type === 'done') {
            jobsInFlight--;
            var cb = jobCallbacks[m.id]; delete jobCallbacks[m.id];
            if (cb) cb(null, m.res);
            if (jobsInFlight <= 0) hideProgress();
        } else if (m.type === 'error') {
            jobsInFlight--;
            var cb2 = jobCallbacks[m.id]; delete jobCallbacks[m.id];
            if (cb2) cb2(new Error(m.message));
            if (jobsInFlight <= 0) hideProgress();
            $('lp-stats').textContent = 'Solver error: ' + m.message;
        }
    }
    var jobId = 0;
    function postJob(kind, job, cb) {
        var id = ++jobId;
        if (worker && workerReady) {
            jobCallbacks[id] = cb;
            jobsInFlight++;
            worker.postMessage({ type: 'solve', id: id, kind: kind, gen: jobGen, job: job });
        } else if (solverFallback) {
            setTimeout(function () {
                try { cb(null, solverFallback.solve(job)); }
                catch (err) { cb(err); }
            }, 10);
        }
    }
    function cancelJobs() {
        jobGen++;
        if (jobsInFlight > 0 && worker) {
            worker.terminate();
            jobsInFlight = 0; jobCallbacks = {};
            worker = null; workerReady = false;
            initWorker();
        }
        hideProgress();
    }
    var progressState = {};
    function setProgress(kind, p) {
        progressState[kind] = p;
        var tot = 0, n = 0;
        for (var k in progressState) { tot += progressState[k]; n++; }
        var bar = $('lp-progress');
        bar.hidden = false;
        $('lp-progress-fill').style.width = Math.round(100 * tot / Math.max(n, 1)) + '%';
    }
    function hideProgress() { $('lp-progress').hidden = true; progressState = {}; }

    /* =================== solve orchestration =================== */
    function solverLayers() {
        return state.layers.map(function (L) { return { h: L.h, E: L.E, nu: L.nu }; });
    }
    function solverLoads() {
        return state.wheels.map(function (w) {
            return { x: w.x, y: w.y, p: w.p / 1000, a: wheelA(w) };
        });
    }
    function solverOptions() {
        return { tol: parseFloat(state.settings.tol), maxPanels: 240 };
    }
    function keyStations() {
        var st = [], seen = {};
        function add(x, y, label) {
            var k = Math.round(x) + '|' + Math.round(y);
            if (seen[k]) return;
            seen[k] = 1;
            st.push({ x: x, y: y, label: label });
        }
        state.wheels.forEach(function (w, i) { add(w.x, w.y, 'Wheel ' + (i + 1)); });
        for (var i = 0; i + 1 < state.wheels.length && i < 4; i++) {
            var a = state.wheels[i], b = state.wheels[i + 1];
            add((a.x + b.x) / 2, (a.y + b.y) / 2, 'Between ' + (i + 1) + '–' + (i + 2));
        }
        return st.slice(0, 8);
    }

    function buildMainJob() {
        var pts = [], n = state.layers.length;
        var zb = [], z = 0;
        for (var i = 0; i < n - 1; i++) { z += state.layers[i].h; zb.push(z); }
        var stations = keyStations();

        stations.forEach(function (s, si) {
            pts.push({ x: s.x, y: s.y, z: 0, li: 0, tag: { t: 'kp', si: si, pos: 'surf' } });
            zb.forEach(function (zi, ii) {
                pts.push({ x: s.x, y: s.y, z: zi, li: ii, tag: { t: 'kp', si: si, pos: 'bot', layer: ii } });
                pts.push({ x: s.x, y: s.y, z: zi, li: ii + 1, tag: { t: 'kp', si: si, pos: 'top', layer: ii + 1 } });
            });
        });

        state.points.forEach(function (p, i) {
            pts.push({ x: p.x, y: p.y, z: p.z, tag: { t: 'up', i: i } });
        });

        /* depth profiles at up to 2 stations */
        var profSt = stations.slice(0, Math.min(2, stations.length));
        var box = worldBox();
        profSt.forEach(function (s, si) {
            var zs = profileDepths(zb, box.zMax);
            zs.forEach(function (zp) {
                pts.push({ x: s.x, y: s.y, z: zp.z, li: zp.li, tag: { t: 'pf', si: si, z: zp.z } });
            });
        });

        /* surface basin along the section line */
        var NB = 121;
        for (var b = 0; b < NB; b++) {
            var xb = box.xL + (box.xR - box.xL) * b / (NB - 1);
            pts.push({ x: xb, y: state.ySec, z: 0, li: 0, tag: { t: 'bs', i: b } });
        }

        return {
            job: { layers: solverLayers(), interfaces: state.interfaces, loads: solverLoads(), points: pts, options: solverOptions() },
            stations: profSt, box: box
        };
    }
    function profileDepths(zb, zMax) {
        var list = [{ z: 0, li: 0 }];
        var tops = [0].concat(zb), bots = zb.concat([zMax]);
        for (var i = 0; i < tops.length; i++) {
            var t = tops[i], b = bots[i];
            var m = Math.max(6, Math.round(14 * (b - t) / zMax));
            for (var j = 1; j <= m; j++) list.push({ z: t + (b - t) * j / (m + 1), li: i });
            list.push({ z: b, li: i });                 /* bottom of layer i  */
            if (i < tops.length - 1) list.push({ z: b, li: i + 1 }); /* top of next */
        }
        return list;
    }

    function buildGridJob(box) {
        var rr = state.settings.res.split('x');
        var nx = parseInt(rr[0], 10), nz = parseInt(rr[1], 10);
        var xs = [], zs = [], pts = [];
        for (var i = 0; i < nx; i++) xs.push(box.xL + (box.xR - box.xL) * i / (nx - 1));
        for (var j = 0; j < nz; j++) zs.push(box.zMax * j / (nz - 1));
        for (j = 0; j < nz; j++) {
            for (i = 0; i < nx; i++) pts.push({ x: xs[i], y: state.ySec, z: zs[j] });
        }
        return { job: { layers: solverLayers(), interfaces: state.interfaces, loads: solverLoads(), points: pts, options: solverOptions() }, nx: nx, nz: nz, xs: xs, zs: zs };
    }

    var scheduleRun = debounce(function () { if (state.settings.autorun) run(); }, 350);

    function run() {
        if (!state.wheels.length || !state.layers.length) return;
        if (!workerReady && !solverFallback) return;
        cancelJobs();
        var myGen = jobGen;
        var t0 = performance.now();
        var main = buildMainJob();
        var grid = buildGridJob(main.box);

        postJob('main', main.job, function (err, res) {
            if (err || myGen !== jobGen) return;
            applyMainResults(res, main.stations);
            $('lp-stats').textContent =
                res.stats.nPoints + ' pts · ' + res.stats.systemSolves + ' kernel solves · ' +
                Math.round(res.stats.ms) + ' ms';
        });
        postJob('grid', grid.job, function (err, res) {
            if (err || myGen !== jobGen) return;
            results.grid = { nx: grid.nx, nz: grid.nz, xs: grid.xs, zs: grid.zs, pts: res.points, box: main.box };
            buildContour();
            drawViewport();
            $('lp-stats').textContent += ' · grid ' + grid.nx + '×' + grid.nz + ' in ' + Math.round(res.stats.ms) + ' ms';
            void t0;
        });
    }

    function applyMainResults(res, stations) {
        var key = [], user = [], prof = {}, basin = [];
        res.points.forEach(function (p) {
            var t = p.tag || {};
            if (t.t === 'kp') key.push(p);
            else if (t.t === 'up') user.push(p);
            else if (t.t === 'pf') { (prof[t.si] = prof[t.si] || []).push(p); }
            else if (t.t === 'bs') basin[t.i] = p;
        });
        results.key = key;
        results.user = user;
        results.profiles = { stations: stations, data: prof };
        results.basin = basin;
        results.stats = res.stats;
        renderCards();
        renderLayerTable();
        renderPointsTable();
        renderCharts();
        drawViewport();
    }

    /* =================== key responses =================== */
    function keyExtremes() {
        if (!results.key) return null;
        var n = state.layers.length;
        var out = { w0: null, et: null, ev: null, sigt: null, tau: null };
        results.key.forEach(function (p) {
            var t = p.tag;
            if (t.pos === 'surf') {
                if (!out.w0 || p.disp.uz > out.w0.v) out.w0 = { v: p.disp.uz, p: p };
            }
            if (t.pos === 'bot') {
                var eT = Math.max(p.eps.xx, p.eps.yy);
                var sT = Math.max(p.sig.xx, p.sig.yy);
                var tau = Math.sqrt(p.sig.xz * p.sig.xz + p.sig.yz * p.sig.yz);
                if (t.layer === 0 && n > 1) {
                    if (!out.et || eT > out.et.v) out.et = { v: eT, p: p };
                }
                if (state.layers[t.layer].E >= 8000) {
                    if (!out.sigt || sT > out.sigt.v) out.sigt = { v: sT, p: p, layer: t.layer };
                }
                if (!out.tau || tau > out.tau.v) out.tau = { v: tau, p: p, layer: t.layer };
            }
            if (t.pos === 'top' && t.layer === n - 1 && n > 1) {
                if (!out.ev || p.eps.zz < out.ev.v) out.ev = { v: p.eps.zz, p: p };
            }
        });
        if (results.basin) {
            results.basin.forEach(function (p) {
                if (p && (!out.w0 || p.disp.uz > out.w0.v)) out.w0 = { v: p.disp.uz, p: p };
            });
        }
        return out;
    }

    function renderCards() {
        var host = $('lp-cards');
        host.innerHTML = '';
        var ex = keyExtremes();
        if (!ex) { host.appendChild(el('p', 'lp-hint', 'Run the analysis to see key responses.')); return; }
        function card(label, value, unitStr, sub, accent) {
            var c = el('div', 'lp-card' + (accent ? ' is-accent' : ''));
            c.appendChild(el('div', 'lp-card-label', label));
            c.appendChild(el('div', 'lp-card-value', value + '<small>' + unitStr + '</small>'));
            if (sub) c.appendChild(el('div', 'lp-card-sub', sub));
            host.appendChild(c);
        }
        function at(p) { return '@ x=' + sig(toDisp('len', p.x), 3) + ' ' + unit('len') + ', z=' + sig(toDisp('len', p.z), 3) + ' ' + unit('len'); }
        if (ex.w0) card('Max surface deflection', sig(toDisp('defl', ex.w0.v)), unit('defl'), at(ex.w0.p), true);
        if (ex.et) card('Tensile strain — bottom of ' + state.layers[0].name, sig(toDisp('strain', ex.et.v)), 'µε', at(ex.et.p) + ' · fatigue cracking driver');
        if (ex.ev) card('Compressive strain — top of subgrade', sig(toDisp('strain', -ex.ev.v)), 'µε', at(ex.ev.p) + ' · rutting driver');
        if (ex.sigt) card('Tensile stress — bottom of ' + state.layers[ex.sigt.layer].name, sig(toDisp('stress', ex.sigt.v)), unit('stress'), at(ex.sigt.p));
        if (ex.tau) card('Peak interface shear', sig(toDisp('stress', ex.tau.v)), unit('stress'), 'bottom of ' + state.layers[ex.tau.layer].name + ' ' + at(ex.tau.p));
    }

    function renderLayerTable() {
        var host = $('lp-layer-table');
        host.innerHTML = '';
        if (!results.key) return;
        var n = state.layers.length;
        var rows = [];
        for (var i = 0; i < n; i++) rows.push({ et: null, ev: null, st: null });
        results.key.forEach(function (p) {
            var t = p.tag;
            if (t.pos === 'bot') {
                var r = rows[t.layer];
                var eT = Math.max(p.eps.xx, p.eps.yy);
                var sT = Math.max(p.sig.xx, p.sig.yy);
                if (r.et == null || eT > r.et) r.et = eT;
                if (r.st == null || sT > r.st) r.st = sT;
            }
            if (t.pos === 'top' || t.pos === 'surf') {
                var li = t.pos === 'surf' ? 0 : t.layer;
                var r2 = rows[li];
                if (r2.ev == null || p.eps.zz < r2.ev) r2.ev = p.eps.zz;
            }
        });
        var wrap = el('div', 'lp-table-wrap');
        var tb = el('table', 'lp-table');
        tb.innerHTML = '<thead><tr><th>Layer</th><th>εt bottom (µε)</th><th>σt bottom (' + unit('stress') + ')</th><th>εv top (µε)</th></tr></thead>';
        var body = el('tbody');
        state.layers.forEach(function (L, i) {
            var r = rows[i];
            var tr = el('tr');
            tr.innerHTML = '<td>' + L.name + '</td>' +
                '<td>' + (r.et != null ? sig(toDisp('strain', r.et)) : '—') + '</td>' +
                '<td>' + (r.st != null ? sig(toDisp('stress', r.st)) : '—') + '</td>' +
                '<td>' + (r.ev != null ? sig(toDisp('strain', r.ev)) : '—') + '</td>';
            body.appendChild(tr);
        });
        tb.appendChild(body);
        wrap.appendChild(tb);
        host.appendChild(wrap);
    }

    function renderPointsTable() {
        var host = $('lp-pts-table');
        host.innerHTML = '';
        var data = results.user || [];
        $('lp-table-hint').textContent = data.length
            ? 'Responses at your ' + data.length + ' evaluation point' + (data.length > 1 ? 's' : '') + '. Stresses tension-positive.'
            : 'No evaluation points yet — double-click the section to drop one.';
        if (!data.length) return;
        var tb = el('table', 'lp-table');
        var us = unit('stress'), ul = unit('len');
        tb.innerHTML = '<thead><tr><th>Pt</th><th>x (' + ul + ')</th><th>z (' + ul + ')</th>' +
            '<th>σx (' + us + ')</th><th>σy (' + us + ')</th><th>σz (' + us + ')</th><th>τxz (' + us + ')</th>' +
            '<th>σ1 (' + us + ')</th><th>σ3 (' + us + ')</th><th>εx (µε)</th><th>εz (µε)</th><th>w (' + unit('defl') + ')</th></tr></thead>';
        var body = el('tbody');
        data.forEach(function (p, i) {
            var tr = el('tr');
            tr.innerHTML = '<td>P' + (i + 1) + '</td>' +
                '<td>' + sig(toDisp('len', p.x), 3) + '</td><td>' + sig(toDisp('len', p.z), 3) + '</td>' +
                '<td>' + sig(toDisp('stress', p.sig.xx)) + '</td><td>' + sig(toDisp('stress', p.sig.yy)) + '</td>' +
                '<td>' + sig(toDisp('stress', p.sig.zz)) + '</td><td>' + sig(toDisp('stress', p.sig.xz)) + '</td>' +
                '<td>' + sig(toDisp('stress', p.principal.s1)) + '</td><td>' + sig(toDisp('stress', p.principal.s3)) + '</td>' +
                '<td>' + sig(toDisp('strain', p.eps.xx)) + '</td><td>' + sig(toDisp('strain', p.eps.zz)) + '</td>' +
                '<td>' + sig(toDisp('defl', p.disp.uz)) + '</td>';
            body.appendChild(tr);
        });
        tb.appendChild(body);
        host.appendChild(tb);
    }

    /* =================== charts (Plotly) =================== */
    function chartColors() {
        return [cssVar('--lp-cat1'), cssVar('--lp-cat2'), cssVar('--lp-cat3'), cssVar('--lp-cat4')];
    }
    function chartLayout(xTitle, yTitle) {
        var ink2 = cssVar('--lp-ink2'), line = cssVar('--lp-line-soft');
        return {
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: ink2, size: 11, family: 'Source Sans Pro, sans-serif' },
            margin: { l: 54, r: 12, t: 8, b: 42 },
            xaxis: { title: { text: xTitle }, gridcolor: line, zerolinecolor: cssVar('--lp-line') },
            yaxis: { title: { text: yTitle }, gridcolor: line, zerolinecolor: cssVar('--lp-line'), autorange: 'reversed' },
            showlegend: true,
            legend: { orientation: 'h', y: -0.18 },
            hovermode: 'closest'
        };
    }
    function renderCharts() {
        if (typeof Plotly === 'undefined') { setTimeout(renderCharts, 600); return; }
        renderProfileChart();
        renderBasinChart();
    }
    function renderProfileChart() {
        var host = $('lp-chart-profile');
        if (!results.profiles) { Plotly.purge(host); return; }
        var f = fieldById($('lp-prof-field').value || 'szz');
        var colors = chartColors();
        var traces = [];
        var zbs = [], zacc = 0;
        for (var i = 0; i < state.layers.length - 1; i++) { zacc += state.layers[i].h; zbs.push(zacc); }
        results.profiles.stations.forEach(function (s, si) {
            var data = (results.profiles.data[si] || []).slice();
            data.sort(function (a, b) { return a.z - b.z || a.li - b.li; });
            traces.push({
                x: data.map(function (p) { return toDisp(f.q, f.get(p)); }),
                y: data.map(function (p) { return toDisp('len', p.z); }),
                name: s.label, mode: 'lines',
                line: { color: colors[si % colors.length], width: 2 },
                hovertemplate: '%{x:.4g} ' + unit(f.q) + ' @ z=%{y:.4g} ' + unit('len') + '<extra>' + s.label + '</extra>'
            });
        });
        var lay = chartLayout(f.label + ' (' + unit(f.q) + ')', 'depth z (' + unit('len') + ')');
        lay.shapes = zbs.map(function (zb) {
            return {
                type: 'line', xref: 'paper', x0: 0, x1: 1,
                y0: toDisp('len', zb), y1: toDisp('len', zb),
                line: { color: cssVar('--lp-line'), width: 1, dash: 'dot' }
            };
        });
        Plotly.react(host, traces, lay, { displayModeBar: false, responsive: true });
    }
    function renderBasinChart() {
        var host = $('lp-chart-basin');
        if (!results.basin || !results.basin.length) { Plotly.purge(host); return; }
        var colors = chartColors();
        var xs = results.basin.map(function (p) { return toDisp('len', p.x); });
        var ws = results.basin.map(function (p) { return toDisp('defl', p.disp.uz); });
        var lay = chartLayout('x (' + unit('len') + ')', 'w (' + unit('defl') + ')');
        lay.showlegend = false;
        Plotly.react(host, [{
            x: xs, y: ws, mode: 'lines', fill: 'tozeroy',
            line: { color: colors[0], width: 2 },
            fillcolor: 'rgba(13,148,136,0.12)',
            hovertemplate: 'w = %{y:.4g} ' + unit('defl') + ' @ x=%{x:.4g}<extra></extra>'
        }], lay, { displayModeBar: false, responsive: true });
    }

    /* =================== contour build =================== */
    var contour = null; /* {canvas, vmin, vmax, lut, field, levels: [{v, segs}]} */

    function buildContour() {
        contour = null;
        var g = results.grid;
        if (!g) return;
        var f = fieldById(state.settings.field);
        var nx = g.nx, nz = g.nz;
        var vals = new Float64Array(nx * nz);
        var finite = [];
        for (var i = 0; i < nx * nz; i++) {
            var v = f.get(g.pts[i]);
            vals[i] = v;
            if (isFinite(v)) finite.push(v);
        }
        finite.sort(function (a, b) { return a - b; });
        var vmin, vmax, lut;
        if (f.div) {
            var m = Math.max(Math.abs(quantile(finite, 0.01)), Math.abs(quantile(finite, 0.99))) || 1;
            vmin = -m; vmax = m; lut = LUT_DIV;
        } else {
            vmin = quantile(finite, 0.01); vmax = quantile(finite, 0.99);
            if (vmax - vmin < 1e-30) vmax = vmin + 1;
            lut = LUT_SEQ;
        }
        var cnv = document.createElement('canvas');
        cnv.width = nx; cnv.height = nz;
        var ictx = cnv.getContext('2d');
        var img = ictx.createImageData(nx, nz);
        for (var j = 0; j < nz; j++) {
            for (i = 0; i < nx; i++) {
                var idx = j * nx + i, v2 = vals[idx];
                var o = idx * 4;
                if (!isFinite(v2)) { img.data[o + 3] = 0; continue; }
                var t = clamp((v2 - vmin) / (vmax - vmin), 0, 1);
                var li = Math.round(t * 255) * 3;
                img.data[o] = lut[li]; img.data[o + 1] = lut[li + 1]; img.data[o + 2] = lut[li + 2];
                /* fade quiet regions so the material shows through and
                 * the stress bulbs carry the visual weight */
                var wgt = f.div ? Math.abs(t - 0.5) * 2 : t;
                img.data[o + 3] = Math.round(255 * (0.08 + 0.92 * Math.pow(wgt, 0.6)));
            }
        }
        ictx.putImageData(img, 0, 0);

        /* marching squares iso-lines */
        var NLEV = 9, levels = [];
        for (var L = 1; L < NLEV; L++) {
            var lv = vmin + (vmax - vmin) * L / NLEV;
            levels.push({ v: lv, segs: marchingSquares(vals, nx, nz, g.xs, g.zs, lv) });
        }
        contour = { canvas: cnv, vmin: vmin, vmax: vmax, lut: lut, field: f, levels: levels, vals: vals };
        drawColorbar();
    }

    function marchingSquares(vals, nx, nz, xs, zs, level) {
        var segs = [];
        function interp(x1, z1, v1, x2, z2, v2) {
            var t = (level - v1) / (v2 - v1);
            return [x1 + (x2 - x1) * t, z1 + (z2 - z1) * t];
        }
        for (var j = 0; j < nz - 1; j++) {
            for (var i = 0; i < nx - 1; i++) {
                var v00 = vals[j * nx + i], v10 = vals[j * nx + i + 1];
                var v01 = vals[(j + 1) * nx + i], v11 = vals[(j + 1) * nx + i + 1];
                if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) continue;
                var c = 0;
                if (v00 > level) c |= 1;
                if (v10 > level) c |= 2;
                if (v11 > level) c |= 4;
                if (v01 > level) c |= 8;
                if (c === 0 || c === 15) continue;
                var x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
                var pts = [];
                if ((c & 1) !== ((c >> 1) & 1)) pts.push(interp(x0, z0, v00, x1, z0, v10));
                if (((c >> 1) & 1) !== ((c >> 2) & 1)) pts.push(interp(x1, z0, v10, x1, z1, v11));
                if (((c >> 3) & 1) !== ((c >> 2) & 1)) pts.push(interp(x0, z1, v01, x1, z1, v11));
                if ((c & 1) !== ((c >> 3) & 1)) pts.push(interp(x0, z0, v00, x0, z1, v01));
                for (var s = 0; s + 1 < pts.length; s += 2) segs.push([pts[s], pts[s + 1]]);
            }
        }
        return segs;
    }

    function sampleContour(x, z) {
        var g = results.grid;
        if (!g || !contour) return null;
        var fx = (x - g.xs[0]) / (g.xs[g.nx - 1] - g.xs[0]) * (g.nx - 1);
        var fz = (z - g.zs[0]) / (g.zs[g.nz - 1] - g.zs[0]) * (g.nz - 1);
        if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) return null;
        var i = clamp(Math.floor(fx), 0, g.nx - 2), j = clamp(Math.floor(fz), 0, g.nz - 2);
        var tx = fx - i, tz = fz - j, n = g.nx;
        var v = contour.vals;
        return (v[j * n + i] * (1 - tx) + v[j * n + i + 1] * tx) * (1 - tz) +
            (v[(j + 1) * n + i] * (1 - tx) + v[(j + 1) * n + i + 1] * tx) * tz;
    }

    /* =================== viewport =================== */
    var cv = null, ctx = null, vpW = 0, vpH = 0, dpr = 1;
    var texCache = {};

    function texture(mat) {
        var key = mat.tex + '|' + mat.color;
        if (texCache[key]) return texCache[key];
        var c = document.createElement('canvas');
        c.width = c.height = 56;
        var g = c.getContext('2d');
        var rnd = mulberry32(1234567);
        g.fillStyle = mat.color;
        g.fillRect(0, 0, 56, 56);
        function shade(hexColor, f) {
            var r = hex2rgb(hexColor);
            return 'rgba(' + clamp(r[0] * f, 0, 255) + ',' + clamp(r[1] * f, 0, 255) + ',' + clamp(r[2] * f, 0, 255) + ',';
        }
        var i, x, y, r;
        if (mat.tex === 'asphalt') {
            for (i = 0; i < 90; i++) {
                x = rnd() * 56; y = rnd() * 56; r = 0.5 + rnd() * 1.6;
                g.fillStyle = shade(mat.color, rnd() < 0.5 ? 0.55 : 1.8) + (0.25 + rnd() * 0.3) + ')';
                g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
            }
        } else if (mat.tex === 'concrete') {
            for (i = 0; i < 26; i++) {
                x = rnd() * 56; y = rnd() * 56; r = 1.5 + rnd() * 3.4;
                g.fillStyle = shade(mat.color, 0.72 + rnd() * 0.2) + '0.5)';
                g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3.1, 0, 6.3); g.fill();
            }
            for (i = 0; i < 40; i++) {
                g.fillStyle = shade(mat.color, rnd() < 0.5 ? 0.8 : 1.15) + '0.4)';
                g.fillRect(rnd() * 56, rnd() * 56, 1, 1);
            }
        } else if (mat.tex === 'granular') {
            for (i = 0; i < 34; i++) {
                x = rnd() * 56; y = rnd() * 56; r = 1.4 + rnd() * 2.8;
                g.fillStyle = shade(mat.color, 0.75 + rnd() * 0.5) + '0.85)';
                g.strokeStyle = shade(mat.color, 0.55) + '0.6)';
                g.lineWidth = 0.7;
                g.beginPath(); g.ellipse(x, y, r, r * 0.75, rnd() * 3.1, 0, 6.3); g.fill(); g.stroke();
            }
        } else if (mat.tex === 'stabilized') {
            g.strokeStyle = shade(mat.color, 0.7) + '0.35)';
            g.lineWidth = 1;
            for (i = -56; i < 112; i += 9) {
                g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 56, 56); g.stroke();
            }
        } else if (mat.tex === 'rock') {
            g.strokeStyle = shade(mat.color, 0.6) + '0.4)';
            g.lineWidth = 1;
            for (i = -56; i < 112; i += 12) {
                g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 56, 56); g.stroke();
                g.beginPath(); g.moveTo(i + 56, 0); g.lineTo(i, 56); g.stroke();
            }
        } else { /* soil */
            for (i = 0; i < 46; i++) {
                x = rnd() * 56; y = rnd() * 56;
                g.fillStyle = shade(mat.color, 0.6 + rnd() * 0.7) + '0.5)';
                if (rnd() < 0.6) g.fillRect(x, y, 2 + rnd() * 3, 1);
                else { g.beginPath(); g.arc(x, y, 0.9, 0, 6.3); g.fill(); }
            }
        }
        var pat = ctx.createPattern(c, 'repeat');
        texCache[key] = pat;
        return pat;
    }

    function w2sx(x) { return view.ox + x * view.scale; }
    function w2sy(z) { return view.oy + z * view.scale; }
    function s2wx(px) { return (px - view.ox) / view.scale; }
    function s2wy(py) { return (py - view.oy) / view.scale; }

    function fitView() {
        var box = worldBox();
        var headroom = 0.22 * box.zMax;
        var wW = box.xR - box.xL, wH = box.zMax + headroom;
        var s = Math.min(vpW / wW, vpH / wH) * 0.92;
        view.scale = s;
        view.ox = vpW / 2;
        view.oy = (vpH - wH * s) / 2 + headroom * s;
        drawViewport();
    }

    function drawViewport() {
        if (!ctx) return;
        var box = worldBox();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vpW, vpH);
        var ink = cssVar('--lp-ink'), ink2 = cssVar('--lp-ink2'), ink3 = cssVar('--lp-ink3');
        var lineC = cssVar('--lp-line'), accent = cssVar('--lp-accent');

        var xL = w2sx(box.xL), xR = w2sx(box.xR), y0 = w2sy(0);
        var n = state.layers.length;

        /* layers */
        var z = 0;
        for (var i = 0; i < n; i++) {
            var L = state.layers[i];
            var zTop = z;
            var zBot = i < n - 1 ? z + L.h : box.zMax;
            z = zBot;
            var yT = w2sy(zTop), yB = w2sy(zBot);
            ctx.fillStyle = L.color;
            ctx.fillRect(xL, yT, xR - xL, yB - yT);
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = texture(L);
            ctx.fillRect(xL, yT, xR - xL, yB - yT);
            ctx.globalAlpha = 1;
        }

        /* subgrade fade to void */
        var fadeTop = w2sy(box.zMax - 0.18 * box.zMax);
        var grd = ctx.createLinearGradient(0, fadeTop, 0, w2sy(box.zMax));
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, cssVar('--lp-bg0'));
        ctx.fillStyle = grd;
        ctx.fillRect(xL, fadeTop, xR - xL, w2sy(box.zMax) - fadeTop);

        /* contour overlay */
        if (contour && state.settings.showContour && results.grid) {
            var g = results.grid;
            var ix0 = w2sx(g.xs[0]), ix1 = w2sx(g.xs[g.nx - 1]);
            var iz0 = w2sy(g.zs[0]), iz1 = w2sy(g.zs[g.nz - 1]);
            ctx.globalAlpha = state.settings.alpha;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(contour.canvas, ix0, iz0, ix1 - ix0, iz1 - iz0);
            ctx.globalAlpha = Math.min(0.5, state.settings.alpha);
            ctx.strokeStyle = 'rgba(10,14,22,0.55)';
            ctx.lineWidth = 0.75;
            ctx.beginPath();
            contour.levels.forEach(function (lv) {
                lv.segs.forEach(function (s) {
                    ctx.moveTo(w2sx(s[0][0]), w2sy(s[0][1]));
                    ctx.lineTo(w2sx(s[1][0]), w2sy(s[1][1]));
                });
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        /* interfaces + labels */
        z = 0;
        ctx.font = '600 12px "Source Sans Pro", sans-serif';
        for (i = 0; i < n; i++) {
            var L2 = state.layers[i];
            var zTop2 = z;
            var zBot2 = i < n - 1 ? z + L2.h : box.zMax;
            z = zBot2;
            var yT2 = w2sy(zTop2), yB2 = w2sy(zBot2);
            if (i > 0) {
                var itf = state.interfaces[i - 1];
                ctx.strokeStyle = lineC;
                ctx.lineWidth = 1;
                if (itf.bond === 'unbonded') ctx.setLineDash([6, 5]);
                else if (itf.bond === 'spring') ctx.setLineDash([2, 3]);
                else ctx.setLineDash([]);
                ctx.beginPath(); ctx.moveTo(xL, yT2); ctx.lineTo(xR, yT2); ctx.stroke();
                ctx.setLineDash([]);
            }
            /* label */
            if (yB2 - yT2 > 17) {
                var midY = (yT2 + Math.min(yB2, vpH)) / 2;
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                var lbl = L2.name;
                var meta = (i < n - 1 ? sig(toDisp('len', L2.h), 3) + ' ' + unit('len') + ' · ' : '∞ · ') +
                    'E=' + sig(toDisp('modulus', L2.E), 3) + ' ' + unit('modulus') + ' · ν=' + L2.nu;
                var tw = Math.max(ctx.measureText(lbl).width, ctx.measureText(meta).width);
                ctx.fillRect(xL + 8, midY - 15, tw + 14, 32);
                ctx.fillStyle = '#f2f5fa';
                ctx.fillText(lbl, xL + 15, midY - 2);
                ctx.fillStyle = 'rgba(242,245,250,0.75)';
                ctx.font = '11px ' + cssVar('--lp-mono');
                ctx.fillText(meta, xL + 15, midY + 12);
                ctx.font = '600 12px "Source Sans Pro", sans-serif';
            }
        }

        /* surface line */
        ctx.strokeStyle = ink2;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xL, y0); ctx.lineTo(xR, y0); ctx.stroke();

        /* deflected surface */
        if (state.settings.showBasin && results.basin && results.basin.length) {
            var wMax = 0;
            results.basin.forEach(function (p) { if (p) wMax = Math.max(wMax, Math.abs(p.disp.uz)); });
            if (wMax > 1e-9) {
                var ex = 0.11 * box.zMax / wMax;
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.6;
                ctx.setLineDash([1, 0]);
                ctx.beginPath();
                var started = false;
                results.basin.forEach(function (p) {
                    if (!p) return;
                    var sx = w2sx(p.x), sy = w2sy(p.disp.uz * ex);
                    if (!started) { ctx.moveTo(sx, sy); started = true; }
                    else ctx.lineTo(sx, sy);
                });
                ctx.stroke();
                ctx.fillStyle = ink3;
                ctx.font = '10px ' + cssVar('--lp-mono');
                ctx.fillText('deflected surface ×' + sig(ex, 2), xR - 190, y0 - 8);
            }
        }

        /* loads */
        state.wheels.forEach(function (w, wi) {
            var a = wheelA(w);
            var cx = w2sx(w.x);
            var halfW = a * view.scale;
            var tireH = Math.min(46, Math.max(22, halfW * 0.8));
            var gap = 12;
            /* pressure arrows */
            ctx.strokeStyle = cssVar('--lp-danger');
            ctx.fillStyle = cssVar('--lp-danger');
            ctx.lineWidth = 1.2;
            var nA = Math.max(3, Math.min(9, Math.round(halfW / 9)));
            for (var k2 = 0; k2 < nA; k2++) {
                var ax = cx - halfW + 2 * halfW * (k2 + 0.5) / nA;
                ctx.beginPath(); ctx.moveTo(ax, y0 - gap); ctx.lineTo(ax, y0 - 2); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(ax, y0); ctx.lineTo(ax - 2.6, y0 - 5); ctx.lineTo(ax + 2.6, y0 - 5);
                ctx.closePath(); ctx.fill();
            }
            /* tire */
            var ty = y0 - gap - tireH;
            ctx.fillStyle = '#1d2126';
            roundRect(ctx, cx - halfW, ty, 2 * halfW, tireH, Math.min(8, halfW * 0.3));
            ctx.fill();
            ctx.fillStyle = '#3c4450';
            roundRect(ctx, cx - halfW * 0.45, ty + tireH * 0.22, halfW * 0.9, tireH * 0.56, 3);
            ctx.fill();
            /* label */
            ctx.fillStyle = ink2;
            ctx.font = '11px ' + cssVar('--lp-mono');
            var loadLbl = sig(toDisp('force', w.F), 3) + ' ' + unit('force') + ' · ' + sig(toDisp('stress', w.p / 1000), 4) + ' ' + unit('stress');
            ctx.textAlign = 'center';
            ctx.fillText('W' + (wi + 1) + ' · ' + loadLbl, cx, ty - 6);
            ctx.textAlign = 'left';
        });

        /* depth rail */
        ctx.strokeStyle = lineC;
        ctx.fillStyle = ink3;
        ctx.font = '10px ' + cssVar('--lp-mono');
        ctx.lineWidth = 1;
        var railX = xL - 6;
        z = 0;
        for (i = 0; i < n; i++) {
            var yTick = w2sy(z);
            ctx.beginPath(); ctx.moveTo(railX - 5, yTick); ctx.lineTo(railX, yTick); ctx.stroke();
            ctx.textAlign = 'right';
            ctx.fillText(sig(toDisp('len', z), 4), railX - 8, yTick + 3);
            if (i < n - 1) z += state.layers[i].h; else break;
        }
        ctx.textAlign = 'left';

        /* evaluation points */
        state.points.forEach(function (p, pi) {
            var sx = w2sx(p.x), sy = w2sy(p.z);
            var isSel = selPoint === p.id;
            ctx.strokeStyle = isSel ? accent : cssVar('--lp-cat3');
            ctx.lineWidth = isSel ? 2 : 1.4;
            ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 6.3); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(sx - 8, sy); ctx.lineTo(sx - 3, sy);
            ctx.moveTo(sx + 3, sy); ctx.lineTo(sx + 8, sy);
            ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy - 3);
            ctx.moveTo(sx, sy + 3); ctx.lineTo(sx, sy + 8);
            ctx.stroke();
            ctx.fillStyle = ink2;
            ctx.font = '10px ' + cssVar('--lp-mono');
            ctx.fillText('P' + (pi + 1), sx + 9, sy - 7);
        });

        /* infinity marker */
        ctx.fillStyle = ink3;
        ctx.font = '14px "Source Sans Pro", sans-serif';
        ctx.fillText('z → ∞', xL + 10, w2sy(box.zMax) - 10);

        drawPlan();
        drawColorbar();
        void ink;
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    /* ---------- plan inset ---------- */
    function drawPlan() {
        var pc = $('lp-plan');
        if (!pc || pc.style.display === 'none') return;
        var g = pc.getContext('2d');
        var W = pc.width, H = pc.height;
        g.clearRect(0, 0, W, H);
        var pad = 14;
        var xs = [], ys = [];
        state.wheels.forEach(function (w) {
            var a = wheelA(w);
            xs.push(w.x - a, w.x + a); ys.push(w.y - a, w.y + a);
        });
        xs.push(-300, 300); ys.push(-300, 300, state.ySec);
        var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
        var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
        var s = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (ymax - ymin));
        function px(x) { return pad + (x - xmin) * s + ((W - 2 * pad) - (xmax - xmin) * s) / 2; }
        function py(y) { return pad + (y - ymin) * s + ((H - 2 * pad) - (ymax - ymin) * s) / 2; }
        pc._px = px; pc._py = py; pc._s = s; pc._ymin = ymin; pc._ymax = ymax;

        g.fillStyle = cssVar('--lp-ink3');
        g.font = '9px ' + cssVar('--lp-mono');
        g.fillText('PLAN', 8, 12);
        /* wheels */
        state.wheels.forEach(function (w) {
            var a = wheelA(w);
            g.fillStyle = 'rgba(224,82,82,0.4)';
            g.strokeStyle = cssVar('--lp-danger');
            g.lineWidth = 1;
            g.beginPath(); g.arc(px(w.x), py(w.y), Math.max(2.5, a * s), 0, 6.3); g.fill(); g.stroke();
        });
        /* section line */
        g.strokeStyle = cssVar('--lp-accent');
        g.lineWidth = 1.4;
        g.setLineDash([5, 3]);
        g.beginPath(); g.moveTo(4, py(state.ySec)); g.lineTo(W - 4, py(state.ySec)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = cssVar('--lp-accent');
        g.fillText('y = ' + sig(toDisp('len', state.ySec), 3), W - 74, py(state.ySec) - 4);
        /* points */
        g.fillStyle = cssVar('--lp-cat3');
        state.points.forEach(function (p) {
            g.beginPath(); g.arc(px(p.x), py(p.y), 2.2, 0, 6.3); g.fill();
        });
    }

    /* ---------- colorbar ---------- */
    function drawColorbar() {
        var cb = $('lp-colorbar');
        if (!cb) return;
        var g = cb.getContext('2d');
        g.clearRect(0, 0, cb.width, cb.height);
        if (!contour || !state.settings.showContour) return;
        var f = contour.field;
        var x0 = 8, w = 13, y0 = 24, h = cb.height - 46;
        for (var i = 0; i < h; i++) {
            var t = 1 - i / (h - 1);
            var li = Math.round(t * 255) * 3;
            g.fillStyle = 'rgb(' + contour.lut[li] + ',' + contour.lut[li + 1] + ',' + contour.lut[li + 2] + ')';
            g.fillRect(x0, y0 + i, w, 1.5);
        }
        g.strokeStyle = cssVar('--lp-line');
        g.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
        g.fillStyle = cssVar('--lp-ink2');
        g.font = '9px ' + cssVar('--lp-mono');
        g.fillText(f.id, x0, 12);
        var us = unit(f.q);
        g.fillText(sig(toDisp(f.q, contour.vmax), 3), x0 + w + 4, y0 + 8);
        g.fillText(sig(toDisp(f.q, (contour.vmax + contour.vmin) / 2), 3), x0 + w + 4, y0 + h / 2 + 3);
        g.fillText(sig(toDisp(f.q, contour.vmin), 3), x0 + w + 4, y0 + h - 2);
        g.fillText(us, x0, y0 + h + 14);
    }

    /* =================== viewport interaction =================== */
    function setupViewport() {
        cv = $('lp-cv');
        ctx = cv.getContext('2d');
        var vp = $('lp-viewport');

        function resize() {
            dpr = window.devicePixelRatio || 1;
            var r = vp.getBoundingClientRect();
            vpW = r.width; vpH = r.height;
            cv.width = Math.round(vpW * dpr);
            cv.height = Math.round(vpH * dpr);
            fitView();
        }
        new ResizeObserver(debounce(resize, 120)).observe(vp);
        resize();

        var drag = null;
        cv.addEventListener('mousedown', function (e) {
            var mx = e.offsetX, my = e.offsetY;
            /* near a point? */
            var hit = null;
            state.points.forEach(function (p) {
                var dx = w2sx(p.x) - mx, dy = w2sy(p.z) - my;
                if (Math.hypot(dx, dy) < 10) hit = p;
            });
            if (hit) {
                selPoint = hit.id;
                drag = { type: 'point', p: hit, moved: false };
            } else {
                selPoint = null;
                drag = { type: 'pan', sx: mx, sy: my, ox: view.ox, oy: view.oy };
            }
            drawViewport();
        });
        window.addEventListener('mousemove', function (e) {
            if (!drag) return;
            var r = cv.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            if (drag.type === 'pan') {
                view.ox = drag.ox + (mx - drag.sx);
                view.oy = drag.oy + (my - drag.sy);
                drawViewport();
            } else if (drag.type === 'point') {
                drag.moved = true;
                drag.p.x = s2wx(mx);
                drag.p.z = Math.max(0, s2wy(my));
                snapPoint(drag.p);
                drawViewport();
            }
        });
        window.addEventListener('mouseup', function () {
            if (drag && drag.type === 'point' && drag.moved) {
                mutate(function () { }, {});      /* commit move */
                renderPanels();
            }
            drag = null;
        });
        cv.addEventListener('dblclick', function (e) {
            var x = s2wx(e.offsetX), z = Math.max(0, s2wy(e.offsetY));
            var p = { id: nid(), x: x, y: state.ySec, z: z };
            snapPoint(p);
            mutate(function (st) { st.points.push(p); }, {});
            selPoint = p.id;
        });
        cv.addEventListener('wheel', function (e) {
            e.preventDefault();
            var f = Math.exp(-e.deltaY * 0.0012);
            var mx = e.offsetX, my = e.offsetY;
            var wx = s2wx(mx), wz = s2wy(my);
            view.scale = clamp(view.scale * f, 0.02, 40);
            view.ox = mx - wx * view.scale;
            view.oy = my - wz * view.scale;
            drawViewport();
        }, { passive: false });

        cv.addEventListener('mousemove', function (e) {
            var x = s2wx(e.offsetX), z = s2wy(e.offsetY);
            var hov = $('lp-hover');
            var box = worldBox();
            if (x < box.xL || x > box.xR || z < -0.3 * box.zMax || z > box.zMax) { hov.hidden = true; $('lp-coords').textContent = ''; return; }
            var lines = 'x ' + sig(toDisp('len', x), 4) + ' ' + unit('len') +
                '\nz ' + sig(toDisp('len', Math.max(0, z)), 4) + ' ' + unit('len');
            if (z >= 0) {
                var li = 0, zz = 0;
                for (var i = 0; i < state.layers.length - 1; i++) { zz += state.layers[i].h; if (z >= zz) li = i + 1; }
                lines += '\n' + state.layers[li].name;
                var v = state.settings.showContour ? sampleContour(x, z) : null;
                if (v != null && contour) {
                    lines += '\n' + contour.field.id + ' ' + sig(toDisp(contour.field.q, v), 4) + ' ' + unit(contour.field.q);
                }
            }
            hov.textContent = lines;
            hov.hidden = false;
            var hx = e.offsetX + 16, hy = e.offsetY + 16;
            if (hx > vpW - 170) hx = e.offsetX - 170;
            if (hy > vpH - 90) hy = e.offsetY - 90;
            hov.style.left = hx + 'px';
            hov.style.top = hy + 'px';
            $('lp-coords').textContent = 'x=' + sig(toDisp('len', x), 4) + ' · z=' + sig(toDisp('len', Math.max(0, z)), 4) + ' ' + unit('len');
        });
        cv.addEventListener('mouseleave', function () { $('lp-hover').hidden = true; });

        /* plan inset: drag section line */
        var pc = $('lp-plan');
        var planDrag = false;
        pc.addEventListener('mousedown', function () { planDrag = true; });
        window.addEventListener('mousemove', function (e) {
            if (!planDrag || !pc._py) return;
            var r = pc.getBoundingClientRect();
            var my = clamp(e.clientY - r.top, 8, pc.height - 8);
            /* invert py roughly by linear scan */
            var yw = pc._ymin + (my - pc._py(pc._ymin)) / pc._s;
            state.ySec = Math.round(yw);
            drawPlan();
        });
        window.addEventListener('mouseup', function () {
            if (planDrag) {
                planDrag = false;
                mutate(function () { }, {});
            }
        });

        /* toolbar */
        $('lp-fit').addEventListener('click', fitView);
        $('lp-zin').addEventListener('click', function () { view.scale *= 1.3; drawViewport(); });
        $('lp-zout').addEventListener('click', function () { view.scale /= 1.3; drawViewport(); });
        $('lp-show-basin').addEventListener('change', function (e) {
            state.settings.showBasin = e.target.checked; drawViewport(); saveLocal();
        });
        $('lp-show-contour').addEventListener('change', function (e) {
            state.settings.showContour = e.target.checked; drawViewport(); saveLocal();
        });
        $('lp-alpha').addEventListener('input', function (e) {
            state.settings.alpha = parseFloat(e.target.value); drawViewport();
        });
        $('lp-field').addEventListener('change', function (e) {
            state.settings.field = e.target.value;
            buildContour();
            drawViewport();
            saveLocal();
        });
    }

    function snapPoint(p) {
        var tolW = 9 / view.scale;
        var z = 0;
        if (Math.abs(p.z) < tolW) p.z = 0;
        for (var i = 0; i < state.layers.length - 1; i++) {
            z += state.layers[i].h;
            if (Math.abs(p.z - z) < tolW) p.z = z;
        }
        state.wheels.forEach(function (w) {
            if (Math.abs(p.x - w.x) < tolW) p.x = w.x;
        });
        p.x = Math.round(p.x * 10) / 10;
        p.z = Math.round(p.z * 10) / 10;
    }

    /* =================== panels =================== */
    function numField(labelText, value, step, onchange, titleText) {
        var f = el('label', 'lp-field');
        f.appendChild(el('span', null, labelText));
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.step = step || 'any';
        inp.value = value;
        if (titleText) inp.title = titleText;
        inp.addEventListener('change', function () {
            var v = parseFloat(inp.value);
            if (isFinite(v)) onchange(v);
        });
        f.appendChild(inp);
        return f;
    }

    function renderPanels() {
        renderLayers();
        renderInterfaces();
        renderWheels();
        renderPointsList();
        renderGearParams();
        $('lp-project-name').value = state.name;
        $('lp-layer-count').textContent = state.layers.length;
        $('lp-load-count').textContent = state.wheels.length;
        $('lp-point-count').textContent = state.points.length || '';
    }

    var expandedLayer = null;
    function renderLayers() {
        var host = $('lp-layers');
        host.innerHTML = '';
        var n = state.layers.length;
        state.layers.forEach(function (L, i) {
            var isLast = i === n - 1;
            var card = el('div', 'lp-layer');
            card.draggable = !isLast;
            var head = el('div', 'lp-layer-head');
            head.appendChild(el('span', 'lp-layer-grip', isLast ? '' : '<i class="fas fa-grip-vertical"></i>'));
            var chip = el('span', 'lp-layer-chip');
            chip.style.background = L.color;
            head.appendChild(chip);
            head.appendChild(el('span', 'lp-layer-name', L.name));
            if (isLast) head.appendChild(el('span', 'lp-subgrade-tag', 'halfspace'));
            else head.appendChild(el('span', 'lp-layer-meta', sig(toDisp('len', L.h), 3) + unit('len')));
            card.appendChild(head);

            if (expandedLayer === L.id) {
                var body = el('div', 'lp-layer-body');
                var msel = el('label', 'lp-field');
                msel.appendChild(el('span', null, 'Material'));
                var sel = el('select', 'lp-select');
                var groups = {};
                MATERIALS.forEach(function (m) {
                    if (!groups[m.group]) {
                        groups[m.group] = el('optgroup');
                        groups[m.group].label = m.group;
                        sel.appendChild(groups[m.group]);
                    }
                    var o = el('option', null, m.name);
                    o.value = m.id;
                    if (m.id === L.mat) o.selected = true;
                    groups[m.group].appendChild(o);
                });
                sel.addEventListener('change', function () {
                    mutate(function () {
                        var m = matById(sel.value);
                        L.mat = m.id; L.name = m.name; L.E = m.E; L.nu = m.nu;
                        L.color = m.color; L.tex = m.tex;
                    });
                });
                msel.appendChild(sel);
                body.appendChild(msel);

                var grid = el('div', 'lp-layer-grid');
                if (!isLast) {
                    grid.appendChild(numField('h (' + unit('len') + ')', sig(toDisp('len', L.h), 5), 'any', function (v) {
                        mutate(function () { L.h = Math.max(1, fromDisp('len', v)); });
                    }));
                }
                var m0 = matById(L.mat);
                grid.appendChild(numField('E (' + unit('modulus') + ')', sig(toDisp('modulus', L.E), 5), 'any', function (v) {
                    mutate(function () { L.E = Math.max(0.1, fromDisp('modulus', v)); });
                }, 'Typical range: ' + sig(toDisp('modulus', m0.range[0]), 3) + '–' + sig(toDisp('modulus', m0.range[1]), 3) + ' ' + unit('modulus') + ' (FAA/AASHTO/Huang)'));
                grid.appendChild(numField('ν (—)', L.nu, '0.01', function (v) {
                    mutate(function () { L.nu = clamp(v, 0.05, 0.499); });
                }));
                var nameF = el('label', 'lp-field');
                nameF.appendChild(el('span', null, 'Name'));
                var ninp = document.createElement('input');
                ninp.type = 'text'; ninp.className = 'lp-input'; ninp.value = L.name;
                ninp.addEventListener('change', function () { mutate(function () { L.name = ninp.value || L.name; }); });
                nameF.appendChild(ninp);
                grid.appendChild(nameF);
                body.appendChild(grid);

                var acts = el('div', 'lp-layer-actions');
                function act(icon, title, fn, disabled) {
                    var b = el('button', 'lp-tool', '<i class="fas ' + icon + '"></i>');
                    b.title = title;
                    b.disabled = !!disabled;
                    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
                    acts.appendChild(b);
                }
                act('fa-arrow-up', 'Move up', function () {
                    mutate(function (st) { if (i > 0) { st.layers.splice(i, 1); st.layers.splice(i - 1, 0, L); } });
                }, i === 0 || isLast);
                act('fa-arrow-down', 'Move down', function () {
                    mutate(function (st) { if (i < n - 2) { st.layers.splice(i, 1); st.layers.splice(i + 1, 0, L); } });
                }, i >= n - 2);
                act('fa-clone', 'Duplicate', function () {
                    mutate(function (st) {
                        var c = JSON.parse(JSON.stringify(L)); c.id = nid();
                        st.layers.splice(i + 1, 0, c);
                    });
                }, isLast);
                act('fa-trash', 'Delete layer', function () {
                    mutate(function (st) { st.layers.splice(i, 1); });
                }, n <= 1 || isLast);
                body.appendChild(acts);
                card.appendChild(body);
            }

            head.addEventListener('click', function () {
                expandedLayer = expandedLayer === L.id ? null : L.id;
                renderLayers();
            });

            /* drag & drop reorder */
            card.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', String(i));
            });
            card.addEventListener('dragover', function (e) {
                if (isLast) return;
                e.preventDefault();
                card.classList.add('is-dragover');
            });
            card.addEventListener('dragleave', function () { card.classList.remove('is-dragover'); });
            card.addEventListener('drop', function (e) {
                e.preventDefault();
                card.classList.remove('is-dragover');
                var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (!isFinite(from) || from === i || isLast) return;
                mutate(function (st) {
                    var moved = st.layers.splice(from, 1)[0];
                    st.layers.splice(i, 0, moved);
                });
            });

            host.appendChild(card);
        });
    }

    function renderInterfaces() {
        var host = $('lp-interfaces');
        host.innerHTML = '';
        if (state.layers.length < 2) {
            host.appendChild(el('p', 'lp-hint', 'Add a second layer to define interface bonding.'));
            return;
        }
        state.interfaces.forEach(function (itf, i) {
            var row = el('div', 'lp-itf');
            row.appendChild(el('span', 'lp-itf-label', (i + 1) + '·' + (i + 2)));
            var sel = el('select', 'lp-select');
            [['bonded', 'Fully bonded'], ['unbonded', 'Frictionless'], ['spring', 'Shear spring']].forEach(function (o) {
                var op = el('option', null, o[1]);
                op.value = o[0];
                if (itf.bond === o[0]) op.selected = true;
                sel.appendChild(op);
            });
            sel.addEventListener('change', function () {
                mutate(function () { itf.bond = sel.value; });
            });
            row.appendChild(sel);
            if (itf.bond === 'spring') {
                var kin = document.createElement('input');
                kin.type = 'number'; kin.step = 'any';
                kin.value = sig(toDisp('kitf', itf.k), 4);
                kin.title = 'Interface shear stiffness k (' + unit('kitf') + '). Large → bonded, small → frictionless.';
                kin.addEventListener('change', function () {
                    var v = parseFloat(kin.value);
                    if (isFinite(v) && v > 0) mutate(function () { itf.k = fromDisp('kitf', v); });
                });
                row.appendChild(kin);
            }
            host.appendChild(row);
        });
    }

    function renderGearParams() {
        var host = $('lp-gear-params');
        host.innerHTML = '';
        host.appendChild(numField('Wheel load (' + unit('force') + ')', sig(toDisp('force', gearParams.F), 4), 'any', function (v) {
            gearParams.F = fromDisp('force', v);
        }));
        host.appendChild(numField('Pressure (' + unit('stress') + ')', sig(toDisp('stress', gearParams.p / 1000), 4), 'any', function (v) {
            gearParams.p = fromDisp('stress', v) * 1000;
        }));
        host.appendChild(numField('Dual spacing (' + unit('len') + ')', sig(toDisp('len', gearParams.Sd), 4), 'any', function (v) {
            gearParams.Sd = fromDisp('len', v);
        }));
        host.appendChild(numField('Tandem spacing (' + unit('len') + ')', sig(toDisp('len', gearParams.St), 4), 'any', function (v) {
            gearParams.St = fromDisp('len', v);
        }));
    }

    function renderWheels() {
        var host = $('lp-wheels');
        host.innerHTML = '';
        state.wheels.forEach(function (w, i) {
            var card = el('div', 'lp-wheel');
            var head = el('div', 'lp-wheel-head');
            head.appendChild(el('span', 'lp-wheel-title', 'Wheel ' + (i + 1)));
            head.appendChild(el('span', 'lp-wheel-a', 'a = ' + sig(toDisp('len', wheelA(w)), 3) + ' ' + unit('len')));
            var db = el('button', 'lp-tool', '<i class="fas fa-trash"></i>');
            db.title = 'Remove wheel';
            db.style.fontSize = '0.7em';
            db.addEventListener('click', function () {
                mutate(function (st) { st.wheels.splice(i, 1); });
            });
            head.appendChild(db);
            card.appendChild(head);
            var grid = el('div', 'lp-wheel-grid');
            grid.appendChild(numField('x (' + unit('len') + ')', sig(toDisp('len', w.x), 5), 'any', function (v) {
                mutate(function () { w.x = fromDisp('len', v); });
            }));
            grid.appendChild(numField('y (' + unit('len') + ')', sig(toDisp('len', w.y), 5), 'any', function (v) {
                mutate(function () { w.y = fromDisp('len', v); });
            }));
            grid.appendChild(numField('F (' + unit('force') + ')', sig(toDisp('force', w.F), 4), 'any', function (v) {
                mutate(function () { w.F = Math.max(0.01, fromDisp('force', v)); });
            }));
            grid.appendChild(numField('p (' + unit('stress') + ')', sig(toDisp('stress', w.p / 1000), 4), 'any', function (v) {
                mutate(function () { w.p = Math.max(1, fromDisp('stress', v) * 1000); });
            }));
            card.appendChild(grid);
            host.appendChild(card);
        });
    }

    function renderPointsList() {
        var host = $('lp-points');
        host.innerHTML = '';
        state.points.forEach(function (p, i) {
            var row = el('div', 'lp-point');
            row.appendChild(el('span', 'lp-point-dot'));
            row.appendChild(el('span', 'lp-grow',
                'P' + (i + 1) + ' · x=' + sig(toDisp('len', p.x), 4) + ' y=' + sig(toDisp('len', p.y), 4) + ' z=' + sig(toDisp('len', p.z), 4)));
            var db = el('button', 'lp-tool', '<i class="fas fa-times"></i>');
            db.addEventListener('click', function () {
                mutate(function (st) { st.points.splice(i, 1); });
            });
            row.appendChild(db);
            host.appendChild(row);
        });
    }

    /* =================== exports =================== */
    function csvEscape(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

    function exportPointsCSV() {
        var rows = [['pt', 'x_mm', 'y_mm', 'z_mm', 'layer',
            'sxx_MPa', 'syy_MPa', 'szz_MPa', 'txy_MPa', 'txz_MPa', 'tyz_MPa',
            's1_MPa', 's2_MPa', 's3_MPa', 'vonMises_MPa', 'tauMax_MPa',
            'exx_ue', 'eyy_ue', 'ezz_ue', 'ux_mm', 'uy_mm', 'uz_mm'].join(',')];
        (results.user || []).forEach(function (p, i) {
            rows.push(['P' + (i + 1), p.x, p.y, p.z, csvEscape(state.layers[p.li].name),
                p.sig.xx, p.sig.yy, p.sig.zz, p.sig.xy, p.sig.xz, p.sig.yz,
                p.principal.s1, p.principal.s2, p.principal.s3, p.vm, p.tauMax,
                p.eps.xx * 1e6, p.eps.yy * 1e6, p.eps.zz * 1e6,
                p.disp.ux, p.disp.uy, p.disp.uz].join(','));
        });
        (results.key || []).forEach(function (p) {
            var t = p.tag;
            var name = t.pos === 'surf' ? 'surface' : (t.pos + ' L' + (t.layer + 1));
            rows.push([csvEscape('key:' + name), p.x, p.y, p.z, csvEscape(state.layers[p.li].name),
                p.sig.xx, p.sig.yy, p.sig.zz, p.sig.xy, p.sig.xz, p.sig.yz,
                p.principal.s1, p.principal.s2, p.principal.s3, p.vm, p.tauMax,
                p.eps.xx * 1e6, p.eps.yy * 1e6, p.eps.zz * 1e6,
                p.disp.ux, p.disp.uy, p.disp.uz].join(','));
        });
        download(safeName() + '_points.csv', rows.join('\n'), 'text/csv');
    }
    function exportGridCSV() {
        if (!results.grid) return;
        var g = results.grid;
        var rows = [['x_mm', 'z_mm', 'sxx_MPa', 'syy_MPa', 'szz_MPa', 'txz_MPa', 's1_MPa', 's3_MPa', 'vonMises_MPa', 'exx_ue', 'ezz_ue', 'uz_mm'].join(',')];
        g.pts.forEach(function (p) {
            rows.push([p.x, p.z, p.sig.xx, p.sig.yy, p.sig.zz, p.sig.xz,
                p.principal.s1, p.principal.s3, p.vm,
                p.eps.xx * 1e6, p.eps.zz * 1e6, p.disp.uz].join(','));
        });
        download(safeName() + '_grid.csv', rows.join('\n'), 'text/csv');
    }
    function safeName() {
        return (state.name || 'leaps').replace(/[^\w\-]+/g, '_').slice(0, 60);
    }
    function exportJSON() {
        download(safeName() + '.leaps.json', JSON.stringify(serialize(), null, 2), 'application/json');
    }
    function exportPNG() {
        var a = document.createElement('a');
        a.href = cv.toDataURL('image/png');
        a.download = safeName() + '_section.png';
        a.click();
    }
    function exportReport() {
        var ex = keyExtremes();
        var w = window.open('', '_blank');
        if (!w) return;
        var us = unit('stress'), ul = unit('len'), um = unit('modulus');
        var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LEAPS report — ' + state.name + '</title>' +
            '<style>body{font:13px/1.6 "Segoe UI",sans-serif;color:#1a2436;max-width:900px;margin:2em auto;padding:0 1.5em}' +
            'h1{font-size:1.5em;border-bottom:2px solid #0d9488;padding-bottom:0.3em}h2{font-size:1.1em;margin-top:1.6em;color:#0d9488}' +
            'table{border-collapse:collapse;width:100%;font-size:0.92em}th,td{border:1px solid #cfd8e3;padding:0.35em 0.6em;text-align:right}' +
            'th{background:#f0f4f8}td:first-child,th:first-child{text-align:left}img{max-width:100%;border:1px solid #cfd8e3;border-radius:6px}' +
            'p.meta{color:#5a6b84}</style></head><body>';
        h += '<h1>LEAPS — ' + state.name + '</h1>';
        h += '<p class="meta">Linear Elastic Analysis of Pavement Structures · multilayer elastic theory (LEAF-JS v1.0) · generated ' + new Date().toLocaleString() + '</p>';
        h += '<h2>1. Pavement structure</h2><table><tr><th>#</th><th>Layer</th><th>h (' + ul + ')</th><th>E (' + um + ')</th><th>ν</th><th>Interface below</th></tr>';
        state.layers.forEach(function (L, i) {
            var itf = i < state.layers.length - 1 ? state.interfaces[i] : null;
            h += '<tr><td>' + (i + 1) + '</td><td>' + L.name + '</td><td>' +
                (i < state.layers.length - 1 ? sig(toDisp('len', L.h), 4) : '∞') + '</td><td>' +
                sig(toDisp('modulus', L.E), 4) + '</td><td>' + L.nu + '</td><td>' +
                (itf ? (itf.bond === 'spring' ? 'spring k=' + sig(toDisp('kitf', itf.k), 3) + ' ' + unit('kitf') : itf.bond) : '—') + '</td></tr>';
        });
        h += '</table>';
        h += '<h2>2. Loading</h2><table><tr><th>Wheel</th><th>x (' + ul + ')</th><th>y (' + ul + ')</th><th>F (' + unit('force') + ')</th><th>p (' + us + ')</th><th>a (' + ul + ')</th></tr>';
        state.wheels.forEach(function (wl, i) {
            h += '<tr><td>W' + (i + 1) + '</td><td>' + sig(toDisp('len', wl.x), 4) + '</td><td>' + sig(toDisp('len', wl.y), 4) +
                '</td><td>' + sig(toDisp('force', wl.F), 4) + '</td><td>' + sig(toDisp('stress', wl.p / 1000), 4) +
                '</td><td>' + sig(toDisp('len', wheelA(wl)), 4) + '</td></tr>';
        });
        h += '</table>';
        if (ex) {
            h += '<h2>3. Key responses</h2><table><tr><th>Response</th><th>Value</th><th>Location</th></tr>';
            function row(lbl, val, p) {
                h += '<tr><td>' + lbl + '</td><td>' + val + '</td><td>x=' + sig(toDisp('len', p.x), 3) + ' ' + ul + ', z=' + sig(toDisp('len', p.z), 3) + ' ' + ul + '</td></tr>';
            }
            if (ex.w0) row('Max surface deflection', sig(toDisp('defl', ex.w0.v)) + ' ' + unit('defl'), ex.w0.p);
            if (ex.et) row('Tensile strain, bottom of ' + state.layers[0].name, sig(toDisp('strain', ex.et.v)) + ' µε', ex.et.p);
            if (ex.ev) row('Compressive strain, top of subgrade', sig(toDisp('strain', -ex.ev.v)) + ' µε', ex.ev.p);
            if (ex.sigt) row('Tensile stress, bottom of ' + state.layers[ex.sigt.layer].name, sig(toDisp('stress', ex.sigt.v)) + ' ' + us, ex.sigt.p);
            h += '</table>';
        }
        h += '<h2>4. Cross-section</h2><img src="' + cv.toDataURL('image/png') + '" alt="section" />';
        if (results.user && results.user.length) {
            h += '<h2>5. Evaluation points</h2><table><tr><th>Pt</th><th>x</th><th>z</th><th>σx (' + us + ')</th><th>σz (' + us + ')</th><th>σ1</th><th>σ3</th><th>εx (µε)</th><th>εz (µε)</th><th>w (' + unit('defl') + ')</th></tr>';
            results.user.forEach(function (p, i) {
                h += '<tr><td>P' + (i + 1) + '</td><td>' + sig(toDisp('len', p.x), 3) + '</td><td>' + sig(toDisp('len', p.z), 3) + '</td><td>' +
                    sig(toDisp('stress', p.sig.xx)) + '</td><td>' + sig(toDisp('stress', p.sig.zz)) + '</td><td>' +
                    sig(toDisp('stress', p.principal.s1)) + '</td><td>' + sig(toDisp('stress', p.principal.s3)) + '</td><td>' +
                    sig(toDisp('strain', p.eps.xx)) + '</td><td>' + sig(toDisp('strain', p.eps.zz)) + '</td><td>' +
                    sig(toDisp('defl', p.disp.uz)) + '</td></tr>';
            });
            h += '</table>';
        }
        h += '<p class="meta">Assumptions: linear elastic, isotropic, homogeneous layers on an infinite halfspace; uniform circular contact pressure; ' +
            'tension-positive stresses; z downward. Engine validated against Boussinesq closed forms, multilayer reduction, interface limits, ' +
            'vertical equilibrium and Burmister two-layer factors (69-check regression suite).</p>';
        h += '</body></html>';
        w.document.write(h);
        w.document.close();
    }

    /* =================== toolbar wiring =================== */
    function setupToolbar() {
        var tsel = $('lp-template');
        TEMPLATES.forEach(function (t) {
            var o = el('option', null, t.name);
            o.value = t.id;
            tsel.appendChild(o);
        });
        tsel.addEventListener('change', function () {
            var tpl = TEMPLATES.filter(function (t) { return t.id === tsel.value; })[0];
            if (tpl) {
                mutate(function () { applyTemplate(tpl); });
                fitView();
            }
            tsel.selectedIndex = 0;
        });

        $('lp-project-name').addEventListener('change', function (e) {
            mutate(function (st) { st.name = e.target.value || 'Untitled analysis'; }, { keepResults: true });
        });
        $('lp-undo').addEventListener('click', undo);
        $('lp-redo').addEventListener('click', redo);
        $('lp-run').addEventListener('click', run);
        $('lp-autorun').addEventListener('change', function (e) {
            state.settings.autorun = e.target.checked; saveLocal();
        });
        $('lp-units').addEventListener('change', function (e) {
            state.settings.units = e.target.value;
            renderPanels();
            renderCards();
            renderLayerTable();
            renderPointsTable();
            renderCharts();
            drawViewport();
            saveLocal();
        });
        $('lp-tol').addEventListener('change', function (e) {
            state.settings.tol = e.target.value; scheduleRun(); saveLocal();
        });
        $('lp-res').addEventListener('change', function (e) {
            state.settings.res = e.target.value; scheduleRun(); saveLocal();
        });

        $('lp-save').addEventListener('click', exportJSON);
        $('lp-open').addEventListener('click', function () { $('lp-file').click(); });
        $('lp-file').addEventListener('change', function (e) {
            var f = e.target.files[0];
            if (!f) return;
            var rd = new FileReader();
            rd.onload = function () {
                try {
                    deserialize(JSON.parse(rd.result));
                    pushHistory();
                    renderAll();
                    fitView();
                    scheduleRun();
                } catch (err) { alert('Could not open file: ' + err.message); }
            };
            rd.readAsText(f);
            e.target.value = '';
        });

        /* structure buttons */
        $('lp-add-layer').addEventListener('click', function () {
            mutate(function (st) {
                st.layers.splice(Math.max(0, st.layers.length - 1), 0, layerFromMat('base', { h: 150 }));
            });
        });
        $('lp-gear-apply').addEventListener('click', function () {
            var type = $('lp-gear').value;
            mutate(function (st) { st.wheels = gearLayout(type, gearParams); });
            fitView();
        });
        $('lp-add-wheel').addEventListener('click', function () {
            mutate(function (st) {
                var x = st.wheels.length ? Math.max.apply(null, st.wheels.map(function (w) { return w.x; })) + gearParams.Sd : 0;
                st.wheels.push({ id: nid(), x: x, y: 0, F: gearParams.F, p: gearParams.p });
            });
        });
        $('lp-pts-critical').addEventListener('click', function () {
            mutate(function (st) {
                if (!st.wheels.length) return;
                var w = st.wheels[0];
                var z = 0;
                st.points.push({ id: nid(), x: w.x, y: w.y, z: 0 });
                for (var i = 0; i < st.layers.length - 1; i++) {
                    z += st.layers[i].h;
                    st.points.push({ id: nid(), x: w.x, y: w.y, z: z });
                }
            });
        });
        $('lp-pts-clear').addEventListener('click', function () {
            mutate(function (st) { st.points = []; });
        });

        /* fields */
        var fsel = $('lp-field'), psel = $('lp-prof-field');
        FIELDS.forEach(function (f) {
            var o1 = el('option', null, f.label); o1.value = f.id;
            var o2 = el('option', null, f.label); o2.value = f.id;
            fsel.appendChild(o1); psel.appendChild(o2);
        });
        fsel.value = state.settings.field;
        psel.value = 'szz';
        psel.addEventListener('change', renderProfileChart);

        /* tabs */
        var tabs = document.querySelectorAll('.lp-tab');
        tabs.forEach(function (t) {
            t.addEventListener('click', function () {
                tabs.forEach(function (x) { x.classList.remove('is-active'); });
                t.classList.add('is-active');
                document.querySelectorAll('.lp-pane').forEach(function (p) {
                    p.classList.toggle('is-active', p.getAttribute('data-pane') === t.getAttribute('data-tab'));
                });
                if (t.getAttribute('data-tab') === 'profiles') renderCharts();
            });
        });

        /* exports */
        $('lp-exp-csv').addEventListener('click', exportPointsCSV);
        $('lp-exp-grid').addEventListener('click', exportGridCSV);
        $('lp-exp-json').addEventListener('click', exportJSON);
        $('lp-exp-png').addEventListener('click', exportPNG);
        $('lp-exp-report').addEventListener('click', exportReport);

        /* keyboard */
        window.addEventListener('keydown', function (e) {
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
            else if (e.key === 'f' || e.key === 'F') fitView();
            else if (e.key === 'r' || e.key === 'R') run();
            else if (e.key === 'Delete' && selPoint != null) {
                mutate(function (st) {
                    st.points = st.points.filter(function (p) { return p.id !== selPoint; });
                });
                selPoint = null;
            }
        });

        /* theme changes → repaint */
        new MutationObserver(function () {
            texCache = {};
            drawViewport();
            renderCharts();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    function renderAll() {
        renderPanels();
        renderCards();
        renderLayerTable();
        renderPointsTable();
        $('lp-units').value = state.settings.units;
        $('lp-tol').value = state.settings.tol;
        $('lp-res').value = state.settings.res;
        $('lp-autorun').checked = state.settings.autorun;
        $('lp-show-basin').checked = state.settings.showBasin;
        $('lp-show-contour').checked = state.settings.showContour;
        $('lp-alpha').value = state.settings.alpha;
        $('lp-field').value = state.settings.field;
        drawViewport();
    }

    /* =================== boot =================== */
    function boot() {
        setupViewport();
        setupToolbar();

        var restored = false;
        try {
            var saved = localStorage.getItem('leaps-autosave');
            if (saved) { deserialize(JSON.parse(saved)); restored = true; }
        } catch (e) { /* corrupted autosave */ }
        if (!restored) applyTemplate(TEMPLATES[0]);

        history = [snapshot()];
        updateHistoryButtons();
        renderAll();
        fitView();
        initWorker();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
