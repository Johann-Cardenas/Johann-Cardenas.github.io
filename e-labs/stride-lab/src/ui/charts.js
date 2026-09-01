/* ============================================================
   Stride Lab — charts.

   Purpose-built Canvas 2D rather than a charting library, for three
   reasons that all matter here:

     - the app has to work with the network off after one visit, and a
       3 MB plotting library from a CDN does not;
     - every chart must be readable at 360 px wide and must have an
       accessible table alternative, which is easier to guarantee when
       the rendering is ours;
     - the dense figure this app actually needs — a mean joint-angle
       curve with a +-1 SD band across strides, normalised to the gait
       cycle — is about thirty lines of canvas and an awkward fit for
       a general-purpose library.

   Rules applied throughout: direct labelling instead of legends where
   there is room, every axis labelled with its unit, no category
   encoded by colour alone, and a stated y range so two charts in a
   comparison can be read against each other.
   ============================================================ */

export function themeFrom(el) {
    const cs = getComputedStyle(el);
    const v = (n, fallback) => (cs.getPropertyValue(n) || '').trim() || fallback;
    return {
        ink: v('--sl-ink', '#e8eef9'),
        ink2: v('--sl-ink2', '#93a5c4'),
        ink3: v('--sl-ink3', '#5f7396'),
        line: v('--sl-line', '#24344f'),
        bg: v('--sl-bg1', '#0f1829'),
        bg2: v('--sl-bg2', '#16223a'),
        accent: v('--sl-accent', '#22d3d1'),
        left: v('--sl-left', '#22d3d1'),
        right: v('--sl-right', '#f0a44a'),
        /* used by the overlay for bones that belong to neither side. Missing it
           does not throw: assigning undefined to strokeStyle is ignored, so the
           centre bones silently keep the dark casing colour from the previous
           pass and the head and pelvis render as black bars. */
        centre: v('--sl-ink2', '#93a5c4'),
        band: v('--sl-band', 'rgba(34,211,209,0.18)'),
        ok: v('--sl-ok', '#34d399'),
        warn: v('--sl-warn', '#d97706'),
        bad: v('--sl-bad', '#e05252')
    };
}

function setup(canvas, pad) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, rect.width || canvas.clientWidth || 320);
    const h = Math.max(80, rect.height || canvas.clientHeight || 160);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    return { ctx, w, h, plot: { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b } };
}

function niceTicks(lo, hi, count = 4) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
}

