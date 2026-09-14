(() => {
  'use strict';
  const { parseBundledNetwork, hav, isRedway, allowed, edgeClass, multiplier, edgeDisplayName, buildGraph, nearestCandidates, aStarMulti, nearestNode, aStar, bearing, angleDiff, cardinal, buildCumulative, targetPhrase, buildManeuvers, initialInstruction, planRoute, routeErrorMessage, hasArrived, remainingJourney } = window.MKRouting;

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

  const el = id => document.getElementById(id);
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
  let baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  let offlineVectorLayer = null;
  const OFFLINE_MAP_URL = './data/mk-basemap.pmtiles';
  const OFFLINE_CACHE = 'mk-redway-offline-v1';
  const SAVED_KEY = 'mk-redway-saved-v1';
  const SETTINGS_KEY = 'mk-redway-settings-v1';
  const SETTINGS_LOGO_HINT_KEY = 'mk-redway-settings-logo-hint-v1';

  const redwayLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
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
    offlineDownloadBusy: false
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
        ? 'Search place or postcode'
        : 'Search place, address or postcode';
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
    state.stage = stage;
    el('exploreUI').hidden = stage !== 'explore';
    el('plannerUI').hidden = stage !== 'planner';
    el('placeSheet').hidden = stage !== 'place';
    el('routeSheet').hidden = stage !== 'planner';
    const nav = stage === 'navigation';
    el('navBanner').hidden = !nav;
    el('navBottom').hidden = !nav;
    el('mapControls').hidden = !nav;
    if (stage !== 'search-results') el('resultsSheet').hidden = true;
    if (stage !== 'explore') el('installSheet').hidden = true;
    if (!['explore', 'place'].includes(stage)) el('savedSheet').hidden = true;
    if (!['explore', 'place'].includes(stage)) el('settingsSheet').hidden = true;
    el('savedPlacesBtn').hidden = !['explore', 'place'].includes(stage);
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
    } catch (_) {}
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        voiceEnabled: state.voiceEnabled,
        units: state.units
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

  function openSavedPlace(place) {
    if (!place) return;
    setPoint('end', L.latLng(place.lat, place.lng), place.name, place.address || '');
    el('homeSearch').value = place.name;
    el('savedSheet').hidden = true;
    showPlaceSheet();
    map.setView([place.lat, place.lng], 16);
  }

  function renderSavedPlaces() {
    const home = state.saved.home;
    const work = state.saved.work;
    el('homeSavedLabel').textContent = home ? home.name : 'Not set';
    el('workSavedLabel').textContent = work ? work.name : 'Not set';
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
      open.innerHTML = '<span class="saved-kind-icon" aria-hidden="true">★</span><span class="saved-row-copy"><strong></strong><small></small></span>';
      open.querySelector('strong').textContent = place.name;
      open.querySelector('small').textContent = place.address || '';
      open.addEventListener('click', () => openSavedPlace(place));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.setAttribute('aria-label', `Remove ${place.name}`);
      remove.textContent = '×';
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
    el('homeSearch').placeholder = window.innerWidth <= 370 ? 'Search place or postcode' : 'Search place, address or postcode';
  }

  function setPoint(which, latlng, label = '', address = '') {
    state[which] = L.latLng(latlng.lat, latlng.lng);
    state[`${which}Label`] = label || fmtCoord(state[which]);
    if (which === 'end') state.endAddress = address || label || '';
    invalidateRoute();
    updatePlannerFields();
    redrawMarkers();
  }

  function updatePlannerFields() {
    if (document.activeElement !== el('startSearch')) {
      el('startSearch').value = state.start ? (state.startLabel || 'Your location') : '';
    }
    if (document.activeElement !== el('endSearch')) {
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
    el('approachNote').hidden = true;
    el('roadStat').textContent = '—';
    el('retryRouteBtn').hidden = true;
    el('startNavBtn').disabled = true;
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
    el('resultsTitle').textContent = results.length ? `Results for “${query}”` : 'No matching places';

    if (!results.length) {
      const msg = document.createElement('div');
      msg.className = 'result-message';
      msg.textContent = 'No Milton Keynes match found. Try a full postcode, street address or place name.';
      list.appendChild(msg);
    } else {
      for (const result of results) {
        const primary = conciseResultName(result);
        const secondary = resultSecondary(result, primary);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result-item';
        button.innerHTML = `<span class="result-icon" aria-hidden="true">⌖</span><span class="result-copy"><strong></strong><span></span></span>`;
        button.querySelector('strong').textContent = primary;
        button.querySelector('.result-copy span').textContent = secondary;
        button.addEventListener('click', () => selectSearchResult(result, context));
        list.appendChild(button);
      }
    }
    el('resultsSheet').hidden = false;
  }

  async function runSearch(context, input) {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    input.blur();
    el('resultsSheet').hidden = false;
    el('resultsTitle').textContent = 'Searching…';
    el('resultsList').innerHTML = '<div class="result-message">Searching Milton Keynes…</div>';
    try {
      const results = await geocode(query);
      showResults(results, context, query);
    } catch (err) {
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
    el('resultsSheet').hidden = true;

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
      map.setView([lat, lng], 16);
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
    el('resultsSheet').hidden = true;
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
    renderSavedPlaces();
    el('settingsSheet').hidden = true;
    el('savedSheet').hidden = false;
    probeOfflineMap().catch(() => {});
  });
  el('closeSaved').addEventListener('click', () => { el('savedSheet').hidden = true; });
  function settingsHintSeen() {
    try { return localStorage.getItem(SETTINGS_LOGO_HINT_KEY) === '1'; } catch (_) { return false; }
  }

  function markSettingsHintSeen() {
    try { localStorage.setItem(SETTINGS_LOGO_HINT_KEY, '1'); } catch (_) {}
  }

  function dismissSettingsLogoHint() {
    markSettingsHintSeen();
    el('settingsLogoHint').hidden = true;
  }

  function openSettings() {
    dismissSettingsLogoHint();
    el('savedSheet').hidden = true;
    el('installSheet').hidden = true;
    syncVoiceControls();
    syncUnitControls();
    el('settingsSheet').hidden = false;
  }

  function showSettingsLogoHintOnce() {
    if (settingsHintSeen()) return;
    el('settingsLogoHint').hidden = false;
    setTimeout(() => el('settingsHintGotIt')?.focus({ preventScroll: true }), 80);
  }

  el('logoSettingsBtn').addEventListener('click', openSettings);
  el('settingsHintGotIt').addEventListener('click', dismissSettingsLogoHint);
  el('closeSettings').addEventListener('click', () => { el('settingsSheet').hidden = true; });
  el('voiceSettingBtn').addEventListener('click', () => {
    setVoiceEnabled(!state.voiceEnabled, { announce: !state.voiceEnabled });
  });
  document.querySelectorAll('[data-units]').forEach(button => {
    button.addEventListener('click', () => setUnits(button.dataset.units));
  });
  el('setHomeBtn').addEventListener('click', () => beginSavedSearch('home'));
  el('setWorkBtn').addEventListener('click', () => beginSavedSearch('work'));
  el('addFavouriteBtn').addEventListener('click', () => beginSavedSearch('favourite'));
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
    if (state.stage === 'explore' || state.stage === 'place') {
      setPoint('end', e.latlng, 'Dropped pin', fmtCoord(e.latlng));
      showPlaceSheet();
    }
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
    el('useLocationBtn').disabled = true;
    setRouteStatus('Getting your current location…');
    try {
      const pos = await acquireCurrentLocation();
      setPoint('start', pos.latlng, 'Your location');
      map.setView(pos.latlng, 15);
      if (calculate) maybeCalculateRoute();
      return pos.latlng;
    } catch (err) {
      console.error(err);
      setRouteStatus('Location unavailable. Search for the starting address or postcode instead.', 'warn');
      toast('Location unavailable — enter a starting point');
      return null;
    } finally {
      el('useLocationBtn').disabled = false;
    }
  }

  el('useLocationBtn').addEventListener('click', () => useCurrentLocation());

  el('directionsBtn').addEventListener('click', async () => {
    setStage('planner');
    updatePlannerFields();
    if (!state.start) await useCurrentLocation({ calculate: false });
    maybeCalculateRoute();
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
    invalidateRoute();
    maybeCalculateRoute();
  }
  el('cycleBtn').addEventListener('click', () => setMode('cycle'));
  el('walkBtn').addEventListener('click', () => setMode('walk'));

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
    const groups = { superredway: [], redway: [], leisure: [], shared: [] };
    for (const w of parsed.ways) {
      const cls = edgeClass(w.tags || {});
      if (!groups[cls]) continue;
      const pts = w.nodes.map(id => parsed.nodes.get(id)).filter(Boolean).map(n => [n.lat, n.lon]);
      if (pts.length >= 2) groups[cls].push(pts);
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
    if (parsed === state.routingNetwork) {
      const key = `${mode}:${pref}`;
      if (!state.graphCache.has(key)) {
        // Keep memory predictable on phones; an old graph can still be referenced by
        // an active route even after it drops out of this small cache.
        if (state.graphCache.size >= 2) state.graphCache.clear();
        state.graphCache.set(key, buildGraph(parsed, mode, pref));
      }
      return state.graphCache.get(key);
    }
    return buildGraph(parsed, mode, pref);
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
      el('navRemain').textContent = `${formatDuration(mins)} · ${formatDistance(remaining)} remaining`;
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
    const source = state.networkSource === 'bundled' ? 'Using downloaded routing data' : 'Using online fallback data';
    return `Route ready · ${source}`;
  }

  function renderAlternatives() {
    const container = el('routeAlternatives'); container.replaceChildren();
    if (state.mode !== 'cycle') return;
    for (const option of state.alternatives) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'route-option' + (option.pref === state.pref ? ' selected' : '');
      button.setAttribute('aria-pressed', String(option.pref === state.pref));
      const title = document.createElement('strong'); title.textContent = PREF_LABEL[option.pref];
      const detail = document.createElement('span');
      detail.textContent = option.error ? 'No route' : `${formatDistance(option.dist)} · ${formatDuration(option.mins)} · ${option.roadPercent}% road`;
      button.append(title, detail); button.disabled = Boolean(option.error) || state.routing;
      button.addEventListener('click', () => {
        state.pref = option.pref; el('prefLabel').textContent = PREF_LABEL[option.pref];
        document.querySelectorAll('[data-pref]').forEach(b => b.classList.toggle('active', b.dataset.pref === option.pref));
        invalidateRoute(); maybeCalculateRoute();
      });
      container.append(button);
    }
  }

  function renderApproachNote() {
    const route = state.route, note = el('approachNote');
    note.hidden = !route || route.approachDist < 5;
    if (!route) return;
    note.textContent = `Approaches: ${formatDistance(route.snaps.start)} at the start, ${formatDistance(route.snaps.end)} at the destination. Dashed lines are unverified gaps, not mapped paths. Totals include an estimated walking approach. Choose an entrance if needed.`;
  }

  function installRoute(plan, { fit = true } = {}) {
    state.route = plan;
    drawRoute(plan.coords, fit);
    el('timeStat').textContent = formatDuration(plan.mins);
    el('arrivalStat').textContent = `Arrive about ${arrivalTime(plan.mins)}`;
    el('distanceStat').textContent = formatDistance(plan.dist);
    el('redwayStat').textContent = `${plan.redwayPercent}%`;
    el('roadStat').textContent = `${plan.roadPercent}%`;
    el('startNavBtn').disabled = false;
    renderApproachNote();
    setRouteStatus(routeReadyStatus(), state.networkSource === 'bundled' ? 'good' : 'warn');
  }

  async function solveRouteOnNetwork(parsed, { fit = true } = {}) {
    const revision = state.routeRevision;
    const {start, end, mode, pref, endLabel} = state;
    const choices = mode === 'cycle' && !state.navigating ? ['maximum', 'balanced', 'fastest'] : [pref];
    const alternatives = []; let selected = null, selectedError;
    for (const choice of choices) {
      await sleep(0);
      if (revision !== state.routeRevision) return;
      try {
        const plan = planRoute(parsed, getGraph(parsed, mode, choice), start, end, mode, endLabel);
        alternatives.push({pref:choice, dist:plan.dist, mins:plan.mins, roadPercent:plan.roadPercent});
        if (choice === pref) selected = plan;
      } catch (err) {
        alternatives.push({pref:choice,error:true});
        if (choice === pref) selectedError = err;
      }
    }
    if (revision !== state.routeRevision) return;
    state.graphCache.clear(); // Keep only the selected plan's graph after comparing routes.
    state.alternatives = alternatives;
    if (!selected) throw selectedError || new Error('No route');
    installRoute(selected, {fit}); renderAlternatives();
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

  el('retryRouteBtn').addEventListener('click', () => calculateRoute());
  for (const which of ['start','end']) {
    el(which === 'start' ? 'moveStartBtn' : 'moveEndBtn').addEventListener('click', () => {
      state.editEndpoint = which;
      setRouteStatus(`Tap an accessible ${which === 'start' ? 'starting point' : 'destination entrance'} on the map.`, 'warn');
      toast('Tap the map to place the entrance', 5000);
    });
  }

  el('clearBtn').addEventListener('click', () => {
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
    el('navEta').textContent = arrivalTime(mins);
    el('navRemain').textContent = `${formatDuration(mins)} · ${formatDistance(journey.distance)} remaining`;

    const { maneuver, index, next } = activeManeuver(progress);
    if (maneuver) {
      const d = Math.max(0, maneuver.at - progress);
      el('turnIcon').textContent = maneuver.icon;
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
    el('turnIcon').textContent = '↑';
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
    resetMapOrientation();
    userLayer.clearLayers();
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
      return Boolean(await cache.match(new URL(OFFLINE_MAP_URL, location.href).href));
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
        flavor: 'light',
        lang: 'en',
        attribution: '© OpenStreetMap contributors'
      });
      const previousLayer = baseLayer;
      let switched = false;
      const finishSwitch = () => {
        if (switched) return;
        switched = true;
        if (previousLayer && previousLayer !== offlineVectorLayer && map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
        baseLayer = offlineVectorLayer;
      };
      offlineVectorLayer.on?.('tileload', finishSwitch);
      offlineVectorLayer.on?.('load', finishSwitch);
      offlineVectorLayer.addTo(map);
      map.attributionControl.addAttribution('© OpenStreetMap contributors');
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
      './data/network.json', './index.html', './styles.css', './app.js', './routing.js', './manifest.webmanifest',
      './icons/app-logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      'https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.2.4/dist/leaflet-rotate.umd.min.js',
      'https://unpkg.com/protomaps-leaflet@5.1.0/dist/protomaps-leaflet.js'
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
    button.hidden = appInstalled || state.stage !== 'explore';
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
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }

  loadSettings();
  loadSavedPlaces();
  renderSavedPlaces();
  syncVoiceControls();
  syncUnitControls();
  updatePlannerFields();
  setStage('explore');
  setTimeout(showSettingsLogoHintOnce, 450);
  loadRedways();
  probeOfflineMap().then(() => activatePackagedBasemap()).catch(console.warn);
})();
