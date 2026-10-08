const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const app = fs.readFileSync('app.js', 'utf8');

function code(from, to) {
  return app.slice(app.indexOf(from), app.indexOf(to));
}

function pinLookup() {
  let resolve;
  const state = {stage: 'explore', navigating: false};
  const elements = {};
  const context = vm.createContext({
    state,
    L: {latLng: (lat, lng) => ({lat, lng, distanceTo: () => 0})},
    el: id => elements[id] ??= {},
    fmtCoord: point => `${point.lat}, ${point.lng}`,
    setPoint(which, point, label, address) {
      state[which] = {...point, distanceTo: () => 0};
      state[`${which}Label`] = label;
      state.endAddress = address;
    },
    showPlaceSheet() { state.stage = 'place'; },
    showDestinationInContext() {},
    reverseGeocode: () => new Promise(r => { resolve = r; }),
    conciseResultName: result => result.name,
    resultSecondary: result => result.display_name
  });
  vm.runInContext(code('  async function dropDestinationPin(', '  let longPressTimer'), context);
  return {state, context, finish() { resolve({name: 'Willen Lake', display_name: 'Milton Keynes'}); }};
}

test('a delayed pin name cannot leave the planner or hide active navigation', async () => {
  for (const stage of ['planner', 'navigation', 'explore']) {
    const pin = pinLookup();
    const pending = pin.context.dropDestinationPin({lat: 52.05, lng: -.72});
    pin.state.stage = stage;
    pin.state.navigating = stage === 'navigation';
    pin.finish();
    await pending;
    assert.equal(pin.state.stage, stage);
    assert.equal(pin.state.navigating, stage === 'navigation');
    assert.equal(pin.state.endLabel, 'Dropped pin');
  }
});

test('a delayed pin name cannot overwrite a replacement destination at the same coordinates', async () => {
  const pin = pinLookup();
  const pending = pin.context.dropDestinationPin({lat: 52.05, lng: -.72});
  pin.state.end = {...pin.state.end};
  pin.state.endLabel = 'Chosen entrance';
  pin.finish();
  await pending;
  assert.equal(pin.state.endLabel, 'Chosen entrance');
});

test('the current pin still receives its reverse-geocoded name', async () => {
  const pin = pinLookup();
  const pending = pin.context.dropDestinationPin({lat: 52.05, lng: -.72});
  pin.finish();
  await pending;
  assert.equal(pin.state.stage, 'place');
  assert.equal(pin.state.endLabel, 'Willen Lake');
  assert.equal(pin.state.endAddress, 'Milton Keynes');
});

