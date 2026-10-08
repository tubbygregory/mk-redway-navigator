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

function functionCode(name) {
  const declaration = new RegExp(`^  (?:async )?function ${name}\\(`, 'm');
  const match = declaration.exec(app);
  assert.ok(match, `Missing application function: ${name}`);
  const end = app.indexOf('\n  }', match.index);
  assert.ok(end > match.index, `Missing application function ending: ${name}`);
  return app.slice(match.index, end + '\n  }'.length);
}

const network = {
  nodes: new Map([[1, {id: 1, lat: 52, lon: -.78}], [2, {id: 2, lat: 52, lon: -.777}],
    [3, {id: 3, lat: 52, lon: -.774}]]),
  ways: [{id: 1, nodes: [1, 2, 3], tags: {highway: 'cycleway', _mk_class: 'redway'}}]
};
const start = {lat: 52, lng: -.78};
const destination = {lat: 52, lng: -.774};
const destinationName = 'Warbler <img src=x onerror=alert(1)> & Wharf';
const destinationAddress = 'Frobisher Gate <script>alert(1)</script>, Milton Keynes';

function harness({end = destination, navigating = true} = {}) {
  const route = R.planRoute(network, R.buildGraph(network, 'cycle', 'maximum'), start, end,
    'cycle', destinationName);
  const state = {
    route, routeRevision: 7, arrivalSummary: null, start, end,
    endLabel: destinationName, endAddress: destinationAddress,
    stage: navigating ? 'navigation' : 'planner', navigating, watchId: navigating ? 19 : null,
    mode: 'cycle', themeChoice: 'light', headingSupported: false, importedRouteName: '', culturalRoute: null,
    lastSegment: 0, navProgressMeters: 0, offRouteCount: 0, lastRerouteAt: 0,
    followUser: false, announcedFar: new Set(), announcedNear: new Set()
  };
  const elements = {}, timers = [], speech = [], toasts = [], stages = [];
  const calls = {watch: 0, clearWatch: [], clearSpeech: 0, draw: 0};
  let locationResolve;
  function el(id) {
    if (!elements[id]) {
      const node = {hidden: true, textContent: '', dataset: {}, style: {}, classList: {toggle() {}},
        setAttribute() {}, focus() {}, querySelectorAll: () => []};
      Object.defineProperty(node, 'innerHTML', {set() { assert.fail(`Unsafe HTML write to #${id}`); }});
      elements[id] = node;
    }
    return elements[id];
  }
  const context = vm.createContext({...R, state, el, console,
    window: {innerWidth: 390},
    navigator: {geolocation: {
      watchPosition() { calls.watch++; return 19; },
      clearWatch(id) { calls.clearWatch.push(id); }
    }},
    document: {documentElement: {dataset: {theme: 'light'}}, querySelector: () => el('roadShareNote')},
    L: {latLng: (lat, lng) => ({lat, lng})},
    gpxLoadRevision: 0, searchRevision: 0, navigationStartRevision: navigating ? 3 : 4, navigationStartPending: false,
    CULTURAL_ROUTE_COLOURS: {blue: '#3c78d8'},
    cancelStartLocation() {}, finishSavedSearch() {}, updateInstallButtonVisibility() {}, syncViewport() {},
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {}, requestAnimationFrame() {},
    map: {hasLayer: () => true}, offlineVectorLayer: null, redwayLayer: {remove() {}, addTo() {}},
    userLayer: {clearLayers() {}}, applyTheme() {}, resetMapOrientation() {},
    setUserMarker() {}, redrawMarkers() {}, updatePlannerFields() {},
    resolveTravelHeading: () => 90, routeHeadingAt: () => 90,
    followNavigationView() {}, setTurnIcon() {}, announceManeuver() {},
    rerouteFromPosition() {}, clearSpeechQueue() { calls.clearSpeech++; },
    toast(message) { toasts.push(message); }, speak(message) { speech.push(message); },
    formatDuration: value => `${Math.round(value)} min`,
    formatDistance: value => `${Math.round(value)} m`, formatTurnDistance: value => `${Math.round(value)} m`,
    arrivalTime: () => '12:00', drawRoute() { calls.draw++; }, renderUnlitSegments() {},
    renderRouteMix() {}, renderRouteInsights() {}, setRouteStatus() {},
    routeReadyStatus: () => 'Route ready', setRouteSheetCollapsed() {}, offerInstallOnce() {},
    unlockSpeechFromGesture() {},
    acquireCurrentLocation() { return new Promise(resolve => { locationResolve = resolve; }); },
    invalidateRoute() { state.route = null; state.routeRevision++; }, async calculateRoute() {},
    showPlaceSheet() { context.setStage('place'); }
  });
  vm.runInContext(code('  function cancelNavigationStart()', '  function cancelStartLocation('), context);
  for (const name of ['setStage', 'clearArrivalSummary', 'showArrivalSummary', 'finishArrivalSummary',
    'renderApproachNote', 'renderCulturalLegend', 'installRoute', 'importedPlan', 'beginCulturalTrack', 'xy', 'nearestOnRoute',
    'activeManeuver', 'updateNavigation', 'resetNavigationProgress', 'startNavigation', 'stopNavigation']) {
    vm.runInContext(functionCode(name), context);
  }
  const actualSetStage = context.setStage;
  context.setStage = stage => { stages.push(stage); actualSetStage(stage); };
  return {state, context, route, el, calls, speech, toasts, stages,
    position(point = state.end, accuracy) {
      return {coords: {latitude: point.lat, longitude: point.lng, accuracy: arguments.length > 1 ? accuracy : 5}};
    },
    completed() {
      return {route: state.route, routeRevision: state.routeRevision,
        navigationRevision: context.navigationStartRevision - 1, name: state.endLabel, address: state.endAddress};
    },
    finishLocation(point = state.start, accuracy = 5) { locationResolve({latlng: point, accuracy}); },
    runTimers() {
      for (let count = 0; timers.length; count++) {
        assert.ok(count < 100, 'Unexpected repeating application timer');
        timers.shift()();
      }
    }
  };
}

