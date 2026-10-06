(() => {
  'use strict';
  const { parseBundledNetwork, hav, isRedway, allowed, edgeClass, multiplier, edgeDisplayName, buildGraph, nearestCandidates, aStarMulti, nearestNode, aStar, bearing, angleDiff, cardinal, buildCumulative, targetPhrase, buildManeuvers, initialInstruction, planRoute, routeErrorMessage, hasArrived, remainingJourney } = window.MKRouting;

  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

  const isStandalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const isIOS = /iP(?:hone|ad|od)/.test(navigator.userAgent);
  const isIOSStandalone = Boolean(isStandalone && isIOS);
  document.documentElement.classList.toggle('ios-standalone', isIOSStandalone);
  let appInstalled = Boolean(isStandalone);
  let deferredInstallPrompt = null;

  const MK = { south: 51.955, west: -0.905, north: 52.155, east: -0.615 };
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

  const el = id => document.getElementById(id);
  let searchRevision = 0;
  let startLocationRevision = 0;
  function cancelStartLocation() {
    startLocationRevision += 1;
    el('useLocationBtn').disabled = false;
  }
  let sheetGestureUntil = 0;
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    rotate: true,
    bearing: 0,
    dragRotate: false,
    shiftKeyRotate: false,
    touchRotate: false,
    rotateControl: false
  }).setView([52.0406, -0.7594], 12);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>');
  const onlineBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: ''
  }).addTo(map);
  let baseLayer = onlineBaseLayer;
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomright', metric: true, imperial: true, maxWidth: 120 }).addTo(map);
  let offlineVectorLayer = null;
  const OFFLINE_MAP_URL = './data/mk-basemap.pmtiles';
  const OFFLINE_CACHE = 'mk-redway-offline-v1';
  const SAVED_KEY = 'mk-redway-saved-v1';
  const SETTINGS_KEY = 'mk-redway-settings-v1';
  const INSTALL_OFFER_KEY = 'mk-redway-install-offer-v1';
  const LOCATION_HINT_KEY = 'mk-redway-location-hint-v1';
  const CULTURAL_ROUTES_URL = 'https://getaroundmk.org.uk/cycling/where-to-ride/cultural-routes';
  const CULTURAL_ROUTES = [
    {
      id: 'blue', color: 'Blue', title: 'Ancient & Modern Milton Keynes', fullMiles: 10, shortMiles: 5,
      tags: ['heritage'], highlights: ['Great Linford', 'Campbell Park', 'Concrete Cows', 'Bradwell Windmill'],
      fullGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-blue-main.gpx',
      shortGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-blue-short.gpx'
    },
    {
      id: 'yellow', color: 'Yellow', title: 'Cars, Boats & Trains', fullMiles: 9.4, shortMiles: 5,
      tags: ['heritage','lakes'], highlights: ['Newport Pagnell', 'Tongwell Lake', 'Willen Lake'],
      fullGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-yellow-main.gpx',
      shortGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-yellow-short.gpx'
    },
    {
      id: 'green', color: 'Green', title: 'Rivers, Lakes & Dinosaurs', fullMiles: 10.1, shortMiles: 5,
      tags: ['lakes'], highlights: ['Open University', 'Grand Union Canal', 'Peartree Bridge'],
      fullGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-green-main.gpx',
      shortGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-green-short.gpx'
    },
    {
      id: 'iron', color: 'Iron', title: 'Romans, Rivers, Trams & Trains', fullMiles: 9.5, shortMiles: 5,
      tags: ['heritage'], highlights: ['Wolverton Mill', 'Iron Trunk Aqueduct', 'Bancroft', 'Stony Stratford'],
      fullGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-iron-main.gpx',
      shortGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-iron-short.gpx'
    },
    {
      id: 'cornflower', color: 'Cornflower', title: 'Woods, Frogs & a Toot', fullMiles: 8.2, shortMiles: 4,
      tags: ['lakes'], highlights: ['Shenley Toot', 'Howe Park Wood', 'Teardrop Lakes', 'Furzton Lake'],
      fullGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-cornflower-main.gpx',
      shortGpx: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-cornflower-short.gpx'
    }
  ];

  const redwayLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const searchResultLayer = L.layerGroup().addTo(map);
  const userLayer = L.layerGroup().addTo(map);

  const state = {
    mode: 'cycle',
    pref: 'maximum',
    stage: 'explore',
    start: null,
    end: null,
    startLabel: '',
    endLabel: '',
    endAddress: '',
    route: null,
    routing: false,
    routeRevision: 0,
    pendingRoute: false,
    alternatives: [],
    editEndpoint: null,
    redwayReady: false,
    searchContext: 'destination',
    lastGeocodeAt: 0,
    watchId: null,
    navigating: false,
    voiceEnabled: true,
    units: 'metric',
    themeChoice: 'system',
    preferLit: false,
    preferSuper: false,
    lightingCoverage: 0,
    localSearchIndex: [],
    speechUnlocked: false,
    speechVoice: null,
    speechActive: null,
    speechQueue: [],
    speechSequence: 0,
    speechFailureNotified: false,
    lastSpokenText: '',
    lastSpokenAt: 0,
    followUser: true,
    userLatLng: null,
    userMarker: null,
    lastSegment: 0,
    navProgressMeters: 0,
    maneuverIndex: 0,
    announcedFar: new Set(),
    announcedNear: new Set(),
    offRouteCount: 0,
    lastRerouteAt: 0,
    lastPositionAt: 0,
    heading: null,
    lastHeadingFix: null,
    headingSupported: typeof map.setHeading === 'function' && typeof map.setBearing === 'function',
    toastTimer: null,
    routingNetwork: null,
    routingNetworkPromise: null,
    graphCache: new Map(),
    networkSource: 'loading',
    saved: { home: null, work: null, favourites: [] },
    pendingSaveKind: null,
    offlineMapAvailable: false,
    offlineMapDownloaded: false,
    offlineMapBytes: 0,
    offlineDownloadBusy: false,
    exploreFilter: 'all',
    importedRouteName: '',
    nightThemeActive: false
  };

  function syncViewport() {
    // The map shell itself is fixed by CSS and extends under the bottom safe area.
    // visualViewport is only used to constrain keyboard-sensitive result panels.
    const h = window.visualViewport?.height || window.innerHeight;
    if (Number.isFinite(h) && h > 0) {
      document.documentElement.style.setProperty('--visual-height', `${Math.round(h)}px`);
    }
    const search = el('homeSearch');
    if (search) {
      if (state.pendingSaveKind === 'home') search.placeholder = 'Search for Home';
      else if (state.pendingSaveKind === 'work') search.placeholder = 'Search for Work';
      else if (state.pendingSaveKind === 'favourite') search.placeholder = 'Search for a favourite';
      else search.placeholder = window.innerWidth <= 370
        ? 'Search places or postcodes'
        : 'Search places or postcodes';
    }
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }
  function refreshMapAfterOrientationChange() {
    setTimeout(() => {
      syncViewport();
      if (state.navigating && state.userLatLng) {
        followNavigationView(state.userLatLng, state.heading, false);
      } else if (state.route && state.stage === 'planner') {
        drawRoute(state.route.coords, true);
      }
    }, 220);
  }

  syncViewport();
  window.addEventListener('resize', syncViewport, { passive: true });
  window.addEventListener('orientationchange', refreshMapAfterOrientationChange, { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });

  function setStage(stage) {
    if (stage !== 'planner') cancelStartLocation();
    state.stage = stage;
    state.plannerSearchOpen = false;
    searchRevision += 1;
    el('app').dataset.stage = stage;
    el('exploreUI').hidden = !['explore', 'place'].includes(stage);
    el('plannerUI').hidden = stage !== 'planner';
    el('placeSheet').hidden = stage !== 'place';
    el('routeSheet').hidden = stage !== 'planner';
    const nav = stage === 'navigation';
    el('navBanner').hidden = !nav;
    el('navBottom').hidden = !nav;
    el('mapControls').hidden = !nav;
    el('browseMapControls').hidden = nav;
    if (nav) {
      el('mapKeyPopover').hidden = true;
      el('layersBtn').setAttribute('aria-expanded', 'false');
    }
    if (stage !== 'search-results') el('resultsSheet').hidden = true;
    if (stage !== 'explore') el('installSheet').hidden = true;
    if (!['explore', 'place'].includes(stage)) el('savedSheet').hidden = true;
    if (!['explore', 'place'].includes(stage)) el('settingsSheet').hidden = true;
    el('savedPlacesBtn').hidden = !['explore', 'place'].includes(stage);
    el('homeNav').hidden = !['explore', 'place'].includes(stage);
    if (!['explore','place'].includes(stage)) el('exploreSheet').hidden = true;
    el('app').dataset.exploreOpen = el('exploreSheet').hidden ? 'false' : 'true';
    updateInstallButtonVisibility();
    setTimeout(syncViewport, 40);
  }

  function toast(message, ms = 2600) {
    const t = el('toast');
    clearTimeout(state.toastTimer);
    t.textContent = message;
    t.hidden = false;
    state.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function setRouteStatus(msg, kind = '') {
    const n = el('routeStatus');
    n.textContent = msg;
    n.className = 'route-status' + (kind ? ` ${kind}` : '');
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (typeof raw.voiceEnabled === 'boolean') state.voiceEnabled = raw.voiceEnabled;
      if (raw.units === 'metric' || raw.units === 'imperial') state.units = raw.units;
      if (['system','light','dark','high-contrast'].includes(raw.themeChoice)) state.themeChoice = raw.themeChoice;
      if (typeof raw.preferLit === 'boolean') state.preferLit = raw.preferLit;
      if (typeof raw.preferSuper === 'boolean') state.preferSuper = raw.preferSuper;
    } catch (_) {}
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        voiceEnabled: state.voiceEnabled,
        units: state.units,
        themeChoice: state.themeChoice,
        preferLit: state.preferLit,
        preferSuper: state.preferSuper
      }));
    } catch (_) {}
  }

  function syncVoiceControls() {
    const navButton = el('voiceBtn');
    if (navButton) {
      navButton.classList.toggle('voice-on', state.voiceEnabled);
      navButton.classList.toggle('voice-off', !state.voiceEnabled);
      navButton.setAttribute('aria-label', state.voiceEnabled ? 'Mute voice guidance' : 'Enable voice guidance');
    }
    const settingButton = el('voiceSettingBtn');
    if (settingButton) {
      settingButton.classList.toggle('on', state.voiceEnabled);
      settingButton.setAttribute('aria-checked', state.voiceEnabled ? 'true' : 'false');
    }
  }

  function syncUnitControls() {
    document.querySelectorAll('[data-units]').forEach(button => {
      button.classList.toggle('active', button.dataset.units === state.units);
    });
  }

  function dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  }

  function solarEvent(date, lat, lon, sunrise) {
    const n = dayOfYear(date);
    const lngHour = lon / 15;
    const t = n + (((sunrise ? 6 : 18) - lngHour) / 24);
    const m = (0.9856 * t) - 3.289;
    let l = m + (1.916 * Math.sin(m * Math.PI / 180)) + (0.020 * Math.sin(2 * m * Math.PI / 180)) + 282.634;
    l = (l + 360) % 360;
    let ra = Math.atan(0.91764 * Math.tan(l * Math.PI / 180)) * 180 / Math.PI;
    ra = (ra + 360) % 360;
    ra += (Math.floor(l / 90) * 90) - (Math.floor(ra / 90) * 90);
    ra /= 15;
    const sinDec = 0.39782 * Math.sin(l * Math.PI / 180);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * Math.PI / 180) - (sinDec * Math.sin(lat * Math.PI / 180))) /
      (cosDec * Math.cos(lat * Math.PI / 180));
    if (cosH > 1 || cosH < -1) return null;
    let h = sunrise ? 360 - Math.acos(cosH) * 180 / Math.PI : Math.acos(cosH) * 180 / Math.PI;
    h /= 15;
    const localMean = h + ra - (0.06571 * t) - 6.622;
    const utcHours = ((localMean - lngHour) % 24 + 24) % 24;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0) + utcHours * 3600000);
  }

  function afterSunset() {
    const here = state.userLatLng || {lat: 52.0406, lng: -0.7594};
    const now = new Date();
    const sunset = solarEvent(now, here.lat, here.lng, false);
    const sunrise = solarEvent(now, here.lat, here.lng, true);
    return Boolean((sunset && now >= sunset) || (sunrise && now < sunrise));
  }

  function effectiveTheme() {
    if (state.themeChoice === 'high-contrast') return 'high-contrast';
    if (state.themeChoice === 'dark') return 'dark';
    if (state.themeChoice === 'light') return 'light';
    return darkQuery?.matches || (state.navigating && afterSunset()) ? 'dark' : 'light';
  }

  function applyTheme() {
    const theme = effectiveTheme();
    state.nightThemeActive = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    const themeColor = theme === 'high-contrast' ? '#000000' : theme === 'dark' ? '#11151a' : '#a9251d';
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = themeColor; });
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.classList.toggle('active', button.dataset.themeChoice === state.themeChoice);
    });
  }

  function setThemeChoice(choice) {
    if (!['system','light','dark','high-contrast'].includes(choice)) return;
    state.themeChoice = choice;
    persistSettings();
    applyTheme();
    if (offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
      map.removeLayer(offlineVectorLayer);
      offlineVectorLayer = null;
      if (!map.hasLayer(onlineBaseLayer)) onlineBaseLayer.addTo(map);
      baseLayer = onlineBaseLayer;
      activatePackagedBasemap().catch(console.warn);
    }
  }

  function syncRoutePreferenceControls() {
    const lit = el('preferLitBtn');
    const sup = el('preferSuperBtn');
    if (lit) {
      lit.setAttribute('aria-checked', String(state.preferLit));
      lit.classList.toggle('active', state.preferLit);
      const coverage = Math.round((state.lightingCoverage || 0) * 100);
      lit.title = coverage ? 'Uses explicit OSM lit tags; about ' + coverage + '% of mapped path ways have a lighting tag.' : 'Uses explicit OSM lighting tags where they are available.';
    }
    if (sup) {
      sup.setAttribute('aria-checked', String(state.preferSuper));
      sup.classList.toggle('active', state.preferSuper);
    }
  }

  function setVoiceEnabled(enabled, { announce = false } = {}) {
    state.voiceEnabled = Boolean(enabled);
    persistSettings();
    syncVoiceControls();
    if (!state.voiceEnabled) {
      clearSpeechQueue({ cancelActive: true });
    } else if (announce) {
      unlockSpeechFromGesture('Voice guidance on.');
    }
  }

  function setUnits(units) {
    if (units !== 'metric' && units !== 'imperial') return;
    state.units = units;
    persistSettings();
    syncUnitControls();
    refreshDistanceDisplays();
  }

  function loadSavedPlaces() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      state.saved = {
        home: raw.home || null,
        work: raw.work || null,
        favourites: Array.isArray(raw.favourites) ? raw.favourites.slice(0, 30) : []
      };
    } catch (_) {
      state.saved = { home: null, work: null, favourites: [] };
    }
  }

  function persistSavedPlaces() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved)); } catch (_) {}
    renderSavedPlaces();
  }

  function savedPlaceFromResult(result) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: conciseResultName(result),
      address: resultSecondary(result, conciseResultName(result)),
      lat, lng
    };
  }

  function savedPlaceFromCurrentEnd() {
    if (!state.end) return null;
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: state.endLabel || 'Saved place',
      address: state.endAddress || fmtCoord(state.end),
      lat: state.end.lat,
      lng: state.end.lng
    };
  }

  function showDestinationInContext(latlng) {
    const here = state.userLatLng || state.start;
    if (here) {
      map.fitBounds(L.latLngBounds([here, latlng]).pad(.16), { maxZoom: 15, padding: [28, 86] });
    } else {
      map.setView(latlng, 14);
    }
  }

  function openSavedPlace(place) {
    if (!place) return;
    const point = L.latLng(place.lat, place.lng);
    setPoint('end', point, place.name, place.address || '');
    el('homeSearch').value = place.name;
    el('savedSheet').hidden = true;
    showPlaceSheet();
    showDestinationInContext(point);
  }

  function renderSavedPlaces() {
    const home = state.saved.home;
    const work = state.saved.work;
    el('homeSavedLabel').textContent = home ? home.name : 'Not set';
    el('workSavedLabel').textContent = work ? work.name : 'Not set';
    const quick = el('quickPlaces');
    const quickHome = el('quickHomeBtn');
    const quickWork = el('quickWorkBtn');
    quickHome.hidden = !home;
    quickWork.hidden = !work;
    quick.querySelectorAll('.quick-favourite').forEach(button => button.remove());
    for (const place of state.saved.favourites.slice(0, 3)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-favourite';
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"></path></svg><span></span>';
      button.querySelector('span').textContent = place.name;
      button.addEventListener('click', () => openSavedPlace(place));
      quick.appendChild(button);
    }
    quick.hidden = !home && !work && !state.saved.favourites.length;
    const list = el('favouritesList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.saved.favourites.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'No favourites yet.';
      list.appendChild(empty);
      return;
    }
    for (const place of state.saved.favourites) {
      const row = document.createElement('div');
      row.className = 'saved-favourite-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'saved-favourite-open';
      open.innerHTML = '<span class="saved-kind-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"></path></svg></span><span class="saved-row-copy"><strong></strong><small></small></span>';
      open.querySelector('strong').textContent = place.name;
      open.querySelector('small').textContent = place.address || '';
      open.addEventListener('click', () => openSavedPlace(place));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.setAttribute('aria-label', `Remove ${place.name}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"></path></svg>';
      remove.addEventListener('click', () => {
        state.saved.favourites = state.saved.favourites.filter(x => x.id !== place.id);
        persistSavedPlaces();
      });
      row.append(open, remove);
      list.appendChild(row);
    }
  }

  function beginSavedSearch(kind) {
    state.pendingSaveKind = kind;
    el('savedSheet').hidden = true;
    setStage('explore');
    el('homeSearch').value = '';
    el('homeSearch').placeholder = kind === 'home' ? 'Search for Home' : kind === 'work' ? 'Search for Work' : 'Search for a favourite';
    el('homeSearch').focus();
  }

  function finishSavedSearch() {
    state.pendingSaveKind = null;
    el('homeSearch').value = '';
    el('homeSearch').placeholder = window.innerWidth <= 370 ? 'Search places or postcodes' : 'Search places or postcodes';
  }

  function setPoint(which, latlng, label = '', address = '') {
    if (which === 'start') cancelStartLocation();
    state[which] = L.latLng(latlng.lat, latlng.lng);
    state[`${which}Label`] = label || fmtCoord(state[which]);
    if (which === 'end') state.endAddress = address || label || '';
    invalidateRoute();
    updatePlannerFields();
    redrawMarkers();
  }

  function updatePlannerFields() {
    if (document.activeElement !== el('startSearch') && !(state.plannerSearchOpen && state.searchContext === 'start')) {
      el('startSearch').value = state.start ? (state.startLabel || 'Your location') : '';
    }
    if (document.activeElement !== el('endSearch') && !(state.plannerSearchOpen && state.searchContext === 'end')) {
      el('endSearch').value = state.end ? state.endLabel : '';
    }
  }

  function redrawMarkers() {
    markerLayer.clearLayers();
    if (state.start && !state.navigating) {
      L.circleMarker(state.start, { radius: 7, color: '#fff', weight: 3, fillColor: '#2457d6', fillOpacity: 1 })
        .addTo(markerLayer).bindTooltip('Start');
    }
    if (state.end) {
      L.circleMarker(state.end, { radius: 8, color: '#fff', weight: 3, fillColor: '#a9251d', fillOpacity: 1 })
        .addTo(markerLayer).bindTooltip(state.endLabel || 'Destination');
    }
  }

  function invalidateRoute() {
    routeLayer.clearLayers();
    state.routeRevision++;
    state.route = null;
    state.alternatives = [];
    el('routeAlternatives').replaceChildren();
    el('routeInsights').hidden = true;
    el('approachNote').hidden = true;
    el('roadStat').textContent = '—';
    el('retryRouteBtn').hidden = true;
    el('startNavBtn').disabled = true;
    el('sendToPhoneBtn').disabled = true;
    el('timeStat').textContent = '—';
    el('distanceStat').textContent = '—';
    el('redwayStat').textContent = '—';
    el('arrivalStat').textContent = 'Route preview';
  }

  function conciseResultName(result) {
    const a = result.address || {};
    const parts = [];
    const namedPlace = a.shop || a.amenity || a.tourism || a.leisure || a.office || a.building;
    if (namedPlace) parts.push(namedPlace);
    if (!namedPlace && result.name) parts.push(result.name);
    if (!parts.length && (a.house_number || a.road)) parts.push([a.house_number, a.road].filter(Boolean).join(' '));
    const locality = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city;
    if (locality && !parts.includes(locality)) parts.push(locality);
    if (a.postcode) parts.push(a.postcode);
    return parts.filter(Boolean).join(', ') || result.display_name;
  }

  function resultSecondary(result, primary) {
    const text = result.display_name || '';
    if (!text || text === primary) return 'Milton Keynes';
    return text.length > 130 ? `${text.slice(0, 127)}…` : text;
  }

  function resultTypeLabel(result) {
    const raw = String(result.type || result.addresstype || '').replaceAll('_', ' ');
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  }

  function resultOrigin() {
    return state.userLatLng || state.start || null;
  }

  function resultDistance(result) {
    const origin = resultOrigin();
    const lat = Number(result.lat), lon = Number(result.lon);
    return origin && Number.isFinite(lat) && Number.isFinite(lon)
      ? hav({lat: origin.lat, lon: origin.lng}, {lat, lon})
      : null;
  }

  function dedupeSearchResults(results) {
    const chosen = [];
    const ordered = [...results].sort((a, b) => (resultDistance(a) ?? Infinity) - (resultDistance(b) ?? Infinity));
    for (const result of ordered) {
      const primary = conciseResultName(result);
      const lat = Number(result.lat), lon = Number(result.lon);
      const duplicate = chosen.some(other =>
        conciseResultName(other).toLowerCase() === primary.toLowerCase() &&
        Number.isFinite(lat) && Number.isFinite(lon) &&
        hav({lat, lon}, {lat: Number(other.lat), lon: Number(other.lon)}) < 700
      );
      if (!duplicate) chosen.push(result);
      if (chosen.length >= 6) break;
    }
    return chosen;
  }

  function buildLocalSearchIndex(parsed) {
    const entries = [];
    const seen = new Set();
    let pathWays = 0;
    let litTaggedWays = 0;
    for (const way of parsed?.ways || []) {
      const tags = way.tags || {};
      if (['superredway','redway','leisure','shared'].includes(edgeClass(tags))) {
        pathWays += 1;
        if (['yes','no'].includes(String(tags.lit || '').toLowerCase())) litTaggedWays += 1;
      }
      const candidates = [
        [tags.name, 'Street or path'],
        [tags._mk_route_name, tags._mk_route_ref ? 'Super Route' : 'Route'],
        [tags._mk_route_ref, 'Super Route']
      ];
      const nodes = way.nodes.map(id => parsed.nodes.get(id)).filter(Boolean);
      if (!nodes.length) continue;
      const mid = nodes[Math.floor(nodes.length / 2)];
      for (const pair of candidates) {
        const textValue = String(pair[0] || '').trim();
        const type = pair[1];
        if (!textValue || textValue.length < 2) continue;
        const key = textValue.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          lat: mid.lat,
          lon: mid.lon,
          name: textValue,
          display_name: type === 'Super Route' ? textValue + ', Milton Keynes' : 'Milton Keynes',
          type,
          local: true
        });
      }
    }
    state.localSearchIndex = entries;
    state.lightingCoverage = pathWays ? litTaggedWays / pathWays : 0;
    syncRoutePreferenceControls();
  }

  function localSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const saved = [state.saved.home, state.saved.work, ...state.saved.favourites]
      .filter(Boolean)
      .map(place => ({
        lat: place.lat,
        lon: place.lng,
        name: place.name,
        display_name: place.address || 'Saved place',
        type: 'Saved place',
        local: true
      }));
    const ranked = [];
    for (const item of [...saved, ...state.localSearchIndex]) {
      const name = String(item.name || '').toLowerCase();
      const display = String(item.display_name || '').toLowerCase();
      const starts = name.startsWith(q);
      const includes = name.includes(q) || display.includes(q);
      if (!includes) continue;
      const d = resultDistance(item);
      ranked.push({item, score: (starts ? 0 : 10) + Math.max(0, name.indexOf(q)) + (Number.isFinite(d) ? Math.min(20, d / 1000) : 5)});
    }
    ranked.sort((a,b) => a.score - b.score);
    return dedupeSearchResults(ranked.map(x => x.item)).slice(0, 5);
  }

  function makeSuggestionButton(result, context) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'typeahead-item';
    button.innerHTML = '<span class="result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span><span class="result-copy"><strong></strong><small></small></span>';
    button.querySelector('strong').textContent = conciseResultName(result);
    const bits = [resultTypeLabel(result) || result.type];
    const d = resultDistance(result);
    if (Number.isFinite(d)) bits.push(formatDistance(d));
    button.querySelector('small').textContent = bits.filter(Boolean).join(' · ');
    button.addEventListener('click', () => {
      el('typeaheadSuggestions').hidden = true;
      selectSearchResult(result, context);
    });
    return button;
  }

  function renderTypeahead(input, context) {
    const results = localSuggestions(input.value);
    if (input === el('homeSearch')) {
      const box = el('typeaheadSuggestions');
      box.replaceChildren();
      for (const result of results) box.appendChild(makeSuggestionButton(result, context));
      box.hidden = !results.length;
      return;
    }
    if (input.value.trim().length < 2) return;
    openPlannerSearch(context);
    const list = el('resultsList');
    list.replaceChildren();
    el('resultsTitle').textContent = results.length ? 'Suggestions' : 'Search when ready';
    if (results.length) {
      for (const result of results) list.appendChild(makeSuggestionButton(result, context));
    } else {
      list.innerHTML = '<div class="result-message">Press Search for addresses and places. Suggestions are generated locally from the MK routing map.</div>';
    }
  }

  async function geocode(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const coordinates = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
    if (coordinates) {
      const lat = Number(coordinates[1]), lon = Number(coordinates[2]);
      if (lat < MK.south || lat > MK.north || lon < MK.west || lon > MK.east) return [];
      return [{lat, lon, name:'Map coordinates', display_name:trimmed}];
    }
    const elapsed = Date.now() - state.lastGeocodeAt;
    if (elapsed < 1050) await sleep(1050 - elapsed);
    state.lastGeocodeAt = Date.now();
    const params = new URLSearchParams({
      q: trimmed,
      format: 'jsonv2',
      addressdetails: '1',
      namedetails: '1',
      limit: '6',
      countrycodes: 'gb',
      viewbox: `${MK.west},${MK.north},${MK.east},${MK.south}`,
      bounded: '1',
      'accept-language': 'en-GB'
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${NOMINATIM}?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Search returned ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  function showResults(results, context, query) {
    state.searchContext = context;
    const list = el('resultsList');
    list.innerHTML = '';
    searchResultLayer.clearLayers();
    const displayResults = dedupeSearchResults(results);
    el('resultsTitle').textContent = displayResults.length ? `Results for “${query}”` : 'No matching places';

    if (!displayResults.length) {
      const msg = document.createElement('div');
      msg.className = 'result-message';
      msg.textContent = 'No Milton Keynes match found. Try a full postcode, street address or place name.';
      list.appendChild(msg);
    } else {
      displayResults.forEach((result, index) => {
        const primary = conciseResultName(result);
        const secondary = resultSecondary(result, primary);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result-item';
        button.innerHTML = `<span class="result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span><span class="result-copy"><strong></strong><span></span><small></small></span>`;
        button.querySelector('strong').textContent = primary;
        button.querySelector('.result-copy span').textContent = secondary;
        const bits = [resultTypeLabel(result)];
        const distance = resultDistance(result);
        if (Number.isFinite(distance)) bits.push(formatDistance(distance));
        button.querySelector('small').textContent = bits.filter(Boolean).join(' · ');
        button.addEventListener('click', () => selectSearchResult(result, context));
        list.appendChild(button);
        const lat = Number(result.lat), lon = Number(result.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const icon = L.divIcon({
            className: 'search-result-marker',
            html: '<span>' + String(index + 1) + '</span>',
            iconSize: [28, 28],
            iconAnchor: [14, 28]
          });
          L.marker([lat, lon], {icon}).addTo(searchResultLayer).on('click', () => selectSearchResult(result, context));
        }
      });
      const coords = displayResults
        .map(result => [Number(result.lat), Number(result.lon)])
        .filter(pair => pair.every(Number.isFinite));
      if (coords.length > 1) map.fitBounds(coords, {padding:[50,70], maxZoom:15});
    }
    el('resultsSheet').hidden = false;
  }

  function openPlannerSearch(context) {
    if (state.stage !== 'planner') return;
    if (context === 'start') cancelStartLocation();
    searchRevision += 1;
    setRouteSheetCollapsed(false);
    state.plannerSearchOpen = true;
    state.searchContext = context;
    el('routeSheet').hidden = true;
    el('resultsSheet').hidden = false;
    el('resultsTitle').textContent = context === 'start' ? 'Choose a starting point' : 'Choose a destination';
    el('resultsList').innerHTML = '<div class="result-message">Enter a place, address or postcode, then tap Search or use the keyboard’s search key.</div>';
  }

  function closeSearch() {
    searchRevision += 1;
    state.plannerSearchOpen = false;
    el('resultsSheet').hidden = true;
    el('typeaheadSuggestions').hidden = true;
    searchResultLayer.clearLayers();
    el('routeSheet').hidden = state.stage !== 'planner';
  }

  for (const [id, context] of [['startSearch', 'start'], ['endSearch', 'end']]) {
    const input = el(id);
    input.addEventListener('focus', () => openPlannerSearch(context));
    input.addEventListener('input', () => renderTypeahead(input, context));
  }
  el('homeSearch').addEventListener('input', () => {
    const context = state.pendingSaveKind ? 'save-' + state.pendingSaveKind : 'destination';
    renderTypeahead(el('homeSearch'), context);
  });

  async function runSearch(context, input) {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    el('typeaheadSuggestions').hidden = true;
    if (context === 'start' || context === 'end') openPlannerSearch(context);
    const revision = ++searchRevision;
    input.blur();
    el('resultsSheet').hidden = false;
    el('resultsTitle').textContent = 'Searching…';
    el('resultsList').innerHTML = '<div class="result-message">Searching Milton Keynes…</div>';
    try {
      const results = await geocode(query);
      if (revision !== searchRevision) return;
      showResults(results, context, query);
    } catch (err) {
      if (revision !== searchRevision) return;
      console.error(err);
      el('resultsTitle').textContent = 'Search unavailable';
      el('resultsList').innerHTML = '<div class="result-message">The public address-search service is temporarily unavailable. Try again shortly.</div>';
    }
  }

  function selectSearchResult(result, context) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const primary = conciseResultName(result);
    const secondary = resultSecondary(result, primary);
    closeSearch();

    if (context === 'save-home' || context === 'save-work' || context === 'save-favourite') {
      const place = savedPlaceFromResult(result);
      if (context === 'save-home') state.saved.home = place;
      else if (context === 'save-work') state.saved.work = place;
      else {
        const duplicate = state.saved.favourites.some(x => Math.abs(x.lat - place.lat) < 0.00002 && Math.abs(x.lng - place.lng) < 0.00002);
        if (!duplicate) state.saved.favourites.unshift(place);
      }
      persistSavedPlaces();
      finishSavedSearch();
      el('savedSheet').hidden = false;
      toast(context === 'save-home' ? 'Home saved' : context === 'save-work' ? 'Work saved' : 'Favourite saved');
      return;
    }

    if (context === 'destination') {
      setPoint('end', L.latLng(lat, lng), primary, secondary);
      el('homeSearch').value = primary;
      showPlaceSheet();
      showDestinationInContext(L.latLng(lat, lng));
    } else if (context === 'start') {
      setPoint('start', L.latLng(lat, lng), primary, secondary);
      setStage('planner');
      maybeCalculateRoute();
      map.setView([lat, lng], 15);
    } else {
      setPoint('end', L.latLng(lat, lng), primary, secondary);
      setStage('planner');
      maybeCalculateRoute();
      map.setView([lat, lng], 15);
    }
  }

  function showPlaceSheet() {
    el('placeName').textContent = state.endLabel || 'Dropped pin';
    el('placeAddress').textContent = state.endAddress || (state.end ? fmtCoord(state.end) : '');
    setStage('place');
  }


  function culturalRouteMatches(route) {
    if (state.exploreFilter === 'all') return true;
    if (state.exploreFilter === 'short') return route.shortMiles <= 5;
    return route.tags.includes(state.exploreFilter);
  }

  function renderCulturalRoutes() {
    const list = el('culturalRoutesList');
    if (!list) return;
    list.replaceChildren();
    for (const route of CULTURAL_ROUTES.filter(culturalRouteMatches)) {
      const card = document.createElement('article');
      card.className = 'cultural-route-card route-' + route.id;
      const header = document.createElement('div');
      header.className = 'cultural-route-heading';
      header.innerHTML = '<span class="cultural-swatch" aria-hidden="true"></span><div><strong></strong><small></small></div>';
      header.querySelector('strong').textContent = route.color + ' · ' + route.title;
      header.querySelector('small').textContent = route.fullMiles + ' mi full · ' + route.shortMiles + ' mi short';
      const highlights = document.createElement('p');
      highlights.textContent = route.highlights.join(' · ');
      const join = document.createElement('small');
      join.className = 'cultural-join';
      join.textContent = Number.isFinite(route.joinDistance)
        ? 'Nearest join ' + formatDistance(route.joinDistance) + ' away'
        : 'Choose a version to load the official GPX';
      const actions = document.createElement('div');
      actions.className = 'cultural-route-actions';
      const full = document.createElement('button');
      full.type = 'button';
      full.textContent = 'Full route';
      full.addEventListener('click', () => loadOfficialGpx(route, 'full'));
      const short = document.createElement('button');
      short.type = 'button';
      short.textContent = 'Short route';
      short.addEventListener('click', () => loadOfficialGpx(route, 'short'));
      const source = document.createElement('a');
      source.href = CULTURAL_ROUTES_URL;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Route guide';
      actions.append(full, short, source);
      card.append(header, highlights, join, actions);
      list.appendChild(card);
    }
  }

  function openExploreRoutes() {
    if (state.pendingSaveKind) finishSavedSearch();
    el('savedSheet').hidden = true;
    el('settingsSheet').hidden = true;
    el('installSheet').hidden = true;
    renderCulturalRoutes();
    hydrateCulturalRouteDistances().catch(() => {});
    el('exploreSheet').hidden = false;
    el('app').dataset.exploreOpen = 'true';
    el('goTabBtn').classList.remove('active');
    el('exploreRoutesBtn').classList.add('active');
    el('exploreRoutesBtn').setAttribute('aria-current', 'page');
    el('savedPlacesBtn').classList.remove('active');
    el('savedPlacesBtn').removeAttribute('aria-current');
    el('goTabBtn').removeAttribute('aria-current');
  }

  async function hydrateCulturalRouteDistances() {
    if (!state.userLatLng) return;
    let changed = false;
    for (const route of CULTURAL_ROUTES) {
      try {
        if (!route.fullCoords) {
          const response = await fetch(route.fullGpx, {headers:{Accept:'application/gpx+xml, application/xml, text/xml'}});
          if (!response.ok) continue;
          route.fullCoords = parseGpx(await response.text()).coords;
        }
        let best = Infinity;
        for (const pair of route.fullCoords || []) {
          best = Math.min(best, hav({lat:state.userLatLng.lat,lon:state.userLatLng.lng},{lat:pair[0],lon:pair[1]}));
        }
        if (Number.isFinite(best)) {
          route.joinDistance = best;
          changed = true;
        }
      } catch (_) {}
    }
    if (changed && !el('exploreSheet').hidden) {
      CULTURAL_ROUTES.sort((a,b) => (a.joinDistance ?? Infinity) - (b.joinDistance ?? Infinity));
      renderCulturalRoutes();
    }
  }

  function routeFromNearestPoint(coords) {
    if (!state.userLatLng || coords.length < 3) return coords;
    const first = coords[0], last = coords.at(-1);
    const closes = hav({lat:first[0],lon:first[1]},{lat:last[0],lon:last[1]}) < 250;
    if (!closes) return coords;
    let bestIndex = 0, best = Infinity;
    coords.forEach((pair,index) => {
      const d = hav({lat:state.userLatLng.lat,lon:state.userLatLng.lng},{lat:pair[0],lon:pair[1]});
      if (d < best) { best = d; bestIndex = index; }
    });
    const loop = coords.slice(0, -1);
    const rotated = [...loop.slice(bestIndex), ...loop.slice(0,bestIndex)];
    if (rotated.length) rotated.push(rotated[0]);
    return rotated;
  }

  function closeExploreRoutes() {
    el('exploreSheet').hidden = true;
    el('app').dataset.exploreOpen = 'false';
    el('exploreRoutesBtn').classList.remove('active');
    el('exploreRoutesBtn').removeAttribute('aria-current');
    el('goTabBtn').classList.add('active');
    el('goTabBtn').setAttribute('aria-current', 'page');
  }

  // All visible sheet handles share touch, mouse and keyboard behaviour.
  function setSheetCollapsed(sheet, collapsed) {
    const handle = sheet.querySelector('.sheet-handle');
    sheet.classList.toggle('is-collapsed', collapsed);
    handle.setAttribute('aria-expanded', String(!collapsed));
    handle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${handle.dataset.panelLabel}`);
    handle.querySelector('.sheet-handle-label').textContent = collapsed ? 'Show details' : 'Hide details';
    sheet.scrollTop = 0;
  }
  function setRouteSheetCollapsed(collapsed) {
    setSheetCollapsed(el('routeSheet'), collapsed);
  }
  document.querySelectorAll('.sheet-handle').forEach(handle => {
    const sheet = handle.closest('.bottom-sheet');
    let drag = null;
    handle.addEventListener('click', event => {
      // Pointer taps are handled on release: touch browsers may omit click after a swipe.
      // Native keyboard and assistive activation still use click (detail zero).
      if (event.detail === 0) setSheetCollapsed(sheet, !sheet.classList.contains('is-collapsed'));
    });
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      // Resizing moves the sheet away from the finger. Suppress compatibility
      // mouse events so they cannot activate the newly exposed map underneath.
      event.preventDefault();
      sheetGestureUntil = performance.now() + 700;
      handle.focus({preventScroll: true});
      drag = {id: event.pointerId, y: event.clientY};
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      sheetGestureUntil = performance.now() + 700;
      const dy = event.clientY - drag.y;
      drag = null;
      setSheetCollapsed(sheet, Math.abs(dy) >= 35 ? dy > 0 : !sheet.classList.contains('is-collapsed'));
    });
    handle.addEventListener('pointercancel', () => { drag = null; });
    handle.addEventListener('touchstart', event => event.stopPropagation(), {passive: true});
    handle.addEventListener('touchend', event => {
      event.preventDefault();
      event.stopPropagation();
    }, {passive: false});
    // Reopening a panel always reveals its controls and any new content.
    new MutationObserver(() => {
      if (!sheet.hidden) setSheetCollapsed(sheet, false);
    }).observe(sheet, {attributes: true, attributeFilter: ['hidden']});
  });

  el('homeSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    const context = state.pendingSaveKind ? `save-${state.pendingSaveKind}` : 'destination';
    runSearch(context, el('homeSearch'));
  });
  el('startSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    runSearch('start', el('startSearch'));
  });
  el('endSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    runSearch('end', el('endSearch'));
  });
  el('closeResults').addEventListener('click', () => {
    closeSearch();
    if (state.pendingSaveKind) { finishSavedSearch(); renderSavedPlaces(); el('savedSheet').hidden = false; }
  });
  el('closePlace').addEventListener('click', () => {
    state.end = null; state.endLabel = ''; state.endAddress = '';
    redrawMarkers();
    el('homeSearch').value = '';
    setStage('explore');
  });

  el('savedPlacesBtn').addEventListener('click', () => {
    if (state.pendingSaveKind) finishSavedSearch();
    closeExploreRoutes();
    renderSavedPlaces();
    el('settingsSheet').hidden = true;
    el('savedSheet').hidden = false;
    el('goTabBtn').classList.remove('active');
    el('goTabBtn').removeAttribute('aria-current');
    el('savedPlacesBtn').classList.add('active');
    el('savedPlacesBtn').setAttribute('aria-current', 'page');
  });
  el('closeSaved').addEventListener('click', () => {
    el('savedSheet').hidden = true;
    el('savedPlacesBtn').classList.remove('active');
    el('savedPlacesBtn').removeAttribute('aria-current');
    el('goTabBtn').classList.add('active');
    el('goTabBtn').setAttribute('aria-current', 'page');
  });
  function openSettings() {
    closeExploreRoutes();
    el('savedSheet').hidden = true;
    el('installSheet').hidden = true;
    syncVoiceControls();
    syncUnitControls();
    syncRoutePreferenceControls();
    applyTheme();
    probeOfflineMap().catch(() => {});
    el('settingsSheet').hidden = false;
  }

  el('visibleSettingsBtn').addEventListener('click', openSettings);
  el('closeSettings').addEventListener('click', () => { el('settingsSheet').hidden = true; });
  el('voiceSettingBtn').addEventListener('click', () => {
    setVoiceEnabled(!state.voiceEnabled, { announce: !state.voiceEnabled });
  });
  document.querySelectorAll('[data-units]').forEach(button => {
    button.addEventListener('click', () => setUnits(button.dataset.units));
  });
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => setThemeChoice(button.dataset.themeChoice));
  });
  document.querySelectorAll('[data-explore-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.exploreFilter = button.dataset.exploreFilter;
      document.querySelectorAll('[data-explore-filter]').forEach(x => x.classList.toggle('active', x === button));
      renderCulturalRoutes();
    });
  });
  el('exploreRoutesBtn').addEventListener('click', openExploreRoutes);
  el('closeExplore').addEventListener('click', closeExploreRoutes);
  el('goTabBtn').addEventListener('click', () => {
    closeExploreRoutes();
    el('savedSheet').hidden = true;
    el('savedPlacesBtn').classList.remove('active');
    el('savedPlacesBtn').removeAttribute('aria-current');
    el('settingsSheet').hidden = true;
    el('goTabBtn').classList.add('active');
    el('goTabBtn').setAttribute('aria-current', 'page');
    setStage('explore');
  });
  el('addFavouriteBtn').addEventListener('click', () => beginSavedSearch('favourite'));
  el('quickHomeBtn').addEventListener('click', () => openSavedPlace(state.saved.home));
  el('quickWorkBtn').addEventListener('click', () => openSavedPlace(state.saved.work));
  el('homeSavedRow').addEventListener('click', () => state.saved.home ? openSavedPlace(state.saved.home) : beginSavedSearch('home'));
  el('workSavedRow').addEventListener('click', () => state.saved.work ? openSavedPlace(state.saved.work) : beginSavedSearch('work'));
  el('saveFavouriteBtn').addEventListener('click', () => {
    const place = savedPlaceFromCurrentEnd();
    if (!place) return;
    const duplicate = state.saved.favourites.some(x => Math.abs(x.lat - place.lat) < 0.00002 && Math.abs(x.lng - place.lng) < 0.00002);
    if (!duplicate) state.saved.favourites.unshift(place);
    persistSavedPlaces();
    toast(duplicate ? 'Already saved' : 'Favourite saved');
  });

  map.on('click', e => {
    // Mobile map libraries may synthesise a delayed click after sheet resizing.
    if (performance.now() < sheetGestureUntil || e.originalEvent?.target?.closest?.('.bottom-sheet')) return;
    if (state.navigating) return;
    if (state.editEndpoint) {
      const which = state.editEndpoint; state.editEndpoint = null;
      setPoint(which, e.latlng, 'Chosen entrance', fmtCoord(e.latlng));
      setStage('planner'); maybeCalculateRoute(); return;
    }
    if (state.pendingSaveKind) {
      const place = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: 'Dropped pin', address: fmtCoord(e.latlng), lat: e.latlng.lat, lng: e.latlng.lng };
      if (state.pendingSaveKind === 'home') state.saved.home = place;
      else if (state.pendingSaveKind === 'work') state.saved.work = place;
      else state.saved.favourites.unshift(place);
      persistSavedPlaces(); finishSavedSearch(); el('savedSheet').hidden = false;
      return;
    }
  });

  async function reverseGeocode(latlng) {
    const elapsed = Date.now() - state.lastGeocodeAt;
    if (elapsed < 1050) await sleep(1050 - elapsed);
    state.lastGeocodeAt = Date.now();
    const params = new URLSearchParams({
      lat: String(latlng.lat),
      lon: String(latlng.lng),
      format: 'jsonv2',
      addressdetails: '1',
      namedetails: '1',
      zoom: '18',
      'accept-language': 'en-GB'
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${NOMINATIM_REVERSE}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function dropDestinationPin(latlng) {
    if (state.navigating || !['explore', 'place'].includes(state.stage)) return;
    setPoint('end', latlng, 'Dropped pin', fmtCoord(latlng));
    showPlaceSheet();
    showDestinationInContext(latlng);
    const original = state.end && L.latLng(state.end.lat, state.end.lng);
    const result = await reverseGeocode(latlng);
    if (!result || !state.end || !original || state.end.distanceTo(original) > 2) return;
    const primary = conciseResultName(result);
    state.endLabel = primary || 'Dropped pin';
    state.endAddress = resultSecondary(result, state.endLabel) || fmtCoord(latlng);
    el('homeSearch').value = state.endLabel;
    showPlaceSheet();
  }

  let longPressTimer = null;
  let longPressStart = null;
  let lastLongPressAt = 0;
  const mapContainer = map.getContainer();
  const cancelLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  };
  mapContainer.addEventListener('pointerdown', event => {
    if (!event.isPrimary || !['touch', 'pen'].includes(event.pointerType) || !['explore', 'place'].includes(state.stage)) return;
    const rect = mapContainer.getBoundingClientRect();
    longPressStart = { x: event.clientX, y: event.clientY, rect };
    longPressTimer = setTimeout(() => {
      if (!longPressStart) return;
      lastLongPressAt = performance.now();
      const point = L.point(longPressStart.x - longPressStart.rect.left, longPressStart.y - longPressStart.rect.top);
      dropDestinationPin(map.containerPointToLatLng(point));
      cancelLongPress();
    }, 550);
  }, {passive: true});
  mapContainer.addEventListener('pointermove', event => {
    if (longPressStart && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) cancelLongPress();
  }, {passive: true});
  mapContainer.addEventListener('pointerup', cancelLongPress, {passive: true});
  mapContainer.addEventListener('pointercancel', cancelLongPress, {passive: true});
  map.on('contextmenu', event => {
    if (performance.now() - lastLongPressAt >= 1000) dropDestinationPin(event.latlng);
  });

  function acquireCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'));
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latlng: L.latLng(pos.coords.latitude, pos.coords.longitude), accuracy: pos.coords.accuracy }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
      );
    });
  }

  async function useCurrentLocation({ calculate = true } = {}) {
    if (state.plannerSearchOpen) closeSearch();
    const revision = ++startLocationRevision;
    el('useLocationBtn').disabled = true;
    setRouteStatus('Getting your current location…');
    try {
      const pos = await acquireCurrentLocation();
      // A manual search, pin, newer request or departure from the planner wins.
      if (revision !== startLocationRevision || state.stage !== 'planner') return false;
      state.userLatLng = pos.latlng;
      setUserMarker(pos.latlng);
      setPoint('start', pos.latlng, 'Your location');
      map.setView(pos.latlng, 15);
      if (calculate) maybeCalculateRoute();
      return true;
    } catch (err) {
      if (revision !== startLocationRevision || state.stage !== 'planner') return false;
      console.error(err);
      setRouteStatus('Location unavailable. Search for the starting address or postcode instead.', 'warn');
      toast('Location unavailable — enter a starting point');
      return true;
    } finally {
      if (revision === startLocationRevision) el('useLocationBtn').disabled = false;
    }
  }

  async function refreshBrowseLocation({ center = true, quiet = false } = {}) {
    const button = el('browseLocateBtn');
    if (button) button.disabled = true;
    try {
      const pos = await acquireCurrentLocation();
      state.userLatLng = pos.latlng;
      setUserMarker(pos.latlng);
      if (center) map.setView(pos.latlng, Math.max(map.getZoom(), 15));
      return true;
    } catch (_) {
      if (!quiet) toast('Location unavailable — check browser permission');
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  el('useLocationBtn').addEventListener('click', () => useCurrentLocation());
  el('browseLocateBtn').addEventListener('click', () => refreshBrowseLocation({ center: true }));

  el('directionsBtn').addEventListener('click', async () => {
    setStage('planner');
    updatePlannerFields();
    if (!state.start && !await useCurrentLocation({ calculate: false })) return;
    if (state.stage === 'planner' && !state.plannerSearchOpen) maybeCalculateRoute();
  });

  el('plannerBack').addEventListener('click', () => {
    if (state.end) showPlaceSheet();
    else setStage('explore');
  });

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    el('cycleBtn').classList.toggle('active', mode === 'cycle');
    el('walkBtn').classList.toggle('active', mode === 'walk');
    el('prefBtn').hidden = true;
    el('prefMenu').hidden = true;
    el('routePreferences').hidden = mode !== 'cycle';
    invalidateRoute();
    maybeCalculateRoute();
  }
  el('cycleBtn').addEventListener('click', () => setMode('cycle'));
  el('walkBtn').addEventListener('click', () => setMode('walk'));
  el('preferLitBtn').addEventListener('click', () => {
    state.preferLit = !state.preferLit;
    persistSettings();
    syncRoutePreferenceControls();
    state.graphCache.clear();
    invalidateRoute();
    maybeCalculateRoute();
  });
  el('preferSuperBtn').addEventListener('click', () => {
    state.preferSuper = !state.preferSuper;
    persistSettings();
    syncRoutePreferenceControls();
    state.graphCache.clear();
    invalidateRoute();
    maybeCalculateRoute();
  });

  const PREF_LABEL = { maximum: 'Max Redway', balanced: 'Balanced', fastest: 'Fastest' };
  el('prefBtn').addEventListener('click', () => {
    const menu = el('prefMenu');
    menu.hidden = !menu.hidden;
    el('prefBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.querySelectorAll('[data-pref]').forEach(button => button.addEventListener('click', () => {
    state.pref = button.dataset.pref;
    document.querySelectorAll('[data-pref]').forEach(b => b.classList.toggle('active', b === button));
    el('prefLabel').textContent = PREF_LABEL[state.pref];
    el('prefMenu').hidden = true;
    el('prefBtn').setAttribute('aria-expanded', 'false');
    invalidateRoute();
    maybeCalculateRoute();
  }));

  async function overpass(query) {
    let lastErr;
    for (const endpoint of OVERPASS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Map data returned ${res.status}`);
        return await res.json();
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error('Map data service unavailable');
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

  async function loadBundledNetwork() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('./data/network.json', {
        headers: { Accept: 'application/json' },
        cache: 'no-cache',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Bundled network returned ${response.status}`);
      const parsed = parseBundledNetwork(await response.json());
      if (parsed.nodes.size < 1000 || parsed.ways.length < 100) throw new Error('Bundled routing network is incomplete');
      state.routingNetwork = parsed;
      buildLocalSearchIndex(parsed);
      state.networkSource = 'bundled';
      document.documentElement.dataset.routingSource = 'bundled';
      state.graphCache.clear();
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  function ensureRoutingNetwork() {
    if (state.routingNetwork) return Promise.resolve(state.routingNetwork);
    if (!state.routingNetworkPromise) {
      state.routingNetworkPromise = loadBundledNetwork().catch(err => {
        console.warn('Bundled routing network unavailable; live fallback will be used', err);
        state.networkSource = 'live-fallback';
        state.routingNetworkPromise = null;
        return null;
      });
    }
    return state.routingNetworkPromise;
  }

  function drawRedwaysFromParsed(parsed) {
    redwayLayer.clearLayers();
    const updateNetworkZoom = () => {
      document.documentElement.dataset.networkZoom = map.getZoom() < 13 ? 'city' : map.getZoom() < 15 ? 'district' : 'street';
    };
    if (state.networkZoomHandler) map.off('zoomend', state.networkZoomHandler);
    state.networkZoomHandler = updateNetworkZoom;
    map.on('zoomend', updateNetworkZoom);
    updateNetworkZoom();
    const groups = { superredway: [], redway: [], leisure: [], shared: [] };
    const superLabels = new Map();
    for (const w of parsed.ways) {
      const tags = w.tags || {};
      const cls = edgeClass(tags);
      if (!groups[cls]) continue;
      const pts = w.nodes.map(id => parsed.nodes.get(id)).filter(Boolean).map(n => [n.lat, n.lon]);
      if (pts.length >= 2) {
        groups[cls].push(pts);
        if (cls === 'superredway' && tags._mk_route_ref && !superLabels.has(tags._mk_route_ref)) {
          superLabels.set(tags._mk_route_ref, pts[Math.floor(pts.length / 2)]);
        }
      }
    }
    const add = (lines, cls) => {
      if (!lines.length) return;
      if (cls !== 'shared') L.polyline(lines, { className: `${cls}-casing`, interactive: false }).addTo(redwayLayer);
      L.polyline(lines, { className: `${cls}-line`, interactive: false }).addTo(redwayLayer);
    };
    add(groups.shared, 'shared');
    add(groups.redway, 'redway');
    add(groups.leisure, 'leisure');
    add(groups.superredway, 'superredway');
    for (const [ref, point] of superLabels) {
      const icon = L.divIcon({
        className: 'super-route-label',
        html: '<span>' + ref + '</span>',
        iconSize: [34, 22],
        iconAnchor: [17, 11]
      });
      L.marker(point, {icon, interactive:false}).addTo(redwayLayer);
    }
    state.redwayReady = Object.values(groups).some(lines => lines.length > 0);
  }

  async function loadRedways() {
    const parsed = await ensureRoutingNetwork();
    if (!parsed) return;
    drawRedwaysFromParsed(parsed);
    const warm = () => {
      try { getGraph(parsed, 'cycle', 'maximum'); } catch (err) { console.warn('Graph warm-up failed', err); }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
    else setTimeout(warm, 700);
  }

  function getGraph(parsed, mode, pref) {
    const options = {
      preferLit: mode === 'cycle' && state.preferLit,
      preferSuper: mode === 'cycle' && state.preferSuper
    };
    if (parsed === state.routingNetwork) {
      const key = mode + ':' + pref + ':' + (options.preferLit ? 'lit' : '-') + ':' + (options.preferSuper ? 'super' : '-');
      if (!state.graphCache.has(key)) {
        // Keep memory predictable on phones; an old graph can still be referenced by
        // an active route even after it drops out of this small cache.
        if (state.graphCache.size >= 4) state.graphCache.clear();
        state.graphCache.set(key, buildGraph(parsed, mode, pref, options));
      }
      return state.graphCache.get(key);
    }
    return buildGraph(parsed, mode, pref, options);
  }

  function corridorBBox(a, b) {
    const minLat = Math.min(a.lat, b.lat); const maxLat = Math.max(a.lat, b.lat);
    const minLon = Math.min(a.lng, b.lng); const maxLon = Math.max(a.lng, b.lng);
    const straight = hav({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    const pad = Math.max(.018, Math.min(.055, straight / 110000 * .5));
    return { s: minLat - pad, w: minLon - pad, n: maxLat + pad, e: maxLon + pad };
  }

  function formatDistance(m) {
    if (!Number.isFinite(m)) return '—';
    if (state.units === 'imperial') {
      const miles = m / 1609.344;
      const yards = m * 1.0936133;
      if (miles < 0.1) return `${Math.max(0, Math.round(yards / 10) * 10)} yd`;
      if (miles < 0.5) return `${Math.max(0, Math.round(yards / 50) * 50)} yd`;
      return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
    }
    if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  function formatTurnDistance(m) {
    if (m < 35) return 'Now';
    if (state.units === 'imperial') {
      const yards = m * 1.0936133;
      if (yards < 100) return `In ${Math.round(yards / 10) * 10} yd`;
      if (yards < 1000) return `In ${Math.round(yards / 50) * 50} yd`;
      const miles = m / 1609.344;
      return `In ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
    }
    if (m < 100) return `In ${Math.round(m / 10) * 10} m`;
    if (m < 1000) return `In ${Math.round(m / 50) * 50} m`;
    return `In ${(m / 1000).toFixed(1)} km`;
  }

  function formatSpokenTurnDistance(m) {
    if (m < 35) return 'Now';
    if (state.units === 'imperial') {
      const yards = m * 1.0936133;
      if (yards < 100) return `In ${Math.round(yards / 10) * 10} yards`;
      if (yards < 1000) return `In ${Math.round(yards / 50) * 50} yards`;
      const miles = m / 1609.344;
      return `In ${miles.toFixed(miles < 10 ? 1 : 0)} miles`;
    }
    if (m < 100) return `In ${Math.round(m / 10) * 10} metres`;
    if (m < 1000) return `In ${Math.round(m / 50) * 50} metres`;
    return `In ${(m / 1000).toFixed(1)} kilometres`;
  }

  function refreshDistanceDisplays() {
    if (!state.route) return;
    el('distanceStat').textContent = formatDistance(state.route.dist);
    if (!state.navigating) {
      setRouteStatus(routeReadyStatus(), 'good');
      renderApproachNote(); renderAlternatives();
    } else {
      const current = state.userLatLng || state.start;
      const journey = remainingJourney(state.route, state.navProgressMeters, current, state.start, state.end, state.mode);
      const remaining = journey.distance, mins = journey.mins;
      el('navEta').textContent = formatDuration(mins);
      el('navRemain').textContent = `${formatDistance(remaining)} · arrive ${arrivalTime(mins)}`;
      const { maneuver } = activeManeuver(state.navProgressMeters);
      if (maneuver) {
        const d = Math.max(0, maneuver.at - state.navProgressMeters);
        el('turnDistance').textContent = maneuver.arrive && d < 30 ? 'Approaching' : formatTurnDistance(d);
      }
    }
  }

  function formatDuration(mins) {
    if (mins < 60) return `${Math.max(1, Math.round(mins))} min`;
    const h = Math.floor(mins / 60); const m = Math.round(mins % 60);
    return `${h}h ${m}m`;
  }

  function arrivalTime(mins) {
    const d = new Date(Date.now() + mins * 60000);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fitRouteBounds(coords) {
    const landscape = window.innerWidth > window.innerHeight;
    if (landscape) {
      const panel = el('routeSheet');
      const panelWidth = panel && !panel.hidden ? panel.getBoundingClientRect().width : Math.min(430, window.innerWidth * .48);
      map.fitBounds(L.latLngBounds(coords).pad(.10), {
        maxZoom: 16,
        paddingTopLeft: [Math.round(panelWidth + 26), 26],
        paddingBottomRight: [22, 22]
      });
    } else {
      const panel = el('routeSheet');
      const panelHeight = panel && !panel.hidden ? panel.getBoundingClientRect().height : 220;
      map.fitBounds(L.latLngBounds(coords).pad(.10), {
        maxZoom: 16,
        paddingTopLeft: [20, 86],
        paddingBottomRight: [20, Math.round(panelHeight + 24)]
      });
    }
  }

  function drawRoute(coords, fit = true) {
    routeLayer.clearLayers();
    L.polyline(coords, { className: 'route-casing', interactive: false }).addTo(routeLayer);
    L.polyline(coords, { className: 'route-line', interactive: false }).addTo(routeLayer);
    if (state.route && coords.length) {
      for (const pair of [[state.start, coords[0]], [state.end, coords.at(-1)]]) {
        if (pair[0]) L.polyline([pair[0], pair[1]], {color:'#a05b00',weight:3,dashArray:'5 7',interactive:false}).addTo(routeLayer);
      }
    }
    if (fit) setTimeout(() => fitRouteBounds([...coords, state.start, state.end].filter(Boolean)), 30);
  }

  function routeReadyStatus() {
    return state.networkSource === 'bundled' ? 'Route ready' : 'Route ready · Online data';
  }

  const MIX_LABELS = {
    superredway: 'Super Redway',
    redway: 'Redway',
    leisure: 'Leisure',
    shared: 'Shared path',
    road: 'Road'
  };

  function renderRouteMix(plan) {
    const mix = plan?.mixPercent;
    const wrapper = el('routeMix');
    const bar = el('routeMixBar');
    const legend = el('routeMixLegend');
    bar.replaceChildren();
    legend.replaceChildren();
    if (!mix) {
      wrapper.hidden = true;
      return;
    }
    wrapper.hidden = false;
    for (const key of ['superredway', 'redway', 'leisure', 'shared', 'road']) {
      const value = Number(mix[key] || 0);
      if (!value) continue;
      const segment = document.createElement('span');
      segment.className = `route-mix-segment mix-${key}`;
      segment.style.width = `${value}%`;
      segment.title = `${MIX_LABELS[key]} ${value}%`;
      bar.appendChild(segment);

      const item = document.createElement('span');
      item.innerHTML = `<i class="mix-dot mix-${key}"></i><b>${value}%</b> ${MIX_LABELS[key]}`;
      legend.appendChild(item);
    }
  }

  function renderAlternativeMapRoutes() {
    routeLayer.eachLayer(layer => {
      const className = layer.options?.className || '';
      if (className === 'route-alt-line' || className === 'route-alt-time') routeLayer.removeLayer(layer);
    });
    if (state.mode !== 'cycle' || !state.route) return;
    for (const option of state.alternatives) {
      if (!option.plan || option.plan === state.route) continue;
      const line = L.polyline(option.plan.coords, {className:'route-alt-line', interactive:false}).addTo(routeLayer);
      line.bringToBack?.();
      const coords = option.plan.coords;
      if (coords.length) {
        const point = coords[Math.floor(coords.length / 2)];
        const icon = L.divIcon({
          className: 'route-alt-time',
          html: '<span>' + formatDuration(option.mins) + '</span>',
          iconSize: [54, 24],
          iconAnchor: [27, 12]
        });
        L.marker(point, {icon, interactive:false}).addTo(routeLayer);
      }
    }
  }

  function renderUnlitSegments(plan) {
    const edges = plan?.result?.edges || [];
    const coords = plan?.coords || [];
    let run = [];
    const flush = () => {
      if (run.length >= 2) L.polyline(run, {className:'route-unlit-line', interactive:false}).addTo(routeLayer);
      run = [];
    };
    for (let i = 0; i < edges.length && i + 1 < coords.length; i++) {
      if (edges[i].lit === 'no') {
        if (!run.length) run.push(coords[i]);
        run.push(coords[i + 1]);
      } else {
        flush();
      }
    }
    flush();
  }

  function renderRouteInsights(plan) {
    const insights = plan?.insights;
    const box = el('routeInsights');
    if (!insights) {
      box.hidden = true;
      return;
    }
    el('underpassStat').textContent = String(insights.underpasses || 0);
    el('crossingStat').textContent = String(insights.roadCrossings || 0);
    el('unlitStat').textContent = formatDistance(insights.unlitDist || 0);
    box.querySelectorAll('.super-route-badge').forEach(node => node.remove());
    for (const route of insights.superRoutes || []) {
      const badge = document.createElement('span');
      badge.className = 'super-route-badge';
      badge.textContent = route.ref + ' Super Route';
      box.appendChild(badge);
    }
    box.hidden = false;
  }

  function renderAlternatives() {
    const container = el('routeAlternatives');
    container.replaceChildren();
    if (state.mode !== 'cycle') {
      renderAlternativeMapRoutes();
      return;
    }
    for (const option of state.alternatives) {
      const prefs = option.prefs || [option.pref];
      const selectedHere = prefs.includes(state.pref);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-option' + (selectedHere ? ' selected' : '');
      button.setAttribute('aria-pressed', String(selectedHere));
      const title = document.createElement('strong');
      title.textContent = prefs.map(pref => PREF_LABEL[pref]).join(' / ');
      const detail = document.createElement('span');
      detail.textContent = option.error
        ? 'No route'
        : `${formatDuration(option.mins)} · ${formatDistance(option.dist)} · ${option.roadPercent}% road${prefs.length > 1 ? ' · same route' : ''}`;
      button.append(title, detail);
      button.disabled = Boolean(option.error) || state.routing;
      button.addEventListener('click', () => {
        state.pref = prefs.includes(state.pref) ? state.pref : prefs[0];
        el('prefLabel').textContent = PREF_LABEL[state.pref];
        document.querySelectorAll('[data-pref]').forEach(b => b.classList.toggle('active', b.dataset.pref === state.pref));
        if (option.plan) {
          installRoute(option.plan, {fit: true, collapse: false});
          renderAlternatives();
        }
      });
      container.append(button);
    }
    renderAlternativeMapRoutes();
  }

  function renderApproachNote() {
    const route = state.route, note = el('approachNote');
    const startGap = route?.snaps?.start || 0;
    const endGap = route?.snaps?.end || 0;
    const significant = Math.max(startGap, endGap) > 50;
    note.hidden = !route || !significant;
    if (!route || !significant) return;
    const messages = [];
    if (startGap > 50) messages.push(`The first ${formatDistance(startGap)} isn't a mapped path`);
    if (endGap > 50) messages.push(`The last ${formatDistance(endGap)} isn't a mapped path`);
    note.textContent = `${messages.join('. ')}. Check that you can get through.`;
  }

  function installOfferSeen() {
    try { return localStorage.getItem(INSTALL_OFFER_KEY) === '1'; } catch (_) { return true; }
  }

  function offerInstallOnce() {
    if (appInstalled || installOfferSeen()) return;
    try { localStorage.setItem(INSTALL_OFFER_KEY, '1'); } catch (_) {}
    setTimeout(() => toast('Tip: install MK Redway from Settings for quicker access.', 4200), 900);
  }

  function installRoute(plan, { fit = true, collapse = window.innerWidth < 900 } = {}) {
    state.route = plan;
    drawRoute(plan.coords, fit);
    renderUnlitSegments(plan);
    el('timeStat').textContent = formatDuration(plan.mins);
    el('arrivalStat').textContent = `Arrive about ${arrivalTime(plan.mins)}`;
    el('distanceStat').textContent = formatDistance(plan.dist);
    el('redwayStat').textContent = `${plan.redwayPercent}%`;
    el('roadStat').textContent = `${plan.roadPercent}%`;
    el('startNavBtn').disabled = false;
    el('sendToPhoneBtn').disabled = false;
    renderRouteMix(plan);
    renderRouteInsights(plan);
    renderApproachNote();
    setRouteStatus(routeReadyStatus(), state.networkSource === 'bundled' ? 'good' : 'warn');
    setRouteSheetCollapsed(collapse);
    offerInstallOnce();
  }

  async function solveRouteOnNetwork(parsed, { fit = true } = {}) {
    const revision = state.routeRevision;
    const {start, end, mode, pref, endLabel} = state;
    const choices = mode === 'cycle' && !state.navigating ? ['maximum', 'balanced', 'fastest'] : [pref];
    const alternatives = [];
    const bySignature = new Map();
    let selected = null, selectedError;
    for (const choice of choices) {
      await sleep(0);
      if (revision !== state.routeRevision) return;
      try {
        const plan = planRoute(parsed, getGraph(parsed, mode, choice), start, end, mode, endLabel);
        const signature = plan.result.ids.join('|');
        const duplicate = bySignature.get(signature);
        if (duplicate) {
          duplicate.prefs.push(choice);
        } else {
          const option = {pref: choice, prefs: [choice], plan, dist: plan.dist, mins: plan.mins, roadPercent: plan.roadPercent};
          alternatives.push(option);
          bySignature.set(signature, option);
        }
        if (choice === pref) selected = plan;
      } catch (err) {
        alternatives.push({pref: choice, prefs: [choice], error: true});
        if (choice === pref) selectedError = err;
      }
    }
    if (revision !== state.routeRevision) return;
    state.graphCache.clear(); // Keep only the selected plan's graph after comparing routes.
    state.alternatives = alternatives;
    if (!selected) throw selectedError || new Error('No route');
    installRoute(selected, {fit, collapse: window.innerWidth < 900}); renderAlternatives();
  }

  function expandedBox(box, factor = 1.8) {
    const cy = (box.s + box.n) / 2;
    const cx = (box.w + box.e) / 2;
    const hh = (box.n - box.s) * factor / 2;
    const hw = (box.e - box.w) * factor / 2;
    return {
      s: Math.max(MK.south, cy - hh),
      w: Math.max(MK.west, cx - hw),
      n: Math.min(MK.north, cy + hh),
      e: Math.min(MK.east, cx + hw)
    };
  }

  async function fetchLiveRoutingNetwork(box) {
    const h = 'path|cycleway|footway|pedestrian|bridleway|track|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link';
    const q = `[out:json][timeout:15];way["highway"~"^(${h})$"](${box.s},${box.w},${box.n},${box.e});(._;>;);out body;`;
    return parseWays(await overpass(q));
  }

  async function calculateRoute({ fit = true, quiet = false } = {}) {
    if (!state.start || !state.end) return;
    if (state.routing) { state.pendingRoute = true; return; }
    state.routing = true;
    const revision = state.routeRevision;
    el('retryRouteBtn').hidden = true;
    el('startNavBtn').disabled = true;
    if (!quiet) setRouteStatus('Finding the best Redway route…');
    const started = performance.now();
    try {
      // Normal path: one versioned network file is generated during the GitHub Pages
      // deployment, served from the same CDN as the app and cached on the phone.
      const bundled = await ensureRoutingNetwork();
      if (revision !== state.routeRevision) return;
      if (bundled) {
        await solveRouteOnNetwork(bundled, { fit });
        const elapsed = performance.now() - started;
        console.info(`Route calculated from bundled network in ${Math.round(elapsed)} ms`);
        return;
      }

      // Fallback for local development or a failed network-data build. Keep the live
      // query bounded and retry once with a wider corridor if topology is clipped.
      if (!quiet) setRouteStatus('Loading live map data…');
      const firstBox = corridorBBox(state.start, state.end);
      let parsed = await fetchLiveRoutingNetwork(firstBox);
      try {
        await solveRouteOnNetwork(parsed, { fit });
      } catch (firstErr) {
        console.warn('First live corridor could not connect route; widening it', firstErr);
        if (!quiet) setRouteStatus('Checking a wider Redway area…');
        parsed = await fetchLiveRoutingNetwork(expandedBox(firstBox, 2.0));
        await solveRouteOnNetwork(parsed, { fit });
      }
    } catch (err) {
      console.error(err);
      if (revision === state.routeRevision) {
        setRouteStatus(routeErrorMessage(err), 'warn');
        setRouteSheetCollapsed(false);
        el('retryRouteBtn').hidden = false;
        toast('Could not calculate route');
      }
    } finally {
      state.routing = false;
      renderAlternatives();
      if (state.pendingRoute) { state.pendingRoute = false; maybeCalculateRoute(); }
    }
  }

  function maybeCalculateRoute() {
    updatePlannerFields();
    if (state.start && state.end) calculateRoute();
    else if (!state.start) setRouteStatus('Use your location or search for a starting point.');
    else setRouteStatus('Search for a destination.');
  }

  function xmlEscape(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
  }

  function routeToGpx(plan, name = 'MK Redway route') {
    const points = (plan?.coords || []).map(pair =>
      '      <trkpt lat="' + Number(pair[0]).toFixed(6) + '" lon="' + Number(pair[1]).toFixed(6) + '"></trkpt>'
    ).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="MK Redway Navigator" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <metadata><name>' + xmlEscape(name) + '</name></metadata>\n' +
      '  <trk><name>' + xmlEscape(name) + '</name><trkseg>\n' + points + '\n  </trkseg></trk>\n' +
      '</gpx>\n';
  }

  function downloadText(filename, textValue, type) {
    const blob = new Blob([textValue], {type});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function parseGpx(textValue) {
    const doc = new DOMParser().parseFromString(textValue, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file');
    let points = [...doc.getElementsByTagNameNS('*', 'trkpt')];
    if (!points.length) points = [...doc.getElementsByTagNameNS('*', 'rtept')];
    const coords = points.map(node => [Number(node.getAttribute('lat')), Number(node.getAttribute('lon'))])
      .filter(pair => pair.every(Number.isFinite));
    if (coords.length < 2) throw new Error('GPX file does not contain a usable track');
    const title = doc.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || 'Imported GPX route';
    return {coords, title};
  }

  function importedPlan(coords, title) {
    const cumulative = buildCumulative(coords);
    const edges = [];
    for (let i = 0; i < coords.length - 1; i++) {
      edges.push({
        d: cumulative[i + 1] - cumulative[i],
        cls: 'shared',
        name: title,
        wayId: 'gpx-' + i,
        lit: '',
        tunnel: '',
        junction: ''
      });
    }
    const distance = cumulative.at(-1) || 0;
    return {
      coords,
      cumulative,
      result: {ids: coords.map((_, i) => 'gpx-' + i), edges},
      networkDist: distance,
      approachDist: 0,
      dist: distance,
      mins: distance / (state.mode === 'cycle' ? 4.17 : 1.34) / 60,
      snaps: {start:0,end:0},
      mixPercent: {superredway:0,redway:0,leisure:0,shared:100,road:0},
      redwayPercent: 0,
      roadPercent: 0,
      insights: {underpasses:0,roadCrossings:0,unlitDist:0,superRoutes:[]},
      maneuvers: buildManeuvers(coords, edges, cumulative, {
        ids: coords.map((_, i) => 'gpx-' + i),
        endLabel: title,
        endGap: 0
      }),
      initialInstruction: initialInstruction(coords, edges)
    };
  }

  function installImportedGpx(coords, title) {
    stopNavigation({keepRoute:false});
    state.importedRouteName = title;
    state.start = L.latLng(coords[0][0], coords[0][1]);
    state.end = L.latLng(coords.at(-1)[0], coords.at(-1)[1]);
    state.startLabel = title + ' start';
    state.endLabel = title + ' finish';
    state.endAddress = 'Imported GPX';
    state.alternatives = [];
    setStage('planner');
    updatePlannerFields();
    redrawMarkers();
    installRoute(importedPlan(coords, title), {fit:true, collapse: window.innerWidth < 900});
    renderAlternatives();
    toast('GPX route ready');
  }

  async function loadOfficialGpx(route, variant) {
    const url = variant === 'short' ? route.shortGpx : route.fullGpx;
    const title = route.color + ' · ' + route.title + (variant === 'short' ? ' short' : '');
    try {
      const response = await fetch(url, {headers:{Accept:'application/gpx+xml, application/xml, text/xml'}});
      if (!response.ok) throw new Error('GPX download returned ' + response.status);
      const parsed = parseGpx(await response.text());
      route[variant + 'Coords'] = parsed.coords;
      closeExploreRoutes();
      installImportedGpx(routeFromNearestPoint(parsed.coords), title);
    } catch (err) {
      console.warn('Official GPX could not be loaded directly', err);
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) location.href = url;
      toast('GPX opened from Get Around MK. Import the downloaded file if it does not open here.', 6000);
    }
  }

  async function importGpxFile(file) {
    if (!file) return;
    try {
      const parsed = parseGpx(await file.text());
      closeExploreRoutes();
      installImportedGpx(parsed.coords, parsed.title || file.name.replace(/\.gpx$/i, ''));
    } catch (err) {
      console.error(err);
      toast('That GPX file could not be read');
    }
  }

  function routeShareUrl() {
    if (!state.start || !state.end) return location.href.split('?')[0];
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('from', state.start.lat.toFixed(6) + ',' + state.start.lng.toFixed(6));
    url.searchParams.set('to', state.end.lat.toFixed(6) + ',' + state.end.lng.toFixed(6));
    url.searchParams.set('mode', state.mode);
    url.searchParams.set('pref', state.pref);
    if (state.preferLit) url.searchParams.set('lit', '1');
    if (state.preferSuper) url.searchParams.set('super', '1');
    return url.href;
  }

  async function sendRouteToPhone() {
    if (!state.route) return;
    const url = routeShareUrl();
    const data = {title:'MK Redway route', text:'Open this route in MK Redway Navigator', url};
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast('Route link copied — open it on your phone');
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn(err);
    }
    window.prompt('Copy this route link to your phone:', url);
  }

  function restoreSharedRoute() {
    const params = new URLSearchParams(location.search);
    const parsePoint = key => {
      const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(params.get(key) || '');
      if (!match) return null;
      const lat = Number(match[1]), lng = Number(match[2]);
      if (![lat,lng].every(Number.isFinite) || lat < MK.south || lat > MK.north || lng < MK.west || lng > MK.east) return null;
      return L.latLng(lat,lng);
    };
    const from = parsePoint('from'), to = parsePoint('to');
    if (!from || !to) return false;
    state.mode = params.get('mode') === 'walk' ? 'walk' : 'cycle';
    state.pref = ['maximum','balanced','fastest'].includes(params.get('pref')) ? params.get('pref') : 'maximum';
    state.preferLit = params.get('lit') === '1';
    state.preferSuper = params.get('super') === '1';
    state.start = from;
    state.end = to;
    state.startLabel = 'Shared route start';
    state.endLabel = 'Shared route destination';
    state.endAddress = '';
    el('cycleBtn').classList.toggle('active', state.mode === 'cycle');
    el('walkBtn').classList.toggle('active', state.mode === 'walk');
    el('routePreferences').hidden = state.mode !== 'cycle';
    syncRoutePreferenceControls();
    setStage('planner');
    updatePlannerFields();
    redrawMarkers();
    maybeCalculateRoute();
    return true;
  }

  el('exportGpxBtn').addEventListener('click', () => {
    if (!state.route) return;
    downloadText('mk-redway-route.gpx', routeToGpx(state.route, state.endLabel || 'MK Redway route'), 'application/gpx+xml');
  });
  for (const id of ['importGpxBtn','exploreImportGpxBtn']) {
    el(id).addEventListener('click', () => el('gpxFileInput').click());
  }
  el('gpxFileInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    importGpxFile(file);
  });
  el('sendToPhoneBtn').addEventListener('click', sendRouteToPhone);

  el('retryRouteBtn').addEventListener('click', () => calculateRoute());
  el('routeMoreBtn').addEventListener('click', () => {
    const menu = el('routeMoreMenu');
    menu.hidden = !menu.hidden;
    el('routeMoreBtn').setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) setRouteSheetCollapsed(false);
  });
  for (const which of ['start','end']) {
    el(which === 'start' ? 'moveStartBtn' : 'moveEndBtn').addEventListener('click', () => {
      if (which === 'start') cancelStartLocation();
      state.editEndpoint = which;
      el('routeMoreMenu').hidden = true;
      el('routeMoreBtn').setAttribute('aria-expanded', 'false');
      setRouteStatus(`Tap an accessible ${which === 'start' ? 'starting point' : 'destination entrance'} on the map.`, 'warn');
      toast('Tap the map to place the entrance', 5000);
    });
  }

  el('clearBtn').addEventListener('click', () => {
    el('routeMoreMenu').hidden = true;
    el('routeMoreBtn').setAttribute('aria-expanded', 'false');
    stopNavigation({ keepRoute: false });
    state.editEndpoint = null;
    state.start = null; state.end = null; state.startLabel = ''; state.endLabel = ''; state.endAddress = '';
    invalidateRoute(); markerLayer.clearLayers(); userLayer.clearLayers();
    el('homeSearch').value = ''; el('startSearch').value = ''; el('endSearch').value = '';
    resetMapOrientation();
    setStage('explore'); map.setView([52.0406, -0.7594], 12);
  });

  // Navigation helpers -------------------------------------------------------
  function xy(latlng, lat0) {
    const rad = Math.PI / 180;
    return { x: latlng.lng * 111320 * Math.cos(lat0 * rad), y: latlng.lat * 110540 };
  }

  function normalizeHeading(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function bearingBetween(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const dLon = (b.lng - a.lng) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return normalizeHeading(Math.atan2(y, x) / rad);
  }

  function smoothHeading(raw) {
    raw = normalizeHeading(raw);
    if (!Number.isFinite(state.heading)) {
      state.heading = raw;
      return raw;
    }
    const delta = ((raw - state.heading + 540) % 360) - 180;
    const alpha = state.mode === 'cycle' ? .42 : .32;
    state.heading = normalizeHeading(state.heading + delta * alpha);
    return state.heading;
  }

  function routeHeadingAt(snap) {
    const coords = state.route?.coords;
    if (!coords || coords.length < 2 || !snap) return null;
    const i = Math.max(0, Math.min(coords.length - 2, snap.segment));
    return bearingBetween(
      { lat: coords[i][0], lng: coords[i][1] },
      { lat: coords[i + 1][0], lng: coords[i + 1][1] }
    );
  }

  function resolveTravelHeading(position, snap, latlng) {
    let raw = Number(position.coords.heading);
    const speed = Number(position.coords.speed);
    if (!Number.isFinite(raw) || raw < 0 || (Number.isFinite(speed) && speed < .45)) raw = null;

    if (state.lastHeadingFix) {
      const moved = map.distance(state.lastHeadingFix, latlng);
      if (raw == null && moved >= (state.mode === 'cycle' ? 5 : 3)) {
        raw = bearingBetween(state.lastHeadingFix, latlng);
      }
      if (moved >= 2) state.lastHeadingFix = L.latLng(latlng.lat, latlng.lng);
    } else {
      state.lastHeadingFix = L.latLng(latlng.lat, latlng.lng);
    }

    if (raw == null) raw = routeHeadingAt(snap);
    return raw == null ? state.heading : smoothHeading(raw);
  }

  function resetMapOrientation() {
    state.heading = null;
    state.lastHeadingFix = null;
    if (!state.headingSupported) return;
    try {
      map.setHeading(null);
      map.stopHeadingUp?.();
      map.setBearing(0);
    } catch (err) {
      console.warn('Could not reset map bearing', err);
    }
  }

  function navigationTargetPoint() {
    const size = map.getSize();
    const landscape = window.innerWidth > window.innerHeight;
    if (landscape) {
      // Side controls occupy the left side in landscape, so the travelling point
      // sits in the centre of the clear map area rather than the whole screen.
      return L.point(size.x * 0.66, size.y * 0.54);
    }
    // Horizontally centred, slightly below mid-screen to expose more route ahead.
    return L.point(size.x * 0.50, size.y * 0.58);
  }

  function alignNavigationPoint(latlng, animate = false) {
    if (!latlng) return;
    const actual = map.latLngToContainerPoint(latlng);
    const target = navigationTargetPoint();
    const offset = actual.subtract(target);
    if (Math.abs(offset.x) > 1 || Math.abs(offset.y) > 1) {
      map.panBy(offset, { animate });
    }
  }

  // Heading easing continues after the initial camera layout frames. Keep the
  // travelling point anchored throughout rotation, unless the user pans away.
  let navigationAlignmentFrame = 0;
  map.on('rotate', () => {
    if (!state.navigating || !state.followUser || !state.userLatLng || navigationAlignmentFrame) return;
    navigationAlignmentFrame = requestAnimationFrame(() => {
      navigationAlignmentFrame = 0;
      if (state.navigating && state.followUser) alignNavigationPoint(state.userLatLng, false);
    });
  });

  function followNavigationView(latlng, heading, animate = false) {
    if (!latlng) return;
    const zoom = state.mode === 'cycle' ? 17 : 18;
    map.invalidateSize({ pan: false });

    if (state.headingSupported && Number.isFinite(heading)) {
      try { map.setHeading(heading, { ease: .22, deadzone: .6 }); } catch (err) { console.warn(err); }
    }

    map.setView(latlng, zoom, { animate: false });

    // Leaflet-Rotate applies its transform after the map view update. Align on the
    // next two frames so navigation always begins with the current position centred
    // in the intended sat-nav camera area instead of inheriting an old map offset.
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      alignNavigationPoint(latlng, false);
      requestAnimationFrame(() => alignNavigationPoint(latlng, animate));
    });
  }

  function nearestOnRoute(latlng) {
    const route = state.route;
    if (!route || route.coords.length < 2) return null;
    const p = xy(latlng, latlng.lat);
    let best = null;
    let start = Math.max(0, state.lastSegment - 25);
    let end = Math.min(route.coords.length - 2, state.lastSegment + 160);
    if (!Number.isFinite(state.lastSegment)) { start = 0; end = route.coords.length - 2; }

    const scan = (a, b) => {
      let out = null;
      for (let i = a; i <= b; i++) {
        const A = xy(L.latLng(route.coords[i][0], route.coords[i][1]), latlng.lat);
        const B = xy(L.latLng(route.coords[i + 1][0], route.coords[i + 1][1]), latlng.lat);
        const vx = B.x - A.x; const vy = B.y - A.y;
        const len2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / len2));
        const qx = A.x + t * vx; const qy = A.y + t * vy;
        const d = Math.hypot(p.x - qx, p.y - qy);
        if (!out || d < out.distance) {
          const segLen = route.cumulative[i + 1] - route.cumulative[i];
          out = { segment: i, fraction: t, distance: d, progress: route.cumulative[i] + t * segLen };
        }
      }
      return out;
    };

    best = scan(start, end);
    if (!best || best.distance > 120) best = scan(0, route.coords.length - 2);
    return best;
  }

  function setUserMarker(latlng) {
    userLayer.clearLayers();
    const icon = L.divIcon({ className: '', html: '<div class="user-pulse"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    state.userMarker = L.marker(latlng, { icon, interactive: false }).addTo(userLayer);
  }

  function turnIconSvg(kind) {
    const paths = {
      straight: '<path d="M12 20V5M7 10l5-5 5 5"></path>',
      left: '<path d="M20 17v-4a5 5 0 0 0-5-5H6M10 4 6 8l4 4"></path>',
      right: '<path d="M4 17v-4a5 5 0 0 1 5-5h9M14 4l4 4-4 4"></path>',
      'slight-left': '<path d="M18 19 8 9M8 15V9h6"></path>',
      'slight-right': '<path d="m6 19 10-10M10 9h6v6"></path>',
      'sharp-left': '<path d="M18 20v-8a4 4 0 0 0-4-4H7M11 4 7 8l4 4"></path>',
      'sharp-right': '<path d="M6 20v-8a4 4 0 0 1 4-4h7M13 4l4 4-4 4"></path>',
      'u-turn-left': '<path d="M18 20V10a6 6 0 0 0-12 0v3M3 10l3 3 3-3"></path>',
      'u-turn-right': '<path d="M6 20V10a6 6 0 0 1 12 0v3M15 10l3 3 3-3"></path>',
      roundabout: '<circle cx="12" cy="12" r="5"></circle><path d="M12 20v-3M12 7V4M6.5 15.5 4 17M17.5 8.5 20 7"></path><path d="m15 5-3-1 1-3"></path>',
      'roundabout-exit': '<circle cx="10" cy="13" r="4"></circle><path d="M10 21v-4M13 10l6-6M15 4h4v4"></path>',
      underpass: '<path d="M3 17c2-6 5-9 9-9s7 3 9 9"></path><path d="M4 17h16M12 17V9"></path>',
      arrive: '<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.straight}</svg>`;
  }

  function setTurnIcon(kind) {
    el('turnIcon').innerHTML = turnIconSvg(kind);
  }

  // Voice guidance ----------------------------------------------------------
  // iOS requires the first speech request to happen synchronously inside a
  // user gesture. Once that first utterance has started, later GPS-triggered
  // utterances are normally allowed for the lifetime of the page. Keep our own
  // queue as repeatedly calling speechSynthesis.cancel() is unreliable on
  // mobile WebKit and can silently suppress subsequent instructions.
  function speechSupported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  function selectSpeechVoice() {
    if (!speechSupported()) return null;
    const voices = window.speechSynthesis.getVoices?.() || [];
    const british = voices.filter(v => /^en[-_]GB$/i.test(v.lang || ''));
    const english = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang || ''));
    state.speechVoice =
      british.find(v => /Daniel|Serena|Martha|Siri/i.test(v.name || '')) ||
      british.find(v => v.localService) || british[0] ||
      english.find(v => v.localService) || english[0] || null;
    return state.speechVoice;
  }

  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = state.mode === 'cycle' ? 1.03 : 1.0;
    u.pitch = 1;
    u.volume = 1;
    const voice = state.speechVoice || selectSpeechVoice();
    if (voice) u.voice = voice;
    return u;
  }

  function clearSpeechQueue({ cancelActive = false } = {}) {
    state.speechQueue.length = 0;
    if (cancelActive && speechSupported()) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      state.speechActive = null;
    }
  }

  function drainSpeechQueue() {
    if (!speechSupported() || !state.voiceEnabled || state.speechActive || !state.speechQueue.length) return;
    const item = state.speechQueue.shift();
    const u = makeUtterance(item.text);
    const token = ++state.speechSequence;
    let started = false;
    state.speechActive = { token, utterance: u, text: item.text };

    const finish = () => {
      if (state.speechActive?.token !== token) return;
      state.speechActive = null;
      setTimeout(drainSpeechQueue, 40);
    };
    u.onstart = () => {
      started = true;
      state.speechUnlocked = true;
      state.speechFailureNotified = false;
    };
    u.onend = finish;
    u.onerror = event => {
      console.warn('Speech synthesis error', event.error || event);
      finish();
    };

    try {
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.warn('Speech unavailable', err);
      finish();
      return;
    }

    // WebKit can silently reject speech without firing an error. Detect that
    // case and tell the rider how to restore voice using the speaker button.
    setTimeout(() => {
      if (state.speechActive?.token !== token || started) return;
      const synthSpeaking = Boolean(window.speechSynthesis.speaking || window.speechSynthesis.pending);
      if (!synthSpeaking) {
        state.speechActive = null;
        state.speechUnlocked = false;
        if (!state.speechFailureNotified && state.navigating) {
          state.speechFailureNotified = true;
          toast('Voice is silent — tap the speaker button once to restore it', 5000);
        }
        drainSpeechQueue();
      }
    }, 1200);
    // Some WebKit failures leave an utterance permanently pending with no events.
    // Never let that block every later turn instruction.
    setTimeout(() => {
      if (state.speechActive?.token !== token || started) return;
      state.speechActive = null;
      state.speechUnlocked = false;
      if (!state.speechFailureNotified && state.navigating) {
        state.speechFailureNotified = true;
        toast('Voice needs a tap — press the speaker button to restore it', 5000);
      }
      drainSpeechQueue();
    }, 4000);
  }

  function speak(text, { priority = 1, dedupeMs = 3500 } = {}) {
    if (!state.voiceEnabled || !speechSupported() || !text) return;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const now = Date.now();
    if (clean === state.lastSpokenText && now - state.lastSpokenAt < dedupeMs) return;
    state.lastSpokenText = clean;
    state.lastSpokenAt = now;

    // Near-turn and reroute prompts supersede stale queued preview prompts.
    if (priority >= 3) state.speechQueue = state.speechQueue.filter(x => x.priority >= 3);
    state.speechQueue.push({ text: clean, priority, at: now });
    state.speechQueue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    drainSpeechQueue();
  }

  function unlockSpeechFromGesture(message = 'Voice guidance ready.') {
    if (!state.voiceEnabled || !speechSupported()) return false;
    try {
      clearSpeechQueue({ cancelActive: true });
      selectSpeechVoice();
      window.speechSynthesis.resume?.();
      const u = makeUtterance(message);
      const token = ++state.speechSequence;
      let started = false;
      state.speechActive = { token, utterance: u, text: message };
      u.onstart = () => {
        started = true;
        state.speechUnlocked = true;
        state.speechFailureNotified = false;
      };
      u.onend = () => {
        if (state.speechActive?.token === token) state.speechActive = null;
        drainSpeechQueue();
      };
      u.onerror = event => {
        console.warn('Speech unlock failed', event.error || event);
        if (state.speechActive?.token === token) state.speechActive = null;
      };
      // Crucially, this call occurs before startNavigation reaches its first await.
      window.speechSynthesis.speak(u);
      setTimeout(() => {
        if (state.speechActive?.token !== token || started) return;
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          state.speechActive = null;
          state.speechUnlocked = false;
        }
      }, 1200);
      return true;
    } catch (err) {
      console.warn('Could not unlock speech', err);
      return false;
    }
  }

  if (speechSupported()) {
    selectSpeechVoice();
    window.speechSynthesis.addEventListener?.('voiceschanged', selectSpeechVoice);
  }

  function activeManeuver(progress) {
    const ms = state.route?.maneuvers || [];
    let i = 0;
    while (i < ms.length - 1 && ms[i].at < progress + 8) i++;
    return { maneuver: ms[i], index: i, next: ms[i + 1] || null };
  }

  function announceManeuver(m, index, dist) {
    if (!m || m.arrive) return;
    const far = state.mode === 'cycle' ? 180 : 90;
    const near = state.mode === 'cycle' ? 55 : 25;
    if (dist <= near && !state.announcedNear.has(index)) {
      state.announcedNear.add(index);
      // At the junction, lead with the action rather than repeating a short distance.
      speak(`${m.instruction}.`, { priority: 3, dedupeMs: 1800 });
    } else if (dist <= far && !state.announcedFar.has(index)) {
      state.announcedFar.add(index);
      speak(`${formatSpokenTurnDistance(dist)}. ${m.instruction}.`, { priority: 1 });
    }
  }

  function updateNavigation(position) {
    if (!state.route || !state.navigating) return;
    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
    state.userLatLng = latlng;
    state.lastPositionAt = Date.now();
    setUserMarker(latlng);

    const snap = nearestOnRoute(latlng);
    if (!snap) return;
    const heading = resolveTravelHeading(position, snap, latlng);
    state.lastSegment = snap.segment;
    state.navProgressMeters = Math.max(state.navProgressMeters - 15, snap.progress);
    const progress = Math.max(state.navProgressMeters, snap.progress);
    state.navProgressMeters = progress;

    const total = state.route.networkDist;
    const remaining = Math.max(0, total - progress);
    const journey = remainingJourney(state.route, progress, latlng, state.start, state.end, state.mode);
    const mins = journey.mins;
    el('navEta').textContent = formatDuration(mins);
    el('navRemain').textContent = `${formatDistance(journey.distance)} · arrive ${arrivalTime(mins)}`;

    const { maneuver, index, next } = activeManeuver(progress);
    if (maneuver) {
      const d = Math.max(0, maneuver.at - progress);
      setTurnIcon(maneuver.icon);
      el('turnDistance').textContent = maneuver.arrive && d < 30 ? 'Approaching' : formatTurnDistance(d);
      el('turnText').textContent = maneuver.instruction;
      el('nextTurnText').textContent = next && !maneuver.arrive ? `Then ${next.instruction.charAt(0).toLowerCase()}${next.instruction.slice(1)}` : '';
      announceManeuver(maneuver, index, d);
    }

    if (hasArrived(position, state.end, remaining)) {
      speak(`You have arrived at ${state.endLabel || 'your destination'}.`, { priority: 4, dedupeMs: 10000 });
      toast('You have arrived', 4000);
      stopNavigation({ keepRoute: true, arrived: true });
      return;
    }

    if (remaining < 22) {
      el('turnDistance').textContent = formatDistance(journey.distance);
      el('turnText').textContent = 'Mapped route ends here. Check the approach to your destination.';
      el('nextTurnText').textContent = 'Arrival is confirmed near your destination with an accurate GPS fix.';
      if (state.followUser) followNavigationView(latlng, heading, true);
      return;
    }

    const offThreshold = state.mode === 'cycle' ? 50 : 35;
    if (snap.distance > offThreshold) state.offRouteCount += 1;
    else state.offRouteCount = 0;
    if (state.offRouteCount >= 2 && Date.now() - state.lastRerouteAt > 25000) rerouteFromPosition(latlng);

    if (state.followUser) followNavigationView(latlng, heading, true);
  }

  async function rerouteFromPosition(latlng) {
    if (!state.route || state.routing) return;
    state.lastRerouteAt = Date.now(); state.offRouteCount = 0;
    toast('Rerouting…'); speak('Rerouting.', { priority: 4, dedupeMs: 5000 });
    state.start = latlng; state.startLabel = 'Your location';
    invalidateRoute();
    await calculateRoute({fit:false,quiet:true});
    resetNavigationProgress();
    if (state.route) speak(state.route.initialInstruction, { priority:3 });
    else { stopNavigation({keepRoute:false}); setStage('planner'); }
  }

  function resetNavigationProgress() {
    state.lastSegment = 0; state.navProgressMeters = 0;
    state.announcedFar.clear(); state.announcedNear.clear();
  }

  async function startNavigation() {
    if (!state.route || state.navigating) return;
    if (!navigator.geolocation) { toast('Live navigation needs location access'); return; }

    // This must happen synchronously inside the Start-button tap. On iOS,
    // waiting for GPS first loses the transient user activation and speech can
    // then be silently blocked for the whole navigation session.
    unlockSpeechFromGesture('Voice guidance ready.');

    const current = await acquireCurrentLocation().catch(() => null);
    if (!current) { toast('Allow location access to start navigation'); return; }
    state.userLatLng = current.latlng;
    const distanceFromPlannedStart = state.start ? hav({ lat: current.latlng.lat, lon: current.latlng.lng }, { lat: state.start.lat, lon: state.start.lng }) : 0;
    if (distanceFromPlannedStart > 60) {
      state.start = current.latlng; state.startLabel = 'Your location';
      invalidateRoute();
      await calculateRoute({ fit: false, quiet: true });
      if (!state.route) {
        setStage('planner');
        return;
      }
    }

    state.navigating = true;
    state.followUser = true;
    applyTheme();
    resetNavigationProgress();
    redrawMarkers();
    setStage('navigation');
    redwayLayer.remove(); // declutter sat-nav view; the chosen route remains visible.
    setUserMarker(current.latlng);
    const initialSnap = nearestOnRoute(current.latlng);
    state.heading = routeHeadingAt(initialSnap);
    state.lastHeadingFix = L.latLng(current.latlng.lat, current.latlng.lng);
    // Give the navigation overlays and rotated map one layout pass before setting
    // the initial camera; this prevents the first frame from starting off-centre.
    requestAnimationFrame(() => requestAnimationFrame(() =>
      followNavigationView(current.latlng, state.heading, false)
    ));
    if (!state.headingSupported) toast('Heading-up map unavailable; navigation will stay north-up', 3500);
    setTurnIcon('straight');
    el('navEta').textContent = formatDuration(state.route.mins);
    el('navRemain').textContent = `${formatDistance(state.route.dist)} · arrive ${arrivalTime(state.route.mins)}`;
    el('turnDistance').textContent = 'Start';
    el('turnText').textContent = state.route.initialInstruction;
    el('nextTurnText').textContent = state.route.maneuvers[0] ? `Then ${state.route.maneuvers[0].instruction.charAt(0).toLowerCase()}${state.route.maneuvers[0].instruction.slice(1)}` : '';
    speak(`Navigation started. ${state.route.initialInstruction}.`, { priority: 3, dedupeMs: 1000 });

    state.watchId = navigator.geolocation.watchPosition(
      updateNavigation,
      err => { console.warn(err); toast('GPS signal unavailable'); },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
    );
  }

  function stopNavigation({ keepRoute = true, arrived = false } = {}) {
    if (state.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null; state.navigating = false; state.followUser = true;
    applyTheme();
    resetMapOrientation();
    userLayer.clearLayers();
    if (state.userLatLng) setUserMarker(state.userLatLng);
    if (!arrived) clearSpeechQueue({ cancelActive: true });
    if (!map.hasLayer(redwayLayer)) redwayLayer.addTo(map);
    redrawMarkers();
    if (keepRoute && state.route) {
      setStage('planner');
      drawRoute(state.route.coords, true);
    } else if (state.end) showPlaceSheet();
    else setStage('explore');
  }

  el('startNavBtn').addEventListener('click', startNavigation);
  el('exitNavBtn').addEventListener('click', () => stopNavigation({ keepRoute: true }));
  el('recenterBtn').addEventListener('click', () => {
    state.followUser = true;
    if (state.userLatLng) followNavigationView(state.userLatLng, state.heading, true);
  });
  map.on('dragstart', () => { if (state.navigating) state.followUser = false; });

  el('voiceBtn').addEventListener('click', () => {
    // A speaker-button tap is a direct user gesture, so enabling voice here can
    // also recover WebKit speech after backgrounding.
    setVoiceEnabled(!state.voiceEnabled, { announce: !state.voiceEnabled });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.navigating || !state.voiceEnabled || !speechSupported()) return;
    try { window.speechSynthesis.resume?.(); } catch (_) {}
    // iOS can suspend PWA audio when backgrounded. We cannot manufacture a new
    // user gesture, so leave the speaker button available as the recovery path.
    if (isIOSStandalone && !state.speechUnlocked) {
      toast('Tap the speaker button once to restore voice guidance', 4500);
    }
  });

  // Offline MK basemap ------------------------------------------------------
  function humanBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 20 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  async function offlineMapCached() {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      return Boolean(await cache.match(new URL(OFFLINE_MAP_URL, location.href).href)) && Boolean(await caches.match(new URL("./data/network.json", location.href).href));
    } catch (_) { return false; }
  }

  function renderOfflineStatus() {
    const status = el('offlineStatus');
    const button = el('offlineDownloadBtn');
    if (!status || !button) return;
    if (state.offlineDownloadBusy) return;
    if (state.offlineMapDownloaded) {
      status.textContent = `Downloaded${state.offlineMapBytes ? ` · ${humanBytes(state.offlineMapBytes)}` : ''}. Map and routing are available offline.`;
      button.textContent = 'Remove';
      button.disabled = false;
    } else if (state.offlineMapAvailable) {
      status.textContent = `Download the MK basemap${state.offlineMapBytes ? ` (${humanBytes(state.offlineMapBytes)})` : ''} for navigation without signal.`;
      button.textContent = 'Download';
      button.disabled = false;
    } else {
      status.textContent = 'Offline basemap is not available in this deployment yet.';
      button.textContent = 'Unavailable';
      button.disabled = true;
    }
  }

  async function probeOfflineMap() {
    state.offlineMapDownloaded = await offlineMapCached();
    try {
      const response = await fetch(OFFLINE_MAP_URL, { method: 'HEAD', cache: 'no-store' });
      state.offlineMapAvailable = response.ok;
      const len = Number(response.headers.get('Content-Length') || 0);
      if (len > 0) state.offlineMapBytes = len;
    } catch (_) {
      state.offlineMapAvailable = state.offlineMapDownloaded;
    }
    renderOfflineStatus();
    return state.offlineMapAvailable;
  }

  async function activatePackagedBasemap() {
    if (offlineVectorLayer && map.hasLayer(offlineVectorLayer)) return true;
    if (!window.protomapsL?.leafletLayer) return false;
    const available = state.offlineMapAvailable || await probeOfflineMap();
    if (!available) return false;
    try {
      offlineVectorLayer = window.protomapsL.leafletLayer({
        url: OFFLINE_MAP_URL,
        flavor: ['dark','high-contrast'].includes(effectiveTheme()) ? 'dark' : 'light',
        lang: 'en',
        attribution: '<a href="https://protomaps.com/">Protomaps</a>'
      });
      const previousLayer = baseLayer;
      let switched = false;
      const finishSwitch = () => {
        if (switched) return;
        switched = true;
        if (previousLayer && previousLayer !== offlineVectorLayer && map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
        baseLayer = offlineVectorLayer;
      };
      // Keep the complete raster fallback visible until the vector layer has
      // finished the current view; switching on the first tile creates a patchwork.
      offlineVectorLayer.on?.('load', finishSwitch);
      offlineVectorLayer.addTo(map);
      setTimeout(() => {
        if (!switched && offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
          // Leave the proven online layer in place if the PMTiles renderer never produced a tile.
          map.removeLayer(offlineVectorLayer);
          offlineVectorLayer = null;
        }
      }, 4500);
      return true;
    } catch (err) {
      console.warn('Packaged basemap could not be activated', err);
      return false;
    }
  }

  async function cacheOfflineDependencies(cache) {
    const urls = [
      './data/network.json', './data/data-meta.json', './about.js', './index.html', './styles.css', './app.js', './routing.js', './manifest.webmanifest',
      './icons/app-logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
      './vendor/leaflet.css',
      './vendor/leaflet.js',
      './vendor/leaflet-rotate.umd.min.js',
      './vendor/protomaps-leaflet.js'
    ];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (err) { console.warn('Could not cache offline dependency', url, err); }
    }
  }

  async function downloadOfflineMap() {
    if (state.offlineDownloadBusy) return;
    if (state.offlineMapDownloaded) {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        await cache.delete(new URL(OFFLINE_MAP_URL, location.href).href);
        state.offlineMapDownloaded = false;
        renderOfflineStatus();
        toast('Offline map removed');
      } catch (_) {}
      return;
    }
    if (!state.offlineMapAvailable) return;
    state.offlineDownloadBusy = true;
    const button = el('offlineDownloadBtn');
    const status = el('offlineStatus');
    button.disabled = true;
    button.textContent = 'Downloading…';
    status.textContent = 'Starting offline map download…';
    try {
      const response = await fetch(OFFLINE_MAP_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Offline map returned ${response.status}`);
      const total = Number(response.headers.get('Content-Length') || state.offlineMapBytes || 0);
      const chunks = [];
      let received = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); received += value.byteLength;
          status.textContent = total > 0
            ? `Downloading map… ${Math.min(100, Math.round(received / total * 100))}%`
            : `Downloading map… ${humanBytes(received)}`;
        }
      } else {
        chunks.push(new Uint8Array(await response.arrayBuffer()));
        received = chunks[0].byteLength;
      }
      const blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
      const cache = await caches.open(OFFLINE_CACHE);
      const url = new URL(OFFLINE_MAP_URL, location.href).href;
      await cache.put(url, new Response(blob, {
        status: 200,
        headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' }
      }));
      await cacheOfflineDependencies(cache);
      try { await navigator.storage?.persist?.(); } catch (_) {}
      state.offlineMapDownloaded = true;
      state.offlineMapBytes = blob.size || received;
      toast('Milton Keynes downloaded for offline use');
      await activatePackagedBasemap();
    } catch (err) {
      console.error(err);
      toast('Offline map download failed');
      status.textContent = 'Download failed. Check your connection and try again.';
    } finally {
      state.offlineDownloadBusy = false;
      renderOfflineStatus();
    }
  }

  el('offlineDownloadBtn').addEventListener('click', downloadOfflineMap);

  // PWA installation -------------------------------------------------------
  function updateInstallButtonVisibility() {
    const button = el('installAppBtn');
    if (!button) return;
    button.hidden = appInstalled;
  }

  function setInstallInstructions() {
    const steps = el('installSteps');
    const action = el('installActionBtn');
    steps.innerHTML = '';
    action.hidden = true;

    let copy;
    if (deferredInstallPrompt) {
      copy = [
        'Tap Install below.',
        'Confirm the browser installation prompt.'
      ];
      action.textContent = 'Install MK Redway';
      action.hidden = false;
    } else if (isIOS) {
      copy = [
        'Tap the Share button in your browser.',
        'Choose Add to Home Screen.',
        'Tap Add to finish.'
      ];
    } else if (/Android/i.test(navigator.userAgent)) {
      copy = [
        'Open your browser menu (⋮).',
        'Choose Install app or Add to Home screen.',
        'Confirm the installation.'
      ];
    } else {
      copy = [
        'Open your browser menu.',
        'Choose Install MK Redway, Install app, or Add to Home screen.'
      ];
    }

    for (const text of copy) {
      const li = document.createElement('li');
      li.textContent = text;
      steps.appendChild(li);
    }
  }

  function showInstallSheet() {
    setInstallInstructions();
    el('settingsSheet').hidden = true;
    el('savedSheet').hidden = true;
    el('installSheet').hidden = false;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtonVisibility();
  });

  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    deferredInstallPrompt = null;
    el('installSheet').hidden = true;
    updateInstallButtonVisibility();
    toast('MK Redway installed');
  });

  el('installAppBtn').addEventListener('click', showInstallSheet);
  el('closeInstall').addEventListener('click', () => { el('installSheet').hidden = true; });
  el('installActionBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showInstallSheet();
      return;
    }
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    try {
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        appInstalled = true;
        el('installSheet').hidden = true;
      }
    } catch (_) {}
    updateInstallButtonVisibility();
  });

  // Service worker + initial state ------------------------------------------
  el('app').dataset.appVersion = '0.14.0';
  if ('serviceWorker' in navigator) {
    const updateArea = document.createElement('div');
    updateArea.className = 'setting-block';
    updateArea.innerHTML = '<p id="appUpdateStatus" role="status">App updates are checked when you return online.</p><button id="appUpdateBtn" class="compact-action" type="button">Check for updates</button>';
    el('settingsSheet').insertBefore(updateArea, el('aboutData'));
    let registration;
    let hadController = Boolean(navigator.serviceWorker.controller);
    let updateReady = false;
    const ready = () => {
      updateReady = true;
      el('appUpdateStatus').textContent = 'An update is ready. Reload when you have finished your journey.';
      el('appUpdateBtn').textContent = 'Reload updated app';
      el('appUpdateBtn').disabled = false;
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        ready();
        toast('App updated. Open Settings to reload when ready.', 5000);
      }
      hadController = true;
    });
    async function checkUpdate(manual = false) {
      if (!registration || updateReady) return;
      if (!navigator.onLine) {
        if (manual) el('appUpdateStatus').textContent = 'You are offline. Connect to check for updates.';
        return;
      }
      if (manual) el('appUpdateStatus').textContent = 'Checking for updates…';
      try {
        await registration.update();
        if (!updateReady && manual) el('appUpdateStatus').textContent = registration.installing
          ? 'Downloading the update…' : 'No newer update found.';
      } catch (_) {
        if (manual) el('appUpdateStatus').textContent = 'Could not check for updates. Try again when connected.';
      }
    }
    el('appUpdateBtn').addEventListener('click', () => {
      if (updateReady) location.reload();
      else checkUpdate(true);
    });
    window.addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
        await checkUpdate();
      } catch (error) { console.warn(error); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate();
    });
    window.addEventListener('online', () => checkUpdate());
  }

  loadSettings();
  loadSavedPlaces();
  renderSavedPlaces();
  syncVoiceControls();
  syncUnitControls();
  syncRoutePreferenceControls();
  applyTheme();
  updatePlannerFields();
  setStage('explore');
  setTurnIcon('straight');
  loadRedways();
  const sharedRouteRestored = restoreSharedRoute();
  probeOfflineMap().then(() => activatePackagedBasemap()).catch(console.warn);

  el('layersBtn').addEventListener('click', () => {
    const popover = el('mapKeyPopover');
    popover.hidden = !popover.hidden;
    el('layersBtn').setAttribute('aria-expanded', String(!popover.hidden));
  });
  map.on('movestart', () => {
    if (!el('mapKeyPopover').hidden) {
      el('mapKeyPopover').hidden = true;
      el('layersBtn').setAttribute('aria-expanded', 'false');
    }
  });

  function locationIntroSeen() {
    try { return localStorage.getItem(LOCATION_HINT_KEY) === '1'; } catch (_) { return true; }
  }
  function closeLocationIntro() {
    el('locationIntro').hidden = true;
    try { localStorage.setItem(LOCATION_HINT_KEY, '1'); } catch (_) {}
  }
  el('locationIntroAllow').addEventListener('click', async () => {
    closeLocationIntro();
    await refreshBrowseLocation({center:false, quiet:false});
  });
  el('locationIntroDismiss').addEventListener('click', closeLocationIntro);

  (async () => {
    try {
      const permission = await navigator.permissions?.query?.({name: 'geolocation'});
      if (permission?.state === 'granted') {
        await refreshBrowseLocation({center:false, quiet:true});
      } else if (!sharedRouteRestored && !locationIntroSeen()) {
        el('locationIntro').hidden = false;
      }
    } catch (_) {
      if (!sharedRouteRestored && !locationIntroSeen()) el('locationIntro').hidden = false;
    }
  })();

  darkQuery?.addEventListener?.('change', () => {
    applyTheme();
    if (offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
      map.removeLayer(offlineVectorLayer);
      offlineVectorLayer = null;
      if (!map.hasLayer(onlineBaseLayer)) onlineBaseLayer.addTo(map);
      baseLayer = onlineBaseLayer;
      activatePackagedBasemap().catch(console.warn);
    }
  });
})();
