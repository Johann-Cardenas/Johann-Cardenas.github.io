// Application controller: state, URL, the 3D stage and the Build panel.
import { checkConfig, worst } from './compat.js';
import { decodeConfig, encodeConfig, decodeParams, defaultParams, applyChange, summarize, PARAMS } from './state.js';
import { PAINT_SCHEMES } from './geo/materials.js';
import * as views from './views.js';
import * as panels from './panels.js';
import { cadScene, aeroScene, feScene, loadPack } from './labs.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = {
  g: (v) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('en-US')} g` : '—'),
  usd: (v) => (Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : '—'),
  dg: (v) => (v == null ? 'unknown' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')} g`),
  n: (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'),
};
export const EVIDENCE = { C: 'Confirmed by owner', L: 'Listing / seller', S: 'Stock or published reference, unverified on this bike', M: 'Must be measured' };
export const badge = (c) => `<span class="badge ${String(c).toLowerCase()}" title="${esc(EVIDENCE[c] || '')}">${esc(c)}</span>`;
const LAYOUT = { build: 'stage', cad: 'stage', aero: 'stage', structure: 'stage', upgrades: 'page', gearing: 'page', spec: 'page' };
const LEGACY = { performance: 'aero', geometry: 'build' };
const REBUILD = new Set(['paint', 'c1', 'c2', 'c3', 'decals', 'tape', 'saddle_height_mm', 'saddle_setback_mm', 'spacers_mm', 'stem_length_mm', 'stem_angle_deg', 'bar_width_mm', 'crank_length_mm', 'ring', 'cog', 'steer_deg', 'bottles']);

export const S = {
  geom: null, catalog: null, parts: null, history: null, measurements: [],
  cfg: null, P: null, view: 'build', showInstalled: false, selected: null, viewer: null,
  fe: { lc: 'pedalling', E: 65, wall: 1, gain: 1, field: 'vm' },
  open: new Set(['Rolling']),
};
export const effCfg = () => (S.showInstalled ? S.catalog.default_config : S.cfg);
export const slotLabel = (id) => S.catalog.slots.find((s) => s.id === id)?.label ?? id;
export const status = (msg) => { $('#status').textContent = msg; };

// ---- state changes ------------------------------------------------------------------------------
let rebuildTimer = 0;
function writeHash() { history.replaceState(null, '', encodeConfig(S.cfg, S.catalog, S.P, S.geom.fit_defaults, S.view === 'build' ? null : S.view)); }
export function rebuild3D(now = false) {
  clearTimeout(rebuildTimer);
  const go = () => { if (!S.viewer) return; S.viewer.setConfig(effCfg(), S.catalog, S.P); if (S.view === 'structure' && panels.L.structMode === 'beam') views.runFE(); };
  if (now) go(); else rebuildTimer = setTimeout(go, 70);
}
/** Change one free parameter. `soft` skips re-rendering the panel (a slider being dragged). */
export function setParam(key, value, { soft = false } = {}) {
  if (S.P[key] === value) { if (!soft) render(); return; }
  S.P[key] = value; writeHash();
  if (key === 'crank_deg') S.viewer?.setCrank(value);
  else if (REBUILD.has(key)) rebuild3D();
  if (!soft) render();
}
export function setSlot(slot, id) {
  const r = applyChange(S.cfg, slot, id || null, S.catalog);
  if (r.blocked) { status(`Not compatible: ${r.blocked[0].msg}`); render(); return false; }
  S.cfg = r.cfg; S.showInstalled = false;
  status(r.also.length ? `Also changed ${r.also.map((a) => slotLabel(a.slot)).join(', ')} to keep the build compatible.` : 'Proposal updated.');
  writeHash(); rebuild3D(true); render();
  return true;
}
export function setConfig(cfg, msg) { S.cfg = { ...cfg }; S.showInstalled = false; writeHash(); rebuild3D(true); render(); if (msg) status(msg); }
export function go(view) {
  view = LEGACY[view] || view;
  if (!LAYOUT[view]) view = 'build';
  S.view = view; writeHash(); render(); syncStage();
}

