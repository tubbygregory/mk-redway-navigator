const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../routing.js');
const fs=require('node:fs');
const network=(nodes,ways)=>({nodes:new Map(nodes.map(([id,lat,lon])=>[id,{id,lat,lon}])),ways:ways.map(([id,nodes,tags])=>({id,nodes,tags}))});
const tags={highway:'cycleway',_mk_class:'redway'};

test('frontend accepts generated v6 and rejects incompatible data',()=>{
 assert.doesNotThrow(()=>R.parseBundledNetwork({format:'mk-redway-network-v6',nodes:[],ways:[]}));
 assert.throws(()=>R.parseBundledNetwork({format:'mk-redway-network-v99',nodes:[],ways:[]}));
});
test('explicit council classifications take precedence; legal access still applies',()=>{
 for(const [value,expected] of [['redway','redway'],['super_redway','superredway'],['leisure','leisure']]) assert.equal(R.edgeClass({highway:'path',_mk_class:value}),expected);
 assert.equal(R.allowed({...tags,bicycle:'no'},'cycle'),false);
 assert.equal(R.allowed({...tags,access:'private'},'cycle'),false);
});
test('same-edge projections preserve distance, directions and original graph',()=>{
 const p=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],tags]]),g=R.buildGraph(p,'cycle','maximum');
 const a={lat:52,lng:-.778},b={lat:52,lng:-.772};
 const plan=R.planRoute(p,g,a,b);
 assert.ok(Math.abs(plan.networkDist-R.hav({lat:a.lat,lon:a.lng},{lat:b.lat,lon:b.lng}))<.1);
 assert.ok(plan.approachDist<.01); assert.equal(g.size,2); assert.equal(p.nodes.size,2);
 for(const oneway of ['yes','-1']){
  const one=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],{...tags,oneway}]]),og=R.buildGraph(one,'cycle','maximum');
  const [start,end]=oneway==='yes'?[a,b]:[b,a];
  assert.doesNotThrow(()=>R.planRoute(one,og,start,end));
  assert.throws(()=>R.planRoute(one,og,end,start),/No connected/);
 }
});
test('lighting and Super Route preferences change graph costs without changing access',()=>{
 const p=network([[1,52,-.78],[2,52,-.77],[3,52.001,-.77]],[
  [1,[1,2],{highway:'cycleway',_mk_class:'redway',lit:'no'}],
  [2,[2,3],{highway:'cycleway',_mk_class:'super_redway',lit:'yes',_mk_route_ref:'H5',_mk_route_name:'Portway'}]
 ]);
 const normal=R.buildGraph(p,'cycle','balanced');
 const preferred=R.buildGraph(p,'cycle','balanced',{preferLit:true,preferSuper:true});
 assert.ok(preferred.get(1)[0].cost>normal.get(1)[0].cost,'unlit segment should be penalised');
 const normalSuper=normal.get(2).find(e=>e.to===3);
 const preferredSuper=preferred.get(2).find(e=>e.to===3);
 assert.ok(preferredSuper.cost<normalSuper.cost,'Super Route should be favoured');
 assert.equal(R.allowed({...tags,bicycle:'no'},'cycle'),false);
});

test('route insights count mapped underpasses, short road crossings, unlit distance and Super Routes',()=>{
 const edges=[
  {d:100,cls:'redway',lit:'no',tunnel:'yes',routeRef:'H5',routeName:'Portway'},
  {d:20,cls:'road',lit:'yes',tunnel:''},
  {d:100,cls:'redway',lit:'yes',tunnel:''}
 ];
 const insights=R.routeInsights(edges);
 assert.equal(insights.underpasses,1);
 assert.equal(insights.roadCrossings,1);
 assert.equal(insights.unlitDist,100);
 assert.deepEqual(insights.superRoutes,[{ref:'H5',name:'Portway'}]);
});

