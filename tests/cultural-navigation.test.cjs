const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../routing.js');
const app = fs.readFileSync('app.js', 'utf8');
const source = [[52, -.746], [52.003, -.743], [52.003, -.746], [52, -.746]];
const origin = {lat: 52, lng: -.75};
const network = {
  nodes: new Map([[1, {id: 1, lat: 52, lon: -.75}], [2, {id: 2, lat: 52, lon: -.746}],
    [3, {id: 3, lat: 52.003, lon: -.743}], [4, {id: 4, lat: 52.003, lon: -.746}],
    [5, {id: 5, lat: 52.003, lon: -.75}]]),
  ways: [{id: 10, nodes: [1, 2], tags: {highway: 'footway', foot: 'yes', bicycle: 'no'}},
    {id: 11, nodes: [1, 5, 2], tags: {highway: 'cycleway', foot: 'designated', bicycle: 'designated'}},
    {id: 12, nodes: [2, 3, 4, 2], tags: {highway: 'cycleway', foot: 'designated', bicycle: 'designated'}}]
};
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
function harness() {
  const elements = {}, lines = [], positions = [], speech = [], toasts = [], statuses = [], files = [];
  const calls = {watch: 0, clearWatch: 0, graph: 0};
  const state = {mode: 'cycle', pref: 'maximum', routeRevision: 1, stage: 'planner', route: null,
    importedRouteName: '', culturalRoute: null, userLatLng: null, start: null, end: null,
    routing: false, navigating: false, networkSource: 'bundled', themeChoice: 'light',
    lastSegment: 0, navProgressMeters: 0, offRouteCount: 0, lastRerouteAt: 0,
    announcedFar: new Set(), announcedNear: new Set(), headingSupported: false};
  const el = id => elements[id] ??= {hidden: true, classList: {toggle() {}}, querySelectorAll: () => []};
  const context = vm.createContext({...R, state, el, console, window: {innerWidth: 390},
    CULTURAL_ROUTE_COLOURS: {blue: '#3c78d8', yellow: '#d5a500', green: '#23864a', iron: '#5f6670', cornflower: '#6495ed'},
    gpxLoadRevision: 0, navigationStartRevision: 0, navigationStartPending: false,
    navigator: {geolocation: {watchPosition() { calls.watch++; return calls.watch; }, clearWatch() { calls.clearWatch++; }}},
    document: {documentElement: {dataset: {theme: 'light'}}, querySelector: () => el('roadNote')},
    L: {latLng: (lat, lng) => ({lat, lng}), polyline(coords, options) {
      const line = {coords, options, addTo() { lines.push(this); return this; }}; return line;
    }},
    routeLayer: {clearLayers() { lines.length = 0; }},
    map: {hasLayer: () => false}, offlineVectorLayer: null,
    redwayLayer: {remove() {}, addTo() {}}, userLayer: {clearLayers() {}},
    formatDuration: String, formatDistance: String, formatTurnDistance: String, arrivalTime: () => '12:00',
    setTimeout() {}, requestAnimationFrame() {}, fitRouteBounds() {},
    setUserMarker() {}, redrawMarkers() {}, updatePlannerFields() {},
    renderUnlitSegments() {}, renderAlternatives() {}, renderApproachNote() {},
    renderRouteMix(plan) { el('routeMix').hidden = !plan?.mixPercent; },
    renderRouteInsights(plan) { el('routeInsights').hidden = !plan?.insights; },
    setRouteSheetCollapsed() {}, offerInstallOnce() {}, routeReadyStatus: () => 'Route ready',
    setRouteStatus(message) { statuses.push(message); el('routeStatus').textContent = message; },
    toast(message) { toasts.push(message); }, speak(message) { speech.push(message); },
    closeSearch() {}, cancelStartLocation() {}, clearSpeechQueue() {}, resetMapOrientation() {}, applyTheme() {},
    unlockSpeechFromGesture() {}, setTurnIcon() {}, followNavigationView() {},
    resolveTravelHeading: () => 90, routeHeadingAt: () => 90, announceManeuver() {},
    activeManeuver: () => ({maneuver: null}), fmtCoord: point => `${point.lat},${point.lng}`,
    getGraph(parsed, mode, pref) { return R.buildGraph(parsed, mode, pref); },
    ensureRoutingNetwork() { calls.graph++; return Promise.resolve(network); },
    acquireCurrentLocation() { const pending = deferred(); positions.push(pending); return pending.promise; },
    cancelNavigationStart() { context.navigationStartRevision++; context.navigationStartPending = false; },
    invalidateRoute() { state.route = null; state.routeRevision++; lines.length = 0; },
    setStage(stage) {
      state.stage = stage; context.gpxLoadRevision++;
      if (stage !== 'planner') context.cancelNavigationStart();
    },
    showPlaceSheet() { context.setStage('place'); },
    downloadText(name, text, type) { files.push({name, text, type}); },
    File: class {constructor(parts, name, options) {this.parts = parts; this.name = name; this.type = options.type;}},
  });
  for (const [from, to] of [
    ['  function setPoint(', '  function updatePlannerFields('],
    ['  function routeFromNearestPoint(', '  function closeExploreRoutes('],
    ['  function setMode(mode)', "  el('cycleBtn').addEventListener"],
    ['  function drawRoute(', '  function routeReadyStatus('],
    ['  function installRoute(', '  async function solveRouteOnNetwork('],
    ['  async function calculateRoute(', '  function xmlEscape('],
    ['  function xmlEscape(', '  function downloadText('],
    ['  function importedPlan(', '  async function loadOfficialGpx('],
    ['  async function sendRouteToPhone(', '  function restoreSharedRoute('],
    ['  function xy(', '  function normalizeHeading('],
    ['  function nearestOnRoute(', '  function setUserMarker('],
    ['  function updateNavigation(', '  async function rerouteFromPosition('],
    ['  async function rerouteFromPosition(', "  el('startNavBtn').addEventListener"]
  ]) vm.runInContext(code(from, to), context);
  function cultural(coords = source, options = {}) {
    context.installImportedGpx(coords, 'Blue · Source & route', {culturalRoute: {id: 'blue', color: 'Blue'}, ...options});
  }
  return {context, state, el, lines, positions, speech, toasts, statuses, files, calls, cultural,
    fix(lat = origin.lat, lng = origin.lng, accuracy = 5) {
      positions.at(-1).resolve({latlng: {lat, lng}, accuracy});
    },
    position(lat, lng, accuracy = 5) { return {coords: {latitude: lat, longitude: lng, accuracy}}; }};
}