// ---- stage --------------------------------------------------------------------------------------
const toggles = { dims: false, tech: false, spin: false, pedal: false };
const P = panels.L;
const panelApi = { redraw: () => S.viewer?.redraw(), render: () => render(), sync: () => syncStage(), groups: {} };
async function ensure(kind) {
  const theme = document.documentElement.dataset.theme;
  try {
    if (kind === 'cad' && !P.cad) {
      [P.cad, P.sw] = await Promise.all([cadScene(theme), fetch('data/cad/solidworks.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
      P.cad.setEdges(P.edges); P.cad.setClay(P.clay);
    } else if (kind === 'aero' && !P.aero && !P.aeroMissing) {
      try { P.aero = await aeroScene(P.aeroCase, theme); } catch { P.aeroMissing = true; }
      if (P.aero) { for (const [k, on] of Object.entries(P.show)) P.aero.show(k, on); P.aero.setField(P.field); panelApi.groups = await fetch('data/cfd/groups.json').then((r) => r.json()).catch(() => ({})); }
    } else if (kind === 'fe' && !P.fe) {
      P.fe = await feScene(theme); P.fe.setScale(P.scale); P.fe.setCase(P.feCase);
    }
  } catch (err) { console.error(err); status(`Could not load ${kind} results.`); }
}
let lastScene = null;
async function syncStage() {
  const v = S.viewer; if (!v) return;
  const view = S.view, beam = view === 'structure' && P.structMode === 'beam';
  const kind = view === 'cad' ? 'cad' : view === 'aero' ? 'aero' : view === 'structure' && !beam ? 'fe' : null;
  $('#legend').hidden = !beam;
  if (view !== 'build') hideCard();
  if (kind) {
    await ensure(kind);
    if (S.view !== view) return; // the user moved on while it loaded
    const sc = { cad: P.cad, aero: P.aero, fe: P.fe }[kind];
    if (sc) {
      v.setMode('custom');
      v.setCustom(sc.group, { animate: (dt, t) => sc.animate(dt, t), fitTo: sc.bounds || sc.group, pick: kind === 'cad' ? (part, how) => { if (how === 'click') { P.part = P.cad.select(part); render(); } } : null });
      if (lastScene !== kind) { v.preset('quarter'); lastScene = kind; }
    } else { v.setCustom(null); v.setMode('studio'); lastScene = null; }
    if (kind === 'cad' && P.cad) P.cad.replay();
  } else {
    v.setCustom(null); lastScene = null;
    v.setMode(beam ? 'fe' : toggles.tech ? 'technical' : 'studio');
    if (beam) { views.runFE(); v.preset('quarter'); }
  }
  v.dimensions(view === 'build' && toggles.dims);
  v.turntable(toggles.spin); v.pedal(toggles.pedal && view === 'build');
  $$('.rb-views [data-tog]').forEach((b) => b.setAttribute('aria-pressed', String(toggles[b.dataset.tog])));
  if (LAYOUT[S.view] === 'stage') render();
}
function hideCard() { $('#card').hidden = true; S.selected = null; S.viewer?.select(null); }
function showCard(slot, partName) {
  const id = effCfg()[slot], p = S.parts.get(id), el = $('#card');
  if (!p) { hideCard(); return; }
  S.selected = slot;
  const issues = checkConfig(effCfg(), S.parts).filter((i) => i.slot === slot);
  const kv = (o) => Object.entries(o).map(([k, v]) => `<dt>${esc(k.replaceAll('_', ' '))}</dt><dd>${v == null ? '<span class="muted">not measured</span>' : esc(Array.isArray(v) ? v.join(' / ') : v)}</dd>`).join('');
  el.innerHTML = `
    <header><b>${esc(p.name)}</b><button data-x title="Close" aria-label="Close">×</button></header>
    <p class="sub">${esc(slotLabel(slot))} · ${p.status === 'installed' ? 'installed' : 'proposed'} ${badge(p.confidence)}</p>
    <div class="cmass"><b>${Number.isFinite(p.mass_g) ? Math.round(p.mass_g).toLocaleString('en-US') : '—'}</b><span>g</span><i>${esc(p.mass_source || 'Not weighed. No reference mass is assumed.')}</i></div>
    <dl>${partName ? `<dt>picked</dt><dd>${esc(partName)}</dd>` : ''}<dt>price</dt><dd>${p.price_usd == null ? '—' : fmt.usd(p.price_usd) + ' approx.'}</dd></dl>
    ${Object.keys(p.provides || {}).length ? `<h4>Interfaces</h4><dl>${kv(p.provides)}</dl>` : ''}
    ${issues.map((i) => `<div class="issue ${i.level}">${esc(i.msg)}</div>`).join('')}
    ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ''}
    ${p.upgrade ? `<h4>Why consider it</h4><p class="note" style="margin-top:2px">${esc(p.upgrade.why)}</p>` : ''}
    <footer><button data-iso aria-pressed="false">Isolate</button><button data-focus>Zoom to</button><button data-opts>Options</button>${p.url ? `<a class="small" style="align-self:center;margin-left:auto" href="${esc(p.url)}" target="_blank" rel="noopener">Source</a>` : ''}</footer>`;
  el.hidden = false;
  el.querySelector('[data-x]').onclick = () => { S.viewer.isolate(null); hideCard(); };
  el.querySelector('[data-iso]').onclick = (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); S.viewer.isolate(on ? slot : null); };
  el.querySelector('[data-focus]').onclick = () => S.viewer.focus(slot);
  el.querySelector('[data-opts]').onclick = () => { const g = S.catalog.slots.find((s) => s.id === slot)?.group; if (g) S.open.add(g); if (S.view !== 'build') go('build'); else render(); requestAnimationFrame(() => $(`[data-slot="${slot}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })); };
}

// ---- build panel --------------------------------------------------------------------------------
function optionState(slot, id) {
  const r = applyChange(S.cfg, slot, id, S.catalog);
  if (r.blocked) return { level: 'error', text: 'Not compatible', title: r.blocked[0].msg };
  const issues = checkConfig(r.cfg, S.parts).filter((i) => i.slot === slot), lvl = worst(issues);
  const also = r.also.length ? ` Selecting it also changes ${r.also.map((a) => slotLabel(a.slot)).join(', ')}.` : '';
  const text = { ok: 'Fits', warn: 'Check', info: 'Measure' }[lvl] + (r.also.length ? ' +1' : '');
  return { level: lvl, text, title: (issues.map((i) => i.msg).join(' ') || 'No interface issues.') + also };
}
const P0 = (v) => Math.round(v);
function buildPanel() {
  const cfg = effCfg(), sum = summarize(cfg, S.catalog), issues = checkConfig(cfg, S.parts);
  const hard = issues.filter((i) => i.level !== 'info'), info = issues.filter((i) => i.level === 'info');
  const ro = S.showInstalled ? 'disabled' : '';
  const groups = [...new Set(S.catalog.slots.map((s) => s.group))];
  const groupHTML = groups.map((g) => {
    const slots = S.catalog.slots.filter((s) => s.group === g);
    const changed = slots.filter((s) => cfg[s.id] !== S.catalog.default_config[s.id]).length;
    return `<details class="grp" data-g="${esc(g)}" ${S.open.has(g) ? 'open' : ''}><summary>${esc(g)}<em class="${changed ? 'chg' : ''}">${changed ? `${changed} changed` : `${slots.length} ${slots.length > 1 ? 'slots' : 'slot'}`}</em></summary>
      ${slots.map((s) => {
        const opts = S.catalog.components.filter((p) => p.slot === s.id);
        return `<div class="slot" data-slot="${s.id}"><h3>${esc(s.label)}<button class="ghost" data-focus="${s.id}">Show</button></h3>
          ${s.optional ? `<label class="opt"><input type="radio" name="${s.id}" value="" ${!cfg[s.id] ? 'checked' : ''} ${ro}><span class="nm">None</span><span></span></label>` : ''}
          ${opts.map((p) => {
            const st = cfg[s.id] === p.id ? { level: worst(issues.filter((i) => i.slot === s.id)), text: 'Selected', title: issues.filter((i) => i.slot === s.id).map((i) => i.msg).join(' ') } : optionState(s.id, p.id);
            return `<label class="opt ${st.level === 'error' ? 'blocked' : ''}" title="${esc([p.upgrade?.why, st.title].filter(Boolean).join(' · '))}"><input type="radio" name="${s.id}" value="${p.id}" ${cfg[s.id] === p.id ? 'checked' : ''} ${ro}>
              <span class="nm">${esc(p.name)}</span><span class="st ${st.level}">${esc(st.text)}</span>
              <span class="meta">${badge(p.confidence)}<span>${fmt.g(p.mass_g)}</span><span>${p.price_usd == null ? (p.status === 'installed' ? 'installed' : 'price —') : fmt.usd(p.price_usd)}</span></span>
              </label>`;
          }).join('')}</div>`;
      }).join('')}</details>`;
  }).join('');
  const P = S.P, L = S.viewer?.info?.layout;
  const scheme = (k, v) => `<button class="scheme" data-paint="${k}" aria-pressed="${P.paint === k}"><span><i class="dot" style="background:${v.c1}"></i><i class="dot" style="background:${v.c2}"></i><i class="dot" style="background:${v.c3}"></i></span>&nbsp;${esc(v.label)}</button>`;
  const tapes = ['#161618', '#f1f1ee', '#c41230', '#1d4ed8', '#18a9a8'];
  const slider = (key, label, unit, f = (v) => v) => { const sp = PARAMS[key]; return `<div class="row"><label for="p_${key}">${label}</label><input id="p_${key}" type="range" data-p="${key}" min="${sp.min}" max="${sp.max}" step="${sp.step}" value="${P[key]}"><span class="val" data-v="${key}">${f(P[key])}${unit}</span></div>`; };
  $('#panel').innerHTML = `
    <div class="sec">
      <div class="rb-seg" style="display:flex;margin-bottom:12px"><button style="flex:1" data-mode="installed" aria-pressed="${S.showInstalled}">Installed</button><button style="flex:1" data-mode="proposal" aria-pressed="${!S.showInstalled}">Proposal${sum.changedCount && !S.showInstalled ? ` · ${sum.changedCount}` : ''}</button></div>
      <div class="kpis">
        <div class="kpi"><span>Parts to buy</span><b>${sum.changedCount}</b><small>${sum.changedCount ? (sum.cost_usd == null ? 'a price is unknown' : fmt.usd(sum.cost_usd) + ' approx.') : 'installed build'}</small></div>
        <div class="kpi ${sum.deltaMass_g < 0 ? 'good' : ''}"><span>Mass change</span><b>${sum.changedCount ? fmt.dg(sum.deltaMass_g) : '0 g'}</b><small>${sum.unknownMassCount} of ${Object.keys(cfg).length} parts unweighed</small></div>
        <div class="kpi"><span>Lowest gear</span><b>${fmt.n(sum.gearMin, 2)}</b><small>ring ÷ cog</small></div>
        <div class="kpi"><span>Highest gear</span><b>${fmt.n(sum.gearMax, 2)}</b><small>ring ÷ cog</small></div>
      </div>
      ${hard.map((i) => `<div class="issue ${i.level}"><b>${esc(slotLabel(i.slot))}.</b> ${esc(i.msg)}</div>`).join('')}
      ${info.length ? `<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">${info.length} item${info.length > 1 ? 's' : ''} waiting on a measurement</summary>${info.map((i) => `<div class="issue"><b>${esc(slotLabel(i.slot))}.</b> ${esc(i.msg)}</div>`).join('')}</details>` : ''}
      <div class="btnrow"><button data-act="share">Copy build link</button><button data-act="reset" ${sum.changedCount ? '' : 'disabled'}>Reset to installed</button><button data-act="upgrades" class="primary">Suggested upgrades</button></div>
    </div>
    ${groupHTML}
    <details class="grp" data-g="Finish" ${S.open.has('Finish') ? 'open' : ''}><summary>Paint &amp; finish<em>${esc(P.paint === 'custom' ? 'Custom' : PAINT_SCHEMES[P.paint].label)}</em></summary><div class="slot">
      <h3>Scheme</h3><div class="swatches">${Object.entries(PAINT_SCHEMES).map(([k, v]) => scheme(k, v)).join('')}<button class="scheme" data-paint="custom" aria-pressed="${P.paint === 'custom'}">Custom</button></div>
      ${P.paint === 'custom' ? `<div class="row two" style="margin-top:8px"><label>Colours</label><span class="swatches"><input type="color" data-c="c1" value="${P.c1}" aria-label="Primary"><input type="color" data-c="c2" value="${P.c2}" aria-label="Accent"><input type="color" data-c="c3" value="${P.c3}" aria-label="Detail"></span></div>` : ''}
      <h3 style="margin-top:12px">Bar tape</h3><div class="swatches">${tapes.map((c) => `<button data-tape="${c}" style="background:${c}" aria-pressed="${P.tape === c}" aria-label="Tape colour ${c}"></button>`).join('')}<input type="color" data-c="tape" value="${P.tape}" aria-label="Custom tape colour"></div>
      <div class="btnrow"><label class="chk"><input type="checkbox" data-b="decals" ${P.decals ? 'checked' : ''}> Decals</label><label class="chk"><input type="checkbox" data-b="bottles" ${P.bottles ? 'checked' : ''}> Bottles</label></div>
    </div></details>
    <details class="grp" data-g="Fit" ${S.open.has('Fit') ? 'open' : ''}><summary>Fit &amp; geometry<em>${P0(S.P.stem_length_mm)} mm stem</em></summary>${views.panels.geometry()}</details>
    <details class="grp" data-g="Pose" ${S.open.has('Pose') ? 'open' : ''}><summary>Pose<em>${L ? `${L.rings[L.ri]} × ${L.cogs[L.ci]}` : ''}</em></summary><div class="slot">
      <div class="row two"><label>Chainring</label><div class="rb-seg"><button data-ring="big" aria-pressed="${P.ring === 'big'}">${L ? L.rings[0] + 'T' : 'Big'}</button><button data-ring="small" aria-pressed="${P.ring === 'small'}">${L ? L.rings[1] + 'T' : 'Small'}</button></div></div>
      ${slider('cog', 'Sprocket', '', (v) => (L ? `${L.cogs[Math.min(v, L.cogs.length - 1)]}T` : v))}
      ${slider('crank_deg', 'Crank angle', '°')}
      ${slider('steer_deg', 'Steering', '°')}
      ${L && L.state !== 'ok' ? `<div class="issue warn">${L.state === 'short' ? 'The chain is too short for this combination: the cage is fully extended.' : 'The cage cannot take up all the slack in this combination.'}</div>` : ''}
      <p class="small muted" style="margin-top:6px">The chain is ${L ? L.links : '—'} links (big–big plus one link pair); the derailleur cage swings to whatever angle uses exactly that length.</p>
    </div></details>`;
}

// ---- render -------------------------------------------------------------------------------------
export function render() {
  const layout = LAYOUT[S.view];
  document.body.dataset.view = S.view; document.body.dataset.layout = layout;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.view)));
  const sum = summarize(S.cfg, S.catalog);
  const sub = { cad: 'SolidWorks assembly', aero: 'Wind tunnel · 40 km/h', structure: P.structMode === 'beam' ? 'Beam model' : 'Abaqus shell model' }[S.view];
  $('#ttl').textContent = S.view === 'build' ? 'Synapse Carbon' : { cad: 'CAD', aero: 'Aerodynamics', structure: 'Structure' }[S.view] ?? 'Synapse Carbon';
  $('#sub').textContent = sub ?? (S.showInstalled || !sum.changedCount ? 'Installed build' : `Proposal · ${sum.changedCount} part${sum.changedCount > 1 ? 's' : ''} changed`);
  const panel = $('#panel'), page = $('#page'), top = panel.scrollTop;
  page.hidden = layout !== 'page';
  if (layout === 'page') page.innerHTML = `<div class="wrap">${views.pages[S.view]()}</div>`;
  else if (S.view === 'build') buildPanel();
  else if (S.view === 'cad') panel.innerHTML = panels.cadPanel();
  else if (S.view === 'aero') panel.innerHTML = panels.aeroPanel();
  else if (S.view === 'structure') panel.innerHTML = panels.structurePanel(views.panels.structure);
  else panel.innerHTML = '';
  panel.scrollTop = top;
  if (S.selected && S.view === 'build') showCard(S.selected);
}

// ---- events -------------------------------------------------------------------------------------
function wire() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
  $('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('roadbike-theme', t); localStorage.setItem('theme-preference', t); } catch { /* private mode */ } S.viewer?.setTheme(t); if (LAYOUT[S.view] === 'page') render(); };
  $('#panelBtn').onclick = () => { document.body.dataset.panel = document.body.dataset.panel === 'off' ? 'on' : 'off'; };
  const bar = $('.rb-views');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !S.viewer) return;
    if (b.dataset.view) S.viewer.preset(b.dataset.view);
    else if (b.dataset.act === 'fit') S.viewer.fit();
    else if (b.dataset.act === 'png') savePNG();
    else if (b.dataset.tog) { toggles[b.dataset.tog] = !toggles[b.dataset.tog]; syncStage(); }
  });
  $('#explode').addEventListener('input', (e) => S.viewer?.explode(e.target.value / 100));
  $('#quality').addEventListener('change', (e) => S.viewer?.setQuality(e.target.value));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey || !S.viewer || LAYOUT[S.view] !== 'stage') return;
    const k = e.key.toLowerCase(), order = ['quarter', 'drive', 'nondrive', 'front', 'rear', 'top'];
    if (k >= '1' && k <= '6') S.viewer.preset(order[+k - 1]);
    else if (k === '0') S.viewer.fit();
    else if (k === 's') savePNG();
    else if ({ d: 'dims', e: 'tech', r: 'spin', p: 'pedal' }[k]) { const t = { d: 'dims', e: 'tech', r: 'spin', p: 'pedal' }[k]; toggles[t] = !toggles[t]; syncStage(); }
  });

  const panel = $('#panel');
  panel.addEventListener('toggle', (e) => { const g = e.target.dataset?.g; if (!g) return; if (e.target.open) S.open.add(g); else S.open.delete(g); }, true);
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'radio' && t.name && S.view === 'build') { setSlot(t.name, t.value); if (t.value) { S.viewer.select(t.name); } }
    else if (t.dataset.b) setParam(t.dataset.b, t.checked);
    else if (t.dataset.c) { if (t.dataset.c !== 'tape') S.P.paint = 'custom'; setParam(t.dataset.c, t.value); }
    else if (t.dataset.p) { setParam(t.dataset.p, Number(t.value)); }
    else views.onChange?.(e);
  });
  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (panels.handleInput(e, panelApi)) return;
    if (t.type === 'range' && t.dataset.p) {
      setParam(t.dataset.p, Number(t.value), { soft: true });
      const out = panel.querySelector(`[data-v="${t.dataset.p}"]`), L = S.viewer?.info?.layout;
      if (out) out.textContent = t.dataset.p === 'cog' && L ? `${L.cogs[Math.min(+t.value, L.cogs.length - 1)]}T` : `${t.value}${t.dataset.u ?? (t.dataset.p.endsWith('_deg') ? '°' : t.dataset.p.endsWith('_mm') ? ' mm' : '')}`;
    } else views.onInput?.(e);
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (panels.handle(e, b, panelApi)) return;
    if (b.dataset.mode) { S.showInstalled = b.dataset.mode === 'installed'; rebuild3D(true); render(); }
    else if (b.dataset.focus) { S.viewer.select(b.dataset.focus); S.viewer.focus(b.dataset.focus); showCard(b.dataset.focus); }
    else if (b.dataset.paint) setParam('paint', b.dataset.paint);
    else if (b.dataset.tape) setParam('tape', b.dataset.tape);
    else if (b.dataset.ring) setParam('ring', b.dataset.ring);
    else if (b.dataset.act === 'share') navigator.clipboard?.writeText(location.href).then(() => status('Build link copied.'), () => status('Copy the link from the address bar.'));
    else if (b.dataset.act === 'reset') setConfig(S.catalog.default_config, 'Back to the installed build.');
    else if (b.dataset.act === 'upgrades') go('upgrades');
    else views.onClick?.(e, b);
  });
  const page = $('#page');
  page.addEventListener('click', (e) => { const b = e.target.closest('button, tr[data-gear], a[data-go]'); if (b) views.onClick?.(e, b); });
  page.addEventListener('change', (e) => views.onChange?.(e));
  page.addEventListener('input', (e) => views.onInput?.(e));
  window.addEventListener('hashchange', () => { load(); rebuild3D(true); render(); syncStage(); });
}
function savePNG() { const a = document.createElement('a'); a.href = S.viewer.png(3840); a.download = `synapse-${S.view}.png`; a.click(); status('Saved a 3840-pixel PNG.'); }
function load() {
  S.cfg = decodeConfig(location.hash, S.catalog);
  S.P = decodeParams(location.hash, S.geom.fit_defaults);
  const v = new URLSearchParams(location.hash.slice(1)).get('view');
  S.view = LAYOUT[LEGACY[v] || v] ? (LEGACY[v] || v) : 'build';
}

async function init() {
  const get = async (p, as = 'json') => { const r = await fetch(p); if (!r.ok) throw new Error(`Cannot load ${p}`); return r[as](); };
  try {
    [S.geom, S.catalog, S.history] = await Promise.all([get('data/geometry.json'), get('data/components.json'), get('data/history.json')]);
    S.measurements = await get('tools/measurements.csv', 'text').then((t) => t.trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(','); return { id: c[0], quantity: c[1], value: c[2], unit: c[3], date: c[4] }; }), () => []);
  } catch (err) { $('#loadmsg').textContent = `${err.message}. Serve this folder over HTTP and reload.`; $('.rb-spin').remove(); return; }
  S.parts = new Map(S.catalog.components.map((p) => [p.id, p]));
  load(); wire(); render();
  try {
    const { createViewer } = await import('./viewer.js');
    S.viewer = createViewer($('#gl'), $('#labels'), S.geom, {
      onPick: (slot, part) => { if (S.view !== 'build') return; if (slot) showCard(slot, part); else { S.viewer.isolate(null); hideCard(); } },
      onHover: (h, e) => {
        const tip = $('#tip'); if (!h || (S.view !== 'build' && !h.custom)) { tip.hidden = true; return; }
        const r = $('#stage').getBoundingClientRect(); tip.hidden = false; tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`;
        tip.textContent = h.custom ? `${(h.custom.name || '').replaceAll('_', ' ')}${h.custom.slot ? ' · ' + h.custom.slot : ''}` : `${slotLabel(h.slot)}${h.part ? ' · ' + h.part : ''}`;
      },
    });
    S.viewer.setTheme(document.documentElement.dataset.theme);
    S.viewer.setConfig(effCfg(), S.catalog, S.P);
    S.viewer.preset('quarter');
    $('#loading').hidden = true;
    render(); syncStage();
    status('Model ready. Click any part to inspect it.');
    window.RB = { S, viewer: S.viewer, go }; // for the banner tool and for poking around in the console
  } catch (err) {
    console.error(err);
    $('#loadmsg').textContent = '3D viewer unavailable in this browser. The analysis tabs still work.'; $('.rb-spin')?.remove();
  }
}
init();
