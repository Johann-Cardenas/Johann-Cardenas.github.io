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
 *   - Multi-wheel superposition with full tensor rotation
 *
 * Conventions:
 *   Units      : mm, N, MPa (N/mm^2). Pressures in MPa inside engine.
 *   Axes       : z positive DOWN from surface; x,y in plan.
 *   Stresses   : tension positive. uz positive downward.
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

    var VERSION = '1.0.0';

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

    /* 8-point Gauss-Legendre on [-1, 1] */
    var GX = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290,
        -0.1834346424956498, 0.1834346424956498, 0.5255324099163290,
        0.7966664774136267, 0.9602898564975363];
    var GW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
        0.3626837833783620, 0.3626837833783620, 0.3137066458778873,
        0.2223810344533745, 0.1012285362903763];

    /* ------------------------------------------------------------------
     * Layered system: geometry + per-m boundary system with caching
     * ------------------------------------------------------------------ */
    function LayerSystem(layers, interfaces) {
        var n = layers.length;
        this.n = n;
        this.layers = layers.map(function (L) {
            return { h: L.h, E: L.E, nu: L.nu, G: L.E / (2 * (1 + L.nu)) };
        });
        this.interfaces = [];
        for (var i = 0; i < n - 1; i++) {
            var f = (interfaces && interfaces[i]) || { bond: 'bonded' };
            this.interfaces.push({ bond: f.bond || 'bonded', k: (f.k != null ? f.k : 1) });
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
        this._piv = new Int32Array(this.N);
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
                var k = Math.max(itf.k, 1e-9);
                this._addRow(r0, up, z, m, 0, 1); this._addRow(r0, lo, z, m, 0, -1);
                this._addRow(r0 + 1, up, z, m, 1, 1); this._addRow(r0 + 1, lo, z, m, 1, -1);
                this._addRow(r0 + 2, up, z, m, 2, 1 / Gu); this._addRow(r0 + 2, lo, z, m, 2, -1 / Gl);
                /* tau = k * (ur_lower - ur_upper);  ur = Q/(2Gm) */
                this._addRow(r0 + 3, up, z, m, 1, 1);
                this._addRow(r0 + 3, lo, z, m, 3, -k / (2 * Gl * m));
                this._addRow(r0 + 3, up, z, m, 3, k / (2 * Gu * m));
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
     * ------------------------------------------------------------------ */
    function wynnEps(s) {
        var n = s.length;
        if (n < 3) return s[n - 1];
        var prev = new Float64Array(n + 1);              /* eps_{-1} = 0  */
        var cur = Float64Array.from(s);                  /* eps_0 = sums  */
        var best = s[n - 1];
        for (var k = 1; k < n; k++) {
            var next = new Float64Array(n - k);
            for (var i = 0; i < n - k; i++) {
                var d = cur[i + 1] - cur[i];
                next[i] = prev[i + 1] + (Math.abs(d) > 1e-290 ? 1 / d : 1e290);
            }
            prev = cur; cur = next;
            if ((k & 1) === 0 && cur.length > 0) best = cur[cur.length - 1];
        }
        return isFinite(best) ? best : s[n - 1];
    }

    /* ------------------------------------------------------------------
     * Panel breakpoints: union of approximate Bessel-zero sequences
     * of J1(m a) and J0/J1(m r)
     * ------------------------------------------------------------------ */
    function makeBreakpoints(a, r, z, count) {
        var cand = [];
        var s, lim;
        for (s = 1; s <= count; s++) cand.push((s + 0.25) * Math.PI / a);
        if (r > 1e-9) for (s = 1; s <= count; s++) cand.push((s + 0.25) * Math.PI / r);
        if (z > 1e-9) {
            /* refine the exponential-decay scale e^{-mz} near m = 0;
             * z is quantized to powers of two so that neighbouring depths
             * share quadrature nodes and hit the coefficient cache */
            var zq = Math.pow(2, Math.ceil(Math.log(z) / Math.LN2));
            var dm = 4 / zq; lim = 90 / zq;
            for (s = 1; s * dm <= lim; s++) cand.push(s * dm);
        }
        cand.sort(function (x, y) { return x - y; });
        var bp = [0], last = 0;
        for (var i = 0; i < cand.length && bp.length < count + 1; i++) {
            if (cand[i] - last > 1e-9 * cand[i] + 1e-12) { bp.push(cand[i]); last = cand[i]; }
        }
        return bp;
    }

    /* ------------------------------------------------------------------
     * Integrate all six responses for one load / one point.
     * Returns [sz, sr, st, trz, uz, ur] already scaled by (-p*a).
     * ------------------------------------------------------------------ */
    var NC = 6;
    function pointResponse(sys, p, a, r, z, li, opt) {
        var tol = opt.tol, maxPanels = opt.maxPanels;
        var surface = z <= 1e-9;
        var L1 = sys.layers[0], nu1, G1;
        var asy = null;
        if (surface) {
            li = 0; z = 0;
            nu1 = L1.nu; G1 = L1.G;
            /* m→inf limits of kernels at z=0 (halfspace of layer 1)  */
            asy = { Sz: 1, St: 0, P: 1, Q: 1 - 2 * nu1, Tk: 2 * nu1, W: -(2 - 2 * nu1) };
        }

        var bp = makeBreakpoints(a, r, z, maxPanels);
        var S = new Float64Array(NC);
        var hist = [];                       /* ring of partial-sum snapshots */
        var HISTMAX = 28;
        var est = new Float64Array(NC), estPrev = new Float64Array(NC);
        var haveEst = false, converged = false;
        var K = new Float64Array(6);
        var tiny = 0;                        /* consecutive negligible panels */
        var kUsed = 0;

        for (var kp = 0; kp < bp.length - 1 && !converged; kp++) {
            var m0 = bp[kp], m1 = bp[kp + 1];
            var hw = 0.5 * (m1 - m0), mid = 0.5 * (m1 + m0);
            var pc = new Float64Array(NC);
            for (var g = 0; g < 8; g++) {
                var m = mid + hw * GX[g];
                var w = hw * GW[g];
                var X = sys.coeffs(m);
                sys.kernels(m, X, z, li, K);
                var Sz = K[0], St = K[1], P = K[2], Q = K[3], Tk = K[4], W = K[5];
                if (asy) { Sz -= asy.Sz; St -= asy.St; P -= asy.P; Q -= asy.Q; Tk -= asy.Tk; W -= asy.W; }
                var G = sys.layers[li].G;
                var J1a = besselJ1(m * a);
                var J0r, J1r, j1r;
                if (r > 1e-9) {
                    J0r = besselJ0(m * r); J1r = besselJ1(m * r); j1r = J1r / (m * r);
                } else { J0r = 1; J1r = 0; j1r = 0.5; }
                var c = w * J1a;
                pc[0] += c * J0r * Sz;
                pc[1] += c * (J0r * P - j1r * Q);
                pc[2] += c * (J0r * Tk + j1r * Q);
                pc[3] += c * J1r * St;
                pc[4] += c * J0r * W / (2 * G * m);
                pc[5] += c * J1r * Q / (2 * G * m);
            }
            var mag = 0, smag = 0;
            for (var q = 0; q < NC; q++) {
                S[q] += pc[q];
                mag = Math.max(mag, Math.abs(pc[q]));
                smag = Math.max(smag, Math.abs(S[q]));
            }
            hist.push(Float64Array.from(S));
            if (hist.length > HISTMAX) hist.shift();
            kUsed = kp + 1;

            /* Fast exit: exponentially dead tail */
            if (mag <= Math.max(smag, 1e-30) * 1e-15) {
                if (++tiny >= 2 && kp >= 3) break;
            } else tiny = 0;

            /* Accelerated convergence check every other panel */
            if (kp >= 7 && (kp & 1) === 1) {
                var scS = 0, scU = 0;
                for (q = 0; q < 4; q++) scS = Math.max(scS, Math.abs(S[q]));
                for (q = 4; q < 6; q++) scU = Math.max(scU, Math.abs(S[q]));
                var ok = true;
                for (q = 0; q < NC; q++) {
                    var seq = hist.map(function (v) { return v[q]; });
                    est[q] = wynnEps(seq);
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

        var f = -p * a;
        var out = {
            sz: f * R[0], sr: f * R[1], st: f * R[2],
            trz: f * R[3], uz: f * R[4], ur: f * R[5],
            panels: kUsed, converged: converged || tiny >= 2
        };

        if (asy) {
            /* Add closed-form Weber–Schafheitlin tails */
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
            out.sz += f * asy.Sz * cJ0;
            out.sr += f * (asy.P * cJ0 - asy.Q * cj1r);
            out.st += f * (asy.Tk * cJ0 + asy.Q * cj1r);
            out.uz += f * asy.W / (2 * G1) * cuz;
            out.ur += f * asy.Q / (2 * G1) * cur;
        }
        return out;
    }

    /* ------------------------------------------------------------------
     * Derived quantities from a Cartesian stress tensor + material
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
        /* principal strains (same directions) */
        var e1 = (s1 - nu * (s2 + s3)) / E;
        var e3 = (s3 - nu * (s1 + s2)) / E;
        return {
            eps: eps,
            principal: { s1: s1, s2: s2, s3: s3 },
            epsPrincipal: { e1: e1, e3: e3 },
            vm: vm,
            tauMax: 0.5 * (s1 - s3),
            tauOct: Math.sqrt(2 * J2 / 3),
            meanStress: p0,
            bulkStress: tr
        };
    }

    /* ------------------------------------------------------------------
     * Main entry: solve a batch of evaluation points
     * job = { layers, interfaces, loads, points, options }
     *   layers    : [{h(mm), E(MPa), nu}]        (last h ignored → ∞)
     *   interfaces: [{bond:'bonded'|'unbonded'|'spring', k(MPa/mm)}]
     *   loads     : [{x, y, p(MPa), a(mm)}]
     *   points    : [{x, y, z, side}]  side:+1 evaluates below interface
     * ------------------------------------------------------------------ */
    function solve(job, onProgress) {
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var layers = job.layers, loads = job.loads, pts = job.points;
        if (!layers || layers.length < 1) throw new Error('At least one layer required');
        if (!loads || !loads.length) throw new Error('At least one load required');
        var sys = new LayerSystem(layers, job.interfaces);
        var opt = {
            tol: (job.options && job.options.tol) || 1e-6,
            maxPanels: (job.options && job.options.maxPanels) || 220
        };
        var results = new Array(pts.length);
        var panelsTot = 0, panelsN = 0;

        for (var ip = 0; ip < pts.length; ip++) {
            var pt = pts[ip];
            var z = Math.max(0, pt.z);
            var li = (pt.li != null) ? pt.li : layerIndexAt(sys, z, pt.side === 1 ? 1 : -1);
            var sig = { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
            var disp = { ux: 0, uy: 0, uz: 0 };
            var okAll = true;
            for (var il = 0; il < loads.length; il++) {
                var ld = loads[il];
                var dx = pt.x - ld.x, dy = pt.y - ld.y;
                var r = Math.sqrt(dx * dx + dy * dy);
                var res = pointResponse(sys, ld.p, ld.a, r, z, li, opt);
                if (!res.converged) okAll = false;
                panelsTot += res.panels; panelsN++;
                var cth, sth;
                if (r > 1e-9) { cth = dx / r; sth = dy / r; } else { cth = 1; sth = 0; }
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
            var L = sys.layers[li];
            var d = derive(sig, L.E, L.nu);
            results[ip] = {
                x: pt.x, y: pt.y, z: z, li: li,
                sig: sig, disp: disp,
                eps: d.eps, principal: d.principal, epsPrincipal: d.epsPrincipal,
                vm: d.vm, tauMax: d.tauMax, tauOct: d.tauOct,
                meanStress: d.meanStress, bulkStress: d.bulkStress,
                converged: okAll,
                tag: pt.tag
            };
            if (onProgress && (ip % 25 === 24 || ip === pts.length - 1)) {
                onProgress((ip + 1) / pts.length);
            }
        }

        var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return {
            points: results,
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
     * Self test: Boussinesq halfspace closed forms (engine trust check)
     * ------------------------------------------------------------------ */
    function selfTest() {
        var p = 0.7, a = 150, E = 100, nu = 0.35;
        var job = {
            layers: [{ h: 0, E: E, nu: nu }],
            interfaces: [],
            loads: [{ x: 0, y: 0, p: p, a: a }],
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
        return { pass: errs.length === 0, errors: errs };
    }

    return {
        version: VERSION,
        solve: solve,
        selfTest: selfTest,
        besselJ0: besselJ0,
        besselJ1: besselJ1,
        ellipKE: ellipKE,
        _internals: { LayerSystem: LayerSystem, pointResponse: pointResponse, wynnEps: wynnEps }
    };
});
