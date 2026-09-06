/**
 * E-Labs Canvas Animations
 * Seven hover-gated Canvas 2D animation engines for the app cards.
 * Each engine exposes init(w,h)→state and draw(ctx,state,w,h,timestamp).
 */
(function () {
  'use strict';

  /* ===========================================================
     Utility: colour ramps

     The engines below paint the same fields their apps
     paint, so they need the same scales: viridis for the FEA
     lab's von Mises, Plotly's YlOrRd for contact stress and
     Plotly's RdBu (reversed) for pavement strain.
     =========================================================== */
  function ramp(stops) {
    return function (t) {
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var s = t * (stops.length - 1);
      var i = Math.min(stops.length - 2, Math.floor(s));
      var f = s - i, a = stops[i], b = stops[i + 1];
      return [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f
      ];
    };
  }
  function css(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }

  /* the five anchors Finite-Elemented's own cmap() uses */
  var VIRIDIS = ramp([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]);

  /* Plotly's YlOrRd, the scale AirCrafter asks for by name */
  var YLORRD = ramp([
    [128, 0, 38], [189, 0, 38], [227, 26, 28], [252, 78, 42], [253, 141, 60],
    [254, 178, 76], [254, 217, 118], [255, 237, 160], [255, 255, 204]
  ]);

  /* Plotly's RdBu, on its own uneven stops, as Asphera reverses it */
  function rdBu(t) {
    var stops = [
      [0.0, [5, 10, 172]], [0.35, [106, 137, 247]], [0.5, [190, 190, 190]],
      [0.6, [220, 170, 132]], [0.7, [230, 145, 90]], [1.0, [178, 10, 28]]
    ];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (var i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        var f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        var a = stops[i][1], b = stops[i + 1][1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return stops[stops.length - 1][1];
  }

  /* ===========================================================
     Engine 1 — Asphera: a wheel crossing a layered section,
     with the longitudinal strain field it drags along.

     The app animates thirteen timesteps of a dynamic finite
     element run as the load crosses the section, and this is
     that loop: the true layer thicknesses of the Arterial
     Section (40 / 115 / 305 mm over subgrade), the same
     interfaces, the same reversed RdBu scale, and the tension
     bulb sitting under the wheel where the app's does.

     The field itself is a closed-form stand-in, not the shipped
     five-megabyte result file. The card needs a legible shape at
     200 px; the banner is where the real array is drawn.
     =========================================================== */
  var asphera = {
    init: function (w, h) {
      var off = document.createElement('canvas');
      off.width = 76; off.height = 44;
      return {
        off: off,
        octx: off.getContext('2d'),
        img: off.getContext('2d').createImageData(76, 44),
        /* Arterial Section, from data/TK_P1/structure.json */
        /* interfaces at every material change, but a label only where
           the band is thick enough on a 200 px card to carry one */
        layers: [
          { label: 'HMA', top: 0, bottom: 40 },
          { label: '', top: 40, bottom: 155 },
          { label: 'BASE', top: 155, bottom: 460 },
          { label: 'SUBGRADE', top: 460, bottom: 710 }
        ],
        depthMax: 710,
        steps: 13
      };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#0c1425';
      ctx.fillRect(0, 0, w, h);

      var top = h * 0.24, bot = h * 0.86;
      var phase = (t * 0.12) % 1;
      var x0 = phase;                               /* wheel position, 0..1 across */

      /* the field, computed small and scaled up */
      var iw = st.off.width, ih = st.off.height, d = st.img.data;
      for (var j = 0; j < ih; j++) {
        var depth = (j + 0.5) / ih * st.depthMax;
        for (var i = 0; i < iw; i++) {
          var u = (i + 0.5) / iw;
          var dx = (u - x0) * 2.2;
          var bulb = 132 * Math.exp(-dx * dx * 3.1) * Math.exp(-Math.pow((depth - 300) / 230, 2));
          var surf = -58 * Math.exp(-dx * dx * 34) * Math.exp(-Math.pow(depth / 46, 2));
          var e = -9 + bulb + surf;
          var c = rdBu(1 - (e + 52) / 170);
          var k = (j * iw + i) * 4;
          d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
        }
      }
      st.octx.putImageData(st.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(st.off, 0, top, w, bot - top);

      /* layer interfaces, dashed as the app draws them */
      ctx.strokeStyle = 'rgba(15,23,42,0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      for (var L = 1; L < st.layers.length; L++) {
        var y = top + (st.layers[L].top / st.depthMax) * (bot - top);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.textBaseline = 'top';
      for (var L2 = 0; L2 < st.layers.length; L2++) {
        var ly = top + (st.layers[L2].top / st.depthMax) * (bot - top);
        if (st.layers[L2].label && ly + 12 < bot) ctx.fillText(st.layers[L2].label, 6, ly + 3);
      }

      /* the wheel, and the load it is putting down */
      var wx = x0 * w;
      if (wx > -30 && wx < w + 30) {
        ctx.fillStyle = '#12161c';
        ctx.fillRect(wx - 13, top - 17, 26, 15);
        ctx.fillStyle = '#2a323d';
        for (var g = -1; g <= 1; g++) ctx.fillRect(wx - 11 + g * 8, top - 16, 3, 13);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.2;
        var pulse = 3 + Math.sin(t * 4) * 1.2;
        for (var a = -1; a <= 1; a++) {
          ctx.beginPath();
          ctx.moveTo(wx + a * 7, top - 21 - pulse);
          ctx.lineTo(wx + a * 7, top - 19);
          ctx.stroke();
        }
      }

      /* frame, and the timestep readout the app's slider carries */
      ctx.strokeStyle = 'rgba(84,106,132,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, top + 0.5, w - 1, bot - top - 1);

      var step = 4 + Math.floor(phase * st.steps);
      ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#2dd4d3';
      ctx.fillText('ε11  STEP ' + step + ' / 16', 8, 8);
      ctx.fillStyle = 'rgba(148,163,184,0.85)';
      ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('ARTERIAL SECTION · 144K NODES', 8, h - 14);

      /* the slider track, scrubbing itself */
      ctx.fillStyle = 'rgba(84,106,132,0.5)';
      ctx.fillRect(w - 78, h - 10, 62, 2);
      ctx.fillStyle = '#2dd4d3';
      ctx.fillRect(w - 78, h - 11, 62 * phase, 4);
    }
  };

  /* ===========================================================
     Engine 2 — AirCrafter: the vertical contact stress surface
     of one tyre, rib by rib.

     Seven ribs and six grooves of a B777-300 ER main gear tyre,
     the widths and factors the app reads out of aircraft.xlsx,
     run through the same generalized parabola computeStresses()
     uses. The wheel load breathes as it would under a rolling
     aircraft, and the ridges rise and fall with it.
     =========================================================== */
  var aircrafter = {
    init: function (w, h) {
      /* B777-300 ER, from e-labs/aircrafter/aircraft.xlsx */
      var bi = [50, 35, 40, 90, 40, 35, 50];
      var al = [0.24, 0.08, 0.08, 0.20, 0.08, 0.08, 0.24];
      var sig = [1.80, 1.10, 1.10, 1.10, 1.10, 1.10, 1.80];
      var bands = [], cursor = 0;
      for (var i = 0; i < bi.length; i++) {
        bands.push({ rib: i, y0: cursor, y1: cursor + bi[i] });
        cursor += bi[i];
        if (i < bi.length - 1) { bands.push({ rib: -1, y0: cursor, y1: cursor + 10 }); cursor += 10; }
      }
      return {
        bi: bi, al: al, sig: sig, bands: bands, patchW: cursor,
        P: 266305.367727, TiP: 1.524, L: 608.9791076660156,
        NU: 16
      };
    },

    /* the generalized parabola, one rib at a time */
    ssz: function (st, i, xnorm, loadFac) {
      var P = st.P * loadFac;
      var denom = (st.L * st.bi[i] * st.sig[i] * st.TiP) / (st.al[i] * P) - 1.0;
      var n = Math.abs(1.0 / (2.0 * denom));
      var coeff = (st.al[i] * P) / (st.L * st.bi[i]);
      return coeff * (1 + 1 / (2 * n)) * (1 - Math.pow(xnorm * xnorm, n));
    },

    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#0c1425';
      ctx.fillRect(0, 0, w, h);

      var loadFac = 1 + Math.sin(t * 1.35) * 0.16;

      /* peak, so the colour scale does not swim as the load breathes */
      var zMax = 0;
      for (var i = 0; i < st.bi.length; i++) {
        var v = this.ssz(st, i, 0, 1.16);
        if (v > zMax) zMax = v;
      }

      /* axonometric frame, fitted to the card */
      var ax = [-0.36 * w, 0.30 * h], aw = [0.46 * w, 0.24 * h], zh = 0.35 * h;
      var ox = w * 0.5 - (ax[0] + aw[0]) * 0.5;
      var oy = h * 0.26;
      function proj(u, v, z) {
        return [ox + u * ax[0] + v * aw[0], oy + u * ax[1] + v * aw[1] - (z / zMax) * zh];
      }
      function poly(pts, fill) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }

      /* the footprint the ribs stand on */
      poly([proj(0, 0, 0), proj(1, 0, 0), proj(1, 1, 0), proj(0, 1, 0)], 'rgba(12,20,37,0.9)');
      ctx.strokeStyle = 'rgba(84,106,132,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var c0 = proj(0, 0, 0), c1 = proj(1, 0, 0), c2 = proj(1, 1, 0), c3 = proj(0, 1, 0);
      ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]);
      ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.closePath();
      ctx.stroke();

      /* back to front, so the ridges occlude correctly */
      var quads = [];
      for (var b = 0; b < st.bands.length; b++) {
        var bd = st.bands[b];
        var v0 = bd.y0 / st.patchW, v1 = bd.y1 / st.patchW;
        for (var k2 = 0; k2 < st.NU; k2++) {
          var u0 = k2 / st.NU, u1 = (k2 + 1) / st.NU;
          quads.push({
            bd: bd, u0: u0, u1: u1, v0: v0, v1: v1,
            z0: bd.rib >= 0 ? this.ssz(st, bd.rib, -1 + 2 * u0, loadFac) : 0,
            z1: bd.rib >= 0 ? this.ssz(st, bd.rib, -1 + 2 * u1, loadFac) : 0,
            d: u0 + v0
          });
        }
      }
      quads.sort(function (a, b2) { return a.d - b2.d; });

      for (var q = 0; q < quads.length; q++) {
        var Q = quads[q];
        var zm = (Q.z0 + Q.z1) / 2;
        var top = [proj(Q.u0, Q.v0, Q.z0), proj(Q.u1, Q.v0, Q.z1), proj(Q.u1, Q.v1, Q.z1), proj(Q.u0, Q.v1, Q.z0)];
        if (Q.bd.rib < 0) { poly(top, 'rgba(12,20,37,0.55)'); continue; }
        var c = YLORRD(zm / zMax);
        poly([proj(Q.u0, Q.v1, Q.z0), proj(Q.u1, Q.v1, Q.z1), proj(Q.u1, Q.v1, 0), proj(Q.u0, Q.v1, 0)],
          css([c[0] * 0.5, c[1] * 0.5, c[2] * 0.5]));
        poly([proj(Q.u1, Q.v0, Q.z1), proj(Q.u1, Q.v1, Q.z1), proj(Q.u1, Q.v1, 0), proj(Q.u1, Q.v0, 0)],
          css([c[0] * 0.66, c[1] * 0.66, c[2] * 0.66]));
        poly(top, css(c));
      }

      /* readouts, in the app's own units */
      var peak = this.ssz(st, 0, 0, loadFac);
      ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('B777-300 ER · 7 RIBS', 8, h - 32);
      ctx.fillStyle = '#fdbb6d';
      ctx.fillText('σz  ' + peak.toFixed(2) + ' MPa', 8, h - 20);
      ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(148,163,184,0.85)';
      ctx.fillText((266.3 * loadFac).toFixed(1) + ' kN · 1.524 MPa', 8, h - 10);

      /* a compact key on the right */
      var kh = Math.min(64, h * 0.4), ky = (h - kh) / 2;
      for (var s2 = 0; s2 < kh; s2++) {
        ctx.fillStyle = css(YLORRD(1 - s2 / kh));
        ctx.fillRect(w - 16, ky + s2, 7, 1.2);
      }
      ctx.strokeStyle = 'rgba(84,106,132,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(w - 16.5, ky - 0.5, 8, kh + 1);
    }
  };

  /* ===========================================================
     Engine 3 — Frontier: Deep-space starfield + nebulae
     =========================================================== */
  var frontier = {
    init: function (w, h) {
      var area = w * h;
      var layers = [
        { count: Math.max(15, Math.floor(area / 2200)), speed: 0.08, sz: [0.4, 1.0] },
        { count: Math.max(10, Math.floor(area / 4000)), speed: 0.22, sz: [0.8, 1.8] },
        { count: Math.max(5,  Math.floor(area / 7000)), speed: 0.45, sz: [1.4, 2.8] }
      ];
      var stars = [];
      for (var l = 0; l < layers.length; l++) {
        var ly = layers[l];
        for (var i = 0; i < ly.count; i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: ly.sz[0] + Math.random() * (ly.sz[1] - ly.sz[0]),
            speed: ly.speed,
            layer: l,
            bright: 0.35 + Math.random() * 0.65,
            twPhase: Math.random() * 6.2832,
            twSpeed: 0.4 + Math.random() * 2.5
          });
        }
      }

      var nebulae = [
        { x: w * 0.25, y: h * 0.35, r: Math.min(w, h) * 0.38, c: [90, 30, 170] },
        { x: w * 0.72, y: h * 0.55, r: Math.min(w, h) * 0.32, c: [15, 70, 160] },
        { x: w * 0.50, y: h * 0.15, r: Math.min(w, h) * 0.22, c: [0, 140, 175] }
      ];

      var ss = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, timer: 2 + Math.random() * 3, trail: [] };

      return { stars: stars, nebulae: nebulae, ss: ss };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      var stars = st.stars;

      // Background
      var bg = ctx.createLinearGradient(0, 0, w * 0.3, h);
      bg.addColorStop(0, '#06060f');
      bg.addColorStop(1, '#0a0a1e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Nebulae (breathing + slow drift)
      for (var n = 0; n < st.nebulae.length; n++) {
        var nb = st.nebulae[n];
        var pulse = 1 + Math.sin(t * 0.25 + n * 1.8) * 0.07;
        var nx = nb.x + Math.sin(t * 0.12 + n * 2.2) * 10;
        var ny = nb.y + Math.cos(t * 0.1 + n * 2.8) * 7;
        var g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nb.r * pulse);
        g.addColorStop(0, 'rgba(' + nb.c[0] + ',' + nb.c[1] + ',' + nb.c[2] + ',0.11)');
        g.addColorStop(0.5, 'rgba(' + nb.c[0] + ',' + nb.c[1] + ',' + nb.c[2] + ',0.04)');
        g.addColorStop(1, 'rgba(' + nb.c[0] + ',' + nb.c[1] + ',' + nb.c[2] + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Stars: parallax drift + twinkle
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.x -= s.speed * 0.35;
        if (s.x < -4) { s.x = w + 4; s.y = Math.random() * h; }

        var tw = 0.5 + Math.sin(t * s.twSpeed + s.twPhase) * 0.5;
        var alpha = s.bright * tw;

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, 6.2832);
        ctx.fillStyle = 'rgba(210,220,255,' + alpha + ')';
        ctx.fill();

        if (s.size > 1.4) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size * 3, 0, 6.2832);
          ctx.fillStyle = 'rgba(170,190,255,' + (alpha * 0.08) + ')';
          ctx.fill();
        }
      }

      // Constellation lines (same or adjacent layers, within 55px)
      ctx.lineWidth = 0.5;
      for (var i = 0; i < stars.length; i++) {
        var si = stars[i];
        for (var j = i + 1; j < stars.length; j++) {
          var sj = stars[j];
          if (Math.abs(si.layer - sj.layer) > 1) continue;
          var dx = si.x - sj.x, dy = si.y - sj.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 3025) {
            ctx.globalAlpha = (1 - d2 / 3025) * 0.35;
            ctx.beginPath();
            ctx.moveTo(si.x, si.y);
            ctx.lineTo(sj.x, sj.y);
            ctx.strokeStyle = 'rgba(100,150,255,0.5)';
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Shooting star
      var ss = st.ss;
      var dt = 0.016;
      if (!ss.active) {
        ss.timer -= dt;
        if (ss.timer <= 0) {
          ss.active = true;
          ss.x = Math.random() * w * 0.6;
          ss.y = Math.random() * h * 0.25;
          var angle = 0.3 + Math.random() * 0.4;
          var spd = 4 + Math.random() * 4;
          ss.vx = Math.cos(angle) * spd;
          ss.vy = Math.sin(angle) * spd;
          ss.life = 1;
          ss.trail = [];
        }
      } else {
        ss.x += ss.vx; ss.y += ss.vy;
        ss.life -= 0.018;
        ss.trail.push({ x: ss.x, y: ss.y, a: ss.life });
        if (ss.trail.length > 18) ss.trail.shift();

        for (var i = 0; i < ss.trail.length; i++) {
          var tp = ss.trail[i];
          var f = i / ss.trail.length;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 1.5 * f + 0.3, 0, 6.2832);
          ctx.fillStyle = 'rgba(255,255,255,' + (tp.a * f * 0.7) + ')';
          ctx.fill();
        }

        if (ss.life <= 0 || ss.x > w + 30 || ss.y > h + 30) {
          ss.active = false;
          ss.timer = 3 + Math.random() * 5;
          ss.trail = [];
        }
      }
    }
  };

  /* ===========================================================
     Engine 4 — Finite-Elemented: the 2D Stress Lab, refining.

     The card runs the lesson the whole platform is built around.
     A cantilever is meshed at each of the five densities the
     app's own convergence study uses, the von Mises field is
     painted in viridis, and the tip deflection walks up towards
     Timoshenko beam theory as the mesh gets finer — with the DOF
     count and the two deflections read out underneath.

     The deflections are the app's, to the digit: FE.lab's Q4
     study for the cantilever in plane stress. The field is
     closed-form beam theory rather than a solve, which is the
     right trade at 200 px, and is also the very thing the app
     compares its solver against.
     =========================================================== */
  var finiteElemented = {
    init: function (w, h) {
      return {
        /* FE.lab.runStudy(), Q4 quads, cantilever, plane stress */
        dof: [54, 170, 350, 594, 902],
        tip: [2.3618, 2.5836, 2.6320, 2.6500, 2.6587],
        beam: 2.6848,
        L: 8, Hh: 2, P: 10, I: 2 * 2 * 2 / 12, A: 2,
        hold: 1.7                                  /* seconds per density */
      };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, w, h);

      /* faint mesh backdrop, as on the app's own hero */
      ctx.strokeStyle = 'rgba(51,65,85,0.4)';
      ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 24) { ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 24) { ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(w, gy + 0.5); ctx.stroke(); }

      var span = st.hold * st.dof.length;
      var k = Math.floor((t % span) / st.hold);
      var stage = Math.min(st.dof.length - 1, k);
      var density = stage + 1;
      var tip = st.tip[stage];

      var ncx = 8 * density, ncy = 2 * density;
      var band = { x: w * 0.06, y: h * 0.16, w: w * 0.78, h: h * 0.44 };
      var sc = Math.min(band.w / st.L, band.h / (st.Hh * 1.9));
      var ox = band.x, oy = band.y + band.h * 0.42;

      /* deflection shape, normalized so the tip lands on the
         value the app reports for this mesh */
      var drop = (tip / st.beam) * st.Hh * 0.62;
      function wOf(x) {
        var s = (3 * st.L * x * x - x * x * x) / (2 * st.L * st.L * st.L);
        return s * drop;
      }
      function P2(x, y) {
        return [ox + x * sc, oy + (st.Hh - y) * sc + wOf(x) * sc];
      }

      /* von Mises from beam theory: bending plus parabolic shear */
      var vmMax = st.P * st.L * 1 / st.I;
      function vm(x, y) {
        var c = y - st.Hh / 2;
        var sx = st.P * (st.L - x) * c / st.I;
        var tau = (3 * st.P / (2 * st.A)) * (1 - c * c);
        return Math.sqrt(sx * sx + 3 * tau * tau);
      }

      /* undeformed ghost */
      ctx.strokeStyle = 'rgba(71,85,105,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox, oy, st.L * sc, st.Hh * sc);

      /* elements */
      var hx = st.L / ncx, hy = st.Hh / ncy;
      for (var i = 0; i < ncx; i++) {
        for (var j = 0; j < ncy; j++) {
          var x0 = i * hx, x1 = x0 + hx, y0 = j * hy, y1 = y0 + hy;
          var a = P2(x0, y0), b = P2(x1, y0), c2 = P2(x1, y1), d2 = P2(x0, y1);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]);
          ctx.closePath();
          ctx.fillStyle = css(VIRIDIS(vm((x0 + x1) / 2, (y0 + y1) / 2) / vmMax));
          ctx.fill();
          if (density <= 3) {
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      if (density > 3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 0.4;
        for (var i2 = 0; i2 <= ncx; i2++) {
          ctx.beginPath();
          for (var j2 = 0; j2 <= ncy; j2++) {
            var p = P2(i2 * hx, j2 * hy);
            if (j2 === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
          ctx.stroke();
        }
        for (var j3 = 0; j3 <= ncy; j3++) {
          ctx.beginPath();
          for (var i3 = 0; i3 <= ncx; i3++) {
            var p2 = P2(i3 * hx, j3 * hy);
            if (i3 === 0) ctx.moveTo(p2[0], p2[1]); else ctx.lineTo(p2[0], p2[1]);
          }
          ctx.stroke();
        }
      }

      /* clamped edge and the tip load */
      ctx.fillStyle = '#2dd4bf';
      for (var s2 = 0; s2 <= ncy; s2++) {
        var pf = P2(0, s2 * hy);
        ctx.beginPath(); ctx.arc(pf[0], pf[1], 2.4, 0, 6.2832); ctx.fill();
      }
      ctx.strokeStyle = '#f59e0b';
      ctx.fillStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      for (var s3 = 0; s3 <= ncy; s3 += Math.max(1, Math.round(ncy / 4))) {
        var pt = P2(st.L, s3 * hy);
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] - 16); ctx.lineTo(pt[0], pt[1] - 5); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1] - 1); ctx.lineTo(pt[0] - 3.2, pt[1] - 7); ctx.lineTo(pt[0] + 3.2, pt[1] - 7);
        ctx.closePath(); ctx.fill();
      }

      /* the convergence readout: five ticks, the current one lit,
         against the beam-theory line they are all reaching for */
      var trackY = h - 26, x0t = 10, x1t = w - 10;
      ctx.strokeStyle = 'rgba(51,65,85,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0t, trackY); ctx.lineTo(x1t, trackY); ctx.stroke();

      var lo = 2.30, hi = 2.72;
      var by = trackY - ((st.beam - lo) / (hi - lo)) * 18;
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0t, by); ctx.lineTo(x1t, by); ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      for (var m = 0; m < st.dof.length; m++) {
        var mx = x0t + (m / (st.dof.length - 1)) * (x1t - x0t);
        var my = trackY - ((st.tip[m] - lo) / (hi - lo)) * 18;
        if (m === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      }
      ctx.strokeStyle = '#2dd4bf';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (var m2 = 0; m2 < st.dof.length; m2++) {
        var mx2 = x0t + (m2 / (st.dof.length - 1)) * (x1t - x0t);
        var my2 = trackY - ((st.tip[m2] - lo) / (hi - lo)) * 18;
        ctx.beginPath();
        ctx.arc(mx2, my2, m2 === stage ? 4 : 2.2, 0, 6.2832);
        ctx.fillStyle = m2 === stage ? '#e8eef9' : '#2dd4bf';
        ctx.fill();
      }

      ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#2dd4bf';
      ctx.fillText(st.dof[stage] + ' DOF', 10, 8);
      ctx.fillStyle = '#e8eef9';
      ctx.fillText(tip.toFixed(2), 10, h - 14);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('→ ' + st.beam.toFixed(2) + ' BEAM', 46, h - 14);
    }
  };

  /* ===========================================================
     Engine 5: Cross-Section Studio — isometric layered block
     Stepped pavement layers assemble and a light sweep passes.
     =========================================================== */
  var crossSectionStudio = {
    init: function (w, h) {
      // top face color / side shade pairs, top layer first
      return {
        layers: [
          { top: '#3e434a', side: '#2b2f34', t: 0.16 },  // asphalt
          { top: '#b59a76', side: '#8a7355', t: 0.22 },  // crushed base
          { top: '#b8b5ad', side: '#93908a', t: 0.30 },  // subbase
          { top: '#87694a', side: '#6a5136', t: 0.32 }   // subgrade
        ],
        speckles: (function () {
          var s = [];
          for (var i = 0; i < 90; i++) {
            s.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.4 });
          }
          return s;
        })()
      };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, w, h);

      var cx = w * 0.5, baseY = h * 0.78;
      var bw = Math.min(w * 0.6, 240);      // block width (screen)
      var iso = 0.42;                        // isometric slope
      var totalH = h * 0.52;
      var step = bw * 0.09;                  // per-layer recess

      var y = baseY;
      for (var i = st.layers.length - 1; i >= 0; i--) {
        var L = st.layers[i];
        var lh = totalH * L.t;
        var halfW = bw / 2 - (st.layers.length - 1 - i) * step;
        // assemble: layers drop in with phase offset, loops every 6s
        var phase = Math.max(0, Math.min(1, (t % 6) * 1.6 - (st.layers.length - 1 - i) * 0.35));
        var ease = 1 - Math.pow(1 - phase, 3);
        var yOff = (1 - ease) * -30;
        var yTop = y - lh + yOff;

        // side face (right)
        ctx.fillStyle = L.side;
        ctx.globalAlpha = ease;
        ctx.beginPath();
        ctx.moveTo(cx, yTop + halfW * iso);
        ctx.lineTo(cx + halfW, yTop);
        ctx.lineTo(cx + halfW, yTop + lh);
        ctx.lineTo(cx, yTop + lh + halfW * iso);
        ctx.closePath();
        ctx.fill();

        // side face (left, slightly darker)
        ctx.fillStyle = L.side;
        ctx.beginPath();
        ctx.moveTo(cx, yTop + halfW * iso);
        ctx.lineTo(cx - halfW, yTop);
        ctx.lineTo(cx - halfW, yTop + lh);
        ctx.lineTo(cx, yTop + lh + halfW * iso);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();

        // top face
        ctx.fillStyle = L.top;
        ctx.beginPath();
        ctx.moveTo(cx, yTop - halfW * iso);
        ctx.lineTo(cx + halfW, yTop);
        ctx.lineTo(cx, yTop + halfW * iso);
        ctx.lineTo(cx - halfW, yTop);
        ctx.closePath();
        ctx.fill();

        // sweep highlight on the top face
        var sweep = ((t * 0.35 + i * 0.12) % 1);
        var sx = cx - halfW + sweep * halfW * 2;
        var grad = ctx.createLinearGradient(sx - 24, 0, sx + 24, 0);
        grad.addColorStop(0, 'rgba(34,211,209,0)');
        grad.addColorStop(0.5, 'rgba(34,211,209,0.18)');
        grad.addColorStop(1, 'rgba(34,211,209,0)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.globalAlpha = 1;

        y = yTop - (i === 0 ? 0 : 2);       // thin joint line gap
      }

      // aggregate speckles over the whole block silhouette
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#e2e8f0';
      for (var k = 0; k < st.speckles.length; k++) {
        var sp = st.speckles[k];
        ctx.beginPath();
        ctx.arc(cx - bw / 2 + sp.x * bw, baseY - totalH + sp.y * totalH, sp.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };

  /* ===========================================================
     LEAPS — pulsing stress bulbs under dual wheels in a layered
     cross-section, with an exaggerated deflection basin line
     =========================================================== */
  var leaps = {
    init: function (w, h) {
      return {
        layers: [
          { c: '#33363d', t: 0.16 },   // asphalt
          { c: '#95897a', t: 0.22 },   // base
          { c: '#ab9c86', t: 0.26 },   // subbase
          { c: '#8d7355', t: 0.36 }    // subgrade
        ]
      };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#0a111f';
      ctx.fillRect(0, 0, w, h);

      var y0 = h * 0.3, depth = h * 0.7;
      var y = y0;
      for (var i = 0; i < st.layers.length; i++) {
        var L = st.layers[i];
        ctx.fillStyle = L.c;
        ctx.fillRect(0, y, w, depth * L.t + 1);
        y += depth * L.t;
      }

      // dual wheels + pulsing pressure bulbs
      var pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
      var wheels = [w * 0.38, w * 0.62];
      for (i = 0; i < wheels.length; i++) {
        var cx = wheels[i];
        // stress bulb (compression = blue)
        var R = w * 0.16 * pulse;
        var g = ctx.createRadialGradient(cx, y0, 2, cx, y0, R);
        g.addColorStop(0, 'rgba(33,102,172,0.85)');
        g.addColorStop(0.55, 'rgba(67,147,195,0.35)');
        g.addColorStop(1, 'rgba(67,147,195,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, y0 + R * 0.55, R * 0.72, R, 0, 0, 6.2832);
        ctx.fill();
        // tire
        ctx.fillStyle = '#1d2126';
        var tw = w * 0.055;
        ctx.fillRect(cx - tw, y0 - tw * 1.5 - 6, tw * 2, tw * 1.5);
        // arrows
        ctx.strokeStyle = '#e05252';
        ctx.lineWidth = 1.2;
        for (var a = -2; a <= 2; a++) {
          var ax = cx + a * tw * 0.45;
          ctx.beginPath(); ctx.moveTo(ax, y0 - 5); ctx.lineTo(ax, y0 - 1); ctx.stroke();
        }
      }

      // deflection basin line
      ctx.strokeStyle = '#22d3d1';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (var x = 0; x <= w; x += 3) {
        var defl = 0;
        for (i = 0; i < wheels.length; i++) {
          var dx = (x - wheels[i]) / (w * 0.16);
          defl += Math.exp(-dx * dx);
        }
        var yy = y0 + defl * h * 0.05 * pulse;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();

      // iso-line rings
      ctx.strokeStyle = 'rgba(232,238,249,0.18)';
      ctx.lineWidth = 0.8;
      for (i = 0; i < wheels.length; i++) {
        for (var r2 = 1; r2 <= 3; r2++) {
          var RR = w * 0.06 * r2 * pulse;
          ctx.beginPath();
          ctx.ellipse(wheels[i], y0 + RR * 0.5, RR * 0.75, RR, 0, 0, Math.PI);
          ctx.stroke();
        }
      }
    }
  };


  /* ===========================================================
     Engine 7 — Stride Lab: pose skeleton over a gait timeline

     A miniature of what the app actually shows: a runner traced by
     the same seventeen-landmark skeleton, left solid and right
     dashed exactly as in the app, with foot-strike and toe-off
     ticks marching along a timeline underneath and a knee-angle
     arc following the near leg.

     The pose is a small closed-form running model rather than a
     port of the app's inverse kinematics — the card needs a legible
     silhouette at 200 px, not a validated one, and keeping it
     self-contained means this file stays dependency-free like the
     six engines above it.
     =========================================================== */
  var strideLab = {
    init: function (w, h) {
      return {
        // seventeen canonical landmarks, in the app's own order
        names: ['nose', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
                'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
                'heelL', 'heelR', 'toeL', 'toeR'],
        bones: [
          ['nose', 'shoulderL', 'C'], ['nose', 'shoulderR', 'C'],
          ['shoulderL', 'shoulderR', 'C'], ['hipL', 'hipR', 'C'],
          ['shoulderL', 'hipL', 'L'], ['shoulderR', 'hipR', 'R'],
          ['shoulderL', 'elbowL', 'L'], ['elbowL', 'wristL', 'L'],
          ['shoulderR', 'elbowR', 'R'], ['elbowR', 'wristR', 'R'],
          ['hipL', 'kneeL', 'L'], ['kneeL', 'ankleL', 'L'],
          ['hipR', 'kneeR', 'R'], ['kneeR', 'ankleR', 'R'],
          ['ankleL', 'heelL', 'L'], ['heelL', 'toeL', 'L'], ['ankleL', 'toeL', 'L'],
          ['ankleR', 'heelR', 'R'], ['heelR', 'toeR', 'R'], ['ankleR', 'toeR', 'R']
        ],
        duty: 0.32,        // ground contact as a fraction of the stride
        period: 1.45,      // seconds per stride, slowed for legibility
        trail: []
      };
    },

    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      var TEAL = '#22d3d1', AMBER = '#f0a44a', INK2 = '#93a5c4', LINE = '#24344f';

      ctx.fillStyle = '#0a111f';
      ctx.fillRect(0, 0, w, h);

      // faint measurement grid
      ctx.strokeStyle = 'rgba(36,52,79,0.5)';
      ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 26) {
        ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, h); ctx.stroke();
      }
      for (var gy = 0; gy < h; gy += 26) {
        ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(w, gy + 0.5); ctx.stroke();
      }

      var ground = h * 0.74;
      var scale = h * 0.052;              // one "unit" ~ a tenth of body height
      var cx = w * 0.5;

      // ---- the running model -------------------------------------
      // phase 0 at left foot strike; the right leg is half a stride behind
      var ph = (t / st.period) % 1;
      var duty = st.duty;

      function legPhase(side) {
        var p = side === 'L' ? ph : (ph + 0.5) % 1;
        return p;
      }

      // pelvis: lowest at mid-stance, highest in flight — the same phase
      // relationship the app's detector depends on
      function pelvisY() {
        var p = (ph * 2) % 1;                       // once per step
        return p < duty * 2
          ? -Math.sin(Math.PI * p / (duty * 2)) * scale * 0.7
          : Math.sin(Math.PI * (p - duty * 2) / (1 - duty * 2)) * scale * 0.45;
      }

      var hipY = ground - scale * 5.3 + pelvisY();
      var thigh = scale * 2.45, shank = scale * 2.46, foot = scale * 1.5;

      function anklePos(side) {
        var p = legPhase(side);
        var reach = scale * 3.4;
        if (p < duty) {
          // stance: the foot travels backward under the body
          var s = p / duty;
          return { x: cx + reach * (0.32 - s) * 1.6, y: ground - scale * 0.28 };
        }
        // swing: forward with an arched lift
        var q = (p - duty) / (1 - duty);
        var e = q * q * (3 - 2 * q);
        return {
          x: cx + reach * (-1.09 + 1.41 * e) * 1.6,
          y: ground - scale * 0.28 - Math.sin(Math.PI * q) * Math.sin(Math.PI * q) * scale * 2.4
        };
      }

      function knee(hip, ankle) {
        var dx = ankle.x - hip.x, dy = ankle.y - hip.y;
        var d = Math.min(Math.hypot(dx, dy), (thigh + shank) * 0.995) || 0.001;
        var ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
        var a = (thigh * thigh - shank * shank + d * d) / (2 * d);
        var hh = Math.sqrt(Math.max(0, thigh * thigh - a * a));
        // the knee bends forward; pick the anterior root
        return { x: hip.x + a * ux - uy * hh * -1, y: hip.y + a * uy + ux * hh * -1 };
      }

      var lean = 0.12;
      var P = {};
      P.hipL = { x: cx - scale * 0.12, y: hipY };
      P.hipR = { x: cx + scale * 0.12, y: hipY };
      var shoulderY = hipY - scale * 2.9;
      var shoulderX = cx + Math.sin(lean) * scale * 2.9;
      P.shoulderL = { x: shoulderX - scale * 0.2, y: shoulderY };
      P.shoulderR = { x: shoulderX + scale * 0.2, y: shoulderY };
      P.nose = { x: shoulderX + Math.sin(lean) * scale * 0.7, y: shoulderY - scale * 1.15 };

      ['L', 'R'].forEach(function (side) {
        var hip = P['hip' + side];
        var ankle = anklePos(side);
        var kn = knee(hip, ankle);
        P['knee' + side] = kn;
        P['ankle' + side] = ankle;
        // foot pitch: toe-up at strike, flat through stance, pushed off at the end
        var p = legPhase(side);
        var pitch = p < duty
          ? (p < duty * 0.35 ? 0.22 * (1 - p / (duty * 0.35)) : -0.5 * ((p - duty * 0.35) / (duty * 0.65)))
          : -0.5 + 0.72 * Math.min(1, (p - duty) / (1 - duty) / 0.85);
        var fx = Math.cos(pitch), fy = -Math.sin(pitch);
        P['heel' + side] = { x: ankle.x - foot * 0.32 * fx, y: ankle.y - foot * 0.32 * fy + scale * 0.28 };
        P['toe' + side] = { x: ankle.x + foot * 0.68 * fx, y: ankle.y + foot * 0.68 * fy + scale * 0.28 };
      });

      // ---- ground and toe trail ----------------------------------
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(w, ground); ctx.stroke();

      st.trail.push({ x: P.toeL.x, y: P.toeL.y });
      if (st.trail.length > 48) st.trail.shift();
      ctx.beginPath();
      for (var i = 0; i < st.trail.length; i++) {
        if (i === 0) ctx.moveTo(st.trail[i].x, st.trail[i].y);
        else ctx.lineTo(st.trail[i].x, st.trail[i].y);
      }
      ctx.strokeStyle = 'rgba(34,211,209,0.32)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // ---- skeleton: casing, then bones ---------------------------
      ctx.lineCap = 'round';
      for (var pass = 0; pass < 2; pass++) {
        for (var b = 0; b < st.bones.length; b++) {
          var bone = st.bones[b];
          var A = P[bone[0]], B = P[bone[1]];
          if (!A || !B) continue;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
          if (pass === 0) {
            ctx.strokeStyle = 'rgba(6,10,20,0.65)';
            ctx.lineWidth = 5.5;
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = bone[2] === 'L' ? TEAL : bone[2] === 'R' ? AMBER : INK2;
            ctx.lineWidth = 2.4;
            // right side dashed, never color alone — as in the app
            ctx.setLineDash(bone[2] === 'R' ? [6, 4] : []);
          }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      for (var n = 0; n < st.names.length; n++) {
        var name = st.names[n], pt = P[name];
        if (!pt) continue;
        if (name === 'nose') {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, scale * 0.62, 0, 6.2832);
          ctx.fillStyle = INK2;
          ctx.fill();
          continue;
        }
        var isFoot = /heel|toe|ankle/.test(name);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isFoot ? 3.2 : 2.6, 0, 6.2832);
        ctx.fillStyle = name.charAt(name.length - 1) === 'R' ? AMBER : TEAL;
        ctx.fill();
      }

      // ---- knee angle arc on the near leg -------------------------
      (function () {
        var hip = P.hipL, kn = P.kneeL, an = P.ankleL;
        var r = Math.min(20, scale * 1.5);
        var a1 = Math.atan2(hip.y - kn.y, hip.x - kn.x);
        var a2 = Math.atan2(an.y - kn.y, an.x - kn.x);
        var sweep = a2 - a1;
        while (sweep > Math.PI) sweep -= 6.2832;
        while (sweep < -Math.PI) sweep += 6.2832;
        ctx.beginPath();
        ctx.arc(kn.x, kn.y, r, a1, a1 + sweep, sweep < 0);
        ctx.strokeStyle = TEAL;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        var mid = a1 + sweep / 2;
        var deg = Math.round(180 - Math.abs(sweep) * 57.2958);
        ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = '#e8eef9';
        ctx.textBaseline = 'middle';
        ctx.fillText(deg + '\u00B0', kn.x + Math.cos(mid) * (r + 12) - 8, kn.y + Math.sin(mid) * (r + 12));
      })();

      // ---- event timeline ----------------------------------------
      var tlY = h - 16;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(10, tlY); ctx.lineTo(w - 10, tlY); ctx.stroke();

      // ticks scroll leftwards at one stride per period, so a strike tick
      // crosses the playhead exactly when the foot lands
      var span = w - 20;
      var pxPerStride = span / 2.6;
      for (var k = -1; k < 5; k++) {
        for (var s2 = 0; s2 < 2; s2++) {
          var evPh = k + (s2 === 0 ? 0 : 0.5);
          var x = 10 + span * 0.5 + (evPh - ph) * pxPerStride;
          if (x < 8 || x > w - 8) continue;
          ctx.strokeStyle = s2 === 0 ? TEAL : AMBER;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, tlY - 6); ctx.lineTo(x, tlY + 6); ctx.stroke();
          var xo = x + duty * pxPerStride;
          if (xo > 8 && xo < w - 8) {
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(xo, tlY - 3.5); ctx.lineTo(xo, tlY + 3.5); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      // playhead
      ctx.strokeStyle = '#e8eef9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10 + span * 0.5, tlY - 10); ctx.lineTo(10 + span * 0.5, tlY + 10);
      ctx.stroke();

      // ---- on-device badge ---------------------------------------
      ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#34d399';
      ctx.textBaseline = 'top';
      ctx.beginPath();
      ctx.arc(14, 15, 3, 0, 6.2832);
      ctx.fill();
      ctx.fillText('ON-DEVICE', 22, 11);
    }
  };

  /* ===========================================================
     Controller: DPR-aware sizing, hover-gated rAF loop
     =========================================================== */
  var engines = {
    'asphera': asphera,
    'aircrafter': aircrafter,
    'frontier': frontier,
    'finite-elemented': finiteElemented,
    'cross-section-studio': crossSectionStudio,
    'leaps': leaps,
    'stride-lab': strideLab
  };

  function initCard(card) {
    var type = card.getAttribute('data-animation');
    var engine = engines[type];
    if (!engine) return;

    var canvas = card.querySelector('.app-card__canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var container = canvas.parentElement;

    function size() {
      var rect = container.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: rect.width, h: rect.height };
    }

    var dims = size();
    var state = engine.init(dims.w, dims.h);
    engine.draw(ctx, state, dims.w, dims.h, 0);

    var rafId = null;

    card.addEventListener('mouseenter', function () {
      if (rafId) return;
      (function loop(ts) {
        engine.draw(ctx, state, dims.w, dims.h, ts);
        rafId = requestAnimationFrame(loop);
      })(performance.now());
    });

    card.addEventListener('mouseleave', function () {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        dims = size();
        state = engine.init(dims.w, dims.h);
        engine.draw(ctx, state, dims.w, dims.h, 0);
      }, 250);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var cards = document.querySelectorAll('.app-card[data-animation]');
    for (var i = 0; i < cards.length; i++) initCard(cards[i]);
  });
})();
