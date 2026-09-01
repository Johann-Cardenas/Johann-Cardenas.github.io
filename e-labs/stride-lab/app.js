/* ============================================================
   Stride Lab — DOM controller.

   One controller, deliberately. The engine under src/engine is pure
   and testable; this file is the impure half — the DOM, the files,
   the workers — and keeping the boundary in one place is what makes
   the other half worth having.
   ============================================================ */

import { analyseFile, STAGES } from './src/ui/pipeline.js';
import { runPipeline, gaitCycleCurves } from './src/engine/analyze.js';
import { synthGait } from './src/synth/gait.js';
import { METRICS, METRIC_BY_ID, DIMENSIONS } from './src/engine/metrics/catalog.js';
import { REFERENCE_BY_ID } from './src/engine/scoring/references.js';
import { bandFor } from './src/engine/scoring/norms.js';
import { EXERCISE_BY_ID } from './src/engine/recommend/exercises.js';
import { CANONICAL, ASYMMETRY_ATTENTION, ASYMMETRY_NOTABLE } from './src/engine/types.js';
import { APP_VERSION } from './src/engine/version.js';
import * as store from './src/ui/store.js';
import { drawOverlay, anglesFor, fitCanvas, contain } from './src/ui/overlay.js';
import { drawGaitCycle, drawRangeBar, drawSparkline, drawStrideDots, drawScoreBar, themeFrom } from './src/ui/charts.js';
import {
    fmt, fmtWithCi, fmtUnit, fmtBytes, fmtDateTime, convert, cmToFeetInches, heightToCm,
    paceFromSpeed, announce, errorFor, CONFIDENCE_COPY, STATUS_GLYPH, STATUS_COPY
} from './src/ui/format.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

const S = {
    file: null,
    videoUrl: null,
    result: null,
    demo: null,
    units: 'metric',
    trim: { start: 0, end: 0, duration: 0 },
    playing: false,
    cancelled: false,
    running: false,
    recorder: null,
    history: [],
    compareIds: []
};

/* ============================================================
   Boot
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
    wireTopbar();
    wireProfile();
    wireCapture();
    wirePlayer();
    wireDock();
    wireSheet();
    wireExports();
    drawEmptyArt();

    const p = await store.activeProfile().catch(() => null);
    if (p) applyProfile(p);
    S.units = await store.getSetting('units', 'metric');
    $('sl-units').value = S.units;
    applyUnits();
    refreshStorage();
    await refreshHistory();
    renderStages(null);

    /* A shared link carries its payload after the '#', which is never sent to
       any server. Read it if there is one. */
    if (location.hash.startsWith('#s=')) {
        try {
            const summary = await store.readShareCode(location.hash.slice(3));
            renderSharedSummary(summary);
        } catch { /* an unreadable code is not worth an error dialog */ }
    }

    registerServiceWorker();
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    /* Not on a local dev server. A worker that serves the shell from cache is
       exactly right in production and exactly wrong while editing the files it
       cached: every reload would show the previous save. */
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    navigator.serviceWorker.register('sw.js', { scope: './' })
        .catch(() => { /* offline is a bonus, not a requirement */ });
}

/* ============================================================
   Top bar, profile, units
   ============================================================ */

function wireTopbar() {
    $('sl-units').addEventListener('change', async (e) => {
        S.units = e.target.value;
        await store.setSetting('units', S.units);
        applyUnits();
        if (S.result) renderResult(S.result);
    });
    $('sl-run').addEventListener('click', () => startAnalysis());
    $('sl-demo').addEventListener('click', runDemo);
    $('sl-demo2').addEventListener('click', runDemo);
    $('sl-save').addEventListener('click', exportBundle);
    $('sl-open').addEventListener('click', () => $('sl-import-file').click());
    $('sl-import-file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            const r = await store.importBundle(f);
            toast(`Imported ${r.imported} analysis${r.imported === 1 ? '' : 'es'}.`);
            await refreshHistory();
        } catch (err) {
            toast(`That file could not be read. ${err.message}`);
        }
        e.target.value = '';
    });
}

function applyUnits() {
    const imperial = S.units === 'imperial';
    $('sl-height-metric').hidden = imperial;
    $('sl-height-imperial').hidden = !imperial;
    $('sl-mass-unit').textContent = imperial ? 'lb' : 'kg';
    $('sl-speed-unit').textContent = imperial ? 'mph' : 'm/s';
}

function wireProfile() {
    for (const id of ['sl-height-cm', 'sl-height-ft', 'sl-height-in', 'sl-mass', 'sl-sex', 'sl-speed', 'sl-surface', 'sl-view']) {
        $(id).addEventListener('change', () => { saveProfile(); updateRunEnabled(); });
    }
    $('sl-surface').addEventListener('change', () => {
        const treadmill = $('sl-surface').value === 'treadmill';
        $('sl-speed-field').style.opacity = treadmill ? '1' : '0.65';
        $('sl-speed-help').textContent = treadmill
            ? 'On a treadmill you do not move through the frame, so there is no displacement to measure. Without the belt speed there is no step length, no running speed, and no way to pick the right cadence band — a cadence target that ignores speed is folklore.'
            : 'Overground, speed and step length are measured from how far you travel between foot strikes, so this field is optional. Enter it if you know it and it will be used as a cross-check.';
    });
}

function applyProfile(p) {
    if (p.heightCm) {
        $('sl-height-cm').value = Math.round(p.heightCm);
        const fi = cmToFeetInches(p.heightCm);
        $('sl-height-ft').value = fi.feet;
        $('sl-height-in').value = fi.inches;
    }
    if (p.massKg) $('sl-mass').value = S.units === 'imperial' ? Math.round(p.massKg * 2.20462) : Math.round(p.massKg);
    if (p.sex) $('sl-sex').value = p.sex;
    S.profileId = p.id;
}

function heightCm() {
    if (S.units === 'imperial') return heightToCm($('sl-height-ft').value || 0, $('sl-height-in').value || 0);
    return Number($('sl-height-cm').value) || 0;
}

/** Body mass in kg, or null. Required for the spring-mass stiffness model. */
function massKg() {
    const raw = Number($('sl-mass').value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return S.units === 'imperial' ? raw / 2.20462 : raw;
}

function speedMs() {
    const raw = Number($('sl-speed').value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return S.units === 'imperial' ? raw / 2.23694 : raw;
}

async function saveProfile() {
    const massRaw = Number($('sl-mass').value);
    const p = await store.saveProfile({
        id: S.profileId,
        heightCm: heightCm(),
        massKg: Number.isFinite(massRaw) && massRaw > 0 ? (S.units === 'imperial' ? massRaw / 2.20462 : massRaw) : null,
        sex: $('sl-sex').value,
        units: S.units,
        createdAt: Date.now()
    });
    S.profileId = p.id;
}

function updateRunEnabled() {
    const h = heightCm();
    $('sl-run').disabled = S.running || !S.file || !(h >= 120 && h <= 220);
}

/* ============================================================
   Capture
   ============================================================ */

function wireCapture() {
    const drop = $('sl-drop');
    $('sl-pick').addEventListener('click', () => $('sl-file').click());
    $('sl-pick2').addEventListener('click', () => $('sl-file').click());
    $('sl-file').addEventListener('change', (e) => { if (e.target.files[0]) acceptFile(e.target.files[0]); });
    $('sl-clearfile').addEventListener('click', clearFile);
    $('sl-record').addEventListener('click', startCamera);
    $('sl-cam-cancel').addEventListener('click', stopCamera);
    $('sl-cam-shoot').addEventListener('click', toggleRecording);

    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, (e) => {
        e.preventDefault(); drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, (e) => {
        e.preventDefault(); drop.classList.remove('is-over');
    }));
    drop.addEventListener('drop', (e) => {
        const f = e.dataTransfer.files[0];
        if (f) acceptFile(f);
    });

    $('sl-trim-start').addEventListener('input', onTrim);
    $('sl-trim-end').addEventListener('input', onTrim);
}

async function acceptFile(file) {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
        toast('That does not look like a video. MP4 or MOV from a phone camera works best.');
        return;
    }
    clearFile(true);
    S.file = file;
    S.videoUrl = URL.createObjectURL(file);
    $('sl-filename').textContent = `${file.name} · ${fmtBytes(file.size)}`;
    $('sl-filecard').hidden = false;
    $('sl-drop').hidden = true;
    await preflight(file);
    showTrim();
    updateRunEnabled();
}

function clearFile(silent) {
    if (S.videoUrl) URL.revokeObjectURL(S.videoUrl);
    S.file = null; S.videoUrl = null;
    $('sl-filecard').hidden = true;
    $('sl-drop').hidden = false;
    $('sl-checks').innerHTML = '';
    if (!silent) { showStage('empty'); updateRunEnabled(); }
}

/**
 * Pre-flight. Everything checkable before spending compute is checked before
 * spending compute, and the failures that matter are stated in terms of what
 * to do rather than what went wrong.
 */
