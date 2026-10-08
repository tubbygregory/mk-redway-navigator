const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {parseBundledNetwork} = require('../routing.js');
const source = fs.readFileSync('app.js','utf8');
const scope = 'https://example.test/app/';
const mapUrl = new URL('data/mk-basemap.pmtiles',scope).href;
const graph = {format:'mk-redway-network-v6',
  nodes:Array.from({length:1000},(_,i)=>[i,52,-.75]),
  ways:Array.from({length:100},(_,i)=>[i,[i,i+1],{highway:'cycleway'}])};
const places = {format:'mk-redway-places-v1',source:'OpenStreetMap / Geofabrik',
  bounds:{south:51.955,west:-.905,north:52.155,east:-.615},source_sha256:'a'.repeat(64),
  source_timestamp:new Date(Date.now()-86400000).toISOString(),generated_at:new Date().toISOString(),
  entries:[{id:'n123',kind:'place',lat:52.04,lon:-.74,location:'mapped point',name:'Local cafe',category:'cafe'}]};

// Header/extent fixture for integrity checks, not a usable geographic basemap.
function mapBytes(size=100000,declaredSize=size) {
  const bytes=new Uint8Array(size);
  bytes.set([80,77,84,105,108,101,115,3]);
  if(size>=127) {
    const view=new DataView(bytes.buffer);
    view.setUint32(8,127,true);view.setUint32(16,1,true);
    view.setUint32(24,128,true);view.setUint32(32,2,true);
    view.setUint32(40,130,true);
    view.setUint32(56,130,true);view.setUint32(64,declaredSize-130,true);
  }
  return bytes;
}
function app(mapResponse=()=>new Response(mapBytes(),{headers:{'Content-Length':'100000'}})) {
  const stores=new Map(), elements={offlineStatus:{},offlineDownloadBtn:{}}, messages=[];
  const key=url=>new URL(url,scope).href;
  const cache={
    async put(url,response){if(context.full)throw Error('Quota exceeded');stores.set(key(url),response.clone());},
    async match(url){return stores.get(key(url))?.clone();},
    async delete(url){return stores.delete(key(url));}
  };
  const context=vm.createContext({URL,Response,Blob,Uint8Array,DataView,parseBundledNetwork,MK:places.bounds,
    window:{caches:{}},caches:{open:async()=>cache,match:cache.match},
    location:{href:scope},OFFLINE_MAP_URL:'./data/mk-basemap.pmtiles',OFFLINE_CACHE:'offline',
    navigator:{onLine:true,storage:{persist:async()=>true}},
    state:{offlineMapAvailable:true,offlineMapDownloaded:false,offlineDownloadBusy:false},
    el:id=>elements[id],toast:msg=>messages.push(msg),console:{warn(){},error(){}},
    activatePackagedBasemap:async()=>true,
    fetch:async(url,options)=>{
      if(url.endsWith('mk-basemap.pmtiles'))return mapResponse(options);
      if(url.endsWith('places.json'))return context.placeResponse ? context.placeResponse() : new Response(JSON.stringify(places));
      return new Response(url.endsWith('network.json')?JSON.stringify(graph):'dependency');
    }
  });
  const helpers=source.slice(source.indexOf('  function humanBytes('),source.indexOf('  async function activatePackagedBasemap('));
  const download=source.slice(source.indexOf('  async function cacheOfflineDependencies('),source.indexOf("  el('offlineDownloadBtn').addEventListener"));
  const placeHelpers=source.slice(source.indexOf('  function validateSearchResult('),source.indexOf('  function conciseResultName('))+
    source.slice(source.indexOf('  function searchWords('),source.indexOf('  async function loadPlaceIndex('))+
    source.slice(source.indexOf('  function normalizeSearchQuery('),source.indexOf('  let geocodeGate'));
  vm.runInContext(placeHelpers+helpers+download,context);
  return {context,cache,stores,elements,messages};
}

