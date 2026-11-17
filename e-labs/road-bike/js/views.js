// Analysis views: side panels for the 3D stage (Frame FE, Geometry & fit) and full pages
// (Upgrades, Gearing, Performance, Spec sheet).
import { S, $, $$, esc, fmt, badge, effCfg, slotLabel, status, setParam, setSlot, setConfig, go, render, rebuild3D, EVIDENCE } from './app.js';
import { checkConfig, worst, interfaces } from './compat.js';
import { applyChange, summarize, PARAMS } from './state.js';
import { derive, fit } from './model/derived.js';
import { gearTable, steps, range, capacityNeeded, chainLinks, rollout } from './model/gearing.js';
import { compare } from './model/physics.js';
import { setup, evaluate, POSITIONS, CDA_SOURCE, ASSUMED_BIKE_KG } from './model/perf.js';
import { buildModel, loadCases, analyse, stiffness } from './model/frame-fe.js';
import { lineChart, rangeBars, bars } from './charts.js';

const ACC = 'var(--accent)', IND = 'var(--indigo)', GREY = 'var(--ink3)';
const prov = (cfg) => { const { provided } = interfaces(cfg, S.parts); return (k) => provided.get(k)?.value; };
const drivetrain = (cfg) => {
  const v = prov(cfg), cas = S.parts.get(cfg.cassette);
  return { rings: [v('ring_big'), v('ring_small')], cogs: cas?.visual?.cogs ?? [], tireWidth: v('tire_width_mm') ?? 23, rdMax: v('rd_max_cog'), rdCap: v('rd_capacity') };
};
const changed = () => summarize(S.cfg, S.catalog).changedCount > 0;
const input = (key, label, unit = '') => { const sp = PARAMS[key]; return `<div class="row"><label for="i_${key}">${label}</label><input id="i_${key}" type="range" data-p="${key}" data-u="${unit}" min="${sp.min}" max="${sp.max}" step="${sp.step}" value="${S.P[key]}"><span class="val" data-v="${key}">${S.P[key]}${unit}</span></div>`; };

