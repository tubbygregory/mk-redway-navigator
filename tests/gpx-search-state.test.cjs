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
  function node(tagName = 'div') {
    return {
      tagName, hidden: true, value: '', dataset: {}, listeners: {}, children: [], slots: {},
      classList: {add() {}, remove() {}, toggle() {}},
      setAttribute() {}, removeAttribute() {}, blur() {}, focus() {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      querySelector(selector) {
        if (['strong', 'small'].includes(selector)) return this.slots[selector] ??= node();
        const download = /^\[data-gpx-download="([^"]+)"\]$/.exec(selector);
        return download ? descendants(this).find(item => item.dataset.gpxDownload === download[1]) || null : null;
      }
    };
  }
  function el(id) {
    return elements[id] ??= node();
  }
  const state = {stage: 'explore', route: null, routeRevision: 1, pendingSaveKind: null, exploreFilter: 'all'};
  const context = vm.createContext({
    state, el, gpxLoadRevision: 0, searchRevision: 0,
    console: {warn(...args) { errors.push(args); }, error(...args) { errors.push(args); }},
    fetch(url) { const request = deferred(); downloads.push({url, ...request}); return request.promise; },
    parseGpx(text) {
      if (text === 'invalid') throw Error('Invalid GPX');
      return {coords: [[52.025, -.783], [52.027, -.780]], title: text, multipleSegments: text === 'multiple'};
    },
    installImportedGpx(coords, title) { installed.push({coords, title}); state.routeRevision++; context.setStage('planner'); },
    routeFromNearestPoint: coords => coords,
    toast: text => messages.push(text),
    document: {
      createElement: node,
      querySelector(selector) {
        const match = /^\.route-(\w+) \.cultural-route-actions$/.exec(selector);
        const card = match && el('culturalRoutesList').children.find(item => item.className.endsWith('route-' + match[1]));
        return card ? descendants(card).find(item => item.className === 'cultural-route-actions') : null;
      }
    },
    formatDistance: distance => `${distance} m`,
    cancelStartLocation() {}, cancelNavigationStart() {}, updateInstallButtonVisibility() {}, syncViewport() {}, setTimeout() {},
    searchResultLayer: {clearLayers() { pins = 0; }},
    geocode(query) { const request = deferred(); searches.push({query, ...request}); return request.promise; },
    showResults(results, searchContext, query) { shown.push({results, searchContext, query}); el('resultsSheet').hidden = false; pins = results.length; },
    renderTypeahead(input, searchContext) { suggestions.push({query: input.value, searchContext}); el('typeaheadSuggestions').hidden = false; },
    openPlannerSearch() {}, finishSavedSearch() {}, renderSavedPlaces() {}, renderCulturalRoutes() {},
    hydrateCulturalRouteDistances: async () => {}, syncVoiceControls() {}, syncUnitControls() {}, syncRoutePreferenceControls() {}, applyTheme() {},
    probeOfflineMap: async () => {}
  });
  vm.runInContext(code('  const CULTURAL_ROUTES_URL =', '  const redwayLayer ='), context);
  const routes = vm.runInContext('CULTURAL_ROUTES', context);
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
  return {context, state, el, routes, downloads, installed, messages, errors, searches, shown, suggestions, pins: () => pins};
}
const route = () => ({id: 'blue', color: 'Blue', title: 'Source route', fullGpx: './cultural-routes/gpx-blue-main.gpx', shortGpx: './cultural-routes/gpx-blue-short.gpx'});
const response = text => ({ok: true, text: async () => text});
const file = text => ({name: 'local.gpx', size: 100, text});
function renderCards(h) {
  vm.runInContext(code('  function culturalRouteMatches(', '  function openExploreRoutes('), h.context);
  h.context.renderCulturalRoutes();
  return h.el('culturalRoutesList').children;
}
function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