test('offline download rejects empty, HTML, partial and truncated basemaps before caching',async()=>{
  const html=new Uint8Array(100000);html.set(Buffer.from('<html>upstream error</html>'));
  const badResponses=[
    ()=>new Response(''),()=>new Response(html),()=>new Response(mapBytes(127)),
    ()=>new Response(mapBytes(),{status:206}),
    ()=>new Response(mapBytes(),{headers:{'Content-Length':'100001'}}),
    ()=>new Response(mapBytes(100000,200000))
  ];
  for(const response of badResponses) {
    const a=app(response);await a.context.downloadOfflineMap();
    assert.equal(a.context.state.offlineMapDownloaded,false);
    assert.equal(a.stores.has(mapUrl),false);
    assert.equal(a.messages.at(-1),'Offline map download failed');
    assert.match(a.elements.offlineStatus.textContent,/Download failed/);
    assert.equal(a.elements.offlineDownloadBtn.disabled,false);
  }
});
test('complete maps become offline-ready only after map and graph storage succeeds',async()=>{
  const a=app();await a.context.downloadOfflineMap();
  assert.equal(a.context.state.offlineMapDownloaded,true);
  assert.equal(a.context.state.offlineMapBytes,100000);
  assert.equal(a.elements.offlineDownloadBtn.textContent,'Remove');
  assert.match(a.elements.offlineStatus.textContent,/^Ready for offline journeys/);
  assert.match(a.elements.offlineStatus.textContent,/98 KB/);
  assert.equal(await a.context.offlineMapCached(),true);
  assert.ok(a.stores.has(new URL('data/network.json',scope).href));
  const full=app();full.context.full=true;await full.context.downloadOfflineMap();
  assert.equal(full.context.state.offlineMapDownloaded,false);
  assert.match(full.elements.offlineStatus.textContent,/device storage/);
  const failed=app(()=>new Response('unavailable',{status:503}));await failed.context.downloadOfflineMap();
  assert.equal(failed.context.state.offlineMapDownloaded,false);
  assert.equal(failed.stores.has(mapUrl),false);
});
test('HTTP-encoded download lengths are not mistaken for decoded map lengths',async()=>{
  const a=app(()=>new Response(mapBytes(),{headers:{'Content-Length':'12345','Content-Encoding':'gzip'}}));
  await a.context.downloadOfflineMap();
  assert.equal(a.context.state.offlineMapDownloaded,true);
});
test('offline dependencies validate local places before storing and preserve a good asset after malformed HTTP200',async()=>{
  const url=new URL('data/places.json',scope).href;
  for(const body of ['<html>upstream failure</html>',JSON.stringify({...places,entries:[]}),
    JSON.stringify({...places,entries:[{...places.entries[0],location:'building centre'}]})]) {
    const a=app();await a.cache.put(url,new Response(JSON.stringify(places)));
    a.context.placeResponse=()=>new Response(body);
    await a.context.cacheOfflineDependencies(a.cache);
    assert.deepEqual(await (await a.cache.match(url)).json(),places);
  }
  const valid=app();await valid.context.cacheOfflineDependencies(valid.cache);
  assert.deepEqual(await (await valid.cache.match(url)).json(),places);
});
test('repeated Retry taps cannot start duplicate downloads after delayed availability probes',async()=>{
  let resolveHead,downloads=0;
  const head=new Promise(resolve=>{resolveHead=resolve;});
  const a=app(options=>{
    if(options?.method==='HEAD')return head;
    downloads++;
    return new Response(mapBytes(),{headers:{'Content-Length':'100000'}});
  });
  a.context.state.offlineMapAvailable=false;
  const first=a.context.downloadOfflineMap(),second=a.context.downloadOfflineMap();
  resolveHead(new Response(null,{headers:{'Content-Length':'100000'}}));
  await Promise.all([first,second]);
  assert.equal(downloads,1);
  assert.equal(a.context.state.offlineMapDownloaded,true);
});
test('invalid old cached basemaps are removed before readiness and can be retried',async()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array(100000),mapBytes(100000,200000)]) {
    const a=app();
    await a.cache.put(mapUrl,new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}));
    await a.cache.put('data/network.json',new Response(JSON.stringify(graph)));
    assert.equal(await a.context.offlineMapCached(),false);
    assert.equal(a.stores.has(mapUrl),false);
    await a.context.downloadOfflineMap();
    assert.equal(a.context.state.offlineMapDownloaded,true);
  }
});
test('cached-map validation reads only its header and requires a successful graph response',async()=>{
  const a=app();let reads=0,cancelled=false;
  assert.equal(await a.context.validCachedOfflineMap({status:200,
    headers:new Headers({'Content-Length':'100000'}),
    body:{getReader:()=>({async read(){assert.equal(++reads,1);return{done:false,value:mapBytes().subarray(0,127)};},
      async cancel(){cancelled=true;}})}
  }),true);
  assert.equal(cancelled,true);
  await a.cache.put(mapUrl,new Response(mapBytes(),{headers:{'Content-Length':'100000'}}));
  assert.equal(await a.context.offlineMapCached(),false);
  await a.cache.put('data/network.json',new Response('unavailable',{status:503}));
  assert.equal(await a.context.offlineMapCached(),false);
});
test('existing HTTP200 graph caches must contain a complete valid routing network',async()=>{
  for(const body of [
    'not JSON',JSON.stringify({format:'unsupported',nodes:[],ways:[]}),
    JSON.stringify({...graph,ways:graph.ways.slice(0,99)}),
    JSON.stringify({...graph,nodes:graph.nodes.slice(0,999)})
  ]) {
    const a=app();
    await a.cache.put(mapUrl,new Response(mapBytes(),{headers:{'Content-Length':'100000'}}));
    await a.cache.put('data/network.json',new Response(body));
    assert.equal(await a.context.offlineMapCached(),false);
    await a.context.probeOfflineMap();
    assert.equal(a.context.state.offlineMapDownloaded,false);
    assert.doesNotMatch(a.elements.offlineStatus.textContent,/available offline/);
    assert.doesNotMatch(a.elements.offlineStatus.textContent,/Ready for offline journeys/);
  }
  const valid=app();
  await valid.cache.put(mapUrl,new Response(mapBytes(),{headers:{'Content-Length':'100000'}}));
  await valid.cache.put('data/network.json',new Response(JSON.stringify(graph)));
  assert.equal(await valid.context.offlineMapCached(),true);
});
test('availability messages distinguish disconnected, server-error and absent deployments',async()=>{
  const offline=app(()=>{throw Error('Offline');});
  offline.context.navigator.onLine=false;
  assert.equal(await offline.context.probeOfflineMap(),false);
  assert.match(offline.elements.offlineStatus.textContent,/Connect to download/);
  assert.equal(offline.elements.offlineDownloadBtn.textContent,'Retry');
  assert.equal(offline.elements.offlineDownloadBtn.disabled,false);
  for(const status of [404,503]) {
    const a=app(()=>new Response(null,{status}));
    assert.equal(await a.context.probeOfflineMap(),false);
    assert.match(a.elements.offlineStatus.textContent,status===404?/not available in this deployment/:/Could not check/);
    assert.equal(a.elements.offlineDownloadBtn.disabled,status===404);
  }
  const cached=app(()=>new Response(null,{status:503}));
  await cached.cache.put(mapUrl,new Response(mapBytes(),{headers:{'Content-Length':'100000'}}));
  await cached.cache.put('data/network.json',new Response(JSON.stringify(graph)));
  assert.equal(await cached.context.probeOfflineMap(),true);
  assert.equal(cached.context.state.offlineMapDownloaded,true);
  assert.match(cached.elements.offlineStatus.textContent,/available offline/);
});
