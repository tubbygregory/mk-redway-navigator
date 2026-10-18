const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('about.js', 'utf8');
const start = source.indexOf('  function setupSettingsAdvertisement()');
const end = source.indexOf('\n  }', start);
assert.ok(start >= 0 && end > start, 'Settings advertising initializer is missing');

function harness({loaded = true, online = true, hidden = false, supported = true, throws = false} = {}) {
  const events = {}, requests = [], observers = [];
  const bounds = {top: 450, bottom: 550, width: 280, height: 100};
  const sheet = {hidden: false, collapsed: false,
    classList: {contains: () => sheet.collapsed},
    getBoundingClientRect: () => ({top: 20, bottom: 580}),
    querySelector: () => ({getBoundingClientRect: () => ({bottom: 118})}),
    addEventListener: (name, callback) => { events['sheet:' + name] = callback; }};
  const unit = {getBoundingClientRect: () => bounds};
  const document = {readyState: loaded ? 'complete' : 'interactive', hidden,
    getElementById: id => id === 'settingsSheet' ? sheet : unit,
    addEventListener: (name, callback) => { events[name] = callback; }};
  class Observer {
    constructor(callback, options) { this.callback = callback; observers.push(this); assert.equal(options.root, sheet); }
    observe(target) { assert.equal(target, unit); }
    disconnect() { this.disconnected = true; }
  }
  const window = {innerHeight: 844,
    addEventListener: (name, callback) => { events[name] = callback; },
    adsbygoogle: {push() {
      requests.push({width: bounds.width, hidden: sheet.hidden});
      if (throws) throw new Error('Optional provider unavailable');
    }}};
  if (supported) window.IntersectionObserver = Observer;
  const navigator = {onLine: online};
  const context = vm.createContext({document, window, navigator, IntersectionObserver: Observer});
  vm.runInContext(source.slice(start, end + 4), context);
  context.setupSettingsAdvertisement();
  return {sheet, bounds, document, navigator, window, requests, observers,
    intersect() { observers[0].callback([]); },
    fire(name) { events[name](); }};
}

test('delayed bootstrap cannot dispatch a formerly visible slot after Settings closes', () => {
  const h = harness({loaded: false});
  h.intersect();
  assert.equal(h.requests.length, 0);
  h.sheet.hidden = true;
  h.fire('load');
  assert.equal(h.requests.length, 0);
  h.sheet.hidden = false;
  h.intersect();
  assert.deepEqual(h.requests, [{width: 280, hidden: false}]);
});

test('below-fold, zero-width and header-obscured slots wait until visible', () => {
  const h = harness();
  h.bounds.top = 600; h.bounds.bottom = 700;
  h.intersect();
  h.bounds.top = 450; h.bounds.bottom = 550; h.bounds.width = 0;
  h.intersect();
  h.bounds.width = 280; h.bounds.top = 20; h.bounds.bottom = 100;
  h.fire('sheet:scroll');
  assert.equal(h.requests.length, 0);
  h.bounds.top = 450; h.bounds.bottom = 550;
  h.fire('sheet:scroll');
  assert.equal(h.requests.length, 1);
});

test('collapsed Settings waits for expansion and never refreshes on subsequent visits', () => {
  const h = harness();
  h.sheet.collapsed = true; h.intersect();
  assert.equal(h.requests.length, 0);
  h.sheet.collapsed = false; h.intersect();
  for (let visit = 0; visit < 4; visit++) {
    h.sheet.hidden = true; h.fire('sheet:scroll');
    h.sheet.hidden = false; h.intersect();
    h.fire('online'); h.fire('visibilitychange'); h.fire('load');
  }
  assert.equal(h.requests.length, 1);
  assert.equal(h.observers[0].disconnected, true);
});

test('offline and background events request only after a visible foreground recovery', () => {
  const h = harness({online: false});
  h.intersect();
  h.navigator.onLine = true; h.document.hidden = true; h.fire('online');
  h.document.hidden = false; h.sheet.hidden = true; h.fire('visibilitychange');
  assert.equal(h.requests.length, 0);
  h.sheet.hidden = false; h.intersect();
  assert.equal(h.requests.length, 1);
});

test('provider errors are contained and do not cause repeated ad requests', () => {
  const h = harness({throws: true});
  assert.doesNotThrow(() => h.intersect());
  h.fire('online'); h.fire('sheet:scroll'); h.intersect();
  assert.equal(h.requests.length, 1);
});

test('a failed bootstrap leaves one harmless queue entry without blocking Settings', () => {
  const h = harness();
  delete h.window.adsbygoogle;
  assert.doesNotThrow(() => h.intersect());
  assert.equal(h.window.adsbygoogle.length, 1);
  h.intersect();
  assert.equal(h.window.adsbygoogle.length, 1);
});

test('browsers without the optional intersection API keep Settings usable', () => {
  const h = harness({supported: false});
  assert.equal(h.observers.length, 0);
  assert.equal(h.requests.length, 0);
});