async function preflight(file) {
    const list = $('sl-checks');
    list.innerHTML = '';
    const add = (cls, text) => { const li = el('li', cls, text); list.appendChild(li); };

    const v = document.createElement('video');
    v.src = S.videoUrl; v.muted = true; v.preload = 'metadata';
    await new Promise(res => { v.onloadedmetadata = res; v.onerror = res; });

    const dur = v.duration || 0;
    /* videoWidth/videoHeight are the DISPLAY dimensions: the element applies the
       rotation the container asks for. The probe below reports the coded size,
       and the two disagreeing is exactly what a portrait recording looks like. */
    let w = v.videoWidth, h = v.videoHeight;
    S.trim.duration = dur;

    if (dur < 2) add('bad', `${dur.toFixed(1)} s is too short. Record at least three seconds so several strides are visible.`);
    else if (dur < 3) add('warn', `${dur.toFixed(1)} s gives only two or three strides. Longer is better.`);
    else if (dur > 20) add('warn', `${dur.toFixed(0)} s is long. The best six-second window will be proposed below.`);
    else add('ok', `${dur.toFixed(1)} s of video`);

    const shortSide = Math.min(w, h);
    if (shortSide < 480) add('warn', `${w} x ${h} — below 480 on the short side, so landmark accuracy degrades.`);
    else add('ok', `${w} x ${h}${h > w ? ' portrait' : ' landscape'}`);

    /* Frame rate is measured from the decoded timestamps, not read from the
       container, because container metadata about frame rate is routinely
       wrong on phone video. Probe it properly. */
    try {
        const { probe } = await import('./src/engine/decode/frames.js');
        const info = await probe(file);
        if (info.path === 'webcodecs' && Number.isFinite(info.fps)) {
            if (info.fps < 30) add('bad', `${info.fps.toFixed(0)} fps. Below 30 fps nothing here can be measured — record at 60 or higher.`);
            else if (info.fps < 60) add('warn', `${info.fps.toFixed(0)} fps. Contact time, flight time and duty factor will be suppressed; one frame is ${(1000 / info.fps).toFixed(0)} ms and contact is only about 230 ms.`);
            else if (info.fps < 120) add('ok', `${info.fps.toFixed(0)} fps — timing shown with a wider interval`);
            else add('ok', `${info.fps.toFixed(0)} fps — full timing precision`);
            if (info.rotationDeg) {
                add('ok', `stored ${info.codedWidth} x ${info.codedHeight} with a ${info.rotationDeg}° turn — it will be rotated upright before analysis`);
            }
            if (info.mirrored) {
                add('warn', 'this clip is mirrored in its metadata; it will be un-mirrored so left and right are not swapped');
            }
        } else {
            add('warn', `This browser will decode by playback rather than frame by frame (${info.reason || 'no WebCodecs'}). Timing precision is reduced.`);
        }
    } catch {
        add('warn', 'The frame rate could not be read before analysis. It will be measured during it.');
    }
}

/* ---------- camera ---------- */

let camStream = null, camChunks = [];

async function startCamera() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, frameRate: { ideal: 120 } },
            audio: false
        });
    } catch {
        toast('The camera could not be opened. You can still choose a file.');
        return;
    }
    const v = $('sl-cam');
    v.srcObject = camStream;
    await v.play().catch(() => { });
    showStage('camera');

    const track = camStream.getVideoTracks()[0];
    const s = track.getSettings();
    $('sl-cam-hint').textContent = s.frameRate
        ? `${s.width}x${s.height} at ${Math.round(s.frameRate)} fps. ${s.frameRate < 60 ? 'Raise the frame rate in the camera app for timing measurements.' : 'Good for timing.'}`
        : 'Fill the outline, whole body in frame';
    drawFramingGuide();
}

function drawFramingGuide() {
    const v = $('sl-cam'), c = $('sl-cam-guide');
    if (!camStream) return;
    const r = v.getBoundingClientRect();
    const ctx = fitCanvas(c, r.width, r.height);
    ctx.clearRect(0, 0, r.width, r.height);
    /* A silhouette box the runner should fill: 70% of frame height, centred.
       This is a metric-accuracy feature, not decoration — subject size in frame
       drives landmark quality and the pixel-to-metre scale. */
    const bh = r.height * 0.72, bw = bh * 0.42;
    ctx.strokeStyle = 'rgba(34,211,209,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect((r.width - bw) / 2, (r.height - bh) / 2, bw, bh);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(232,238,249,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, r.height / 2); ctx.lineTo(r.width, r.height / 2);
    ctx.stroke();
    if (camStream) requestAnimationFrame(drawFramingGuide);
}

function toggleRecording() {
    if (S.recorder && S.recorder.state === 'recording') {
        S.recorder.stop();
        return;
    }
    camChunks = [];
    const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    S.recorder = new MediaRecorder(camStream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
    S.recorder.ondataavailable = (e) => { if (e.data.size) camChunks.push(e.data); };
    S.recorder.onstop = async () => {
        const blob = new Blob(camChunks, { type: camChunks[0] ? camChunks[0].type : 'video/webm' });
        stopCamera();
        const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
        await acceptFile(new File([blob], `recording.${ext}`, { type: blob.type }));
    };
    S.recorder.start();
    $('sl-cam-shoot').innerHTML = '<i class="fas fa-stop"></i> Stop';
}

function stopCamera() {
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    $('sl-cam').srcObject = null;
    $('sl-cam-shoot').innerHTML = '<i class="fas fa-circle"></i> Record';
    if (!S.file) showStage('empty');
}

/* ---------- trim ---------- */

async function showTrim() {
    showStage('trim');
    const v = $('sl-trim-video');
    v.src = S.videoUrl;
    await new Promise(res => { v.onloadedmetadata = res; });
    const dur = v.duration;
    S.trim.duration = dur;
    /* Propose the best six-second window. With no analysis yet the only cheap
       proxy is "the middle", which is where a runner filming themselves is
       most likely to be in frame and up to speed. */
    const want = Math.min(6, dur);
    S.trim.start = Math.max(0, (dur - want) / 2);
    S.trim.end = S.trim.start + want;
    $('sl-trim-start').value = String(Math.round(S.trim.start / dur * 100));
    $('sl-trim-end').value = String(Math.round(S.trim.end / dur * 100));
    onTrim();
    buildFilmstrip(v, dur);
}

function onTrim() {
    const dur = S.trim.duration || 1;
    let a = Number($('sl-trim-start').value) / 100 * dur;
    let b = Number($('sl-trim-end').value) / 100 * dur;
    if (b - a < 1) { b = Math.min(dur, a + 1); $('sl-trim-end').value = String(Math.round(b / dur * 100)); }
    S.trim.start = a; S.trim.end = b;
    $('sl-trim-readout').textContent = `${a.toFixed(2)} s to ${b.toFixed(2)} s · ${(b - a).toFixed(2)} s selected`;
    const v = $('sl-trim-video');
    if (v.readyState >= 1) v.currentTime = a;
}

async function buildFilmstrip(video, dur) {
    const strip = $('sl-filmstrip');
    strip.innerHTML = '';
    const n = 10;
    for (let i = 0; i < n; i++) {
        const c = document.createElement('canvas');
        c.width = 120; c.height = 68;
        strip.appendChild(c);
        const t = (i + 0.5) / n * dur;
        video.currentTime = t;
        await new Promise(res => { video.onseeked = res; setTimeout(res, 400); });
        try { c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); } catch { /* frame not ready */ }
    }
    video.currentTime = S.trim.start;
}

/* ============================================================
   Running the analysis
   ============================================================ */

function renderStages(active) {
    const ol = $('sl-stages');
    ol.innerHTML = '';
    let seen = false;
    for (const s of STAGES) {
        const li = el('li', '', s.label);
        if (s.id === active) { li.className = 'active'; seen = true; }
        else if (!seen) li.className = 'done';
        ol.appendChild(li);
    }
}

