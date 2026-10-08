const SHELL_CACHE = 'mk-redway-shell-v36';
const OFFLINE_CACHE = 'mk-redway-offline-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './routing.js',
  './about.js',
  './data/data-meta.json',
  './DATA-LICENCE.md',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './vendor/leaflet-rotate.umd.min.js',
  './vendor/protomaps-leaflet.js',
  './vendor/images/layers.png',
  './vendor/images/layers-2x.png',
  './vendor/images/marker-icon.png',
  './vendor/images/marker-icon-2x.png',
  './vendor/images/marker-shadow.png',
  './manifest.webmanifest',
  './icons/app-logo.svg?v=0.14.6',
  './icons/icon-maskable-512.png?v=0.14.6',
  './icons/favicon.ico?v=0.14.6',
  './icons/favicon-16.png?v=0.14.6',
  './icons/favicon-32.png?v=0.14.6',
  './icons/icon-192.png?v=0.14.6',
  './icons/icon-512.png?v=0.14.6',
  './icons/apple-touch-icon.png?v=0.14.6',
  './icons/iphone16-splash.png?v=0.14.6'
];


self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, {cache: 'reload'})))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Retain a previously downloaded routing graph when replacing the app shell.
    const networkUrl = new URL('data/network.json', self.registration.scope).href;
    try {
      const offline = await caches.open(OFFLINE_CACHE);
      if (!await offline.match(networkUrl)) {
        const previous = await caches.match(networkUrl);
        if (previous?.ok) await offline.put(networkUrl, previous);
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('mk-redway-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    } catch (_) {
      // Keep older shells if their graph could not be safely retained.
    }
    await self.clients.claim();
  })());
});

async function openCache(name) {
  try { return await caches.open(name); } catch (_) { return null; }
}

async function matchCache(cache, request) {
  try { return await cache?.match(request); } catch (_) { return undefined; }
}

async function cachedOfflineMap() {
  const cache = await openCache(OFFLINE_CACHE);
  const url = new URL('data/mk-basemap.pmtiles', self.registration.scope).href;
  return matchCache(cache, url);
}

function rangeResponse(fullResponse, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match || (!match[1] && !match[2])) return Promise.resolve(fullResponse);
  return fullResponse.blob().then(blob => {
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : blob.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, blob.size - suffix);
      end = blob.size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= blob.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
    }
    end = Math.min(end, blob.size - 1);
    const slice = blob.slice(start, end + 1, fullResponse.headers.get('Content-Type') || 'application/octet-stream');
    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': slice.type || 'application/octet-stream',
        'Content-Length': String(slice.size),
        'Content-Range': `bytes ${start}-${end}/${blob.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=604800'
      }
    });
  });
}

async function handlePmtiles(request) {
  const cached = await cachedOfflineMap();
  if (request.method === 'HEAD') {
    if (cached) {
      const blob = await cached.blob();
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
          'Content-Length': String(blob.size),
          'Accept-Ranges': 'bytes'
        }
      });
    }
    return fetch(request);
  }
  const range = request.headers.get('Range');
  if (cached && range) return rangeResponse(cached, range);
  if (cached && !range && request.method === 'GET') return cached;
  return fetch(request);
}

// A full cache must not turn a successful network response into a failed request.
async function storeResponse(cache, request, response) {
  if (cache && response.ok && response.status !== 206) {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (url.pathname === new URL('data/mk-basemap.pmtiles', scope).pathname && ['GET', 'HEAD'].includes(request.method)) {
    event.respondWith(handlePmtiles(request).catch(() => Response.error()));
    return;
  }
  if (request.method !== 'GET') return;

  if (url.pathname === new URL('data/network.json', scope).pathname) {
    event.respondWith((async () => {
      const cache = await openCache(OFFLINE_CACHE);
      const key = new URL('data/network.json', scope).href;
      let response;
      try {
        response = await fetch(request);
        if (response.ok) {
          await storeResponse(cache, key, response);
          return response;
        }
      } catch (_) {}
      return (await matchCache(cache, key)) || (await matchCache(caches, key)) || response || Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await openCache(SHELL_CACHE);
    // Route handoff parameters belong to the URL, not to a separate app document.
    // Only the actual entry points may use this fallback; missing files stay missing.
    const isAppNavigation = request.mode === 'navigate' &&
      [scope.pathname, new URL('index.html', scope).pathname].includes(url.pathname);
    const key = isAppNavigation ? new URL('index.html', scope).href : request;
    const cached = await matchCache(cache, key);
    if (cached) return cached;
    const response = await fetch(request);
    await storeResponse(cache, key, response);
    return response;
  })());
});
