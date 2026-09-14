/* Independent runtime data presentation; never blocks navigation. */
(() => {
  'use strict';
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const date = value => {
    const parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime())
      ? parsed.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})
      : 'Date unavailable';
  };
  async function refresh() {
    try {
      const response = await fetch('./data/data-meta.json');
      if (!response.ok) throw new Error('Metadata unavailable');
      const data = await response.json();
      text('aboutVersion', 'Version ' + data.app_version + ' · Beta');
      text('aboutNetwork', date(data.network.generated_at) + (data.network.stale ? ' · Older saved data' : ''));
      text('aboutMap', date(data.basemap.built_on));
      text('aboutCouncil', ({fresh: 'Latest extraction', cached: 'Last successful extraction', fallback: 'OSM classification fallback'})[data.council.status] || 'Status unavailable');
    } catch (_) {
      text('aboutVersion', 'MK Redway Navigator · Beta');
      ['aboutNetwork', 'aboutMap', 'aboutCouncil'].forEach(id => text(id, 'Information unavailable'));
    }
    try {
      const cache = await caches.open('mk-redway-offline-v1');
      const saved = await cache.match(new URL('./data/mk-basemap.pmtiles', location.href).href);
      const network = await caches.match(new URL('./data/network.json', location.href).href);
      text('aboutOffline', saved && network ? 'Downloaded on this device' : 'Not downloaded');
    } catch (_) { text('aboutOffline', 'Storage unavailable'); }
  }
  document.getElementById('aboutData').addEventListener('toggle', event => {
    if (event.target.open) refresh();
  });
})();
