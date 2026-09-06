/* ============================================================
   E-Labs card banner kit — a tiny software rasterizer.
   ------------------------------------------------------------
   Shared by the generators in this directory. Same reasoning as
   e-labs/stride-lab/tools/make-banner.mjs, which this generalizes:
   no image library, no dependency, and the subset of drawing a
   banner needs is small.

   Two differences from that first tool:

   1. Everything is SUPERSAMPLED. The surface is allocated at
      `ss` times the requested size and box-filtered down on the
      way out, so polygons, contours and curves are anti-aliased
      without per-primitive coverage maths. `ss` is even, and the
      bitmap font is drawn at an integer scale, so glyph edges land
      on sample boundaries and the pixel type stays crisp.

   2. `field()` walks the output pixels of a rectangle and asks a
      callback for the color, which is how the contour and stress
      surfaces are drawn: smooth, at output resolution, straight
      from the numbers rather than from a grid of flat cells.
   ============================================================ */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* ---------------- surface ---------------- */

export function surface(W, H, ss = 2) {
    const w = W * ss, h = H * ss;
    const buf = new Float32Array(w * h * 3);

    function px(x, y, c, a) {
        if (a <= 0) return;
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = (y * w + x) * 3, ia = 1 - a;
        buf[i] = buf[i] * ia + c[0] * a;
        buf[i + 1] = buf[i + 1] * ia + c[1] * a;
        buf[i + 2] = buf[i + 2] * ia + c[2] * a;
    }

    /** Axis-aligned rectangle with fractional edge coverage. */
    function rect(X, Y, RW, RH, c, a = 1) {
        const x0 = X * ss, y0 = Y * ss, x1 = x0 + RW * ss, y1 = y0 + RH * ss;
        for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
            const cy = Math.min(y + 1, y1) - Math.max(y, y0);
            if (cy <= 0) continue;
            for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
                const cx = Math.min(x + 1, x1) - Math.max(x, x0);
                if (cx > 0) px(x, y, c, a * cx * cy);
            }
        }
    }

    function roundRect(X, Y, RW, RH, r, c, a = 1) {
        const x0 = X * ss, y0 = Y * ss, rw = RW * ss, rh = RH * ss, rr = r * ss;
        for (let y = 0; y < rh; y++) {
            for (let x = 0; x < rw; x++) {
                const dx = Math.min(x, rw - 1 - x), dy = Math.min(y, rh - 1 - y);
                let cov = 1;
                if (dx < rr && dy < rr) {
                    const d = Math.hypot(rr - dx, rr - dy);
                    cov = d <= rr - 1 ? 1 : d >= rr ? 0 : rr - d;
                }
                if (cov > 0) px(x0 + x, y0 + y, c, a * cov);
            }
        }
    }

    /** Anti-aliased thick line, coverage from distance to the segment. */
    function line(X0, Y0, X1, Y1, width, c, a = 1) {
        const x0 = X0 * ss, y0 = Y0 * ss, x1 = X1 * ss, y1 = Y1 * ss;
        const half = (width * ss) / 2;
        const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1));
        const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + half + 1));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1));
        const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + half + 1));
        const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
                const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
                const cov = d <= half - 0.5 ? 1 : d >= half + 0.5 ? 0 : half + 0.5 - d;
                if (cov > 0) px(x, y, c, a * cov);
            }
        }
    }

    function polyline(pts, width, c, a = 1) {
        for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width, c, a);
    }

    function dashedLine(X0, Y0, X1, Y1, width, c, a = 1, on = 9, off = 7) {
        const len = Math.hypot(X1 - X0, Y1 - Y0);
        if (len === 0) return;
        const ux = (X1 - X0) / len, uy = (Y1 - Y0) / len;
        for (let t = 0; t < len; t += on + off) {
            const e = Math.min(len, t + on);
            line(X0 + ux * t, Y0 + uy * t, X0 + ux * e, Y0 + uy * e, width, c, a);
        }
    }

    function disc(CX, CY, R, c, a = 1) {
        const cx = CX * ss, cy = CY * ss, r = R * ss;
        for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
            for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
                const d = Math.hypot(x - cx, y - cy);
                const cov = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : r + 0.5 - d;
                if (cov > 0) px(x, y, c, a * cov);
            }
        }
    }

    function ring(CX, CY, R, width, c, a = 1, seg = 96) {
        const pts = [];
        for (let i = 0; i <= seg; i++) {
            const t = (i / seg) * Math.PI * 2;
            pts.push([CX + Math.cos(t) * R, CY + Math.sin(t) * R]);
        }
        polyline(pts, width, c, a);
    }

    function arc(CX, CY, R, a0, a1, width, c, a = 1, seg = 64) {
        const pts = [];
        for (let i = 0; i <= seg; i++) {
            const t = a0 + (a1 - a0) * (i / seg);
            pts.push([CX + Math.cos(t) * R, CY + Math.sin(t) * R]);
        }
        polyline(pts, width, c, a);
    }

    /** Convex or simple polygon, scanline filled at sample resolution. */
    function polygon(pts, c, a = 1) {
        if (pts.length < 3) return;
        const P = pts.map(p => [p[0] * ss, p[1] * ss]);
        let minY = Infinity, maxY = -Infinity;
        for (const p of P) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
        const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
        const xs = [];
        for (let y = y0; y <= y1; y++) {
            const sy = y + 0.5;
            xs.length = 0;
            for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
                const [xi, yi] = P[i], [xj, yj] = P[j];
                if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
            }
            xs.sort((m, n) => m - n);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const xa = xs[k], xb = xs[k + 1];
                for (let x = Math.max(0, Math.floor(xa)); x < Math.min(w, Math.ceil(xb)); x++) {
                    const cov = Math.min(x + 1, xb) - Math.max(x, xa);
                    if (cov > 0) px(x, y, c, a * cov);
                }
            }
        }
    }

    /**
     * Walk the output pixels of a rectangle and ask `sample(u, v)` for a
     * color, where u and v run 0..1 across the rectangle. Return null to
     * leave the pixel alone. This is how contours and stress surfaces are
     * drawn: at output resolution, straight from the numbers.
     */
    function field(X, Y, FW, FH, sample, a = 1) {
        const x0 = Math.max(0, Math.round(X * ss)), y0 = Math.max(0, Math.round(Y * ss));
        const x1 = Math.min(w, Math.round((X + FW) * ss)), y1 = Math.min(h, Math.round((Y + FH) * ss));
        const dw = (X + FW) * ss - X * ss, dh = (Y + FH) * ss - Y * ss;
        for (let y = y0; y < y1; y++) {
            const v = (y + 0.5 - Y * ss) / dh;
            for (let x = x0; x < x1; x++) {
                const u = (x + 0.5 - X * ss) / dw;
                const c = sample(u, v);
                if (c) px(x, y, c, a * (c.length > 3 ? c[3] : 1));
            }
        }
    }

    function vgradient(X, Y, GW, GH, top, bottom, a = 1) {
        for (let y = 0; y < GH; y++) {
            const t = GH > 1 ? y / (GH - 1) : 0;
            rect(X, Y + y, GW, 1, [
                top[0] + (bottom[0] - top[0]) * t,
                top[1] + (bottom[1] - top[1]) * t,
                top[2] + (bottom[2] - top[2]) * t
            ], a);
        }
    }

    /** Radial falloff, for the soft glows behind the hero art. */
    function glow(CX, CY, R, c, a = 1, power = 2) {
        field(CX - R, CY - R, R * 2, R * 2, (u, v) => {
            const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
            const d = Math.hypot(dx, dy);
            if (d >= 1) return null;
            return [c[0], c[1], c[2], Math.pow(1 - d, power) * a];
        });
    }

    /* ---------------- 5x7 bitmap font ----------------
       Extends the Stride Lab set with the symbols these three
       apps actually print: Greek stress and strain names, the
       multiplication sign, brackets and arrows. */

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
        '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03], '°': [0x0C, 0x12, 0x0C, 0, 0, 0, 0],
        '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
        '=': [0, 0, 0x1F, 0, 0x1F, 0, 0], '×': [0, 0, 0x11, 0x0A, 0x04, 0x0A, 0x11],
        '→': [0, 0x04, 0x02, 0x1F, 0x02, 0x04, 0], '↓': [0x04, 0x04, 0x04, 0x15, 0x0E, 0x04, 0],
        'σ': [0, 0x0F, 0x12, 0x11, 0x11, 0x11, 0x0E], 'ε': [0, 0x0E, 0x10, 0x0C, 0x10, 0x10, 0x0E],
        'µ': [0, 0x11, 0x11, 0x11, 0x13, 0x1D, 0x10], 'α': [0, 0, 0x0D, 0x12, 0x12, 0x12, 0x0D],
        'Δ': [0x04, 0x0A, 0x0A, 0x11, 0x11, 0x11, 0x1F], '−': [0, 0, 0, 0x1F, 0, 0, 0],
        '_': [0, 0, 0, 0, 0, 0, 0x1F], '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        '#': [0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A], '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
        '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04], '"': [0x0A, 0x0A, 0, 0, 0, 0, 0],
        '≈': [0, 0, 0x0A, 0x15, 0, 0x0A, 0x15]
    };

    /* Characters the font keeps in their own case; everything else is
       upper-cased, because the set has no lowercase forms. */
    const CASED = new Set(['σ', 'ε', 'µ', 'α', 'Δ', '·', '°', '×', '→', '↓', '−', '≈']);

    function glyphs(str) {
        return [...str].map(ch => (CASED.has(ch) ? ch : ch.toUpperCase()));
    }

    function text(str, X, Y, scale, c, a = 1, spacing = 1) {
        let cx = X;
        for (const ch of glyphs(str)) {
            const g = FONT[ch] || FONT[' '];
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < 5; col++) {
                    if (g[row] & (1 << (4 - col))) rect(cx + col * scale, Y + row * scale, scale, scale, c, a);
                }
            }
            cx += (5 + spacing) * scale;
        }
        return cx - X;
    }

    const textWidth = (str, scale, spacing = 1) => [...str].length * (5 + spacing) * scale - spacing * scale;

    function textRight(str, X, Y, scale, c, a = 1, spacing = 1) {
        return text(str, X - textWidth(str, scale, spacing), Y, scale, c, a, spacing);
    }

    function textCenter(str, X, Y, scale, c, a = 1, spacing = 1) {
        return text(str, X - textWidth(str, scale, spacing) / 2, Y, scale, c, a, spacing);
    }

    /* ---------------- output ---------------- */

    function toRGBA() {
        const out = new Uint8ClampedArray(W * H * 4);
        const n = ss * ss;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let r = 0, g = 0, b = 0;
                for (let sy = 0; sy < ss; sy++) {
                    const row = (y * ss + sy) * w;
                    for (let sx = 0; sx < ss; sx++) {
                        const i = (row + x * ss + sx) * 3;
                        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
                    }
                }
                const o = (y * W + x) * 4;
                out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
            }
        }
        return out;
    }

    function write(path) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, encodePng(toRGBA(), W, H));
        return path;
    }

    return {
        W, H, ss,
        px, rect, roundRect, line, polyline, dashedLine, disc, ring, arc, polygon,
        field, vgradient, glow, text, textWidth, textRight, textCenter, toRGBA, write
    };
}

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

