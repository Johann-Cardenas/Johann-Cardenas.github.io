/* ============================================================
   Stride Lab — Stage B. Frame extraction.

   Two paths, and the difference between them is recorded in the
   analysis metadata rather than hidden:

     1. WebCodecs VideoDecoder over the sample table from mp4.js.
        Exact presentation timestamps, decodes far faster than real
        time, and never seeks.

     2. <video> + requestVideoFrameCallback, using metadata.mediaTime
        as the timestamp and metadata.presentedFrames to notice
        dropped frames. Used for WebM, fragmented MP4, or any browser
        without WebCodecs. Marked `timingConfidence: 'reduced'`.

   What is NOT used, on purpose: <video> with currentTime seeking.
   The specification does not guarantee a frame-accurate seek, and
   every timing metric in this app is a difference between two frame
   timestamps.

   Frames are streamed, never accumulated. A 6 s clip at 240 fps is
   1440 decoded frames; holding them would exhaust a phone long
   before the analysis finished. Each frame is handed to the caller,
   then closed.
   ============================================================ */

import { parseMp4, measuredFps, displaySize } from './mp4.js';

/**
 * @typedef {Object} Frame
 * @property {VideoFrame|ImageBitmap} image  the caller MUST close() it
 * @property {number} timestampUs
 * @property {number} index
 */

export const DEFAULT_LONG_SIDE = 640;

/**
 * Probe a file: what is in it, and which decode path will be used.
 * Cheap — reads the sample table only, decodes nothing.
 */
export async function probe(file) {
    const supported = typeof VideoDecoder !== 'undefined';
    let head;
    try {
        head = await file.arrayBuffer();
    } catch {
        return { path: 'video-element', reason: 'unreadable', timingConfidence: 'reduced' };
    }
    const parsed = parseMp4(head);
    if (!supported) {
        return { path: 'video-element', reason: 'no-webcodecs', timingConfidence: 'reduced' };
    }
    if (!parsed.ok) {
        return { path: 'video-element', reason: parsed.reason, timingConfidence: 'reduced' };
    }
    const config = {
        codec: parsed.track.codec,
        codedWidth: Math.round(parsed.track.width),
        codedHeight: Math.round(parsed.track.height),
        description: parsed.track.description || undefined
    };
    let ok = false;
    try {
        ok = (await VideoDecoder.isConfigSupported(config)).supported;
    } catch { ok = false; }
    if (!ok) return { path: 'video-element', reason: 'codec-unsupported', timingConfidence: 'reduced' };

    /* Display orientation, not coded orientation. A phone recording in portrait
       stores landscape pixels plus a quarter-turn in the display matrix; the
       decoder hands back the landscape pixels and knows nothing about the
       matrix, so the size the user recognizes is this one. */
    const display = displaySize(parsed.track);
    return {
        path: 'webcodecs',
        timingConfidence: 'full',
        track: parsed.track,
        buffer: head,
        fps: measuredFps(parsed.track),
        frameCount: parsed.track.samples.length,
        codedWidth: parsed.track.width,
        codedHeight: parsed.track.height,
        width: display.width,
        height: display.height,
        rotationDeg: parsed.track.rotationDeg,
        mirrored: parsed.track.mirrored,
        durationS: parsed.track.samples.length
            ? (Math.max(...parsed.track.samples.map(s => s.cts)) + parsed.track.samples[0].duration) / parsed.track.timescale
            : 0
    };
}

/**
 * Stream frames. `onFrame` is awaited, so the caller controls back-pressure:
 * the decoder is not allowed to run ahead of the pose estimator and pile up
 * decoded frames in memory.
 *
 * @param {Blob} file
 * @param {Object} opts
 * @param {number} [opts.startS]
 * @param {number} [opts.endS]
 * @param {number} [opts.maxFrames]
 * @param {(f: Frame) => Promise<void>|void} opts.onFrame
 * @param {(done:number, total:number) => void} [opts.onProgress]
 * @param {() => boolean} [opts.canceled]
 */
export async function extractFrames(file, opts) {
    const info = opts.probe || await probe(file);
    return info.path === 'webcodecs'
        ? decodeWithWebCodecs(info, opts)
        : decodeWithVideoElement(file, opts);
}

