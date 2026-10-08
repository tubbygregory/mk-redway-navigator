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
  let gpxLoadRevision = 0;
  let startLocationRevision = 0;
  let navigationStartRevision = 0;
  let navigationStartPending = false;
  function cancelNavigationStart() { navigationStartRevision += 1; navigationStartPending = false; }
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
  const CULTURAL_ROUTE_COLOURS = {blue: '#3c78d8', yellow: '#d5a500', green: '#23864a', iron: '#5f6670', cornflower: '#6495ed'};
  const CULTURAL_ROUTES = [
    {
      id: 'blue', color: 'Blue', title: 'Ancient & Modern Milton Keynes', fullMiles: 10, shortMiles: 5,
      tags: ['heritage'], highlights: ['Great Linford', 'Campbell Park', 'Concrete Cows', 'Bradwell Windmill'],
      fullGpx: './cultural-routes/gpx-blue-main.gpx',
      shortGpx: './cultural-routes/gpx-blue-short.gpx',
      fullGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-blue-main.gpx',
      shortGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-blue-short.gpx'
    },
    {
      id: 'yellow', color: 'Yellow', title: 'Cars, Boats & Trains', fullMiles: 9.4, shortMiles: 5,
      tags: ['heritage','lakes'], highlights: ['Newport Pagnell', 'Tongwell Lake', 'Willen Lake'],
      fullGpx: './cultural-routes/gpx-yellow-main.gpx',
      shortGpx: './cultural-routes/gpx-yellow-short.gpx',
      fullGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-yellow-main.gpx',
      shortGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-yellow-short.gpx'
    },
    {
      id: 'green', color: 'Green', title: 'Rivers, Lakes & Dinosaurs', fullMiles: 10.1, shortMiles: 5,
      tags: ['lakes'], highlights: ['Open University', 'Grand Union Canal', 'Peartree Bridge'],
      fullGpx: './cultural-routes/gpx-green-main.gpx',
      shortGpx: './cultural-routes/gpx-green-short.gpx',
      fullGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-green-main.gpx',
      shortGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-green-short.gpx'
    },
    {
      id: 'iron', color: 'Iron', title: 'Romans, Rivers, Trams & Trains', fullMiles: 9.5, shortMiles: 5,
      tags: ['heritage'], highlights: ['Wolverton Mill', 'Iron Trunk Aqueduct', 'Bancroft', 'Stony Stratford'],
      fullGpx: './cultural-routes/gpx-iron-main.gpx',
      shortGpx: './cultural-routes/gpx-iron-short.gpx',
      fullGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-iron-main.gpx',
      shortGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-iron-short.gpx'
    },
    {
      id: 'cornflower', color: 'Cornflower', title: 'Woods, Frogs & a Toot', fullMiles: 8.2, shortMiles: 4,
      tags: ['lakes'], highlights: ['Shenley Toot', 'Howe Park Wood', 'Teardrop Lakes', 'Furzton Lake'],
      fullGpx: './cultural-routes/gpx-cornflower-main.gpx',
      shortGpx: './cultural-routes/gpx-cornflower-short.gpx',
      fullGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-cornflower-main.gpx',
      shortGpxSource: 'https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-cornflower-short.gpx'
    }
  ];

  const redwayLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const searchResultLayer = L.layerGroup().addTo(map);
  const userLayer = L.layerGroup().addTo(map);
  // Keep the credit independent of the zoom/scale controls so each can fit
  // around the current foreground panels without covering their actions.
  const mapCredit = map.attributionControl.getContainer();
  mapCredit.classList.add('map-attribution');
  el('app').appendChild(mapCredit);

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
    placeSearchIndex: [],
    placeSearchStatus: 'loading',
    placeSearchPromise: null,
    searchSubmissionActive: false,
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
    savedPickOnMap: false,
    savedPickRevision: 0,
    offlineMapAvailable: false,
    offlineMapDownloaded: false,
    offlineMapBytes: 0,
    offlineDownloadBusy: false,
    exploreFilter: 'all',
    importedRouteName: '',
    culturalRoute: null,
    nightThemeActive: false,
    lastThemeCheckAt: 0
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
      else search.placeholder = 'Search places';
    }
    syncBrowseAttribution();
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }

  let creditLayoutFrame = null;
  function syncBrowseAttribution() {
    if (creditLayoutFrame !== null) return;
    creditLayoutFrame = requestAnimationFrame(() => {
      creditLayoutFrame = null;
      positionMapAttribution();
    });
  }

  function positionMapAttribution() {
    const app = el('app');
    const frame = app.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = frame.width;
    const height = Math.min(frame.height, viewport?.height || frame.height);
    mapCredit.style.maxWidth = `${Math.min(260, Math.max(120, width - 24))}px`;
    const credit = mapCredit.getBoundingClientRect();
    const visibleRect = node => {
      if (!node || node.hidden || !node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') return null;
      const rect = node.getBoundingClientRect();
      return {left: rect.left - frame.left, right: rect.right - frame.left,
        top: rect.top - frame.top, bottom: rect.bottom - frame.top};
    };
    const topPanel = visibleRect(el(state.navigating ? 'navBanner' : state.stage === 'planner' ? 'plannerUI' : 'exploreUI'));
    const preferredTop = Math.ceil((topPanel?.bottom || 4) + 8);
    const portrait = width < 900 && width <= height;
    const notification = el('toast');
    const notificationVisible = notification && !notification.hidden;
    if (notificationVisible) notification.style.maxWidth = `${portrait ? width - 32 : Math.min(420, Math.max(150, width - (topPanel?.right || 0) - 24))}px`;
    const notificationSpace = portrait && notificationVisible ? notification.getBoundingClientRect().height + 12 : 0;
    // A full-width sheet must leave a strip between the search and the sheet
    // for the credit, including when favourite chips or instructions wrap.
    app.style.setProperty('--foreground-panel-max-height', `${Math.max(90, height - preferredTop - credit.height - notificationSpace - 26)}px`);
    const panels = ['exploreUI', 'plannerUI', 'placeSheet', 'routeSheet', 'savedSheet', 'settingsSheet',
      'exploreSheet', 'resultsSheet', 'installSheet', 'navBanner', 'navBottom', 'homeNav',
      'browseMapControls', 'mapControls', 'mapKeyPopover', 'arrivalSummary', 'locationRecovery'];
    const obstacles = panels.map(id => visibleRect(el(id))).filter(Boolean);
    const maxX = Math.max(8, width - credit.width - 8);
    const maxY = Math.max(8, height - credit.height - 8);
    const preferredX = portrait ? 10 : Math.min(maxX, Math.max(10, (topPanel?.right || 0) + 12));
    const preferredY = portrait ? preferredTop : Math.max(8, height - credit.height - 76);
    const xs = [preferredX, 10, maxX, ...obstacles.flatMap(r => [r.right + 8, r.left - credit.width - 8])];
    const ys = [preferredY, preferredTop, 8, maxY, ...obstacles.flatMap(r => [r.bottom + 8, r.top - credit.height - 8])];
    const candidates = [];
    for (const left of xs) for (const top of ys) {
      if (left < 8 || left > maxX || top < 8 || top > maxY) continue;
      if (obstacles.some(r => left < r.right + 4 && left + credit.width > r.left - 4 &&
          top < r.bottom + 4 && top + credit.height > r.top - 4)) continue;
      candidates.push({left, top, score: Math.abs(left - preferredX) + Math.abs(top - preferredY)});
    }
    candidates.sort((a, b) => a.score - b.score);
    const position = candidates[0] || {left: Math.min(maxX, preferredX), top: Math.min(maxY, preferredY)};
    mapCredit.style.left = `${Math.round(position.left)}px`;
    mapCredit.style.top = `${Math.round(position.top)}px`;
    if (notificationVisible) {
      notification.style.left = `${portrait ? width / 2 : ((topPanel?.right || 0) + width) / 2}px`;
      notification.style.top = portrait ? `${Math.round(position.top + credit.height + 8)}px` : 'auto';
      notification.style.bottom = portrait ? 'auto' : '122px';
    }
  }

  // Panels change size and visibility without a window resize. Observe the
  // instruction itself too, since a joining instruction can be multiline.
  const creditObserver = new ResizeObserver(syncBrowseAttribution);
  for (const id of ['exploreUI', 'plannerUI', 'placeSheet', 'routeSheet', 'savedSheet', 'settingsSheet',
    'exploreSheet', 'resultsSheet', 'navBanner', 'navBottom', 'homeNav', 'arrivalSummary', 'toast']) {
    const panel = el(id);
    if (panel) {
      creditObserver.observe(panel);
      new MutationObserver(syncBrowseAttribution).observe(panel, {attributes: true, attributeFilter: ['hidden', 'class']});
    }
  }
  new MutationObserver(syncBrowseAttribution).observe(mapCredit, {childList: true, subtree: true, characterData: true});

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
    clearArrivalSummary();
    gpxLoadRevision += 1;
    if (state.pendingSaveKind && !['explore', 'place'].includes(stage)) finishSavedSearch();
    if (stage !== 'planner') { cancelStartLocation(); cancelNavigationStart(); }
    state.stage = stage;
    state.plannerSearchOpen = false;
    searchRevision += 1;
    state.localSuggestionInput = null;
    state.localSuggestionContext = null;
    state.searchSubmissionActive = false;
    state.searchMapPickContext = null;
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
    syncBrowseAttribution();
    state.toastTimer = setTimeout(() => { t.hidden = true; syncBrowseAttribution(); }, ms);
  }

  function setRouteStatus(msg, kind = '') {
    const n = el('routeStatus');
    n.textContent = msg;
    n.className = 'route-status sheet-summary' + (kind ? ` ${kind}` : '');
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

  function normalizeSavedPlace(place) {
    const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
    if (!place || typeof place !== 'object' || Array.isArray(place) ||
        typeof place.lat !== 'number' || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90 ||
        typeof place.lng !== 'number' || !Number.isFinite(place.lng) || place.lng < -180 || place.lng > 180 ||
        !text(place.name, 500) || place.address !== undefined && (typeof place.address !== 'string' || place.address.length > 2000) ||
        place.id !== undefined && !text(place.id, 200)) return null;
    return {id: place.id || `legacy-${place.lat}-${place.lng}-${place.name.slice(0, 80)}`, name: place.name.trim(),
      address: place.address || '', lat: place.lat, lng: place.lng};
  }

  function sameSavedPlace(first, second) {
    return !!first && !!second && Math.abs(first.lat - second.lat) < 0.00002 && Math.abs(first.lng - second.lng) < 0.00002;
  }

  function favouriteName(value) {
    return typeof value === 'string' && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
  }

  function nextSavedPinName(saved) {
    const used = new Set(saved.favourites.map(place => place.name));
    let number = 1;
    while (used.has('Saved pin ' + number)) number++;
    return 'Saved pin ' + number;
  }

  function savedSnapshotForChange() {
    try {
      const value = localStorage.getItem(SAVED_KEY);
      const raw = JSON.parse(value || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved places');
      return {value, saved: {
        home: normalizeSavedPlace(raw.home), work: normalizeSavedPlace(raw.work),
        favourites: Array.isArray(raw.favourites) ? raw.favourites.map(normalizeSavedPlace).filter(Boolean) : []
      }};
    } catch (_) {
      toast('Saved places could not be read. Try again before making changes.', 6000);
      return null;
    }
  }

  function renderSavedUndo() {
    const undo = state.favouriteUndo;
    el('savedUndoNotice').hidden = !undo;
    if (undo) el('savedUndoText').textContent = undo.place.name + ' removed.';
  }

  function removeFavourite(place) {
    const snapshot = savedSnapshotForChange();
    if (!snapshot) return false;
    const index = snapshot.saved.favourites.findIndex(saved => saved.id === place.id && sameSavedPlace(saved, place));
    if (index < 0) {
      state.saved = snapshot.saved; renderSavedPlaces();
      toast('This favourite has already been removed.'); return false;
    }
    const favourites = [...snapshot.saved.favourites];
    const removed = favourites.splice(index, 1)[0];
    if (!persistSavedPlaces({...snapshot.saved, favourites}, snapshot.value)) return false;
    state.favouriteUndo = {place: removed, index, count: snapshot.saved.favourites.length,
      remainingIds: new Set(favourites.map(saved => saved.id))};
    if (state.favouriteNameTarget?.id === removed.id) closeFavouriteNameEditor();
    renderSavedUndo();
    el('undoFavouriteBtn').focus();
    return true;
  }

  function undoFavouriteRemoval() {
    const undo = state.favouriteUndo;
    if (!undo) return false;
    const snapshot = savedSnapshotForChange();
    if (!snapshot) return false;
    const favourites = [...snapshot.saved.favourites];
    if (favourites.some(saved => saved.id === undo.place.id || sameSavedPlace(saved, undo.place))) {
      state.saved = snapshot.saved;
      state.favouriteUndo = null;
      renderSavedPlaces(); renderSavedUndo();
      toast('That favourite is already saved.');
      return false;
    }
    // Preserve a legitimate pre-existing list above the current limit, but do
    // not let Undo bypass capacity after other favourites have been added.
    const capacity = undo.count > 30 && favourites.every(saved => undo.remainingIds.has(saved.id)) ? undo.count : 30;
    if (favourites.length >= capacity) {
      state.saved = snapshot.saved; renderSavedPlaces();
      toast('Remove another favourite before restoring this one. Your saved places have been kept.', 6000);
      return false;
    }
    favourites.splice(Math.min(undo.index, favourites.length), 0, undo.place);
    if (!persistSavedPlaces({...snapshot.saved, favourites}, snapshot.value)) return false;
    state.favouriteUndo = null;
    renderSavedUndo();
    toast('Favourite restored.');
    return true;
  }

  function openFavouriteNameEditor(place) {
    state.favouriteNameTarget = {...place};
    el('favouriteNameInput').value = place.name;
    el('favouriteNameEditor').hidden = false;
    el('favouriteNameInput').focus();
    el('favouriteNameInput').select();
    el('favouriteNameEditor').scrollIntoView({block: 'nearest'});
  }

  function closeFavouriteNameEditor() {
    const id = state.favouriteNameTarget?.id;
    state.favouriteNameTarget = null;
    el('favouriteNameEditor').hidden = true;
    el('favouriteNameInput').value = '';
    const buttons = el('favouritesList').querySelectorAll?.('.saved-rename') || [];
    Array.from(buttons).find(button => button.dataset.favouriteId === id)?.focus();
  }

  function saveFavouriteName() {
    const target = state.favouriteNameTarget;
    if (!target) return false;
    const name = favouriteName(el('favouriteNameInput').value);
    if (!name) { toast('Enter a name of up to 80 characters, without line breaks.', 6000); return false; }
    const snapshot = savedSnapshotForChange();
    if (!snapshot) return false;
    const index = snapshot.saved.favourites.findIndex(saved => saved.id === target.id && sameSavedPlace(saved, target));
    if (index < 0 || snapshot.saved.favourites[index].name !== target.name) {
      state.saved = snapshot.saved; renderSavedPlaces();
      toast('This favourite changed elsewhere. Close this editor and choose it again.', 6000);
      return false;
    }
    const favourites = [...snapshot.saved.favourites];
    favourites[index] = {...favourites[index], name};
    if (!persistSavedPlaces({...snapshot.saved, favourites}, snapshot.value)) return false;
    closeFavouriteNameEditor();
    toast('Favourite name updated.');
    return true;
  }

  el('undoFavouriteBtn').addEventListener('click', undoFavouriteRemoval);
  el('favouriteNameEditor').addEventListener('submit', event => { event.preventDefault(); saveFavouriteName(); });
  el('favouriteNameCancelBtn').addEventListener('click', closeFavouriteNameEditor);
  el('favouriteNameInput').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeFavouriteNameEditor(); }
  });

  function syncSaveFavouriteButton() {
    const saved = state.saved.favourites.some(place => sameSavedPlace(place, state.end));
    el('saveFavouriteLabel').textContent = saved ? 'Saved' : 'Save';
    el('saveFavouriteBtn').classList.toggle('is-saved', saved);
    el('saveFavouriteBtn').setAttribute('aria-pressed', String(saved));
  }

  function loadSavedPlaces() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      state.saved = {
        home: normalizeSavedPlace(raw?.home),
        work: normalizeSavedPlace(raw?.work),
        favourites: Array.isArray(raw?.favourites) ? raw.favourites.map(normalizeSavedPlace).filter(Boolean) : []
      };
    } catch (_) {
      state.saved = { home: null, work: null, favourites: [] };
    }
  }

  function persistSavedPlaces(nextSaved = state.saved, expectedValue) {
    try {
      if (arguments.length > 1 && localStorage.getItem(SAVED_KEY) !== expectedValue) {
        toast('Saved places changed in another tab. Open Saved and try again.', 6000);
        return false;
      }
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextSaved));
    }
    catch (_) { toast('Saved places could not be updated. Browser storage is full or unavailable.', 6000); return false; }
    state.saved = nextSaved;
    renderSavedPlaces();
    return true;
  }

  function savePlace(kind, candidate, {mapPin = false} = {}) {
    let customName = '';
    if (kind === 'favourite' && state.pendingSaveKind === 'favourite') {
      const name = favouriteName(el('savedFavouriteNameInput').value);
      if (name === null) { toast('Use a name of up to 80 characters, without line breaks.', 6000); return {ok: false}; }
      customName = name;
      if (customName) candidate = {...candidate, name: customName};
    }
    const place = normalizeSavedPlace(candidate);
    if (!place || !['home', 'work', 'favourite'].includes(kind)) return {ok: false};
    const snapshot = savedSnapshotForChange();
    if (!snapshot) return {ok: false};
    const saved = snapshot.saved;
    if (kind === 'favourite' && mapPin && !customName) place.name = nextSavedPinName(saved);
    const duplicate = kind === 'favourite' && saved.favourites.some(existing => sameSavedPlace(existing, place));
    if (duplicate) { state.saved = saved; renderSavedPlaces(); return {ok: true, duplicate: true}; }
    if (!validateSearchResult({lat: place.lat, lon: place.lng})) {
      toast('Choose a point within the Milton Keynes map area.', 6000);
      return {ok: false};
    }
    if (kind === 'favourite' && saved.favourites.length >= 30) {
      state.saved = saved; renderSavedPlaces();
      toast('You can save up to 30 favourites. Remove one before adding another.', 6000);
      return {ok: false};
    }
    const next = {...saved, favourites: [...saved.favourites]};
    if (kind === 'favourite') next.favourites.unshift(place);
    else next[kind] = place;
    return {ok: persistSavedPlaces(next, snapshot.value), duplicate: false};
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
    place = normalizeSavedPlace(place);
    if (!place) return;
    closeFavouriteNameEditor();
    if (state.pendingSaveKind) finishSavedSearch();
    const point = L.latLng(place.lat, place.lng);
    setPoint('end', point, place.name, place.address || '');
    el('homeSearch').value = place.name;
    el('savedSheet').hidden = true;
    showPlaceSheet();
    showDestinationInContext(point);
  }

  function renderSavedPlaces() {
    syncSaveFavouriteButton();
    renderSavedUndo();
    const home = state.saved.home;
    const work = state.saved.work;
    el('homeSavedLabel').textContent = home ? (home.name === 'Home' ? home.address || home.name : home.name) : 'Add Home for a quicker start';
    el('workSavedLabel').textContent = work ? (work.name === 'Work' ? work.address || work.name : work.name) : 'Add Work when you need it';
    el('setHomeBtn').textContent = home ? 'Change Home' : 'Set Home';
    el('setWorkBtn').textContent = work ? 'Change Work' : 'Set Work';
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
      button.setAttribute('aria-label', place.name);
      button.title = place.name;
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"></path></svg><span></span>';
      button.querySelector('span').textContent = place.name;
      button.addEventListener('click', () => openSavedPlace(place));
      quick.appendChild(button);
    }
    quick.hidden = !home && !work && !state.saved.favourites.length;
    el('quickPlacesShell').hidden = quick.hidden;
    if (!quick.dataset.scrollCueReady) {
      quick.addEventListener('scroll', updateQuickPlacesOverflow, {passive: true});
      window.addEventListener('resize', updateQuickPlacesOverflow, {passive: true});
      quick.dataset.scrollCueReady = 'true';
    }
    requestAnimationFrame(updateQuickPlacesOverflow);
    const list = el('favouritesList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.saved.favourites.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'Keep your regular stops handy.';
      const hint = document.createElement('p');
      hint.className = 'saved-empty-hint';
      hint.textContent = 'Add a place or a map pin. Your favourites stay on this device.';
      list.append(empty, hint);
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
      const actions = document.createElement('div');
      actions.className = 'saved-favourite-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'saved-rename';
      rename.dataset.favouriteId = place.id;
      rename.setAttribute('aria-label', `Rename ${place.name}`);
      rename.title = 'Rename favourite';
      rename.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4"></path></svg>';
      rename.addEventListener('click', () => openFavouriteNameEditor(place));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.setAttribute('aria-label', `Remove ${place.name}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"></path></svg>';
      remove.addEventListener('click', () => removeFavourite(place));
      actions.append(rename, remove);
      row.append(open, actions);
      list.appendChild(row);
    }
  }

  function updateQuickPlacesOverflow() {
    const quick = el('quickPlaces');
    const maxScroll = quick.scrollWidth - quick.clientWidth;
    el('quickPlacesShell').dataset.canScroll = String(!quick.hidden && maxScroll > 2 && quick.scrollLeft < maxScroll - 2);
  }

  function beginSavedSearch(kind) {
    if (!['home', 'work', 'favourite'].includes(kind)) return;
    closeSearch();
    closeFavouriteNameEditor();
    el('savedFavouriteNameInput').value = '';
    state.pendingSaveKind = kind;
    state.savedPickOnMap = false;
    state.savedPickRevision = (state.savedPickRevision || 0) + 1;
    el('savedSheet').hidden = true;
    el('settingsSheet').hidden = true;
    el('locationIntro').hidden = true;
    setStage('explore');
    el('homeSearch').value = '';
    el('homeSearch').placeholder = kind === 'home' ? 'Search for Home' : kind === 'work' ? 'Search for Work' : 'Search for a favourite';
    el('homeSearch').blur();
    renderSavedPicker();
  }

  function renderSavedPicker() {
    const kind = state.pendingSaveKind;
    el('savedPlacePicker').hidden = !kind;
    el('savedFavouriteNameField').hidden = kind !== 'favourite';
    if (state.savedPickOnMap) el('savedFavouriteNameInput').blur();
    if (!kind) return;
    const label = kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : 'a favourite';
    el('savedPlacePickerTitle').textContent = kind === 'favourite' ? 'Add a favourite' : `Set ${label}`;
    el('savedPlacePickerHint').textContent = state.savedPickOnMap
      ? `Tap the map to save ${label}. Drag or zoom the map to find the right point.`
      : 'Search for a place, or choose a point on the map.';
    el('pickSavedOnMapBtn').hidden = !!state.savedPickOnMap;
  }

  function savePendingMapPin(latlng) {
    if (!state.pendingSaveKind) return false;
    if (!validateSearchResult({lat: latlng?.lat, lon: latlng?.lng})) {
      toast('Choose a point within the Milton Keynes map area.', 6000);
      return true;
    }
    const kind = state.pendingSaveKind;
    const name = kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : 'Saved pin';
    const candidate = {id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, address: fmtCoord(latlng), lat: latlng.lat, lng: latlng.lng};
    const result = savePlace(kind, candidate, {mapPin: true});
    if (!result.ok) return true;
    closeSearch();
    finishSavedSearch();
    el('savedSheet').hidden = false;
    toast(result.duplicate ? 'Already saved' : kind === 'home' ? 'Home saved' : kind === 'work' ? 'Work saved' : 'Favourite saved');
    return true;
  }

  function finishSavedSearch() {
    state.pendingSaveKind = null;
    state.savedPickOnMap = false;
    state.savedPickRevision = (state.savedPickRevision || 0) + 1;
    el('savedFavouriteNameInput').value = '';
    renderSavedPicker();
    el('homeSearch').value = '';
    el('homeSearch').placeholder = 'Search places';
  }

  function setPoint(which, latlng, label = '', address = '') {
    if (which === 'start') cancelStartLocation();
    if (which === 'end') state.culturalRoute = null;
    state.importedRouteName = state.culturalRoute?.title || '';
    state[which] = L.latLng(latlng.lat, latlng.lng);
    state[`${which}Label`] = label || fmtCoord(state[which]);
    if (which === 'start' && state.culturalRoute) {
      state.culturalRoute.originLabel = state.startLabel;
      state.culturalRoute.phase = 'awaiting';
    }
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
        .addTo(markerLayer).bindTooltip(document.createTextNode(state.endLabel || 'Destination'));
    }
  }

  function invalidateRoute() {
    clearArrivalSummary();
    routeLayer.clearLayers();
    el('culturalRouteLegend').hidden = true;
    state.routeRevision++;
    state.route = null;
    state.alternatives = [];
    el('routeAlternatives').replaceChildren();
    el('routeInsights').hidden = true;
    el('approachNote').hidden = true;
    el('routeApproachSummary').hidden = true;
    el('routeApproachSummary').textContent = '';
    el('routeTrackStatus').hidden = true;
    el('routeClassification').hidden = false;
    el('routeModeLabel').textContent = state.mode === 'walk' ? 'Walking' : 'Cycling';
    el('roadStat').textContent = '—';
    el('retryRouteBtn').hidden = true;
    el('startNavBtn').disabled = true;
    el('sendToPhoneBtn').disabled = true;
    el('timeStat').textContent = '—';
    el('distanceStat').textContent = '—';
    el('redwayStat').textContent = '—';
    el('arrivalStat').textContent = 'Route preview';
  }

  function searchText(value) {
    return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  }

  function validateSearchResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    if (![result.lat, result.lon].every(value =>
      (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)))) return false;
    const lat = Number(result.lat), lon = Number(result.lon);
    return lat >= MK.south && lat <= MK.north && lon >= MK.west && lon <= MK.east;
  }

  function conciseResultName(result) {
    const a = result?.address || {};
    const namedPlace = [a.shop, a.amenity, a.tourism, a.leisure, a.office, a.building].map(searchText).find(Boolean);
    const name = namedPlace || searchText(result?.name);
    const house = searchText(a.house_number), road = searchText(a.road);
    const address = [house, road].filter(Boolean).join(' ');
    // Keep a useful title separate from address context. A provider may name a
    // numbered address after its street or number; neither may lose the number.
    if (house && road && (!name || [house, road, address].some(value => value.toLowerCase() === name.toLowerCase()))) return address;
    return name || address || searchText(result?.display_name).split(',')[0].trim() || 'Map location';
  }

  function resultAddress(result, primary) {
    const a = result?.address || {};
    const street = [searchText(a.house_number), searchText(a.road)].filter(Boolean).join(' ');
    const localities = [a.suburb, a.neighbourhood, a.village, a.town, a.city_district, a.city].map(searchText).filter(Boolean);
    const parts = [street, ...localities, searchText(a.postcode)].filter(Boolean);
    const context = parts.length ? parts : searchText(result?.display_name).split(',').map(part => part.trim()).filter(Boolean);
    const distinct = context.filter((part, index) => part.toLowerCase() !== primary.toLowerCase() &&
      context.findIndex(other => other.toLowerCase() === part.toLowerCase()) === index);
    return distinct.join(', ') || 'Milton Keynes';
  }

  function resultSecondary(result, primary) {
    return [resultAddress(result, primary), searchText(result?.matchNote) || resultAccuracyNote(result)].filter(Boolean).join(' · ');
  }

  function resultAccuracyNote(result) {
    if (result.requestedHouseNumber) return `Number ${result.requestedHouseNumber} not found locally · check entrance on map`;
    if (result.matchNote) return searchText(result.matchNote);
    const type = searchText(result.type || result.addresstype).toLowerCase();
    if (result.class === 'highway' || ['street or path', 'road', 'street', 'footway', 'path', 'cycleway'].includes(type)) {
      return 'Street or path match · choose the entrance on the map';
    }
    if (result.address?.house_number && result.address?.road) return 'Mapped address · check entrance on map';
    if (['house', 'building'].includes(type)) return 'Building match · check entrance on map';
    return '';
  }

  function resultTypeLabel(result) {
    const raw = (searchText(result.type) || searchText(result.addresstype)).replaceAll('_', ' ');
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  }

  function resultOrigin() {
    return state.userLatLng || state.start || null;
  }

  function resultDistance(result) {
    if (!validateSearchResult(result)) return null;
    const origin = resultOrigin();
    const lat = Number(result.lat), lon = Number(result.lon);
    return origin && Number.isFinite(lat) && Number.isFinite(lon)
      ? hav({lat: origin.lat, lon: origin.lng}, {lat, lon})
      : null;
  }

  function dedupeSearchResults(results) {
    const chosen = [];
    const localAddress = result => {
      const a = result.address || {};
      const fields = [a.house_number, a.road, a.postcode, a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city]
        .map(value => searchText(value).toLowerCase());
      return fields.some(Boolean) ? fields.join('|') : searchText(result.display_name).toLowerCase();
    };
    for (const result of Array.isArray(results) ? results : []) {
      if (!validateSearchResult(result)) continue;
      const primary = conciseResultName(result).toLowerCase();
      const lat = Number(result.lat), lon = Number(result.lon);
      const duplicate = chosen.some(other => {
        if (searchText(result.osm_type) && searchText(result.osm_id) &&
            result.osm_type === other.osm_type && String(result.osm_id) === String(other.osm_id)) return true;
        return conciseResultName(other).toLowerCase() === primary && localAddress(other) === localAddress(result) &&
          hav({lat, lon}, {lat: Number(other.lat), lon: Number(other.lon)}) < 50;
      });
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
      if (!validateSearchResult({lat: mid.lat, lon: mid.lon})) continue;
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
    const exactSaved = ranked.filter(item => item.item.type === 'Saved place' && searchWords(item.item.name).join(' ') === searchWords(query).join(' '));
    return dedupeSearchResults([...exactSaved.map(item => item.item), ...searchLocalPlaces(query), ...ranked.map(x => x.item)]).slice(0, 5);
  }

  function searchWords(text) {
    return normalizeSearchQuery(text).toLowerCase().replace(/'s\b/g, '').replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word && !['the', 'of', 'and'].includes(word));
  }

  function wordMatchScore(query, word) {
    if (query === word) return 0;
    if (/\d/.test(query) || /\d/.test(word)) return null;
    if (query.length >= 2 && word.startsWith(query)) return 1;
    const singular = value => value.length > 5 && value.endsWith('s') ? value.slice(0, -1) : value;
    const a = singular(query), b = singular(word);
    if (a === b) return 1;
    if (a.length < 5 || b.length < 5 || a[0] !== b[0] || Math.abs(a.length - b.length) > 1) return null;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return null;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return edits + (i < a.length || j < b.length ? 1 : 0) <= 1 ? 3 : null;
  }

  function placeWordScore(words, candidates) {
    let total = 0;
    for (const word of words) {
      let best = Infinity;
      for (const candidate of candidates) {
        const score = wordMatchScore(word, candidate);
        if (score !== null) best = Math.min(best, score);
      }
      if (!Number.isFinite(best)) return null;
      total += best;
    }
    return total;
  }

  function parsePlaceIndex(data) {
    const required = ['format', 'source', 'source_timestamp', 'source_sha256', 'generated_at', 'bounds', 'entries'];
    const textLimits = {name: 200, house_number: 40, street: 200, postcode: 32, locality: 160, category: 80};
    const validText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit &&
      value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
    const timestamp = value => {
      if (typeof value !== 'string' || value.length > 40) return NaN;
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
      if (!match) return NaN;
      const [, y, m, d, h, min, sec, , offsetHour, offsetMinute] = match;
      const year = Number(y), month = Number(m), day = Number(d);
      const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 ||
        Number(offsetHour || 0) > 23 || Number(offsetMinute || 0) > 59 ? NaN : Date.parse(value);
    };
    const sourceTime = timestamp(data?.source_timestamp), generatedTime = timestamp(data?.generated_at);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== required.length ||
        !required.every(key => Object.hasOwn(data, key)) || data.format !== 'mk-redway-places-v1' ||
        data.source !== 'OpenStreetMap / Geofabrik' || !data.bounds || Object.keys(data.bounds).length !== Object.keys(MK).length ||
        !Object.keys(MK).every(key => data.bounds[key] === MK[key]) ||
        typeof data.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.source_sha256) ||
        !Number.isFinite(sourceTime) || !Number.isFinite(generatedTime) || sourceTime > generatedTime ||
        generatedTime > Date.now() + 86400000 || !Array.isArray(data.entries) ||
        data.entries.length < 1 || data.entries.length > 50000) throw new Error('Unsupported local place data');
    const seen = new Set();
    return data.entries.map(entry => {
      const requiredEntry = ['id', 'kind', 'lat', 'lon', 'location'];
      const allowedEntry = [...requiredEntry, ...Object.keys(textLimits), 'aliases'];
      if (!validateSearchResult(entry) || !requiredEntry.every(key => Object.hasOwn(entry, key)) ||
          !Object.keys(entry).every(key => allowedEntry.includes(key)) || typeof entry.lat !== 'number' || typeof entry.lon !== 'number' ||
          typeof entry.id !== 'string' || !/^[nw][1-9][0-9]{0,19}$/.test(entry.id) || seen.has(entry.id) ||
          !['mapped point', 'building centre', 'mapped feature centre'].includes(entry.location) ||
          (entry.id[0] === 'n') !== (entry.location === 'mapped point') ||
          !Object.entries(textLimits).every(([key, limit]) => !Object.hasOwn(entry, key) || validText(entry[key], limit)) ||
          !(entry.kind === 'place' ? entry.name && entry.category : entry.kind === 'address' ? entry.street && (entry.house_number || entry.name) :
            entry.kind === 'building' ? entry.name && entry.street && !entry.house_number : false) ||
          Object.hasOwn(entry, 'aliases') && (!Array.isArray(entry.aliases) || entry.aliases.length < 1 || entry.aliases.length > 8 ||
            !entry.aliases.every(alias => validText(alias, 200)) || new Set(entry.aliases.map(alias => alias.toLowerCase())).size !== entry.aliases.length ||
            entry.aliases.some(alias => alias.toLowerCase() === (entry.name || '').toLowerCase()))) throw new Error('Invalid local place entry');
      seen.add(entry.id);
      const names = [entry.name, ...(entry.aliases || [])].filter(Boolean).map(searchWords);
      const words = searchWords([entry.name, ...(entry.aliases || []), entry.house_number, entry.street, entry.postcode, entry.locality].filter(Boolean).join(' '));
      return {...entry, _names: names, _words: words};
    });
  }

  async function loadPlaceIndex() {
    if (state.placeSearchPromise) return state.placeSearchPromise;
    state.placeSearchStatus = 'loading';
    state.placeSearchPromise = (async () => {
      const url = new URL('./data/places.json', location.href).href;
      const read = async response => {
        if (!response?.ok) throw new Error('Local place data unavailable');
        const text = await response.text();
        if (text.length > 10 * 1024 * 1024) throw new Error('Local place data too large');
        return parsePlaceIndex(JSON.parse(text));
      };
      let parsed;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        parsed = await read(await fetch(url, {signal: controller.signal}));
      } catch (error) {
        try { parsed = await read(await caches.match(url)); } catch (_) {}
        if (!parsed) {
          // A malformed cached asset must not keep blocking a later download.
          try {
            for (const name of await caches.keys()) {
              if (name === OFFLINE_CACHE || name.startsWith('mk-redway-shell-')) await (await caches.open(name)).delete(url);
            }
          } catch (_) {}
          state.placeSearchStatus = 'unavailable';
          return false;
        }
      } finally { clearTimeout(timer); }
      state.placeSearchIndex = parsed;
      state.placeSearchStatus = 'ready';
      const input = state.localSuggestionInput;
      if (input && !state.searchSubmissionActive && document.activeElement === input &&
          (input === el('homeSearch') && ['explore', 'place'].includes(state.stage) ||
           state.stage === 'planner' && state.plannerSearchOpen)) renderTypeahead(input, state.localSuggestionContext);
      return true;
    })();
    const ready = await state.placeSearchPromise;
    if (!ready) state.placeSearchPromise = null;
    return ready;
  }

  function searchLocalPlaces(query) {
    const normalized = normalizeSearchQuery(query);
    if (normalized.length < 2) return [];
    const words = searchWords(normalized);
    if (!words.length) return [];
    const requested = /^(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)\s+(.+)$/i.exec(normalized);
    const house = requested?.[1].replace(/\s+/g, '').toLowerCase();
    const rest = requested ? searchWords(requested[2]) : words;
    const ranked = [];
    for (const entry of state.placeSearchIndex || []) {
      let score = placeWordScore(words, entry._words);
      let buildingFallback = false;
      if (requested) {
        const exact = searchText(entry.house_number).replace(/\s+/g, '').toLowerCase() === house;
        if (!exact) {
          if (entry.kind !== 'building' || !entry.street) continue;
          score = placeWordScore(rest, searchWords([entry.street, entry.postcode, entry.locality].filter(Boolean).join(' ')));
          buildingFallback = score !== null;
          if (buildingFallback) {
            score += 30;
            // A numeric building name is only a ranking hint, never verification
            // of an individual house or flat coordinate.
            const range = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(entry.name || '');
            if (range && /^\d+$/.test(house) && Number(house) >= Number(range[1]) && Number(house) <= Number(range[2])) score -= 2;
          }
        } else if (score !== null) score -= 20;
      }
      if (score === null) continue;
      if (!requested) {
        const nameScore = entry._names.map(nameWords => placeWordScore(words, nameWords)).filter(value => value !== null);
        if (nameScore.length) score = Math.min(score, Math.min(...nameScore) - 10);
      }
      const name = entry.kind === 'building' && /^\s*\d+\s*[-–]\s*\d+\s*$/.test(entry.name || '') && entry.street
        ? entry.name + ' ' + entry.street : entry.name || '';
      const result = {
        lat: entry.lat, lon: entry.lon, name,
        address: {house_number: entry.house_number || '', road: entry.street || '', postcode: entry.postcode || '', suburb: entry.locality || ''},
        display_name: [entry.name, entry.house_number, entry.street, entry.locality, entry.postcode].filter(Boolean).join(', '),
        type: entry.kind === 'building' ? 'Building match' : entry.kind === 'address' ? 'Address' : entry.category || 'Place',
        osm_type: entry.id[0] === 'n' ? 'node' : 'way', osm_id: entry.id.slice(1), local: true,
        requestedHouseNumber: buildingFallback ? requested[1] : '',
        matchNote: buildingFallback
          ? 'Building match · Exact house number ' + requested[1] + ' not found in local data · check entrance on map'
          : entry.location.charAt(0).toUpperCase() + entry.location.slice(1) + ' · check entrance on map'
      };
      ranked.push({result, score, distance: resultDistance(result) ?? Infinity});
    }
    ranked.sort((a, b) => a.score - b.score || a.distance - b.distance);
    return dedupeSearchResults(ranked.map(item => item.result));
  }

  function makeSuggestionButton(result, context) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'typeahead-item';
    button.innerHTML = '<span class="result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span><span class="result-copy"><strong></strong><span class="result-address"></span><small></small></span>';
    const primary = conciseResultName(result);
    button.querySelector('strong').textContent = primary;
    button.querySelector('.result-address').textContent = resultAddress(result, primary);
    const bits = [resultTypeLabel(result) || result.type];
    const d = resultDistance(result);
    if (Number.isFinite(d)) bits.push(formatDistance(d));
    button.querySelector('small').textContent = bits.filter(Boolean).join(' · ');
    if (resultAccuracyNote(result)) {
      const accuracy = document.createElement('small');
      accuracy.className = 'result-accuracy';
      accuracy.textContent = resultAccuracyNote(result);
      button.querySelector('.result-copy').appendChild(accuracy);
    }
    button.addEventListener('click', () => {
      el('typeaheadSuggestions').hidden = true;
      selectSearchResult(result, context);
    });
    return button;
  }

  function renderTypeahead(input, context) {
    state.searchMapPickContext = null;
    state.localSuggestionInput = input;
    state.localSuggestionContext = context;
    state.searchSubmissionActive = false;
    const results = localSuggestions(input.value);
    if (input === el('homeSearch')) {
      const box = el('typeaheadSuggestions');
      box.replaceChildren();
      for (const result of results) box.appendChild(makeSuggestionButton(result, context));
      box.hidden = !results.length;
      return;
    }
    openPlannerSearch(context);
    if (input.value.trim().length < 2) return;
    const list = el('resultsList');
    list.replaceChildren();
    el('resultsTitle').textContent = results.length ? 'Suggestions' : 'Search when ready';
    if (results.length) {
      for (const result of results) list.appendChild(makeSuggestionButton(result, context));
    } else {
      list.innerHTML = '<div class="result-message">Press Search for addresses and places. Suggestions use local MK map data.</div>';
    }
  }

  function normalizeSearchQuery(query) {
    return String(query || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
      .replace(/\b(MK\d{1,2})\s*(\d[a-z]{2})\b/gi, (_, outward, inward) => outward.toUpperCase() + ' ' + inward.toUpperCase());
  }

  let geocodeGate = Promise.resolve();
  function waitForGeocoder(isCurrent = () => true) {
    const next = geocodeGate.then(async () => {
      if (!isCurrent()) return false;
      const elapsed = Date.now() - state.lastGeocodeAt;
      if (elapsed < 1050) await sleep(1050 - elapsed);
      if (!isCurrent()) return false;
      state.lastGeocodeAt = Date.now();
      return true;
    });
    geocodeGate = next.catch(() => {});
    return next;
  }

  async function geocode(query, isCurrent = () => true) {
    const trimmed = normalizeSearchQuery(query);
    if (!trimmed || !isCurrent()) return [];
    const coordinates = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
    if (coordinates) {
      const lat = Number(coordinates[1]), lon = Number(coordinates[2]);
      if (lat < MK.south || lat > MK.north || lon < MK.west || lon > MK.east) return [];
      return [{lat, lon, name:'Map coordinates', display_name:trimmed}];
    }
    if (!await waitForGeocoder(isCurrent)) return [];
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
      const results = await response.json();
      if (!Array.isArray(results)) throw new Error('Search returned invalid results');
      return results.filter(validateSearchResult);
    } finally { clearTimeout(timer); }
  }

  function showResults(results, context, query, message = '') {
    state.searchMapPickContext = null;
    state.searchContext = context;
    const list = el('resultsList');
    list.innerHTML = '';
    searchResultLayer.clearLayers();
    const displayResults = dedupeSearchResults(results);
    el('resultsTitle').textContent = displayResults.length
      ? `${displayResults.every(result => result.local) ? 'Local matches' : 'Results'} for “${query}”` : 'No matching places';

    if (message) {
      const status = document.createElement('div');
      status.id = 'resultsMessage';
      status.className = 'result-message';
      status.setAttribute('role', 'status');
      status.textContent = message;
      list.appendChild(status);
    }

    if (!displayResults.length) {
      const msg = document.createElement('div');
      msg.className = 'result-message';
      msg.textContent = 'We couldn’t find that in the MK map area. Try a postcode, street address or place name, or choose a point on the map.';
      if (!message) list.appendChild(msg);
      appendSearchRecovery(list, context);
    } else {
      displayResults.forEach((result, index) => {
        const primary = conciseResultName(result);
        const secondary = resultAddress(result, primary);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result-item';
        button.innerHTML = `<span class="result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span><span class="result-copy"><strong></strong><span class="result-address"></span><small></small></span>`;
        button.querySelector('strong').textContent = primary;
        button.querySelector('.result-copy span').textContent = secondary;
        const bits = [resultTypeLabel(result)];
        const distance = resultDistance(result);
        if (Number.isFinite(distance)) bits.push(formatDistance(distance));
        button.querySelector('small').textContent = bits.filter(Boolean).join(' · ');
        if (resultAccuracyNote(result)) {
          const accuracy = document.createElement('small');
          accuracy.className = 'result-accuracy';
          accuracy.textContent = resultAccuracyNote(result);
          button.querySelector('.result-copy').appendChild(accuracy);
        }
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
    const help = document.createElement('p');
    help.id = 'resultsPrecisionHelp';
    help.className = 'results-help';
    help.textContent = 'Search covers the MK map area, not every MK postcode. Not every house number is mapped; building and street matches are approximate locations, not verified front doors.';
    list.appendChild(help);
    el('resultsSheet').hidden = false;
  }

  function appendSearchRecovery(list, context) {
    const actions = document.createElement('div');
    actions.className = 'result-recovery-actions';
    const postcode = document.createElement('button');
    postcode.type = 'button';
    postcode.className = 'secondary-action';
    postcode.textContent = 'Try a postcode';
    postcode.addEventListener('click', () => {
      closeSearch();
      const input = el(context === 'start' ? 'startSearch' : context === 'end' ? 'endSearch' : 'homeSearch');
      input.focus();
      input.select?.();
    });
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'secondary-action';
    pin.textContent = 'Choose on map';
    pin.addEventListener('click', () => beginResultMapPick(context));
    actions.appendChild(postcode);
    actions.appendChild(pin);
    list.appendChild(actions);
  }

  function beginResultMapPick(context) {
    closeSearch();
    if (context === 'start') cancelStartLocation();
    state.searchMapPickContext = {context, stage: state.stage};
    el('resultsTitle').textContent = context === 'start' ? 'Choose a starting point' : 'Choose a point on the map';
    const hint = document.createElement('div');
    hint.className = 'result-message';
    hint.textContent = 'Tap the entrance or accessible point you want to use. Close this panel to cancel.';
    el('resultsList').replaceChildren(hint);
    el('resultsSheet').hidden = false;
    el('routeSheet').hidden = true;
    el('closeResults').focus();
  }

  function selectSearchMapPoint(latlng) {
    const picking = state.searchMapPickContext;
    if (!picking || picking.stage !== state.stage || el('resultsSheet').hidden) return false;
    if (!validateSearchResult({lat: latlng.lat, lon: latlng.lng})) {
      toast('Choose a point within the Milton Keynes map area.', 6000);
      return true;
    }
    if (picking.context.startsWith('save-') && savePendingMapPin(latlng)) return true;
    selectSearchResult({lat: latlng.lat, lon: latlng.lng, name: 'Dropped pin', display_name: fmtCoord(latlng)}, picking.context);
    return true;
  }

  function openPlannerSearch(context) {
    if (state.stage !== 'planner') return;
    state.searchMapPickContext = null;
    if (context === 'start') cancelStartLocation();
    searchRevision += 1;
    state.searchSubmissionActive = false;
    searchResultLayer.clearLayers();
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
    state.searchSubmissionActive = false;
    state.localSuggestionInput = null;
    state.localSuggestionContext = null;
    state.plannerSearchOpen = false;
    state.searchMapPickContext = null;
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
    closeSearch();
    const context = state.pendingSaveKind ? 'save-' + state.pendingSaveKind : 'destination';
    renderTypeahead(el('homeSearch'), context);
  });

  async function runSearch(context, input) {
    state.searchMapPickContext = null;
    const query = normalizeSearchQuery(input.value);
    if (!query) { input.focus(); return; }
    el('typeaheadSuggestions').hidden = true;
    if (context === 'start' || context === 'end') openPlannerSearch(context);
    const revision = ++searchRevision;
    state.searchSubmissionActive = true;
    searchResultLayer.clearLayers();
    input.blur();
    el('resultsSheet').hidden = false;
    el('resultsTitle').textContent = 'Searching…';
    el('resultsList').innerHTML = '<div class="result-message">Searching Milton Keynes…</div>';
    const localReady = loadPlaceIndex().catch(() => false);
    const offline = navigator.onLine === false;
    const coordinates = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.test(query);
    const onlineResult = offline && !coordinates ? Promise.resolve({results: []})
      : geocode(query, () => revision === searchRevision).then(results => ({results}), error => ({error}));
    const [, online] = await Promise.all([localReady, onlineResult]);
    if (revision !== searchRevision) return;
    const local = searchLocalPlaces(query);
    const localResults = local.length ? local : localSuggestions(query);
    let message = '';
    if (offline && !online.results?.length) message = localResults.length
      ? "You're offline. Showing mapped local matches."
      : "You're offline. We couldn’t find that in the local MK map data. Try a saved place or choose on the map.";
    else if (online.error) message = localResults.length
      ? 'Online search is unavailable. Showing mapped local matches; check the entrance on the map.'
      : 'Online search is unavailable. We couldn’t find that in the local MK map data. Try a saved place or choose on the map.';
    else if (!online.results.length && localResults.length) message = 'No online match was found. Showing mapped local matches.';
    showResults([...(online.results || []), ...localResults], context, query, message);
  }

  function selectSearchResult(result, context) {
    if (!validateSearchResult(result)) return;
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const primary = conciseResultName(result);
    const secondary = resultSecondary(result, primary);
    closeSearch();

    if (context === 'save-home' || context === 'save-work' || context === 'save-favourite') {
      const place = savedPlaceFromResult(result);
      const savedResult = savePlace(context.slice(5), place);
      if (!savedResult.ok) return;
      finishSavedSearch();
      el('savedSheet').hidden = false;
      toast(savedResult.duplicate ? 'Already saved' : context === 'save-home' ? 'Home saved' : context === 'save-work' ? 'Work saved' : 'Favourite saved');
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
    syncSaveFavouriteButton();
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
      header.querySelector('small').textContent = route.fullMiles + ' mi full · ' + route.shortMiles + ' mi shorter ride in guide';
      const highlights = document.createElement('p');
      highlights.textContent = route.highlights.join(' · ');
      card.append(header, highlights);
      if (Number.isFinite(route.joinDistance)) {
        const join = document.createElement('small');
        join.className = 'cultural-join';
        join.textContent = 'Nearest join ' + formatDistance(route.joinDistance) + ' away';
        card.appendChild(join);
      }
      const shortcutNote = document.createElement('small');
      shortcutNote.className = 'cultural-shortcut-note';
      shortcutNote.id = 'shortcut-note-' + route.id;
      shortcutNote.textContent = 'Shortcut GPX is a segment, not the complete shorter loop.';
      const actions = document.createElement('div');
      actions.className = 'cultural-route-actions';
      const full = document.createElement('button');
      full.type = 'button';
      full.className = 'primary-action cultural-full-action';
      full.textContent = 'Full route';
      full.addEventListener('click', () => loadOfficialGpx(route, 'full'));
      const short = document.createElement('button');
      short.type = 'button';
      short.className = 'secondary-action cultural-shortcut-action';
      short.textContent = 'Shortcut track';
      short.setAttribute('aria-describedby', shortcutNote.id);
      short.addEventListener('click', () => loadOfficialGpx(route, 'short'));
      const source = document.createElement('a');
      source.className = 'secondary-action cultural-guide-action';
      source.href = CULTURAL_ROUTES_URL;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Route guide';
      const shortcut = document.createElement('div');
      shortcut.className = 'cultural-shortcut-choice';
      shortcut.append(short, shortcutNote);
      actions.append(full, source, shortcut);
      card.appendChild(actions);
      if (route.loadErrorVariant) {
        const error = document.createElement('small');
        error.className = 'cultural-load-error';
        error.setAttribute('role', 'status');
        error.textContent = (route.loadErrorVariant === 'short' ? 'Shortcut track' : 'Full route') + ' could not be loaded. Retry or import a GPX file.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.dataset.gpxRetry = route.loadErrorVariant;
        retry.textContent = route.loadErrorVariant === 'short' ? 'Retry shortcut track' : 'Retry full route';
        retry.addEventListener('click', () => loadOfficialGpx(route, route.loadErrorVariant));
        actions.appendChild(retry);
        card.appendChild(error);
      }
      list.appendChild(card);
    }
  }

  function openExploreRoutes() {
    closeSearch();
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

  function routeFromNearestPoint(coords, origin = state.userLatLng) {
    if (!origin || coords.length < 3) return coords;
    const first = coords[0], last = coords.at(-1);
    const closes = first[0] === last[0] && first[1] === last[1];
    if (!closes) return coords;
    let bestIndex = 0, best = Infinity;
    coords.forEach((pair,index) => {
      const d = hav({lat:origin.lat,lon:origin.lng},{lat:pair[0],lon:pair[1]});
      if (d < best) { best = d; bestIndex = index; }
    });
    const loop = coords.slice(0, -1);
    bestIndex %= loop.length;
    const rotated = [...loop.slice(bestIndex), ...loop.slice(0,bestIndex)];
    if (rotated.length) rotated.push(rotated[0]);
    return rotated;
  }

  function closeExploreRoutes() {
    gpxLoadRevision += 1;
    el('exploreSheet').hidden = true;
    el('app').dataset.exploreOpen = 'false';
    el('exploreRoutesBtn').classList.remove('active');
    el('exploreRoutesBtn').removeAttribute('aria-current');
    el('goTabBtn').classList.add('active');
    el('goTabBtn').setAttribute('aria-current', 'page');
  }

  // All visible sheet handles share touch, mouse and keyboard behaviour.
  function setSheetCollapsed(sheet, collapsed) {
    if (sheet.id === 'routeSheet') el('routeDetails').scrollTop = 0;
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
    closeSearch();
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
    closeSearch();
    if (state.pendingSaveKind) finishSavedSearch();
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
    closeSearch();
    if (state.pendingSaveKind) finishSavedSearch();
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
  el('setHomeBtn').addEventListener('click', () => beginSavedSearch('home'));
  el('setWorkBtn').addEventListener('click', () => beginSavedSearch('work'));
  el('pickSavedOnMapBtn').addEventListener('click', () => {
    if (!state.pendingSaveKind) return;
    closeSearch();
    el('homeSearch').blur();
    state.savedPickOnMap = true;
    renderSavedPicker();
  });
  el('cancelSavedPickBtn').addEventListener('click', () => {
    closeSearch();
    finishSavedSearch();
    renderSavedPlaces();
    el('savedSheet').hidden = false;
  });
  el('quickHomeBtn').addEventListener('click', () => openSavedPlace(state.saved.home));
  el('quickWorkBtn').addEventListener('click', () => openSavedPlace(state.saved.work));
  el('homeSavedRow').addEventListener('click', () => state.saved.home ? openSavedPlace(state.saved.home) : beginSavedSearch('home'));
  el('workSavedRow').addEventListener('click', () => state.saved.work ? openSavedPlace(state.saved.work) : beginSavedSearch('work'));
  el('saveFavouriteBtn').addEventListener('click', () => {
    const place = savedPlaceFromCurrentEnd();
    if (!place) return;
    const result = savePlace('favourite', place);
    if (result.ok) toast(result.duplicate ? 'Already saved' : 'Favourite saved');
  });

  map.on('click', e => {
    // Mobile map libraries may synthesise a delayed click after sheet resizing.
    if (performance.now() < sheetGestureUntil || e.originalEvent?.target?.closest?.('.bottom-sheet')) return;
    if (state.navigating) return;
    if (state.searchMapPickContext && selectSearchMapPoint(e.latlng)) return;
    if (state.editEndpoint) {
      const which = state.editEndpoint; state.editEndpoint = null;
      setPoint(which, e.latlng, 'Chosen entrance', fmtCoord(e.latlng));
      setStage('planner'); maybeCalculateRoute(); return;
    }
    if (savePendingMapPin(e.latlng)) return;
  });

  async function reverseGeocode(latlng) {
    await waitForGeocoder();
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
    if (state.searchMapPickContext && selectSearchMapPoint(latlng)) return;
    if (state.pendingSaveKind && savePendingMapPin(latlng)) return;
    setPoint('end', latlng, 'Dropped pin', fmtCoord(latlng));
    showPlaceSheet();
    showDestinationInContext(latlng);
    const original = state.end;
    const result = await reverseGeocode(latlng);
    if (!result || state.navigating || state.stage !== 'place' || state.end !== original) return;
    const primary = conciseResultName(result);
    state.endLabel = primary || 'Dropped pin';
    state.endAddress = resultSecondary(result, state.endLabel) || fmtCoord(latlng);
    el('homeSearch').value = state.endLabel;
    showPlaceSheet();
  }

  let longPressTimer = null;
  let longPressStart = null;
  let lastLongPressAt = 0;
  let longPressClickGuard = null;
  const mapContainer = map.getContainer();
  // Touch release can target a sheet that appeared beneath the original finger.
  // Consume only that compatibility click; a new gesture or keyboard action wins.
  document.addEventListener('pointerdown', () => { longPressClickGuard = null; }, {capture: true, passive: true});
  document.addEventListener('pointerup', () => {
    if (longPressClickGuard) longPressClickGuard.until = performance.now() + 1000;
  }, {capture: true, passive: true});
  document.addEventListener('pointercancel', () => { longPressClickGuard = null; }, {capture: true, passive: true});
  document.addEventListener('click', event => {
    const guard = longPressClickGuard;
    if (!guard || event.detail === 0 || performance.now() > guard.until ||
        Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 12) return;
    longPressClickGuard = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const cancelLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  };
  mapContainer.addEventListener('pointerdown', event => {
    if (!event.isPrimary || !['touch', 'pen'].includes(event.pointerType) || !['explore', 'place'].includes(state.stage)) return;
    if (event.target?.closest?.('.leaflet-control, button, a, input, select, textarea, [role="button"]')) return;
    const savedRevision = state.savedPickRevision;
    const rect = mapContainer.getBoundingClientRect();
    longPressStart = { x: event.clientX, y: event.clientY, rect };
    longPressTimer = setTimeout(() => {
      if (!longPressStart) return;
      if (state.savedPickRevision !== savedRevision) { cancelLongPress(); return; }
      lastLongPressAt = performance.now();
      longPressClickGuard = {x: longPressStart.x, y: longPressStart.y, until: Infinity};
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

  function locationFailureMessage(error, planner = false) {
    const reason = error?.code === 1 ? 'Location access is off.'
      : error?.code === 3 ? 'Your location is taking a while.'
      : 'We couldn’t get your location.';
    return reason + (planner
      ? ' Search for a starting address or postcode instead.'
      : ' You can still search or choose a point on the map.');
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
      setRouteStatus(locationFailureMessage(err, true), 'warn');
      toast(locationFailureMessage(err, true), 6000);
      return true;
    } finally {
      if (revision === startLocationRevision) el('useLocationBtn').disabled = false;
    }
  }

  async function refreshBrowseLocation({ center = true, quiet = false } = {}) {
    if (state.navigating || state.stage === 'navigation') return false;
    const request = state.browseLocationRevision = (state.browseLocationRevision || 0) + 1;
    const screen = searchRevision, stage = state.stage;
    // A newer lookup, manual search or screen transition owns the map.
    const isCurrent = () => state.browseLocationRevision === request && searchRevision === screen &&
      state.stage === stage && !state.navigating && state.stage !== 'navigation';
    const button = el('browseLocateBtn');
    if (button) button.disabled = true;
    el('browseLocationRecovery').hidden = true;
    try {
      const pos = await acquireCurrentLocation();
      if (!isCurrent()) return false;
      state.userLatLng = pos.latlng;
      setUserMarker(pos.latlng);
      if (center) map.setView(pos.latlng, Math.max(map.getZoom(), 15));
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (!quiet && ['explore', 'place'].includes(state.stage)) {
        el('browseLocationMessage').textContent = locationFailureMessage(error);
        el('browseLocationRecovery').hidden = false;
      }
      return false;
    } finally {
      if (button && state.browseLocationRevision === request) button.disabled = false;
    }
  }

  el('useLocationBtn').addEventListener('click', () => useCurrentLocation());
  el('browseLocateBtn').addEventListener('click', () => refreshBrowseLocation({ center: true }));
  el('searchWithoutLocationBtn').addEventListener('click', () => {
    el('browseLocationRecovery').hidden = true;
    el('homeSearch').focus();
  });
  el('dismissLocationRecoveryBtn').addEventListener('click', () => { el('browseLocationRecovery').hidden = true; });

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
    el('routePreferences').hidden = mode !== 'cycle' || Boolean(state.importedRouteName);
    if (state.culturalRoute) {
      cancelNavigationStart();
      const cultural = state.culturalRoute;
      cultural.joinRevision++;
      cultural.trackPlan = importedPlan(cultural.trackPlan.coords, cultural.title);
      if (cultural.phase === 'track') installRoute(cultural.trackPlan);
      else if (state.start) prepareCulturalJoin(state.start, {chooseJoin: false});
      else installRoute(cultural.trackPlan);
      return;
    }
    if (state.route?.imported) {
      installRoute(importedPlan(state.route.coords, state.importedRouteName));
      return;
    }
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
    const track = state.culturalRoute?.phase === 'joining' ? state.culturalRoute.trackPlan : null;
    el('distanceStat').textContent = formatDistance(state.route.dist + (track?.dist || 0));
    if (!state.navigating) {
      if (!state.culturalRoute) setRouteStatus(routeReadyStatus(), 'good');
      renderApproachNote(); renderAlternatives();
    } else {
      const current = state.userLatLng || state.start;
      const journey = remainingJourney(state.route, state.navProgressMeters, current, state.start, state.end, state.mode);
      if (track) { journey.distance += track.dist; journey.mins += track.mins; }
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
    const cultural = state.culturalRoute;
    if (cultural) {
      L.polyline(cultural.trackPlan.coords, {className: 'route-casing', interactive: false}).addTo(routeLayer);
      L.polyline(cultural.trackPlan.coords, {className: 'cultural-route-line', color: CULTURAL_ROUTE_COLOURS[cultural.id], weight: 7, opacity: .98, interactive: false}).addTo(routeLayer);
    }
    if (!cultural || cultural.phase === 'joining') {
      L.polyline(coords, { className: 'route-casing', interactive: false }).addTo(routeLayer);
      L.polyline(coords, { className: 'route-line', interactive: false }).addTo(routeLayer);
    }
    if (state.route && coords.length && (!cultural || cultural.phase === 'joining')) {
      for (const pair of [[state.start, coords[0]], [state.end, coords.at(-1)]]) {
        if (pair[0]) L.polyline([pair[0], pair[1]], {color:'#a05b00',weight:3,dashArray:'5 7',interactive:false}).addTo(routeLayer);
      }
    }
    if (fit) setTimeout(() => fitRouteBounds([...coords, ...(cultural?.trackPlan.coords || []), state.start, state.end].filter(Boolean)), 30);
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
      const className = layer.options?.className || layer.options?.icon?.options?.className || '';
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
      const usefulName = route.name && route.name !== route.ref && !route.name.includes('MK Redway Super Route');
      badge.textContent = usefulName ? route.name : route.ref + ' Super Route';
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
    const route = state.route, note = el('approachNote'), summary = el('routeApproachSummary');
    const startGap = route?.snaps?.start || 0;
    const endGap = route?.snaps?.end || 0;
    const significant = Math.max(startGap, endGap) > 50;
    note.hidden = !route || !significant;
    summary.hidden = note.hidden;
    summary.textContent = '';
    if (!route || !significant) return;
    const messages = [];
    if (startGap > 50) messages.push(`The first ${formatDistance(startGap)} isn't a mapped path`);
    if (endGap > 50) messages.push(`The last ${formatDistance(endGap)} isn't a mapped path`);
    note.textContent = `${messages.join('. ')}. Check that you can get through.`;
    const checks = [];
    if (startGap > 50) checks.push(`first ${formatDistance(startGap)}`);
    if (endGap > 50) checks.push(`final ${formatDistance(endGap)}`);
    summary.textContent = `Check ${checks.join(' and ')} · unmapped approach`;
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
    clearArrivalSummary();
    state.route = plan;
    const cultural = state.culturalRoute;
    const followingTrack = cultural?.phase === 'track';
    const total = cultural?.phase === 'joining' ? {dist: plan.dist + cultural.trackPlan.dist, mins: plan.mins + cultural.trackPlan.mins} : plan;
    const unverified = plan.imported || Boolean(cultural);
    drawRoute(plan.coords, fit);
    renderUnlitSegments(plan);
    el('timeStat').textContent = formatDuration(total.mins);
    el('arrivalStat').textContent = `Arrive about ${arrivalTime(total.mins)}`;
    el('distanceStat').textContent = formatDistance(total.dist);
    el('routeModeLabel').textContent = state.mode === 'walk' ? 'Walking' : 'Cycling';
    el('routeClassification').hidden = unverified;
    el('routeTrackStatus').hidden = !unverified;
    el('redwayStat').textContent = unverified ? 'Unknown' : `${plan.redwayPercent}%`;
    el('roadStat').textContent = unverified ? 'Unknown' : `${plan.roadPercent}%`;
    el('routePreferences').hidden = unverified || state.mode !== 'cycle';
    document.querySelector('.road-share-note').textContent = cultural
      ? (cultural.phase === 'joining' ? 'The red joining leg uses mapped paths. ' : '') + 'The official GPX track has unverified access, path types and conditions; combined percentages are unknown.'
      : plan.imported ? 'Imported track: path types, access and conditions are unverified. Follows file geometry, not a calculated Redway route.'
      : 'Mapped conditions may be incomplete. Crossing estimates include short road links; unknown lighting is not counted as unlit.';
    renderCulturalLegend(cultural);
    el('startNavBtn').disabled = false;
    el('sendToPhoneBtn').disabled = false;
    renderRouteMix(cultural ? null : plan);
    renderRouteInsights(cultural ? null : plan);
    renderApproachNote();
    setRouteStatus(cultural ? (followingTrack ? cultural.color + ' Cultural Route · unverified track' : 'Route to Cultural Route start / join · then ' + cultural.color + ' track')
      : plan.imported ? 'Imported GPX · unverified track' : routeReadyStatus(), unverified ? 'warn' : state.networkSource === 'bundled' ? 'good' : 'warn');
    el('routeStatus').classList.toggle('is-ready-preview', true);
    setRouteSheetCollapsed(collapse);
    offerInstallOnce();
  }

  function renderCulturalLegend(cultural) {
    el('culturalRouteLegend').hidden = !cultural;
    if (!cultural) return;
    el('culturalJoinLegend').hidden = cultural.phase === 'track';
    el('culturalJoinLabel').textContent = cultural.phase === 'joining'
      ? 'Red: start / join' : 'Joining leg not calculated';
    el('culturalTrackLabel').textContent = cultural.color + ': official GPX track';
    el('culturalTrackSwatch').style.backgroundColor = CULTURAL_ROUTE_COLOURS[cultural.id];
  }

  function clearArrivalSummary() {
    state.arrivalSummary = null;
    el('arrivalSummary').hidden = true;
  }

  function showArrivalSummary(completed) {
    if (!completed || completed.route !== state.route || completed.routeRevision !== state.routeRevision ||
        completed.navigationRevision + 1 !== navigationStartRevision || state.stage !== 'planner' || state.navigating) return;
    state.arrivalSummary = completed;
    el('arrivalDestination').textContent = completed.name || 'Your destination';
    el('arrivalDetail').textContent = completed.address && completed.address !== completed.name
      ? completed.address : 'Navigation has finished.';
    el('arrivalSummary').hidden = false;
    el('arrivalDoneBtn').focus({preventScroll: true});
  }

  function finishArrivalSummary() {
    if (!state.arrivalSummary) return;
    clearArrivalSummary();
    setStage('explore');
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
        if (choice === pref) selected = duplicate ? duplicate.plan : plan;
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
    if (state.culturalRoute) return prepareCulturalJoin(state.start || state.userLatLng, {fit});
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
      if (revision !== state.routeRevision) return;
      try {
        await solveRouteOnNetwork(parsed, { fit });
      } catch (firstErr) {
        console.warn('First live corridor could not connect route; widening it', firstErr);
        if (!quiet) setRouteStatus('Checking a wider Redway area…');
        parsed = await fetchLiveRoutingNetwork(expandedBox(firstBox, 2.0));
        if (revision !== state.routeRevision) return;
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
    if (state.culturalRoute) {
      if (state.start) calculateRoute();
      else setRouteStatus('Choose a starting point, or Start to use your location for the Cultural Route join.', 'warn');
      return;
    }
    if (state.importedRouteName) return;
    if (state.start && state.end) calculateRoute();
    else if (!state.start) setRouteStatus('Use your location or search for a starting point.');
    else setRouteStatus('Search for a destination.');
  }

  function xmlEscape(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
  }

  function routeToGpx(plan, name = 'MK Redway route') {
    const coords = state.culturalRoute && plan === state.route ? state.culturalRoute.sourceCoords : plan?.coords || [];
    if (state.culturalRoute && plan === state.route) name = state.culturalRoute.title;
    const points = coords.map(pair =>
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
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function parseGpx(textValue) {
    if (textValue.length > 10 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(textValue)) throw new Error('Unsupported GPX file');
    const doc = new DOMParser().parseFromString(textValue, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'gpx') throw new Error('Invalid GPX file');
    // Never draw invented links across separate tracks or recording gaps. Use the
    // longest continuous segment and tell the user when the file contains more.
    let groups = [...doc.getElementsByTagNameNS('*', 'trkseg')].map(segment => [...segment.children].filter(n => n.localName === 'trkpt'));
    if (!groups.length) groups = [...doc.getElementsByTagNameNS('*', 'rte')].map(route => [...route.children].filter(n => n.localName === 'rtept'));
    let count = 0;
    const segments = groups.map(points => {
      count += points.length;
      if (count > 100000) throw new Error('GPX has too many points');
      return points.map(node => {
        const lat = node.getAttribute('lat'), lon = node.getAttribute('lon');
        if (!lat?.trim() || !lon?.trim()) throw new Error('Missing GPX coordinate');
        const pair = [Number(lat), Number(lon)];
        if (!pair.every(Number.isFinite) || Math.abs(pair[0]) > 90 || Math.abs(pair[1]) > 180) throw new Error('Invalid GPX coordinate');
        return pair;
      }).filter((point, i, all) => !i || point.some((v, j) => v !== all[i - 1][j]));
    }).filter(coords => coords.length >= 2);
    if (!segments.length) throw new Error('GPX file does not contain a usable track');
    segments.sort((a, b) => buildCumulative(b).at(-1) - buildCumulative(a).at(-1));
    const title = (doc.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || 'Imported GPX route').slice(0, 160);
    return {coords: segments[0], title, multipleSegments: segments.length > 1};
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
      imported: true,
      mixPercent: null,
      redwayPercent: 0,
      roadPercent: 0,
      insights: null,
      maneuvers: buildManeuvers(coords, edges, cumulative, {
        ids: coords.map((_, i) => 'gpx-' + i),
        endLabel: title,
        endGap: 0
      }),
      initialInstruction: initialInstruction(coords, edges)
    };
  }

  async function prepareCulturalJoin(origin, {fit = true, chooseJoin = true, accuracy, isCurrent = () => true} = {}) {
    const cultural = state.culturalRoute;
    if (!cultural || !origin) return false;
    const request = ++cultural.joinRevision;
    const revision = state.routeRevision, screen = gpxLoadRevision, mode = state.mode;
    const current = () => state.culturalRoute === cultural && request === cultural.joinRevision &&
      revision === state.routeRevision && screen === gpxLoadRevision && mode === state.mode && isCurrent();
    try {
      if (chooseJoin) cultural.trackPlan = importedPlan(routeFromNearestPoint(cultural.sourceCoords, origin), cultural.title);
      const first = cultural.trackPlan.coords[0];
      const target = L.latLng(first[0], first[1]);
      const gap = hav({lat: origin.lat, lon: origin.lng}, {lat: target.lat, lon: target.lng});
      cultural.origin = origin;
      state.start = origin;
      state.startLabel = cultural.originLabel || 'Your location';
      state.end = target;
      state.endLabel = cultural.title + ' start / join';
      state.endAddress = 'Cultural Route start / join · then follow the official GPX track';
      if (gap <= 30 && (accuracy === undefined || accuracy <= 35)) {
        if (!current()) return false;
        cultural.origin = origin;
        beginCulturalTrack({fit});
        return true;
      }
      if (gap <= 30 && accuracy > 35) {
        setRouteStatus('Waiting for an accurate location to join the Cultural Route. Try Start again.', 'warn');
        toast('Waiting for an accurate location to join the Cultural Route', 5000);
        return false;
      }
      setRouteStatus('Finding a route to Cultural Route start / join…');
      el('startNavBtn').disabled = true;
      const parsed = await ensureRoutingNetwork();
      if (!current()) return false;
      if (!parsed) throw new Error('The local routing graph is unavailable');
      const plan = planRoute(parsed, getGraph(parsed, mode, state.pref), origin, target, mode, cultural.color + ' Cultural Route start / join');
      // Reaching this leg is a handoff to the source track, not the end of the ride.
      for (const maneuver of plan.maneuvers) {
        if (maneuver.arrive) maneuver.instruction = plan.snaps.end > 20
          ? 'Mapped route ends near the ' + cultural.color + ' Cultural Route start / join; check the remaining approach'
          : 'Join the ' + cultural.color + ' Cultural Route';
      }
      if (!current()) return false;
      cultural.phase = 'joining'; cultural.origin = origin;
      state.start = origin;
      state.startLabel = cultural.originLabel || 'Your location';
      state.end = target;
      state.endLabel = cultural.title + ' start / join';
      state.endAddress = 'Cultural Route start / join · then follow the official GPX track';
      state.alternatives = [];
      installRoute(plan, {fit});
      updatePlannerFields(); redrawMarkers(); renderAlternatives();
      el('retryRouteBtn').hidden = true;
      return true;
    } catch (error) {
      if (!current()) return false;
      cultural.phase = 'awaiting';
      installRoute(cultural.trackPlan, {fit: false, collapse: false});
      setRouteStatus('Could not calculate route to Cultural Route start / join. ' + routeErrorMessage(error), 'warn');
      el('retryRouteBtn').hidden = false;
      return false;
    } finally {
      if (state.culturalRoute === cultural && request === cultural.joinRevision) el('startNavBtn').disabled = !state.route;
    }
  }

  function beginCulturalTrack({fit = false} = {}) {
    const cultural = state.culturalRoute;
    if (!cultural) return;
    cultural.phase = 'track';
    cultural.startingTrack = true;
    const coords = cultural.trackPlan.coords;
    state.start = L.latLng(coords[0][0], coords[0][1]);
    state.end = L.latLng(coords.at(-1)[0], coords.at(-1)[1]);
    state.startLabel = cultural.title + ' start / join';
    state.endLabel = cultural.title + ' finish';
    state.endAddress = 'Official Cultural Route GPX · track conditions unverified';
    resetNavigationProgress();
    installRoute(cultural.trackPlan, {fit});
    updatePlannerFields(); redrawMarkers();
  }

  function installImportedGpx(coords, title, {culturalRoute = null, origin = null, originLabel = ''} = {}) {
    cancelStartLocation();
    closeSearch();
    invalidateRoute();
    state.pendingRoute = false;
    state.culturalRoute = null;
    stopNavigation({keepRoute:false});
    state.importedRouteName = title;
    state.start = L.latLng(coords[0][0], coords[0][1]);
    state.end = L.latLng(coords.at(-1)[0], coords.at(-1)[1]);
    state.startLabel = title + ' start';
    state.endLabel = title + ' finish';
    state.endAddress = 'Imported GPX';
    state.alternatives = [];
    if (culturalRoute) {
      state.culturalRoute = {id: culturalRoute.id, color: culturalRoute.color, title, sourceCoords: coords,
        trackPlan: importedPlan(routeFromNearestPoint(coords, origin), title), phase: 'awaiting',
        origin, originLabel, joinRevision: 0};
      state.start = origin;
      const first = state.culturalRoute.trackPlan.coords[0];
      state.end = L.latLng(first[0], first[1]);
      state.startLabel = originLabel || (origin ? 'Your location' : '');
      state.endLabel = title + ' start / join';
      state.endAddress = 'Cultural Route start / join · then follow the official GPX track';
    }
    setStage('planner');
    updatePlannerFields();
    redrawMarkers();
    installRoute(state.culturalRoute?.trackPlan || importedPlan(coords, title), {fit:true, collapse: window.innerWidth < 900});
    renderAlternatives();
    if (state.culturalRoute) {
      if (origin) prepareCulturalJoin(origin);
      else setRouteStatus('Choose a starting point, or Start to use your location for the Cultural Route join.', 'warn');
    } else toast('GPX route ready');
  }

  async function loadOfficialGpx(route, variant) {
    const revision = ++gpxLoadRevision;
    const routeRevision = state.routeRevision;
    const plannedRoute = state.route;
    const isCurrent = () => revision === gpxLoadRevision && routeRevision === state.routeRevision && plannedRoute === state.route;
    const url = variant === 'short' ? route.shortGpx : route.fullGpx;
    const title = route.color + ' · ' + route.title + (variant === 'short' ? ' shortcut track' : '');
    let applying = false;
    try {
      const response = await fetch(url, {headers:{Accept:'application/gpx+xml, application/xml, text/xml'}});
      if (!isCurrent()) return;
      if (!response.ok) throw new Error('GPX download returned ' + response.status);
      const textValue = await response.text();
      if (!isCurrent()) return;
      const parsed = parseGpx(textValue);
      route[variant + 'Coords'] = parsed.coords;
      delete route.loadErrorVariant;
      applying = true;
      closeExploreRoutes();
      const origin = state.culturalRoute?.origin || (!state.importedRouteName ? state.start : null) || state.userLatLng;
      const originLabel = state.culturalRoute?.originLabel || (!state.importedRouteName && state.start ? state.startLabel : 'Your location');
      installImportedGpx(parsed.coords, title, {culturalRoute: route, origin, originLabel});
    } catch (err) {
      if (!applying && !isCurrent()) return;
      console.warn('Cultural route GPX could not be loaded', err);
      route.loadErrorVariant = variant;
      renderCulturalRoutes();
      toast('Could not load this route. Retry, or import a GPX file in Explore.', 6000);
    }
  }

  async function importGpxFile(file) {
    if (!file) return;
    const revision = ++gpxLoadRevision;
    const routeRevision = state.routeRevision;
    const plannedRoute = state.route;
    const isCurrent = () => revision === gpxLoadRevision && routeRevision === state.routeRevision && plannedRoute === state.route;
    let applying = false;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('GPX file is too large');
      const textValue = await file.text();
      if (!isCurrent()) return;
      const parsed = parseGpx(textValue);
      applying = true;
      closeExploreRoutes();
      installImportedGpx(parsed.coords, parsed.title || file.name.replace(/\.gpx$/i, ''));
      if (parsed.multipleSegments) toast('Multiple GPX sections: showing the longest continuous section.', 6000);
    } catch (err) {
      if (!applying && !isCurrent()) return;
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
    if (state.route.imported || state.culturalRoute) {
      const file = new File([routeToGpx(state.route, state.importedRouteName)], 'mk-redway-route.gpx', {type:'application/gpx+xml'});
      if (navigator.canShare?.({files:[file]})) {
        try { await navigator.share({files:[file], title:'Imported route'}); } catch (err) { if (err.name !== 'AbortError') toast('Could not share the GPX file'); }
      } else {
        downloadText(file.name, routeToGpx(state.route, state.importedRouteName), file.type);
        toast('GPX exported — transfer this file to your phone and import it in Explore.', 6000);
      }
      return;
    }
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
    const opening = menu.hidden || el('routeSheet').classList.contains('is-collapsed');
    menu.hidden = !opening;
    el('routeMoreBtn').setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) {
      setRouteSheetCollapsed(false);
      requestAnimationFrame(() => {
        if (!menu.hidden) menu.scrollTop = 0;
      });
    }
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
    const startingTrack = state.culturalRoute?.phase === 'track' && state.culturalRoute.startingTrack;
    if (startingTrack) {
      // A closed track's closing segment may be closest just beside its start.
      // Until forward progress is established, match only the beginning so a
      // fresh ride cannot acquire almost-complete progress from closing geometry.
      start = 0; end = 0;
      while (end < route.coords.length - 2 && route.cumulative[end + 1] < 80) end++;
    }

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
    if ((!best || best.distance > 120) && !startingTrack) best = scan(0, route.coords.length - 2);
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
    if (state.themeChoice === 'system' && Date.now() - state.lastThemeCheckAt > 30000) {
      state.lastThemeCheckAt = Date.now();
      const before = document.documentElement.dataset.theme;
      applyTheme();
      if (before !== document.documentElement.dataset.theme && offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
        map.removeLayer(offlineVectorLayer);
        offlineVectorLayer = null;
        if (!map.hasLayer(onlineBaseLayer)) onlineBaseLayer.addTo(map);
        baseLayer = onlineBaseLayer;
        activatePackagedBasemap().catch(console.warn);
      }
    }

    if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy > 100 || position.coords.accuracy < 0) {
      state.offRouteCount = 0;
      el('turnText').textContent = 'Waiting for an accurate location';
      el('nextTurnText').textContent = 'Guidance will resume when the GPS signal improves.';
      return;
    }
    if (state.culturalRoute?.phase === 'track' && state.culturalRoute.startingTrack && position.coords.accuracy <= 35 &&
        hav({lat: latlng.lat, lon: latlng.lng}, {lat: state.start.lat, lon: state.start.lng}) >= Math.min(50, state.route.networkDist / 4)) {
      // Backgrounded apps may miss the first few fixes. Once an accurate fix is
      // away from the start, allow normal matching and recovery along the track.
      state.culturalRoute.startingTrack = false;
    }
    const snap = nearestOnRoute(latlng);
    if (!snap) return;
    const heading = resolveTravelHeading(position, snap, latlng);
    const progressThreshold = state.mode === 'cycle' ? 80 : 60;
    const closeEnoughForProgress = snap.distance <= progressThreshold && Number.isFinite(position.coords.accuracy) && position.coords.accuracy <= 100;
    if (closeEnoughForProgress) {
      state.lastSegment = snap.segment;
      state.navProgressMeters = Math.max(state.navProgressMeters - 15, snap.progress);
      if (state.culturalRoute?.phase === 'track' && state.culturalRoute.startingTrack &&
          position.coords.accuracy <= 35 && snap.progress >= Math.min(50, state.route.networkDist / 4)) {
        state.culturalRoute.startingTrack = false;
      }
    }
    const progress = closeEnoughForProgress ? Math.max(state.navProgressMeters, snap.progress) : state.navProgressMeters;
    state.navProgressMeters = progress;

    if (state.route.imported && !closeEnoughForProgress) {
      el('navEta').textContent = 'Join route';
      el('navRemain').textContent = `${formatDistance(snap.distance)} to nearest point`;
      setTurnIcon('straight');
      el('turnDistance').textContent = formatDistance(snap.distance);
      el('turnText').textContent = position.coords.accuracy > 100 ? 'Waiting for an accurate location' : 'Join the imported route';
      el('nextTurnText').textContent = 'Guidance will continue from the nearest point once you reach the track.';
      state.offRouteCount += 1;
      if (state.offRouteCount >= 2 && Date.now() - state.lastRerouteAt > 25000) rerouteFromPosition(latlng);
      if (state.followUser) followNavigationView(latlng, heading, true);
      return;
    }

    const total = state.route.networkDist;
    const remaining = Math.max(0, total - progress);
    const journey = remainingJourney(state.route, progress, latlng, state.start, state.end, state.mode);
    if (state.culturalRoute?.phase === 'joining') {
      journey.distance += state.culturalRoute.trackPlan.dist;
      journey.mins += state.culturalRoute.trackPlan.mins;
    }
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

    if (state.culturalRoute?.phase === 'joining' && hasArrived(position, state.end, remaining)) {
      const color = state.culturalRoute.color;
      beginCulturalTrack();
      speak('Joined the ' + color + ' Cultural Route. Follow the official track.', {priority: 3});
      updateNavigation(position);
      return;
    }
    if (hasArrived(position, state.end, remaining)) {
      speak(`You have arrived at ${state.endLabel || 'your destination'}.`, { priority: 4, dedupeMs: 10000 });
      toast('You have arrived', 4000);
      const completed = {route: state.route, routeRevision: state.routeRevision, navigationRevision: navigationStartRevision, name: state.endLabel, address: state.endAddress};
      stopNavigation({ keepRoute: true, arrived: true });
      showArrivalSummary(completed);
      return;
    }

    if (remaining < 22) {
      const joining = state.culturalRoute?.phase === 'joining';
      const approach = joining ? hav({lat: latlng.lat, lon: latlng.lng}, {lat: state.end.lat, lon: state.end.lng}) : journey.distance;
      el('turnDistance').textContent = formatDistance(approach);
      el('turnText').textContent = joining ? 'Mapped joining leg ends here. Check the approach to Cultural Route start / join.'
        : 'Mapped route ends here. Check the approach to your destination.';
      el('nextTurnText').textContent = joining ? 'Track guidance will begin near the start / join with an accurate GPS fix.'
        : 'Arrival is confirmed near your destination with an accurate GPS fix.';
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
    if (state.route.imported) {
      const snap = nearestOnRoute(latlng);
      const gap = snap?.distance;
      const message = Number.isFinite(gap)
        ? `Return to the imported route — nearest point is ${formatDistance(gap)} away.`
        : 'Return to the imported route.';
      toast(message, 4200);
      speak(message, { priority: 3, dedupeMs: 12000 });
      return;
    }
    if (state.culturalRoute?.phase === 'joining') {
      const cultural = state.culturalRoute, session = navigationStartRevision;
      const current = () => state.navigating && session === navigationStartRevision && state.culturalRoute === cultural;
      toast('Rerouting to Cultural Route start / join…');
      cultural.originLabel = 'Your location';
      const ready = await prepareCulturalJoin(latlng, {fit: false, chooseJoin: false, isCurrent: current});
      if (!current()) return;
      if (ready) {
        resetNavigationProgress();
        speak(state.route.initialInstruction, {priority: 3});
      } else stopNavigation({keepRoute: true});
      return;
    }
    toast('Rerouting…'); speak('Rerouting.', { priority: 4, dedupeMs: 5000 });
    state.start = latlng; state.startLabel = 'Your location';
    invalidateRoute();
    const session = navigationStartRevision;
    await calculateRoute({fit:false,quiet:true});
    if (!state.navigating || session !== navigationStartRevision) return;
    resetNavigationProgress();
    if (state.route) speak(state.route.initialInstruction, { priority:3 });
    else { stopNavigation({keepRoute:false}); setStage('planner'); }
  }

  function resetNavigationProgress() {
    state.lastSegment = 0; state.navProgressMeters = 0;
    state.announcedFar.clear(); state.announcedNear.clear();
  }

  async function startNavigation() {
    if (!state.route || state.navigating || navigationStartPending) return;
    if (!navigator.geolocation) { toast('Live navigation needs location access'); return; }

    // This must happen synchronously inside the Start-button tap. On iOS,
    // waiting for GPS first loses the transient user activation and speech can
    // then be silently blocked for the whole navigation session.
    unlockSpeechFromGesture('Voice guidance ready.');

    const requestRevision = ++navigationStartRevision;
    let routeRevision = state.routeRevision;
    const plannedRoute = state.route;
    navigationStartPending = true;
    try {
      const current = await acquireCurrentLocation().catch(() => null);
      if (requestRevision !== navigationStartRevision || routeRevision !== state.routeRevision || plannedRoute !== state.route || state.stage !== 'planner') return;
      if (!current) { toast('Allow location access to start navigation'); return; }
      if (!Number.isFinite(current.accuracy) || current.accuracy > 100 || current.accuracy < 0) {
        toast('Waiting for an accurate location — try Start again when the GPS signal improves', 5000);
        return;
      }
      state.userLatLng = current.latlng;
      if (state.culturalRoute) {
        const cultural = state.culturalRoute;
        const stillCurrent = () => requestRevision === navigationStartRevision && routeRevision === state.routeRevision &&
          state.stage === 'planner' && state.culturalRoute === cultural;
        cultural.originLabel = 'Your location';
        const ready = await prepareCulturalJoin(current.latlng, {fit: false, accuracy: current.accuracy, isCurrent: stillCurrent});
        if (!ready || !stillCurrent()) return;
      }
      const distanceFromPlannedStart = state.start ? hav({ lat: current.latlng.lat, lon: current.latlng.lng }, { lat: state.start.lat, lon: state.start.lng }) : 0;
      if (distanceFromPlannedStart > 60 && !state.importedRouteName) {
        state.start = current.latlng; state.startLabel = 'Your location';
        invalidateRoute();
        routeRevision = state.routeRevision;
        await calculateRoute({ fit: false, quiet: true });
        if (requestRevision !== navigationStartRevision || routeRevision !== state.routeRevision || state.stage !== 'planner') return;
        if (!state.route) {
          setStage('planner');
          return;
        }
      }

      clearArrivalSummary();
      state.navigating = true;
      state.followUser = true;
      const themeBeforeNavigation = document.documentElement.dataset.theme;
      applyTheme();
      if (themeBeforeNavigation !== document.documentElement.dataset.theme && offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
        map.removeLayer(offlineVectorLayer);
        offlineVectorLayer = null;
        if (!map.hasLayer(onlineBaseLayer)) onlineBaseLayer.addTo(map);
        baseLayer = onlineBaseLayer;
        activatePackagedBasemap().catch(console.warn);
      }
      resetNavigationProgress();
      if (state.route.imported) {
        const importedSnap = nearestOnRoute(current.latlng);
        if (importedSnap && importedSnap.distance <= (state.mode === 'cycle' ? 80 : 60) && current.accuracy <= 100) {
          state.lastSegment = importedSnap.segment;
          state.navProgressMeters = importedSnap.progress;
        } else if (importedSnap) {
          toast(`Imported route is ${formatDistance(importedSnap.distance)} away — head to the nearest point to join it.`, 6000);
        }
      }
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
      const track = state.culturalRoute?.phase === 'joining' ? state.culturalRoute.trackPlan : null;
      const initialMins = state.route.mins + (track?.mins || 0), initialDist = state.route.dist + (track?.dist || 0);
      el('navEta').textContent = formatDuration(initialMins);
      el('navRemain').textContent = `${formatDistance(initialDist)} · arrive ${arrivalTime(initialMins)}`;
      el('turnDistance').textContent = 'Start';
      el('turnText').textContent = state.route.initialInstruction;
      el('nextTurnText').textContent = state.route.maneuvers[0] ? `Then ${state.route.maneuvers[0].instruction.charAt(0).toLowerCase()}${state.route.maneuvers[0].instruction.slice(1)}` : '';
      if (state.route.imported && initialSnap?.distance > (state.mode === 'cycle' ? 80 : 60)) {
        el('navEta').textContent = 'Join route';
        el('turnText').textContent = 'Join the imported route';
        el('turnDistance').textContent = formatDistance(initialSnap.distance);
        el('nextTurnText').textContent = 'Follow the imported track once you reach it.';
        speak('Join the imported route to begin guidance.', {priority:3});
      } else speak(`Navigation started. ${state.route.initialInstruction}.`, { priority: 3, dedupeMs: 1000 });

      state.watchId = navigator.geolocation.watchPosition(
        updateNavigation,
        err => { console.warn(err); toast('GPS signal unavailable'); },
        { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
      );
    } finally {
      if (requestRevision === navigationStartRevision) navigationStartPending = false;
    }
  }

  function stopNavigation({ keepRoute = true, arrived = false } = {}) {
    clearArrivalSummary();
    cancelNavigationStart();
    if (state.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null; state.navigating = false; state.followUser = true;
    const themeBeforeExit = document.documentElement.dataset.theme;
    applyTheme();
    if (themeBeforeExit !== document.documentElement.dataset.theme && offlineVectorLayer && map.hasLayer(offlineVectorLayer)) {
      map.removeLayer(offlineVectorLayer);
      offlineVectorLayer = null;
      if (!map.hasLayer(onlineBaseLayer)) onlineBaseLayer.addTo(map);
      baseLayer = onlineBaseLayer;
      activatePackagedBasemap().catch(console.warn);
    }
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
  el('arrivalDoneBtn').addEventListener('click', finishArrivalSummary);
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

  function validPmtilesHeader(header, size) {
    if (!Number.isSafeInteger(size) || size < 100000 || header.byteLength < 127) return false;
    if (![80, 77, 84, 105, 108, 101, 115, 3].every((value, index) => header[index] === value)) return false;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const uint64 = offset => view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 4294967296;
    // The v3 header declares each directory/metadata/tile-data section's extent.
    // A valid signature alone does not establish that the download is complete.
    for (const offset of [8, 24, 40, 56]) {
      const start = uint64(offset), length = uint64(offset + 8);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) ||
          (length > 0 && start < 127) || start > size || length > size - start) return false;
    }
    return uint64(16) > 0 && uint64(64) > 0;
  }

  async function validCachedOfflineMap(response) {
    if (response?.status !== 200) return false;
    const size = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(size) || size < 100000) return false;
    if (!response.body?.getReader) {
      const blob = await response.blob();
      return blob.size === size && validPmtilesHeader(new Uint8Array(await blob.slice(0, 127).arrayBuffer()), blob.size);
    }
    // Cached downloads record their actual blob length. Read only the header on
    // startup rather than loading or hashing the entire basemap again.
    const reader = response.body.getReader();
    const header = new Uint8Array(127);
    let received = 0;
    try {
      while (received < header.length) {
        const {done, value} = await reader.read();
        if (done) return false;
        const length = Math.min(value.byteLength, header.length - received);
        header.set(value.subarray(0, length), received);
        received += length;
      }
      return validPmtilesHeader(header, size);
    } finally {
      // Do not wait for a cloned response's other stream branch to finish.
      reader.cancel().catch(() => {});
    }
  }

  async function offlineMapCached() {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      const url = new URL(OFFLINE_MAP_URL, location.href).href;
      const basemap = await cache.match(url);
      if (!await validCachedOfflineMap(basemap)) {
        // Pre-validation downloads must not keep poisoning subsequent retries.
        if (basemap) await cache.delete(url);
        return false;
      }
      state.offlineMapBytes = Number(basemap.headers.get('Content-Length'));
      const network = await caches.match(new URL('./data/network.json', location.href).href);
      if (!network?.ok) return false;
      const parsed = parseBundledNetwork(await network.json());
      return parsed.nodes.size >= 1000 && parsed.ways.length >= 100;
    } catch (_) { return false; }
  }

  function renderOfflineStatus() {
    const status = el('offlineStatus');
    const button = el('offlineDownloadBtn');
    if (!status || !button) return;
    if (state.offlineDownloadBusy) return;
    if (state.offlineMapDownloaded) {
      status.textContent = `Ready for offline journeys${state.offlineMapBytes ? ` · ${humanBytes(state.offlineMapBytes)}` : ''}. Map and routing are available offline.`;
      button.textContent = 'Remove';
      button.disabled = false;
    } else if (state.offlineMapAvailable) {
      status.textContent = `Download the MK map${state.offlineMapBytes ? ` (${humanBytes(state.offlineMapBytes)})` : ''} before travelling without signal.`;
      button.textContent = 'Download';
      button.disabled = false;
    } else {
      status.textContent = state.offlineMapMissing
        ? 'The offline map is not available in this deployment yet.'
        : navigator.onLine === false
          ? 'Connect to download the offline MK basemap.'
          : 'Could not check the offline basemap. Try again when connected.';
      button.textContent = state.offlineMapMissing ? 'Unavailable' : 'Retry';
      button.disabled = Boolean(state.offlineMapMissing);
    }
  }

  async function probeOfflineMap() {
    state.offlineMapDownloaded = await offlineMapCached();
    try {
      const response = await fetch(OFFLINE_MAP_URL, { method: 'HEAD', cache: 'no-store' });
      state.offlineMapMissing = [404, 410].includes(response.status);
      state.offlineMapAvailable = response.status === 200 || state.offlineMapDownloaded;
      const len = Number(response.headers.get('Content-Length') || 0);
      if (len > 0) state.offlineMapBytes = len;
    } catch (_) {
      state.offlineMapMissing = false;
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
    if (offlineVectorLayer && map.hasLayer(offlineVectorLayer)) return true;
    try {
      const layer = window.protomapsL.leafletLayer({
        url: OFFLINE_MAP_URL,
        flavor: ['dark','high-contrast'].includes(effectiveTheme()) ? 'dark' : 'light',
        lang: 'en',
        attribution: '<a href="https://protomaps.com/">Protomaps</a>'
      });
      offlineVectorLayer = layer;
      const previousLayer = baseLayer;
      let switched = false;
      const finishSwitch = () => {
        if (switched || offlineVectorLayer !== layer) return;
        switched = true;
        if (previousLayer && previousLayer !== layer && map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
        baseLayer = layer;
      };
      // Keep the complete raster fallback visible until the vector layer has
      // finished the current view; switching on the first tile creates a patchwork.
      layer.on?.('load', finishSwitch);
      layer.addTo(map);
      setTimeout(() => {
        if (!switched && offlineVectorLayer === layer && map.hasLayer(layer)) {
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
      './data/network.json', './data/places.json', './data/data-meta.json', './about.js', './index.html', './styles.css', './app.js', './routing.js', './manifest.webmanifest',
      './icons/app-logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
      './vendor/leaflet.css',
      './vendor/leaflet.js',
      './vendor/leaflet-rotate.umd.min.js',
      './vendor/protomaps-leaflet.js'
    ];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' });
        if (response.ok) {
          if (url === './data/network.json') {
            const parsed = parseBundledNetwork(await response.clone().json());
            if (parsed.nodes.size < 1000 || parsed.ways.length < 100) throw new Error('Offline routing data is incomplete');
          }
          if (url === './data/places.json') parsePlaceIndex(await response.clone().json());
          await cache.put(url, response.clone());
        }
      } catch (err) { console.warn('Could not cache offline dependency', url, err); }
    }
    const network = await cache.match(new URL('./data/network.json', location.href).href);
    if (!network?.ok) throw new Error('Routing data could not be downloaded');
    const parsed = parseBundledNetwork(await network.json());
    if (parsed.nodes.size < 1000 || parsed.ways.length < 100) throw new Error('Offline routing data is incomplete');
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
    if (!state.offlineMapAvailable && !await probeOfflineMap()) return;
    if (state.offlineDownloadBusy || state.offlineMapDownloaded) return;
    state.offlineDownloadBusy = true;
    const button = el('offlineDownloadBtn');
    const status = el('offlineStatus');
    button.disabled = true;
    button.textContent = 'Downloading…';
    status.textContent = 'Starting offline map download…';
    let downloadFailed = false;
    try {
      const response = await fetch(OFFLINE_MAP_URL, { cache: 'no-store' });
      if (response.status !== 200) throw new Error(`Offline map returned ${response.status}; a complete download is required`);
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
      const header = new Uint8Array(await blob.slice(0, 127).arrayBuffer());
      if (!validPmtilesHeader(header, blob.size)) throw new Error('Offline map is invalid or incomplete');
      const declaredLength = response.headers.get('Content-Length');
      const encoding = response.headers.get('Content-Encoding');
      if (declaredLength !== null && (!encoding || encoding.toLowerCase() === 'identity') &&
          (!Number.isSafeInteger(Number(declaredLength)) || Number(declaredLength) !== blob.size)) {
        throw new Error('Offline map download is incomplete');
      }
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
      toast('Ready for offline journeys in Milton Keynes');
      await activatePackagedBasemap();
    } catch (err) {
      console.error(err);
      downloadFailed = true;
      state.offlineMapDownloaded = false;
      toast('Offline map download failed');
    } finally {
      state.offlineDownloadBusy = false;
      renderOfflineStatus();
      if (downloadFailed) status.textContent = 'Download failed. Check your connection and available device storage, then retry.';
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
  el('app').dataset.appVersion = '0.14.10';
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
  loadPlaceIndex();
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