test('directed destination at terminal node is routable',()=>{
 const p=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],{...tags,oneway:'yes'}]]);
 const plan=R.planRoute(p,R.buildGraph(p,'cycle','fastest'),{lat:52,lng:-.778},{lat:52,lng:-.77});
 assert.equal(plan.endNodeId,2);
});
test('approach gaps count in totals and distant endpoints are rejected',()=>{
 const p=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],tags]]),g=R.buildGraph(p,'cycle','maximum');
 const plan=R.planRoute(p,g,{lat:52.0005,lng:-.778},{lat:52.0005,lng:-.772});
 assert.ok(plan.approachDist>100);
 assert.equal(plan.dist,plan.networkDist+plan.approachDist);
 assert.ok(plan.mins>plan.networkDist/4.17/60+1);
 assert.throws(()=>R.planRoute(p,g,{lat:52.003,lng:-.778},{lat:52,lng:-.772}),/over 150 metres/);
});
test('arrival requires an accurate fix at the actual destination',()=>{
 const destination={lat:52.001,lng:-.772};
 assert.equal(R.hasArrived({coords:{latitude:52,longitude:-.772,accuracy:5}},destination,0),false);
 assert.equal(R.hasArrived({coords:{latitude:52.001,longitude:-.772,accuracy:100}},destination,0),false);
 assert.equal(R.hasArrived({coords:{latitude:52.001,longitude:-.772,accuracy:5}},destination,0),true);
});
test('smooth bends are quiet but closely spaced real turns remain',()=>{
 const coords=[[52,-.78],[52,-.779],[52.0001,-.779],[52.0001,-.778]];
 const edges=[0,1,2].map(i=>({wayId:i,cls:'redway',name:'Redway'}));
 const ids=[1,2,3,4],graph=new Map([[2,[{to:1},{to:3},{to:10}]],[3,[{to:2},{to:4},{to:11}]]]);
 const turns=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph});
 assert.equal(turns.filter(m=>!m.arrive).length,2);
 const simple=new Map([[2,[{to:1},{to:3}]],[3,[{to:2},{to:4}]]]);
 assert.equal(R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph:simple}).length,1);
});
test('download errors have actionable text',()=>{
 assert.match(R.routeErrorMessage({name:'AbortError',message:'signal is aborted without reason'}),/timed out.*retry/);
 assert.match(R.routeErrorMessage(new TypeError('Failed to fetch')),/connection.*retry/);
});

test('generated MK data supports representative journeys in all four modes',()=>{
 const raw=JSON.parse(fs.readFileSync('data/network.json','utf8')),parsed=R.parseBundledNetwork(raw);
 assert.equal(raw.format,'mk-redway-network-v6');assert.ok(raw.council_geometry_features>0,'Release must include council geometry');
 assert.equal(parsed.ways.filter(w=>w.tags._mk_class==='redway'&&R.edgeClass(w.tags)!=='redway').length,0);
 const journeys=[
 ['Campbell Park–Knowlhill',[52.0467,-.7378],[52.025,-.783]],
 ['MK Central–Willen approach',[52.0345,-.774],[52.053,-.724]],
 ['Bletchley–centre:mk',[51.995,-.737],[52.043,-.758]],
 ['Wolverton–MK Central',[52.0659,-.804],[52.0345,-.774]],
 ['Stony Stratford–Willen approach',[52.056,-.852],[52.053,-.724]],
 ['OU–Hospital',[52.025,-.709],[52.026,-.736]]];
 const summary=[];
 for(const [mode,pref] of [['cycle','maximum'],['cycle','balanced'],['cycle','fastest'],['walk','maximum']]){
  const graph=R.buildGraph(parsed,mode,pref);
  for(const [name,a,b] of journeys){
   let plan; try { plan=R.planRoute(parsed,graph,{lat:a[0],lng:a[1]},{lat:b[0],lng:b[1]},mode,name); } catch(err) { err.message = `${name} (${mode}/${pref}): ${err.message}`; throw err; }
   assert.ok(plan.dist>100&&plan.dist<25000,name);assert.ok(plan.snaps.start<=150&&plan.snaps.end<=150);
   assert.ok(plan.result.edges.every(e=>Number.isFinite(e.d)&&e.d>=0));
   assert.ok(plan.maneuvers.every(m=>!m.instruction.includes('Make a U-turn')));
   assert.equal(Object.values(plan.mixPercent).reduce((a,b)=>a+b,0),100);
   assert.ok(plan.maneuvers.every(m=>['straight','left','right','slight-left','slight-right','sharp-left','sharp-right','u-turn-left','u-turn-right','roundabout','roundabout-exit','underpass','arrive'].includes(m.icon)));
   summary.push({journey:name,mode,pref,km:+(plan.dist/1000).toFixed(2),road:plan.roadPercent,instructions:plan.maneuvers.length});
  }
 }
 console.log(JSON.stringify(summary));
 // Original point in/near the lake must no longer silently accept a 236m gap.
 assert.throws(()=>R.planRoute(parsed,R.buildGraph(parsed,'cycle','maximum'),{lat:52.0345,lng:-.774},{lat:52.057,lng:-.718}),/over 150 metres/);
});
