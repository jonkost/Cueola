/* Cueola offline shell — dependency-free and intentionally same-origin only. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './script-operator.html',
  './outrangutan/output.html',
  './manifest.webmanifest',
  './assets/Brand/Cueola_Icon.svg',
  // Script Operator controls must retain deterministic SF Symbol masks when
  // the dedicated window is opened for the first time while offline.
  './design-system/apple/symbols/runtime/light-small/objectsandtools/paperclip.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/xmark.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/trash.svg',
  './design-system/apple/symbols/runtime/light-small/editing/pencil.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.turn.up.right.fill.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.left.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.right.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/repeat.svg',
  './design-system/apple/symbols/runtime/light-small/editing/scissors.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrow.up.to.line.svg',
  './design-system/apple/symbols/runtime/light-small/media/display.svg',
  './design-system/apple/symbols/runtime/light-small/textformatting/list.bullet.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/circle.fill.svg',
  './design-system/apple/symbols/runtime/light-small/media/pause.svg',
  './design-system/apple/symbols/runtime/light-small/media/play.display.svg',
  './design-system/apple/symbols/runtime/light-small/media/stop.circle.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/bell.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/bell.badge.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/info.circle.svg',
  './design-system/apple/symbols/runtime/light-small/time/timer.svg',
  './design-system/apple/symbols/runtime/light-small/privacyandsecurity/exclamationmark.triangle.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/clock.svg',
  'assets/sf-symbols.css?v=4adcd0fd7c',
  // PDF export renderers — vendored same-origin so paperwork exports never
  // depend on CDN reachability during a show (pinned jspdf 2.5.1 / html2canvas 1.4.1).
  'assets/vendor/jspdf.umd.min.js',
  'assets/vendor/html2canvas.min.js',
  'cueola-entitlements.js?v=746c10a762',
  'cueola-avatar-profile.js?v=943c230239',
  'cueola-assignment-model.js?v=d81e0cf353',
  'cueola-export-model.js?v=b9bc3293de',
  'cueola-prepro-sync.js?v=2a99ec4a39',
  'cueola-identity.js?v=9c230d2c7a',
  'cueola-live-session.js?v=6a1ac2f19e',
  'cueola-prompter-session.js?v=1002259f73',
  'cueola-script-operator-protocol.js?v=209555b4d7',
  'script-operator.js?v=02e366509b',
  'script-operator.css?v=c455a9dec9',
  'outrangutan/output-protocol.js?v=515bfb5721',
  'outrangutan/output-command-queue.js?v=d3ef82b3a4',
  'outrangutan/stream-deck-label.js?v=c4ae3df80f',
  'cueola-app.js?v=7fda679abe',
  'outrangutan/outrangutan.css?v=b020d1d384',
  'outrangutan/outrangutan.js?v=57bf7b65d9',
];

const versionSignature = SHELL_ASSETS
  .map(path => new URL(path, self.location.href).searchParams.get('v'))
  .filter(Boolean)
  .join('-');
// Bumped for cache-policy OR page-HTML-only releases: the shell caches
// index.html/dashboard.html, whose content never feeds versionSignature —
// an HTML-only change must roll the cache name here (V2 Phase 3 learning d).
const WORKER_SCHEMA = '6';
const CACHE_NAME = `cueola-shell-${WORKER_SCHEMA}-${versionSignature || 'dev'}`;
const CACHE_PREFIX = 'cueola-shell-';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Firebase SDKs, Firestore, App Check, and the local emulator are different
  // origins and intentionally remain under their own networking/persistence.
  // restore-p2607.html is a recovery utility that must never be shell-cached.
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/restore-p2607.html')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      const shellPage = url.pathname.endsWith('/dashboard.html')
        ? './dashboard.html'
        : url.pathname.endsWith('/script-operator.html')
          ? './script-operator.html'
        : url.pathname.endsWith('/outrangutan/output.html')
          ? './outrangutan/output.html'
          : './index.html';
      return (await cache.match(shellPage)) || fetch(request);
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch (err) {
      throw err;
    }
  })());
});
