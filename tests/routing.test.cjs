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
  {d:100,cls:'superredway',lit:'no',tunnel:'yes',routeRef:'H5',routeName:'Portway'},
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
test('one-way forks retain turn guidance without announcing ordinary directed bends',()=>{
 const p=network([[1,52,-.78],[2,52.001,-.78],[3,52.001,-.779],[4,52.002,-.78]],[
  [1,[1,2],{...tags,oneway:'yes'}],[2,[2,3],{...tags,oneway:'yes'}],[3,[2,4],{...tags,oneway:'yes'}]]);
 const graph=R.buildGraph(p,'cycle','balanced'),coords=[[52,-.78],[52.001,-.78],[52.001,-.779]];
 const edges=[graph.get(1)[0],graph.get(2).find(e=>e.to===3)],ids=[1,2,3];
 const turns=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph});
 assert.equal(turns[0].icon,'right');assert.match(turns[0].instruction,/^Turn right/);
 const simple=R.buildGraph({...p,ways:p.ways.slice(0,2)},'cycle','balanced');
 assert.equal(R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph:simple}).length,1);
});
test('smoothing stops at closely spaced one-way decision points',()=>{
 const coords=[[52,-.78],[52,-.779],[52.00004,-.779],[52.00004,-.778]];
 const edges=[0,1,2].map(i=>({wayId:i,cls:'redway',name:'Redway'})),ids=[1,2,3,4];
 const graph=new Map([[2,[{to:3},{to:10}]],[3,[{to:4},{to:11}]]]);
 const turns=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph});
 assert.deepEqual(turns.filter(m=>!m.arrive).map(m=>m.icon),['left','right']);
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

test('unknown lighting stays unknown and both preferences retain legal connectivity',()=>{
 const p=network([[1,52,-.78],[2,52,-.779],[3,52,-.778],[4,52,-.777]],[
  [1,[1,2],tags],[2,[2,3],{...tags,lit:'no'}],[3,[3,4],{...tags,lit:'yes'}]]);
 const g=R.buildGraph(p,'cycle','maximum',{preferLit:true,preferSuper:true});
 assert.equal(g.get(1)[0].lit,'');
 const result=R.aStar(p,g,1,4);
 assert.deepEqual(result.ids,[1,2,3,4]);
 assert.ok(Math.abs(R.routeInsights(result.edges).unlitDist-result.edges[1].d)<.01);
});

test('discounted Super Route A* agrees with an independent Dijkstra oracle',()=>{
 const p=network([[1,52,-.78],[2,52.001,-.78],[3,52.001,-.779],[4,52,-.779]],[
  [1,[1,4],{highway:'cycleway'}],
  [2,[1,2,3,4],{...tags,_mk_class:'super_redway',lit:'yes'}]]);
 // Short connector and deeply discounted corridor deliberately offer competing paths.
 for(const pref of ['maximum','balanced','fastest']) for(const preferLit of [false,true]) for(const preferSuper of [false,true]) {
  const g=R.buildGraph(p,'cycle',pref,{preferLit,preferSuper});
  const distances=new Map([[1,0]]),pending=new Set(g.keys());
  while(pending.size){
   const id=[...pending].sort((a,b)=>(distances.get(a)??Infinity)-(distances.get(b)??Infinity))[0];pending.delete(id);
   for(const e of g.get(id)||[]) if(pending.has(e.to)) distances.set(e.to,Math.min(distances.get(e.to)??Infinity,(distances.get(id)??Infinity)+e.cost));
  }
  for(const route of [R.aStar(p,g,1,4),R.aStarMulti(p,g,[{id:1,d:0}],[{id:4,d:0}],{lat:52,lng:-.779})])
   assert.ok(Math.abs(route.edges.reduce((n,e)=>n+e.cost,0)-distances.get(4))<.001);
 }
});

test('roundabouts and bicycle-specific one-way overrides respect direction',()=>{
 for(const t of [{junction:'roundabout'},{'oneway:bicycle':'yes'},{oneway:'no','oneway:bicycle':'yes'}]) {
  const p=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],{...tags,...t}]]);
  assert.equal(R.buildGraph(p,'cycle','balanced').get(2).length,0);
  assert.equal(R.buildGraph(p,'walk','balanced').get(2).length,1);
 }
 const p=network([[1,52,-.78],[2,52,-.77]],[[1,[1,2],{...tags,oneway:'yes','oneway:bicycle':'no'}]]);
 assert.equal(R.buildGraph(p,'cycle','balanced').get(2).length,1);
});

