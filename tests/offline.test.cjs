const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('sw.js', 'utf8');
function worker(scope = 'https://example.test/app/') {
  const listeners = {}, stores = new Map();
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const caches = {
    async open(name) {
      if (context.failOpen) throw Error('Storage disabled');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { async match(request) { if (context.failMatch) throw Error('Storage read failed'); return store.get(key(request))?.clone(); },
        async put(request, response) { if (context.full) throw Error('Quota'); store.set(key(request), response.clone()); } };
    },
    async match(request) { if (context.failMatch) throw Error('Storage read failed'); for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone(); },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); }
  };
  const context = vm.createContext({URL, Request, Response, Blob, caches,
    fetch: async request => context.network(request),
    self: {registration:{scope}, location:{origin:new URL(scope).origin}, clients:{claim:async()=>{context.claimed=true;}},
      skipWaiting(){}, addEventListener(name, fn){listeners[name]=fn;}}});
  context.network = async () => {throw Error('Offline');};
  vm.runInContext(source, context);
  return {context, caches, stores, async put(name,path,body){await (await caches.open(name)).put(path,new Response(body));},
    async activate(){let result;listeners.activate({waitUntil(p){result=p;}});await result;},
    async request(path,{mode='cors',method='GET',headers={}}={}) {let result;
      listeners.fetch({request:{url:key(path),mode,method,headers:new Headers(headers)},respondWith(p){result=p;}});
      return result;
    }};
}
const shell = /const SHELL_CACHE = '([^']+)'/.exec(source)[1];
const offline = 'mk-redway-offline-v1';
test('unseen shared routes open the app shell offline at root and subpath', async()=>{
  for (const scope of ['https://example.test/','https://example.test/app/']) {
    const w=worker(scope); await w.put(shell,'index.html','app');
    assert.equal(await (await w.request('?from=52,-.7&to=52.01,-.71',{mode:'navigate'})).text(),'app');
    await assert.rejects(w.request('missing.html',{mode:'navigate'}),/Offline/);
  }
});
test('network HTTP errors fall back to the persistent routing graph',async()=>{
  const w=worker(); await w.put(offline,'data/network.json','graph');
  w.context.network=async()=>new Response('Unavailable',{status:503});
  assert.equal(await(await w.request('data/network.json')).text(),'graph');
});
test('successful graphs survive shell updates and failed cache writes',async()=>{
  const w=worker(); await w.put('mk-redway-shell-old','data/network.json','old graph');
  await w.activate(); assert.equal(w.stores.has('mk-redway-shell-old'),false);
  assert.equal(await(await w.request('data/network.json')).text(),'old graph');
  w.context.network=async()=>new Response('new graph');
  assert.equal(await(await w.request('data/network.json')).text(),'new graph');
  w.context.network=async()=>{throw Error('Offline');};
  assert.equal(await(await w.request('data/network.json')).text(),'new graph');
  w.context.full=true; w.context.network=async()=>new Response('valid');
  assert.equal(await(await w.request('asset.js')).text(),'valid');
});
test('HTTP failures never poison the shell cache',async()=>{
  const w=worker();let count=0; w.context.network=async()=>{count++; return new Response(count===1?'error':'good',{status:count===1?503:200});};
  assert.equal((await w.request('asset.js')).status,503);
  assert.equal(await(await w.request('asset.js')).text(),'good');assert.equal(count,2);
});
test('PMTiles requests are scoped and cached range responses stay readable',async()=>{
  const w=worker();await w.put(offline,'data/mk-basemap.pmtiles','0123456789');
  assert.equal(await w.request('https://other.test/data/mk-basemap.pmtiles'),undefined);
  assert.equal(await w.request('https://example.test/other/data/mk-basemap.pmtiles'),undefined);
  const part=await w.request('data/mk-basemap.pmtiles',{headers:{Range:'bytes=2-4'}});
  assert.equal(part.status,206);assert.equal(await part.text(),'234');
  assert.equal(await(await w.request('data/mk-basemap.pmtiles',{headers:{Range:'unsupported'}})).text(),'0123456789');
});
test('storage open/read failures preserve online shell, graph and PMTiles responses',async()=>{
  for (const failure of ['failOpen','failMatch']) {
    const w=worker();w.context[failure]=true;
    let requests=0;
    w.context.network=async request=>{
      requests++;
      return new Response(request.method==='HEAD'?null:'online', {status:request.headers.get('Range')?206:200});
    };
    for (const [path,options] of [
      ['?to=52,-.7',{mode:'navigate'}],['app.js',{}],['data/network.json',{}],
      ['data/mk-basemap.pmtiles',{}],['data/mk-basemap.pmtiles',{method:'HEAD'}],
      ['data/mk-basemap.pmtiles',{headers:{Range:'bytes=0-7'}}]
    ]) {
      const response=await w.request(path,options);
      assert.equal(response.status,options.headers?206:200);
      assert.equal(await response.text(),options.method==='HEAD'?'':'online');
    }
    assert.equal(requests,6,'Each unavailable cache must fall through to a single network request');
    w.context.network=async()=>new Response('temporarily unavailable',{status:503});
    assert.equal((await w.request('data/network.json')).status,503);
  }
});
test('failed graph migration preserves older shell storage and claims clients',async()=>{
  for (const failure of ['full','failOpen','failMatch']) {
    const w=worker();await w.put('mk-redway-shell-old','data/network.json','retained graph');
    w.context[failure]=true;
    await w.activate();
    assert.equal(w.context.claimed,true);
    assert.equal(w.stores.has('mk-redway-shell-old'),true);
    w.context[failure]=false;
    assert.equal(await(await w.request('data/network.json')).text(),'retained graph');
  }
});
