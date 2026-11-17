// Interface compatibility. Every component `provides` named interfaces and `requires` others.
// Levels: error (cannot be assembled), warn (outside a rating or unverified), info (not measured yet).
const OPS = {
  eq: (a, b) => a === b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  lte: (a, b) => Number.isFinite(a) && Number.isFinite(b) && a <= b,
  gte: (a, b) => Number.isFinite(a) && Number.isFinite(b) && a >= b,
};

/** How much wider a tyre measures per millimetre of extra internal rim width (rule of thumb). */
export const TIRE_GROWTH_PER_MM = 0.4;
export const ETRTO_REF_RIM_MM = 15;

/** Collect the interfaces a configuration provides, plus the derived ones. */
export function interfaces(cfg, parts) {
  const provided = new Map(), conflicts = new Set(), issues = [];
  for (const [slot, id] of Object.entries(cfg)) {
    const part = parts.get(id);
    // Only valid slot assignments may contribute interfaces. Conflicting values
    // must not depend on configuration insertion order.
    if (!part || part.slot !== slot) continue;
    for (const [k, v] of Object.entries(part.provides ?? {})) {
      const prior = provided.get(k);
      if (prior && prior.value !== v) {
        conflicts.add(k);
        issues.push({ level: 'error', slot, key: k, msg: `Conflicting ${k} interfaces from ${prior.slot} and ${slot}` });
      } else if (!prior) provided.set(k, { value: v, slot });
    }
  }
  for (const key of conflicts) provided.delete(key);
  const n = (k) => provided.get(k)?.value;
  if (['ring_big', 'ring_small', 'cog_max', 'cog_min'].map(n).every(Number.isFinite)) {
    provided.set('capacity_needed', { value: n('ring_big') - n('ring_small') + n('cog_max') - n('cog_min'), slot: 'derived' });
  }
  if (Number.isFinite(n('tire_width_mm')) && Number.isFinite(n('rim_internal_mm'))) {
    provided.set('tire_measured_mm', { value: n('tire_width_mm') + TIRE_GROWTH_PER_MM * (n('rim_internal_mm') - ETRTO_REF_RIM_MM), slot: 'derived' });
  }
  return { provided, conflicts, issues };
}

export function checkConfig(cfg, parts) {
  const { provided, conflicts, issues } = interfaces(cfg, parts);
  const n = (k) => provided.get(k)?.value;
  for (const [slot, id] of Object.entries(cfg)) {
    const part = parts.get(id);
    if (!part || part.slot !== slot) { issues.push({ level: 'error', slot, msg: `Invalid component ${id} for ${slot}` }); continue; }
    for (const r of part.requires ?? []) {
      const provider = provided.get(r.key);
      if (!OPS[r.op]) { issues.push({ level: 'error', slot, key: r.key, msg: `Unsupported operator ${r.op}` }); continue; }
      if (conflicts.has(r.key)) continue;
      if (provider?.value == null) { issues.push({ level: 'info', slot, key: r.key, msg: `${part.name}: ${r.key} not measured or verified yet` }); continue; }
      if (!OPS[r.op](provider.value, r.value)) {
        issues.push({ level: r.level ?? 'error', slot, key: r.key, msg: r.msg ?? `${part.name}: requires ${r.key} ${r.op} ${r.value}; selected value ${provider.value}` });
      }
    }
  }
  if (n('freehub') === 'HG-11') issues.push({ level: 'info', slot: 'cassette', msg: '10-speed cassette on HG-11 needs a verified 1.85 mm spacer.' });
  const measured = n('tire_measured_mm'), max = n('tire_max_mm');
  if (Number.isFinite(measured) && Number.isFinite(max) && measured > max) {
    issues.push({ level: 'warn', slot: 'tires', key: 'tire_max_mm', msg: `On this rim the tyre is expected to measure about ${measured.toFixed(1)} mm, over the ${max} mm frame limit.` });
  } else if (Number.isFinite(measured) && measured - n('tire_width_mm') >= 1) {
    issues.push({ level: 'info', slot: 'tires', msg: `On a ${n('rim_internal_mm')} mm internal rim this tyre is expected to measure about ${measured.toFixed(1)} mm (rule of thumb).` });
  }
  return issues;
}

export const worst = (issues) => (issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warn') ? 'warn' : issues.some((i) => i.level === 'info') ? 'info' : 'ok');