function assertNoArrival(h) {
  assert.equal(h.el('arrivalSummary').hidden, true);
  assert.equal(h.state.arrivalSummary, null);
  assert.ok(!h.speech.some(message => /You have arrived/.test(message)));
}

test('an accurate nearby final fix leaves a persistent named arrival summary and the route intact', () => {
  const h = harness(), route = h.state.route, end = h.state.end;
  const position = h.position({lat: end.lat + .00004, lng: end.lng});
  assert.equal(R.hasArrived(position, end, 0), true, 'fixture must satisfy the real arrival guard');
  h.context.updateNavigation(position);
  assert.equal(h.state.navigating, false);
  assert.equal(h.state.stage, 'planner');
  assert.equal(h.state.watchId, null);
  assert.deepEqual(h.calls.clearWatch, [19]);
  assert.equal(h.state.route, route);
  assert.equal(h.state.end, end);
  assert.equal(h.el('arrivalSummary').hidden, false);
  assert.equal(h.state.arrivalSummary.route, route);
  assert.equal(h.state.arrivalSummary.routeRevision, 7);
  assert.equal(h.el('arrivalDestination').textContent, destinationName);
  assert.equal(h.el('arrivalDetail').textContent, destinationAddress);
  const completed = h.state.arrivalSummary;
  h.runTimers();
  h.context.updateNavigation(position);
  assert.equal(h.state.arrivalSummary, completed);
  assert.equal(h.el('arrivalSummary').hidden, false, 'arrival must remain visible until explicitly dismissed');
  assert.equal(h.speech.filter(message => /You have arrived/.test(message)).length, 1);
  assert.deepEqual(h.calls.clearWatch, [19]);
});

