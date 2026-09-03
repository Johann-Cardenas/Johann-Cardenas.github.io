/* ============================================================
   Gear3D — raster export with tiled fallback
   ------------------------------------------------------------
   Exports re-render the current view at full resolution rather
   than upscaling the viewport.

   Before allocating a large framebuffer we ask the GL context what
   it can actually do. If the requested size exceeds
   MAX_RENDERBUFFER_SIZE / MAX_TEXTURE_SIZE / MAX_VIEWPORT_DIMS, we
   fall back to TILED rendering: the image is rendered as an N x M
   grid of tiles using the camera's view-offset (which works for
   both orthographic and perspective projections) and composited
   into a 2D canvas.

   Silently emitting a black 4K PNG on integrated graphics is the
   classic failure of tools like this. Every path here either
   produces a correct image or throws with a message that says what
   to do instead.
   ============================================================ */

'use strict';

/** Resolution presets offered in the UI. */
export const RESOLUTION_PRESETS = Object.freeze([
    { id: '1600x1200', width: 1600, height: 1200, label: '1600 × 1200' },
    { id: '2400x1800', width: 2400, height: 1800, label: '2400 × 1800 (300 dpi @ 8×6 in)' },
    { id: '3600x2700', width: 3600, height: 2700, label: '3600 × 2700 (600 dpi @ 6×4.5 in)' },
    { id: '1920x1080', width: 1920, height: 1080, label: '1920 × 1080' },
    { id: '3840x2160', width: 3840, height: 2160, label: '3840 × 2160' },
    { id: 'custom', width: 2400, height: 1800, label: 'Custom…' }
]);

/**
 * @typedef {Object} RasterOptions
 * @property {number} width
 * @property {number} height
 * @property {'png'|'png-alpha'|'jpeg'} format
 * @property {number} [quality=0.95]  JPEG only
 * @property {number} [maxTile]       override the tile size (testing)
 * @property {number} [supersample=1] render at this multiple, then downsample
 * @property {(stage: string, done: number, total: number) => void} [onProgress]
 */

/**
 * Render at a multiple of the requested size and box-filter down.
 *
 * MSAA antialiases geometry edges but does nothing for the specular
 * shimmer along a rim's polished lip or the sub-pixel detail in tread
 * grooves, which is exactly the content that falls apart at 600 dpi.
 * Supersampling resolves both, at the cost of 4x the fill for 2x.
 *
 * The tiled fallback composes with this automatically: the supersampled
 * target is simply a larger image, so if it exceeds the GPU limit it is
 * tiled like any other.
 *
 * @param {import('../scene/renderer.js').Viewport} viewport
 * @param {RasterOptions} opts
 * @returns {Promise<HTMLCanvasElement>} at exactly opts.width x opts.height
 */
export async function renderSupersampled(viewport, opts) {
    const ss = Math.max(1, Math.min(4, Math.round(opts.supersample ?? 1)));
    if (ss === 1) return renderToCanvas(viewport, opts);

    const big = await renderToCanvas(viewport, {
        ...opts,
        width: opts.width * ss,
        height: opts.height * ss,
        onProgress: (stage, done, total) => opts.onProgress?.(stage, done, total)
    });

    opts.onProgress?.('downsample', 0, 1);
    const out = document.createElement('canvas');
    out.width = opts.width;
    out.height = opts.height;
    // willReadFrequently: isBlank() samples this context pixel by pixel, and
    // without the hint the browser keeps it GPU-backed and reads back each time.
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not obtain a 2D context for downsampling.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Halve repeatedly rather than scaling in one step: a single large
    // downscale in canvas2d samples too sparsely and reintroduces the
    // aliasing the supersample was meant to remove.
    let src = big;
    let w = big.width, h = big.height;
    while (w > opts.width * 2 && h > opts.height * 2) {
        const half = document.createElement('canvas');
        half.width = Math.max(opts.width, Math.round(w / 2));
        half.height = Math.max(opts.height, Math.round(h / 2));
        const hctx = half.getContext('2d');
        hctx.imageSmoothingEnabled = true;
        hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(src, 0, 0, half.width, half.height);
        src = half; w = half.width; h = half.height;
    }
    ctx.drawImage(src, 0, 0, opts.width, opts.height);
    opts.onProgress?.('downsample', 1, 1);
    return out;
}

