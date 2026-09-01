/* ============================================================
   Stride Lab — local storage.

   Everything lives in IndexedDB on the device. There is no account,
   no sync and no server, and that is a structural property of the
   app rather than a feature that could be switched on later.

   The honest consequence, stated in the UI and not buried: history
   lives in ONE browser on ONE device. Clearing site data deletes it.
   That is why export exists and why it is offered prominently rather
   than hidden in a settings page.
   ============================================================ */

const DB_NAME = 'stride-lab';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

/** Keep this many videos before the oldest is dropped. Videos are large. */
export const VIDEO_RETENTION = 5;

let dbPromise = null;

function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('analyses')) {
                const s = db.createObjectStore('analyses', { keyPath: 'id' });
                s.createIndex('byProfileDate', ['profileId', 'createdAt']);
                s.createIndex('byDate', 'createdAt');
            }
            if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
    return dbPromise;
}

function tx(store, mode, fn) {
    return open().then(db => new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        try { out = fn(s); } catch (e) { rej(e); return; }
        /* Unwrap the request whenever there IS one, including when it found
           nothing. Testing `out.result !== undefined` instead meant a miss
           resolved with the IDBRequest object, which is truthy: `getSetting`
           then read `.value` off a request, got undefined, and returned that
           rather than the caller's fallback — so on a first visit the units
           selector was set to undefined and rendered blank, and the
           active-profile lookup was handed a request object as a key and threw
           into a catch that swallowed it. A miss must resolve as undefined. */
        t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
    }));
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

/* ---------------- profiles ---------------- */

export async function saveProfile(profile) {
    const p = { ...profile, id: profile.id || uuid(), updatedAt: Date.now() };
    await tx('profiles', 'readwrite', s => s.put(p));
    await setSetting('activeProfile', p.id);
    return p;
}

export async function activeProfile() {
    const id = await getSetting('activeProfile');
    if (!id) return null;
    return tx('profiles', 'readonly', s => s.get(id));
}

/* ---------------- analyses ---------------- */

/**
 * Store an analysis. The heavy parts are separated deliberately:
 *
 *   - keypoints are kept as flat typed arrays. A 6 s clip at 240 fps is
 *     1440 frames x 17 keypoints x 3 floats, about 300 KB. Trivial.
 *   - the video is NOT kept unless the user opts in, and only the most
 *     recent few are retained, because a 6 s 4K clip is tens of megabytes
 *     and browser storage is a shared, evictable resource.
 */
export async function saveAnalysis(record, videoBlob) {
    const rec = { ...record, id: record.id || uuid(), schemaVersion: SCHEMA_VERSION };
    await tx('analyses', 'readwrite', s => s.put(rec));
    if (videoBlob) {
        await tx('videos', 'readwrite', s => s.put({ id: rec.id, blob: videoBlob, createdAt: rec.createdAt }));
        await pruneVideos();
    }
    return rec;
}

export function getAnalysis(id) { return tx('analyses', 'readonly', s => s.get(id)); }
export function getVideo(id) { return tx('videos', 'readonly', s => s.get(id)); }
export function deleteAnalysis(id) {
    return Promise.all([
        tx('analyses', 'readwrite', s => s.delete(id)),
        tx('videos', 'readwrite', s => s.delete(id))
    ]);
}

