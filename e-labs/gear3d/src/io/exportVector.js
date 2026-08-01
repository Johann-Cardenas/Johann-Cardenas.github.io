/* ============================================================
   Gear3D — vector export (SVG and PDF)
   ------------------------------------------------------------
   Hybrid composition, in both formats:

     - the WebGL render goes in as a raster underlay
     - the dimensions, labels, callouts and scale bar stay VECTOR

   That is the combination that survives journal production. A
   figure re-scaled by a typesetter keeps hairline dimension lines
   and selectable, searchable numbers; only the shaded render
   resamples.

   The PDF writer here is deliberately small and self-contained —
   no external library, because this app must deploy as static
   files and keep working offline. It writes a single page with one
   DCTDecode (JPEG) image XObject and a content stream translated
   from the SVG subset that the annotation engine actually emits:
   line, polyline, polygon, rect, circle and text. It is not a
   general SVG-to-PDF converter and does not pretend to be; it
   throws on anything it does not recognise rather than dropping it
   silently.
   ============================================================ */

'use strict';

import { inlineComputedColors } from './exportRaster.js';

/* ============================================================
   SVG
   ============================================================ */

/**
 * Build a standalone SVG document with the render embedded as a base64
 * raster and the annotations preserved as vector elements.
 *
 * @param {HTMLCanvasElement} renderCanvas full-resolution WebGL render
 * @param {SVGSVGElement} overlay live annotation overlay
 * @param {{width: number, height: number, sourceWidth: number, sourceHeight: number,
 *          title?: string, underlayFormat?: 'png'|'jpeg', quality?: number}} o
 * @returns {string} SVG source
 */