test('joining leg is a legal mode-specific red route; source track retains its colour and geometry', async () => {
  const distances = [];
  for (const mode of ['walk', 'cycle']) {
    const h = harness(), original = JSON.stringify(source); h.state.mode = mode; h.cultural();
    assert.equal(await h.context.prepareCulturalJoin(origin), true);
    assert.equal(h.state.culturalRoute.phase, 'joining'); assert.equal(h.state.route.imported, undefined);
    const red = h.lines.find(line => line.options.className === 'route-line');
    const coloured = h.lines.find(line => line.options.className === 'cultural-route-line');
    assert.equal(red.coords, h.state.route.coords); assert.equal(coloured.options.color, '#3c78d8');
    assert.equal(JSON.stringify(coloured.coords), original); assert.equal(JSON.stringify(source), original);
    assert.ok(h.state.route.result.edges.every(edge => mode === 'walk' || edge.wayId !== 10));
    assert.equal(h.el('distanceStat').textContent, String(h.state.route.dist + h.state.culturalRoute.trackPlan.dist));
    assert.equal(h.el('redwayStat').textContent, 'Unknown'); assert.equal(h.el('roadStat').textContent, 'Unknown');
    assert.equal(h.el('routeMix').hidden, true); assert.equal(h.el('routeInsights').hidden, true);
    assert.match(h.el('culturalRouteLegend').textContent, /Red:.*start \/ join.*Blue:/);
    assert.ok(h.state.route.maneuvers.filter(m => m.arrive).every(m => /^Join the Blue/.test(m.instruction)));
    distances.push(h.state.route.dist);
  }
  assert.ok(distances[1] > distances[0] + 300, 'cycling must avoid the foot-only shortcut');
});

