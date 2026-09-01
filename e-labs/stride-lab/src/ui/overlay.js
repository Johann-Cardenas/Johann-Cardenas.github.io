/* ============================================================
   Stride Lab — the annotated skeleton overlay.

   This is the signature element: the one thing here that a table of
   numbers cannot substitute for. It gets the design attention and
   the rest of the page stays quiet.

   The organising idea is that an analytical overlay SHOWS THE
   MEASUREMENT rather than decorating the video and printing the
   number somewhere else. "Overstride 11% of standing height" is an
   abstraction; the same thing drawn as a dimension line between the
   plumb line through the hips and the ankle, at the instant of
   contact, is a fact about the picture. Everything below earns its
   place that way or it is not drawn.

   Two rules constrain the drawing throughout.

   Left and right are never distinguished by COLOUR ALONE. Left is
   solid with a filled marker, right is dashed with a hollow one, so
   the distinction survives a monochrome print and any form of
   colour vision deficiency.

   Nothing is asserted more confidently than it was measured. A
   landmark the pose model was unsure of is drawn hollow and dimmed,
   so a skeleton resting on a guess looks like one.
   ============================================================ */

import { CANONICAL } from '../engine/types.js';

const I = Object.fromEntries(CANONICAL.map((n, i) => [n, i]));

/** Bones, tagged with the side that decides their line style. */
export const BONES = [
    /* head: the ears carry it, the nose hangs off them. The ear midpoint is
       where Winter puts the head-and-neck centre of mass, so it is the
       structural landmark and the nose is the decoration, not the reverse. */
    ['earL', 'earR', 'C'],
    ['earL', 'shoulderL', 'L'], ['earR', 'shoulderR', 'R'],
    ['earL', 'nose', 'C'], ['earR', 'nose', 'C'],
    ['shoulderL', 'shoulderR', 'C'],
    ['hipL', 'hipR', 'C'],
    ['shoulderL', 'hipL', 'L'], ['shoulderR', 'hipR', 'R'],
    ['shoulderL', 'elbowL', 'L'], ['elbowL', 'wristL', 'L'],
    ['shoulderR', 'elbowR', 'R'], ['elbowR', 'wristR', 'R'],
    ['wristL', 'handL', 'L'], ['wristR', 'handR', 'R'],
    ['hipL', 'kneeL', 'L'], ['kneeL', 'ankleL', 'L'],
    ['hipR', 'kneeR', 'R'], ['kneeR', 'ankleR', 'R'],
    ['ankleL', 'heelL', 'L'], ['heelL', 'toeL', 'L'], ['ankleL', 'toeL', 'L'],
    ['ankleR', 'heelR', 'R'], ['heelR', 'toeR', 'R'], ['ankleR', 'toeR', 'R'],
    /* lateral forefoot, when the backend has one: this is the edge that turns
       each foot from a line into a plane */
    ['toeL', 'footOuterL', 'L'], ['heelL', 'footOuterL', 'L'],
    ['toeR', 'footOuterR', 'R'], ['heelR', 'footOuterR', 'R']
];

export const LAYERS = {
    skeleton: true, angles: true, guides: true, readout: true,
    phase: true, measures: true, trails: false, events: true, com: true
};

/** Visibility below this draws a landmark as unsure rather than as fact. */
const SURE = 0.7;

const CASING = 'rgba(4,8,16,0.62)';
const PANEL = 'rgba(8,14,26,0.86)';
const MONO = 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace';

/* ============================================================
   Entry point
   ============================================================ */

/**
 * @param {CanvasRenderingContext2D} ctx  already translated to the video box
 * @param {Object} o
 * @param {Float64Array} o.xy      normalised [kp][2], y DOWN
 * @param {Float64Array} o.vis
 * @param {number} o.w             video box width, CSS px
 * @param {number} o.h             video box height
 * @param {Object} o.theme
 * @param {Object} [o.layers]
 * @param {Array}  [o.angles]      { a, b, c, label, side, text } triplets
 * @param {Array}  [o.trails]
 * @param {{x:number,y:number}} [o.com]
 * @param {Object} [o.readout]     { rows, time, frame, stride }
 * @param {Object} [o.phase]       { L, R, lanes, playhead }
 * @param {Object} [o.measures]    { overstride, comBand, groundY }
 * @param {number} [o.metresPerPx]
 * @param {string} [o.eventLabel]
 */