/**
 * 8-bit RGB PNG. The alpha channel is dropped — every banner is fully
 * opaque, and three bytes per pixel compresses meaningfully better than
 * four. Filter is chosen per scanline from the five standard ones by
 * smallest absolute sum, which is what makes smooth contour fields
 * compress at all.
 */
export function encodePng(rgba, w, h) {
    const bpp = 3, stride = w * bpp;
    const raw = Buffer.alloc(h * (1 + stride));
    const cur = Buffer.alloc(stride);
    let prev = Buffer.alloc(stride);
    const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            cur[x * 3] = rgba[(y * w + x) * 4];
            cur[x * 3 + 1] = rgba[(y * w + x) * 4 + 1];
            cur[x * 3 + 2] = rgba[(y * w + x) * 4 + 2];
        }
        let best = 0, bestScore = Infinity;
        for (let f = 0; f < 5; f++) {
            let score = 0;
            for (let x = 0; x < stride; x++) {
                const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
                let v;
                if (f === 0) v = cur[x];
                else if (f === 1) v = cur[x] - a;
                else if (f === 2) v = cur[x] - b;
                else if (f === 3) v = cur[x] - ((a + b) >> 1);
                else {
                    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    v = cur[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                }
                v &= 0xFF;
                cand[f][x] = v;
                score += v < 128 ? v : 256 - v;
            }
            if (score < bestScore) { bestScore = score; best = f; }
        }
        const o = y * (1 + stride);
        raw[o] = best;
        cand[best].copy(raw, o + 1);
        const t = prev; prev = Buffer.from(cur); cur.copy(t);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/* ---------------- color ---------------- */

export const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
];

