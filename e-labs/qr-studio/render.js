/*!
 * render.js — styled QR rendering for QR Studio.
 *
 * One geometry pass, two backends. All layout and shape work happens in
 * *module units* (1 unit = 1 QR module) and is emitted through a small surface
 * interface; CanvasSurface and SvgSurface then translate those primitives.
 * Doing it this way means the on-screen preview, the exported PNG and the
 * exported SVG are the same drawing at three resolutions rather than three
 * implementations that slowly drift apart.
 *
 * Curves are emitted only as cubic beziers, which both backends reproduce
 * exactly — arcs would need separate, and subtly different, code per backend.
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QRRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var KAPPA = 0.5522847498307936;   // circle-to-bezier control point ratio

    // ------------------------------------------------------------ path maths

    /** Rounded rectangle with independent corner radii [tl, tr, br, bl]. */
    function roundRectPath(x, y, w, h, radii) {
        var r = Array.isArray(radii) ? radii.slice() : [radii, radii, radii, radii];
        var max = Math.min(w, h) / 2;
        for (var i = 0; i < 4; i++) r[i] = Math.max(0, Math.min(r[i], max));
        var k = KAPPA, p = [];
        p.push(['M', x + r[0], y]);
        p.push(['L', x + w - r[1], y]);
        if (r[1]) p.push(['C', x + w - r[1] + r[1] * k, y, x + w, y + r[1] - r[1] * k, x + w, y + r[1]]);
        p.push(['L', x + w, y + h - r[2]]);
        if (r[2]) p.push(['C', x + w, y + h - r[2] + r[2] * k, x + w - r[2] + r[2] * k, y + h, x + w - r[2], y + h]);
        p.push(['L', x + r[3], y + h]);
        if (r[3]) p.push(['C', x + r[3] - r[3] * k, y + h, x, y + h - r[3] + r[3] * k, x, y + h - r[3]]);
        p.push(['L', x, y + r[0]]);
        if (r[0]) p.push(['C', x, y + r[0] - r[0] * k, x + r[0] - r[0] * k, y, x + r[0], y]);
        p.push(['Z']);
        return p;
    }

    function circlePath(cx, cy, r) {
        var k = r * KAPPA;
        return [
            ['M', cx, cy - r],
            ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
            ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
            ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
            ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
            ['Z']
        ];
    }

    // ------------------------------------------------------- module shapes

    var MODULE_SHAPES = {
        square: 'Square',
        rounded: 'Rounded',
        'extra-rounded': 'Extra rounded',
        dots: 'Dots',
        classy: 'Classy',
        fluid: 'Fluid',
        vertical: 'Vertical bars',
        horizontal: 'Horizontal bars'
    };

    /**
     * Path for one data module. `has(dx, dy)` reports whether the neighbouring
     * module is dark, which is what lets the connected shapes join up.
     *
     * Ink coverage is deliberately kept high across every shape. A decoder
     * thresholds local blocks of pixels rather than sampling module centres
     * alone, so a shape that paints only ~60% of its cell leaves the binarizer
     * no margin and starts to fail non-monotonically with render size. Each
     * shape below fills as much of its cell as its silhouette allows; the
     * scan harness measures the resulting coverage.
     */
    function modulePath(shape, x, y, has) {
        switch (shape) {
            case 'square':
                return roundRectPath(x, y, 1, 1, 0);
            case 'rounded':
                return roundRectPath(x, y, 1, 1, 0.26);
            case 'extra-rounded':
                return roundRectPath(x, y, 1, 1, 0.40);
            case 'dots':
                return circlePath(x + 0.5, y + 0.5, 0.5);
            case 'classy':
                // Sharp on one diagonal, round on the other — the "classy" look.
                return roundRectPath(x, y, 1, 1, [0.44, 0, 0.44, 0]);
            case 'vertical':
                return roundRectPath(x + 0.03, y, 0.94, 1,
                    [has(0, -1) ? 0 : 0.47, has(0, -1) ? 0 : 0.47,
                     has(0, 1) ? 0 : 0.47, has(0, 1) ? 0 : 0.47]);
            case 'horizontal':
                return roundRectPath(x, y + 0.03, 1, 0.94,
                    [has(-1, 0) ? 0 : 0.47, has(1, 0) ? 0 : 0.47,
                     has(1, 0) ? 0 : 0.47, has(-1, 0) ? 0 : 0.47]);
            case 'fluid':
            default:
                // Round a corner only where both of its edges are exposed, so
                // adjacent modules flow into one another.
                var r = 0.5;
                return roundRectPath(x, y, 1, 1, [
                    (!has(-1, 0) && !has(0, -1)) ? r : 0,
                    (!has(1, 0) && !has(0, -1)) ? r : 0,
                    (!has(1, 0) && !has(0, 1)) ? r : 0,
                    (!has(-1, 0) && !has(0, 1)) ? r : 0
                ]);
        }
    }

    // ---------------------------------------------------------- eye shapes

    var EYE_FRAME_SHAPES = {
        square: 'Square',
        rounded: 'Rounded',
        'extra-rounded': 'Extra rounded',
        circle: 'Circle',
        leaf: 'Leaf',
        'leaf-alt': 'Leaf (mirrored)'
    };
    var EYE_BALL_SHAPES = {
        square: 'Square',
        rounded: 'Rounded',
        'extra-rounded': 'Extra rounded',
        circle: 'Circle',
        leaf: 'Leaf'
    };

    function eyeFrameRadii(shape) {
        switch (shape) {
            case 'square': return [0, 0, 0, 0];
            case 'rounded': return [1.6, 1.6, 1.6, 1.6];
            case 'extra-rounded': return [2.6, 2.6, 2.6, 2.6];
            case 'circle': return [3.5, 3.5, 3.5, 3.5];
            case 'leaf': return [3.5, 0, 3.5, 0];
            case 'leaf-alt': return [0, 3.5, 0, 3.5];
            default: return [1.6, 1.6, 1.6, 1.6];
        }
    }

    /** Eye frame: a 7x7 ring drawn as outer + inner subpath, filled even-odd. */
    function eyeFramePath(shape, ox, oy) {
        var outer = eyeFrameRadii(shape);
        var inner = outer.map(function (v) { return Math.max(0, v - 1); });
        return roundRectPath(ox, oy, 7, 7, outer)
            .concat(roundRectPath(ox + 1, oy + 1, 5, 5, inner));
    }

    /**
     * Eye centre: the 3x3 core of a finder pattern.
     *
     * Scanners locate a symbol by the 1:1:3:1:1 dark/light run ratio through a
     * finder, where the "3" is this core. The rounded variants keep a 3-module
     * run on every scan line that crosses them; a true circle does not — off
     * the centre row its chord narrows to about 2.2 modules, which strict
     * locators reject outright. Circle and leaf are kept because phone cameras
     * do tolerate them and the look is popular, but SHAPE_RISK below records
     * what the scan harness actually measured so the UI can say so.
     */
    function eyeBallPath(shape, ox, oy) {
        var x = ox + 2, y = oy + 2;
        switch (shape) {
            case 'square': return roundRectPath(x, y, 3, 3, 0);
            case 'rounded': return roundRectPath(x, y, 3, 3, 0.8);
            case 'extra-rounded': return roundRectPath(x, y, 3, 3, 1.2);
            case 'circle': return circlePath(x + 1.5, y + 1.5, 1.5);
            case 'leaf': return roundRectPath(x, y, 3, 3, [1.5, 0, 1.5, 0]);
            default: return roundRectPath(x, y, 3, 3, 0.8);
        }
    }

    // ------------------------------------------------------------- frames

    // Frame geometry in module units. `pad` is the gap between the quiet zone
    // and the frame's inner edge; `caption` reserves a text band.
    var FRAMES = {
        none: { label: 'None', pad: 0, border: 0, radius: 0, caption: null },
        thin: { label: 'Hairline', pad: 1.4, border: 0.28, radius: 1.6, caption: null },
        solid: { label: 'Solid border', pad: 1.6, border: 1.1, radius: 0, caption: null },
        rounded: { label: 'Rounded border', pad: 1.6, border: 1.1, radius: 3, caption: null },
        'caption-bottom': { label: 'Caption below', pad: 1.4, border: 1.0, radius: 2.4, caption: 'bottom' },
        'caption-top': { label: 'Caption above', pad: 1.4, border: 1.0, radius: 2.4, caption: 'top' },
        bubble: { label: 'Speech bubble', pad: 1.4, border: 1.0, radius: 2.6, caption: 'bottom', tail: true },
        card: { label: 'Card', pad: 2.2, border: 0, radius: 3.2, caption: 'bottom', plate: true },
        badge: { label: 'Badge', pad: 1.8, border: 0.5, radius: 2.6, caption: 'overlap' }
    };

    /**
     * Measured decode robustness, from test/scan-harness.html.
     *
     * Each entry is how many of five render sizes a strict image decoder (jsQR)
     * read back, with square defaults elsewhere. These are measurements, not
     * opinions — rerun the harness and update them if the shapes change.
     *
     * Context for the low scores: the same harness run against qr-code-styling,
     * the library behind most commercial QR generators, produces the same
     * pattern (its dotted style also fails ~2 of 5 sizes). Dotted and circular
     * geometry is simply harder to threshold. Phone cameras are markedly more
     * tolerant than jsQR, which is why these shapes remain on offer rather than
     * being removed — but a user aiming a code at unknown scanners deserves to
     * be told which choices spend margin.
     */
    var SHAPE_RISK = {
        module: { square: 5, rounded: 5, 'extra-rounded': 5, fluid: 5, horizontal: 5, classy: 4, vertical: 4, dots: 3 },
        eyeFrame: { square: 5, rounded: 5, 'extra-rounded': 5, 'leaf-alt': 5, circle: 2, leaf: 2 },
        eyeBall: { square: 5, rounded: 5, 'extra-rounded': 5, circle: 0, leaf: 0 }
    };

    var FONT_STACKS = {
        'source-sans': { label: 'Source Sans Pro', stack: '"Source Sans Pro", "Segoe UI", sans-serif', web: false },
        system: { label: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', web: false },
        georgia: { label: 'Georgia serif', stack: 'Georgia, "Times New Roman", serif', web: false },
        mono: { label: 'Monospace', stack: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace', web: false },
        inter: { label: 'Inter', stack: '"Inter", system-ui, sans-serif', web: 'Inter:wght@400;600;700' },
        montserrat: { label: 'Montserrat', stack: '"Montserrat", system-ui, sans-serif', web: 'Montserrat:wght@400;600;700' },
        playfair: { label: 'Playfair Display', stack: '"Playfair Display", Georgia, serif', web: 'Playfair+Display:wght@400;600;700' },
        oswald: { label: 'Oswald', stack: '"Oswald", "Arial Narrow", sans-serif', web: 'Oswald:wght@400;600;700' }
    };

    // ------------------------------------------------------ text measuring

    var _measureCanvas = null;
    function measureText(text, fontCss) {
        if (typeof document === 'undefined') return text.length * 0.5;
        if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
        var ctx = _measureCanvas.getContext('2d');
        ctx.font = fontCss;
        return ctx.measureText(text).width;
    }

    // ------------------------------------------------------------- layout

    /**
     * Work out the full drawing box, in module units, for a symbol + style.
     * Backends consume this; nothing here touches a canvas or the DOM except
     * for text measurement.
     */
    function computeLayout(symbol, style) {
        var n = symbol.size;
        var margin = Math.max(0, style.margin);
        var frame = FRAMES[style.frame.style] || FRAMES.none;

        var qrBox = n + margin * 2;                 // QR plus its quiet zone
        var pad = frame.pad;
        var border = frame.border;

        var hasCaption = !!frame.caption && String(style.frame.text || '').trim().length > 0;
        var fontSize = style.frame.fontSize;        // in module units
        var captionBand = hasCaption ? Math.max(fontSize * 1.9, 4) : 0;
        var tailH = (frame.tail && hasCaption) ? 1.8 : 0;

        var innerW = qrBox + pad * 2;
        var innerH = qrBox + pad * 2;

        var width = innerW + border * 2;
        var height = innerH + border * 2 + captionBand + tailH;

        // Where the module grid starts (quiet zone already accounted for).
        var qrX = border + pad + margin;
        var qrY = border + pad + margin + (frame.caption === 'top' ? captionBand : 0);

        var captionRect = null;
        if (hasCaption) {
            if (frame.caption === 'top') {
                captionRect = { x: 0, y: 0, w: width, h: captionBand + border };
            } else if (frame.caption === 'overlap') {
                // A pill that straddles the bottom edge of the frame.
                captionRect = { x: width * 0.12, y: height - captionBand - border, w: width * 0.76, h: captionBand };
            } else {
                captionRect = { x: 0, y: height - captionBand - tailH, w: width, h: captionBand };
            }
        }
        if (frame.caption === 'overlap') height += 0;

        return {
            width: width,
            height: height,
            qrX: qrX,
            qrY: qrY,
            modules: n,
            margin: margin,
            frame: frame,
            hasCaption: hasCaption,
            captionRect: captionRect,
            captionBand: captionBand,
            tailH: tailH,
            border: border,
            radius: frame.radius,
            plateRect: { x: border, y: border + (frame.caption === 'top' ? captionBand : 0), w: innerW, h: innerH }
        };
    }

    // -------------------------------------------------------------- paints

    function paintBox(layout) {
        return { x: layout.qrX, y: layout.qrY, w: layout.modules, h: layout.modules };
    }

    /** Endpoint coordinates for a linear gradient at `angle` across `box`. */
    function gradientLine(box, angle) {
        var rad = (angle || 0) * Math.PI / 180;
        var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        var len = Math.abs(box.w * Math.cos(rad)) + Math.abs(box.h * Math.sin(rad));
        var dx = Math.cos(rad) * len / 2, dy = Math.sin(rad) * len / 2;
        return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
    }

    // ------------------------------------------------------ Canvas surface

    function CanvasSurface(ctx, scale) {
        this.ctx = ctx;
        this.scale = scale;
    }
    CanvasSurface.prototype._resolve = function (paint, box) {
        var ctx = this.ctx, s = this.scale, g;
        if (!paint || paint.type === 'none') return null;
        if (paint.type === 'linear') {
            var L = gradientLine(box, paint.angle);
            g = ctx.createLinearGradient(L.x1 * s, L.y1 * s, L.x2 * s, L.y2 * s);
        } else if (paint.type === 'radial') {
            var r = Math.max(box.w, box.h) * 0.72 * s;
            g = ctx.createRadialGradient((box.x + box.w / 2) * s, (box.y + box.h / 2) * s, 0,
                (box.x + box.w / 2) * s, (box.y + box.h / 2) * s, r);
        } else {
            return paint.color;
        }
        paint.stops.forEach(function (st) { g.addColorStop(st.offset, st.color); });
        return g;
    };
    CanvasSurface.prototype.path = function (cmds, paint, box, fillRule) {
        var fill = this._resolve(paint, box);
        if (!fill) return;
        var ctx = this.ctx, s = this.scale;
        ctx.beginPath();
        for (var i = 0; i < cmds.length; i++) {
            var c = cmds[i];
            if (c[0] === 'M') ctx.moveTo(c[1] * s, c[2] * s);
            else if (c[0] === 'L') ctx.lineTo(c[1] * s, c[2] * s);
            else if (c[0] === 'C') ctx.bezierCurveTo(c[1] * s, c[2] * s, c[3] * s, c[4] * s, c[5] * s, c[6] * s);
            else if (c[0] === 'Z') ctx.closePath();
        }
        ctx.fillStyle = fill;
        ctx.fill(fillRule || 'nonzero');
    };
    CanvasSurface.prototype.image = function (img, x, y, w, h) {
        if (!img) return;
        var s = this.scale;
        this.ctx.drawImage(img, x * s, y * s, w * s, h * s);
    };
    CanvasSurface.prototype.text = function (str, x, y, o) {
        var ctx = this.ctx, s = this.scale;
        ctx.save();
        ctx.font = o.weight + ' ' + (o.size * s) + 'px ' + o.stack;
        ctx.fillStyle = o.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (o.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = (o.letterSpacing * s) + 'px';
        ctx.fillText(str, x * s, y * s);
        ctx.restore();
    };
    CanvasSurface.prototype.clipPush = function (cmds) {
        var ctx = this.ctx, s = this.scale;
        ctx.save();
        ctx.beginPath();
        for (var i = 0; i < cmds.length; i++) {
            var c = cmds[i];
            if (c[0] === 'M') ctx.moveTo(c[1] * s, c[2] * s);
            else if (c[0] === 'L') ctx.lineTo(c[1] * s, c[2] * s);
            else if (c[0] === 'C') ctx.bezierCurveTo(c[1] * s, c[2] * s, c[3] * s, c[4] * s, c[5] * s, c[6] * s);
            else if (c[0] === 'Z') ctx.closePath();
        }
        ctx.clip();
    };
    CanvasSurface.prototype.clipPop = function () { this.ctx.restore(); };

    // --------------------------------------------------------- SVG surface

    function SvgSurface(width, height, scale) {
        this.w = width; this.h = height; this.scale = scale;
        this.defs = [];
        this.body = [];
        this._id = 0;
        this._clipDepth = 0;
    }
    SvgSurface.prototype._num = function (v) {
        return (Math.round(v * this.scale * 1000) / 1000);
    };
    SvgSurface.prototype._resolve = function (paint, box) {
        if (!paint || paint.type === 'none') return null;
        if (paint.type === 'solid') return paint.color;
        var id = 'g' + (++this._id);
        var stops = paint.stops.map(function (st) {
            return '<stop offset="' + st.offset + '" stop-color="' + st.color + '"/>';
        }).join('');
        if (paint.type === 'linear') {
            var L = gradientLine(box, paint.angle);
            this.defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' +
                this._num(L.x1) + '" y1="' + this._num(L.y1) + '" x2="' + this._num(L.x2) +
                '" y2="' + this._num(L.y2) + '">' + stops + '</linearGradient>');
        } else {
            var cx = this._num(box.x + box.w / 2), cy = this._num(box.y + box.h / 2);
            var r = this._num(Math.max(box.w, box.h) * 0.72);
            this.defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' +
                cx + '" cy="' + cy + '" r="' + r + '">' + stops + '</radialGradient>');
        }
        return 'url(#' + id + ')';
    };
    SvgSurface.prototype._d = function (cmds) {
        var self = this, out = [];
        cmds.forEach(function (c) {
            if (c[0] === 'M') out.push('M' + self._num(c[1]) + ' ' + self._num(c[2]));
            else if (c[0] === 'L') out.push('L' + self._num(c[1]) + ' ' + self._num(c[2]));
            else if (c[0] === 'C') out.push('C' + self._num(c[1]) + ' ' + self._num(c[2]) + ' ' +
                self._num(c[3]) + ' ' + self._num(c[4]) + ' ' + self._num(c[5]) + ' ' + self._num(c[6]));
            else if (c[0] === 'Z') out.push('Z');
        });
        return out.join(' ');
    };
    SvgSurface.prototype.path = function (cmds, paint, box, fillRule) {
        var fill = this._resolve(paint, box);
        if (!fill) return;
        this.body.push('<path d="' + this._d(cmds) + '" fill="' + fill + '"' +
            (fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '') + '/>');
    };
    SvgSurface.prototype.image = function (img, x, y, w, h) {
        if (!img || !img.src) return;
        this.body.push('<image href="' + img.src + '" xlink:href="' + img.src + '" x="' + this._num(x) +
            '" y="' + this._num(y) + '" width="' + this._num(w) + '" height="' + this._num(h) +
            '" preserveAspectRatio="xMidYMid meet"/>');
    };
    SvgSurface.prototype.text = function (str, x, y, o) {
        var esc = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        this.body.push('<text x="' + this._num(x) + '" y="' + this._num(y) +
            '" font-family="' + o.stack.replace(/"/g, "'") + '" font-size="' + this._num(o.size) +
            '" font-weight="' + o.weight + '" fill="' + o.color +
            '" text-anchor="middle" dominant-baseline="central"' +
            (o.letterSpacing ? ' letter-spacing="' + this._num(o.letterSpacing) + '"' : '') +
            '>' + esc + '</text>');
    };
    SvgSurface.prototype.clipPush = function (cmds) {
        var id = 'c' + (++this._id);
        this.defs.push('<clipPath id="' + id + '"><path d="' + this._d(cmds) + '"/></clipPath>');
        this.body.push('<g clip-path="url(#' + id + ')">');
        this._clipDepth++;
    };
    SvgSurface.prototype.clipPop = function () {
        if (this._clipDepth > 0) { this.body.push('</g>'); this._clipDepth--; }
    };
    SvgSurface.prototype.toString = function () {
        var w = this._num(this.w), h = this._num(this.h);
        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
            'width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">\n' +
            (this.defs.length ? '<defs>' + this.defs.join('') + '</defs>\n' : '') +
            this.body.join('\n') + '\n</svg>\n';
    };

    // -------------------------------------------------------------- render

    function isFinderModule(n, x, y) {
        return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    }

    /**
     * Draw a symbol onto a surface. `style` is the full design state; `assets`
     * carries the resolved logo image element (browser only).
     */
    function render(symbol, style, surface, layout, assets) {
        assets = assets || {};
        var n = symbol.size;
        var L = layout;
        var box = paintBox(L);
        var frame = L.frame;

        // ---- frame background / plate
        var outerPath = roundRectPath(0, 0, L.width, L.height, L.radius);
        if (style.frame.style !== 'none') {
            surface.path(outerPath, solid(style.frame.color), box);
        }

        var plateRadius = Math.max(0, L.radius - L.border);
        var plate = L.plateRect;
        var bgPaint = style.bg;
        if (frame.plate || style.frame.style === 'none') {
            // Card frames sit the QR on its own plate; a frameless code just
            // paints its background across the whole box.
            if (style.frame.style === 'none') {
                surface.path(roundRectPath(0, 0, L.width, L.height, 0), bgPaint, box);
            } else {
                surface.path(roundRectPath(plate.x, plate.y, plate.w, plate.h, plateRadius), bgPaint, box);
            }
        } else {
            surface.path(roundRectPath(plate.x, plate.y, plate.w, plate.h, plateRadius), bgPaint, box);
        }

        // ---- logo clear region (in module coordinates)
        var clear = null;
        if (assets.logo && style.logo.excavate) {
            var half = (style.logo.size * n) / 2 + style.logo.padding;
            clear = {
                x0: n / 2 - half, x1: n / 2 + half,
                y0: n / 2 - half, y1: n / 2 + half
            };
        }

        var has = function (x, y) {
            return function (dx, dy) {
                var nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= n || ny >= n) return false;
                if (isFinderModule(n, nx, ny)) return false;
                return symbol.modules[ny][nx];
            };
        };

        // ---- data modules, accumulated into a single path per paint
        var dataCmds = [];
        for (var y = 0; y < n; y++) {
            for (var x = 0; x < n; x++) {
                if (!symbol.modules[y][x]) continue;
                if (isFinderModule(n, x, y)) continue;
                if (clear && x + 1 > clear.x0 && x < clear.x1 && y + 1 > clear.y0 && y < clear.y1) continue;
                var p = modulePath(style.moduleShape, L.qrX + x, L.qrY + y, has(x, y));
                dataCmds = dataCmds.concat(p);
            }
        }
        surface.path(dataCmds, style.fg, box);

        // ---- the three finder patterns
        var eyeOrigins = [[0, 0], [n - 7, 0], [0, n - 7]];
        var framePaint = style.eyeFrameColor ? solid(style.eyeFrameColor) : style.fg;
        var ballPaint = style.eyeBallColor ? solid(style.eyeBallColor) : style.fg;
        var frameCmds = [], ballCmds = [];
        eyeOrigins.forEach(function (o) {
            frameCmds = frameCmds.concat(eyeFramePath(style.eyeFrameShape, L.qrX + o[0], L.qrY + o[1]));
            ballCmds = ballCmds.concat(eyeBallPath(style.eyeBallShape, L.qrX + o[0], L.qrY + o[1]));
        });
        surface.path(frameCmds, framePaint, box, 'evenodd');
        surface.path(ballCmds, ballPaint, box);

        // ---- logo
        if (assets.logo) {
            var lw = style.logo.size * n;
            var lx = L.qrX + (n - lw) / 2, ly = L.qrY + (n - lw) / 2;
            var padv = style.logo.padding;
            if (style.logo.shape !== 'none') {
                var bx = lx - padv, by = ly - padv, bw = lw + padv * 2;
                var br = style.logo.shape === 'circle' ? bw / 2 : (style.logo.shape === 'rounded' ? bw * 0.18 : 0);
                surface.path(roundRectPath(bx, by, bw, bw, br), solid(style.logo.bgColor), box);
            }
            if (style.logo.clip && style.logo.shape === 'circle') {
                surface.clipPush(circlePath(lx + lw / 2, ly + lw / 2, lw / 2));
                surface.image(assets.logo, lx, ly, lw, lw);
                surface.clipPop();
            } else {
                surface.image(assets.logo, lx, ly, lw, lw);
            }
        }

        // ---- frame caption
        if (L.hasCaption && L.captionRect) {
            var cr = L.captionRect;
            var f = style.frame;
            var stack = (FONT_STACKS[f.font] || FONT_STACKS['source-sans']).stack;

            if (frame.caption === 'overlap') {
                surface.path(roundRectPath(cr.x, cr.y, cr.w, cr.h, cr.h / 2), solid(f.color), box);
            } else if (frame.tail) {
                var t = L.tailH, midX = L.width / 2;
                surface.path([
                    ['M', midX - t, cr.y + cr.h - 0.1],
                    ['L', midX + t, cr.y + cr.h - 0.1],
                    ['L', midX, cr.y + cr.h + t],
                    ['Z']
                ], solid(f.color), box);
            }

            // Shrink the type until the phrase fits the band with a safe inset.
            var maxW = cr.w * 0.86;
            var size = f.fontSize;
            var text = String(f.text);
            for (var guard = 0; guard < 40; guard++) {
                var w = measureText(text, f.fontWeight + ' ' + (size * 10) + 'px ' + stack) / 10;
                if (w <= maxW || size <= 1.2) break;
                size *= 0.94;
            }
            surface.text(text, cr.x + cr.w / 2, cr.y + cr.h / 2, {
                size: size,
                weight: f.fontWeight,
                stack: stack,
                color: f.textColor,
                letterSpacing: f.letterSpacing || 0
            });
        }
    }

    function solid(color) { return { type: 'solid', color: color }; }

    // ------------------------------------------------- scannability advice

    function parseHex(c) {
        if (!c) return null;
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
        if (!m) return null;
        var h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function relLuminance(rgb) {
        var a = rgb.map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    function contrastRatio(c1, c2) {
        var a = parseHex(c1), b = parseHex(c2);
        if (!a || !b) return null;
        var l1 = relLuminance(a), l2 = relLuminance(b);
        var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }

    function paintAverageColor(paint) {
        if (!paint) return null;
        if (paint.type === 'solid') return paint.color;
        if (!paint.stops || !paint.stops.length) return null;
        var sums = [0, 0, 0], count = 0;
        paint.stops.forEach(function (s) {
            var rgb = parseHex(s.color);
            if (rgb) { sums[0] += rgb[0]; sums[1] += rgb[1]; sums[2] += rgb[2]; count++; }
        });
        if (!count) return null;
        return '#' + sums.map(function (v) {
            return Math.round(v / count).toString(16).padStart(2, '0');
        }).join('');
    }

    /**
     * Heuristic pre-flight. This predicts the common causes of unreadable
     * codes; it is deliberately advisory, and the live decode check in the app
     * is the authoritative answer.
     */
    function assessScannability(symbol, style) {
        var issues = [];
        var score = 100;

        var fgAvg = paintAverageColor(style.fg);
        var bgAvg = style.bg && style.bg.type !== 'none' ? paintAverageColor(style.bg) : '#ffffff';
        var ratio = contrastRatio(fgAvg, bgAvg);
        if (ratio !== null) {
            if (ratio < 3) { issues.push({ level: 'error', text: 'Contrast ' + ratio.toFixed(1) + ':1 is too low — most scanners need 3:1 or better.' }); score -= 45; }
            else if (ratio < 5) { issues.push({ level: 'warn', text: 'Contrast ' + ratio.toFixed(1) + ':1 is workable but tight; 7:1 scans far more reliably.' }); score -= 15; }
        }

        // A light foreground on a dark background is inverted; many readers
        // cope, but a meaningful minority still do not.
        var fgL = parseHex(fgAvg) ? relLuminance(parseHex(fgAvg)) : 0;
        var bgL = parseHex(bgAvg) ? relLuminance(parseHex(bgAvg)) : 1;
        if (fgL > bgL) { issues.push({ level: 'warn', text: 'The code is inverted (light modules on a dark field). Some older scanners will not read it.' }); score -= 12; }

        if (style.margin < 4) {
            issues.push({
                level: style.margin < 2 ? 'error' : 'warn',
                text: 'Quiet zone is ' + style.margin + ' modules; the standard asks for 4.'
            });
            score -= style.margin < 2 ? 25 : 10;
        }

        if (style.logo && style.logo.enabled) {
            var area = style.logo.size * style.logo.size;      // fraction of the symbol
            var budget = { L: 0.07, M: 0.15, Q: 0.25, H: 0.30 }[symbol.ecl] || 0.15;
            if (area > budget) {
                issues.push({
                    level: area > budget * 1.5 ? 'error' : 'warn',
                    text: 'Logo covers ' + Math.round(area * 100) + '% of the symbol but level ' +
                        symbol.ecl + ' only recovers ~' + Math.round(budget * 100) + '%. Raise error correction or shrink the logo.'
                });
                score -= area > budget * 1.5 ? 35 : 15;
            }
        }

        // Shape choices, scored from what the harness actually measured.
        var shapeChecks = [
            ['eyeBall', style.eyeBallShape, 'Eye centre'],
            ['eyeFrame', style.eyeFrameShape, 'Eye frame'],
            ['module', style.moduleShape, 'Module']
        ];
        shapeChecks.forEach(function (c) {
            var score5 = SHAPE_RISK[c[0]][c[1]];
            if (score5 === undefined || score5 >= 5) return;
            var label = c[2] + ' shape "' + c[1] + '"';
            if (score5 <= 2) {
                issues.push({
                    level: 'error',
                    text: label + ' deforms the finder pattern that scanners lock onto — a strict decoder read it back at only ' +
                        score5 + ' of 5 test sizes. Phone cameras usually cope; unknown scanners may not. Test decode before you ship it.'
                });
                score -= 22;
            } else {
                issues.push({
                    level: 'warn',
                    text: label + ' read back at ' + score5 + ' of 5 test sizes — slightly less margin than the square or rounded options.'
                });
                score -= 8;
            }
        });

        if (style.moduleShape === 'dots' && symbol.version > 10) {
            issues.push({ level: 'warn', text: 'Dot modules on a dense symbol (version ' + symbol.version + ') lose contrast at small print sizes.' });
            score -= 8;
        }

        return {
            score: Math.max(0, Math.min(100, Math.round(score))),
            contrast: ratio,
            issues: issues
        };
    }

    return {
        computeLayout: computeLayout,
        render: render,
        CanvasSurface: CanvasSurface,
        SvgSurface: SvgSurface,
        assessScannability: assessScannability,
        contrastRatio: contrastRatio,
        MODULE_SHAPES: MODULE_SHAPES,
        EYE_FRAME_SHAPES: EYE_FRAME_SHAPES,
        EYE_BALL_SHAPES: EYE_BALL_SHAPES,
        FRAMES: FRAMES,
        FONT_STACKS: FONT_STACKS,
        SHAPE_RISK: SHAPE_RISK,
        // The shape functions are exported so the picker swatches are drawn by
        // the same code that draws the code itself — an icon can never show a
        // shape the renderer would not actually produce.
        modulePath: modulePath,
        eyeFramePath: eyeFramePath,
        eyeBallPath: eyeBallPath,
        paths: {
            roundRectPath: roundRectPath,
            circlePath: circlePath
        }
    };
});
