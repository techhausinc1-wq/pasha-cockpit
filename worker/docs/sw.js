/* 210 Cockpit service worker
   Network-first for index.html (the app shell) so a deploy is never masked
   by a stale cache -- cache-first for genuinely static assets (logo,
   manifest). Network-first for any /api/* calls.
   Real bug fixed 2026-09-20: CACHE_VERSION was a hand-bumped string last
   updated 2026-06-09 ("dual-receipt") and never touched again despite
   months of real deploys since (WhatsApp notifications, the crash-handler
   fix, the supplier tracker, this file's own theme-picker fix) -- every
   one of those was silently invisible to any returning device until its
   cache happened to expire or get manually cleared. Switching index.html
   itself to network-first removes the need to remember a manual version
   bump ever again; CACHE_VERSION now only matters for the smaller static
   shell (logo/manifest), which changes rarely and safely falls back to
   cache if the network is down. */
const CACHE_VERSION = 'cockpit-v11-2026-09-20-network-first-shell';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './210-logo.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Network-first for any future API calls (currently no /api in the demo, but ready)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Network-first for the page itself (navigations + index.html) -- a
  // real deploy must always win over whatever was cached before. Falls
  // back to cache only if the network is genuinely unavailable (offline).
  const isAppShellPage = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if (isAppShellPage) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for genuinely static assets (logo, manifest, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