// =================================================================================================
// Upgrades
// =================================================================================================
function upgradesPage() {
  const base = S.catalog.default_config, P = S.P;
  const perfBase = evaluate(setup(base, S.catalog, P), P);
  const bundle = (b) => {
    const cfg = { ...base, ...b.set }, sum = summarize(cfg, S.catalog), issues = checkConfig(cfg, S.parts), lvl = worst(issues.filter((i) => i.level !== 'info'));
    const su = setup(cfg, S.catalog, P), pf = evaluate(su, P), c = compare({ ...perfBase.o, P: P.power_w }, { ...pf.o, P: P.power_w });
    const waiting = issues.filter((i) => i.level === 'info').length;
    return `<article class="cardx bundle"><h2 title="${esc(b.summary)}">${esc(b.title)}</h2>
      <ul>${Object.entries(b.set).map(([slot, id]) => `<li><b>${esc(slotLabel(slot))}:</b> ${esc(S.parts.get(id).name)}</li>`).join('')}</ul>
      ${issues.filter((i) => i.level !== 'info').map((i) => `<div class="issue ${i.level}">${esc(i.msg)}</div>`).join('')}
      <div class="kpis three">
        <div class="kpi"><span>Cost</span><b>${sum.cost_usd == null ? '—' : fmt.usd(sum.cost_usd)}</b><small>${sum.cost_usd == null ? 'a price is unknown' : 'approx.'}</small></div>
        <div class="kpi ${sum.deltaMass_g < 0 ? 'good' : ''}"><span>Mass</span><b>${fmt.dg(sum.deltaMass_g)}</b><small>${sum.deltaMass_g == null ? 'a part is unweighed' : 'vs installed'}</small></div>
        <div class="kpi ${c.dt_s < -0.5 ? 'good' : ''}"><span>40 km at ${P.power_w} W</span><b>${Math.abs(c.dt_s) < 0.5 ? '0 s' : `${c.dt_s < 0 ? '−' : '+'}${fmt.n(Math.abs(c.dt_s))} s`}</b><small>modelled</small></div>
      </div>
      <div class="btnrow"><button class="primary" data-bundle="${b.id}">Apply to proposal</button><span class="st ${lvl === 'ok' ? 'ok' : lvl}" style="align-self:center">${lvl === 'ok' ? 'Interfaces fit' : lvl === 'warn' ? 'Check warnings' : 'Blocked'}</span>${waiting ? `<span class="small muted" style="align-self:center">${waiting} to measure</span>` : ''}</div></article>`;
  };
  const ups = S.catalog.components.filter((p) => p.upgrade).sort((a, b) => a.upgrade.tier - b.upgrade.tier);
  const rowFor = (p) => {
    const r = applyChange(base, p.slot, p.id, S.catalog), inst = S.parts.get(base[p.slot]);
    let st;
    if (r.blocked) st = { l: 'error', t: 'Not compatible', tip: r.blocked[0].msg };
    else { const is = checkConfig(r.cfg, S.parts).filter((i) => i.slot === p.slot), l = worst(is); st = { l, t: { ok: 'Fits', warn: 'Check', info: 'Measure first' }[l], tip: is.map((i) => i.msg).join(' ') + (r.also.length ? ` Needs ${r.also.map((a) => S.parts.get(a.id).name).join(', ')}.` : '') }; }
    const dm = inst && Number.isFinite(inst.mass_g) && Number.isFinite(p.mass_g) ? p.mass_g - inst.mass_g : null;
    const sel = S.cfg[p.slot] === p.id;
    return `<tr class="${sel ? 'sel' : ''}"><td><span class="tier">${p.upgrade.tier}</span></td>
      <td title="${esc([p.upgrade.why, p.notes].filter(Boolean).join(' '))}"><b>${esc(p.name)}</b> ${badge(p.confidence)}${r.also?.length ? `<br><span class="small">Also needs: ${r.also.map((a) => esc(S.parts.get(a.id).name)).join(', ')}</span>` : ''}</td>
      <td>${esc(slotLabel(p.slot))}</td><td><span class="st ${st.l}" title="${esc(st.tip)}">${st.t}</span></td>
      <td class="num">${fmt.g(p.mass_g)}<br><span class="delta ${dm < 0 ? 'pos' : dm > 0 ? 'neg' : ''}">${dm == null ? '' : fmt.dg(dm)}</span></td>
      <td class="num">${fmt.usd(p.price_usd)}</td>
      <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ''}</td>
      <td><button data-add="${p.slot}:${p.id}" ${sel || st.l === 'error' ? 'disabled' : ''}>${sel ? 'In proposal' : 'Add'}</button></td></tr>`;
  };
  const blocked = S.catalog.components.filter((p) => !p.upgrade && p.status === 'candidate' && applyChange(base, p.slot, p.id, S.catalog).blocked);
  return `<div class="intro"><h1>Upgrades</h1><p title="Checked against rim brakes, QR axles, BB30 and 10-speed 105 cable pull. Tyre clearance is unmeasured, so wider tyres stay flagged until M15. Prices approximate, Nov 2026.">Every part checked against this bike’s interfaces.</p></div>
    <div class="grid">${S.catalog.bundles.map(bundle).join('')}</div>
    <article class="cardx" style="margin-top:14px"><h2>All parts</h2>
      <div class="tablewrap"><table><thead><tr><th>Tier</th><th>Part</th><th>Slot</th><th>Fit</th><th class="num">Mass</th><th class="num">Price</th><th></th><th></th></tr></thead><tbody>${ups.map(rowFor).join('')}</tbody></table></div>
      <p class="foot" title="1 wear items due anyway · 2 clear gains · 3 useful with a condition · 4 larger spend · 5 optional or unofficial">Tier 1 → 5 · <abbr>key</abbr></p></article>
    ${blocked.length ? `<article class="cardx" style="margin-top:14px"><h2>Looks compatible, is not</h2>${blocked.map((p) => `<div class="issue error"><b>${esc(p.name)}.</b> ${esc(applyChange(base, p.slot, p.id, S.catalog).blocked[0].msg)} ${esc(p.notes)}</div>`).join('')}</article>` : ''}`;
}

