const SHELL_CACHE = 'mk-redway-shell-v14';
const OFFLINE_CACHE = 'mk-redway-offline-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/app-logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/iphone16-splash.png'
];
const EXTERNAL_ASSETS = new Set([
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.2.4/dist/leaflet-rotate.umd.min.js',
  'https://unpkg.com/protomaps-leaflet@5.1.0/dist/protomaps-leaflet.js'
]);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('mk-redway-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

async function cachedOfflineMap() {
  const cache = await caches.open(OFFLINE_CACHE);
  const url = new URL('data/mk-basemap.pmtiles', self.registration.scope).href;
  return cache.match(url);
}

function rangeResponse(fullResponse, rangeHeader) {
  return fullResponse.blob().then(blob => {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
    if (!match) return fullResponse;
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

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.pathname.endsWith('/data/mk-basemap.pmtiles') && ['GET', 'HEAD'].includes(request.method)) {
    event.respondWith(handlePmtiles(request).catch(() => Response.error()));
    return;
  }

  if (request.method !== 'GET') return;

  if (url.origin === self.location.origin && url.pathname.endsWith('/data/network.json')) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  if (EXTERNAL_ASSETS.has(url.href)) {
    event.respondWith((async () => {
      const offline = await caches.open(OFFLINE_CACHE);
      const cached = await offline.match(request) || await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
      return response;
    }))
  );
});