test('poor GPS at the endpoint cannot produce arrival', () => {
  for (const accuracy of [80, 150, NaN, undefined, -1]) {
    const h = harness();
    h.context.updateNavigation(h.position(h.state.end, accuracy));
    assertNoArrival(h);
    assert.equal(h.state.navigating, true);
    assert.equal(h.state.stage, 'navigation');
    assert.deepEqual(h.calls.clearWatch, []);
  }
});

test('reaching the mapped route end cannot confirm a destination beyond the mapped approach', () => {
  const h = harness({end: {lat: 52.0012, lng: -.774}});
  const [lat, lng] = h.route.coords.at(-1), position = h.position({lat, lng});
  assert.equal(R.hasArrived(position, h.state.end, 0), false);
  h.context.updateNavigation(position);
  assertNoArrival(h);
  assert.equal(h.state.navigating, true);
  assert.match(h.el('turnText').textContent, /Mapped route ends here/);
  assert.deepEqual(h.calls.clearWatch, []);
});

test('a distant imported track cannot acquire completed progress or arrival', () => {
  const h = harness();
  h.state.route = h.context.importedPlan([[52, -.78], [52, -.774]], 'Distant track');
  h.state.importedRouteName = 'Distant track';
  h.context.updateNavigation(h.position({lat: 52.002, lng: -.774}));
  assertNoArrival(h);
  assert.equal(h.state.navigating, true);
  assert.equal(h.state.navProgressMeters, 0);
  assert.equal(h.el('navEta').textContent, 'Join route');
  assert.match(h.el('turnText').textContent, /Join the imported route/);
  assert.deepEqual(h.calls.clearWatch, []);
});

test('Cultural joining arrival hands off to the official track before any final arrival summary', () => {
  const h = harness();
  const track = h.context.importedPlan([[52, -.774], [52.003, -.774], [52.003, -.771]], 'Blue Cultural Route');
  h.state.culturalRoute = {id: 'blue', phase: 'joining', title: 'Blue Cultural Route', color: 'Blue', trackPlan: track};
  h.state.importedRouteName = 'Blue Cultural Route';
  h.context.updateNavigation(h.position());
  assertNoArrival(h);
  assert.equal(h.state.culturalRoute.phase, 'track');
  assert.equal(h.state.route, track);
  assert.equal(h.state.navigating, true);
  assert.deepEqual(h.calls.clearWatch, []);
  assert.ok(h.speech.some(message => /Joined the Blue Cultural Route/.test(message)));
  h.context.updateNavigation(h.position({lat: 52.003, lng: -.774}));
  h.context.updateNavigation(h.position());
  assert.equal(h.state.navigating, false);
  assert.equal(h.el('arrivalSummary').hidden, false);
  assert.equal(h.el('arrivalDestination').textContent, 'Blue Cultural Route finish');
  assert.deepEqual(h.calls.clearWatch, [19]);
});

test('a later endpoint GPS callback cannot turn an ordinary Stop into arrival', () => {
  const h = harness();
  h.context.stopNavigation({keepRoute: true});
  h.context.updateNavigation(h.position());
  assertNoArrival(h);
  assert.equal(h.state.stage, 'planner');
  assert.equal(h.state.navigating, false);
  assert.equal(h.state.route, h.route);
});

test('stale completed snapshots cannot reveal arrival after route, revision, stage, or navigation changes', () => {
  const changes = [
    h => { h.state.route = {...h.state.route}; },
    h => { h.state.routeRevision++; },
    h => h.context.setStage('explore'),
    h => h.context.setStage('place'),
    h => h.context.setStage('navigation'),
    h => h.context.stopNavigation({keepRoute: true}),
    h => { h.state.navigating = true; }
  ];
  for (const change of changes) {
    const h = harness({navigating: false}), completed = h.completed();
    change(h);
    h.context.showArrivalSummary(completed);
    assertNoArrival(h);
  }
});

