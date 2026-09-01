/* ============================================================
   Stride Lab — E-Labs card banner generator.
   ------------------------------------------------------------
   Run with:  node tools/make-banner.mjs   (or: npm run banner)

   Writes images/e-labs/E-Labs_Stride-Lab.png, 1310x790, the same
   dimensions the other E-Labs cards use.

   The banner is DRAWN FROM THE ENGINE rather than mocked up: the
   figures are real frames of the synthetic runner, posed by the same
   inverse kinematics the validation suite checks, and the event ticks
   sit at the times the real detector found. If the engine's geometry
   ever breaks, the banner breaks with it, which is the right coupling
   for a picture whose whole claim is "this is what the app computes".

   No image library. A small software rasteriser (anti-aliased lines,
   circles, a 5x7 bitmap font) into an RGBA buffer, then PNG through
   Node's own zlib. Same reasoning as everywhere else in this app:
   one fewer dependency, and the subset needed is small.
   ============================================================ */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { synthGait } from '../src/synth/gait.js';
import { condition } from '../src/engine/signal/condition.js';
import { detectEvents } from '../src/engine/events/detect.js';
import { CANONICAL } from '../src/engine/types.js';

const W = 1310, H = 790;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', '..', 'images', 'e-labs', 'E-Labs_Stride-Lab.png');

/* ---------------- raster surface ---------------- */

const buf = new Uint8ClampedArray(W * H * 4);

function px(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = ((y | 0) * W + (x | 0)) * 4;
    const ia = 1 - a;
    buf[i] = buf[i] * ia + r * a;
    buf[i + 1] = buf[i + 1] * ia + g * a;
    buf[i + 2] = buf[i + 2] * ia + b * a;
    buf[i + 3] = Math.max(buf[i + 3], a * 255);
}

function rect(x0, y0, w, h, c, a = 1) {
    for (let y = Math.max(0, y0 | 0); y < Math.min(H, (y0 + h) | 0); y++)
        for (let x = Math.max(0, x0 | 0); x < Math.min(W, (x0 + w) | 0); x++)
            px(x, y, c[0], c[1], c[2], a);
}

function roundRect(x0, y0, w, h, r, c, a = 1) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = Math.min(x, w - 1 - x), dy = Math.min(y, h - 1 - y);
            let cov = 1;
            if (dx < r && dy < r) {
                const d = Math.hypot(r - dx, r - dy);
                cov = d <= r - 1 ? 1 : d >= r ? 0 : r - d;
            }
            if (cov > 0) px(x0 + x, y0 + y, c[0], c[1], c[2], a * cov);
        }
    }
}

/** Anti-aliased thick line, by coverage from the distance to the segment. */
function line(x0, y0, x1, y1, width, c, a = 1) {
    const half = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + half + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + half + 1));
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
            const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
            const cov = d <= half - 0.5 ? 1 : d >= half + 0.5 ? 0 : half + 0.5 - d;
            if (cov > 0) px(x, y, c[0], c[1], c[2], a * cov);
        }
    }
}

function dashedLine(x0, y0, x1, y1, width, c, a, on = 9, off = 7) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    let t = 0;
    while (t < len) {
        const e = Math.min(len, t + on);
        line(x0 + ux * t, y0 + uy * t, x0 + ux * e, y0 + uy * e, width, c, a);
        t = e + off;
    }
}

function disc(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            const d = Math.hypot(x - cx, y - cy);
            const cov = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : r + 0.5 - d;
            if (cov > 0) px(x, y, c[0], c[1], c[2], a * cov);
        }
    }
}

/* ---------------- 5x7 bitmap font ---------------- */

const FONT = {
    'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11], 'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E], 'D': [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
    'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F], 'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F], 'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    'I': [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E], 'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], 'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    'M': [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11], 'N': [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
    'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], 'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D], 'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E], 'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], 'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11], 'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04], 'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0x0C, 0x0C], ',': [0, 0, 0, 0, 0x0C, 0x04, 0x08],
    '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10], ':': [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0],
    '-': [0, 0, 0, 0x1F, 0, 0, 0], '+': [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0], '·': [0, 0, 0, 0x04, 0, 0, 0],
    '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03], '°': [0x0C, 0x12, 0x0C, 0, 0, 0, 0]
};