test('closed loops rotate only source points using explicit origin; open shortcuts keep their first point', () => {
  const h = harness(), near = {lat: source[1][0], lng: source[1][1]}, original = JSON.stringify(source);
  h.state.userLatLng = origin;
  const loop = h.context.routeFromNearestPoint(source, near);
  assert.deepEqual([...loop[0]], source[1]); assert.deepEqual([...loop.at(-1)], source[1]);
  assert.equal(loop.length, source.length); assert.equal(JSON.stringify(source), original);
  const open = source.slice(0, -1);
  assert.equal(h.context.routeFromNearestPoint(open, near), open);
});

test('Cultural preview needs no location prompt; known explicit start produces the red leg', async () => {
  const h = harness(); h.cultural(source, {origin, originLabel: 'Chosen start'});
  await new Promise(setImmediate);
  assert.equal(h.calls.graph, 1); assert.equal(h.positions.length, 0);
  assert.equal(h.state.start, origin); assert.equal(h.state.startLabel, 'Chosen start');
  assert.equal(h.state.culturalRoute.phase, 'joining', JSON.stringify(h.statuses));
  const waiting = harness(); waiting.cultural();
  assert.equal(waiting.calls.graph, 0); assert.equal(waiting.positions.length, 0);
  assert.equal(waiting.state.start, null); assert.match(waiting.el('routeStatus').textContent, /Choose a starting point/);
});

test('Start computes from accurate current GPS once and preserves joining plus track estimates', async () => {
  const h = harness(); h.cultural();
  const pending = h.context.startNavigation(); await h.context.startNavigation();
  assert.equal(h.positions.length, 1); h.fix(); await pending;
  assert.equal(h.calls.graph, 1); assert.equal(h.calls.watch, 1);
  assert.equal(h.state.navigating, true); assert.equal(h.state.culturalRoute.phase, 'joining');
  assert.equal(h.el('navEta').textContent, String(h.state.route.mins + h.state.culturalRoute.trackPlan.mins));
  assert.equal(h.state.start.lat, origin.lat); assert.equal(h.state.start.lng, origin.lng);
});

test('accurate joining arrival hands off without false final arrival; poor and distant fixes do not advance the track', async () => {
  const h = harness(); h.cultural(); const pending = h.context.startNavigation(); h.fix(); await pending;
  const join = h.state.end;
  h.context.updateNavigation(h.position(join.lat, join.lng, 150));
  assert.equal(h.state.culturalRoute.phase, 'joining'); assert.equal(h.state.navProgressMeters, 0);
  h.context.updateNavigation(h.position(join.lat, join.lng));
  assert.equal(h.state.culturalRoute.phase, 'track'); assert.equal(h.state.route.imported, true);
  assert.equal(h.state.navigating, true); assert.equal(h.calls.watch, 1); assert.equal(h.calls.clearWatch, 0);
  assert.equal(h.state.navProgressMeters, 0); assert.ok(!h.speech.some(text => /You have arrived/.test(text)));
  assert.ok(h.speech.some(text => /Joined the Blue/.test(text)));
  h.context.updateNavigation(h.position(52.01, -.76));
  assert.equal(h.state.navProgressMeters, 0); assert.match(h.el('turnText').textContent, /Join the imported route/);
});

test('already near a Cultural join needs no invented connector and requires a precise initial fix', async () => {
  for (const accuracy of [5, 60, 200]) {
    const h = harness(); h.cultural(); const pending = h.context.startNavigation();
    h.fix(source[0][0], source[0][1], accuracy); await pending;
    assert.equal(h.calls.graph, 0);
    assert.equal(h.state.navigating, accuracy === 5);
    assert.equal(h.calls.watch, accuracy === 5 ? 1 : 0);
    assert.equal(h.state.navProgressMeters, 0);
    assert.ok(!h.lines.some(line => line.options.className === 'route-line'));
  }
});

