// 3D viewer. Scene units are millimetres. Renders on demand: a frame is drawn only while the
// camera is easing, something is animating, or the scene has changed.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildBike } from './geo/bike.js';

const QUALITY = {
  balanced: { hq: 1.25, shadow: 1024 },
  high: { hq: 2, shadow: 2048 },
  ultra: { hq: 3, shadow: 4096 },
};
// Exploded view: where each slot goes, in millimetres at full explosion.
const EXPLODE = {
  frameset: [0, 0, 0], wheels: [0, 0, 0], tires: [0, 0, 0], tubes: [0, 0, 0],
  crankset: [0, -60, 260], bottom_bracket: [0, -60, 120], pedals: [0, -60, 400], chain: [-40, -160, 330], cassette: [-120, 0, 330],
  rear_derailleur: [-200, -120, 300], front_derailleur: [-60, 140, 260], shifters: [200, 120, 0], cables: [0, 200, -260],
  brakes: [0, 150, 0], brake_pads: [0, 150, -160], stem: [60, 220, 0], handlebar: [200, 260, 0], tape: [260, 330, 0], aerobar: [330, 420, 0],
  seatpost: [-60, 200, 0], saddle: [-90, 330, 0], cages: [0, 0, -330], light: [420, 60, 0], computer: [420, 220, 0], rear_light: [-330, 120, 0],
};
const WHEEL_SPLIT = 520; // front and rear wheels move apart along X