async function startAnalysis() {
    if (!S.file || S.running) return;
    S.running = true; S.cancelled = false;
    updateRunEnabled();
    showStage('run');
    $('sl-device-chip').classList.add('is-busy');
    $('sl-device-text').textContent = 'Analysing on your device';
    const live = $('sl-live');
    const liveCtx = fitCanvas(live, live.clientWidth || 640, 360);
    const theme = themeFrom($('sl-viewport'));

    $('sl-cancel').onclick = () => { S.cancelled = true; };

    try {
        const result = await analyseFile(S.file, {
            heightM: heightCm() / 100,
            massKg: massKg(),
            surface: $('sl-surface').value,
            speedMs: speedMs(),
            view: $('sl-view').value,
            startS: S.trim.start,
            endS: S.trim.end,
            preferGpu: $('sl-gpu').checked,
            useWorker: $('sl-worker').checked,
            cutoffHz: Number($('sl-cutoff').value),
            cancelled: () => S.cancelled,
            onProgress: (p) => {
                renderStages(p.stage);
                const frac = p.total ? p.done / p.total : 0;
                $('sl-progress-fill').style.width = `${Math.round(frac * 100)}%`;
                $('sl-progress-text').textContent = p.total > 1
                    ? `${p.label} — ${p.done} of ${p.total}`
                    : p.label;
            },
            onPreview: (p) => {
                const r = live.getBoundingClientRect();
                liveCtx.clearRect(0, 0, r.width, r.height);
                liveCtx.fillStyle = theme.bg;
                liveCtx.fillRect(0, 0, r.width, r.height);
                const box = contain(p.width, p.height, r.width, r.height);
                liveCtx.save();
                liveCtx.translate(box.x, box.y);
                drawOverlay(liveCtx, {
                    xy: reindex(p.landmarks), vis: null, w: box.w, h: box.h, theme,
                    layers: { skeleton: true, angles: false, trails: false, events: false }
                });
                liveCtx.restore();
            }
        });

        if (S.cancelled || result.cancelled) { showStage('trim'); return; }
        if (!result.ok) { showError(result); return; }
        await adoptResult(result, S.file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
        showError({ code: 'decode-failed', message: String(err && err.message || err) });
    } finally {
        S.running = false;
        $('sl-device-chip').classList.remove('is-busy');
        $('sl-device-text').textContent = 'Processed on your device';
        updateRunEnabled();
    }
}

/** BlazePose's 33 landmarks arrive raw from the worker; map to canonical. */
function reindex(raw) {
    const map = { nose: 0, shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32 };
    const out = new Float64Array(CANONICAL.length * 2);
    CANONICAL.forEach((n, i) => {
        const s = map[n];
        out[i * 2] = raw[s * 2];
        out[i * 2 + 1] = raw[s * 2 + 1];
    });
    return out;
}

async function runDemo() {
    S.running = true;
    updateRunEnabled();
    showStage('run');
    renderStages('metrics');
    $('sl-progress-fill').style.width = '100%';
    $('sl-progress-text').textContent = 'Building a synthetic runner';

    const h = heightCm() / 100 || 1.75;
    const g = synthGait({
        heightM: h, fps: 240, durationS: 6, seed: Date.now() & 0xffff,
        noiseFrac: 0.008, dropout: 0.01, asymmetry: 0.05
    });
    await new Promise(r => setTimeout(r, 120));
    const result = runPipeline(g.series, {
        heightM: h, massKg: massKg(), surface: 'treadmill', speedMs: g.params.speedMs,
        backend: 'synthetic', cutoffHz: Number($('sl-cutoff').value)
    });
    result.series = g.series;
    result.synthetic = g.truth;
    S.running = false;
    updateRunEnabled();
    if (!result.ok) { showError(result); return; }
    await adoptResult(result, 'Synthetic demo', true);
}

async function adoptResult(result, name, synthetic) {
    S.result = result;
    S.demo = !!synthetic;
    $('sl-name').value = name || 'Untitled analysis';
    renderResult(result);
    showStage('player');
    setupPlayer(result, synthetic);

    const record = {
        id: store.uuid(),
        profileId: S.profileId || null,
        createdAt: Date.now(),
        label: $('sl-name').value,
        synthetic: !!synthetic,
        engine: result.engine,
        capture: result.capture,
        scale: result.scale,
        strideCount: result.strideCount,
        metrics: stripMetrics(result.metrics),
        scores: { dimensions: result.scores.dimensions, worstAsymmetry: result.scores.worstAsymmetry },
        findings: result.findings,
        warnings: result.warnings,
        keypoints: result.series
            ? { names: result.series.names, n: result.series.n, width: result.series.width, height: result.series.height, t: result.series.t, xy: result.series.xy, vis: result.series.vis }
            : null,
        events: {
            strikes: result.events.strikes.map(e => ({ t: e.t, side: e.side, spreadMs: e.spreadMs })),
            toeoffs: result.events.toeoffs.map(e => ({ t: e.t, side: e.side, spreadMs: e.spreadMs }))
        }
    };
    S.recordId = record.id;
    try {
        await store.saveAnalysis(record, $('sl-keepvideo').checked && S.file ? S.file : null);
        await store.requestPersistence();
        await refreshHistory();
        refreshStorage();
    } catch {
        toast('The analysis is shown but could not be saved locally. Storage may be full or blocked.');
    }
}

function stripMetrics(metrics) {
    const out = {};
    for (const id of Object.keys(metrics)) {
        const m = metrics[id];
        out[id] = {
            id, label: m.label, unit: m.unit, view: m.view, sided: m.sided,
            dimension: m.dimension, decimals: m.decimals,
            sides: m.sides, combined: m.combined,
            asymmetryIndex: m.asymmetryIndex, confidence: m.confidence
        };
    }
    return out;
}

function showStage(which) {
    for (const id of ['empty', 'camera', 'trim', 'run', 'player', 'error']) {
        $(`sl-stage-${id}`).hidden = id !== which;
    }
}

function showError(result) {
    const copy = errorFor(result.code, result.message);
    $('sl-error-title').textContent = copy.title;
    $('sl-error-body').textContent = result.message || copy.body;
    const actions = $('sl-error-actions');
    actions.innerHTML = '';
    if (result.code === 'multiple-people' && result.candidates) {
        for (const c of result.candidates) {
            const b = el('button', 'sl-btn', `Runner ${c.id} · in frame ${(c.coverage * 100).toFixed(0)}%`);
            b.onclick = () => toast('Tap-to-select is not wired to a re-run yet — record a clip with one runner in frame.');
            actions.appendChild(b);
        }
    }
    const again = el('button', 'sl-btn', 'Choose another clip');
    again.onclick = () => { clearFile(); };
    actions.appendChild(again);
    showStage('error');
}

/* ============================================================
   Result rendering
   ============================================================ */

function renderResult(r) {
    $('sl-rail-empty').hidden = true;
    $('sl-rail-content').hidden = false;
    renderDimensions(r);
    renderKey(r);
    renderFacts(r);
    renderFindings(r);
    renderMetricGrid(r);
    renderCycles(r);
    renderStrides(r);
}

function renderDimensions(r) {
    const host = $('sl-dimensions');
    host.innerHTML = '';
    for (const d of DIMENSIONS) {
        const dim = r.scores.dimensions[d.id];
        if (!dim) continue;
        const wrap = el('div', 'sl-dim');
        const head = el('div', 'sl-dim-head');
        head.appendChild(el('span', 'sl-dim-name', dim.label));
        head.appendChild(el('span', 'sl-dim-score', dim.score == null ? 'not scored' : `${Math.round(dim.score * 100)} / 100`));
        wrap.appendChild(head);
        const c = document.createElement('canvas');
        wrap.appendChild(c);
        if (dim.contributors && dim.contributors.length) {
            const det = document.createElement('details');
            det.appendChild(el('summary', '', `${dim.contributors.length} measurement${dim.contributors.length === 1 ? '' : 's'} behind this`));
            const ul = el('ul', 'sl-dim-list');
            for (const c2 of dim.contributors) {
                const li = document.createElement('li');
                li.appendChild(el('span', '', c2.label));
                li.appendChild(el('span', '', c2.value != null
                    ? `${fmt(c2.value, 1)}%`
                    : `${Math.round(c2.score * 100)} · ${c2.strength}`));
                ul.appendChild(li);
            }
            det.appendChild(ul);
            wrap.appendChild(det);
        }
        if (dim.note) wrap.appendChild(el('div', 'sl-rail-note', dim.note));
        host.appendChild(wrap);
        requestAnimationFrame(() => drawScoreBar(c, dim.score));
    }
}

/* Ordered by how much the evidence supports them, not by how familiar they
   are: centre-of-mass oscillation and the two stiffness terms are the only
   variables here with a significant pooled association with running economy. */
const KEY_METRICS = ['comVerticalOscillation', 'cadence', 'verticalStiffness', 'legStiffness',
    'gct', 'stepLength', 'overstride', 'footStrikeAngle', 'pelvicDrop'];

function renderKey(r) {
    const host = $('sl-key');
    host.innerHTML = '';
    host.className = 'sl-key';
    for (const id of KEY_METRICS) {
        const m = r.metrics[id];
        if (!m || m.confidence === 'unavailable') continue;
        const row = el('button', 'sl-keyrow');
        row.type = 'button';
        const slot = m.sided ? m.sides.L : m.combined;
        const conv = convert(slot.value, m.unit, S.units);
        row.appendChild(el('span', 'sl-keyrow-label', m.label));
        const val = el('span', 'sl-keyrow-value');
        val.textContent = m.sided
            ? `${fmt(conv.value, m.decimals)} / ${fmt(convert(m.sides.R.value, m.unit, S.units).value, m.decimals)}`
            : fmt(conv.value, m.decimals);
        val.appendChild(el('span', 'sl-unit', ` ${fmtUnit(conv.unit)}`));
        row.appendChild(val);
        const sub = el('span', 'sl-keyrow-sub');
        sub.appendChild(el('span', '', m.sided ? 'left / right' : 'both sides'));
        if (slot.ci95 != null) sub.appendChild(el('span', '', `± ${fmt(convert(slot.ci95, m.unit, S.units).value, m.decimals)}`));
        sub.appendChild(el('span', '', CONFIDENCE_COPY[slot.confidence].label.toLowerCase()));
        row.appendChild(sub);
        row.setAttribute('aria-label', announce(m, m.sided ? 'L' : null));
        row.onclick = () => openSheet(id, r);
        host.appendChild(row);
    }
}

function renderFacts(r) {
    const host = $('sl-facts');
    host.innerHTML = '';
    const add = (k, v) => {
        const d = document.createElement('div');
        d.appendChild(el('dt', '', k));
        d.appendChild(el('dd', '', v));
        host.appendChild(d);
    };
    add('View', r.capture.view + (
        r.capture.viewOverridden ? ' (you chose this)'
            : r.capture.viewAuto === 'oblique' ? ' (camera looks oblique)'
                : ''));
    if (Number.isFinite(r.capture.travelLegs)) {
        add('Travel in frame', `${r.capture.travelLegs.toFixed(1)} leg lengths`);
    }
    add('Frame rate', `${r.capture.fps.toFixed(1)} fps`);
    add('Frames', String(r.capture.frameCount));
    add('Strides used', `${r.strideCount.L} L / ${r.strideCount.R} R`);
    add('Scale', `${r.scale.confidence} · ±${(r.scale.scatter * 100).toFixed(1)}%`);
    if (r.capture.speedMs) add('Speed', `${r.capture.speedMs.toFixed(2)} m/s · ${paceFromSpeed(r.capture.speedMs)}`);
    add('Backend', r.engine.backend + (r.engine.delegate ? ` · ${r.engine.delegate}` : ''));
    add('Model', r.engine.modelVariant || '—');
    add('Stage-2 model', r.engine.stage2);
    add('Engine', `v${r.engine.version}`);
}

function renderFindings(r) {
    const host = $('sl-pane-findings');
    host.innerHTML = '';

    for (const w of r.warnings || []) {
        const box = el('div', 'sl-warnbox');
        box.appendChild(el('i', 'fas fa-exclamation-triangle'));
        box.appendChild(el('div', '', w.message));
        host.appendChild(box);
    }

    if (S.demo && r.synthetic) {
        const box = el('div', 'sl-warnbox');
        box.appendChild(el('i', 'fas fa-vial'));
        box.appendChild(el('div', '',
            `Synthetic demo. This runner was generated, not filmed, so the true answers are known: cadence ${r.synthetic.cadenceSpm} steps/min, `
            + `contact ${r.synthetic.gctMs.L.toFixed(0)} ms left and ${r.synthetic.gctMs.R.toFixed(0)} ms right, trunk lean ${r.synthetic.trunkLeanDeg}°, `
            + `foot-strike angle ${r.synthetic.strikeAngleDeg}°. Compare them with the measurements below — that difference is the engine's error, not a person's form.`));
        host.appendChild(box);
    }

    if (!r.findings.length) {
        host.appendChild(el('p', 'sl-empty-note',
            'No rule fired on this clip. That means nothing measured here at medium confidence or better fell outside its reference range — not that nothing could be improved. The measurements themselves are in the next tab.'));
        return;
    }

    for (const f of r.findings) {
        const card = el('div', 'sl-finding');
        card.appendChild(el('h4', '', f.finding));
        card.appendChild(el('p', 'sl-evidence', f.evidence));
        card.appendChild(el('p', 'sl-mech', f.mechanism));
        const cue = el('p', 'sl-cue');
        cue.appendChild(el('strong', '', 'Try this: '));
        cue.appendChild(document.createTextNode(f.cue));
        card.appendChild(cue);
        const list = el('div', 'sl-ex-list');
        for (const id of f.exercises) {
            const ex = EXERCISE_BY_ID[id];
            if (!ex) continue;
            const b = el('button', 'sl-ex', `${ex.name} · ${ex.dosage}`);
            b.onclick = () => openExercise(ex);
            list.appendChild(b);
        }
        card.appendChild(list);
        const refs = el('div', 'sl-refs');
        refs.appendChild(document.createTextNode('Sources: '));
        f.references.forEach((id, i) => {
            const ref = REFERENCE_BY_ID[id];
            if (!ref) return;
            if (i) refs.appendChild(document.createTextNode('; '));
            const a = el('a', '', `${ref.authors}${ref.year ? ` ${ref.year}` : ''}`);
            a.href = ref.doi ? `https://doi.org/${ref.doi}` : 'science.html#references';
            a.target = '_blank'; a.rel = 'noopener';
            refs.appendChild(a);
        });
        card.appendChild(refs);
        host.appendChild(card);
    }

    if (r.findingsSuppressed > 0) {
        host.appendChild(el('p', 'sl-empty-note',
            `${r.findingsSuppressed} further rule${r.findingsSuppressed === 1 ? '' : 's'} fired and ${r.findingsSuppressed === 1 ? 'was' : 'were'} not shown. `
            + 'Three is the cap, deliberately: a report listing eleven faults is the standard failure of automated gait analysis and nobody acts on it.'));
    }
}

const GROUPS = [
    { id: 'timing', label: 'Timing and rhythm' },
    { id: 'spatial', label: 'Stride and displacement' },
    { id: 'contact', label: 'Impact and foot contact' },
    { id: 'posture', label: 'Posture and alignment' }
];

function renderMetricGrid(r) {
    const host = $('sl-pane-metrics');
    host.innerHTML = '';
    for (const g of GROUPS) {
        const ids = METRICS.filter(m => m.dimension === g.id).map(m => m.id);
        if (!ids.length) continue;
        host.appendChild(el('div', 'sl-grouphead', g.label));
        const grid = el('div', 'sl-grid');
        for (const id of ids) {
            const card = metricCard(r, id);
            if (card) grid.appendChild(card);
        }
        host.appendChild(grid);
    }
}

function metricCard(r, id) {
    const m = r.metrics[id];
    const spec = METRIC_BY_ID[id];
    if (!m || !spec) return null;
    const card = el('button', 'sl-mcard');
    card.type = 'button';
    if (m.confidence === 'unavailable') card.classList.add('is-unavailable');

    const head = el('div', 'sl-mcard-head');
    head.appendChild(el('span', 'sl-mcard-label', m.label));
    head.appendChild(el('span', `sl-conf ${m.confidence}`, CONFIDENCE_COPY[m.confidence].label));
    card.appendChild(head);

    const band = bandFor(id, { speedMs: r.capture.speedMs });
    const sides = el('div', 'sl-sides');
    const slots = m.sided ? [['L', 'Left'], ['R', 'Right']] : [[null, 'Both sides']];
    for (const [key, label] of slots) {
        const slot = key ? m.sides[key] : m.combined;
        const cell = document.createElement('div');
        const lab = el('div', 'sl-side-label');
        lab.appendChild(document.createTextNode(label + ' '));
        /* the dash marks the right side everywhere in this app, so left and
           right are never told apart by colour alone */
        if (key === 'R') lab.appendChild(el('span', 'sl-dash', '- -'));
        cell.appendChild(lab);
        const v = el('div', 'sl-side-value');
        if (id === 'strikePattern') {
            v.textContent = slot && slot.klass ? slot.klass : '—';
        } else {
            const conv = convert(slot ? slot.value : null, m.unit, S.units);
            v.textContent = slot && slot.value != null
                ? `${fmt(conv.value, m.decimals)}${slot.ci95 != null ? ` ± ${fmt(convert(slot.ci95, m.unit, S.units).value, m.decimals)}` : ''}`
                : '—';
            if (slot && slot.value != null) v.appendChild(el('span', 'sl-unit', fmtUnit(conv.unit)));
        }
        cell.appendChild(v);
        cell.setAttribute('aria-label', announce(m, key));
        sides.appendChild(cell);
    }
    card.appendChild(sides);

    const primary = m.sided ? m.sides.L : m.combined;
    if (primary && primary.value != null && id !== 'strikePattern') {
        const c = document.createElement('canvas');
        card.appendChild(c);
        requestAnimationFrame(() => drawRangeBar(c, { value: primary.value, ci95: primary.ci95, band }));
    }

    const foot = el('div', 'sl-mcard-foot');
    const scored = r.scores.perMetric[id];
    const status = scored ? (m.sided ? scored.sides.L.status : (scored.combined ? scored.combined.status : 'unscored')) : 'unscored';
    const st = el('span', 'sl-status');
    st.appendChild(el('span', '', STATUS_GLYPH[status]));
    st.appendChild(el('span', '', STATUS_COPY[status]));
    foot.appendChild(st);
    if (m.asymmetryIndex != null) {
        const cls = m.asymmetryIndex > ASYMMETRY_NOTABLE ? 'notable' : m.asymmetryIndex > ASYMMETRY_ATTENTION ? 'attention' : '';
        foot.appendChild(el('span', `sl-ai ${cls}`, `L/R ${m.asymmetryIndex.toFixed(1)}%`));
    }
    card.appendChild(foot);

    const note = (m.sided ? m.sides.L.note : (m.combined && m.combined.note));
    if (note) card.appendChild(el('div', 'sl-mnote', note));

    card.onclick = () => openSheet(id, r);
    return card;
}

const CYCLE_SERIES = [
    { key: 'kneeFlex', label: 'Knee flexion', unit: '°', blurb: 'Mean across strides with a ±1 SD band. The width of the band is how consistent you are, which no single number shows.' },
    { key: 'hipExt', label: 'Hip angle', unit: '°', blurb: 'Thigh relative to the trunk axis. Positive is behind you.' },
    { key: 'footAngle', label: 'Foot angle', unit: '°', blurb: 'Heel-to-toe relative to horizontal. Positive is toe-up.' },
    { key: 'shank', label: 'Shank angle', unit: '°', blurb: 'Shin from vertical. Positive means the knee is behind the ankle.' },
    { key: 'ankleDf', label: 'Ankle angle', unit: '°', blurb: 'Relative to an assumed neutral, so read the shape rather than the offset.' },
    { key: 'elbow', label: 'Elbow angle', unit: '°', blurb: 'Interior shoulder-elbow-wrist angle.' }
];

function renderCycles(r) {
    const host = $('sl-pane-cycle');
    host.innerHTML = '';
    if (!r._internal) {
        host.appendChild(el('p', 'sl-empty-note', 'Curves are available for the analysis in this session. Re-run a stored analysis to see them.'));
        return;
    }
    const intro = el('p', 'sl-empty-note',
        'Every stride, resampled to 0–100% of the gait cycle and averaged. The shaded band is ±1 standard deviation across strides; the shaded left-hand region is stance. Left is solid, right is dashed.');
    host.appendChild(intro);
    const grid = el('div', 'sl-charts');
    for (const s of CYCLE_SERIES) {
        const L = gaitCycleCurves(r, s.key, 'L');
        const R = gaitCycleCurves(r, s.key, 'R');
        if (!L && !R) continue;
        const card = el('div', 'sl-chart');
        card.appendChild(el('h4', '', s.label));
        card.appendChild(el('p', '', s.blurb));
        const c = document.createElement('canvas');
        card.appendChild(c);
        const sets = [];
        if (L) sets.push({ ...L, side: 'L', label: 'left' });
        if (R) sets.push({ ...R, side: 'R', label: 'right' });
        card.appendChild(dataTable(sets, s.unit));
        grid.appendChild(card);
        requestAnimationFrame(() => drawGaitCycle(c, sets, { yLabel: s.unit }));
    }
    host.appendChild(grid);
}

/** Every chart has a table alternative reachable from the chart. */
function dataTable(sets, unit) {
    const det = document.createElement('details');
    det.appendChild(el('summary', '', 'Show as a table'));
    const wrap = el('div', 'sl-tablewrap');
    const t = el('table', 'sl-datatable');
    const head = document.createElement('tr');
    head.appendChild(el('th', '', `cycle %`));
    for (const s of sets) head.appendChild(el('th', '', `${s.label} (${unit})`));
    t.appendChild(head);
    for (let p = 0; p <= 100; p += 10) {
        const i = Math.round(p / 100 * (sets[0].mean.length - 1));
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', String(p)));
        for (const s of sets) tr.appendChild(el('td', '', fmt(s.mean[i], 1)));
        t.appendChild(tr);
    }
    wrap.appendChild(t);
    det.appendChild(wrap);
    return det;
}

const STRIDE_METRICS = ['gct', 'stepTime', 'peakKneeFlexionStance', 'footStrikeAngle'];

function renderStrides(r) {
    const host = $('sl-pane-strides');
    host.innerHTML = '';
    if (!r._internal) {
        host.appendChild(el('p', 'sl-empty-note', 'Per-stride values are available for the analysis in this session.'));
        return;
    }
    host.appendChild(el('p', 'sl-empty-note',
        'One point per stride, so variability is visible rather than averaged away. Left is a filled circle, right an open square.'));
    const grid = el('div', 'sl-charts');
    const strides = r._internal.strides;
    for (const id of STRIDE_METRICS) {
        const m = r.metrics[id];
        if (!m || m.confidence === 'unavailable') continue;
        const card = el('div', 'sl-chart');
        card.appendChild(el('h4', '', m.label));
        card.appendChild(el('p', '', `${m.unit ? fmtUnit(m.unit) : ''} · ${strides.L.length} left, ${strides.R.length} right`));
        const c = document.createElement('canvas');
        card.appendChild(c);
        const sets = ['L', 'R'].map(side => ({
            side,
            values: strides[side].map(st => strideValue(r, st, id, side))
        }));
        grid.appendChild(card);
        requestAnimationFrame(() => drawStrideDots(c, sets, { yLabel: fmtUnit(m.unit) }));
    }
    host.appendChild(grid);
}

function strideValue(r, st, id, side) {
    switch (id) {
        case 'gct': return st.stanceTime * 1000;
        case 'stepTime': return st.stepTime * 1000;
        case 'peakKneeFlexionStance': {
            const arr = r._internal.series.kneeFlex[side];
            let best = -Infinity;
            for (let i = st.i0; i <= Math.min(arr.length - 1, st.i1); i++) if (arr[i] > best) best = arr[i];
            return Number.isFinite(best) ? best : NaN;
        }
        case 'footStrikeAngle': return r._internal.series.footAngle[side][st.i0];
        default: return NaN;
    }
}

/* ============================================================
   Player
   ============================================================ */

let playerState = null;

function wirePlayer() {
    $('sl-play').addEventListener('click', togglePlay);
    $('sl-prev').addEventListener('click', () => step(-1));
    $('sl-next').addEventListener('click', () => step(1));
    $('sl-scrub').addEventListener('input', (e) => seekFraction(Number(e.target.value) / 1000));
    $('sl-scrub').addEventListener('keydown', (e) => {
        const n = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-n); }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(n); }
    });
    $('sl-rate').addEventListener('change', (e) => {
        if (playerState && playerState.video) playerState.video.playbackRate = Number(e.target.value);
    });
    for (const id of OVERLAY_LAYERS) {
        const el = $(`sl-l-${id}`);
        if (el) el.addEventListener('change', drawPlayerFrame);
    }
    const preset = $('sl-overlay-preset');
    if (preset) preset.addEventListener('change', () => applyOverlayPreset(preset.value));
    window.addEventListener('resize', debounce(() => { if (playerState) drawPlayerFrame(); }, 180));
}