function axes(ctx, plot, theme, xLabel, yLabel, xTicks, yTicks, fmtY) {
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.ink3;
    ctx.textBaseline = 'middle';

    for (const t of yTicks.ticks) {
        const y = plot.y + plot.h - (t - yTicks.lo) / (yTicks.hi - yTicks.lo) * plot.h;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'right';
        ctx.fillText(fmtY ? fmtY(t) : String(t), plot.x - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xTicks.ticks) {
        const x = plot.x + (t - xTicks.lo) / (xTicks.hi - xTicks.lo) * plot.w;
        ctx.fillText(String(t), x, plot.y + plot.h + 6);
    }
    if (xLabel) {
        ctx.fillStyle = theme.ink3;
        ctx.fillText(xLabel, plot.x + plot.w / 2, plot.y + plot.h + 20);
    }
    if (yLabel) {
        ctx.save();
        ctx.translate(10, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }
}

/**
 * Mean joint-angle curve across strides, with a +-1 SD band, normalised to
 * 0-100% of the gait cycle. This is the standard biomechanics presentation and
 * it communicates CONSISTENCY, which no single number does: a wide band and a
 * narrow band around the same mean are very different runners.
 */
export function drawGaitCycle(canvas, series, opts = {}) {
    const theme = opts.theme || themeFrom(canvas);
    const { ctx, plot } = setup(canvas, { l: 42, r: 12, t: 12, b: 30 });
    const sets = series.filter(s => s && s.mean && s.mean.length);
    if (!sets.length) return;

    let lo = Infinity, hi = -Infinity;
    for (const s of sets) {
        for (let i = 0; i < s.mean.length; i++) {
            if (!Number.isFinite(s.mean[i])) continue;
            lo = Math.min(lo, s.mean[i] - (s.sd ? s.sd[i] : 0));
            hi = Math.max(hi, s.mean[i] + (s.sd ? s.sd[i] : 0));
        }
    }
    if (opts.yRange) { lo = opts.yRange[0]; hi = opts.yRange[1]; }
    if (!(hi > lo)) { hi = lo + 1; }
    const padY = (hi - lo) * 0.08;
    lo -= padY; hi += padY;

    const X = (p) => plot.x + p * plot.w;
    const Y = (v) => plot.y + plot.h - (v - lo) / (hi - lo) * plot.h;

    /* stance shading, so the reader can see which half of the cycle is on the
       ground without consulting a legend */
    const stance = sets[0].stanceFraction;
    if (Number.isFinite(stance)) {
        ctx.fillStyle = theme.bg2;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(plot.x, plot.y, plot.w * stance, plot.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.ink3;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('stance', plot.x + 4, plot.y + 3);
        ctx.fillText('swing', plot.x + plot.w * stance + 4, plot.y + 3);
    }

    axes(ctx, plot, theme, opts.xLabel || 'gait cycle, %', opts.yLabel || '',
        { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] },
        { lo, hi, ticks: niceTicks(lo, hi, 4) },
        (v) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)));

    for (const s of sets) {
        const n = s.mean.length;
        if (s.sd) {
            ctx.beginPath();
            for (let i = 0; i < n; i++) ctx.lineTo(X(i / (n - 1)), Y(s.mean[i] + s.sd[i]));
            for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i / (n - 1)), Y(s.mean[i] - s.sd[i]));
            ctx.closePath();
            ctx.fillStyle = s.side === 'R' ? theme.right : theme.left;
            ctx.globalAlpha = 0.16;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = X(i / (n - 1)), y = Y(s.mean[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = s.side === 'R' ? theme.right : theme.left;
        ctx.lineWidth = 2;
        /* never colour alone: the right side is dashed everywhere in this app */
        ctx.setLineDash(s.side === 'R' ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        /* direct labelling, at the end of the curve */
        const last = s.mean[n - 1];
        if (Number.isFinite(last)) {
            ctx.fillStyle = s.side === 'R' ? theme.right : theme.left;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(s.label || (s.side === 'R' ? 'right' : 'left'), plot.x + plot.w - 2, Y(last) - 4);
        }
    }
}

/**
 * A value with its 95% interval against the optimal and acceptable bands.
 * The interval is drawn, not written in a footnote: a metric whose interval
 * spans the whole acceptable band is telling you something the number alone
 * hides completely.
 */
export function drawRangeBar(canvas, o) {
    const theme = o.theme || themeFrom(canvas);
    const { ctx, w, h } = setup(canvas, { l: 0, r: 0, t: 0, b: 0 });
    const band = o.band;
    const value = o.value;
    const pad = 8;
    const barY = h * 0.5;
    const barH = 9;

    let lo, hi;
    if (band) {
        lo = Math.min(band.acceptable[0], value - (o.ci95 || 0));
        hi = Math.max(band.acceptable[1], value + (o.ci95 || 0));
    } else {
        lo = value - Math.max(1, Math.abs(value) * 0.5);
        hi = value + Math.max(1, Math.abs(value) * 0.5);
    }
    const span = hi - lo || 1;
    const pad2 = span * 0.08;
    lo -= pad2; hi += pad2;
    const X = (v) => pad + (v - lo) / (hi - lo) * (w - pad * 2);

    ctx.fillStyle = theme.bg2;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(pad, barY - barH / 2, w - pad * 2, barH, 5); ctx.fill(); }
    else ctx.fillRect(pad, barY - barH / 2, w - pad * 2, barH);

    if (band) {
        ctx.fillStyle = theme.line;
        ctx.fillRect(X(band.acceptable[0]), barY - barH / 2, X(band.acceptable[1]) - X(band.acceptable[0]), barH);
        ctx.fillStyle = theme.ok;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(X(band.optimal[0]), barY - barH / 2, X(band.optimal[1]) - X(band.optimal[0]), barH);
        ctx.globalAlpha = 1;
    }

    if (o.ci95) {
        ctx.strokeStyle = theme.ink2;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X(value - o.ci95), barY);
        ctx.lineTo(X(value + o.ci95), barY);
        ctx.stroke();
        for (const v of [value - o.ci95, value + o.ci95]) {
            ctx.beginPath();
            ctx.moveTo(X(v), barY - 6); ctx.lineTo(X(v), barY + 6);
            ctx.stroke();
        }
    }

    ctx.beginPath();
    ctx.arc(X(value), barY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
}

/** A sparkline of one metric over time, with confidence shading. */
export function drawSparkline(canvas, points, o = {}) {
    const theme = o.theme || themeFrom(canvas);
    const { ctx, plot } = setup(canvas, { l: 6, r: 6, t: 8, b: 8 });
    const vals = points.filter(p => Number.isFinite(p.value));
    if (vals.length < 2) {
        ctx.fillStyle = theme.ink3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('one point so far', plot.x + plot.w / 2, plot.y + plot.h / 2);
        return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const p of vals) {
        lo = Math.min(lo, p.value - (p.ci95 || 0));
        hi = Math.max(hi, p.value + (p.ci95 || 0));
    }
    const padY = (hi - lo) * 0.15 || 1;
    lo -= padY; hi += padY;
    const X = (i) => plot.x + (i / (vals.length - 1)) * plot.w;
    const Y = (v) => plot.y + plot.h - (v - lo) / (hi - lo) * plot.h;

    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) ctx.lineTo(X(i), Y(vals[i].value + (vals[i].ci95 || 0)));
    for (let i = vals.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(vals[i].value - (vals[i].ci95 || 0)));
    ctx.closePath();
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
        const x = X(i), y = Y(vals[i].value);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < vals.length; i++) {
        ctx.beginPath();
        ctx.arc(X(i), Y(vals[i].value), 2.6, 0, Math.PI * 2);
        ctx.fillStyle = theme.ink;
        ctx.fill();
    }
}

