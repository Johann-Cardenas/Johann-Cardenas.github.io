// Spec sheet for a part: the handful of numbers that matter for its slot, beside the installed part.
// Values come from the part's `specs` first, then from the structured fields every part already has
// (mass, price, interfaces, visual geometry, rolling resistance). Pure, no DOM.

const n = (v) => (Number.isFinite(v) ? v : null);
const each = (p) => (Number.isFinite(p.mass_g) ? p.mass_g / 2 : null);
const pair = (a) => (Array.isArray(a) ? a.join(' / ') : null);

/** [key, label, unit, better ('low' | 'high' | null), fallback(part)] per slot. */
const SHEETS = {
  tires: [
    ['width_mm', 'Width, nominal', 'mm', null, (p) => p.provides?.tire_width_mm],
    ['measured_mm', 'Width, measured', 'mm', null],
    ['mass_each_g', 'Mass, each', 'g', 'low', each],
    ['crr', 'Crr', '', 'low', (p) => n(p.perf?.crr)],
    ['rr_w', 'Rolling loss', 'W/tyre', 'low'],
    ['setup', 'Tested', '', null, (p) => p.perf?.crr_setup ?? (Number.isFinite(p.perf?.crr) ? 'butyl tube' : null)],
    ['puncture', 'Puncture', 'pts', 'high'],
    ['wet_grip', 'Wet grip', 'pts', 'high'],
    ['tread_mm', 'Tread', 'mm', 'high'],
    ['tpi', 'Casing', 'TPI'],
    ['compound', 'Compound'],
    ['breaker', 'Belt'],
    ['pressure', 'Pressure'],
    ['sidewall', 'Sidewall', '', null, (p) => p.visual?.sidewall],
    ['tubeless', 'Tubeless'],
  ],
  wheels: [
    ['depth_mm', 'Rim depth', 'mm', 'high', (p) => (p.visual?.depth ? (p.visual.depthRear ? `${p.visual.depth} / ${p.visual.depthRear}` : p.visual.depth) : null)],
    ['width_ext_mm', 'Width, outer', 'mm', null, (p) => p.visual?.width],
    ['width_int_mm', 'Width, inner', 'mm', null, (p) => p.provides?.rim_internal_mm],
    ['material', 'Rim', '', null, (p) => ({ carbon: 'Carbon', alloy_black: 'Aluminium' }[p.visual?.rim] ?? null)],
    ['brake_track', 'Brake track', '', null, (p) => p.provides?.brake_track],
    ['spokes', 'Spokes F / R', '', null, (p) => pair(p.visual?.spokes)],
    ['lacing', 'Lacing'],
    ['spoke_type', 'Spoke'],
    ['hubs', 'Hubs'],
    ['freehub', 'Freehub', '', null, (p) => p.provides?.freehub],
    ['mass_pair_g', 'Mass, pair', 'g', 'low', (p) => p.mass_g],
    ['tubeless', 'Tubeless'],
  ],
  computer: [
    ['screen', 'Screen'], ['resolution', 'Pixels'], ['size_mm', 'Size', 'mm'], ['mass_g', 'Mass', 'g', 'low', (p) => p.mass_g],
    ['battery_h', 'Battery', 'h'], ['gnss', 'GNSS'], ['sensors', 'Links'], ['water', 'Water'], ['mount', 'Mount'], ['extras', 'Extras'],
  ],
  cassette: [['range', 'Range', 'T', null, (p) => (p.provides?.cog_min ? `${p.provides.cog_min}–${p.provides.cog_max}` : null)], ['cogs', 'Cogs', '', null, (p) => p.visual?.cogs?.join('-')]],
};

const LABELS = { // labels for interfaces when a slot has no curated sheet
  brake_type: 'Brake', front_axle: 'Front axle', rear_axle: 'Rear axle', bb_standard: 'BB shell', fd_mount: 'FD mount', steerer_mm: 'Steerer, mm', seatpost_d_mm: 'Post Ø, mm',
  tire_max_mm: 'Tyre max, mm', brake_reach_mm: 'Brake reach, mm', ring_big: 'Big ring, T', ring_small: 'Small ring, T', crank_spindle: 'Spindle', bb_spindle: 'Spindle',
  rd_max_cog: 'Max cog, T', rd_capacity: 'Capacity, T', chain_speeds: 'Speeds', shifter_speeds: 'Speeds', brake_pull: 'Brake pull', shifter_pull: 'Cable pull',
  caliper_tire_max_mm: 'Tyre clearance, mm', pad_compound: 'Pad compound', stem_bar_clamp_mm: 'Bar clamp, mm', cleat: 'Cleat', cog_min: 'Smallest cog', cog_max: 'Largest cog', cassette_speeds: 'Speeds',
};

function sheet(slot, parts) {
  if (SHEETS[slot]) return SHEETS[slot];
  const keys = [...new Set(parts.flatMap((p) => Object.keys(p?.provides ?? {})))];
  return [['mass_g', 'Mass', 'g', 'low', (p) => p.mass_g], ...keys.map((k) => [k, LABELS[k] ?? k.replaceAll('_', ' '), '', null, (p) => p.provides?.[k]])];
}

function value(part, [key, , , , fb]) {
  if (!part) return null;
  const v = part.specs?.[key];
  if (v !== undefined && v !== null && v !== '') return v;
  return fb ? fb(part) ?? null : null;
}

/**
 * Rows for `part`, compared with `installed` (null when it is the installed part).
 * Each row: {label, unit, a, b, cmp} where cmp is 'better' | 'worse' | '' for numeric rows with a direction.
 * Rows where neither part has a value are dropped; a missing value stays null (shown as unknown).
 */
export function specRows(part, installed = null) {
  const cmpTo = installed && installed.id !== part.id ? installed : null;
  const rows = [];
  for (const def of sheet(part.slot, [part, cmpTo])) {
    const a = value(part, def), b = cmpTo ? value(cmpTo, def) : null;
    if (a == null && b == null) continue;
    let cmp = '';
    if (def[3] && Number.isFinite(a) && Number.isFinite(b) && a !== b) cmp = (def[3] === 'low') === (a < b) ? 'better' : 'worse';
    rows.push({ key: def[0], label: def[1], unit: def[2] || '', a, b, cmp });
  }
  if (Number.isFinite(part.price_usd) || Number.isFinite(cmpTo?.price_usd)) rows.push({ key: 'price', label: 'Price', unit: 'USD', a: part.price_usd, b: cmpTo?.price_usd ?? null, cmp: '' });
  return { rows, compare: !!cmpTo, source: part.specs?.spec_source ?? null };
}

/** Tab-separated text of a sheet, for pasting into a spreadsheet. */
export function specTSV(part, installed, sheetRows = specRows(part, installed)) {
  const head = ['Spec', 'Unit', part.name, ...(sheetRows.compare ? [installed.name] : [])];
  const cell = (v) => (v == null ? '' : String(v));
  return [head, ...sheetRows.rows.map((r) => [r.label, r.unit, cell(r.a), ...(sheetRows.compare ? [cell(r.b)] : [])])].map((r) => r.join('\t')).join('\n');
}