test('crossings count contiguous sections, distinguish estimates, and ignore bridges and long roads',()=>{
 const path={cls:'redway',d:10};
 const insights=R.routeInsights([path,{...path,crossing:true},{...path,crossing:true},path,{cls:'road',d:15},{cls:'road',d:15},path]);
 assert.equal(insights.roadCrossings,2);assert.equal(insights.estimatedRoadCrossings,1);
 assert.equal(R.routeInsights([path,{cls:'road',d:70},path]).roadCrossings,0);
 assert.equal(R.routeInsights([{...path,bridge:'yes'},{...path,tunnel:'no'}]).underpasses,0);
 assert.equal(R.routeInsights([{...path,tunnel:'yes'},{...path,tunnel:'yes'},path,{...path,tunnel:'yes'}]).underpasses,2);
});
test('mapped road bridges are retained and excluded from estimated at-grade crossings',()=>{
 for(const bridge of ['yes','viaduct','movable']) {
  const p=network([[1,52,-.78],[2,52,-.779],[3,52,-.7788],[4,52,-.778]],[
   [1,[1,2],tags],[2,[2,3],{highway:'residential',bridge}],[3,[3,4],tags]]);
  const graph=R.buildGraph(p,'cycle','balanced'),result=R.aStar(p,graph,1,4);
  assert.equal(result.edges[1].bridge,bridge);
  assert.equal(R.routeInsights(result.edges).estimatedRoadCrossings,0);
  assert.equal(R.routeInsights(result.edges).roadCrossings,0);
  result.edges[1].bridge='no';
  assert.equal(R.routeInsights(result.edges).estimatedRoadCrossings,1);
 }
});

test('unlit warning survives underpass maneuver and roundabout exits never invent exit numbers',()=>{
 const coords=[[52,-.78],[52,-.779],[52,-.778]], c=R.buildCumulative(coords);
 const maneuvers=R.buildManeuvers(coords,[{cls:'redway'},{cls:'redway',tunnel:'yes',underRoad:'H5 Portway',lit:'no'}],c);
 assert.match(maneuvers[0].instruction,/under H5 Portway; unlit path ahead/);
 const round=R.buildManeuvers(coords,[{junction:'roundabout'},{cls:'redway'}],c);
 assert.equal(round[0].icon,'roundabout-exit');assert.doesNotMatch(round[0].instruction,/\d|third/);
});
test('tunnel entries retain turn direction, mapped context and unlit warning',()=>{
 for(const [lon,direction] of [[-.779,'right'],[-.781,'left']]) {
  const coords=[[52,-.78],[52.001,-.78],[52.001,lon]],ids=[1,2,3];
  const edges=[{cls:'redway',wayId:1},{cls:'redway',wayId:2,tunnel:'yes',underRoad:'H5 Portway',lit:'no'}];
  const graph=new Map([[2,[{to:1},{to:3},{to:4}]]]);
  const maneuver=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph})[0];
  assert.equal(maneuver.icon,'underpass');
  assert.equal(maneuver.instruction,`Turn ${direction} under H5 Portway; unlit path ahead`);
  const bend=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph:new Map([[2,[{to:1},{to:3}]]])})[0];
  assert.equal(bend.instruction,'Continue under H5 Portway; unlit path ahead');
  edges[0].junction='roundabout';
  const exit=R.buildManeuvers(coords,edges,R.buildCumulative(coords),{ids,graph})[0];
  assert.equal(exit.instruction,'Exit the roundabout under H5 Portway; unlit path ahead');
 }
});

test('network consumer rejects corrupt geometry and metadata before installing a graph',()=>{
 const valid={format:'mk-redway-network-v6',nodes:[[1,52,-.7],[2,52.01,-.71]],ways:[[1,[1,2],{highway:'cycleway',lit:'yes'}]]};
 assert.doesNotThrow(()=>R.parseBundledNetwork(valid));
 for(const mutate of [d=>d.nodes[0][1]=NaN,d=>d.nodes[0][2]=181,d=>d.nodes.push(d.nodes[0]),
   d=>d.nodes[0][1]=true,d=>d.nodes[0][0]=false,d=>d.nodes[0][0]=2**53,
   d=>d.ways[0][0]=true,d=>d.ways[0][0]=2**53,d=>d.ways[0][1]=[true,2],
   d=>d.ways[0][1]=[1,999],d=>d.ways[0][2].lit=false,d=>d.ways.push(d.ways[0]),d=>d.ways[0][2]._mk_class='invented']) {
  const data=structuredClone(valid);mutate(data);assert.throws(()=>R.parseBundledNetwork(data),/invalid/);
 }
});