// =================================================================================================
// Gearing
// =================================================================================================
function gearingPage() {
  const P = S.P, cur = drivetrain(effCfg()), inst = drivetrain(S.catalog.default_config), diff = changed() && !S.showInstalled;
  const rows = gearTable({ ...cur, cadence: P.cadence, chainstay: S.geom.chainstay_mm });
  const L = S.viewer?.info?.layout, selRing = P.ring === 'big' ? cur.rings[0] : cur.rings[1], selCog = cur.cogs[Math.min(P.cog, cur.cogs.length - 1)];
  const rg = range(cur.rings, cur.cogs), rgI = range(inst.rings, inst.cogs), cap = capacityNeeded(cur.rings, cur.cogs), links = chainLinks({ ...cur, chainstay: S.geom.chainstay_mm });
  const circ = rollout(cur.tireWidth), maxCog = Math.max(...cur.cogs);
  const table = cur.rings.map((ring) => `<div><table><thead><tr><th>${ring}T ring</th><th class="num">Ratio</th><th class="num">Metres / turn</th><th class="num">km/h at ${P.cadence} rpm</th><th class="num">Chain angle</th></tr></thead><tbody>
    ${rows.filter((r) => r.ring === ring).map((r) => `<tr class="click ${r.ring === selRing && r.cog === selCog ? 'sel' : ''} ${r.cross ? 'dim' : ''}" data-gear="${r.ring === cur.rings[0] ? 'big' : 'small'}:${cur.cogs.indexOf(r.cog)}" title="Show this gear on the 3D model"><td>${r.cog}T${r.cross ? ' · cross-chained' : ''}</td><td class="num">${r.ratio.toFixed(2)}</td><td class="num">${r.development_m.toFixed(2)}</td><td class="num">${r.speed_kmh.toFixed(1)}</td><td class="num">${r.skew_deg.toFixed(1)}°</td></tr>`).join('')}</tbody></table></div>`).join('');
  const barRows = rows.map((r) => ({ label: `${r.ring}×${r.cog}`, lo: r.development_m * 70 * 0.06, hi: r.development_m * 110 * 0.06, mark: r.speed_kmh, color: r.ring === cur.rings[0] ? ACC : IND, dim: r.cross, sel: r.ring === selRing && r.cog === selCog }));
  const st = steps(cur.cogs), stI = steps(inst.cogs);
  const capOK = cur.rdCap == null ? null : cap <= cur.rdCap, cogOK = cur.rdMax == null ? null : maxCog <= cur.rdMax;
  return `<div class="intro"><h1>Gearing</h1><p>${cur.rings.join('/')} × ${Math.min(...cur.cogs)}–${maxCog} · 700 × ${cur.tireWidth} · click a row to shift the 3D model.</p></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">
      <div class="kpi"><span>Range</span><b>${rg.pct.toFixed(0)} %</b><small>${diff ? `installed ${rgI.pct.toFixed(0)} %` : 'highest ÷ lowest'}</small></div>
      <div class="kpi"><span>Lowest gear</span><b>${rg.lo.toFixed(2)}</b><small>${(rg.lo * circ).toFixed(2)} m · ${(rg.lo * circ * 60 * 0.06).toFixed(1)} km/h at 60 rpm</small></div>
      <div class="kpi"><span>Highest gear</span><b>${rg.hi.toFixed(2)}</b><small>${(rg.hi * circ * 100 * 0.06).toFixed(1)} km/h at 100 rpm</small></div>
      <div class="kpi ${capOK === false ? 'bad' : ''}"><span>Chain wrap needed</span><b>${cap}T</b><small>${cur.rdCap == null ? 'derailleur capacity unknown' : `derailleur takes ${cur.rdCap}T`}</small></div>
      <div class="kpi ${cogOK === false ? 'bad' : ''}"><span>Largest sprocket</span><b>${maxCog}T</b><small>${cur.rdMax == null ? 'rating unknown' : `derailleur rated ${cur.rdMax}T`}</small></div>
      <div class="kpi ${L && L.state !== 'ok' ? 'bad' : ''}"><span>Chain length</span><b>${links} links</b><small>big–big plus one pair${L ? ` · cage ${L.state === 'ok' ? 'in range' : L.state === 'short' ? 'over-extended' : 'out of take-up'}` : ''}</small></div>
    </div>
    <div class="grid wide">
      <article class="cardx"><h2>Speed in each gear</h2><p title="Bars span 70–110 rpm; faded = cross-chained">70–110 rpm · tick ${P.cadence} rpm</p>${rangeBars({ rows: barRows, xLabel: 'km/h' })}
        <div class="legendrow"><span><i style="background:${ACC}"></i>${cur.rings[0]}T ring</span><span><i style="background:${IND}"></i>${cur.rings[1]}T ring</span></div>
        <div class="row" style="margin-top:10px"><label for="i_cadence">Cadence</label><input id="i_cadence" type="range" data-p="cadence" data-u=" rpm" min="60" max="120" step="1" value="${P.cadence}"><span class="val" data-v="cadence">${P.cadence} rpm</span></div></article>
      <article class="cardx"><h2>Step between sprockets</h2><p title="Above about 15 % a shift is felt as a jump">% change per shift</p>
        ${bars({ items: st.map((s) => ({ label: `${s.from}→${s.to}`, value: s.pct, color: s.pct > 15 ? 'var(--warn)' : ACC })), yLabel: '% change', fmt: (v) => v.toFixed(0) + '%', w: 520 })}
        ${diff && stI.map((s) => s.to).join() !== st.map((s) => s.to).join() ? `<p class="small muted">Installed ${Math.min(...inst.cogs)}–${Math.max(...inst.cogs)}: largest step ${Math.max(...stI.map((s) => s.pct)).toFixed(0)} %. This cassette: ${Math.max(...st.map((s) => s.pct)).toFixed(0)} %.</p>` : ''}</article>
      <article class="cardx span"><h2>Gear table</h2><div class="grid wide">${table}</div></article>
    </div>`;
}

