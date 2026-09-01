/* ============================================================
   Stride Lab — Stage C. Pose estimation.

   Primary backend: MediaPipe Tasks Vision PoseLandmarker,
   BlazePose GHUM.

   The decisive reason is the KEYPOINT SET, not the accuracy. Running
   form analysis needs the heel and the toe:

     - foot-strike angle is the angle of the heel-to-toe vector at
       contact. Without both points it cannot be computed at all.
     - the best kinematic contact detectors key off heel height and
       heel vertical velocity.

   COCO-17 models — MoveNet, YOLO-pose, RTMPose-17 — stop at the
   ankle. They are faster, and they cannot do either of the two
   things that most distinguish this product, which settles it.

   Known weaknesses, mitigated rather than ignored:
     - slower than MoveNet, markedly so on mid-range Android. This is
       offline analysis of a 6 s clip, not live tracking, so
       throughput matters more than latency: it runs in a worker with
       real progress, and mobile gets the `full` model rather than
       `heavy`.
     - the foot landmarks are the least reliable in the set, worst
       under motion blur at high foot velocity. That is exactly what
       the confidence gating and the multi-method event vote exist
       for.
   ============================================================ */

import { CANONICAL } from '../types.js';
import { adaptFrame, makeSeries } from './skeleton.js';

/**
 * The interface every backend implements. A second implementation
 * (RTMPose / Halpe-26 through onnxruntime-web) can be dropped in behind this
 * without a single metric file changing, because metrics address landmarks by
 * canonical NAME through the skeleton adapter.
 *
 * @typedef {Object} PoseBackend
 * @property {string} id
 * @property {readonly string[]} keypointNames
 * @property {(opts:{modelBase:string, preferGpu:boolean, variant?:string}) => Promise<void>} init
 * @property {(image:any, timestampMs:number) => Promise<RawPose[]|null>} infer
 * @property {() => void} dispose
 */

/** @typedef {{xy: Float32Array, vis: Float32Array, worldXY?: Float32Array}} RawPose */

/* Self-hosting these would make the offline story airtight, and it is the
   right end state. It is not done here because the two model files are ~9 MB
   and ~29 MB and this is a personal site repository; the CDN is used for the
   model weights and the WASM runtime ONLY. No video, no frame, and no landmark
   ever leaves the device, which is the claim that actually matters and which
   remains literally true. See DECISIONS.md. */
export const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';

export const MODEL_URLS = {
    lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
};

/**
 * Pick a model variant. Desktop gets `heavy`; a phone gets `full`, because
 * heavy on mid-range Android turns a 40-second wait into a three-minute one
 * for an accuracy difference that the frame rate of the clip usually dominates
 * anyway.
 */
export function defaultVariant() {
    if (typeof navigator === 'undefined') return 'full';
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (mobile || mem <= 4 || cores <= 4) return 'full';
    return 'heavy';
}