/**
 * The ground, as the lowest foot landmark anywhere in the clip. Approximate by
 * construction — it assumes a level surface — and used only to draw a
 * reference line, never to measure anything.
 */
function estimateGround(result) {
    const S = result.series;
    const K = CANONICAL.length;
    let lowest = -Infinity;
    for (const name of ['heelL', 'heelR', 'toeL', 'toeR']) {
        const c = CANONICAL.indexOf(name);
        for (let f = 0; f < S.n; f++) {
            if (!(S.vis[f * K + c] >= 0.5)) continue;
            const y = S.xy[(f * K + c) * 2 + 1];
            if (Number.isFinite(y) && y > lowest) lowest = y;
        }
    }
    return Number.isFinite(lowest) && lowest > -Infinity ? lowest : null;
}

function setupPlayer(result, synthetic) {
    const series = result.series;
    const video = $('sl-video');
    if (result._internal) result._internal.groundY = estimateGround(result);
    playerState = {
        result, series, synthetic: !!synthetic,
        frame: 0,
        n: series ? series.n : 0,
        video: synthetic ? null : video,
        theme: themeFrom($('sl-viewport'))
    };
    if (synthetic || !S.videoUrl) {
        video.hidden = true;
        video.removeAttribute('src');
    } else {
        video.hidden = false;
        video.src = S.videoUrl;
        video.playbackRate = Number($('sl-rate').value);
        video.currentTime = series.t[0];
        video.ontimeupdate = () => {
            const i = nearestFrame(series.t, video.currentTime);
            playerState.frame = i;
            $('sl-scrub').value = String(Math.round(i / Math.max(1, series.n - 1) * 1000));
            drawPlayerFrame();
        };
        video.onended = () => { S.playing = false; $('sl-play').innerHTML = '<i class="fas fa-play"></i>'; };
    }
    renderEventTrack(result);
    drawPlayerFrame();
}

