// Side panels for the result scenes: CAD, Aero (wind tunnel) and Structure (Abaqus / live beam).
// Words are kept to labels and numbers; explanations live in title tooltips.
import { S, esc, fmt, status } from './app.js';
import { rampCSS, FIELD_RAMP } from './labs.js';
import { setup, evaluate, POSITIONS } from './model/perf.js';
import { lineChart } from './charts.js';

export const L = { cad: null, aero: null, fe: null, sw: null, aeroCase: 'yaw00_dx8', aeroMissing: false, structMode: 'shell', feCase: 'pedalling', feMode: -1,
  show: { surface: true, particles: true, lines: true, side: false, plan: false, wake: false, wakeIso: false, vortex: false }, field: 'speed', group: null, part: null, clay: false, edges: true, explode: 0, scale: 25, playing: true,
  cases: [], cut: 'off', cutT: { x: 0.45, y: 0.5, z: 0.5 }, cutAt: null, scan: false, iso: { wakeIso: 0.5, vortex: 0.2 } };

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
  const v = a.cfd.validation, yaw = s.assumptions.yaw_deg, vol = a.volume, U = s.assumptions.speed_kmh / 3.6;
  const cases = L.cases.filter((c, i, all) => c.dx_mm === s.grid.dx_mm && all.findIndex((o) => o.yaw_deg === c.yaw_deg && o.dx_mm === c.dx_mm) === i);
  const F = vol?.F, fieldRange = (f) => (F?.[f] ? F[f].range : { speed: [0, 1.5], cp: [-1.6, 1] }[f]);
  const LEG = { speed: ['|U| / U∞', 1], cp: ['Cp', 1], loss: ['total-pressure loss', 1], vort: ['|ω| 1/s', 0] };
  const fr = fieldRange(L.field), fl = LEG[L.field];
  const cutLabel = { x: 'Across', y: 'Plan', z: 'Side' };
  const cutPos = cutText(a);
  return `
  ${cases.length > 1 ? `<div class="sec"><h2>Crosswind<em>yaw</em></h2><div class="rb-seg" style="display:flex">${cases.map((c) => chip(`data-ayaw="${esc(c.case)}"`, c.case === L.aeroCase, `${c.yaw_deg}°`, `Wind ${c.yaw_deg}° off the nose, from the drive side`)).join('')}</div></div>` : ''}
  <div class="sec"><div class="kpis">
    ${kpi('CdA, bike', `${s.CdA_m2.toFixed(3)} m²`, `no rider · ${yaw}° yaw`, 'big', 'Drag area of the bike alone. See the footnote on accuracy.')}
    ${kpi('Drag', `${s.drag_N.toFixed(1)} N`, '40 km/h', 'big')}
    ${yaw ? kpi('Side force', `${s.side_force_N.toFixed(1)} N`, 'pushes the bike sideways', '', 'Lateral force in the bike frame; what a gust makes you steer against.') : kpi('Power', `${Math.round(s.power_W_at_40kmh)} W`, 'to push the bike', '', 'Drag × speed at 40 km/h. Reads high with the drag; see the accuracy note.')}
    ${kpi('Of total drag', `${Math.round(bikeShare * 100)} %`, `with a rider on the ${POSITIONS[P.position]?.label.toLowerCase() ?? 'hoods'}`, '', 'Bike CdA from the tunnel divided by a typical rider-plus-bike CdA for the chosen position.')}
  </div></div>
  <div class="sec"><h2>Show</h2>
    <div class="chips">${chip('data-ash="surface"', L.show.surface, 'Surface Cp')}${chip('data-ash="particles"', L.show.particles, 'Flow')}${chip('data-ash="lines"', L.show.lines, 'Streamlines')}
    ${vol ? chip('data-ash="wakeIso"', L.show.wakeIso, 'Wake', 'Envelope of the slow air behind the bike') + chip('data-ash="vortex"', L.show.vortex, 'Vortices', 'Vortex cores (Q criterion), coloured by pressure: blue is suction') : chip('data-ash="side"', L.show.side, 'Side plane') + chip('data-ash="plan"', L.show.plan, 'Plan plane') + chip('data-ash="wake"', L.show.wake, 'Wake plane')}</div>
    ${vol && L.show.wakeIso ? `<div class="row"><label for="awk" title="The surface where air has slowed to this fraction of the free stream">Wake at</label><input id="awk" type="range" data-aiso="wakeIso" min="0.4" max="0.95" step="0.05" value="${L.iso.wakeIso}"><span class="val">${Math.round(L.iso.wakeIso * 100)} % U∞</span></div>` : ''}
    ${vol && L.show.vortex ? `<div class="row"><label for="avx" title="Q criterion level, as a share of its 99.5th percentile">Vortex level</label><input id="avx" type="range" data-aiso="vortex" min="0.02" max="0.4" step="0.01" value="${L.iso.vortex}"><span class="val">${Math.round(L.iso.vortex * 100)} %</span></div>` : ''}
    ${L.show.surface ? `<div style="margin-top:6px">${legend('cp', '−1.6', '1.0', 'surface Cp')}</div>` : ''}
  </div>
  ${vol ? `<div class="sec"><h2>Cut plane<em id="acpos">${cutPos}</em></h2>
    <div class="rb-seg" style="display:flex">${chip('data-acut="off"', L.cut === 'off', 'Off')}${['x', 'y', 'z'].map((k) => chip(`data-acut="${k}"`, L.cut === k, cutLabel[k], { x: 'Across the flow, slides from the nose into the wake', y: 'Horizontal, slides from the ground up', z: 'Vertical along the bike, slides side to side' }[k])).join('')}</div>
    ${L.cut !== 'off' ? `<div class="row" style="margin-top:6px"><label for="acp">Position</label><input id="acp" type="range" data-acutt min="0" max="1" step="0.005" value="${L.cutT[L.cut]}"><span class="val"><button data-ascan aria-pressed="${L.scan}" title="Sweep the plane through the flow" style="padding:2px 8px">${L.scan ? 'Stop' : 'Scan'}</button></span></div>
    <div class="rb-seg" style="display:flex;margin-top:6px">${chip('data-afield="speed"', L.field === 'speed', 'Speed')}${chip('data-afield="cp"', L.field === 'cp', 'Pressure')}${chip('data-afield="loss"', L.field === 'loss', 'Loss', 'Total-pressure loss, 1 − Cp₀: energy taken out of the air')}${chip('data-afield="vort"', L.field === 'vort', 'Vorticity', 'How fast the air is spinning')}</div>
    <div style="margin-top:8px">${legend(FIELD_RAMP[L.field], fr[0].toFixed(fl[1]).replace('-', '−'), fr[1].toFixed(fl[1]), fl[0])}</div>` : ''}
  </div>` : ''}
  <div class="sec"><h2>Drag by part<em>N at 40 km/h</em></h2><div class="bars">${order.map(([g, val]) =>
    `<div class="barrow ${L.group === g ? 'on' : ''}" data-grp="${esc(g)}" title="${val < 0 ? 'Net suction: sits in the wake of the parts ahead of it (coarse-grid result)' : (val / s.drag_N * 100).toFixed(0) + ' % of the bike’s drag'}"><span>${esc(g)}</span><i style="width:${Math.max(0, val / max * 100).toFixed(1)}%"></i><b>${val.toFixed(1)}</b></div>`).join('')}</div></div>
  ${aeroCharts(a, cases, U)}
  <div class="sec"><h2>Ride</h2>
    <div class="row two"><label>Position</label><div class="rb-seg">${['tops', 'hoods', 'drops'].map((k) => chip(`data-pos="${k}"`, P.position === k, POSITIONS[k].label)).join('')}</div></div>
    <div class="row"><label for="apw">Power</label><input id="apw" type="range" data-p="power_w" data-u=" W" min="50" max="500" step="5" value="${P.power_w}"><span class="val">${P.power_w} W</span></div>
    <div class="kpis" style="margin-top:6px">${kpi('Speed', `${ev.kmh.toFixed(1)} km/h`, 'flat, no wind')}${kpi('Air takes', `${Math.round(ev.split.aero / P.power_w * 100)} %`, 'of your power')}</div>
    <p class="foot" title="${esc(`${s.method}. ${s.grid.cells_total.toLocaleString('en-US')} cells at ${s.grid.dx_mm} mm, ${s.grid.flow_throughs} flow-throughs. Sphere check (Re ${v.sphere_Re}): Cd ${v.Cd_24_cells_per_D} at 24 cells/D and ${v.Cd_12_cells_per_D} at 12 cells/D against ${v.reference_Cd}. ${v.note}`)}">
      LBM-LES · ${s.grid.dx_mm} mm · air 20 °C · 40 km/h · no ground · static wheels · no spokes · <abbr>accuracy</abbr></p>
  </div>`;
}