export function buildHybridSVG(renderCanvas, overlay, o) {
    const mime = o.underlayFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = renderCanvas.toDataURL(mime, o.quality ?? 0.95);

    const clone = /** @type {SVGSVGElement} */ (overlay.cloneNode(true));
    inlineComputedColors(overlay, clone);

    // Scale the annotation layer from viewport pixels to export pixels.
    const sx = o.width / o.sourceWidth;
    const sy = o.height / o.sourceHeight;
    const inner = Array.from(clone.childNodes)
        .map((n) => new XMLSerializer().serializeToString(n))
        .join('\n    ');

    const cs = getComputedStyle(overlay);
    const font = (cs.fontFamily || 'sans-serif').replace(/"/g, "'");

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}"
     color="${cs.color || '#16202b'}" font-family="${font}">
  <title>${escapeXml(o.title || 'Gear3D figure')}</title>
  <desc>Gear3D hybrid figure. The shaded render is an embedded raster; all dimensions, labels and the scale bar are vector.</desc>
  <image x="0" y="0" width="${o.width}" height="${o.height}"
         xlink:href="${dataUrl}" href="${dataUrl}"
         preserveAspectRatio="none"/>
  <g transform="scale(${sx} ${sy})">
    ${inner}
  </g>
</svg>
`;
}

/* ============================================================
   PDF
   ============================================================ */

/**
 * Build a single-page PDF with the render as a JPEG underlay and the
 * annotations as vector operators.
 *
 * @param {HTMLCanvasElement} renderCanvas
 * @param {SVGSVGElement} overlay
 * @param {{width: number, height: number, sourceWidth: number, sourceHeight: number,
 *          dpi?: number, quality?: number, title?: string}} o
 * @returns {Blob}
 */
export function buildHybridPDF(renderCanvas, overlay, o) {
    const dpi = o.dpi ?? 300;
    const ptW = (o.width * 72) / dpi;
    const ptH = (o.height * 72) / dpi;

    const jpegBytes = dataUrlToBytes(renderCanvas.toDataURL('image/jpeg', o.quality ?? 0.95));

    // Overlay pixels -> PDF points.
    const sx = ptW / o.sourceWidth;
    const sy = ptH / o.sourceHeight;

    const ops = [];
    ops.push('q');
    ops.push(`${f(ptW)} 0 0 ${f(ptH)} 0 0 cm`);
    ops.push('/Im0 Do');
    ops.push('Q');
    ops.push('q');
    ops.push('1 w 1 J 1 j');

    const clone = /** @type {SVGSVGElement} */ (overlay.cloneNode(true));
    inlineComputedColors(overlay, clone);
    emitNode(clone, ops, { sx, sy, ptH, inherited: {} });

    ops.push('Q');
    const content = ops.join('\n');

    return assemblePDF({
        content,
        jpeg: jpegBytes,
        imgW: renderCanvas.width,
        imgH: renderCanvas.height,
        ptW, ptH,
        title: o.title || 'Gear3D figure'
    });
}

/**
 * Walk the SVG subset and emit PDF operators.
 * @param {Node} node
 * @param {string[]} ops
 * @param {{sx:number, sy:number, ptH:number, inherited: object}} ctx
 */
function emitNode(node, ops, ctx) {
    if (node.nodeType !== 1) return;
    const e = /** @type {Element} */ (node);
    const tag = e.tagName.toLowerCase();

    const inherited = { ...ctx.inherited };
    for (const k of ['fill', 'stroke', 'stroke-width', 'font-size', 'opacity', 'color']) {
        const v = e.getAttribute(k);
        if (v) inherited[k] = v;
    }
    const sub = { ...ctx, inherited };

    /** @param {string} which @returns {string|null} */
    const paint = (which) => {
        const v = inherited[which];
        if (!v || v === 'none') return null;
        return v === 'currentColor' ? (inherited.color || '#16202b') : v;
    };

    const X = (v) => f(Number(v) * ctx.sx);
    const Y = (v) => f(ctx.ptH - Number(v) * ctx.sy);

    const applyAlpha = () => {
        // Constant alpha needs an ExtGState; rather than emit one per value,
        // near-transparent elements are simply skipped and the rest drawn
        // opaque. A dimension is either shown or it is not.
        const a = Number(inherited.opacity ?? 1);
        return a >= 0.35;
    };

    const strokeSetup = () => {
        const s = paint('stroke');
        if (!s) return false;
        const c = parseColor(s);
        ops.push(`${f(c.r)} ${f(c.g)} ${f(c.b)} RG`);
        const w = Number(inherited['stroke-width'] ?? 1) * ctx.sx;
        ops.push(`${f(Math.max(0.12, w))} w`);
        return true;
    };
    const fillSetup = () => {
        const s = paint('fill');
        if (!s) return false;
        const c = parseColor(s);
        ops.push(`${f(c.r)} ${f(c.g)} ${f(c.b)} rg`);
        return true;
    };

    if (applyAlpha()) {
        switch (tag) {
            case 'line': {
                if (strokeSetup()) {
                    ops.push(`${X(e.getAttribute('x1'))} ${Y(e.getAttribute('y1'))} m`);
                    ops.push(`${X(e.getAttribute('x2'))} ${Y(e.getAttribute('y2'))} l`);
                    ops.push('S');
                }
                break;
            }
            case 'polygon':
            case 'polyline': {
                const pts = (e.getAttribute('points') || '').trim().split(/\s+/)
                    .map((p) => p.split(',').map(Number))
                    .filter((p) => p.length === 2 && p.every(Number.isFinite));
                if (pts.length >= 2) {
                    const hasFill = fillSetup();
                    const hasStroke = strokeSetup();
                    ops.push(`${X(pts[0][0])} ${Y(pts[0][1])} m`);
                    for (const p of pts.slice(1)) ops.push(`${X(p[0])} ${Y(p[1])} l`);
                    if (tag === 'polygon') ops.push('h');
                    ops.push(hasFill && hasStroke ? 'B' : hasFill ? 'f' : 'S');
                }
                break;
            }
            case 'rect': {
                const x = Number(e.getAttribute('x')), y = Number(e.getAttribute('y'));
                const w = Number(e.getAttribute('width')), h = Number(e.getAttribute('height'));
                const hasFill = fillSetup();
                const hasStroke = strokeSetup();
                ops.push(`${X(x)} ${f(ctx.ptH - (y + h) * ctx.sy)} ${f(w * ctx.sx)} ${f(h * ctx.sy)} re`);
                ops.push(hasFill && hasStroke ? 'B' : hasFill ? 'f' : 'S');
                break;
            }
            case 'circle': {
                const cx = Number(e.getAttribute('cx')), cy = Number(e.getAttribute('cy'));
                const r = Number(e.getAttribute('r'));
                const hasFill = fillSetup();
                const hasStroke = strokeSetup();
                emitCircle(ops, cx * ctx.sx, ctx.ptH - cy * ctx.sy, r * ctx.sx);
                ops.push(hasFill && hasStroke ? 'B' : hasFill ? 'f' : 'S');
                break;
            }
            case 'text': {
                // Halo copies are stroke-only; PDF text stroking for a halo
                // costs more than it gains, so only filled text is emitted.
                if (paint('fill')) emitText(e, ops, ctx, inherited);
                break;
            }
            case 'title':
            case 'desc':
                break;
            default:
                // Containers are traversed; anything else is unexpected and
                // should be noticed, not silently dropped.
                if (tag !== 'g' && tag !== 'svg') {
                    throw new Error(
                        `PDF export met an SVG element it does not handle: <${tag}>. `
                        + 'Add support for it in io/exportVector.js rather than letting the '
                        + 'figure lose an annotation silently.'
                    );
                }
        }
    }

    for (const c of Array.from(e.childNodes)) emitNode(c, ops, sub);
}

/**
 * @param {Element} e
 * @param {string[]} ops
 * @param {{sx:number, sy:number, ptH:number}} ctx
 * @param {object} inherited
 */
function emitText(e, ops, ctx, inherited) {
    const text = (e.textContent || '').trim();
    if (!text) return;

    const size = Number(inherited['font-size'] ?? 12) * ctx.sx;
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const anchor = e.getAttribute('text-anchor') || 'start';

    const width = measureText(text, Number(inherited['font-size'] ?? 12));
    const dx = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
    // dominant-baseline: middle -> shift up by roughly 0.35 em.
    const dy = (e.getAttribute('dominant-baseline') === 'middle') ? -0.35 * Number(inherited['font-size'] ?? 12) : 0;

    // SVG rotate(deg cx cy): visually clockwise for positive deg because y
    // points down. PDF y points up, so the same visual rotation is -deg.
    let deg = 0, cx = x, cy = y;
    const tr = e.getAttribute('transform');
    if (tr) {
        const m = /rotate\(\s*(-?[\d.]+)(?:\s+(-?[\d.]+)\s+(-?[\d.]+))?\s*\)/.exec(tr);
        if (m) {
            deg = Number(m[1]);
            if (m[2] != null) { cx = Number(m[2]); cy = Number(m[3]); }
        }
    }

    const c = parseColor(inherited.fill === 'currentColor' ? (inherited.color || '#16202b') : inherited.fill);
    ops.push('BT');
    ops.push(`${f(c.r)} ${f(c.g)} ${f(c.b)} rg`);
    ops.push(`/F1 ${f(size)} Tf`);

    const rad = (-deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // Rotate about (cx, cy), then place the anchored text.
    const px = (x + dx - cx), py = -(y + dy - cy);
    const tx = cx * ctx.sx + (px * cos - py * sin) * ctx.sx;
    const ty = ctx.ptH - cy * ctx.sy + (px * sin + py * cos) * ctx.sy;
    ops.push(`${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${f(tx)} ${f(ty)} Tm`);
    ops.push(`(${escapePdfString(text)}) Tj`);
    ops.push('ET');
}

/** Reused canvas context for exact text metrics. */
let _measureCtx = null;

/**
 * Measure text in the same face the PDF will use, so centred labels land
 * where the SVG put them.
 * @param {string} text
 * @param {number} fontSize
 * @returns {number} width in SVG user units
 */
export function measureText(text, fontSize) {
    if (!_measureCtx) {
        const c = document.createElement('canvas');
        _measureCtx = c.getContext('2d');
    }
    _measureCtx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    return _measureCtx.measureText(text).width;
}

/**
 * Four Bezier arcs approximating a circle.
 * @param {string[]} ops
 * @param {number} cx @param {number} cy @param {number} r
 */
function emitCircle(ops, cx, cy, r) {
    const k = 0.5522847498 * r;
    ops.push(`${f(cx + r)} ${f(cy)} m`);
    ops.push(`${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`);
    ops.push(`${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`);
    ops.push(`${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`);
    ops.push(`${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`);
    ops.push('h');
}

/**
 * Assemble the PDF byte stream.
 * @param {{content: string, jpeg: Uint8Array, imgW: number, imgH: number,
 *          ptW: number, ptH: number, title: string}} p
 * @returns {Blob}
 */
function assemblePDF(p) {
    /** @type {Array<string|Uint8Array>} */
    const parts = [];
    /** @type {number[]} */
    const offsets = [0];
    let length = 0;

    const push = (chunk) => {
        parts.push(chunk);
        length += typeof chunk === 'string' ? utf8Length(chunk) : chunk.length;
    };
    const startObject = () => { offsets.push(length); };

    push('%PDF-1.4\n%âãÏÓ\n');

    // 1 Catalog
    startObject();
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2 Pages
    startObject();
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    // 3 Page
    startObject();
    push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.ptW)} ${f(p.ptH)}]\n`
        + '   /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >>\n'
        + '   /Contents 4 0 R >>\nendobj\n');

    // 4 Contents
    startObject();
    const contentBytes = utf8Length(p.content);
    push(`4 0 obj\n<< /Length ${contentBytes} >>\nstream\n`);
    push(p.content);
    push('\nendstream\nendobj\n');

    // 5 Image XObject
    startObject();
    push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.imgW} /Height ${p.imgH}\n`
        + `   /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');

    // 6 Font
    startObject();
    push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

    // 7 Info
    startObject();
    push(`7 0 obj\n<< /Title (${escapePdfString(p.title)}) /Producer (Gear3D) /Creator (Gear3D) >>\nendobj\n`);

    const xrefPos = length;
    const count = offsets.length;   // objects 1..count-1 plus the free entry
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) {
        xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    const blobParts = parts.map((c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c));
    return new Blob(blobParts, { type: 'application/pdf' });
}

/* ---------------- helpers ---------------- */

/** @param {number} v @returns {string} */
function f(v) {
    if (!Number.isFinite(v)) return '0';
    return (Math.round(v * 1000) / 1000).toString();
}

/** @param {string} s @returns {number} */
function utf8Length(s) { return new TextEncoder().encode(s).length; }

/** @param {string} s @returns {string} */
function escapePdfString(s) {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
        // The narrow no-break space and thin space have no WinAnsi code point;
        // a normal space keeps the number readable in the PDF.
        .replace(/[   ]/g, ' ')
        .replace(/[^\x20-\x7E]/g, '?');
}

/** @param {string} s @returns {string} */
function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {string} css
 * @returns {{r:number, g:number, b:number}} 0..1
 */
export function parseColor(css) {
    const s = (css || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1];
        return { r: parseInt(h[0] + h[0], 16) / 255, g: parseInt(h[1] + h[1], 16) / 255, b: parseInt(h[2] + h[2], 16) / 255 };
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
        const h = m[1];
        return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const p = m[1].split(',').map((v) => parseFloat(v));
        return { r: (p[0] || 0) / 255, g: (p[1] || 0) / 255, b: (p[2] || 0) / 255 };
    }
    return { r: 0.086, g: 0.125, b: 0.169 };   // --g3-ink
}

/**
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
export function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
