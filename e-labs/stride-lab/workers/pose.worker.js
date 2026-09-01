/* ============================================================
   Stride Lab — pose worker.

   Inference runs here so the main thread stays free to draw the live
   skeleton overlay while frames are processed. That overlay is the
   most persuasive thing in the product and it is what makes a
   forty-second wait tolerable, so it must not be competing with the
   model for the same thread.

   Frames arrive as transferred ImageBitmaps — never structured-cloned
   — and landmarks go back as transferred typed arrays.
   ============================================================ */

import { createMediaPipeBackend, defaultVariant, MEDIAPIPE_CDN } from '../src/engine/pose/mediapipe.js';

let backend = null;

self.onmessage = async (e) => {
    const msg = e.data;
    try {
        if (msg.t === 'init') {
            backend = createMediaPipeBackend();
            await backend.init({
                modelBase: msg.modelBase || MEDIAPIPE_CDN,
                preferGpu: msg.preferGpu !== false,
                variant: msg.variant || defaultVariant()
            });
            self.postMessage({
                t: 'ready',
                backend: backend.id,
                delegate: backend.info.delegate,
                variant: backend.info.variant,
                crossOriginIsolated: self.crossOriginIsolated === true
            });
            return;
        }

        if (msg.t === 'frame') {
            const poses = await backend.infer(msg.image, msg.timestampMs);
            try { msg.image.close(); } catch { /* already closed */ }
            if (!poses) {
                self.postMessage({ t: 'poses', index: msg.index, poses: [] });
                return;
            }
            const transfer = [];
            const flat = poses.map(p => {
                transfer.push(p.xy.buffer, p.vis.buffer);
                if (p.worldXY) transfer.push(p.worldXY.buffer);
                return { xy: p.xy, vis: p.vis, worldXY: p.worldXY };
            });
            self.postMessage({ t: 'poses', index: msg.index, poses: flat }, transfer);
            return;
        }

        if (msg.t === 'dispose') {
            if (backend) backend.dispose();
            backend = null;
            self.postMessage({ t: 'disposed' });
        }
    } catch (err) {
        self.postMessage({ t: 'error', message: String((err && err.message) || err) });
    }
};
