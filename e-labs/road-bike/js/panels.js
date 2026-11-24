// Side panels for the result scenes: CAD, Aero (wind tunnel) and Structure (Abaqus / live beam).
// Words are kept to labels and numbers; explanations live in title tooltips.
import { S, esc, fmt, status } from './app.js';
import { rampCSS, FIELD_RAMP, SURFACE_CP } from './labs.js';
import { setup, evaluate, POSITIONS } from './model/perf.js';
import { BASE_CAD, pairCases, weightedDelta, roadGains, climbPer100g, YAW_WEIGHTS, YAW_BASIS, RESOLUTION, MATRIX, matrixStudy, BARRY_BASIS, SPOKE } from './model/study.js';
import { lineChart } from './charts.js';

export const L = { cad: null, aero: null, fe: null, sw: null, aeroCase: 'yaw00_dx8', aeroMissing: false, structMode: 'shell', feCase: 'pedalling', feMode: -1,
  show: { surface: true, particles: true, lines: true, side: false, plan: false, wake: false, wakeIso: false, vortex: false, unsteady: false, rolling: true }, uCores: true, uSheet: true, uLevel: 0.3, field: 'speed', group: null, part: null, clay: false, edges: true, explode: 0, scale: 25, playing: true,
  cases: [], cut: 'off', cutT: { x: 0.45, y: 0.5, z: 0.5 }, cutAt: null, scan: false, iso: { wakeIso: 0.65, vortex: 0.35 } };

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
  const cad = a.cfd.cad || BASE_CAD, cfgOf = (c) => c.cad || BASE_CAD, pr = s.assumptions.protocol || 'static';
  const cases = L.cases.filter((c, i, all) => c.dx_mm === s.grid.dx_mm && cfgOf(c) === cad && proto(c) === pr && all.findIndex((o) => o.yaw_deg === c.yaw_deg && o.dx_mm === c.dx_mm && cfgOf(o) === cad && proto(o) === pr) === i);
  const configs = [...new Map(L.cases.filter((c) => c.dx_mm === s.grid.dx_mm && proto(c) === pr).map((c) => [cfgOf(c), c.config || 'Installed build'])).entries()]
    .sort((x, y) => mIdx(x[0]) - mIdx(y[0]));
  const protos = [...new Set(L.cases.map(proto))];
  const F = vol?.F, fieldRange = (f) => (F?.[f] ? F[f].range : { speed: [0, 1.5], cp: [-1.6, 1] }[f]);
  const LEG = { speed: ['|U| / U∞', 1], cp: ['Cp', 1], loss: ['total-pressure loss', 1], vort: ['|ω| 1/s', 0] };
  const fr = fieldRange(L.field), fl = LEG[L.field];
  const cutLabel = { x: 'Across', y: 'Plan', z: 'Side' };
  const cutPos = cutText(a);
  return `
  ${protos.length > 1 ? `<div class="sec"><h2 title="${esc(PROTO_TIP)}">Protocol</h2><div class="rb-seg" style="display:flex">${chip('data-aproto="standard"', pr === 'standard', 'Spinning · ground', PROTO_TIP)}${chip('data-aproto="static"', pr === 'static', 'Static (earlier)', 'The first runs: free stream with no ground and the wheels still. Kept for comparison.')}</div></div>` : ''}
  ${configs.length > 1 ? `<div class="sec"><h2>Build in the tunnel</h2><div class="chips">${configs.map(([k, label]) => chip(`data-acfg="${esc(k)}"`, k === cad, k === BASE_CAD ? 'Installed' : esc(MATRIX.find((m) => m.cad === k)?.label ?? label.replace('GP5000 ', '')), k === BASE_CAD ? 'Fulcrum Racing 15C on Rubino Pro 23, as photographed' : esc(label))).join('')}</div></div>` : ''}
  ${pr === 'standard' ? matrixSection(a) : studySection(a)}
  ${cases.length > 1 ? `<div class="sec"><h2>Crosswind<em>yaw</em></h2><div class="rb-seg" style="display:flex">${cases.map((c) => chip(`data-ayaw="${esc(c.case)}"`, c.case === L.aeroCase, `${String(c.yaw_deg).replace('-', '−')}°`, `Wind ${Math.abs(c.yaw_deg)}° off the nose, from the ${c.yaw_deg < 0 ? 'left' : 'drive'} side`)).join('')}</div></div>` : ''}
  <div class="sec"><div class="kpis">
    ${kpi('CdA, bike', `${s.CdA_m2.toFixed(3)} m²`, `no rider · ${yaw}° yaw`, 'big', 'Drag area of the bike alone. See the footnote on accuracy.')}
    ${kpi('Drag', `${s.drag_N.toFixed(1)} N`, '40 km/h', 'big')}
    ${yaw ? kpi('Side force', `${s.side_force_N.toFixed(1)} N`, 'pushes the bike sideways', '', 'Lateral force in the bike frame; what a gust makes you steer against.') : kpi('Power', `${Math.round(s.power_W_at_40kmh)} W`, 'to push the bike', '', 'Drag × speed at 40 km/h. Reads high with the drag; see the accuracy note.')}
    ${kpi('Of total drag', `${Math.round(bikeShare * 100)} %`, `with a rider on the ${POSITIONS[P.position]?.label.toLowerCase() ?? 'hoods'}`, '', 'Bike CdA from the tunnel divided by a typical rider-plus-bike CdA for the chosen position.')}
  </div></div>
  <div class="sec"><h2>Show</h2>
    <div class="chips">${chip('data-ash="surface"', L.show.surface, 'Surface Cp')}${chip('data-ash="particles"', L.show.particles, 'Flow')}${chip('data-ash="lines"', L.show.lines, 'Streamlines')}${chip('data-ash="rolling"', L.show.rolling, 'Rolling', 'Wheels and cranks turn as if riding at 40 km/h in the selected gear, on the same slowed clock as the air. The tunnel ran with the wheels still, so the motion is illustrative.')}
    ${vol ? chip('data-ash="wakeIso"', L.show.wakeIso, 'Wake', 'Envelope of the slow air behind the bike (time-averaged)') + chip('data-ash="vortex"', L.show.vortex, 'Vortices', 'Time-averaged vortex cores (Q criterion), coloured by how fast they spin') : chip('data-ash="side"', L.show.side, 'Side plane') + chip('data-ash="plan"', L.show.plan, 'Plan plane') + chip('data-ash="wake"', L.show.wake, 'Wake plane')}
    ${a.hasUnsteady ? chip('data-ash="unsteady"', L.show.unsteady, 'Unsteady ▸', 'Instantaneous snapshots from the end of the run, played in order: the wake as it actually sheds, not its average') : ''}</div>
    ${vol && L.show.wakeIso ? `<div class="row"><label for="awk" title="The surface where air has slowed to this fraction of the free stream">Wake at</label><input id="awk" type="range" data-aiso="wakeIso" min="0.4" max="0.95" step="0.05" value="${L.iso.wakeIso}"><span class="val">${Math.round(L.iso.wakeIso * 100)} % U∞</span></div>` : ''}
    ${vol && L.show.vortex ? `<div class="row"><label for="avx" title="Q criterion level, as a share of its 99.5th percentile">Vortex level</label><input id="avx" type="range" data-aiso="vortex" min="0.02" max="0.4" step="0.01" value="${L.iso.vortex}"><span class="val">${Math.round(L.iso.vortex * 100)} %</span></div>` : ''}
    ${a.hasUnsteady && L.show.unsteady ? `<div class="chips" style="margin-top:6px">${chip('data-auns="cores"', L.uCores, 'Vortex cores', 'Instantaneous Q-criterion surfaces')}${chip('data-auns="sheet"', L.uSheet, 'Centre plane', 'Spanwise vorticity on the bike centre plane: red spins one way, blue the other')}</div>
    ${L.uCores ? `<div class="row"><label for="aul" title="Q criterion level, as a share of the snapshots' 99.5th percentile">Core level</label><input id="aul" type="range" data-auns-level min="0.16" max="0.7" step="0.02" value="${L.uLevel}"><span class="val">${Math.round(L.uLevel * 100)} %</span></div>` : ''}
    ${(() => { const i = a.unsteady.info(); return i ? `<p class="foot">${i.frames} snapshots · ${(i.span_s * 1000).toFixed(0)} ms of flow · played ${Math.round(1 / 0.055)}× slower</p>` : ''; })()}` : ''}
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
    const cad = a.cfd.cad || BASE_CAD, pr = s.assumptions.protocol || 'static', other = [...new Set(L.cases.filter((c) => proto(c) === pr).map((c) => c.cad || BASE_CAD))].filter((k) => k !== cad);
    const otherPts = other.map((k) => L.cases.filter((c) => (c.cad || BASE_CAD) === k && c.dx_mm === s.grid.dx_mm && proto(c) === pr).sort((x, y) => x.yaw_deg - y.yaw_deg).map((c) => [c.yaw_deg, c.CdA_m2])).filter((q) => q.length);
    out.push(chartSec('Drag area vs wind angle', 'm²', lineChart({ series: [...otherPts.map((q) => ({ pts: q, color: 'var(--ink3)' })), { pts, color: 'var(--accent)' }], marks: cases.map((c) => ({ x: c.yaw_deg, y: c.CdA_m2, color: c === cur ? 'var(--accent)' : 'var(--ink3)', label: c === cur ? c.CdA_m2.toFixed(3) : '' })), xLabel: 'yaw °', yLabel: 'CdA m²', w: 360, h: 190, xMin: Math.min(0, ...pts.map((p) => p[0])), yMin: Math.floor(Math.min(...pts.map((p) => p[1]), ...otherPts.flat().map((p) => p[1])) * 0.9 * 100) / 100 }),
      otherPts.length ? keyRow([['var(--accent)', 'this build'], ['var(--ink3)', 'other builds']]) : '', 'Drag area of the bike in the direction of travel, as the wind swings off the nose.'));
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
      keyRow([['var(--ink3)', 'instantaneous'], ['var(--accent)', 'mean over the averaging window']]), `${s.grid.flow_throughs} flow-throughs; the reported drag is the mean of every step in the last ${Math.round(s.grid.averaged_steps / s.grid.steps * 100)} %.${h.note ? ' ' + h.note : ''}`));
  }
  return out.join('');
}

// ---- Wheels x tyres matrix (standard protocol) ----------------------------------------------------
const proto = (c) => c.protocol || 'static';
const mIdx = (cad) => { const i = MATRIX.findIndex((m) => m.cad === cad); return i < 0 ? -1 : i; };
const PROTO_TIP = 'After common wind-tunnel practice for wheels and bikes: bike with no rider, wheels spun at road speed (U cos yaw) on a ground moving at the same speed, yaw −15…+15° in 5° steps, CdA at 40 km/h, yaw-weighted after Barry (2018). Spokes do not resolve at 8 mm and are added by a blade-element model.';
const MCOL = { fu23: '#7b8794', fu25: '#56616d', fu28: '#2f3a45', st23: '#7fd6d5', st25: '#18a9a8', st28: '#0b6f6e' };
function matrixSection(a) {
  const P = S.P, st = matrixStudy(L.cases, S.catalog, P);
  if (!st) return '';
  const rows = st.rows, done = rows.filter((r) => !r.missing), cur = a.cfd.cad;
  const allYaws = [...new Set(L.cases.filter((c) => proto(c) === 'standard').map((c) => c.yaw_deg))].sort((x, y) => x - y);
  const W = (x) => `${sgn(-x, 1)}`;
  const w0 = done[0]?.weights ?? {};
  const series = done.map((r) => ({ pts: r.cases.map((c) => [c.yaw_deg, c.CdA_m2]), color: MCOL[r.key], dash: r.wheelset.startsWith('Fulcrum') ? '5 3' : '' }));
  const best = done.filter((r) => r.key !== 'fu23').sort((x, y) => x.gain.dt_s - y.gain.dt_s)[0];
  const tip = `${PROTO_TIP} ${BARRY_BASIS} ${RESOLUTION.basis} ${SPOKE.basis} Rolling from the catalog Crr (tubeless drum figures plus the butyl-tube penalty). ${P.power_w} W, ${POSITIONS[P.position === 'aero' ? 'drops' : P.position].label.toLowerCase()}, flat, mass held equal.`;
  return `<div class="sec"><h2 title="${esc(tip)}">Wheels × tyres<em>vs Fulcrum · 23 (installed)</em></h2>
    ${best ? `<div class="gain" title="${esc(tip)}">
      <div><span>Fastest: ${esc(best.label)}</span><b>${sgn(best.gain.kmhUp - best.gain.kmhBase, 2)}</b><small>km/h at ${P.power_w} W</small></div>
      <div><span>40 km</span><b class="${best.gain.dt_s > 0 ? 'bad' : ''}">${sgn(best.gain.dt_s, 0)} s</b><small>${best.yaws.length} yaw${best.yaws.length > 1 ? 's' : ''} weighted</small></div>
      <div><span>At 32 km/h</span><b>${W(best.gain.at.find((x) => x.kmh === 32).saved_W)} W</b><small>${W(best.gain.at.find((x) => x.kmh === 32).aero_W)} air · ${W(best.gain.at.find((x) => x.kmh === 32).rolling_W)} roll</small></div>
    </div>` : ''}
    <table class="study" style="margin-top:8px"><thead><tr><th>Build</th><th title="Yaw-weighted tunnel CdA (bike only)">CdA</th><th title="Change in effective CdA: tunnel × ${RESOLUTION.mid} plus the spoke model">Δ</th><th title="Power change at 32 km/h from air">Air</th><th title="Power change at 32 km/h from rolling resistance">Roll</th><th title="Time over 40 km at ${P.power_w} W">40 km</th><th title="Parts to buy (wheels, tyres, pads)">$</th></tr></thead><tbody>
      ${rows.map((r) => r.missing ? `<tr><td><i class="dot" style="background:${MCOL[r.key]}"></i> ${esc(r.label)}</td><td colspan="6" class="muted" style="text-align:center">in the tunnel queue</td></tr>` : (() => {
        const a32 = r.gain.at.find((x) => x.kmh === 32), base = r.key === 'fu23';
        return `<tr data-acfg="${esc(r.cad)}" style="cursor:pointer${r.cad === cur ? ';background:var(--accent-bg)' : ''}" title="Show ${esc(r.label)} in the tunnel"><td><i class="dot" style="background:${MCOL[r.key]}"></i> ${esc(r.label)}</td><td>${r.cda.toFixed(4)}</td>
          <td class="${base ? '' : r.dCdA < 0 ? 'good' : 'bad'}">${base ? '—' : sgn(r.dCdA * 1e4, 0)}</td><td class="${base ? '' : a32.aero_W > 0 ? 'good' : 'bad'}">${base ? '—' : W(a32.aero_W)}</td><td class="${base ? '' : a32.rolling_W > 0 ? 'good' : 'bad'}">${base ? '—' : W(a32.rolling_W)}</td>
          <td class="${base ? '' : r.gain.dt_s < 0 ? 'good' : 'bad'}">${base ? '—' : sgn(r.gain.dt_s, 0) + ' s'}</td><td>${base ? '—' : Number.isFinite(r.price) ? fmt.usd(r.price) : '—'}</td></tr>`;
      })()).join('')}
    </tbody></table>
    ${series.length ? `<div style="margin-top:8px">${lineChart({ series, xLabel: 'yaw °', yLabel: 'CdA m²', w: 360, h: 200, xMin: Math.min(0, ...allYaws), xMax: Math.max(15, ...allYaws), yMin: Math.floor(Math.min(...series.flatMap((x) => x.pts.map((p) => p[1]))) * 0.9 * 100) / 100 })}</div>
      ${keyRow(done.map((r) => [MCOL[r.key], r.label]))}` : ''}
    <p class="foot" title="${esc(tip)}">Δ in 1e-4 m² · W at 32 km/h · yaw weights ${Object.entries(w0).sort((x, y) => x[0] - y[0]).map(([y, v]) => `${y}° ${Math.round(v * 100)} %`).join(', ')} · ${done.length} of 6 builds · <abbr>basis</abbr></p>
  </div>`;
}

// ---- Upgrade study: installed vs Superteam 50 + GP5000 AS TR 28 ----------------------------------
const STUDY_CAD = 'data/cad/variants/st28/parts';
const STUDY_SET = { wheels: 'wheels_superteam_50c', tires: 'tires_gp5000_as_tr_28', brake_pads: 'pads_black_prince' };
const sgn = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
function studySection(a) {
  const rows = pairCases(L.cases, STUDY_CAD, { protocol: 'static' });
  if (!rows.length) return '';
  const P = S.P, wd = weightedDelta(rows), cfg = { ...S.catalog.default_config, ...STUDY_SET };
  const mid = wd.dCdA * RESOLUTION.mid, g = roadGains(S.catalog, P, cfg, mid), gLo = roadGains(S.catalog, P, cfg, wd.dCdA * RESOLUTION.hi), gHi = roadGains(S.catalog, P, cfg, wd.dCdA * RESOLUTION.lo);
  const gAero = roadGains(S.catalog, P, S.catalog.default_config, mid), gRoll = roadGains(S.catalog, P, cfg, 0);
  const W = (x) => `${sgn(x, 1)} W`, at = g.at.find((r) => r.kmh === 32) || g.at[0];
  const range = (f) => { const v = [f(gLo), f(gHi)].map(Math.abs).sort((x, y) => x - y); return `${v[0].toFixed(0)}–${v[1].toFixed(0)}`; };
  const wheelD = (r) => (r.groups['Front wheel'] ?? 0) + (r.groups['Rear wheel'] ?? 0);
  const se = rows.find((r) => r.se)?.se;
  const perG = climbPer100g(S.catalog, P);
  const tip = `${YAW_BASIS} ${RESOLUTION.basis} Rolling: ${g.crrBasis ?? ''} Position CdA ${g.cdaBase.toFixed(3)} m² (${g.position}). ${g.notes.join(' ')}`;
  return `<div class="sec"><h2 title="${esc('Same tunnel, lattice and inflow; only the wheels and tyres change. The installed build runs on Fulcrum Racing 15C rims with Rubino Pro 23 tyres; the upgrade on Superteam 50 mm carbon rims with GP5000 AS TR 28 tyres.')}">Upgrade study<em>Superteam 50 + AS TR 28</em></h2>
    <div class="gain" title="${esc(tip)}">
      <div><span>Speed at ${P.power_w} W</span><b class="${g.kmhUp < g.kmhBase ? 'bad' : ''}">${sgn(g.kmhUp - g.kmhBase, 2)}</b><small>km/h · ${g.kmhBase.toFixed(1)} → ${g.kmhUp.toFixed(1)}</small></div>
      <div><span>${g.km} km at ${P.power_w} W</span><b class="${g.dt_s > 0 ? 'bad' : ''}">${sgn(g.dt_s, 0)} s</b><small>${range((x) => -x.dt_s)} s ${g.dt_s < 0 ? 'saved' : 'lost'}</small></div>
      <div><span>Power at ${at.kmh} km/h</span><b class="${at.saved_W < 0 ? 'bad' : ''}">${sgn(-at.saved_W, 1)} W</b><small>${sgn(-at.aero_W, 1)} air · ${sgn(-at.rolling_W, 1)} rolling</small></div>
    </div>
    <table class="study" style="margin-top:8px"><thead><tr><th>Yaw</th><th>CdA inst.</th><th>CdA up.</th><th>Δ</th><th title="Front + rear wheel groups. Between builds the per-part split moves by several newtons (frame and drivetrain trade force across their shared wake); only the total and the wheel groups, which sit in clean air at the front, are read as results.">Δ wheels N</th><th title="Change in sideways force on the bike (magnitude): what a gust makes you steer against. Deep rims add sail area.">Δ side N</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.yaw}°<small class="muted"> ${Math.round((YAW_WEIGHTS[r.yaw] ?? 0) * 100)} %</small></td><td>${r.base.CdA_m2.toFixed(4)}</td><td>${r.up.CdA_m2.toFixed(4)}</td><td class="${r.dCdA < 0 ? 'good' : 'bad'}" title="${sgn(r.dCdA * 1e4, 0)}e-4 m²">${sgn(r.dCdA / r.base.CdA_m2 * 100, 1)} %</td><td class="${wheelD(r) < 0 ? 'good' : 'bad'}">${sgn(wheelD(r), 2)}</td><td class="${Math.abs(r.up.side_force_N) > Math.abs(r.base.side_force_N) + 0.5 ? 'bad' : ''}">${sgn(Math.abs(r.up.side_force_N) - Math.abs(r.base.side_force_N), 1)}</td></tr>`).join('')}
      <tr class="tot"><td title="${esc(YAW_BASIS)}">Weighted</td><td></td><td></td><td class="${wd.dCdA < 0 ? 'good' : 'bad'}">${sgn(wd.dCdA * 1e4, 0)}<small>e-4 m²</small></td><td>${wd.coverage < 0.999 ? `<small class="muted">${Math.round(wd.coverage * 100)} % of time</small>` : ''}</td><td></td></tr>
    </tbody></table>
    <table class="study" style="margin-top:8px"><thead><tr><th>Speed</th><th>Installed W</th><th>Upgrade W</th><th>Air</th><th>Rolling</th></tr></thead><tbody>
      ${g.at.map((r) => `<tr><td>${r.kmh} km/h</td><td>${r.base_W.toFixed(0)}</td><td>${r.up_W.toFixed(0)}</td><td class="${r.aero_W > 0 ? 'good' : 'bad'}">${W(-r.aero_W)}</td><td class="${r.rolling_W > 0 ? 'good' : 'bad'}">${W(-r.rolling_W)}</td></tr>`).join('')}
    </tbody></table>
    <div class="kpis" style="margin-top:8px">
      ${kpi('Aero only', `${sgn(gAero.kmhUp - gAero.kmhBase, 2)} km/h`, 'wheels + tyre shape', '', 'Speed change from the tunnel ΔCdA alone (centre of the resolution band), rolling resistance unchanged.')}
      ${kpi('Tyres only', `${sgn(gRoll.kmhUp - gRoll.kmhBase, 2)} km/h`, `Crr ${g.crrBase.toFixed(4)} → ${g.crrUp.toFixed(4)}`, '', 'Speed change from rolling resistance alone: Rubino Pro (butyl tube, drum) against GP5000 AS TR 28 (tubeless drum figure plus the butyl-tube penalty, since the Superteam rims are tube-only).')}
      ${kpi('Climb cost', `${perG.toFixed(1)} s`, 'per 100 g · 5 km at 6 %', '', g.massKnown ? `Mass change of the proposal ${Math.round(g.deltaMass_g)} g.` : 'The Rubino Pro and Fulcrum are not weighed, so the mass change is unknown and the flat-road numbers hold mass equal. The Superteam listing claims 1,560–1,760 g against ~1,650 g for the Racing; the 28 mm tyres add ~230 g over typical 23 mm tyres.')}
      ${kpi('Tunnel noise', se ? `±${(2 * se / (0.5 * 1.204 * (40 / 3.6) ** 2) * 1e4).toFixed(0)}e-4` : '±0.5 %', 'm² CdA, 2σ', '', 'Two-sigma from batch means of the averaging window; two independent runs of the installed build agreed within 0.041 N (0.5 %).')}
    </div>
    <p class="foot" title="${esc(tip)}">Tunnel Δ × ${RESOLUTION.mid} for resolution (band ${RESOLUTION.lo}–${RESOLUTION.hi}) · ${g.position.toLowerCase()} CdA ${g.cdaBase.toFixed(3)} m² · ${P.rider_kg + P.kit_kg} kg rider · static wheels, no spokes · <abbr>basis</abbr></p>
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

/** The colour key that sits on the stage (phones included). */
export function aeroKey() {
  const a = L.aero; if (!a) return '';
  const row = (name, ramp, ticks, unit) => `<div class="k"><b>${name}<em>${unit}</em></b><div class="kbar" style="background:${rampCSS(ramp)}"></div><div class="kt">${ticks.map((t) => `<span>${t}</span>`).join('')}</div></div>`;
  const out = [];
  const [c0, c1] = SURFACE_CP, f = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  if (L.show.surface) out.push(row('Surface pressure', 'cfd', [`≤${f(c0)}`, '0', `≥${f(c1)}`], 'Cp'));
  if (L.show.particles || L.show.lines) out.push(row('Air speed', 'flow', ['0', '1', '1.5'], '|U| / U∞'));
  if (L.show.unsteady && L.uSheet && a.hasUnsteady) out.push(row('Spin, centre plane', 'swirl', ['cw', '0', 'ccw'], 'ω<sub>z</sub>'));
  else if ((L.show.vortex || (L.show.unsteady && L.uCores)) && a.volume) out.push(row('Vortex cores', 'vort', ['slow', '', 'fast'], 'spin'));
  if (L.cut !== 'off' && a.volume) { const LEG = { speed: ['Cut: speed', '|U| / U∞'], cp: ['Cut: pressure', 'Cp'], loss: ['Cut: loss', '1 − Cp₀'], vort: ['Cut: vorticity', '1/s'] }[L.field]; const r = a.volume.F[L.field]?.range ?? [0, 1]; out.push(row(LEG[0], FIELD_RAMP[L.field], [r[0].toFixed(L.field === 'vort' ? 0 : 1).replace('-', '−'), '', r[1].toFixed(L.field === 'vort' ? 0 : 1)], LEG[1])); }
  return out.join('');
}

// ---- events --------------------------------------------------------------------------------------
export function handle(e, b, api) {
  const d = b?.dataset ?? e.target.dataset;
  if (d.cadt === 'replay') { L.cad?.replay(); api.redraw(); return true; }
  if (d.cadt) { L[d.cadt] = !L[d.cadt]; if (d.cadt === 'clay') L.cad?.setClay(L.clay); else L.cad?.setEdges(L.edges); api.redraw(); api.render(); return true; }
  if (d.cadp) { const p = L.cad?.doc.parts.find((x) => x.name === d.cadp); L.part = L.cad?.select(p) ?? null; api.redraw(); api.render(); return true; }
  if (d.grp) { L.group = L.group === d.grp ? null : d.grp; L.aero?.highlight(L.group ? api.groups[L.group] : null); api.redraw(); api.render(); return true; }
  if (d.ash === 'unsteady') { L.show.unsteady = !L.show.unsteady; applyUnsteady().then(() => { api.redraw(); api.render(); }); api.render(); return true; }
  if (d.ash === 'rolling') { L.show.rolling = !L.show.rolling; L.aero?.setRolling(L.show.rolling, api.gearRatio()); api.redraw(); api.render(); return true; }
  if (d.ash) { L.show[d.ash] = !L.show[d.ash]; L.aero?.show(d.ash, L.show[d.ash]); api.redraw(); api.render(); return true; }
  if (d.auns) { if (d.auns === 'cores') L.uCores = !L.uCores; else L.uSheet = !L.uSheet; applyUnsteady(); api.redraw(); api.render(); return true; }
  if (d.afield) { L.field = d.afield; L.aero?.setField(L.field); api.redraw(); api.render(); return true; }
  if (d.ayaw) { if (d.ayaw !== L.aeroCase) { L.aeroCase = d.ayaw; api.reloadAero(); } return true; }
  if (d.aproto) {
    const yaw = L.aero?.cfd.summary.assumptions.yaw_deg ?? 0, inP = L.cases.filter((c) => proto(c) === d.aproto);
    const pref = d.aproto === 'standard' ? MATRIX[0].cad : BASE_CAD, pool = inP.filter((c) => (c.cad || BASE_CAD) === pref).length ? inP.filter((c) => (c.cad || BASE_CAD) === pref) : inP;
    const to = pool.find((c) => c.yaw_deg === yaw) || pool[0];
    if (to && to.case !== L.aeroCase) { L.aeroCase = to.case; api.reloadAero(); }
    return true;
  }
  if (d.acfg) {
    const pr = L.aero?.cfd.summary.assumptions.protocol || 'static';
    const yaw = L.aero?.cfd.summary.assumptions.yaw_deg ?? 0, inCfg = L.cases.filter((c) => (c.cad || BASE_CAD) === d.acfg && proto(c) === pr);
    const to = inCfg.find((c) => c.yaw_deg === yaw) || inCfg.sort((x, y) => Math.abs(x.yaw_deg - yaw) - Math.abs(y.yaw_deg - yaw))[0];
    if (to && to.case !== L.aeroCase) { L.aeroCase = to.case; api.reloadAero(); }
    return true;
  }
  if (d.study) { L.studyOpen = !L.studyOpen; api.render(); return true; }
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
/** Unsteady playback replaces the time-averaged vortex surface while it runs. */
export async function applyUnsteady() {
  const a = L.aero; if (!a?.hasUnsteady) return;
  const on = L.show.unsteady;
  a.unsteady.setParts(L.uCores, L.uSheet);
  if (on && a.unsteady.level !== L.uLevel && a.unsteady.ready) a.unsteady.setLevel(L.uLevel); else a.unsteady.level = L.uLevel;
  a.show('vortex', on ? false : L.show.vortex);
  await a.unsteady.setOn(on);
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
  if (t.hasAttribute('data-auns-level')) { L.uLevel = Number(t.value); t.nextElementSibling.textContent = `${Math.round(L.uLevel * 100)} %`; clearTimeout(isoTimer); isoTimer = setTimeout(() => { L.aero?.unsteady.setLevel(L.uLevel); api.redraw(); }, 150); return true; }
  if (t.dataset.fe2 === 'scale') { L.scale = Number(t.value); L.fe?.setScale(L.scale); t.nextElementSibling.textContent = `×${L.scale}`; api.redraw(); return true; }
  return false;
}
