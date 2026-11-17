// URL state: the component configuration (slot=id) and the free parameters (p.key=value).
import { checkConfig, interfaces } from './compat.js';

// ---- free parameters ---------------------------------------------------------------------------
// Fit values default from data/geometry.json (fit_defaults); the rest default here.
export const PARAMS = {
  // paint
  paint: { type: 'enum', options: ['stock', 'stealth', 'team', 'custom'], def: 'stock' },
  c1: { type: 'color', def: '#f3f3f0' }, c2: { type: 'color', def: '#c41230' }, c3: { type: 'color', def: '#111214' },
  decals: { type: 'bool', def: true },
  tape: { type: 'color', def: '#161618' },
  // fit
  saddle_height_mm: { type: 'num', min: 600, max: 800, step: 1 }, saddle_setback_mm: { type: 'num', min: -20, max: 40, step: 1 },
  spacers_mm: { type: 'num', min: 0, max: 40, step: 5 }, stem_length_mm: { type: 'num', min: 70, max: 130, step: 10 },
  stem_angle_deg: { type: 'num', min: -17, max: 17, step: 1 }, bar_width_mm: { type: 'num', min: 380, max: 440, step: 20 },
  crank_length_mm: { type: 'num', min: 165, max: 175, step: 2.5 },
  // pose
  ring: { type: 'enum', options: ['big', 'small'], def: 'big' }, cog: { type: 'num', min: 0, max: 9, step: 1, def: 4 },
  crank_deg: { type: 'num', min: 0, max: 360, step: 1, def: 20 }, steer_deg: { type: 'num', min: -40, max: 40, step: 1, def: 0 },
  bottles: { type: 'bool', def: true },
  // rider and conditions (analysis)
  rider_kg: { type: 'num', min: 40, max: 130, step: 1, def: 75 }, kit_kg: { type: 'num', min: 0, max: 15, step: 0.5, def: 3 },
  bike_kg: { type: 'num', min: 0, max: 15, step: 0.1, def: 0 }, // 0 = not weighed
  power_w: { type: 'num', min: 50, max: 500, step: 5, def: 200 }, grade_pct: { type: 'num', min: -5, max: 15, step: 0.5, def: 0 },
  position: { type: 'enum', options: ['tops', 'hoods', 'drops', 'aero'], def: 'hoods' },
  temp_c: { type: 'num', min: -10, max: 40, step: 1, def: 20 }, altitude_m: { type: 'num', min: 0, max: 3000, step: 10, def: 220 },
  cadence: { type: 'num', min: 60, max: 120, step: 1, def: 90 },
};

export function defaultParams(fitDefaults = {}) {
  const out = {};
  for (const [k, s] of Object.entries(PARAMS)) out[k] = s.def ?? fitDefaults[k];
  return out;
}

function coerce(spec, raw) {
  if (spec.type === 'bool') return raw === '1' ? true : raw === '0' ? false : undefined;
  if (spec.type === 'enum') return spec.options.includes(raw) ? raw : undefined;
  if (spec.type === 'color') return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= spec.min && v <= spec.max ? v : undefined;
}

