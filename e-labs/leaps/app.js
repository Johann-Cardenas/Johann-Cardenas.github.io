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
 *   opts.docsHref    where the manual lives  (default: 'documentation.html')
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
        tau: { b: 'τ' }, N: { b: 'N' }, Nf: { b: 'N', sub: 'f' }, Nr: { b: 'N', sub: 'r' }
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
    /* =====================================================================
     * AXONOMETRIC PROJECTION
     * ---------------------------------------------------------------------
     * World axes: x across the section, y along the direction of travel,
     * z DOWN. The camera yaws by az about the vertical and pitches by el,
     * and the projection is orthographic: a drawing somebody measures must
     * not foreshorten, so parallel stays parallel and a length is a length
     * wherever in the box it sits.
     *
     * Two properties are load-bearing rather than incidental, and both are
     * pinned by the test suite. The map is AFFINE, which is what lets the
     * contour image be poured onto the cut plane with one ctx.transform
     * instead of being resampled pixel by pixel. And the z axis projects
     * to a VERTICAL screen direction at every camera angle, which is what
     * keeps depth reading down the page: a drop line from a point to the
     * surface is plumb, and a layer is a band rather than a wedge.
     * ================================================================== */
    function axonometric(az, el, scale) {
        var a = az * Math.PI / 180, e = el * Math.PI / 180;
        var ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
        var k = scale == null ? 1 : scale;
        return {
            ca: ca, sa: sa, ce: ce, se: se,
            ex: [ca * k, -sa * se * k],
            ey: [-sa * k, -ca * se * k],
            ez: [0, ce * k]
        };
    }

    /* =====================================================================
     * DISTRESS TRANSFER FUNCTIONS  (Asphalt Institute, MS-1)
     * ---------------------------------------------------------------------
     * Strain is dimensionless here and the modulus is in MPa; the psi
     * conversion the fatigue equation was calibrated in happens inside, so
     * a caller cannot forget it. They were written inline in the panel that
     * printed them, which was fine while one card printed them and wrong
     * the moment a design study had to plot the same quantity: two copies
     * of a calibration constant is one copy too many.
     * ================================================================== */
    function fatigueLife(epsT, E_MPa) {
        if (!(epsT > 0) || !(E_MPa > 0)) return null;
        var Epsi = E_MPa * 145.0377377;
        return 0.0796 * Math.pow(epsT, -3.291) * Math.pow(Epsi, -0.854);
    }
    function ruttingLife(epsV) {
        if (!(epsV > 0)) return null;
        return 1.365e-9 * Math.pow(epsV, -4.477);
    }
    /* The design life is the SMALLER of the two, because a pavement fails
     * by whichever mechanism gets there first, and which one that is is the
     * answer a design study is looking for. */
    function governingLife(Nf, Nr) {
        if (Nf == null) return Nr == null ? null : { N: Nr, by: 'Subgrade rutting' };
        if (Nr == null) return { N: Nf, by: 'Fatigue cracking' };
        return Nf <= Nr ? { N: Nf, by: 'Fatigue cracking' } : { N: Nr, by: 'Subgrade rutting' };
    }

    /* What a design study can plot. Magnitudes, because a study is read
     * for size and a sign that flips halfway up a log axis is noise; the
     * sign is in the results table, where it is the reading. */
    var STUDY_RESP = [
        { id: 'et', sym: 'et', name: 'Tensile strain, base of layer 1', q: 'strain', log: false,
          get: function (r) { return r.ex.et ? Math.abs(r.ex.et.v) : null; } },
        { id: 'ev', sym: 'ev', name: 'Compressive strain, top of subgrade', q: 'strain', log: false,
          get: function (r) { return r.ex.ev ? Math.abs(r.ex.ev.v) : null; } },
        { id: 'w0', sym: 'w', name: 'Maximum surface deflection', q: 'defl', log: false,
          get: function (r) { return r.ex.w0 ? Math.abs(r.ex.w0.v) : null; } },
        { id: 'Nf', sym: 'Nf', name: 'Fatigue life', q: null, log: true,
          get: function (r) { return r.Nf; } },
        { id: 'Nr', sym: 'Nr', name: 'Subgrade rutting life', q: null, log: true,
          get: function (r) { return r.Nr; } },
        { id: 'Ng', sym: 'N', name: 'Governing life', q: null, log: true,
          get: function (r) { return r.Ng ? r.Ng.N : null; } }
    ];

    /* x -> -x, applied to one solved point.
     *
     * The reflection is an ORTHOGONAL map, so every invariant comes through
     * untouched - the principal stresses and strains, the von Mises stress,
     * the maximum shear - and what changes sign is exactly the components
     * carrying one x index: sigma_xy, sigma_xz, their strains, and u_x.
     * Getting that list wrong would put a correct-looking shear bulb on the
     * wrong side of the section, which is why the contour's mirrored half
     * is checked against the engine's own answer rather than trusted. */
    function mirrorXPoint(p) {
        if (!p) return p;
        var s2 = p.sig, e2 = p.eps, d2 = p.disp;
        return {
            x: -p.x, y: p.y, z: p.z, li: p.li,
            sig: { xx: s2.xx, yy: s2.yy, zz: s2.zz, xy: -s2.xy, xz: -s2.xz, yz: s2.yz },
            eps: { xx: e2.xx, yy: e2.yy, zz: e2.zz, xy: -e2.xy, xz: -e2.xz, yz: e2.yz },
            disp: { ux: -d2.ux, uy: d2.uy, uz: d2.uz },
            principal: p.principal, epsPrincipal: p.epsPrincipal,
            vm: p.vm, tauMax: p.tauMax, tauOct: p.tauOct,
            meanStress: p.meanStress, bulkStress: p.bulkStress,
            converged: p.converged, singular: p.singular, tag: p.tag
        };
    }

    /* =====================================================================
     * LIGHT
     * ---------------------------------------------------------------------
     * A fixed world light would put one face of the box in the dark as soon
     * as the camera swung past it, so the light follows the camera: up and
     * to the reader's left, which is where a draughtsman has always put it.
     * Lambert with a high ambient floor, because this is a drawing rather
     * than a photograph and a face nobody can read is worse than a face
     * that is not physically shaded.
     * ================================================================== */
    function light3(az, el) {
        var aL = (az - 25) * Math.PI / 180;
        var eL = Math.min(Math.max(el + 35, 30), 80) * Math.PI / 180;
        var ce = Math.cos(eL);
        return [-Math.sin(aL) * ce, -Math.cos(aL) * ce, -Math.sin(eL)];
    }
    function lambert3(n, L) {
        var d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
        return 0.55 + 0.5 * (d > 0 ? d : 0);
    }
    /* The direction the camera looks, which is what decides whether a face
     * is turned away. Derived from the same basis the projection uses, so
     * the two cannot disagree about which side of the box is visible. */
    function viewDir3(az, el) {
        var a = az * Math.PI / 180, e = el * Math.PI / 180;
        return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    }
    function shadeHex(hex, k) {
        var c = hex2rgb(hex);
        if (!c) return hex;
        return 'rgb(' + Math.round(clamp(c[0] * k, 0, 255)) + ',' +
            Math.round(clamp(c[1] * k, 0, 255)) + ',' +
            Math.round(clamp(c[2] * k, 0, 255)) + ')';
    }

    /* Cut aggregate.
     *
     * A layer drawn as a flat band is a stripe of paint; a layer drawn with
     * the stones the cut went through is a material. The particles are
     * generated once per material in the face's own (u, v) coordinates and
     * are sized in MILLIMETERS, so a 20 mm stone in a 200 mm base is a
     * twentieth of the band and stays that way at every zoom. Deterministic
     * from a seed, or the section would boil while the camera moved. */
    var AGG = {
        asphalt:    { n: 150, r0: 1.5, r1: 5,  lo: 0.55, hi: 1.35, edge: 0 },
        concrete:   { n: 90,  r0: 4,   r1: 13, lo: 0.72, hi: 1.12, edge: 0.35 },
        granular:   { n: 80,  r0: 6,   r1: 20, lo: 0.66, hi: 1.3,  edge: 0.5 },
        stabilized: { n: 70,  r0: 3,   r1: 9,  lo: 0.78, hi: 1.12, edge: 0.25 },
        rock:       { n: 40,  r0: 12,  r1: 34, lo: 0.6,  hi: 1.25, edge: 0.6 },
        soil:       { n: 110, r0: 1,   r1: 4,  lo: 0.7,  hi: 1.25, edge: 0 }
    };
    var aggCache = {};
    function aggregateFor(tex, seed) {
        var key = tex + '|' + seed;
        if (aggCache[key]) return aggCache[key];
        var spec = AGG[tex] || AGG.soil;
        var rnd = mulberry32(seed * 2654435761 % 4294967296 || 12345);
        var out = [];
        for (var i = 0; i < spec.n; i++) {
            out.push({
                u: rnd(), v: rnd(),
                r: spec.r0 + rnd() * (spec.r1 - spec.r0),
                e: 0.55 + rnd() * 0.45,
                rot: rnd() * Math.PI,
                k: spec.lo + rnd() * (spec.hi - spec.lo)
            });
        }
        aggCache[key] = out;
        return out;
    }

    /* The tire that fits a gear.
     *
     * A wheel occupies 2w across the track and 2R along it, so a pair of
     * them clears when |dx| >= 2w OR |dy| >= 2R. Scaling w and R together
     * by ONE factor keeps the tire's proportion while it shrinks, and the
     * factor the tightest pair allows is the one the whole gear uses:
     * wheels of different sizes in one gear would read as different tires
     * rather than as one set of them.
     *
     * Everything starts from the contact patch, which is the only length
     * the model has. Below a quarter more than the patch there is no tire
     * worth drawing - the wheels are closer together than wheels can be -
     * and the caller falls back to the imprints, which is the honest
     * picture of a gear that could not be built. */
    var TIRE = { R0: 2.6, W0: 0.85, GAP: 1.08, MIN: 1.25 };
    function tireFit(loads, a) {
        if (!loads || !loads.length || !(a > 0)) return null;
        var w0 = TIRE.W0 * a, R0 = TIRE.R0 * a, sc = 1, i, j;
        for (i = 0; i < loads.length; i++) {
            for (j = i + 1; j < loads.length; j++) {
                var dx = Math.abs(loads[i].x - loads[j].x);
                var dy = Math.abs(loads[i].y - loads[j].y);
                var need = Math.max(dx / (2 * TIRE.GAP * w0), dy / (2 * TIRE.GAP * R0));
                if (need < sc) sc = need;
            }
        }
        if (!(sc * R0 >= TIRE.MIN * a)) return null;
        var R = sc * R0;
        /* the flat the load presses into the bottom of the tire: the
           contact patch itself wherever the tire is big enough to carry
           one, capped at a fraction of the radius where the gear is
           cramped, so a squeezed wheel reads as a wheel rather than as a
           pancake and the imprint shows fore and aft of the flat. */
        var flat = Math.min(a, 0.42 * R);
        return { R: R, w: sc * w0, a: a, s: sc, flat: flat,
            h: Math.sqrt(Math.max(R * R - flat * flat, 1)) };
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
        /* The manual sits next door on the standalone page and somewhere
         * else entirely when the app is mounted inside another site, so the
         * one link to it is injected rather than patched at port time, the
         * same as Plotly and the Worker. It opens in a new tab on both
         * hosts: the workspace holds a section somebody is in the middle of
         * typing, and reading the manual should not be a way to lose it. */
        function docsHref() { return opts.docsHref || 'documentation.html'; }

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
            'lp-smallmults', 'lp-chart-perf', 'lp-chart-study'];

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
                alpha: 0.85, strainAbs: false, solveFor: 'A', view3d: false
            }
        };

        var results = { key: null, user: null, profiles: null, basin: null, grid: null, stats: null, meta: null };
        var view = { scale: 0.5, ox: 0, oy: 0 };
        /* The perspective camera. Orthographic, not perspective, because a
         * drawing a reader measures must not foreshorten: parallel is
         * parallel and a length is a length wherever it sits in the box. */
        var ISO3 = { az: 45, el: 35.264 };
        var sceneDraft = false;
        var view3 = { az: ISO3.az, el: ISO3.el, scale: 1, ox: 0, oy: 0, fitted: false };
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
            /* A design study is a set of sections around THIS one, so it
               stops being about anything the moment this one changes. It is
               dropped rather than redrawn stale: a curve that still looks
               current and is not is worse than an empty panel. */
            if (study.rows) {
                study.rows = null; study.ran = null;
                if ($('lp-study-note')) renderStudy();
            }
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
            /* A sweep is a dozen jobs with one completion counter, and
               terminating the worker throws their callbacks away: without
               this the counter never reaches zero and the button stays
               disabled for the rest of the session. */
            if (study.running) {
                study.running = false;
                var sb = $('lp-study-run');
                if (sb) sb.disabled = false;
                studyNote('Study canceled: the model changed under it.');
            }
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

        /* Surface, and both sides of every interface, under every load
         * station. These are the points the key responses are read from, so
         * the design study asks for exactly the same ones under a section
         * that is not on screen: the interface depths come from the layers
         * passed in, never from state, because a thickness sweep moves
         * them. */
        function keyPoints(layers) {
            var pts = [], zb = [], z = 0, i;
            for (i = 0; i < layers.length - 1; i++) { z += layers[i].h; zb.push(z); }
            var stations = keyStations(), off = stationOffset();
            stations.forEach(function (s, si) {
                var sx = s.x + off;
                pts.push({ x: sx, y: s.y, z: 0, li: 0, tag: { t: 'kp', si: si, pos: 'surf' } });
                zb.forEach(function (zi, ii) {
                    pts.push({ x: sx, y: s.y, z: zi, li: ii, tag: { t: 'kp', si: si, pos: 'bot', layer: ii } });
                    pts.push({ x: sx, y: s.y, z: zi, li: ii + 1, tag: { t: 'kp', si: si, pos: 'top', layer: ii + 1 } });
                });
            });
            return pts;
        }

        function buildMainJob() {
            var pts = keyPoints(solverLayers());
            var n = state.layers.length;
            var zb = interfaceZs();
            var stations = keyStations();
            var off = stationOffset();

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

        /* Is the gear its own mirror image in x?
         *
         * The contour grid is the most expensive thing this app asks for,
         * and half of it is redundant whenever the loads are symmetric
         * about x = 0, which covers every gear the generator builds. The
         * section plane is a y = const plane, so a mirror in x maps it to
         * itself: the test is about the LOADS and nothing else, and holds
         * at any section offset. */
        function loadsMirrorX() {
            var ws = state.loads;
            if (!ws.length) return false;
            /* a segment at any azimuth but along y maps to a different
               segment under the mirror, so only the perpendicular case is
               symmetric */
            if (state.loadKind === 'line' &&
                Math.abs(Math.cos(gearParams.theta * Math.PI / 180)) > 1e-9) return false;
            var tol = 1e-6 * Math.max(1, maxA());
            for (var i = 0; i < ws.length; i++) {
                var found = false;
                for (var j = 0; j < ws.length && !found; j++) {
                    found = Math.abs(ws[j].x + ws[i].x) < tol &&
                        Math.abs(ws[j].y - ws[i].y) < tol &&
                        Math.abs(ws[j].F - ws[i].F) <= 1e-9 * Math.max(1, Math.abs(ws[i].F)) &&
                        Math.abs(ws[j].p - ws[i].p) <= 1e-9 * Math.max(1, Math.abs(ws[i].p));
                }
                if (!found) return false;
            }
            return true;
        }

        function buildGridJob(box, scale) {
            var rr = state.settings.res.split('x');
            var nx = parseInt(rr[0], 10), nz = parseInt(rr[1], 10);
            /* A line load costs several times a circular one per point: it
             * is a quadrature inside a quadrature, so the contour grid is
             * trimmed rather than left to take five seconds. */
            if (state.loadKind === 'line') { nx = Math.round(nx * 0.7); nz = Math.round(nz * 0.7); }
            if (scale && scale < 1) {
                nx = Math.max(9, Math.round(nx * scale) | 1);
                nz = Math.max(7, Math.round(nz * scale) | 1);
            }
            var xs = [], zs = [], pts = [];
            for (var i = 0; i < nx; i++) xs.push(box.xL + (box.xR - box.xL) * i / (nx - 1));
            for (var j = 0; j < nz; j++) zs.push(box.zMax * j / (nz - 1));
            /* Half the columns when the gear is its own mirror image, and
             * the box is symmetric about x = 0 so the columns pair up
             * exactly. The other half is arithmetic, not a solve. */
            var mirror = loadsMirrorX() && Math.abs(box.xL + box.xR) < 1e-6 * Math.max(1, Math.abs(box.xR));
            var i0 = mirror ? Math.ceil((nx - 1) / 2) : 0;
            for (j = 0; j < nz; j++) {
                for (i = i0; i < nx; i++) pts.push({ x: xs[i], y: state.ySec, z: zs[j] });
            }
            return {
                job: {
                    layers: solverLayers(), interfaces: solverInterfaces(),
                    loads: solverLoads(), points: pts, options: solverOptions()
                }, nx: nx, nz: nz, xs: xs, zs: zs, i0: i0
            };
        }

        /* Put a solved half-grid back into a whole one. */
        function expandGrid(pts, g) {
            if (!g.i0) return pts;
            var w = g.nx - g.i0, out = new Array(g.nx * g.nz);
            for (var j = 0; j < g.nz; j++) {
                for (var i = g.i0; i < g.nx; i++) {
                    var src = pts[j * w + (i - g.i0)];
                    out[j * g.nx + i] = src;
                    var mi = g.nx - 1 - i;
                    if (mi < g.i0) out[j * g.nx + mi] = mirrorXPoint(src);
                }
            }
            return out;
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

            var statsMain = '', statsGrid = '';
            function showStats() {
                $('lp-stats').textContent = statsMain + statsGrid;
            }

            postJob('main', main.job, function (err, res) {
                if (err || myGen !== jobGen || disposed) return;
                applyMainResults(res, main.stations);
                statsMain = res.stats.nPoints + ' pts · ' + res.stats.systemSolves +
                    ' kernel solves · ' + Math.round(res.stats.ms) + ' ms';
                showStats();
            });

            /* The contour is the expensive half of a run and the only half
             * a reader watches arrive, so it comes in two passes: a coarse
             * one that costs about a tenth and puts a picture on the
             * section within a moment, then the full one over the top of
             * it. The preview is not free, but a blank viewport for two
             * seconds after every edit costs more. */
            if (state.settings.showContour) {
                var fullDone = false;
                /* Measured: a point costs about the same wherever it is, so
                   the work is points times loads. Below this the full grid
                   lands inside a second and a preview only delays it. */
                var work = grid.job.points.length * Math.max(1, state.loads.length);
                var coarse = buildGridJob(main.box, 0.38);
                if (work > 2500) postJob('grid', coarse.job, function (err, res) {
                    if (err || myGen !== jobGen || disposed) return;
                    if (fullDone) return;            /* the full one won the race */
                    results.grid = {
                        nx: coarse.nx, nz: coarse.nz, xs: coarse.xs, zs: coarse.zs,
                        pts: expandGrid(res.points, coarse), box: main.box, preview: true
                    };
                    buildContour();
                    drawViewport();
                    statsGrid = ' · preview ' + coarse.nx + '×' + coarse.nz +
                        ' in ' + Math.round(res.stats.ms) + ' ms';
                    showStats();
                });
                postJob('grid', grid.job, function (err, res) {
                    if (err || myGen !== jobGen || disposed) return;
                    fullDone = true;
                    results.grid = {
                        nx: grid.nx, nz: grid.nz, xs: grid.xs, zs: grid.zs,
                        pts: expandGrid(res.points, grid), box: main.box
                    };
                    buildContour();
                    drawViewport();
                    statsGrid = ' · grid ' + grid.nx + '×' + grid.nz +
                        ' in ' + Math.round(res.stats.ms) + ' ms' +
                        (grid.i0 ? ' (half, mirrored)' : '');
                    showStats();
                });
            } else {
                /* No grid was asked for, so the one from the last run is no
                   longer about this model: it goes with it, which is also
                   what lets the overlay switch ask for a fresh one. */
                results.grid = null;
                contour = null;
                drawColorbar();
            }
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
            return extremesFrom(results.key, state.layers, results.basin);
        }
        /* The same reduction, over whatever set of key points it is given.
         * The design study runs it on a section that is not the one on
         * screen, so it cannot read `state` or `results`: a sweep whose
         * critical-response rule drifted from the panel's would be a second
         * model wearing the same labels. */
        function extremesFrom(keyPts, layers, basin) {
            var n = layers.length;
            var out = { w0: null, et: null, ev: null, sigt: null, tau: null };
            (keyPts || []).forEach(function (p) {
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
                    if (layers[t.layer].E >= 8000) {
                        if (!out.sigt || sT > out.sigt.v) out.sigt = { v: sT, p: p, layer: t.layer };
                    }
                    if (!out.tau || tau > out.tau.v) out.tau = { v: tau, p: p, layer: t.layer };
                }
                if (t.pos === 'top' && t.layer === n - 1 && n > 1) {
                    if (!out.ev || p.eps.zz < out.ev.v) out.ev = { v: p.eps.zz, p: p };
                }
            });
            if (basin) {
                basin.forEach(function (p) {
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
            var epsT = acBound && ex.et ? Math.abs(ex.et.v) : null;
            var epsV = ex.ev ? Math.abs(ex.ev.v) : null;
            var Nf = epsT == null ? null : fatigueLife(epsT, L0.E);
            var Nr = epsV == null ? null : ruttingLife(epsV);
            var g = governingLife(Nf, Nr);
            var gov = g ? g.N : null, govName = g ? g.by : '';

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
                '<a href="' + docsHref() + '" target="_blank" rel="noopener noreferrer">documentation</a>.'));

            renderPerfChart();
        }
        var perfRetry = null;
        var studyRetry = null;
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

        /* ========================== DESIGN STUDY ==========================
         * Every other panel answers "what does THIS section do". The
         * question a homework asks is the other one: how thick does layer 1
         * have to be, how much does bonding buy, what happens when the
         * subgrade is soft. Answering that by hand means editing a number,
         * pressing Run, writing the answer down, and doing it eight more
         * times, which is enough friction that nobody does it eight times.
         *
         * So: one variable, a range, and the critical responses across it,
         * solved with the SAME key-point rule and the SAME transfer
         * functions the panels use. Two details make it a design tool
         * rather than a plotting one. The current design is marked on the
         * curve, so the study always says where you are. And for a life,
         * a target draws a line and the crossing is interpolated, which is
         * the number the design was after: the thickness that buys the
         * repetitions.
         * ================================================================ */
        var study = {
            varId: null, from: null, to: null, steps: 13,
            resp: 'Ng', target: 1e6, rows: null, running: false, ran: null
        };

        /* Every quantity worth sweeping, built from the section on screen.
         * The subgrade's thickness is not among them: it is a half-space
         * and its thickness is ignored, so a sweep of it would draw a flat
         * line and teach the wrong thing. */
        function studyVars() {
            var out = [], n = state.layers.length, i;
            for (i = 0; i < n - 1; i++) {
                out.push({ id: 'h' + i, kind: 'h', i: i, q: 'len',
                    name: state.layers[i].name + ' · thickness' });
            }
            for (i = 0; i < n; i++) {
                out.push({ id: 'E' + i, kind: 'E', i: i, q: 'modulus',
                    name: state.layers[i].name + ' · modulus' });
            }
            for (i = 0; i < state.interfaces.length; i++) {
                out.push({ id: 's' + i, kind: 'slip', i: i, q: null,
                    name: 'Interface ' + (i + 1) + '·' + (i + 2) + ' · slip' });
            }
            if (state.loads.length) {
                out.push({ id: 'F', kind: 'F', q: 'force', name: 'Wheel load' });
                if (state.loadKind === 'circle') {
                    out.push({ id: 'p', kind: 'p', q: 'stress', name: 'Contact pressure' });
                }
            }
            return out;
        }
        function studyVarById(id) {
            var all = studyVars();
            for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
            return all[0] || null;
        }
        function studyCurrent(v) {
            if (!v) return 0;
            if (v.kind === 'h') return state.layers[v.i].h;
            if (v.kind === 'E') return state.layers[v.i].E;
            if (v.kind === 'slip') return state.interfaces[v.i] ? (state.interfaces[v.i].slip || 0) : 0;
            if (v.kind === 'F') return state.loads.length ? state.loads[0].F : 0;
            if (v.kind === 'p') return state.loads.length ? state.loads[0].p : 0;
            return 0;
        }
        function studyDisp(v, x) { return v && v.q ? toDisp(v.q, x) : x; }
        function studySI(v, x) { return v && v.q ? fromDisp(v.q, x) : x; }
        function studyUnit(v) { return v && v.q ? unit(v.q) : ''; }

        /* A range around where you are: half to double for anything with a
         * scale, and the whole of it for a slip, which has ends. */
        function studyDefaults(v) {
            if (!v) return { from: 0, to: 1 };
            var cur = studyDisp(v, studyCurrent(v));
            if (v.kind === 'slip') return { from: 0, to: 1 };
            if (!(cur > 0)) return { from: 0, to: 1 };
            return { from: sig(cur * 0.5, 3) * 1, to: sig(cur * 1.5, 3) * 1 };
        }

        /* One step of the sweep, as a solver job. Nothing here reads the
         * layers on screen: a thickness sweep moves the interfaces, so the
         * evaluation points have to be built from the section being asked
         * about rather than the one being displayed. */
        /* A surface scan across the loaded width, which is where the
         * deflection maximum lives: the panel finds it from the 121-point
         * basin it draws, and the study has to look in the same places or
         * the same quantity reads two ways on two panels. Restricted to the
         * gear rather than the whole box, because outside it the surface is
         * monotonic and the extra points buy nothing. */
        function studySurfaceScan() {
            if (!state.loads.length) return [];
            var xs = state.loads.map(function (w) { return w.x; });
            var a = 0;
            state.loads.forEach(function (w) { a = Math.max(a, loadA(w)); });
            a = Math.max(a, 60);
            var x0 = Math.min.apply(null, xs) - 2.5 * a;
            var x1 = Math.max.apply(null, xs) + 2.5 * a;
            var N = 41, out = [];
            for (var i = 0; i < N; i++) {
                out.push({
                    x: x0 + (x1 - x0) * i / (N - 1), y: state.ySec, z: 0, li: 0,
                    tag: { t: 'bs', i: i }
                });
            }
            return out;
        }

        function studyJob(v, value) {
            var layers = solverLayers(), itf = solverInterfaces(), loads;
            if (v.kind === 'h') layers[v.i].h = Math.max(value, 1);
            else if (v.kind === 'E') layers[v.i].E = Math.max(value, 1);
            else if (v.kind === 'slip') itf[v.i] = { slip: clamp(value, 0, 1) };
            var kind = state.loadKind;
            loads = state.loads.map(function (w) {
                var F = w.F, p = w.p;
                /* F and p are one equation with the area; the sweep holds
                 * the other one and lets the contact area follow, which is
                 * what happens on a truck: inflation pressure is a property
                 * of the tire and the load is a property of the trip. */
                if (v.kind === 'F') {
                    var F0 = state.loads[0].F || 1;
                    F = w.F * (value / F0);
                } else if (v.kind === 'p') p = Math.max(value, 1e-6);
                if (kind === 'circle') {
                    return { kind: 'circle', x: w.x, y: w.y, p: p,
                        a: Math.sqrt(F / Math.max(p, 1e-12) / Math.PI) };
                }
                if (kind === 'point') return { kind: 'point', x: w.x, y: w.y, P: F };
                return { kind: 'line', x: w.x, y: w.y, P: F, L: gearParams.L, theta: gearParams.theta };
            });
            return {
                job: {
                    layers: layers, interfaces: itf, loads: loads,
                    points: keyPoints(layers).concat(studySurfaceScan()),
                    options: solverOptions()
                },
                layers: layers
            };
        }

        function studyNote(html) {
            var el2 = $('lp-study-note');
            if (el2) el2.innerHTML = html;
        }

        function runStudy() {
            if (study.running) return;
            var v = studyVarById($('lp-study-var').value);
            if (!v) return;
            var from = studySI(v, parseFloat($('lp-study-from').value));
            var to = studySI(v, parseFloat($('lp-study-to').value));
            var steps = clamp(Math.round(parseFloat($('lp-study-steps').value) || 13), 3, 41);
            if (!isFinite(from) || !isFinite(to) || from === to) {
                studyNote('Give the range two different ends.');
                return;
            }
            $('lp-study-steps').value = String(steps);
            var gen = jobGen, pending = steps, rows = new Array(steps), done = 0;
            var acBound = state.layers[0] && state.layers[0].tex === 'asphalt';
            study.running = true;
            study.rows = null;
            study.ran = {
                varId: v.id, name: v.name, q: v.q, unit: studyUnit(v),
                current: studyCurrent(v), acBound: acBound
            };
            $('lp-study-run').disabled = true;
            studyNote('Solving 0 of ' + steps + '…');

            for (var k = 0; k < steps; k++) {
                (function (k) {
                    var value = from + (to - from) * k / (steps - 1);
                    var built = studyJob(v, value);
                    postJob('study', built.job, function (err, res) {
                        if (gen !== jobGen || disposed) return;
                        pending--; done++;
                        if (!err && res) {
                            var kp = [], bs = [];
                            res.points.forEach(function (p) {
                                (p.tag && p.tag.t === 'bs' ? bs : kp).push(p);
                            });
                            var ex = extremesFrom(kp, built.layers, bs);
                            var epsT = acBound && ex.et ? Math.abs(ex.et.v) : null;
                            var epsV = ex.ev ? Math.abs(ex.ev.v) : null;
                            var Nf = epsT == null ? null : fatigueLife(epsT, built.layers[0].E);
                            var Nr = epsV == null ? null : ruttingLife(epsV);
                            rows[k] = { value: value, ex: ex, Nf: Nf, Nr: Nr, Ng: governingLife(Nf, Nr) };
                        }
                        studyNote('Solving ' + done + ' of ' + steps + '…');
                        if (pending <= 0) {
                            study.running = false;
                            study.rows = rows.filter(function (r) { return !!r; });
                            $('lp-study-run').disabled = false;
                            renderStudy();
                        }
                    });
                })(k);
            }
        }

        function studySeries(respId) {
            var r = null;
            for (var i = 0; i < STUDY_RESP.length; i++) if (STUDY_RESP[i].id === respId) r = STUDY_RESP[i];
            return r || STUDY_RESP[0];
        }

        /* Where the curve crosses the target, in the units on screen.
         * Interpolated in log N, which is the space a life is smooth in and
         * the space the transfer functions are straight lines in. */
        function studyCrossing(rows, resp, target) {
            if (!resp.log || !(target > 0)) return null;
            for (var i = 1; i < rows.length; i++) {
                var a = resp.get(rows[i - 1]), b = resp.get(rows[i]);
                if (!(a > 0) || !(b > 0)) continue;
                if ((a - target) * (b - target) > 0) continue;
                if (a === b) return rows[i].value;
                var t = (Math.log10(target) - Math.log10(a)) / (Math.log10(b) - Math.log10(a));
                return rows[i - 1].value + t * (rows[i].value - rows[i - 1].value);
            }
            return null;
        }

        function renderStudyControls(keepRange) {
            var sel = $('lp-study-var');
            if (!sel) return;
            var vars = studyVars();
            var runBtn = $('lp-study-run');
            if (!vars.length) {
                /* The panels are built before the unit gate is answered, so
                   there is a moment with no section to sweep at all. */
                sel.innerHTML = '';
                if (runBtn) runBtn.disabled = true;
                return;
            }
            if (runBtn && !study.running) runBtn.disabled = false;
            var want = study.varId || (vars[0] && vars[0].id);
            sel.innerHTML = '';
            vars.forEach(function (v) {
                var o = doc.createElement('option');
                o.value = v.id; o.textContent = v.name;
                sel.appendChild(o);
            });
            if (!vars.some(function (v) { return v.id === want; })) want = vars[0] && vars[0].id;
            sel.value = want || '';
            study.varId = sel.value;

            var v = studyVarById(study.varId);
            var unitSpan = $('lp-study-unit');
            if (unitSpan) unitSpan.textContent = studyUnit(v);
            /* Also when the boxes are empty: the panel is built before the
               unit gate is answered, so the first fill has nothing to fill
               from and the range would stay blank until the variable was
               changed by hand. */
            /* Also when the boxes are empty: the panel is built before the
               unit gate is answered, so the first fill has nothing to fill
               from, and the range would stay blank until the variable was
               changed by hand. */
            if (!keepRange || !$('lp-study-from').value || !$('lp-study-to').value) {
                var d = studyDefaults(v);
                $('lp-study-from').value = String(d.from);
                $('lp-study-to').value = String(d.to);
            }
            var rsel = $('lp-study-resp');
            if (rsel && !rsel.options.length) {
                STUDY_RESP.forEach(function (r) {
                    var o = doc.createElement('option');
                    o.value = r.id;
                    o.textContent = symText(r.sym) + '  ·  ' + r.name;
                    rsel.appendChild(o);
                });
                rsel.value = study.resp;
            }
            var resp = studySeries(study.resp);
            var tw = $('lp-study-target-wrap');
            if (tw) tw.hidden = !resp.log;
        }

        function renderStudy() {
            renderStudyControls(true);
            if (study.running) return;
            if (!study.rows || !study.rows.length) {
                studyNote('Pick a quantity, give it a range, and press <strong>Run study</strong>. ' +
                    'Every step is solved with the same critical-response rule the panels use.');
                var P0 = plotly(), h0 = $('lp-chart-study');
                if (P0 && h0) { try { P0.purge(h0); } catch (e) { /* never drawn */ } }
                return;
            }
            renderStudyChart();
        }

        function renderStudyChart() {
            var P = plotly(), hostEl = $('lp-chart-study');
            if (!hostEl) return;
            if (!P) { clearTimeout(studyRetry); studyRetry = setTimeout(renderStudyChart, 500); return; }
            var ran = study.ran, rows = study.rows;
            if (!ran || !rows || !rows.length) return;
            var resp = studySeries(study.resp);
            var vq = function (x) { return ran.q ? toDisp(ran.q, x) : x; };
            var xs = rows.map(function (r) { return vq(r.value); });
            var ys = rows.map(function (r) {
                var y = resp.get(r);
                if (y == null) return null;
                return resp.q ? toDisp(resp.q, y) : y;
            });
            var xUnit = ran.unit ? ' (' + ran.unit + ')' : '';
            var yUnit = resp.q ? ' (' + unit(resp.q) + ')' : '';
            var lay = chartLayout(ran.name + xUnit,
                symText(resp.sym) + yUnit, { showlegend: false, noReverseY: true });
            if (resp.log) {
                lay.yaxis.type = 'log';
                /* Under one decade Plotly labels the minor ticks with bare
                   mantissas, so a column of repetitions reads 4, 6, 8, 1M,
                   2, 3. Every tick prints its own magnitude instead. */
                lay.yaxis.tickformat = '~s';
            }

            var shapes = [], anns = [];
            var xCur = vq(ran.current);
            shapes.push({
                type: 'line', xref: 'x', yref: 'paper', x0: xCur, x1: xCur, y0: 0, y1: 1,
                line: { color: cssVar('--lp-accent'), width: 1.4, dash: 'dot' }
            });
            anns.push({
                x: xCur, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom',
                text: 'this design', showarrow: false,
                font: { size: 10, color: cssVar('--lp-accent') }
            });

            var solved = null;
            if (resp.log && study.target > 0) {
                var ty = study.target;
                shapes.push({
                    type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: ty, y1: ty,
                    line: { color: cssVar('--lp-ink3'), width: 1.2, dash: 'dash' }
                });
                solved = studyCrossing(rows, resp, ty);
            }
            var traces = [{
                x: xs, y: ys, mode: 'lines+markers',
                line: { color: cssVar('--lp-cat1'), width: 2.2, shape: 'spline', smoothing: 0.6 },
                marker: { size: 6, color: cssVar('--lp-cat1') },
                connectgaps: false,
                hovertemplate: '%{x:.4g}' + xUnit + '  →  %{y:.4g}' + yUnit + '<extra></extra>'
            }];
            if (solved != null) {
                traces.push({
                    x: [vq(solved)], y: [study.target], mode: 'markers',
                    marker: { size: 11, color: cssVar('--lp-ok'), symbol: 'diamond',
                        line: { color: cssVar('--lp-bg1'), width: 1.5 } },
                    hovertemplate: 'target at %{x:.4g}' + xUnit + '<extra></extra>'
                });
            }
            lay.shapes = shapes;
            lay.annotations = anns;
            P.react(hostEl, traces, lay, { displayModeBar: false, responsive: true });

            /* The reading, in words, because the number the study was run
               for is the crossing and not the curve. */
            var here = resp.get(rows.reduce(function (best, r) {
                return best == null || Math.abs(r.value - ran.current) < Math.abs(best.value - ran.current) ? r : best;
            }, null));
            var uSuffix = ran.unit ? ' ' + ran.unit : '';
            var txt = '<strong>' + rows.length + '</strong> sections solved. ';
            if (here != null) {
                txt += 'At ' + sig(vq(ran.current), 4) + uSuffix + ', ' +
                    symText(resp.sym) + ' is ' +
                    (resp.log ? fmtLife(here) : sig(resp.q ? toDisp(resp.q, here) : here, 4) +
                        (resp.q ? ' ' + unit(resp.q) : '')) + '. ';
            }
            if (resp.log) {
                txt += solved != null
                    ? '<strong>' + fmtLife(study.target) + '</strong> repetitions at ' +
                      ran.name + ' = <strong>' + sig(vq(solved), 4) + uSuffix +
                      '</strong>, interpolated between the two steps that straddle it.'
                    : 'The target is not crossed inside this range.';
            }
            if (!ran.acBound && (resp.id === 'Nf' || resp.id === 'Ng')) {
                txt += ' The surface layer is not asphalt-bound, so there is no fatigue life to plot.';
            }
            studyNote(txt);
        }

        function exportStudyCsv() {
            if (!study.rows || !study.rows.length) return;
            var ran = study.ran;
            var lines = [];
            lines.push('# LEAPS design study');
            lines.push('# ' + ran.name + ', ' + study.rows.length + ' steps, units ' + state.settings.units);
            function csv(v) {
                var t = String(v == null ? '' : v);
                return /[",\n]/.test(t) ? '"' + t.split('"').join('""') + '"' : t;
            }
            function row(cells) { return cells.map(csv).join(','); }
            lines.push(row([ran.name + ' (' + (ran.unit || 'dimensionless') + ')',
                'et (' + unit('strain') + ')', 'ev (' + unit('strain') + ')',
                'w (' + unit('defl') + ')', 'Nf', 'Nr', 'N governing', 'governed by']));
            study.rows.forEach(function (r) {
                var et = r.ex.et ? Math.abs(r.ex.et.v) : null;
                var ev = r.ex.ev ? Math.abs(r.ex.ev.v) : null;
                var w0 = r.ex.w0 ? Math.abs(r.ex.w0.v) : null;
                function f(x, q) { return x == null ? '' : sig(q ? toDisp(q, x) : x, 6); }
                lines.push(row([
                    f(r.value, ran.q), f(et, 'strain'), f(ev, 'strain'), f(w0, 'defl'),
                    f(r.Nf), f(r.Nr), r.Ng ? sig(r.Ng.N, 6) : '', r.Ng ? r.Ng.by : ''
                ]));
            });
            download((state.name || 'leaps') + '-study.csv', lines.join('\n'), 'text/csv');
        }

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

        function zoomView(k) {
            if (state.settings.view3d) {
                /* zoom about the middle of the canvas, so the thing being
                   looked at stays where it is being looked at */
                var cx = vpW / 2, cy = (vpH - X_RULER_H) / 2;
                view3.ox = cx + (view3.ox - cx) * k;
                view3.oy = cy + (view3.oy - cy) * k;
                view3.scale *= k;
            } else view.scale *= k;
            drawViewport();
        }
        function syncViewMode() {
            $$('#lp-viewmode .lp-seg-btn').forEach(function (b) {
                b.classList.toggle('is-active', (b.dataset.view === '3d') === !!state.settings.view3d);
            });
            /* The plan inset is a second picture of exactly what the 3-D
             * view already shows, drawn over the top of it, and the one
             * thing it was needed for -- moving the section line -- is a
             * drag on the cut plane out there. It comes back untouched,
             * collapsed or not, when the Section view does. */
            var pp = $('lp-plan-panel');
            if (pp) pp.classList.toggle('is-away', !!state.settings.view3d);
        }
        function fitView() {
            if (state.settings.view3d) { fit3(); drawViewport(); return; }
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
        /* A dimension line, drawn the way a drawing draws one: two extension
         * ticks, a line with arrowheads between them, and the number in a
         * gap in the middle. It is what ties 'a = 95.4 mm' in the caption to
         * the width on the page, which is the whole reason a figure beats a
         * table for geometry. */
        function dimLine(x1, x2, y, label, col) {
            var w = Math.abs(x2 - x1);
            if (w < 30) return;
            ctx.save();
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5);
            ctx.moveTo(x2, y - 5); ctx.lineTo(x2, y + 5);
            ctx.moveTo(x1, y); ctx.lineTo(x2, y);
            ctx.stroke();
            [[x1, 1], [x2, -1]].forEach(function (e) {
                ctx.beginPath();
                ctx.moveTo(e[0], y); ctx.lineTo(e[0] + 5 * e[1], y - 2.6);
                ctx.lineTo(e[0] + 5 * e[1], y + 2.6); ctx.closePath(); ctx.fill();
            });
            ctx.font = '10px ' + monoFont();
            var tw = ctx.measureText(label).width;
            var mid = (x1 + x2) / 2;
            ctx.fillStyle = rgba('--lp-bg1', 0.92);
            ctx.fillRect(mid - tw / 2 - 3, y - 7, tw + 6, 14);
            ctx.fillStyle = col;
            ctx.textAlign = 'center';
            ctx.fillText(label, mid, y + 3.5);
            ctx.textAlign = 'left';
            ctx.restore();
        }

        /* The circled cross of an axis that runs into the page: a line load
         * at the default azimuth is PERPENDICULAR to the section, so it
         * crosses this plane at one point, and without the mark that reads
         * as a point load rather than as a line seen end on. */
        function intoPage(x, y, r, col) {
            ctx.save();
            ctx.strokeStyle = col; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.stroke();
            var d = r * 0.68;
            ctx.beginPath();
            ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
            ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
            ctx.stroke();
            ctx.restore();
        }

        function chipNote(x, y, text, col) {
            ctx.save();
            ctx.font = '9px ' + monoFont();
            var tw = ctx.measureText(text).width;
            ctx.fillStyle = rgba('--lp-bg1', 0.92);
            ctx.strokeStyle = col; ctx.lineWidth = 1;
            roundRect(ctx, x, y - 8, tw + 10, 15, 4); ctx.fill(); ctx.stroke();
            ctx.fillStyle = col;
            ctx.fillText(text, x + 5, y + 3);
            ctx.restore();
        }

        function drawLoadSection(G, danger, y0) {
            var cx = G.cx, contactHalf = G.contactHalf;
            var kind = state.loadKind;
            var annotate = !!G.annotate;

            /* ground contact shadow, same for all three */
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.ellipse(cx, y0 + 2.5, Math.max(contactHalf, 4) * 1.3 + 3, 3, 0, 0, 6.3);
            ctx.fill();

            if (kind === 'point') {
                var h = 58;
                /* One force, all of it at one place. The shaft is drawn
                 * heavier than the other two idealizations carry because
                 * that is the point of it: the same total load with no
                 * area at all under it. */
                ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 2.6;
                ctx.beginPath(); ctx.moveTo(cx, y0 - h); ctx.lineTo(cx, y0 - 4); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cx, y0); ctx.lineTo(cx - 5.5, y0 - 10); ctx.lineTo(cx + 5.5, y0 - 10);
                ctx.closePath(); ctx.fill();
                /* the singularity, drawn as one: no finite response lives
                 * at the load itself, and the table prints nothing there */
                ctx.save();
                ctx.strokeStyle = danger; ctx.lineWidth = 1; ctx.globalAlpha = 0.75;
                ctx.setLineDash([2, 2.5]);
                ctx.beginPath(); ctx.arc(cx, y0, 7, 0, 6.3); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, y0, 12, 0, 6.3); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = danger;
                ctx.beginPath(); ctx.arc(cx, y0, 2.8, 0, 6.3); ctx.fill();
                if (annotate) chipNote(cx + 15, y0 + 1, 'singular', danger);
                return { top: y0 - h };
            }

            if (kind === 'line') {
                /* The segment crosses this plane at whatever its azimuth
                 * projects onto x, and at the default 90 degrees that is a
                 * POINT: the line runs along y, into the page. Drawing that
                 * case as a three-pixel knife edge and saying nothing is how
                 * a line load comes to be read as a point load. */
                var th = gearParams.theta * Math.PI / 180;
                var projW = Math.abs(gearParams.L * Math.cos(th));
                var halfW = projW * 0.5 * view.scale;
                var endOn = halfW < 6;
                var hh = 48;
                if (endOn) {
                    ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 2.2;
                    ctx.beginPath(); ctx.moveTo(cx, y0 - hh); ctx.lineTo(cx, y0 - 11); ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(cx, y0 - 1); ctx.lineTo(cx - 5, y0 - 11); ctx.lineTo(cx + 5, y0 - 11);
                    ctx.closePath(); ctx.fill();
                    intoPage(cx, y0 - 20, 7, danger);
                    if (annotate) chipNote(cx + 15, y0 - 20, 'line \u2225 y, seen end on', cssVar('--lp-ink2'));
                    return { top: y0 - hh };
                }
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
                if (annotate) {
                    dimLine(cx - halfW, cx + halfW,
                        y0 + 20, 'L cos\u03B8 ' + sig(toDisp('len', projW), 3) + ' ' + unit('len'),
                        cssVar('--lp-ink2'));
                }
                return { top: y0 - hh };
            }

            /* ---- circular imprint: a tire, and the pressure it applies ----
             * Two things are being drawn and they are not the same thing.
             * The TIRE is scenery: it says which way is up and what the load
             * came off. The BLOCK of pressure between it and the surface is
             * the model, and it is drawn the way a statics figure draws a
             * uniformly distributed load, with a capped band of equal
             * arrows, because 'uniform' is the assumption every layered-
             * elastic program makes and the one worth showing rather than
             * implying. */
            /* A cut in the x-z plane runs ACROSS the tread, so what is seen
             * is the tire's section width against its height, and a real one
             * is far taller than it is wide. The old cap at 54px drew a
             * plank as soon as the view was zoomed in at all. Only the
             * bottom of the wheel is drawn, so this is still a stylization,
             * but the proportion is now the tire's rather than the cap's. */
            var tireHalf = Math.max(contactHalf, 10);
            var tireH = clamp(tireHalf * 1.7, 26, 96);
            var blockH = clamp(tireHalf * 0.55, 11, 19);
            var tireBot = y0 - blockH, ty = tireBot - tireH;

            /* the pressure band */
            ctx.fillStyle = rgba('--lp-danger', 0.14);
            ctx.fillRect(cx - contactHalf, tireBot, 2 * contactHalf, blockH);
            ctx.strokeStyle = danger; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(cx - contactHalf, tireBot + 0.5);
            ctx.lineTo(cx + contactHalf, tireBot + 0.5);
            ctx.stroke();
            ctx.lineWidth = 1;
            var nB = clamp(Math.round(contactHalf / 6), 2, 11);
            for (var q = 0; q < nB; q++) {
                var bx = cx - contactHalf + 2 * contactHalf * (q + 0.5) / nB;
                ctx.beginPath(); ctx.moveTo(bx, tireBot + 2); ctx.lineTo(bx, y0 - 4); ctx.stroke();
                ctx.fillStyle = danger;
                ctx.beginPath();
                ctx.moveTo(bx, y0 - 1); ctx.lineTo(bx - 2.3, y0 - 5); ctx.lineTo(bx + 2.3, y0 - 5);
                ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = danger;
            roundRect(ctx, cx - contactHalf, y0 - 2, 2 * contactHalf, 4, 1.5); ctx.fill();

            /* the tire: tread band, sidewalls, rim */
            var rad = Math.min(tireHalf * 0.42, 11);
            var grad = ctx.createLinearGradient(cx - tireHalf, 0, cx + tireHalf, 0);
            grad.addColorStop(0, '#0e1116');
            grad.addColorStop(0.22, '#2c323b');
            grad.addColorStop(0.5, '#4b525d');
            grad.addColorStop(0.78, '#2c323b');
            grad.addColorStop(1, '#0e1116');
            roundRect(ctx, cx - tireHalf, ty, 2 * tireHalf, tireH, rad);
            ctx.fillStyle = grad; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();

            ctx.save();
            roundRect(ctx, cx - tireHalf, ty, 2 * tireHalf, tireH, rad); ctx.clip();
            /* Circumferential grooves, which on a cut across the tread are
             * the notches in it. No rim: this cut is through the bottom of
             * the wheel and the rim is above it. */
            ctx.strokeStyle = 'rgba(0,0,0,0.42)';
            ctx.lineWidth = Math.max(1.4, tireHalf * 0.055);
            var grooves = clamp(Math.round(tireHalf / 7), 3, 7);
            for (var gi = 1; gi < grooves; gi++) {
                var gx = cx - tireHalf + 2 * tireHalf * gi / grooves;
                ctx.beginPath();
                ctx.moveTo(gx, ty + tireH * 0.72); ctx.lineTo(gx, ty + tireH + 1);
                ctx.stroke();
            }
            /* the shoulders, where a tire's section turns the corner */
            var shG = ctx.createLinearGradient(0, ty + tireH * 0.55, 0, ty + tireH);
            shG.addColorStop(0, 'rgba(0,0,0,0)');
            shG.addColorStop(1, 'rgba(0,0,0,0.3)');
            ctx.fillStyle = shG;
            ctx.fillRect(cx - tireHalf, ty + tireH * 0.55, 2 * tireHalf, tireH * 0.45);
            ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(cx - tireHalf + rad, ty + 2.5); ctx.lineTo(cx + tireHalf - rad, ty + 2.5);
            ctx.stroke();
            ctx.restore();

            /* the contact width, dimensioned once so the number in the
               caption has a length on the page to belong to */
            if (annotate) {
                dimLine(cx - contactHalf, cx + contactHalf, y0 + 20,
                    '2a ' + sig(toDisp('len', 2 * loadA(state.loads[G.wi])), 3) + ' ' + unit('len'),
                    cssVar('--lp-ink2'));
            }
            return { top: ty, mid: ty + tireH / 2 };
        }

        /* The interface state, written on the interface. Three words, a
         * click apart: the condition below a layer is a modeling decision
         * a student changes half a dozen times in one sitting, and walking
         * to a side panel for it every time is the friction that stops them
         * trying the other two. */
        /* The number on the line.
         *
         * An unlabeled iso-line says only that something is constant along
         * it; with the colorbar beside the figure a reader can decode one
         * line by eye, and not a nest of nine. Engraved contour maps put the
         * value IN the line, in a gap broken for it, and that is what this
         * does. Placement is deliberately boring: candidates are the segment
         * midpoints that are on screen and inside the pavement, the one
         * nearest a target rail is taken, and anything within 30px of a
         * label already placed is dropped, so the labels walk down the
         * figure instead of piling up where the gradient is steepest. */
        function drawIsoLabels() {
            if (!contour || !contour.levels) return;
            var f = contour.field;
            var railX = vpW * 0.62, placed = [];
            ctx.save();
            ctx.font = '9px ' + monoFont();
            ctx.textAlign = 'center';
            contour.levels.forEach(function (lv) {
                if (!lv.segs.length) return;
                var best = null, bestD = Infinity;
                for (var i = 0; i < lv.segs.length; i += 2) {
                    var sg = lv.segs[i];
                    var mx = w2sx((sg[0][0] + sg[1][0]) / 2);
                    var my = w2sy((sg[0][1] + sg[1][1]) / 2);
                    if (mx < 40 || mx > vpW - 110 || my < 30 || my > vpH - X_RULER_H - 12) continue;
                    var d = Math.abs(mx - railX);
                    if (d < bestD) { bestD = d; best = [mx, my]; }
                }
                if (!best) return;
                var txt = sig(toDisp(f.q, lv.v), 2);
                var tw = ctx.measureText(txt).width;
                /* reject on the LABELS overlapping, not on a fixed box: a
                   fixed one at 46 by 30 threw away six of the eight lines */
                for (var k = 0; k < placed.length; k++) {
                    if (Math.abs(placed[k][0] - best[0]) < (placed[k][2] + tw) / 2 + 10 &&
                        Math.abs(placed[k][1] - best[1]) < 15) return;
                }
                placed.push([best[0], best[1], tw]);
                ctx.fillStyle = rgba('--lp-bg1', 0.88);
                ctx.fillRect(best[0] - tw / 2 - 3, best[1] - 6, tw + 6, 12);
                ctx.fillStyle = cssVar('--lp-ink2');
                ctx.fillText(txt, best[0], best[1] + 3.5);
            });
            ctx.restore();
            ctx.textAlign = 'left';
        }

        function itfLabel(slip) {
            if (slip <= 0) return 'bonded';
            if (slip >= 1) return 'free';
            return 'slip ' + sig(slip, 2);
        }

        /* ============================ AXES ============================
         * A section with no scale on it is a picture rather than a drawing.
         * The depth rail has always carried z and x carried nothing, so a
         * distance across the section could not be read at all; and the
         * THIRD axis carried nothing anywhere, which is the one thing a
         * reader of a two-dimensional cut through a three-dimensional gear
         * has to be told: which way y points, and where along it this cut
         * was taken. The gnomon says it the way a drafting sheet does, with
         * the axis that runs into the page drawn as a circled cross.
         * ============================================================== */
        var X_RULER_H = 21;

        /* The plan inset floats over the bottom right of the same canvas, so
         * the ruler stops where it starts rather than running underneath it.
         * Measured rather than assumed: the panel collapses. */
        function rulerRight() {
            var panel = $('lp-plan-panel');
            if (!panel || panel.classList.contains('is-collapsed')) return vpW;
            var pr = panel.getBoundingClientRect(), cr = cv.getBoundingClientRect();
            if (!pr.width) return vpW;
            return clamp(pr.left - cr.left - 8, 120, vpW);
        }

        function drawXRuler() {
            var right = rulerRight();
            var yB = vpH - X_RULER_H;
            ctx.fillStyle = rgba('--lp-bg1', 0.88);
            ctx.fillRect(0, yB, right, X_RULER_H);
            ctx.strokeStyle = cssVar('--lp-line');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, yB + 0.5); ctx.lineTo(right, yB + 0.5); ctx.stroke();

            var span = s2wx(right) - s2wx(0);
            var step = niceStep(span / 7);
            var xs = Math.ceil(s2wx(4) / step) * step;
            var unitW = ctx.measureText('x').width;
            ctx.font = '10px ' + monoFont();
            var lblRight = right - 34;
            for (var x = xs; w2sx(x) < lblRight; x += step) {
                var sx = w2sx(x);
                if (sx < 16) continue;
                var zero = Math.abs(x) < step * 1e-6;
                ctx.strokeStyle = zero ? cssVar('--lp-ink2') : cssVar('--lp-line');
                ctx.beginPath();
                ctx.moveTo(sx, yB + 1); ctx.lineTo(sx, yB + (zero ? 8 : 5)); ctx.stroke();
                ctx.fillStyle = zero ? cssVar('--lp-ink2') : cssVar('--lp-ink3');
                ctx.textAlign = 'center';
                ctx.fillText(sig(toDisp('len', x), 4), sx, yB + 17);
            }
            ctx.fillStyle = cssVar('--lp-ink3');
            ctx.textAlign = 'right';
            ctx.fillText('x ' + unit('len'), right - 6, yB + 17);
            ctx.textAlign = 'left';
            void unitW;
        }

        /* x right, z down, y into the page. The third one is the reason this
         * exists: every number in the results table is in these axes, the
         * section is one cut through them, and until the cut is labeled with
         * its own y the reader cannot place it. */
        function drawGnomon() {
            var w = 132, h = 74, pad = 10;
            var ox = pad, oy = vpH - X_RULER_H - h - pad;
            if (oy < 40) return;
            ctx.fillStyle = rgba('--lp-bg1', 0.9);
            ctx.strokeStyle = cssVar('--lp-line');
            ctx.lineWidth = 1;
            roundRect(ctx, ox, oy, w, h, 7); ctx.fill(); ctx.stroke();

            var gx = ox + 26, gy = oy + 22, len = 30;
            var ink2 = cssVar('--lp-ink2'), ink3 = cssVar('--lp-ink3');
            ctx.lineWidth = 1.6;
            ctx.font = '700 11px ' + monoFont();

            /* x, to the right */
            ctx.strokeStyle = ink2; ctx.fillStyle = ink2;
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + len, gy); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx + len + 4, gy); ctx.lineTo(gx + len - 2, gy - 3.2);
            ctx.lineTo(gx + len - 2, gy + 3.2); ctx.closePath(); ctx.fill();
            ctx.fillText('x', gx + len + 8, gy + 4);

            /* z, downward, which is where it points in every layered-elastic
             * program and the opposite of what a plot library assumes */
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + len); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx, gy + len + 4); ctx.lineTo(gx - 3.2, gy + len - 2);
            ctx.lineTo(gx + 3.2, gy + len - 2); ctx.closePath(); ctx.fill();
            /* beside the middle of its own arrow, not under the tip: the
               caption line lives under the tip */
            ctx.fillText('z', gx - 13, gy + len * 0.72);

            /* y, into the page: the drafting circle and cross */
            ctx.strokeStyle = cssVar('--lp-accent');
            ctx.fillStyle = cssVar('--lp-accent');
            ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(gx, gy, 5, 0, 6.3); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx - 3.5, gy - 3.5); ctx.lineTo(gx + 3.5, gy + 3.5);
            ctx.moveTo(gx + 3.5, gy - 3.5); ctx.lineTo(gx - 3.5, gy + 3.5);
            ctx.stroke();
            ctx.fillText('y', gx - 14, gy - 8);

            ctx.font = '10px ' + monoFont();
            ctx.fillStyle = ink3;
            ctx.fillText('cut at y ' + sig(toDisp('len', state.ySec), 4), ox + 9, oy + h - 9);
        }

        /* ========================= THE 3-D VIEW =========================
         * The section answers what happens under one cut. It cannot answer
         * where the cut IS, which is the question a dual tandem raises the
         * moment it is built: four wheels, one plane through them, and a
         * flat drawing that shows two of them and says nothing about the
         * other two. The plan inset was the first answer and it is a second
         * flat picture the reader has to fuse with the first.
         *
         * So: one orthographic box. The far half of the structure is solid
         * and carries the contour on the cut face; the near half is the
         * glass it was cut out of, so the wheels standing on it are still
         * where they are. Orthographic rather than perspective because a
         * drawing that gets measured must not foreshorten.
         * ============================================================== */
        /* ONE tire for the whole gear, sized so that no two of them touch.
         *
         * The test the sizing has to pass is a TRIDEM: three axles a
         * spacing apart, and a radius that looks right under a single
         * wheel puts all three of them through each other. So the radius
         * is not a fixed multiple of anything. It starts from the contact
         * patch, which is the only length the model actually has, and is
         * then scaled down until every pair of wheels clears - whatever
         * the gear, truck or aircraft.
         *
         * A wheel occupies 2w across the track and 2R along it, so a pair
         * clears when |dx| >= 2w OR |dy| >= 2R. Scaling w and R together
         * by ONE factor keeps the tire's proportion while it shrinks, and
         * the factor the tightest pair allows is the one the whole gear
         * uses: wheels of different sizes in one gear would read as
         * different tires rather than as one set.
         *
         * Below a quarter more than the patch there is no tire worth
         * drawing - the wheels would be closer together than wheels can
         * be - and the view falls back to the imprints and their arrows,
         * which is the honest picture of a gear that cannot exist. */
        function tireGeom() {
            var ws = state.loads;
            if (state.loadKind !== 'circle' || !ws.length) return null;
            var a = 0;
            for (var i = 0; i < ws.length; i++) a = Math.max(a, loadA(ws[i]));
            return tireFit(ws, Math.max(a, 20));
        }
        function tireTop() {
            var g = tireGeom();
            return g ? -(g.h + g.R) : 0;
        }

        function sceneBox() {
            var box = worldBox();
            var yc = 0, n = state.loads.length;
            if (n) {
                var sy = 0;
                state.loads.forEach(function (w) { sy += w.y; });
                yc = sy / n;
            }
            var span = box.xR - box.xL;
            var yExt = 0;
            state.loads.forEach(function (w) { yExt = Math.max(yExt, Math.abs(w.y - yc)); });
            if (state.loadKind === 'line') {
                yExt += 0.5 * gearParams.L * Math.abs(Math.sin(gearParams.theta * Math.PI / 180));
            }
            var yHalf = clamp(yExt + 4 * maxA(), 0.2 * span, 0.5 * span);
            return {
                xL: box.xL, xR: box.xR, zMax: box.zMax, df: box.df,
                zTop: tireTop(),
                y0: Math.min(yc - yHalf, state.ySec - 60),
                y1: Math.max(yc + yHalf, state.ySec + 60)
            };
        }
        /* The projection is affine, which is the whole reason the contour
         * image can be poured onto the cut face with one ctx.transform
         * rather than resampled pixel by pixel. */
        function basis3(scale) {
            return axonometric(view3.az, view3.el, scale == null ? view3.scale : scale);
        }
        function P3(B, x, y, z, noOff) {
            var ox = noOff ? 0 : view3.ox, oy = noOff ? 0 : view3.oy;
            return [ox + x * B.ex[0] + y * B.ey[0] + z * B.ez[0],
                    oy + x * B.ex[1] + y * B.ey[1] + z * B.ez[1]];
        }
        function fit3() {
            var sb = sceneBox(), U = basis3(1);
            var xs = [], ys = [];
            [sb.xL, sb.xR].forEach(function (x) {
                [sb.y0, sb.y1].forEach(function (y) {
                    [sb.zTop, 0, sb.zMax].forEach(function (z) {
                        var p = P3(U, x, y, z, true);
                        xs.push(p[0]); ys.push(p[1]);
                    });
                });
            });
            var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
            var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
            var availW = vpW - 96, availH = vpH - X_RULER_H - 86;
            var sc = Math.min(availW / Math.max(x1 - x0, 1e-6), availH / Math.max(y1 - y0, 1e-6));
            view3.scale = sc;
            view3.ox = vpW / 2 - sc * (x0 + x1) / 2;
            view3.oy = (vpH - X_RULER_H) / 2 + 6 - sc * (y0 + y1) / 2;
            view3.fitted = true;
        }
        function poly3(B, pts, fill, stroke, lw) {
            ctx.beginPath();
            pts.forEach(function (q, i) {
                var p = P3(B, q[0], q[1], q[2]);
                if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
            });
            ctx.closePath();
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
        }
        function line3(B, a, b, col, lw, dash) {
            var p = P3(B, a[0], a[1], a[2]), q = P3(B, b[0], b[1], b[2]);
            ctx.save();
            if (dash) ctx.setLineDash(dash);
            ctx.strokeStyle = col; ctx.lineWidth = lw || 1;
            ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
            ctx.restore();
        }
        /* A circle on the ground is an ellipse on the page, and it is the
         * image of the unit circle under the same affine map, so it is drawn
         * by handing the map to the context rather than by solving for axes
         * and rotation. */
        function ellipse3(B, cxw, cyw, r, fill, stroke, lw) {
            var c = P3(B, cxw, cyw, 0);
            ctx.save();
            ctx.transform(r * B.ex[0], r * B.ex[1], r * B.ey[0], r * B.ey[1], c[0], c[1]);
            ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3);
            ctx.restore();
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
        }

        /* The orientation widget, in the corner rather than in the scene.
         * Put on the box it lands on whichever face happens to be behind it
         * and reads as part of the structure, which it is not: it is the
         * reader's compass, and a compass belongs at the edge of the map.
         * It turns with the camera, which is the whole of its job. */
        function triadBox3() {
            var w = 108, h = 92, pad = 10;
            return { x: pad, y: vpH - h - pad, w: w, h: h };
        }
        function hitTriad3(mx, my) {
            if (!state.settings.view3d) return false;
            var b = triadBox3();
            return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
        }
        function drawTriad3(B, nearIsLow) {
            var bx = triadBox3(), w = bx.w, h = bx.h;
            var ox = bx.x, oy = bx.y;
            ctx.save();
            ctx.fillStyle = rgba('--lp-bg1', 0.86);
            ctx.strokeStyle = cssVar('--lp-line');
            ctx.lineWidth = 1;
            roundRect(ctx, ox, oy, w, h, 7); ctx.fill(); ctx.stroke();

            var cx = ox + w / 2, cy = oy + h / 2 - 4, r = 30;
            var unitS = Math.sqrt(B.ex[0] * B.ex[0] + B.ex[1] * B.ex[1]) || 1;
            var dirs = [
                [B.ex[0] / unitS, B.ex[1] / unitS, 'x'],
                [B.ey[0] / unitS * (nearIsLow ? 1 : 1), B.ey[1] / unitS, 'y'],
                [B.ez[0] / unitS, B.ez[1] / unitS, 'z']
            ];
            ctx.font = '700 11px ' + monoFont();
            dirs.forEach(function (d) {
                var tx = cx + d[0] * r, ty = cy + d[1] * r;
                var col = d[2] === 'z' ? cssVar('--lp-accent') : cssVar('--lp-ink2');
                ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
                var m = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1;
                var ux = d[0] / m, uy = d[1] / m;
                ctx.beginPath();
                ctx.moveTo(tx + ux * 5, ty + uy * 5);
                ctx.lineTo(tx - uy * 3.2, ty + ux * 3.2);
                ctx.lineTo(tx + uy * 3.2, ty - ux * 3.2);
                ctx.closePath(); ctx.fill();
                ctx.textAlign = 'center';
                ctx.fillText(d[2], tx + ux * 11, ty + uy * 11 + 4);
                ctx.textAlign = 'left';
            });
            ctx.fillStyle = cssVar('--lp-ink3');
            ctx.font = '9px ' + monoFont();
            ctx.textAlign = 'center';
            var isIso = Math.abs(view3.az - ISO3.az) < 0.6 && Math.abs(view3.el - ISO3.el) < 0.6;
            ctx.fillText(isIso ? 'isometric' :
                (Math.round(((view3.az % 360) + 360) % 360) + '° / ' + Math.round(view3.el) + '°  ·  reset'),
                cx, oy + h - 7);
            ctx.textAlign = 'left';
            ctx.restore();
        }

        /* Where the cut plane's top edge is on screen, and how far the
         * pointer is from it. The edge is the handle: dragging the section
         * through the gear is the one edit this view can offer honestly,
         * because y is the only coordinate a point on that line is free in.
         * Everything else would need a depth the screen does not carry. */
        function cutEdge3() {
            var sb = sceneBox(), B = basis3();
            var ySec = clamp(state.ySec, sb.y0, sb.y1);
            return { a: P3(B, sb.xL, ySec, 0), b: P3(B, sb.xR, ySec, 0), B: B, sb: sb };
        }
        function hitCut3(mx, my) {
            var e = cutEdge3();
            var ax = e.a[0], ay = e.a[1], bx = e.b[0], by = e.b[1];
            var vx = bx - ax, vy = by - ay;
            var len2 = vx * vx + vy * vy;
            if (len2 < 1) return false;
            var t = clamp(((mx - ax) * vx + (my - ay) * vy) / len2, 0, 1);
            var px = ax + t * vx, py = ay + t * vy;
            return Math.hypot(mx - px, my - py) < 9;
        }
        /* A screen displacement, read back as a displacement in y. The
         * projection is affine, so this is the least-squares inverse of one
         * basis vector and not an approximation. */
        function screenToY3(dx, dy) {
            var B = basis3();
            var ey = B.ey, len2 = ey[0] * ey[0] + ey[1] * ey[1];
            if (len2 < 1e-12) return 0;
            return (dx * ey[0] + dy * ey[1]) / len2;
        }

        /* A face of the box: shaded by its own normal, textured, and then
         * given the stones the cut went through. */
        function face3(B, quad, mat, n, L, uv, quality) {
            var k = lambert3(n, L);
            poly3(B, quad, shadeHex(mat.color, k), null);
            ctx.save();
            ctx.globalAlpha = uv ? 0.42 : 0.2;
            poly3(B, quad, texture(mat), null);
            ctx.restore();
            if (uv && quality !== 'draft') aggregate3(B, mat, n, L, uv, quad);
            return k;
        }

        /* The particles, projected into the face. Sized in millimeters and
         * drawn as flattened discs, which is what a saw cut through a
         * graded aggregate actually looks like: no particle is a circle. */
        function aggregate3(B, mat, n, L, uv, quad) {
            var spec = AGG[mat.tex] || AGG.soil;
            var pts = aggregateFor(mat.tex, (mat.id || mat.name || 'x').length * 977 + mat.tex.length * 31);
            /* how much of the face is on screen decides how many are worth
               drawing: a band two pixels tall gets none */
            var scr = quad.map(function (q) { return P3(B, q[0], q[1], q[2]); });
            var area = Math.abs(
                (scr[1][0] - scr[0][0]) * (scr[3][1] - scr[0][1]) -
                (scr[3][0] - scr[0][0]) * (scr[1][1] - scr[0][1]));
            var want = clamp(Math.round(area / 2600), 0, pts.length);
            if (want < 3) return;
            var k = lambert3(n, L);
            var sc = view3.scale;
            ctx.save();
            for (var i = 0; i < want; i++) {
                var g = pts[i];
                var w = uv(g.u, g.v);
                var c = P3(B, w[0], w[1], w[2]);
                var rr = g.r * sc;
                if (rr < 0.55) continue;
                ctx.fillStyle = shadeHex(mat.color, k * g.k);
                ctx.beginPath();
                ctx.ellipse(c[0], c[1], rr, rr * g.e, g.rot, 0, 6.3);
                ctx.fill();
                if (spec.edge && rr > 2.2) {
                    ctx.strokeStyle = shadeHex(mat.color, k * 0.5);
                    ctx.globalAlpha = spec.edge;
                    ctx.lineWidth = Math.min(1, rr * 0.18);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
            ctx.restore();
        }

        /* A wheel, as a wheel.
         *
         * The model underneath is still a uniform pressure over a circle -
         * the tire is scenery, and the contact patch it stands on is the
         * physics - but a gear drawn as four discs on the ground is a gear
         * nobody recognizes. Radius and width are tied to the CONTACT patch
         * (R = 4.2a, W = 2a), so a wider tire is a wider footprint and the
         * proportion stays a truck's rather than a cartoon's.
         *
         * Built as a swept band of quads around the axle with back faces
         * culled and each quad lit by its own normal, which is the whole of
         * what makes a cylinder look round. */
        function drawTire3(B, w, wi, L, W3, quality, cutY, keep, part, G) {
            if (!G) return;
            var R = G.R, halfW = G.w, h = G.h;
            var a = loadA(w);
            var x0 = w.x, y0 = w.y;
            var N = quality === 'draft' ? 18 : 40;
            var dark = '#23262b';
            var scr = view3.scale, rr = R * scr;
            var q = cutY == null ? -2 : clamp((cutY - y0) / R, -2, 2);
            function keptY(yv) { return cutY == null || (keep > 0 ? yv >= cutY : yv <= cutY); }

            /* The profile of a LOADED tire: a circle about the axle,
             * flattened where it meets the ground. The axle rides at
             * h = sqrt(R^2 - flat^2), so the flat comes out exactly as long
             * as the contact it is standing on: the deformation IS the
             * imprint, which is the one place this drawing and the model
             * touch. */
            function py(t) { return y0 + R * Math.sin(t); }
            function pz(t) { var z = -h + R * Math.cos(t); return z > 0 ? 0 : z; }

            if (part === 'cut') {
                if (cutY == null || Math.abs(q) >= 1) return;
                /* The wheel's own section is scenery beside the pavement's,
                   which is data, so it is drawn a shade quieter: a tire cut
                   through its axis is a tall narrow shape and at full
                   strength it competes with the face it stands on. */
                ctx.save();
                ctx.globalAlpha *= 0.75;
                var dy = cutY - y0;
                var kCut = lambert3([0, keep > 0 ? -1 : 1, 0], L);
                /* half the height of the section of a ring of radius r */
                function hz(r) {
                    var v = r * r - dy * dy;
                    return v > 0 ? Math.sqrt(v) : 0;
                }
                /* one band of material, clipped at the ground */
                function band(zA, zB, wid, col) {
                    var z1 = Math.min(zA, zB), z2 = Math.max(zA, zB);
                    z2 = Math.min(z2, 0);
                    if (!(z2 - z1 > 0.4)) return;
                    poly3(B, [
                        [x0 - wid, cutY, z1], [x0 + wid, cutY, z1],
                        [x0 + wid, cutY, z2], [x0 - wid, cutY, z2]
                    ], shadeHex(col, kCut), 'rgba(0,0,0,0.28)', 1);
                }
                /* the tread and its carcass: the outer ring */
                var oR = hz(R), iR = hz(R * 0.78);
                band(-h - oR, -h - iR, halfW, '#43474f');
                band(-h + iR, -h + oR, halfW, '#43474f');
                /* the wheel itself: rim to rim through the disc, in one
                   piece and narrower than the tire it carries */
                var oW = hz(R * 0.66);
                if (oW > 0) band(-h - oW, -h + oW, halfW * 0.5, '#96a0ac');
                /* the hub boss, thicker again at the axle */
                var oH = hz(R * 0.2);
                if (oH > 0) band(-h - oH, -h + oH, halfW * 0.72, '#c3cad3');
                ctx.restore();
                return;
            }

            /* the shadow, which is what puts the wheel ON the ground */
            if (quality !== 'draft' && keptY(y0)) {
                var c0 = P3(B, x0, y0, 0);
                ctx.save();
                ctx.transform(a * 2.1 * B.ex[0], a * 2.1 * B.ex[1],
                    a * 2.1 * B.ey[0], a * 2.1 * B.ey[1], c0[0], c0[1]);
                var sg = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 1);
                sg.addColorStop(0, 'rgba(0,0,0,0.4)');
                sg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = sg;
                ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.fill();
                ctx.restore();
            }

            /* the imprint the model actually applies, under the tire */
            if (keptY(y0)) {
                ellipse3(B, x0, y0, a, rgba('--lp-danger', 0.42), null, 0);
                /* and the dark line of the contact itself, tight to the
                   flat: without it the wheel reads as hovering over its
                   own footprint, which is the one thing it must not do */
                var cf = P3(B, x0, y0, 0);
                ctx.save();
                ctx.transform(halfW * 1.12 * B.ex[0], halfW * 1.12 * B.ex[1],
                    G.flat * 1.15 * B.ey[0], G.flat * 1.15 * B.ey[1], cf[0], cf[1]);
                var cg = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
                cg.addColorStop(0, 'rgba(0,0,0,0.5)');
                cg.addColorStop(0.7, 'rgba(0,0,0,0.28)');
                cg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = cg;
                ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.fill();
                ctx.restore();
            }

            /* ---- the tread, swept around the axle ---- */
            var GR = [0.26, 0.5, 0.74], GW = 0.055;       /* circumferential grooves */
            var t0, t1, tm, nrm, k, sinT0, sinT1, i2, gi;
            for (i2 = 0; i2 < N; i2++) {
                t0 = i2 / N * 6.283185307; t1 = (i2 + 1) / N * 6.283185307;
                tm = (t0 + t1) / 2;
                nrm = [0, Math.sin(tm), Math.cos(tm)];
                if (nrm[0] * W3[0] + nrm[1] * W3[1] + nrm[2] * W3[2] >= 0) continue;
                if (!keptY(py(tm))) continue;
                sinT0 = py(t0); sinT1 = py(t1);
                k = lambert3(nrm, L);
                poly3(B, [
                    [x0 - halfW, sinT0, pz(t0)], [x0 + halfW, sinT0, pz(t0)],
                    [x0 + halfW, sinT1, pz(t1)], [x0 - halfW, sinT1, pz(t1)]
                ], shadeHex(dark, k * 1.08), null);
                /* the grooves, which is what a tread is: without them a
                   tire is a black doughnut */
                if (quality !== 'draft' && halfW * scr > 5) {
                    for (gi = 0; gi < GR.length; gi++) {
                        var u0 = x0 - halfW + 2 * halfW * (GR[gi] - GW);
                        var u1 = x0 - halfW + 2 * halfW * (GR[gi] + GW);
                        poly3(B, [
                            [u0, sinT0, pz(t0)], [u1, sinT0, pz(t0)],
                            [u1, sinT1, pz(t1)], [u0, sinT1, pz(t1)]
                        ], shadeHex(dark, k * 0.6), null);
                    }
                }
            }

            /* ---- the sidewall the camera can see ---- */
            var xs = W3[0] > 0 ? x0 - halfW : x0 + halfW;
            var c = P3(B, xs, y0, -h);
            var a0 = 0, a1 = 6.283185307, whole = true;
            if (cutY != null && Math.abs(q) <= 1) {
                var ac = Math.acos(clamp(keep > 0 ? q : -q, -1, 1));
                a0 = keep > 0 ? -ac : Math.PI - ac;
                a1 = keep > 0 ? ac : Math.PI + ac;
                whole = false;
            }
            function disc(rad, fill, stroke, lw) {
                ctx.save();
                ctx.transform(rad * B.ey[0], rad * B.ey[1], rad * B.ez[0], rad * B.ez[1], c[0], c[1]);
                ctx.beginPath();
                ctx.arc(0, 0, 1, a0, a1);
                if (!whole) ctx.closePath();
                ctx.restore();
                if (fill) { ctx.fillStyle = fill; ctx.fill(); }
                if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
            }
            /* the outer sidewall: the profile itself, flat and all */
            function wallPath() {
                var M = Math.max(N, 28), started = false, i3, t, p;
                ctx.beginPath();
                for (i3 = 0; i3 <= M; i3++) {
                    t = i3 / M * 6.283185307;
                    if (!keptY(py(t))) { started = false; continue; }
                    p = P3(B, xs, py(t), pz(t));
                    if (started) ctx.lineTo(p[0], p[1]);
                    else { ctx.moveTo(p[0], p[1]); started = true; }
                }
                ctx.closePath();
            }
            var kSide = lambert3([W3[0] > 0 ? -1 : 1, 0, 0], L);
            /* a radial fall-off across the sidewall, in SCREEN space because
               that is where the gradient lives: a flat disc reads as a
               sticker, and one lit from the same side as the box reads as
               rubber */
            var sw = ctx.createRadialGradient(
                c[0] - rr * 0.35, c[1] - rr * 0.4, rr * 0.05, c[0], c[1], rr * 1.05);
            sw.addColorStop(0, shadeHex(dark, kSide * 1.5));
            sw.addColorStop(0.55, shadeHex(dark, kSide * 1.08));
            sw.addColorStop(1, shadeHex(dark, kSide * 0.72));
            wallPath();
            ctx.fillStyle = sw; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
            if (rr > 10) disc(R * 0.78, null, shadeHex(dark, kSide * 0.65), 1);   /* the bead */

            if (rr > 15) {
                var rim = ctx.createRadialGradient(
                    c[0] - rr * 0.3, c[1] - rr * 0.35, rr * 0.03, c[0], c[1], rr * 0.66);
                rim.addColorStop(0, shadeHex('#c6ced8', kSide * 1.12));
                rim.addColorStop(0.6, shadeHex('#96a0ac', kSide * 1.02));
                rim.addColorStop(1, shadeHex('#6d7681', kSide * 0.95));
                disc(R * 0.62, rim, 'rgba(0,0,0,0.45)', 1);
                disc(R * 0.46, shadeHex('#5f6771', kSide), null, 0);
                disc(R * 0.16, shadeHex('#c3cad3', kSide * 1.12), 'rgba(0,0,0,0.4)', 1);
                /* the lugs. Six of them, in the plane of the wheel, which is
                   the detail that makes it read as a wheel at a glance */
                if (rr > 34 && quality !== 'draft') {
                    ctx.fillStyle = shadeHex('#aab3bd', kSide * 1.05);
                    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                    ctx.lineWidth = 0.8;
                    for (var lg = 0; lg < 6; lg++) {
                        var ph = lg / 6 * 6.283185307 + 0.4;
                        var lx = c[0] + R * 0.32 * (Math.cos(ph) * B.ey[0] + Math.sin(ph) * B.ez[0]);
                        var ly = c[1] + R * 0.32 * (Math.cos(ph) * B.ey[1] + Math.sin(ph) * B.ez[1]);
                        if (!whole) {
                            /* only the lugs on the half that survived */
                            var yy = y0 + R * 0.32 * Math.cos(ph);
                            if (!keptY(yy)) continue;
                        }
                        ctx.beginPath(); ctx.arc(lx, ly, Math.max(1.2, rr * 0.045), 0, 6.3);
                        ctx.fill(); ctx.stroke();
                    }
                }
            }

            /* the imprint's own edge, over the flat, so the circle the model
               applies is readable through the wheel standing on it */
            if (keptY(y0)) {
                ellipse3(B, x0, y0, a, null, cssVar('--lp-danger'), 1.3);
            }

            /* the tag, on the hub */
            if (rr > 11 && (cutY == null || Math.abs(q) < 1 || keptY(y0))) {
                ctx.font = '700 10px ' + monoFont();
                var tag = 'L' + (wi + 1), tw = ctx.measureText(tag).width;
                ctx.fillStyle = 'rgba(15,24,41,0.88)';
                roundRect(ctx, c[0] - tw / 2 - 5, c[1] - 8, tw + 10, 15, 4); ctx.fill();
                ctx.fillStyle = '#e8eef9'; ctx.textAlign = 'center';
                ctx.fillText(tag, c[0], c[1] + 3.5);
                ctx.textAlign = 'left';
            }
        }

        /* Numbers on the edges of the box. Without them the 3-D view is a
         * picture of a pavement; with them it is a drawing of one. Each
         * label is pushed off its edge along the edge's own screen normal,
         * away from the solid, so the ticks never land on the material. */
        function edgeTicks3(B, from, to, step, axis, outward, label) {
            var p0 = P3(B, from[0], from[1], from[2]);
            var p1 = P3(B, to[0], to[1], to[2]);
            var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
            var len = Math.hypot(dx, dy);
            if (len < 60) return;
            var nx = -dy / len, ny = dx / len;
            if (nx * outward[0] + ny * outward[1] < 0) { nx = -nx; ny = -ny; }
            var v0 = from[axis], v1 = to[axis];
            var lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            ctx.save();
            ctx.font = '9px ' + monoFont();
            ctx.fillStyle = cssVar('--lp-ink3');
            ctx.strokeStyle = rgba('--lp-ink3', 0.55);
            ctx.lineWidth = 1;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            function chip(text, x, y, strong) {
                var w = ctx.measureText(text).width;
                ctx.fillStyle = rgba('--lp-bg1', 0.88);
                roundRect(ctx, x - w / 2 - 3, y - 7, w + 6, 14, 3);
                ctx.fill();
                ctx.fillStyle = strong ? cssVar('--lp-ink2') : cssVar('--lp-ink3');
                ctx.fillText(text, x, y);
            }
            for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) {
                var t = (v - v0) / (v1 - v0 || 1);
                var x = p0[0] + dx * t, y = p0[1] + dy * t;
                ctx.beginPath();
                ctx.moveTo(x, y); ctx.lineTo(x + nx * 5, y + ny * 5); ctx.stroke();
                var lx = x + nx * 16, ly = y + ny * 16;
                if (lx < 14 || lx > vpW - 14 || ly < 10 || ly > vpH - 10) continue;
                chip(sig(toDisp('len', v), 3), lx, ly, false);
            }
            if (label) {
                ctx.font = '700 10px ' + monoFont();
                chip(label, p1[0] + nx * 16 + dx / len * 18, p1[1] + ny * 16 + dy / len * 18, true);
            }
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.restore();
        }

        function drawScene3D(quality) {
            var sb = sceneBox();
            if (!view3.fitted) fit3();
            var B = basis3();
            var L3 = light3(view3.az, view3.el);
            var W3 = viewDir3(view3.az, view3.el);
            var G3 = tireGeom();
            var ink2 = cssVar('--lp-ink2'), ink3 = cssVar('--lp-ink3');
            var lineC = cssVar('--lp-line'), accent = cssVar('--lp-accent');
            var danger = cssVar('--lp-danger');
            var n = state.layers.length;

            /* Which faces the camera can see. The cut keeps the half the
             * camera is NOT on, so the exposed plane always faces the
             * reader however far the scene is spun. */
            var nearIsLow = B.ca >= 0;
            var ySec = clamp(state.ySec, sb.y0, sb.y1);
            var solidA = nearIsLow ? ySec : sb.y0;
            var solidB = nearIsLow ? sb.y1 : ySec;
            var ghostA = nearIsLow ? sb.y0 : ySec;
            var ghostB = nearIsLow ? ySec : sb.y1;
            var sideX = B.sa >= 0 ? sb.xL : sb.xR;

            /* ---- the surface of the solid half ---- */
            var top = state.layers[0];
            var topQuad = [[sb.xL, solidA, 0], [sb.xR, solidA, 0], [sb.xR, solidB, 0], [sb.xL, solidB, 0]];
            var kTop = face3(B, topQuad, top, [0, 0, -1], L3, null, quality);

            /* the edges the light catches */
            ctx.save();
            ctx.globalAlpha = 0.55;
            line3(B, [sb.xL, solidA, 0], [sb.xR, solidA, 0], shadeHex(top.color, 2.1), 1.4);
            line3(B, [sideX, solidA, 0], [sideX, solidB, 0], shadeHex(top.color, 1.9), 1.4);
            ctx.restore();

            /* ---- the ground grid: this is where x and y get their scale ---- */
            var gstep = niceStep((sb.xR - sb.xL) / 8);
            ctx.save();
            ctx.globalAlpha = 0.3;
            var gx, gy;
            for (gx = Math.ceil(sb.xL / gstep) * gstep; gx <= sb.xR; gx += gstep) {
                line3(B, [gx, solidA, 0], [gx, solidB, 0], Math.abs(gx) < 1e-6 ? ink3 : lineC, 1);
            }
            for (gy = Math.ceil(solidA / gstep) * gstep; gy <= solidB; gy += gstep) {
                line3(B, [sb.xL, gy, 0], [sb.xR, gy, 0], Math.abs(gy) < 1e-6 ? ink3 : lineC, 1);
            }
            ctx.restore();

            /* ---- loads standing on the solid half ---- */
            function drawLoad3(w, wi, alpha) {
                ctx.save();
                ctx.globalAlpha = alpha;
                var c = P3(B, w.x, w.y, 0);
                if (state.loadKind === 'circle' && G3) {
                    drawTire3(B, w, wi, L3, W3, quality, ySec, nearIsLow ? 1 : -1, null, G3);
                    ctx.restore();
                    return;
                }
                if (state.loadKind === 'circle') {
                    /* no tire fits between these wheels, so none is drawn:
                       the imprint and its arrow are the model anyway */
                    ellipse3(B, w.x, w.y, loadA(w), rgba('--lp-danger', 0.5), danger, 1.4);
                    ellipse3(B, w.x, w.y, loadA(w) * 0.45, rgba('--lp-danger', 0.3), null, 0);
                }
                if (state.loadKind === 'line') {
                    var th = gearParams.theta * Math.PI / 180, hl = 0.5 * gearParams.L;
                    line3(B, [w.x - hl * Math.cos(th), w.y - hl * Math.sin(th), 0],
                             [w.x + hl * Math.cos(th), w.y + hl * Math.sin(th), 0], danger, 3.5);
                } else {
                    ctx.fillStyle = danger;
                    ctx.beginPath(); ctx.arc(c[0], c[1], 3.4, 0, 6.3); ctx.fill();
                }
                /* the force itself, which is the one thing that is not in
                   the plane of the ground */
                var tipZ = -Math.max(26, 0.09 * sb.zMax * view3.scale) / Math.max(view3.scale, 1e-6);
                var tip = P3(B, w.x, w.y, tipZ);
                ctx.strokeStyle = danger; ctx.fillStyle = danger; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(c[0], c[1] - 7); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] - 4.5, c[1] - 9);
                ctx.lineTo(c[0] + 4.5, c[1] - 9); ctx.closePath(); ctx.fill();
                ctx.font = '700 10px ' + monoFont();
                var tag = 'L' + (wi + 1), tw = ctx.measureText(tag).width;
                ctx.fillStyle = 'rgba(15,24,41,0.9)';
                roundRect(ctx, tip[0] - tw / 2 - 5, tip[1] - 17, tw + 10, 15, 4); ctx.fill();
                ctx.fillStyle = '#e8eef9'; ctx.textAlign = 'center';
                ctx.fillText(tag, tip[0], tip[1] - 6);
                ctx.textAlign = 'left';
                ctx.restore();
            }
            var order = state.loads.map(function (w, wi) { return { w: w, wi: wi }; });
            order.sort(function (p, q) {
                return (q.w.x * B.sa + q.w.y * B.ca) - (p.w.x * B.sa + p.w.y * B.ca);
            });
            /* The kept half of every wheel stands BEHIND the cut plane, so
             * it is painted before it: drawn afterwards it covered the
             * stress bulb it is standing on, which is the one thing this
             * view exists to show. */
            order.forEach(function (o) {
                if (state.loadKind === 'circle') { drawLoad3(o.w, o.wi, 1); return; }
                var inSolid = nearIsLow ? o.w.y >= ySec : o.w.y <= ySec;
                if (inSolid) drawLoad3(o.w, o.wi, 1);
            });

            /* ---- the side face, layer by layer ---- */
            var sideN = [sideX === sb.xL ? -1 : 1, 0, 0];
            var z = 0, i;
            for (i = 0; i < n; i++) {
                var Ly = state.layers[i];
                var zT = z, zB = i < n - 1 ? z + Ly.h : sb.zMax;
                z = zB;
                var quad = [[sideX, solidA, zT], [sideX, solidB, zT], [sideX, solidB, zB], [sideX, solidA, zB]];
                (function (zT2, zB2) {
                    face3(B, quad, Ly, sideN, L3, function (u, v) {
                        return [sideX, solidA + (solidB - solidA) * u, zT2 + (zB2 - zT2) * v];
                    }, quality);
                })(zT, zB);
                /* the cut edge at the top of every band, which is the line
                   a saw leaves and the thing that makes a stack of layers
                   read as a stack rather than as stripes */
                line3(B, [sideX, solidA, zT], [sideX, solidB, zT], rgba('--lp-ink', 0.3), 1);
            }

            /* ---- the cut face: layers, contour, interfaces ---- */
            var cutN = [0, nearIsLow ? -1 : 1, 0];
            z = 0;
            for (i = 0; i < n; i++) {
                var L2 = state.layers[i];
                var zT2 = z, zB2 = i < n - 1 ? z + L2.h : sb.zMax;
                z = zB2;
                var face = [[sb.xL, ySec, zT2], [sb.xR, ySec, zT2], [sb.xR, ySec, zB2], [sb.xL, ySec, zB2]];
                (function (zA, zBb) {
                    var bare = !(contour && state.settings.showContour && results.grid);
                    face3(B, face, L2, cutN, L3, bare ? function (u, v) {
                        return [sb.xL + (sb.xR - sb.xL) * u, ySec, zA + (zBb - zA) * v];
                    } : null, quality);
                })(zT2, zB2);
            }

            /* the subgrade has no bottom: the last band fades out rather
               than ending on a line the model does not have */
            (function () {
                var fadeTop = sb.zMax - 0.22 * sb.zMax;
                var a0 = P3(B, sb.xL, ySec, fadeTop), a1 = P3(B, sb.xL, ySec, sb.zMax);
                var gr = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
                gr.addColorStop(0, rgba('--lp-bg0', 0));
                gr.addColorStop(1, cssVar('--lp-bg0'));
                poly3(B, [[sb.xL, ySec, fadeTop], [sb.xR, ySec, fadeTop],
                    [sb.xR, ySec, sb.zMax], [sb.xL, ySec, sb.zMax]], gr, null);
                var b0 = P3(B, sideX, solidA, fadeTop), b1 = P3(B, sideX, solidA, sb.zMax);
                var gr2 = ctx.createLinearGradient(b0[0], b0[1], b1[0], b1[1]);
                gr2.addColorStop(0, rgba('--lp-bg0', 0));
                gr2.addColorStop(1, cssVar('--lp-bg0'));
                poly3(B, [[sideX, solidA, fadeTop], [sideX, solidB, fadeTop],
                    [sideX, solidB, sb.zMax], [sideX, solidA, sb.zMax]], gr2, null);
            })();

            if (contour && state.settings.showContour && results.grid) {
                var g = results.grid;
                var dx = (g.xs[g.nx - 1] - g.xs[0]) / (g.nx - 1);
                var dz = (g.zs[g.nz - 1] - g.zs[0]) / (g.nz - 1);
                var O = P3(B, g.xs[0], ySec, g.zs[0]);
                ctx.save();
                ctx.globalAlpha = Math.min(1, state.settings.alpha * 1.12);
                ctx.imageSmoothingEnabled = true;
                ctx.transform(dx * B.ex[0], dx * B.ex[1], dz * B.ez[0], dz * B.ez[1], O[0], O[1]);
                ctx.drawImage(contour.canvas, 0, 0);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = Math.min(0.45, state.settings.alpha);
                ctx.strokeStyle = rgba('--lp-ink', 0.5);
                ctx.lineWidth = 0.75;
                ctx.beginPath();
                contour.levels.forEach(function (lv) {
                    lv.segs.forEach(function (sg) {
                        var p = P3(B, sg[0][0], ySec, sg[0][1]);
                        var q = P3(B, sg[1][0], ySec, sg[1][1]);
                        ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
                    });
                });
                ctx.stroke();
                ctx.restore();
            }

            /* the rubber cross-sections, coplanar with the cut face */
            if (state.loadKind === 'circle' && G3) {
                order.forEach(function (o) {
                    drawTire3(B, o.w, o.wi, L3, W3, quality, ySec, nearIsLow ? 1 : -1, 'cut', G3);
                });
            }

            /* interfaces on the cut face, and the outline of the face */
            interfaceZs().forEach(function (zi) {
                line3(B, [sb.xL, ySec, zi], [sb.xR, ySec, zi], rgba('--lp-ink', 0.5), 1.1);
                line3(B, [sideX, solidA, zi], [sideX, solidB, zi], rgba('--lp-ink', 0.35), 1);
            });
            poly3(B, [[sb.xL, ySec, 0], [sb.xR, ySec, 0], [sb.xR, ySec, sb.zMax], [sb.xL, ySec, sb.zMax]],
                null, accent, 1.6);

            /* the deflected surface, on the plane it was computed in */
            if (state.settings.showBasin && results.basin && results.basin.length) {
                var wMax = 0;
                results.basin.forEach(function (p) {
                    if (p && isFinite(p.disp.uz)) wMax = Math.max(wMax, Math.abs(p.disp.uz));
                });
                if (wMax > 1e-9) {
                    var exg = 0.11 * sb.zMax / wMax;
                    ctx.strokeStyle = accent; ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    var started = false;
                    results.basin.forEach(function (p) {
                        if (!p || !isFinite(p.disp.uz)) return;
                        var q = P3(B, p.x, ySec, p.disp.uz * exg);
                        if (!started) { ctx.moveTo(q[0], q[1]); started = true; }
                        else ctx.lineTo(q[0], q[1]);
                    });
                    ctx.stroke();
                }
            }

            /* evaluation points, wherever they are in the box */
            state.points.forEach(function (p, pi) {
                var q = P3(B, p.x, p.y, p.z), g0 = P3(B, p.x, p.y, 0);
                var col = ptColor(pi);
                ctx.save();
                ctx.setLineDash([2, 3]);
                ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(q[0], q[1], selPoint === p.id ? 4.5 : 3.2, 0, 6.3); ctx.fill();
                ctx.strokeStyle = col; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.arc(q[0], q[1], 6.5, 0, 6.3); ctx.stroke();
                ctx.font = '700 10px ' + monoFont();
                ctx.fillText('P' + (pi + 1), q[0] + 9, q[1] - 6);
            });

            /* ---- the half that was cut away, drawn as the glass it is ---- */
            var ghost = [[sb.xL, ghostA, 0], [sb.xR, ghostA, 0], [sb.xR, ghostB, 0], [sb.xL, ghostB, 0]];
            /* No fill. The removed half is nearer the camera than the face
               the cut exposes, so ANY ink in it is ink over the stress bulb:
               a fourteen per cent white veil was enough to turn a saturated
               blue into a smudge. Phantom lines only, the same rule the
               removed half of a wheel follows. */
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.globalAlpha = 0.75;
            poly3(B, ghost, null, ink3, 1.2);
            ctx.globalAlpha = 0.5;
            for (gx = Math.ceil(sb.xL / gstep) * gstep; gx <= sb.xR; gx += gstep) {
                line3(B, [gx, ghostA, 0], [gx, ghostB, 0], lineC, 1);
            }
            for (gy = Math.ceil(ghostA / gstep) * gstep; gy <= ghostB; gy += gstep) {
                line3(B, [sb.xL, gy, 0], [sb.xR, gy, 0], lineC, 1);
            }
            ctx.restore();
            /* and the half of each wheel the cut took away, in phantom */
            if (state.loadKind === 'circle' && G3) {
                ctx.save();
                ctx.setLineDash([5, 4]);
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = ink3;
                ctx.lineWidth = 1.1;
                order.forEach(function (o) {
                    var R = G3.R, aa = loadA(o.w);
                    var qq = clamp((ySec - o.w.y) / R, -2, 2);
                    if (Math.abs(qq) >= 1 && (nearIsLow ? o.w.y >= ySec : o.w.y <= ySec)) return;
                    var cc = P3(B, W3[0] > 0 ? o.w.x - G3.w : o.w.x + G3.w, o.w.y, -G3.h);
                    var a0 = 0, a1 = 6.283185307;
                    if (Math.abs(qq) <= 1) {
                        var ac = Math.acos(clamp(nearIsLow ? -qq : qq, -1, 1));
                        a0 = nearIsLow ? Math.PI - ac : -ac;
                        a1 = nearIsLow ? Math.PI + ac : ac;
                    }
                    ctx.save();
                    ctx.transform(R * B.ey[0], R * B.ey[1], R * B.ez[0], R * B.ez[1], cc[0], cc[1]);
                    ctx.beginPath(); ctx.arc(0, 0, 1, a0, a1);
                    ctx.restore();
                    ctx.stroke();
                    ellipse3(B, o.w.x, o.w.y, aa, null, ink3, 1);
                });
                ctx.restore();
            } else {
                order.forEach(function (o) {
                    var inSolid = nearIsLow ? o.w.y >= ySec : o.w.y <= ySec;
                    if (!inSolid) drawLoad3(o.w, o.wi, 0.95);
                });
            }

            /* ---- the numbers on the box ---- */
            if (quality !== 'draft') {
                var mid = [(sb.xL + sb.xR) / 2, (sb.y0 + sb.y1) / 2];
                var away = function (px, py) {
                    /* away from the middle of the BLOCK, not of the surface:
                       the material hangs below the ground plane, so a
                       ground edge has to push its labels upward to clear
                       it */
                    var c = P3(B, mid[0], mid[1], sb.zMax * 0.5);
                    return [px - c[0], py - c[1]];
                };
                var frontY = nearIsLow ? sb.y0 : sb.y1;
                var xStep = niceStep((sb.xR - sb.xL) / 3.2);
                var e0 = P3(B, (sb.xL + sb.xR) / 2, frontY, 0);
                edgeTicks3(B, [sb.xL, frontY, 0], [sb.xR, frontY, 0], xStep, 0,
                    away(e0[0], e0[1]), 'x ' + unit('len'));
                var yStep = niceStep((sb.y1 - sb.y0) / 3.2);
                var e1 = P3(B, sideX, (sb.y0 + sb.y1) / 2, 0);
                edgeTicks3(B, [sideX, sb.y0, 0], [sideX, sb.y1, 0], yStep, 1,
                    away(e1[0], e1[1]), 'y ' + unit('len'));
                var zStep = niceStep(sb.zMax / 3.2);
                var e2 = P3(B, sideX, ySec, sb.zMax / 2);
                edgeTicks3(B, [sideX, ySec, 0], [sideX, ySec, sb.zMax], zStep, 2,
                    away(e2[0], e2[1]), 'z ' + unit('len'));
            }

            /* ---- the cut, named, under the face it names ---- */
            var badge = 'section y ' + sig(toDisp('len', state.ySec), 4) + ' ' + unit('len');
            var bp = P3(B, (sb.xL + sb.xR) / 2, ySec, sb.zMax);
            ctx.font = '600 11px ' + monoFont();
            var bw = ctx.measureText(badge).width;
            var bx = clamp(bp[0] - bw / 2, 10, vpW - bw - 16);
            var by = clamp(bp[1] + 20, 24, vpH - 34);
            ctx.fillStyle = rgba('--lp-accent', 0.92);
            roundRect(ctx, bx - 7, by - 12, bw + 14, 18, 5); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(badge, bx, by + 1);

            /* ---- the scale, and the two gestures ---- */
            var sl = gstep * view3.scale;
            var sx0 = 132, sy0 = vpH - 16;
            ctx.strokeStyle = ink2; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(sx0, sy0 - 4); ctx.lineTo(sx0, sy0); ctx.lineTo(sx0 + sl, sy0);
            ctx.lineTo(sx0 + sl, sy0 - 4); ctx.stroke();
            ctx.fillStyle = ink3; ctx.font = '10px ' + monoFont();
            ctx.fillText(sig(toDisp('len', gstep), 3) + ' ' + unit('len'), sx0 + sl + 6, sy0 + 3.5);
            ctx.fillText('drag to orbit · scroll to zoom · drag the cut plane to move the section',
                sx0, sy0 - 15);

            drawTriad3(B, nearIsLow);
            void ink2;
        }

        function drawViewport() {
            if (!ctx) return;
            var box = worldBox();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, vpW, vpH);
            itfChips = [];
            if (state.settings.view3d) {
                /* The aggregate and the tread come off the drag, the same
                 * way the contour comes off a slider: a scene that is
                 * 60 fps while the hand moves and fully drawn the moment it
                 * stops reads as faster than one that is neither. */
                drawScene3D(sceneDraft ? 'draft' : null);
                drawPlan();
                drawColorbar();
                return;
            }
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
                /* The iso-lines were a hardcoded near-black, which is a line
                   nobody can see on the dark theme. */
                ctx.strokeStyle = rgba('--lp-ink', 0.5);
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
                drawIsoLabels();
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
            /* Exactly one load is dimensioned. Six wheels each carrying the
             * same dimension line is six times the ink for one number, so
             * the annotation goes on the load nearest the section plane,
             * and nearest the origin where two tie. */
            var best = null;
            geoms.forEach(function (G) {
                if (!best || G.dy < best.dy - 1e-9 ||
                    (Math.abs(G.dy - best.dy) < 1e-9 && Math.abs(G.cx) < Math.abs(best.cx))) best = G;
            });
            if (best) best.annotate = true;

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
                    /* The contact width is dimensioned on the drawing now,
                       so the caption does not print it twice. */
                    if (state.loadKind === 'circle') {
                        cap += ' · ' + sig(toDisp('stress', w0.p), 4) + ' ' + unit('stress');
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
            /* Left-aligned from wherever there is room, because right-
               aligning it to the rail puts it off the canvas whenever the
               section is panned or fitted tight to the left edge. */
            ctx.fillStyle = ink3;
            var zlbl = 'z ' + unit('len');
            ctx.fillText(zlbl, Math.max(2, railX - 8 - ctx.measureText(zlbl).width), w2sy(0) - 14);
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

            /* the frame, over everything: a scale is no use half covered */
            drawXRuler();
            drawGnomon();

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
            /* The plan is the OTHER two axes, and without their names it is
             * a second picture of the same wheels rather than the view that
             * tells you what y is. */
            g.fillStyle = ink3; g.font = '700 8px ' + mono;
            g.textAlign = 'right'; g.textBaseline = 'bottom';
            g.fillText('x', padL + plotW - 3, padT + plotH - 2);
            g.textAlign = 'left'; g.textBaseline = 'top';
            g.fillText('y', padL + 3, padT + 2);
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

                /* 0. in the 3-D view the canvas is a camera. Nothing here is
                 * editable by dragging, because a screen position out there
                 * is an infinite number of world positions and guessing one
                 * would move a layer the reader did not mean to touch. */
                if (state.settings.view3d) {
                    /* the orientation widget doubles as the way home */
                    if (hitTriad3(mx, my)) {
                        view3.az = ISO3.az; view3.el = ISO3.el;
                        fit3();
                        drawViewport();
                        return;
                    }
                    if (!e.shiftKey && hitCut3(mx, my)) {
                        drag = { type: 'ysec', sx: mx, sy: my, y0: state.ySec, moved: false };
                        cv.style.cursor = 'grabbing';
                        return;
                    }
                    drag = { type: 'orbit', sx: mx, sy: my, az: view3.az, el: view3.el,
                             ox: view3.ox, oy: view3.oy, pan: e.shiftKey, moved: false };
                    sceneDraft = true;
                    cv.style.cursor = 'grabbing';
                    return;
                }

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
                if (drag.type === 'orbit') {
                    drag = null;
                    sceneDraft = false;
                    cv.style.cursor = 'grab';
                    drawViewport();          /* now at full quality */
                    return;
                }
                if (drag.type === 'ysec') {
                    var moved = drag.moved;
                    drag = null;
                    cv.style.cursor = 'grab';
                    if (moved) mutate(function () { /* ySec already set */ });
                    return;
                }
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
                if (state.settings.view3d) return;
                var p = { id: nid(), x: dragSnap('len', s2wx(e.offsetX)), y: state.ySec,
                    z: Math.max(0, dragSnap('len', s2wy(e.offsetY))) };
                snapPoint(p);
                mutate(function (st) { st.points.push(p); });
                selPoint = p.id;
            });
            on(cv, 'wheel', function (e) {
                e.preventDefault();
                if (state.settings.view3d) { zoomView(e.deltaY < 0 ? 1.1 : 1 / 1.1); return; }
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
                if (state.settings.view3d) {
                    if (drag && drag.type === 'ysec') {
                        drag.moved = true;
                        var sb3 = sceneBox();
                        var yNew = drag.y0 + screenToY3(e.offsetX - drag.sx, e.offsetY - drag.sy);
                        state.ySec = clamp(dragSnap('len', yNew), sb3.y0, sb3.y1);
                        drawViewport();
                        var cy = $('lp-coords');
                        if (cy) {
                            cy.textContent = 'section y ' + sig(toDisp('len', state.ySec), 5) + ' ' + unit('len');
                        }
                        return;
                    }
                    if (drag && drag.type === 'orbit') {
                        drag.moved = true;
                        var ddx = e.offsetX - drag.sx, ddy = e.offsetY - drag.sy;
                        if (drag.pan) {
                            view3.ox = drag.ox + ddx;
                            view3.oy = drag.oy + ddy;
                        } else {
                            /* The azimuth is held in one quadrant on purpose. The
                             * cut face is the figure; swing past 80 degrees and it
                             * is edge on, the contour disappears, and the reader is
                             * looking ALONG the plane whose values they came to
                             * read. Elevation is free between the horizon and
                             * nearly overhead, which is the axis that actually pays
                             * for itself. */
                            view3.az = clamp(drag.az + ddx * 0.45, 12, 78);
                            /* elevation stops short of straight down and of
                               the horizon: at either the box collapses to a
                               line and there is nothing left to read */
                            view3.el = clamp(drag.el - ddy * 0.32, 12, 72);
                        }
                        drawViewport();
                    } else if (hitTriad3(e.offsetX, e.offsetY)) cv.style.cursor = 'pointer';
                    else cv.style.cursor = hitCut3(e.offsetX, e.offsetY) ? 'move' : 'grab';
                    var c3 = $('lp-coords');
                    if (c3) {
                        c3.textContent = 'orbit ' + Math.round(((view3.az % 360) + 360) % 360) +
                            '°  ·  elevation ' + Math.round(view3.el) +
                            '°  ·  shift-drag to pan';
                    }
                    return;
                }
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
            $('lp-zin').addEventListener('click', function () { zoomView(1.2); });
            $('lp-zout').addEventListener('click', function () { zoomView(1 / 1.2); });
            $$('#lp-viewmode .lp-seg-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    var want3 = b.dataset.view === '3d';
                    if (state.settings.view3d === want3) return;
                    state.settings.view3d = want3;
                    view3.fitted = false;
                    syncViewMode();
                    drawViewport();
                    saveLocal();
                });
            });
            $('lp-show-basin').addEventListener('change', function (e) {
                state.settings.showBasin = e.target.checked; drawViewport(); saveLocal();
            });
            $('lp-show-contour').addEventListener('change', function (e) {
                state.settings.showContour = e.target.checked;
                drawViewport();
                saveLocal();
                /* Nothing solves a field nobody is looking at, so turning
                   the overlay back on is what asks for it. */
                if (state.settings.showContour && !results.grid) scheduleRun();
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
            renderStudyControls(false);
            renderStudy();

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
                    else if (key === 'study') { renderStudy(); resizePlots(['lp-chart-study']); }
                });
            });
            /* The design study. The variable list is rebuilt from the
               section every time it is opened, because layers get added,
               renamed and deleted while a study is sitting there. */
            $('lp-study-var').addEventListener('change', function (e) {
                study.varId = e.target.value;
                renderStudyControls(false);
            });
            $('lp-study-resp').addEventListener('change', function (e) {
                study.resp = e.target.value;
                renderStudyControls(true);
                if (study.rows) renderStudyChart();
            });
            $('lp-study-target').addEventListener('input', debounce(function (e) {
                var t = parseFloat(e.target.value);
                study.target = isFinite(t) && t > 0 ? t : 0;
                if (study.rows) renderStudyChart();
            }, 260));
            $('lp-study-steps').addEventListener('change', function (e) {
                var n = clamp(Math.round(parseFloat(e.target.value) || 13), 3, 41);
                e.target.value = String(n);
                study.steps = n;
            });
            $('lp-study-run').addEventListener('click', runStudy);
            $('lp-study-csv').addEventListener('click', exportStudyCsv);

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
            syncViewMode();
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
        symText: symText,
        axonometric: axonometric,
        fatigueLife: fatigueLife,
        ruttingLife: ruttingLife,
        governingLife: governingLife,
        mirrorXPoint: mirrorXPoint,
        viewDir3: viewDir3,
        lambert3: lambert3,
        tireFit: tireFit
    };
});