const GROUP_COL = { Frame: '#18a9a8', Fork: '#6366f1', 'Front wheel': '#e0884a', 'Rear wheel': '#c9a227', Drivetrain: '#d1495b', Cockpit: '#5b8def', 'Saddle & post': '#8d6cc9', Brakes: '#7a8794', Bottles: '#3fa66b' };
const chartSec = (title, unit, svg, legendRow = '', tip = '') => `<div class="sec"><h2 ${tip ? `title="${esc(tip)}"` : ''}>${title}${unit ? `<em>${unit}</em>` : ''}</h2>${svg}${legendRow}</div>`;
const keyRow = (items) => `<div class="legendrow">${items.map(([c, l, dash]) => `<span><i style="background:${c};${dash ? 'opacity:.6' : ''}"></i>${esc(l)}</span>`).join('')}</div>`;

function aeroCharts(a, cases, U) {
  const s = a.cfd.summary, out = [], yaw = s.assumptions.yaw_deg, rho = s.assumptions.air_density;
  // yaw sweep: drag area and side force against the wind angle
  if (cases.length > 1) {
    const pts = cases.map((c) => [c.yaw_deg, c.CdA_m2]), side = cases.map((c) => [c.yaw_deg, c.side_force_N]);
    const cur = cases.find((c) => c.case === L.aeroCase);
    out.push(chartSec('Drag area vs wind angle', 'm²', lineChart({ series: [{ pts, color: 'var(--accent)' }], marks: cases.map((c) => ({ x: c.yaw_deg, y: c.CdA_m2, color: c === cur ? 'var(--accent)' : 'var(--ink3)', label: c === cur ? c.CdA_m2.toFixed(3) : '' })), xLabel: 'yaw °', yLabel: 'CdA m²', w: 360, h: 190, xMin: 0, yMin: Math.floor(Math.min(...pts.map((p) => p[1])) * 0.9 * 100) / 100 }),
      '', 'Drag area of the bike in the direction of travel, as the wind swings off the nose.'));
    const gk = Object.keys(cases[0].drag_by_group_N).filter((g) => Math.max(...cases.map((c) => Math.abs(c.drag_by_group_N[g]))) > 0.8);
    out.push(chartSec('Drag by part vs wind angle', 'N', lineChart({ series: gk.map((g) => ({ pts: cases.map((c) => [c.yaw_deg, c.drag_by_group_N[g]]), color: GROUP_COL[g] || 'var(--ink3)' })), xLabel: 'yaw °', yLabel: 'drag N', w: 360, h: 200, xMin: 0, yMin: Math.min(0, ...cases.flatMap((c) => gk.map((g) => c.drag_by_group_N[g]))) }),
      keyRow(gk.map((g) => [GROUP_COL[g] || 'var(--ink3)', g]))));
    out.push(chartSec('Side force vs wind angle', 'N', lineChart({ series: [{ pts: side, color: '#6366f1' }], marks: side.map(([x, y]) => ({ x, y, color: x === cur?.yaw_deg ? '#6366f1' : 'var(--ink3)' })), xLabel: 'yaw °', yLabel: 'side force N', w: 360, h: 170, xMin: 0, yMin: Math.min(0, ...side.map((p) => p[1])) }),
      '', 'Sideways push on the bike alone; it grows with yaw much faster than drag does.'));
  }
  // drag building up from the nose to the tail
  const pr = a.profile;
  if (pr) {
    const G = a.cfd.groups, nose = a.cfd.bike_box_m[1][0], tail = a.cfd.bike_box_m[0][0];
    const xs = Array.from({ length: pr.n }, (_, i) => pr.x0_m + (i + 0.5) * pr.dx_m);
    const keep = xs.map((x, i) => i).filter((i) => xs[i] <= nose + 0.1 && xs[i] >= tail - 0.4).reverse(); // nose first
    const cum = (gs) => { let c = 0; return keep.map((i) => { for (const g of gs) c += pr.drag[g * pr.n + i]; return [nose - xs[i], c]; }); };
    const all = G.map((_, g) => g), tot = cum(all);
    const big = G.map((name, g) => [name, g, Math.abs(s.drag_by_group_N[name] ?? 0)]).sort((x, y) => y[2] - x[2]).slice(0, 4);
    out.push(chartSec('Drag from nose to tail', 'N, cumulative', lineChart({ series: [{ pts: tot, color: 'var(--ink)' }, ...big.map(([name, g]) => ({ pts: cum([g]), color: GROUP_COL[name] || 'var(--ink3)' }))], xLabel: 'm behind the nose', yLabel: 'drag N', w: 360, h: 210, xMin: 0, yMin: Math.min(0, ...tot.map((p) => p[1]), ...big.flatMap(([, g]) => cum([g]).map((p) => p[1]))) }),
      keyRow([['var(--ink)', 'Bike'], ...big.map(([name]) => [GROUP_COL[name] || 'var(--ink3)', name])]), 'Running total of the time-averaged force on each 16 mm slab of the bike, front to back along the flow.'));
  }
  // power to push the bike alone against speed
  const sp = []; for (let k = 10; k <= 55; k += 1) sp.push([k, 0.5 * rho * s.CdA_m2 * (k / 3.6) ** 3]);
  out.push(chartSec('Power to push the bike', 'W, no rider', lineChart({ series: [{ pts: sp, color: 'var(--accent)' }], marks: [{ x: 40, y: s.power_W_at_40kmh, color: 'var(--accent)', label: `${Math.round(s.power_W_at_40kmh)} W` }], xLabel: 'km/h', yLabel: 'W', w: 360, h: 180, xMin: 10, xMax: 55 }),
    '', `½ ρ CdA v³ with the tunnel CdA at ${yaw}° yaw; it scales with the cube of speed.`));
  // convergence of the solver
  const h = a.history;
  if (h?.t_s?.length) {
    const pts = h.t_s.map((t, i) => [t, h.drag_N[i]]).filter((p) => p[0] > h.t_s[h.t_s.length - 1] * 0.12);
    const avgFrom = h.t_s[h.t_s.length - 1] * (1 - s.grid.averaged_steps / s.grid.steps);
    out.push(chartSec('Solver convergence', 'N', lineChart({ series: [{ pts, color: 'var(--ink3)' }, { pts: [[avgFrom, s.drag_N], [h.t_s[h.t_s.length - 1], s.drag_N]], color: 'var(--accent)' }], xLabel: 's of air time', yLabel: 'drag N', w: 360, h: 170, yMin: Math.floor(Math.min(...pts.map((p) => p[1])) * 0.9), yMax: Math.ceil(Math.max(...pts.map((p) => p[1])) * 1.05) }),
      keyRow([['var(--ink3)', 'instantaneous'], ['var(--accent)', 'mean over the averaging window']]), `${s.grid.flow_throughs} flow-throughs; the reported drag is the mean of the last ${Math.round(s.grid.averaged_steps / s.grid.steps * 100)} %.`));
  }
  return out.join('');
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
  if (d.ayaw) { if (d.ayaw !== L.aeroCase) { L.aeroCase = d.ayaw; api.reloadAero(); } return true; }
  if (d.acut) { L.cut = d.acut; if (L.cut === 'off') L.scan = false; applyCut(); api.redraw(); api.render(); return true; }
  if (b?.hasAttribute('data-ascan')) { L.scan = !L.scan; applyCut(); api.redraw(); api.render(); return true; }
  if (d.smode) { L.structMode = d.smode; api.sync(); return true; }
  if (d.fcase) { L.feMode = -1; L.feCase = d.fcase; L.fe?.setCase(d.fcase); api.redraw(); api.render(); return true; }
  if (d.fmode != null && d.fmode !== undefined && b?.hasAttribute('data-fmode')) { L.feMode = Number(d.fmode); L.fe?.setMode(L.feMode); api.redraw(); api.render(); return true; }
  if (b?.hasAttribute('data-fplay')) { L.playing = !L.playing; L.fe?.setPlaying(L.playing); api.redraw(); api.render(); return true; }
  return false;
}
const cutText = (a) => L.cutAt == null ? '' : L.cut === 'x' ? `${((a.cfd.bike_box_m[1][0] * 1000 - L.cutAt) / 1000).toFixed(2)} m behind the nose` : L.cut === 'y' ? `${Math.round(L.cutAt + 0)} mm up` : `${Math.round(Math.abs(L.cutAt))} mm ${L.cutAt >= 0 ? 'drive side' : 'left side'}`;
/** Push the cut-plane state into the scene; while scanning, the slider follows the plane. */
export function applyCut() {
  const a = L.aero; if (!a?.volume) return;
  if (L.cut === 'off') { a.setCut({ on: false }); L.cutAt = null; }
  else L.cutAt = a.setCut({ on: true, axis: L.cut, t: L.cutT[L.cut] });
  const scanning = L.scan && L.cut !== 'off';
  if (scanning) L.cutAt = null;
  a.setScan(scanning, (t) => { L.cutT[L.cut] = t; const el = document.getElementById('acp'); if (el) el.value = t; });
}
let isoTimer = 0;
export function handleInput(e, api) {
  const t = e.target;
  if (t.dataset.cad === 'explode') { L.explode = Number(t.value); L.cad?.setExplode(L.explode); t.nextElementSibling.textContent = `${Math.round(L.explode * 100)} %`; api.redraw(); return true; }
  if (t.hasAttribute('data-acutt')) {
    const was = L.scan; L.scan = false; L.cutT[L.cut] = Number(t.value); applyCut();
    const pos = document.getElementById('acpos'); if (pos) pos.textContent = cutText(L.aero);
    if (was) { const sb = document.querySelector('[data-ascan]'); if (sb) { sb.textContent = 'Scan'; sb.setAttribute('aria-pressed', 'false'); } }
    api.redraw(); return true;
  }
  if (t.dataset.aiso) { const k = t.dataset.aiso, v = Number(t.value); L.iso[k] = v; t.nextElementSibling.textContent = k === 'wakeIso' ? `${Math.round(v * 100)} % U∞` : `${Math.round(v * 100)} %`; clearTimeout(isoTimer); isoTimer = setTimeout(() => { L.aero?.setIso(k, v); api.redraw(); }, 120); return true; }
  if (t.dataset.fe2 === 'scale') { L.scale = Number(t.value); L.fe?.setScale(L.scale); t.nextElementSibling.textContent = `×${L.scale}`; api.redraw(); return true; }
  return false;
}