test('Back clears the visible arrival and an old snapshot cannot reopen it when the planner is revisited', () => {
  for (const stage of ['explore', 'place']) {
    const h = harness({navigating: false}), completed = h.completed();
    h.context.showArrivalSummary(completed);
    assert.equal(h.el('arrivalSummary').hidden, false);
    h.context.setStage(stage);
    assert.equal(h.el('arrivalSummary').hidden, true);
    assert.equal(h.state.arrivalSummary, null);
    h.context.setStage('planner');
    h.context.showArrivalSummary(completed);
    assertNoArrival(h);
  }
});

test('installing an alternative route clears arrival without needing an endpoint revision change', () => {
  const h = harness({navigating: false}), completed = h.completed();
  h.context.showArrivalSummary(completed);
  const replacement = R.planRoute(network, R.buildGraph(network, 'cycle', 'balanced'), start, destination,
    'cycle', destinationName);
  h.context.installRoute(replacement, {fit: false, collapse: false});
  assert.equal(h.state.routeRevision, completed.routeRevision);
  assert.equal(h.state.route, replacement);
  h.context.showArrivalSummary(completed);
  assertNoArrival(h);
});

test('a new Start clears the old arrival summary and prevents its snapshot from reappearing', async () => {
  const h = harness({navigating: false}), completed = h.completed();
  h.context.showArrivalSummary(completed);
  assert.equal(h.el('arrivalSummary').hidden, false);
  const pending = h.context.startNavigation();
  h.finishLocation();
  await pending;
  assert.equal(h.el('arrivalSummary').hidden, true);
  assert.equal(h.state.arrivalSummary, null);
  assert.equal(h.state.navigating, true);
  assert.equal(h.state.stage, 'navigation');
  h.context.showArrivalSummary(completed);
  assertNoArrival(h);
});

test('Done clears arrival and returns to explore while preserving the completed route and destination', () => {
  const h = harness({navigating: false}), route = h.state.route, end = h.state.end;
  h.context.showArrivalSummary(h.completed());
  h.context.finishArrivalSummary();
  assert.equal(h.state.arrivalSummary, null);
  assert.equal(h.el('arrivalSummary').hidden, true);
  assert.equal(h.state.stage, 'explore');
  assert.equal(h.el('app').dataset.stage, 'explore');
  assert.equal(h.el('routeSheet').hidden, true);
  assert.equal(h.state.route, route);
  assert.equal(h.state.end, end);
  assert.equal(h.state.endLabel, destinationName);
  assert.equal(h.state.endAddress, destinationAddress);
});

test('the compact mapped-gap cue accompanies the full approach note and clears for an ordinary route', () => {
  const h = harness({navigating: false});
  for (const [first, last] of [[51, 0], [0, 71], [51, 71]]) {
    h.state.route.snaps = {start: first, end: last};
    h.context.renderApproachNote();
    assert.equal(h.el('routeApproachSummary').hidden, false);
    assert.equal(h.el('approachNote').hidden, false);
    const compact = h.el('routeApproachSummary').textContent;
    const full = h.el('approachNote').textContent;
    if (first) { assert.match(compact, /first.*51 m/i); assert.match(full, /The first 51 m isn't a mapped path/); }
    if (last) { assert.match(compact, /final.*71 m/i); assert.match(full, /The last 71 m isn't a mapped path/); }
    assert.match(full, /Check that you can get through\./);
    assert.ok(compact.length < full.length, 'the collapsed cue must be shorter than the full explanation');
  }
  h.state.route.snaps = {start: 50, end: 50};
  h.context.renderApproachNote();
  assert.equal(h.el('routeApproachSummary').hidden, true);
  assert.equal(h.el('approachNote').hidden, true);
  h.state.route = null;
  h.context.renderApproachNote();
  assert.equal(h.el('routeApproachSummary').hidden, true);
  assert.equal(h.el('approachNote').hidden, true);
});
