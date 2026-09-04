/*!
 * app.js — QR Studio UI controller.
 *
 * Owns the design state, the render loop, and every control. The QR math
 * lives in qrcode.js and all drawing in render.js; this file never touches
 * a module matrix or a bezier directly.
 *
 * Everything runs locally: the payload and any uploaded logo stay in the page.
 */
(function () {
    'use strict';

    var QR = window.QRCodeEngine;
    var R = window.QRRender;
    if (!QR || !R) return;

    var $ = function (id) { return document.getElementById(id); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    // ------------------------------------------------------------ defaults

    var DEFAULTS = {
        content: {
            type: 'link',
            link: 'https://www.johanncardenas.com',
            text: '',
            email: { to: '', subject: '', body: '' },
            phone: '',
            sms: { to: '', body: '' },
            wifi: { ssid: '', pass: '', auth: 'WPA', hidden: false }
        },
        ecl: 'M',
        margin: 4,
        moduleShape: 'fluid',
        eyeFrameShape: 'extra-rounded',
        eyeBallShape: 'extra-rounded',
        fgType: 'solid',
        fg1: '#0f172a',
        fg2: '#18a9a8',
        fgAngle: 45,
        bg: '#ffffff',
        bgTransparent: false,
        eyeFrameCustom: false,
        eyeFrameColor: '#0f172a',
        eyeBallCustom: false,
        eyeBallColor: '#18a9a8',
        logo: {
            dataUrl: '',
            name: '',
            size: 22,
            padding: 1,
            shape: 'rounded',
            bgColor: '#ffffff',
            excavate: true
        },
        frame: {
            style: 'none',
            text: 'SCAN ME',
            font: 'source-sans',
            fontWeight: '700',
            fontSize: 3,
            letterSpacing: 0,
            color: '#0f172a',
            textColor: '#ffffff'
        },
        exportFormat: 'png',
        exportSize: 1024,
        filename: 'qr-code'
    };

    // Curated starting points. Each is a patch over DEFAULTS.
    var PRESETS = [
        {
            id: 'classic', label: 'Classic',
            patch: { moduleShape: 'square', eyeFrameShape: 'square', eyeBallShape: 'square', fgType: 'solid', fg1: '#000000', bg: '#ffffff', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'none' } }
        },
        {
            id: 'slate', label: 'Slate',
            patch: { moduleShape: 'fluid', eyeFrameShape: 'extra-rounded', eyeBallShape: 'extra-rounded', fgType: 'solid', fg1: '#0f172a', bg: '#ffffff', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'none' } }
        },
        {
            id: 'teal', label: 'Teal fade',
            patch: { moduleShape: 'fluid', eyeFrameShape: 'extra-rounded', eyeBallShape: 'extra-rounded', fgType: 'linear', fg1: '#0d7f7e', fg2: '#6366f1', fgAngle: 45, bg: '#ffffff', eyeFrameCustom: true, eyeFrameColor: '#0f172a', eyeBallCustom: true, eyeBallColor: '#18a9a8', frame: { style: 'none' } }
        },
        {
            id: 'scanme', label: 'Scan me',
            patch: { moduleShape: 'rounded', eyeFrameShape: 'rounded', eyeBallShape: 'rounded', fgType: 'solid', fg1: '#0f172a', bg: '#ffffff', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'caption-bottom', text: 'SCAN ME', color: '#0f172a', textColor: '#ffffff', font: 'source-sans', fontWeight: '700', fontSize: 3, letterSpacing: 0.15 } }
        },
        {
            id: 'bubble', label: 'Bubble',
            patch: { moduleShape: 'extra-rounded', eyeFrameShape: 'extra-rounded', eyeBallShape: 'extra-rounded', fgType: 'solid', fg1: '#0d7f7e', bg: '#ffffff', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'bubble', text: 'SCAN ME', color: '#18a9a8', textColor: '#ffffff', fontSize: 3, letterSpacing: 0.1 } }
        },
        {
            id: 'card', label: 'Card',
            patch: { moduleShape: 'classy', eyeFrameShape: 'leaf-alt', eyeBallShape: 'extra-rounded', fgType: 'solid', fg1: '#1e293b', bg: '#ffffff', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'card', text: 'SCAN TO VISIT', color: '#1e293b', textColor: '#ffffff', fontSize: 2.6, letterSpacing: 0.12 } }
        },
        {
            id: 'mono', label: 'Mono dots',
            patch: { moduleShape: 'dots', eyeFrameShape: 'rounded', eyeBallShape: 'extra-rounded', fgType: 'solid', fg1: '#334155', bg: '#f8fafc', eyeFrameCustom: false, eyeBallCustom: false, frame: { style: 'thin', text: '' } }
        },
        {
            id: 'night', label: 'Night',
            patch: { moduleShape: 'fluid', eyeFrameShape: 'extra-rounded', eyeBallShape: 'extra-rounded', fgType: 'solid', fg1: '#e2e8f0', bg: '#0f172a', eyeFrameCustom: true, eyeFrameColor: '#22d3d1', eyeBallCustom: true, eyeBallColor: '#22d3d1', frame: { style: 'none' } }
        }
    ];

    // --------------------------------------------------------------- state

    var state = clone(DEFAULTS);
    var logoImg = null;
    var lastSymbol = null, lastLayout = null, lastStyle = null, lastPayload = '';
    var history = [], histIndex = -1;
    var rafPending = false, commitTimer = null;

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    function deepMerge(target, patch) {
        Object.keys(patch).forEach(function (k) {
            if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
                if (!target[k] || typeof target[k] !== 'object') target[k] = {};
                deepMerge(target[k], patch[k]);
            } else {
                target[k] = patch[k];
            }
        });
        return target;
    }

    // ------------------------------------------------------------ payloads

    function normalizeUrl(u) {
        var s = String(u || '').trim();
        if (!s) return '';
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
        return s;
    }

    function escWifi(s) {
        return String(s || '').replace(/([\\;,":])/g, '\\$1');
    }

    function buildPayload(c) {
        switch (c.type) {
            case 'link':
                return normalizeUrl(c.link);
            case 'text':
                return String(c.text || '');
            case 'email': {
                var q = [];
                if (c.email.subject) q.push('subject=' + encodeURIComponent(c.email.subject));
                if (c.email.body) q.push('body=' + encodeURIComponent(c.email.body));
                if (!c.email.to) return '';
                return 'mailto:' + c.email.to.trim() + (q.length ? '?' + q.join('&') : '');
            }
            case 'phone':
                return c.phone ? 'tel:' + String(c.phone).replace(/[^\d+]/g, '') : '';
            case 'sms': {
                if (!c.sms.to) return '';
                var num = String(c.sms.to).replace(/[^\d+]/g, '');
                return 'SMSTO:' + num + (c.sms.body ? ':' + c.sms.body : '');
            }
            case 'wifi': {
                if (!c.wifi.ssid) return '';
                var auth = c.wifi.auth;
                var parts = 'WIFI:T:' + auth + ';S:' + escWifi(c.wifi.ssid) + ';';
                if (auth !== 'nopass') parts += 'P:' + escWifi(c.wifi.pass) + ';';
                if (c.wifi.hidden) parts += 'H:true;';
                return parts + ';';
            }
            default:
                return '';
        }
    }

    // ---------------------------------------------------------- style build

    function buildStyle(overrides) {
        var fg = state.fgType === 'solid'
            ? { type: 'solid', color: state.fg1 }
            : {
                type: state.fgType,
                angle: state.fgAngle,
                stops: [{ offset: 0, color: state.fg1 }, { offset: 1, color: state.fg2 }]
            };
        var bg = state.bgTransparent ? { type: 'none' } : { type: 'solid', color: state.bg };

        var style = {
            margin: state.margin,
            moduleShape: state.moduleShape,
            eyeFrameShape: state.eyeFrameShape,
            eyeBallShape: state.eyeBallShape,
            fg: fg,
            bg: bg,
            eyeFrameColor: state.eyeFrameCustom ? state.eyeFrameColor : null,
            eyeBallColor: state.eyeBallCustom ? state.eyeBallColor : null,
            logo: {
                enabled: !!state.logo.dataUrl,
                size: state.logo.size / 100,
                padding: state.logo.padding,
                shape: state.logo.shape,
                bgColor: state.logo.bgColor,
                excavate: state.logo.excavate,
                clip: true
            },
            frame: {
                style: state.frame.style,
                text: state.frame.text,
                font: state.frame.font,
                fontWeight: state.frame.fontWeight,
                fontSize: state.frame.fontSize,
                letterSpacing: state.frame.letterSpacing,
                color: state.frame.color,
                textColor: state.frame.textColor
            }
        };
        if (overrides) deepMerge(style, overrides);
        return style;
    }

    // -------------------------------------------------------------- render

    function scheduleRender() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () { rafPending = false; doRender(); });
    }

    var EMPTY_HINTS = {
        link: 'Enter a destination URL to see your code.',
        text: 'Type some text to encode.',
        email: 'Enter a recipient address.',
        phone: 'Enter a phone number.',
        sms: 'Enter a phone number.',
        wifi: 'Enter the network name (SSID).'
    };

    function doRender() {
        var payload = buildPayload(state.content);
        lastPayload = payload;
        var errEl = $('qs-stage-error');
        var empty = $('qs-empty');
        var canvas0 = $('qs-canvas');

        // An empty payload encodes to a perfectly valid but meaningless symbol.
        // Showing that would imply the tool is finished when it is not.
        if (!payload) {
            empty.hidden = false;
            canvas0.style.visibility = 'hidden';
            errEl.hidden = true;
            $('qs-empty-hint').textContent = EMPTY_HINTS[state.content.type] || EMPTY_HINTS.link;
            ['qs-meta-version', 'qs-meta-ecl', 'qs-meta-bytes'].forEach(function (id) { $(id).textContent = '—'; });
            setExportEnabled(false);
            return;
        }
        empty.hidden = true;
        canvas0.style.visibility = '';
        setExportEnabled(true);

        var symbol;
        try {
            symbol = QR.encode(payload, { ecl: state.ecl, boostEcl: false });
        } catch (e) {
            errEl.textContent = e.message;
            errEl.hidden = false;
            return;
        }
        errEl.hidden = true;

        var style = buildStyle();
        var layout = R.computeLayout(symbol, style);
        lastSymbol = symbol; lastLayout = layout; lastStyle = style;

        var canvas = $('qs-canvas');
        var wrap = $('qs-canvas-wrap');
        var avail = Math.max(140, wrap.clientWidth - 32);
        // The upper bound is height-led, not width-led: on a wide screen the
        // stage column is far wider than the code needs, so letting width run
        // free would just push the frame off the bottom of the viewport.
        var cssW = Math.min(avail, 640);
        // Keep the whole drawing inside the stage when a frame makes it tall.
        var maxH = Math.min(window.innerHeight * 0.62, 580);
        if (layout.height / layout.width * cssW > maxH) cssW = maxH * layout.width / layout.height;

        var scale = cssW / layout.width;
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.max(1, Math.round(layout.width * scale * dpr));
        canvas.height = Math.max(1, Math.round(layout.height * scale * dpr));
        canvas.style.width = cssW + 'px';
        canvas.style.height = (layout.height * scale) + 'px';

        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        R.render(symbol, style, new R.CanvasSurface(ctx, scale * dpr), layout, { logo: logoImg });

        // meta chips
        var bytes = payload ? new Blob([payload]).size : 0;
        $('qs-meta-version').textContent = 'Version ' + symbol.version + ' · ' + symbol.size + '×' + symbol.size;
        $('qs-meta-ecl').textContent = 'Level ' + symbol.ecl;
        $('qs-meta-bytes').textContent = bytes + ' bytes';
        canvas.setAttribute('aria-label', 'QR code encoding ' + payload);

        updateReadability(symbol, style);
        updatePrintHint();
        updateTabDots();
    }

    function setExportEnabled(on) {
        ['qs-download', 'qs-download-2', 'qs-copy', 'qs-copy-2', 'qs-copy-nobg', 'qs-verify']
            .forEach(function (id) { if ($(id)) $(id).disabled = !on; });
    }

    /**
     * Physical-size advice. Module size is what actually limits a scan, so
     * convert the chosen export width into printed millimeters per module and
     * give the rule-of-thumb read distance (roughly ten times symbol width).
     */
    function updatePrintHint() {
        var el = $('qs-print-hint');
        if (!el || !lastLayout) return;
        if (state.exportFormat === 'svg') {
            el.textContent = 'Vector output scales to any size — the limit below applies to whatever width you print it at.';
            el.classList.remove('is-warn');
            return;
        }
        var DPI = 300;
        var widthMm = state.exportSize / DPI * 25.4;
        var moduleMm = widthMm / lastLayout.width;
        var distanceM = (widthMm * 10) / 1000;
        var tight = moduleMm < 0.4;
        el.classList.toggle('is-warn', tight);
        el.textContent = 'At 300 dpi that prints ' + widthMm.toFixed(1) + ' mm wide (' +
            moduleMm.toFixed(2) + ' mm per module), readable from roughly ' +
            distanceM.toFixed(1) + ' m.' +
            (tight ? ' Below 0.4 mm per module most printers and scanners struggle — export larger.' : '');
    }

    /** Mark design tabs whose settings differ from the defaults. */
    function updateTabDots() {
        var changed = {
            modules: state.moduleShape !== DEFAULTS.moduleShape,
            eyes: state.eyeFrameShape !== DEFAULTS.eyeFrameShape ||
                state.eyeBallShape !== DEFAULTS.eyeBallShape ||
                state.eyeFrameCustom || state.eyeBallCustom,
            colors: state.fgType !== DEFAULTS.fgType || state.fg1 !== DEFAULTS.fg1 ||
                state.bg !== DEFAULTS.bg || state.bgTransparent,
            logo: !!state.logo.dataUrl,
            frame: state.frame.style !== DEFAULTS.frame.style
        };
        $$('.qs-tab').forEach(function (t) {
            t.classList.toggle('is-changed', !!changed[t.dataset.tab]);
        });
    }

    // -------------------------------------------------------- readability

    function updateReadability(symbol, style) {
        var res = R.assessScannability(symbol, style);
        var ring = $('qs-ring-fg');
        var C = 2 * Math.PI * 19;
        ring.style.strokeDasharray = C;
        ring.style.strokeDashoffset = C * (1 - res.score / 100);
        ring.style.stroke = res.score >= 80 ? 'var(--qs-ok)' : (res.score >= 55 ? 'var(--qs-warn)' : 'var(--qs-danger)');
        $('qs-score-num').textContent = res.score;
        $('qs-score-label').textContent = res.score >= 80 ? 'Looks solid'
            : (res.score >= 55 ? 'Should scan, with care' : 'Likely to fail');
        $('qs-score-contrast').textContent = res.contrast
            ? 'Contrast ' + res.contrast.toFixed(1) + ':1'
            : 'Gradient fill — contrast estimated';

        var ul = $('qs-issues');
        ul.innerHTML = '';
        if (!res.issues.length) {
            var li = document.createElement('li');
            li.className = 'is-ok';
            li.appendChild(document.createTextNode('No problems detected in the design.'));
            ul.appendChild(li);
        } else {
            res.issues.forEach(function (iss) {
                var li = document.createElement('li');
                li.className = iss.level === 'error' ? 'is-error' : 'is-warn';
                li.appendChild(document.createTextNode(iss.text));
                ul.appendChild(li);
            });
        }
    }

    // ------------------------------------------------------- verify decode

    function loadJsQR() {
        if (window.jsQR) return Promise.resolve(window.jsQR);
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
            s.onload = function () { resolve(window.jsQR); };
            s.onerror = function () { reject(new Error('offline')); };
            document.head.appendChild(s);
        });
    }

    function verifyDecode() {
        var out = $('qs-verify-out');
        var btn = $('qs-verify');
        if (!lastSymbol) return;
        btn.disabled = true;
        out.hidden = false;
        out.className = 'qs-verify-out';
        out.textContent = 'Rendering and decoding…';

        loadJsQR().then(function (jsQR) {
            // Sweep several sizes rather than trusting one. This decoder
            // thresholds 8x8 pixel blocks, so a design can pass at one size and
            // fail at another purely on how module size lands against that
            // grid; the count is a far better signal than a single verdict.
            // White backdrop, because that is what paper does — a transparent
            // export would otherwise be decoded against nothing.
            var SIZES = [380, 560, 780, 1100];
            var ok = 0, wrong = null;

            SIZES.forEach(function (target) {
                var scale = target / lastLayout.width;
                var c = document.createElement('canvas');
                c.width = Math.round(lastLayout.width * scale);
                c.height = Math.round(lastLayout.height * scale);
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, c.width, c.height);
                R.render(lastSymbol, lastStyle, new R.CanvasSurface(ctx, scale), lastLayout, { logo: logoImg });
                var img = ctx.getImageData(0, 0, c.width, c.height);
                var found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
                if (found && found.data === lastPayload) ok++;
                else if (found) wrong = found.data;
            });

            if (ok === SIZES.length) {
                out.className = 'qs-verify-out is-ok';
                out.textContent = 'Read back at all ' + SIZES.length + ' test sizes: ' + lastPayload;
            } else if (wrong) {
                out.className = 'qs-verify-out is-bad';
                out.textContent = 'Decoded to the wrong text (' + wrong.slice(0, 60) + '). Something is wrong with the design — reset and rebuild it.';
            } else if (ok > 0) {
                out.className = 'qs-verify-out';
                out.textContent = 'Marginal: read at ' + ok + ' of ' + SIZES.length +
                    ' test sizes. It will likely work on a phone camera, which is more tolerant than this decoder, but for print or unknown scanners raise the contrast, use square or rounded eyes, or increase error correction.';
            } else {
                out.className = 'qs-verify-out is-bad';
                out.textContent = 'Not read at any test size. Raise the contrast, enlarge the quiet zone, shrink the logo, choose square or rounded eye shapes, or pick a stronger error-correction level.';
            }
        }).catch(function () {
            out.className = 'qs-verify-out';
            out.textContent = 'The decoder could not be loaded (it comes from a CDN and needs a connection). The design checks above still apply.';
        }).then(function () {
            btn.disabled = false;
        });
    }

    // ------------------------------------------------- color input polish

    // A sober, high-contrast set. Brand colors go in the hex field; these are
    // for getting somewhere good in one click.
    var PALETTE = [
        '#0f172a', '#000000', '#334155', '#64748b',
        '#0d7f7e', '#18a9a8', '#6366f1', '#1d4ed8',
        '#6d28d9', '#b91c1c', '#15803d', '#b45309',
        '#ffffff', '#f8fafc'
    ];

    function isHex(v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v).trim()); }

    function expandHex(v) {
        var h = String(v).trim();
        if (h[0] !== '#') h = '#' + h;
        if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
        return h.toLowerCase();
    }

    /**
     * Give every color input a hex field beside it. Done here rather than in
     * the markup so no color control can be added later and quietly miss out —
     * a picker alone cannot accept a brand hex someone pastes from a style guide.
     */
    function enhanceColorInputs() {
        $$('input[type="color"]').forEach(function (input) {
            if (input.dataset.enhanced) return;
            input.dataset.enhanced = '1';

            var wrap = document.createElement('span');
            wrap.className = 'qs-color';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);

            var hex = document.createElement('input');
            hex.type = 'text';
            hex.className = 'qs-hexfield';
            hex.spellcheck = false;
            hex.maxLength = 7;
            hex.value = input.value;
            hex.setAttribute('aria-label', 'Hex color value');
            wrap.appendChild(hex);

            input.addEventListener('input', function () { hex.value = input.value; hex.classList.remove('is-bad'); });
            hex.addEventListener('input', function () {
                if (!isHex(hex.value)) { hex.classList.add('is-bad'); return; }
                hex.classList.remove('is-bad');
                input.value = expandHex(hex.value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            hex.addEventListener('blur', function () {
                hex.value = input.value;
                hex.classList.remove('is-bad');
            });
        });
    }

    function buildPalette(hostId, apply) {
        var host = $(hostId);
        if (!host) return;
        host.innerHTML = '';
        PALETTE.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'qs-chip';
            b.style.background = c;
            b.title = c;
            b.setAttribute('aria-label', 'Use ' + c);
            b.addEventListener('click', function () {
                apply(c);
                commit();
                scheduleRender();
            });
            host.appendChild(b);
        });
    }

    // ---------------------------------------------------------- icon build

    function stripXml(s) { return s.replace(/^<\?xml[^>]*\?>\s*/, ''); }

    var ICON_PATTERN = [
        [1, 1, 0, 1, 1],
        [1, 1, 0, 1, 0],
        [0, 0, 1, 1, 1],
        [1, 1, 1, 0, 0],
        [1, 0, 1, 1, 1]
    ];

    function moduleIconSvg(shape) {
        var surf = new R.SvgSurface(5, 5, 1);
        var box = { x: 0, y: 0, w: 5, h: 5 };
        var cmds = [];
        var has = function (x, y) {
            return function (dx, dy) {
                var nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx > 4 || ny > 4) return false;
                return !!ICON_PATTERN[ny][nx];
            };
        };
        for (var y = 0; y < 5; y++) {
            for (var x = 0; x < 5; x++) {
                if (ICON_PATTERN[y][x]) cmds = cmds.concat(R.modulePath(shape, x, y, has(x, y)));
            }
        }
        surf.path(cmds, { type: 'solid', color: 'currentColor' }, box);
        return stripXml(surf.toString());
    }

    function eyeFrameIconSvg(shape) {
        var surf = new R.SvgSurface(7, 7, 1);
        surf.path(R.eyeFramePath(shape, 0, 0), { type: 'solid', color: 'currentColor' }, { x: 0, y: 0, w: 7, h: 7 }, 'evenodd');
        return stripXml(surf.toString());
    }

    function eyeBallIconSvg(shape) {
        var surf = new R.SvgSurface(7, 7, 1);
        surf.path(R.eyeFramePath('rounded', 0, 0), { type: 'solid', color: 'currentColor' }, { x: 0, y: 0, w: 7, h: 7 }, 'evenodd');
        surf.path(R.eyeBallPath(shape, 0, 0), { type: 'solid', color: 'currentColor' }, { x: 0, y: 0, w: 7, h: 7 });
        return stripXml(surf.toString());
    }

    function frameIconSvg(key) {
        var f = R.FRAMES[key];
        var W = 22, H = 22;
        var capH = f.caption ? 5 : 0;
        var top = f.caption === 'top' ? capH : 0;
        var bot = (f.caption && f.caption !== 'top') ? capH : 0;
        var r = Math.max(0, Math.min(f.radius * 0.9, 5));
        var b = key === 'none' ? 0 : Math.max(1.1, f.border * 1.1);
        var surf = new R.SvgSurface(W, H, 1);
        var box = { x: 0, y: 0, w: W, h: H };
        var ink = { type: 'solid', color: 'currentColor' };

        if (key !== 'none') {
            surf.path(
                R.paths.roundRectPath(0, 0, W, H, r)
                    .concat(R.paths.roundRectPath(b, b + top, W - 2 * b, H - 2 * b - top - bot, Math.max(0, r - b))),
                ink, box, 'evenodd');
            if (capH) {
                var cy = f.caption === 'top' ? 0 : H - capH;
                var overlap = f.caption === 'overlap';
                surf.path(R.paths.roundRectPath(overlap ? 4 : 0, cy, overlap ? W - 8 : W, capH,
                    overlap ? capH / 2 : 0), ink, box);
            }
        }

        // A small glyph standing in for the code itself.
        var innerX = b, innerY = b + top;
        var innerW = W - 2 * b, innerH = H - 2 * b - top - bot;
        var gs = Math.min(innerW, innerH) / 4.6;
        var gx = innerX + (innerW - gs * 3) / 2, gy = innerY + (innerH - gs * 3) / 2;
        [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]].forEach(function (p) {
            surf.path(R.paths.roundRectPath(gx + p[0] * gs, gy + p[1] * gs, gs * 0.72, gs * 0.72, gs * 0.2), ink, box);
        });
        return stripXml(surf.toString());
    }

    function buildSwatches(containerId, entries, iconFn, getValue, setValue, riskKey) {
        var host = $(containerId);
        var risk = riskKey ? R.SHAPE_RISK[riskKey] : null;
        host.innerHTML = '';
        Object.keys(entries).forEach(function (key) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'qs-swatch';
            btn.dataset.value = key;
            var score = risk ? risk[key] : 5;
            var flag = '';
            if (score !== undefined && score < 5) {
                // Measured, not guessed — see SHAPE_RISK in render.js.
                btn.classList.add(score <= 2 ? 'is-risky' : 'is-caution');
                btn.title = entries[key] + ' — read back at ' + score +
                    ' of 5 test sizes by a strict decoder. Phone cameras are more tolerant; use Test decode to check.';
                flag = '<i class="qs-swatch-flag fas fa-' + (score <= 2 ? 'triangle-exclamation' : 'circle-exclamation') + '"></i>';
            }
            btn.innerHTML = iconFn(key) + '<small>' + entries[key] + '</small>' + flag;
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', function () {
                setValue(key);
                markActive(host, key);
                commit();
                scheduleRender();
            });
            host.appendChild(btn);
        });
        markActive(host, getValue());
    }

    function markActive(host, value) {
        $$('.qs-swatch, .qs-preset', host).forEach(function (b) {
            var on = b.dataset.value === value;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    // ------------------------------------------------------------ presets

    function buildPresets() {
        var host = $('qs-presets');
        host.innerHTML = '';
        var sample = QR.encode('https://www.johanncardenas.com', { ecl: 'M', boostEcl: false });

        PRESETS.forEach(function (p) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'qs-preset';
            btn.dataset.value = p.id;
            btn.title = p.label;

            var probe = clone(DEFAULTS);
            deepMerge(probe, p.patch);
            var saved = state;
            state = probe;
            var st = buildStyle();
            state = saved;

            var lay = R.computeLayout(sample, st);
            var c = document.createElement('canvas');
            var px = 124;
            var scale = px / lay.width;
            c.width = px;
            c.height = Math.round(lay.height * scale);
            var ctx = c.getContext('2d');
            R.render(sample, st, new R.CanvasSurface(ctx, scale), lay, {});

            btn.appendChild(c);
            var lab = document.createElement('small');
            lab.textContent = p.label;
            btn.appendChild(lab);

            btn.addEventListener('click', function () {
                deepMerge(state, clone(p.patch));
                syncControlsFromState();
                markActive(host, p.id);
                commit();
                ensureFont(state.frame.font).then(scheduleRender);
            });
            host.appendChild(btn);
        });
    }

    // --------------------------------------------------------------- fonts

    function ensureFont(key) {
        var f = R.FONT_STACKS[key];
        if (!f || !f.web) return Promise.resolve();
        var id = 'qs-font-' + key;
        if (!document.getElementById(id)) {
            var l = document.createElement('link');
            l.id = id;
            l.rel = 'stylesheet';
            l.href = 'https://fonts.googleapis.com/css2?family=' + f.web + '&display=swap';
            document.head.appendChild(l);
        }
        if (!document.fonts) return Promise.resolve();
        var family = f.stack.split(',')[0].replace(/"/g, '');
        return Promise.all([
            document.fonts.load('400 32px "' + family + '"'),
            document.fonts.load('600 32px "' + family + '"'),
            document.fonts.load('700 32px "' + family + '"')
        ]).catch(function () { }).then(function () { });
    }

    // -------------------------------------------------------------- export

    function renderToCanvas(width, opts) {
        opts = opts || {};
        var style = opts.style || lastStyle;
        var layout = R.computeLayout(lastSymbol, style);
        var scale = width / layout.width;
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(layout.width * scale));
        c.height = Math.max(1, Math.round(layout.height * scale));
        var ctx = c.getContext('2d');
        if (opts.flatten) {
            ctx.fillStyle = opts.flatten;
            ctx.fillRect(0, 0, c.width, c.height);
        }
        R.render(lastSymbol, style, new R.CanvasSurface(ctx, scale), layout, { logo: logoImg });
        return c;
    }

    function buildSvg(width) {
        var layout = R.computeLayout(lastSymbol, lastStyle);
        var scale = width / layout.width;
        var surf = new R.SvgSurface(layout.width, layout.height, scale);
        R.render(lastSymbol, lastStyle, surf, layout, { logo: logoImg });
        return surf.toString();
    }

    function download(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function doDownload() {
        if (!lastSymbol) return;
        var name = (state.filename || 'qr-code').replace(/[\\/:*?"<>|]+/g, '-');
        ensureFont(state.frame.font).then(function () {
            if (state.exportFormat === 'svg') {
                download(new Blob([buildSvg(state.exportSize)], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg');
                toast('SVG downloaded', 'ok');
                return;
            }
            var jpeg = state.exportFormat === 'jpeg';
            var c = renderToCanvas(state.exportSize, { flatten: jpeg ? (state.bgTransparent ? '#ffffff' : state.bg) : null });
            c.toBlob(function (blob) {
                if (!blob) { toast('Export failed', 'bad'); return; }
                download(blob, name + (jpeg ? '.jpg' : '.png'));
                toast((jpeg ? 'JPEG' : 'PNG') + ' downloaded', 'ok');
            }, jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.92 : undefined);
        });
    }

    function doCopy(noBackground) {
        if (!lastSymbol) return;
        if (!navigator.clipboard || !window.ClipboardItem) {
            toast('Clipboard unavailable — downloading instead', 'bad');
            doDownload();
            return;
        }
        var style = noBackground ? buildStyle({ bg: { type: 'none' } }) : lastStyle;

        // Safari checks user activation synchronously, so clipboard.write must
        // be handed a *promise* of the blob rather than an awaited blob.
        var blobPromise = ensureFont(state.frame.font).then(function () {
            return new Promise(function (resolve, reject) {
                var c = renderToCanvas(Math.min(state.exportSize, 2048), { style: style });
                c.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode failed')); }, 'image/png');
            });
        });

        navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
            .then(function () { toast(noBackground ? 'Copied without background' : 'Copied to clipboard', 'ok'); })
            .catch(function () {
                toast('Copy refused — downloading instead', 'bad');
                blobPromise.then(function (b) { download(b, (state.filename || 'qr-code') + '.png'); });
            });
    }

    // ---------------------------------------------------------- save / load

    function doSave() {
        var payload = { app: 'qr-studio', version: 1, savedAt: new Date().toISOString(), state: state };
        download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
            (state.filename || 'qr-code') + '.qrstudio.json');
        toast('Design saved', 'ok');
    }

    function doLoad(file) {
        var fr = new FileReader();
        fr.onload = function () {
            try {
                var obj = JSON.parse(fr.result);
                if (!obj || obj.app !== 'qr-studio' || !obj.state) throw new Error('not a QR Studio file');
                state = deepMerge(clone(DEFAULTS), obj.state);
                applyLogoFromState().then(function () {
                    syncControlsFromState();
                    commit();
                    return ensureFont(state.frame.font);
                }).then(scheduleRender);
                toast('Design loaded', 'ok');
            } catch (e) {
                toast('Could not read that file', 'bad');
            }
        };
        fr.readAsText(file);
    }

    function applyLogoFromState() {
        return new Promise(function (resolve) {
            if (!state.logo.dataUrl) { logoImg = null; resolve(); return; }
            var img = new Image();
            img.onload = function () { logoImg = img; resolve(); };
            img.onerror = function () { logoImg = null; state.logo.dataUrl = ''; resolve(); };
            img.src = state.logo.dataUrl;
        });
    }

    // --------------------------------------------------------- undo / redo

    function commit() {
        clearTimeout(commitTimer);
        var snap = JSON.stringify(state);
        if (history[histIndex] === snap) return;
        history = history.slice(0, histIndex + 1);
        history.push(snap);
        if (history.length > 60) history.shift();
        histIndex = history.length - 1;
        updateHistoryButtons();
        saveLocal();
    }

    function commitSoon() {
        clearTimeout(commitTimer);
        commitTimer = setTimeout(commit, 450);
    }

    function updateHistoryButtons() {
        $('qs-undo').disabled = histIndex <= 0;
        $('qs-redo').disabled = histIndex >= history.length - 1;
    }

    function travel(delta) {
        var i = histIndex + delta;
        if (i < 0 || i >= history.length) return;
        histIndex = i;
        state = JSON.parse(history[i]);
        applyLogoFromState().then(function () {
            syncControlsFromState();
            updateHistoryButtons();
            saveLocal();
            return ensureFont(state.frame.font);
        }).then(scheduleRender);
    }

    function saveLocal() {
        try {
            localStorage.setItem('qr-studio-state', JSON.stringify(state));
        } catch (e) {
            // A large logo can blow the quota; keep the rest of the design.
            try {
                var lean = clone(state);
                lean.logo.dataUrl = '';
                lean.logo.name = '';
                localStorage.setItem('qr-studio-state', JSON.stringify(lean));
            } catch (e2) { /* storage unavailable — not fatal */ }
        }
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem('qr-studio-state');
            if (!raw) return false;
            state = deepMerge(clone(DEFAULTS), JSON.parse(raw));
            return true;
        } catch (e) { return false; }
    }

    // --------------------------------------------------------------- toast

    function toast(msg, kind) {
        var wrap = $('qs-toast-wrap');
        var el = document.createElement('div');
        el.className = 'qs-toast' + (kind ? ' is-' + kind : '');
        el.textContent = msg;
        wrap.appendChild(el);
        setTimeout(function () {
            el.style.transition = 'opacity .25s ease';
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 260);
        }, 2200);
    }

    // ------------------------------------------------------- control sync

    function syncControlsFromState() {
        var c = state.content;
        $$('#qs-type .qs-seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.type === c.type); });
        $$('.qs-fields').forEach(function (f) { f.hidden = f.dataset.fields !== c.type; });

        $('qs-link').value = c.link;
        $('qs-text').value = c.text;
        $('qs-email-to').value = c.email.to;
        $('qs-email-subject').value = c.email.subject;
        $('qs-email-body').value = c.email.body;
        $('qs-phone').value = c.phone;
        $('qs-sms-to').value = c.sms.to;
        $('qs-sms-body').value = c.sms.body;
        $('qs-wifi-ssid').value = c.wifi.ssid;
        $('qs-wifi-pass').value = c.wifi.pass;
        $('qs-wifi-auth').value = c.wifi.auth;
        $('qs-wifi-hidden').checked = c.wifi.hidden;

        $('qs-ecl').value = state.ecl;
        $('qs-margin').value = state.margin;
        $('qs-margin-val').textContent = state.margin;

        markActive($('qs-module-shapes'), state.moduleShape);
        markActive($('qs-eye-frame-shapes'), state.eyeFrameShape);
        markActive($('qs-eye-ball-shapes'), state.eyeBallShape);
        markActive($('qs-frame-styles'), state.frame.style);

        $$('#qs-fg-type .qs-seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.fg === state.fgType); });
        $('qs-fg1').value = state.fg1;
        $('qs-fg2').value = state.fg2;
        $('qs-fg-angle').value = state.fgAngle;
        $('qs-fg-angle-val').textContent = state.fgAngle;
        $('qs-fg2-wrap').hidden = state.fgType === 'solid';
        $('qs-fg-swap').hidden = state.fgType === 'solid';
        $('qs-fg-angle-wrap').hidden = state.fgType !== 'linear';
        $('qs-fg1-label').textContent = state.fgType === 'solid' ? 'Color' : 'First color';
        $('qs-bg').value = state.bg;
        $('qs-bg-transparent').checked = state.bgTransparent;

        $('qs-eye-frame-color').value = state.eyeFrameColor;
        $('qs-eye-ball-color').value = state.eyeBallColor;
        $('qs-eye-frame-reset').classList.toggle('is-on', !state.eyeFrameCustom);
        $('qs-eye-ball-reset').classList.toggle('is-on', !state.eyeBallCustom);

        var hasLogo = !!state.logo.dataUrl;
        $('qs-logo-preview').hidden = !hasLogo;
        $('qs-logo-controls').hidden = !hasLogo;
        $('qs-logo-drop').hidden = hasLogo;
        if (hasLogo) {
            $('qs-logo-thumb').src = state.logo.dataUrl;
            $('qs-logo-name').textContent = state.logo.name || 'logo';
        }
        $('qs-logo-size').value = state.logo.size;
        $('qs-logo-size-val').textContent = state.logo.size;
        $('qs-logo-pad').value = state.logo.padding;
        $('qs-logo-pad-val').textContent = state.logo.padding.toFixed(1);
        $('qs-logo-shape').value = state.logo.shape;
        $('qs-logo-bg').value = state.logo.bgColor;
        $('qs-logo-excavate').checked = state.logo.excavate;

        $('qs-frame-text').value = state.frame.text;
        $('qs-frame-font').value = state.frame.font;
        $('qs-frame-weight').value = state.frame.fontWeight;
        $('qs-frame-size').value = state.frame.fontSize;
        $('qs-frame-size-val').textContent = Number(state.frame.fontSize).toFixed(1);
        $('qs-frame-track').value = state.frame.letterSpacing;
        $('qs-frame-track-val').textContent = Number(state.frame.letterSpacing).toFixed(2);
        $('qs-frame-color').value = state.frame.color;
        $('qs-frame-text-color').value = state.frame.textColor;
        $('qs-frame-controls').hidden = state.frame.style === 'none';
        $('qs-frame-none-note').hidden = state.frame.style !== 'none';

        $$('#qs-format .qs-seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.format === state.exportFormat); });
        $('qs-size').value = state.exportSize;
        $('qs-size-val').textContent = state.exportSize;
        $('qs-filename').value = state.filename;
        updateExportHint();
        updateLinkHint();
        updatePrintHint();
        updateTabDots();
        // Mirror every color picker into its hex field.
        $$('input[type="color"]').forEach(function (i) {
            var h = i.parentNode.querySelector('.qs-hexfield');
            if (h) { h.value = i.value; h.classList.remove('is-bad'); }
        });
    }

    function updateExportHint() {
        var h = $('qs-export-hint');
        if (state.exportFormat === 'svg') h.textContent = 'Vector — resolution independent and ideal for print.';
        else if (state.exportFormat === 'jpeg') h.textContent = 'JPEG has no transparency; the background is flattened.';
        else h.textContent = 'PNG keeps transparency if the background is off.';
    }

    function updateLinkHint() {
        var h = $('qs-link-hint');
        if (state.content.type !== 'link') { h.textContent = ''; return; }
        var raw = String(state.content.link || '').trim();
        if (!raw) { h.textContent = 'Enter a URL to encode.'; h.className = 'qs-hint'; return; }
        var norm = normalizeUrl(raw);
        h.className = 'qs-hint';
        h.textContent = norm !== raw ? 'Encoding as ' + norm : '';
    }

    // ---------------------------------------------------------------- wire

    function bindInput(id, apply, opts) {
        var el = $(id);
        if (!el) return;
        var ev = (opts && opts.event) || 'input';
        el.addEventListener(ev, function () {
            apply(el);
            if (opts && opts.instant) commit(); else commitSoon();
            scheduleRender();
        });
    }

    function wire() {
        // Segmented controls behave like radio groups; say so.
        $$('.qs-seg').forEach(function (g) { g.setAttribute('role', 'group'); });

        // content type
        $$('#qs-type .qs-seg-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                state.content.type = b.dataset.type;
                syncControlsFromState();
                commit();
                scheduleRender();
            });
        });

        bindInput('qs-link', function (el) { state.content.link = el.value; updateLinkHint(); });
        bindInput('qs-text', function (el) { state.content.text = el.value; });
        bindInput('qs-email-to', function (el) { state.content.email.to = el.value; });
        bindInput('qs-email-subject', function (el) { state.content.email.subject = el.value; });
        bindInput('qs-email-body', function (el) { state.content.email.body = el.value; });
        bindInput('qs-phone', function (el) { state.content.phone = el.value; });
        bindInput('qs-sms-to', function (el) { state.content.sms.to = el.value; });
        bindInput('qs-sms-body', function (el) { state.content.sms.body = el.value; });
        bindInput('qs-wifi-ssid', function (el) { state.content.wifi.ssid = el.value; });
        bindInput('qs-wifi-pass', function (el) { state.content.wifi.pass = el.value; });
        bindInput('qs-wifi-auth', function (el) { state.content.wifi.auth = el.value; }, { event: 'change', instant: true });
        bindInput('qs-wifi-hidden', function (el) { state.content.wifi.hidden = el.checked; }, { event: 'change', instant: true });

        bindInput('qs-ecl', function (el) { state.ecl = el.value; }, { event: 'change', instant: true });
        bindInput('qs-margin', function (el) {
            state.margin = parseInt(el.value, 10);
            $('qs-margin-val').textContent = state.margin;
        });

        // colors
        $$('#qs-fg-type .qs-seg-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                state.fgType = b.dataset.fg;
                syncControlsFromState();
                commit();
                scheduleRender();
            });
        });
        bindInput('qs-fg1', function (el) { state.fg1 = el.value; });
        bindInput('qs-fg2', function (el) { state.fg2 = el.value; });
        bindInput('qs-fg-angle', function (el) {
            state.fgAngle = parseInt(el.value, 10);
            $('qs-fg-angle-val').textContent = state.fgAngle;
        });
        bindInput('qs-bg', function (el) { state.bg = el.value; state.bgTransparent = false; $('qs-bg-transparent').checked = false; });
        bindInput('qs-bg-transparent', function (el) { state.bgTransparent = el.checked; }, { event: 'change', instant: true });

        bindInput('qs-eye-frame-color', function (el) { state.eyeFrameColor = el.value; state.eyeFrameCustom = true; $('qs-eye-frame-reset').classList.remove('is-on'); });
        bindInput('qs-eye-ball-color', function (el) { state.eyeBallColor = el.value; state.eyeBallCustom = true; $('qs-eye-ball-reset').classList.remove('is-on'); });
        $('qs-eye-frame-reset').addEventListener('click', function () {
            state.eyeFrameCustom = false;
            $('qs-eye-frame-reset').classList.add('is-on');
            commit(); scheduleRender();
        });
        $('qs-eye-ball-reset').addEventListener('click', function () {
            state.eyeBallCustom = false;
            $('qs-eye-ball-reset').classList.add('is-on');
            commit(); scheduleRender();
        });

        // logo
        var drop = $('qs-logo-drop');
        var input = $('qs-logo-input');
        drop.addEventListener('click', function () { input.click(); });
        drop.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        ['dragenter', 'dragover'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
        });
        drop.addEventListener('drop', function (e) {
            if (e.dataTransfer.files && e.dataTransfer.files[0]) acceptLogo(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', function () {
            if (input.files && input.files[0]) acceptLogo(input.files[0]);
            input.value = '';
        });
        $('qs-logo-remove').addEventListener('click', function () {
            state.logo.dataUrl = '';
            state.logo.name = '';
            logoImg = null;
            syncControlsFromState();
            commit();
            scheduleRender();
        });
        bindInput('qs-logo-size', function (el) {
            state.logo.size = parseInt(el.value, 10);
            $('qs-logo-size-val').textContent = state.logo.size;
        });
        bindInput('qs-logo-pad', function (el) {
            state.logo.padding = parseFloat(el.value);
            $('qs-logo-pad-val').textContent = state.logo.padding.toFixed(1);
        });
        bindInput('qs-logo-shape', function (el) { state.logo.shape = el.value; }, { event: 'change', instant: true });
        bindInput('qs-logo-bg', function (el) { state.logo.bgColor = el.value; });
        bindInput('qs-logo-excavate', function (el) { state.logo.excavate = el.checked; }, { event: 'change', instant: true });

        // frame
        bindInput('qs-frame-text', function (el) { state.frame.text = el.value; });
        $('qs-frame-font').addEventListener('change', function () {
            state.frame.font = $('qs-frame-font').value;
            commit();
            ensureFont(state.frame.font).then(scheduleRender);
        });
        bindInput('qs-frame-weight', function (el) { state.frame.fontWeight = el.value; }, { event: 'change', instant: true });
        bindInput('qs-frame-size', function (el) {
            state.frame.fontSize = parseFloat(el.value);
            $('qs-frame-size-val').textContent = state.frame.fontSize.toFixed(1);
        });
        bindInput('qs-frame-track', function (el) {
            state.frame.letterSpacing = parseFloat(el.value);
            $('qs-frame-track-val').textContent = state.frame.letterSpacing.toFixed(2);
        });
        bindInput('qs-frame-color', function (el) { state.frame.color = el.value; });
        bindInput('qs-frame-text-color', function (el) { state.frame.textColor = el.value; });

        // export
        $$('#qs-format .qs-seg-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                state.exportFormat = b.dataset.format;
                syncControlsFromState();
                commit();
            });
        });
        bindInput('qs-size', function (el) {
            state.exportSize = parseInt(el.value, 10);
            $('qs-size-val').textContent = state.exportSize;
            updatePrintHint();
        });
        bindInput('qs-filename', function (el) { state.filename = el.value; });

        $('qs-fg-swap').addEventListener('click', function () {
            var a = state.fg1;
            state.fg1 = state.fg2;
            state.fg2 = a;
            syncControlsFromState();
            commit();
            scheduleRender();
        });

        buildPalette('qs-fg-palette', function (c) { state.fg1 = c; syncControlsFromState(); });
        buildPalette('qs-bg-palette', function (c) { state.bg = c; state.bgTransparent = false; syncControlsFromState(); });

        $('qs-download').addEventListener('click', doDownload);
        $('qs-download-2').addEventListener('click', doDownload);
        $('qs-copy').addEventListener('click', function () { doCopy(false); });
        $('qs-copy-2').addEventListener('click', function () { doCopy(false); });
        $('qs-copy-nobg').addEventListener('click', function () { doCopy(true); });
        $('qs-verify').addEventListener('click', verifyDecode);

        $('qs-save').addEventListener('click', doSave);
        $('qs-load').addEventListener('click', function () { $('qs-load-input').click(); });
        $('qs-load-input').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) doLoad(e.target.files[0]);
            e.target.value = '';
        });
        $('qs-reset').addEventListener('click', function () {
            state = clone(DEFAULTS);
            logoImg = null;
            syncControlsFromState();
            commit();
            scheduleRender();
            toast('Reset to defaults');
        });
        $('qs-undo').addEventListener('click', function () { travel(-1); });
        $('qs-redo').addEventListener('click', function () { travel(1); });

        // tabs
        $$('.qs-tab').forEach(function (t, i, all) {
            t.setAttribute('role', 'tab');
            t.setAttribute('aria-selected', t.classList.contains('is-active') ? 'true' : 'false');
            var pane = document.querySelector('.qs-tabpane[data-pane="' + t.dataset.tab + '"]');
            if (pane) pane.setAttribute('role', 'tabpanel');

            function select() {
                all.forEach(function (x) {
                    x.classList.remove('is-active');
                    x.setAttribute('aria-selected', 'false');
                    x.tabIndex = -1;
                });
                t.classList.add('is-active');
                t.setAttribute('aria-selected', 'true');
                t.tabIndex = 0;
                $$('.qs-tabpane').forEach(function (p) {
                    p.classList.toggle('is-active', p.dataset.pane === t.dataset.tab);
                });
            }
            t.addEventListener('click', select);
            // Arrow-key navigation is what a tablist is expected to do.
            t.addEventListener('keydown', function (e) {
                var d = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
                if (!d) return;
                e.preventDefault();
                var next = all[(i + d + all.length) % all.length];
                next.click();
                next.focus();
            });
        });

        // collapsible panels
        $$('.qs-panel-head').forEach(function (h) {
            h.addEventListener('click', function () {
                h.setAttribute('aria-expanded', h.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
            });
        });

        // shortcuts
        document.addEventListener('keydown', function (e) {
            var tag = (e.target.tagName || '').toLowerCase();
            var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
            if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'c') {
                e.preventDefault(); doCopy(false); return;
            }
            if (typing) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                travel(e.shiftKey ? 1 : -1);
            }
        });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(scheduleRender, 120);
        });
        window.addEventListener('orientationchange', function () { setTimeout(scheduleRender, 220); });
    }

    function acceptLogo(file) {
        if (!/^image\//.test(file.type)) { toast('That file is not an image', 'bad'); return; }
        if (file.size > 3 * 1024 * 1024) { toast('Image is larger than 3 MB', 'bad'); return; }
        var fr = new FileReader();
        fr.onload = function () {
            var img = new Image();
            img.onload = function () {
                logoImg = img;
                state.logo.dataUrl = String(fr.result);
                state.logo.name = file.name;
                // A logo eats error-correction budget; make sure there is some.
                if (state.ecl === 'L' || state.ecl === 'M') {
                    state.ecl = 'H';
                    toast('Error correction raised to H for the logo');
                }
                syncControlsFromState();
                commit();
                scheduleRender();
            };
            img.onerror = function () { toast('Could not read that image', 'bad'); };
            img.src = String(fr.result);
        };
        fr.readAsDataURL(file);
    }

    // ----------------------------------------------------------- bootstrap

    function populateFontSelect() {
        var sel = $('qs-frame-font');
        sel.innerHTML = '';
        Object.keys(R.FONT_STACKS).forEach(function (k) {
            var o = document.createElement('option');
            o.value = k;
            o.textContent = R.FONT_STACKS[k].label + (R.FONT_STACKS[k].web ? '' : '  (system)');
            sel.appendChild(o);
        });
    }

    function collapseForHandhelds() {
        // Panels start collapsed on phones so the code itself is visible; this
        // is never persisted, because a panel opened by hand must stay open.
        if (window.innerWidth >= 720) return;
        $$('.qs-rail--right .qs-panel-head').forEach(function (h) { h.setAttribute('aria-expanded', 'false'); });
    }

    function init() {
        loadLocal();
        populateFontSelect();

        buildSwatches('qs-module-shapes', R.MODULE_SHAPES, moduleIconSvg,
            function () { return state.moduleShape; },
            function (v) { state.moduleShape = v; }, 'module');
        buildSwatches('qs-eye-frame-shapes', R.EYE_FRAME_SHAPES, eyeFrameIconSvg,
            function () { return state.eyeFrameShape; },
            function (v) { state.eyeFrameShape = v; }, 'eyeFrame');
        buildSwatches('qs-eye-ball-shapes', R.EYE_BALL_SHAPES, eyeBallIconSvg,
            function () { return state.eyeBallShape; },
            function (v) { state.eyeBallShape = v; }, 'eyeBall');

        var frameLabels = {};
        Object.keys(R.FRAMES).forEach(function (k) { frameLabels[k] = R.FRAMES[k].label; });
        buildSwatches('qs-frame-styles', frameLabels, frameIconSvg,
            function () { return state.frame.style; },
            function (v) {
                state.frame.style = v;
                $('qs-frame-controls').hidden = v === 'none';
                $('qs-frame-none-note').hidden = v !== 'none';
            });

        buildPresets();
        enhanceColorInputs();
        wire();
        collapseForHandhelds();

        applyLogoFromState().then(function () {
            syncControlsFromState();
            commit();
            return ensureFont(state.frame.font);
        }).then(scheduleRender);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