function renderEventTrack(result) {
    const track = $('sl-eventtrack');
    track.innerHTML = '';
    const t0 = result.series.t[0];
    const t1 = result.series.t[result.series.n - 1];
    const span = t1 - t0 || 1;
    const add = (t, cls) => {
        const s = document.createElement('span');
        s.className = cls;
        s.style.left = `${((t - t0) / span) * 100}%`;
        track.appendChild(s);
    };
    for (const e of result.events.strikes) add(e.t, e.side === 'R' ? 'r' : '');
    for (const e of result.events.toeoffs) add(e.t, `off ${e.side === 'R' ? 'r' : ''}`);
}

function nearestFrame(times, t) {
    let lo = 0, hi = times.length - 1;
    if (t <= times[0]) return 0;
    if (t >= times[hi]) return hi;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (times[m] <= t) lo = m; else hi = m;
    }
    return (t - times[lo]) < (times[hi] - t) ? lo : hi;
}

function togglePlay() {
    if (!playerState) return;
    if (playerState.video && !playerState.video.hidden) {
        if (playerState.video.paused) { playerState.video.play(); $('sl-play').innerHTML = '<i class="fas fa-pause"></i>'; }
        else { playerState.video.pause(); $('sl-play').innerHTML = '<i class="fas fa-play"></i>'; }
        return;
    }
    S.playing = !S.playing;
    $('sl-play').innerHTML = S.playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    if (S.playing) tickSynthetic();
}

function tickSynthetic() {
    if (!S.playing || !playerState) return;
    const rate = Number($('sl-rate').value);
    playerState.frame = (playerState.frame + Math.max(1, Math.round(rate * 4))) % playerState.n;
    $('sl-scrub').value = String(Math.round(playerState.frame / Math.max(1, playerState.n - 1) * 1000));
    drawPlayerFrame();
    setTimeout(() => requestAnimationFrame(tickSynthetic), 33);
}

function step(n) {
    if (!playerState) return;
    playerState.frame = Math.max(0, Math.min(playerState.n - 1, playerState.frame + n));
    if (playerState.video && !playerState.video.hidden) {
        playerState.video.pause();
        playerState.video.currentTime = playerState.series.t[playerState.frame];
    }
    $('sl-scrub').value = String(Math.round(playerState.frame / Math.max(1, playerState.n - 1) * 1000));
    drawPlayerFrame();
}

function seekFraction(f) {
    if (!playerState) return;
    playerState.frame = Math.round(f * (playerState.n - 1));
    if (playerState.video && !playerState.video.hidden) {
        playerState.video.currentTime = playerState.series.t[playerState.frame];
    }
    drawPlayerFrame();
}