export async function listAnalyses() {
    const all = await tx('analyses', 'readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

async function pruneVideos() {
    const all = await tx('videos', 'readonly', s => s.getAll());
    if (!all || all.length <= VIDEO_RETENTION) return;
    const drop = all.sort((a, b) => b.createdAt - a.createdAt).slice(VIDEO_RETENTION);
    for (const v of drop) await tx('videos', 'readwrite', s => s.delete(v.id));
}

/* ---------------- settings ---------------- */

export async function getSetting(key, fallback = null) {
    const row = await tx('settings', 'readonly', s => s.get(key));
    return row ? row.value : fallback;
}
export function setSetting(key, value) {
    return tx('settings', 'readwrite', s => s.put({ key, value }));
}

/* ---------------- quota ---------------- */

export async function storageReport() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const est = await navigator.storage.estimate();
    let persisted = false;
    try { persisted = await navigator.storage.persisted(); } catch { /* not supported */ }
    return {
        usage: est.usage || 0,
        quota: est.quota || 0,
        fraction: est.quota ? (est.usage || 0) / est.quota : 0,
        persisted
    };
}

/** Ask the browser not to evict this history. It may refuse; that is fine. */
export async function requestPersistence() {
    try { return navigator.storage && navigator.storage.persist ? navigator.storage.persist() : false; }
    catch { return false; }
}

/* ---------------- export and import ---------------- */

/**
 * A single .stridelab.json bundle, gzipped where CompressionStream exists.
 * Videos are never included: they are the private part and they are enormous.
 * The schema is versioned from the first release and `migrate` exists before it
 * is needed, because the alternative is discovering it is needed after users
 * have data.
 */
export async function exportBundle() {
    const [profile, analyses] = await Promise.all([activeProfile(), listAnalyses()]);
    const payload = {
        format: 'stridelab-export',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        profile,
        analyses: analyses.map(a => ({ ...a, keypoints: serialiseKeypoints(a.keypoints) }))
    };
    const text = JSON.stringify(payload);
    if (typeof CompressionStream === 'undefined') {
        return new Blob([text], { type: 'application/json' });
    }
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob().then(b => new Blob([b], { type: 'application/gzip' }));
}

export async function importBundle(file) {
    let text;
    const raw = await file.arrayBuffer();
    const isGzip = new Uint8Array(raw)[0] === 0x1f && new Uint8Array(raw)[1] === 0x8b;
    if (isGzip && typeof DecompressionStream !== 'undefined') {
        const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(s).text();
    } else {
        text = new TextDecoder().decode(raw);
    }
    const data = migrate(JSON.parse(text));
    if (data.format !== 'stridelab-export') throw new Error('That file is not a Stride Lab export.');
    if (data.profile) await saveProfile(data.profile);
    let n = 0;
    for (const a of data.analyses || []) {
        await saveAnalysis({ ...a, keypoints: deserialiseKeypoints(a.keypoints) });
        n++;
    }
    return { imported: n };
}

/**
 * Schema migration. Written on day one, deliberately, because the moment it is
 * actually needed is the moment somebody already has data that would be lost.
 */
export function migrate(data) {
    let d = data;
    if (!d.schemaVersion) d = { ...d, schemaVersion: 1 };
    /* future: if (d.schemaVersion === 1) { ...; d.schemaVersion = 2; } */
    return d;
}

function serialiseKeypoints(k) {
    if (!k) return null;
    return {
        names: k.names,
        n: k.n, width: k.width, height: k.height,
        t: Array.from(k.t),
        xy: Array.from(k.xy).map(v => Math.round(v * 100000) / 100000),
        vis: Array.from(k.vis).map(v => Math.round(v * 1000) / 1000)
    };
}

function deserialiseKeypoints(k) {
    if (!k) return null;
    return {
        names: k.names, n: k.n, width: k.width, height: k.height,
        t: Float64Array.from(k.t),
        xy: Float64Array.from(k.xy),
        vis: Float64Array.from(k.vis)
    };
}

/* ---------------- share codes ---------------- */

/**
 * A metric summary after the '#'. URL fragments are NEVER sent to the server,
 * so a shared link leaks nothing to GitHub Pages or to anybody's logs. No
 * keypoints and no video go in: they would not fit and they should not travel.
 */
export async function makeShareCode(result) {
    const slim = {
        v: SCHEMA_VERSION,
        c: {
            view: result.capture.view, surface: result.capture.surface,
            fps: Math.round(result.capture.fps), speed: result.capture.speedMs
        },
        m: {}
    };
    for (const id of Object.keys(result.metrics)) {
        const m = result.metrics[id];
        const pick = (s) => (s && s.value != null ? [round(s.value), s.ci95 != null ? round(s.ci95) : null, s.confidence[0]] : null);
        slim.m[id] = m.sided ? [pick(m.sides.L), pick(m.sides.R)] : [pick(m.combined)];
    }
    const json = JSON.stringify(slim);
    const bytes = typeof CompressionStream !== 'undefined'
        ? new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
        : new TextEncoder().encode(json);
    return base64url(bytes);
}

export async function readShareCode(code) {
    const bytes = unbase64url(code);
    let json;
    if (typeof DecompressionStream !== 'undefined') {
        try {
            json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
        } catch { json = new TextDecoder().decode(bytes); }
    } else {
        json = new TextDecoder().decode(bytes);
    }
    return JSON.parse(json);
}

const round = (v) => Math.round(v * 1000) / 1000;

function base64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}
