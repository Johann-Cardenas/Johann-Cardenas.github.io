import { group, test, assert, assertEqual, assertClose } from './harness.mjs';
import { createPlaybackClock } from '../src/ui/playback.js';
import { drawOverlay, fitCanvas } from '../src/ui/overlay.js';
import { CANONICAL } from '../src/engine/types.js';

export function playbackTests() {
    group('Playback ownership and recovery');
    function rig(onFrame = () => {}, onEnd = () => {}) {
        let time = 0, seq = 0, errors = 0;
        const raf = new Map(), presented = new Map(), listeners = new Map();
        const video = { currentTime: 0.5, paused: false, seeking: false, readyState: 4,
            pause() { this.paused = true; },
            requestVideoFrameCallback(fn) { const id = ++seq; presented.set(id, fn); return id; },
            cancelVideoFrameCallback(id) { presented.delete(id); },
            addEventListener(name, fn) { listeners.set(name, fn); },
            removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }
        };
        const clock = createPlaybackClock(video, { start: 0.5, end: 2, onFrame, onEnd,
            onError: () => { errors++; }, now: () => time,
            requestAnimationFrame(fn) { const id = ++seq; raf.set(id, fn); return id; },
            cancelAnimationFrame(id) { raf.delete(id); }
        });
        return { video, clock, raf, presented, listeners, get errors() { return errors; },
            tick(ms, media) { time += ms; video.currentTime = media; const jobs = [...raf.values()]; raf.clear(); jobs.forEach(fn => fn(time)); },
            present(media) { const [id, fn] = presented.entries().next().value; presented.delete(id); fn(time, { mediaTime: media }); }
        };
    }
    test('missing presented-frame callbacks recover on the independent clock', () => {
        const frames = [], r = rig(time => frames.push(time));
        r.present(0.5); r.tick(150, 0.7);
        r.present(0.5); // duplicate callbacks must not reset the watchdog or rewind a pose
        r.tick(20, 0.8); r.present(NaN); r.tick(20, 0.9);
        assertEqual(frames.length, 4);
        assertClose(frames[3], 0.9, 1e-9);
        assertEqual(r.raf.size, 1);
        r.clock.dispose();
    });
    test('rendering failures do not break either scheduling chain', () => {
        let calls = 0;
        const r = rig(() => { if (++calls === 1) throw new Error('injected draw failure'); });
        r.present(0.5); r.present(0.6); r.tick(150, 0.8);
        assertEqual(calls, 3); assertEqual(r.errors, 1);
        assertEqual(r.presented.size, 1); assertEqual(r.raf.size, 1);
        r.clock.dispose();
    });
    test('pausing retains the presented pose instead of following the audio clock', () => {
        const frames = [], r = rig(time => frames.push(time));
        r.present(0.5);
        r.video.paused = true;
        r.tick(30, 0.52);
        assertEqual(frames.length, 1);
        assertEqual(frames[0], 0.5);
        r.listeners.get('seeked')();
        assertEqual(frames.at(-1), 0.52);
        r.clock.dispose();
    });
    test('a failed paused draw is retried at its target timestamp', () => {
        const frames = [];
        const r = rig(time => { frames.push(time); if (frames.length === 2) throw new Error('paused seek draw'); });
        r.present(0.5);
        r.video.paused = true;
        r.video.currentTime = 0.8;
        r.listeners.get('seeked')();
        r.tick(20, 0.8);
        assertEqual(frames.length, 3);
        assertEqual(frames.at(-1), 0.8);
        r.tick(20, 0.8);
        assertEqual(frames.length, 3);
        r.clock.dispose();
        let attempts = 0;
        const same = rig(() => { if (++attempts === 2) throw new Error('same-time redraw'); });
        same.present(0.5); same.video.paused = true;
        same.listeners.get('seeked')(); same.tick(20, 0.5);
        assertEqual(attempts, 3);
        same.clock.dispose();
    });
    test('a stable playback canvas reuses its backing buffer until resized', () => {
        const previous = globalThis.window;
        let writes = 0, width = 0, height = 0;
        const canvas = { style: {}, get width() { return width; }, set width(value) { writes++; width = value; },
            get height() { return height; }, set height(value) { writes++; height = value; },
            getContext: () => ({ setTransform() {} }) };
        try {
            globalThis.window = { devicePixelRatio: 2 };
            fitCanvas(canvas, 300, 500, true);
            const initial = writes;
            for (let i = 0; i < 60; i++) fitCanvas(canvas, 300, 500, true);
            assertEqual(writes, initial);
            fitCanvas(canvas, 400, 500, true);
            assert(writes > initial);
            assertEqual(canvas.width, 800);
        } finally {
            if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
        }
    });
    test('a UI-triggered redraw request wakes a paused clock at the requested frame', () => {
        const frames = [], r = rig(time => frames.push(time));
        r.present(0.5); r.video.paused = true;
        r.clock.requestRedraw(0.8);
        r.tick(20, 0.8);
        assertEqual(frames.at(-1), 0.8);
        r.clock.dispose();
        r.clock.requestRedraw(1);
        r.tick(20, 1);
        assertEqual(frames.length, 2);
    });
    test('retired callbacks cannot mutate a replacement player or rearm themselves', () => {
        let calls = 0;
        const r = rig(() => calls++);
        const stale = [...r.presented.values()][0], staleRaf = [...r.raf.values()][0];
        r.clock.dispose(); r.clock.dispose();
        stale(0, { mediaTime: 1 }); staleRaf();
        assertEqual(calls, 0); assertEqual(r.presented.size, 0); assertEqual(r.raf.size, 0);
        assertEqual(r.listeners.size, 0);
    });
    test('playback stops at the analyzed boundary instead of holding a pose over later video', () => {
        const frames = []; let ended = 0;
        const r = rig(time => frames.push(time), () => ended++);
        r.tick(30, 2.2);
        assert(r.video.paused); assertEqual(r.video.currentTime, 2);
        assertEqual(frames[0], 2); assertEqual(ended, 1);
        r.video.currentTime = 3; // e.g. media ended while the tab's animation clock was suspended
        r.tick(2000, 3);
        assertEqual(r.video.currentTime, 2);
        r.clock.dispose();
    });
    test('a mechanics layer does not draw a second skeleton over the tracked pose', () => {
        const lines = [];
        const ctx = new Proxy({}, { get: (_target, name) => name === 'lineTo' ? (...xy) => lines.push(xy) : () => {}, set: () => true });
        const options = { xy: new Float64Array(CANONICAL.length * 2).fill(NaN), vis: new Float64Array(CANONICAL.length), w: 100, h: 100,
            theme: { accent: '#22d3d1' }, layers: { skeleton: true, mechanics: true, guides: false, trails: false, events: false },
            mech: { bones: [[{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]], rows: [] }
        };
        drawOverlay(ctx, options); assertEqual(lines.length, 0);
        drawOverlay(ctx, { ...options, layers: { ...options.layers, skeleton: false } });
        assertEqual(lines.length, 1);
    });
}