function drawPlayerFrame() {
    if (!playerState) return;
    const { series, result } = playerState;
    const host = $('sl-player');
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;
    const canvas = $('sl-overlay');
    const ctx = fitCanvas(canvas, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const box = playerState.video && !playerState.video.hidden && playerState.video.videoWidth
        ? contain(playerState.video.videoWidth, playerState.video.videoHeight, rect.width, rect.height)
        : contain(series.width, series.height, rect.width, rect.height);

    if (!playerState.video || playerState.video.hidden) {
        ctx.fillStyle = playerState.theme.bg;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = playerState.theme.line;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
        /* ground line, so a synthetic runner is not floating in a void */
        ctx.beginPath();
        ctx.moveTo(box.x, box.y + box.h * 0.955);
        ctx.lineTo(box.x + box.w, box.y + box.h * 0.955);
        ctx.strokeStyle = playerState.theme.line;
        ctx.stroke();
    }

    const f = playerState.frame;
    const K = CANONICAL.length;
    const xy = new Float64Array(K * 2);
    const vis = new Float64Array(K);
    for (let c = 0; c < K; c++) {
        let x = series.xy[(f * K + c) * 2];
        xy[c * 2] = result.capture.mirrored ? x : x;
        xy[c * 2 + 1] = series.xy[(f * K + c) * 2 + 1];
        vis[c] = series.vis[f * K + c];
    }

    const tNow = series.t[f];
    const near = [...result.events.strikes, ...result.events.toeoffs]
        .map(e => ({ e, d: Math.abs(e.t - tNow) }))
        .sort((a, b) => a.d - b.d)[0];
    const label = near && near.d < 0.035
        ? `${near.e.kind === 'strike' ? 'foot strike' : 'toe-off'} · ${near.e.side === 'L' ? 'left' : 'right'}`
        : null;

    ctx.save();
    ctx.translate(box.x, box.y);
    drawOverlay(ctx, {
        xy, vis, w: box.w, h: box.h, theme: playerState.theme,
        layers: currentLayers(),
        angles: liveAngles(result, f),
        trails: $('sl-l-trails').checked ? buildTrails(result, f) : null,
        com: comAt(result, f),
        readout: $('sl-l-readout').checked ? frameReadout(result, f) : null,
        phase: phaseAt(result, f),
        measures: $('sl-l-measures').checked ? measuresAt(result, f) : null,
        metresPerPx: metresPerCanvasPx(result, f, box.w),
        eventLabel: label
    });
    ctx.restore();

    $('sl-time').textContent = `${tNow.toFixed(3)} s`;
}

/**
 * The whole-body centre of mass at one frame, in normalised coordinates.
 * The engine works in a y-up pixel frame, so it has to be converted back for
 * the overlay, which draws in image coordinates.
 */
function comAt(result, frame) {
    const com = result._internal && result._internal.com;
    if (!com || !Number.isFinite(com.x[frame])) return null;
    const w = result.capture.resolution[0], h = result.capture.resolution[1];
    const x = result.capture.mirrored ? (w - com.x[frame]) : com.x[frame];
    return { x: x / w, y: 1 - com.y[frame] / h };
}

const OVERLAY_LAYERS = ['skeleton', 'angles', 'guides', 'readout', 'phase', 'measures', 'trails', 'events', 'com'];

/* Three densities, because the right amount of annotation depends on what you
   are doing. "Clean" is for showing somebody the video; "analytical" is the
   working default; "everything" is for reading one frame carefully. */
const OVERLAY_PRESETS = {
    clean: { skeleton: 1, angles: 0, guides: 0, readout: 0, phase: 0, measures: 0, trails: 0, events: 1, com: 0 },
    analytical: { skeleton: 1, angles: 1, guides: 1, readout: 1, phase: 1, measures: 1, trails: 0, events: 1, com: 1 },
    everything: { skeleton: 1, angles: 1, guides: 1, readout: 1, phase: 1, measures: 1, trails: 1, events: 1, com: 1 }
};

function applyOverlayPreset(name) {
    const p = OVERLAY_PRESETS[name];
    if (!p) return;
    for (const id of OVERLAY_LAYERS) {
        const el = $(`sl-l-${id}`);
        if (el) el.checked = !!p[id];
    }
    drawPlayerFrame();
}

function currentLayers() {
    const out = {};
    for (const id of OVERLAY_LAYERS) {
        const el = $(`sl-l-${id}`);
        out[id] = el ? el.checked : true;
    }
    return out;
}

/**
 * Angle annotations with THIS FRAME's value attached.
 *
 * The arc and the number come from the same place: `metric` names the
 * per-frame series the engine computed, so the drawing and the reading cannot
 * describe different joints or disagree about a sign convention.
 */
function liveAngles(result, frame) {
    const S = result._internal && result._internal.series;
    const specs = anglesFor(result.capture.view);
    if (!S) return specs;
    return specs.map(spec => {
        const src = S[spec.metric];
        const arr = src && (src[spec.side] || src);
        const v = arr && Number.isFinite(arr[frame]) ? arr[frame] : null;
        return { ...spec, text: v == null ? null : `${spec.label}  ${v.toFixed(0)}°` };
    });
}

/**
 * The values at this frame, for the heads-up readout.
 *
 * Deliberately different from the dashboard, which shows stride aggregates.
 * Stepping frame by frame through a contact and watching knee flexion rise is
 * how a gait cycle is actually read, and that needs the instantaneous value.
 */
function frameReadout(result, frame) {
    const inner = result._internal;
    if (!inner) return null;
    const S = inner.series;
    const rows = [];
    const at = (arr) => (arr && Number.isFinite(arr[frame]) ? arr[frame] : null);
    const deg = (label, arr, side) => {
        const v = at(arr);
        if (v == null) return null;
        return { label, value: `${v.toFixed(1)}°`, side };
    };

    if (result.capture.view === 'frontal') {
        rows.push(deg('pelvis', S.obliquity));
        rows.push(deg('knee', S.fppa && S.fppa.L, 'L'));
        rows.push(deg('knee', S.fppa && S.fppa.R, 'R'));
        rows.push(deg('lean', S.lateral));
    } else {
        rows.push(deg('knee', S.kneeFlex && S.kneeFlex.L, 'L'));
        rows.push(deg('knee', S.kneeFlex && S.kneeFlex.R, 'R'));
        rows.push(deg('hip', S.hipExt && S.hipExt.L, 'L'));
        rows.push(deg('foot', S.footAngle && S.footAngle.L, 'L'));
        rows.push(deg('trunk', S.trunkLean));
    }

    /* Centre-of-mass height ABOVE THE GROUND, not above the bottom of the
       image — the frame edge is an arbitrary datum and a height measured from
       it is a number with no meaning. */
    const com = inner.com;
    const mpp = inner.scale && inner.scale.mPerPx;
    if (com && mpp && Number.isFinite(com.y[frame]) && Number.isFinite(mpp[frame])
        && Number.isFinite(inner.groundY)) {
        const groundUpPx = (1 - inner.groundY) * result.series.height;
        const above = (com.y[frame] - groundUpPx) * mpp[frame];
        if (above > 0) rows.push({ label: 'com ht', value: `${above.toFixed(2)} m`, dim: true });
    }

    const strides = (result.events.strides || []).filter(s => s.valid);
    const t = result.series.t[frame];
    const idx = strides.findIndex(s => t >= s.strike.t && t < s.nextStrike.t);
    return {
        rows: rows.filter(Boolean),
        time: t,
        frame,
        /* An oblique camera measures every planar angle in a plane the movement
           did not happen in. The findings say so at length; the frame itself
           should not stay silent about it while displaying those angles. */
        stride: [
            idx >= 0 ? `stride ${idx + 1}/${strides.length}` : null,
            result.capture.viewAuto === 'oblique' ? 'oblique view' : null
        ].filter(Boolean).join('  ·  ') || null
    };
}

/**
 * Which foot is on the ground now, and the stance blocks across the whole clip.
 *
 * The lanes make the event detection inspectable: if the two feet do not
 * alternate, the detection is wrong and it is visible without reading a number.
 */
function phaseAt(result, frame) {
    if (!$('sl-l-phase') || !$('sl-l-phase').checked) {
        /* the contact brackets still need to know who is down */
        return contactState(result, frame);
    }
    const state = contactState(result, frame);
    const t0 = result.series.t[0];
    const t1 = result.series.t[result.series.n - 1];
    const span = (t1 - t0) || 1;
    const lanes = { L: [], R: [] };
    /* a record reloaded from storage keeps its events but not its strides */
    for (const st of (result.events.strides || [])) {
        if (!st.toeoff) continue;
        lanes[st.side].push({
            from: Math.max(0, (st.strike.t - t0) / span),
            to: Math.min(1, (st.toeoff.t - t0) / span)
        });
    }
    return { ...state, lanes, playhead: (result.series.t[frame] - t0) / span };
}

function contactState(result, frame) {
    const t = result.series.t[frame];
    const out = { L: { stance: false }, R: { stance: false } };
    for (const st of (result.events.strides || [])) {
        if (!st.toeoff) continue;
        if (t >= st.strike.t && t <= st.toeoff.t) out[st.side].stance = true;
    }
    return out;
}

/**
 * Dimensioned callouts: overstride at the frames near a foot strike, and the
 * centre-of-mass excursion across the stride containing this frame.
 */
const trusted = (c) => c === 'high' || c === 'medium';

function measuresAt(result, frame) {
    const inner = result._internal;
    if (!inner) return null;
    const t = result.series.t[frame];
    const K = CANONICAL.length;
    const S = result.series;
    const norm = (name, f) => ({
        x: S.xy[(f * K + CANONICAL.indexOf(name)) * 2],
        y: S.xy[(f * K + CANONICAL.indexOf(name)) * 2 + 1]
    });
    const out = {};

    /* ground: the lowest foot landmark seen in this clip */
    if (Number.isFinite(inner.groundY)) out.groundY = inner.groundY;

    /* overstride, only near a contact — it is defined at that instant */
    const strike = result.events.strikes
        .map(e => ({ e, d: Math.abs(e.t - t) }))
        .sort((p, q) => p.d - q.d)[0];
    if (strike && strike.d < 0.12) {
        const side = strike.e.side;
        const ankle = norm('ankle' + side, frame);
        const hipL = norm('hipL', frame), hipR = norm('hipR', frame);
        const hx = (hipL.x + hipR.x) / 2;
        const m = result.metrics.overstride.sides[side];
        /* A dimension line is an assertion. The engine already refuses to score
           or advise on a measurement below medium confidence; drawing it as a
           confident annotation on the frame would let the overlay contradict
           the report it belongs to. */
        if (Number.isFinite(ankle.x) && Number.isFinite(hx)
            && m && m.value != null && trusted(m.confidence)) {
            out.overstride = {
                x0: hx, x1: ankle.x, y: ankle.y - 0.03,
                text: `overstride ${m.value.toFixed(1)}% ht`
            };
        }
    }

    /* centre-of-mass excursion across the stride containing this frame */
    const st = (result.events.strides || []).find(s => s.valid && t >= s.strike.t && t < s.nextStrike.t);
    const com = inner.com;
    const mCom = result.metrics.comVerticalOscillation.combined;
    if (st && com && mCom && mCom.value != null && trusted(mCom.confidence)) {
        let lo = Infinity, hi = -Infinity;
        for (let f = st.i0; f <= Math.min(S.n - 1, st.i1); f++) {
            const v = com.y[f];
            if (!Number.isFinite(v)) continue;
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        if (hi > lo) {
            const H = S.height;
            out.comBand = {
                x: Math.min(0.93, Math.max(0.07, (com.x[frame] / S.width) + 0.16)),
                yMin: 1 - hi / H,
                yMax: 1 - lo / H,
                text: `bounce ${mCom.value.toFixed(1)} cm`
            };
        }
    }
    return out;
}

/**
 * Metres per canvas pixel, for the scale bar.
 * The engine works in SOURCE pixels; the canvas draws the source width into
 * `boxW`, so the two scales have to be composed rather than confused.
 */
function metresPerCanvasPx(result, frame, boxW) {
    const inner = result._internal;
    const mpp = inner && inner.scale && inner.scale.mPerPx;
    if (!mpp || !Number.isFinite(mpp[frame]) || !(boxW > 0)) return null;
    return mpp[frame] * (result.series.width / boxW);
}

function buildTrails(result, frame) {
    const series = result.series;
    const K = CANONICAL.length;
    const out = [];
    const from = Math.max(0, frame - 75);
    for (const [name, side] of [['toeL', 'L'], ['toeR', 'R']]) {
        const c = CANONICAL.indexOf(name);
        const pts = [];
        for (let f = from; f <= frame; f++) {
            pts.push(series.xy[(f * K + c) * 2], series.xy[(f * K + c) * 2 + 1]);
        }
        out.push({ side, pts });
    }
    /* the centre-of-mass path, which is the one trace worth watching */
    const com = result._internal && result._internal.com;
    if (com) {
        const pts = [];
        for (let f = from; f <= frame; f++) {
            pts.push(
                (result.capture.mirrored ? (series.width - com.x[f]) : com.x[f]) / series.width,
                1 - com.y[f] / series.height
            );
        }
        out.push({ side: 'C', pts, colour: null });
    }
    return out;
}

/* ============================================================
   Dock, sheet, history, compare
   ============================================================ */

function wireDock() {
    for (const tab of document.querySelectorAll('.sl-dtab')) {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sl-dtab').forEach(t => {
                t.classList.toggle('is-active', t === tab);
                t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
            });
            document.querySelectorAll('.sl-pane').forEach(p => {
                p.classList.toggle('is-active', p.dataset.pane === tab.dataset.pane);
            });
            if (tab.dataset.pane === 'history') refreshHistory();
            if (tab.dataset.pane === 'compare') renderCompare();
        });
    }
    $('sl-dock-collapse').addEventListener('click', () => {
        const d = $('sl-dock');
        d.classList.toggle('is-collapsed');
        $('sl-dock-collapse').innerHTML = d.classList.contains('is-collapsed')
            ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
    });
    /* Panels start collapsed on handhelds so the viewport is reachable without
       scrolling. Never persisted: a panel opened by hand stays open. */
    if (window.matchMedia('(max-width: 720px)').matches) {
        $('sl-step-guidance').open = false;
        $('sl-step-advanced').open = false;
        $('sl-dock').classList.add('is-collapsed');
        $('sl-dock-collapse').innerHTML = '<i class="fas fa-chevron-up"></i>';
    }
}

