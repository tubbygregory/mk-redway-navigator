/* Independent runtime data presentation; never blocks navigation. */
(() => {
  'use strict';
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const date = value => {
    const parsed = value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value) : null;
    return parsed && Number.isFinite(parsed.getTime())
      ? parsed.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})
      : 'Date unavailable';
  };
  async function refresh() {
    text('aboutVersion', 'Version ' + document.getElementById('app').dataset.appVersion + ' · Beta');
    try {
      const response = await fetch('./data/data-meta.json');
      if (!response.ok) throw new Error('Metadata unavailable');
      const data = await response.json();
      text('aboutNetwork', date(data.network.generated_at) + (data.network.stale ? ' · Older saved data' : ''));
      text('aboutPlaces', date(data.places.source_timestamp) + (data.places.stale ? ' · Older mapped data' : ''));
      text('aboutMap', date(data.basemap.built_on));
      text('aboutCouncil', ({fresh: 'Latest extraction', cached: 'Last successful extraction', fallback: 'OSM classification fallback'})[data.council.status] || 'Status unavailable');
    } catch (_) {
      ['aboutNetwork', 'aboutPlaces', 'aboutMap', 'aboutCouncil'].forEach(id => text(id, 'Information unavailable'));
    }
    try {
      const cache = await caches.open('mk-redway-offline-v1');
      const saved = await cache.match(new URL('./data/mk-basemap.pmtiles', location.href).href);
      const network = await caches.match(new URL('./data/network.json', location.href).href);
      text('aboutOffline', saved && network ? 'Downloaded on this device' : 'Not downloaded');
      if (saved) {
        const stored = await cache.match(new URL('./data/data-meta.json', location.href).href);
        const savedData = stored ? await stored.json() : null;
        text('aboutMap', date(savedData?.basemap?.built_on) + ' · Downloaded map');
      }
    } catch (_) { text('aboutOffline', 'Storage unavailable'); }
  }
  document.getElementById('aboutData').addEventListener('toggle', event => {
    if (event.target.open) refresh();
  });

  function setupSettingsAdvertisement() {
    const sheet = document.getElementById('settingsSheet');
    const unit = document.getElementById('settingsAd');
    if (!sheet || !unit || !('IntersectionObserver' in window)) return;
    let requested = false;
    let loaded = document.readyState === 'complete';
    const request = () => {
      if (requested || !loaded || !navigator.onLine || document.hidden || sheet.hidden ||
          sheet.classList.contains('is-collapsed')) return;
      const bounds = unit.getBoundingClientRect();
      const panel = sheet.getBoundingClientRect();
      const heading = sheet.querySelector('.sheet-heading').getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 ||
          bounds.bottom <= Math.max(panel.top, heading.bottom, 0) ||
          bounds.top >= Math.min(panel.bottom, window.innerHeight)) return;
      requested = true;
      observer.disconnect();
      // The async bootstrap must finish before dispatch: a queued request could
      // otherwise be processed after Settings closes, when its width is zero.
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
    };
    const observer = new IntersectionObserver(request, {root: sheet});
    observer.observe(unit);
    sheet.addEventListener('scroll', request, {passive: true});
    window.addEventListener('load', () => { loaded = true; request(); }, {once: true});
    window.addEventListener('online', request);
    document.addEventListener('visibilitychange', request);
  }
  setupSettingsAdvertisement();
})();
