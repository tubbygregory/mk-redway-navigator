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
function harness() {
  const elements = {}, markers = [], selected = [], searches = [];
  function node() {
    return {hidden: true, value: '', children: [], slots: {}, listeners: {},
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      querySelector(selector) { return this.slots[selector] ??= node(); },
      addEventListener(event, fn) { this.listeners[event] = fn; },
      setAttribute(key, value) { this[key] = value; }, focus() {}, blur() {}};
  }
  const el = id => elements[id] ??= node();
  const state = {stage: 'planner', userLatLng: {lat: 52.0467, lng: -.7378},
    saved: {home: null, work: null, favourites: []}, localSearchIndex: [], placeSearchIndex: [], placeSearchStatus: 'unavailable'};
  const context = vm.createContext({
    state, MK, hav, el, searchRevision: 0,
    edgeClass: () => 'road', syncRoutePreferenceControls() {},
    searchResultLayer: {clearLayers() { markers.length = 0; }},
    cancelStartLocation() {}, setRouteSheetCollapsed() {},
    formatDistance: distance => `${Math.round(distance)} m`,
    document: {createElement: node}, navigator: {onLine: true},
    URL, AbortController, setTimeout, clearTimeout, location: {href: 'https://example.test/navigator/'}, OFFLINE_CACHE: 'mk-redway-offline-v1',
    fetch: async () => { throw Error('No network fixture'); },
    caches: {match: async () => undefined, keys: async () => []},
    L: {latLng: (lat, lng) => ({lat, lng}), divIcon: options => options,
      marker(coords) {
        return {coords, listeners: {}, addTo() { markers.push(this); return this; },
          on(event, fn) { this.listeners[event] = fn; return this; }};
      }},
    map: {fitBounds() {}, setView() {}},
    setPoint(which, point, label, address) { selected.push({which, point, label, address}); },
    showPlaceSheet() {}, showDestinationInContext() {}, setStage() {}, maybeCalculateRoute() {},
    geocode: async (query, isCurrent) => { searches.push(query); context.currentSearch = isCurrent; return []; }, console,
    persistSavedPlaces() {}, finishSavedSearch() {}, toast() {}
  });
  for (const [from, to] of [
    [app.includes('  function searchText(') ? '  function searchText(' : '  function conciseResultName(', '  function makeSuggestionButton('],
    ['  function showResults(', "  for (const [id, context] of [['startSearch'"],
    ['  async function runSearch(', '  function selectSearchResult('],
    ['  function selectSearchResult(', '  function showPlaceSheet()']
  ]) vm.runInContext(code(from, to), context);
  vm.runInContext(code('  function normalizeSearchQuery(', '  let geocodeGate'), context);
  vm.runInContext(code('  function makeSuggestionButton(', '  function normalizeSearchQuery('), context);
  vm.runInContext(code("  el('homeSearch').addEventListener('input'", '  async function runSearch('), context);
  const loadPlaceIndex = context.loadPlaceIndex;
  context.loadPlaceIndex = async () => false;
  return {context, state, el, markers, selected, searches, loadPlaceIndex};
}
function place(name, lat = 52.0468, address = {}) {
  return {name, lat, lon: -.7378, display_name: name + ', Milton Keynes', address};
}
function house(number, lat = 52.048) {
  return place('Huntley Crescent', lat, {house_number: number, road: 'Huntley Crescent', city: 'Milton Keynes', postcode: 'MK9 4LR'});
}
function index(entries = [{id: 'n123', kind: 'place', lat: 52.0468, lon: -.7378, location: 'mapped point', name: 'Test cafe', category: 'cafe'}]) {
  return {format: 'mk-redway-places-v1', source: 'OpenStreetMap / Geofabrik', bounds: {...MK},
    source_timestamp: new Date(Date.now() - 86400000).toISOString(), generated_at: new Date().toISOString(),
    source_sha256: 'a'.repeat(64), entries};
}
const actualIndex = JSON.parse(fs.readFileSync('data/places.json', 'utf8'));
function useIndex(h, data = actualIndex) {
  h.state.placeSearchIndex = h.context.parsePlaceIndex(data);
  h.context.loadPlaceIndex = async () => true;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const response = data => ({ok: true, text: async () => JSON.stringify(data)});

test('search results require nonempty numeric coordinates inside the MK coverage', () => {
  const h = harness();
  for (const invalid of [null, [], 'place', {}, {lat: null, lon: null}, {lat: '', lon: ''},
    {lat: true, lon: -.7378}, {lat: [], lon: -.7378}, {lat: 'NaN', lon: -.7378},
    {lat: Infinity, lon: -.7378}, {lat: 52.0467, lon: '-.7378oops'},
    {lat: 55.95, lon: -3.19}, {lat: MK.north + .001, lon: -.7378}, {lat: 52, lon: MK.west - .001}]) {
    assert.equal(h.context.validateSearchResult(invalid), false, JSON.stringify(invalid));
  }
  for (const valid of [place('Valid'), {lat: '52.0467', lon: '-.7378'},
    {lat: MK.south, lon: MK.west}, {lat: MK.north, lon: MK.east}]) {
    assert.equal(h.context.validateSearchResult(valid), true);
  }
});

test('numbered addresses retain house and street when the provider name repeats the street or number', () => {
  const h = harness(), address = house('25');
  assert.equal(h.context.conciseResultName(address), '25 Huntley Crescent, Milton Keynes, MK9 4LR');
  address.name = '25';
  assert.equal(h.context.conciseResultName(address), '25 Huntley Crescent, Milton Keynes, MK9 4LR');
  address.name = '';
  assert.equal(h.context.conciseResultName(address), '25 Huntley Crescent, Milton Keynes, MK9 4LR');
});

test('named businesses and buildings keep their name with supplied address context', () => {
  const h = harness();
  const pub = place('Warbler On The Wharf', 52.0468, {house_number: '6', road: 'Wharf Lane', city: 'Milton Keynes'});
  assert.equal(h.context.conciseResultName(pub), 'Warbler On The Wharf, 6 Wharf Lane, Milton Keynes');
  const building = place('Provider name', 52.0468, {building: 'Named building', house_number: '25', road: 'Huntley Crescent'});
  assert.equal(h.context.conciseResultName(building), 'Named building, 25 Huntley Crescent');
});

test('dedupe retains specific houses, generic streets and separate nearby branches in provider order', () => {
  const h = harness(), specific = house('25'), otherHouse = house('27', 52.0479);
  const street = place('Huntley Crescent', 52.0468, {road: 'Huntley Crescent', city: 'Milton Keynes', postcode: 'MK9 4LR'});
  const firstBranch = place('Same shop', 52.048), secondBranch = place('Same shop', 52.050);
  const results = [specific, street, otherHouse, firstBranch, secondBranch];
  assert.deepEqual(Array.from(h.context.dedupeSearchResults(results)), results);
});

test('dedupe collapses stable OSM identities and close representations of the same local address', () => {
  const h = harness();
  const first = {...place('Station', 52.047), osm_type: 'node', osm_id: 123};
  const repeat = {...first, name: 'Station platform', lat: 52.049};
  const named = place('A local cafe', 52.048, {road: 'Example Road', postcode: 'MK9 1AA'});
  const building = {...named, lat: 52.0481};
  const otherAddress = {...named, address: {road: 'Another Road', postcode: 'MK9 1AA'}};
  assert.deepEqual(Array.from(h.context.dedupeSearchResults([first, repeat, named, building, otherAddress])), [first, named, otherAddress]);
});

test('malformed and out-of-area rows cannot hide otherwise valid results', () => {
  const h = harness(), valid = place('Valid match');
  assert.deepEqual(Array.from(h.context.dedupeSearchResults([null, {lat: '', lon: ''}, place('Edinburgh', 55.95), valid])), [valid]);
  assert.deepEqual(Array.from(h.context.dedupeSearchResults(null)), []);
  assert.equal(h.context.conciseResultName({lat: 52.0468, lon: -.7378}), 'Map location');
});

test('local relevance ranking survives dedupe instead of being replaced by distance sorting', () => {
  const h = harness();
  h.state.localSearchIndex = [place('Huntley Crescent', 52.049), place('Old Huntley footpath', 52.0468)];
  assert.deepEqual(Array.from(h.context.localSuggestions('Huntley'), result => result.name), ['Huntley Crescent', 'Old Huntley footpath']);
});

test('local index excludes outside coverage without discarding a later in-area street of the same name', () => {
  const h = harness();
  h.context.buildLocalSearchIndex({nodes: new Map([
    ['outside', {lat: 55.95, lon: -3.19}], ['inside', {lat: 52.0468, lon: -.7378}]
  ]), ways: [
    {nodes: ['outside'], tags: {name: 'Example Road'}}, {nodes: ['inside'], tags: {name: 'Example Road'}}
  ]});
  assert.equal(h.state.localSearchIndex.length, 1);
  assert.equal(h.state.localSearchIndex[0].lat, 52.0468);
});

test('search rows and pins use the same validated ordered destinations', () => {
  const results = [house('25'), null, place('Outside', 55.95), house('27', 52.0479)];
  for (const index of [0, 1]) {
    const row = harness(); row.context.showResults(results, 'destination', 'Huntley Crescent');
    assert.equal(row.el('resultsList').children.length, 2); assert.equal(row.markers.length, 2);
    row.el('resultsList').children[index].listeners.click();
    const pin = harness(); pin.context.showResults(results, 'destination', 'Huntley Crescent');
    pin.markers[index].listeners.click();
    assert.deepEqual(row.selected, pin.selected);
    assert.match(row.selected[0].label, new RegExp(index === 0 ? '^25 Huntley' : '^27 Huntley'));
  }
});

test('selection rejects malformed and outside results before changing an endpoint or Saved', () => {
  const h = harness();
  for (const invalid of [null, {lat: '', lon: ''}, place('Outside', 55.95)]) {
    for (const context of ['destination', 'start', 'end', 'save-home', 'save-favourite']) h.context.selectSearchResult(invalid, context);
  }
  assert.equal(h.selected.length, 0); assert.equal(h.state.saved.home, null); assert.equal(h.state.saved.favourites.length, 0);
});

test('replacing planner results and starting a submitted search clears previous pins', async () => {
  const h = harness(); h.markers.push({old: true});
  h.context.openPlannerSearch('end');
  assert.equal(h.markers.length, 0); assert.match(h.el('resultsList').innerHTML, /Enter a place/);
  h.markers.push({old: true}); const input = h.el('homeSearch'); input.value = 'A new query';
  await h.context.runSearch('destination', input);
  assert.equal(h.markers.length, 0); assert.deepEqual(h.searches, ['A new query']);
});

test('local asset validates complete source metadata, bounds, dates and reviewed limits', () => {
  const h = harness();
  assert.equal(h.context.parsePlaceIndex(actualIndex).length, actualIndex.entries.length);
  for (const changes of [
    {format: 'unknown'}, {source: 'An invented authority'}, {unknown: true}, {source_sha256: 'a'},
    {source_timestamp: 2026}, {source_timestamp: '2026-10-06'}, {source_timestamp: '2026-02-30T00:00:00Z'},
    {source_timestamp: '2026-10-06T25:00:00Z'}, {generated_at: '2080-01-01T00:00:00Z'},
    {source_timestamp: '2026-10-09T00:00:00Z', generated_at: '2026-10-08T00:00:00Z'},
    {bounds: {...MK, west: -1}}, {bounds: {...MK, unknown: 0}}, {entries: []},
    {entries: Array(50001).fill(index().entries[0])}
  ]) assert.throws(() => h.context.parsePlaceIndex({...index(), ...changes}), /local place data/);
});

test('local entries reject malformed identities, misleading precision and unsafe field shapes', () => {
  const h = harness(), valid = index().entries[0];
  for (const changes of [
    {id: 'n0'}, {id: 'n01'}, {id: 'x123'}, {id: 'n123456789012345678901'}, {id: 123},
    {lat: '52.0468'}, {lat: NaN}, {lon: -3}, {unknown: true}, {kind: 'unknown'},
    {location: 'building centre'}, {id: 'w123', location: 'mapped point'}, {location: 'door'},
    {name: undefined}, {category: undefined}, {name: ' '}, {name: ' padded'}, {name: 'Bad\nname'},
    {name: 'x'.repeat(201)}, {house_number: '1'.repeat(41)}, {street: '<'.repeat(201)},
    {postcode: 'x'.repeat(33)}, {locality: 'x'.repeat(161)}, {category: 'x'.repeat(81)},
    {aliases: []}, {aliases: ['one', 'ONE']}, {aliases: ['Test cafe']}, {aliases: Array(9).fill('name')},
    {aliases: ['bad\u007f']}, {aliases: ['x'.repeat(201)]}, {aliases: 'name'}
  ]) assert.throws(() => h.context.parsePlaceIndex(index([{...valid, ...changes}])), /local place entry/, JSON.stringify(changes));
  assert.throws(() => h.context.parsePlaceIndex(index([valid, {...valid}])), /local place entry/);
  for (const entry of [
    {...valid, kind: 'address', street: 'Example Road', name: undefined, category: undefined},
    {...valid, kind: 'building', street: 'Example Road', house_number: '25', id: 'w1', location: 'building centre'}
  ]) assert.throws(() => h.context.parsePlaceIndex(index([entry])), /local place entry/);
});

test('real MK names match local punctuation, possessives and conservative misspellings without a public request', () => {
  const h = harness(); useIndex(h);
  for (const query of ['Warbler On The Wharf', 'Warbler on Wharf', 'Bannatyne', 'Bannatynes', 'Bannatyne’s', 'Banatyne']) {
    const found = h.context.localSuggestions(query);
    assert.ok(found.length, query);
    assert.match(found[0].name, query.toLowerCase().startsWith('warbler') ? /Warbler on the Wharf/ : /Bannatyne Health Club/);
  }
  assert.deepEqual(h.searches, []);
});

test('Huntley house 25 is never invented: actual building alternatives keep canonical names and visible precision', () => {
  const h = harness(); useIndex(h);
  const found = h.context.searchLocalPlaces('25 Huntley Crescent');
  assert.equal(found.length, 3);
  assert.equal(found[0].name, '8-55 Huntley Crescent');
  for (const result of found) {
    assert.equal(result.address.house_number, '');
    assert.match(result.matchNote, /Exact house number 25 not found in local data/);
    assert.ok(actualIndex.entries.some(entry => entry.id === 'w' + result.osm_id && entry.lat === result.lat && entry.lon === result.lon));
    assert.doesNotMatch(h.context.conciseResultName(result), /^25 /);
  }
  h.context.showResults(found, 'destination', '25 Huntley Crescent');
  const row = h.el('resultsList').children[0];
  const warning = row.querySelector('.result-copy').children.find(child => child.className === 'result-accuracy');
  assert.match(warning.textContent, /Building match.*Exact house number 25 not found/);
  row.listeners.click();
  assert.equal(h.selected[0].point.lat, found[0].lat);
  assert.match(h.selected[0].label, /^8-55 Huntley Crescent/);
  assert.equal(h.selected[0].address, found[0].matchNote);
});

test('actual numbered addresses outrank building fallback and house numbers are never fuzzy matched', () => {
  const h = harness();
  useIndex(h, index([
    {id: 'n25', kind: 'address', lat: 52.045, lon: -.742, location: 'mapped point', house_number: '25', street: 'Example Road', postcode: 'MK9 3FZ'},
    {id: 'n27', kind: 'address', lat: 52.046, lon: -.742, location: 'mapped point', house_number: '27', street: 'Example Road'},
    {id: 'w1', kind: 'building', lat: 52.047, lon: -.742, location: 'building centre', name: '1-30', street: 'Example Road'}
  ]));
  const found = h.context.searchLocalPlaces('25 Example Road mk93fz');
  assert.equal(found[0].address.house_number, '25');
  assert.doesNotMatch(found[0].matchNote, /not found/);
  assert.equal(h.context.searchLocalPlaces('2 Example Road').some(result => result.address.house_number === '25'), false);
  assert.equal(h.context.searchLocalPlaces('26 Example Road').some(result => result.address.house_number), false);
});

test('local aliases resolve to source names, while an exact Saved place stays reachable before many branches', () => {
  const h = harness();
  useIndex(h, index(Array.from({length: 7}, (_, i) => ({id: 'n' + (i + 1), kind: 'place', lat: 52.04 + i / 1000,
    lon: -.74, location: 'mapped point', name: 'Example cafe ' + i, category: 'cafe', aliases: ['Old cafe ' + i]}))));
  assert.equal(h.context.searchLocalPlaces('Old cafe 3')[0].name, 'Example cafe 3');
  h.state.saved.favourites.push({name: 'Example cafe', lat: 52.048, lng: -.741, address: 'My saved meeting point'});
  assert.equal(h.context.localSuggestions('Example cafe')[0].type, 'Saved place');
});

test('local asset loading uses a scoped validated asset and does not overwrite the routing street index', async () => {
  const h = harness(), fetched = [];
  const streets = [place('Graph road')]; h.state.localSearchIndex = streets;
  h.context.fetch = async (url, options) => { fetched.push({url, options}); return response(index()); };
  assert.equal(await h.loadPlaceIndex(), true);
  assert.equal(h.state.placeSearchStatus, 'ready');
  assert.equal(h.state.placeSearchIndex[0].name, 'Test cafe');
  assert.equal(h.state.localSearchIndex, streets);
  assert.equal(fetched[0].url, 'https://example.test/navigator/data/places.json');
  assert.ok(fetched[0].options.signal instanceof AbortSignal);
  assert.equal(await h.loadPlaceIndex(), true); assert.equal(fetched.length, 1);
});

test('HTTP, network and corrupt local asset responses fall back to a validated scoped cache', async () => {
  for (const network of [() => { throw Error('offline'); }, () => ({ok: false, status: 503}), () => response({bad: true}), () => ({ok: true, text: async () => '<html>'})]) {
    const h = harness(), matches = [];
    h.context.fetch = async () => network();
    h.context.caches.match = async url => { matches.push(url); return response(index()); };
    assert.equal(await h.loadPlaceIndex(), true); assert.equal(h.state.placeSearchStatus, 'ready');
    assert.deepEqual(matches, ['https://example.test/navigator/data/places.json']);
  }
});

test('invalid network and cached place assets are rejected, deleted only from app caches, and can be retried', async () => {
  const h = harness(), deleted = [];
  h.context.fetch = async () => response({...index(), entries: []});
  h.context.caches = {match: async () => response({...index(), entries: []}), keys: async () => ['mk-redway-shell-v39', 'mk-redway-offline-v1', 'other-app'],
    open: async name => ({delete: async url => { deleted.push({name, url}); }})};
  assert.equal(await h.loadPlaceIndex(), false); assert.equal(h.state.placeSearchStatus, 'unavailable');
  assert.equal(h.state.placeSearchIndex.length, 0); assert.equal(h.state.placeSearchPromise, null);
  assert.deepEqual(deleted.map(item => item.name), ['mk-redway-shell-v39', 'mk-redway-offline-v1']);
  assert.ok(deleted.every(item => item.url === 'https://example.test/navigator/data/places.json'));
  h.context.fetch = async () => response(index());
  assert.equal(await h.loadPlaceIndex(), true);
});

test('local asset fetch timeout aborts and releases the search to honest unavailable status', async () => {
  const h = harness(); let timeout, signal;
  h.context.setTimeout = fn => { timeout = fn; return 1; };
  h.context.clearTimeout = () => {};
  h.context.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
  };
  const pending = h.loadPlaceIndex(); timeout();
  assert.equal(await pending, false); assert.equal(signal.aborted, true); assert.equal(h.state.placeSearchStatus, 'unavailable');
});

