/* =====================================================================
 * LEAPS: Linear Elastic Analysis of Pavement Structures
 * Application shell: model panels, CAD-style section viewport,
 * results studio, exports. The numerical engine lives in solver.js
 * and runs inside a Web Worker (worker.js).
 *
 * Internal units: mm, N, MPa (= N/mm^2). The UI converts per selected
 * unit system, and the system is chosen ONCE on first run: a pavement
 * analysis in the wrong units is not wrong by a factor you would notice
 * in a plot, so the choice is made before anything is typed.
 *
 * The whole app is ONE `initLeaps(root)` closure that returns a disposer,
 * so it can be mounted inside another framework's tree without the two
 * fighting over the DOM. Nothing is read from `document` outside `root`
 * except the theme attribute and the window-level listeners, all of which
 * the disposer removes.
 *
 * Three things are injected rather than assumed, which is what lets the
 * same file serve a standalone page and a bundled island:
 *   opts.plotly      the Plotly namespace   (default: window.Plotly)
 *   opts.makeWorker  a Worker factory       (default: new Worker('worker.js'))
 *   opts.katex       the KaTeX namespace    (default: window.katex)
 * ===================================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LeapsApp = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* =====================================================================
     * NOTATION
     * ---------------------------------------------------------------------
     * Every symbol the app prints, in one table, because a symbol that is
     * spelled two ways is read as two quantities. A pavement engineer reads
     * sigma-sub-z, not the three characters "s z z", and a table of
     * twenty-four rows is where that matters most: the row labels ARE the
     * notation, and flat text turns tau-sub-xz into something that looks
     * like a variable named txz.
     *
     * Three renderings, one source:
     *   symHtml  markup, for the DOM and for Plotly, which understands
     *            <sub> and <sup> in every title and annotation it draws
     *   symText  flat, for a <select> option (which cannot carry markup)
     *            and for a CSV column, which must open in a spreadsheet
     *   drawSym  canvas, which has no typesetter at all and needs the
     *            baseline arithmetic done by hand
     * ===================================================================== */
    var SYM = {
        x: { b: 'x' }, y: { b: 'y' }, z: { b: 'z' }, w: { b: 'w' },
        a: { b: 'a' }, p: { b: 'p' }, q: { b: 'q' }, F: { b: 'F' }, A: { b: 'A' },
        E: { b: 'E' }, nu: { b: 'ν' }, h: { b: 'h' }, k: { b: 'k' }, s: { b: 's' },
        G: { b: 'G' },

        sxx: { b: 'σ', sub: 'x' }, syy: { b: 'σ', sub: 'y' }, szz: { b: 'σ', sub: 'z' },
        sxz: { b: 'τ', sub: 'xz' }, syz: { b: 'τ', sub: 'yz' }, sxy: { b: 'τ', sub: 'xy' },
        exx: { b: 'ε', sub: 'x' }, eyy: { b: 'ε', sub: 'y' }, ezz: { b: 'ε', sub: 'z' },
        gxz: { b: 'γ', sub: 'xz' }, gyz: { b: 'γ', sub: 'yz' }, gxy: { b: 'γ', sub: 'xy' },
        ux: { b: 'u', sub: 'x' }, uy: { b: 'u', sub: 'y' }, uz: { b: 'u', sub: 'z' },
        s1: { b: 'σ', sub: '1' }, s2: { b: 'σ', sub: '2' }, s3: { b: 'σ', sub: '3' },
        e1: { b: 'ε', sub: '1' }, e2: { b: 'ε', sub: '2' }, e3: { b: 'ε', sub: '3' },

        vm: { b: 'σ', sub: 'vm' }, tmax: { b: 'τ', sub: 'max' },
        et: { b: 'ε', sub: 't' }, ev: { b: 'ε', sub: 'v' }, st: { b: 'σ', sub: 't' },
        tau: { b: 'τ' }, Nf: { b: 'N', sub: 'f' }, Nr: { b: 'N', sub: 'r' }
    };
    function symOf(id) { return SYM[id] || { b: String(id) }; }
    function symHtml(id) {
        var s = symOf(id);
        return s.b + (s.sub ? '<sub>' + s.sub + '</sub>' : '') + (s.sup ? '<sup>' + s.sup + '</sup>' : '');
    }
    function symText(id) {
        var s = symOf(id);
        return s.b + (s.sub || '') + (s.sup ? '^' + s.sup : '');
    }

    /* =====================================================================
     * EQUATIONS
     * ---------------------------------------------------------------------
     * The few real formulas the app shows go through KaTeX. It is already
     * on both hosts (the course site loads it on every page; the E-Lab page
     * pulls the same build from the same CDN), it is a deferred script, and
     * it can fail: `throwOnError: false` does NOT throw, it renders the
     * source in red and returns normally, so success is checked by looking
     * for `.katex-error` rather than by catching. Every entry carries a
     * plain-text twin that stands in until the library lands and stays
     * forever if it never does, because an equation a student cannot read
     * is worse than an ugly one.
     *
     * Backslashes are doubled here because this is a JavaScript string
     * literal: `\frac` written once is a form feed and the equation
     * silently loses its numerator. The port's test asserts every run of
     * backslashes inside an EQ entry is even, which is the only thing that
     * catches it.
     * ===================================================================== */
    var EQ = {
        area: {
            tex: 'A = \\pi a^{2} = \\dfrac{F}{p}',
            plain: 'A = pi a^2 = F / p'
        },
        radius: {
            tex: 'a = \\sqrt{\\dfrac{F}{\\pi p}}',
            plain: 'a = sqrt(F / (pi p))'
        },
        spring: {
            tex: 'k(s) = \\dfrac{G_{\\text{lower}}}{a}\\cdot\\dfrac{1-s}{s}',
            plain: 'k(s) = (G_lower / a) (1 - s) / s'
        },
        fatigue: {
            tex: 'N_f = 0.0796\\,\\varepsilon_t^{-3.291}\\,E^{-0.854}',
            plain: 'Nf = 0.0796 eps_t^-3.291 E^-0.854'
        },
        rutting: {
            tex: 'N_r = 1.365\\times10^{-9}\\,\\varepsilon_v^{-4.477}',
            plain: 'Nr = 1.365e-9 eps_v^-4.477'
        }
    };

    /* =================== unit systems =================== */
    /* Engine units are mm, N, MPa. `k` multiplies engine -> display.
     * US is WinJULEA's own column set: inches, pounds, psi, including a
     * modulus in psi rather than ksi and a displacement in inches rather
     * than mils, so a result can be read straight across from the other
     * program without a mental conversion. */
    var UNITS = {
        SI: {
            name: 'SI', label: 'SI (mm, N, MPa)',
            len: { k: 1, u: 'mm' }, stress: { k: 1, u: 'MPa' }, modulus: { k: 1, u: 'MPa' },
            force: { k: 1, u: 'N' }, defl: { k: 1, u: 'mm' }, strain: { k: 1e6, u: 'µε' },
            kitf: { k: 1, u: 'MPa/mm' }, perlen: { k: 1, u: 'N/mm' },
            area: { k: 1, u: 'mm²' }
        },
        US: {
            name: 'US', label: 'English (in, lb, psi)',
            len: { k: 1 / 25.4, u: 'in' }, stress: { k: 145.0377377, u: 'psi' },
            modulus: { k: 145.0377377, u: 'psi' },
            force: { k: 0.2248089431, u: 'lb' }, defl: { k: 1 / 25.4, u: 'in' },
            strain: { k: 1e6, u: 'µε' },
            kitf: { k: 3683.958538, u: 'psi/in' }, perlen: { k: 5.710147155, u: 'lb/in' },
            area: { k: 1 / 645.16, u: 'in²' }
        }
    };

    /* =================== material database =================== */
    /* Typical values compiled from FAA AC 150/5320-6, AASHTO MEPDG,
     * Huang (2004). E in MPa, editable everywhere. */
    var MATERIALS = [
        { id: 'ac-dense', name: 'Dense-graded HMA', group: 'Asphalt', E: 3000, range: [1500, 6000], nu: 0.35, color: '#33363d', tex: 'asphalt' },
        { id: 'ac-sma', name: 'SMA surface', group: 'Asphalt', E: 3800, range: [2000, 6500], nu: 0.35, color: '#282b31', tex: 'asphalt' },
        { id: 'ac-p401', name: 'FAA P-401 HMA', group: 'Asphalt', E: 1379, range: [1000, 3500], nu: 0.35, color: '#3a3d44', tex: 'asphalt' },
        { id: 'atb', name: 'Asphalt-treated base', group: 'Asphalt', E: 1800, range: [800, 3000], nu: 0.35, color: '#46484e', tex: 'asphalt' },
        { id: 'pcc', name: 'PCC paving concrete', group: 'Concrete', E: 27600, range: [20700, 41400], nu: 0.15, color: '#b9bdc4', tex: 'concrete' },
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

    /* =================== templates =================== */
    /* Loads are given as total force in N and contact pressure in MPa, the
     * pair WinJULEA takes and the pair that survives a change of load
     * idealization unchanged. */
    var TEMPLATES = [
        {
            id: 'aashto-flex', name: 'Highway flexible (AASHTO)',
            layers: [
                { mat: 'ac-dense', h: 100 }, { mat: 'base', h: 200 },
                { mat: 'subbase', h: 300 }, { mat: 'sg-silt', h: 0 }
            ],
            gear: 'dual', params: { F: 20000, p: 0.7, Sd: 350, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'faa-flex', name: 'Airfield flexible (FAA B737 duals)',
            layers: [
                { mat: 'ac-p401', h: 127 }, { mat: 'p209', h: 305 },
                { mat: 'p154', h: 305 }, { mat: 'sg-silt', h: 0, E: 83 }
            ],
            gear: 'dual', params: { F: 185000, p: 1.413, Sd: 864, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'rigid', name: 'Rigid PCC on unbonded CTB',
            layers: [
                { mat: 'pcc', h: 300 }, { mat: 'ctb', h: 150 }, { mat: 'sg-silt', h: 0, E: 80 }
            ],
            slips: [1, 0],
            gear: 'dual', params: { F: 20000, p: 0.7, Sd: 350, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'composite', name: 'Composite AC over PCC',
            layers: [
                { mat: 'ac-dense', h: 100 }, { mat: 'pcc', h: 250 },
                { mat: 'base', h: 150 }, { mat: 'sg-sand', h: 0 }
            ],
            gear: 'dual', params: { F: 20000, p: 0.7, Sd: 350, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'perpetual', name: 'Perpetual deep asphalt',
            layers: [
                { mat: 'ac-sma', h: 50 }, { mat: 'ac-dense', h: 150 },
                { mat: 'atb', h: 100 }, { mat: 'base', h: 150 }, { mat: 'sg-silt', h: 0 }
            ],
            gear: 'dual', params: { F: 22000, p: 0.75, Sd: 350, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'halfspace', name: 'Halfspace (Boussinesq check)',
            layers: [{ mat: 'sg-sand', h: 0, E: 100, nu: 0.35 }],
            gear: 'single', params: { F: 49480, p: 0.7, Sd: 350, St: 350, L: 300, theta: 90 }
        },
        {
            id: 'saintvenant', name: 'Saint-Venant comparison',
            layers: [{ mat: 'base', h: 300, E: 300 }, { mat: 'sg-silt', h: 0, E: 60 }],
            gear: 'single', params: { F: 20000, p: 0.7, Sd: 350, St: 350, L: 400, theta: 90 },
            points: 'axis'
        }
    ];

    /* =================== load idealizations =================== */
    /* The switch a student actually reasons with. All three carry the same
     * TOTAL force, so changing the model changes only how that force is
     * spread, which is the whole comparison. */
    var LOAD_KINDS = [
        {
            id: 'circle', name: 'Circular imprint', short: 'Circle', icon: 'fa-circle-dot',
            blurb: 'Uniform pressure over a circular contact area. The standard idealization, and the one to use against another layered-elastic program.'
        },
        {
            id: 'point', name: 'Point load', short: 'Point', icon: 'fa-location-dot',
            blurb: 'A concentrated force (Boussinesq). Singular at the load itself, and accurate below about two contact radii.'
        },
        {
            id: 'line', name: 'Line load', short: 'Line', icon: 'fa-grip-lines',
            blurb: 'Force spread along a straight segment: a knife edge, a roller drum, a wall footing. Singular on the line at the surface.'
        }
    ];
    function kindById(id) {
        for (var i = 0; i < LOAD_KINDS.length; i++) if (LOAD_KINDS[i].id === id) return LOAD_KINDS[i];
        return LOAD_KINDS[0];
    }

    /* =================== response fields =================== */
    var FIELDS = [
        { id: 'szz', sym: 'szz', name: 'vertical stress', q: 'stress', div: true, get: function (p) { return p.sig.zz; } },
        { id: 'sxx', sym: 'sxx', name: 'horizontal stress', q: 'stress', div: true, get: function (p) { return p.sig.xx; } },
        { id: 'syy', sym: 'syy', name: 'transverse stress', q: 'stress', div: true, get: function (p) { return p.sig.yy; } },
        { id: 'sxz', sym: 'sxz', name: 'shear stress', q: 'stress', div: true, get: function (p) { return p.sig.xz; } },
        { id: 's1', sym: 's1', name: 'major principal', q: 'stress', div: true, get: function (p) { return p.principal.s1; } },
        { id: 's3', sym: 's3', name: 'minor principal', q: 'stress', div: true, get: function (p) { return p.principal.s3; } },
        { id: 'vm', sym: 'vm', name: 'von Mises', q: 'stress', div: false, get: function (p) { return p.vm; } },
        { id: 'tmax', sym: 'tmax', name: 'maximum shear', q: 'stress', div: false, get: function (p) { return p.tauMax; } },
        { id: 'exx', sym: 'exx', name: 'horizontal strain', q: 'strain', div: true, get: function (p) { return p.eps.xx; } },
        { id: 'ezz', sym: 'ezz', name: 'vertical strain', q: 'strain', div: true, get: function (p) { return p.eps.zz; } },
        { id: 'uz', sym: 'w', name: 'deflection', q: 'defl', div: false, get: function (p) { return p.disp.uz; } }
    ];
    function fieldById(id) {
        for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].id === id) return FIELDS[i];
        return FIELDS[0];
    }
    function fieldText(f) { return symText(f.sym) + ' ' + f.name; }

    /* =================== the results table =================== *
     * One row per quantity, one COLUMN per evaluation point: the shape a
     * layered-elastic program prints, and the shape a comparison is read
     * in, with two programs' P3 side by side rather than two screens apart.
     * The order is WinJULEA's own, so a row here is the same row there. */
    var RESULT_GROUPS = [
        { id: 'loc', name: 'Location', icon: 'fa-location-crosshairs' },
        { id: 'sig', name: 'Stresses', icon: 'fa-weight-hanging' },
        { id: 'eps', name: 'Strains', icon: 'fa-arrows-left-right-to-line' },
        { id: 'disp', name: 'Displacements', icon: 'fa-arrows-down-to-line' },
        { id: 'psig', name: 'Principal stresses', icon: 'fa-vector-square' },
        { id: 'peps', name: 'Principal strains', icon: 'fa-ruler-combined' }
    ];
    var RESULT_ROWS = [
        { g: 'loc', key: 'x', sym: 'x', q: 'len', get: function (p) { return p.x; } },
        { g: 'loc', key: 'y', sym: 'y', q: 'len', get: function (p) { return p.y; } },
        { g: 'loc', key: 'z', sym: 'z', q: 'len', get: function (p) { return p.z; } },

        { g: 'sig', key: 'sxx', sym: 'sxx', q: 'stress', get: function (p) { return p.sig.xx; } },
        { g: 'sig', key: 'syy', sym: 'syy', q: 'stress', get: function (p) { return p.sig.yy; } },
        { g: 'sig', key: 'szz', sym: 'szz', q: 'stress', get: function (p) { return p.sig.zz; } },
        { g: 'sig', key: 'sxz', sym: 'sxz', q: 'stress', get: function (p) { return p.sig.xz; } },
        { g: 'sig', key: 'syz', sym: 'syz', q: 'stress', get: function (p) { return p.sig.yz; } },
        { g: 'sig', key: 'sxy', sym: 'sxy', q: 'stress', get: function (p) { return p.sig.xy; } },

        { g: 'eps', key: 'exx', sym: 'exx', q: 'strain', get: function (p) { return p.eps.xx; } },
        { g: 'eps', key: 'eyy', sym: 'eyy', q: 'strain', get: function (p) { return p.eps.yy; } },
        { g: 'eps', key: 'ezz', sym: 'ezz', q: 'strain', get: function (p) { return p.eps.zz; } },
        { g: 'eps', key: 'gxz', sym: 'gxz', q: 'strain', get: function (p) { return p.eps.xz; } },
        { g: 'eps', key: 'gyz', sym: 'gyz', q: 'strain', get: function (p) { return p.eps.yz; } },
        { g: 'eps', key: 'gxy', sym: 'gxy', q: 'strain', get: function (p) { return p.eps.xy; } },

        { g: 'disp', key: 'ux', sym: 'ux', q: 'defl', get: function (p) { return p.disp.ux; } },
        { g: 'disp', key: 'uy', sym: 'uy', q: 'defl', get: function (p) { return p.disp.uy; } },
        { g: 'disp', key: 'uz', sym: 'uz', q: 'defl', get: function (p) { return p.disp.uz; } },

        { g: 'psig', key: 's1', sym: 's1', q: 'stress', get: function (p) { return p.principal.s1; } },
        { g: 'psig', key: 's2', sym: 's2', q: 'stress', get: function (p) { return p.principal.s2; } },
        { g: 'psig', key: 's3', sym: 's3', q: 'stress', get: function (p) { return p.principal.s3; } },

        { g: 'peps', key: 'e1', sym: 'e1', q: 'strain', get: function (p) { return p.epsPrincipal.e1; } },
        { g: 'peps', key: 'e2', sym: 'e2', q: 'strain', get: function (p) { return p.epsPrincipal.e2; } },
        { g: 'peps', key: 'e3', sym: 'e3', q: 'strain', get: function (p) { return p.epsPrincipal.e3; } }
    ];

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

    /* =================== small utilities =================== */
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function debounce(fn, ms) {
        var t = null;
        var d = function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
        d.cancel = function () { clearTimeout(t); };
        return d;
    }
    /* The blank. Not an em dash: the app prints none anywhere a reader can
     * see one, and a column of long dashes in a numeric table reads as data
     * rather than as absence. */
    var BLANK = '-';
    function sig(x, n) {
        n = n || 4;
        if (x == null || !isFinite(x)) return BLANK;
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

    /* =====================================================================
     * The app.
     * ===================================================================== */
    function initLeaps(host, opts) {
        opts = opts || {};
        if (!host) throw new Error('LEAPS: no mount element');

        /* --- scoped DOM access: nothing outside the mount is touched --- */
        function $(id) { return host.querySelector('#' + id); }
        function $$(sel) { return Array.prototype.slice.call(host.querySelectorAll(sel)); }
        var doc = host.ownerDocument || document;
        var win = doc.defaultView || window;

        function el(tag, cls, html) {
            var e = doc.createElement(tag);
            if (cls) e.className = cls;
            if (html != null) e.innerHTML = html;
            return e;
        }
        /* A token, never an empty string.
         *
         * Canvas ignores an unparseable fillStyle or strokeStyle and keeps
         * the last one, so a missing token there is a wrong color. But
         * CanvasGradient.addColorStop THROWS, and that kills the whole
         * draw, which is what a stylesheet arriving after the first frame
         * did: one blank viewport and an exception, from a variable that
         * was going to resolve a hundred milliseconds later. */
        function cssVar(name, fallback) {
            var v = win.getComputedStyle(host).getPropertyValue(name).trim();
            return v || fallback || 'transparent';
        }
        function rgba(name, alpha) {
            var h = cssVar(name);
            if (!/^#[0-9a-f]{6}$/i.test(h)) return 'rgba(13,148,136,' + alpha + ')';
            var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        }
        var fillRGBA = rgba;
        function download(filename, text, mime) {
            var blob = new Blob([text], { type: mime || 'text/plain' });
            var a = doc.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        }
        function plotly() { return opts.plotly || win.Plotly; }
        function katex() { return opts.katex || win.katex; }

        /* An equation, or its plain twin. See the EQ table: KaTeX is a
         * deferred script on both hosts, and `throwOnError: false` renders
         * the source in red instead of throwing, so a successful render is
         * one with no `.katex-error` in it. */
        function eq(id, display) {
            var e = EQ[id];
            if (!e) return '';
            var K = katex();
            if (K && typeof K.renderToString === 'function') {
                try {
                    var h = K.renderToString(e.tex, { throwOnError: false, displayMode: !!display });
                    if (h.indexOf('katex-error') < 0) {
                        return '<span class="lp-eq' + (display ? ' is-block' : '') + '">' + h + '</span>';
                    }
                } catch (err) { /* fall through to the plain twin */ }
            }
            return '<span class="lp-eq is-plain' + (display ? ' is-block' : '') + '">' + e.plain + '</span>';
        }

        /* The UI typeface, read from the stylesheet rather than named here.
         * Plotly and the 2-D canvas both want a font STRING, so neither can
         * inherit one; taking it from a token is what lets the same app.js
         * render in this site's Source Sans and in a host that sets its own,
         * without a second copy of the file. */
        function uiFont() { return cssVar('--lp-font') || 'Source Sans Pro, sans-serif'; }
        function monoFont() { return cssVar('--lp-mono') || 'ui-monospace, monospace'; }

        /* A symbol on the canvas, which has no typesetter. Returns the width
         * drawn, so a caller can lay text out after it. */
        function drawSym(c, id, x, y, size) {
            var s = symOf(id), w = 0;
            c.font = '600 ' + size + 'px ' + uiFont();
            c.fillText(s.b, x, y);
            w = c.measureText(s.b).width;
            if (s.sub) {
                c.font = Math.max(8, Math.round(size * 0.72)) + 'px ' + uiFont();
                c.fillText(s.sub, x + w + 0.5, y + Math.round(size * 0.22));
                w += c.measureText(s.sub).width + 0.5;
            }
            return w;
        }

        /* teardown register: every listener and observer lands here */
        var teardown = [];
        function on(target, type, fn, o) {
            target.addEventListener(type, fn, o);
            teardown.push(function () { target.removeEventListener(type, fn, o); });
        }

        /* Every plot the dock can hold. Kept in one place so the resize
           paths cannot drift apart as panes are added. */
        var ALL_PLOT_IDS = ['lp-chart-profile', 'lp-chart-surface', 'lp-chart-basin',
            'lp-smallmults', 'lp-chart-perf'];

        function resizePlots(ids) {
            var P = plotly();
            if (!P) return;
            win.requestAnimationFrame(function () {
                ids.forEach(function (id) {
                    var elx = $(id);
                    if (elx && elx.data) { try { P.Plots.resize(elx); } catch (e) { /* not a plot yet */ } }
                });
            });
        }

        /* =================== unit helpers =================== */
        function U() { return UNITS[state.settings.units] || UNITS.SI; }
        function toDisp(q, v) { return v * U()[q].k; }
        function fromDisp(q, v) { return v / U()[q].k; }
        function unit(q) { return U()[q].u; }
        function matById(id) {
            for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].id === id) return MATERIALS[i];
            return MATERIALS[0];
        }

        /* =================== state =================== */
        var uid = 1;
        function nid() { return uid++; }

        var state = {
            name: 'Untitled analysis',
            ySec: 0,
            loadKind: 'circle',
            layers: [],           /* {id, mat, name, h, E, nu, color, tex} */
            interfaces: [],       /* {slip} 0 bonded, 1 frictionless, else spring */
            loads: [],            /* {id, x, y, F(N), p(MPa)} */
            points: [],           /* {id, x, y, z} */
            settings: {
                units: 'SI', tol: '1e-6', res: '61x43', autorun: true,
                showBasin: true, showContour: true, field: 'szz', profField: 'szz',
                alpha: 0.85, strainAbs: false, solveFor: 'A'
            }
        };

        var results = { key: null, user: null, profiles: null, basin: null, grid: null, stats: null, meta: null };
        var view = { scale: 0.5, ox: 0, oy: 0 };
        var selPoint = null, selLayer = null;
        var history = [], future = [];
        var gearParams = { F: 20000, p: 0.7, Sd: 350, St: 350, L: 300, theta: 90 };
        var gearDirty = false;
        var openGroups = { loc: true, sig: true, eps: true, disp: true, psig: true, peps: true };

        /* =====================================================================
         * THE LOAD TRIPLE
         * ---------------------------------------------------------------------
         * Load per wheel F, contact pressure p and contact area A are one
         * relation, F = p A, with A = pi a^2. Any TWO of them fix the third,
         * and which one a student has in hand depends entirely on where the
         * number came from: an axle rating gives F, a tire placard gives p,
         * and a footprint traced on paper gives A.
         *
         * So the app stores F and p (the pair the solver and WinJULEA both
         * take) and `solveFor` names which of the three is the DERIVED one.
         * Editing a value never edits the field you are solving for; it
         * rewrites whichever of the stored pair keeps the other two inputs
         * exactly as typed. That is the whole rule, and it is why there is
         * no fourth stored number to fall out of step.
         * ===================================================================== */
        function areaOf(w) { return w.F / Math.max(w.p, 1e-12); }
        function radiusOf(w) { return Math.sqrt(areaOf(w) / Math.PI); }
        var loadA = radiusOf;                     /* the solver wants a radius */

        /* Apply one edit to one load, honoring `solveFor`. `what` is
         * 'F' | 'p' | 'A', in ENGINE units. */
        function setLoadValue(w, what, v) {
            var solve = state.settings.solveFor;
            if (!(v > 0)) return;
            if (what === solve) return;           /* the derived one is read-only */
            var A = areaOf(w);
            if (solve === 'A') {
                if (what === 'F') w.F = v; else w.p = v;
            } else if (solve === 'F') {
                if (what === 'p') { w.p = v; w.F = v * A; }
                else { w.F = w.p * v; }            /* what === 'A' */
            } else {                               /* solve === 'p' */
                if (what === 'F') { w.F = v; w.p = v / A; }
                else { w.p = w.F / v; }            /* what === 'A' */
            }
        }
        /* The same rule for the gear generator, which seeds every load. */
        function setGearValue(what, v) {
            var solve = state.settings.solveFor;
            if (!(v > 0) || what === solve) return;
            var A = gearParams.F / Math.max(gearParams.p, 1e-12);
            if (solve === 'A') {
                if (what === 'F') gearParams.F = v; else gearParams.p = v;
            } else if (solve === 'F') {
                if (what === 'p') { gearParams.p = v; gearParams.F = v * A; }
                else { gearParams.F = gearParams.p * v; }
            } else {
                if (what === 'F') { gearParams.F = v; gearParams.p = v / A; }
                else { gearParams.p = gearParams.F / v; }
            }
        }
        function gearArea() { return gearParams.F / Math.max(gearParams.p, 1e-12); }

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
        /* Depth of every interface, top down. One answer to where a layer
         * boundary is, shared by the drawing, the hit test and the solver. */
        function interfaceZs() {
            var out = [], z = 0;
            for (var i = 0; i < state.layers.length - 1; i++) { z += state.layers[i].h; out.push(z); }
            return out;
        }
        /* The length that sets the drawing scale. A circular load has a
         * radius; a point load has none at all, and a line load has a
         * length across the section only if it is not parallel to it, so
         * the fallback is a floor rather than zero. */
        function maxA() {
            var a = 0;
            state.loads.forEach(function (w) { a = Math.max(a, loadA(w)); });
            if (state.loadKind === 'point') a = Math.max(a * 0.25, 30);
            return Math.max(a, 60);
        }
        function worldBox() {
            var df = depthFinite();
            var subExt = state.layers.length > 1 ? clamp(0.55 * df, 300, 2200) : Math.max(4 * maxA(), 900);
            var zMax = df + subExt;
            var xw = 0;
            state.loads.forEach(function (w) { xw = Math.max(xw, Math.abs(w.x)); });
            if (state.loadKind === 'line') {
                var th = gearParams.theta * Math.PI / 180;
                xw += 0.5 * gearParams.L * Math.abs(Math.cos(th));
            }
            var xHalf = Math.max(xw + 3.0 * maxA(), 0.9 * zMax, 700);
            return { xL: -xHalf, xR: xHalf, zMax: zMax, df: df };
        }

        /* The color that ties an evaluation point to its column in the
         * results table and its marker in the section. Blue first, because
         * the loads are red and the accents orange. */
        function ptColor(i) {
            var pal = [cssVar('--lp-cat2'), cssVar('--lp-cat3'), cssVar('--lp-cat4'), cssVar('--lp-cat1')];
            return pal[i % pal.length];
        }

        function serialize() {
            return {
                app: 'LEAPS', version: '2.1', name: state.name, ySec: state.ySec,
                loadKind: state.loadKind,
                layers: state.layers, interfaces: state.interfaces,
                loads: state.loads, points: state.points, settings: state.settings,
                gear: gearParams
            };
        }
        function deserialize(d) {
            if (!d || d.app !== 'LEAPS') throw new Error('Not a LEAPS project file');
            state.name = d.name || 'Untitled analysis';
            state.ySec = d.ySec || 0;
            state.loadKind = d.loadKind || 'circle';
            state.layers = d.layers || [];
            state.interfaces = (d.interfaces || []).map(migrateInterface);
            /* v1 files carry `wheels` with kN/kPa; v2 carries `loads` in N/MPa */
            if (d.loads) state.loads = d.loads;
            else state.loads = (d.wheels || []).map(function (w) {
                return { id: nid(), x: w.x, y: w.y, F: w.F * 1000, p: w.p / 1000 };
            });
            state.points = d.points || [];
            var s = d.settings || {};
            for (var k in state.settings) if (s[k] != null) state.settings[k] = s[k];
            if (d.gear) for (var g in gearParams) if (d.gear[g] != null) gearParams[g] = d.gear[g];
            state.layers.forEach(function (L) { L.id = nid(); });
            state.loads.forEach(function (w) { w.id = nid(); });
            state.points.forEach(function (p) { p.id = nid(); });
            selLayer = null; gearDirty = false;
        }
        /* v1 wrote {bond, k}; v2 writes {slip}. Both round-trip. */
        function migrateInterface(f) {
            if (!f) return { slip: 0 };
            if (f.slip != null) return { slip: clamp(f.slip, 0, 1), k: f.k };
            if (f.bond === 'unbonded' || f.bond === 'frictionless') return { slip: 1 };
            if (f.bond === 'spring') return { slip: 0.5, bond: 'spring', k: f.k };
            return { slip: 0 };
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
            try { win.localStorage.setItem('leaps-autosave', snapshot()); } catch (e) { /* quota */ }
        }, 600);

        /* mutate wrapper: apply fn, record, re-render, schedule solve */
        function mutate(fn, o) {
            fn(state);
            syncStructures();
            pushHistory();
            renderPanels();
            invalidateResults(o && o.keepResults);
            drawViewport();
            renderChecks();
            scheduleRun();
        }
        function syncStructures() {
            var n = state.layers.length;
            while (state.interfaces.length < n - 1) state.interfaces.push({ slip: 0 });
            state.interfaces.length = Math.max(0, n - 1);
            if (selLayer != null && !state.layers.some(function (L) { return L.id === selLayer; })) selLayer = null;
        }
        function invalidateResults(keep) {
            if (keep) return;
            results = { key: null, user: null, profiles: null, basin: null, grid: null, stats: null, meta: null };
        }

        /* =====================================================================
         * PREFLIGHT
         * ---------------------------------------------------------------------
         * A layered-elastic solve will happily return numbers for a section
         * nobody meant to type. A zero-thickness layer, a Poisson ratio of
         * 0.5, a contact pressure left blank while the load was edited: each
         * produces a field that looks like a pavement and is not one, and
         * none of them announces itself in a contour plot.
         *
         * So Run asks first. Every check is a one-line claim about the model
         * with a tick or a cross beside it, and a failing one stops the run
         * and opens the list rather than reporting an error afterwards.
         * ===================================================================== */
        function checks() {
            var out = [];
            function ok(pass, label, detail) { out.push({ pass: !!pass, label: label, detail: detail || '' }); }
            var n = state.layers.length;

            ok(n >= 1, 'At least one layer', n ? '' : 'the section is empty');

            var badH = [], badE = [], badNu = [];
            state.layers.forEach(function (L, i) {
                if (i < n - 1 && !(L.h > 0)) badH.push(i + 1);
                if (!(L.E > 0)) badE.push(i + 1);
                if (!(L.nu > 0 && L.nu < 0.5)) badNu.push(i + 1);
            });
            ok(!badH.length, 'Every layer has a thickness',
                badH.length ? 'layer ' + badH.join(', ') : '');
            ok(!badE.length, 'Every modulus is positive',
                badE.length ? 'layer ' + badE.join(', ') : '');
            ok(!badNu.length, 'Every Poisson ratio is between 0 and 0.5',
                badNu.length ? 'layer ' + badNu.join(', ') : '');

            var badSlip = [];
            state.interfaces.forEach(function (f, i) {
                var s = f.slip;
                if (!(s >= 0 && s <= 1)) badSlip.push((i + 1) + '·' + (i + 2));
            });
            ok(!badSlip.length, 'Every interface has a slip value',
                badSlip.length ? 'interface ' + badSlip.join(', ') : '');

            ok(state.loads.length > 0, 'At least one load',
                state.loads.length ? '' : 'nothing is loading the section');

            var badF = [], badP = [];
            state.loads.forEach(function (w, i) {
                if (!(w.F > 0)) badF.push(i + 1);
                if (!(w.p > 0)) badP.push(i + 1);
            });
            ok(!badF.length && state.loads.length > 0, 'Every load carries a force',
                badF.length ? 'load ' + badF.join(', ') : '');
            if (state.loadKind === 'circle') {
                ok(!badP.length && state.loads.length > 0, 'Every contact pressure and area is set',
                    badP.length ? 'load ' + badP.join(', ') : '');
            }
            if (state.loadKind === 'line') {
                ok(gearParams.L > 0, 'The line load has a length',
                    gearParams.L > 0 ? '' : 'length must be greater than zero');
            }

            ok(!gearDirty, 'The gear matches its parameters',
                gearDirty ? 'press Build to apply the edited gear' : '');

            ok(state.points.length > 0, 'At least one evaluation point',
                state.points.length ? '' : 'the results table has no columns without one');

            return out;
        }
        function checksPass(list) {
            for (var i = 0; i < list.length; i++) if (!list[i].pass) return false;
            return true;
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
            else if (type === 'dual-tridem') {
                add(-g.Sd / 2, -g.St); add(g.Sd / 2, -g.St);
                add(-g.Sd / 2, 0); add(g.Sd / 2, 0);
                add(-g.Sd / 2, g.St); add(g.Sd / 2, g.St);
            }
            return w;
        }
        function applyTemplate(tpl) {
            state.name = tpl.name;
            state.ySec = 0;
            state.loadKind = 'circle';
            state.layers = tpl.layers.map(function (Ld) {
                return layerFromMat(Ld.mat, { h: Ld.h, E: Ld.E, nu: Ld.nu });
            });
            state.interfaces = [];
            for (var i = 0; i < state.layers.length - 1; i++) {
                state.interfaces.push({ slip: tpl.slips ? tpl.slips[i] : 0 });
            }
            for (var k in gearParams) if (tpl.params[k] != null) gearParams[k] = tpl.params[k];
            state.loads = gearLayout(tpl.gear, gearParams);
            state.points = [];
            selLayer = null;
            gearDirty = false;
            if (tpl.points === 'axis') criticalPoints();
        }

        /* =================== worker bridge =================== */
        var worker = null, workerReady = false, jobGen = 0, jobsInFlight = 0;
        var solverFallback = opts.solver || win.LEAPS || null;
        var disposed = false;

        function setEngineBadge(ok, text) {
            var b = $('lp-engine');
            if (!b) return;
            b.className = 'lp-status-badge ' + (ok ? 'is-ok' : 'is-bad');
            b.innerHTML = '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-exclamation-triangle') + '"></i> ' + text;
        }

        function makeWorker() {
            if (opts.makeWorker) return opts.makeWorker();
            return new Worker('worker.js');
        }
        function initWorker() {
            try {
                worker = makeWorker();
                worker.onmessage = onWorkerMessage;
                worker.onerror = function () { workerFailed(); };
                worker.postMessage({ type: 'hello' });
            } catch (e) { workerFailed(); }
        }
        function workerFailed() {
            worker = null; workerReady = false;
            if (solverFallback) {
                var st = solverFallback.selfTest();
                setEngineBadge(st.pass, 'LEAF-JS v' + solverFallback.version + ' · main thread · self-check ' + (st.pass ? '✓' : '✗'));
                scheduleRun();
            } else {
                setEngineBadge(false, 'Solver unavailable in this browser');
            }
        }
        var jobCallbacks = {};
        function onWorkerMessage(e) {
            if (disposed) return;
            var m = e.data || {};
            if (m.type === 'ready') {
                workerReady = true;
                setEngineBadge(m.selfTest.pass, 'LEAF-JS v' + m.version + ' · self-check ' + (m.selfTest.pass ? '✓ Boussinesq' : '✗ ' + m.selfTest.errors[0]));
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
                    if (disposed) return;
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
            if (!bar) return;
            bar.hidden = false;
            $('lp-progress-fill').style.width = Math.round(100 * tot / Math.max(n, 1)) + '%';
        }
        function hideProgress() {
            var bar = $('lp-progress');
            if (bar) bar.hidden = true;
            progressState = {};
        }

        /* =================== solve orchestration =================== */
        function solverLayers() {
            return state.layers.map(function (L) { return { h: L.h, E: L.E, nu: L.nu }; });
        }
        function solverInterfaces() {
            return state.interfaces.map(function (f) {
                return f.bond === 'spring' && f.k != null
                    ? { bond: 'spring', k: f.k }
                    : { slip: clamp(f.slip || 0, 0, 1) };
            });
        }
        function solverLoads() {
            var kind = state.loadKind;
            return state.loads.map(function (w) {
                if (kind === 'circle') return { kind: 'circle', x: w.x, y: w.y, p: w.p, a: loadA(w) };
                if (kind === 'point') return { kind: 'point', x: w.x, y: w.y, P: w.F };
                return { kind: 'line', x: w.x, y: w.y, P: w.F, L: gearParams.L, theta: gearParams.theta };
            });
        }
        function solverOptions() {
            return {
                tol: parseFloat(state.settings.tol), maxPanels: 240,
                aRef: state.loads.length ? loadA(state.loads[0]) : 150
            };
        }
        function keyStations() {
            var st = [], seen = {};
            function add(x, y, label) {
                var k = Math.round(x) + '|' + Math.round(y);
                if (seen[k]) return;
                seen[k] = 1;
                st.push({ x: x, y: y, label: label });
            }
            state.loads.forEach(function (w, i) { add(w.x, w.y, 'Load ' + (i + 1)); });
            for (var i = 0; i + 1 < state.loads.length && i < 4; i++) {
                var a = state.loads[i], b = state.loads[i + 1];
                add((a.x + b.x) / 2, (a.y + b.y) / 2, 'Between ' + (i + 1) + ' and ' + (i + 2));
            }
            return st.slice(0, 8);
        }
        /* A point load is singular at its own center and a line load along
         * its own line, so the automatic station set is nudged off it. The
         * offset is a fraction of the contact radius the same total force
         * would have had, small enough to still be "under the wheel". */
        function stationOffset() {
            if (state.loadKind === 'circle') return 0;
            var a = state.loads.length ? loadA(state.loads[0]) : 100;
            return Math.max(0.25 * a, 10);
        }

        function buildMainJob() {
            var pts = [], n = state.layers.length;
            var zb = interfaceZs();
            var stations = keyStations();
            var off = stationOffset();

            stations.forEach(function (s, si) {
                var sx = s.x + off;
                pts.push({ x: sx, y: s.y, z: 0, li: 0, tag: { t: 'kp', si: si, pos: 'surf' } });
                zb.forEach(function (zi, ii) {
                    pts.push({ x: sx, y: s.y, z: zi, li: ii, tag: { t: 'kp', si: si, pos: 'bot', layer: ii } });
                    pts.push({ x: sx, y: s.y, z: zi, li: ii + 1, tag: { t: 'kp', si: si, pos: 'top', layer: ii + 1 } });
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
                    pts.push({ x: s.x + off, y: s.y, z: zp.z, li: zp.li, tag: { t: 'pf', si: si, z: zp.z } });
                });
            });

            /* surface basin along the section line */
            var NB = 121;
            for (var b = 0; b < NB; b++) {
                var xb = box.xL + (box.xR - box.xL) * b / (NB - 1);
                pts.push({ x: xb, y: state.ySec, z: 0, li: 0, tag: { t: 'bs', i: b } });
            }

            return {
                job: {
                    layers: solverLayers(), interfaces: solverInterfaces(),
                    loads: solverLoads(), points: pts, options: solverOptions()
                },
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
            /* A line load costs several times a circular one per point: it
             * is a quadrature inside a quadrature, so the contour grid is
             * trimmed rather than left to take five seconds. */
            if (state.loadKind === 'line') { nx = Math.round(nx * 0.7); nz = Math.round(nz * 0.7); }
            var xs = [], zs = [], pts = [];
            for (var i = 0; i < nx; i++) xs.push(box.xL + (box.xR - box.xL) * i / (nx - 1));
            for (var j = 0; j < nz; j++) zs.push(box.zMax * j / (nz - 1));
            for (j = 0; j < nz; j++) {
                for (i = 0; i < nx; i++) pts.push({ x: xs[i], y: state.ySec, z: zs[j] });
            }
            return {
                job: {
                    layers: solverLayers(), interfaces: solverInterfaces(),
                    loads: solverLoads(), points: pts, options: solverOptions()
                }, nx: nx, nz: nz, xs: xs, zs: zs
            };
        }

        var scheduleRun = debounce(function () {
            if (state.settings.autorun && checksPass(checks())) run();
        }, 350);

        /* The Run button. Auto-run stays quiet when a check fails; pressing
         * Run says why rather than doing nothing. */
        function runPressed() {
            var list = checks();
            if (!checksPass(list)) { openChecks(true); return; }
            run();
        }

        function run() {
            if (!state.loads.length || !state.layers.length) return;
            if (!workerReady && !solverFallback) return;
            cancelJobs();
            var myGen = jobGen;
            var main = buildMainJob();
            var grid = buildGridJob(main.box);

            postJob('main', main.job, function (err, res) {
                if (err || myGen !== jobGen || disposed) return;
                applyMainResults(res, main.stations);
                $('lp-stats').textContent =
                    res.stats.nPoints + ' pts · ' + res.stats.systemSolves + ' kernel solves · ' +
                    Math.round(res.stats.ms) + ' ms';
            });
            postJob('grid', grid.job, function (err, res) {
                if (err || myGen !== jobGen || disposed) return;
                results.grid = { nx: grid.nx, nz: grid.nz, xs: grid.xs, zs: grid.zs, pts: res.points, box: main.box };
                buildContour();
                drawViewport();
                $('lp-stats').textContent += ' · grid ' + grid.nx + '×' + grid.nz + ' in ' + Math.round(res.stats.ms) + ' ms';
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
            results.meta = { aRef: res.aRef, slip: res.slip };
            renderCards();
            renderLayerTable();
            renderPointsTable();
            renderCharts();
            renderPerformance();
            drawViewport();
        }

        /* =================== key responses =================== */
        function keyExtremes() {
            if (!results.key) return null;
            var n = state.layers.length;
            var out = { w0: null, et: null, ev: null, sigt: null, tau: null };
            results.key.forEach(function (p) {
                var t = p.tag;
                if (!isFinite(p.disp.uz)) return;
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
                    if (p && isFinite(p.disp.uz) && (!out.w0 || p.disp.uz > out.w0.v)) out.w0 = { v: p.disp.uz, p: p };
                });
            }
            return out;
        }

        /* The flash cards. They carry the numbers a design decision is made
         * on, so they get a surface of their own: a tinted card on a plain
         * panel, and the governing one keyed in the brand color. Everything
         * else in the rail is white on white on purpose, so that these five
         * are the only thing with a fill. */
        function renderCards() {
            var hostEl = $('lp-cards');
            hostEl.innerHTML = '';
            var ex = keyExtremes();
            if (!ex) { hostEl.appendChild(el('p', 'lp-hint', 'Run to see key responses.')); return; }
            function card(symId, name, value, unitStr, sub, lead) {
                var c = el('div', 'lp-card' + (lead ? ' is-lead' : ''));
                c.appendChild(el('div', 'lp-card-label',
                    '<span class="lp-card-sym">' + symHtml(symId) + '</span>' + name));
                c.appendChild(el('div', 'lp-card-value', value + '<small>' + unitStr + '</small>'));
                if (sub) c.appendChild(el('div', 'lp-card-sub', sub));
                hostEl.appendChild(c);
            }
            function at(p) {
                return symHtml('x') + ' ' + sig(toDisp('len', p.x), 3) + ', ' +
                    symHtml('z') + ' ' + sig(toDisp('len', p.z), 3) + ' ' + unit('len');
            }
            if (ex.w0) card('w', 'surface deflection', sig(toDisp('defl', ex.w0.v)), unit('defl'), at(ex.w0.p), true);
            if (ex.et) card('et', 'tensile strain, base of ' + state.layers[0].name,
                sig(toDisp('strain', ex.et.v)), 'µε', at(ex.et.p) + ' · fatigue');
            if (ex.ev) card('ev', 'compressive strain, top of subgrade',
                sig(toDisp('strain', -ex.ev.v)), 'µε', at(ex.ev.p) + ' · rutting');
            if (ex.sigt) card('st', 'tensile stress, base of ' + state.layers[ex.sigt.layer].name,
                sig(toDisp('stress', ex.sigt.v)), unit('stress'), at(ex.sigt.p));
            if (ex.tau) card('tau', 'peak interface shear',
                sig(toDisp('stress', ex.tau.v)), unit('stress'),
                'base of ' + state.layers[ex.tau.layer].name);
        }

        function renderLayerTable() {
            var hostEl = $('lp-layer-table');
            hostEl.innerHTML = '';
            if (!results.key) return;
            var n = state.layers.length;
            var rows = [];
            for (var i = 0; i < n; i++) rows.push({ et: null, ev: null, st: null });
            results.key.forEach(function (p) {
                var t = p.tag;
                if (!isFinite(p.eps.xx)) return;
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
            tb.innerHTML = '<thead><tr><th>Layer</th>' +
                '<th>' + symHtml('et') + ' base (µε)</th>' +
                '<th>' + symHtml('st') + ' base (' + unit('stress') + ')</th>' +
                '<th>' + symHtml('ev') + ' top (µε)</th></tr></thead>';
            var body = el('tbody');
            state.layers.forEach(function (L, i) {
                var r = rows[i];
                var tr = el('tr');
                tr.innerHTML = '<td><span class="lp-swatch" style="background:' + L.color + '"></span>' + L.name + '</td>' +
                    '<td>' + (r.et != null ? sig(toDisp('strain', r.et)) : BLANK) + '</td>' +
                    '<td>' + (r.st != null ? sig(toDisp('stress', r.st)) : BLANK) + '</td>' +
                    '<td>' + (r.ev != null ? sig(toDisp('strain', r.ev)) : BLANK) + '</td>';
                body.appendChild(tr);
            });
            tb.appendChild(body);
            wrap.appendChild(tb);
            hostEl.appendChild(wrap);
        }

        /* =================== the transposed results table =================
         * Points across, quantities down. Three things make it navigable at
         * twenty-four rows: the quantity and unit columns are frozen, so a
         * column scrolled four screens right is still labeled; the six
         * groups fold; and every cell carries a bar scaled to the largest
         * magnitude IN ITS OWN ROW, which is what turns a field of digits
         * into a shape you can read across. The bar is per row and never
         * per table, because a stress and a strain share no scale.
         *
         * Strains print as microstrain by default, the number a pavement
         * engineer compares; the toggle prints them dimensionless in the
         * E-notation a layered-elastic program uses. */
        function rowValue(row, p) {
            var v = row.get(p);
            if (!isFinite(v)) return null;
            if (row.q === 'strain' && state.settings.strainAbs) return v;
            return toDisp(row.q, v);
        }
        function rowUnit(row) {
            if (row.q === 'strain') return state.settings.strainAbs ? BLANK : 'µε';
            return unit(row.q);
        }
        /* A response that is zero BY SYMMETRY comes back as roundoff, not as
         * zero: on a wheel axis the engine returns a shear of 2e-18 where the
         * answer is exactly 0, and a table printing 2.19e-18 invites a reader
         * to believe there is a shear there. Anything twelve orders below the
         * largest value in its own row is that row's zero. Twelve, not six:
         * the two solvers agree to five significant figures, so a number that
         * small is not a small response, it is the double's last bits. The
         * project file keeps the raw value, so nothing is lost, only unprinted. */
        function rowFloor(v, mx) {
            if (v == null) return v;
            return (mx > 0 && Math.abs(v) < 1e-12 * mx) ? 0 : v;
        }
        function fmtCell(row, v, mx) {
            if (v == null) return BLANK;
            v = rowFloor(v, mx);
            if (v === 0) return '0';
            if (row.q === 'strain' && state.settings.strainAbs) return v.toExponential(4);
            return sig(v, 5);
        }

        function renderPointsTable() {
            var hostEl = $('lp-pts-table');
            hostEl.innerHTML = '';
            var data = results.user || [];
            var hint = $('lp-table-hint');
            hint.innerHTML = data.length
                ? '<strong>' + data.length + '</strong> point' + (data.length > 1 ? 's' : '') +
                  ' · tension positive · ' + symHtml('z') + ' downward'
                : 'No evaluation points yet. Add one, use <em>Critical set</em>, or double-click the section.';
            if (!data.length) return;

            var wrap = el('div', 'lp-rt-wrap');
            var tb = el('table', 'lp-rt');

            var thead = el('thead');
            var hr = el('tr');
            hr.appendChild(el('th', 'lp-rt-corner', 'Quantity'));
            hr.appendChild(el('th', 'lp-rt-unit-h', 'Unit'));
            data.forEach(function (p, i) {
                var th = el('th', 'lp-rt-pt' + (p.singular ? ' is-singular' : ''));
                th.innerHTML = '<span class="lp-rt-ptname">' +
                    '<span class="lp-rt-dot" style="background:' + ptColor(i) + '"></span>P' + (i + 1) + '</span>' +
                    '<span class="lp-rt-ptlayer">' + (state.layers[p.li] ? state.layers[p.li].name : BLANK) + '</span>';
                th.dataset.col = String(i);
                hr.appendChild(th);
            });
            thead.appendChild(hr);
            tb.appendChild(thead);

            var posTint = rgba('--lp-cat1', 0.18), negTint = rgba('--lp-cat2', 0.18);

            RESULT_GROUPS.forEach(function (grp) {
                var rows = RESULT_ROWS.filter(function (r) { return r.g === grp.id; });
                if (!rows.length) return;
                var body = el('tbody', 'lp-rt-group' + (openGroups[grp.id] ? ' is-open' : ''));

                var gr = el('tr', 'lp-rt-grouphead');
                var gth = el('th');
                gth.colSpan = data.length + 2;
                gth.innerHTML = '<button type="button" class="lp-rt-toggle"><i class="fas fa-chevron-right"></i>' +
                    '<i class="fas ' + grp.icon + '"></i> ' + grp.name +
                    '<span class="lp-rt-count">' + rows.length + '</span></button>';
                gth.querySelector('button').addEventListener('click', function () {
                    openGroups[grp.id] = !openGroups[grp.id];
                    body.classList.toggle('is-open', openGroups[grp.id]);
                });
                gr.appendChild(gth);
                body.appendChild(gr);

                rows.forEach(function (r) {
                    var tr = el('tr', 'lp-rt-row');
                    tr.appendChild(el('th', 'lp-rt-q', symHtml(r.sym)));
                    tr.appendChild(el('td', 'lp-rt-unit', rowUnit(r)));

                    /* one pass for the row scale, one to draw it */
                    var vals = data.map(function (p) { return rowValue(r, p); });
                    var mx = 0, peak = -1;
                    if (grp.id !== 'loc') {
                        vals.forEach(function (v, i) {
                            if (v == null) return;
                            if (Math.abs(v) > mx) { mx = Math.abs(v); peak = i; }
                        });
                    }
                    vals.forEach(function (v, i) {
                        var neg = v != null && v < 0;
                        var td = el('td', 'lp-rt-v' + (neg ? ' is-neg' : '') + (i === peak ? ' is-peak' : ''),
                            fmtCell(r, v, mx));
                        td.dataset.col = String(i);
                        if (mx > 0 && v != null) {
                            var pct = Math.round(100 * Math.abs(v) / mx);
                            td.style.backgroundImage = 'linear-gradient(to left, ' +
                                (neg ? negTint : posTint) + ' 0 ' + pct + '%, transparent ' + pct + '%)';
                        }
                        tr.appendChild(td);
                    });
                    body.appendChild(tr);
                });
                tb.appendChild(body);
            });

            /* column highlight: one delegated listener, not 24 x N */
            function highlight(e) {
                var c = e.target && e.target.dataset ? e.target.dataset.col : null;
                $$('.lp-rt .is-col').forEach(function (n) { n.classList.remove('is-col'); });
                if (c == null) return;
                Array.prototype.forEach.call(tb.querySelectorAll('[data-col="' + c + '"]'), function (n) {
                    n.classList.add('is-col');
                });
            }
            tb.addEventListener('pointerover', highlight);
            tb.addEventListener('pointerleave', function () {
                $$('.lp-rt .is-col').forEach(function (n) { n.classList.remove('is-col'); });
            });

            wrap.appendChild(tb);
            hostEl.appendChild(wrap);

            if (data.some(function (p) { return p.singular; })) {
                hostEl.appendChild(el('p', 'lp-warn',
                    '<i class="fas fa-triangle-exclamation"></i> A point marked <strong>singular</strong> sits on a ' +
                    'point or line load, where the idealization has no finite answer. Move it off the load, or use a ' +
                    'circular imprint.'));
            }
        }

        /* =================== charts (Plotly) =================== */
        function chartColors() {
            return [cssVar('--lp-cat1'), cssVar('--lp-cat2'), cssVar('--lp-cat3'), cssVar('--lp-cat4')];
        }
        /* one high-contrast, theme-aware tooltip style shared by every plot so the
         * hovered readout is always a solid, legible panel, never Plotly's default
         * trace-tinted box with auto black/white text */
        function hoverStyle() {
            return {
                bgcolor: cssVar('--lp-bg2'),
                bordercolor: cssVar('--lp-line'),
                font: { color: cssVar('--lp-ink'), family: uiFont(), size: 12 },
                align: 'left', namelength: -1
            };
        }
        /* refined axis: subdued ticks, a slightly stronger titled label, a readable
         * zero line, and (optionally) a dotted crosshair spike while hovering.
         * Plotly renders <sub> and <sup> in every title it draws, so an axis can
         * carry the same typeset symbol the table does. */
        function chartAxis(titleText, spikes) {
            var ax = {
                title: { text: titleText, font: { size: 11.5, color: cssVar('--lp-ink2'), family: uiFont() }, standoff: 10 },
                tickfont: { size: 10, color: cssVar('--lp-ink3') },
                gridcolor: cssVar('--lp-line-soft'), gridwidth: 1,
                zerolinecolor: cssVar('--lp-line'), zerolinewidth: 1.4,
                linecolor: cssVar('--lp-line'), ticks: 'outside', ticklen: 3, tickcolor: cssVar('--lp-line-soft'),
                automargin: true
            };
            if (spikes) {
                ax.showspikes = true; ax.spikethickness = 1; ax.spikedash = 'dot';
                ax.spikecolor = cssVar('--lp-ink3'); ax.spikemode = 'across'; ax.spikesnap = 'data';
            }
            return ax;
        }
        function chartLayout(xTitle, yTitle, o) {
            o = o || {};
            var ink2 = cssVar('--lp-ink2');
            var spikes = o.spikes !== false;   /* reading charts get crosshair spikes by default */
            var lay = {
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: ink2, size: 11, family: uiFont() },
                margin: o.margin || { l: 60, r: 16, t: 12, b: 48 },
                xaxis: chartAxis(xTitle, spikes),
                yaxis: chartAxis(yTitle, spikes),
                showlegend: o.showlegend !== false,
                legend: { orientation: 'h', y: -0.28, font: { size: 10, color: ink2 } },
                hovermode: 'closest',
                hoverlabel: hoverStyle()
            };
            if (!o.noReverseY) lay.yaxis.autorange = 'reversed';
            return lay;
        }
        /* layer-band shading rectangles for a depth (y) axis */
        function layerBandShapes(xref, yref) {
            var shapes = [], z = 0, line = cssVar('--lp-line');
            for (var i = 0; i < state.layers.length; i++) {
                var top = z;
                var bot = i < state.layers.length - 1 ? z + state.layers[i].h : z + state.layers[i].h + 400;
                z = bot;
                shapes.push({
                    type: 'rect', xref: xref, yref: yref, layer: 'below',
                    x0: 0, x1: 1, y0: toDisp('len', top), y1: toDisp('len', bot),
                    fillcolor: state.layers[i].color, opacity: 0.12, line: { width: 0 }
                });
                if (i > 0) shapes.push({
                    type: 'line', xref: xref, yref: yref, layer: 'below',
                    x0: 0, x1: 1, y0: toDisp('len', top), y1: toDisp('len', top),
                    line: { color: line, width: 1, dash: 'dot' }, opacity: 0.7
                });
            }
            return shapes;
        }
        /* dotted vertical markers at each load center, for the surface/basin charts */
        function loadRefLines() {
            var danger = cssVar('--lp-danger');
            return state.loads.map(function (w) {
                return {
                    type: 'line', yref: 'paper', y0: 0, y1: 1, layer: 'below',
                    x0: toDisp('len', w.x), x1: toDisp('len', w.x),
                    line: { color: danger, width: 1, dash: 'dot' }, opacity: 0.5
                };
            });
        }
        function profField() { return fieldById(state.settings.profField || 'szz'); }
        /* keep the two field-linked chart-card captions in sync with the selector */
        function syncProfileTitles() {
            var f = profField();
            var tp = $('lp-title-profile'), ts = $('lp-title-surface');
            if (tp) tp.innerHTML = 'Depth profile · ' + symHtml(f.sym) + ' ' + f.name;
            if (ts) ts.innerHTML = 'Surface response · ' + symHtml(f.sym);
        }
        /* briefly highlight the two field-linked cards so it is obvious which
         * charts just refreshed when the Field selector changes */
        function flashLinkedCards() {
            $$('.lp-chart-card.is-linked').forEach(function (c) {
                c.classList.remove('is-flash');
                void c.offsetWidth;   /* restart the animation */
                c.classList.add('is-flash');
            });
        }
        var chartRetry = null;
        function renderCharts() {
            if (!plotly()) { clearTimeout(chartRetry); chartRetry = setTimeout(renderCharts, 600); return; }
            renderProfileChart();
            renderSurfaceChart();
            renderBasinChart();
            renderSmallMultiples();
        }
        function renderProfileChart() {
            var hostEl = $('lp-chart-profile');
            var P = plotly();
            if (!hostEl || !P) return;
            syncProfileTitles();
            if (!results.profiles) { P.purge(hostEl); return; }
            var f = profField();
            var colors = chartColors();
            var traces = [];
            results.profiles.stations.forEach(function (s, si) {
                var data = (results.profiles.data[si] || []).slice();
                data.sort(function (a, b) { return a.z - b.z || a.li - b.li; });
                traces.push({
                    x: data.map(function (p) { return toDisp(f.q, f.get(p)); }),
                    y: data.map(function (p) { return toDisp('len', p.z); }),
                    name: s.label, mode: 'lines',
                    line: { color: colors[si % colors.length], width: 2.1 },
                    hovertemplate: '<b>' + s.label + '</b><br>%{x:.4g} ' + unit(f.q) + ' at z = %{y:.4g} ' + unit('len') + '<extra></extra>'
                });
            });
            var lay = chartLayout(symHtml(f.sym) + '  (' + unit(f.q) + ')', 'depth z (' + unit('len') + ')');
            lay.shapes = layerBandShapes('paper', 'y');
            P.react(hostEl, traces, lay, { displayModeBar: false, responsive: true });
        }
        function renderSurfaceChart() {
            var hostEl = $('lp-chart-surface');
            var P = plotly();
            if (!hostEl || !P) return;
            syncProfileTitles();
            if (!results.basin || !results.basin.length) { P.purge(hostEl); return; }
            var f = profField();
            var colors = chartColors();
            var pts = results.basin.filter(function (p) { return p && isFinite(f.get(p)); });
            var xs = pts.map(function (p) { return toDisp('len', p.x); });
            var ys = pts.map(function (p) { return toDisp(f.q, f.get(p)); });
            var lay = chartLayout('offset x (' + unit('len') + ')', symHtml(f.sym) + '  (' + unit(f.q) + ')',
                { noReverseY: true, showlegend: false });
            lay.shapes = loadRefLines();
            P.react(hostEl, [{
                x: xs, y: ys, mode: 'lines',
                line: { color: colors[2], width: 2.1 },
                hovertemplate: '%{y:.4g} ' + unit(f.q) + ' at x = %{x:.4g} ' + unit('len') + '<extra></extra>'
            }], lay, { displayModeBar: false, responsive: true });
        }
        function renderBasinChart() {
            var hostEl = $('lp-chart-basin');
            var P = plotly();
            if (!hostEl || !P) return;
            if (!results.basin || !results.basin.length) { P.purge(hostEl); return; }
            var pts = results.basin.filter(function (p) { return p && isFinite(p.disp.uz); });
            var xs = pts.map(function (p) { return toDisp('len', p.x); });
            var ws = pts.map(function (p) { return toDisp('defl', p.disp.uz); });
            var lay = chartLayout('offset x (' + unit('len') + ')', 'w  (' + unit('defl') + ')', { showlegend: false });
            lay.shapes = loadRefLines();
            P.react(hostEl, [{
                x: xs, y: ws, mode: 'lines', fill: 'tozeroy',
                line: { color: cssVar('--lp-accent-deep'), width: 2.1 },
                fillcolor: rgba('--lp-accent-deep', 0.16),
                hovertemplate: 'w = %{y:.4g} ' + unit('defl') + ' at x = %{x:.4g} ' + unit('len') + '<extra></extra>'
            }], lay, { displayModeBar: false, responsive: true });
        }
        var SM_FIELDS = ['szz', 'sxx', 'vm', 'exx', 'ezz', 'uz'];
        function renderSmallMultiples() {
            var hostEl = $('lp-smallmults');
            var P = plotly();
            if (!hostEl || !P) return;
            if (!results.profiles || !results.profiles.stations.length) { P.purge(hostEl); return; }
            var data = (results.profiles.data[0] || []).slice();
            data.sort(function (a, b) { return a.z - b.z || a.li - b.li; });
            if (!data.length) { P.purge(hostEl); return; }
            var zbs = interfaceZs();
            var soft = cssVar('--lp-line-soft'), lineC = cssVar('--lp-line'), ink2 = cssVar('--lp-ink2'), ink3 = cssVar('--lp-ink3');
            var cols = chartColors();
            var ys = data.map(function (p) { return toDisp('len', p.z); });
            var traces = [], annotations = [], shapes = [];
            function sfx(k) { return k === 0 ? '' : String(k + 1); }   /* Plotly: first axis is x/y, then x2/y2 */
            SM_FIELDS.forEach(function (fid, k) {
                var f = fieldById(fid), sx = 'x' + sfx(k), sy = 'y' + sfx(k);
                traces.push({
                    x: data.map(function (p) { return toDisp(f.q, f.get(p)); }), y: ys,
                    xaxis: sx, yaxis: sy, mode: 'lines',
                    line: { color: cols[k % cols.length], width: 1.7 },
                    hovertemplate: '<b>' + symHtml(f.sym) + '</b><br>%{x:.4g} ' + unit(f.q) + ' at z = %{y:.4g} ' + unit('len') + '<extra></extra>',
                    showlegend: false
                });
                annotations.push({
                    text: '<b>' + symHtml(f.sym) + '</b> (' + unit(f.q) + ')',
                    xref: sx + ' domain', yref: sy + ' domain',
                    x: 0, y: 1.16, xanchor: 'left', yanchor: 'top', showarrow: false,
                    font: { size: 10, color: ink2 }
                });
                zbs.forEach(function (zb) {
                    shapes.push({
                        type: 'line', xref: sx + ' domain', yref: sy,
                        x0: 0, x1: 1, y0: toDisp('len', zb), y1: toDisp('len', zb),
                        line: { color: lineC, width: 0.8, dash: 'dot' }
                    });
                });
            });
            var lay = {
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: ink2, size: 10, family: uiFont() },
                margin: { l: 48, r: 14, t: 28, b: 36 }, height: 430,
                grid: { rows: 2, columns: 3, pattern: 'independent', roworder: 'top to bottom' },
                showlegend: false, annotations: annotations, shapes: shapes,
                hovermode: 'closest', hoverlabel: hoverStyle()
            };
            for (var k = 0; k < SM_FIELDS.length; k++) {
                lay['xaxis' + sfx(k)] = {
                    gridcolor: soft, zerolinecolor: lineC, zerolinewidth: 1.2,
                    tickfont: { size: 9, color: ink3 }, ticks: 'outside', ticklen: 2, tickcolor: soft
                };
                lay['yaxis' + sfx(k)] = {
                    autorange: 'reversed', gridcolor: soft, zerolinecolor: lineC, zerolinewidth: 1.2,
                    tickfont: { size: 9, color: ink3 }, ticks: 'outside', ticklen: 2, tickcolor: soft
                };
            }
            P.react(hostEl, traces, lay, { displayModeBar: false, responsive: true });
        }

        /* =================== performance / distress =================== */
        function supDigits(s) {
            var map = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '' };
            return String(s).replace(/[0-9+\-]/g, function (c) { return map[c]; });
        }
        function fmtLife(n) {
            if (n == null || !isFinite(n) || n <= 0) return BLANK;
            if (n >= 1e18) return '∞';
            var e = Math.floor(Math.log10(n)), m = n / Math.pow(10, e);
            if (e < 3) return String(Math.round(n));
            return (Math.round(m * 100) / 100) + ' × 10' + supDigits(e);
        }
        function renderPerformance() {
            var hostEl = $('lp-perf');
            if (!hostEl) return;
            var ex = keyExtremes();
            hostEl.innerHTML = '';
            if (!ex) { hostEl.appendChild(el('p', 'lp-hint', 'Run to see distress estimates.')); return; }

            var L0 = state.layers[0];
            var acBound = L0 && L0.tex === 'asphalt';
            var Nf = null, epsT = null;
            if (acBound && ex.et) {
                epsT = Math.abs(ex.et.v);
                var Epsi = L0.E * 145.0377377;
                if (epsT > 0) Nf = 0.0796 * Math.pow(epsT, -3.291) * Math.pow(Epsi, -0.854);
            }
            var Nr = null, epsV = null;
            if (ex.ev) { epsV = Math.abs(ex.ev.v); if (epsV > 0) Nr = 1.365e-9 * Math.pow(epsV, -4.477); }
            var gov = null, govName = '';
            if (Nf != null && Nr != null) { if (Nf <= Nr) { gov = Nf; govName = 'Fatigue cracking'; } else { gov = Nr; govName = 'Subgrade rutting'; } }
            else if (Nf != null) { gov = Nf; govName = 'Fatigue cracking'; }
            else if (Nr != null) { gov = Nr; govName = 'Subgrade rutting'; }

            var wrap = el('div', 'lp-perf-grid');
            var cards = el('div', 'lp-perf-cards');
            function pcard(label, value, sub, gover, icon) {
                var c = el('div', 'lp-perf-card' + (gover ? ' is-gov' : ''));
                c.innerHTML = '<div class="lp-perf-icon"><i class="fas ' + icon + '"></i></div>' +
                    '<div class="lp-perf-body"><div class="lp-perf-label">' + label + '</div>' +
                    '<div class="lp-perf-value">' + value + '</div>' +
                    '<div class="lp-perf-sub">' + sub + '</div></div>';
                cards.appendChild(c);
            }
            pcard('Fatigue life ' + symHtml('Nf'), fmtLife(Nf),
                acBound ? (epsT != null ? eq('fatigue') : 'no tensile strain found')
                    : 'surface layer is not asphalt-bound',
                govName === 'Fatigue cracking', 'fa-network-wired');
            pcard('Subgrade rutting life ' + symHtml('Nr'), fmtLife(Nr),
                epsV != null ? eq('rutting') : BLANK,
                govName === 'Subgrade rutting', 'fa-arrows-down-to-line');
            pcard('Governing life', fmtLife(gov), govName ? govName : BLANK, false, 'fa-flag-checkered');
            wrap.appendChild(cards);

            var chartCard = el('div', 'lp-perf-chart');
            var cdiv = el('div'); cdiv.id = 'lp-chart-perf'; cdiv.className = 'lp-chart';
            chartCard.appendChild(el('div', 'lp-chart-title', 'Critical tensile strain by layer'));
            chartCard.appendChild(cdiv);
            wrap.appendChild(chartCard);
            hostEl.appendChild(wrap);

            hostEl.appendChild(el('p', 'lp-hint',
                'Asphalt Institute transfer functions, E in psi. Scope and calibration: ' +
                '<a href="documentation.html">documentation</a>.'));

            renderPerfChart();
        }
        var perfRetry = null;
        function renderPerfChart() {
            var P = plotly();
            if (!P) { clearTimeout(perfRetry); perfRetry = setTimeout(renderPerfChart, 500); return; }
            var hostEl = $('lp-chart-perf');
            if (!hostEl || !results.key) return;
            var n = state.layers.length, rows = [];
            for (var i = 0; i < n; i++) rows.push(null);
            results.key.forEach(function (p) {
                var t = p.tag;
                if (t.pos === 'bot' && isFinite(p.eps.xx)) {
                    var eT = Math.max(p.eps.xx, p.eps.yy);
                    if (rows[t.layer] == null || eT > rows[t.layer]) rows[t.layer] = eT;
                }
            });
            var names = [], vals = [], colors = [];
            for (i = 0; i < n - 1; i++) {
                names.push(state.layers[i].name);
                vals.push(rows[i] != null ? rows[i] * 1e6 : 0);
                colors.push(state.layers[i].color);
            }
            var lay = {
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: cssVar('--lp-ink2'), size: 11, family: uiFont() },
                margin: { l: 150, r: 20, t: 8, b: 44 }, height: 260,
                xaxis: {
                    title: { text: symHtml('et') + ' at layer base (µε)', font: { size: 11.5, color: cssVar('--lp-ink2') }, standoff: 10 },
                    tickfont: { size: 10, color: cssVar('--lp-ink3') },
                    gridcolor: cssVar('--lp-line-soft'), zerolinecolor: cssVar('--lp-line'), zerolinewidth: 1.4
                },
                yaxis: { automargin: true, autorange: 'reversed', tickfont: { size: 11, color: cssVar('--lp-ink2') } },
                showlegend: false, hovermode: 'closest', hoverlabel: hoverStyle()
            };
            P.react(hostEl, [{
                type: 'bar', orientation: 'h', x: vals, y: names,
                marker: { color: colors, line: { color: cssVar('--lp-line'), width: 1 } },
                hovertemplate: '%{y}: %{x:.4g} µε<extra></extra>'
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
            if (!finite.length) return;
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
            var cnv = doc.createElement('canvas');
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
        /* Hit targets the DRAWING computes and the pointer handler reads, so
         * the two can never disagree about where a control is. */
        var itfChips = [];
        var dragNote = null;

        function texture(mat) {
            var key = mat.tex + '|' + mat.color;
            if (texCache[key]) return texCache[key];
            var c = doc.createElement('canvas');
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

        function roundRect(c, x, y, w, h, r) {
            c.beginPath();
            c.moveTo(x + r, y);
            c.arcTo(x + w, y, x + w, y + h, r);
            c.arcTo(x + w, y + h, x, y + h, r);
            c.arcTo(x, y + h, x, y, r);
            c.arcTo(x, y, x + w, y, r);
            c.closePath();
        }

        /* --- the three load idealizations, drawn as three different things.
         * A student should be able to tell which model is running without
         * reading a control: a tire, an arrow, or a bar of arrows. */
        function drawLoadSection(G, danger, y0) {
            var cx = G.cx, contactHalf = G.contactHalf;
            var kind = state.loadKind;

            /* ground contact shadow, same for all three */
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.ellipse(cx, y0 + 2.5, Math.max(contactHalf, 4) * 1.3 + 3, 3, 0, 0, 6.3);
            ctx.fill();

            if (kind === 'point') {
                var h = 54;
                ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.moveTo(cx, y0 - h); ctx.lineTo(cx, y0 - 3); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cx, y0); ctx.lineTo(cx - 5, y0 - 9); ctx.lineTo(cx + 5, y0 - 9);
                ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.arc(cx, y0, 2.6, 0, 6.3); ctx.fill();
                return { top: y0 - h };
            }

            if (kind === 'line') {
                /* the segment as it crosses the section plane */
                var th = gearParams.theta * Math.PI / 180;
                var halfW = Math.max(Math.abs(0.5 * gearParams.L * Math.cos(th)) * view.scale, 3);
                var hh = 44;
                ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 1.2;
                var nA = clamp(Math.round(halfW / 6), 2, 12);
                for (var k = 0; k < nA; k++) {
                    var ax = cx - halfW + 2 * halfW * (k + 0.5) / nA;
                    ctx.beginPath(); ctx.moveTo(ax, y0 - hh + 8); ctx.lineTo(ax, y0 - 4); ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(ax, y0 - 1); ctx.lineTo(ax - 2.3, y0 - 5); ctx.lineTo(ax + 2.3, y0 - 5);
                    ctx.closePath(); ctx.fill();
                }
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.moveTo(cx - halfW, y0 - hh + 8); ctx.lineTo(cx + halfW, y0 - hh + 8);
                ctx.stroke();
                /* the knife edge itself */
                ctx.fillStyle = danger;
                roundRect(ctx, cx - halfW, y0 - 2.5, 2 * halfW, 5, 2); ctx.fill();
                return { top: y0 - hh };
            }

            /* circular imprint: a tire with its contact patch */
            var tireHalf = Math.max(contactHalf, 10);
            var tireH = clamp(tireHalf * 1.35, 22, 54);
            var gap = clamp(tireH * 0.34, 9, 16);
            var tireBot = y0 - gap, ty = tireBot - tireH;

            ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 1;
            var nB = clamp(Math.round(contactHalf / 7), 2, 9);
            for (var q = 0; q < nB; q++) {
                var bx = cx - contactHalf + 2 * contactHalf * (q + 0.5) / nB;
                ctx.beginPath(); ctx.moveTo(bx, tireBot + 1); ctx.lineTo(bx, y0 - 4); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(bx, y0 - 1); ctx.lineTo(bx - 2.3, y0 - 5); ctx.lineTo(bx + 2.3, y0 - 5);
                ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = danger;
            roundRect(ctx, cx - contactHalf, y0 - 2, 2 * contactHalf, 4, 1.5); ctx.fill();

            var rad = Math.min(tireHalf * 0.45, 11);
            var grad = ctx.createLinearGradient(cx - tireHalf, 0, cx + tireHalf, 0);
            grad.addColorStop(0, '#111418'); grad.addColorStop(0.5, '#474d57'); grad.addColorStop(1, '#111418');
            roundRect(ctx, cx - tireHalf, ty, 2 * tireHalf, tireH, rad);
            ctx.fillStyle = grad; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();

            ctx.save();
            roundRect(ctx, cx - tireHalf, ty, 2 * tireHalf, tireH, rad); ctx.clip();
            ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.4;
            var grooves = clamp(Math.round(tireHalf / 5), 3, 10);
            for (var gi = 1; gi < grooves; gi++) {
                var gx = cx - tireHalf + 2 * tireHalf * gi / grooves;
                ctx.beginPath(); ctx.moveTo(gx, ty + 1.5); ctx.lineTo(gx, ty + tireH - 1.5); ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(cx - tireHalf + rad, ty + 2.5); ctx.lineTo(cx + tireHalf - rad, ty + 2.5); ctx.stroke();
            ctx.restore();
            return { top: ty, mid: ty + tireH / 2 };
        }

        /* The interface state, written on the interface. Three words, a
         * click apart: the condition below a layer is a modeling decision
         * a student changes half a dozen times in one sitting, and walking
         * to a side panel for it every time is the friction that stops them
         * trying the other two. */
        function itfLabel(slip) {
            if (slip <= 0) return 'bonded';
            if (slip >= 1) return 'free';
            return 'slip ' + sig(slip, 2);
        }

        function drawViewport() {
            if (!ctx) return;
            var box = worldBox();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, vpW, vpH);
            itfChips = [];
            var ink2 = cssVar('--lp-ink2'), ink3 = cssVar('--lp-ink3');
            var lineC = cssVar('--lp-line'), accent = cssVar('--lp-accent');

            var xL = w2sx(box.xL), xR = w2sx(box.xR), y0 = w2sy(0);
            var n = state.layers.length;

            /* layers */
            var z = 0, i, L;
            for (i = 0; i < n; i++) {
                L = state.layers[i];
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

            /* the selected layer, outlined */
            if (selLayer != null) {
                z = 0;
                for (i = 0; i < n; i++) {
                    L = state.layers[i];
                    var sT = z, sB = i < n - 1 ? z + L.h : box.zMax;
                    z = sB;
                    if (L.id !== selLayer) continue;
                    ctx.save();
                    ctx.strokeStyle = accent; ctx.lineWidth = 2;
                    ctx.strokeRect(xL + 1, w2sy(sT) + 1, xR - xL - 2, w2sy(sB) - w2sy(sT) - 2);
                    ctx.restore();
                }
            }

            /* interfaces, their labels and their state chips */
            z = 0;
            ctx.font = '600 12px ' + uiFont();
            for (i = 0; i < n; i++) {
                var L2 = state.layers[i];
                var zTop2 = z;
                var zBot2 = i < n - 1 ? z + L2.h : box.zMax;
                z = zBot2;
                var yT2 = w2sy(zTop2), yB2 = w2sy(zBot2);
                if (i > 0) {
                    var itf = state.interfaces[i - 1] || { slip: 0 };
                    ctx.strokeStyle = lineC;
                    ctx.lineWidth = 1;
                    if (itf.slip >= 1) ctx.setLineDash([6, 5]);
                    else if (itf.slip > 0) ctx.setLineDash([2, 3]);
                    else ctx.setLineDash([]);
                    ctx.beginPath(); ctx.moveTo(xL, yT2); ctx.lineTo(xR, yT2); ctx.stroke();
                    ctx.setLineDash([]);

                    /* the clickable state chip, right-aligned inside the box */
                    var txt = itfLabel(itf.slip);
                    ctx.font = '600 10px ' + uiFont();
                    var cw = ctx.measureText(txt).width + 16;
                    /* 96px of clearance on the right: the colorbar is
                     * drawn over this same canvas, at the right edge, and a
                     * chip tucked under it is a control nobody can press. */
                    var chipRight = Math.min(xR - 12, vpW - 96);
                    var chip = { x: chipRight - cw, y: yT2 - 9, w: cw, h: 18, i: i - 1 };
                    if (chip.y > 4 && chip.y < vpH - 22) {
                        itfChips.push(chip);
                        ctx.fillStyle = itf.slip > 0 ? rgba('--lp-warn', 0.9) : rgba('--lp-bg1', 0.92);
                        roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 9); ctx.fill();
                        ctx.strokeStyle = itf.slip > 0 ? cssVar('--lp-warn') : lineC;
                        ctx.lineWidth = 1; ctx.stroke();
                        ctx.fillStyle = itf.slip > 0 ? '#fff' : ink2;
                        ctx.textAlign = 'center';
                        ctx.fillText(txt, chip.x + chip.w / 2, chip.y + 12.5);
                        ctx.textAlign = 'left';
                    }
                    ctx.font = '600 12px ' + uiFont();
                }
                /* label */
                if (yB2 - yT2 > 17) {
                    var midY = (yT2 + Math.min(yB2, vpH)) / 2;
                    var lbl = L2.name;
                    var meta = (i < n - 1 ? sig(toDisp('len', L2.h), 3) + ' ' + unit('len') + ' · ' : '∞ · ') +
                        'E ' + sig(toDisp('modulus', L2.E), 3) + ' ' + unit('modulus') + ' · ν ' + L2.nu;
                    var tw = Math.max(ctx.measureText(lbl).width, ctx.measureText(meta).width);
                    ctx.fillStyle = 'rgba(0,0,0,0.35)';
                    ctx.fillRect(xL + 8, midY - 15, tw + 14, 32);
                    ctx.fillStyle = '#f2f5fa';
                    ctx.fillText(lbl, xL + 15, midY - 2);
                    ctx.fillStyle = 'rgba(242,245,250,0.75)';
                    ctx.font = '11px ' + monoFont();
                    ctx.fillText(meta, xL + 15, midY + 12);
                    ctx.font = '600 12px ' + uiFont();
                }
            }

            /* surface line */
            ctx.strokeStyle = ink2;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(xL, y0); ctx.lineTo(xR, y0); ctx.stroke();

            /* deflected surface */
            if (state.settings.showBasin && results.basin && results.basin.length) {
                var wMax = 0;
                results.basin.forEach(function (p) { if (p && isFinite(p.disp.uz)) wMax = Math.max(wMax, Math.abs(p.disp.uz)); });
                if (wMax > 1e-9) {
                    var exg = 0.11 * box.zMax / wMax;
                    ctx.strokeStyle = accent;
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    var started = false;
                    results.basin.forEach(function (p) {
                        if (!p || !isFinite(p.disp.uz)) return;
                        var sx = w2sx(p.x), sy = w2sy(p.disp.uz * exg);
                        if (!started) { ctx.moveTo(sx, sy); started = true; }
                        else ctx.lineTo(sx, sy);
                    });
                    ctx.stroke();
                    ctx.fillStyle = ink3;
                    ctx.font = '10px ' + monoFont();
                    ctx.fillText('deflected surface ×' + sig(exg, 2), xR - 190, y0 - 8);
                }
            }

            /* loads. Off-section loads fade with distance and draw behind,
             * so the ones on the section plane read clearly. */
            var danger = cssVar('--lp-danger');
            var minTop = Infinity, sumX = 0, yMax = 1;
            state.loads.forEach(function (w) { yMax = Math.max(yMax, Math.abs(w.y - state.ySec)); });
            var fadeScale = Math.max(yMax, 120);
            var geoms = state.loads.map(function (w, wi) {
                var a = loadA(w);
                var cx = w2sx(w.x);
                var contactHalf = Math.max(a * view.scale, 2.5);
                var dy = Math.abs(w.y - state.ySec);
                sumX += cx;
                return {
                    wi: wi, cx: cx, contactHalf: contactHalf, dy: dy,
                    alpha: clamp(1 - (dy / fadeScale) * 0.62, 0.3, 1)
                };
            });
            geoms.slice().sort(function (a, b) { return b.dy - a.dy; }).forEach(function (G) {
                ctx.save();
                ctx.globalAlpha = G.alpha;
                var geo = drawLoadSection(G, danger, y0);
                minTop = Math.min(minTop, geo.top);
                /* Index tag. A tire has a body to sit in the middle of; an
                 * arrow and a knife edge do not, so theirs goes BESIDE the
                 * stem rather than above it, which is where the shared load
                 * caption goes and where the two collided. */
                ctx.font = '700 10px ' + monoFont();
                var tag = 'L' + (G.wi + 1);
                var tw = ctx.measureText(tag).width;
                var inBody = geo.mid != null;
                var tagY = inBody ? geo.mid : geo.top + 14;
                var tagX = inBody ? G.cx : G.cx + tw / 2 + 11;
                ctx.fillStyle = 'rgba(15,24,41,0.9)';
                roundRect(ctx, tagX - tw / 2 - 5, tagY - 8, tw + 10, 16, 4); ctx.fill();
                ctx.fillStyle = '#e8eef9'; ctx.textAlign = 'center';
                ctx.fillText(tag, tagX, tagY + 3.5);
                ctx.textAlign = 'left';
                ctx.restore();
            });

            /* shared load caption above the gear */
            if (geoms.length) {
                var w0 = state.loads[0];
                var allSame = state.loads.every(function (w) { return w.F === w0.F && w.p === w0.p; });
                var capX = sumX / geoms.length, capY = minTop - 9;
                ctx.font = '600 11px ' + uiFont();
                var kind = kindById(state.loadKind);
                var cap = state.loads.length + ' × ' + kind.short.toLowerCase() +
                    (state.loads.length > 1 ? 's' : '') + ' · ';
                if (allSame) {
                    cap += sig(toDisp('force', w0.F), 4) + ' ' + unit('force');
                    if (state.loadKind === 'circle') {
                        cap += ' · ' + sig(toDisp('stress', w0.p), 4) + ' ' + unit('stress') +
                            ' · a ' + sig(toDisp('len', loadA(w0)), 3) + ' ' + unit('len');
                    } else if (state.loadKind === 'line') {
                        cap += ' · ' + sig(toDisp('perlen', w0.F / gearParams.L), 4) + ' ' + unit('perlen') +
                            ' over ' + sig(toDisp('len', gearParams.L), 3) + ' ' + unit('len');
                    }
                } else cap += 'mixed loads';
                var cw2 = ctx.measureText(cap).width;
                ctx.fillStyle = 'rgba(15,24,41,0.82)';
                roundRect(ctx, capX - cw2 / 2 - 8, capY - 13, cw2 + 16, 18, 6); ctx.fill();
                ctx.strokeStyle = 'rgba(224,82,82,0.45)'; ctx.lineWidth = 1; ctx.stroke();
                ctx.fillStyle = '#e8eef9'; ctx.textAlign = 'center';
                ctx.fillText(cap, capX, capY);
                ctx.textAlign = 'left';
            }

            /* depth rail */
            ctx.strokeStyle = lineC;
            ctx.fillStyle = ink3;
            ctx.font = '10px ' + monoFont();
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

            /* evaluation points, colored to match their column in the table */
            state.points.forEach(function (p, pi) {
                var sx = w2sx(p.x), sy = w2sy(p.z);
                var col = ptColor(pi);
                var isSel = selPoint === p.id;
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(sx, sy, isSel ? 4 : 3, 0, 6.3); ctx.fill();
                ctx.strokeStyle = col;
                ctx.lineWidth = isSel ? 2 : 1.4;
                ctx.beginPath(); ctx.arc(sx, sy, isSel ? 8 : 6.5, 0, 6.3); ctx.stroke();
                ctx.fillStyle = col;
                ctx.font = '700 10px ' + monoFont();
                ctx.fillText('P' + (pi + 1), sx + 10, sy - 7);
            });

            /* the live readout of whatever is being dragged */
            if (dragNote) {
                ctx.font = '600 11px ' + monoFont();
                var nw = ctx.measureText(dragNote.text).width;
                ctx.fillStyle = cssVar('--lp-accent');
                roundRect(ctx, dragNote.x - nw / 2 - 8, dragNote.y - 10, nw + 16, 20, 6); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
                ctx.fillText(dragNote.text, dragNote.x, dragNote.y + 4);
                ctx.textAlign = 'left';
            }

            /* infinity marker */
            ctx.fillStyle = ink3;
            ctx.font = '14px ' + uiFont();
            ctx.fillText('z → ∞', xL + 10, w2sy(box.zMax) - 10);

            drawPlan();
            drawColorbar();
        }

        /* ---------- plan inset (top-down load map) ---------- */
        function niceStep(raw) {
            if (!(raw > 0)) return 1;
            var e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
            return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
        }
        function planSpacings() {
            var ws = state.loads, Sd = null, St = null;
            for (var i = 0; i < ws.length; i++) for (var j = i + 1; j < ws.length; j++) {
                var dx = Math.abs(ws[i].x - ws[j].x), dy = Math.abs(ws[i].y - ws[j].y);
                if (dy < 1e-6 && dx > 1e-6 && (Sd == null || dx < Sd)) Sd = dx;
                if (dx < 1e-6 && dy > 1e-6 && (St == null || dy < St)) St = dy;
            }
            return { Sd: Sd, St: St };
        }
        function sizePlanCanvas(pc) {
            var rect = pc.getBoundingClientRect();
            var W = Math.max(80, Math.round(rect.width)), H = Math.max(60, Math.round(rect.height));
            var d = win.devicePixelRatio || 1;
            if (pc.width !== Math.round(W * d) || pc.height !== Math.round(H * d)) {
                pc.width = Math.round(W * d); pc.height = Math.round(H * d);
            }
            return { W: W, H: H, d: d };
        }
        function drawPlan() {
            var panel = $('lp-plan-panel'), pc = $('lp-plan');
            if (!pc || !panel || panel.classList.contains('is-collapsed')) return;
            var dim = sizePlanCanvas(pc), W = dim.W, H = dim.H;
            var g = pc.getContext('2d');
            g.setTransform(dim.d, 0, 0, dim.d, 0, 0);
            g.clearRect(0, 0, W, H);

            var padL = 28, padR = 10, padT = 10, padB = 20;
            var plotW = W - padL - padR, plotH = H - padT - padB;

            /* isotropic world bounds around footprints + section */
            var xs = [], ys = [];
            var kind = state.loadKind;
            var th = gearParams.theta * Math.PI / 180;
            var ex = Math.cos(th), ey = Math.sin(th), hl = 0.5 * gearParams.L;
            state.loads.forEach(function (w) {
                if (kind === 'circle') {
                    var a = loadA(w); xs.push(w.x - a, w.x + a); ys.push(w.y - a, w.y + a);
                } else if (kind === 'line') {
                    xs.push(w.x - hl * ex, w.x + hl * ex); ys.push(w.y - hl * ey, w.y + hl * ey);
                } else { xs.push(w.x); ys.push(w.y); }
            });
            if (!state.loads.length) { xs.push(-200, 200); ys.push(-200, 200); }
            ys.push(state.ySec);
            var xc = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
            var yc = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
            var xspan = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 120) * 1.35;
            var yspan = Math.max(Math.max.apply(null, ys) - Math.min.apply(null, ys), 120) * 1.35;
            var s = Math.min(plotW / xspan, plotH / yspan);
            var xmin = xc - (plotW / s) / 2;
            var ymin = yc - (plotH / s) / 2, ymax = yc + (plotH / s) / 2;
            var xmax = xc + (plotW / s) / 2;
            function px(x) { return padL + (x - xmin) * s; }
            function py(y) { return padT + (y - ymin) * s; }
            pc._px = px; pc._py = py; pc._s = s; pc._ymin = ymin;
            pc._plotT = padT; pc._plotB = padT + plotH;

            var ink3 = cssVar('--lp-ink3'), ink2 = cssVar('--lp-ink2');
            var lineC = cssVar('--lp-line'), soft = cssVar('--lp-line-soft');
            var accent = cssVar('--lp-accent'), danger = cssVar('--lp-danger');
            var mono = monoFont();

            g.fillStyle = cssVar('--lp-bg0');
            g.fillRect(padL, padT, plotW, plotH);

            /* grid + tick labels */
            var step = niceStep((xmax - xmin) / 4);
            g.font = '8px ' + mono; g.lineWidth = 1;
            g.textBaseline = 'middle';
            var gx, gy, X, Y;
            for (gx = Math.ceil(xmin / step) * step; gx <= xmax; gx += step) {
                X = px(gx);
                g.strokeStyle = Math.abs(gx) < 1e-6 ? lineC : soft;
                g.beginPath(); g.moveTo(X, padT); g.lineTo(X, padT + plotH); g.stroke();
                g.fillStyle = ink3; g.textAlign = 'center'; g.textBaseline = 'top';
                g.fillText(sig(toDisp('len', gx), 3), X, padT + plotH + 3);
            }
            for (gy = Math.ceil(ymin / step) * step; gy <= ymax; gy += step) {
                Y = py(gy);
                g.strokeStyle = Math.abs(gy) < 1e-6 ? lineC : soft;
                g.beginPath(); g.moveTo(padL, Y); g.lineTo(padL + plotW, Y); g.stroke();
                g.fillStyle = ink3; g.textAlign = 'right'; g.textBaseline = 'middle';
                g.fillText(sig(toDisp('len', gy), 3), padL - 3, Y);
            }
            g.strokeStyle = lineC; g.lineWidth = 1; g.strokeRect(padL, padT, plotW, plotH);
            g.textBaseline = 'alphabetic';

            /* footprints + connectors (clipped) */
            g.save();
            g.beginPath(); g.rect(padL, padT, plotW, plotH); g.clip();
            g.strokeStyle = 'rgba(224,82,82,0.35)'; g.lineWidth = 1;
            for (var i = 0; i < state.loads.length; i++) for (var j = i + 1; j < state.loads.length; j++) {
                var a2 = state.loads[i], b2 = state.loads[j];
                if (Math.abs(a2.y - b2.y) < 1e-6 || Math.abs(a2.x - b2.x) < 1e-6) {
                    g.beginPath(); g.moveTo(px(a2.x), py(a2.y)); g.lineTo(px(b2.x), py(b2.y)); g.stroke();
                }
            }
            state.loads.forEach(function (w, wi) {
                var cX = px(w.x), cY = py(w.y);
                if (kind === 'circle') {
                    var a = loadA(w), R = Math.max(2.5, a * s);
                    var rg = g.createRadialGradient(cX - R * 0.3, cY - R * 0.3, 1, cX, cY, R);
                    rg.addColorStop(0, 'rgba(242,128,128,0.9)'); rg.addColorStop(1, 'rgba(196,58,58,0.55)');
                    g.fillStyle = rg;
                    g.beginPath(); g.arc(cX, cY, R, 0, 6.3); g.fill();
                    g.strokeStyle = danger; g.lineWidth = 1.2; g.stroke();
                    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.8;
                    g.beginPath();
                    g.moveTo(cX - R * 0.5, cY); g.lineTo(cX + R * 0.5, cY);
                    g.moveTo(cX, cY - R * 0.5); g.lineTo(cX, cY + R * 0.5); g.stroke();
                    if (R > 6) {
                        g.fillStyle = '#fff'; g.font = '700 8px ' + mono;
                        g.textAlign = 'center'; g.textBaseline = 'middle';
                        g.fillText('L' + (wi + 1), cX, cY);
                        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
                    }
                } else if (kind === 'line') {
                    g.strokeStyle = danger; g.lineWidth = 3; g.lineCap = 'round';
                    g.beginPath();
                    g.moveTo(px(w.x - hl * ex), py(w.y - hl * ey));
                    g.lineTo(px(w.x + hl * ex), py(w.y + hl * ey));
                    g.stroke();
                    g.lineCap = 'butt';
                    g.fillStyle = '#fff';
                    g.beginPath(); g.arc(cX, cY, 1.8, 0, 6.3); g.fill();
                } else {
                    g.fillStyle = danger;
                    g.beginPath(); g.arc(cX, cY, 3.4, 0, 6.3); g.fill();
                    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.9;
                    g.beginPath(); g.arc(cX, cY, 5.6, 0, 6.3); g.stroke();
                }
            });
            /* evaluation points, in their own colors */
            state.points.forEach(function (p, pi) {
                g.fillStyle = ptColor(pi);
                g.beginPath(); g.arc(px(p.x), py(p.y), 2.6, 0, 6.3); g.fill();
            });
            g.restore();

            /* spacing readout */
            var sp = planSpacings(), parts = [];
            if (sp.Sd != null) parts.push('Sd ' + sig(toDisp('len', sp.Sd), 3));
            if (sp.St != null) parts.push('St ' + sig(toDisp('len', sp.St), 3));
            if (parts.length) {
                var txt = parts.join('   ') + ' ' + unit('len');
                g.font = '8px ' + mono; var tw = g.measureText(txt).width;
                g.fillStyle = 'rgba(15,24,41,0.82)';
                roundRect(g, padL + 4, padT + plotH - 16, tw + 10, 13, 3); g.fill();
                g.fillStyle = '#e8eef9'; g.textAlign = 'left'; g.textBaseline = 'middle';
                g.fillText(txt, padL + 9, padT + plotH - 9);
                g.textBaseline = 'alphabetic';
            }

            /* section line + drag handle */
            var syl = py(state.ySec);
            g.strokeStyle = accent; g.lineWidth = 1.6; g.setLineDash([5, 3]);
            g.beginPath(); g.moveTo(padL, syl); g.lineTo(padL + plotW, syl); g.stroke();
            g.setLineDash([]);
            g.fillStyle = accent;
            g.beginPath(); g.arc(padL + plotW - 4, syl, 3.5, 0, 6.3); g.fill();
            g.font = '700 8px ' + mono; g.textAlign = 'right';
            g.fillText('SECTION y ' + sig(toDisp('len', state.ySec), 3), padL + plotW - 10, syl - 4);
            g.textAlign = 'left';
            void ink2;
        }

        /* ---------- colorbar ----------
         * The scale for the contoured field. It carries the SYMBOL, drawn
         * rather than spelled, because "szz" beside a stress bulb is the
         * one label on the figure a reader has to decode. */
        function drawColorbar() {
            var cb = $('lp-colorbar');
            if (!cb) return;
            var g = cb.getContext('2d');
            g.clearRect(0, 0, cb.width, cb.height);
            if (!contour || !state.settings.showContour) return;
            var f = contour.field;
            var x0 = 10, w = 14, y0 = 30, h = cb.height - 56;
            for (var i = 0; i < h; i++) {
                var t = 1 - i / (h - 1);
                var li = Math.round(t * 255) * 3;
                g.fillStyle = 'rgb(' + contour.lut[li] + ',' + contour.lut[li + 1] + ',' + contour.lut[li + 2] + ')';
                g.fillRect(x0, y0 + i, w, 1.5);
            }
            g.strokeStyle = cssVar('--lp-line');
            g.lineWidth = 1;
            g.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);

            g.fillStyle = cssVar('--lp-ink');
            drawSym(g, f.sym, x0, 16, 13);

            g.fillStyle = cssVar('--lp-ink2');
            g.font = '9px ' + monoFont();
            var mid = (contour.vmax + contour.vmin) / 2;
            [[contour.vmax, y0 + 8], [mid, y0 + h / 2 + 3], [contour.vmin, y0 + h - 2]].forEach(function (t2) {
                g.fillText(sig(toDisp(f.q, t2[0]), 3), x0 + w + 5, t2[1]);
                g.beginPath();
                g.moveTo(x0 + w, t2[1] - 3); g.lineTo(x0 + w + 3, t2[1] - 3);
                g.strokeStyle = cssVar('--lp-line'); g.stroke();
            });
            g.fillStyle = cssVar('--lp-ink3');
            g.fillText(unit(f.q), x0, y0 + h + 15);
        }

        /* =================== viewport interaction =================== */
        /* A dragged number lands on a ROUND one. A fitted section puts ten
           millimeters or more under every pixel, so an unsnapped drag of an
           interface reads 972.23 mm, and a thickness nobody would type is a
           thickness nobody can check. The step is the 1/2/5 rung just below
           what one pixel is worth, taken in the units on screen: always
           finer than the hand, never coarser than the drawing, and it
           follows the zoom, so the same drag is coarse on a whole section
           and fine on a close-up. */
        function dragSnap(q, v) {
            var perPx = toDisp(q, 1 / view.scale);
            if (!(perPx > 0) || !isFinite(perPx)) return v;
            var e = Math.pow(10, Math.floor(Math.log(perPx) / Math.LN10));
            var m = perPx / e;
            var step = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
            return fromDisp(q, Math.round(toDisp(q, v) / step) * step);
        }
        function snapPoint(p) {
            var zb = interfaceZs();
            var tolPix = 7 / view.scale;
            for (var i = 0; i < zb.length; i++) {
                if (Math.abs(p.z - zb[i]) < tolPix) { p.z = zb[i]; return; }
            }
            if (Math.abs(p.z) < tolPix) p.z = 0;
        }
        function hitInterface(my) {
            var zb = interfaceZs();
            for (var i = 0; i < zb.length; i++) {
                if (Math.abs(w2sy(zb[i]) - my) < 6) return i;
            }
            return -1;
        }
        function hitChip(mx, my) {
            for (var i = 0; i < itfChips.length; i++) {
                var c = itfChips[i];
                if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return c.i;
            }
            return -1;
        }
        function hitLayer(my) {
            var zw = s2wy(my);
            if (zw < 0) return -1;
            var z = 0;
            for (var i = 0; i < state.layers.length - 1; i++) {
                z += state.layers[i].h;
                if (zw < z) return i;
            }
            return state.layers.length - 1;
        }
        /* The three interface conditions, one click apart. */
        function cycleInterface(i) {
            var f = state.interfaces[i];
            if (!f) return;
            mutate(function () {
                var s = f.slip || 0;
                f.slip = s <= 0 ? 0.5 : (s < 1 ? 1 : 0);
                delete f.bond; delete f.k;
            });
        }

        function setupViewport() {
            cv = $('lp-cv');
            ctx = cv.getContext('2d');
            var vp = $('lp-viewport');

            function resize() {
                dpr = win.devicePixelRatio || 1;
                var r = vp.getBoundingClientRect();
                vpW = r.width; vpH = r.height;
                cv.width = Math.round(vpW * dpr);
                cv.height = Math.round(vpH * dpr);
                fitView();
            }
            var ro = new ResizeObserver(debounce(resize, 120));
            ro.observe(vp);
            teardown.push(function () { ro.disconnect(); });
            resize();

            var drag = null;
            /* Pointer events, not mouse events. A touch drag never produces a
               mousemove (the browser scrolls the page instead), so on a phone
               or tablet the section could not be panned and an analysis point
               could not be moved. PointerEvent covers mouse, touch and pen
               from one path, and #lp-cv sets touch-action:none so the gesture
               is delivered here rather than taken by the scroller. */
            on(cv, 'pointerdown', function (e) {
                var mx = e.offsetX, my = e.offsetY;

                /* 1. an evaluation point */
                var hit = null;
                state.points.forEach(function (p) {
                    var dx = w2sx(p.x) - mx, dy = w2sy(p.z) - my;
                    if (Math.hypot(dx, dy) < 10) hit = p;
                });
                if (hit) {
                    selPoint = hit.id;
                    drag = { type: 'point', p: hit, moved: false };
                    drawViewport();
                    return;
                }

                /* 2. an interface state chip */
                var ci = hitChip(mx, my);
                if (ci >= 0) { drag = { type: 'chip', i: ci, moved: false }; return; }

                /* 3. an interface line: drag it to set the thickness above */
                var ii = hitInterface(my);
                if (ii >= 0) {
                    var zTop = 0;
                    for (var q = 0; q < ii; q++) zTop += state.layers[q].h;
                    drag = { type: 'itf', i: ii, zTop: zTop, moved: false };
                    return;
                }

                /* 4. otherwise pan, and remember what a click would select */
                selPoint = null;
                drag = {
                    type: 'pan', sx: mx, sy: my, ox: view.ox, oy: view.oy,
                    layer: hitLayer(my), moved: false
                };
                drawViewport();
            });
            on(win, 'pointermove', function (e) {
                if (!drag) return;
                var r = cv.getBoundingClientRect();
                var mx = e.clientX - r.left, my = e.clientY - r.top;
                if (drag.type === 'pan') {
                    if (Math.abs(mx - drag.sx) + Math.abs(my - drag.sy) > 3) drag.moved = true;
                    view.ox = drag.ox + (mx - drag.sx);
                    view.oy = drag.oy + (my - drag.sy);
                    drawViewport();
                } else if (drag.type === 'point') {
                    drag.moved = true;
                    drag.p.x = dragSnap('len', s2wx(mx));
                    drag.p.z = Math.max(0, dragSnap('len', s2wy(my)));
                    snapPoint(drag.p);
                    renderPointsList();
                    drawViewport();
                } else if (drag.type === 'itf') {
                    drag.moved = true;
                    var L = state.layers[drag.i];
                    L.h = clamp(dragSnap('len', s2wy(my) - drag.zTop), 5, 5000);
                    dragNote = {
                        x: (w2sx(worldBox().xL) + w2sx(worldBox().xR)) / 2,
                        y: w2sy(drag.zTop + L.h) - 18,
                        text: L.name + '  ' + sig(toDisp('len', L.h), 4) + ' ' + unit('len')
                    };
                    renderLayers();
                    drawViewport();
                }
            });
            on(win, 'pointerup', function () {
                if (!drag) { dragNote = null; return; }
                if (drag.type === 'point' && drag.moved) mutate(function () { /* committed in place */ });
                else if (drag.type === 'itf' && drag.moved) { dragNote = null; mutate(function () { }); }
                else if (drag.type === 'chip') cycleInterface(drag.i);
                else if (drag.type === 'pan' && !drag.moved && drag.layer >= 0) {
                    var L = state.layers[drag.layer];
                    selLayer = (selLayer === L.id) ? null : L.id;
                    renderLayers();
                    drawViewport();
                }
                dragNote = null;
                drag = null;
            });
            on(cv, 'dblclick', function (e) {
                var p = { id: nid(), x: dragSnap('len', s2wx(e.offsetX)), y: state.ySec,
                    z: Math.max(0, dragSnap('len', s2wy(e.offsetY))) };
                snapPoint(p);
                mutate(function (st) { st.points.push(p); });
                selPoint = p.id;
            });
            on(cv, 'wheel', function (e) {
                e.preventDefault();
                var r = cv.getBoundingClientRect();
                var mx = e.clientX - r.left, my = e.clientY - r.top;
                var wx = s2wx(mx), wy = s2wy(my);
                var f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
                view.scale = clamp(view.scale * f, 0.02, 40);
                view.ox = mx - wx * view.scale;
                view.oy = my - wy * view.scale;
                drawViewport();
            }, { passive: false });
            on(cv, 'pointermove', function (e) {
                if (!drag) {
                    cv.style.cursor = hitChip(e.offsetX, e.offsetY) >= 0 ? 'pointer'
                        : (hitInterface(e.offsetY) >= 0 ? 'ns-resize' : 'crosshair');
                }
                var x = s2wx(e.offsetX), z = s2wy(e.offsetY);
                var out = 'x ' + sig(toDisp('len', x), 5) + '  z ' + sig(toDisp('len', z), 5) + ' ' + unit('len');
                var v = sampleContour(x, z);
                if (v != null && contour) {
                    out += '   ' + symText(contour.field.sym) + ' ' + sig(toDisp(contour.field.q, v), 4) + ' ' + unit(contour.field.q);
                }
                var c = $('lp-coords');
                if (c) c.textContent = out;
            });

            /* plan-view section drag */
            var pc = $('lp-plan');
            var planDrag = false;
            function planY(e) {
                var r = pc.getBoundingClientRect();
                var y = e.clientY - r.top;
                if (!pc._py) return null;
                return (y - pc._plotT) / pc._s + pc._ymin;
            }
            on(pc, 'pointerdown', function (e) {
                planDrag = true;
                pc.setPointerCapture(e.pointerId);
                var yv = planY(e);
                if (yv != null) { state.ySec = yv; drawViewport(); }
            });
            on(pc, 'pointermove', function (e) {
                if (!planDrag) return;
                var yv = planY(e);
                if (yv != null) { state.ySec = yv; drawViewport(); }
            });
            on(pc, 'pointerup', function () {
                if (!planDrag) return;
                planDrag = false;
                mutate(function () { /* ySec already set */ });
            });

            $('lp-fit').addEventListener('click', fitView);
            $('lp-zin').addEventListener('click', function () { view.scale *= 1.2; drawViewport(); });
            $('lp-zout').addEventListener('click', function () { view.scale /= 1.2; drawViewport(); });
            $('lp-show-basin').addEventListener('change', function (e) {
                state.settings.showBasin = e.target.checked; drawViewport(); saveLocal();
            });
            $('lp-show-contour').addEventListener('change', function (e) {
                state.settings.showContour = e.target.checked; drawViewport(); saveLocal();
            });
            $('lp-alpha').addEventListener('input', function (e) {
                state.settings.alpha = parseFloat(e.target.value); drawViewport();
            });
        }

        /* =================== panels =================== */
        /* `labelHtml` is markup, so a field can be labeled with the symbol
         * it edits rather than with a transliteration of it. */
        function numField(labelHtml, value, step, onchange, titleText, readOnly) {
            var f = el('label', 'lp-field' + (readOnly ? ' is-derived' : ''));
            f.appendChild(el('span', null, labelHtml));
            var inp = doc.createElement('input');
            inp.type = 'number';
            inp.step = step || 'any';
            inp.value = value;
            if (titleText) inp.title = titleText;
            if (readOnly) { inp.readOnly = true; inp.tabIndex = -1; }
            else inp.addEventListener('change', function () {
                var v = parseFloat(inp.value);
                if (isFinite(v)) onchange(v);
            });
            f.appendChild(inp);
            return f;
        }

        function renderPanels() {
            renderLayers();
            renderInterfaces();
            renderLoadKind();
            renderGearParams();
            renderLoads();
            renderPointsList();
            renderChecks();
            $('lp-project-name').value = state.name;
            $('lp-layer-count').textContent = state.layers.length;
            $('lp-load-count').textContent = state.loads.length;
            $('lp-point-count').textContent = state.points.length || '';
        }

        function materialSelect(L) {
            var sel = el('select', 'lp-select lp-layer-mat');
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
            return sel;
        }

        var expandedLayer = null;
        function layerInsertZone(atIndex) {
            var z = el('div', 'lp-layer-insert');
            z.setAttribute('role', 'button');
            z.setAttribute('tabindex', '0');
            z.setAttribute('aria-label', 'Insert a layer here');
            z.title = 'Insert a layer here';
            z.innerHTML =
                '<span class="lp-layer-insert-line"></span>' +
                '<span class="lp-layer-insert-btn"><i class="fas fa-plus"></i></span>' +
                '<span class="lp-layer-insert-line"></span>';
            function doInsert() {
                mutate(function (st) {
                    st.layers.splice(atIndex, 0, layerFromMat('base', { h: 150 }));
                });
            }
            z.addEventListener('click', doInsert);
            z.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doInsert(); }
            });
            return z;
        }

        /* The structure panel. Delete is IN the row rather than behind the
         * overflow menu: adding and removing layers is the commonest edit in
         * the tool, and a destructive action one click deep with an undo one
         * key away is the right trade for that. Rename, reorder and
         * duplicate stay in the menu, where they are wanted once. */
        function renderLayers() {
            var hostEl = $('lp-layers');
            hostEl.innerHTML = '';
            var n = state.layers.length;
            state.layers.forEach(function (L, i) {
                var isLast = i === n - 1;
                if (i > 0) hostEl.appendChild(layerInsertZone(i));
                var card = el('div', 'lp-layer' + (isLast ? ' is-subgrade' : '') +
                    (L.id === selLayer ? ' is-sel' : ''));
                card.addEventListener('click', function (e) {
                    if (e.target.closest('button, select, input')) return;
                    selLayer = (selLayer === L.id) ? null : L.id;
                    renderLayers();
                    drawViewport();
                });

                var head = el('div', 'lp-layer-head');
                var grip = el('span', 'lp-layer-grip',
                    isLast ? '<i class="fas fa-anchor" title="Subgrade, fixed at the bottom"></i>'
                        : '<i class="fas fa-grip-vertical"></i>');
                head.appendChild(grip);
                var chip = el('span', 'lp-layer-chip');
                chip.style.background = L.color;
                head.appendChild(chip);
                head.appendChild(materialSelect(L));

                var del = el('button', 'lp-layer-del', '<i class="fas fa-trash"></i>');
                del.title = isLast ? 'The subgrade cannot be removed' : 'Delete this layer';
                del.disabled = isLast || n <= 1;
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    mutate(function (st) { st.layers.splice(i, 1); });
                });
                head.appendChild(del);

                var more = el('button', 'lp-layer-more' + (expandedLayer === L.id ? ' is-open' : ''),
                    '<i class="fas fa-ellipsis-h"></i>');
                more.title = 'Rename, reorder, duplicate';
                more.addEventListener('click', function (e) {
                    e.stopPropagation();
                    expandedLayer = expandedLayer === L.id ? null : L.id;
                    renderLayers();
                });
                head.appendChild(more);
                card.appendChild(head);

                var quick = el('div', 'lp-layer-quick' + (isLast ? ' is-sub' : ''));
                var m0 = matById(L.mat);
                if (isLast) {
                    quick.appendChild(el('span', 'lp-inf-tag', '<i class="fas fa-infinity"></i> halfspace'));
                } else {
                    quick.appendChild(numField(symHtml('h') + ' <em>' + unit('len') + '</em>',
                        sig(toDisp('len', L.h), 5), 'any', function (v) {
                            mutate(function () { L.h = Math.max(1, fromDisp('len', v)); });
                        }, 'Layer thickness. Drag the interface in the section to set it by eye.'));
                }
                quick.appendChild(numField(symHtml('E') + ' <em>' + unit('modulus') + '</em>',
                    sig(toDisp('modulus', L.E), 5), 'any', function (v) {
                        mutate(function () { L.E = Math.max(0.1, fromDisp('modulus', v)); });
                    }, 'Elastic modulus. Typical ' + sig(toDisp('modulus', m0.range[0]), 3) + ' to ' +
                    sig(toDisp('modulus', m0.range[1]), 3) + ' ' + unit('modulus')));
                quick.appendChild(numField(symHtml('nu'), L.nu, '0.01', function (v) {
                    mutate(function () { L.nu = clamp(v, 0.05, 0.499); });
                }, "Poisson's ratio"));
                card.appendChild(quick);

                if (expandedLayer === L.id) {
                    var body = el('div', 'lp-layer-body');
                    var nameF = el('label', 'lp-field');
                    nameF.appendChild(el('span', null, 'Name'));
                    var ninp = doc.createElement('input');
                    ninp.type = 'text'; ninp.className = 'lp-input'; ninp.value = L.name;
                    ninp.addEventListener('change', function () { mutate(function () { L.name = ninp.value || L.name; }); });
                    nameF.appendChild(ninp);
                    body.appendChild(nameF);

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
                    body.appendChild(acts);
                    card.appendChild(body);
                }

                if (!isLast) {
                    grip.setAttribute('draggable', 'true');
                    grip.addEventListener('dragstart', function (e) {
                        e.dataTransfer.setData('text/plain', String(i));
                        e.dataTransfer.effectAllowed = 'move';
                        card.classList.add('is-dragging');
                    });
                    grip.addEventListener('dragend', function () { card.classList.remove('is-dragging'); });
                    card.addEventListener('dragover', function (e) {
                        e.preventDefault();
                        card.classList.add('is-dragover');
                    });
                    card.addEventListener('dragleave', function () { card.classList.remove('is-dragover'); });
                    card.addEventListener('drop', function (e) {
                        e.preventDefault();
                        card.classList.remove('is-dragover');
                        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (!isFinite(from) || from === i) return;
                        mutate(function (st) {
                            var moved = st.layers.splice(from, 1)[0];
                            st.layers.splice(i, 0, moved);
                        });
                    });
                }

                hostEl.appendChild(card);
            });
        }

        /* Interfaces on a WinJULEA slip value. The two ends of the range are
         * the two conditions anyone actually analyses, so they are buttons;
         * the middle is a slider, and the shear stiffness it implies is
         * printed beside it rather than hidden. */
        function renderInterfaces() {
            var hostEl = $('lp-interfaces');
            hostEl.innerHTML = '';
            if (state.layers.length < 2) {
                hostEl.appendChild(el('p', 'lp-hint', 'Add a second layer to set interface bonding.'));
                return;
            }
            state.interfaces.forEach(function (itf, i) {
                var slip = clamp(itf.slip || 0, 0, 1);
                var row = el('div', 'lp-itf');
                var lab = el('span', 'lp-itf-label', (i + 1) + '·' + (i + 2));
                lab.title = state.layers[i].name + ' over ' + state.layers[i + 1].name;
                row.appendChild(lab);

                var seg = el('div', 'lp-seg lp-seg-sm');
                [['Bonded', 0, 'Fully bonded. WinJULEA slip 0.'],
                 ['Partial', 0.5, 'Goodman shear spring between the two limits.'],
                 ['Free', 1, 'Frictionless. WinJULEA slip 1.']].forEach(function (o) {
                    var active = o[1] === 0 ? slip <= 0 : (o[1] === 1 ? slip >= 1 : (slip > 0 && slip < 1));
                    var b = el('button', 'lp-seg-btn' + (active ? ' is-active' : ''), o[0]);
                    b.title = o[2];
                    b.addEventListener('click', function () {
                        mutate(function () { itf.slip = o[1]; delete itf.bond; delete itf.k; });
                    });
                    seg.appendChild(b);
                });
                row.appendChild(seg);
                hostEl.appendChild(row);

                if (slip > 0 && slip < 1) {
                    var sub = el('div', 'lp-itf-sub');
                    var sl = doc.createElement('input');
                    sl.type = 'range'; sl.min = '0.02'; sl.max = '0.98'; sl.step = '0.02';
                    sl.value = String(slip);
                    sl.className = 'lp-itf-range';
                    sl.title = 'Slip 0 is bonded, 1 is frictionless';
                    sl.addEventListener('input', function () {
                        itf.slip = parseFloat(sl.value);
                        renderInterfaces(); drawViewport();
                    });
                    sl.addEventListener('change', function () { mutate(function () { }); });
                    sub.appendChild(sl);
                    var G = state.layers[i + 1].E / (2 * (1 + state.layers[i + 1].nu));
                    var aRef = state.loads.length ? loadA(state.loads[0]) : 150;
                    var k = (G / aRef) * (1 - slip) / slip;
                    var read = el('span', 'lp-itf-k',
                        symHtml('s') + ' ' + sig(slip, 2) + ' · ' + symHtml('k') + ' ' +
                        sig(toDisp('kitf', k), 3) + ' ' + unit('kitf'));
                    read.title = EQ.spring.plain;
                    sub.appendChild(read);
                    hostEl.appendChild(sub);
                }
            });
        }

        /* ---- the load-model switch ----------------------------------------
         * It lives in the TOP TOOLBAR, beside the unit system, and not in
         * the Loads panel where it started. Both are properties of the whole
         * analysis rather than of one control group, and the left rail is a
         * scroll container: measured on a 900 px viewport with the structure
         * and interface panels open, the Loads section began 40 px below the
         * fold, so the one control the tool is built around was the one
         * control you had to go looking for. */
        function renderLoadKind() {
            var hostEl = $('lp-kind');
            hostEl.innerHTML = '';
            var seg = el('div', 'lp-seg lp-seg-kind');
            LOAD_KINDS.forEach(function (k) {
                var b = el('button', 'lp-seg-btn' + (state.loadKind === k.id ? ' is-active' : ''),
                    '<i class="fas ' + k.icon + '"></i><span>' + k.short + '</span>');
                b.title = k.name + '. ' + k.blurb;
                b.setAttribute('aria-pressed', state.loadKind === k.id ? 'true' : 'false');
                b.addEventListener('click', function () {
                    if (state.loadKind === k.id) return;
                    mutate(function (st) { st.loadKind = k.id; });
                    fitView();
                });
                seg.appendChild(b);
            });
            hostEl.appendChild(seg);

            var note = $('lp-kind-note');
            if (note) {
                var k0 = kindById(state.loadKind);
                note.innerHTML = '<strong>' + k0.name + '.</strong> ' + k0.blurb;
            }
        }

        /* The gear generator, and the load triple.
         *
         * Load, pressure and area are one equation. The "solve for" switch
         * names which of the three the app computes, and that one turns into
         * a read-only readout while the other two stay editable: there is no
         * mode where a student can type three numbers that do not satisfy
         * F = p A and have to be told so afterwards. */
        function markGearDirty() {
            if (gearDirty) return;
            gearDirty = true;
            var b = $('lp-gear-apply');
            if (b) b.classList.add('is-dirty');
            renderChecks();
        }
        function clearGearDirty() {
            gearDirty = false;
            var b = $('lp-gear-apply');
            if (b) b.classList.remove('is-dirty');
            renderChecks();
        }
        function renderGearParams() {
            var hostEl = $('lp-gear-params');
            hostEl.innerHTML = '';
            var solve = state.settings.solveFor;

            var seg = el('div', 'lp-seg lp-seg-solve');
            seg.title = 'Two of load, pressure and area fix the third. Pick the one to compute.';
            [['F', symHtml('F')], ['p', symHtml('p')], ['A', symHtml('A')]].forEach(function (o) {
                var b = el('button', 'lp-seg-btn' + (solve === o[0] ? ' is-active' : ''), o[1]);
                b.title = 'Solve for ' + (o[0] === 'F' ? 'load' : o[0] === 'p' ? 'pressure' : 'area');
                b.addEventListener('click', function () {
                    state.settings.solveFor = o[0];
                    renderGearParams(); renderLoads(); saveLocal();
                });
                seg.appendChild(b);
            });
            var solveRow = el('div', 'lp-solve-row');
            solveRow.appendChild(el('span', 'lp-solve-label', 'Solve for'));
            solveRow.appendChild(seg);
            hostEl.appendChild(solveRow);

            var A = gearArea();
            hostEl.appendChild(numField(symHtml('F') + ' <em>' + unit('force') + '</em>',
                sig(toDisp('force', gearParams.F), 5), 'any', function (v) {
                    setGearValue('F', fromDisp('force', v)); markGearDirty(); renderGearParams();
                }, 'Total force carried by each load in the gear', solve === 'F'));
            hostEl.appendChild(numField(symHtml('p') + ' <em>' + unit('stress') + '</em>',
                sig(toDisp('stress', gearParams.p), 4), 'any', function (v) {
                    setGearValue('p', fromDisp('stress', v)); markGearDirty(); renderGearParams();
                }, 'Uniform contact pressure', solve === 'p'));
            hostEl.appendChild(numField(symHtml('A') + ' <em>' + unit('area') + '</em>',
                sig(toDisp('area', A), 5), 'any', function (v) {
                    setGearValue('A', fromDisp('area', v)); markGearDirty(); renderGearParams();
                }, 'Contact area', solve === 'A'));
            hostEl.appendChild(numField(symHtml('a') + ' <em>' + unit('len') + '</em>',
                sig(toDisp('len', Math.sqrt(A / Math.PI)), 4), 'any', function (v) {
                    var a = Math.max(1e-3, fromDisp('len', v));
                    setGearValue('A', Math.PI * a * a); markGearDirty(); renderGearParams();
                }, 'Contact radius of the equivalent circle', solve === 'A'));

            hostEl.appendChild(numField('Sd <em>' + unit('len') + '</em>',
                sig(toDisp('len', gearParams.Sd), 4), 'any', function (v) {
                    gearParams.Sd = fromDisp('len', v); markGearDirty();
                }, 'Dual spacing'));
            hostEl.appendChild(numField('St <em>' + unit('len') + '</em>',
                sig(toDisp('len', gearParams.St), 4), 'any', function (v) {
                    gearParams.St = fromDisp('len', v); markGearDirty();
                }, 'Tandem spacing'));

            if (state.loadKind === 'line') {
                hostEl.appendChild(numField('L <em>' + unit('len') + '</em>',
                    sig(toDisp('len', gearParams.L), 4), 'any', function (v) {
                        mutate(function () { gearParams.L = Math.max(1, fromDisp('len', v)); });
                    }, 'Length of the loaded segment'));
                hostEl.appendChild(numField('θ <em>deg</em>',
                    sig(gearParams.theta, 4), '5', function (v) {
                        mutate(function () { gearParams.theta = v; });
                    }, '0 runs along x, across the section; 90 runs along y, into the page'));
            }
        }

        /* The load table. Columns follow the load model and the solve-for
         * switch: the derived quantity is shown but not editable, so the
         * three numbers in a row always satisfy F = p A. */
        function renderLoads() {
            var hostEl = $('lp-loads');
            hostEl.innerHTML = '';
            if (!state.loads.length) {
                hostEl.appendChild(el('p', 'lp-hint', 'No loads. Build a gear above, or Add one.'));
                return;
            }
            var ul = unit('len'), uf = unit('force'), us = unit('stress');
            var kind = state.loadKind, solve = state.settings.solveFor;
            var tbl = el('table', 'lp-wtable');
            var head = '<thead><tr><th class="lp-wtag-h">#</th>' +
                '<th>' + symHtml('x') + '<em>' + ul + '</em></th>' +
                '<th>' + symHtml('y') + '<em>' + ul + '</em></th>' +
                '<th>' + symHtml('F') + '<em>' + uf + '</em></th>';
            if (kind === 'circle') {
                head += '<th>' + symHtml('p') + '<em>' + us + '</em></th>' +
                    '<th>' + symHtml('a') + '<em>' + ul + '</em></th>';
            } else if (kind === 'line') {
                head += '<th>' + symHtml('q') + '<em>' + unit('perlen') + '</em></th>';
            }
            head += '<th></th></tr></thead>';
            tbl.innerHTML = head;
            var body = el('tbody');
            state.loads.forEach(function (w, i) {
                var tr = el('tr');
                var tag = el('td', 'lp-wtag', 'L' + (i + 1));
                tag.title = kindById(kind).name;
                tr.appendChild(tag);
                function cell(val, decimals, setv, ro, title) {
                    var td = el('td');
                    var inp = doc.createElement('input');
                    inp.type = 'number'; inp.step = 'any';
                    inp.value = sig(val, decimals);
                    if (ro) { inp.readOnly = true; inp.className = 'is-ro'; inp.tabIndex = -1; }
                    if (title) inp.title = title;
                    if (!ro) inp.addEventListener('change', function () {
                        var v = parseFloat(inp.value);
                        if (isFinite(v)) mutate(function () { setv(v); });
                    });
                    td.appendChild(inp);
                    tr.appendChild(td);
                }
                cell(toDisp('len', w.x), 6, function (v) { w.x = fromDisp('len', v); });
                cell(toDisp('len', w.y), 6, function (v) { w.y = fromDisp('len', v); });
                cell(toDisp('force', w.F), 5, function (v) {
                    setLoadValue(w, 'F', fromDisp('force', v));
                }, solve === 'F', solve === 'F' ? 'Computed from pressure and area' : '');
                if (kind === 'circle') {
                    cell(toDisp('stress', w.p), 4, function (v) {
                        setLoadValue(w, 'p', fromDisp('stress', v));
                    }, solve === 'p', solve === 'p' ? 'Computed from load and area' : '');
                    cell(toDisp('len', loadA(w)), 4, function (v) {
                        var a = Math.max(1e-3, fromDisp('len', v));
                        setLoadValue(w, 'A', Math.PI * a * a);
                    }, solve === 'A', solve === 'A' ? 'Computed from load and pressure' : 'Contact radius');
                } else if (kind === 'line') {
                    cell(toDisp('perlen', w.F / gearParams.L), 4, function (v) {
                        w.F = Math.max(0.01, fromDisp('perlen', v) * gearParams.L);
                    }, false, 'Force per unit length');
                }
                var tdDel = el('td');
                var db = el('button', 'lp-tool lp-wdel', '<i class="fas fa-times"></i>');
                db.title = 'Remove load ' + (i + 1);
                db.addEventListener('click', function () { mutate(function (st) { st.loads.splice(i, 1); }); });
                tdDel.appendChild(db);
                tr.appendChild(tdDel);
                body.appendChild(tr);
            });
            tbl.appendChild(body);
            hostEl.appendChild(tbl);

            var total = 0;
            state.loads.forEach(function (w) { total += w.F; });
            var foot = el('div', 'lp-wfoot');
            foot.innerHTML = '<i class="fas fa-weight-hanging"></i> total ' +
                sig(toDisp('force', total), 5) + ' ' + unit('force');
            hostEl.appendChild(foot);
        }

        function renderPointsList() {
            var hostEl = $('lp-points');
            hostEl.innerHTML = '';
            if (!state.points.length) {
                hostEl.appendChild(el('p', 'lp-hint', 'No evaluation points.'));
                return;
            }
            var ul = unit('len');
            var tbl = el('table', 'lp-wtable');
            tbl.innerHTML = '<thead><tr><th class="lp-wtag-h">#</th>' +
                '<th>' + symHtml('x') + '<em>' + ul + '</em></th>' +
                '<th>' + symHtml('y') + '<em>' + ul + '</em></th>' +
                '<th>' + symHtml('z') + '<em>' + ul + '</em></th>' +
                '<th></th></tr></thead>';
            var body = el('tbody');
            state.points.forEach(function (p, i) {
                var tr = el('tr', selPoint === p.id ? 'is-sel' : '');
                var tag = el('td', 'lp-wtag');
                tag.innerHTML = '<span class="lp-rt-dot" style="background:' + ptColor(i) + '"></span>P' + (i + 1);
                tr.appendChild(tag);
                function cell(val, setv) {
                    var td = el('td');
                    var inp = doc.createElement('input');
                    inp.type = 'number'; inp.step = 'any';
                    inp.value = sig(val, 6);
                    inp.addEventListener('change', function () {
                        var v = parseFloat(inp.value);
                        if (isFinite(v)) mutate(function () { setv(v); });
                    });
                    inp.addEventListener('focus', function () { selPoint = p.id; drawViewport(); });
                    td.appendChild(inp);
                    tr.appendChild(td);
                }
                cell(toDisp('len', p.x), function (v) { p.x = fromDisp('len', v); });
                cell(toDisp('len', p.y), function (v) { p.y = fromDisp('len', v); });
                cell(toDisp('len', p.z), function (v) { p.z = Math.max(0, fromDisp('len', v)); });
                var tdDel = el('td');
                var db = el('button', 'lp-tool lp-wdel', '<i class="fas fa-times"></i>');
                db.title = 'Remove point ' + (i + 1);
                db.addEventListener('click', function () { mutate(function (st) { st.points.splice(i, 1); }); });
                tdDel.appendChild(db);
                tr.appendChild(tdDel);
                body.appendChild(tr);
            });
            tbl.appendChild(body);
            hostEl.appendChild(tbl);
        }

        function criticalPoints() {
            if (!state.loads.length) return;
            var w = state.loads[0], off = stationOffset(), z = 0;
            state.points.push({ id: nid(), x: w.x + off, y: w.y, z: 0 });
            for (var i = 0; i < state.layers.length - 1; i++) {
                z += state.layers[i].h;
                state.points.push({ id: nid(), x: w.x + off, y: w.y, z: z });
            }
        }

        /* =================== the preflight popover =================== */
        function renderChecks() {
            var badge = $('lp-checks-btn'), list = $('lp-checks-list');
            if (!badge || !list) return;
            var c = checks(), bad = c.filter(function (k) { return !k.pass; }).length;
            badge.className = 'lp-checks-btn' + (bad ? ' is-bad' : ' is-ok');
            badge.innerHTML = (bad ? '<i class="fas fa-triangle-exclamation"></i>' : '<i class="fas fa-check-circle"></i>') +
                '<span>' + (c.length - bad) + '/' + c.length + '</span>';
            badge.title = bad ? bad + ' item(s) need review before the results mean anything'
                : 'Every input checks out';
            list.innerHTML = '';
            c.forEach(function (k) {
                var row = el('div', 'lp-pf-row' + (k.pass ? ' is-ok' : ' is-bad'));
                row.innerHTML = (k.pass ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-times"></i>') +
                    '<span class="lp-pf-label">' + k.label + '</span>' +
                    (k.detail ? '<span class="lp-pf-detail">' + k.detail + '</span>' : '');
                list.appendChild(row);
            });
        }
        function openChecks(force) {
            var pop = $('lp-checks-pop');
            if (!pop) return;
            renderChecks();
            pop.hidden = force ? false : !pop.hidden;
        }
        function closeChecks() {
            var pop = $('lp-checks-pop');
            if (pop) pop.hidden = true;
        }

        /* =====================================================================
         * THE FIELD PICKER
         * ---------------------------------------------------------------------
         * A <select> cannot carry markup, so an <option> can only ever spell
         * a symbol out: "szz", "txz", "exx". That is the one place in the app
         * where the notation had nowhere to go, and it is the control a
         * student uses most. A button with a menu can carry the typeset
         * symbol, so this is a button with a menu.
         * ===================================================================== */
        var openMenu = null;
        function fieldPicker(hostEl, get, set) {
            if (!hostEl) return;
            hostEl.innerHTML = '';
            var cur = fieldById(get());
            var btn = el('button', 'lp-fp-btn',
                '<span class="lp-fp-sym">' + symHtml(cur.sym) + '</span>' +
                '<span class="lp-fp-name">' + cur.name + '</span>' +
                '<i class="fas fa-chevron-down"></i>');
            btn.title = 'Contoured response field';
            var menu = el('div', 'lp-fp-menu');
            menu.hidden = true;
            FIELDS.forEach(function (f) {
                var o = el('button', 'lp-fp-opt' + (f.id === cur.id ? ' is-active' : ''),
                    '<span class="lp-fp-sym">' + symHtml(f.sym) + '</span>' +
                    '<span class="lp-fp-name">' + f.name + '</span>');
                o.addEventListener('click', function () {
                    menu.hidden = true; openMenu = null;
                    set(f.id);
                });
                menu.appendChild(o);
            });
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (openMenu && openMenu !== menu) openMenu.hidden = true;
                menu.hidden = !menu.hidden;
                openMenu = menu.hidden ? null : menu;
            });
            hostEl.appendChild(btn);
            hostEl.appendChild(menu);
        }
        function renderFieldPickers() {
            fieldPicker($('lp-field'), function () { return state.settings.field; }, function (id) {
                state.settings.field = id;
                renderFieldPickers();
                buildContour(); drawViewport(); saveLocal();
            });
            fieldPicker($('lp-prof-field'), function () { return state.settings.profField; }, function (id) {
                state.settings.profField = id;
                renderFieldPickers();
                renderProfileChart(); renderSurfaceChart(); flashLinkedCards(); saveLocal();
            });
        }

        /* =================== exports =================== */
        function csvEscape(s) { return /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s); }
        function safeName() { return (state.name || 'leaps').replace(/[^\w\-]+/g, '_').slice(0, 60); }

        /* ONE export that is the whole analysis: what was modeled, how it
         * was loaded, what the solver was told, and every number it
         * produced, in the units on screen with the conventions named. A
         * results file nobody can reconstruct the run from is a table of
         * numbers, not a record. */
        function exportAnalysis() {
            var u = U(), rows = [];
            function push() { rows.push(Array.prototype.slice.call(arguments).map(csvEscape).join(',')); }
            function blank() { rows.push(''); }

            push('LEAPS, Linear Elastic Analysis of Pavement Structures');
            push('Project', state.name);
            push('Generated', new Date().toISOString());
            push('Engine', 'LEAF-JS v' + (solverFallback ? solverFallback.version : '2.0.0'));
            push('Unit system', u.label);
            push('Sign convention', 'tension positive; z measured downward from the surface; uz positive downward');
            push('Strain reported as', state.settings.strainAbs ? 'dimensionless' : 'microstrain (1e-6)');
            push('Values rounded to', '6 significant figures');
            blank();

            push('[PREFLIGHT]');
            checks().forEach(function (k) {
                push(k.pass ? 'OK' : 'REVIEW', k.label, k.detail);
            });
            blank();

            push('[STRUCTURE]');
            push('#', 'Layer', 'Thickness (' + u.len.u + ')', 'E (' + u.modulus.u + ')', 'Poisson ratio',
                'Interface below', 'Slip', 'k (' + u.kitf.u + ')');
            state.layers.forEach(function (L, i) {
                var itf = state.interfaces[i];
                var slipTxt = '', kTxt = '', bondTxt = '';
                if (itf) {
                    var s = clamp(itf.slip || 0, 0, 1);
                    slipTxt = sig(s, 4);
                    bondTxt = s <= 0 ? 'fully bonded' : (s >= 1 ? 'frictionless' : 'partial (shear spring)');
                    if (s > 0 && s < 1) {
                        var G = state.layers[i + 1].E / (2 * (1 + state.layers[i + 1].nu));
                        var aRef = state.loads.length ? loadA(state.loads[0]) : 150;
                        kTxt = sig(toDisp('kitf', (G / aRef) * (1 - s) / s), 5);
                    }
                }
                push(i + 1, L.name,
                    i < state.layers.length - 1 ? sig(toDisp('len', L.h), 6) : 'semi-infinite',
                    sig(toDisp('modulus', L.E), 6), sig(L.nu, 4), bondTxt, slipTxt, kTxt);
            });
            blank();

            push('[LOADS]');
            push('Load model', kindById(state.loadKind).name);
            push('Solved for', state.settings.solveFor === 'F' ? 'load' : state.settings.solveFor === 'p' ? 'pressure' : 'area');
            var lh = ['#', 'x (' + u.len.u + ')', 'y (' + u.len.u + ')', 'Total load (' + u.force.u + ')'];
            if (state.loadKind === 'circle') {
                lh.push('Pressure (' + u.stress.u + ')', 'Area (' + u.area.u + ')', 'Radius (' + u.len.u + ')');
            }
            if (state.loadKind === 'line') lh.push('q (' + u.perlen.u + ')', 'Length (' + u.len.u + ')', 'Azimuth (deg)');
            push.apply(null, lh);
            state.loads.forEach(function (w, i) {
                var r = [i + 1, sig(toDisp('len', w.x), 6), sig(toDisp('len', w.y), 6), sig(toDisp('force', w.F), 6)];
                if (state.loadKind === 'circle') {
                    r.push(sig(toDisp('stress', w.p), 6), sig(toDisp('area', areaOf(w)), 6),
                        sig(toDisp('len', loadA(w)), 6));
                }
                if (state.loadKind === 'line') r.push(sig(toDisp('perlen', w.F / gearParams.L), 6),
                    sig(toDisp('len', gearParams.L), 6), sig(gearParams.theta, 5));
                push.apply(null, r);
            });
            blank();

            push('[SOLVER]');
            push('Relative tolerance', state.settings.tol);
            push('Contour grid', state.settings.res);
            push('Section plane y', sig(toDisp('len', state.ySec), 6) + ' ' + u.len.u);
            if (results.meta) push('Reference radius for slip', sig(toDisp('len', results.meta.aRef), 6) + ' ' + u.len.u);
            if (results.stats) {
                push('Evaluation points solved', results.stats.nPoints);
                push('Kernel system solves', results.stats.systemSolves);
                push('Solve time (ms)', Math.round(results.stats.ms));
            }
            blank();

            push('[RESPONSES AT EVALUATION POINTS]');
            var data = results.user || [];
            if (!data.length) push('(no evaluation points)');
            else {
                var hdr = ['Quantity', 'Unit'];
                data.forEach(function (p, i) { hdr.push('P' + (i + 1)); });
                push.apply(null, hdr);
                var layerRow = ['layer', BLANK];
                data.forEach(function (p) { layerRow.push(state.layers[p.li] ? state.layers[p.li].name : BLANK); });
                push.apply(null, layerRow);
                RESULT_ROWS.forEach(function (r) {
                    var line = [symText(r.sym), rowUnit(r)];
                    /* the same row zero the table prints, so the file and the
                       screen never disagree about whether a shear is there */
                    var rmx = 0;
                    if (r.g !== 'loc') data.forEach(function (p) {
                        var q = rowValue(r, p);
                        if (q != null && Math.abs(q) > rmx) rmx = Math.abs(q);
                    });
                    data.forEach(function (p) {
                        var v = rowFloor(rowValue(r, p), rmx);
                        /* Six significant figures, not seventeen. The solver
                         * agrees with an independent one to about five, so
                         * the digits past that are the double's rather than
                         * the pavement's, and a column of them is unreadable.
                         * The project JSON keeps everything, for reloading. */
                        line.push(v == null ? (p.singular ? 'singular' : BLANK) : sig(v, 6));
                    });
                    push.apply(null, line);
                });
            }
            blank();

            push('[KEY RESPONSES]');
            var ex = keyExtremes();
            if (ex) {
                if (ex.w0) push('Max surface deflection', sig(toDisp('defl', ex.w0.v), 6), u.defl.u);
                if (ex.et) push('Max tensile strain, base of ' + state.layers[0].name, sig(toDisp('strain', ex.et.v), 6), 'microstrain');
                if (ex.ev) push('Max compressive strain, top of subgrade', sig(toDisp('strain', -ex.ev.v), 6), 'microstrain');
                if (ex.sigt) push('Max tensile stress, base of ' + state.layers[ex.sigt.layer].name, sig(toDisp('stress', ex.sigt.v), 6), u.stress.u);
                if (ex.tau) push('Peak interface shear', sig(toDisp('stress', ex.tau.v), 6), u.stress.u);
            } else push('(not solved yet)');

            download(safeName() + '-analysis.csv', rows.join('\n'), 'text/csv');
        }

        function exportGridCSV() {
            var g = results.grid;
            if (!g) { win.alert('Run the analysis first.'); return; }
            var f = fieldById(state.settings.field);
            var rows = ['x_' + unit('len') + ',z_' + unit('len') + ',' + symText(f.sym) + '_' + unit(f.q)];
            g.pts.forEach(function (p) {
                rows.push(toDisp('len', p.x) + ',' + toDisp('len', p.z) + ',' + toDisp(f.q, f.get(p)));
            });
            download(safeName() + '-' + f.id + '-grid.csv', rows.join('\n'), 'text/csv');
        }
        function exportJSON() {
            download(safeName() + '.leaps.json', JSON.stringify(serialize(), null, 2), 'application/json');
        }
        function exportPNG() {
            var a = doc.createElement('a');
            a.download = safeName() + '-section.png';
            a.href = cv.toDataURL('image/png');
            a.click();
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
                    clearGearDirty();
                    fitView();
                }
                tsel.selectedIndex = 0;
            });

            $('lp-project-name').addEventListener('change', function (e) {
                mutate(function (st) { st.name = e.target.value || 'Untitled analysis'; }, { keepResults: true });
            });
            $('lp-undo').addEventListener('click', undo);
            $('lp-redo').addEventListener('click', redo);
            $('lp-run').addEventListener('click', runPressed);
            $('lp-checks-btn').addEventListener('click', function (e) { e.stopPropagation(); openChecks(false); });
            on(doc, 'pointerdown', function (e) {
                if (openMenu && !e.target.closest('.lp-fieldpick')) { openMenu.hidden = true; openMenu = null; }
                if (!e.target.closest('.lp-checks')) closeChecks();
            });
            $('lp-autorun').addEventListener('change', function (e) {
                state.settings.autorun = e.target.checked; saveLocal();
            });
            $('lp-units').addEventListener('change', function (e) { setUnits(e.target.value); });
            $('lp-tol').addEventListener('change', function (e) {
                state.settings.tol = e.target.value; scheduleRun(); saveLocal();
            });
            $('lp-res').addEventListener('change', function (e) {
                state.settings.res = e.target.value; scheduleRun(); saveLocal();
            });
            $('lp-strain-abs').addEventListener('change', function (e) {
                state.settings.strainAbs = e.target.checked;
                renderPointsTable(); saveLocal();
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
                    } catch (err) { win.alert('Could not open file: ' + err.message); }
                };
                rd.readAsText(f);
                e.target.value = '';
            });

            $('lp-add-layer').addEventListener('click', function () {
                mutate(function (st) {
                    st.layers.splice(Math.max(0, st.layers.length - 1), 0, layerFromMat('base', { h: 150 }));
                });
            });
            $('lp-gear-apply').addEventListener('click', function () {
                var type = $('lp-gear').value;
                mutate(function (st) { st.loads = gearLayout(type, gearParams); });
                clearGearDirty();
                fitView();
            });
            $('lp-gear').addEventListener('change', markGearDirty);
            $('lp-add-load').addEventListener('click', function () {
                mutate(function (st) {
                    var x = st.loads.length ? Math.max.apply(null, st.loads.map(function (w) { return w.x; })) + gearParams.Sd : 0;
                    st.loads.push({ id: nid(), x: x, y: 0, F: gearParams.F, p: gearParams.p });
                });
            });
            $('lp-pts-critical').addEventListener('click', function () {
                mutate(function () { criticalPoints(); });
            });
            $('lp-pts-add').addEventListener('click', function () {
                mutate(function (st) {
                    var w = st.loads[0] || { x: 0, y: 0 };
                    st.points.push({ id: nid(), x: w.x, y: w.y, z: 0 });
                });
            });
            $('lp-pts-clear').addEventListener('click', function () {
                mutate(function (st) { st.points = []; });
            });

            renderFieldPickers();

            var dtabs = $$('.lp-dtab');
            dtabs.forEach(function (t) {
                t.addEventListener('click', function () {
                    var key = t.getAttribute('data-dtab');
                    dtabs.forEach(function (x) { x.classList.remove('is-active'); });
                    t.classList.add('is-active');
                    $$('.lp-dpane').forEach(function (p) {
                        p.classList.toggle('is-active', p.getAttribute('data-dpane') === key);
                    });
                    $('lp-dock').classList.remove('is-collapsed');
                    if (key === 'profiles') { renderCharts(); resizePlots(['lp-chart-profile', 'lp-chart-surface', 'lp-chart-basin', 'lp-smallmults']); }
                    else if (key === 'performance') { renderPerformance(); resizePlots(['lp-chart-perf']); }
                });
            });
            $('lp-dock-collapse').addEventListener('click', function () {
                var d = $('lp-dock');
                d.classList.toggle('is-collapsed');
                if (!d.classList.contains('is-collapsed')) resizePlots(ALL_PLOT_IDS);
            });

            $('lp-plan-toggle').addEventListener('click', function (e) {
                e.stopPropagation();
                $('lp-plan-panel').classList.toggle('is-collapsed');
                drawViewport();
            });

            $('lp-exp-analysis').addEventListener('click', exportAnalysis);
            $('lp-exp-grid').addEventListener('click', exportGridCSV);
            $('lp-exp-json').addEventListener('click', exportJSON);
            $('lp-exp-png').addEventListener('click', exportPNG);

            on(win, 'keydown', function (e) {
                if (!host.contains(doc.activeElement) && doc.activeElement !== doc.body) return;
                var tag = (e.target.tagName || '').toLowerCase();
                if (e.key === 'Escape') { closeChecks(); if (openMenu) { openMenu.hidden = true; openMenu = null; } }
                if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
                else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
                else if (e.key === 'f' || e.key === 'F') fitView();
                else if (e.key === 'r' || e.key === 'R') runPressed();
                else if (e.key === 'Delete' && selPoint != null) {
                    mutate(function (st) {
                        st.points = st.points.filter(function (p) { return p.id !== selPoint; });
                    });
                    selPoint = null;
                }
            });

            var mo = new MutationObserver(function () {
                texCache = {};
                drawViewport();
                renderCharts();
                renderPerformance();
            });
            mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
            teardown.push(function () { mo.disconnect(); });
        }

        /* =================== units =================== */
        function setUnits(u) {
            state.settings.units = u;
            try { win.localStorage.setItem('leaps-units', u); } catch (e) { /* private mode */ }
            $('lp-units').value = u;
            renderPanels();
            renderCards();
            renderLayerTable();
            renderPointsTable();
            renderFieldPickers();
            renderCharts();
            renderPerformance();
            drawViewport();
            saveLocal();
        }

        /* The unit system is asked for ONCE, before anything is typed. Every
         * number in the app is in it, and a pavement analysis read in the
         * wrong system is wrong by a factor nobody notices in a plot. It is
         * still on the toolbar afterwards. */
        function unitGate() {
            var saved = null;
            try { saved = win.localStorage.getItem('leaps-units'); } catch (e) { /* private mode */ }
            if (saved === 'SI' || saved === 'US') { state.settings.units = saved; return; }
            var gate = $('lp-unitgate');
            if (!gate) return;
            gate.hidden = false;
            $$('#lp-unitgate [data-units]').forEach(function (b) {
                b.addEventListener('click', function () {
                    gate.hidden = true;
                    setUnits(b.getAttribute('data-units'));
                });
            });
        }

        function renderAll() {
            renderPanels();
            renderCards();
            renderLayerTable();
            renderPointsTable();
            renderFieldPickers();
            $('lp-units').value = state.settings.units;
            $('lp-tol').value = state.settings.tol;
            $('lp-res').value = state.settings.res;
            $('lp-autorun').checked = state.settings.autorun;
            $('lp-strain-abs').checked = state.settings.strainAbs;
            $('lp-show-basin').checked = state.settings.showBasin;
            $('lp-show-contour').checked = state.settings.showContour;
            $('lp-alpha').value = state.settings.alpha;
            drawViewport();
        }

        /* =================== boot =================== */
        setupViewport();
        setupToolbar();

        var restored = false;
        try {
            var saved = win.localStorage.getItem('leaps-autosave');
            if (saved) { deserialize(JSON.parse(saved)); restored = true; }
        } catch (e) { /* corrupted autosave */ }
        if (!restored) applyTemplate(TEMPLATES[0]);

        unitGate();
        history = [snapshot()];
        updateHistoryButtons();
        renderAll();
        fitView();
        initWorker();
        setupResponsive();

        /* ---------- Responsive behavior ----------
         * Two things the stylesheet cannot do on its own.
         *
         * 1. Plotly sizes a chart when it draws it and does not watch the
         *    window. Turning a tablet from portrait to landscape would
         *    otherwise leave the deflection basin, the small-multiples grid
         *    and the performance chart drawn to the old width until a dock
         *    tab was touched. The canvas viewport is never affected: it has
         *    its own ResizeObserver.
         *
         * 2. The control sections ship open, which is right beside a
         *    viewport on a desktop and wrong once they stack: measured at
         *    390px the left rail ran 1,281px and put the results dock at
         *    y=2,969. Only the first section stays open on a handheld.       */
        function setupResponsive() {
            var onResize = debounce(function () { resizePlots(ALL_PLOT_IDS); }, 180);
            on(win, 'resize', onResize);
            /* Safari fires orientationchange before the new viewport size is
               readable, so the resize that follows is what actually lands;
               this is here for the browsers that do not emit one. */
            on(win, 'orientationchange', function () { setTimeout(onResize, 250); });
            collapseSectionsOnHandheld();
        }

        /* Runs once, at boot, and is not persisted: a section opened by hand
           has to stay open for the session. */
        function collapseSectionsOnHandheld() {
            if (!win.matchMedia) return;
            var handheld = win.matchMedia('(max-width: 719px)').matches
                || win.matchMedia('(max-width: 1080px) and (max-height: 500px) and (orientation: landscape)').matches;
            if (!handheld) return;
            var secs = host.querySelectorAll('.lp-left .lp-section');
            for (var i = 1; i < secs.length; i++) secs[i].open = false;
        }

        /* =================== disposer =================== */
        return function dispose() {
            disposed = true;
            scheduleRun.cancel();
            saveLocal.cancel();
            clearTimeout(chartRetry);
            clearTimeout(perfRetry);
            if (worker) { worker.terminate(); worker = null; }
            var P = plotly();
            if (P) ALL_PLOT_IDS.forEach(function (id) {
                var n = $(id);
                if (n && n.data) { try { P.purge(n); } catch (e) { /* never drawn */ } }
            });
            teardown.forEach(function (fn) { fn(); });
            teardown.length = 0;
        };
    }

    return {
        init: initLeaps,
        UNITS: UNITS,
        MATERIALS: MATERIALS,
        TEMPLATES: TEMPLATES,
        LOAD_KINDS: LOAD_KINDS,
        RESULT_ROWS: RESULT_ROWS,
        RESULT_GROUPS: RESULT_GROUPS,
        FIELDS: FIELDS,
        SYM: SYM,
        EQ: EQ,
        symHtml: symHtml,
        symText: symText
    };
});
