const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');

function harness(stage = 'explore') {
  const elements = {}, messages = [], statuses = [], points = [];
  let calls = 0, failure = {code: 1}, resolve, reject;
  const el = id => elements[id] ??= {hidden: true, disabled: false, listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; }, focus() { this.focused = true; }};
  const state = {stage};
  const context = vm.createContext({state, el, startLocationRevision: 0,
    acquireCurrentLocation() { calls++; return Promise.reject(failure); },
    console: {error() {}},
    closeSearch() {}, setUserMarker() {}, maybeCalculateRoute() {}, map: {setView() {}},
    setPoint(...args) { points.push(args); },
    setRouteStatus(...args) { statuses.push(args); }, toast(message) { messages.push(message); }});
  const start = app.indexOf('  function locationFailureMessage(');
  const end = app.indexOf("  el('directionsBtn').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  return {context, state, el, points, messages, statuses, calls: () => calls,
    fail(error) { failure = error; },
    delay() { context.acquireCurrentLocation = () => { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); }; },
    resolve() { resolve({latlng: {lat: 52.04, lng: -.75}, accuracy: 5}); }, reject(error) { reject(error); }};
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
