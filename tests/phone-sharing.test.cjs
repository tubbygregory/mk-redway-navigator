const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app.js', 'utf8');
function code(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'Missing application sharing function: ' + from);
  return source.slice(start, end);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function denied(name = 'NotAllowedError') {
  return Object.assign(new Error('Optional browser action unavailable'), {name});
}
function harness({clipboard, share, canShare, href = 'https://example.test/mk-redway/?obsolete=1'} = {}) {
  const elements = {}, calls = {clipboard: [], share: [], downloads: [], prompts: 0,
    cancelLocation: 0, cancelNavigation: 0, gps: 0}, messages = [];
  const state = {route: {coords: [[52.0467, -.7378], [52.025, -.783]]},
    routeRevision: 7, stage: 'planner', start: {lat: 52.0467, lng: -.7378},
    end: {lat: 52.025, lng: -.783}, startLabel: 'Private saved starting label',
    endLabel: 'Private saved destination label', mode: 'cycle', pref: 'maximum',
    preferLit: false, preferSuper: false, importedRouteName: '', culturalRoute: null,
    phoneShare: null, phoneShareRevision: 0, navigating: false};
  const document = {activeElement: null};
  const el = id => elements[id] || (elements[id] = {
    id, hidden: false, disabled: false, value: '', textContent: '', open: false,
    dataset: {}, style: {}, isConnected: true, selections: 0,
    classList: {add() {}, remove() {}, toggle() {}, contains: () => false},
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() { document.activeElement = this; },
    select() { this.selections++; this.selectionStart = 0; this.selectionEnd = this.value.length; },
    setSelectionRange(start, end) { this.selections++; this.selectionStart = start; this.selectionEnd = end; },
    addEventListener() {},
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; },
    getClientRects() { return this.hidden ? [] : [{width: 300, height: 48}]; }
  });
  const navigator = {geolocation: {
    getCurrentPosition() { calls.gps++; }, watchPosition() { calls.gps++; }
  }};
  if (clipboard) navigator.clipboard = {async writeText(text) {
    calls.clipboard.push(text); return clipboard(text);
  }};
  if (share) navigator.share = async data => { calls.share.push(data); return share(data); };
  if (canShare) navigator.canShare = canShare;
  class TestFile {
    constructor(parts, name, options = {}) {
      this.content = parts.map(String).join(''); this.name = name;
      this.type = options.type || ''; this.size = Buffer.byteLength(this.content);
    }
    async text() { return this.content; }
  }
  const window = {navigator, innerWidth: 1280, isSecureContext: true,
    prompt() { calls.prompts++; throw new Error('Sharing must not depend on a browser prompt'); }};
  const context = vm.createContext({state, el, document, navigator, window, URL, File: TestFile,
    location: {href}, console: {warn() {}}, toast: message => messages.push(message),
    cancelStartLocation() { calls.cancelLocation++; },
    cancelNavigationStart() { calls.cancelNavigation++; },
    downloadText(filename, text, type) { calls.downloads.push({filename, text, type}); }});
  vm.runInContext(code('  function xmlEscape(', '  function downloadText('), context);
  vm.runInContext(code('  function routeShareUrl(', '  function restoreSharedRoute('), context);
  document.activeElement = el('sendToPhoneBtn');
  return {context, state, el, calls, messages, document};
}

test('Send to phone opens a persistent link dialog synchronously without initiating transfer or GPS', async () => {
  const h = harness({clipboard: async () => {}, share: async () => {}});
  h.state.mode = 'walk'; h.state.pref = 'fastest';
  h.state.preferLit = h.state.preferSuper = true;
  const opening = h.context.sendRouteToPhone();
  assert.equal(h.el('phoneShareDialog').open, true, 'The click must immediately produce app UI');
  await opening;
  assert.equal(h.state.phoneShare.kind, 'link');
  const url = new URL(h.el('phoneShareLink').value);
  assert.equal(url.origin + url.pathname, 'https://example.test/mk-redway/');
  assert.equal(url.searchParams.get('from'), '52.046700,-0.737800');
  assert.equal(url.searchParams.get('to'), '52.025000,-0.783000');
  assert.equal(url.searchParams.get('mode'), 'walk');
  assert.equal(url.searchParams.get('pref'), 'fastest');
  assert.equal(url.searchParams.get('lit'), '1');
  assert.equal(url.searchParams.get('super'), '1');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['from', 'lit', 'mode', 'pref', 'super', 'to']);
  assert.ok(!url.href.includes('Private'), 'Saved names must not leak into route links');
  assert.equal(h.el('phoneShareLinkField').hidden, false);
  assert.equal(h.calls.clipboard.length + h.calls.share.length + h.calls.downloads.length, 0);
  assert.equal(h.calls.prompts, 0); assert.equal(h.calls.gps, 0);
  assert.ok(h.calls.cancelLocation > 0 && h.calls.cancelNavigation > 0,
    'Opening transfer UI must cancel pending navigation/location starts');
});

