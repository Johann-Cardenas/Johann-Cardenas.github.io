import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { auditTreadmill } from '../treadmill-audit.mjs';
import { rotateLeg } from '../pose-reliability.mjs';

const treadmillReview = JSON.parse(await readFile(new URL('../fixtures/treadmill-review.json', import.meta.url), 'utf8'));

async function treadmillEvidence(page, record, testInfo) {
    const encoded = await page.evaluate(async ({ record, review }) => {
        const video = document.getElementById('sl-video'); video.pause();
        const sheet = document.createElement('canvas'); sheet.width = 600; sheet.height = 748;
        const ctx = sheet.getContext('2d'); ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, 600, 748);
        const array = v => Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v) : Object.values(v);
        const k = record.keypoints, t = array(k.t), xy = array(k.xy), vis = array(k.vis), K = k.names.length;
        for (let i = 0; i < review.samples.length; i++) {
            const sample = review.samples[i];
            if (Math.abs(video.currentTime - sample.time) > 1e-5 || video.seeking) await new Promise(resolve => {
                video.addEventListener('seeked', resolve, { once: true }); video.currentTime = sample.time;
            });
            const x = i % 3 * 200, y = Math.floor(i / 3) * 374;
            ctx.drawImage(video, x, y, 200, 354);
            let f = 0;
            for (let j = 1; j < t.length; j++) if (Math.abs(t[j] - sample.time) < Math.abs(t[f] - sample.time)) f = j;
            ctx.strokeStyle = '#fbd34d'; ctx.lineWidth = 1;
            for (const box of [sample.head, sample.torso]) ctx.strokeRect(x + box[0] * 200, y + box[1] * 354, (box[2] - box[0]) * 200, (box[3] - box[1]) * 354);
            for (let j = 0; j < K; j++) if (vis[f * K + j] >= 0.5) {
                ctx.fillStyle = '#00f5d4'; ctx.beginPath();
                ctx.arc(x + xy[(f * K + j) * 2] * 200, y + xy[(f * K + j) * 2 + 1] * 354, 2, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = '#ffffff'; ctx.font = '12px sans-serif'; ctx.fillText(`${sample.time}s · source pose ${t[f].toFixed(3)}s`, x + 4, y + 369);
        }
        return sheet.toDataURL('image/png').split(',')[1];
    }, { record, review: treadmillReview });
    await testInfo.attach('treadmill-video-and-raw-pose-review', { body: Buffer.from(encoded, 'base64'), contentType: 'image/png' });
}

async function open(page, errors) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) errors.push(`Unexpected write request: ${request.url()}`);
    });
    await page.goto('/e-labs/stride-lab/');
    await expect(page.locator('#sl-demo')).toBeEnabled();
    await page.exposeFunction('testProgress', text => console.log(text));
    await page.evaluate(() => {
        let last = performance.now();
        new MutationObserver(() => {
            if (performance.now() - last > 15000) {
                last = performance.now();
                window.testProgress(document.getElementById('sl-progress-text').textContent);
            }
        }).observe(document.getElementById('sl-progress-text'), { childList: true, characterData: true, subtree: true });
    });
}

async function runDemo(page, id) {
    await page.selectOption('#sl-demo-pick', id);
    await page.click('#sl-demo');
    await page.waitForFunction(() => !document.getElementById('sl-stage-player').hidden || !document.getElementById('sl-stage-error').hidden, undefined, { timeout: 240000 });
    await expect(page.locator('#sl-stage-player')).toBeVisible();
    await expect(page.locator('#sl-stage-error')).toBeHidden();
}

async function saved(page) {
    return page.evaluate(async () => {
        const store = await import('/e-labs/stride-lab/src/ui/store.js');
        return (await store.listAnalyses())[0];
    });
}