/** Per-stride scatter, so variability is visible rather than averaged away. */
export function drawStrideDots(canvas, strides, o = {}) {
    const theme = o.theme || themeFrom(canvas);
    const { ctx, plot } = setup(canvas, { l: 42, r: 12, t: 12, b: 28 });
    const all = strides.flatMap(s => s.values.filter(Number.isFinite));
    if (!all.length) return;
    let lo = Math.min(...all), hi = Math.max(...all);
    const padY = (hi - lo) * 0.2 || 1;
    lo -= padY; hi += padY;
    const maxN = Math.max(...strides.map(s => s.values.length), 1);
    const X = (i) => plot.x + (maxN > 1 ? i / (maxN - 1) : 0.5) * plot.w;
    const Y = (v) => plot.y + plot.h - (v - lo) / (hi - lo) * plot.h;

    axes(ctx, plot, theme, 'stride', o.yLabel || '',
        { lo: 0, hi: Math.max(1, maxN - 1), ticks: Array.from({ length: Math.min(maxN, 6) }, (_, i) => i) },
        { lo, hi, ticks: niceTicks(lo, hi, 4) },
        (v) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)));

    for (const s of strides) {
        ctx.strokeStyle = s.side === 'R' ? theme.right : theme.left;
        ctx.fillStyle = s.side === 'R' ? theme.right : theme.left;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(s.side === 'R' ? [5, 4] : []);
        ctx.beginPath();
        s.values.forEach((v, i) => { if (Number.isFinite(v)) ctx.lineTo(X(i), Y(v)); });
        ctx.stroke();
        ctx.setLineDash([]);
        s.values.forEach((v, i) => {
            if (!Number.isFinite(v)) return;
            ctx.beginPath();
            /* left is a filled circle, right an open square: shape, not colour */
            if (s.side === 'R') ctx.rect(X(i) - 3, Y(v) - 3, 6, 6);
            else ctx.arc(X(i), Y(v), 3.2, 0, Math.PI * 2);
            if (s.side === 'R') ctx.stroke(); else ctx.fill();
        });
    }
}

/** Horizontal bars for the dimension scores. Shape and label, never colour alone. */
export function drawScoreBar(canvas, score, o = {}) {
    const theme = o.theme || themeFrom(canvas);
    const { ctx, w, h } = setup(canvas, { l: 0, r: 0, t: 0, b: 0 });
    const y = h / 2, barH = 8;
    ctx.fillStyle = theme.bg2;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, y - barH / 2, w, barH, 4); ctx.fill(); }
    else ctx.fillRect(0, y - barH / 2, w, barH);
    if (score == null) return;
    const col = score >= 0.66 ? theme.ok : score >= 0.33 ? theme.warn : theme.bad;
    ctx.fillStyle = col;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, y - barH / 2, Math.max(4, w * score), barH, 4); ctx.fill(); }
    else ctx.fillRect(0, y - barH / 2, Math.max(4, w * score), barH);
    void o;
}
