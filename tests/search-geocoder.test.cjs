const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {hav} = require('../routing.js');
const app = fs.readFileSync('app.js', 'utf8');
const MK = {south: 51.955, west: -.905, north: 52.155, east: -.615};

function code(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing application function: ${from}`);
  return app.slice(start, end);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function place(name = 'Mapped MK place') {
  return {name, lat: '52.0478907', lon: '-0.7333684', display_name: name + ', Milton Keynes'};
}
function response(body, status = 200) {
  return {ok: status >= 200 && status < 300, status, json: async () => body};
}
function harness(options = {}) {
  let clock = 5000, timerId = 0;
  const requests = [], waits = [], timers = new Map();
  const state = {lastGeocodeAt: options.lastGeocodeAt ?? 0, userLatLng: null, start: null};
  const context = vm.createContext({
    MK, state, hav, URLSearchParams, AbortController,
    NOMINATIM: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_REVERSE: 'https://nominatim.openstreetmap.org/reverse',
    Date: {now: () => clock},
    sleep(ms) {
      waits.push(ms);
      // Yield before advancing simulated time so the previous fetch starts
      // before the next queued geocoder slot, just as in the browser.
      return options.sleep ? Promise.resolve(options.sleep(ms)).then(() => { clock += ms; })
        : new Promise(resolve => setImmediate(() => { clock += ms; resolve(); }));
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init) {
      const request = {url: new URL(url), init, at: clock};
      requests.push(request);
      return options.fetch ? options.fetch(request, requests.length)
        : Promise.resolve(response(request.url.pathname.endsWith('/reverse') ? place() : [place()]));
    }
  });
  vm.runInContext(code('  function searchText(', '  function buildLocalSearchIndex('), context);
  // Include normalization beside the request gate without evaluating map/UI setup.
  const normalizer = app.indexOf('  function normalizeSearchQuery(');
  const gate = app.indexOf('  let geocodeGate =');
  const from = normalizer >= 0 && normalizer < gate ? '  function normalizeSearchQuery(' : '  let geocodeGate =';
  vm.runInContext(code(from, '  function showResults('), context);
  vm.runInContext(code('  async function reverseGeocode(', '  async function dropDestinationPin('), context);
  return {context, state, requests, waits, timers, clock: () => clock};
}
function assertMkRequest(request) {
  assert.equal(request.url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(request.url.pathname, '/search');
  assert.equal(request.url.searchParams.get('bounded'), '1');
  assert.equal(request.url.searchParams.get('viewbox'), '-0.905,52.155,-0.615,51.955');
  assert.equal(request.url.searchParams.get('countrycodes'), 'gb');
  assert.equal(request.url.searchParams.get('format'), 'jsonv2');
  assert.equal(request.url.searchParams.get('addressdetails'), '1');
  assert.equal(request.init.headers.Accept, 'application/json');
  assert.ok(request.init.signal instanceof AbortSignal);
}
async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('submitted names and full postcodes are normalized in a single MK-bounded request', async () => {
  for (const [input, expected] of [
    ['  Warbler   On\tThe Wharf  ', 'Warbler On The Wharf'],
    ['Bannatyne’s   Health Club', "Bannatyne's Health Club"],
    ['mk93fz', 'MK9 3FZ'], ['mk9 3fz', 'MK9 3FZ'], ['  MK9  3FZ ', 'MK9 3FZ'],
    ['25 Huntley Crescent mk93fz', '25 Huntley Crescent MK9 3FZ']
  ]) {
    const h = harness();
    const results = await h.context.geocode(input);
    assert.equal(results.length, 1);
    assert.equal(h.requests.length, 1, input);
    assertMkRequest(h.requests[0]);
    assert.equal(h.requests[0].url.searchParams.get('q'), expected, input);
    assert.equal(h.timers.size, 0, 'completed request clears its timeout');
  }
});

test('blank searches and supported coordinates never contact the public provider', async () => {
  const h = harness();
  for (const query of ['', ' \t ', '52.0478907, -0.7333684', '51.955,-0.905', '52.155,-0.615']) {
    const results = await h.context.geocode(query);
    assert.equal(results.length, query.trim() ? 1 : 0, query);
    if (results.length) {
      assert.equal(results[0].name, 'Map coordinates');
      assert.ok(h.context.validateSearchResult(results[0]));
    }
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.waits.length, 0);
  assert.equal(h.state.lastGeocodeAt, 0);
});

test('coordinates outside supported MK coverage do not become nationwide address searches', async () => {
  const h = harness();
  for (const query of ['55.95,-3.19', '51.954,-0.7', '52.156,-0.7', '52,-0.906', '52,-0.614', '999,-0.7']) {
    assert.equal((await h.context.geocode(query)).length, 0, query);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.lastGeocodeAt, 0);
});

test('successful provider results retain order while malformed and outside-MK rows are excluded', async () => {
  const first = place('First provider match'), second = {...place('Second provider match'), lat: 52.05};
  const rows = [null, {}, {lat: '', lon: ''}, {lat: true, lon: -.7}, first,
    {lat: Infinity, lon: -.7}, {lat: '52.05oops', lon: '-.7'},
    {...place('Outside MK'), lat: 55.95, lon: -3.19}, second];
  const h = harness({fetch: async () => response(rows)});
  assert.deepEqual(Array.from(await h.context.geocode('Mapped place')), [first, second]);
  assert.equal(h.requests.length, 1);
  assertMkRequest(h.requests[0]);
});

test('an empty provider match performs one bounded request without widening scope or retrying', async () => {
  const h = harness({fetch: async () => response([])});
  assert.equal((await h.context.geocode('25 Unmapped Road')).length, 0);
  assert.equal(h.requests.length, 1);
  assertMkRequest(h.requests[0]);
});

test('non-array search responses are service failures rather than invented empty matches', async () => {
  for (const body of [null, {}, {error: 'busy'}, 'not JSON results', 1]) {
    const h = harness({fetch: async () => response(body)});
    await assert.rejects(h.context.geocode('Submitted place'), /invalid results/i);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('HTTP and JSON failures do not issue extra requests or hide service errors', async () => {
  for (const status of [403, 429, 503]) {
    const h = harness({fetch: async () => response([], status)});
    await assert.rejects(h.context.geocode('Submitted place'), new RegExp(String(status)));
    assert.equal(h.requests.length, 1);
    assertMkRequest(h.requests[0]);
    assert.equal(h.timers.size, 0);
  }
  const h = harness({fetch: async () => ({ok: true, status: 200, json: async () => { throw Error('Malformed JSON'); }})});
  await assert.rejects(h.context.geocode('Submitted place'), /Malformed JSON/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('network errors preserve the provider failure and release the request timeout', async () => {
  const h = harness({fetch: async () => { throw Error('Network unavailable'); }});
  await assert.rejects(h.context.geocode('Submitted place'), /Network unavailable/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('a timed-out search aborts its fetch and does not retry', async () => {
  const h = harness({fetch: request => new Promise((resolve, reject) => {
    request.init.signal.addEventListener('abort', () => reject(Error('Search aborted')), {once: true});
  })});
  const pending = h.context.geocode('Submitted place');
  await flushMicrotasks();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 1);
  const timeout = Array.from(h.timers.values())[0];
  assert.equal(timeout.ms, 12000);
  timeout.fn();
  await assert.rejects(pending, /Search aborted/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('an already abandoned submitted search uses no request slot or public fetch', async () => {
  const h = harness({lastGeocodeAt: 5000});
  assert.equal((await h.context.geocode('Old query', () => false)).length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.waits.length, 0);
  assert.equal(h.state.lastGeocodeAt, 5000);
});

test('abandoning a search during the shared gate wait prevents its fetch and slot reservation', async () => {
  const waiting = deferred();
  const h = harness({lastGeocodeAt: 5000, sleep: () => waiting.promise});
  let current = true;
  const pending = h.context.geocode('Old query', () => current);
  await flushMicrotasks();
  assert.deepEqual(h.waits, [1050]);
  current = false;
  waiting.resolve();
  assert.equal((await pending).length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.lastGeocodeAt, 5000, 'an abandoned query must not reserve a later request slot');
  await h.context.geocode('Current query');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.searchParams.get('q'), 'Current query');
  assert.deepEqual(h.waits, [1050], 'the live query can use the elapsed slot immediately');
});

test('a queued abandoned search is skipped when an earlier request releases the gate', async () => {
  const waiting = deferred();
  const h = harness({lastGeocodeAt: 5000, sleep: () => waiting.promise});
  const first = h.context.geocode('Current query');
  let current = true;
  const abandoned = h.context.geocode('Queued old query', () => current);
  await flushMicrotasks();
  assert.deepEqual(h.waits, [1050]);
  current = false;
  waiting.resolve();
  assert.equal((await first).length, 1);
  assert.equal((await abandoned).length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.searchParams.get('q'), 'Current query');
  assert.deepEqual(h.waits, [1050], 'the abandoned queued query does not add another wait');
  assert.equal(h.state.lastGeocodeAt, h.requests[0].at);
});

test('forward and reverse geocoding retain shared spacing at actual request start', async () => {
  const h = harness();
  await Promise.all([
    h.context.geocode('Milton Keynes Central'),
    h.context.reverseGeocode({lat: 52.0478907, lng: -.7333684}),
    h.context.geocode('Warbler on the Wharf')
  ]);
  assert.deepEqual(h.requests.map(request => request.url.pathname), ['/search', '/reverse', '/search']);
  assert.equal(h.requests.length, 3);
  for (let i = 1; i < h.requests.length; i++) {
    assert.ok(h.requests[i].at - h.requests[i - 1].at >= 1050, 'each actual request is paced');
  }
  assert.deepEqual(h.waits, [1050, 1050]);
  assertMkRequest(h.requests[0]); assertMkRequest(h.requests[2]);
  assert.equal(h.requests[1].url.searchParams.get('lat'), '52.0478907');
  assert.equal(h.requests[1].url.searchParams.get('lon'), '-0.7333684');
});

test('a failed submitted request does not poison the shared gate for the next live query', async () => {
  const h = harness({fetch: async (request, count) => count === 1 ? response([], 503) : response([place()])});
  await assert.rejects(h.context.geocode('Failed query'), /503/);
  assert.equal((await h.context.geocode('Next query')).length, 1);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests[1].at - h.requests[0].at >= 1050);
  assertMkRequest(h.requests[0]); assertMkRequest(h.requests[1]);
});