async function decodeWithWebCodecs(info, opts) {
    const { track, buffer } = info;
    const bytes = new Uint8Array(buffer);
    const ts = track.timescale;
    const startS = opts.startS ?? 0;
    const endS = opts.endS ?? Infinity;

    /* Samples must be fed in DECODE order; the composition time is what the
       output carries. Decoding has to start at the sync sample at or before the
       window, otherwise the first frames reference data the decoder never saw. */
    const inOrder = track.samples.map((s, i) => ({ ...s, i }));
    let firstIdx = 0;
    for (let i = 0; i < inOrder.length; i++) {
        if (inOrder[i].cts / ts <= startS && inOrder[i].sync) firstIdx = i;
        if (inOrder[i].cts / ts > startS) break;
    }
    let lastIdx = inOrder.length - 1;
    for (let i = firstIdx; i < inOrder.length; i++) {
        if (inOrder[i].cts / ts > endS) { lastIdx = i; break; }
    }

    const wanted = inOrder.slice(firstIdx, lastIdx + 1);
    const total = Math.min(wanted.length, opts.maxFrames ?? Infinity);

    let emitted = 0;
    let pending = Promise.resolve();
    let error = null;

    const decoder = new VideoDecoder({
        output: (frame) => {
            pending = pending.then(async () => {
                const tS = frame.timestamp / 1e6;
                if (error || (opts.canceled && opts.canceled()) ||
                    tS < startS - 1e-6 || tS > endS + 1e-6 || emitted >= total) {
                    frame.close();
                    return;
                }
                const index = emitted++;
                try {
                    await opts.onFrame({ image: frame, timestampUs: frame.timestamp, index });
                } catch (e) {
                    error = e;
                } finally {
                    /* the consumer may already have closed it; closing twice is
                       harmless, leaking is not */
                    try { frame.close(); } catch { /* already closed */ }
                }
                if (opts.onProgress) opts.onProgress(emitted, total);
            });
        },
        error: (e) => { error = e; }
    });

    decoder.configure({
        codec: track.codec,
        codedWidth: Math.round(track.width),
        codedHeight: Math.round(track.height),
        description: track.description || undefined,
        optimizeForLatency: true
    });

    for (const s of wanted) {
        if (error || (opts.canceled && opts.canceled())) break;
        decoder.decode(new EncodedVideoChunk({
            type: s.sync ? 'key' : 'delta',
            timestamp: Math.round(s.cts / ts * 1e6),
            duration: Math.round(s.duration / ts * 1e6),
            data: bytes.subarray(s.offset, s.offset + s.size)
        }));
        /* keep the decoder queue short so memory stays bounded */
        if (decoder.decodeQueueSize > 12) {
            await new Promise(r => setTimeout(r, 0));
            await pending;
        }
    }
    await decoder.flush().catch(() => { });
    await pending;
    decoder.close();
    if (error) throw error;

    return {
        frames: emitted, path: 'webcodecs', timingConfidence: 'full',
        rotationDeg: track.rotationDeg, mirrored: track.mirrored
    };
}

/**
 * Fallback: play the clip and take a callback per presented frame.
 * `mediaTime` is a real presentation timestamp, so this is materially better
 * than seeking — but it runs at playback speed and the browser may drop
 * frames under load, which `presentedFrames` lets us detect and report.
 */