export function drawOverlay(ctx, o) {
    const layers = { ...LAYERS, ...(o.layers || {}) };
    const { xy, vis, w, h, theme } = o;

    /* One design unit, so the whole overlay scales with the video rather than
       being tuned for one size.

       Derived from the AREA rather than the short side. A 9:16 phone clip has a
       short side barely a third of its long one, so sizing from the minimum
       shrinks every label and lane to the point of illegibility on exactly the
       videos people actually record. The geometric mean tracks how much room
       there really is. */
    const u = Math.max(5.5, Math.sqrt(w * h) / 88);
    const px = (i) => xy[i * 2] * w;
    const py = (i) => xy[i * 2 + 1] * h;
    const seen = (i) => (vis ? vis[i] >= 0.35 : true) && Number.isFinite(xy[i * 2]);
    const sure = (i) => vis ? vis[i] >= SURE : true;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';

    const g = { ctx, o, layers, theme, w, h, u, px, py, seen, sure };

    if (layers.guides) drawGuides(g);
    if (layers.trails) drawTrails(g);
    if (layers.measures) drawMeasures(g);
    if (layers.skeleton) drawSkeleton(g);
    if (layers.angles && o.angles) drawAngles(g);
    if (layers.com && o.com) drawCoM(g);
    if (layers.events) drawContacts(g);
    if (layers.guides && o.metresPerPx) drawScaleBar(g);
    if (layers.readout && o.readout) drawReadout(g);
    if (layers.phase && o.phase && o.phase.lanes) drawPhaseStrip(g);

    ctx.restore();
}

/* ============================================================
   Construction lines
   ============================================================ */

/**
 * The reference geometry every measurement is taken against: the ground, the
 * plumb line through the hips, and the horizon through the hip centre.
 *
 * These are what make an overlay read as a measurement rather than a filter.
 * The plumb line in particular is what overstride is measured FROM, so drawing
 * it turns a percentage into a visible distance.
 */
