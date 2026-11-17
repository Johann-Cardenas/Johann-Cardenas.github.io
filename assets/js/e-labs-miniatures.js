/**
 * E-Labs 3D miniatures for AirCrafter and Asphera.
 *
 * The same visual language as the Finite-Elemented and Frontier previews
 * (light or dark stage that follows the site theme, grid floor, one caption
 * chip), drawn from each app's own numbers:
 *
 *   AirCrafter  the vertical contact stress of a B777-300ER main-gear tire,
 *               seven ribs, through the generalized parabola the app's
 *               computeStresses() uses, with the row the app reads out of
 *               aircraft.xlsx. Peak 2.74 MPa at 266.3 kN and 1.524 MPa.
 *   Asphera     the Arterial Section block at true layer thickness, its
 *               front face painted with the real longitudinal strain field
 *               of the app's 13 animation frames (data/TK_P1/mini.json,
 *               written by scripts/banners/asphera-mini.mjs).
 *
 * The scene renders one still frame when the card scrolls into view and
 * animates only while the card is hovered or focused. Without WebGL the card
 * keeps its banner and the Canvas 2D engine in e-labs-canvas.js.
 */
(function () {
  'use strict';

  var T = window.THREE;
  if (!T) return;

  var TYPES = ['aircrafter', 'asphera'];

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  /* ---------- colour scales, as the apps paint them ---------- */
  function ramp(stops) {
    return function (t) {
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
      var a = stops[i], b = stops[i + 1];
      return [(a[0] + (b[0] - a[0]) * f) / 255, (a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255];
    };
  }
  /* Plotly YlOrRd, the scale AirCrafter asks for by name */
  var YLORRD = ramp([[128, 0, 38], [189, 0, 38], [227, 26, 28], [252, 78, 42], [253, 141, 60],
    [254, 178, 76], [254, 217, 118], [255, 237, 160], [255, 255, 204]]);
  /* Plotly RdBu on its uneven stops, reversed the way Asphera uses it */
  function rdBu(t) {
    var st = [[0, [5, 10, 172]], [0.35, [106, 137, 247]], [0.5, [190, 190, 190]],
      [0.6, [220, 170, 132]], [0.7, [230, 145, 90]], [1, [178, 10, 28]]];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (var i = 0; i < st.length - 1; i++) {
      if (t <= st[i + 1][0]) {
        var f = (t - st[i][0]) / (st[i + 1][0] - st[i][0]), a = st[i][1], b = st[i + 1][1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return st[st.length - 1][1];
  }

  var _c = new T.Color();
  function lin(rgb) { _c.setRGB(rgb[0], rgb[1], rgb[2], T.SRGBColorSpace); return [_c.r, _c.g, _c.b]; }

  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

  /* ===========================================================
     Stage: renderer, camera, lights, floor, theme, lifecycle
     =========================================================== */
  function Stage(host, opts) {
    this.host = host;
    this.theta = opts.theta; this.phi = opts.phi; this.radius = opts.radius;
    this.target = opts.target || new T.Vector3(0, 0, 0);
    this.fitWidth = opts.fitWidth || 10;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#f8fafc');
    this.scene.fog = new T.Fog('#f8fafc', 30, 60);
    this.camera = new T.PerspectiveCamera(opts.fov || 30, 1, 0.1, 200);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    // ?poster lifts the cap so the banner PNGs can be captured from this scene.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, /[?&]poster/.test(location.search) ? 4 : 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.NoToneMapping;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);

    this.hemi = new T.HemisphereLight('#f1f7ff', '#5b6b80', 1.6);
    this.scene.add(this.hemi);
    var key = new T.DirectionalLight('#ffffff', 1.9);
    key.position.set(-6, 12, 9);
    this.scene.add(key);
    var fill = new T.DirectionalLight('#cfe8ff', 0.9);
    fill.position.set(8, 4, -6);
    this.scene.add(fill);

    this.grid = new T.GridHelper(60, 60, '#cbd5e1', '#cbd5e1');
    this.grid.position.y = opts.floor || 0;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);

    this.content = new T.Group();
    this.scene.add(this.content);

    var self = this;
    this.setTheme();
    this.themeObserver = new MutationObserver(function () { self.setTheme(); });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.resizeObserver = new ResizeObserver(function () { self.resize(); });
    this.resizeObserver.observe(host);
    this.resize();
  }
  Stage.prototype.setTheme = function () {
    var dark = isDark(), bg = dark ? '#0f172a' : '#f8fafc';
    this.scene.background.set(bg);
    this.scene.fog.color.set(bg);
    var c = new T.Color(dark ? '#253650' : '#d5dde7'), a = this.grid.geometry.attributes.color;
    for (var i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
    a.needsUpdate = true;
    this.grid.material.opacity = dark ? 0.55 : 0.8;
    if (this.onTheme) this.onTheme(dark);
    this.render();
  };
  Stage.prototype.resize = function () {
    var r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  };
  Stage.prototype.render = function () {
    var sp = Math.sin(this.phi);
    // Frame the subject's width regardless of the card's aspect ratio.
    var fovH = 2 * Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect);
    var dist = Math.max(this.radius, (this.fitWidth / 2) / Math.tan(fovH / 2));
    this.camera.position.set(
      this.target.x + dist * sp * Math.sin(this.theta),
      this.target.y + dist * Math.cos(this.phi),
      this.target.z + dist * sp * Math.cos(this.theta));
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  };
  Stage.prototype.dispose = function () {
    this.themeObserver.disconnect();
    this.resizeObserver.disconnect();
    this.scene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  };

  /* ===========================================================
     AirCrafter: sigma-z over the footprint, rib by rib
     =========================================================== */
  function buildAircrafter(stage) {
    /* B777-300 ER, the row AirCrafter reads out of aircraft.xlsx */
    var tire = {
      bi: [50, 35, 40, 90, 40, 35, 50],          // rib widths, mm
      al: [0.24, 0.08, 0.08, 0.20, 0.08, 0.08, 0.24],
      sig: [1.80, 1.10, 1.10, 1.10, 1.10, 1.10, 1.80],
      groove: 10, P: 266305.367727, TiP: 1.524, L: 608.9791076660156
    };
    function ssz(i, xn, loadFac) {
      var P = tire.P * loadFac;
      var denom = (tire.L * tire.bi[i] * tire.sig[i] * tire.TiP) / (tire.al[i] * P) - 1;
      var n = Math.abs(1 / (2 * denom));
      var coeff = (tire.al[i] * P) / (tire.L * tire.bi[i]);
      return coeff * (1 + 1 / (2 * n)) * (1 - Math.pow(xn * xn, n));
    }
    var peak = 0;
    for (var p = 0; p < 7; p++) peak = Math.max(peak, ssz(p, 0, 1));

    var S = 0.01;                 // scene units per mm
    var H = 2.6;                  // height of the peak stress, scene units
    var NX = 48, NY = 5;
    var width = tire.bi.reduce(function (a, b) { return a + b; }, 0) + tire.groove * 6;
    var Lx = tire.L * S, Wz = width * S;

    // The footprint plate the ribs stand on.
    var plateMat = new T.MeshStandardMaterial({ color: '#334155', roughness: 0.85, metalness: 0 });
    var plate = new T.Mesh(new T.BoxGeometry(Lx + 0.5, 0.08, Wz + 0.5), plateMat);
    plate.position.y = -0.04;
    stage.content.add(plate);
    var edge = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(Lx, 0.001, Wz)),
      new T.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.8 }));
    edge.position.y = 0.002;
    stage.content.add(edge);

    var mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0, side: T.DoubleSide });
    var ribs = [];
    var z0 = -Wz / 2;
    for (var r = 0; r < 7; r++) {
      var w = tire.bi[r] * S;
      // top surface (NX x NY) + two long side walls (NX x 2 each)
      var verts = (NX + 1) * (NY + 1) + 2 * (NX + 1) * 2;
      var pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3), idx = [];
      var k = 0;
      for (var j = 0; j <= NY; j++) for (var i = 0; i <= NX; i++, k++) {
        pos[k * 3] = -Lx / 2 + Lx * i / NX; pos[k * 3 + 2] = z0 + w * j / NY;
      }
      for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
        var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      var wall0 = k;
      for (var sdx = 0; sdx < 2; sdx++) {
        var zz = sdx ? z0 + w : z0, base = k;
        for (var lvl = 0; lvl < 2; lvl++) for (i = 0; i <= NX; i++, k++) {
          pos[k * 3] = -Lx / 2 + Lx * i / NX; pos[k * 3 + 2] = zz;
        }
        for (i = 0; i < NX; i++) {
          var a2 = base + i, b2 = a2 + 1, c2 = base + NX + 1 + i, d2 = c2 + 1;
          idx.push(a2, b2, c2, b2, d2, c2);
        }
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.setIndex(idx);
      var mesh = new T.Mesh(g, mat);
      stage.content.add(mesh);
      ribs.push({ r: r, g: g, wall0: wall0 });
      z0 += w + tire.groove * S;
    }

    function update(loadFac) {
      ribs.forEach(function (rb) {
        var pos = rb.g.attributes.position.array, col = rb.g.attributes.color.array;
        var heights = [];
        for (var i = 0; i <= NX; i++) {
          var s = ssz(rb.r, -1 + 2 * i / NX, loadFac);
          heights.push(s);
        }
        var k = 0;
        for (var j = 0; j <= NY; j++) for (i = 0; i <= NX; i++, k++) {
          var s2 = heights[i], c = lin(YLORRD(s2 / (peak * 1.16)));
          pos[k * 3 + 1] = s2 / peak * H;
          col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
        }
        for (var sdx = 0; sdx < 2; sdx++) for (var lvl = 0; lvl < 2; lvl++) for (i = 0; i <= NX; i++, k++) {
          var s3 = heights[i], c3 = lin(YLORRD(s3 / (peak * 1.16))), shade = lvl ? 1 : 0.55;
          pos[k * 3 + 1] = lvl ? s3 / peak * H : 0;
          col[k * 3] = c3[0] * shade; col[k * 3 + 1] = c3[1] * shade; col[k * 3 + 2] = c3[2] * shade;
        }
        rb.g.attributes.position.needsUpdate = true;
        rb.g.attributes.color.needsUpdate = true;
        rb.g.computeVertexNormals();
        rb.g.computeBoundingSphere();
      });
    }
    update(1);

    return {
      caption: function () {
        return ['CONTACT STRESS σz', 'B777-300ER · ' + peak.toFixed(2) + ' MPa'];
      },
      tick: function (t, cap) {
        var f = 1 + Math.sin(t * 1.3) * 0.14;
        update(f);
        cap[1].textContent = (266.3 * f).toFixed(0) + ' kN · ' + (peak * f).toFixed(2) + ' MPa';
      },
      reset: function (cap) { update(1); cap[1].textContent = 'B777-300ER · ' + peak.toFixed(2) + ' MPa'; }
    };
  }

  /* ===========================================================
     Asphera: the Arterial Section, its real strain on the cut face
     =========================================================== */
  function buildAsphera(stage, data) {
    var S = 0.01;
    var Lx = (data.x[1] - data.x[0]) * S;     // 13.2
    var D = data.depth * S;                   // 7
    var Wz = 5.0;                             // block depth into the screen
    var block = new T.Group();
    stage.content.add(block);

    // Layers at true thickness, coloured as Asphera colours them.
    var edgeMat = new T.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.35 });
    data.layers.forEach(function (l) {
      var h = (l.bottom - l.top) * S;
      if (h <= 0) return;
      var m = new T.MeshStandardMaterial({ color: l.color, roughness: 0.9, metalness: 0 });
      var box = new T.Mesh(new T.BoxGeometry(Lx, h, Wz), m);
      box.position.set(0, -(l.top * S) - h / 2, 0);
      block.add(box);
      var e = new T.LineSegments(new T.EdgesGeometry(box.geometry), edgeMat);
      e.position.copy(box.position);
      block.add(e);
    });

    // The cut face carries the field.
    var nx = data.nx, nz = data.nz;
    var pixels = new Uint8Array(nx * nz * 4);
    var tex = new T.DataTexture(pixels, nx, nz, T.RGBAFormat);
    tex.colorSpace = T.SRGBColorSpace;
    tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter;
    tex.flipY = false;
    var face = new T.Mesh(new T.PlaneGeometry(Lx, D),
      new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.set(0, -D / 2, Wz / 2 + 0.004);
    block.add(face);
    // Interfaces drawn on the face, dashed as the app draws them.
    var dash = new T.LineDashedMaterial({ color: '#0f172a', dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.65 });
    data.layers.forEach(function (l, i) {
      if (i === 0) return;
      var y = -l.top * S;
      var gl = new T.BufferGeometry().setFromPoints([new T.Vector3(-Lx / 2, y, Wz / 2 + 0.01), new T.Vector3(Lx / 2, y, Wz / 2 + 0.01)]);
      var line = new T.Line(gl, dash);
      line.computeLineDistances();
      block.add(line);
    });

    var lo = data.range[0], hi = data.range[1];
    function paint(a, b, f) {
      // Rows run top (surface) to bottom; the plane's v runs bottom to top.
      for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++) {
        var k = j * nx + i;
        var e = a.e11[k] * (1 - f) + b.e11[k] * f;
        var c = rdBu(1 - (e - lo) / (hi - lo));
        var p = ((nz - 1 - j) * nx + i) * 4;
        pixels[p] = c[0]; pixels[p + 1] = c[1]; pixels[p + 2] = c[2]; pixels[p + 3] = 255;
      }
      tex.needsUpdate = true;
    }

    // A tire, rolling along the wheel path above the face.
    var R = 1.7, TW = 1.5;
    var wheel = new T.Group();
    var rubber = new T.MeshStandardMaterial({ color: '#1f2329', roughness: 0.75, metalness: 0.05 });
    var tread = new T.Mesh(new T.CylinderGeometry(R, R, TW, 64, 1, true), rubber);
    tread.rotation.x = Math.PI / 2;
    wheel.add(tread);
    var side = new T.Mesh(new T.RingGeometry(R * 0.62, R, 64), rubber);
    var rimMat = new T.MeshStandardMaterial({ color: '#b6c2cf', roughness: 0.35, metalness: 0.6 });
    var rim = new T.Mesh(new T.CircleGeometry(R * 0.62, 48), rimMat);
    [1, -1].forEach(function (s) {
      var sd = side.clone(); sd.position.z = s * TW / 2; if (s < 0) sd.rotation.y = Math.PI; wheel.add(sd);
      var rm = rim.clone(); rm.position.z = s * (TW / 2 - 0.05); if (s < 0) rm.rotation.y = Math.PI; wheel.add(rm);
    });
    var hub = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, TW + 0.12, 24), new T.MeshStandardMaterial({ color: '#64748b', roughness: 0.4, metalness: 0.5 }));
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(0, R, Wz / 2 - TW / 2 - 0.25);
    stage.content.add(wheel);

    var frames = data.frames, rest = 7;   // step 11: the bulb under the middle of the block
    function show(pos) {
      var i = Math.min(frames.length - 2, Math.floor(pos)), f = pos - i;
      paint(frames[i], frames[i + 1], f);
      var wx = frames[i].wheelX * (1 - f) + frames[i + 1].wheelX * f;
      wheel.position.x = wx * S;
      wheel.rotation.z = -wheel.position.x / R;
      return Math.round(frames[i].step * (1 - f) + frames[i + 1].step * f);
    }
    show(rest);

    return {
      caption: function () {
        return ['STRAIN ε11 · ARTERIAL', 'STEP ' + frames[rest].step + ' / 16'];
      },
      tick: function (t, cap) {
        var span = frames.length - 1, pos = ((t * 1.6) % (span * 2));
        pos = pos > span ? span * 2 - pos : pos;          // ping-pong, so the tire never jumps
        var step = show(Math.min(span - 1e-6, pos));
        cap[1].textContent = 'STEP ' + step + ' / 16';
      },
      reset: function (cap) { show(rest); cap[1].textContent = 'STEP ' + frames[rest].step + ' / 16'; }
    };
  }

  /* ===========================================================
     Card wiring
     =========================================================== */
  function injectStyle() {
    if (document.getElementById('elabs-mini-style')) return;
    var s = document.createElement('style');
    s.id = 'elabs-mini-style';
    s.textContent =
      '.elabs-mini{position:absolute;inset:0;z-index:1;pointer-events:none}' +
      '.elabs-mini canvas{display:block;width:100%;height:100%}' +
      '.app-card.elabs-mini-ready .app-card__banner,.app-card.elabs-mini-ready .app-card__canvas,' +
      '.app-card.elabs-mini-ready .app-card__hover-text{display:none!important}' +
      '.app-card.elabs-mini-ready .status-badge{z-index:3}' +
      '.elabs-mini-caption{position:absolute;z-index:2;bottom:14px;left:16px;right:16px;display:flex;' +
      'justify-content:space-between;gap:8px;padding:7px 9px;border-radius:6px;background:var(--bg-box);' +
      'color:var(--text-primary);font:600 9.5px/1.4 ui-monospace,monospace;letter-spacing:.06em;' +
      'white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}' +
      '.elabs-mini-caption span:last-child{color:var(--text-secondary);text-align:right}';
    document.head.appendChild(s);
  }

  function mount(card) {
    var type = card.getAttribute('data-animation');
    var bg = card.querySelector('.app-card__animated-bg');
    var host = document.createElement('div');
    host.className = 'elabs-mini';
    bg.appendChild(host);

    var ready = type === 'asphera'
      ? fetch('e-labs/asphera/data/TK_P1/mini.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      : Promise.resolve(null);

    return ready.then(function (data) {
      var stage, model;
      if (type === 'aircrafter') {
        stage = new Stage(host, { theta: 0.62, phi: 1.04, radius: 14.5, fov: 30, fitWidth: 9,
          target: new T.Vector3(0, 0.15, 0.35), floor: -0.09 });
        model = buildAircrafter(stage);
      } else {
        stage = new Stage(host, { theta: 0.42, phi: 1.2, radius: 33, fov: 30, fitWidth: 19,
          target: new T.Vector3(0, -4.5, 0), floor: -7.05 });
        model = buildAsphera(stage, data);
      }
      var cap = document.createElement('div');
      cap.className = 'elabs-mini-caption';
      cap.innerHTML = '<span></span><span></span>';
      var spans = cap.children, text = model.caption();
      spans[0].textContent = text[0]; spans[1].textContent = text[1];
      bg.appendChild(cap);
      card.classList.add('elabs-mini-ready');
      stage.render();

      var raf = 0, t0 = 0, theta0 = stage.theta;
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      function loop(ts) {
        if (!t0) t0 = ts;
        var t = (ts - t0) / 1000;
        model.tick(t, spans);
        stage.theta = theta0 + Math.sin(t * 0.35) * 0.22;
        stage.render();
        raf = requestAnimationFrame(loop);
      }
      function motion() {
        var on = !reduce.matches && (card.matches(':hover') || card.contains(document.activeElement));
        if (on && !raf) { t0 = 0; raf = requestAnimationFrame(loop); }
        if (!on && raf) {
          cancelAnimationFrame(raf); raf = 0;
          stage.theta = theta0; model.reset(spans); stage.render();
        }
      }
      card.addEventListener('mouseenter', motion);
      card.addEventListener('mouseleave', motion);
      card.addEventListener('focusin', motion);
      card.addEventListener('focusout', function () { setTimeout(motion, 0); });
      return stage;
    }).catch(function () {
      // Keep the banner and the Canvas 2D engine.
      host.remove();
      card.removeAttribute('data-mini');
      return null;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!webglAvailable() || !('IntersectionObserver' in window) || !('ResizeObserver' in window)) return;
    var cards = TYPES.map(function (t) { return document.querySelector('.app-card[data-animation="' + t + '"]'); })
      .filter(Boolean);
    if (!cards.length) return;
    injectStyle();
    var stages = [];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        mount(en.target).then(function (s) { if (s) stages.push(s); });
      });
    }, { rootMargin: '150px' });
    cards.forEach(function (c) {
      c.setAttribute('data-mini', '3d');   // e-labs-canvas.js leaves these cards alone
      io.observe(c);
    });
    window.addEventListener('pagehide', function (e) {
      if (e.persisted) return;
      io.disconnect();
      stages.forEach(function (s) { s.dispose(); });
    });
  });
})();
