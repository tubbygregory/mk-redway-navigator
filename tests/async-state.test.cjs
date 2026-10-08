const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const app = fs.readFileSync('app.js','utf8');
// Exercise the actual application functions with controlled browser dependencies.
function code(from,to){return app.slice(app.indexOf(from),app.indexOf(to));}
function navigation(){
  let resolve; const state={route:{},routeRevision:1,stage:'planner',navigating:false};
  const context=vm.createContext({state,navigator:{geolocation:{}},unlockSpeechFromGesture(){},toast(){},
    acquireCurrentLocation:()=>new Promise(r=>{resolve=r;}),navigationStartRevision:0,navigationStartPending:false});
  vm.runInContext(code('  async function startNavigation()', '  function stopNavigation('),context);
  return {state,context,finish(){resolve({latlng:{lat:52,lng:-.7},accuracy:10});}};
}
test('late Start location cannot resume after leaving planner or changing the route',async()=>{
  for (const cancel of [s=>s.stage='place',s=>{s.route=null;s.routeRevision++;}]) {
    const n=navigation(); const pending=n.context.startNavigation();cancel(n.state);n.finish();await pending;
    assert.equal(n.state.navigating,false); assert.equal(n.context.navigationStartPending,false);
  }
});
test('repeated Start taps share one pending request',async()=>{
  const n=navigation();const pending=n.context.startNavigation(); await n.context.startNavigation();
  n.state.stage='place';n.finish();await pending;assert.equal(n.state.navigating,false);
});
test('inaccurate generated-route fixes cannot announce or trigger rerouting',()=>{
  const elements={}; const state={route:{},navigating:true,themeChoice:'light',offRouteCount:1};
  const context=vm.createContext({state,Date,L:{latLng:(lat,lng)=>({lat,lng})},setUserMarker(){},
    el:id=>(elements[id]??={}),nearestOnRoute(){throw Error('Must not advance on poor GPS');}});
  vm.runInContext(code('  function updateNavigation(position)', '  async function rerouteFromPosition('),context);
  for(const accuracy of [250,NaN,undefined,-1]) {
    context.updateNavigation({coords:{latitude:52,longitude:-.7,accuracy}});
    assert.equal(state.offRouteCount,0);assert.equal(elements.turnText.textContent,'Waiting for an accurate location');
  }
});
test('superseded basemap load and timeout cannot remove or select its replacement',async()=>{
  const layers=new Set(), timers=[], made=[];const online={};layers.add(online);
  const context=vm.createContext({state:{offlineMapAvailable:true},offlineVectorLayer:null,baseLayer:online,
    OFFLINE_MAP_URL:'map',effectiveTheme:()=> 'light',console,setTimeout:fn=>timers.push(fn),
    map:{hasLayer:l=>layers.has(l),removeLayer:l=>layers.delete(l)},
    window:{protomapsL:{leafletLayer(){const layer={on(event,fn){this.load=fn;},addTo(){layers.add(this);}};made.push(layer);return layer;}}}});
  vm.runInContext(code('  async function activatePackagedBasemap()', '  async function cacheOfflineDependencies('),context);
  await context.activatePackagedBasemap(); layers.delete(made[0]);context.offlineVectorLayer=null;
  await context.activatePackagedBasemap();made[0].load();timers[0]();
  assert.equal(context.offlineVectorLayer,made[1]);assert.ok(layers.has(made[1]));assert.equal(context.baseLayer,online);
  made[1].load();assert.equal(context.baseLayer,made[1]);assert.equal(layers.has(online),false);
});
test('simultaneous forward/reverse requests receive distinct geocoder time slots',async()=>{
  let clock=5000;const waits=[];
  const context=vm.createContext({state:{lastGeocodeAt:5000},Date:{now:()=>clock},sleep:async ms=>{waits.push(ms);clock+=ms;}});
  vm.runInContext(code('  let geocodeGate =', '  async function geocode('),context);
  await Promise.all([context.waitForGeocoder(),context.waitForGeocoder(),context.waitForGeocoder()]);
  assert.deepEqual(waits,[1050,1050,1050]);assert.equal(clock,8150);
});
test('offline download cannot report success without usable routing data',async()=>{
  const {parseBundledNetwork}=require('../routing.js');
  const context=vm.createContext({URL,location:{href:'https://example.test/app/'},console:{warn(){}},
    fetch:async()=>new Response('unavailable',{status:503}),parseBundledNetwork});
  vm.runInContext(code('  async function cacheOfflineDependencies(', '  async function downloadOfflineMap('),context);
  await assert.rejects(context.cacheOfflineDependencies({put(){throw Error('not expected');},match:async()=>undefined}),/could not be downloaded/);
  await assert.rejects(context.cacheOfflineDependencies({match:async()=>new Response('{"format":"bad"}')}),/unsupported format/);
});