function wireSheet() {
    $('sl-sheet-close').addEventListener('click', closeSheet);
    $('sl-sheet').addEventListener('click', (e) => { if (e.target === $('sl-sheet')) closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

function openSheet(id, r) {
    const m = r.metrics[id];
    const spec = METRIC_BY_ID[id];
    if (!spec) return;
    $('sl-sheet-title').textContent = spec.label;
    const body = $('sl-sheet-body');
    body.innerHTML = '';

    body.appendChild(el('h4', '', 'What it is'));
    body.appendChild(el('p', '', spec.definition));
    body.appendChild(el('h4', '', 'How it is computed'));
    body.appendChild(el('p', '', spec.formula));

    body.appendChild(el('h4', '', 'Your value'));
    for (const [key, label] of (m.sided ? [['L', 'Left'], ['R', 'Right']] : [[null, 'Both sides']])) {
        const slot = key ? m.sides[key] : m.combined;
        const p = document.createElement('p');
        p.textContent = `${label}: ${slot && slot.value != null ? `${fmtWithCi(slot, spec)} ${fmtUnit(m.unit)} (${slot.n} stride${slot.n === 1 ? '' : 's'}, confidence ${CONFIDENCE_COPY[slot.confidence].label.toLowerCase()})` : 'not measured'}`;
        body.appendChild(p);
        if (slot && slot.note) body.appendChild(el('p', '', slot.note));
    }

    const band = bandFor(id, { speedMs: r.capture.speedMs });
    body.appendChild(el('h4', '', 'Reference range'));
    if (band) {
        const ref = REFERENCE_BY_ID[band.source];
        body.appendChild(el('p', '',
            `Typical ${band.optimal[0]} to ${band.optimal[1]} ${fmtUnit(m.unit)}, acceptable ${band.acceptable[0]} to ${band.acceptable[1]}.`
            + (band.conditions.speedMs && band.conditions.speedMs[1] < 99
                ? ` This band applies between ${band.conditions.speedMs[0]} and ${band.conditions.speedMs[1]} m/s.` : '')));
        if (band.comment) body.appendChild(el('p', '', band.comment));
        if (ref) {
            const p = document.createElement('p');
            p.appendChild(document.createTextNode(`Evidence strength: ${band.strength}. Source: `));
            const a = el('a', '', `${ref.authors}${ref.year ? `, ${ref.year}` : ''} — ${ref.title}`);
            a.href = ref.doi ? `https://doi.org/${ref.doi}` : 'science.html#references';
            a.target = '_blank'; a.rel = 'noopener';
            p.appendChild(a);
            body.appendChild(p);
            body.appendChild(el('p', '', ref.used));
        }
    } else {
        body.appendChild(el('p', '', 'No reference band is defined for this measurement, so it is reported and not scored. That is deliberate: inventing a range would be worse than leaving it unscored.'));
    }

    body.appendChild(el('h4', '', 'What limits its confidence'));
    body.appendChild(el('p', '', spec.drivers.length ? spec.drivers.join(', ') + '.' : 'Nothing beyond the general limits of pose estimation from a single camera.'));
    const link = el('p', '');
    const a = el('a', '', 'How this is measured, and what it cannot do');
    a.href = 'science.html';
    link.appendChild(a);
    body.appendChild(link);

    $('sl-sheet').hidden = false;
    $('sl-sheet-close').focus();
}

function openExercise(ex) {
    $('sl-sheet-title').textContent = ex.name;
    const body = $('sl-sheet-body');
    body.innerHTML = '';
    body.appendChild(el('h4', '', 'Dosage'));
    body.appendChild(el('p', '', ex.dosage));
    body.appendChild(el('h4', '', 'Set up'));
    body.appendChild(el('p', '', ex.setup));
    body.appendChild(el('h4', '', 'Cues'));
    const ul = document.createElement('ul');
    for (const c of ex.cues) ul.appendChild(el('li', '', c));
    body.appendChild(ul);
    body.appendChild(el('h4', '', 'Common errors'));
    const ul2 = document.createElement('ul');
    for (const c of ex.commonErrors) ul2.appendChild(el('li', '', c));
    body.appendChild(ul2);
    body.appendChild(el('h4', '', 'Safety'));
    body.appendChild(el('p', '', ex.contraindications + ' Stop any exercise that causes pain.'));
    body.appendChild(el('p', '', 'No demonstration video is included: it has to be shot or licensed, and taking somebody else’s is not an option. The cues above are what determines whether the movement is done well.'));
    $('sl-sheet').hidden = false;
}

function closeSheet() { $('sl-sheet').hidden = true; }

async function refreshHistory() {
    S.history = await store.listAnalyses().catch(() => []);
    const host = $('sl-pane-history');
    if (!host) return;
    host.innerHTML = '';
    if (!S.history.length) {
        host.appendChild(el('p', 'sl-empty-note',
            'Nothing stored yet. Analyses are kept in this browser on this device — there is no account and no server, so clearing site data deletes them. Export a bundle to keep them.'));
        return;
    }
    host.appendChild(el('p', 'sl-empty-note',
        'Stored in this browser only. Comparing a treadmill side view with an overground rear view is not meaningful, so compare is limited to analyses that match.'));
    const list = el('div', 'sl-hist');
    for (const a of S.history) {
        const row = el('div', 'sl-histrow');
        const left = document.createElement('div');
        left.appendChild(el('div', 'sl-hist-name', a.label || 'Untitled'));
        left.appendChild(el('div', 'sl-hist-meta',
            `${fmtDateTime(a.createdAt)} · ${a.capture.view} · ${a.capture.surface} · ${a.capture.fps.toFixed(0)} fps${a.synthetic ? ' · synthetic' : ''}`));
        row.appendChild(left);
        const actions = el('div', 'sl-hist-actions');
        const cmp = el('button', 'sl-btn', S.compareIds.includes(a.id) ? 'Selected' : 'Compare');
        cmp.onclick = () => {
            const i = S.compareIds.indexOf(a.id);
            if (i >= 0) S.compareIds.splice(i, 1);
            else { S.compareIds.push(a.id); if (S.compareIds.length > 2) S.compareIds.shift(); }
            refreshHistory();
        };
        const del = el('button', 'sl-btn', 'Delete');
        del.onclick = async () => { await store.deleteAnalysis(a.id); await refreshHistory(); refreshStorage(); };
        actions.appendChild(cmp);
        actions.appendChild(del);
        row.appendChild(actions);
        list.appendChild(row);
    }
    host.appendChild(list);

    /* trends */
    const trendable = S.history.filter(a => !a.synthetic).slice(0, 12).reverse();
    if (trendable.length >= 2) {
        host.appendChild(el('div', 'sl-grouphead', 'Trends'));
        const grid = el('div', 'sl-charts');
        for (const id of ['cadence', 'gct', 'verticalOscillation', 'overstride']) {
            const pts = trendable.map(a => {
                const m = a.metrics[id];
                const slot = m && (m.sided ? m.sides.L : m.combined);
                return { value: slot ? slot.value : null, ci95: slot ? slot.ci95 : null };
            }).filter(p => p.value != null);
            if (pts.length < 2) continue;
            const card = el('div', 'sl-chart');
            card.appendChild(el('h4', '', METRIC_BY_ID[id].label));
            card.appendChild(el('p', '', `${pts.length} analyses, oldest first. Shading is the 95% interval.`));
            const c = document.createElement('canvas');
            c.style.height = '120px';
            card.appendChild(c);
            grid.appendChild(card);
            requestAnimationFrame(() => drawSparkline(c, pts));
        }
        host.appendChild(grid);
    }
}

function renderCompare() {
    const host = $('sl-pane-compare');
    host.innerHTML = '';
    if (S.compareIds.length < 2) {
        host.appendChild(el('p', 'sl-empty-note',
            'Pick two analyses in the History tab. They have to share a view and a surface: comparing a treadmill side view with an overground rear view compares two different measurements, so it is not offered.'));
        return;
    }
    const [a, b] = S.compareIds.map(id => S.history.find(h => h.id === id));
    if (!a || !b) { host.appendChild(el('p', 'sl-empty-note', 'One of those analyses is no longer stored.')); return; }
    if (a.capture.view !== b.capture.view || a.capture.surface !== b.capture.surface) {
        host.appendChild(el('p', 'sl-empty-note',
            `These are not comparable: ${a.capture.view}/${a.capture.surface} against ${b.capture.view}/${b.capture.surface}.`));
        return;
    }
    host.appendChild(el('p', 'sl-empty-note',
        `${a.label || 'A'} (${fmtDateTime(a.createdAt)}) against ${b.label || 'B'} (${fmtDateTime(b.createdAt)}). `
        + 'A change smaller than the two intervals combined is reported as no measurable change, because that is what it is.'));

    const wrap = el('div', 'sl-tablewrap');
    const t = el('table', 'sl-datatable');
    const head = document.createElement('tr');
    ['Measurement', 'Earlier', 'Later', 'Change'].forEach(h => head.appendChild(el('th', '', h)));
    t.appendChild(head);
    const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
    for (const spec of METRICS) {
        const ma = older.metrics[spec.id], mb = newer.metrics[spec.id];
        if (!ma || !mb) continue;
        const sa = ma.sided ? ma.sides.L : ma.combined;
        const sb = mb.sided ? mb.sides.L : mb.combined;
        if (!sa || !sb || sa.value == null || sb.value == null) continue;
        const d = sb.value - sa.value;
        const combined = Math.hypot(sa.ci95 || 0, sb.ci95 || 0);
        const cls = Math.abs(d) <= combined ? 'same' : 'better';
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', spec.label));
        tr.appendChild(el('td', '', fmt(sa.value, spec.decimals)));
        tr.appendChild(el('td', '', fmt(sb.value, spec.decimals)));
        tr.appendChild(el('td', `sl-delta ${cls}`,
            Math.abs(d) <= combined ? 'no measurable change' : `${d > 0 ? '+' : ''}${fmt(d, spec.decimals)}`));
        t.appendChild(tr);
    }
    wrap.appendChild(t);
    host.appendChild(wrap);
}

function renderSharedSummary(summary) {
    const host = $('sl-pane-findings');
    host.innerHTML = '';
    const box = el('div', 'sl-warnbox');
    box.appendChild(el('i', 'fas fa-link'));
    box.appendChild(el('div', '',
        'Shared summary. The numbers below came from the link, which carries them after the "#" and therefore never reached any server. There is no video and no keypoint data here — only the measurements.'));
    host.appendChild(box);
    const wrap = el('div', 'sl-tablewrap');
    const t = el('table', 'sl-datatable');
    const head = document.createElement('tr');
    ['Measurement', 'Left', 'Right', 'Confidence'].forEach(h => head.appendChild(el('th', '', h)));
    t.appendChild(head);
    for (const id of Object.keys(summary.m || {})) {
        const spec = METRIC_BY_ID[id];
        const vals = summary.m[id];
        if (!spec || !vals || !vals[0]) continue;
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', spec.label));
        tr.appendChild(el('td', '', vals[0] ? fmt(vals[0][0], spec.decimals) : '—'));
        tr.appendChild(el('td', '', vals[1] ? fmt(vals[1][0], spec.decimals) : '—'));
        tr.appendChild(el('td', '', vals[0] ? vals[0][2] : '—'));
        t.appendChild(tr);
    }
    wrap.appendChild(t);
    host.appendChild(wrap);
}

/* ============================================================
   Exports
   ============================================================ */

function wireExports() {
    $('sl-ex-json').addEventListener('click', () => {
        if (!S.result) return;
        const clean = { ...S.result };
        delete clean._internal;
        delete clean.series;
        download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }),
            `${slug($('sl-name').value)}.stridelab.json`);
    });
    $('sl-ex-csv').addEventListener('click', exportCsv);
    $('sl-ex-print').addEventListener('click', () => window.print());
    $('sl-ex-video').addEventListener('click', exportOverlayVideo);
    $('sl-ex-share').addEventListener('click', shareLink);
}