test('a route must exist before opening phone transfer', async () => {
  const h = harness(); h.state.route = null;
  await h.context.sendRouteToPhone();
  assert.equal(h.el('phoneShareDialog').open, false);
  assert.equal(h.calls.downloads.length + h.calls.share.length + h.calls.clipboard.length, 0);
});

test('explicit Copy copies the displayed link and leaves visible confirmation and manual fallback', async () => {
  const h = harness({clipboard: async () => {}});
  await h.context.sendRouteToPhone();
  const link = h.el('phoneShareLink').value;
  await h.context.copyPhoneRoute();
  assert.deepEqual(h.calls.clipboard, [link]);
  assert.match(h.el('phoneShareStatus').textContent, /copied/i);
  assert.equal(h.el('phoneShareDialog').open, true);
  assert.equal(h.el('phoneShareLink').value, link);
  assert.equal(h.calls.prompts, 0);
});

test('denied or unavailable clipboard retains a selected link and persistent manual-copy guidance', async () => {
  for (const clipboard of [undefined, async () => { throw denied(); }]) {
    const h = harness({clipboard});
    await h.context.sendRouteToPhone();
    await h.context.copyPhoneRoute();
    assert.equal(h.el('phoneShareDialog').open, true);
    assert.ok(h.el('phoneShareLink').selections > 0);
    assert.equal(h.el('phoneShareLink').selectionStart, 0);
    assert.equal(h.el('phoneShareLink').selectionEnd, h.el('phoneShareLink').value.length);
    assert.match(h.el('phoneShareStatus').textContent, /copy|select|clipboard/i);
    assert.equal(h.calls.prompts, 0);
    assert.equal(h.el('phoneShareCopyBtn').disabled, false);
  }
});

test('native link sharing occurs only after its explicit action and shares the displayed route', async () => {
  const h = harness({share: async () => {}});
  await h.context.sendRouteToPhone();
  assert.equal(h.calls.share.length, 0);
  await h.context.sharePhoneRoute();
  assert.equal(h.calls.share.length, 1);
  assert.equal(h.calls.share[0].url, h.el('phoneShareLink').value);
  assert.equal(h.calls.share[0].files, undefined);
  assert.equal(h.calls.gps, 0);
});

test('failed or cancelled native sharing retains copy/manual transfer instead of silently returning', async () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    const h = harness({share: async () => { throw denied(name); }});
    await h.context.sendRouteToPhone();
    const payload = h.state.phoneShare, link = h.el('phoneShareLink').value;
    await h.context.sharePhoneRoute();
    assert.equal(h.el('phoneShareDialog').open, true);
    assert.equal(h.state.phoneShare, payload);
    assert.equal(h.el('phoneShareLinkField').hidden, false);
    assert.equal(h.el('phoneShareLink').value, link);
    assert.equal(h.el('phoneShareCopyBtn').disabled, false);
    assert.equal(h.el('phoneShareNativeBtn').disabled, false);
    assert.equal(h.calls.prompts, 0);
    if (name !== 'AbortError') assert.match(h.el('phoneShareStatus').textContent, /copy|share|link/i);
  }
});

test('late clipboard success or failure cannot overwrite a closed/reopened route transfer', async () => {
  for (const fail of [false, true]) {
    const waiting = deferred(), h = harness({clipboard: () => waiting.promise});
    await h.context.sendRouteToPhone();
    const copying = h.context.copyPhoneRoute();
    h.context.closePhoneShare();
    assert.equal(h.state.phoneShare, null);
    assert.equal(h.el('phoneShareDialog').open, false);
    h.state.end = {lat: 52.04, lng: -.75}; h.state.routeRevision++;
    await h.context.sendRouteToPhone();
    const payload = h.state.phoneShare, link = h.el('phoneShareLink').value;
    const status = h.el('phoneShareStatus').textContent;
    const selections = h.el('phoneShareLink').selections;
    if (fail) waiting.reject(denied()); else waiting.resolve();
    await copying;
    assert.equal(h.state.phoneShare, payload);
    assert.equal(h.el('phoneShareLink').value, link);
    assert.equal(h.el('phoneShareStatus').textContent, status);
    assert.equal(h.el('phoneShareLink').selections, selections);
  }
});

test('late native share completion cannot overwrite a newer transfer', async () => {
  for (const fail of [false, true]) {
    const waiting = deferred(), h = harness({share: () => waiting.promise});
    await h.context.sendRouteToPhone();
    const sharing = h.context.sharePhoneRoute();
    h.context.closePhoneShare(); h.state.routeRevision++;
    h.state.end = {lat: 52.04, lng: -.75};
    await h.context.sendRouteToPhone();
    const payload = h.state.phoneShare, status = h.el('phoneShareStatus').textContent;
    if (fail) waiting.reject(denied()); else waiting.resolve();
    await sharing;
    assert.equal(h.state.phoneShare, payload);
    assert.equal(h.el('phoneShareStatus').textContent, status);
    assert.equal(h.el('phoneShareDialog').open, true);
  }
});