test('an unmapped final joining approach reports its actual gap, not the whole Cultural ride distance', async () => {
  const h = harness(); h.state.mode = 'walk'; h.cultural([[51.9993, -.746], [51.9993, -.74]]);
  const pending = h.context.startNavigation(); h.fix(); await pending;
  assert.ok(h.state.route.snaps.end > 70);
  assert.match(h.state.route.maneuvers.at(-1).instruction, /start \/ join; check the remaining approach/);
  h.context.updateNavigation(h.position(52, -.746));
  const gap = R.hav({lat: 52, lon: -.746}, {lat: h.state.end.lat, lon: h.state.end.lng});
  assert.equal(h.el('turnDistance').textContent, String(gap));
  assert.match(h.el('turnText').textContent, /Mapped joining leg ends here/);
  assert.equal(h.state.culturalRoute.phase, 'joining'); assert.equal(h.state.navigating, true);
  assert.ok(!h.speech.some(text => /You have arrived/.test(text)));
});

test('near the closing side of a fresh loop, both handoff and direct Start retain beginning progress', async () => {
  for (const handoff of [false, true]) {
    const h = harness(); h.cultural(); const pending = h.context.startNavigation();
    h.fix(handoff ? origin.lat : source[0][0] + .00015, handoff ? origin.lng : source[0][1]);
    await pending;
    h.context.updateNavigation(h.position(source[0][0] + .00015, source[0][1]));
    assert.equal(h.state.culturalRoute.phase, 'track');
    assert.equal(h.state.navigating, true); assert.equal(h.calls.clearWatch, 0);
    assert.ok(h.state.navProgressMeters < 30, 'closing-side geometry must not create almost-complete progress');
    assert.equal(h.state.culturalRoute.startingTrack, true);
    assert.ok(!h.speech.some(text => /You have arrived/.test(text)));
    // Genuine progress around the original loop still permits final completion.
    h.context.updateNavigation(h.position(source[1][0], source[1][1]));
    assert.equal(h.state.culturalRoute.startingTrack, false);
    h.context.updateNavigation(h.position(source[2][0], source[2][1]));
    h.context.updateNavigation(h.position(source[0][0] + .00015, source[0][1]));
    assert.equal(h.state.navigating, false); assert.equal(h.calls.clearWatch, 1);
    assert.ok(h.speech.some(text => /You have arrived/.test(text)));
  }
});

