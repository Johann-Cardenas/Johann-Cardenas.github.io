/* ============================================================
   Stride Lab — service worker.

   Scoped to this app's directory only. It must never claim the whole
   site: this worker knows nothing about the blog, the projects pages
   or the other E-Labs apps, and a root-scoped cache that did would be
   a way to serve somebody a stale version of a page it never meant to
   touch.

   Two caches, on purpose:
     - the app shell, revalidated in the background so a deploy is
       picked up on the next visit;
     - the pose model and its runtime, cached forever, because they
       are tens of megabytes, immutable at their versioned URLs, and
       the whole offline story rests on them.

   What this deliberately does NOT do: intercept anything outside its
   scope, or cache a POST. There is no POST in this app — that is the
   point of it.
   ============================================================ */

const SHELL = 'stride-lab-shell-v1';
const MODELS = 'stride-lab-models-v1';

const SHELL_FILES = [
    './',
    './index.html',
    './science.html',
    './styles.css',
    './science.css',
    './app.js',
    './manifest.webmanifest',
    './src/engine/types.js',
    './src/engine/version.js',
    './src/engine/analyze.js',
    './src/engine/signal/filter.js',
    './src/engine/signal/peaks.js',
    './src/engine/signal/condition.js',
    './src/engine/pose/skeleton.js',
    './src/engine/pose/mediapipe.js',
    './src/engine/decode/mp4.js',
    './src/engine/decode/frames.js',
    './src/engine/calib/scale.js',
    './src/engine/events/detect.js',
    './src/engine/events/stage2.js',
    './src/engine/metrics/angles.js',
    './src/engine/metrics/catalog.js',
    './src/engine/metrics/compute.js',
    './src/engine/scoring/norms.js',
    './src/engine/scoring/score.js',
    './src/engine/scoring/references.js',
    './src/engine/recommend/rules.js',
    './src/engine/recommend/exercises.js',
    './src/ui/pipeline.js',
    './src/ui/overlay.js',
    './src/ui/charts.js',
    './src/ui/store.js',
    './src/ui/format.js',
    './src/ui/demos.js',
    './src/ui/propose.js',
    './src/synth/gait.js',
    './workers/pose.worker.js',
    '../../assets/css/main.css'
];

/** Hosts whose responses are versioned and immutable, so cache-first is safe. */
const MODEL_HOSTS = [
    'cdn.jsdelivr.net',
    'storage.googleapis.com'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(async (f) => {
            try {
                /* `cache: 'reload'` is not optional here. cache.add() and a plain
                   fetch both consult the HTTP cache first, so a worker installing
                   right after a deploy will happily bake in the PREVIOUS build's
                   file and then serve it as though it were current — a stale
                   stylesheet that survives every subsequent reload, because the
                   worker is now the thing answering. Bypassing the HTTP cache on
                   install is what makes a new worker mean a new build. */
                const res = await fetch(f, { cache: 'reload' });
                if (res && res.ok) await c.put(f, res);
            } catch {
                /* one missing file must not fail the whole install and leave the
                   app with no worker at all */
            }
        }))).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(k => k.startsWith('stride-lab-') && k !== SHELL && k !== MODELS)
                .map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    /* A ranged request must go to the network untouched. `cache.match` would
       answer it with a whole 200, and a media element handed a 200 where it
       asked for bytes 0-1 stops seeking — Safari refuses to play at all. The
       demo clip is the only large media this app serves and it is fetched
       whole, into a blob, so nothing here needs a range; a worker that
       silently broke one if it did would be a trap for later. */
    if (req.headers.has('range')) return;

    const url = new URL(req.url);

    /* Model weights and the WASM runtime: cache-first and kept, because they
       are large, immutable at these URLs, and offline depends on them. */
    if (MODEL_HOSTS.includes(url.hostname)) {
        e.respondWith(
            caches.open(MODELS).then(async (cache) => {
                const hit = await cache.match(req);
                if (hit) return hit;
                const res = await fetch(req);
                if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
                return res;
            }).catch(() => fetch(req))
        );
        return;
    }

    /* Anything outside this worker's own scope is none of its business. */
    if (url.origin !== location.origin) return;

    /* Shell: serve from cache immediately, revalidate in the background, so a
       deploy is picked up on the next visit without ever blocking on network. */
    e.respondWith(
        caches.open(SHELL).then(async (cache) => {
            const hit = await cache.match(req, { ignoreSearch: true });
            const network = fetch(req).then((res) => {
                if (res && res.ok) cache.put(req, res.clone());
                return res;
            }).catch(() => null);
            return hit || network || new Response('Offline and not cached', { status: 504 });
        })
    );
});