async function decodeWithVideoElement(file, opts) {
    if (typeof document === 'undefined') {
        throw new Error('no-video-element');   /* worker context without WebCodecs */
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = () => rej(new Error('video-load-failed'));
    });

    if (!('requestVideoFrameCallback' in video)) {
        URL.revokeObjectURL(url);
        throw new Error('no-frame-callback');
    }

    const startS = opts.startS ?? 0;
    const endS = opts.endS ?? video.duration;
    const total = opts.maxFrames ?? Infinity;

    video.currentTime = startS;
    await new Promise(res => { video.onseeked = res; });

    let emitted = 0, dropped = 0, lastPresented = 0;
    let firstMediaTime = null, lastMediaTime = null;
    let finish;
    const done = new Promise(res => { finish = res; });

    const step = async (_now, meta) => {
        if (opts.canceled && opts.canceled()) { finish(); return; }
        if (lastPresented && meta.presentedFrames > lastPresented + 1) {
            dropped += meta.presentedFrames - lastPresented - 1;
        }
        lastPresented = meta.presentedFrames;
        /* Pausing and resuming can re-present the frame already handled. */
        const fresh = lastMediaTime == null || meta.mediaTime > lastMediaTime + 1e-6;
        if (fresh && meta.mediaTime >= startS && meta.mediaTime <= endS && emitted < total) {
            /* STOP THE CLOCK. `onFrame` is pose inference — 100 ms and up per
               frame — and the video does not wait for it. Registering the next
               callback only after the await, as this did, means every frame
               presented while the model was busy is simply gone: the decode
               then samples at the speed of inference rather than at the frame
               rate of the clip. Measured on a 30 fps recording, a free
               consumer got 24 fps, a 40 ms consumer 11.5, and real inference
               5 — at which point the pipeline refused the clip and told the
               user to re-record at 60 fps, which would not have helped,
               because the recording was never the problem. */
            video.pause();
            const bmp = await createImageBitmap(video);
            const index = emitted++;
            if (firstMediaTime == null) firstMediaTime = meta.mediaTime;
            lastMediaTime = meta.mediaTime;
            try {
                await opts.onFrame({ image: bmp, timestampUs: Math.round(meta.mediaTime * 1e6), index });
            } finally {
                try { bmp.close(); } catch { /* already closed */ }
            }
            if (opts.onProgress) opts.onProgress(emitted, Number.isFinite(total) ? total : 0);
        }
        if (meta.mediaTime > endS || emitted >= total || video.ended) { finish(); return; }
        /* Register BEFORE resuming, or the first frame after the resume can be
           presented with nobody listening for it. */
        video.requestVideoFrameCallback(step);
        if (video.paused) await video.play().catch(() => { finish(); });
    };

    video.requestVideoFrameCallback(step);
    await video.play().catch(() => { });
    await done;
    video.pause();
    URL.revokeObjectURL(url);

    /* What the SOURCE ran at, as distinct from what we managed to sample. The
       two differ only when frames were lost, and telling them apart is what
       lets the pipeline say "this browser could not keep up" rather than
       "your camera is too slow". */
    const spanS = (firstMediaTime != null && lastMediaTime > firstMediaTime)
        ? lastMediaTime - firstMediaTime : 0;
    const sourceFps = spanS > 0 ? (emitted - 1 + dropped) / spanS : null;

    /* A <video> element applies the display matrix itself, so these frames are
       already upright and must NOT be rotated again. The two decode paths
       disagreeing about orientation would mean the same clip analyzed
       differently on two browsers. */
    return {
        frames: emitted, dropped, sourceFps, path: 'video-element',
        timingConfidence: 'reduced', rotationDeg: 0, mirrored: false
    };
}

/**
 * Turn a decoded frame into an upright, downscaled bitmap for inference.
 *
 * This is the step that has to exist. WebCodecs decodes the CODED frame and
 * ignores the container's display matrix, so portrait phone video arrives on
 * its side. BlazePose is trained on upright people: given a runner lying
 * sideways it does not degrade gracefully, it produces a confidently wrong
 * skeleton. Rotating the pixels here — rather than rotating the landmarks
 * afterward — is what lets the model see what the user saw.
 *
 * @param {VideoFrame|ImageBitmap} src
 * @param {number} rotationDeg  0, 90, 180 or 270, clockwise
 * @param {boolean} mirrored
 * @param {number} outW  target width, already in DISPLAY orientation
 * @param {number} outH
 */
export async function orientFrame(src, rotationDeg, mirrored, outW, outH) {
    const rot = ((Math.round((rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
    if (!rot && !mirrored) {
        return createImageBitmap(src, { resizeWidth: outW, resizeHeight: outH, resizeQuality: 'medium' });
    }
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(outW, outH)
        : Object.assign(document.createElement('canvas'), { width: outW, height: outH });
    const ctx = canvas.getContext('2d');
    /* the drawing box, in the rotated coordinate system */
    const swap = rot === 90 || rot === 270;
    const drawW = swap ? outH : outW;
    const drawH = swap ? outW : outH;

    ctx.save();
    if (rot === 90) { ctx.translate(outW, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(outW, outH); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, outH); ctx.rotate(-Math.PI / 2); }
    if (mirrored) { ctx.translate(drawW, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, 0, 0, drawW, drawH);
    ctx.restore();

    return canvas.transferToImageBitmap
        ? canvas.transferToImageBitmap()
        : createImageBitmap(canvas);
}

/**
 * Longest-side target for inference. Landmark models resize internally anyway,
 * so feeding 4K costs memory and time and buys nothing.
 */
export function downscaleSize(w, h, longSide = DEFAULT_LONG_SIDE) {
    const m = Math.max(w, h);
    if (!(m > longSide)) return { width: Math.round(w), height: Math.round(h), scale: 1 };
    const s = longSide / m;
    return { width: Math.round(w * s), height: Math.round(h * s), scale: s };
}
