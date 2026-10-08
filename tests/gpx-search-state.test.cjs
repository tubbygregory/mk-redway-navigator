const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');

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
function harness() {
  const elements = {}, downloads = [], installed = [], messages = [], errors = [], searches = [], shown = [], suggestions = [];
  let pins = 0;
  function el(id) {
    return elements[id] ??= {
      hidden: true, value: '', dataset: {}, listeners: {},
      classList: {add() {}, remove() {}, toggle() {}},
      setAttribute() {}, removeAttribute() {}, blur() {}, focus() {},
      addEventListener(event, fn) { this.listeners[event] = fn; }
    };
  }
  const links = [];
  const state = {stage: 'explore', route: null, routeRevision: 1, pendingSaveKind: null};
  const context = vm.createContext({
    state, el, gpxLoadRevision: 0, searchRevision: 0,
    console: {warn(...args) { errors.push(args); }, error(...args) { errors.push(args); }},
    fetch() { const request = deferred(); downloads.push(request); return request.promise; },
    parseGpx(text) {
      if (text === 'invalid') throw Error('Invalid GPX');
      return {coords: [[52.025, -.783], [52.027, -.780]], title: text, multipleSegments: text === 'multiple'};
    },
    installImportedGpx(coords, title) { installed.push({coords, title}); state.routeRevision++; context.setStage('planner'); },
    routeFromNearestPoint: coords => coords,
    toast: text => messages.push(text),
    document: {
      querySelector: () => ({querySelector: () => null, appendChild: link => links.push(link)}),
      createElement: () => ({dataset: {}})
    },
    cancelStartLocation() {}, cancelNavigationStart() {}, updateInstallButtonVisibility() {}, syncViewport() {}, setTimeout() {},
    searchResultLayer: {clearLayers() { pins = 0; }},
    geocode(query) { const request = deferred(); searches.push({query, ...request}); return request.promise; },
    showResults(results, searchContext, query) { shown.push({results, searchContext, query}); el('resultsSheet').hidden = false; pins = results.length; },
    renderTypeahead(input, searchContext) { suggestions.push({query: input.value, searchContext}); el('typeaheadSuggestions').hidden = false; },
    openPlannerSearch() {}, finishSavedSearch() {}, renderSavedPlaces() {}, renderCulturalRoutes() {},
    hydrateCulturalRouteDistances: async () => {}, syncVoiceControls() {}, syncUnitControls() {}, syncRoutePreferenceControls() {}, applyTheme() {},
    probeOfflineMap: async () => {}
  });
  for (const [from, to] of [
    ['  function setStage(stage)', '  function toast('],
    ['  function closeSearch()', "  for (const [id, context] of [['startSearch'"],
    ["  el('homeSearch').addEventListener('input'", '  function selectSearchResult('],
    ['  function openExploreRoutes()', '  async function hydrateCulturalRouteDistances('],
    ['  function closeExploreRoutes()', '  // All visible sheet handles'],
    ["  el('savedPlacesBtn').addEventListener('click'", "  el('closeSaved').addEventListener("],
    ['  function openSettings()', "  el('visibleSettingsBtn').addEventListener("],
    ['  async function loadOfficialGpx(', '  function routeShareUrl(']
  ]) vm.runInContext(code(from, to), context);
  return {context, state, el, downloads, installed, messages, errors, links, searches, shown, suggestions, pins: () => pins};
}
const route = () => ({id: 'blue', color: 'Blue', title: 'Source route', fullGpx: 'full.gpx', shortGpx: 'short.gpx'});
const response = text => ({ok: true, text: async () => text});
const file = text => ({name: 'local.gpx', size: 100, text});

test('current official and local GPX loads still install after closing Explore', async () => {
  const h = harness();
  const official = h.context.loadOfficialGpx(route(), 'full');
  h.downloads[0].resolve(response('official')); await official;
  assert.equal(h.installed[0].title, 'Blue · Source route');
  assert.equal(h.state.stage, 'planner'); assert.equal(h.el('exploreSheet').hidden, true);
  await h.context.importGpxFile(file(async () => 'multiple'));
  assert.equal(h.installed[1].title, 'multiple');
  assert.match(h.messages[0], /longest continuous section/);
});

test('newer official GPX wins over older responses and failures', async () => {
  for (const outcome of ['success', 'http-error', 'network-error']) {
    const h = harness(), source = route();
    const older = h.context.loadOfficialGpx(source, 'full');
    const newer = h.context.loadOfficialGpx(source, 'short');
    h.downloads[1].resolve(response('short')); await newer;
    if (outcome === 'network-error') h.downloads[0].reject(Error('Offline'));
    else h.downloads[0].resolve(outcome === 'success' ? response('full') : {ok: false, status: 503});
    await older;
    assert.deepEqual(h.installed.map(item => item.title), ['Blue · Source route short']);
    assert.equal(source.fullCoords, undefined); assert.equal(h.errors.length, 0); assert.equal(h.messages.length, 0);
  }
});