export const mix = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
];

function ramp(stops) {
    return (t) => {
        t = Math.max(0, Math.min(1, t));
        const s = t * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(s));
        return mix(stops[i], stops[i + 1], s - i);
    };
}

/* Viridis, the five anchors Finite-Elemented's own cmap() uses. */
export const viridis = ramp([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]);

/* Plotly's YlOrRd and RdBu, the two scales AirCrafter and Asphera ask
   Plotly for by name. Transcribed from Plotly's colorscale table so the
   banners match what the apps put on screen. */
export const ylOrRd = ramp([
    [128, 0, 38], [189, 0, 38], [227, 26, 28], [252, 78, 42], [253, 141, 60],
    [254, 178, 76], [254, 217, 118], [255, 237, 160], [255, 255, 204]
]);

export const rdBu = ramp([
    [5, 10, 172], [106, 137, 247], [190, 190, 190], [220, 170, 132], [230, 145, 90], [178, 10, 28]
]);

/* Plotly interpolates RdBu on its own stop positions, not evenly. */
export function rdBuAt(t) {
    const stops = [
        [0.0, [5, 10, 172]], [0.35, [106, 137, 247]], [0.5, [190, 190, 190]],
        [0.6, [220, 170, 132]], [0.7, [230, 145, 90]], [1.0, [178, 10, 28]]
    ];
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
            const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            return mix(stops[i][1], stops[i + 1][1], f);
        }
    }
    return stops[stops.length - 1][1];
}

