const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');

function harness(stage = 'explore') {
  const elements = {}, messages = [], statuses = [], points = [], markers = [], views = [], pendingLocations = [];
  let calls = 0, failure = {code: 1};
  const el = id => elements[id] ??= {hidden: true, disabled: false, listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; }, focus() { this.focused = true; }};
  const state = {stage};
  const context = vm.createContext({state, el, startLocationRevision: 0, searchRevision: 0,
    acquireCurrentLocation() { calls++; return Promise.reject(failure); },
    console: {error() {}},
    closeSearch() {}, setUserMarker(point) { markers.push(point); }, maybeCalculateRoute() {},
    map: {setView(...args) { views.push(args); }, getZoom: () => 12},
    setPoint(...args) { points.push(args); },
    setRouteStatus(...args) { statuses.push(args); }, toast(message) { messages.push(message); }});
  const start = app.indexOf('  function locationFailureMessage(');
  const end = app.indexOf("  el('directionsBtn').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  return {context, state, el, points, markers, views, messages, statuses, calls: () => calls,
    fail(error) { failure = error; },
    delay() { context.acquireCurrentLocation = () => { calls++; return new Promise((resolve, reject) => { pendingLocations.push({resolve, reject}); }); }; },
    resolve(index = pendingLocations.length - 1, point = {lat: 52.04, lng: -.75}) { pendingLocations[index].resolve({latlng: point, accuracy: 5}); },
    reject(error, index = pendingLocations.length - 1) { pendingLocations[index].reject(error); }};
}

test('denied, slow and unavailable location messages retain a manual starting-point fallback', async () => {
  for (const [code, reason] of [[1, /access is off/], [3, /taking a while/], [2, /couldn’t get/], [undefined, /couldn’t get/]]) {
    const h = harness('planner'); h.fail({code});
    await h.context.useCurrentLocation();
    const [message, kind] = h.statuses.at(-1);
    assert.match(message, reason);
    assert.match(message, /Search for a starting address or postcode instead/);
    assert.equal(kind, 'warn');
    assert.equal(h.calls(), 1, 'a failure must not cause another permission request');
    assert.equal(h.points.length, 0);
    assert.equal(h.el('useLocationBtn').disabled, false);
  }
});

test('browse-location failure offers search without re-requesting location or claiming permission denial on timeout', async () => {
  const h = harness(); h.fail({code: 3});
  await h.context.refreshBrowseLocation();
  assert.equal(h.el('browseLocationRecovery').hidden, false);
  assert.match(h.el('browseLocationMessage').textContent, /taking a while.*still search or choose a point/);
  assert.doesNotMatch(h.el('browseLocationMessage').textContent, /permission|access is off/);
  h.el('searchWithoutLocationBtn').listeners.click();
  assert.equal(h.el('homeSearch').focused, true);
  assert.equal(h.el('browseLocationRecovery').hidden, true);
  assert.equal(h.calls(), 1);
});

test('quiet first-load location failures and failures after entering navigation do not open recovery UI', async () => {
  const quiet = harness();
  await quiet.context.refreshBrowseLocation({quiet: true});
  assert.equal(quiet.el('browseLocationRecovery').hidden, true);
  assert.deepEqual(quiet.messages, []);
  const late = harness(); late.delay();
  const pending = late.context.refreshBrowseLocation();
  late.state.stage = 'navigation'; late.reject({code: 1}); await pending;
  assert.equal(late.el('browseLocationRecovery').hidden, true);
});

test('delayed planner location failures cannot overwrite a manually selected starting point or reopened search', async () => {
  const h = harness('planner'); h.delay();
  const pending = h.context.useCurrentLocation();
  h.context.startLocationRevision++;
  h.el('useLocationBtn').disabled = false;
  h.reject({code: 1}); await pending;
  assert.deepEqual(h.statuses, [['Getting your current location…']]);
  assert.deepEqual(h.messages, []);
  assert.equal(h.points.length, 0);
  assert.equal(h.el('useLocationBtn').disabled, false);
});

test('a delayed browse location success cannot pan or replace location after navigation, Back or a replacement search', async () => {
  for (const action of ['navigation', 'back', 'search']) {
    const h = harness(); h.delay();
    const pending = h.context.refreshBrowseLocation({center: true});
    const current = {lat: 52.05, lng: -.72}; h.state.userLatLng = current;
    if (action === 'navigation') { h.state.stage = 'navigation'; h.state.navigating = true; }
    if (action === 'back') { h.state.stage = 'place'; h.context.searchRevision++; h.state.stage = 'explore'; }
    h.context.searchRevision++;
    h.resolve();
    assert.equal(await pending, false);
    assert.equal(h.state.userLatLng, current, `${action}: stale browse GPS replaced the latest position`);
    assert.deepEqual(h.views, [], `${action}: stale browse GPS moved the map`);
    assert.deepEqual(h.markers, []);
    assert.equal(h.calls(), 1);
  }
});

test('new browse requests supersede older callbacks without stale messages or enabling their pending button', async () => {
  for (const outcome of ['success', 'failure']) {
    const h = harness(); h.delay();
    const first = h.context.refreshBrowseLocation();
    const second = h.context.refreshBrowseLocation();
    if (outcome === 'success') h.resolve(0);
    else h.reject({code: 1}, 0);
    assert.equal(await first, false);
    assert.equal(h.el('browseLocateBtn').disabled, true, 'an older callback must not enable a newer pending request');
    assert.deepEqual(h.views, []);
    assert.deepEqual(h.markers, []);
    assert.equal(h.el('browseLocationRecovery').hidden, true);
    const latest = {lat: 52.05, lng: -.72}; h.resolve(1, latest);
    assert.equal(await second, true);
    assert.equal(h.state.userLatLng, latest);
    assert.deepEqual(h.markers, [latest]);
    assert.equal(h.views.length, 1);
    assert.equal(h.el('browseLocateBtn').disabled, false);
    assert.equal(h.calls(), 2);
  }
});

test('current quiet granted-location initialization updates its marker without moving the map or opening recovery', async () => {
  const h = harness(); h.delay();
  const pending = h.context.refreshBrowseLocation({center: false, quiet: true});
  h.resolve();
  assert.equal(await pending, true);
  assert.deepEqual(h.state.userLatLng, {lat: 52.04, lng: -.75});
  assert.equal(h.markers.length, 1);
  assert.deepEqual(h.views, []);
  assert.equal(h.el('browseLocationRecovery').hidden, true);
  assert.equal(h.calls(), 1);
});