function navigation({distanceFromStart = 0, imported = false} = {}) {
  const plan = {initialInstruction: 'Follow the route', maneuvers: [], coords: [[52.04, -.75], [52.05, -.74]], mins: 5, dist: 1000, imported};
  const originalStart = {lat: 52.04, lng: -.75};
  const state = {
    route: plan, start: originalStart, routeRevision: 1, stage: 'planner', navigating: false,
    headingSupported: false, mode: 'cycle', importedRouteName: imported ? 'Imported track' : '',
    announcedFar: new Set(), announcedNear: new Set()
  };
  const elements = {};
  const calls = {location: 0, unlock: 0, watch: 0, replan: 0, messages: []};
  let resolve;
  const context = vm.createContext({
    state, navigator: {geolocation: {watchPosition() { calls.watch++; return calls.watch; }}},
    navigationStartRevision: 0, navigationStartPending: false,
    acquireCurrentLocation() { calls.location++; return new Promise(r => { resolve = r; }); },
    unlockSpeechFromGesture() { calls.unlock++; },
    toast(message) { calls.messages.push(message); },
    hav: () => distanceFromStart,
    invalidateRoute() { state.route = null; state.routeRevision++; },
    async calculateRoute() { calls.replan++; state.route = {...plan}; },
    el: id => elements[id] ??= {classList: {toggle() {}}},
    document: {documentElement: {dataset: {theme: 'light'}}, querySelector: () => ({}), querySelectorAll: () => []},
    window: {innerWidth: 390},
    map: {hasLayer: () => false},
    offlineVectorLayer: null,
    applyTheme() {},
    redrawMarkers() {},
    setStage(stage) {
      state.stage = stage;
      if (stage !== 'planner') {
        context.navigationStartRevision++;
        context.navigationStartPending = false;
      }
    },
    redwayLayer: {remove() {}},
    setUserMarker() {},
    nearestOnRoute: () => ({segment: 0, progress: 0, distance: 0}),
    routeHeadingAt: () => 90,
    L: {latLng: (lat, lng) => ({lat, lng})},
    requestAnimationFrame() {},
    followNavigationView() {},
    updateNavigation() {},
    setTurnIcon() {},
    formatDuration: () => '5 min',
    formatDistance: () => '1 km',
    arrivalTime: () => '12:00',
    speak() {},
    drawRoute() {},
    renderUnlitSegments() {},
    renderRouteMix() {},
    renderRouteInsights() {},
    renderApproachNote() {},
    setRouteStatus() {},
    routeReadyStatus: () => 'Route ready',
    setRouteSheetCollapsed() {},
    offerInstallOnce() {},
    importedPlan: coords => ({...plan, coords, mins: 10})
  });
  vm.runInContext(code('  function installRoute(', '  async function solveRouteOnNetwork('), context);
  vm.runInContext(code('  function setMode(mode)', "  el('cycleBtn').addEventListener"), context);
  vm.runInContext(code('  function resetNavigationProgress()', '  function stopNavigation('), context);
  return {
    state, context, calls, plan, originalStart,
    finish(accuracy) { resolve({latlng: {lat: 52.05, lng: -.74}, accuracy: arguments.length ? accuracy : 5}); }
  };
}

test('Start preserves the planned route and start while the initial GPS fix is inaccurate', async () => {
  for (const accuracy of [1500, NaN, undefined, -1]) {
    const nav = navigation({distanceFromStart: 7000});
    const pending = nav.context.startNavigation();
    assert.equal(nav.calls.unlock, 1, 'speech must unlock during the original gesture');
    nav.finish(accuracy);
    await pending;
    assert.equal(nav.state.start, nav.originalStart);
    assert.equal(nav.state.route, nav.plan);
    assert.equal(nav.state.navigating, false);
    assert.equal(nav.calls.replan, 0);
    assert.equal(nav.calls.watch, 0);
    assert.equal(nav.context.navigationStartPending, false);
    assert.match(nav.calls.messages.at(-1), /accurate location/);
  }
});

test('Start can be retried with an accurate fix and can still replan from that fix', async () => {
  const nav = navigation({distanceFromStart: 70});
  const first = nav.context.startNavigation();
  nav.finish(250);
  await first;
  const second = nav.context.startNavigation();
  nav.finish(5);
  await second;
  assert.equal(nav.calls.location, 2);
  assert.equal(nav.calls.replan, 1);
  assert.equal(nav.calls.watch, 1);
  assert.equal(nav.state.navigating, true);
  assert.equal(nav.state.stage, 'navigation');
  assert.equal(nav.state.start.lat, 52.05);
});

test('selecting another installed route while Start waits for GPS cancels the pending Start', async () => {
  const nav = navigation();
  const pending = nav.context.startNavigation();
  nav.context.installRoute({...nav.plan, initialInstruction: 'Take the alternative'});
  assert.equal(nav.state.routeRevision, 1, 'installing an alternative does not invalidate endpoint revisions');
  nav.finish();
  await pending;
  assert.equal(nav.state.navigating, false);
  assert.equal(nav.calls.watch, 0);
  assert.equal(nav.context.navigationStartPending, false);
});

test('changing an imported route to walking while Start waits for GPS cancels the pending Start', async () => {
  const nav = navigation({imported: true});
  const pending = nav.context.startNavigation();
  nav.context.setMode('walk');
  assert.equal(nav.state.mode, 'walk');
  assert.equal(nav.state.routeRevision, 1);
  nav.finish();
  await pending;
  assert.equal(nav.state.navigating, false);
  assert.equal(nav.calls.watch, 0);
});
