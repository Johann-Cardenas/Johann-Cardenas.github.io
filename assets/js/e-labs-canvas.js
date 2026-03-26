/**
 * E-Labs Canvas Animations
 * Four hover-gated Canvas 2D animation engines for app cards.
 * Each engine exposes init(w,h)→state and draw(ctx,state,w,h,timestamp).
 */
(function () {
  'use strict';

  /* ===========================================================
     Utility: Jet-like stress colormap LUT (256 entries)
     =========================================================== */
  function buildStressLUT() {
    var stops = [
      { pos: 0.00, r: 6,   g: 6,   b: 50  },
      { pos: 0.12, r: 0,   g: 35,  b: 120 },
      { pos: 0.28, r: 0,   g: 100, b: 140 },
      { pos: 0.45, r: 0,   g: 120, b: 70  },
      { pos: 0.55, r: 70,  g: 130, b: 0   },
      { pos: 0.70, r: 160, g: 130, b: 0   },
      { pos: 0.82, r: 160, g: 70,  b: 0   },
      { pos: 1.00, r: 110, g: 0,   b: 0   }
    ];
    var lut = new Array(256);
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      var lo = stops[0], hi = stops[stops.length - 1];
      for (var s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s].pos && t <= stops[s + 1].pos) {
          lo = stops[s]; hi = stops[s + 1]; break;
        }
      }
      var f = hi.pos === lo.pos ? 0 : (t - lo.pos) / (hi.pos - lo.pos);
      lut[i] = 'rgb(' +
        Math.round(lo.r + (hi.r - lo.r) * f) + ',' +
        Math.round(lo.g + (hi.g - lo.g) * f) + ',' +
        Math.round(lo.b + (hi.b - lo.b) * f) + ')';
    }
    return lut;
  }

  /* ===========================================================
     Engine 1 — Asphera: Deformable FEM mesh + stress colormap
     =========================================================== */
  var asphera = {
    init: function (w, h) {
      var spacing = 16;
      var cols = Math.ceil(w / spacing) + 2;
      var rows = Math.ceil(h / spacing) + 2;
      var nodes = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var ox = (r % 2) * (spacing * 0.5);
          nodes.push({
            bx: c * spacing + ox - spacing,
            by: r * spacing - spacing,
            x: 0, y: 0,
            phase: Math.random() * 6.2832
          });
        }
      }
      var tris = [];
      for (var r = 0; r < rows - 1; r++) {
        for (var c = 0; c < cols - 1; c++) {
          var i = r * cols + c;
          tris.push(i, i + 1, i + cols);
          tris.push(i + 1, i + cols + 1, i + cols);
        }
      }
      return { nodes: nodes, tris: tris, cols: cols, lut: buildStressLUT() };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      var nodes = st.nodes, tris = st.tris, lut = st.lut;

      ctx.fillStyle = '#080c16';
      ctx.fillRect(0, 0, w, h);

      // Deform
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.x = n.bx + Math.sin(t * 0.7 + n.phase + n.bx * 0.018) * 2.8;
        n.y = n.by + Math.cos(t * 0.55 + n.phase + n.by * 0.022) * 2.8;
      }

      // Draw triangles
      for (var i = 0; i < tris.length; i += 3) {
        var a = nodes[tris[i]], b = nodes[tris[i + 1]], c = nodes[tris[i + 2]];
        var cx = (a.x + b.x + c.x) / 3;
        var cy = (a.y + b.y + c.y) / 3;

        // Stress: sweeping diagonal wave + radial pulse
        var stress = (Math.sin(t * 0.35 + cx * 0.012 - cy * 0.01) +
                      Math.sin(t * 0.6 + Math.sqrt(cx * cx + cy * cy) * 0.008)) * 0.25 + 0.5;
        var idx = Math.max(0, Math.min(255, (stress * 255) | 0));

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.fillStyle = lut[idx];
        ctx.globalAlpha = 0.75;
        ctx.fill();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Subtle top highlight sweep
      var sweepX = (Math.sin(t * 0.25) + 1) * 0.5 * w;
      var grad = ctx.createRadialGradient(sweepX, h * 0.3, 0, sweepX, h * 0.3, w * 0.4);
      grad.addColorStop(0, 'rgba(255,255,255,0.04)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  };

  /* ===========================================================
     Engine 2 — AirCrafter: Contact pressure hotspots + load paths
     =========================================================== */
  var aircrafter = {
    init: function (w, h) {
      var cx = w * 0.5, cy = h * 0.5;
      var rx = w * 0.26, ry = h * 0.36;

      // Hotspots
      var hotspots = [];
      for (var i = 0; i < 6; i++) {
        var a = Math.random() * 6.2832;
        var d = 0.15 + Math.random() * 0.5;
        hotspots.push({
          x: cx + Math.cos(a) * rx * d,
          y: cy + Math.sin(a) * ry * d,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          radius: 14 + Math.random() * 22,
          phase: Math.random() * 6.2832,
          intensity: 0.45 + Math.random() * 0.55
        });
      }

      // Grid nodes for repulsion
      var gs = 14;
      var grid = [];
      for (var y = 0; y < h + gs; y += gs) {
        for (var x = 0; x < w + gs; x += gs) {
          grid.push({ bx: x, by: y, x: x, y: y });
        }
      }

      // Load-path Bezier curves
      var paths = [];
      for (var i = 0; i < 3; i++) {
        var side = Math.random() > 0.5;
        paths.push({
          x0: side ? -10 : w * (0.2 + Math.random() * 0.6),
          y0: side ? h * (0.1 + Math.random() * 0.3) : -10,
          x1: cx + (Math.random() - 0.5) * rx * 0.8,
          y1: cy * 0.45 + Math.random() * cy * 0.2,
          x2: cx + (Math.random() - 0.5) * rx * 0.4,
          y2: cy + Math.random() * cy * 0.3,
          x3: w * (0.2 + Math.random() * 0.6),
          y3: h + 10,
          offset: Math.random()
        });
      }

      return { cx: cx, cy: cy, rx: rx, ry: ry, hotspots: hotspots, grid: grid, gs: gs, paths: paths };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      ctx.fillStyle = '#18101e';
      ctx.fillRect(0, 0, w, h);

      var cx = st.cx, cy = st.cy, rx = st.rx, ry = st.ry;
      var hs = st.hotspots, grid = st.grid;

      // Update hotspots
      for (var i = 0; i < hs.length; i++) {
        var h2 = hs[i];
        h2.x += h2.vx; h2.y += h2.vy;
        var dx = (h2.x - cx) / rx, dy = (h2.y - cy) / ry;
        if (dx * dx + dy * dy > 0.65) { h2.vx -= dx * 0.04; h2.vy -= dy * 0.04; }
        h2.vx *= 0.992; h2.vy *= 0.992;
      }

      // Contact zone ellipse + pressure rings
      var breathe = 1 + Math.sin(t * 1.1) * 0.025;
      for (var ring = 3; ring >= 0; ring--) {
        var rs = 0.3 + ring * 0.22;
        var ra = (Math.sin(t * 0.8 + ring * 0.6) + 1) * 0.08 + 0.04;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * rs * breathe, ry * rs * breathe, 0, 0, 6.2832);
        var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry) * rs * breathe);
        rg.addColorStop(0, 'rgba(255,80,30,' + (ra * 0.5) + ')');
        rg.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = rg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,100,50,' + (ra * 0.6) + ')';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Grid node repulsion
      for (var i = 0; i < grid.length; i++) {
        var gn = grid[i];
        var px = 0, py = 0;
        for (var j = 0; j < hs.length; j++) {
          var h2 = hs[j];
          var gdx = gn.bx - h2.x, gdy = gn.by - h2.y;
          var gd = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gd < h2.radius * 2.5 && gd > 0.5) {
            var f = (1 - gd / (h2.radius * 2.5)) * 5;
            px += (gdx / gd) * f; py += (gdy / gd) * f;
          }
        }
        gn.x = gn.bx + px; gn.y = gn.by + py;

        var inE = Math.pow((gn.bx - cx) / (rx * 1.1), 2) + Math.pow((gn.by - cy) / (ry * 1.1), 2);
        var na = inE < 1 ? 0.35 : 0.1;
        ctx.beginPath();
        ctx.arc(gn.x, gn.y, inE < 1 ? 1.3 : 0.8, 0, 6.2832);
        ctx.fillStyle = inE < 1 ? 'rgba(255,140,60,' + na + ')' : 'rgba(120,80,60,' + na + ')';
        ctx.fill();
      }

      // Hotspot glows
      for (var i = 0; i < hs.length; i++) {
        var h2 = hs[i];
        var pulse = 1 + Math.sin(t * 2 + h2.phase) * 0.15;
        var r = h2.radius * pulse;
        var g = ctx.createRadialGradient(h2.x, h2.y, 0, h2.x, h2.y, r);
        g.addColorStop(0, 'rgba(255,50,15,' + (h2.intensity * 0.55) + ')');
        g.addColorStop(0.4, 'rgba(255,110,40,' + (h2.intensity * 0.25) + ')');
        g.addColorStop(1, 'rgba(255,80,30,0)');
        ctx.beginPath(); ctx.arc(h2.x, h2.y, r, 0, 6.2832);
        ctx.fillStyle = g; ctx.fill();
      }

      // Load-path Bezier curves + traveling pulse dots
      for (var p = 0; p < st.paths.length; p++) {
        var path = st.paths[p];
        ctx.beginPath();
        ctx.moveTo(path.x0, path.y0);
        ctx.bezierCurveTo(path.x1, path.y1, path.x2, path.y2, path.x3, path.y3);
        ctx.strokeStyle = 'rgba(255,160,80,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Pulse dot
        var pt = ((t * 0.25 + path.offset) % 1);
        var it2 = 1 - pt;
        var px = it2*it2*it2*path.x0 + 3*it2*it2*pt*path.x1 + 3*it2*pt*pt*path.x2 + pt*pt*pt*path.x3;
        var py = it2*it2*it2*path.y0 + 3*it2*it2*pt*path.y1 + 3*it2*pt*pt*path.y2 + pt*pt*pt*path.y3;

        // Comet tail
        for (var ti = 6; ti >= 1; ti--) {
          var tt = Math.max(0, pt - ti * 0.018);
          var ti2 = 1 - tt;
          var tx = ti2*ti2*ti2*path.x0 + 3*ti2*ti2*tt*path.x1 + 3*ti2*tt*tt*path.x2 + tt*tt*tt*path.x3;
          var ty = ti2*ti2*ti2*path.y0 + 3*ti2*ti2*tt*path.y1 + 3*ti2*tt*tt*path.y2 + tt*tt*tt*path.y3;
          var fa = (1 - ti / 7) * 0.4;
          ctx.beginPath(); ctx.arc(tx, ty, 2 * (1 - ti / 7), 0, 6.2832);
          ctx.fillStyle = 'rgba(255,180,80,' + fa + ')'; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(px, py, 2.8, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,210,120,0.85)'; ctx.fill();
      }

      // Edge glow cascade
      var edgePhase = (t * 0.4) % 6.2832;
      for (var a = 0; a < 6.2832; a += 0.3) {
        var glow = Math.max(0, Math.cos(a - edgePhase)) * 0.12;
        if (glow < 0.01) continue;
        var ex = cx + Math.cos(a) * rx * breathe;
        var ey = cy + Math.sin(a) * ry * breathe;
        ctx.beginPath(); ctx.arc(ex, ey, 4, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,120,40,' + glow + ')'; ctx.fill();
      }
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
     Engine 4 — Finite-Elemented: Particle network + element formation
     =========================================================== */
  var finiteElemented = {
    init: function (w, h) {
      var count = Math.max(20, Math.min(55, Math.floor(w * h / 2200)));
      var particles = [];
      for (var i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
          size: 1.4 + Math.random() * 1.4,
          trail: []
        });
      }
      return {
        particles: particles,
        att: { x: w * 0.5, y: h * 0.5, phase: Math.random() * 6.2832 },
        connDist: 75,
        triDist: 60
      };
    },
    draw: function (ctx, st, w, h, ts) {
      var t = ts * 0.001;
      var p = st.particles, att = st.att;

      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, w, h);

      // Drifting attractor
      att.x = w * 0.5 + Math.sin(t * 0.28 + att.phase) * w * 0.28;
      att.y = h * 0.5 + Math.cos(t * 0.2 + att.phase * 1.3) * h * 0.22;

      // Update particles
      for (var i = 0; i < p.length; i++) {
        var pi = p[i];
        var dx = att.x - pi.x, dy = att.y - pi.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        pi.vx += (dx / dist) * 0.012;
        pi.vy += (dy / dist) * 0.012;
        pi.vx *= 0.994; pi.vy *= 0.994;
        pi.x += pi.vx; pi.y += pi.vy;

        if (pi.x < -15) pi.x = w + 15;
        if (pi.x > w + 15) pi.x = -15;
        if (pi.y < -15) pi.y = h + 15;
        if (pi.y > h + 15) pi.y = -15;

        pi.trail.push({ x: pi.x, y: pi.y });
        if (pi.trail.length > 7) pi.trail.shift();
      }

      // Connections
      var cd2 = st.connDist * st.connDist;
      for (var i = 0; i < p.length; i++) {
        for (var j = i + 1; j < p.length; j++) {
          var dx = p[i].x - p[j].x, dy = p[i].y - p[j].y;
          var d2 = dx * dx + dy * dy;
          if (d2 < cd2) {
            var a = (1 - d2 / cd2) * 0.28;
            ctx.beginPath();
            ctx.moveTo(p[i].x, p[i].y);
            ctx.lineTo(p[j].x, p[j].y);
            ctx.strokeStyle = 'rgba(24,169,168,' + a + ')';
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      // Triangle formation
      var td2 = st.triDist * st.triDist;
      for (var i = 0; i < p.length; i++) {
        for (var j = i + 1; j < p.length; j++) {
          var dij = (p[i].x - p[j].x) * (p[i].x - p[j].x) + (p[i].y - p[j].y) * (p[i].y - p[j].y);
          if (dij > td2) continue;
          for (var k = j + 1; k < p.length; k++) {
            var dik = (p[i].x - p[k].x) * (p[i].x - p[k].x) + (p[i].y - p[k].y) * (p[i].y - p[k].y);
            if (dik > td2) continue;
            var djk = (p[j].x - p[k].x) * (p[j].x - p[k].x) + (p[j].y - p[k].y) * (p[j].y - p[k].y);
            if (djk > td2) continue;
            var maxD = Math.max(dij, dik, djk);
            ctx.beginPath();
            ctx.moveTo(p[i].x, p[i].y);
            ctx.lineTo(p[j].x, p[j].y);
            ctx.lineTo(p[k].x, p[k].y);
            ctx.closePath();
            ctx.fillStyle = 'rgba(99,102,241,' + ((1 - maxD / td2) * 0.07) + ')';
            ctx.fill();
          }
        }
      }

      // Draw particles + trails
      for (var i = 0; i < p.length; i++) {
        var pi = p[i];
        for (var ti = 0; ti < pi.trail.length; ti++) {
          var tp = pi.trail[ti];
          var f = ti / pi.trail.length;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, pi.size * f * 0.5, 0, 6.2832);
          ctx.fillStyle = 'rgba(24,169,168,' + (f * 0.2) + ')';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(pi.x, pi.y, pi.size, 0, 6.2832);
        ctx.fillStyle = 'rgba(24,169,168,0.82)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pi.x, pi.y, pi.size * 2.5, 0, 6.2832);
        ctx.fillStyle = 'rgba(99,102,241,0.06)';
        ctx.fill();
      }

      // Attractor glow
      var ag = ctx.createRadialGradient(att.x, att.y, 0, att.x, att.y, 30);
      ag.addColorStop(0, 'rgba(99,102,241,0.06)');
      ag.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(att.x, att.y, 30, 0, 6.2832); ctx.fill();
    }
  };

  /* ===========================================================
     Controller: DPR-aware sizing, hover-gated rAF loop
     =========================================================== */
  var engines = {
    'asphera': asphera,
    'aircrafter': aircrafter,
    'frontier': frontier,
    'finite-elemented': finiteElemented
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