// =================================================================================================
// Frame FE (panel beside the stage)
// =================================================================================================
let feCache = null;
export function runFE() {
  if (!S.viewer) return;
  const P = S.P, f = S.fe;
  const model = buildModel(S.geom, { laminate: { E: f.E * 1000, wallScale: f.wall }, fitPts: fit(S.geom, P) });
  const rider = { mass_kg: P.rider_kg, crank_mm: P.crank_length_mm, ring: prov(effCfg())('ring_big') ?? 50 };
  const lcs = loadCases(model, rider), lc = lcs[f.lc] ?? lcs.pedalling;
  const res = analyse(model, lc); res.loadList = lc.loads; res.fixedList = lc.fixed;
  const auto = 55 / Math.max(res.umax, 1e-6), scale = auto * f.gain;
  feCache = { model, lcs, lc, res, stiff: stiffness(model, rider), scale };
  S.viewer.showFE({ model, result: res, scale, field: f.field });
  const lg = $('#legend'), peak = res.peak;
  lg.innerHTML = `<b>von Mises, MPa</b><div class="lrow"><div class="bar"></div><div class="ticks"><span>${peak.toFixed(0)}</span><span>${(peak * 0.75).toFixed(0)}</span><span>${(peak / 2).toFixed(0)}</span><span>${(peak / 4).toFixed(0)}</span><span>0</span></div></div><div class="muted" style="margin-top:6px">Deflection ×${scale.toFixed(0)}</div>`;
  if (S.view === 'structure') { const p = $('#panel'), top = p.scrollTop; p.innerHTML = structurePanel(); p.scrollTop = top; }
}
const MEMBER = { seat_tube: 'Seat tube', top_tube: 'Top tube', down_tube: 'Down tube', head_tube: 'Head tube', chainstay: 'Chainstays', seat_stay: 'Seat stays', fork_blade: 'Fork blades', seatpost: 'Seatpost', steerer: 'Steerer', stem: 'Stem' };
function structurePanel() {
  const f = S.fe, c = feCache;
  if (!c) return '<div class="sec"><p class="muted">Solving…</p></div>';
  const { res, lc, stiff, model, lcs } = c, lam = model.laminate;
  const members = Object.entries(res.byMember).sort((a, b) => b[1].vm - a[1].vm);
  const frameOnly = members.filter(([k]) => !['seatpost', 'steerer', 'stem'].includes(k));
  const peakFrame = frameOnly.length ? frameOnly[0][1].vm : 0, resid = Math.max(...res.equilibrium.map(Math.abs));
  return `<div class="sec"><p class="small muted" title="${model.nodes.length} nodes, ${model.elements.length} six-DOF beam elements; thin-walled elliptical sections from the tube table and one equivalent laminate modulus. Recomputed in your browser.">${model.elements.length} beams · recomputed live</p></div>
    <div class="sec"><h2>Load case</h2>
      <div class="row two"><label for="fe_lc">Case</label><select id="fe_lc" data-fe="lc">${Object.entries(lcs).map(([k, v]) => `<option value="${k}" ${k === f.lc ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <p class="foot" title="${esc(lc.note)}">${esc(lc.label)} · <abbr>loads</abbr></p>
      <div class="row"><label for="fe_E">Laminate E</label><input id="fe_E" type="range" data-fe="E" min="40" max="120" step="5" value="${f.E}"><span class="val">${f.E} GPa</span></div>
      <div class="row"><label for="fe_w">Wall thickness</label><input id="fe_w" type="range" data-fe="wall" min="0.6" max="1.8" step="0.1" value="${f.wall}"><span class="val">×${f.wall.toFixed(1)}</span></div>
      <div class="row"><label for="fe_g">Deflection scale</label><input id="fe_g" type="range" data-fe="gain" min="0" max="3" step="0.25" value="${f.gain}"><span class="val">×${c.scale.toFixed(0)}</span></div>
    </div>
    <div class="sec"><h2>Result<em>${esc(lc.label)}</em></h2>
      <div class="kpis">
        <div class="kpi"><span>Peak stress, frame</span><b>${peakFrame.toFixed(0)} MPa</b><small>${esc(MEMBER[frameOnly[0]?.[0]] ?? '')}</small></div>
        <div class="kpi"><span>Largest deflection</span><b>${res.umax.toFixed(2)} mm</b><small>anywhere in the model</small></div>
        <div class="kpi"><span>Reserve</span><b>${(lam.allowable / Math.max(peakFrame, 1e-6)).toFixed(1)}×</b><small>vs assumed ${lam.allowable} MPa</small></div>
        <div class="kpi ${resid < 1e-3 ? 'good' : 'bad'}"><span>Equilibrium check</span><b>${resid.toExponential(1)} N</b><small>loads + reactions</small></div>
      </div>
      <table style="margin-top:10px"><thead><tr><th>Member</th><th class="num">σ MPa</th><th style="width:40%"></th><th class="num">Axial N</th></tr></thead><tbody>
      ${members.map(([k, v]) => `<tr><td>${esc(MEMBER[k] ?? k)}</td><td class="num">${v.vm.toFixed(0)}</td><td><div style="height:8px;border-radius:4px;background:var(--line2)"><div style="height:8px;border-radius:4px;width:${Math.min(100, (v.vm / res.peak) * 100).toFixed(0)}%;background:var(--accent)"></div></div></td><td class="num">${v.axial.toFixed(0)}</td></tr>`).join('')}</tbody></table>

    </div>
    <div class="sec"><h2>Stiffness<em>all cases</em></h2>
      <div class="kpis">
        <div class="kpi"><span>Bottom bracket</span><b>${stiff.bb_N_per_mm.toFixed(0)} N/mm</b><small>pedal force ÷ BB deflection</small></div>
        <div class="kpi"><span>Head-tube torsion</span><b>${stiff.torsion_Nm_per_deg.toFixed(0)} N·m/°</b><small>rear dropouts clamped</small></div>
        <div class="kpi"><span>Saddle, vertical</span><b>${stiff.saddle_N_per_mm.toFixed(0)} N/mm</b><small>lower is more compliant</small></div>
        <div class="kpi"><span>Tube mass in model</span><b>${model.tubeMass_g.toFixed(0)} g</b><small>frame and fork tubes only</small></div>
      </div>

    </div>
`;
}

// =================================================================================================
// Geometry & fit (panel beside the stage)
// =================================================================================================
function geometryPanel() {
  const P = S.P, g = S.geom, tire = prov(effCfg())('tire_width_mm') ?? 23, d = derive(g, { tireWidth: tire, crank: P.crank_length_mm }), f = fit(g, P);
  const row = (k, v, u = 'mm', dgt = 0) => `<tr><td>${k}</td><td class="num">${fmt.n(v, dgt)} ${u}</td></tr>`;
  return `<div class="sec"><h2>Fit</h2>
      ${input('saddle_height_mm', 'Saddle height', ' mm')}${input('saddle_setback_mm', 'Saddle setback', ' mm')}${input('spacers_mm', 'Spacers', ' mm')}${input('stem_length_mm', 'Stem length', ' mm')}${input('stem_angle_deg', 'Stem angle', '°')}${input('bar_width_mm', 'Bar width', ' mm')}${input('crank_length_mm', 'Crank length', ' mm')}
      <table style="margin-top:8px"><tbody>${row('Saddle to bar reach', f.saddle_to_bar_reach_mm)}${row('Saddle to bar drop', f.saddle_to_bar_drop_mm)}${row('Saddle behind BB', f.saddle_behind_bb_mm)}${row('Bar stack from BB', f.bar_stack_mm)}${row('Bar reach from BB', f.bar_reach_mm)}</tbody></table>
      <div class="btnrow"><button data-act="fitreset">Reset fit</button></div></div>
    <div class="sec"><h2>Frame<em>catalog</em></h2><table><tbody>
      ${row('Stack', g.stack_mm)}${row('Reach', g.reach_mm)}${row('Head angle', g.head_angle_deg, '°', 1)}${row('Seat angle', g.seat_angle_deg, '°', 1)}${row('Head tube', g.head_tube_mm)}${row('Seat tube', g.seat_tube_mm)}${row('Chainstay', g.chainstay_mm)}${row('BB drop', g.bb_drop_mm)}${row('Fork rake', g.fork_rake_mm)}</tbody></table></div>
    <div class="sec"><h2>Derived<em>700 × ${tire}</em></h2><table><tbody>
      ${row('Wheelbase', d.wheelbase_mm)}${row('Front centre', d.front_center_mm)}${row('Effective top tube', d.effective_top_tube_mm, 'mm', 1)}${row('Trail', d.trail_mm, 'mm', 1)}${row('Wheel flop', d.wheel_flop_mm, 'mm', 1)}${row('BB height', d.bb_height_mm)}${row('Axle to crown', d.axle_to_crown_mm)}${row('Pedal spindle to tyre', d.spindle_to_tire_mm)}${row('Stack ÷ reach', d.stack_reach_ratio, '', 2)}</tbody></table>
      <p class="small muted" style="margin-top:6px">Pedal spindle to tyre is with the crank level and the wheel straight. Shoe overhang is not assumed, so this is not a toe-overlap verdict.</p></div>
    <div class="sec"><h2>Open discrepancies</h2>${g.discrepancies.map((x) => `<div class="issue warn">${esc(x)}</div>`).join('')}</div>`;
}

// =================================================================================================
// Spec sheet
// =================================================================================================
function specPage() {
  const cfg = effCfg(), sum = summarize(cfg, S.catalog), g = S.geom;
  const sel = S.catalog.slots.filter((s) => cfg[s.id]).map((s) => ({ s, p: S.parts.get(cfg[s.id]) }));
  const done = S.measurements.filter((m) => m.value).length;
  return `<div class="intro"><h1>Spec</h1><p title="Unknown values stay unknown; they are never counted as zero.">${S.showInstalled || !sum.changedCount ? 'Installed build' : `Proposal · ${sum.changedCount} changed`}</p></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
      <div class="kpi"><span>Known mass subtotal</span><b>${fmt.g(sum.knownMass_g)}</b><small>${sum.unknownMassCount} parts unweighed, so this is not the bike’s weight</small></div>
      <div class="kpi"><span>Evidence</span><b>${['C', 'L', 'S', 'M'].map((c) => `${sel.filter((x) => x.p.confidence === c).length}${c}`).join(' · ')}</b><small>confirmed · listing · reference · measure</small></div>
      <div class="kpi"><span>Measurements</span><b>${done} / ${S.measurements.length}</b><small>recorded in tools/measurements.csv</small></div>
      <div class="kpi"><span>Catalog</span><b>${S.catalog.components.length} parts</b><small>${S.catalog.slots.length} slots, ${S.catalog.components.filter((p) => p.status === 'candidate').length} candidates</small></div>
    </div>
    <article class="cardx"><h2>Bill of materials</h2><p>${Object.entries(EVIDENCE).map(([k, v]) => `${badge(k)} ${esc(v)}`).join(' &nbsp; ')}</p>
      <div class="toolbar"><label>Filter<input type="search" id="bomq" placeholder="cassette, 105, measure…"></label><button data-act="csv">Export CSV</button><button data-act="print">Print</button></div>
      <div class="tablewrap"><table id="bom"><thead><tr><th>Slot</th><th>Part</th><th>Evidence</th><th class="num">Mass</th><th class="num">Price</th><th style="min-width:190px">Interfaces</th><th>Notes</th></tr></thead><tbody>
      ${sel.map(({ s, p }) => `<tr><td>${esc(s.label)}</td><td><b>${esc(p.name)}</b><br><span class="small muted">${p.status === 'installed' ? 'installed' : 'proposed'}</span></td><td>${badge(p.confidence)}</td><td class="num">${fmt.g(p.mass_g)}<br><span class="small muted" style="font-family:Inter,sans-serif;white-space:normal;display:block;max-width:180px;margin-left:auto">${esc(p.mass_source ?? '')}</span></td><td class="num">${fmt.usd(p.price_usd)}</td><td class="small">${Object.entries(p.provides).map(([k, v]) => `${esc(k.replaceAll('_', ' '))}: <b>${v == null ? '?' : esc(v)}</b>`).join('<br>')}</td><td class="small muted">${esc(p.notes)}${p.url ? ` <a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ''}</td></tr>`).join('')}</tbody></table></div></article>
    <div class="grid wide" style="margin-top:14px">
      <article class="cardx"><h2>Measurement plan</h2><p>${done} / ${S.measurements.length} recorded</p>
        <div class="tablewrap"><table><thead><tr><th>ID</th><th>Quantity</th><th class="num">Value</th></tr></thead><tbody>${S.measurements.map((m) => `<tr><td class="mono">${esc(m.id)}</td><td>${esc(m.quantity)}</td><td class="num">${m.value ? esc(m.value) + ' ' + esc(m.unit) : '<span class="muted">pending</span>'}</td></tr>`).join('')}</tbody></table></div>
        <div class="btnrow"><a href="tools/measurements.csv" download><button>Download worksheet</button></a></div></article>
      <article class="cardx"><h2>Model status</h2>
        <table><tbody>
          <tr><td>Hardpoints, angles</td><td>${badge('S')} catalog</td></tr>
          <tr><td>Tube heights, paint, components</td><td>${badge('L')} owner photos</td></tr>
          <tr><td>Tube widths, walls, laminate</td><td>${badge('M')} assumed</td></tr>
          <tr><td>SolidWorks assembly</td><td>${badge('C')} 35 parts, volume-checked</td></tr>
          <tr><td>Wind tunnel</td><td>${badge('C')} LBM-LES, 40 km/h</td></tr>
          <tr><td>Frame FE</td><td>${badge('C')} Abaqus shells, 5 cases + modes</td></tr>
        </tbody></table></article>
      <article class="cardx"><h2>History</h2><ul class="timeline">${S.history.events.map((e) => `<li><time>${esc(e.date ?? 'date to record')}</time> ${badge(e.confidence)}<br><b>${esc(e.title)}</b><br><span class="muted">${esc(e.description)}</span></li>`).join('')}</ul></article>
      <article class="cardx"><h2>Geometry source</h2><p>${esc(g.source)}.</p><p class="small"><a href="${esc(g.source_url)}" target="_blank" rel="noopener">Catalog page</a> · ${esc(g.status)}</p>
        ${g.discrepancies.map((x) => `<div class="issue warn">${esc(x)}</div>`).join('')}<p class="small muted" style="margin-top:8px">${esc(g.tubes.status)}</p></article>
    </div>`;
}

export const pages = { upgrades: upgradesPage, gearing: gearingPage, spec: specPage };
export const panels = { structure: structurePanel, geometry: geometryPanel };

// ---- events (delegated from app.js) -------------------------------------------------------------
export function onClick(e, b) {
  const d = b.dataset;
  if (d.bundle) { const bu = S.catalog.bundles.find((x) => x.id === d.bundle); setConfig({ ...S.catalog.default_config, ...bu.set }, `${bu.title} applied to the proposal.`); go('build'); }
  else if (d.add) { const [slot, id] = d.add.split(':'); if (setSlot(slot, id)) status(`${S.parts.get(id).name} added to the proposal.`); }
  else if (d.gear) { const [ring, cog] = d.gear.split(':'); S.P.ring = ring; setParam('cog', Number(cog)); render(); status('Gear set on the 3D model. Open Build to see it.'); }
  else if (d.pos) setParam('position', d.pos);
  else if (d.act === 'fitreset') { for (const k of Object.keys(S.geom.fit_defaults)) if (PARAMS[k]) S.P[k] = S.geom.fit_defaults[k]; setParam('saddle_setback_mm', S.geom.fit_defaults.saddle_setback_mm); rebuild3D(true); render(); }
  else if (d.act === 'print') window.print();
  else if (d.act === 'csv') {
    const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`, cfg = effCfg();
    const rows = [['slot', 'id', 'part', 'status', 'evidence', 'mass_g', 'mass_source', 'price_usd', 'notes'], ...S.catalog.slots.filter((s) => cfg[s.id]).map((s) => { const p = S.parts.get(cfg[s.id]); return [s.id, p.id, p.name, p.status, p.confidence, p.mass_g, p.mass_source, p.price_usd, p.notes]; })];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = 'synapse-build.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
export function onChange(e) {
  const t = e.target;
  if (t.dataset.fe === 'lc') { S.fe.lc = t.value; runFE(); }
  else if (t.dataset.fe) { S.fe[t.dataset.fe] = Number(t.value); runFE(); }
  else if (t.dataset.p) setParam(t.dataset.p, Number(t.value));
}
export function onInput(e) {
  const t = e.target;
  if (t.id === 'bomq') { const q = t.value.toLowerCase(); $$('#bom tbody tr').forEach((r) => { r.hidden = !r.textContent.toLowerCase().includes(q); }); return; }
  if (t.type !== 'range') return;
  if (t.dataset.fe) {
    S.fe[t.dataset.fe] = Number(t.value);
    t.nextElementSibling.textContent = t.dataset.fe === 'E' ? `${t.value} GPa` : `×${Number(t.value).toFixed(t.dataset.fe === 'gain' ? 2 : 1)}`;
  } else if (t.dataset.p) {
    setParam(t.dataset.p, Number(t.value), { soft: true });
    const out = t.parentElement.querySelector('.val'); if (out) out.textContent = `${t.value}${t.dataset.u ?? ''}`;
  }
}