async function seek(page, value) {
    await page.locator('#sl-scrub').evaluate((el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

async function expectScoresAtPlayhead(page) {
    const scores = await page.evaluate(async () => {
        const { movementAt } = await import('/e-labs/stride-lab/src/engine/scoring/movement.js');
        const store = await import('/e-labs/stride-lab/src/ui/store.js');
        const record = (await store.listAnalyses())[0];
        const time = Number(document.getElementById('sl-overlay').dataset.mediaTime);
        const expected = movementAt(record, time);
        return ['stride', 'cadence'].map(id => ({ id, expected: expected[id] == null ? '—' : String(Math.round(expected[id] * 100)),
            actual: document.getElementById(`sl-live-${id}`).textContent }));
    });
    for (const score of scores) expect(score.actual, `${score.id} score at the displayed frame`).toBe(score.expected);
}

async function pausedPaintRecovery(page) {
    const before = await page.locator('#sl-overlay').evaluate(canvas => ({
        errors: Number(canvas.dataset.renderErrors || 0), frame: canvas.dataset.frame
    }));
    await page.evaluate(() => {
        const original = CanvasRenderingContext2D.prototype.stroke;
        window.restorePausedStroke = () => { CanvasRenderingContext2D.prototype.stroke = original; };
        let armed = true;
        CanvasRenderingContext2D.prototype.stroke = function (...args) {
            if (armed && this.canvas.id === 'sl-overlay') { armed = false; throw new Error('Injected paused UI paint failure'); }
            return original.apply(this, args);
        };
        window.dispatchEvent(new Event('resize'));
    });
    try {
        await expect.poll(() => page.locator('#sl-overlay').getAttribute('data-render-errors')).toBe(String(before.errors + 1));
        await expect.poll(() => page.locator('#sl-overlay').evaluate(canvas => {
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            return pixels.some((value, index) => index % 4 === 3 && value > 0);
        })).toBe(true);
        await expect(page.locator('#sl-overlay')).toHaveAttribute('data-frame', before.frame);
    } finally {
        await page.evaluate(() => { window.restorePausedStroke(); delete window.restorePausedStroke; });
    }
}

async function exerciseRates(page, testInfo) {
    for (const rate of ['0.5', '1']) {
        await seek(page, 250);
        await expect.poll(() => page.locator('#sl-video').evaluate(video => video.seeking)).toBe(false);
        await page.selectOption('#sl-rate', rate);
        const samples = await page.evaluate(async () => {
            const video = document.getElementById('sl-video'), overlay = document.getElementById('sl-overlay');
            const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
            let buffers = 0;
            Object.defineProperty(overlay, 'width', { configurable: true,
                get() { return width.get.call(this); },
                set(value) { buffers++; width.set.call(this, value); }
            });
            const rows = [], start = performance.now();
            await video.play();
            await new Promise(resolve => {
                function sample(now) {
                    rows.push({ wall: now - start, video: video.currentTime, overlay: Number(overlay.dataset.mediaTime),
                        frame: Number(overlay.dataset.frame), errors: Number(overlay.dataset.renderErrors), buffers });
                    if (now - start >= 1800) { video.pause(); delete overlay.width; resolve(); }
                    else requestAnimationFrame(sample);
                }
                requestAnimationFrame(sample);
            });
            return rows;
        });
        await testInfo.attach(`playback-${rate}`, { body: JSON.stringify(samples), contentType: 'application/json' });
        expect(new Set(samples.map(row => row.frame)).size).toBeGreaterThan(10);
        expect(samples.at(-1).video - samples[0].video).toBeGreaterThan(Number(rate) * 1.3);
        expect(Math.max(...samples.map(row => Math.abs(row.video - row.overlay)))).toBeLessThan(0.2);
        expect(samples.every(row => row.errors === 0)).toBe(true);
        expect(samples.at(-1).buffers, 'stable playback must reuse the canvas buffer').toBeLessThanOrEqual(1);
        let changedAt = samples[0].wall, maxHold = 0, previous = samples[0].frame;
        for (const row of samples) {
            if (row.frame !== previous) { maxHold = Math.max(maxHold, row.wall - changedAt); changedAt = row.wall; previous = row.frame; }
        }
        maxHold = Math.max(maxHold, samples.at(-1).wall - changedAt);
        expect(maxHold).toBeLessThan(350);
        await expectScoresAtPlayhead(page);
    }
}

async function inspectLayouts(page, testInfo, prefix) {
    for (const theme of ['dark', 'light']) for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.dispatchEvent(new Event('resize')); }, theme);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect.poll(() => page.evaluate(() => {
            const rect = document.getElementById('sl-player').getBoundingClientRect();
            return Math.abs(document.getElementById('sl-overlay').width - rect.width * Math.min(devicePixelRatio, 2.5));
        })).toBeLessThan(1);
        await expect(page.locator('#sl-live-stride')).toBeVisible();
        await expect(page.locator('#sl-live-cadence')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        expect(overflow, `${prefix} ${theme} ${width}px horizontal overflow`).toBe(false);
        if (prefix === 'treadmill') {
            const alignment = await page.evaluate(async () => {
                const { contain } = await import('/e-labs/stride-lab/src/ui/overlay.js');
                const host = document.getElementById('sl-player').getBoundingClientRect();
                const video = document.getElementById('sl-video'), rect = video.getBoundingClientRect();
                const expected = contain(video.videoWidth, video.videoHeight, host.width, host.height);
                return Math.max(Math.abs(rect.left - host.left - expected.x), Math.abs(rect.top - host.top - expected.y),
                    Math.abs(rect.width - expected.w), Math.abs(rect.height - expected.h));
            });
            expect(alignment, `${prefix} video/overlay geometry at ${width}px`).toBeLessThan(1);
        }
        const path = testInfo.outputPath(`${prefix}-${theme}-${width}.png`);
        await page.locator('.sl-workspace').screenshot({ path, animations: 'disabled' });
        await testInfo.attach(`${prefix}-${theme}-${width}`, { path, contentType: 'image/png' });
    }
}

test('synthetic runner: scores, seeking, responsive themes and saved result', async ({ page }, testInfo) => {
    const errors = [];
    await open(page, errors);
    // Stabilize the demo's generated seed without replacing the analysis path.
    await page.evaluate(() => { Date.now = () => 1725148800014; });
    await runDemo(page, 'synthetic');
    await seek(page, 650);
    await expect(page.locator('#sl-live-cadence')).toHaveText(/^\d+$/);
    await expect(page.locator('#sl-live-stride')).toHaveText(/^\d+$/);
    const score = await page.locator('#sl-live-cadence').textContent();
    await seek(page, 0);
    await expect(page.locator('#sl-live-cadence')).toHaveText('—');
    await seek(page, 650);
    await expect(page.locator('#sl-live-cadence')).toHaveText(score);
    await expectScoresAtPlayhead(page);
    await inspectLayouts(page, testInfo, 'synthetic');
    expect((await saved(page)).movementSamples.length).toBeGreaterThan(0);
    await pausedPaintRecovery(page);
    expect(errors).toEqual([]);
});

test('synthetic runner suppresses transient leg jumps without altering saved observations', async ({ page }) => {
    const errors = []; await open(page, errors);
    await page.evaluate(() => { Date.now = () => 1725148800014; });
    await runDemo(page, 'synthetic');
    const record = await saved(page), k = record.keypoints;
    for (const key of ['t', 'xy', 'vis']) k[key] = Float64Array.from(Object.values(k[key]));
    const start = Math.floor(k.n * 0.4), count = Math.max(2, Math.round(0.06 / (k.t[1] - k.t[0])));
    rotateLeg(k, start, count);
    // This regression supplies known bracketing observations; random demo
    // dropout is tested separately and must not invalidate the planted return.
    for (let f = start - 1; f <= start + count; f++) for (const name of ['hipL', 'kneeL', 'ankleL', 'heelL', 'toeL']) {
        k.vis[f * k.names.length + k.names.indexOf(name)] = 1;
    }
    await page.evaluate(async record => {
        for (const key of ['t', 'xy', 'vis']) record.keypoints[key] = Float64Array.from(Object.values(record.keypoints[key]));
        const store = await import('/e-labs/stride-lab/src/ui/store.js'); await store.saveAnalysis(record);
    }, record);
    await page.reload(); // discard the app's pre-mutation history cache
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.locator('.sl-histrow').first().getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('#sl-stage-player')).toBeVisible();
    await seek(page, Math.round((start + Math.floor(count / 2)) / (k.n - 1) * 1000));
    await expect.poll(() => page.locator('#sl-overlay').evaluate(c => Number(c.dataset.poseMasked))).toBeGreaterThanOrEqual(4);
    const drawn = await page.evaluate(async record => {
        const original = CanvasRenderingContext2D.prototype.arc, arcs = [];
        CanvasRenderingContext2D.prototype.arc = function (...args) {
            if (this.canvas.id === 'sl-overlay') arcs.push(args.slice(0, 2)); return original.apply(this, args);
        };
        try {
            window.dispatchEvent(new Event('resize'));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const { contain } = await import('/e-labs/stride-lab/src/ui/overlay.js');
            const canvas = document.getElementById('sl-overlay'), host = document.getElementById('sl-player').getBoundingClientRect();
            const k = record.keypoints, xy = Object.values(k.xy), f = Number(canvas.dataset.frame), c = k.names.indexOf('ankleL');
            const box = contain(k.width, k.height, host.width, host.height);
            const target = [xy[(f * k.names.length + c) * 2] * box.w, xy[(f * k.names.length + c) * 2 + 1] * box.h];
            return { count: arcs.length, targetDrawn: arcs.some(p => Math.hypot(p[0] - target[0], p[1] - target[1]) < 0.25) };
        } finally { CanvasRenderingContext2D.prototype.arc = original; }
    }, record);
    expect(drawn.count).toBeGreaterThan(0); expect(drawn.targetDrawn).toBe(false);
    const persisted = await saved(page);
    expect(Object.values(persisted.keypoints.vis)).toEqual(Array.from(k.vis));
    expect(Object.values(persisted.keypoints.xy)).toEqual(Array.from(k.xy));
    expect(errors).toEqual([]);
});