function text(str, x, y, scale, c, a = 1, spacing = 1) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
        const g = FONT[ch] || FONT[' '];
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 5; col++) {
                if (g[row] & (1 << (4 - col))) rect(cx + col * scale, y + row * scale, scale, scale, c, a);
            }
        }
        cx += (5 + spacing) * scale;
    }
    return cx - x;
}

const textWidth = (str, scale, spacing = 1) => str.length * (5 + spacing) * scale;

/* ---------------- PNG encoder ---------------- */

function crc32(bytes) {
    let c, crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = (crc ^ bytes[i]) & 0xFF;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
    /* one filter byte per scanline; filter 1 (Sub) compresses this kind of
       smooth-gradient image noticeably better than filter 0 */
    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        const o = y * (1 + w * 4);
        raw[o] = 1;
        for (let x = 0; x < w * 4; x++) {
            const cur = rgba[y * w * 4 + x];
            const left = x >= 4 ? rgba[y * w * 4 + x - 4] : 0;
            raw[o + 1 + x] = (cur - left) & 0xFF;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/* ---------------- the composition ----------------

   Layout is banded so nothing overlaps anything: a left column carries
   the wordmark and the measurement chips, the right two thirds carry the
   runner over a ground line, and the event timeline sits under both.
   ------------------------------------------------------------------ */

const C = {
    bg0: [8, 13, 24], bg1: [15, 24, 41], bg2: [22, 34, 58],
    line: [36, 52, 79], ink: [232, 238, 249], ink2: [147, 165, 196], ink3: [95, 115, 150],
    accent: [34, 211, 209], right: [240, 164, 74], ok: [52, 211, 153]
};

const LEFT_W = 470;            /* text column                       */
const GROUND_Y = H - 150;      /* the runners stand on this          */
const TL_Y = H - 92;           /* event timeline                     */

/* vertical gradient ground */
for (let y = 0; y < H; y++) {
    const t = y / H;
    rect(0, y, W, 1, [
        C.bg1[0] + (C.bg0[0] - C.bg1[0]) * t,
        C.bg1[1] + (C.bg0[1] - C.bg1[1]) * t,
        C.bg1[2] + (C.bg0[2] - C.bg1[2]) * t
    ], 1);
}
/* a faint measurement grid, because measurement is what this app is */
for (let x = 0; x < W; x += 46) rect(x, 0, 1, H, C.line, 0.18);
for (let y = 0; y < H; y += 46) rect(0, y, W, 1, C.line, 0.18);

/* ---- the runner ------------------------------------------------- */
const g = synthGait({
    fps: 120, durationS: 2.2, imageW: W, imageH: H,
    fillFrac: 0.50, strikeAngleDeg: 11
});
const cond = condition(g.series, { fps: 120 });
const ev = detectEvents(cond);
const K = CANONICAL.length;
const I = Object.fromEntries(CANONICAL.map((n, i) => [n, i]));

const BONES = [
    ['earL', 'earR', 'C'], ['earL', 'shoulderL', 'L'], ['earR', 'shoulderR', 'R'],
    ['shoulderL', 'shoulderR', 'C'], ['hipL', 'hipR', 'C'],
    ['shoulderL', 'hipL', 'L'], ['shoulderR', 'hipR', 'R'],
    ['shoulderL', 'elbowL', 'L'], ['elbowL', 'wristL', 'L'],
    ['shoulderR', 'elbowR', 'R'], ['elbowR', 'wristR', 'R'],
    ['wristL', 'handL', 'L'], ['wristR', 'handR', 'R'],
    ['hipL', 'kneeL', 'L'], ['kneeL', 'ankleL', 'L'],
    ['hipR', 'kneeR', 'R'], ['kneeR', 'ankleR', 'R'],
    ['ankleL', 'heelL', 'L'], ['heelL', 'toeL', 'L'], ['ankleL', 'toeL', 'L'],
    ['ankleR', 'heelR', 'R'], ['heelR', 'toeR', 'R'], ['ankleR', 'toeR', 'R']
];

/* The synthetic runner is generated on a treadmill, so every frame lands in
   the same place. Each pose is shifted by hand to read as a stride sequence.
   The vertical offset moves the whole figure so its lowest foot rests on the
   banner ground line rather than on the generator frame ground. */
function figureBounds(frame) {
    let lo = Infinity, hi = -Infinity, left = Infinity, right = -Infinity;
    for (let c = 0; c < K; c++) {
        const x = g.series.xy[(frame * K + c) * 2] * W;
        const y = g.series.xy[(frame * K + c) * 2 + 1] * H;
        /* landmarks this keypoint set does not have arrive as NaN, and one of
           them would poison every bound */
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        left = Math.min(left, x); right = Math.max(right, x);
    }
    return { top: lo, bottom: hi, left, right, cx: (left + right) / 2 };
}

function drawFigure(frame, atX, alpha, bright) {
    const b = figureBounds(frame);
    const dx = atX - b.cx;
    const dy = GROUND_Y - b.bottom;
    const at = (name) => ({
        x: g.series.xy[(frame * K + I[name]) * 2] * W + dx,
        y: g.series.xy[(frame * K + I[name]) * 2 + 1] * H + dy
    });
    for (const pass of [0, 1]) {
        for (const [a, bn, side] of BONES) {
            const p = at(a), q = at(bn);
            if (!Number.isFinite(p.x) || !Number.isFinite(q.x)) continue;
            if (pass === 0) {
                line(p.x, p.y, q.x, q.y, bright ? 10 : 7, [4, 8, 16], alpha * 0.6);
            } else {
                const col = side === 'L' ? C.accent : side === 'R' ? C.right : C.ink2;
                const wdt = bright ? 4.5 : 2.6;
                if (side === 'R') dashedLine(p.x, p.y, q.x, q.y, wdt, col, alpha);
                else line(p.x, p.y, q.x, q.y, wdt, col, alpha);
            }
        }
    }
    /* a head, so the figure reads as a person rather than as a stick with a
       stray dot floating above it */
    const earL = at('earL'), earR = at('earR'), sl = at('shoulderL'), sr = at('shoulderR');
    const head = { x: (earL.x + earR.x) / 2, y: (earL.y + earR.y) / 2 };
    const headR = Math.hypot(head.x - (sl.x + sr.x) / 2, head.y - (sl.y + sr.y) / 2) * 0.48;
    disc(head.x, head.y, headR + (bright ? 2.5 : 1.5), [4, 8, 16], alpha * 0.6);
    disc(head.x, head.y, headR, C.ink2, alpha * (bright ? 0.95 : 0.8));

    for (const name of CANONICAL) {
        if (name === 'nose' || name === 'earL' || name === 'earR') continue;
        const p = at(name);
        if (!Number.isFinite(p.x)) continue;
        const foot = /heel|toe|ankle/.test(name);
        const col = name.endsWith('R') ? C.right : name.endsWith('L') ? C.accent : C.ink2;
        disc(p.x, p.y, foot ? (bright ? 6.5 : 4) : (bright ? 5 : 3.2), col, alpha);
        if (bright) disc(p.x, p.y, foot ? 2.8 : 2.2, [10, 16, 28], alpha);
    }
    return { at, dx, dy };
}

/* Pick the hero frame at MID-STANCE of a clean left stride. A flight-phase
   pose has both legs scissored in mid-air and reads as a tangle at this size;
   mid-stance has one leg planted and the other driving through, which is the
   pose everybody recognises as running. */
const heroStride = ev.strides.find(s => s.valid && s.side === 'L' && s.toeoff) || ev.strides[0];
const tMid = heroStride ? heroStride.strike.t + (heroStride.stanceTime || 0.2) * 0.55 : 0.3;
const heroFrame = Math.max(2, Math.min(g.series.n - 3, Math.round(tMid * 120)));

/* ground line, drawn across the runner band only */
line(LEFT_W - 30, GROUND_Y, W - 40, GROUND_Y, 2, C.line, 0.95);

/* two ghosts trailing behind the hero, then the hero itself */
const heroX = LEFT_W + 460;
for (let k = 2; k >= 1; k--) {
    drawFigure((heroFrame - k * 15 + g.series.n) % g.series.n, heroX - k * 178, 0.15 + (2 - k) * 0.07, false);
}
const hero = drawFigure(heroFrame, heroX, 1, true);

/* knee angle arc on the hero figure: the app's signature annotation */
(function kneeArc() {
    const hip = hero.at('hipL'), knee = hero.at('kneeL'), ankle = hero.at('ankleL');
    const r = 52;
    const a1 = Math.atan2(hip.y - knee.y, hip.x - knee.x);
    const a2 = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const deg = Math.round(180 - Math.abs(sweep) * 180 / Math.PI);
    for (let i = 0; i < 64; i++) {
        const t0 = a1 + sweep * (i / 64), t1 = a1 + sweep * ((i + 1) / 64);
        line(knee.x + Math.cos(t0) * r, knee.y + Math.sin(t0) * r,
            knee.x + Math.cos(t1) * r, knee.y + Math.sin(t1) * r, 3, C.accent, 0.95);
    }
    const mid = a1 + sweep / 2;
    const lx = knee.x + Math.cos(mid) * (r + 38), ly = knee.y + Math.sin(mid) * (r + 38);
    const label = `${deg}°`;
    const w = textWidth(label, 3) + 20;
    roundRect(lx - w / 2, ly - 17, w, 34, 8, [10, 17, 30], 0.95);
    rect(lx - w / 2, ly - 17, w, 2, C.accent, 0.85);
    text(label, lx - w / 2 + 10, ly - 10, 3, C.ink, 1);
})();

/* ---- event timeline, under the runner band ---------------------- */
const tlX0 = LEFT_W - 30, tlX1 = W - 40;
line(tlX0, TL_Y, tlX1, TL_Y, 2, C.line, 1);
const tSpan = g.series.t[g.series.n - 1] - g.series.t[0];
for (const e of ev.strikes) {
    const x = tlX0 + (e.t / tSpan) * (tlX1 - tlX0);
    line(x, TL_Y - 14, x, TL_Y + 14, 3, e.side === 'R' ? C.right : C.accent, 0.95);
}
for (const e of ev.toeoffs) {
    const x = tlX0 + (e.t / tSpan) * (tlX1 - tlX0);
    line(x, TL_Y - 7, x, TL_Y + 7, 2, e.side === 'R' ? C.right : C.accent, 0.45);
}
text('FOOT STRIKE AND TOE-OFF, FROM FIVE INDEPENDENT DETECTORS', tlX0, TL_Y + 28, 2, C.ink3, 0.85);

/* ---- left column: wordmark, claim, chips ------------------------ */
const PAD = 64;
text('STRIDE', PAD, 92, 8, C.ink, 1);
text('LAB', PAD, 92 + 8 * 10, 8, C.accent, 1);
rect(PAD, 92 + 8 * 20 + 6, 150, 3, C.accent, 0.9);
text('RUNNING GAIT ANALYSIS', PAD, 92 + 8 * 20 + 30, 3, C.ink2, 0.95);
text('COMPUTED ENTIRELY IN YOUR BROWSER', PAD, 92 + 8 * 20 + 62, 2, C.ink3, 0.95);
text('THE VIDEO NEVER LEAVES YOUR DEVICE', PAD, 92 + 8 * 20 + 86, 2, C.ink3, 0.95);

const chips = [
    ['COM BOUNCE', '7.4', 'CM'],
    ['CADENCE', '170', 'SPM'],
    ['K VERT', '28', 'KN/M'],
    ['CONTACT', '226', 'MS']
];
let chipY = 420;
for (let i = 0; i < chips.length; i++) {
    const [label, value, unit] = chips[i];
    const col = i % 2, row = (i / 2) | 0;
    const cw = 186, ch = 92;
    const cxp = PAD + col * (cw + 16);
    const cyp = chipY + row * (ch + 16);
    roundRect(cxp, cyp, cw, ch, 11, C.bg2, 0.88);
    rect(cxp, cyp, cw, 2, C.accent, 0.5);
    text(label, cxp + 18, cyp + 18, 2, C.ink3, 0.95);
    const vw = textWidth(value, 5);
    text(value, cxp + 18, cyp + 44, 5, C.ink, 1);
    if (unit) text(unit, cxp + 18 + vw + 8, cyp + 58, 3, C.ink3, 0.9);
}

/* on-device badge, top right */
(function badge() {
    const label = 'ON-DEVICE';
    const w = textWidth(label, 3) + 40;
    const x = W - PAD - w, y = 86;
    roundRect(x, y, w, 42, 21, [12, 32, 32], 0.92);
    disc(x + 20, y + 21, 5.5, C.ok, 1);
    text(label, x + 34, y + 14, 3, C.ok, 1);
})();

/* ---------------- write ---------------- */

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, encodePng(buf, W, H));
console.log(`wrote ${OUT} (${W}x${H})`);