/* ---------------- shared layout helpers ---------------- */

/**
 * The 2x2 chip block every banner carries under its wordmark, and the
 * one piece of the Stride Lab card that is worth repeating verbatim:
 * four numbers, large, with their unit set small beside them.
 */
export function chips(s, entries, X, Y, opts = {}) {
    const cw = opts.w || 186, ch = opts.h || 92, gap = opts.gap || 16;
    const cols = opts.cols || 2;
    entries.forEach(([label, value, unit], i) => {
        const col = i % cols, row = (i / cols) | 0;
        const x = X + col * (cw + gap), y = Y + row * (ch + gap);
        s.roundRect(x, y, cw, ch, 11, opts.bg, 0.9);
        s.rect(x, y, cw, 2, opts.rule, 0.55);
        s.text(label, x + 18, y + 18, 2, opts.label, 0.95);
        const vw = s.text(value, x + 18, y + 44, 5, opts.value, 1);
        if (unit) s.text(unit, x + 18 + vw + 8, y + 58, 3, opts.label, 0.9);
    });
    return Y + Math.ceil(entries.length / cols) * (ch + gap) - gap;
}

/** A pill badge, as in the app chrome: dot, then a short label. */
export function badge(s, label, X, Y, opts) {
    const w = s.textWidth(label, 3) + 46;
    s.roundRect(X, Y, w, 42, 21, opts.bg, 0.94);
    s.disc(X + 21, Y + 21, 5.5, opts.dot, 1);
    s.text(label, X + 34, Y + 14, 3, opts.ink, 1);
    return w;
}

/**
 * Vertical colorbar, range at the ends. The label goes above by
 * default and below when `titleBelow` is set — the E-Labs card
 * paints a status badge over the banner's top right corner, so
 * nothing that has to be read may sit above y = 180 there.
 */
export function colorbar(s, X, Y, BW, BH, cmap, opts) {
    s.field(X, Y, BW, BH, (u, v) => cmap(1 - v));
    s.rect(X - 1, Y - 1, BW + 2, 1, opts.frame, 0.6);
    s.rect(X - 1, Y + BH, BW + 2, 1, opts.frame, 0.6);
    s.rect(X - 1, Y - 1, 1, BH + 2, opts.frame, 0.6);
    s.rect(X + BW, Y - 1, 1, BH + 2, opts.frame, 0.6);
    if (opts.title) {
        if (opts.titleBelow) s.text(opts.title, X - 2, Y + BH + 40, 2, opts.ink, 0.95);
        else s.text(opts.title, X - 2, Y - 24, 2, opts.ink, 0.95);
    }
    if (opts.max != null) s.text(opts.max, X + BW + 10, Y - 3, 2, opts.ink, 0.9);
    if (opts.mid != null) s.text(opts.mid, X + BW + 10, Y + BH / 2 - 7, 2, opts.ink2, 0.8);
    if (opts.min != null) s.text(opts.min, X + BW + 10, Y + BH - 11, 2, opts.ink, 0.9);
}