test('late asset completion refreshes active local typeahead but never reopens a closed search or replaces submitted rows', async () => {
  for (const action of ['active', 'close', 'submitted']) {
    const h = harness(), request = deferred(); h.state.stage = 'explore';
    const input = h.el('homeSearch'); input.value = 'Test cafe'; h.context.document.activeElement = input;
    h.context.renderTypeahead(input, 'destination');
    h.context.fetch = async () => request.promise;
    const pending = h.loadPlaceIndex();
    if (action === 'close') h.context.closeSearch();
    if (action === 'submitted') { h.state.searchSubmissionActive = true; h.el('resultsTitle').textContent = 'Authoritative results'; }
    request.resolve(response(index())); await pending;
    if (action === 'active') assert.equal(h.el('typeaheadSuggestions').children.length, 1);
    else assert.equal(h.el('typeaheadSuggestions').children.length, 0);
    if (action === 'close') assert.equal(h.el('typeaheadSuggestions').hidden, true);
    if (action === 'submitted') assert.equal(h.el('resultsTitle').textContent, 'Authoritative results');
  }
});

test('submitted empty and failed provider searches retain mapped local places with accessible honest status', async () => {
  for (const outcome of ['empty', 'error', 'offline']) {
    const h = harness(); useIndex(h); const input = h.el('homeSearch'); input.value = 'Warbler On The Wharf';
    let calls = 0;
    h.context.geocode = async () => { calls++; if (outcome === 'error') throw Error('503'); return []; };
    h.context.navigator.onLine = outcome !== 'offline';
    await h.context.runSearch('destination', input);
    assert.equal(calls, outcome === 'offline' ? 0 : 1);
    assert.equal(h.markers.length, 1);
    const status = h.el('resultsList').children.find(item => item.id === 'resultsMessage');
    assert.equal(status.role, 'status');
    assert.match(status.textContent, outcome === 'offline' ? /offline.*mapped local/ : outcome === 'error' ? /unavailable.*mapped local/ : /No online match.*mapped local/);
  }
});