for (const delegate of ['GPU', 'CPU']) test(`real treadmill ${delegate}: production inference, playback and honest confidence gates`, async ({ page }, testInfo) => {
    const errors = [];
    await open(page, errors);
    await page.locator('#sl-step-advanced').evaluate(details => { details.open = true; });
    if (delegate === 'CPU') await page.uncheck('#sl-gpu');
    await page.check('#sl-keepvideo');
    await runDemo(page, 'treadmill');
    await expect.poll(async () => !!(await saved(page))).toBeTruthy();
    const record = await saved(page);
    await testInfo.attach('treadmill-result', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
    const audit = auditTreadmill(record, treadmillReview);
    await testInfo.attach('treadmill-independent-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
    await treadmillEvidence(page, record, testInfo);
    const reliability = await page.evaluate(async record => {
        const { playbackReliability } = await import('/e-labs/stride-lab/src/ui/pose-reliability.js');
        const k = record.keypoints;
        for (const name of ['t', 'xy', 'vis']) k[name] = Float64Array.from(Object.values(k[name]));
        const r = playbackReliability(k);
        return { counts: ['L', 'R'].map(s => r.sides[s].reduce((sum, v) => sum + v, 0)),
            first: Array.from({ length: k.n }, (_, f) => f).find(f => r.sides.L[f] || r.sides.R[f]) ?? -1 };
    }, record);
    await testInfo.attach('treadmill-playback-reliability', { body: JSON.stringify(reliability), contentType: 'application/json' });
    for (const count of reliability.counts) expect(count, 'confidence guard must not discard most of a leg track').toBeLessThan(record.keypoints.n * 0.2);
    if (reliability.first >= 0) {
        await seek(page, Math.round(reliability.first / (record.keypoints.n - 1) * 1000));
        await expect.poll(() => page.locator('#sl-video').evaluate(v => v.seeking)).toBe(false);
        await expect.poll(() => page.locator('#sl-overlay').evaluate(c => Number(c.dataset.poseMasked))).toBeGreaterThan(0);
    }
    expect(record.engine.backend).not.toBe('synthetic');
    expect(record.engine.poseWorker, 'the supported browser must run inference off the UI thread').toBe(true);
    const timing = record.engine.processing;
    expect(timing.frames).toBe(record.capture.sourceFrameCount);
    for (const key of ['modelMs', 'decodeAndPoseMs', 'prepareMs', 'inferMs', 'analysisMs', 'totalMs']) {
        expect(Number.isFinite(timing[key]), key).toBe(true);
        expect(timing[key], key).toBeGreaterThanOrEqual(0);
    }
    expect(timing.totalMs).toBeGreaterThanOrEqual(timing.modelMs + timing.decodeAndPoseMs + timing.analysisMs);
    if (delegate === 'CPU') expect(record.engine.delegate).toBe('CPU');
    expect(record.capture.fps).toBeGreaterThan(29);
    expect(record.capture.fps).toBeLessThan(31);
    expect(record.metrics.gct.sides.L.value).toBeNull();
    expect(record.metrics.gct.sides.R.value).toBeNull();
    expect(record.capture.resolution[1]).toBeGreaterThan(record.capture.resolution[0]);
    expect(record.metrics.cadence.combined.value).toBeGreaterThan(170);
    expect(record.metrics.cadence.combined.value).toBeLessThan(200);
    // This occluded fixture supplies different numbers of accepted cycles on
    // heavy/full and CPU/GPU. Validate the evidence rather than a cycle quota.
    expect(record.movementSamples.length).toBeGreaterThan(0);
    for (const sample of record.movementSamples) {
        expect(sample.end).toBeGreaterThan(sample.start);
        expect(['L', 'R']).toContain(sample.side);
    }
    expect(record.metrics.cadence.combined.confidence).toBe('low');
    const withheld = await page.evaluate(async record => {
        const { movementAt } = await import('/e-labs/stride-lab/src/engine/scoring/movement.js');
        return Array.from({ length: 121 }, (_, i) => movementAt(record, i / 10))
            .every(score => score.stride === null && score.cadence === null);
    }, record);
    expect(withheld, 'occluded treadmill footage must not produce confident scores').toBe(true);
    await exerciseRates(page, testInfo);
    await seek(page, 650);
    await page.locator('#sl-video').evaluate(video => new Promise(resolve => { if (!video.seeking) resolve(); else video.addEventListener('seeked', resolve, { once: true }); }));
    await page.selectOption('#sl-rate', '1');
    const before = await page.locator('#sl-video').evaluate(video => video.currentTime);
    await page.click('#sl-play');
    await expect.poll(() => page.locator('#sl-video').evaluate(video => video.currentTime)).toBeGreaterThan(before + 0.3);
    await page.click('#sl-play');
    for (const pane of ['mechanics', 'metrics', 'cycle', 'strides', 'findings']) {
        await page.locator(`.sl-dtab[data-pane="${pane}"]`).click();
        await expect(page.locator(`#sl-pane-${pane}`)).toBeVisible();
    }
    const downloadReady = page.waitForEvent('download');
    await page.click('#sl-ex-csv');
    const download = await downloadReady;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain('"cadence"');
    expect(csv).not.toMatch(/NaN|undefined|Infinity/);
    await inspectLayouts(page, testInfo, 'treadmill');
    await page.reload();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.locator('.sl-histrow').first().getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('#sl-stage-player')).toBeVisible();
    await seek(page, 650);
    await expect(page.locator('#sl-video')).toBeVisible();
    await exerciseRates(page, testInfo);
    // A second reopen retires the former clock instead of retaining two owners.
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.locator('.sl-histrow').first().getByRole('button', { name: 'Open', exact: true }).click();
    await exerciseRates(page, testInfo);
    await seek(page, 985);
    await page.locator('#sl-video').evaluate(video => video.play());
    await expect.poll(() => page.locator('#sl-video').evaluate(video => video.paused)).toBe(true);
    const end = record.keypoints.t[0] + record.capture.durationMs / 1000;
    expect(await page.locator('#sl-video').evaluate(video => video.currentTime)).toBeCloseTo(end, 2);
    await page.click('#sl-play');
    await expect.poll(() => page.locator('#sl-video').evaluate(video => video.currentTime)).toBeLessThan(end - 1);
    await page.locator('#sl-video').evaluate(video => video.pause());
    await seek(page, 250);
    await expect.poll(() => page.locator('#sl-video').evaluate(video => video.seeking)).toBe(false);
    const beforeFault = await page.evaluate(() => {
        const original = CanvasRenderingContext2D.prototype.stroke;
        let armed = true;
        window.restoreStrideStroke = () => { CanvasRenderingContext2D.prototype.stroke = original; };
        CanvasRenderingContext2D.prototype.stroke = function (...args) {
            if (armed && this.canvas.id === 'sl-overlay') { armed = false; throw new Error('Injected overlay paint failure'); }
            return original.apply(this, args);
        };
        return Number(document.getElementById('sl-overlay').dataset.frame);
    });
    try {
        await page.locator('#sl-video').evaluate(video => video.play());
        await expect.poll(() => page.locator('#sl-overlay').getAttribute('data-render-errors')).toBe('1');
        await expect.poll(() => page.locator('#sl-overlay').evaluate(canvas => Number(canvas.dataset.frame))).toBeGreaterThan(beforeFault + 4);
    } finally {
        await page.evaluate(() => { window.restoreStrideStroke(); delete window.restoreStrideStroke; document.getElementById('sl-video').pause(); });
    }
    await page.waitForTimeout(100); // allow the final presented frame to settle after pause
    await pausedPaintRecovery(page);
    expect(errors).toEqual([]);
});

test('real-video clock recovers from starved callbacks and an injected draw error', async ({ page }) => {
    const errors = [];
    await open(page, errors);
    const observed = await page.evaluate(async () => {
        const { createPlaybackClock } = await import('/e-labs/stride-lab/src/ui/playback.js');
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.width = 240;
        document.body.appendChild(video);
        video.src = '/e-labs/stride-lab/demo/treadmill-30fps.mp4';
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
        video.currentTime = 0.5;
        await new Promise(resolve => { video.onseeked = resolve; });
        video.requestVideoFrameCallback = () => 77; video.cancelVideoFrameCallback = () => {};
        const frames = []; let failures = 0;
        const clock = createPlaybackClock(video, { start: 0.5, end: 2,
            onFrame(time) { if (frames.length === 0) { frames.push(time); throw new Error('injected draw'); } frames.push(time); },
            onError() { failures++; }
        });
        await video.play();
        await new Promise(resolve => { const check = () => video.paused ? resolve() : requestAnimationFrame(check); requestAnimationFrame(check); });
        clock.dispose(); video.remove();
        return { frames, failures, ended: video.currentTime };
    });
    expect(observed.failures).toBe(1);
    expect(observed.frames.length).toBeGreaterThan(15);
    expect(observed.ended).toBeCloseTo(2, 2);
    expect(errors).toEqual([]);
});

test('treadmill playback decoder: backpressure, orientation, cancellation and consumer errors', async ({ page }, testInfo) => {
    const errors = [];
    await open(page, errors);
    const result = await page.evaluate(async () => {
        const { extractFrames, probe, orientFrame } = await import('/e-labs/stride-lab/src/engine/decode/frames.js');
        const blob = await (await fetch('/e-labs/stride-lab/demo/treadmill-30fps.mp4')).blob();
        const file = new File([blob], 'treadmill.mp4', { type: 'video/mp4' });
        const fingerprint = image => {
            const canvas = new OffscreenCanvas(16, 16), ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, 16, 16);
            return Array.from(ctx.getImageData(0, 0, 16, 16).data);
        };
        const info = await probe(file);
        if (info.path !== 'webcodecs') throw new Error('This decoder comparison requires the independent WebCodecs reference.');
        let reference;
        await extractFrames(file, { probe: info, startS: 0.5, endS: 0.5, maxFrames: 1,
            onFrame: async frame => {
                const bitmap = await orientFrame(frame.image, info.rotationDeg, info.mirrored, 480, 848);
                reference = fingerprint(bitmap); bitmap.close();
            } });
        let copied;
        const times = [], dimensions = [];
        const decoded = await extractFrames(file, { probe: { path: 'video-element' }, startS: 0.5, endS: 2.5,
            onFrame: async frame => {
                times.push(frame.timestampUs / 1e6);
                dimensions.push([frame.image.width, frame.image.height]);
                if (!copied) copied = fingerprint(frame.image);
                await new Promise(resolve => setTimeout(resolve, 45));
            }
        });
        let count = 0;
        const canceled = await extractFrames(file, { probe: { path: 'video-element' }, startS: 0.5, endS: 2.5,
            canceled: () => count >= 3, onFrame: () => { count++; } });
        let consumerError = null;
        try {
            await extractFrames(file, { probe: { path: 'video-element' }, startS: 0.5, endS: 2.5,
                onFrame: () => { throw new Error('Injected consumer failure'); } });
        } catch (error) { consumerError = error.message; }
        const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
        const pixelDifference = reference.reduce((sum, value, i) => sum + Math.abs(value - copied[i]), 0) / reference.length;
        return { decoded, times, dimensions, canceled, consumerError, pixelDifference, medianGap: gaps[gaps.length >> 1] };
    });
    await testInfo.attach('playback-decoder', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(result.times.length).toBeGreaterThan(45);
    expect(result.medianGap).toBeCloseTo(1 / 30, 3);
    expect(result.dimensions.every(([w, h]) => w === 480 && h === 848)).toBe(true);
    expect(result.pixelDifference).toBeLessThan(12);
    expect(result.times.every((t, i) => i === 0 || t > result.times[i - 1])).toBe(true);
    expect(result.canceled.frames).toBe(3);
    expect(result.consumerError).toBe('Injected consumer failure');
    expect(errors).toEqual([]);
});

test('playback decoder reuses orientation surfaces without changing pixels or bitmap ownership', async ({ page }, testInfo) => {
    const errors = [];
    await open(page, errors);
    const result = await page.evaluate(async () => {
        const { orientFrame, createFrameOrienter } = await import('/e-labs/stride-lab/src/engine/decode/frames.js');
        const source = document.createElement('canvas'); source.width = 96; source.height = 64;
        const ctx = source.getContext('2d');
        const paint = color => { ctx.clearRect(0, 0, 96, 64); ctx.fillStyle = color; ctx.fillRect(0, 0, 48, 32); };
        const read = image => {
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            return Array.from(context.getImageData(0, 0, image.width, image.height).data);
        };
        const NativeCanvas = window.OffscreenCanvas;
        const checks = [], allocations = [];
        try {
            for (const fallback of [false, true]) {
                let surfaces = 0;
                window.OffscreenCanvas = fallback ? undefined : class extends NativeCanvas {
                    constructor(...args) { super(...args); surfaces++; }
                };
                const orient = createFrameOrienter();
                paint('red');
                const retained = await orient(source, 90, false, 64, 96), original = read(retained);
                for (const rotation of [0, 90, 180, 270]) for (const mirrored of [false, true]) for (const half of [false, true]) {
                    paint(mirrored ? 'blue' : 'green');
                    const swap = rotation % 180 !== 0, w = (swap ? 64 : 96) / (half ? 2 : 1), h = (swap ? 96 : 64) / (half ? 2 : 1);
                    const reused = await orient(source, rotation, mirrored, w, h);
                    const before = surfaces;
                    const fresh = await orientFrame(source, rotation, mirrored, w, h);
                    surfaces = before; // count only this run's reusable surface
                    checks.push(JSON.stringify(read(reused)) === JSON.stringify(read(fresh)));
                    reused.close(); fresh.close();
                }
                checks.push(JSON.stringify(read(retained)) === JSON.stringify(original));
                retained.close();
                if (!fallback) allocations.push(surfaces);
            }
        } finally { window.OffscreenCanvas = NativeCanvas; }
        const timings = {};
        source.width = 480; source.height = 848;
        for (const [name, orient] of [['fresh', orientFrame], ['reused', createFrameOrienter()]]) {
            for (let i = 0; i < 10; i++) (await orient(source, 90, false, 848, 480)).close();
            const start = performance.now();
            for (let i = 0; i < 120; i++) (await orient(source, 90, false, 848, 480)).close();
            timings[name] = performance.now() - start;
        }
        return { checks, allocations, timings };
    });
    await testInfo.attach('orientation-performance', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.checks.every(Boolean)).toBe(true);
    expect(result.allocations).toEqual([1]);
    expect(errors).toEqual([]);
});

test('inference worker startup cancellation terminates without main-thread fallback', async ({ page }) => {
    const errors = [];
    await open(page, errors);
    const result = await page.evaluate(async () => {
        const { analyzeFile } = await import('/e-labs/stride-lab/src/ui/pipeline.js');
        const NativeWorker = window.Worker;
        const blob = await (await fetch('/e-labs/stride-lab/demo/treadmill-30fps.mp4')).blob();
        let canceled = false, terminated = false, modelRequests = 0;
        const nativeFetch = window.fetch;
        window.fetch = (...args) => { if (/mediapipe|\.task/.test(String(args[0]))) modelRequests++; return nativeFetch(...args); };
        window.Worker = class {
            postMessage() { setTimeout(() => { canceled = true; }, 50); }
            terminate() { terminated = true; }
        };
        try {
            const start = performance.now();
            const output = await analyzeFile(new File([blob], 'treadmill.mp4', { type: 'video/mp4' }), {
                heightM: 1.7, surface: 'treadmill', view: 'sagittal', canceled: () => canceled
            });
            return { output, terminated, modelRequests, elapsed: performance.now() - start };
        } finally { window.Worker = NativeWorker; window.fetch = nativeFetch; }
    });
    expect(result.output).toEqual({ canceled: true });
    expect(result.terminated).toBe(true);
    expect(result.modelRequests).toBe(0);
    expect(result.elapsed).toBeLessThan(5000);
    await runDemo(page, 'synthetic');
    expect(errors).toEqual([]);
});

test('inference worker failure terminates cleanly and permits another analysis', async ({ page }) => {
    await page.addInitScript(() => {
        window.Worker = class {
            postMessage(message) {
                if (message.t === 'init') queueMicrotask(() => this.onmessage?.({ data: { t: 'ready', backend: 'fault-injection', delegate: 'CPU', variant: 'heavy' } }));
                else if (message.t === 'frame') {
                    message.image.close();
                    queueMicrotask(() => this.onmessage?.({ data: { t: 'error', message: 'Injected inference failure' } }));
                }
            }
            terminate() { window.testWorkerTerminated = true; }
        };
    });
    const errors = [];
    await open(page, errors);
    await page.selectOption('#sl-demo-pick', 'treadmill');
    await page.click('#sl-demo');
    await expect(page.locator('#sl-stage-error')).toBeVisible();
    await expect(page.locator('#sl-stage-error')).toContainText('Injected inference failure');
    await expect(page.locator('#sl-demo')).toBeEnabled();
    expect(await page.evaluate(() => window.testWorkerTerminated)).toBe(true);
    await runDemo(page, 'synthetic');
    await expect(page.locator('#sl-stage-player')).toBeVisible();
    expect(errors).toEqual([]);
});
