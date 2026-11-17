// Small SVG charts. Colours come from CSS variables so they follow the theme.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = (lo, hi, n = 5) => {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), f = step0 / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
};

/** series: [{pts: [[x, y], ...], color, dash, label}], marks: [{x, y, color, label}] */
export function lineChart({ series, marks = [], xLabel = '', yLabel = '', w = 640, h = 300, xMin, xMax, yMin = 0, yMax }) {
  const m = { l: 48, r: 14, t: 12, b: 36 }, all = series.flatMap((s) => s.pts);
  xMin ??= Math.min(...all.map((p) => p[0])); xMax ??= Math.max(...all.map((p) => p[0]));
  yMax ??= Math.max(...all.map((p) => p[1])) * 1.05;
  const X = (x) => m.l + ((x - xMin) / (xMax - xMin)) * (w - m.l - m.r), Y = (y) => h - m.b - ((y - yMin) / (yMax - yMin)) * (h - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)} against ${esc(xLabel)}">`;
  for (const v of nice(yMin, yMax)) s += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
  for (const v of nice(xMin, xMax, 8)) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}"/><text x="${X(v)}" y="${h - m.b + 14}" text-anchor="middle">${v}</text>`;
  s += `<line class="ax" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/><line class="ax" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${h - m.b}"/>`;
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xLabel)}</text><text transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  for (const sr of series) {
    const d = sr.pts.filter((p) => p[1] <= yMax && p[1] >= yMin).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
    s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''} stroke-linejoin="round"/>`;
  }
  for (const k of marks) s += `<circle cx="${X(k.x)}" cy="${Y(k.y)}" r="4" fill="${k.color}" stroke="var(--bg2)" stroke-width="1.5"/>${k.label ? `<text x="${X(k.x) + 7}" y="${Y(k.y) - 7}" style="fill:var(--ink)">${esc(k.label)}</text>` : ''}`;
  return s + '</svg>';
}

/** Horizontal range bars: rows [{label, lo, hi, color, mark, dim}] on a shared x axis. */
export function rangeBars({ rows, xLabel = '', w = 640, rowH = 15, xMin = 0, xMax }) {
  const m = { l: 66, r: 16, t: 8, b: 34 }, h = m.t + m.b + rows.length * rowH;
  xMax ??= Math.max(...rows.map((r) => r.hi)) * 1.04;
  const X = (x) => m.l + ((x - xMin) / (xMax - xMin)) * (w - m.l - m.r);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(xLabel)}">`;
  for (const v of nice(xMin, xMax, 8)) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}"/><text x="${X(v)}" y="${h - m.b + 14}" text-anchor="middle">${v}</text>`;
  rows.forEach((r, i) => {
    const y = m.t + i * rowH;
    s += `<text x="${m.l - 6}" y="${y + rowH * 0.68}" text-anchor="end" ${r.sel ? 'style="fill:var(--accent-ink);font-weight:700"' : ''}>${esc(r.label)}</text>`;
    s += `<rect x="${X(r.lo)}" y="${y + 2.5}" width="${Math.max(1, X(r.hi) - X(r.lo))}" height="${rowH - 5}" rx="2" fill="${r.color}" opacity="${r.dim ? 0.32 : 0.9}"/>`;
    if (r.mark != null) s += `<line x1="${X(r.mark)}" x2="${X(r.mark)}" y1="${y + 1}" y2="${y + rowH - 1}" stroke="var(--ink)" stroke-width="1.5"/>`;
  });
  s += `<line class="ax" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/><text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
  return s + '</svg>';
}

/** Vertical bars: items [{label, value, color}] */
export function bars({ items, yLabel = '', w = 420, h = 220, yMax, fmt = (v) => v.toFixed(0) }) {
  const m = { l: 46, r: 10, t: 16, b: 46 };
  yMax ??= Math.max(...items.map((i) => i.value), 1e-9) * 1.15;
  const bw = (w - m.l - m.r) / items.length, Y = (y) => h - m.b - (y / yMax) * (h - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)}">`;
  for (const v of nice(0, yMax, 4)) s += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
  items.forEach((it, i) => {
    const x = m.l + i * bw + bw * 0.16, bh = h - m.b - Y(it.value);
    s += `<rect x="${x}" y="${Y(it.value)}" width="${bw * 0.68}" height="${Math.max(bh, 0.5)}" rx="2" fill="${it.color}"/>`;
    s += `<text x="${x + bw * 0.34}" y="${Y(it.value) - 4}" text-anchor="middle" style="fill:var(--ink)">${esc(fmt(it.value))}</text>`;
    s += `<text transform="translate(${x + bw * 0.34} ${h - m.b + 12}) rotate(-28)" text-anchor="end">${esc(it.label)}</text>`;
  });
  s += `<line class="ax" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/><text transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return s + '</svg>';
}