test('submitted provider relevance stays first while local matches supplement coverage and deduplicate OSM identity', async () => {
  const h = harness(); useIndex(h);
  const local = h.context.searchLocalPlaces('Warbler On The Wharf')[0];
  const provider = {...local, local: false, lat: String(local.lat), lon: String(local.lon)};
  h.context.geocode = async () => [provider];
  const input = h.el('homeSearch'); input.value = 'Warbler On The Wharf'; await h.context.runSearch('destination', input);
  assert.equal(h.markers.length, 1); assert.match(h.el('resultsTitle').textContent, /^Results /);
});

test('editing the home query cancels the predicate passed to geocode and discards the late provider reply', async () => {
  const h = harness(), request = deferred(); let current;
  h.context.geocode = (_query, isCurrent) => { current = isCurrent; return request.promise; };
  const input = h.el('homeSearch'); input.value = 'Old query';
  const pending = h.context.runSearch('destination', input); assert.equal(current(), true);
  input.value = 'New query'; input.listeners.input(); assert.equal(current(), false);
  request.resolve([place('Old destination')]); await pending;
  assert.equal(h.markers.length, 0); assert.equal(h.el('resultsSheet').hidden, true);
});

test('offline submitted MK coordinates retain the existing local shortcut without a public fetch', async () => {
  const h = harness(); let requests = 0;
  h.context.NOMINATIM = 'https://nominatim.example/search';
  h.context.waitForGeocoder = async () => true;
  h.context.fetch = async () => { requests++; throw Error('Unexpected public fetch'); };
  vm.runInContext(code('  async function geocode(', '  function showResults('), h.context);
  h.context.navigator.onLine = false;
  const input = h.el('homeSearch'); input.value = '52.025,-0.783';
  await h.context.runSearch('destination', input);
  assert.equal(requests, 0); assert.equal(h.markers.length, 1);
  h.markers[0].listeners.click(); assert.deepEqual(h.selected[0].point, {lat: 52.025, lng: -.783});
  input.value = '55.95,-3.19'; await h.context.runSearch('destination', input);
  assert.equal(h.markers.length, 0); assert.equal(requests, 0);
});
