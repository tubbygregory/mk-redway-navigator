const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');
function code(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}
const place = (id = 'one', lat = 52.04, lng = -.75) => ({id, name: 'Chosen place', address: 'MK address', lat, lng});
function harness() {
  const state = {saved: {home: null, work: null, favourites: []}, end: null, stage: 'explore', savedPickRevision: 0};
  const store = new Map(), elements = new Map(), handlers = {}, mapHandlers = {}, timers = new Map();
  const calls = {writes: 0, renders: 0, reverse: 0, messages: [], blocked: false, readBlocked: false, clock: 100, nextTimer: 0};
  function el(id) {
    if (!elements.has(id)) elements.set(id, {hidden: false, value: '', placeholder: '', attributes: {}, classes: new Set(),
      setAttribute(key, value) { this.attributes[key] = value; },
      classList: {toggle(name, enabled) { if (enabled) el(id).classes.add(name); else el(id).classes.delete(name); }},
      addEventListener(type, callback) { handlers[id + ':' + type] = callback; },
      blur() { this.blurred = true; }, focus() { this.focused = true; }, select() {}, scrollIntoView() {}});
    return elements.get(id);
  }
  const container = {getBoundingClientRect: () => ({left: 0, top: 0}),
    addEventListener(type, callback) { handlers['map:' + type] = callback; }};
  const context = vm.createContext({
    state, el, MK: {south: 51.955, north: 52.155, west: -.905, east: -.615}, SAVED_KEY: 'saved',
    localStorage: {getItem(key) {
      if (calls.readBlocked) throw new Error('SecurityError');
      calls.beforeRead?.(key);
      return store.get(key) || null;
    }, setItem(key, value) {
      calls.writes++; if (calls.blocked) throw new Error('QuotaExceededError'); store.set(key, value);
    }},
    toast: message => calls.messages.push(message),
    renderSavedPlaces() { calls.renders++; context.syncSaveFavouriteButton(); },
    renderSavedPicker() { el('savedPlacePicker').hidden = !state.pendingSaveKind; },
    closeSearch() {}, setStage: stage => { state.stage = stage; },
    conciseResultName: result => result.name || 'Chosen place', resultSecondary: result => result.address?.road || 'MK address',
    fmtCoord: point => point.lat + ', ' + point.lng, L: {latLng: (lat, lng) => ({lat, lng}), point: (x, y) => ({x, y})},
    setPoint(which, point, label, address) { state[which] = {...point}; state[which + 'Label'] = label; state.endAddress = address; },
    showPlaceSheet() { state.stage = 'place'; context.syncSaveFavouriteButton(); },
    showDestinationInContext() {}, maybeCalculateRoute() {}, updatePlannerFields() {},
    reverseGeocode: async () => { calls.reverse++; return null; },
    performance: {now: () => calls.clock}, sheetGestureUntil: 0,
    document: {addEventListener(type, callback) { handlers['document:' + type] = callback; }},
    map: {getContainer: () => container, containerPointToLatLng: () => ({lat: 52.043, lng: -.737}),
      on(type, callback) { mapHandlers[type] = callback; }},
    setTimeout(callback) { const id = ++calls.nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  for (const [from, to] of [
    ['  function validateSearchResult(', '  function conciseResultName('],
    ['  function normalizeSavedPlace(', '  function showDestinationInContext('],
    ['  function beginSavedSearch(', '  function setPoint('],
    ['  function selectSearchResult(', '  function showPlaceSheet('],
    ["  el('addFavouriteBtn').addEventListener", "  el('quickHomeBtn').addEventListener"],
    ["  el('saveFavouriteBtn').addEventListener", "  map.on('click'"],
    ["  map.on('click'", '  async function reverseGeocode('],
    ['  async function dropDestinationPin(', '  function acquireCurrentLocation(']
  ]) vm.runInContext(code(from, to), context);
  return {state, store, context, calls, el, handlers, mapHandlers, timers,
    click(id) { handlers[id + ':click'](); },
    longPress() {
      const event = {isPrimary: true, pointerType: 'touch', clientX: 100, clientY: 300, target: {closest: () => null}};
      handlers['document:pointerdown'](event); handlers['map:pointerdown'](event);
      calls.clock += 550; const [id, callback] = timers.entries().next().value; timers.delete(id); callback();
    },
    releaseClick({x = 100, y = 300, detail = 1} = {}) {
      let prevented = false;
      handlers['document:click']({clientX: x, clientY: y, detail,
        preventDefault() { prevented = true; }, stopImmediatePropagation() {}});
      return prevented;
    }};
}

test('Saved feedback follows successful persistence, duplicate saves, removal and a different destination', () => {
  const h = harness(); h.state.end = {lat: 52.04, lng: -.75};
  h.context.syncSaveFavouriteButton(); assert.equal(h.el('saveFavouriteLabel').textContent, 'Save');
  h.click('saveFavouriteBtn');
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Saved');
  assert.equal(h.el('saveFavouriteBtn').attributes['aria-pressed'], 'true');
  assert.ok(h.el('saveFavouriteBtn').classes.has('is-saved'));
  h.click('saveFavouriteBtn'); assert.equal(h.state.saved.favourites.length, 1); assert.equal(h.calls.writes, 1);
  assert.equal(h.calls.messages.at(-1), 'Already saved');
  h.context.persistSavedPlaces({...h.state.saved, favourites: []});
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Save');
  h.context.savePlace('favourite', place()); h.state.end.lng = -.76; h.context.syncSaveFavouriteButton();
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Save');
  h.context.loadSavedPlaces(); assert.equal(h.state.saved.favourites.length, 1);
});

for (const kind of ['home', 'work', 'favourite']) {
  test('real search selection saves ' + kind + ' and closes its picker only after persistence', () => {
    const h = harness(); h.context.beginSavedSearch(kind);
    h.context.selectSearchResult({name: '25 Example Road', address: {road: 'Example Road'}, lat: '52.04', lon: '-.75'}, 'save-' + kind);
    const selected = kind === 'favourite' ? h.state.saved.favourites[0] : h.state.saved[kind];
    assert.equal(selected.name, '25 Example Road'); assert.equal(selected.lat, 52.04);
    assert.equal(h.state.pendingSaveKind, null); assert.equal(h.el('savedSheet').hidden, false);
    assert.equal(JSON.parse(h.store.get('saved'))[kind === 'favourite' ? 'favourites' : kind] !== null, true);
    const failed = harness(); failed.context.beginSavedSearch(kind);
    failed.calls.blocked = true; failed.context.selectSearchResult({name: 'Address', lat: 52.04, lon: -.75}, 'save-' + kind);
    assert.equal(failed.state.pendingSaveKind, kind); assert.equal(failed.store.size, 0);
    assert.match(failed.calls.messages.at(-1), /could not be updated/);
    assert.equal(failed.state.saved.favourites.length, 0); assert.equal(failed.state.saved.home, null);
    assert.equal(failed.state.saved.work, null);
  });
  test('map selection saves ' + kind + ' without reverse lookup and rejects outside-MK pins', () => {
    const h = harness(); h.context.beginSavedSearch(kind); h.click('pickSavedOnMapBtn');
    assert.equal(h.state.savedPickOnMap, true); assert.equal(h.el('homeSearch').blurred, true);
    h.mapHandlers.click({latlng: {lat: 53, lng: -.75}});
    assert.equal(h.calls.writes, 0); assert.equal(h.state.pendingSaveKind, kind);
    h.mapHandlers.click({latlng: {lat: 52.04, lng: -.75}});
    assert.equal(h.calls.writes, 1); assert.equal(h.calls.reverse, 0); assert.equal(h.state.pendingSaveKind, null);
  });
}

test('blocked storage rolls back saving and removal, preserving durable data and button state', () => {
  const h = harness(); h.state.end = place(); h.context.savePlace('favourite', place());
  const saved = h.store.get('saved'); h.calls.blocked = true;
  assert.equal(h.context.persistSavedPlaces({...h.state.saved, favourites: []}), false);
  assert.equal(h.store.get('saved'), saved); assert.equal(h.state.saved.favourites.length, 1);
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Saved');
  h.state.end = place('two', 52.05); const result = h.context.savePlace('favourite', h.state.end);
  assert.equal(result.ok, false); h.context.syncSaveFavouriteButton();
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Save');
  assert.equal(h.store.get('saved'), saved); assert.match(h.calls.messages.at(-1), /storage is full or unavailable/);
});

test('malformed saved records cannot break loading; legitimate legacy/outside-area records survive', () => {
  const h = harness(), outside = place('outside', 53, -.75);
  h.store.set('saved', JSON.stringify({home: {name: 'Bad', lat: '52', lng: -.75}, work: outside,
    favourites: [null, {}, {...place(), lat: null}, {...place(), name: 1}, place(), outside]}));
  h.context.loadSavedPlaces(); assert.equal(h.state.saved.home, null); assert.equal(h.state.saved.work.lat, 53);
  assert.equal(h.state.saved.favourites.length, 2); h.context.syncSaveFavouriteButton();
  h.store.set('saved', 'null'); h.context.loadSavedPlaces(); assert.equal(h.state.saved.favourites.length, 0);
  h.store.set('saved', '{'); h.context.loadSavedPlaces(); assert.equal(h.state.saved.home, null);
});

test('new favourites respect the limit while more than thirty valid legacy entries are never silently erased', () => {
  const h = harness(), favourites = Array.from({length: 31}, (_, i) => place(String(i), 52.02 + i * .0001));
  h.store.set('saved', JSON.stringify({home: null, work: null, favourites})); h.context.loadSavedPlaces();
  assert.equal(h.state.saved.favourites.length, 31);
  const before = h.store.get('saved'); assert.equal(h.context.savePlace('favourite', place('new', 52.1)).ok, false);
  assert.equal(h.store.get('saved'), before); assert.match(h.calls.messages.at(-1), /30 favourites/);
  assert.equal(h.context.savePlace('home', place('home')).ok, true);
  assert.equal(JSON.parse(h.store.get('saved')).favourites.length, 31);
});

test('the thirty-first new favourite is refused without eviction and removal makes room', () => {
  const h = harness();
  for (let i = 0; i < 30; i++) assert.equal(h.context.savePlace('favourite', place(String(i), 52.02 + i * .0001)).ok, true);
  const before = h.store.get('saved'), candidate = place('new', 52.1);
  assert.equal(h.context.savePlace('favourite', candidate).ok, false);
  assert.equal(h.state.saved.favourites.length, 30); assert.equal(h.store.get('saved'), before);
  h.context.loadSavedPlaces(); assert.equal(h.state.saved.favourites.length, 30);
  assert.equal(h.context.persistSavedPlaces({...h.state.saved, favourites: h.state.saved.favourites.slice(1)}), true);
  assert.equal(h.context.savePlace('favourite', candidate).ok, true);
  assert.equal(h.state.saved.favourites.length, 30); assert.equal(h.state.saved.favourites[0].id, 'new');
});

test('map-picking cancellation prevents saving and stale long-press timers', () => {
  const h = harness(); h.context.beginSavedSearch('work'); h.click('cancelSavedPickBtn');
  assert.equal(h.state.pendingSaveKind, null); assert.equal(h.el('savedPlacePicker').hidden, true);
  h.context.beginSavedSearch('home');
  const event = {isPrimary: true, pointerType: 'touch', clientX: 100, clientY: 300, target: {closest: () => null}};
  h.handlers['map:pointerdown'](event); const callback = [...h.timers.values()][0];
  h.context.finishSavedSearch(); callback();
  assert.equal(h.calls.writes, 0); assert.equal(h.state.pendingSaveKind, null);
});

test('touch long-press saves the pin and consumes the release click on the new sheet', () => {
  const h = harness(); h.context.beginSavedSearch('work'); h.longPress();
  assert.equal(h.state.saved.work.name, 'Work'); assert.equal(h.calls.reverse, 0);
  assert.equal(h.releaseClick(), true); assert.equal(h.releaseClick(), false);
});

test('long-press protection permits keyboard, other-position clicks and a genuinely new gesture', () => {
  const h = harness(); h.context.beginSavedSearch('favourite'); h.longPress();
  assert.equal(h.releaseClick({detail: 0}), false);
  assert.equal(h.releaseClick({x: 180}), false);
  h.handlers['document:pointerdown']({});
  assert.equal(h.releaseClick(), false);
});

test('long-held touch stays guarded until release and the compatibility window then expires', () => {
  const h = harness(); h.context.beginSavedSearch('work'); h.longPress();
  h.calls.clock += 2500; h.handlers['document:pointerup']({});
  assert.equal(h.releaseClick(), true);
  const expired = harness(); expired.context.beginSavedSearch('work'); expired.longPress();
  expired.handlers['document:pointerup']({}); expired.calls.clock += 1001;
  assert.equal(expired.releaseClick(), false);
  const cancelled = harness(); cancelled.context.beginSavedSearch('work'); cancelled.longPress();
  cancelled.handlers['document:pointercancel']({}); assert.equal(cancelled.releaseClick(), false);
});

test('optional local pin names and distinct unnamed pin labels persist without a reverse lookup', () => {
  const h = harness();
  for (const [lat, expected] of [[52.04, 'Saved pin 1'], [52.05, 'Saved pin 2']]) {
    h.context.beginSavedSearch('favourite');
    h.context.savePendingMapPin({lat, lng: -.75});
    assert.equal(h.state.saved.favourites[0].name, expected);
  }
  h.context.beginSavedSearch('favourite'); h.el('savedFavouriteNameInput').value = '  Riverside start  ';
  h.context.savePendingMapPin({lat: 52.06, lng: -.75});
  assert.equal(h.state.saved.favourites[0].name, 'Riverside start');
  assert.equal(h.el('savedFavouriteNameInput').value, '');
  h.context.loadSavedPlaces();
  assert.deepEqual([...h.state.saved.favourites].map(p => p.name), ['Riverside start', 'Saved pin 2', 'Saved pin 1']);
  assert.equal(h.calls.reverse, 0);
});

test('an optional name also applies to selected search results, preserving their address and coordinates', () => {
  const h = harness(); h.context.beginSavedSearch('favourite');
  h.el('savedFavouriteNameInput').value = 'Lunch stop';
  h.context.selectSearchResult({name: 'Source venue', address: {road: 'Frobisher Gate'}, lat: 52.04, lon: -.75}, 'save-favourite');
  const favourite = h.state.saved.favourites[0];
  assert.equal(favourite.name, 'Lunch stop'); assert.equal(favourite.address, 'Frobisher Gate');
  assert.equal(favourite.lat, 52.04); assert.equal(favourite.lng, -.75);
  assert.equal(h.state.pendingSaveKind, null); assert.equal(h.calls.reverse, 0);
});

test('invalid optional names leave the picker open and durable data unchanged', () => {
  for (const name of ['x'.repeat(81), 'Name\nwith line break', 'Name\x00']) {
    const h = harness(); h.context.beginSavedSearch('favourite'); h.el('savedFavouriteNameInput').value = name;
    assert.equal(h.context.savePendingMapPin({lat: 52.04, lng: -.75}), true);
    assert.equal(h.calls.writes, 0); assert.equal(h.state.pendingSaveKind, 'favourite');
    assert.match(h.calls.messages.at(-1), /80 characters/);
  }
});

test('renaming changes only the favourite name and retains Saved membership across reload', () => {
  const h = harness(); h.state.end = place(); h.context.savePlace('favourite', place());
  const original = h.state.saved.favourites[0]; h.context.openFavouriteNameEditor(original);
  h.el('favouriteNameInput').value = '  Canal café <near bridge>  ';
  assert.equal(h.context.saveFavouriteName(), true);
  const renamed = h.state.saved.favourites[0];
  assert.equal(renamed.name, 'Canal café <near bridge>');
  for (const field of ['id', 'address', 'lat', 'lng']) assert.equal(renamed[field], original[field]);
  assert.equal(h.el('saveFavouriteLabel').textContent, 'Saved');
  assert.equal(h.el('favouriteNameEditor').hidden, true);
  h.context.loadSavedPlaces(); assert.equal(h.state.saved.favourites[0].name, 'Canal café <near bridge>');
  assert.equal(h.calls.reverse, 0);
});

test('rename validation, cancellation and blocked storage never replace the persisted name', () => {
  const h = harness(); h.context.savePlace('favourite', place()); const original = h.store.get('saved');
  h.context.openFavouriteNameEditor(h.state.saved.favourites[0]);
  for (const name of ['', '   ', 'x'.repeat(81), 'Name\n']) {
    h.el('favouriteNameInput').value = name;
    assert.equal(h.context.saveFavouriteName(), false); assert.equal(h.store.get('saved'), original);
  }
  h.el('favouriteNameInput').value = 'New name'; h.calls.blocked = true;
  assert.equal(h.context.saveFavouriteName(), false);
  assert.equal(h.state.saved.favourites[0].name, 'Chosen place');
  assert.equal(h.el('favouriteNameEditor').hidden, false); assert.equal(h.store.get('saved'), original);
  h.handlers['favouriteNameInput:keydown']({key: 'Escape', preventDefault() {}});
  assert.equal(h.el('favouriteNameEditor').hidden, true); assert.equal(h.state.favouriteNameTarget, null);
  assert.equal(h.store.get('saved'), original);
});

test('a rename cannot silently replace a concurrent name edit and preserves other current fields', () => {
  const h = harness(); h.context.savePlace('favourite', place());
  h.context.openFavouriteNameEditor(h.state.saved.favourites[0]);
  const changed = JSON.parse(h.store.get('saved')); changed.favourites[0].name = 'Edited in another tab';
  changed.home = place('home', 52.06); h.store.set('saved', JSON.stringify(changed));
  h.el('favouriteNameInput').value = 'My rename';
  assert.equal(h.context.saveFavouriteName(), false);
  assert.equal(JSON.parse(h.store.get('saved')).favourites[0].name, 'Edited in another tab');
  assert.equal(JSON.parse(h.store.get('saved')).home.id, 'home');
  assert.match(h.calls.messages.at(-1), /changed elsewhere/);
});

test('Undo restores only the removed favourite into the latest durable Home, Work and favourite edits', () => {
  const h = harness(); h.context.savePlace('favourite', place('first', 52.04));
  h.context.savePlace('favourite', place('second', 52.05));
  const removed = h.state.saved.favourites[1]; assert.equal(h.context.removeFavourite(removed), true);
  assert.equal(h.el('savedUndoNotice').hidden, false);
  const changed = JSON.parse(h.store.get('saved'));
  changed.home = place('home', 52.06); changed.work = place('work', 52.07);
  changed.favourites[0].name = 'Changed since deletion'; changed.favourites.unshift(place('third', 52.08));
  h.store.set('saved', JSON.stringify(changed));
  assert.equal(h.context.undoFavouriteRemoval(), true);
  const final = JSON.parse(h.store.get('saved'));
  assert.equal(final.home.id, 'home'); assert.equal(final.work.id, 'work');
  assert.equal(final.favourites.find(p => p.id === 'second').name, 'Changed since deletion');
  assert.equal(final.favourites.find(p => p.id === 'first').name, removed.name);
  assert.ok(final.favourites.some(p => p.id === 'third'));
  assert.equal(final.favourites.length, 3); assert.equal(h.el('savedUndoNotice').hidden, true);
});

test('Undo cannot duplicate a favourite re-added with a different id or replace its new name', () => {
  const h = harness(); h.context.savePlace('favourite', place());
  assert.equal(h.context.removeFavourite(h.state.saved.favourites[0]), true);
  const replacement = {...place('replacement'), name: 'New personal name'};
  h.store.set('saved', JSON.stringify({home: null, work: null, favourites: [replacement]}));
  const before = h.store.get('saved'); assert.equal(h.context.undoFavouriteRemoval(), false);
  assert.equal(h.store.get('saved'), before); assert.equal(h.state.saved.favourites.length, 1);
  assert.equal(h.state.saved.favourites[0].name, 'New personal name');
  assert.equal(h.el('savedUndoNotice').hidden, true);
});

test('Undo respects a full list after concurrent additions and stays available for retry', () => {
  const h = harness(); h.context.savePlace('favourite', place());
  h.context.removeFavourite(h.state.saved.favourites[0]);
  const favourites = Array.from({length: 30}, (_, i) => place('other-' + i, 52.02 + i * .0001));
  h.store.set('saved', JSON.stringify({home: null, work: null, favourites})); const before = h.store.get('saved');
  assert.equal(h.context.undoFavouriteRemoval(), false); assert.equal(h.store.get('saved'), before);
  assert.ok(h.state.favouriteUndo); assert.match(h.calls.messages.at(-1), /Remove another favourite/);
  favourites.pop(); h.store.set('saved', JSON.stringify({home: null, work: null, favourites}));
  assert.equal(h.context.undoFavouriteRemoval(), true);
  assert.equal(JSON.parse(h.store.get('saved')).favourites.length, 30);
});

test('storage failures roll back deletion and leave a failed Undo retryable', () => {
  const h = harness(); h.context.savePlace('favourite', place()); const favourite = h.state.saved.favourites[0];
  const before = h.store.get('saved'); h.calls.blocked = true;
  assert.equal(h.context.removeFavourite(favourite), false); assert.equal(h.store.get('saved'), before);
  assert.equal(h.state.saved.favourites.length, 1); assert.equal(h.state.favouriteUndo, undefined);
  h.calls.blocked = false; assert.equal(h.context.removeFavourite(favourite), true);
  const deleted = h.store.get('saved'); h.calls.blocked = true;
  assert.equal(h.context.undoFavouriteRemoval(), false); assert.equal(h.store.get('saved'), deleted);
  assert.equal(h.state.saved.favourites.length, 0); assert.ok(h.state.favouriteUndo);
  h.calls.blocked = false; assert.equal(h.context.undoFavouriteRemoval(), true);
  assert.equal(h.state.saved.favourites.length, 1);
});

test('Undo preserves a valid legacy list above thirty without enabling new-capacity eviction', () => {
  const h = harness(), favourites = Array.from({length: 31}, (_, i) => place(String(i), 52.02 + i * .0001));
  h.store.set('saved', JSON.stringify({home: null, work: null, favourites})); h.context.loadSavedPlaces();
  assert.equal(h.context.removeFavourite(h.state.saved.favourites[10]), true);
  assert.equal(h.context.undoFavouriteRemoval(), true);
  assert.deepEqual(JSON.parse(h.store.get('saved')).favourites.map(p => p.id), favourites.map(p => p.id));
});

test('unreadable or malformed durable data is never overwritten by Undo', () => {
  const h = harness(); h.context.savePlace('favourite', place()); h.context.removeFavourite(h.state.saved.favourites[0]);
  const valid = h.store.get('saved'); h.calls.readBlocked = true;
  assert.equal(h.context.undoFavouriteRemoval(), false); assert.equal(h.store.get('saved'), valid);
  h.calls.readBlocked = false; h.store.set('saved', '{');
  assert.equal(h.context.undoFavouriteRemoval(), false); assert.equal(h.store.get('saved'), '{');
  h.store.set('saved', valid); assert.equal(h.context.undoFavouriteRemoval(), true);
});

test('a Saved change between snapshot and write is detected instead of silently overwritten', () => {
  const h = harness(); h.context.savePlace('favourite', place()); const target = h.state.saved.favourites[0];
  const changed = JSON.parse(h.store.get('saved')); changed.work = place('new-work', 52.07);
  let reads = 0;
  h.calls.beforeRead = key => { if (++reads === 2) h.store.set(key, JSON.stringify(changed)); };
  assert.equal(h.context.removeFavourite(target), false);
  assert.equal(JSON.parse(h.store.get('saved')).work.id, 'new-work');
  assert.equal(JSON.parse(h.store.get('saved')).favourites.length, 1);
  assert.equal(h.state.favouriteUndo, undefined); assert.match(h.calls.messages.at(-1), /another tab/);
});
