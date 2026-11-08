import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
    await inspectLayouts(page, testInfo, 'synthetic');
    expect((await saved(page)).movementSamples.length).toBeGreaterThan(0);
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
    expect(record.engine.backend).not.toBe('synthetic');
    if (delegate === 'CPU') expect(record.engine.delegate).toBe('CPU');
    expect(record.capture.fps).toBeGreaterThan(29);
    expect(record.capture.fps).toBeLessThan(31);
    expect(record.metrics.gct.sides.L.value).toBeNull();
    expect(record.metrics.gct.sides.R.value).toBeNull();
    expect(record.capture.resolution[1]).toBeGreaterThan(record.capture.resolution[0]);
    expect(record.metrics.cadence.combined.value).toBeGreaterThan(170);
    expect(record.metrics.cadence.combined.value).toBeLessThan(200);
    expect(record.movementSamples.length).toBeGreaterThan(2);
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