/**
 * Render the current view to a canvas at an arbitrary size.
 *
 * @param {import('../scene/renderer.js').Viewport} viewport
 * @param {RasterOptions} opts
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderToCanvas(viewport, opts) {
    const { width, height } = opts;
    if (!(width > 0 && height > 0)) throw new Error('Export size must be positive.');

    const caps = viewport.capabilities();
    const limit = Math.max(256, Math.min(
        caps.maxRenderbuffer || 4096,
        caps.maxTexture || 4096,
        caps.maxViewport?.[0] || 4096,
        caps.maxViewport?.[1] || 4096,
        opts.maxTile || Infinity
    ));

    const transparent = opts.format === 'png-alpha';
    const needsTiles = width > limit || height > limit;

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    // willReadFrequently: isBlank() samples this context pixel by pixel, and
    // without the hint the browser keeps it GPU-backed and reads back each time.
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not obtain a 2D context for the export canvas.');

    if (!transparent) {
        const bg = viewport.background === 'color' ? viewport.backgroundColor
            : viewport.background === 'transparent' ? '#ffffff'
                : '#ffffff';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
    }

    const renderer = viewport.renderer;
    const camera = viewport.cameras.camera;
    const prevSize = viewport.size;
    const prevRatio = renderer.getPixelRatio();
    const prevAlpha = transparent ? null : undefined;

    // The export is not the live view: pixel ratio must be exactly 1 or the
    // requested pixel dimensions come out multiplied by the display scale.
    renderer.setPixelRatio(1);
    if (transparent) renderer.setClearAlpha(0);

    try {
        if (!needsTiles) {
            opts.onProgress?.('render', 0, 1);
            viewport.cameras.setSize(width, height);
            renderer.setSize(width, height, false);
            /** @type {any} */(camera).clearViewOffset?.();
            // renderScene(), not renderer.render(): the viewport is the only
            // thing that knows whether this frame is one view or four.
            viewport.renderScene();
            ctx.drawImage(renderer.domElement, 0, 0);
            opts.onProgress?.('render', 1, 1);
        } else {
            if (viewport.quad) {
                // Tiling offsets ONE projection matrix. Quad view has four,
                // each confined to a scissor rect, and an offset applied to
                // the frame would not map onto them. Rather than emit a
                // quietly wrong sheet, say so and let the user choose a size
                // the GPU can render in one pass.
                throw new Error(
                    `A ${width} x ${height} quad export exceeds this GPU's `
                    + `${limit} px limit, and the quad layout cannot be tiled. `
                    + 'Reduce the resolution, lower the supersample factor, or '
                    + 'export the panes individually from single view.'
                );
            }
            const cols = Math.ceil(width / limit);
            const rows = Math.ceil(height / limit);
            const total = cols * rows;
            let done = 0;

            viewport.cameras.setSize(width, height);

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const tw = Math.min(limit, width - c * limit);
                    const th = Math.min(limit, height - r * limit);

                    renderer.setSize(tw, th, false);
                    /** @type {any} */(camera).setViewOffset(width, height, c * limit, r * limit, tw, th);
                    camera.updateProjectionMatrix();
                    renderer.render(viewport.scene, camera);
                    ctx.drawImage(renderer.domElement, c * limit, r * limit);

                    done++;
                    opts.onProgress?.('tile', done, total);
                    // Yield so the progress indicator can actually paint.
                    await new Promise((res) => setTimeout(res, 0));
                }
            }
            /** @type {any} */(camera).clearViewOffset();
            camera.updateProjectionMatrix();
        }
    } finally {
        // Restore the live view exactly as it was.
        if (transparent) renderer.setClearAlpha(prevAlpha === null ? 1 : 1);
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.width, prevSize.height, false);
        viewport.cameras.setSize(prevSize.width, prevSize.height);
        /** @type {any} */(camera).clearViewOffset?.();
        camera.updateProjectionMatrix();
        viewport.setBackground(viewport.background, viewport.backgroundColor);
        viewport.invalidate();
    }

    // A completely blank result almost always means a lost context or a
    // driver refusing the allocation. Say so rather than hand back a black
    // rectangle that looks like a rendering bug.
    if (isBlank(ctx, width, height) && !transparent) {
        throw new Error(
            'The export rendered blank. This usually means the GPU refused the requested '
            + `size (${width} × ${height}). Try a smaller resolution, or reload the page if the `
            + 'WebGL context was lost.'
        );
    }

    return out;
}