/** @returns {PoseBackend} */
export function createMediaPipeBackend() {
    let landmarker = null;
    let vision = null;
    let delegate = 'GPU';
    let variant = 'full';
    let lastTimestampMs = -1;

    return {
        id: 'mediapipe-blazepose',
        keypointNames: CANONICAL,

        get info() { return { delegate, variant }; },

        async init(opts) {
            const mod = await import(/* @vite-ignore */ `${opts.modelBase || MEDIAPIPE_CDN}/vision_bundle.mjs`);
            const { FilesetResolver, PoseLandmarker } = mod;
            vision = await FilesetResolver.forVisionTasks(`${opts.modelBase || MEDIAPIPE_CDN}/wasm`);
            variant = opts.variant || defaultVariant();

            const build = async (del) => PoseLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: MODEL_URLS[variant], delegate: del },
                runningMode: 'VIDEO',
                /* detect several and choose one in stage D — silently analysing
                   the wrong person produces a plausible, entirely wrong report */
                numPoses: 3,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputSegmentationMasks: false
            });

            if (opts.preferGpu !== false) {
                try {
                    landmarker = await build('GPU');
                    delegate = 'GPU';
                    return;
                } catch { /* fall through to CPU */ }
            }
            landmarker = await build('CPU');
            delegate = 'CPU';
        },

        async infer(image, timestampMs) {
            if (!landmarker) throw new Error('backend not initialised');
            /* MediaPipe's VIDEO mode keeps internal tracking state keyed on the
               timestamp. Out-of-order or repeated timestamps corrupt it
               silently, so they are forced strictly increasing here rather than
               trusted from upstream. */
            const t = timestampMs <= lastTimestampMs ? lastTimestampMs + 1 : timestampMs;
            lastTimestampMs = t;
            const res = landmarker.detectForVideo(image, t);
            if (!res || !res.landmarks || !res.landmarks.length) return null;
            return res.landmarks.map((lm, i) => {
                const xy = new Float32Array(lm.length * 2);
                const vis = new Float32Array(lm.length);
                for (let k = 0; k < lm.length; k++) {
                    xy[k * 2] = lm[k].x;
                    xy[k * 2 + 1] = lm[k].y;
                    vis[k] = lm[k].visibility != null ? lm[k].visibility : 1;
                }
                let worldXY;
                const w = res.worldLandmarks && res.worldLandmarks[i];
                if (w) {
                    worldXY = new Float32Array(w.length * 3);
                    for (let k = 0; k < w.length; k++) {
                        worldXY[k * 3] = w[k].x; worldXY[k * 3 + 1] = w[k].y; worldXY[k * 3 + 2] = w[k].z;
                    }
                }
                return { xy, vis, worldXY };
            });
        },

        dispose() {
            if (landmarker) { try { landmarker.close(); } catch { /* already closed */ } }
            landmarker = null;
        }
    };
}

/* ============================================================
   Stage D — person selection and tracking
   ============================================================ */

/**
 * Score a detected pose: mostly how big it is, partly how central.
 * The runner being analysed is the one filling the frame near the middle,
 * because that is what the capture guidance asks for.
 */
export function scorePose(pose, backendId = 'mediapipe-blazepose') {
    const b = boundingBox(pose);
    if (!b) return -1;
    const area = Math.max(0, (b.x1 - b.x0)) * Math.max(0, (b.y1 - b.y0));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const dist = Math.hypot(cx - 0.5, cy - 0.5) / Math.SQRT1_2;
    void backendId;
    return 0.6 * Math.min(1, area * 4) + 0.4 * (1 - Math.min(1, dist));
}

export function boundingBox(pose) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, seen = 0;
    for (let k = 0; k < pose.vis.length; k++) {
        if (!(pose.vis[k] >= 0.5)) continue;
        const x = pose.xy[k * 2], y = pose.xy[k * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        seen++;
    }
    return seen >= 6 ? { x0, y0, x1, y1 } : null;
}

function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const inter = ix * iy;
    const ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
    return ua > 0 ? inter / ua : 0;
}

/** Tolerate this many frames of occlusion before a track is abandoned. */
export const MAX_OCCLUSION_FRAMES = 8;

/**
 * Multi-person tracker.
 *
 * Feed it the detections for each frame in order; it maintains tracks by IoU
 * plus centroid distance and, at the end, `resolve()` reports whether the
 * choice was obvious. If two tracks each cover more than 40% of the clip it
 * says so instead of picking, and the app asks the user to tap the runner —
 * guessing wrong here produces a report that looks entirely normal and
 * describes somebody else.
 */