export function decodeParams(hash, fitDefaults = {}) {
  const out = defaultParams(fitDefaults);
  for (const [k, raw] of new URLSearchParams((hash ?? '').replace(/^#/, ''))) {
    if (!k.startsWith('p.')) continue;
    const spec = PARAMS[k.slice(2)];
    const v = spec && coerce(spec, raw);
    if (v !== undefined) out[k.slice(2)] = v;
  }
  return out;
}

const isMeta = (k) => k.startsWith('p.') || k === 'view';

// ---- component configuration --------------------------------------------------------------------
// Optional slots are removed with slot=none. Invalid URLs return the installed configuration.
export function decodeConfig(hash, catalog) {
  const cfg = { ...catalog.default_config }, slots = new Map(catalog.slots.map((s) => [s.id, s])), parts = new Map(catalog.components.map((p) => [p.id, p]));
  const seen = new Set();
  for (const [slot, id] of new URLSearchParams((hash ?? '').replace(/^#/, ''))) {
    if (isMeta(slot)) continue;
    if (seen.has(slot)) return { ...catalog.default_config };
    seen.add(slot);
    const s = slots.get(slot);
    if (!s) return { ...catalog.default_config };
    if (id === 'none' && s.optional) { delete cfg[slot]; continue; }
    if (parts.get(id)?.slot !== slot) return { ...catalog.default_config };
    cfg[slot] = id;
  }
  return checkConfig(cfg, parts).some((i) => i.level === 'error') ? { ...catalog.default_config } : cfg;
}

/** Only what differs from the installed build and the default parameters is written. */
export function encodeConfig(cfg, catalog, params = null, fitDefaults = {}, view = null) {
  const q = new URLSearchParams();
  for (const s of catalog?.slots ?? Object.keys(cfg).map((id) => ({ id }))) {
    const id = cfg[s.id], def = catalog?.default_config?.[s.id];
    if (!id && s.optional && def) q.set(s.id, 'none');
    else if (id && id !== def) q.set(s.id, id);
  }
  if (params) {
    const d = defaultParams(fitDefaults);
    for (const [k, v] of Object.entries(params)) if (PARAMS[k] && v !== d[k]) q.set('p.' + k, PARAMS[k].type === 'bool' ? (v ? '1' : '0') : String(v));
  }
  if (view) q.set('view', view);
  return '#' + q.toString();
}

/**
 * Apply one change. If it breaks an interface, look for a single companion change in another slot
 * that repairs it (a crank that needs a different bottom bracket, carbon rims that need carbon pads).
 * Returns {cfg, also: [{slot, id}]} or {blocked: issues}.
 */
export function applyChange(cfg, slot, id, catalog) {
  const parts = new Map(catalog.components.map((p) => [p.id, p]));
  const next = { ...cfg };
  if (id) next[slot] = id; else delete next[slot];
  const errors = (c) => checkConfig(c, parts).filter((i) => i.level === 'error');
  let bad = errors(next);
  if (!bad.length) return { cfg: next, also: [] };
  const keys = new Set(bad.map((i) => i.key).filter(Boolean));
  for (const other of catalog.slots) {
    if (other.id === slot) continue;
    const options = catalog.components.filter((p) => p.slot === other.id && p.id !== next[other.id]
      && (Object.keys(p.provides ?? {}).some((k) => keys.has(k)) || (p.requires ?? []).some((r) => keys.has(r.key))));
    options.sort((a, b) => (a.status === 'installed' ? -1 : 0) - (b.status === 'installed' ? -1 : 0));
    for (const alt of options) {
      const trial = { ...next, [other.id]: alt.id };
      if (!errors(trial).length) return { cfg: trial, also: [{ slot: other.id, id: alt.id }] };
    }
  }
  return { blocked: bad };
}

export function summarize(cfg, catalog) {
  const parts = new Map(catalog.components.map((p) => [p.id, p]));
  const selected = Object.values(cfg).map((id) => parts.get(id)).filter(Boolean);
  const knownMass = selected.filter((p) => Number.isFinite(p.mass_g));
  const unknownMass = selected.length - knownMass.length;
  const changed = catalog.slots.filter((s) => cfg[s.id] !== catalog.default_config[s.id]);
  const delta = (key) => {
    let total = 0;
    for (const s of changed) {
      const a = parts.get(catalog.default_config[s.id]), b = parts.get(cfg[s.id]);
      if ((a && !Number.isFinite(a[key])) || (b && !Number.isFinite(b[key]))) return null;
      total += (b?.[key] ?? 0) - (a?.[key] ?? 0);
    }
    return total;
  };
  // What the proposal costs to buy: every changed slot's new part. Null if any price is unknown.
  let cost = 0;
  for (const s of changed) { const b = parts.get(cfg[s.id]); if (!b) continue; if (!Number.isFinite(b.price_usd)) { cost = null; break; } cost += b.price_usd; }
  const { provided } = interfaces(cfg, parts);
  const v = (k) => provided.get(k)?.value;
  const gearMin = v('ring_small') / v('cog_max'), gearMax = v('ring_big') / v('cog_min');
  return {
    knownMass_g: knownMass.reduce((a, p) => a + p.mass_g, 0), unknownMassCount: unknownMass,
    totalMass_g: unknownMass ? null : knownMass.reduce((a, p) => a + p.mass_g, 0),
    deltaMass_g: delta('mass_g'), deltaPrice_usd: delta('price_usd'), cost_usd: cost,
    gearMin: Number.isFinite(gearMin) ? gearMin : null, gearMax: Number.isFinite(gearMax) ? gearMax : null,
    deltaCdA_m2: null, changedCount: changed.length, changed: changed.map((s) => s.id),
  };
}