/**
 * Composite the SVG annotation overlay onto an already-rendered canvas.
 * Used by the PNG/JPEG path, where annotations have to be rasterized.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SVGSVGElement} overlay
 * @param {{width: number, height: number, sourceWidth: number, sourceHeight: number}} geom
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function compositeOverlay(canvas, overlay, geom) {
    const clone = /** @type {SVGSVGElement} */ (overlay.cloneNode(true));
    clone.setAttribute('width', String(geom.width));
    clone.setAttribute('height', String(geom.height));
    clone.setAttribute('viewBox', `0 0 ${geom.sourceWidth} ${geom.sourceHeight}`);
    inlineComputedColors(overlay, clone);

    const svgText = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        const img = await loadImage(url);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, geom.width, geom.height);
    } finally {
        URL.revokeObjectURL(url);
    }
    return canvas;
}

/**
 * SVG rendered into an <img> has no access to the document's CSS custom
 * properties, so `currentColor` and `var(--g3-paper)` would resolve to
 * nothing. Resolve them to literal values on the clone.
 *
 * @param {SVGSVGElement} source
 * @param {SVGSVGElement} clone
 */
export function inlineComputedColors(source, clone) {
    const cs = getComputedStyle(source);
    const color = cs.color || '#16202b';
    const paper = getComputedStyle(document.documentElement)
        .getPropertyValue('--g3-paper').trim() || '#ffffff';

    clone.setAttribute('color', color);
    const walk = (n) => {
        if (n.nodeType === 1) {
            const e = /** @type {Element} */ (n);
            for (const attr of ['fill', 'stroke']) {
                const v = e.getAttribute(attr);
                if (!v) continue;
                if (v === 'currentColor') e.setAttribute(attr, color);
                else if (v.startsWith('var(')) {
                    e.setAttribute(attr, v.includes('--g3-paper') ? paper : color);
                }
            }
            if (!e.getAttribute('font-family') && e.tagName === 'text') {
                e.setAttribute('font-family', cs.fontFamily || 'sans-serif');
            }
        }
        for (const c of n.childNodes) walk(c);
    };
    walk(clone);
}

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not rasterize the annotation overlay.'));
        img.src = src;
    });
}

/**
 * Cheap blank-frame detector: samples a sparse grid rather than reading the
 * whole buffer, which on a 3600 x 2700 export would itself be slow.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @returns {boolean}
 */
function isBlank(ctx, w, h) {
    const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
    let first = null;
    for (let y = step; y < h; y += step) {
        for (let x = step; x < w; x += step) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            const key = `${d[0]},${d[1]},${d[2]},${d[3]}`;
            if (first === null) first = key;
            else if (key !== first) return false;
        }
    }
    return true;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {'png'|'png-alpha'|'jpeg'} format
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, format, quality = 0.95) {
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Could not encode the exported image.'))),
            mime,
            format === 'jpeg' ? quality : undefined
        );
    });
}