test('official downloads and local files share supersession in both directions', async () => {
  for (const first of ['official', 'file']) {
    const h = harness(), text = deferred();
    const older = first === 'official' ? h.context.loadOfficialGpx(route(), 'full') : h.context.importGpxFile(file(() => text.promise));
    const newer = first === 'official' ? h.context.importGpxFile(file(async () => 'new file')) : h.context.loadOfficialGpx(route(), 'short');
    if (first === 'file') h.downloads[0].resolve(response('short'));
    await newer;
    if (first === 'official') h.downloads[0].resolve(response('full'));
    else text.resolve('old file');
    await older;
    assert.equal(h.installed.length, 1);
    assert.equal(h.installed[0].title, first === 'official' ? 'new file' : 'Blue · Source route short');
  }
});

test('newer local GPX wins when older file reads finish later', async () => {
  for (const fail of [false, true]) {
    const h = harness(), text = deferred();
    const older = h.context.importGpxFile(file(() => text.promise));
    await h.context.importGpxFile(file(async () => 'new file'));
    if (fail) text.reject(Error('Read failed'));
    else text.resolve('old file');
    await older;
    assert.deepEqual(h.installed.map(item => item.title), ['new file']);
    assert.equal(h.messages.length, 0); assert.equal(h.errors.length, 0);
  }
});

test('leaving Explore or changing the route cancels GPX without stale errors', async () => {
  for (const cancel of [h => h.context.closeExploreRoutes(), h => h.context.setStage('place'), h => h.state.routeRevision++]) {
    for (const kind of ['official', 'file']) {
      const h = harness(), text = deferred();
      const pending = kind === 'official' ? h.context.loadOfficialGpx(route(), 'full') : h.context.importGpxFile(file(() => text.promise));
      cancel(h);
      if (kind === 'official') h.downloads[0].reject(Error('Offline'));
      else text.reject(Error('Read failed'));
      await pending;
      assert.equal(h.installed.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.messages.length, 0);
    }
  }
});

test('a route edit during the response body read prevents GPX installation', async () => {
  const h = harness(), body = deferred();
  const pending = h.context.loadOfficialGpx(route(), 'full');
  h.downloads[0].resolve({ok: true, text: () => body.promise});
  await Promise.resolve();
  h.state.routeRevision++; body.resolve('old body'); await pending;
  assert.equal(h.installed.length, 0);
});

test('selecting another route with the same revision cancels pending GPX', async () => {
  for (const kind of ['official', 'file']) {
    const h = harness(), text = deferred(); h.state.route = {name: 'Old alternative'};
    const pending = kind === 'official' ? h.context.loadOfficialGpx(route(), 'full') : h.context.importGpxFile(file(() => text.promise));
    h.state.route = {name: 'Chosen alternative'};
    if (kind === 'official') h.downloads[0].resolve(response('old GPX'));
    else text.resolve('old GPX');
    await pending;
    assert.equal(h.installed.length, 0); assert.equal(h.state.route.name, 'Chosen alternative');
    assert.equal(h.state.routeRevision, 1); assert.equal(h.messages.length, 0);
  }
});

test('current GPX failures retain explicit download/import error reporting', async () => {
  const h = harness();
  const pending = h.context.loadOfficialGpx(route(), 'full');
  h.downloads[0].resolve({ok: false, status: 503}); await pending;
  assert.equal(h.links[0].href, 'full.gpx'); assert.match(h.messages[0], /Direct loading unavailable/);
  await h.context.importGpxFile(file(async () => 'invalid'));
  assert.match(h.messages[1], /could not be read/); assert.equal(h.installed.length, 0);
});

test('unchanged submitted home searches still show results', async () => {
  const h = harness(), input = h.el('homeSearch'); input.value = 'Station';
  const pending = h.context.runSearch('destination', input);
  h.searches[0].resolve([{name: 'Station'}]); await pending;
  assert.equal(h.shown[0].query, 'Station'); assert.equal(h.el('resultsSheet').hidden, false); assert.equal(h.pins(), 1);
});

test('query editing or a new panel prevents stale submitted results and failures', async () => {
  for (const action of ['edit', 'Explore', 'Settings', 'Saved']) {
    for (const fail of [false, true]) {
      const h = harness(), input = h.el('homeSearch'); input.value = 'Old query';
      const pending = h.context.runSearch('destination', input);
      if (action === 'edit') { input.value = 'New query'; input.listeners.input(); }
      else if (action === 'Explore') h.context.openExploreRoutes();
      else if (action === 'Settings') h.context.openSettings();
      else h.el('savedPlacesBtn').listeners.click();
      if (fail) h.searches[0].reject(Error('Offline'));
      else h.searches[0].resolve([{name: 'Old result'}]);
      await pending;
      assert.equal(h.shown.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.el('resultsSheet').hidden, true);
      assert.equal(h.searches.length, 1, 'local typing/panel opening must not submit another search');
      if (action === 'edit') assert.equal(h.suggestions[0].query, 'New query');
    }
  }
});

test('editing after a submitted result clears its old pins and retains local suggestions', async () => {
  const h = harness(), input = h.el('homeSearch'); input.value = 'Old query';
  const pending = h.context.runSearch('destination', input);
  h.searches[0].resolve([{name: 'Old result'}]); await pending;
  input.value = 'New query'; input.listeners.input();
  assert.equal(h.pins(), 0); assert.equal(h.el('resultsSheet').hidden, true);
  assert.equal(h.el('typeaheadSuggestions').hidden, false); assert.equal(h.searches.length, 1);
});
