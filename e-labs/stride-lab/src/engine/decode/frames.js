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

import { parseMp4, measuredFps } from './mp4.js';

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

    return {
        path: 'webcodecs',
        timingConfidence: 'full',
        track: parsed.track,
        buffer: head,
        fps: measuredFps(parsed.track),
        frameCount: parsed.track.samples.length,
        width: parsed.track.width,
        height: parsed.track.height,
        rotationDeg: parsed.track.rotationDeg,
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
 * @param {() => boolean} [opts.cancelled]
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
                if (error || (opts.cancelled && opts.cancelled()) ||
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
        if (error || (opts.cancelled && opts.cancelled())) break;
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

    return { frames: emitted, path: 'webcodecs', timingConfidence: 'full', rotationDeg: track.rotationDeg };
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
    let finish;
    const done = new Promise(res => { finish = res; });

    const step = async (_now, meta) => {
        if (opts.cancelled && opts.cancelled()) { finish(); return; }
        if (lastPresented && meta.presentedFrames > lastPresented + 1) {
            dropped += meta.presentedFrames - lastPresented - 1;
        }
        lastPresented = meta.presentedFrames;
        if (meta.mediaTime >= startS && meta.mediaTime <= endS && emitted < total) {
            const bmp = await createImageBitmap(video);
            const index = emitted++;
            try {
                await opts.onFrame({ image: bmp, timestampUs: Math.round(meta.mediaTime * 1e6), index });
            } finally {
                try { bmp.close(); } catch { /* already closed */ }
            }
            if (opts.onProgress) opts.onProgress(emitted, Number.isFinite(total) ? total : 0);
        }
        if (meta.mediaTime > endS || emitted >= total || video.ended) { finish(); return; }
        video.requestVideoFrameCallback(step);
    };

    video.requestVideoFrameCallback(step);
    await video.play().catch(() => { });
    await done;
    video.pause();
    URL.revokeObjectURL(url);

    return {
        frames: emitted, dropped, path: 'video-element',
        timingConfidence: 'reduced', rotationDeg: 0
    };
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
