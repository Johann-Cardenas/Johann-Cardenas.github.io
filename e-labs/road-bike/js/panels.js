// Side panels for the result scenes: CAD, Aero (wind tunnel) and Structure (Abaqus / live beam).
// Words are kept to labels and numbers; explanations live in title tooltips.
import { S, esc, fmt, status } from './app.js';
import { rampCSS } from './labs.js';
import { setup, evaluate, POSITIONS } from './model/perf.js';

export const L = { cad: null, aero: null, fe: null, sw: null, aeroCase: 'yaw00_dx8', aeroMissing: false, structMode: 'shell', feCase: 'pedalling', feMode: -1,
  show: { surface: true, particles: true, lines: true, side: false, plan: false, wake: false }, field: 'speed', group: null, part: null, clay: false, edges: true, explode: 0, scale: 25, playing: true };

const kpi = (label, value, sub = '', cls = '', tip = '') => `<div class="kpi ${cls}" ${tip ? `title="${esc(tip)}"` : ''}><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const chip = (attr, on, label, tip = '') => `<button ${attr} aria-pressed="${on}" ${tip ? `title="${esc(tip)}"` : ''}>${label}</button>`;
const legend = (name, lo, hi, unit) => `<div class="ramp" style="background:${rampCSS(name)}"></div><div class="rampl"><span>${lo}</span><span>${unit}</span><span>${hi}</span></div>`;

// ---- CAD -----------------------------------------------------------------------------------------
export function cadPanel() {
  const c = L.cad;
  if (!c) return '<div class="pending"><span class="rb-spin"></span>Loading CAD…</div>';
  const sw = L.sw?.parts ?? [], swOf = new Map(sw.map((r) => [r.name, r]));
  const tris = c.doc.parts.reduce((n, p) => n + p.idx[1] / 3, 0);
  const worst = sw.length ? Math.max(...sw.map((r) => Math.abs(r.volume_rel))) * 100 : null;
  const bySlot = {};
  for (const p of c.doc.parts) (bySlot[p.slot] ||= []).push(p);
  const sel = L.part, sr = sel && swOf.get(sel.name);
  return `
  <div class="sec"><div class="kpis three">
    ${kpi('Parts', c.doc.parts.length, 'SLDPRT')}
    ${kpi('SolidWorks', sw.length ? `${sw.length}/${c.doc.parts.length}` : '—', worst == null ? '' : `max ΔV ${worst.toFixed(1)} %`, 'good', 'Every part was imported into SolidWorks 2026 and its volume and centroid checked against the CadQuery source.')}
    ${kpi('Triangles', `${Math.round(tris / 1000)}k`, 'web mesh')}
  </div></div>
  <div class="sec"><h2>View</h2>
    <div class="row"><label for="cadx">Explode</label><input id="cadx" type="range" data-cad="explode" min="0" max="1" step="0.01" value="${L.explode}"><span class="val">${Math.round(L.explode * 100)} %</span></div>
    <div class="chips" style="margin-top:6px">${chip('data-cadt="clay"', L.clay, 'Clay')}${chip('data-cadt="edges"', L.edges, 'Edges')}<button data-cadt="replay">Assemble ▸</button></div>
  </div>
  ${sel ? `<div class="sec"><h2>${esc(sel.name.replaceAll('_', ' '))}<em>${esc(sel.slot)}</em></h2><div class="kpis">
    ${kpi('Volume', `${sel.volume_cm3.toLocaleString('en-US')} cm³`)}
    ${kpi('Centroid', sel.centroid.map((v) => Math.round(v)).join(', '), 'mm from BB')}
    ${sr ? kpi('SolidWorks ΔV', `${(sr.volume_rel * 100).toFixed(2)} %`, `ΔCG ${sr.centroid_dmm.toFixed(2)} mm`, Math.abs(sr.volume_rel) < 0.02 ? 'good' : '') : ''}
    ${kpi('Wind tunnel', sel.aero ? 'in' : 'out', sel.aero ? '' : 'omitted')}
  </div></div>` : ''}
  <div class="sec"><h2>Parts</h2><div class="plist">${Object.entries(bySlot).map(([slot, ps]) => ps.map((p) =>
    `<button data-cadp="${esc(p.name)}" class="${sel === p ? 'on' : ''}"><span>${esc(p.name.replaceAll('_', ' '))}</span><small>${p.volume_cm3} cm³</small></button>`).join('')).join('')}</div>
    <p class="foot" title="cad/bike_cad.py builds the B-rep with CadQuery from data/geometry.json; cad/solidworks_build.py imports each STEP into SolidWorks, checks volume and centroid, and assembles synapse.SLDASM.">CadQuery → STEP → SolidWorks 2026 · <abbr>how</abbr></p></div>`;
}

// ---- Aero ----------------------------------------------------------------------------------------
export function aeroPanel() {
  if (L.aeroMissing) return `<div class="pending"><span class="rb-spin"></span><b>Wind tunnel running</b><span class="small muted">Results appear here when the solver finishes.</span></div>`;
  const a = L.aero;
  if (!a) return '<div class="pending"><span class="rb-spin"></span>Loading wind tunnel…</div>';
  const s = a.cfd.summary, d = s.drag_by_group_N, max = Math.max(...Object.values(d));
  const order = Object.entries(d).sort((x, y) => y[1] - x[1]);
  const P = S.P, su = setup(S.catalog.default_config, S.catalog, P), ev = evaluate(su, P);
  const bikeShare = s.CdA_m2 / POSITIONS[P.position === 'aero' ? 'drops' : P.position].cda;
  const v = a.cfd.validation;
  return `
  <div class="sec"><div class="kpis">
    ${kpi('CdA, bike', `${s.CdA_m2.toFixed(3)} m²`, 'no rider', 'big', 'Drag area of the bike alone at 0° yaw. See the footnote on accuracy.')}
    ${kpi('Drag', `${s.drag_N.toFixed(1)} N`, '40 km/h', 'big')}
    ${kpi('Power', `${Math.round(s.power_W_at_40kmh)} W`, 'to push the bike', '', 'Drag × speed at 40 km/h. Reads high with the drag; see the accuracy note.')}
    ${kpi('Of total drag', `${Math.round(bikeShare * 100)} %`, `with a rider on the ${POSITIONS[P.position]?.label.toLowerCase() ?? 'hoods'}`, '', 'Bike CdA from the tunnel divided by a typical rider-plus-bike CdA for the chosen position.')}
  </div></div>
  <div class="sec"><h2>Drag by part<em>N at 40 km/h</em></h2><div class="bars">${order.map(([g, val]) =>
    `<div class="barrow ${L.group === g ? 'on' : ''}" data-grp="${esc(g)}" title="${val < 0 ? 'Net suction: sits in the wake of the parts ahead of it (coarse-grid result)' : (val / s.drag_N * 100).toFixed(0) + ' % of the bike's drag'}"><span>${esc(g)}</span><i style="width:${Math.max(0, val / max * 100).toFixed(1)}%"></i><b>${val.toFixed(1)}</b></div>`).join('')}</div></div>
  <div class="sec"><h2>Show</h2>
    <div class="chips">${chip('data-ash="surface"', L.show.surface, 'Surface Cp')}${chip('data-ash="particles"', L.show.particles, 'Flow')}${chip('data-ash="lines"', L.show.lines, 'Streamlines')}
    ${chip('data-ash="side"', L.show.side, 'Side plane')}${chip('data-ash="plan"', L.show.plan, 'Plan plane')}${chip('data-ash="wake"', L.show.wake, 'Wake plane')}</div>
    <div class="rb-seg" style="margin-top:8px">${chip('data-afield="speed"', L.field === 'speed', 'Speed')}${chip('data-afield="cp"', L.field === 'cp', 'Pressure')}</div>
    <div style="margin-top:8px">${L.field === 'speed' ? legend('speed', '0', '1.5', '|U| / U∞') : legend('cp', '−1.6', '1.0', 'Cp')}</div>
    ${L.show.surface ? `<div style="margin-top:6px">${legend('cp', '−1.6', '1.0', 'surface Cp')}</div>` : ''}
  </div>
  <div class="sec"><h2>Ride</h2>
    <div class="row two"><label>Position</label><div class="rb-seg">${['tops', 'hoods', 'drops'].map((k) => chip(`data-pos="${k}"`, P.position === k, POSITIONS[k].label)).join('')}</div></div>
    <div class="row"><label for="apw">Power</label><input id="apw" type="range" data-p="power_w" data-u=" W" min="50" max="500" step="5" value="${P.power_w}"><span class="val">${P.power_w} W</span></div>
    <div class="kpis" style="margin-top:6px">${kpi('Speed', `${ev.kmh.toFixed(1)} km/h`, 'flat, no wind')}${kpi('Air takes', `${Math.round(ev.split.aero / P.power_w * 100)} %`, 'of your power')}</div>
    <p class="foot" title="${esc(`${s.method}. ${s.grid.cells_total.toLocaleString('en-US')} cells at ${s.grid.dx_mm} mm, ${s.grid.flow_throughs} flow-throughs. Sphere check (Re ${v.sphere_Re}): Cd ${v.Cd_24_cells_per_D} at 24 cells/D and ${v.Cd_12_cells_per_D} at 12 cells/D against ${v.reference_Cd}. ${v.note}`)}">
      LBM-LES · ${s.grid.dx_mm} mm · air 20 °C · 40 km/h · no ground · static wheels · no spokes · <abbr>accuracy</abbr></p>
  </div>`;
}

// ---- Structure -----------------------------------------------------------------------------------
export function structurePanel(beamPanel) {
  const seg = `<div class="sec"><div class="rb-seg" style="display:flex">${chip('data-smode="shell"', L.structMode === 'shell', 'Shell model · Abaqus', 'Abaqus Standard, S4R/S3R shells on the CAD skin')}${chip('data-smode="beam"', L.structMode === 'beam', 'Beam model · live', 'Space-frame beams, recomputed in your browser as you change the laminate')}</div></div>`;
  if (L.structMode === 'beam') return seg + beamPanel();
  const f = L.fe;
  if (!f) return seg + '<div class="pending"><span class="rb-spin"></span>Loading Abaqus results…</div>';
  const c = L.feMode >= 0 ? null : f.cases.find((x) => x.name === L.feCase) || f.cases[0];
  const mass = Object.values(f.doc.mesh).reduce((a, m) => a + m.mass_kg, 0);
  const lam = f.doc.laminate;
  return seg + `
  <div class="sec"><div class="chips">${f.cases.map((x) => chip(`data-fcase="${x.name}"`, L.feMode < 0 && x.name === L.feCase, ({ seated: 'Seated', pedalling: 'Pedalling', fork: 'Fork', saddle: 'Saddle', torsion: 'Torsion' })[x.name] || esc(x.label), esc(x.label))).join('')}${chip('data-fmode="0"', L.feMode >= 0, 'Modes')}</div></div>
  ${c ? `<div class="sec"><div class="kpis">
      ${kpi('Stress, 99th pct', `${c.p99_mises.toFixed(0)} MPa`, 'von Mises', 'big', '99 % of elements are below this. The colour scale tops out here.')}
      ${kpi('Deflection', `${c.max_disp.toFixed(1)} mm`, 'largest', 'big')}
      ${kpi('Local peak', `${c.peak_mises.toFixed(0)} MPa`, 'junction or load point', '', 'At a sharp tube junction or where a load enters through a coupling; a real frame has fillets and reinforcement there.')}
      ${kpi('Reserve', `${(lam.strength / c.p99_mises).toFixed(1)}×`, `vs ${lam.strength} MPa`, '', 'Assumed laminate strength over the 99th-percentile stress.')}
    </div>${legend('stress', '0', c.p99_mises.toFixed(0), 'MPa')}</div>`
    : `<div class="sec"><h2>Natural modes<em>axles held</em></h2><div class="chips">${f.modes.map((m, i) => chip(`data-fmode="${i}"`, L.feMode === i, `${m.hz.toFixed(0)} Hz`)).join('')}</div>${legend('stress', '0', '1', 'relative motion')}</div>`}
  <div class="sec"><h2>Motion</h2>
    <div class="row"><label for="fsc">Scale</label><input id="fsc" type="range" data-fe2="scale" min="1" max="80" step="1" value="${L.scale}"><span class="val">×${L.scale}</span></div>
    <div class="chips">${chip('data-fplay', L.playing, L.playing ? 'Pause' : 'Play')}</div>
  </div>
  <div class="sec"><div class="kpis three">${kpi('Elements', `${Math.round(Object.values(f.doc.mesh).reduce((a, m) => a + m.elements, 0) / 1000)}k`, 'S4R / S3R')}${kpi('Shell mass', `${(mass * 1000).toFixed(0)} g`, 'frame + fork')}${kpi('Laminate', `${(lam.E / 1000).toFixed(0)} GPa`, 'quasi-isotropic')}</div>
    <p class="foot" title="${esc(`${lam.note} Walls per tube from data/geometry.json. Loads use ISO 4210-6 magnitudes for orientation; this is not that test and not a safety assessment.`)}">Abaqus 2025 · CFRP walls 1.0–3.0 mm · ISO 4210-6 loads · <abbr>assumptions</abbr></p></div>`;
}

// ---- events --------------------------------------------------------------------------------------
export function handle(e, b, api) {
  const d = b?.dataset ?? e.target.dataset;
  if (d.cadt === 'replay') { L.cad?.replay(); api.redraw(); return true; }
  if (d.cadt) { L[d.cadt] = !L[d.cadt]; if (d.cadt === 'clay') L.cad?.setClay(L.clay); else L.cad?.setEdges(L.edges); api.redraw(); api.render(); return true; }
  if (d.cadp) { const p = L.cad?.doc.parts.find((x) => x.name === d.cadp); L.part = L.cad?.select(p) ?? null; api.redraw(); api.render(); return true; }
  if (d.grp) { L.group = L.group === d.grp ? null : d.grp; L.aero?.highlight(L.group ? api.groups[L.group] : null); api.redraw(); api.render(); return true; }
  if (d.ash) { L.show[d.ash] = !L.show[d.ash]; L.aero?.show(d.ash, L.show[d.ash]); api.redraw(); api.render(); return true; }
  if (d.afield) { L.field = d.afield; L.aero?.setField(L.field); api.redraw(); api.render(); return true; }
  if (d.smode) { L.structMode = d.smode; api.sync(); return true; }
  if (d.fcase) { L.feMode = -1; L.feCase = d.fcase; L.fe?.setCase(d.fcase); api.redraw(); api.render(); return true; }
  if (d.fmode != null && d.fmode !== undefined && b?.hasAttribute('data-fmode')) { L.feMode = Number(d.fmode); L.fe?.setMode(L.feMode); api.redraw(); api.render(); return true; }
  if (b?.hasAttribute('data-fplay')) { L.playing = !L.playing; L.fe?.setPlaying(L.playing); api.redraw(); api.render(); return true; }
  return false;
}
export function handleInput(e, api) {
  const t = e.target;
  if (t.dataset.cad === 'explode') { L.explode = Number(t.value); L.cad?.setExplode(L.explode); t.nextElementSibling.textContent = `${Math.round(L.explode * 100)} %`; api.redraw(); return true; }
  if (t.dataset.fe2 === 'scale') { L.scale = Number(t.value); L.fe?.setScale(L.scale); t.nextElementSibling.textContent = `×${L.scale}`; api.redraw(); return true; }
  return false;
}
