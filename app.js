(() => {
  'use strict';

  const MK = { south: 51.955, west: -0.905, north: 52.155, east: -0.615 };
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  const map = L.map('map', { zoomControl: true }).setView([52.0406, -0.7594], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  const redwayLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);

  // Keep the app aligned to iOS Safari's changing visual viewport (address bar / keyboard).
  function syncViewport() {
    const height = window.visualViewport?.height || window.innerHeight;
    if (Number.isFinite(height) && height > 0) {
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    }
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }

  const el = id => document.getElementById(id);
  syncViewport();
  window.addEventListener('resize', syncViewport, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(syncViewport, 120), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport, { passive: true });
  }

  const routeSheet = el('routeSheet');
  const sheetToggle = el('sheetToggle');
  if (routeSheet && sheetToggle) {
    sheetToggle.addEventListener('click', () => {
      const collapsed = routeSheet.classList.toggle('sheet-collapsed');
      sheetToggle.textContent = collapsed ? 'Show controls' : 'Minimise controls';
      sheetToggle.setAttribute('aria-expanded', String(!collapsed));
      setTimeout(syncViewport, 220);
    });
  }

  const state = {
    mode: 'cycle',
    pref: 'maximum',
    selecting: 'start',
    start: null,
    end: null,
    startLabel: '',
    endLabel: '',
    redwayReady: false,
    routing: false,
    lastGeocodeAt: 0
  };

  function setStatus(msg, kind = '') {
    const s = el('status');
    s.textContent = msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }

  function pointLabel(which) {
    const point = state[which];
    const label = state[`${which}Label`];
    return point ? (label || fmtCoord(point)) : 'Search or tap the map';
  }

  function invalidateRoute() {
    routeLayer.clearLayers();
    el('stats').hidden = true;
  }

  function updatePointUI() {
    el('startText').textContent = pointLabel('start');
    el('endText').textContent = pointLabel('end');
    el('routeBtn').disabled = !(state.start && state.end) || state.routing;
    redrawMarkers();
  }

  function setSelecting(which) {
    state.selecting = which;
    el('startPoint').classList.toggle('active', which === 'start');
    el('endPoint').classList.toggle('active', which === 'end');
  }

  function redrawMarkers() {
    markerLayer.clearLayers();
    if (state.start) {
      L.circleMarker(state.start, {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#26734d',
        fillOpacity: 1
      }).addTo(markerLayer).bindTooltip('Start');
    }
    if (state.end) {
      L.circleMarker(state.end, {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#b3261e',
        fillOpacity: 1
      }).addTo(markerLayer).bindTooltip('Destination');
    }
  }

  function setPoint(which, latlng, label = '') {
    state[which] = L.latLng(latlng.lat, latlng.lng);
    state[`${which}Label`] = label;
    invalidateRoute();
    updatePointUI();
  }

  map.on('click', e => {
    const which = state.selecting;
    setPoint(which, e.latlng, 'Map pin');
    if (which === 'start') setSelecting('end');
  });

  ['startPoint', 'endPoint'].forEach(id => {
    const node = el(id);
    const which = id === 'startPoint' ? 'start' : 'end';
    node.addEventListener('click', () => setSelecting(which));
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSelecting(which);
      }
    });
  });

  el('cycleBtn').addEventListener('click', () => setMode('cycle'));
  el('walkBtn').addEventListener('click', () => setMode('walk'));

  function setMode(mode) {
    state.mode = mode;
    el('cycleBtn').classList.toggle('active', mode === 'cycle');
    el('walkBtn').classList.toggle('active', mode === 'walk');
    invalidateRoute();
  }

  document.querySelectorAll('[data-pref]').forEach(b => b.addEventListener('click', () => {
    state.pref = b.dataset.pref;
    document.querySelectorAll('[data-pref]').forEach(x => x.classList.toggle('active', x === b));
    invalidateRoute();
  }));

  el('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('This browser does not expose location. Search for a start address/postcode or tap the map instead.', 'warn');
      return;
    }
    setStatus('Requesting your location…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setPoint('start', L.latLng(pos.coords.latitude, pos.coords.longitude), 'Current location');
        setSelecting('end');
        map.setView(state.start, 15);
        setStatus('Current location set as the start. Search for a destination or tap the map.', 'good');
      },
      () => setStatus('Location was unavailable. Search for your start address/postcode instead.', 'warn'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function conciseResultName(result) {
    const a = result.address || {};
    const parts = [];
    if (a.house_number || a.road) parts.push([a.house_number, a.road].filter(Boolean).join(' '));
    const locality = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city;
    if (locality) parts.push(locality);
    if (a.postcode) parts.push(a.postcode);
    return parts.filter(Boolean).join(', ') || result.display_name;
  }

  function secondaryResultName(result, primary) {
    if (!result.display_name || result.display_name === primary) return 'Milton Keynes';
    const text = result.display_name;
    return text.length > 105 ? text.slice(0, 102) + '…' : text;
  }

  async function geocode(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const elapsed = Date.now() - state.lastGeocodeAt;
    if (elapsed < 1050) await sleep(1050 - elapsed);
    state.lastGeocodeAt = Date.now();

    const params = new URLSearchParams({
      q: trimmed,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'gb',
      viewbox: `${MK.west},${MK.north},${MK.east},${MK.south}`,
      bounded: '1',
      'accept-language': 'en-GB'
    });

    const response = await fetch(`${NOMINATIM}?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Address search returned ${response.status}`);
    return response.json();
  }

  function renderSearchResults(which, results) {
    const box = el(which === 'start' ? 'startResults' : 'endResults');
    box.innerHTML = '';
    box.hidden = false;

    if (!results.length) {
      const message = document.createElement('div');
      message.className = 'search-message';
      message.textContent = 'No Milton Keynes match found. Try the full postcode or include the house number and street.';
      box.appendChild(message);
      return;
    }

    for (const result of results) {
      const primary = conciseResultName(result);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';

      const strong = document.createElement('strong');
      strong.textContent = primary;
      const small = document.createElement('small');
      small.textContent = secondaryResultName(result, primary);
      button.append(strong, small);

      button.addEventListener('click', () => {
        const lat = Number(result.lat);
        const lng = Number(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setPoint(which, L.latLng(lat, lng), primary);
        setSelecting(which === 'start' ? 'end' : 'end');
        box.hidden = true;
        map.setView([lat, lng], 16);
        const input = el(which === 'start' ? 'startSearch' : 'endSearch');
        input.value = primary;
        setStatus(`${which === 'start' ? 'Start' : 'Destination'} set to ${primary}.`, 'good');
      });

      box.appendChild(button);
    }
  }

  async function runSearch(which) {
    const input = el(which === 'start' ? 'startSearch' : 'endSearch');
    const button = input.closest('form').querySelector('.search-button');
    const query = input.value.trim();
    if (!query) {
      input.focus();
      return;
    }

    button.disabled = true;
    setStatus(`Searching Milton Keynes for “${query}”…`);
    try {
      const results = await geocode(query);
      renderSearchResults(which, results);
      setStatus(results.length
        ? `Found ${results.length} possible match${results.length === 1 ? '' : 'es'}. Choose the correct one.`
        : 'No Milton Keynes address/postcode match found.',
        results.length ? '' : 'warn');
    } catch (err) {
      console.error(err);
      const box = el(which === 'start' ? 'startResults' : 'endResults');
      box.hidden = false;
      box.innerHTML = '<div class="search-message">Address search is temporarily unavailable. You can still set the point by tapping the map.</div>';
      setStatus('Address search is temporarily unavailable. Try again shortly or tap the map.', 'warn');
    } finally {
      button.disabled = false;
    }
  }

  el('startSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    runSearch('start');
  });
  el('endSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    runSearch('end');
  });

  document.addEventListener('click', e => {
    for (const [formId, resultsId] of [['startSearchForm', 'startResults'], ['endSearchForm', 'endResults']]) {
      const form = el(formId);
      if (!form.contains(e.target)) el(resultsId).hidden = true;
    }
  });

  async function overpass(query) {
    let lastErr;
    for (const endpoint of OVERPASS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: 'data=' + encodeURIComponent(query),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Overpass unavailable');
  }

  function parseWays(data) {
    const nodes = new Map();
    const ways = [];
    for (const x of data.elements || []) {
      if (x.type === 'node') nodes.set(x.id, { id: x.id, lat: x.lat, lon: x.lon });
    }
    for (const x of data.elements || []) {
      if (x.type === 'way' && x.nodes && x.nodes.length > 1) ways.push({ id: x.id, nodes: x.nodes, tags: x.tags || {} });
    }
    return { nodes, ways };
  }

  async function loadRedways() {
    const q = `[out:json][timeout:25];(way["highway"]["foot"="designated"]["bicycle"="designated"](${MK.south},${MK.west},${MK.north},${MK.east}););(._;>;);out body;`;
    try {
      const parsed = parseWays(await overpass(q));
      let count = 0;
      for (const w of parsed.ways) {
        const pts = w.nodes.map(id => parsed.nodes.get(id)).filter(Boolean).map(n => [n.lat, n.lon]);
        if (pts.length < 2) continue;
        L.polyline(pts, { className: 'redway-casing', interactive: false }).addTo(redwayLayer);
        L.polyline(pts, { className: 'redway-line', interactive: false }).addTo(redwayLayer);
        count++;
      }
      state.redwayReady = true;
      setStatus(`Loaded ${count.toLocaleString()} mapped Redway candidate segments. Search for a start and destination, or tap the map.`, 'good');
    } catch (e) {
      state.redwayReady = false;
      setStatus('The Redway overlay could not be loaded from OpenStreetMap right now. Routing can still be attempted after you set two points.', 'warn');
      console.error(e);
    }
  }

  function hav(a, b) {
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const isRedway = t => ['path', 'cycleway', 'footway'].includes(t.highway) && t.bicycle === 'designated' && t.foot === 'designated';

  function allowed(t, mode) {
    const h = t.highway || '';
    if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(h)) return false;
    if (t.access === 'private' || t.access === 'no') return false;
    if (mode === 'cycle') {
      if (t.bicycle === 'no' || t.bicycle === 'private' || h === 'steps') return false;
      if (['footway', 'pedestrian'].includes(h) && !['yes', 'designated', 'permissive'].includes(t.bicycle)) return false;
      if (h === 'path' && !['yes', 'designated', 'permissive'].includes(t.bicycle)) return false;
    } else if (t.foot === 'no' || t.foot === 'private') return false;
    return true;
  }

  function edgeClass(t) {
    const h = t.highway || '';
    if (isRedway(t)) return 'redway';
    if (['cycleway', 'footway', 'path', 'pedestrian', 'bridleway', 'track'].includes(h)) return 'trafficfree';
    if (['living_street', 'residential', 'service'].includes(h)) return 'quiet';
    if (h === 'unclassified') return 'road';
    if (['tertiary', 'tertiary_link'].includes(h)) return 'tertiary';
    if (['secondary', 'secondary_link'].includes(h)) return 'secondary';
    if (['primary', 'primary_link'].includes(h)) return 'primary';
    return 'road';
  }

  function multiplier(cls, pref, mode) {
    if (mode === 'walk') {
      return { redway: .94, trafficfree: 1, quiet: 1.08, road: 1.12, tertiary: 1.18, secondary: 1.24, primary: 1.35 }[cls] || 1.2;
    }
    const table = {
      maximum: { redway: .72, trafficfree: .93, quiet: 4.0, road: 5.5, tertiary: 8, secondary: 13, primary: 24 },
      balanced: { redway: .84, trafficfree: .98, quiet: 1.7, road: 2.1, tertiary: 2.8, secondary: 4.3, primary: 9 },
      fastest: { redway: 1, trafficfree: 1.04, quiet: 1.10, road: 1.13, tertiary: 1.18, secondary: 1.3, primary: 1.6 }
    };
    return table[pref][cls] || 2;
  }

  function buildGraph(parsed, mode, pref) {
    const graph = new Map();
    const add = (id, edge) => {
      if (!graph.has(id)) graph.set(id, []);
      graph.get(id).push(edge);
    };
    for (const w of parsed.ways) {
      const t = w.tags || {};
      if (!allowed(t, mode)) continue;
      const cls = edgeClass(t);
      const reverse = t.oneway === '-1';
      const oneWay = mode === 'cycle' && ['yes', '1', 'true', '-1'].includes(t.oneway) && t['oneway:bicycle'] !== 'no';
      for (let i = 0; i < w.nodes.length - 1; i++) {
        const ida = w.nodes[i];
        const idb = w.nodes[i + 1];
        const a = parsed.nodes.get(ida);
        const b = parsed.nodes.get(idb);
        if (!a || !b) continue;
        const d = hav(a, b);
        const eAB = { to: idb, d, cost: d * multiplier(cls, pref, mode), cls };
        const eBA = { to: ida, d, cost: d * multiplier(cls, pref, mode), cls };
        if (!oneWay) {
          add(ida, eAB);
          add(idb, eBA);
        } else if (reverse) add(idb, eBA);
        else add(ida, eAB);
      }
    }
    return graph;
  }

  function nearestNode(parsed, latlng, graph) {
    let best = null;
    let bd = Infinity;
    for (const [id, n] of parsed.nodes) {
      if (!graph.has(id)) continue;
      const d = hav({ lat: latlng.lat, lon: latlng.lng }, n);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return { id: best, d: bd };
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(x, p) {
      const n = { x, p };
      this.a.push(n);
      let i = this.a.length - 1;
      while (i) {
        const q = (i - 1) >> 1;
        if (this.a[q].p <= p) break;
        this.a[i] = this.a[q];
        i = q;
      }
      this.a[i] = n;
    }
    pop() {
      if (!this.a.length) return null;
      const root = this.a[0];
      const last = this.a.pop();
      if (this.a.length) {
        let i = 0;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          if (l >= this.a.length) break;
          const c = r < this.a.length && this.a[r].p < this.a[l].p ? r : l;
          if (this.a[c].p >= last.p) break;
          this.a[i] = this.a[c];
          i = c;
        }
        this.a[i] = last;
      }
      return root.x;
    }
    get length() { return this.a.length; }
  }

  function aStar(parsed, graph, startId, endId) {
    const open = new MinHeap();
    const g = new Map([[startId, 0]]);
    const prev = new Map();
    const prevEdge = new Map();
    const closed = new Set();
    open.push(startId, 0);
    const goal = parsed.nodes.get(endId);
    let loops = 0;

    while (open.length && loops++ < 750000) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      if (cur === endId) break;
      closed.add(cur);
      for (const e of graph.get(cur) || []) {
        if (closed.has(e.to)) continue;
        const ng = g.get(cur) + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          prev.set(e.to, cur);
          prevEdge.set(e.to, e);
          const n = parsed.nodes.get(e.to);
          open.push(e.to, ng + hav(n, goal) * .70);
        }
      }
    }

    if (!prev.has(endId) && startId !== endId) return null;
    const ids = [endId];
    const edges = [];
    let c = endId;
    while (c !== startId) {
      edges.push(prevEdge.get(c));
      c = prev.get(c);
      if (c == null) return null;
      ids.push(c);
    }
    ids.reverse();
    edges.reverse();
    return { ids, edges };
  }

  function corridorBBox(a, b) {
    const minLat = Math.min(a.lat, b.lat);
    const maxLat = Math.max(a.lat, b.lat);
    const minLon = Math.min(a.lng, b.lng);
    const maxLon = Math.max(a.lng, b.lng);
    const straight = hav({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    const pad = Math.max(.018, Math.min(.055, straight / 110000 * .5));
    return { s: minLat - pad, w: minLon - pad, n: maxLat + pad, e: maxLon + pad };
  }

  async function calculate() {
    if (!state.start || !state.end || state.routing) return;
    state.routing = true;
    el('routeBtn').disabled = true;
    invalidateRoute();
    try {
      const box = corridorBBox(state.start, state.end);
      setStatus('Loading nearby walk/cycle paths and connecting roads…');
      const h = 'path|cycleway|footway|pedestrian|bridleway|track|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link';
      const q = `[out:json][timeout:30];way["highway"~"^(${h})$"](${box.s},${box.w},${box.n},${box.e});(._;>;);out body;`;
      const parsed = parseWays(await overpass(q));
      setStatus(`Building route graph from ${parsed.ways.length.toLocaleString()} nearby ways…`);
      const graph = buildGraph(parsed, state.mode, state.pref);
      const s = nearestNode(parsed, state.start, graph);
      const e = nearestNode(parsed, state.end, graph);
      if (!s.id || !e.id) throw new Error('No routable path near one of the selected points.');
      if (s.d > 800 || e.d > 800) throw new Error('One selected point is too far from the loaded walking/cycling network.');
      const result = aStar(parsed, graph, s.id, e.id);
      if (!result) throw new Error('No route was found in this corridor. Try Balanced/Fastest or choose points closer to the MK network.');

      const coords = result.ids.map(id => {
        const n = parsed.nodes.get(id);
        return [n.lat, n.lon];
      });
      L.polyline(coords, { className: 'route-casing', interactive: false }).addTo(routeLayer);
      L.polyline(coords, { className: 'route-line', interactive: false }).addTo(routeLayer);

      let dist = 0;
      let tf = 0;
      for (const ed of result.edges) {
        dist += ed.d;
        if (ed.cls === 'redway' || ed.cls === 'trafficfree') tf += ed.d;
      }
      const speed = state.mode === 'cycle' ? 4.17 : 1.34;
      const mins = Math.max(1, Math.round(dist / speed / 60));
      el('distanceStat').textContent = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
      el('timeStat').textContent = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
      el('redwayStat').textContent = `${Math.round(tf / dist * 100)}%`;
      el('stats').hidden = false;
      map.fitBounds(L.latLngBounds(coords).pad(.08), { maxZoom: 16 });
      setStatus(`Route found. Start/end were snapped ${Math.round(s.d)} m and ${Math.round(e.d)} m to the routable network.`, 'good');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Routing failed. The public OpenStreetMap data service may be busy; try again shortly.', 'warn');
    } finally {
      state.routing = false;
      updatePointUI();
    }
  }

  el('routeBtn').addEventListener('click', calculate);

  el('clearBtn').addEventListener('click', () => {
    state.start = null;
    state.end = null;
    state.startLabel = '';
    state.endLabel = '';
    state.selecting = 'start';
    el('startSearch').value = '';
    el('endSearch').value = '';
    el('startResults').hidden = true;
    el('endResults').hidden = true;
    invalidateRoute();
    markerLayer.clearLayers();
    setSelecting('start');
    updatePointUI();
    setStatus(state.redwayReady ? 'Route cleared. Search for a start address/postcode or tap the map.' : 'Route cleared. Redway overlay is still loading.');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }

  updatePointUI();
  loadRedways();
})();
