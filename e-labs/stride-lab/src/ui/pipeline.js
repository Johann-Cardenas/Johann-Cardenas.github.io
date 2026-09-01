/* ============================================================
   Stride Lab — browser orchestration.

   The engine is pure and knows nothing about any of this. This file
   is the only place that touches decoders, workers and the network,
   and its whole job is to turn a file into a PoseSeries and hand it
   to runPipeline().

   Ordering, and why: frames are decoded on the MAIN thread and pose
   runs in a WORKER. The other way round sounds tidier and is worse —
   the <video> fallback decoder needs the DOM, so putting decoding in
   a worker would mean no fallback at all on a browser without
   WebCodecs, which is precisely the browser that needs one.
   ============================================================ */

import { probe, extractFrames, downscaleSize } from '../engine/decode/frames.js';
import {
    createMediaPipeBackend, createTracker, seriesFromTrack, worldLegLength,
    defaultVariant, MEDIAPIPE_CDN
} from '../engine/pose/mediapipe.js';
import { runPipeline } from '../engine/analyze.js';
import { loadStage2, runStage2 } from '../engine/events/stage2.js';
import { condition } from '../engine/signal/condition.js';
import { CANONICAL } from '../engine/types.js';

export const STAGES = [
    { id: 'ingest', label: 'Reading the clip' },
    { id: 'model', label: 'Loading the pose model' },
    { id: 'pose', label: 'Finding you in every frame' },
    { id: 'track', label: 'Following one runner' },
    { id: 'signal', label: 'Conditioning the trajectories' },
    { id: 'events', label: 'Detecting foot strikes and toe-offs' },
    { id: 'metrics', label: 'Computing the measurements' },
    { id: 'score', label: 'Comparing with the reference ranges' }
];

/**
 * @param {Blob} file
 * @param {Object} opts
 * @param {number} opts.heightM
 * @param {string} opts.surface
 * @param {number|null} opts.speedMs
 * @param {'auto'|'sagittal'|'frontal'} opts.view
 * @param {number} [opts.startS]
 * @param {number} [opts.endS]
 * @param {(s:{stage:string, done:number, total:number, label:string}) => void} [opts.onProgress]
 * @param {(p:{index:number, landmarks:Float32Array, width:number, height:number}) => void} [opts.onPreview]
 * @param {() => boolean} [opts.cancelled]
 * @param {number} [opts.trackChoice]  a track id, when the user has picked one
 */