function exportCsv() {
    if (!S.result) return;
    const rows = [['metric', 'unit', 'side', 'value', 'ci95', 'sd', 'strides', 'confidence', 'note']];
    for (const spec of METRICS) {
        const m = S.result.metrics[spec.id];
        if (!m) continue;
        for (const [key, label] of (m.sided ? [['L', 'left'], ['R', 'right']] : [[null, 'both']])) {
            const s = key ? m.sides[key] : m.combined;
            if (!s) continue;
            rows.push([spec.id, spec.unit, label,
                s.value != null ? s.value : '', s.ci95 != null ? s.ci95 : '', s.sd != null ? s.sd : '',
                s.n, s.confidence, (s.note || '').replace(/"/g, "'")]);
        }
    }
    const csv = rows.map(r => r.map(v => `"${String(v)}"`).join(',')).join('\n');
    download(new Blob([csv], { type: 'text/csv' }), `${slug($('sl-name').value)}-metrics.csv`);
}

/**
 * Render the overlay to a WebM by drawing every frame into an offscreen canvas
 * and capturing its stream. Client-side, like everything else.
 */
async function exportOverlayVideo() {
    if (!playerState) return;
    const { series, result } = playerState;
    const w = 960;
    const h = Math.round(w * series.height / series.width);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const theme = playerState.theme;
    const fps = Math.min(60, result.capture.fps);

    const mime = ['video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { toast('This browser cannot record a video export.'); return; }
    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    rec.start();

    const video = (!playerState.synthetic && S.videoUrl) ? document.createElement('video') : null;
    if (video) {
        video.src = S.videoUrl; video.muted = true;
        await new Promise(r => { video.onloadedmetadata = r; });
    }

    toast('Rendering the overlay video…');
    const K = CANONICAL.length;
    for (let f = 0; f < series.n; f++) {
        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, w, h);
        if (video) {
            video.currentTime = series.t[f];
            await new Promise(r => { video.onseeked = r; setTimeout(r, 60); });
            try { ctx.drawImage(video, 0, 0, w, h); } catch { /* frame not ready */ }
        }
        const xy = new Float64Array(K * 2), vis = new Float64Array(K);
        for (let c = 0; c < K; c++) {
            xy[c * 2] = series.xy[(f * K + c) * 2];
            xy[c * 2 + 1] = series.xy[(f * K + c) * 2 + 1];
            vis[c] = series.vis[f * K + c];
        }
        drawOverlay(ctx, { xy, vis, w, h, theme, angles: anglesFor(result.capture.view), layers: { skeleton: true, angles: true, trails: false, events: false } });
        await new Promise(r => setTimeout(r, Math.max(4, 1000 / fps)));
    }
    rec.stop();
    await done;
    download(new Blob(chunks, { type: mime }), `${slug($('sl-name').value)}-overlay.webm`);
    toast('Overlay video saved.');
}

async function shareLink() {
    if (!S.result) return;
    const code = await store.makeShareCode(S.result);
    const url = `${location.origin}${location.pathname}#s=${code}`;
    const note = $('sl-share-note');
    note.hidden = false;
    if (url.length > 4000) {
        note.textContent = 'The summary is too large for a link. Export the JSON instead.';
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        note.textContent = 'Link copied. Everything travels after the "#", which browsers never send to a server — so the numbers reach whoever you send it to and nobody else.';
    } catch {
        note.textContent = url;
    }
}

async function exportBundle() {
    try {
        const blob = await store.exportBundle();
        download(blob, `stride-lab-export.${blob.type.includes('gzip') ? 'json.gz' : 'json'}`);
    } catch {
        toast('Nothing to export yet.');
    }
}

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s) => (s || 'analysis').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'analysis';

/* ============================================================
   Misc
   ============================================================ */

async function refreshStorage() {
    const r = await store.storageReport();
    const node = $('sl-storage');
    if (!r) { node.textContent = 'Storage usage is not reported by this browser.'; return; }
    node.textContent = `Using ${fmtBytes(r.usage)} of the ${fmtBytes(r.quota)} this browser allows`
        + `${r.persisted ? ', marked persistent' : '. Not marked persistent, so the browser may clear it'}`
        + `. Videos are kept for the most recent ${store.VIDEO_RETENTION} analyses only.`;
    if (r.fraction > 0.8) toast('Local storage is nearly full. Export and delete older analyses.');
}

function toast(msg) {
    const t = $('sl-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 5200);
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * The empty state is an invitation to act, not decoration: a small running
 * figure traced by the same overlay code the results use, so what the app does
 * is visible before anything is uploaded.
 */
function drawEmptyArt() {
    const canvas = $('sl-empty-canvas');
    if (!canvas) return;
    const g = synthGait({ fps: 60, durationS: 2.4, imageW: 640, imageH: 280, fillFrac: 0.78 });
    const theme = themeFrom(document.querySelector('.sl-app'));
    let f = 0, raf = null;
    const K = CANONICAL.length;

    const draw = () => {
        const r = canvas.getBoundingClientRect();
        if (!r.width) { raf = requestAnimationFrame(draw); return; }
        const ctx = fitCanvas(canvas, r.width, r.height);
        ctx.clearRect(0, 0, r.width, r.height);
        const box = contain(640, 280, r.width, r.height);
        ctx.strokeStyle = theme.line;
        ctx.beginPath();
        ctx.moveTo(box.x, box.y + box.h * 0.955);
        ctx.lineTo(box.x + box.w, box.y + box.h * 0.955);
        ctx.stroke();
        const xy = new Float64Array(K * 2), vis = new Float64Array(K);
        for (let c = 0; c < K; c++) {
            xy[c * 2] = g.series.xy[(f * K + c) * 2];
            xy[c * 2 + 1] = g.series.xy[(f * K + c) * 2 + 1];
            vis[c] = 1;
        }
        ctx.save();
        ctx.translate(box.x, box.y);
        drawOverlay(ctx, { xy, vis, w: box.w, h: box.h, theme, layers: { skeleton: true, angles: false, trails: false, events: false } });
        ctx.restore();
        f = (f + 1) % g.series.n;
        raf = requestAnimationFrame(draw);
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        f = 20;
        const r = canvas.getBoundingClientRect();
        const ctx = fitCanvas(canvas, r.width || 320, r.height || 140);
        const box = contain(640, 280, r.width || 320, r.height || 140);
        const xy = new Float64Array(K * 2), vis = new Float64Array(K).fill(1);
        for (let c = 0; c < K; c++) {
            xy[c * 2] = g.series.xy[(f * K + c) * 2];
            xy[c * 2 + 1] = g.series.xy[(f * K + c) * 2 + 1];
        }
        ctx.save(); ctx.translate(box.x, box.y);
        drawOverlay(ctx, { xy, vis, w: box.w, h: box.h, theme, layers: { skeleton: true } });
        ctx.restore();
        return;
    }
    draw();
    void raf;
    void APP_VERSION;
}
