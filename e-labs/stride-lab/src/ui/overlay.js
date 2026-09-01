/* ============================================================
   Stride Lab — the annotated skeleton overlay.

   This is the signature element. It is the one thing here that no
   spreadsheet of numbers can substitute for, so it gets the design
   attention and the rest of the page stays quiet.

   Accessibility constraint that shapes the drawing code: left and
   right are never distinguished by COLOUR ALONE. The left side is
   drawn solid and the right side dashed, so the distinction survives
   a monochrome print and any form of colour vision deficiency.
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

export const LAYERS = { skeleton: true, angles: true, trails: false, events: true, com: true };

/**
 * Draw one frame of overlay.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} o
 * @param {Float64Array|Float32Array} o.xy   normalised [kp][2], y DOWN
 * @param {Float64Array|Float32Array} o.vis
 * @param {number} o.w  canvas CSS width
 * @param {number} o.h  canvas CSS height
 * @param {Object} o.theme
 * @param {Object} [o.layers]
 * @param {Array} [o.trails]  recent normalised positions of the feet
 * @param {Object} [o.angles] { label, a, b, c } triplets to annotate
 * @param {string} [o.eventLabel]
 * @param {{x:number,y:number}} [o.com]  whole-body centre of mass, normalised
 */
export function drawOverlay(ctx, o) {
    const layers = { ...LAYERS, ...(o.layers || {}) };
    const { xy, vis, w, h, theme } = o;
    const px = (i) => xy[i * 2] * w;
    const py = (i) => xy[i * 2 + 1] * h;
    const ok = (i) => vis ? vis[i] >= 0.35 : true;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (layers.trails && o.trails && o.trails.length > 1) {
        for (const trail of o.trails) {
            ctx.beginPath();
            for (let k = 0; k < trail.pts.length; k += 2) {
                const x = trail.pts[k] * w, y = trail.pts[k + 1] * h;
                if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = trail.side === 'L' ? theme.left : theme.right;
            ctx.globalAlpha = 0.45;
            ctx.setLineDash(trail.side === 'R' ? [4, 4] : []);
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
    }

    if (layers.skeleton) {
        /* a dark casing under every bone, so the skeleton reads over a bright
           background as well as a dark one without a scrim over the video */
        for (const pass of ['casing', 'line']) {
            for (const [a, b, side] of BONES) {
                const ia = I[a], ib = I[b];
                if (!ok(ia) || !ok(ib)) continue;
                ctx.beginPath();
                ctx.moveTo(px(ia), py(ia));
                ctx.lineTo(px(ib), py(ib));
                if (pass === 'casing') {
                    ctx.strokeStyle = 'rgba(6,10,20,0.55)';
                    ctx.lineWidth = 6;
                    ctx.setLineDash([]);
                } else {
                    ctx.strokeStyle = side === 'L' ? theme.left : side === 'R' ? theme.right : theme.centre;
                    ctx.lineWidth = 2.6;
                    ctx.setLineDash(side === 'R' ? [7, 5] : []);
                }
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);

        for (let i = 0; i < CANONICAL.length; i++) {
            if (!ok(i)) continue;
            const name = CANONICAL[i];
            const isFoot = /heel|toe|ankle/.test(name);
            const r = isFoot ? 4.2 : 3.2;
            ctx.beginPath();
            ctx.arc(px(i), py(i), r, 0, Math.PI * 2);
            ctx.fillStyle = name.endsWith('R') ? theme.right : name.endsWith('L') ? theme.left : theme.centre;
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = 'rgba(6,10,20,0.75)';
            ctx.stroke();
        }
    }

    if (layers.angles && o.angles) {
        for (const a of o.angles) {
            const ia = I[a.a], ib = I[a.b], ic = I[a.c];
            if (!ok(ia) || !ok(ib) || !ok(ic)) continue;
            drawAngleArc(ctx, px(ia), py(ia), px(ib), py(ib), px(ic), py(ic), a.label, theme);
        }
    }

    /* The centre of mass, drawn as the crosshair convention used for it in the
       biomechanics literature. It is a computed point rather than a tracked
       one, which is why it does not look like a landmark. */
    if (layers.com && o.com && Number.isFinite(o.com.x)) {
        const cx = o.com.x * w, cy = o.com.y * h;
        const r = 8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,10,20,0.55)';
        ctx.fill();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        /* alternate quadrants filled */
        for (const [a0, a1] of [[0, Math.PI / 2], [Math.PI, 1.5 * Math.PI]]) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, a0, a1);
            ctx.closePath();
            ctx.fillStyle = theme.ink;
            ctx.fill();
        }
    }

    if (layers.events && o.eventLabel) {
        drawChip(ctx, 12, 12, o.eventLabel, theme);
    }

    ctx.restore();
}

function drawAngleArc(ctx, ax, ay, bx, by, cx, cy, label, theme) {
    const r = Math.min(34, Math.hypot(ax - bx, ay - by) * 0.42);
    const a1 = Math.atan2(ay - by, ax - bx);
    const a2 = Math.atan2(cy - by, cx - bx);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(bx, by, r, a1, a1 + sweep, sweep < 0);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();

    const mid = a1 + sweep / 2;
    const lx = bx + Math.cos(mid) * (r + 16);
    const ly = by + Math.sin(mid) * (r + 16);
    drawChip(ctx, lx - 20, ly - 9, label, theme, true);
}

function drawChip(ctx, x, y, text, theme, small) {
    ctx.font = `${small ? 600 : 700} ${small ? 11 : 12}px ui-monospace, Menlo, Consolas, monospace`;
    const w = ctx.measureText(text).width + 14;
    const h = small ? 18 : 22;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fillStyle = 'rgba(8,14,26,0.86)';
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e8eef9';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 7, y + h / 2 + 0.5);
}

/** Angle annotations worth showing, by view. */
export function anglesFor(view) {
    return view === 'frontal'
        ? [
            { a: 'hipL', b: 'kneeL', c: 'ankleL', label: 'knee L' },
            { a: 'hipR', b: 'kneeR', c: 'ankleR', label: 'knee R' }
        ]
        : [
            { a: 'hipL', b: 'kneeL', c: 'ankleL', label: 'knee L' },
            { a: 'hipR', b: 'kneeR', c: 'ankleR', label: 'knee R' },
            { a: 'shoulderL', b: 'elbowL', c: 'wristL', label: 'elbow L' }
        ];
}

/**
 * Resize a canvas for the device pixel ratio and return its CSS size.
 * Without this every line is soft on a retina screen, which on an overlay
 * whose whole job is to show precise geometry reads as imprecision.
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
 * Returns the drawn rectangle, which the overlay must use as its own frame or
 * the skeleton floats away from the runner on any non-matching aspect ratio.
 */
export function contain(sw, sh, bw, bh) {
    const s = Math.min(bw / sw, bh / sh);
    const w = sw * s, h = sh * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w, h, scale: s };
}