test('an accurate resumed fix on the unchanged official Blue track recovers after missing initial watch callbacks', async () => {
  const xml = fs.readFileSync('cultural-routes/gpx-blue-main.gpx', 'utf8');
  const points = [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(points.length > 1000);
  const h = harness(); h.cultural(points); const pending = h.context.startNavigation();
  h.fix(points[0][0], points[0][1]); await pending;
  assert.equal(h.state.culturalRoute.startingTrack, true);
  assert.ok(R.hav({lat: points[0][0], lon: points[0][1]}, {lat: points[19][0], lon: points[19][1]}) > 50);
  h.context.updateNavigation(h.position(points[19][0], points[19][1], 150));
  assert.equal(h.state.culturalRoute.startingTrack, true); assert.equal(h.state.navProgressMeters, 0);
  h.context.updateNavigation(h.position(points[19][0], points[19][1]));
  assert.equal(h.state.culturalRoute.startingTrack, false);
  assert.ok(Math.abs(h.state.navProgressMeters - R.buildCumulative(points)[19]) < 5);
  assert.equal(h.state.navigating, true); assert.notEqual(h.el('navEta').textContent, 'Join route');
});

test('late Cultural GPS cannot restart after Back, replacement, or mode change', async () => {
  for (const cancel of [h => h.context.setStage('place'), h => h.context.installImportedGpx(source, 'Replacement GPX'),
    h => h.context.setMode('walk')]) {
    const h = harness(); h.cultural(); const pending = h.context.startNavigation(); cancel(h); h.fix(); await pending;
    assert.equal(h.state.navigating, false); assert.equal(h.calls.watch, 0);
  }
});

test('late joining network calculations cannot restore navigation or routes after cancellation', async () => {
  for (const cancel of [h => h.context.setStage('place'), h => h.context.installImportedGpx(source, 'Replacement GPX'),
    h => h.context.stopNavigation({keepRoute: true})]) {
    const h = harness(), graph = deferred(); h.cultural();
    h.context.ensureRoutingNetwork = () => graph.promise;
    const pending = h.context.startNavigation(); h.fix(); await Promise.resolve(); await Promise.resolve();
    cancel(h); const chosen = h.state.route; graph.resolve(network); await pending;
    assert.equal(h.state.route, chosen); assert.equal(h.state.navigating, false); assert.equal(h.calls.watch, 0);
    assert.equal(h.el('startNavBtn').disabled, false);
  }
});

test('stopping a Cultural reroute cancels its completion and keeps the source track', async () => {
  const h = harness(); h.cultural(); const start = h.context.startNavigation(); h.fix(); await start;
  const graph = deferred(); h.context.ensureRoutingNetwork = () => graph.promise;
  const pending = h.context.rerouteFromPosition({lat: 52.003, lng: -.75});
  h.context.stopNavigation({keepRoute: true}); const stopped = h.state.route;
  graph.resolve(network); await pending;
  assert.equal(h.state.navigating, false); assert.equal(h.state.route, stopped); assert.equal(h.calls.clearWatch, 1);
  assert.equal(h.el('startNavBtn').disabled, false);
});

test('missing graphs and unreachable approaches keep the source track and allow an honest retry', async () => {
  for (const unavailable of [true, false]) {
    const h = harness(); h.cultural();
    if (unavailable) h.context.ensureRoutingNetwork = async () => null;
    assert.equal(await h.context.prepareCulturalJoin(unavailable ? origin : {lat: 52.1, lng: -.8}), false);
    assert.equal(h.state.culturalRoute.phase, 'awaiting'); assert.equal(h.state.route.imported, true);
    assert.equal(h.state.navigating, false); assert.equal(h.el('retryRouteBtn').hidden, false);
    assert.match(h.el('routeStatus').textContent, /Could not calculate route to Cultural Route start \/ join/);
    assert.ok(!h.lines.some(line => line.options.className === 'route-line'));
    h.state.start = origin; h.context.ensureRoutingNetwork = async () => network;
    assert.equal(await h.context.calculateRoute(), true);
    assert.equal(h.state.culturalRoute.phase, 'joining'); assert.equal(h.el('retryRouteBtn').hidden, true);
  }
});

test('Cultural export and phone sharing keep the original source geometry during the red joining leg', async () => {
  const h = harness(); h.cultural(); await h.context.prepareCulturalJoin(origin);
  const xml = h.context.routeToGpx(h.state.route, 'Joining leg');
  assert.equal((xml.match(/<trkpt /g) || []).length, source.length);
  for (const pair of source) assert.ok(xml.includes(`lat="${pair[0].toFixed(6)}" lon="${pair[1].toFixed(6)}"`));
  assert.ok(!xml.includes('lon="-0.750000"')); assert.match(xml, /Blue · Source &amp; route/);
  await h.context.sendRouteToPhone(); assert.equal(h.files.length, 1); assert.equal(h.files[0].text, xml);
});

test('generic outside-MK GPX keeps its original import, red display, mode change and export behaviour', () => {
  const h = harness(), outside = [[55.95, -3.19], [55.952, -3.188]];
  h.cultural(); h.context.installImportedGpx(outside, 'Outside track');
  assert.equal(h.state.culturalRoute, null); assert.equal(h.state.route.imported, true);
  assert.equal(h.state.route.coords, outside); assert.ok(h.lines.some(line => line.options.className === 'route-line'));
  assert.ok(!h.lines.some(line => line.options.className === 'cultural-route-line'));
  h.context.setMode('walk'); assert.equal(h.state.route.coords, outside);
  assert.match(h.context.routeToGpx(h.state.route, 'Outside track'), /lat="55.950000" lon="-3.190000"/);
});