function drawGuides(g) {
    const { ctx, o, theme, w, h, u, px, py, seen } = g;
    ctx.save();
    ctx.setLineDash([u * 0.55, u * 0.55]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(theme.ink3, 0.55);

    if (seen(I.hipL) && seen(I.hipR)) {
        const hx = (px(I.hipL) + px(I.hipR)) / 2;
        const hy = (py(I.hipL) + py(I.hipR)) / 2;
        ctx.beginPath();
        ctx.moveTo(hx, Math.max(0, hy - u * 7));
        ctx.lineTo(hx, h - u * 1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(u * 1.2, hy);
        ctx.lineTo(w - u * 1.2, hy);
        ctx.stroke();
    }

    if (o.measures && Number.isFinite(o.measures.groundY)) {
        const gy = o.measures.groundY * h;
        ctx.setLineDash([]);
        ctx.strokeStyle = withAlpha(theme.ink2, 0.45);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
    }
    ctx.restore();
}

/* ============================================================
   Skeleton
   ============================================================ */

function drawSkeleton(g) {
    const { ctx, theme, u, px, py, seen, sure } = g;
    const bone = Math.max(1.6, u * 0.30);

    /* Dark casing under every bone, so the skeleton reads over a bright
       background as well as a dark one without laying a scrim over the video. */
    for (const pass of ['casing', 'line']) {
        for (const [a, b, side] of BONES) {
            const ia = I[a], ib = I[b];
            if (ia == null || ib == null || !seen(ia) || !seen(ib)) continue;
            ctx.beginPath();
            ctx.moveTo(px(ia), py(ia));
            ctx.lineTo(px(ib), py(ib));
            if (pass === 'casing') {
                ctx.strokeStyle = CASING;
                ctx.lineWidth = bone * 2.3;
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = sideColour(theme, side);
                ctx.lineWidth = bone;
                /* right is dashed everywhere in this app, never colour alone */
                ctx.setLineDash(side === 'R' ? [bone * 2.4, bone * 1.7] : []);
                /* a bone resting on an unsure landmark is drawn as unsure */
                ctx.globalAlpha = (sure(ia) && sure(ib)) ? 1 : 0.42;
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
    ctx.setLineDash([]);

    for (let i = 0; i < CANONICAL.length; i++) {
        const name = CANONICAL[i];
        if (!seen(i) || name === 'nose' || name === 'earL' || name === 'earR') continue;
        const isFoot = /heel|toe|ankle|footOuter/.test(name);
        const r = (isFoot ? 0.40 : 0.32) * u;
        const colour = name.endsWith('R') ? theme.right : name.endsWith('L') ? theme.left : theme.centre;
        ctx.beginPath();
        ctx.arc(px(i), py(i), r, 0, Math.PI * 2);
        if (sure(i)) {
            ctx.fillStyle = colour;
            ctx.fill();
            ctx.lineWidth = 1.1;
            ctx.strokeStyle = CASING;
            ctx.stroke();
        } else {
            /* hollow: the model was not sure, and neither is this drawing */
            ctx.fillStyle = CASING;
            ctx.fill();
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = withAlpha(colour, 0.6);
            ctx.stroke();
        }
    }

    /* a head, so the figure reads as a person rather than a stick */
    if (seen(I.earL) && seen(I.earR)) {
        const hx = (px(I.earL) + px(I.earR)) / 2, hy = (py(I.earL) + py(I.earR)) / 2;
        const sh = seen(I.shoulderL) && seen(I.shoulderR)
            ? Math.hypot(hx - (px(I.shoulderL) + px(I.shoulderR)) / 2,
                hy - (py(I.shoulderL) + py(I.shoulderR)) / 2)
            : u * 3;
        const r = Math.max(u * 1.1, sh * 0.46);
        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.fillStyle = CASING;
        ctx.fill();
        ctx.lineWidth = Math.max(1.4, u * 0.16);
        ctx.strokeStyle = theme.centre;
        ctx.stroke();
        if (seen(I.nose)) {
            const dx = px(I.nose) - hx, dy = py(I.nose) - hy;
            const n = Math.hypot(dx, dy) || 1;
            ctx.beginPath();
            ctx.moveTo(hx + dx / n * r * 0.3, hy + dy / n * r * 0.3);
            ctx.lineTo(hx + dx / n * r * 0.95, hy + dy / n * r * 0.95);
            ctx.strokeStyle = theme.centre;
            ctx.lineWidth = Math.max(1.2, u * 0.13);
            ctx.stroke();
        }
    }
}

const sideColour = (theme, side) =>
    side === 'L' ? theme.left : side === 'R' ? theme.right : theme.centre;

/* ============================================================
   Angles
   ============================================================ */

function drawAngles(g) {
    const { ctx, o, theme, u, px, py, seen } = g;
    const labels = [];

    for (const a of o.angles) {
        const ia = I[a.a], ib = I[a.b], ic = I[a.c];
        if (ia == null || ib == null || ic == null) continue;
        if (!seen(ia) || !seen(ib) || !seen(ic)) continue;
        /* An arc without a number is an annotation that cannot say what it
           found. If the conditioned series gated this joint out, the drawing
           says nothing rather than gesturing at it. */
        if (a.text == null) continue;

        const bx = px(ib), by = py(ib);
        const r = Math.min(u * 3.2, Math.hypot(px(ia) - bx, py(ia) - by) * 0.40);
        if (!(r > u * 0.9)) continue;
        const a1 = Math.atan2(py(ia) - by, px(ia) - bx);
        const a2 = Math.atan2(py(ic) - by, px(ic) - bx);
        let sweep = a2 - a1;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;

        const colour = sideColour(theme, a.side || 'C');

        /* short rays, so the arc reads as an angle BETWEEN segments */
        ctx.save();
        ctx.setLineDash([u * 0.3, u * 0.3]);
        ctx.strokeStyle = withAlpha(colour, 0.5);
        ctx.lineWidth = 1;
        for (const t of [a1, a2]) {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(t) * r * 1.45, by + Math.sin(t) * r * 1.45);
            ctx.stroke();
        }
        ctx.restore();

        for (const pass of [0, 1]) {
            ctx.beginPath();
            ctx.arc(bx, by, r, a1, a1 + sweep, sweep < 0);
            ctx.strokeStyle = pass ? colour : CASING;
            ctx.lineWidth = pass ? Math.max(1.5, u * 0.20) : Math.max(2.8, u * 0.38);
            ctx.setLineDash([]);
            ctx.stroke();
        }

        const mid = a1 + sweep / 2;
        labels.push({
            x: bx + Math.cos(mid) * (r + u * 2.4),
            y: by + Math.sin(mid) * (r + u * 2.4),
            ax: bx + Math.cos(mid) * r,
            ay: by + Math.sin(mid) * r,
            text: a.text != null ? a.text : a.label,
            colour
        });
    }

    /* Nudge overlapping labels apart before drawing any of them. Angle chips
       cluster at the knee and hip on a flexed leg, and two unreadable numbers
       are worse than one. */
    declutter(labels, u * 3.0, g.h);

    for (const l of labels) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = withAlpha(l.colour, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(l.ax, l.ay);
        ctx.lineTo(l.x, l.y);
        ctx.stroke();
        ctx.restore();
        chip(ctx, l.x, l.y, l.text, { u, theme, accent: l.colour, centre: true });
    }
}

function declutter(items, minGap, h) {
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1], cur = items[i];
        if (Math.abs(cur.x - prev.x) > minGap * 2.5) continue;
        if (cur.y - prev.y < minGap) cur.y = Math.min(h - minGap, prev.y + minGap);
    }
}

/* ============================================================
   Centre of mass, trails, contacts
   ============================================================ */

function drawCoM(g) {
    const { ctx, o, theme, u, w, h } = g;
    if (!Number.isFinite(o.com.x)) return;
    const cx = o.com.x * w, cy = o.com.y * h;
    const r = u * 0.78;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = CASING;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = Math.max(1.3, u * 0.16);
    ctx.stroke();
    /* the surveyor's convention: alternate quadrants filled */
    for (const [a0, a1] of [[0, Math.PI / 2], [Math.PI, 1.5 * Math.PI]]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = theme.ink;
        ctx.fill();
    }
    ctx.restore();
}

function drawTrails(g) {
    const { ctx, o, theme, u, w, h } = g;
    if (!o.trails) return;
    for (const trail of o.trails) {
        if (!trail.pts || trail.pts.length < 4) continue;
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < trail.pts.length; k += 2) {
            const x = trail.pts[k] * w, y = trail.pts[k + 1] * h;
            if (!Number.isFinite(x)) continue;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = trail.colour || sideColour(theme, trail.side);
        ctx.globalAlpha = 0.5;
        ctx.setLineDash(trail.side === 'R' ? [u * 0.5, u * 0.5] : []);
        ctx.lineWidth = Math.max(1.2, u * 0.17);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * A bracket under whichever foot is on the ground. The single most useful thing
 * an overlay can say at a glance is which foot is loaded right now.
 */
function drawContacts(g) {
    const { ctx, o, theme, u, px, py, seen } = g;
    if (o.phase) {
        for (const side of ['L', 'R']) {
            if (!o.phase[side] || !o.phase[side].stance) continue;
            const heel = I['heel' + side], toe = I['toe' + side];
            if (!seen(heel) || !seen(toe)) continue;
            const x0 = Math.min(px(heel), px(toe)) - u * 0.7;
            const x1 = Math.max(px(heel), px(toe)) + u * 0.7;
            const y = Math.max(py(heel), py(toe)) + u * 1.0;
            ctx.save();
            ctx.setLineDash([]);
            ctx.strokeStyle = sideColour(theme, side);
            ctx.lineWidth = Math.max(2, u * 0.26);
            ctx.beginPath();
            ctx.moveTo(x0, y - u * 0.55);
            ctx.lineTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.lineTo(x1, y - u * 0.55);
            ctx.stroke();
            ctx.restore();
        }
    }
    if (o.eventLabel) {
        chip(ctx, g.w / 2, u * 3.4, o.eventLabel,
            { u, theme, accent: theme.accent, centre: true, strong: true });
    }
}

/* ============================================================
   Dimensioned measurements
   ============================================================ */

/**
 * Draw the measurement, not just the number.
 *
 * Overstride is the horizontal distance between the plumb line through the hips
 * and the ankle at the instant of contact. Written as a percentage it is an
 * abstraction; drawn as a dimension between the two, on the frame where it is
 * taken, it is a fact about the picture. Same for the centre-of-mass excursion,
 * which is otherwise the least visible of the well-evidenced variables.
 */
function drawMeasures(g) {
    const { ctx, o, theme, u, w, h } = g;
    const m = o.measures;
    if (!m) return;
    if (m.overstride) {
        const d = m.overstride;
        dimensionH(ctx, d.x0 * w, d.x1 * w, d.y * h, d.text, { u, theme, accent: theme.accent });
    }
    if (m.comBand) {
        const d = m.comBand;
        dimensionV(ctx, d.x * w, d.yMin * h, d.yMax * h, d.text, { u, theme, accent: theme.ink2 });
    }
}

/** A horizontal dimension with arrowheads and extension lines. */
function dimensionH(ctx, x0, x1, y, text, { u, theme, accent }) {
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || Math.abs(x1 - x0) < u) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.2, u * 0.15);
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();
    arrow(ctx, x0, y, x0 < x1 ? Math.PI : 0, u, accent);
    arrow(ctx, x1, y, x0 < x1 ? 0 : Math.PI, u, accent);
    for (const x of [x0, x1]) {
        ctx.beginPath();
        ctx.moveTo(x, y - u * 0.9);
        ctx.lineTo(x, y + u * 0.9);
        ctx.stroke();
    }
    ctx.restore();
    chip(ctx, (x0 + x1) / 2, y - u * 2.0, text, { u, theme, accent, centre: true });
}

/** A vertical dimension, for excursions. */
function dimensionV(ctx, x, y0, y1, text, { u, theme, accent }) {
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || Math.abs(y1 - y0) < u * 0.6) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.2, u * 0.15);
    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.stroke();
    arrow(ctx, x, y0, y0 < y1 ? -Math.PI / 2 : Math.PI / 2, u, accent);
    arrow(ctx, x, y1, y0 < y1 ? Math.PI / 2 : -Math.PI / 2, u, accent);
    ctx.setLineDash([u * 0.4, u * 0.4]);
    ctx.globalAlpha = 0.6;
    for (const y of [y0, y1]) {
        ctx.beginPath();
        ctx.moveTo(x - u * 0.8, y);
        ctx.lineTo(x + u * 3.4, y);
        ctx.stroke();
    }
    ctx.restore();
    chip(ctx, x, (y0 + y1) / 2, text, { u, theme, accent, centre: true });
}