function imported(h) {
  h.state.route = {imported: true, coords: [[55.95, -3.19], [55.952, -3.188]]};
  h.state.importedRouteName = 'Ride <river> & park';
}

test('imported outside-MK geometry transfers as explicit GPX with escaped metadata, not an endpoint link', async () => {
  const h = harness(); imported(h);
  await h.context.sendRouteToPhone();
  assert.equal(h.state.phoneShare.kind, 'gpx');
  assert.equal(h.el('phoneShareLinkField').hidden, true);
  assert.equal(h.el('phoneShareDownloadBtn').hidden, false);
  assert.equal(h.calls.downloads.length, 0, 'Opening transfer must not silently download');
  h.context.downloadPhoneGpx();
  assert.equal(h.calls.downloads.length, 1);
  const file = h.calls.downloads[0];
  assert.equal(file.type, 'application/gpx+xml');
  assert.match(file.filename, /\.gpx$/);
  assert.equal((file.text.match(/<trkpt /g) || []).length, 2);
  assert.match(file.text, /lat="55\.950000" lon="-3\.190000"/);
  assert.match(file.text, /Ride &lt;river&gt; &amp; park/);
  assert.ok(!file.text.includes('<river>'));
});

test('unsupported or throwing native file capability keeps an explicit GPX download available', async () => {
  for (const canShare of [() => false, () => { throw denied(); }]) {
    const h = harness({share: async () => {}, canShare}); imported(h);
    await h.context.sendRouteToPhone();
    assert.equal(h.el('phoneShareNativeBtn').hidden, true);
    assert.equal(h.el('phoneShareDownloadBtn').hidden, false);
    assert.equal(h.calls.share.length, 0);
    h.context.downloadPhoneGpx();
    assert.equal(h.calls.downloads.length, 1);
  }
});

test('supported native GPX sharing uses the same source file as the explicit download', async () => {
  const h = harness({share: async () => {}, canShare: () => true}); imported(h);
  await h.context.sendRouteToPhone();
  assert.equal(h.calls.share.length, 0);
  assert.equal(h.el('phoneShareNativeBtn').hidden, false);
  await h.context.sharePhoneRoute();
  assert.equal(h.calls.share.length, 1);
  assert.equal(h.calls.share[0].files.length, 1);
  const native = h.calls.share[0].files[0];
  assert.equal(native.type, 'application/gpx+xml');
  h.context.downloadPhoneGpx();
  assert.equal(await native.text(), h.calls.downloads[0].text);
});

test('native GPX failure still leaves the original file downloadable', async () => {
  const h = harness({share: async () => { throw denied(); }, canShare: () => true}); imported(h);
  await h.context.sendRouteToPhone();
  await h.context.sharePhoneRoute();
  assert.equal(h.el('phoneShareDialog').open, true);
  assert.equal(h.el('phoneShareDownloadBtn').hidden, false);
  h.context.downloadPhoneGpx();
  assert.equal(h.calls.downloads.length, 1);
  assert.match(h.calls.downloads[0].text, /lat="55\.950000" lon="-3\.190000"/);
});

test('Cultural sharing during a red joining leg exports unchanged source geometry, excluding the connector', async () => {
  const h = harness();
  h.state.route = {coords: [[52.04, -.75], [52.05, -.74]]};
  h.state.culturalRoute = {phase: 'joining', title: 'Blue & original route',
    sourceCoords: [[52.05, -.74], [52.06, -.73], [52.05, -.74]]};
  await h.context.sendRouteToPhone();
  assert.equal(h.state.phoneShare.kind, 'gpx');
  assert.equal(h.calls.downloads.length, 0);
  h.context.downloadPhoneGpx();
  const text = h.calls.downloads[0].text;
  assert.equal((text.match(/<trkpt /g) || []).length, 3);
  assert.match(text, /Blue &amp; original route/);
  assert.ok(!text.includes('lat="52.040000"'));
  assert.equal((text.match(/lat="52\.050000" lon="-0\.740000"/g) || []).length, 2);
});

test('closing and reopening transfer clears payloads and advances the cancellation revision', async () => {
  const h = harness();
  await h.context.sendRouteToPhone();
  const first = h.state.phoneShare, revision = h.state.phoneShareRevision;
  h.context.closePhoneShare();
  assert.equal(h.state.phoneShare, null);
  assert.equal(h.el('phoneShareDialog').open, false);
  assert.ok(h.state.phoneShareRevision > revision);
  await h.context.sendRouteToPhone();
  assert.notEqual(h.state.phoneShare, first);
  assert.ok(h.state.phoneShareRevision > revision);
});
