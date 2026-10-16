const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../routing.js');
const app = fs.readFileSync('app.js', 'utf8');

function point(east = 0, north = 0) {
  return {lat: 52.04 + north / 111320, lng: -.75 + east / (111320 * Math.cos(52.04 * Math.PI / 180))};
}

function camera({mode = 'cycle', heading = null, lastHeadingFix = null, route = true} = {}) {
  const origin = point();
  const east = point(100);
  const state = {mode, heading, lastHeadingFix,
    route: route ? {coords: [[origin.lat, origin.lng], [east.lat, east.lng]]} : null};
  const context = vm.createContext({state,
    map: {distance: (a, b) => R.hav({lat: a.lat, lon: a.lng}, {lat: b.lat, lon: b.lng})},
    L: {latLng: (lat, lng) => ({lat, lng})}});
  const start = app.indexOf('  function normalizeHeading(');
  const end = app.indexOf('  function resetMapOrientation()', start);
  assert.ok(start >= 0 && end > start, 'Navigation heading helpers must be present');
  vm.runInContext(app.slice(start, end), context);
  return {state,
    fix(coords = {}, location = origin, snap = {segment: 0}) {
      return context.resolveTravelHeading({coords}, snap, location);
    }};
}

function near(actual, expected, message) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < .05,
    `${message || 'Heading'}: expected ${expected}, got ${actual}`);
}

test('a moving GPS fix with a missing heading follows the route instead of inventing north', () => {
  for (const heading of [null, undefined]) {
    const c = camera();
    near(c.fix({heading, speed: 2}), 90, `Missing heading ${heading}`);
  }
});

test('only actual finite numeric GPS headings in [0, 360) are accepted', () => {
  for (const heading of ['', '0', '180', false, true, NaN, Infinity, -Infinity, -1, 360, 720]) {
    const c = camera();
    near(c.fix({heading, speed: 2}), 90, `Invalid heading ${String(heading)}`);
  }
  for (const heading of [0, .25, 180, 359.75]) {
    const c = camera();
    near(c.fix({heading, speed: 2}), heading, `Valid heading ${heading}`);
  }
});

test('genuine north remains valid when the GPS confirms movement', () => {
  const c = camera();
  near(c.fix({heading: 0, speed: .45}), 0);
  near(c.state.heading, 0);
});

test('a GPS course without a valid measured speed uses the route fallback', () => {
  for (const speed of [null, undefined, '', '2', false, true, NaN, Infinity, -Infinity, -1]) {
    const c = camera();
    near(c.fix({heading: 180, speed}), 90, `Invalid or missing speed ${String(speed)}`);
  }
});

test('stationary and slow GPS courses use the existing route fallback', () => {
  for (const speed of [0, .1, .449]) {
    const c = camera();
    near(c.fix({heading: 180, speed}), 90, `Low speed ${speed}`);
  }
  const c = camera();
  near(c.fix({heading: 180, speed: .45}), 180, 'Accepted movement threshold');
});

test('measurable movement supplies the camera heading before the route fallback', () => {
  for (const heading of [null, undefined, '0', 360]) {
    const c = camera({lastHeadingFix: point()});
    near(c.fix({heading, speed: 2}, point(0, 10)), 0, `Movement with heading ${String(heading)}`);
  }
  const c = camera({lastHeadingFix: point()});
  near(c.fix({heading: 270, speed: null}, point(0, 10)), 0, 'Movement with unavailable speed');
});

test('walking and cycling retain their existing movement distance thresholds', () => {
  const walking = camera({mode: 'walk', lastHeadingFix: point()});
  near(walking.fix({heading: null, speed: null}, point(0, 4)), 0, 'Four metres walking');
  const cycling = camera({lastHeadingFix: point()});
  near(cycling.fix({heading: null, speed: null}, point(0, 4)), 90, 'Four metres cycling');
  const cyclingMoving = camera({lastHeadingFix: point()});
  near(cyclingMoving.fix({heading: null, speed: null}, point(0, 6)), 0, 'Six metres cycling');
});

test('a valid GPS course takes priority over both measured displacement and the planned route', () => {
  const c = camera({lastHeadingFix: point()});
  near(c.fix({heading: 270, speed: 2}, point(0, 10)), 270);
});

test('small or absent movement retains route-based camera guidance', () => {
  for (const location of [point(), point(0, 1)]) {
    const c = camera({lastHeadingFix: point()});
    near(c.fix({heading: null, speed: 2}, location), 90);
  }
});

test('missing GPS course and route keep the last camera heading without inventing one', () => {
  const prior = camera({heading: 270, route: false});
  near(prior.fix({heading: null, speed: 2}), 270);
  near(prior.state.heading, 270);
  const fresh = camera({route: false});
  assert.equal(fresh.fix({heading: null, speed: 2}), null);
  assert.equal(fresh.state.heading, null);
  const noSnap = camera();
  assert.equal(noSnap.fix({heading: null, speed: 2}, point(), null), null);
});

test('camera smoothing still takes the short turn across north for both travel modes', () => {
  for (const [mode, expected] of [['cycle', 358.4], ['walk', 356.4]]) {
    const c = camera({mode, heading: 350});
    near(c.fix({heading: 10, speed: 2}), expected, mode);
    near(c.state.heading, expected, mode);
  }
});