test('all ten cultural tracks load from the app origin at root and subpaths with source provenance retained', () => {
  const h = harness(); assert.equal(h.routes.length, 5);
  for (const source of h.routes) {
    for (const [variant, suffix] of [['full', 'main'], ['short', 'short']]) {
      const path = `./cultural-routes/gpx-${source.id}-${suffix}.gpx`;
      assert.equal(source[variant + 'Gpx'], path);
      assert.equal(source[variant + 'GpxSource'], `https://getaroundmk.org.uk/wp-content/uploads/2020/07/gpx-${source.id}-${suffix}.gpx`);
      for (const base of ['https://mkredway.co.uk/', 'https://example.test/navigator/']) {
        const target = new URL(path, base);
        assert.equal(target.origin, new URL(base).origin);
        assert.equal(target.pathname, new URL(base).pathname + path.slice(2));
      }
    }
  }
});

test('route cards identify the shortcut file as a segment and qualify shorter ride distances', () => {
  const h = harness(), cards = renderCards(h);
  for (const card of cards) {
    const nodes = descendants(card);
    assert.ok(nodes.some(item => item.tagName === 'button' && item.textContent === 'Full route'));
    assert.ok(nodes.some(item => item.tagName === 'button' && item.textContent === 'Shortcut track'));
    assert.ok(nodes.some(item => /segment, not the complete shorter loop/.test(item.textContent || '')));
    assert.match(card.children[0].querySelector('small').textContent, /mi shorter ride in guide/);
  }
});

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
    assert.deepEqual(h.installed.map(item => item.title), ['Blue · Source route shortcut track']);
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
    assert.equal(h.installed[0].title, first === 'official' ? 'new file' : 'Blue · Source route shortcut track');
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

test('current GPX failures retain in-app retry/import guidance', async () => {
  const h = harness(), source = route();
  const pending = h.context.loadOfficialGpx(source, 'full');
  h.downloads[0].resolve({ok: false, status: 503}); await pending;
  assert.equal(source.loadErrorVariant, 'full'); assert.match(h.messages[0], /Retry, or import a GPX/);
  await h.context.importGpxFile(file(async () => 'invalid'));
  assert.match(h.messages[1], /could not be read/); assert.equal(h.installed.length, 0);
});

test('failed cultural GPX keeps the planned route and retries locally without an external Download link', async () => {
  for (const variant of ['full', 'short']) {
    for (const outcome of ['http-error', 'network-error', 'malformed']) {
      const h = harness(), source = h.routes[0], previous = {name: 'Planned journey'};
      h.state.route = previous; h.el('exploreSheet').hidden = false; renderCards(h);
      const pending = h.context.loadOfficialGpx(source, variant);
      if (outcome === 'network-error') h.downloads[0].reject(Error('Offline'));
      else h.downloads[0].resolve(outcome === 'malformed' ? response('invalid') : {ok: false, status: 404});
      await pending;
      assert.equal(h.state.route, previous); assert.equal(h.el('exploreSheet').hidden, false); assert.equal(h.installed.length, 0);
      // Distance hydration or reopening the gallery must preserve recovery controls.
      h.context.renderCulturalRoutes();
      const card = h.el('culturalRoutesList').children[0], nodes = descendants(card);
      const retry = nodes.find(item => item.dataset.gpxRetry === variant);
      assert.ok(retry, 'failed loads must offer an in-app Retry action');
      assert.equal(retry.textContent, variant === 'short' ? 'Retry shortcut track' : 'Retry full route');
      assert.ok(nodes.some(item => /could not be loaded/.test(item.textContent || '')));
      assert.equal(nodes.filter(item => item.tagName === 'a').length, 1, 'only the explicit official guide link remains');
      assert.ok(!nodes.some(item => /Download/.test(item.textContent || '')));
      const retried = retry.listeners.click();
      assert.equal(h.downloads[1].url, source[variant + 'Gpx']);
      h.downloads[1].resolve(response('valid track')); await retried;
      assert.equal(h.installed.length, 1); assert.equal(source.loadErrorVariant, undefined);
      if (variant === 'short') assert.match(h.installed[0].title, /shortcut track$/);
    }
  }
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
