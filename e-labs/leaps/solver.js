/* =====================================================================
 * LEAPS Engine — Linear Elastic Analysis of Pavement Structures
 * ---------------------------------------------------------------------
 * Multilayer elastic theory (Burmister) solver.
 *
 *   - Love stress function per layer in Hankel-transform space
 *   - 4N-2 boundary-condition system per transform parameter m,
 *     scaled exponentials (no overflow for any m*h), partial pivoting
 *   - Interfaces: fully bonded, frictionless (unbonded), or linear
 *     shear-spring (partial slip, stiffness k in MPa/mm)
 *   - Panel-wise Gauss-Legendre quadrature between Bessel zeros,
 *     Wynn epsilon acceleration for slowly-decaying oscillatory tails
 *   - Surface (z = 0) responses use asymptotic subtraction with
 *     closed-form Weber-Schafheitlin tails (AGM elliptic integrals):
 *     near machine-precision at the pavement surface
 *   - THREE load idealizations, sharing one quadrature:
 *       circle — uniform pressure p over radius a   (the LEA standard)
 *       point  — a concentrated force P             (Boussinesq)
 *       line   — force per unit length over a segment of length L
 *   - Multi-wheel superposition with full tensor rotation
 *
 * Conventions (WinJULEA-compatible):
 *   Units      : mm, N, MPa (= N/mm^2). Moduli and pressures in MPa.
 *   Axes       : z positive DOWN from the surface; x,y in plan.
 *   Stresses   : TENSION POSITIVE. uz positive downward.
 *   Strains    : extension positive; shear strains are ENGINEERING (gamma).
 *   Interfaces : a WinJULEA "slip" value, 0 = fully bonded,
 *                1 = frictionless, in between = Goodman shear spring.
 *
 * UMD: usable from <script>, importScripts() in a worker, and Node.
 * ===================================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LEAPS = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var VERSION = '2.0.0';

    /* ------------------------------------------------------------------
     * Bessel functions J0, J1 (rational approximations, ~1e-8 rel.)
     * ------------------------------------------------------------------ */
    function besselJ0(x) {
        var ax = Math.abs(x), y, ans1, ans2, z, xx;
        if (ax < 8.0) {
            y = x * x;
            ans1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 +
                y * (-11214424.18 + y * (77392.33017 + y * (-184.9052456)))));
            ans2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 +
                y * (59272.64853 + y * (267.8532712 + y))));
            return ans1 / ans2;
        }
        z = 8.0 / ax; y = z * z; xx = ax - 0.785398164;
        ans1 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 +
            y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
        ans2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 +
            y * (0.7621095161e-6 + y * (-0.934935152e-7))));
        return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
    }

    function besselJ1(x) {
        var ax = Math.abs(x), y, ans1, ans2, z, xx, ans;
        if (ax < 8.0) {
            y = x * x;
            ans1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 +
                y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
            ans2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 +
                y * (99447.43394 + y * (376.9991397 + y))));
            return ans1 / ans2;
        }
        z = 8.0 / ax; y = z * z; xx = ax - 2.356194491;
        ans1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4 +
            y * (0.2457520174e-5 + y * (-0.240337019e-6))));
        ans2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 +
            y * (-0.88228987e-6 + y * 0.105787412e-6)));
        ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
        return x < 0 ? -ans : ans;
    }

    /* ------------------------------------------------------------------
     * Complete elliptic integrals K(k), E(k), modulus k — AGM method
     * ------------------------------------------------------------------ */
    function ellipKE(k) {
        if (k <= 0) return { K: Math.PI / 2, E: Math.PI / 2 };
        if (k >= 1 - 1e-14) return { K: Infinity, E: 1 };
        var a = 1, b = Math.sqrt(1 - k * k), c = k;
        var sum = 0.5 * c * c, pow2 = 0.5, an, bn;
        for (var i = 0; i < 60 && Math.abs(c) > 1e-17; i++) {
            an = 0.5 * (a + b);
            bn = Math.sqrt(a * b);
            c = 0.5 * (a - b);
            a = an; b = bn;
            pow2 *= 2;
            sum += pow2 * c * c;
        }
        var K = Math.PI / (2 * a);
        return { K: K, E: K * (1 - sum) };
    }

    /* 8-point Gauss-Legendre on [-1, 1] — the Hankel quadrature */
    var GX = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290,
        -0.1834346424956498, 0.1834346424956498, 0.5255324099163290,
        0.7966664774136267, 0.9602898564975363];
    var GW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
        0.3626837833783620, 0.3626837833783620, 0.3137066458778873,
        0.2223810344533745, 0.1012285362903763];

    /* 4-point Gauss-Legendre on [-1, 1] — the line-load quadrature.
     * A line load is integrated in PHYSICAL space, not transform space, so
     * its panels are graded toward the closest point rather than placed on
     * Bessel zeros; four points per graded panel is ample. */
    var LX = [-0.8611363115940526, -0.3399810435848563,
        0.3399810435848563, 0.8611363115940526];
    var LW = [0.3478548451374538, 0.6521451548625461,
        0.6521451548625461, 0.3478548451374538];

    /* ------------------------------------------------------------------
     * Interfaces
     * ------------------------------------------------------------------
     * WinJULEA describes an interface by a dimensionless SLIP value:
     *   0 = fully bonded (no relative horizontal movement)
     *   1 = frictionless (no shear transferred)
     * Those two are exact, and are what essentially every published
     * analysis uses. Between them the physical model is Goodman's shear
     * spring,
     *
     *      tau = k * (u_r,lower - u_r,upper)
     *
     * with k a stiffness in MPa/mm. Turning a dimensionless slip into one
     * necessarily introduces a length: the literature (BISAR's shear-spring
     * compliance, Uzan's alpha) scales it on the loaded radius, which is
     * why a dimensionless friction parameter is documented as depending on
     * the diameter of the load circle. LEAPS uses
     *
     *      k(s) = (G_lower / a_ref) * (1 - s) / s
     *
     * where a_ref is the reference contact radius carried on the job. The
     * endpoints are exact (s -> 0 gives k -> infinity, s = 1 gives k = 0);
     * an intermediate value is a defensible partial bond but is NOT
     * guaranteed to reproduce another program's intermediate value digit
     * for digit, because each program normalizes its own way. Enter `k`
     * directly when the number matters.
     * ------------------------------------------------------------------ */
    function slipToK(slip, Glower, aRef) {
        if (!(slip > 0)) return Infinity;            /* bonded */
        if (slip >= 1) return 0;                     /* frictionless */
        return (Glower / Math.max(aRef, 1e-6)) * (1 - slip) / slip;
    }
    function kToSlip(k, Glower, aRef) {
        if (!isFinite(k)) return 0;
        if (!(k > 0)) return 1;
        var t = k * Math.max(aRef, 1e-6) / Glower;   /* = (1-s)/s */
        return 1 / (1 + t);
    }

    /* ------------------------------------------------------------------
     * Layered system: geometry + per-m boundary system with caching
     * ------------------------------------------------------------------ */
    function LayerSystem(layers, interfaces, aRef) {
        var n = layers.length;
        this.n = n;
        this.aRef = aRef > 0 ? aRef : 150;
        this.layers = layers.map(function (L) {
            return { h: L.h, E: L.E, nu: L.nu, G: L.E / (2 * (1 + L.nu)) };
        });
        this.interfaces = [];
        for (var i = 0; i < n - 1; i++) {
            var f = (interfaces && interfaces[i]) || {};
            var Gl = this.layers[i + 1].G;
            var bond, k;
            if (f.bond === 'spring' && f.k != null && isFinite(f.k)) {
                bond = 'spring'; k = f.k;
            } else if (f.bond) {
                bond = f.bond === 'frictionless' ? 'unbonded' : f.bond;
                k = (f.k != null ? f.k : 1);
            } else {
                var s = Math.max(0, Math.min(1, f.slip != null ? f.slip : 0));
                bond = s <= 0 ? 'bonded' : (s >= 1 ? 'unbonded' : 'spring');
                k = slipToK(s, Gl, this.aRef);
            }
            this.interfaces.push({ bond: bond, k: k });
        }
        this.zTop = new Float64Array(n);
        this.zBot = new Float64Array(n);
        var z = 0;
        for (i = 0; i < n; i++) {
            this.zTop[i] = z;
            z += (i < n - 1) ? this.layers[i].h : 0;
            this.zBot[i] = (i < n - 1) ? z : Infinity;
        }
        this.depthFinite = this.zTop[n - 1];
        this.N = 4 * n - 2;
        this._M = new Float64Array(this.N * this.N);
        this._rhs = new Float64Array(this.N);
        this.cache = new Map();
        this.stats = { solves: 0, cacheHits: 0, kernelEvals: 0 };
    }

    /* Kernel partial derivatives w.r.t. scaled coefficients [a,b,c,d]
     * of layer i at depth z, written into row of the system matrix.
     * which: 0=Sz (normal stress), 1=St (shear), 2=W (uz*2Gm), 3=Q (ur*2Gm) */
    LayerSystem.prototype._addRow = function (row, i, z, m, which, fac) {
        var M = this._M, N = this.N;
        var L = this.layers[i], nu = L.nu, mz = m * z;
        var last = (i === this.n - 1);
        var e1 = Math.exp(-m * (z - this.zTop[i]));
        var e2 = last ? 0 : Math.exp(-m * (this.zBot[i] - z));
        var c0 = 4 * i, dA, dB, dC, dD;
        switch (which) {
            case 0: dA = e1; dB = -e2; dC = (1 - 2 * nu + mz) * e1; dD = (1 - 2 * nu - mz) * e2; break;
            case 1: dA = e1; dB = e2; dC = (mz - 2 * nu) * e1; dD = (2 * nu + mz) * e2; break;
            case 2: dA = -e1; dB = -e2; dC = -(2 - 4 * nu + mz) * e1; dD = (2 - 4 * nu - mz) * e2; break;
            default: dA = -e1; dB = e2; dC = (1 - mz) * e1; dD = (1 + mz) * e2; break;
        }
        var base = row * N;
        if (last) {
            M[base + c0] += fac * dA;
            M[base + c0 + 1] += fac * dC;
        } else {
            M[base + c0] += fac * dA;
            M[base + c0 + 1] += fac * dB;
            M[base + c0 + 2] += fac * dC;
            M[base + c0 + 3] += fac * dD;
        }
    };

    /* Solve boundary-condition system for transform parameter m.
     * Returns Float64Array of scaled coefficients (cached). */
    LayerSystem.prototype.coeffs = function (m) {
        var hit = this.cache.get(m);
        if (hit) { this.stats.cacheHits++; return hit; }
        var n = this.n, N = this.N, M = this._M, rhs = this._rhs;
        M.fill(0); rhs.fill(0);

        /* Surface: unit normal stress amplitude, zero shear */
        this._addRow(0, 0, 0, m, 0, 1); rhs[0] = 1;
        this._addRow(1, 0, 0, m, 1, 1);

        for (var j = 0; j < n - 1; j++) {
            var z = this.zBot[j];
            var up = j, lo = j + 1, r0 = 2 + 4 * j;
            var Gu = this.layers[up].G, Gl = this.layers[lo].G;
            var itf = this.interfaces[j];
            if (itf.bond === 'unbonded' || itf.bond === 'frictionless') {
                this._addRow(r0, up, z, m, 0, 1); this._addRow(r0, lo, z, m, 0, -1);
                this._addRow(r0 + 1, up, z, m, 2, 1 / Gu); this._addRow(r0 + 1, lo, z, m, 2, -1 / Gl);
                this._addRow(r0 + 2, up, z, m, 1, 1);
                this._addRow(r0 + 3, lo, z, m, 1, 1);
            } else if (itf.bond === 'spring') {
                var k = Math.max(itf.k, 0);
                this._addRow(r0, up, z, m, 0, 1); this._addRow(r0, lo, z, m, 0, -1);
                this._addRow(r0 + 1, up, z, m, 1, 1); this._addRow(r0 + 1, lo, z, m, 1, -1);
                this._addRow(r0 + 2, up, z, m, 2, 1 / Gu); this._addRow(r0 + 2, lo, z, m, 2, -1 / Gl);
                /* tau = k * (ur_lower - ur_upper);  ur = Q/(2Gm).
                 * Written in whichever normalization keeps the row O(1). A
                 * stiff spring — the limit a student reaches by dragging the
                 * stiffness up toward "bonded" — would otherwise put entries
                 * of size k beside entries of size 1 and lose the shear
                 * equation to rounding. */
                var cU = 1 / (2 * Gu * m), cL = 1 / (2 * Gl * m);
                if (k * cU > 1) {
                    this._addRow(r0 + 3, up, z, m, 1, 1 / k);
                    this._addRow(r0 + 3, up, z, m, 3, cU);
                    this._addRow(r0 + 3, lo, z, m, 3, -cL);
                } else {
                    this._addRow(r0 + 3, up, z, m, 1, 1);
                    this._addRow(r0 + 3, up, z, m, 3, k * cU);
                    this._addRow(r0 + 3, lo, z, m, 3, -k * cL);
                }
            } else { /* bonded */
                this._addRow(r0, up, z, m, 0, 1); this._addRow(r0, lo, z, m, 0, -1);
                this._addRow(r0 + 1, up, z, m, 1, 1); this._addRow(r0 + 1, lo, z, m, 1, -1);
                this._addRow(r0 + 2, up, z, m, 2, 1 / Gu); this._addRow(r0 + 2, lo, z, m, 2, -1 / Gl);
                this._addRow(r0 + 3, up, z, m, 3, 1 / Gu); this._addRow(r0 + 3, lo, z, m, 3, -1 / Gl);
            }
        }

        /* Gaussian elimination with partial pivoting */
        var X = new Float64Array(N);
        var i, r, c, p, t, piv;
        for (c = 0; c < N; c++) {
            p = c; piv = Math.abs(M[c * N + c]);
            for (r = c + 1; r < N; r++) {
                t = Math.abs(M[r * N + c]);
                if (t > piv) { piv = t; p = r; }
            }
            if (piv < 1e-300) { M[p * N + c] = 1e-300; }
            if (p !== c) {
                for (i = c; i < N; i++) { t = M[c * N + i]; M[c * N + i] = M[p * N + i]; M[p * N + i] = t; }
                t = rhs[c]; rhs[c] = rhs[p]; rhs[p] = t;
            }
            var inv = 1 / M[c * N + c];
            for (r = c + 1; r < N; r++) {
                var f = M[r * N + c] * inv;
                if (f === 0) continue;
                for (i = c + 1; i < N; i++) M[r * N + i] -= f * M[c * N + i];
                rhs[r] -= f * rhs[c];
            }
        }
        for (r = N - 1; r >= 0; r--) {
            t = rhs[r];
            for (c = r + 1; c < N; c++) t -= M[r * N + c] * X[c];
            X[r] = t / M[r * N + r];
        }
        this.stats.solves++;
        if (this.cache.size > 60000) this.cache.clear();
        this.cache.set(m, X);
        return X;
    };

    /* Field kernels of layer i at depth z for solved coefficients X.
     * out = [Sz, St, P, Q, Tk, W]
     *   sigma_z = J0*Sz          tau_rz = J1*St
     *   sigma_r = J0*P - (J1/(mr))*Q
     *   sigma_t = J0*Tk + (J1/(mr))*Q
     *   uz = J0*W/(2Gm)          ur = J1*Q/(2Gm)                       */
    LayerSystem.prototype.kernels = function (m, X, z, i, out) {
        var L = this.layers[i], nu = L.nu, mz = m * z;
        var last = (i === this.n - 1);
        var e1 = Math.exp(-m * (z - this.zTop[i]));
        var e2 = last ? 0 : Math.exp(-m * (this.zBot[i] - z));
        var c0 = 4 * i;
        var A = X[c0], B, C, D;
        if (last) { C = X[c0 + 1]; B = 0; D = 0; }
        else { B = X[c0 + 1]; C = X[c0 + 2]; D = X[c0 + 3]; }
        var Ae = A * e1, Be = B * e2, Ce = C * e1, De = D * e2;
        out[0] = Ae + Ce * (1 - 2 * nu + mz) - Be + De * (1 - 2 * nu - mz);   /* Sz */
        out[1] = Ae + Ce * (mz - 2 * nu) + Be + De * (2 * nu + mz);           /* St */
        out[2] = -Ae + Ce * (1 + 2 * nu - mz) + Be + De * (1 + 2 * nu + mz);  /* P  */
        out[3] = -Ae + Ce * (1 - mz) + Be + De * (1 + mz);                    /* Q  */
        out[4] = 2 * nu * (Ce + De);                                          /* Tk */
        out[5] = -Ae - Ce * (2 - 4 * nu + mz) - Be + De * (2 - 4 * nu - mz);  /* W  */
        this.stats.kernelEvals++;
    };

    /* The SAME kernels for a half-space made entirely of layer 1. Its
     * coefficients are constants — A = 2nu, C = 1, B = D = 0 — so this is
     * closed form, and at z = 0 it collapses to exactly the m -> infinity
     * limits the circular load already subtracts.
     *
     * It is the reference a POINT load is integrated against. A point load
     * transforms to P*m/(2*pi), which grows with m: at the surface the raw
     * integral does not converge at all, and just under it converges far too
     * slowly to draw with. The difference from this half-space decays like
     * e^(-2*m*h1) at the surface and like e^(-m*z) below it, and the
     * reference itself is Boussinesq's closed form, added back exactly. */
    function halfKernels(m, z, nu, out) {
        var mz = m * z, e = Math.exp(-mz);
        out[0] = (1 + mz) * e;                 /* Sz */
        out[1] = mz * e;                       /* St */
        out[2] = (1 - mz) * e;                 /* P  */
        out[3] = (1 - 2 * nu - mz) * e;        /* Q  */
        out[4] = 2 * nu * e;                   /* Tk */
        out[5] = (2 * nu - 2 - mz) * e;        /* W  */
    }

    /* Boussinesq's concentrated force on a homogeneous half-space.
     * Tension positive, uz positive downward, ur positive outward.
     * Timoshenko & Goodier art. 138 / Poulos & Davis Table 2.1, negated
     * into this engine's sign convention. */
    function boussinesq(P, E, nu, r, z, out) {
        var R2 = r * r + z * z, R = Math.sqrt(R2);
        if (R < 1e-12) { out.singular = true; return out; }
        var R3 = R2 * R, R5 = R3 * R2, c = P / (2 * Math.PI);
        var Rz = R * (R + z);
        out.sz = -3 * c * z * z * z / R5;
        out.sr = -c * (3 * r * r * z / R5 - (1 - 2 * nu) / Rz);
        out.st = c * (1 - 2 * nu) * (z / R3 - 1 / Rz);
        out.trz = -3 * c * r * z * z / R5;
        var d = P * (1 + nu) / (2 * Math.PI * E * R);
        out.uz = d * (2 * (1 - nu) + z * z / R2);
        out.ur = d * (r * z / R2 - (1 - 2 * nu) * r / (R + z));
        out.singular = false;
        return out;
    }

    /* Layer index containing depth z. side: +1 → below interface wins. */
    function layerIndexAt(sys, z, side) {
        for (var i = 0; i < sys.n - 1; i++) {
            if (z < sys.zBot[i]) return i;
            if (z === sys.zBot[i]) return side === 1 ? i + 1 : i;
        }
        return sys.n - 1;
    }

    /* ------------------------------------------------------------------
     * Wynn epsilon acceleration of a partial-sum sequence (scalar)
     *
     * The table is n(n-1)/2 divisions and was n allocations of a fresh
     * Float64Array per call, called six times per convergence check,
     * seventeen times per point, for every point of a contour grid: a few
     * million short-lived typed arrays for a figure. It is the same
     * arithmetic run over three module-level buffers that rotate. They are
     * module-level and therefore NOT reentrant, which is safe only because
     * the single caller consumes each result before asking for the next —
     * the same rule lea/lea.ts records for its own reused buffers.
     * ------------------------------------------------------------------ */
    var WYNN_MAX = 32;
    var _wA = new Float64Array(WYNN_MAX + 2);
    var _wB = new Float64Array(WYNN_MAX + 2);
    var _wC = new Float64Array(WYNN_MAX + 2);
    function wynnEps(s, n) {
        if (n == null) n = s.length;
        if (n < 3) return s[n - 1];
        var prev = _wA, cur = _wB, next = _wC, i, t;
        for (i = 0; i <= n; i++) prev[i] = 0;            /* eps_{-1} = 0  */
        for (i = 0; i < n; i++) cur[i] = s[i];           /* eps_0 = sums  */
        var best = s[n - 1];
        for (var k = 1; k < n; k++) {
            var m = n - k;
            for (i = 0; i < m; i++) {
                var d = cur[i + 1] - cur[i];
                next[i] = prev[i + 1] + (Math.abs(d) > 1e-290 ? 1 / d : 1e290);
            }
            t = prev; prev = cur; cur = next; next = t;
            if ((k & 1) === 0 && m > 0) best = cur[m - 1];
        }
        return isFinite(best) ? best : s[n - 1];
    }

    /* ------------------------------------------------------------------
     * Panel breakpoints: union of approximate Bessel-zero sequences of
     * J1(m a) and J0/J1(m r). A point load has no `a`, so that family is
     * simply absent and the grid is set by the field radius and depth.
     * ------------------------------------------------------------------ */
    function makeBreakpoints(a, r, zDecay, count) {
        var cand = [];
        var s, lim;
        if (a > 1e-9) for (s = 1; s <= count; s++) cand.push((s + 0.25) * Math.PI / a);
        if (r > 1e-9) for (s = 1; s <= count; s++) cand.push((s + 0.25) * Math.PI / r);
        if (zDecay > 1e-9) {
            /* refine the exponential-decay scale near m = 0. zDecay is the
             * LONGEST length in the problem, not the evaluation depth — see
             * the note at the call site — and is quantized to powers of two
             * so that neighboring points share quadrature nodes and hit the
             * coefficient cache. */
            var zq = Math.pow(2, Math.ceil(Math.log(zDecay) / Math.LN2));
            var dm = 4 / zq; lim = 60 / zq;
            for (s = 1; s * dm <= lim; s++) cand.push(s * dm);
        }
        /* a point load on the surface directly under itself: no length in
         * the problem but the decay scale of the layered correction, which
         * is the first interface. The caller passes z = 0, r = 0 only for a
         * singular point, so this is a floor rather than a real case. */
        if (!cand.length) for (s = 1; s <= count; s++) cand.push(s * 0.05);
        cand.sort(function (x, y) { return x - y; });
        var bp = [0], last = 0;
        for (var i = 0; i < cand.length && bp.length < count + 1; i++) {
            if (cand[i] - last > 1e-9 * cand[i] + 1e-12) { bp.push(cand[i]); last = cand[i]; }
        }

        /* The first panel is graded geometrically toward m = 0.
         *
         * Every family above is EVENLY spaced, because the things they
         * resolve are periodic or exponential. Neither describes the
         * kernels themselves near m = 0, where the layered coefficients
         * turn over on whatever scale the modulus contrast sets: for a
         * 150 mm layer at E1/E2 = 43, the radial-stress integrand swings
         * from +0.03 to -0.20 between m = 1e-4 and 1e-3, an order of
         * magnitude inside the first panel, which ran to 0.008. Eight
         * Gauss points across that returned a radial stress 1e-4 of the
         * contact pressure light, everywhere in the section at once, and
         * converged there at every tolerance from 1e-6 to 1e-12 — the
         * quadrature was not failing to converge, it was converging on
         * the wrong number.
         *
         * Six levels at a ratio of four reach 4096 times below the first
         * breakpoint, and a smooth function over a 4:1 range is nothing to
         * eight-point Gauss. Seven extra panels per point; the linear
         * solves they add hit the cache like any other. */
        if (bp.length > 1) {
            var first = bp[1], grade = [];
            for (var g = 6; g >= 1; g--) grade.push(first / Math.pow(4, g));
            bp = [0].concat(grade, bp.slice(1));
        }
        return bp;
    }

    /* ------------------------------------------------------------------
     * Integrate all six responses for ONE elementary source at ONE point.
     *
     * `src` is either
     *    { kind:'circle', p, a }   uniform pressure p over radius a, or
     *    { kind:'point',  P }      a concentrated force P.
     * A line load is a weighted set of point sources, expanded by the
     * caller — which is what lets every sub-source share one m-grid (`bp`)
     * and therefore one set of cached 4N-2 solves.
     *
     * Returns [sz, sr, st, trz, uz, ur] in engine units.
     * ------------------------------------------------------------------ */
    var NC = 6;
    var _K = new Float64Array(6), _H = new Float64Array(6);
    var _hist = new Float64Array(28 * 6), _seq = new Float64Array(28);
    var _bous = { sz: 0, sr: 0, st: 0, trz: 0, uz: 0, ur: 0, singular: false };

    function pointResponse(sys, src, r, z, li, opt, bp, mConv) {
        var tol = opt.tol;
        var isPoint = src.kind === 'point';
        var L1 = sys.layers[0], nu1 = L1.nu, G1 = L1.G, E1 = L1.E;
        var surface = z <= 1e-9;
        var asy = null, fl = 1;

        if (isPoint) {
            /* Singular AT the load, exactly as the idealization says it is.
             * Reporting a number here would be inventing one. */
            if (Math.sqrt(r * r + z * z) < 1e-9) {
                return {
                    sz: NaN, sr: NaN, st: NaN, trz: NaN, uz: NaN, ur: NaN,
                    panels: 0, converged: true, singular: true
                };
            }
        } else {
            fl = src.p * src.a;
            if (surface) {
                li = 0; z = 0;
                /* m→inf limits of the kernels at z = 0, which is exactly
                 * halfKernels(m, 0, nu1) */
                asy = { Sz: 1, St: 0, P: 1, Q: 1 - 2 * nu1, Tk: 2 * nu1, W: -(2 - 2 * nu1) };
            }
        }

        var S = new Float64Array(NC);
        var nHist = 0;                       /* rolling partial-sum snapshots */
        var HISTMAX = 28;
        var est = new Float64Array(NC), estPrev = new Float64Array(NC);
        var sMax = new Float64Array(NC);     /* largest partial sum seen, per component */
        var haveEst = false, converged = false;
        var K = _K, H = _H;
        var tiny = 0;                        /* consecutive negligible panels */
        var kUsed = 0;
        var Gli = sys.layers[li].G;

        for (var kp = 0; kp < bp.length - 1 && !converged; kp++) {
            var m0 = bp[kp], m1 = bp[kp + 1];
            var hw = 0.5 * (m1 - m0), mid = 0.5 * (m1 + m0);
            var pc = new Float64Array(NC);
            for (var g = 0; g < 8; g++) {
                var m = mid + hw * GX[g];
                var w = hw * GW[g];
                var X = sys.coeffs(m);
                sys.kernels(m, X, z, li, K);
                var Sz = K[0], St = K[1], Pk = K[2], Q = K[3], Tk = K[4], W = K[5];
                var uzK, urK;
                if (isPoint) {
                    halfKernels(m, z, nu1, H);
                    uzK = W / (2 * Gli * m) - H[5] / (2 * G1 * m);
                    urK = Q / (2 * Gli * m) - H[3] / (2 * G1 * m);
                    Sz -= H[0]; St -= H[1]; Pk -= H[2]; Q -= H[3]; Tk -= H[4];
                } else {
                    if (asy) { Sz -= asy.Sz; St -= asy.St; Pk -= asy.P; Q -= asy.Q; Tk -= asy.Tk; W -= asy.W; }
                    uzK = W / (2 * Gli * m);
                    urK = Q / (2 * Gli * m);
                }
                var lt = isPoint ? (src.P * m / (2 * Math.PI)) : (fl * besselJ1(m * src.a));
                var J0r, J1r, j1r;
                if (r > 1e-9) {
                    J0r = besselJ0(m * r); J1r = besselJ1(m * r); j1r = J1r / (m * r);
                } else { J0r = 1; J1r = 0; j1r = 0.5; }
                var c = w * lt;
                pc[0] += c * J0r * Sz;
                pc[1] += c * (J0r * Pk - j1r * Q);
                pc[2] += c * (J0r * Tk + j1r * Q);
                pc[3] += c * J1r * St;
                pc[4] += c * J0r * uzK;
                pc[5] += c * J1r * urK;
            }
            var mag = 0, smag = 0, q;
            for (q = 0; q < NC; q++) {
                S[q] += pc[q];
                if (Math.abs(S[q]) > sMax[q]) sMax[q] = Math.abs(S[q]);
                mag = Math.max(mag, Math.abs(pc[q]));
                smag = Math.max(smag, Math.abs(S[q]));
            }
            if (nHist === HISTMAX) { _hist.copyWithin(0, NC); nHist--; }
            for (q = 0; q < NC; q++) _hist[nHist * NC + q] = S[q];
            nHist++;
            kUsed = kp + 1;

            /* Fast exit: exponentially dead tail */
            if (mag <= Math.max(smag, 1e-30) * 1e-15) {
                if (++tiny >= 2 && kp >= 3) break;
            } else tiny = 0;

            /* Accelerated convergence check every other panel — but never
             * before the mesh has left the band where the layered
             * exponentials live. Wynn's epsilon is a TAIL accelerator: fed
             * the smooth, nearly linear run of partial sums that the fine
             * low-m panels produce, two successive estimates agree to well
             * inside the tolerance and it declares a limit the series has
             * not reached. Measured: the radial stress just above a
             * two-layer interface stopped at 0.916323 against a true
             * 0.916410, converged and stable at every tolerance from 1e-6
             * to 1e-12. mConv is where the slowest exponential in the
             * problem is dead (e^-25), so past it the only thing left IS
             * the oscillatory tail the accelerator is for. */
            if (kp >= 7 && (kp & 1) === 1 && m0 > mConv) {
                var scS = 0, scU = 0;
                for (q = 0; q < 4; q++) scS = Math.max(scS, Math.abs(S[q]));
                for (q = 4; q < 6; q++) scU = Math.max(scU, Math.abs(S[q]));
                var ok = true;
                for (q = 0; q < NC; q++) {
                    for (var hh = 0; hh < nHist; hh++) _seq[hh] = _hist[hh * NC + q];
                    est[q] = wynnEps(_seq, nHist);
                    /* Wynn's epsilon divides by the differences of the
                     * partial sums, so a sequence that has ALREADY converged
                     * to the double it is going to reach divides by rounding
                     * noise and returns something enormous — finite, so the
                     * isFinite guard inside wynnEps passes it straight
                     * through. The limit of a convergent panel sum cannot
                     * stand orders of magnitude above every partial sum that
                     * produced it, so anything that does is the table having
                     * failed, and the plain sum is the better answer. This
                     * is reachable: a point load far from the wheel, where
                     * the layered correction is fifteen orders below the
                     * closed form that is added back to it, returned 1e294
                     * newtons of vertical stress. */
                    if (!isFinite(est[q]) || Math.abs(est[q]) > 100 * sMax[q] + 1e-290) est[q] = S[q];
                    var sc = (q < 4 ? scS : scU) + 1e-300;
                    if (haveEst && Math.abs(est[q] - estPrev[q]) > tol * sc) ok = false;
                }
                if (haveEst && ok) converged = true;
                var tmp = estPrev; estPrev = est; est = tmp;
                if (converged) { est = estPrev; }
                haveEst = true;
            }
        }

        var R = converged ? est : (haveEst ? estPrev : S);
        /* If not accelerated (fast exponential exit), plain sum is best */
        if (!converged && tiny >= 2) R = S;

        var out = {
            sz: -R[0], sr: -R[1], st: -R[2],
            trz: -R[3], uz: -R[4], ur: -R[5],
            panels: kUsed, converged: converged || tiny >= 2, singular: false
        };

        if (isPoint) {
            /* add the reference half-space solution back in closed form */
            var b = boussinesq(src.P, E1, nu1, r, z, _bous);
            out.sz += b.sz; out.sr += b.sr; out.st += b.st;
            out.trz += b.trz; out.uz += b.uz; out.ur += b.ur;
        } else if (asy) {
            /* Add closed-form Weber–Schafheitlin tails */
            var a = src.a;
            var chi = r < a ? 1 : (r > a ? 0 : 0.5);
            var cJ0 = chi / a;                                    /* ∫J1(ma)J0(mr) dm      */
            var cj1r = r <= a ? 1 / (2 * a) : a / (2 * r * r);    /* ∫J1 J1/(mr) dm        */
            var cur = r <= a ? r / (2 * a) : a / (2 * r);         /* ∫J1(ma)J1(mr)/m dm    */
            var cuz;                                              /* ∫J1(ma)J0(mr)/m dm    */
            if (r < 1e-9) cuz = 1;
            else if (r <= a) cuz = (2 / Math.PI) * ellipKE(r / a).E;
            else {
                var ke = ellipKE(a / r);
                cuz = (2 / Math.PI) * (r / a) * (ke.E - (1 - (a * a) / (r * r)) * ke.K);
            }
            out.sz += -fl * asy.Sz * cJ0;
            out.sr += -fl * (asy.P * cJ0 - asy.Q * cj1r);
            out.st += -fl * (asy.Tk * cJ0 + asy.Q * cj1r);
            out.uz += -fl * asy.W / (2 * G1) * cuz;
            out.ur += -fl * asy.Q / (2 * G1) * cur;
        }
        return out;
    }

    /* ------------------------------------------------------------------
     * A line load, expanded into weighted point sources.
     *
     * Panels are graded geometrically toward the foot of the perpendicular
     * from the evaluation point, so the near field is resolved where the
     * kernel actually varies and the far field collapses to a single panel.
     * A point ON the line at the surface is logarithmically singular — that
     * is the idealization, not a defect — and `solve` flags it rather than
     * printing the finite number a quadrature would happen to return.
     * ------------------------------------------------------------------ */
    function lineSources(ld, px, py, z, out) {
        out.length = 0;
        var half = 0.5 * ld.L;
        var th = (ld.theta || 0) * Math.PI / 180;
        var ex = Math.cos(th), ey = Math.sin(th);
        var dx = px - ld.x, dy = py - ld.y;
        var sStar = dx * ex + dy * ey;                 /* foot of perpendicular */
        var perp = Math.abs(dx * ey - dy * ex);
        var sClamp = Math.max(-half, Math.min(half, sStar));
        var along = sStar - sClamp;
        var rMin = Math.sqrt(perp * perp + along * along + z * z);

        var breaks;
        if (rMin >= ld.L) breaks = [-half, half];
        else {
            var h0 = Math.max(rMin, ld.L / 64);
            var set = [-half, half];
            if (sStar > -half && sStar < half) set.push(sStar);
            var off = 0, h = h0;
            for (var lv = 0; lv < 6; lv++) {
                off += h;
                var l = sStar - off, rr = sStar + off;
                if (l > -half) set.push(l);
                if (rr < half) set.push(rr);
                h *= 2;
                if (l <= -half && rr >= half) break;
            }
            set.sort(function (u, v) { return u - v; });
            breaks = [set[0]];
            for (var i = 1; i < set.length; i++) {
                if (set[i] - breaks[breaks.length - 1] > 1e-9 * ld.L) breaks.push(set[i]);
            }
        }

        var q = ld.P / ld.L;                           /* force per unit length */
        for (var b = 0; b + 1 < breaks.length; b++) {
            var s0 = breaks[b], s1 = breaks[b + 1];
            var hw = 0.5 * (s1 - s0), mid = 0.5 * (s1 + s0);
            for (var g = 0; g < 4; g++) {
                var s = mid + hw * LX[g];
                out.push({ x: ld.x + ex * s, y: ld.y + ey * s, P: q * hw * LW[g] });
            }
        }
        return rMin;
    }

    /* ------------------------------------------------------------------
     * Derived quantities from a Cartesian stress tensor + material.
     * Shear strains are ENGINEERING (gamma = tau/G), the convention every
     * layered-elastic program prints.
     * ------------------------------------------------------------------ */
    function derive(sig, E, nu) {
        var G = E / (2 * (1 + nu));
        var tr = sig.xx + sig.yy + sig.zz;
        var eps = {
            xx: (sig.xx - nu * (sig.yy + sig.zz)) / E,
            yy: (sig.yy - nu * (sig.xx + sig.zz)) / E,
            zz: (sig.zz - nu * (sig.xx + sig.yy)) / E,
            xy: sig.xy / G, xz: sig.xz / G, yz: sig.yz / G   /* engineering */
        };
        /* principal stresses via invariants */
        var p0 = tr / 3;
        var sxx = sig.xx - p0, syy = sig.yy - p0, szz = sig.zz - p0;
        var J2 = 0.5 * (sxx * sxx + syy * syy + szz * szz) +
            sig.xy * sig.xy + sig.xz * sig.xz + sig.yz * sig.yz;
        var s1, s2, s3;
        if (J2 < 1e-30) { s1 = s2 = s3 = p0; }
        else {
            var J3 = sxx * syy * szz + 2 * sig.xy * sig.xz * sig.yz -
                sxx * sig.yz * sig.yz - syy * sig.xz * sig.xz - szz * sig.xy * sig.xy;
            var rr = 2 * Math.sqrt(J2 / 3);
            var arg = 3 * Math.sqrt(3) * J3 / (2 * Math.pow(J2, 1.5));
            arg = Math.max(-1, Math.min(1, arg));
            var th = Math.acos(arg) / 3;
            s1 = p0 + rr * Math.cos(th);
            s2 = p0 + rr * Math.cos(th - 2 * Math.PI / 3);
            s3 = p0 + rr * Math.cos(th - 4 * Math.PI / 3);
            var t;
            if (s1 < s2) { t = s1; s1 = s2; s2 = t; }
            if (s2 < s3) { t = s2; s2 = s3; s3 = t; }
            if (s1 < s2) { t = s1; s1 = s2; s2 = t; }
        }
        var vm = Math.sqrt(3 * J2);
        /* principal strains. The material is isotropic, so they share the
         * principal directions of the stress tensor and follow from Hooke
         * directly — no second eigenvalue problem. */
        var e1 = (s1 - nu * (s2 + s3)) / E;
        var e2 = (s2 - nu * (s1 + s3)) / E;
        var e3 = (s3 - nu * (s1 + s2)) / E;
        return {
            eps: eps,
            principal: { s1: s1, s2: s2, s3: s3 },
            epsPrincipal: { e1: e1, e2: e2, e3: e3 },
            vm: vm,
            tauMax: 0.5 * (s1 - s3),
            tauOct: Math.sqrt(2 * J2 / 3),
            meanStress: p0,
            bulkStress: tr
        };
    }

    /* ------------------------------------------------------------------
     * Load normalization. The app may describe a wheel by any two of
     * (total force, pressure, radius); the engine wants the pair it
     * integrates with. Every load carries its TOTAL FORCE whatever its
     * kind, which is what lets the three idealizations be swapped at
     * constant load — the comparison the tool exists to make.
     * ------------------------------------------------------------------ */
    function normalizeLoad(ld) {
        var kind = ld.kind || 'circle';
        var out = { kind: kind, x: ld.x || 0, y: ld.y || 0 };
        var P = ld.P;
        if (P == null && ld.p > 0 && ld.a > 0) P = Math.PI * ld.a * ld.a * ld.p;
        P = Math.max(P || 0, 0);
        if (kind === 'circle') {
            var a = ld.a, p = ld.p;
            if (!(a > 0)) a = Math.sqrt(P / (Math.PI * Math.max(p, 1e-12)));
            if (!(p > 0)) p = P / (Math.PI * a * a);
            out.a = a; out.p = p; out.P = Math.PI * a * a * p;
        } else if (kind === 'point') {
            out.P = P;
        } else {
            out.P = P;
            out.L = ld.L > 0 ? ld.L : 1;
            out.theta = ld.theta || 0;
        }
        return out;
    }

    /* Reference contact radius used to turn a dimensionless slip value into
     * a shear-spring stiffness. The mean of the circular contacts if there
     * are any; otherwise whatever the job names, and failing that 150 mm. */
    function referenceRadius(job, loads) {
        if (job.options && job.options.aRef > 0) return job.options.aRef;
        var s = 0, n = 0;
        for (var i = 0; i < loads.length; i++) {
            if (loads[i].kind === 'circle') { s += loads[i].a; n++; }
        }
        return n ? s / n : 150;
    }

    /* ------------------------------------------------------------------
     * Main entry: solve a batch of evaluation points
     * job = { layers, interfaces, loads, points, options }
     *   layers    : [{h(mm), E(MPa), nu}]        (last h ignored → ∞)
     *   interfaces: [{slip}] or [{bond, k(MPa/mm)}]
     *   loads     : [{kind, x, y, ...}]          see normalizeLoad
     *   points    : [{x, y, z, side}]  side:+1 evaluates below interface
     * ------------------------------------------------------------------ */
    function solve(job, onProgress) {
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var layers = job.layers, pts = job.points;
        if (!layers || layers.length < 1) throw new Error('At least one layer required');
        if (!job.loads || !job.loads.length) throw new Error('At least one load required');
        var loads = job.loads.map(normalizeLoad);
        var aRef = referenceRadius(job, loads);
        var sys = new LayerSystem(layers, job.interfaces, aRef);
        var opt = {
            tol: (job.options && job.options.tol) || 1e-6,
            maxPanels: (job.options && job.options.maxPanels) || 220
        };
        var results = new Array(pts.length);
        var panelsTot = 0, panelsN = 0;
        var subs = [];

        for (var ip = 0; ip < pts.length; ip++) {
            var pt = pts[ip];
            var z = Math.max(0, pt.z);
            var li = (pt.li != null) ? pt.li : layerIndexAt(sys, z, pt.side === 1 ? 1 : -1);
            var sig = { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
            var disp = { ux: 0, uy: 0, uz: 0 };
            var okAll = true, singular = false;

            for (var il = 0; il < loads.length; il++) {
                var ld = loads[il];
                var aBp, rMin = Infinity;
                if (ld.kind === 'line') {
                    rMin = lineSources(ld, pt.x, pt.y, z, subs);
                    aBp = 0;
                    if (rMin < 1e-6 * ld.L) { singular = true; continue; }
                } else {
                    subs.length = 0;
                    subs.push({ x: ld.x, y: ld.y, P: ld.P });
                    aBp = ld.kind === 'circle' ? ld.a : 0;
                }

                /* One m-grid for the whole load. Every sub-source then hits
                 * the SAME cached 4N-2 solves, which is what makes a line
                 * load cost a fraction more than a point one rather than a
                 * multiple of it — the linear solve is the expensive part,
                 * and it depends on m and the materials, never on r. */
                var rMax = 0, j;
                for (j = 0; j < subs.length; j++) {
                    var ddx = pt.x - subs[j].x, ddy = pt.y - subs[j].y;
                    var rj = Math.sqrt(ddx * ddx + ddy * ddy);
                    subs[j].r = rj;
                    subs[j].cth = rj > 1e-9 ? ddx / rj : 1;
                    subs[j].sth = rj > 1e-9 ? ddy / rj : 0;
                    if (rj > rMax) rMax = rj;
                }
                /* The mesh near m = 0 must resolve the SLOWEST-decaying
                 * exponential in the integrand, and that is not e^(-m*z).
                 * A response at depth z carries the reflections off every
                 * interface, which decay like e^(-2*m*lambda_n) in the
                 * total bound depth — always a shorter scale in m than the
                 * direct term, so always the one that sets the mesh. It is
                 * worst at the SURFACE, where the asymptotic subtraction
                 * leaves nothing BUT those reflections and z contributes no
                 * refinement at all: the first panel then ran from 0 to the
                 * first zero of J1(ma), 0.026 for a 150 mm radius, across a
                 * kernel whose whole variation happens below 0.004. Eight
                 * Gauss points cannot see that, and the surface deflection
                 * of a layered section came out 0.2% high on two layers and
                 * 0.8% high on three — converged, stable under every
                 * tolerance, and wrong. Nothing in the suite caught it
                 * because the reflections vanish identically in the two
                 * cases it checked against closed forms, a half-space and a
                 * stack of identical layers.
                 *
                 * Independent check, and the one that found it: a direct
                 * fine-mesh Simpson integration of this engine's own
                 * kernels, and lea/lea.ts, agree with each other and with
                 * this to 5e-5 of the contact pressure. */
                var zDecay = Math.max(z, 2 * sys.depthFinite);
                var bp = makeBreakpoints(aBp, rMax, zDecay, opt.maxPanels);
                var mConv = zDecay > 1e-9 ? 25 / zDecay : 0;

                for (j = 0; j < subs.length; j++) {
                    var sc = subs[j];
                    var src = ld.kind === 'circle'
                        ? { kind: 'circle', p: ld.p, a: ld.a }
                        : { kind: 'point', P: sc.P };
                    var res = pointResponse(sys, src, sc.r, z, li, opt, bp, mConv);
                    if (res.singular) { singular = true; continue; }
                    if (!res.converged) okAll = false;
                    panelsTot += res.panels; panelsN++;
                    var cth = sc.cth, sth = sc.sth;
                    sig.xx += res.sr * cth * cth + res.st * sth * sth;
                    sig.yy += res.sr * sth * sth + res.st * cth * cth;
                    sig.xy += (res.sr - res.st) * cth * sth;
                    sig.zz += res.sz;
                    sig.xz += res.trz * cth;
                    sig.yz += res.trz * sth;
                    disp.ux += res.ur * cth;
                    disp.uy += res.ur * sth;
                    disp.uz += res.uz;
                }
            }

            if (singular) {
                sig = { xx: NaN, yy: NaN, zz: NaN, xy: NaN, xz: NaN, yz: NaN };
                disp = { ux: NaN, uy: NaN, uz: NaN };
            }
            var L = sys.layers[li];
            var d = derive(sig, L.E, L.nu);
            results[ip] = {
                x: pt.x, y: pt.y, z: z, li: li,
                sig: sig, disp: disp,
                eps: d.eps, principal: d.principal, epsPrincipal: d.epsPrincipal,
                vm: d.vm, tauMax: d.tauMax, tauOct: d.tauOct,
                meanStress: d.meanStress, bulkStress: d.bulkStress,
                converged: okAll, singular: singular,
                tag: pt.tag
            };
            if (onProgress && (ip % 25 === 24 || ip === pts.length - 1)) {
                onProgress((ip + 1) / pts.length);
            }
        }

        var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return {
            points: results,
            aRef: aRef,
            slip: sys.interfaces.map(function (f, i) {
                return f.bond === 'bonded' ? 0 : (f.bond === 'unbonded' ? 1
                    : kToSlip(f.k, sys.layers[i + 1].G, aRef));
            }),
            stats: {
                ms: t1 - t0,
                nPoints: pts.length,
                nLoads: loads.length,
                systemSolves: sys.stats.solves,
                cacheHits: sys.stats.cacheHits,
                kernelEvals: sys.stats.kernelEvals,
                panelsAvg: panelsN ? panelsTot / panelsN : 0
            }
        };
    }

    /* ------------------------------------------------------------------
     * Self test: closed forms the engine must reproduce exactly. Runs at
     * startup, so a browser that mis-JITs something says so in the status
     * bar instead of quietly drawing the wrong pavement.
     * ------------------------------------------------------------------ */
    function selfTest() {
        var p = 0.7, a = 150, E = 100, nu = 0.35;
        var job = {
            layers: [{ h: 0, E: E, nu: nu }],
            interfaces: [],
            loads: [{ kind: 'circle', x: 0, y: 0, p: p, a: a }],
            points: [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 0, z: 150 },
                { x: 300, y: 0, z: 0 }
            ]
        };
        var out = solve(job);
        var errs = [];
        function chk(name, got, want, tol) {
            var err = Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
            if (err > tol) errs.push(name + ': got ' + got + ', want ' + want);
            return err;
        }
        var w0 = 2 * (1 - nu * nu) * p * a / E;
        chk('w(0,0)', out.points[0].disp.uz, w0, 1e-6);
        var z = 150, R = Math.sqrt(a * a + z * z);
        chk('sz(0,a)', out.points[1].sig.zz, -p * (1 - z * z * z / (R * R * R)), 1e-4);
        var G = E / (2 * (1 + nu));
        var ke = ellipKE(a / 300);
        var wr = p * a * (1 - nu) / G * (2 / Math.PI) * (300 / a) *
            (ke.E - (1 - a * a / (300 * 300)) * ke.K);
        chk('w(2a,0)', out.points[2].disp.uz, wr, 1e-6);

        /* the point load must reproduce Boussinesq on a true half-space */
        var P = Math.PI * a * a * p;
        var pj = solve({
            layers: [{ h: 0, E: E, nu: nu }], interfaces: [],
            loads: [{ kind: 'point', x: 0, y: 0, P: P }],
            points: [{ x: 200, y: 0, z: 300 }]
        });
        var r = 200, zz = 300, R2 = r * r + zz * zz, RR = Math.sqrt(R2);
        chk('point sz', pj.points[0].sig.zz,
            -3 * P / (2 * Math.PI) * zz * zz * zz / (R2 * R2 * RR), 1e-8);
        return { pass: errs.length === 0, errors: errs };
    }

    return {
        version: VERSION,
        solve: solve,
        selfTest: selfTest,
        besselJ0: besselJ0,
        besselJ1: besselJ1,
        ellipKE: ellipKE,
        slipToK: slipToK,
        kToSlip: kToSlip,
        normalizeLoad: normalizeLoad,
        _internals: {
            LayerSystem: LayerSystem, pointResponse: pointResponse, wynnEps: wynnEps,
            boussinesq: boussinesq, halfKernels: halfKernels, lineSources: lineSources,
            makeBreakpoints: makeBreakpoints, derive: derive
        }
    };
});