export function createTracker() {
    /** @type {{id:number, box:any, lastFrame:number, frames:number[], poses:Map<number,any>}[]} */
    const tracks = [];
    let nextId = 1;

    return {
        push(frameIndex, poses) {
            const boxes = poses.map(p => ({ p, b: boundingBox(p) })).filter(e => e.b);
            const taken = new Set();
            for (const t of tracks) {
                if (frameIndex - t.lastFrame > MAX_OCCLUSION_FRAMES) continue;
                let best = -1, bestScore = 0;
                for (let i = 0; i < boxes.length; i++) {
                    if (taken.has(i)) continue;
                    const o = iou(t.box, boxes[i].b);
                    const c = 1 - Math.min(1, Math.hypot(
                        (t.box.x0 + t.box.x1) / 2 - (boxes[i].b.x0 + boxes[i].b.x1) / 2,
                        (t.box.y0 + t.box.y1) / 2 - (boxes[i].b.y0 + boxes[i].b.y1) / 2) * 3);
                    const s = 0.7 * o + 0.3 * c;
                    if (s > bestScore) { bestScore = s; best = i; }
                }
                if (best >= 0 && bestScore > 0.25) {
                    taken.add(best);
                    t.box = boxes[best].b;
                    t.lastFrame = frameIndex;
                    t.frames.push(frameIndex);
                    t.poses.set(frameIndex, boxes[best].p);
                }
            }
            for (let i = 0; i < boxes.length; i++) {
                if (taken.has(i)) continue;
                tracks.push({
                    id: nextId++, box: boxes[i].b, lastFrame: frameIndex,
                    frames: [frameIndex], poses: new Map([[frameIndex, boxes[i].p]])
                });
            }
        },

        resolve(totalFrames) {
            const ranked = tracks
                .map(t => ({
                    id: t.id,
                    coverage: t.frames.length / Math.max(1, totalFrames),
                    score: t.frames.length / Math.max(1, totalFrames)
                        + 0.5 * scorePose(t.poses.get(t.frames[Math.floor(t.frames.length / 2)])),
                    track: t
                }))
                .sort((a, b) => b.score - a.score);
            const major = ranked.filter(r => r.coverage > 0.4);
            return {
                chosen: ranked[0] ? ranked[0].track : null,
                ambiguous: major.length > 1,
                candidates: ranked.slice(0, 4).map(r => ({
                    id: r.id, coverage: r.coverage, box: r.track.box
                }))
            };
        },

        get tracks() { return tracks; }
    };
}

/**
 * Assemble a canonical PoseSeries from a chosen track.
 * Frames the track never saw are left at zero visibility, which the
 * conditioning stage then treats as missing rather than as the origin.
 */
export function seriesFromTrack(track, frameTimesS, width, height, backendId) {
    const n = frameTimesS.length;
    const series = makeSeries(n, width, height);
    const K = CANONICAL.length;
    const tmpXY = new Float64Array(K * 2);
    const tmpVis = new Float64Array(K);
    for (let f = 0; f < n; f++) {
        series.t[f] = frameTimesS[f];
        const pose = track ? track.poses.get(f) : null;
        if (!pose) continue;
        adaptFrame(pose.xy, pose.vis, backendId, tmpXY, tmpVis);
        for (let c = 0; c < K; c++) {
            series.xy[(f * K + c) * 2] = tmpXY[c * 2];
            series.xy[(f * K + c) * 2 + 1] = tmpXY[c * 2 + 1];
            series.vis[f * K + c] = tmpVis[c];
        }
    }
    return series;
}

/**
 * Leg length in metres from the backend's own metric-space landmarks, used as
 * an INDEPENDENT check on the anthropometric scaling. Two estimates that
 * disagree by more than 20% mean one of them is wrong, and the honest response
 * is to downgrade every distance in the report rather than pick a favourite.
 */
export function worldLegLength(pose) {
    if (!pose || !pose.worldXY) return null;
    const w = pose.worldXY;
    const seg = (a, b) => Math.hypot(w[a * 3] - w[b * 3], w[a * 3 + 1] - w[b * 3 + 1], w[a * 3 + 2] - w[b * 3 + 2]);
    const left = seg(23, 25) + seg(25, 27);
    const right = seg(24, 26) + seg(26, 28);
    const v = (left + right) / 2;
    return Number.isFinite(v) && v > 0.2 && v < 1.5 ? v : null;
}