function arrow(ctx, x, y, angle, u, colour) {
    const s = u * 0.75;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, -s * 0.42);
    ctx.lineTo(s, s * 0.42);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();
}

/* ============================================================
   Heads-up readout
   ============================================================ */

/**
 * The values AT THIS FRAME, not the stride aggregates the dashboard shows.
 *
 * This is the difference between a video with a skeleton on it and an analysis
 * tool. Stepping frame by frame through a contact and watching knee flexion
 * rise is how somebody actually reads a gait cycle, and for that the numbers
 * have to be on the frame.
 */
function drawReadout(g) {
    const { ctx, o, theme, u, h } = g;
    const r = o.readout;
    const pad = u * 1.05;
    const fs = Math.max(9, u * 1.0);
    const lh = fs * 1.62;

    ctx.font = `600 ${fs}px ${MONO}`;
    const head = [];
    if (r.time != null) head.push(`${r.time.toFixed(3)} s`);
    if (r.frame != null) head.push(`f${r.frame}`);
    if (r.stride) head.push(r.stride);
    if (head.length) panel(ctx, pad, pad, head.join('  ·  '), { u, theme, fs, muted: true });

    const rows = (r.rows || []).filter(Boolean);
    if (!rows.length) return;

    let labelW = 0, valueW = 0;
    for (const row of rows) {
        labelW = Math.max(labelW, ctx.measureText(row.label).width);
        valueW = Math.max(valueW, ctx.measureText(row.value).width);
    }
    const markW = u * 1.35;
    const boxW = markW + labelW + valueW + pad * 2.6;
    const boxH = rows.length * lh + pad * 1.2;
    const x = pad;
    const y = h - pad - boxH - (o.phase && o.phase.lanes ? u * 5.0 : 0);

    ctx.save();
    roundRectPath(ctx, x, y, boxW, boxH, u * 0.55);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.line, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();

    rows.forEach((row, i) => {
        const ry = y + pad * 0.6 + lh * (i + 0.5);
        /* shape, not colour: left is a filled dot, right a hollow square */
        if (row.side) {
            const mx = x + pad * 0.85;
            ctx.beginPath();
            if (row.side === 'R') {
                ctx.rect(mx - u * 0.32, ry - u * 0.32, u * 0.64, u * 0.64);
                ctx.strokeStyle = theme.right;
                ctx.lineWidth = 1.4;
                ctx.stroke();
            } else {
                ctx.arc(mx, ry, u * 0.32, 0, Math.PI * 2);
                ctx.fillStyle = theme.left;
                ctx.fill();
            }
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.ink3;
        ctx.font = `600 ${fs}px ${MONO}`;
        ctx.fillText(row.label, x + markW + pad * 0.5, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = row.dim ? theme.ink3 : theme.ink;
        ctx.fillText(row.value, x + boxW - pad * 0.8, ry);
    });
    ctx.restore();
}

/**
 * Stance and swing for both feet across the clip, with a playhead.
 *
 * The standard way to present a gait cycle, and it makes the event detection
 * inspectable: if the bars do not alternate, the detection is wrong, and you
 * can see that without reading a single number.
 */
function drawPhaseStrip(g) {
    const { ctx, o, theme, u, w, h } = g;
    const p = o.phase;
    const laneH = u * 1.45;
    const gap = u * 0.34;
    const boxH = laneH * 2 + gap;
    const x0 = u * 1.2, x1 = w - u * 1.2;
    const y0 = h - u * 1.5 - boxH;

    ctx.save();
    ctx.font = `700 ${Math.max(9, u * 0.88)}px ${MONO}`;
    ['L', 'R'].forEach((side, i) => {
        const y = y0 + i * (laneH + gap);
        roundRectPath(ctx, x0, y, x1 - x0, laneH, laneH / 2);
        ctx.fillStyle = 'rgba(8,14,26,0.72)';
        ctx.fill();
        ctx.strokeStyle = withAlpha(theme.line, 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
        const inset = u * 1.6;
        for (const seg of (p.lanes[side] || [])) {
            const sx = x0 + inset + seg.from * (x1 - x0 - inset);
            const sw = Math.max(1.5, (seg.to - seg.from) * (x1 - x0 - inset));
            roundRectPath(ctx, sx, y, sw, laneH, laneH / 2);
            ctx.fillStyle = withAlpha(sideColour(theme, side), 0.85);
            ctx.fill();
        }
        /* the label sits INSIDE the lane: a strip pinned to the frame edge has
           no room outside it, and a label that falls off the video is not one */
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.ink2;
        ctx.fillText(side, x0 + u * 0.5, y + laneH / 2);
    });

    if (Number.isFinite(p.playhead)) {
        const hx = x0 + u * 1.6 + p.playhead * (x1 - x0 - u * 1.6);
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(hx, y0 - u * 0.35);
        ctx.lineTo(hx, y0 + boxH + u * 0.35);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * A scale bar. Every distance in this app is derived from the height the user
 * typed, so showing the resulting scale is both an orientation aid and a quiet
 * admission of where the numbers come from.
 */
function drawScaleBar(g) {
    const { ctx, o, theme, u, w } = g;
    const mpp = o.metresPerPx;
    if (!(mpp > 0)) return;
    const target = w * 0.18 * mpp;
    const nice = [0.1, 0.2, 0.25, 0.5, 1, 2].reduce((a, b) =>
        Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const barPx = nice / mpp;
    if (!(barPx > u * 3) || barPx > w * 0.45) return;

    const pad = u * 1.05;
    const y = pad + u * 1.6;
    const x1 = w - pad, x0 = x1 - barPx;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = CASING;
    ctx.lineWidth = Math.max(3, u * 0.42);
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = theme.ink2;
    ctx.lineWidth = Math.max(1.4, u * 0.18);
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - u * 0.5); ctx.lineTo(x0, y + u * 0.5);
    ctx.moveTo(x1, y - u * 0.5); ctx.lineTo(x1, y + u * 0.5);
    ctx.stroke();
    ctx.font = `600 ${Math.max(8, u * 0.88)}px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = theme.ink2;
    strokeText(ctx, nice < 1 ? `${Math.round(nice * 100)} cm` : `${nice} m`, x1, y - u * 0.7);
    ctx.restore();
}

/* ============================================================
   Small drawing helpers
   ============================================================ */

function chip(ctx, x, y, text, { u, theme, accent, centre, strong }) {
    const fs = Math.max(9, u * (strong ? 1.06 : 0.96));
    ctx.save();
    ctx.font = `${strong ? 700 : 600} ${fs}px ${MONO}`;
    const tw = ctx.measureText(text).width;
    const padX = u * 0.6, padY = u * 0.4;
    const bw = tw + padX * 2, bh = fs + padY * 2;
    const bx = centre ? x - bw / 2 : x;
    const by = y - bh / 2;
    roundRectPath(ctx, bx, by, bw, bh, u * 0.4);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.strokeStyle = withAlpha(accent || theme.accent, 0.85);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, by + bh / 2 + 0.5);
    ctx.restore();
}

function panel(ctx, x, y, text, { u, theme, fs, muted }) {
    ctx.save();
    ctx.font = `600 ${fs}px ${MONO}`;
    const tw = ctx.measureText(text).width;
    const padX = u * 0.7, padY = u * 0.45;
    roundRectPath(ctx, x, y, tw + padX * 2, fs + padY * 2, u * 0.42);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.line, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = muted ? theme.ink2 : theme.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + (fs + padY * 2) / 2 + 0.5);
    ctx.restore();
}

function strokeText(ctx, text, x, y) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = CASING;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Accept a hex or rgb colour and give it an alpha. */
function withAlpha(colour, alpha) {
    if (!colour) return `rgba(147,165,196,${alpha})`;
    const c = String(colour).trim();
    if (c.startsWith('#')) {
        const hex = c.length === 4
            ? c.slice(1).split('').map(ch => ch + ch).join('')
            : c.slice(1, 7);
        const n = parseInt(hex, 16);
        if (!Number.isFinite(n)) return c;
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }
    if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
    return c;
}

/* ============================================================
   What to annotate, by view
   ============================================================ */

/**
 * Joint angles worth drawing on the frame. `metric` names the per-frame series
 * the caller reads the live value from, so the arc and the number can never
 * disagree about which joint they describe.
 */
export function anglesFor(view) {
    return view === 'frontal'
        ? [
            { a: 'hipL', b: 'kneeL', c: 'ankleL', label: 'knee L', side: 'L', metric: 'kneeFlex' },
            { a: 'hipR', b: 'kneeR', c: 'ankleR', label: 'knee R', side: 'R', metric: 'kneeFlex' }
        ]
        : [
            { a: 'hipL', b: 'kneeL', c: 'ankleL', label: 'knee L', side: 'L', metric: 'kneeFlex' },
            { a: 'hipR', b: 'kneeR', c: 'ankleR', label: 'knee R', side: 'R', metric: 'kneeFlex' },
            { a: 'kneeL', b: 'ankleL', c: 'toeL', label: 'ankle L', side: 'L', metric: 'ankleDf' },
            { a: 'shoulderL', b: 'hipL', c: 'kneeL', label: 'hip L', side: 'L', metric: 'hipExt' },
            { a: 'shoulderL', b: 'elbowL', c: 'wristL', label: 'elbow L', side: 'L', metric: 'elbow' }
        ];
}

/* ============================================================
   Canvas plumbing
   ============================================================ */

/**
 * Resize a canvas for the device pixel ratio and return its context.
 * Without this every line is soft on a retina screen, which on an overlay whose
 * whole job is to show precise geometry reads as imprecision.
 */
export function fitCanvas(canvas, cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

/**
 * Fit a source of `sw` x `sh` into a box of `bw` x `bh`, preserving aspect.
 * The overlay must use this same rectangle as its frame, or the skeleton floats
 * away from the runner on any non-matching aspect ratio.
 */
export function contain(sw, sh, bw, bh) {
    const s = Math.min(bw / sw, bh / sh);
    const w = sw * s, h = sh * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w, h, scale: s };
}
