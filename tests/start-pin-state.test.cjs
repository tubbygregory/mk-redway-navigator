const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../routing.js');
const app = fs.readFileSync('app.js', 'utf8');

function code(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing application function: ${from}`);
  return app.slice(start, end);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
const source = [[52, -.746], [52.003, -.743], [52.003, -.746], [52, -.746]];
const origin = {lat: 52, lng: -.75};
const network = {
  nodes: new Map([[1, {id: 1, lat: 52, lon: -.75}], [2, {id: 2, lat: 52, lon: -.746}],
    [3, {id: 3, lat: 52.003, lon: -.743}], [4, {id: 4, lat: 52.003, lon: -.746}]]),
  ways: [{id: 10, nodes: [1, 2, 3, 4, 2], tags: {highway: 'cycleway', foot: 'designated', bicycle: 'designated'}}]
};

function harness({cultural = false} = {}) {
  const elements = {}, installs = [], fits = [], positions = [], mapListeners = {};
  function node() {
    const classes = new Set();
    return {hidden: true, value: '', dataset: {}, style: {}, listeners: {},
      focus() {}, replaceChildren() {}, appendChild() {}, setAttribute() {},
      addEventListener(event, listener) { this.listeners[event] = listener; },
      classList: {toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name)}};
  }
  const el = id => elements[id] ??= node();
  const state = {stage: 'planner', mode: 'cycle', pref: 'maximum', start: {...origin}, end: {lat: 52.003, lng: -.743},
    startLabel: 'Original start', endLabel: 'Destination', routeRevision: 1, culturalRoute: null, importedRouteName: '',
    routing: false, pendingRoute: false, navigating: false, graphCache: new Map(), networkSource: 'bundled',
    announcedFar: new Set(), announcedNear: new Set()};
  const calls = {watch: 0, geocode: 0};
  const context = vm.createContext({...R, state, el, console,
    MK: {south: 51.955, west: -.905, north: 52.155, east: -.615},
    searchRevision: 0, gpxLoadRevision: 0, startLocationRevision: 0,
    navigationStartRevision: 0, navigationStartPending: false, sheetGestureUntil: 0,
    window: {innerWidth: 390}, performance: {now: () => 100},
    document: {createElement: node, activeElement: null, documentElement: {dataset: {theme: 'light'}}},
    navigator: {geolocation: {watchPosition() { calls.watch++; return calls.watch; }}},
    L: {latLng: (lat, lng) => ({lat, lng})},
    searchResultLayer: {clearLayers() {}},
    map: {on(event, listener) { mapListeners[event] = listener; },
      setView(...args) { fits.push(args); }},
    setRouteSheetCollapsed() {}, setSheetCollapsed() {}, clearArrivalSummary() {},
    setRouteStatus(message, kind = '') { el('routeStatus').textContent = message; el('routeStatus').className = kind; },
    routeReadyStatus: () => 'Route ready', toast() {},
    fmtCoord: point => `${point.lat}, ${point.lng}`,
    conciseResultName: result => result.name,
    resultSecondary: result => result.display_name,
    validateSearchResult: result => Number.isFinite(result.lat) && Number.isFinite(result.lon) &&
      result.lat >= 51.955 && result.lat <= 52.155 && result.lon >= -.905 && result.lon <= -.615,
    savePendingMapPin: () => false, redrawMarkers() {}, updatePlannerFields() {}, renderAlternatives() {},
    invalidateRoute() { state.route = null; state.routeRevision++; },
    acquireCurrentLocation() { const position = deferred(); positions.push(position); return position.promise; },
    unlockSpeechFromGesture() {}, setUserMarker() {},
    applyTheme() {}, offlineVectorLayer: null, redwayLayer: {remove() {}},
    nearestOnRoute: () => ({segment: 0, progress: 0, distance: 0}), routeHeadingAt: () => 90,
    requestAnimationFrame() {}, followNavigationView() {}, setTurnIcon() {}, updateNavigation() {},
    formatDuration: String, formatDistance: String, arrivalTime: () => '12:00', speak() {},
    sleep: async () => {}, ensureRoutingNetwork: async () => network,
    getGraph: (parsed, mode, pref) => R.buildGraph(parsed, mode, pref),
    installRoute(plan, options = {}) {
      state.route = plan; installs.push(plan);
      if (options.fit !== false) fits.push(plan.coords);
      el('startNavBtn').disabled = false;
    },
    setStage(stage) {
      state.stage = stage; context.searchRevision++; context.gpxLoadRevision++;
      state.searchMapPickContext = null; state.plannerSearchOpen = false;
      if (stage !== 'planner') { context.cancelNavigationStart(); context.cancelStartLocation(); }
    }
  });
  for (const [from, to] of [
    ['  function cancelNavigationStart()', '  let sheetGestureUntil'],
    ['  function setPoint(', '  function updatePlannerFields('],
    ['  function appendSearchRecovery(', "  for (const [id, context] of [['startSearch'"],
    ['  function selectSearchResult(', '  function showPlaceSheet()'],
    ['  async function useCurrentLocation(', '  async function refreshBrowseLocation('],
    ['  function routeFromNearestPoint(', '  function closeExploreRoutes('],
    ['  async function solveRouteOnNetwork(', '  function expandedBox('],
    ['  async function calculateRoute(', '  function xmlEscape('],
    ['  function importedPlan(', '  function beginCulturalTrack('],
    ['  function resetNavigationProgress()', '  function stopNavigation('],
    ["  map.on('click', e => {", '  async function reverseGeocode(']
  ]) vm.runInContext(code(from, to), context);
  state.route = R.planRoute(network, R.buildGraph(network, state.mode, state.pref), state.start, state.end, state.mode, state.endLabel);
  if (cultural) {
    const trackPlan = context.importedPlan(source, 'Blue Cultural Route');
    state.culturalRoute = {id: 'blue', color: 'Blue', title: 'Blue Cultural Route', sourceCoords: source,
      trackPlan, phase: 'awaiting', origin: state.start, originLabel: state.startLabel, joinRevision: 0};
    state.importedRouteName = 'Blue Cultural Route';
    state.route = trackPlan;
  }
  return {context, state, el, installs, fits, positions, calls, mapListeners,
    fix(point = origin) { positions.at(-1).resolve({latlng: {...point}, accuracy: 5}); }};
}

test('opening either starting-point chooser cancels pending Start before a point is selected', async () => {
  for (const open of [h => h.context.openPlannerSearch('start'), h => h.context.beginResultMapPick('start')]) {
    const h = harness(), route = h.state.route, start = h.state.start, end = h.state.end;
    const pending = h.context.startNavigation();
    open(h);
    h.fix(); await pending;
    assert.equal(h.state.navigating, false);
    assert.equal(h.calls.watch, 0);
    assert.equal(h.state.route, route);
    assert.equal(h.state.start, start);
    assert.equal(h.state.end, end);
    h.context.closeSearch();
    assert.equal(h.el('startNavBtn').disabled, false);
    assert.equal(h.state.stage, 'planner');
  }
});

test('late planner location cannot replace the map pin chosen instead', async () => {
  const h = harness();
  const pending = h.context.useCurrentLocation();
  h.context.beginResultMapPick('start');
  const chosen = {lat: 52.003, lng: -.746};
  h.mapListeners.click({latlng: chosen});
  h.fix(origin); await pending; await new Promise(setImmediate);
  assert.equal(h.state.start.lat, chosen.lat);
  assert.equal(h.state.start.lng, chosen.lng);
  assert.equal(h.state.startLabel, 'Dropped pin');
  assert.equal(h.state.navigating, false);
});

test('opening the start chooser retires pending ordinary routing without discarding its current preview', async () => {
  const h = harness(), graph = deferred(), route = h.state.route;
  h.context.ensureRoutingNetwork = () => graph.promise;
  const pending = h.context.calculateRoute();
  h.context.openPlannerSearch('start');
  graph.resolve(network); await pending;
  assert.equal(h.state.route, route);
  assert.equal(h.installs.length, 0);
  assert.equal(h.fits.length, 0);
  h.context.closeSearch();
  assert.equal(h.el('startNavBtn').disabled, false);
  assert.doesNotMatch(h.el('routeStatus').textContent || '', /Finding/);
});

test('choosing a new start retires an old Cultural join without replacing the current track or moving the map', async () => {
  for (const open of [h => h.context.openPlannerSearch('start'), h => h.context.beginResultMapPick('start')]) {
    const h = harness({cultural: true}), graph = deferred();
    const route = h.state.route, sourceBefore = JSON.stringify(source);
    h.context.ensureRoutingNetwork = () => graph.promise;
    const pending = h.context.prepareCulturalJoin(origin);
    open(h);
    graph.resolve(network); await pending;
    assert.equal(h.state.route, route);
    assert.equal(h.state.culturalRoute.sourceCoords, source);
    assert.equal(JSON.stringify(source), sourceBefore);
    assert.equal(h.installs.length, 0);
    assert.equal(h.fits.length, 0);
    h.context.closeSearch();
    assert.equal(h.el('startNavBtn').disabled, false);
    assert.doesNotMatch(h.el('routeStatus').textContent || '', /Finding a route/);
  }
});

test('a completed starting-point picker consumes the older Move entrance request', async () => {
  const h = harness(); h.state.editEndpoint = 'start';
  h.context.beginResultMapPick('start');
  h.mapListeners.click({latlng: {lat: 52.003, lng: -.746}});
  const chosen = h.state.start;
  h.mapListeners.click({latlng: {lat: 52, lng: -.75}});
  await new Promise(setImmediate);
  assert.equal(h.state.start, chosen);
  assert.equal(h.state.searchMapPickContext, null);
});

test('an explicit Cultural start pin calculates its legal joining leg and keeps the official source geometry', async () => {
  const h = harness({cultural: true}), cultural = h.state.culturalRoute, sourceBefore = JSON.stringify(source);
  h.context.beginResultMapPick('start');
  h.mapListeners.click({latlng: origin});
  await new Promise(setImmediate);
  assert.equal(h.state.culturalRoute, cultural);
  assert.equal(cultural.sourceCoords, source);
  assert.equal(JSON.stringify(source), sourceBefore);
  assert.equal(cultural.phase, 'joining');
  assert.equal(h.state.start.lat, origin.lat);
  assert.equal(h.state.start.lng, origin.lng);
  assert.equal(h.state.startLabel, 'Dropped pin');
  assert.equal(h.state.route.imported, undefined);
  assert.ok(h.state.route.result.edges.every(edge => edge.wayId === 10));
  assert.equal(h.positions.length, 0, 'choosing a point must not request GPS');
  assert.equal(h.calls.watch, 0);
});