export function createViewer(canvas, labelLayer, geometry, { onPick = () => {}, onHover = () => {} } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, 0.03);
  scene.environment = env.texture; scene.environmentIntensity = 0.85; room.dispose(); pmrem.dispose();
  const camera = new T.PerspectiveCamera(28, 1, 10, 60000);

  const key = new T.DirectionalLight(0xffffff, 2.6); key.position.set(900, 2300, 1500); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -1300, right: 1300, top: 1400, bottom: -600, near: 200, far: 6000 });
  key.shadow.bias = -0.0002; key.shadow.normalBias = 1.2; key.shadow.radius = 5;
  key.target.position.set(100, 400, 0);
  const fill = new T.DirectionalLight(0xcfe0ff, 0.7); fill.position.set(-1500, 700, -1200);
  const rim = new T.DirectionalLight(0xffffff, 1.1); rim.position.set(-700, 1400, -1800);
  scene.add(key, key.target, fill, rim, new T.HemisphereLight(0xffffff, 0x8a8f96, 0.5));

  // floor: a soft disc that fades into the background, plus a shadow catcher
  const floorTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    const g = x.createRadialGradient(256, 256, 0, 256, 256, 256); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512); return new T.CanvasTexture(c);
  })();
  const floor = new T.Mesh(new T.CircleGeometry(4200, 96), new T.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false, color: 0xffffff }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5;
  const catcher = new T.Mesh(new T.PlaneGeometry(12000, 12000), new T.ShadowMaterial({ opacity: 0.24 }));
  catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; catcher.position.y = -0.5;
  scene.add(floor, catcher);

  const overlay = new T.Group(); scene.add(overlay);       // dimensions
  const custom = new T.Group(); scene.add(custom);         // CAD, wind tunnel and Abaqus scenes (labs.js)
  let animator = null, customPick = null, customFit = null;
  const feGroup = new T.Group(); scene.add(feGroup);       // beam model
  let bike = null, lift = 0, theme = 'light', mode = 'studio', quality = 'high';
  let explodeGoal = 0, explodeNow = 0, isolated = null, selected = null, hovered = null;
  const hl = { sel: [], hov: [] };
  const hlMat = { sel: new T.MeshBasicMaterial({ color: 0x18a9a8, transparent: true, opacity: 0.34, depthTest: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    hov: new T.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.2, depthTest: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }) };
  const clay = new T.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.62, metalness: 0.02 });
  const edgeMat = new T.LineBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.5 });
  let edges = null;

  // ---- camera: `st` is the goal set by input; `cur` eases toward it -----------------------------
  const st = { tgt: new T.Vector3(80, 480, 0), r: 3300, th: 0.95, ph: 1.32 };
  const cur = { tgt: st.tgt.clone(), r: st.r, th: st.th, ph: st.ph }, spinV = { th: 0, ph: 0 };
  const clampPh = (v) => Math.min(Math.PI * 0.497, Math.max(0.06, v));
  let frame = 0, last = 0, dragging = false, slow = false, slowN = 0, refresh = 1, turntable = false, pedalling = false, crankDeg = 0, dirty = true;
  const HQ = () => Math.min(QUALITY[quality].hq, Math.max(1, devicePixelRatio * (quality === 'balanced' ? 1 : 1.5)));
  const LQ = () => Math.max(1, Math.min(devicePixelRatio, 1.5));
  const draw = () => { dirty = true; if (!frame) frame = requestAnimationFrame(tick); };

  const pointers = new Map(); let pinch = null, downAt = null;
  const ndc = (e) => { const r = canvas.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  function pan(dx, dy) {
    const k = cur.r * 0.00105, right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0), upv = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
    st.tgt.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, t: performance.now() });
    downAt = { x: e.clientX, y: e.clientY, moved: false };
    dragging = true; spinV.th = spinV.ph = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y, now = performance.now(), s = Math.max(1, now - p.t) / 1000;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) downAt.moved = true;
    p.x = e.clientX; p.y = e.clientY; p.t = now;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      st.r *= pinch.d / Math.max(d, 1); pan(mx - pinch.mx, my - pinch.my); pinch = { d, mx, my };
    } else if (p.b === 2 || p.b === 1 || p.shift) pan(dx, dy);
    else {
      st.th -= dx * 0.0055; st.ph = clampPh(st.ph - dy * 0.0055);
      spinV.th = 0.6 * spinV.th + 0.4 * ((-dx * 0.0055) / s); spinV.ph = 0.6 * spinV.ph + 0.4 * ((-dy * 0.0055) / s);
    }
    st.r = Math.min(9000, Math.max(160, st.r));
    draw();
  });
  const release = (e) => {
    const p = pointers.get(e.pointerId); pointers.delete(e.pointerId);
    if (p && downAt && !downAt.moved && e.type === 'pointerup' && p.b === 0) click(e);
    if (!p || p.b !== 0 || p.shift || performance.now() - p.t > 90) spinV.th = spinV.ph = 0;
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) dragging = false;
    draw();
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) setHover(null); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0012)));
    const ray = new T.Raycaster(), at = new T.Vector3(); ray.setFromCamera(ndc(e), camera);
    if (ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new T.Vector3()), st.tgt), at)) st.tgt.lerp(at, 1 - f);
    st.r = Math.min(9000, Math.max(160, st.r * f)); draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => fit());
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') st.th += 0.14; else if (k === 'ArrowRight') st.th -= 0.14;
    else if (k === 'ArrowUp') st.ph = clampPh(st.ph - 0.1); else if (k === 'ArrowDown') st.ph = clampPh(st.ph + 0.1);
    else if (k === '+' || k === '=') st.r *= 0.88; else if (k === '-') st.r *= 1.14;
    else if (k === 'Home' || k === '0') fit(); else if (k === 'Escape') { select(null); onPick(null); } else return;
    e.preventDefault(); draw();
  });

  // ---- picking ---------------------------------------------------------------------------------
  const ray = new T.Raycaster();
  function hit(e) {
    if (mode === 'custom') {
      if (!customPick) return null;
      ray.setFromCamera(ndc(e), camera);
      const h = ray.intersectObject(custom, true).find((x) => visibleChain(x.object) && x.object.userData.pick);
      return h ? { custom: h.object.userData.pick, point: h.point, slot: null } : null;
    }
    if (!bike || !bike.visible) return null;
    ray.setFromCamera(ndc(e), camera);
    const h = ray.intersectObject(bike, true).find((x) => visibleChain(x.object));
    if (!h) return null;
    let o = h.object; const part = o.userData.part;
    while (o && !o.userData.slot) o = o.parent;
    return o ? { slot: o.userData.slot, part, point: h.point } : null;
  }
  const visibleChain = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  let hoverRaf = 0, hoverEvt = null;
  function hover(e) { hoverEvt = e; if (hoverRaf) return; hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; const h = hit(hoverEvt); if (mode !== 'custom') setHover(h ? h.slot : null); else customPick?.(h?.custom ?? null, 'hover'); canvas.style.cursor = h ? 'pointer' : 'grab'; onHover(h, hoverEvt); }); }
  function click(e) { const h = hit(e); if (mode === 'custom') { customPick?.(h?.custom ?? null, 'click'); return; } select(h ? h.slot : null); onPick(h ? h.slot : null, h ? h.part : null); }
  function meshesOf(slot) { const out = []; if (!bike) return out; for (const h of bike.userData.holders) if (h.userData.slot === slot) h.traverse((o) => { if (o.isMesh && !o.userData.hl) out.push(o); }); return out; }
  function paint(kind, slot) {
    for (const o of hl[kind]) o.parent?.remove(o);
    hl[kind] = [];
    if (!slot || mode === 'fe') return;
    for (const m of meshesOf(slot)) {
      const o = m.isInstancedMesh ? new T.InstancedMesh(m.geometry, hlMat[kind], m.count) : new T.Mesh(m.geometry, hlMat[kind]);
      if (m.isInstancedMesh) o.instanceMatrix = m.instanceMatrix;
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      o.userData.hl = true; o.raycast = () => {}; o.renderOrder = 5; o.frustumCulled = false;
      // a holder mesh is highlighted beside itself; a child of a pivot inside that pivot
      (m.parent).add(o); hl[kind].push(o);
    }
  }
  function setHover(slot) { if (slot === hovered) return; hovered = slot; paint('hov', slot && slot !== selected ? slot : null); draw(); }
  function select(slot) { selected = slot; paint('sel', slot); paint('hov', null); applyVisibility(); draw(); }

  // ---- build / state ---------------------------------------------------------------------------
  function disposeTree(obj) {
    const geos = new Set(), mats = new Set(), tex = new Set();
    obj.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) for (const m of [].concat(o.material)) { if (Object.values(hlMat).includes(m) || m === clay) continue; mats.add(m); for (const k of ['map', 'bumpMap', 'roughnessMap']) if (m[k]) tex.add(m[k]); } });
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); tex.forEach((t) => t.dispose());
  }
  function setConfig(cfg, catalog, params) {
    paint('sel', null); paint('hov', null);
    if (bike) { scene.remove(bike); (bike.userData.materials.textures || []).forEach((t) => t.dispose()); Object.values(bike.userData.materials).forEach((m) => m?.isMaterial && m.dispose()); disposeTree(bike); }
    if (edges) { scene.remove(edges); edges.traverse((o) => o.geometry?.dispose()); edges = null; }
    bike = buildBike(geometry, cfg, catalog, params);
    lift = -bike.userData.groundY; bike.position.y = lift;
    crankDeg = params.crank_deg ?? 20;
    scene.add(bike);
    for (const h of bike.userData.holders) h.userData.offset = new T.Vector3();
    applyExplode(explodeNow, true); applyMode(); applyVisibility(); paint('sel', selected);
    buildDimensions();
    draw();
    return bike.userData;
  }
  function applyExplode(v, force) {
    if (!bike || (!force && v === explodeNow)) return;
    explodeNow = v;
    for (const h of bike.userData.holders) {
      const d = EXPLODE[h.userData.slot] || [0, 0, 0];
      let x = d[0], y = d[1], z = d[2];
      if (h.userData.slot === 'wheels' || h.userData.slot === 'tires') x += (h.userData.base.x > 100 || h.userData.steer ? 1 : -1) * WHEEL_SPLIT * (h.userData.slot === 'tires' ? 1.35 : 1);
      if (h.userData.slot === 'brakes' || h.userData.slot === 'brake_pads') x += (h.userData.steer ? 1 : -1) * 150;
      h.userData.offset.set(x * v, y * v, z * v);
      h.position.copy(h.userData.base).add(h.userData.offset);
    }
    if (hl.sel.length) paint('sel', selected);
  }
  function applyVisibility() {
    if (!bike) return;
    for (const h of bike.userData.holders) h.visible = !isolated || h.userData.slot === isolated;
  }
  function applyMode() {
    if (!bike) return;
    const tech = mode === 'technical';
    scene.overrideMaterial = null;
    bike.traverse((o) => { if (o.isMesh && !o.userData.hl) { if (tech) { o.userData.mat ??= o.material; o.material = clay; } else if (o.userData.mat) { o.material = o.userData.mat; delete o.userData.mat; } } });
    if (tech && !edges) {
      edges = new T.Group(); bike.updateMatrixWorld(true);
      bike.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || o.userData.hl) return; const l = new T.LineSegments(new T.EdgesGeometry(o.geometry, 32), edgeMat); l.userData.src = o; l.matrixAutoUpdate = false; edges.add(l); });
      scene.add(edges);
    }
    if (edges) edges.visible = tech;
    bike.visible = mode !== 'fe' && mode !== 'custom'; feGroup.visible = mode === 'fe'; custom.visible = mode === 'custom';
    catcher.material.opacity = mode === 'fe' ? 0.08 : theme === 'dark' ? 0.5 : 0.24;
    applyTheme();
  }
  function syncEdges() { if (!edges || !edges.visible) return; bike.updateMatrixWorld(true); for (const l of edges.children) { l.matrix.copy(l.userData.src.matrixWorld); l.matrixWorld.copy(l.matrix); l.visible = visibleChain(l.userData.src); } }
  function applyTheme() {
    const dark = theme === 'dark', tech = mode === 'technical' || mode === 'fe';
    scene.background = new T.Color(dark ? (tech ? 0x15181c : 0x101317) : (tech ? 0xf4f5f7 : 0xe9ecf0));
    floor.material.color.set(dark ? 0x2a3038 : 0xffffff); floor.material.opacity = dark ? 0.55 : 1;
    edgeMat.color.set(dark ? 0x0a0c0f : 0x1b1f24);
    clay.color.set(dark ? 0xaab1ba : 0xd9dde2);
    dimMat.color.set(dark ? 0x22d3d1 : 0x0f8281);
    draw();
  }

  // ---- dimensions (3D lines, HTML labels) --------------------------------------------------------
  const dimMat = new T.LineBasicMaterial({ color: 0x0f8281, depthTest: false, transparent: true });
  let labels = [], dimsOn = false;
  function clearLabels() { labels.forEach((l) => l.el.remove()); labels = []; }
  function addLabel(pos, text, cls = '') { const el = document.createElement('div'); el.className = 'vlabel ' + cls; el.textContent = text; labelLayer.appendChild(el); labels.push({ el, pos }); }
  function dim(a, b, text, off = [0, 0, 0]) {
    const A = new T.Vector3(...a).add(new T.Vector3(...off)), Bv = new T.Vector3(...b).add(new T.Vector3(...off));
    const pts = [A, Bv, new T.Vector3(...a), A, new T.Vector3(...b), Bv];
    const l = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), dimMat); l.renderOrder = 10; overlay.add(l);
    addLabel(A.clone().add(Bv).multiplyScalar(0.5), text);
  }
  function buildDimensions() {
    overlay.traverse((o) => o.geometry?.dispose()); overlay.clear(); clearLabels();
    overlay.visible = dimsOn; if (!dimsOn || !bike) return;
    const u = bike.userData, hp = u.hp, d = u.derived, g = geometry, y0 = u.groundY, z = 0;
    overlay.position.y = lift;
    dim([hp.ra.x, y0, z], [hp.fa.x, y0, z], `Wheelbase ${d.wheelbase_mm.toFixed(0)}`, [0, -70, 0]);
    dim([0, 0, z], [0, hp.ht.y, z], `Stack ${g.stack_mm}`, [hp.fa.x + 330, 0, 0]);
    dim([0, hp.ht.y, z], [hp.ht.x, hp.ht.y, z], `Reach ${g.reach_mm}`, [0, 120, 0]);
    dim([hp.ra.x, hp.ra.y, z], [0, 0, z], `Chainstay ${g.chainstay_mm}`, [0, -150, 0]);
    dim([0, y0, z], [0, 0, z], `BB height ${d.bb_height_mm.toFixed(0)}`, [-120, 0, 0]);
    const gx = hp.fa.x - d.trail_mm;
    dim([hp.fa.x, y0, z], [gx + 2 * d.trail_mm, y0, z], `Trail ${d.trail_mm.toFixed(0)}`, [0, -140, 0]);
    dim([u.fit.saddle[0], u.fit.saddle[1], z], [u.fit.bar[0], u.fit.saddle[1], z], `Saddle to bar ${u.fit.saddle_to_bar_reach_mm.toFixed(0)}`, [0, 150, 0]);
    dim([u.fit.bar[0], u.fit.bar[1], z], [u.fit.bar[0], u.fit.saddle[1], z], `Drop ${u.fit.saddle_to_bar_drop_mm.toFixed(0)}`, [260, 0, 0]);
    // steering axis to the ground
    const ax = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(hp.ht.x, hp.ht.y, 0), new T.Vector3(hp.fa.x + d.trail_mm, y0, 0)]), new T.LineDashedMaterial({ color: dimMat.color, dashSize: 14, gapSize: 9, depthTest: false }));
    ax.computeLineDistances(); ax.renderOrder = 10; overlay.add(ax);
  }
  const v3 = new T.Vector3();
  function placeLabels() {
    if (!labels.length) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of labels) {
      v3.copy(l.pos); if (!l.world) v3.y += lift; v3.project(camera);
      const on = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      l.el.style.display = on ? '' : 'none';
      if (on) l.el.style.transform = `translate(-50%,-50%) translate(${((v3.x + 1) / 2) * w}px,${((1 - v3.y) / 2) * h}px)`;
    }
  }

  // ---- finite-element overlay ------------------------------------------------------------------
  const ramp = [[0.19, 0.28, 0.6], [0.16, 0.55, 0.72], [0.2, 0.72, 0.62], [0.62, 0.82, 0.38], [0.97, 0.78, 0.25], [0.93, 0.45, 0.17], [0.78, 0.14, 0.14]];
  const colorAt = (t) => { t = Math.min(1, Math.max(0, t)) * (ramp.length - 1); const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i; return new T.Color(ramp[i][0] + (ramp[i + 1][0] - ramp[i][0]) * f, ramp[i][1] + (ramp[i + 1][1] - ramp[i][1]) * f, ramp[i][2] + (ramp[i + 1][2] - ramp[i][2]) * f); };
  function showFE({ model, result, scale = 20, vmax = null, field = 'vm' }) {
    feGroup.traverse((o) => { o.geometry?.dispose(); if (o.material && o.material !== feLine) o.material.dispose?.(); }); feGroup.clear();
    labels = labels.filter((l) => { if (l.fe) { l.el.remove(); return false; } return true; });
    feGroup.position.y = lift;
    const P = (i, s) => new T.Vector3(model.nodes[i][0] + result.u[i * 6] * s, model.nodes[i][1] + result.u[i * 6 + 1] * s, model.nodes[i][2] + result.u[i * 6 + 2] * s);
    const ghost = [];
    const peak = vmax ?? result.peak, skip = new Set(['rear_axle', 'front_axle', 'fork_crown', 'bb_shell']);
    model.elements.forEach((e, k) => {
      ghost.push(P(e.n1, 0), P(e.n2, 0));
      const a = P(e.n1, scale), b = P(e.n2, scale), r = result.results[k];
      const rad_ = skip.has(e.member) ? 5 : Math.max(5, Math.min(26, (e.sec.cy + e.sec.cz) / 2));
      const geo = new T.CylinderGeometry(rad_, rad_, a.distanceTo(b), 14, 1, true);
      geo.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize())); geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const val = field === 'axial' ? Math.abs(r.axial) : r.vm;
      const mat = new T.MeshStandardMaterial({ color: skip.has(e.member) ? new T.Color(0x9aa3ad) : colorAt(val / peak), roughness: 0.5, metalness: 0.05 });
      const m = new T.Mesh(geo, mat); m.castShadow = true; feGroup.add(m);
      const j = new T.Mesh(new T.SphereGeometry(rad_, 12, 8), mat); j.position.copy(b); feGroup.add(j);
    });
    feGroup.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(ghost), feLine));
    // loads (arrows) and supports (markers)
    const span = 170;
    const fmax = Math.max(...result.loadList.filter((l) => l[1] < 3).map((l) => Math.abs(l[2])), 1);
    for (const [n, d, v] of result.loadList) {
      if (d > 2) continue;
      const dir = new T.Vector3(d === 0 ? Math.sign(v) : 0, d === 1 ? Math.sign(v) : 0, d === 2 ? Math.sign(v) : 0), len = 70 + span * Math.abs(v) / fmax, tip = P(n, scale);
      feGroup.add(new T.ArrowHelper(dir, tip.clone().addScaledVector(dir, -len - 28), len, theme === 'dark' ? 0xffffff : 0x111418, 34, 18));
      const el = document.createElement('div'); el.className = 'vlabel load'; el.textContent = `${Math.abs(v).toFixed(0)} N`; labelLayer.appendChild(el);
      labels.push({ el, pos: tip.clone().addScaledVector(dir, -len - 60), fe: true });
    }
    const seen = new Set();
    for (const [n] of result.fixedList) {
      if (seen.has(n)) continue; seen.add(n);
      const c = new T.Mesh(new T.ConeGeometry(26, 46, 4), new T.MeshStandardMaterial({ color: 0x18a9a8, roughness: 0.5 }));
      c.position.copy(P(n, scale)).add(new T.Vector3(0, -34, 0)); feGroup.add(c);
    }
    draw();
  }
  const feLine = new T.LineBasicMaterial({ color: 0x8b95a1, transparent: true, opacity: 0.55 });
  function clearFE() { labels = labels.filter((l) => { if (l.fe) { l.el.remove(); return false; } return true; }); }

  // ---- camera presets --------------------------------------------------------------------------
  const PRESETS = { quarter: [0.95, 1.32], drive: [Math.PI / 2, 1.5], nondrive: [-Math.PI / 2, 1.5], front: [0, 1.45], rear: [Math.PI, 1.45], top: [Math.PI / 2, 0.07], low: [0.75, 1.52] };
  function fit(pad = 1) {
    const box = new T.Box3();
    const src = mode === 'fe' ? feGroup : mode === 'custom' ? (customFit || custom) : bike;
    if (!src) return;
    src.updateMatrixWorld(true);
    if (isolated && mode === 'studio') { for (const h of bike.userData.holders) if (h.visible) box.expandByObject(h); } else box.setFromObject(src);
    if (box.isEmpty()) return;
    box.getCenter(st.tgt);
    const size = box.getSize(new T.Vector3()), asp = camera.aspect || 1.5;
    const fovV = (camera.fov * Math.PI) / 180, fovH = 2 * Math.atan(Math.tan(fovV / 2) * asp);
    const rad_ = size.length() / 2;
    st.r = (rad_ / Math.sin(Math.min(fovV, fovH) / 2)) * 0.9 * pad;
    draw();
  }
  function preset(name) { const p = PRESETS[name]; if (!p) return; let d = p[0] - st.th; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; st.th += d; st.ph = p[1]; spinV.th = spinV.ph = 0; fit(); }
  function focus(slot) {
    if (!bike) return; const box = new T.Box3(); bike.updateMatrixWorld(true);
    for (const h of bike.userData.holders) if (h.userData.slot === slot) box.expandByObject(h);
    if (box.isEmpty()) return; box.getCenter(st.tgt);
    st.r = Math.max(420, box.getSize(new T.Vector3()).length() * 2.3); draw();
  }

  // ---- frame loop ------------------------------------------------------------------------------
  function tick(now) {
    frame = 0;
    const real = last > 0, dt = Math.min(0.05, real ? (now - last) / 1000 : 1 / 60); last = now;
    if (!dragging && Math.abs(spinV.th) + Math.abs(spinV.ph) > 1e-4) { st.th += spinV.th * dt; st.ph = clampPh(st.ph + spinV.ph * dt); const d = Math.exp(-dt * 4.5); spinV.th *= d; spinV.ph *= d; }
    if (turntable && !dragging) st.th += dt * 0.32;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 14);
    cur.th += (st.th - cur.th) * k; cur.ph += (st.ph - cur.ph) * k; cur.r *= Math.exp((Math.log(st.r) - Math.log(cur.r)) * k); cur.tgt.lerp(st.tgt, k);
    let anim = false;
    if (Math.abs(explodeGoal - explodeNow) > 1e-3) { applyExplode(reduced ? explodeGoal : explodeNow + (explodeGoal - explodeNow) * (1 - Math.exp(-dt * 7))); anim = true; } else if (explodeNow !== explodeGoal) applyExplode(explodeGoal);
    if (pedalling && bike && mode === 'studio') { crankDeg = (crankDeg + dt * 75) % 720000; bike.userData.setCrank(crankDeg); anim = true; }
    if (animator && mode === 'custom' && !reduced) anim = animator(dt, now / 1000) !== false || anim;
    const moving = dragging || turntable || anim || Math.abs(st.th - cur.th) > 1e-4 || Math.abs(st.ph - cur.ph) > 1e-4 || Math.abs(st.r / cur.r - 1) > 1e-4 || cur.tgt.distanceTo(st.tgt) > cur.r * 1e-5 || Math.abs(spinV.th) + Math.abs(spinV.ph) > 1e-4;
    if (real && dt > 0.004) refresh = Math.min(refresh, dt);
    if (moving && real && dt > refresh * 1.6 && ++slowN > 5) slow = true;
    if (!moving) { cur.th = st.th; cur.ph = st.ph; cur.r = st.r; cur.tgt.copy(st.tgt); slowN = 0; }
    settled = !moving;
    const want = moving && slow ? LQ() : HQ();
    if (Math.abs(renderer.getPixelRatio() - want) > 0.01) { renderer.setPixelRatio(want); renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); }
    render();
    dirty = false;
    if (moving) draw(); else { last = 0; }
  }
  // Ambient occlusion is applied only to settled frames: interaction stays fast, the still image gets contact shading.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 60, distanceExponent: 1.4, thickness: 25, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  let aoOn = true, settled = false;
  function render() {
    if (!canvas.clientWidth || !canvas.clientHeight) return; // the stage is hidden on page tabs
    const sp = Math.sin(cur.ph);
    camera.position.set(cur.tgt.x + cur.r * sp * Math.cos(cur.th), cur.tgt.y + cur.r * Math.cos(cur.ph), cur.tgt.z + cur.r * sp * Math.sin(cur.th));
    camera.near = Math.max(5, cur.r / 60); camera.far = cur.r * 14 + 9000; camera.updateProjectionMatrix();
    camera.lookAt(cur.tgt); camera.updateMatrixWorld();
    syncEdges();
    if (aoOn && settled && quality !== 'balanced') {
      const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr); composer.setSize(w, h);
      composer.render();
    } else renderer.render(scene, camera);
    placeLabels();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 38 : 28; camera.updateProjectionMatrix(); draw();
  }
  new ResizeObserver(resize).observe(canvas);

  function setQuality(q) {
    quality = QUALITY[q] ? q : 'high';
    const s = Math.min(QUALITY[quality].shadow, renderer.capabilities.maxTextureSize);
    key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; slow = false; slowN = 0; draw();
  }
  function png(width = 3840) {
    const w = canvas.clientWidth, h = canvas.clientHeight, was = renderer.getPixelRatio();
    const pr = Math.max(1, Math.min(width / w, (renderer.capabilities.maxTextureSize - 64) / Math.max(w, h)));
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); render();
    const url = canvas.toDataURL('image/png');
    renderer.setPixelRatio(was); renderer.setSize(w, h, false); render();
    return url;
  }
  setQuality('high'); resize();

  return {
    setConfig, fit, preset, focus, select, png, setQuality, showFE, clearFE,
    explode(v) { explodeGoal = Math.min(1, Math.max(0, v)); draw(); },
    isolate(slot) { isolated = slot || null; applyVisibility(); if (isolated) fit(1.25); else fit(); },
    setMode(m) { mode = m; if (m !== 'fe') clearFE(); paint('sel', selected); applyMode(); draw(); },
    setTheme(t) { theme = t; applyMode(); },
    dimensions(on) { dimsOn = on; buildDimensions(); draw(); },
    turntable(on) { turntable = on && !reduced; draw(); },
    pedal(on) { pedalling = on && !reduced; draw(); },
    setCrank(deg) { crankDeg = deg; bike?.userData.setCrank(deg); draw(); },
    get info() { return bike?.userData; },
    get lift() { return lift; },
    /** Show a custom scene (CAD, wind tunnel, Abaqus) instead of the bike. animate(dt, t) keeps frames coming. */
    setCustom(obj, { animate = null, pick = null, fitTo = null } = {}) {
      for (const c of [...custom.children]) { custom.remove(c); }
      if (obj) { obj.position.y = lift; custom.add(obj); }
      animator = animate; customPick = pick; customFit = fitTo;
      draw();
    },
    setAO(on) { aoOn = on; draw(); },
    get state() { return { th: st.th, ph: st.ph, r: st.r }; },
    camera: (th, ph, r, tgt) => { st.th = th; st.ph = ph; if (r) st.r = r; if (tgt) st.tgt.set(...tgt); cur.th = st.th; cur.ph = st.ph; cur.r = st.r; cur.tgt.copy(st.tgt); draw(); },
    redraw: draw,
  };
}
