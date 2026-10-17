const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../routing.js');
const navigationIcons = require('../navigation-icons.js');
const app = fs.readFileSync('app.js', 'utf8');

function code(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing application function: ${from}`);
  return app.slice(start, end);
}

function harness({stored = null, readFailure = false, writeFailure = false} = {}) {
  const elements = {}, buttons = [], events = new Map(), documentEvents = new Map();
  const calls = {reads: 0, writes: [], location: 0, watches: 0, cameraHeading: []};
  let bearing = 0;
  for (const choice of navigationIcons.choices) {
    const preview = {innerHTML: ''};
    buttons.push({dataset: {navigationIconChoice: choice.id}, attributes: {}, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      querySelector(selector) { assert.equal(selector, '.navigation-icon-preview'); return preview; },
      addEventListener(type, callback) { this.listeners[type] = callback; }, preview});
  }
  const userLayer = {layers: new Set(), clearLayers() { this.layers.clear(); }, hasLayer(marker) { return this.layers.has(marker); }};
  const map = {
    getBearing: () => bearing,
    setBearing(value) { bearing = value; for (const callback of events.get('rotate') || []) callback(); },
    setHeading(value) { calls.cameraHeading.push(value); },
    stopHeadingUp() {},
    on(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); },
    distance(a, b) { return R.hav({lat: a.lat, lon: a.lng}, {lat: b.lat, lon: b.lng}); }
  };
  const context = vm.createContext({navigationIcons, map, userLayer, SETTINGS_KEY: 'mk-redway-settings-v1',
    localStorage: {
      getItem(key) { assert.equal(key, 'mk-redway-settings-v1'); calls.reads++; if (readFailure) throw new Error('Storage unavailable'); return stored; },
      setItem(key, value) { assert.equal(key, 'mk-redway-settings-v1'); if (writeFailure) throw new Error('Storage unavailable'); calls.writes.push(JSON.parse(value)); stored = value; }
    },
    navigator: {geolocation: {getCurrentPosition() { calls.location++; }, watchPosition() { calls.watches++; }}},
    document: {
      hidden: false, visibilityState: 'visible',
      querySelectorAll(selector) { assert.equal(selector, '[data-navigation-icon-choice]'); return buttons; },
      addEventListener(type, callback) {
        if (!documentEvents.has(type)) documentEvents.set(type, []);
        documentEvents.get(type).push(callback);
      }
    },
    el: id => elements[id] ??= {textContent: ''},
    L: {
      divIcon: options => options,
      marker(latlng, options) {
        const artwork = options.icon.html.includes('user-location-artwork') ? {style: {}, dataset: {}} : null;
        const outer = {style: {transform: 'translate3d(100px,200px,0)'},
          querySelector(selector) { assert.equal(selector, '.user-location-artwork'); return artwork; }};
        return {latlng, options, artwork, getElement: () => outer,
          addTo(layer) { layer.layers.add(this); return this; }};
      }
    }
  });
  vm.runInContext(code('  const state = {', '  function syncViewport(') + '\nglobalThis.state = state;', context);
  for (const [from, to] of [
    ['  function loadSettings()', '  function syncVoiceControls()'],
    ['  function normalizeHeading(', '  function smoothHeading('],
    ['  function resetMapOrientation()', '  function navigationTargetPoint()'],
    ['  function setUserMarker(', '  function turnIconSvg(']
  ]) vm.runInContext(code(from, to), context);
  const rotationRegistration = app.match(/  map\.on\('rotate', syncUserIconRotation\);/);
  assert.ok(rotationRegistration, 'Location artwork must follow actual map rotation events');
  vm.runInContext(code("  map.on('rotate', syncUserIconRotation);", '  const sharedRouteRestored ='), context);
  return {context, state: context.state, map, userLayer, calls, buttons, elements,
    select(id) { buttons.find(button => button.dataset.navigationIconChoice === id).listeners.click(); },
    visibility(hidden) {
      context.document.hidden = hidden;
      context.document.visibilityState = hidden ? 'hidden' : 'visible';
      for (const callback of documentEvents.get('visibilitychange') || []) callback();
    },
    fix(point, coords = {}) {
      context.updateUserIconHeading({coords: {accuracy: 5, heading: null, speed: null, ...coords}}, point);
    }};
}

function point(east = 0, north = 0) {
  return {lat: 52.04 + north / 111320, lng: -.75 + east / (111320 * Math.cos(52.04 * Math.PI / 180))};
}

function near(actual, expected, tolerance = .05) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('the icon module exposes four immutable choices and never renders untrusted settings', () => {
  assert.deepEqual(navigationIcons.choices.map(choice => choice.id), ['dot', 'arrow', 'cyclist', 'cow']);
  assert.ok(Object.isFrozen(navigationIcons));
  assert.ok(Object.isFrozen(navigationIcons.choices));
  for (const choice of navigationIcons.choices) {
    assert.ok(Object.isFrozen(choice));
    assert.equal(navigationIcons.normalise(choice.id), choice.id);
    assert.match(navigationIcons.svg(choice.id), /^<svg\s/);
    assert.match(navigationIcons.svg(choice.id), /aria-hidden="true"/);
    assert.match(navigationIcons.svg(choice.id), /focusable="false"/);
  }
  const unsafe = [undefined, null, false, 0, 1, [], {}, 'ARROW', 'constructor', '__proto__',
    '<img src=x onerror=alert(1)>', 'https://example.invalid/icon.svg',
    {toString() { throw new Error('Settings must not execute user coercion'); }}];
  for (const value of unsafe) {
    assert.equal(navigationIcons.normalise(value), 'dot');
    assert.equal(navigationIcons.svg(value), navigationIcons.svg('dot'));
  }
});

test('fresh and legacy settings retain the red dot and all existing preferences', () => {
  const fresh = harness();
  assert.equal(fresh.state.navigationIcon, 'dot');
  fresh.context.loadSettings();
  assert.equal(fresh.state.navigationIcon, 'dot');
  const legacy = harness({stored: JSON.stringify({voiceEnabled: false, units: 'imperial', themeChoice: 'dark', preferLit: true, preferSuper: true})});
  legacy.context.loadSettings();
  assert.equal(legacy.state.navigationIcon, 'dot');
  assert.equal(legacy.state.voiceEnabled, false);
  assert.equal(legacy.state.units, 'imperial');
  assert.equal(legacy.state.themeChoice, 'dark');
  assert.equal(legacy.state.preferLit, true);
  assert.equal(legacy.state.preferSuper, true);
  assert.equal(legacy.calls.location + legacy.calls.watches, 0);
});

test('malformed, blocked and unrecognised saved settings fail safely to the default', () => {
  for (const stored of ['{broken', 'null', 'false', '42', '[]', '"arrow"',
    ...[null, [], {}, 'unknown', 'ARROW', '<svg onload=alert(1)>'].map(navigationIcon => JSON.stringify({navigationIcon}))]) {
    const h = harness({stored});
    assert.doesNotThrow(() => h.context.loadSettings());
    h.context.syncNavigationIconControls();
    assert.equal(h.state.navigationIcon, 'dot');
    assert.equal(h.buttons.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
    assert.equal(h.buttons[0].attributes['aria-pressed'], 'true');
  }
  const blocked = harness({readFailure: true});
  assert.doesNotThrow(() => blocked.context.loadSettings());
  assert.equal(blocked.state.navigationIcon, 'dot');
});

test('each choice restores, updates accessible selection and persists alongside other settings without asking for GPS', () => {
  for (const choice of navigationIcons.choices) {
    const h = harness({stored: JSON.stringify({navigationIcon: choice.id, voiceEnabled: false, units: 'imperial', themeChoice: 'high-contrast', preferLit: true, preferSuper: true})});
    h.context.loadSettings();
    h.context.syncNavigationIconControls();
    assert.equal(h.state.navigationIcon, choice.id);
    assert.match(h.elements.navigationIconStatus.textContent, new RegExp(choice.label));
    for (const button of h.buttons) {
      assert.equal(button.attributes['aria-pressed'], String(button.dataset.navigationIconChoice === choice.id));
      assert.equal(button.preview.innerHTML, navigationIcons.svg(button.dataset.navigationIconChoice));
    }
    h.select(choice.id);
    assert.deepEqual(h.calls.writes.at(-1), {voiceEnabled: false, units: 'imperial', themeChoice: 'high-contrast', preferLit: true, preferSuper: true, navigationIcon: choice.id});
    assert.match(h.elements.navigationIconStatus.textContent, /Saved on this device/);
    assert.equal(h.calls.location + h.calls.watches, 0);
  }
});

test('a failed settings write keeps the current visit usable and reports the unsaved choice honestly', () => {
  const h = harness({writeFailure: true});
  h.select('cow');
  assert.equal(h.state.navigationIcon, 'cow');
  assert.equal(h.buttons[3].attributes['aria-pressed'], 'true');
  assert.match(h.elements.navigationIconStatus.textContent, /Concrete Cow selected for this visit/);
  assert.match(h.elements.navigationIconStatus.textContent, /could not save/);
  assert.doesNotMatch(h.elements.navigationIconStatus.textContent, /Saved on this device/);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.location + h.calls.watches, 0);
});

test('unknown icon setters neither alter selection nor persist unsafe values', () => {
  const h = harness();
  h.select('cyclist');
  const writes = h.calls.writes.length;
  for (const invalid of ['<svg onload=alert(1)>', 'constructor', 'ARROW', null, undefined, {}]) h.context.setNavigationIcon(invalid);
  assert.equal(h.state.navigationIcon, 'cyclist');
  assert.equal(h.calls.writes.length, writes);
});

test('changing the visible marker keeps its coordinates centred and excludes it from keyboard and pointer interaction', () => {
  const h = harness();
  const location = point(20, 30);
  h.state.userLatLng = location;
  h.context.setUserMarker(location);
  for (const choice of navigationIcons.choices) {
    const old = h.state.userMarker;
    h.select(choice.id);
    const marker = h.state.userMarker;
    assert.notEqual(marker, old);
    assert.equal(h.userLayer.layers.size, 1);
    assert.equal(h.userLayer.hasLayer(old), false);
    assert.equal(h.userLayer.hasLayer(marker), true);
    assert.deepEqual(marker.latlng, location);
    assert.equal(marker.options.interactive, false);
    assert.equal(marker.options.keyboard, false);
    const size = plain(marker.options.icon.iconSize), anchor = plain(marker.options.icon.iconAnchor);
    assert.equal(size[0], size[1]);
    assert.ok(size[0] >= 18 && size[0] <= 48, 'Location symbol must stay visible without obscuring a large map area');
    assert.deepEqual(anchor, size.map(value => value / 2));
    assert.match(marker.options.icon.html, new RegExp(`data-navigation-icon="${choice.id}"`));
  }
  assert.equal(h.calls.location + h.calls.watches, 0);
});

test('changing icon does not resurrect a marker already cleared with its map layer', () => {
  const h = harness();
  h.state.userLatLng = point();
  h.context.setUserMarker(h.state.userLatLng);
  const old = h.state.userMarker;
  h.userLayer.clearLayers();
  h.select('arrow');
  assert.equal(h.state.navigationIcon, 'arrow');
  assert.equal(h.state.userMarker, old);
  assert.equal(h.userLayer.layers.size, 0);
});

test('reported north is valid, but missing, out-of-range and coerced headings do not invent a course', () => {
  const north = harness();
  north.fix(point(), {heading: 0, speed: 2});
  assert.equal(north.state.markerHeading, 0);
  for (const heading of [null, undefined, NaN, Infinity, -1, 360, '0']) {
    const h = harness();
    h.state.markerHeading = 237;
    h.fix(point(), {heading, speed: 2});
    assert.equal(h.state.markerHeading, 237);
  }
});

test('a reported course with missing or invalid speed needs measured movement before changing the arrow', () => {
  for (const speed of [null, undefined, NaN, Infinity, -1, '2']) {
    const h = harness();
    h.state.markerHeading = 237;
    h.fix(point(), {heading: 0, speed});
    assert.equal(h.state.markerHeading, 237);
    h.fix(point(12), {heading: 0, speed});
    assert.ok(h.state.markerHeading > 170 && h.state.markerHeading < 180, 'Reliable eastward displacement should take precedence over unconfirmed north');
  }
});

test('stationary reports hold the course and move the displacement anchor instead of manufacturing a turn', () => {
  const h = harness();
  h.state.markerHeading = 180;
  h.fix(point(), {heading: 180, speed: 0});
  h.fix(point(100), {heading: 0, speed: .44});
  assert.equal(h.state.markerHeading, 180);
  h.fix(point(105));
  assert.equal(h.state.markerHeading, 180);
  h.fix(point(112));
  near(h.state.markerHeading, 142.2);
});

test('position-derived course waits for movement beyond GPS uncertainty and accumulates small steps', () => {
  const h = harness();
  h.fix(point());
  assert.equal(h.state.markerHeading, null);
  for (const east of [1, 3, 5, 9]) {
    h.fix(point(east));
    assert.equal(h.state.markerHeading, null);
    near(h.state.markerHeadingFix.lng, point().lng, 1e-10);
  }
  h.fix(point(12));
  near(h.state.markerHeading, 90);
  near(h.state.markerHeadingFix.lng, point(12).lng, 1e-10);
});

test('the minimum displacement threshold respects walking and cycling speeds even with very accurate fixes', () => {
  for (const [mode, accepted] of [['walk', true], ['cycle', false]]) {
    const h = harness();
    h.state.mode = mode;
    h.fix(point(), {accuracy: .1});
    h.fix(point(4), {accuracy: .1});
    assert.equal(Number.isFinite(h.state.markerHeading), accepted);
    h.fix(point(6), {accuracy: .1});
    assert.ok(Number.isFinite(h.state.markerHeading));
  }
});

test('poor GPS retains direction, clears the old movement anchor and requires fresh reliable displacement after recovery', () => {
  for (const accuracy of [null, undefined, NaN, Infinity, -1, 35.01, '5']) {
    const h = harness();
    h.fix(point(), {heading: 180, speed: 2});
    h.fix(point(30), {accuracy, heading: 0, speed: 2});
    assert.equal(h.state.markerHeading, 180);
    assert.equal(h.state.markerHeadingFix, null);
    h.fix(point(100));
    assert.equal(h.state.markerHeading, 180);
    h.fix(point(112));
    near(h.state.markerHeading, 142.2);
  }
  const boundary = harness();
  boundary.fix(point(), {accuracy: 35, heading: 90, speed: 2});
  assert.equal(boundary.state.markerHeading, 90);
});

test('course smoothing crosses north by the shortest angular path', () => {
  for (const mode of ['cycle', 'walk']) {
    const h = harness();
    h.state.mode = mode;
    h.fix(point(), {heading: 359, speed: 2});
    h.fix(point(), {heading: 1, speed: 2});
    const northError = Math.min(h.state.markerHeading, 360 - h.state.markerHeading);
    assert.ok(northError < 1, `Smoothing ${mode} course should stay near north, got ${h.state.markerHeading}`);
  }
});

test('arrow rotation combines measured course with real map bearing while leaving Leaflet positioning intact', () => {
  const h = harness();
  h.state.navigationIcon = 'arrow';
  h.context.setUserMarker(point(), {coords: {accuracy: 5, heading: 90, speed: 2}});
  const marker = h.state.userMarker;
  assert.equal(marker.artwork.style.transform, 'rotate(90deg)');
  assert.equal(marker.artwork.dataset.headingKnown, 'true');
  h.map.setBearing(270);
  assert.equal(marker.artwork.style.transform, 'rotate(0deg)');
  h.map.setBearing(315);
  assert.equal(marker.artwork.style.transform, 'rotate(45deg)');
  h.state.followUser = false;
  h.map.setBearing(180);
  assert.equal(marker.artwork.style.transform, 'rotate(270deg)');
  assert.equal(marker.getElement().style.transform, 'translate3d(100px,200px,0)');
  h.map.setBearing(0);
  assert.equal(marker.artwork.style.transform, 'rotate(90deg)');
});

test('unknown course and illustrated cyclist/cow remain upright on a rotated map', () => {
  const h = harness();
  h.map.setBearing(270);
  for (const selected of ['arrow', 'cyclist', 'cow']) {
    h.state.navigationIcon = selected;
    h.state.markerHeading = selected === 'arrow' ? null : 90;
    h.context.setUserMarker(point());
    assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
    assert.equal(h.state.userMarker.artwork.dataset.headingKnown, 'false');
    h.map.setBearing(315);
    assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  }
  h.state.navigationIcon = 'dot';
  assert.doesNotThrow(() => h.context.setUserMarker(point()));
  assert.doesNotThrow(() => h.map.setBearing(15));
});

test('orientation reset clears course and movement history without retaining old map compensation', () => {
  const h = harness();
  h.state.navigationIcon = 'arrow';
  h.context.setUserMarker(point(), {coords: {accuracy: 5, heading: 90, speed: 2}});
  h.map.setBearing(270);
  h.context.resetMapOrientation();
  assert.equal(h.state.markerHeading, null);
  assert.equal(h.state.markerHeadingFix, null);
  assert.equal(h.map.getBearing(), 0);
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  assert.equal(h.state.userMarker.artwork.dataset.headingKnown, 'false');
  assert.deepEqual(h.calls.cameraHeading, [null]);
});

test('switching artwork and redrawing uncertain GPS positions retain the measured course without starting another location request', () => {
  const h = harness();
  h.state.navigationIcon = 'cow';
  h.state.userLatLng = point();
  h.context.setUserMarker(h.state.userLatLng, {coords: {accuracy: 5, heading: 90, speed: 2}});
  h.select('arrow');
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(90deg)');
  h.map.setBearing(270);
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  h.state.userLatLng = point(100);
  h.context.setUserMarker(h.state.userLatLng, {coords: {accuracy: 150, heading: 0, speed: 2}});
  assert.equal(h.state.navigationIcon, 'arrow');
  assert.equal(h.state.markerHeading, 90);
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  h.state.heading = 180; // A camera/route fallback must not become the measured course.
  h.context.setUserMarker(h.state.userLatLng, {coords: {accuracy: 5, heading: 180, speed: 0}});
  assert.equal(h.state.markerHeading, 90);
  h.select('cyclist');
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  h.select('arrow');
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(0deg)');
  assert.equal(h.calls.location + h.calls.watches, 0);
});

test('a north-up map without a rotation API still shows the measured arrow course', () => {
  const h = harness();
  h.map.getBearing = undefined;
  h.state.navigationIcon = 'arrow';
  assert.doesNotThrow(() => h.context.setUserMarker(point(), {coords: {accuracy: 5, heading: 90, speed: 2}}));
  assert.equal(h.state.userMarker.artwork.style.transform, 'rotate(90deg)');
  assert.equal(h.state.userMarker.artwork.dataset.headingKnown, 'true');
});

test('background and resume discard only the displacement anchor and require two fresh fixes before inferring a turn', () => {
  for (const hidden of [true, false]) {
    const h = harness();
    h.state.navigationIcon = 'arrow';
    h.state.navigating = true;
    h.state.watchId = 42;
    h.state.heading = 173;
    h.state.followUser = false;
    h.state.lastSegment = 8;
    h.state.navProgressMeters = 420;
    const route = h.state.route = {coords: [[52.04, -.75], [52.05, -.74]]};
    const cameraFix = h.state.lastHeadingFix = point(5);
    h.state.userLatLng = point();
    h.context.setUserMarker(h.state.userLatLng, {coords: {accuracy: 5, heading: 180, speed: 2}});
    h.map.setBearing(187);
    const marker = h.state.userMarker;
    assert.ok(h.state.markerHeadingFix);
    h.visibility(hidden);
    assert.equal(h.state.markerHeadingFix, null);
    assert.equal(h.state.markerHeading, 180);
    assert.equal(h.state.navigating, true);
    assert.equal(h.state.watchId, 42);
    assert.equal(h.state.heading, 173);
    assert.equal(h.state.lastHeadingFix, cameraFix);
    assert.equal(h.state.followUser, false);
    assert.equal(h.state.lastSegment, 8);
    assert.equal(h.state.navProgressMeters, 420);
    assert.equal(h.state.route, route);
    assert.equal(h.state.userMarker, marker);
    assert.equal(h.map.getBearing(), 187);
    assert.equal(marker.artwork.style.transform, 'rotate(7deg)');
    assert.equal(h.calls.location + h.calls.watches, 0);
    assert.deepEqual(h.calls.cameraHeading, []);
    // This large jump could span minutes in the background. It establishes a
    // fresh anchor instead of pretending its old-to-new chord is current travel.
    h.fix(point(100));
    assert.equal(h.state.markerHeading, 180);
    near(h.state.markerHeadingFix.lng, point(100).lng, 1e-10);
    h.fix(point(112));
    near(h.state.markerHeading, 142.2);
  }
});