export async function analyseFile(file, opts) {
    const progress = (stage, done = 0, total = 1) => {
        if (opts.onProgress) {
            const s = STAGES.find(x => x.id === stage);
            opts.onProgress({ stage, done, total, label: s ? s.label : stage });
        }
    };

    progress('ingest');
    const info = await probe(file);
    if (info.path === 'video-element' && typeof document === 'undefined') {
        throw new Error('This browser cannot decode the clip.');
    }

    progress('model');
    const runner = await createRunner(opts);

    /* ---- decode + infer, streamed ------------------------------------- */
    progress('pose', 0, info.frameCount || 0);
    const tracker = createTracker();
    const times = [];
    let width = 0, height = 0;
    let worldLeg = null;
    let frameIndex = 0;

    await extractFrames(file, {
        probe: info,
        startS: opts.startS,
        endS: opts.endS,
        cancelled: opts.cancelled,
        onFrame: async (frame) => {
            const src = frame.image;
            const w = src.displayWidth || src.width;
            const h = src.displayHeight || src.height;
            if (!width) {
                const d = downscaleSize(w, h);
                width = d.width; height = d.height;
            }
            /* Downscale before inference. The landmark model resizes internally
               anyway, so feeding 4K costs memory and time and buys nothing. */
            const bitmap = await createImageBitmap(src, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' });
            const poses = await runner.infer(bitmap, frame.timestampUs / 1000, frameIndex);
            times.push(frame.timestampUs / 1e6);
            if (poses && poses.length) {
                tracker.push(frameIndex, poses);
                if (worldLeg == null) worldLeg = worldLegLength(poses[0]);
                /* preview at most every third frame: the overlay does not need
                   every frame and the message traffic would otherwise dominate */
                if (opts.onPreview && frameIndex % 3 === 0) {
                    opts.onPreview({ index: frameIndex, landmarks: poses[0].xy, width, height });
                }
            }
            frameIndex++;
            progress('pose', frameIndex, info.frameCount || frameIndex);
        }
    });

    await runner.dispose();

    if (opts.cancelled && opts.cancelled()) return { cancelled: true };
    if (!times.length) {
        return { ok: false, code: 'no-frames', message: 'No frames could be read from this clip.' };
    }

    /* ---- choose the runner --------------------------------------------- */
    progress('track');
    const resolved = tracker.resolve(times.length);
    if (!resolved.chosen) {
        return {
            ok: false, code: 'no-person',
            message: 'We could not find a runner in this clip. Check that the whole body is in frame, including the feet.'
        };
    }
    if (resolved.ambiguous && opts.trackChoice == null) {
        return {
            ok: false, code: 'multiple-people',
            message: 'More than one person is in frame for most of the clip. Tap the runner you want analysed.',
            candidates: resolved.candidates,
            recoverable: true
        };
    }
    const track = opts.trackChoice != null
        ? (tracker.tracks.find(t => t.id === opts.trackChoice) || resolved.chosen)
        : resolved.chosen;

    const series = seriesFromTrack(track, times, width, height, runner.backendId);

    /* ---- stage 2, if a model has been dropped in ------------------------ */
    progress('signal');
    let stage2 = null;
    try {
        const model = await loadStage2(opts.stage2Url);
        if (model) {
            const cond = condition(series, { fps: estimateFps(times) });
            stage2 = await runStage2(model, cond, cond.height * 0.35);
        }
    } catch { stage2 = null; }

    /* ---- the pure engine ------------------------------------------------ */
    progress('events');
    const result = runPipeline(series, {
        heightM: opts.heightM,
        surface: opts.surface,
        speedMs: opts.speedMs,
        view: opts.view,
        backend: runner.backendId,
        stage2,
        worldLegLengthM: worldLeg
    });
    progress('metrics');
    progress('score');

    if (result.ok) {
        result.engine.delegate = runner.delegate;
        result.engine.modelVariant = runner.variant;
        result.engine.crossOriginIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
        result.engine.decodePath = info.path;
        result.capture.timingConfidence = info.timingConfidence;
        result.capture.rotationDeg = info.rotationDeg || 0;
        if (info.timingConfidence === 'reduced') {
            result.warnings.unshift({
                code: 'reduced-timing',
                message: 'This browser could not decode the clip frame by frame, so the timestamps came from playback instead. Timing measurements are less precise than they would be in a browser with WebCodecs.'
            });
        }
    }
    result.series = series;
    result.trackCandidates = resolved.candidates;
    return result;
}

function estimateFps(times) {
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    const med = gaps[gaps.length >> 1];
    return med > 0 ? 1 / med : 30;
}

/**
 * A pose runner, in a worker when the browser allows it and on the main thread
 * when it does not. The fallback is not a nicety: module workers, dynamic
 * import inside a worker and WASM instantiation all fail on some real
 * configurations, and an app that cannot analyse anything there is worse than
 * one that analyses slowly.
 */
async function createRunner(opts) {
    const preferGpu = opts.preferGpu !== false;
    const variant = opts.variant || defaultVariant();

    if (opts.useWorker !== false && typeof Worker !== 'undefined') {
        try {
            const worker = new Worker(new URL('../../workers/pose.worker.js', import.meta.url), { type: 'module' });
            const ready = await new Promise((res, rej) => {
                const to = setTimeout(() => rej(new Error('worker init timed out')), 30000);
                worker.onmessage = (e) => {
                    if (e.data.t === 'ready') { clearTimeout(to); res(e.data); }
                    else if (e.data.t === 'error') { clearTimeout(to); rej(new Error(e.data.message)); }
                };
                worker.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || 'worker failed')); };
                worker.postMessage({ t: 'init', modelBase: MEDIAPIPE_CDN, preferGpu, variant });
            });

            let seq = 0;
            const waiting = new Map();
            worker.onmessage = (e) => {
                if (e.data.t === 'poses') {
                    const r = waiting.get(e.data.index);
                    if (r) { waiting.delete(e.data.index); r(e.data.poses); }
                } else if (e.data.t === 'error') {
                    for (const r of waiting.values()) r([]);
                    waiting.clear();
                }
            };

            return {
                backendId: ready.backend,
                delegate: ready.delegate,
                variant: ready.variant,
                inWorker: true,
                infer(bitmap, timestampMs, index) {
                    void seq;
                    return new Promise((res) => {
                        waiting.set(index, res);
                        worker.postMessage({ t: 'frame', image: bitmap, timestampMs, index }, [bitmap]);
                    });
                },
                async dispose() { worker.terminate(); }
            };
        } catch {
            /* fall through to the main thread */
        }
    }

    const backend = createMediaPipeBackend();
    await backend.init({ modelBase: MEDIAPIPE_CDN, preferGpu, variant });
    return {
        backendId: backend.id,
        delegate: backend.info.delegate,
        variant: backend.info.variant,
        inWorker: false,
        async infer(bitmap, timestampMs) {
            const poses = await backend.infer(bitmap, timestampMs);
            try { bitmap.close(); } catch { /* already closed */ }
            return poses || [];
        },
        async dispose() { backend.dispose(); }
    };
}

/** Canonical landmark names, re-exported for the overlay renderer. */
export { CANONICAL };
