(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MKRouting = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function parseBundledNetwork(data) {
    if (!data || !['mk-redway-network-v1', 'mk-redway-network-v2', 'mk-redway-network-v3', 'mk-redway-network-v4', 'mk-redway-network-v5'].includes(data.format) || !Array.isArray(data.nodes) || !Array.isArray(data.ways)) {
      throw new Error('Bundled routing network has an unsupported format');
    }
    const nodes = new Map();
    for (const row of data.nodes) {
      if (!Array.isArray(row) || row.length < 3) continue;
      nodes.set(row[0], { id: row[0], lat: Number(row[1]), lon: Number(row[2]) });
    }
    const ways = [];
    for (const row of data.ways) {
      if (!Array.isArray(row) || row.length < 3 || !Array.isArray(row[1])) continue;
      ways.push({ id: row[0], nodes: row[1], tags: row[2] || {} });
    }
    return { nodes, ways, generatedAt: data.generated_at || null };
  }


  function hav(a, b) {
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const isRedway = t => ['path', 'cycleway', 'footway'].includes(t.highway) && t.bicycle === 'designated' && t.foot === 'designated';
  const taggedRouteClass = t => t._mk_class || '';

  function allowed(t, mode) {
    const h = t.highway || '';
    if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(h)) return false;
    if (t.access === 'private' || t.access === 'no') return false;
    if (mode === 'cycle') {
      if (t.bicycle === 'no' || t.bicycle === 'private' || h === 'steps') return false;
      if (['footway', 'pedestrian'].includes(h) && !['yes', 'designated', 'permissive'].includes(t.bicycle)) return false;
      if (h === 'path' && !['yes', 'designated', 'permissive'].includes(t.bicycle)) return false;
    } else if (t.foot === 'no' || t.foot === 'private') return false;
    return true;
  }

  function edgeClass(t) {
    const h = t.highway || '';
    const tagged = taggedRouteClass(t);
    if (tagged === 'super_redway') return 'superredway';
    if (tagged === 'redway') return 'redway';
    if (tagged === 'leisure') return 'leisure';
    if (isRedway(t)) return 'redway';
    if (['cycleway', 'footway', 'path', 'pedestrian', 'bridleway', 'track'].includes(h)) return 'shared';
    if (['living_street', 'residential', 'service'].includes(h)) return 'quiet';
    if (h === 'unclassified') return 'road';
    if (['tertiary', 'tertiary_link'].includes(h)) return 'tertiary';
    if (['secondary', 'secondary_link'].includes(h)) return 'secondary';
    if (['primary', 'primary_link'].includes(h)) return 'primary';
    return 'road';
  }

  function multiplier(cls, pref, mode) {
    if (mode === 'walk') {
      return { superredway: .95, redway: .97, leisure: .99, shared: 1, quiet: 1.08, road: 1.12, tertiary: 1.18, secondary: 1.24, primary: 1.35 }[cls] || 1.2;
    }
    const table = {
      maximum: { superredway: .62, redway: .72, leisure: .88, shared: .97, quiet: 4.0, road: 5.5, tertiary: 8, secondary: 13, primary: 24 },
      balanced: { superredway: .76, redway: .84, leisure: .94, shared: 1.02, quiet: 1.7, road: 2.1, tertiary: 2.8, secondary: 4.3, primary: 9 },
      fastest: { superredway: .96, redway: 1, leisure: 1.03, shared: 1.06, quiet: 1.10, road: 1.13, tertiary: 1.18, secondary: 1.3, primary: 1.6 }
    };
    return table[pref][cls] || 2;
  }

  function edgeDisplayName(tags, cls) {
    if (cls === 'superredway' && tags._mk_route_name) return tags._mk_route_name;
    if (tags.name) return tags.name;
    if (tags._mk_route_name) return tags._mk_route_name;
    if (tags.ref) return tags.ref;
    if (cls === 'superredway') return 'Super Redway';
    if (cls === 'redway') return 'Redway';
    if (cls === 'leisure') return 'Leisure route';
    if (cls === 'shared') return 'shared path';
    return '';
  }

  function buildGraph(parsed, mode, pref) {
    const graph = new Map();
    const add = (id, edge) => {
      if (!graph.has(id)) graph.set(id, []);
      graph.get(id).push(edge);
      if (!graph.has(edge.to)) graph.set(edge.to, []);
    };
    for (const w of parsed.ways) {
      const t = w.tags || {};
      if (!allowed(t, mode)) continue;
      const cls = edgeClass(t);
      const reverse = t.oneway === '-1';
      const oneWay = mode === 'cycle' && ['yes', '1', 'true', '-1'].includes(t.oneway) && t['oneway:bicycle'] !== 'no';
      const name = edgeDisplayName(t, cls);
      for (let i = 0; i < w.nodes.length - 1; i++) {
        const ida = w.nodes[i];
        const idb = w.nodes[i + 1];
        const a = parsed.nodes.get(ida);
        const b = parsed.nodes.get(idb);
        if (!a || !b) continue;
        const d = hav(a, b);
        const base = { d, cost: d * multiplier(cls, pref, mode), cls, name, wayId: w.id };
        if (!oneWay) {
          add(ida, { ...base, to: idb });
          add(idb, { ...base, to: ida });
        } else if (reverse) add(idb, { ...base, to: ida });
        else add(ida, { ...base, to: idb });
      }
    }
    return graph;
  }


  function nearestCandidates(parsed, latlng, graph, limit = 10, maxDistance = 900) {
    const origin = { lat: latlng.lat, lon: latlng.lng };
    const best = [];
    for (const id of graph.keys()) {
      const n = parsed.nodes.get(id);
      if (!n) continue;
      const d = hav(origin, n);
      if (d > maxDistance && best.length >= limit) continue;
      if (best.length < limit || d < best[best.length - 1].d) {
        best.push({ id, d });
        best.sort((a, b) => a.d - b.d);
        if (best.length > limit) best.length = limit;
      }
    }
    return best.filter(x => x.d <= maxDistance);
  }

  function aStarMulti(parsed, graph, startCandidates, endCandidates, targetLatLng) {
    if (!startCandidates.length || !endCandidates.length) return null;
    const open = new MinHeap();
    const g = new Map();
    const prev = new Map();
    const prevEdge = new Map();
    const sourceSnap = new Map();
    const closed = new Set();
    const goals = new Map(endCandidates.map(x => [x.id, x.d]));
    const target = { lat: targetLatLng.lat, lon: targetLatLng.lng };
    const connectorFactor = 3;

    for (const s of startCandidates) {
      const initial = s.d * connectorFactor;
      if (initial < (g.get(s.id) ?? Infinity)) {
        g.set(s.id, initial);
        sourceSnap.set(s.id, s.d);
        const n = parsed.nodes.get(s.id);
        open.push(s.id, initial + (n ? hav(n, target) * .60 : 0));
      }
    }

    let bestGoal = null;
    let bestTotal = Infinity;
    let loops = 0;
    while (open.length && loops++ < 900000) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      const curG = g.get(cur);
      if (goals.has(cur)) {
        const total = curG + goals.get(cur) * connectorFactor;
        if (total < bestTotal) { bestTotal = total; bestGoal = cur; }
        if (open.peekPriority >= bestTotal) break;
      }
      closed.add(cur);
      for (const e of graph.get(cur) || []) {
        if (closed.has(e.to)) continue;
        const ng = curG + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          prev.set(e.to, cur);
          prevEdge.set(e.to, e);
          sourceSnap.set(e.to, sourceSnap.get(cur));
          const n = parsed.nodes.get(e.to);
          open.push(e.to, ng + (n ? hav(n, target) * .60 : 0));
        }
      }
    }
    if (bestGoal == null) return null;

    const ids = [bestGoal];
    const edges = [];
    let c = bestGoal;
    while (prev.has(c)) {
      edges.push(prevEdge.get(c));
      c = prev.get(c);
      ids.push(c);
    }
    ids.reverse();
    edges.reverse();
    return {
      ids,
      edges,
      startSnap: sourceSnap.get(bestGoal) ?? startCandidates[0].d,
      endSnap: goals.get(bestGoal) ?? endCandidates[0].d
    };
  }

  function nearestNode(parsed, latlng, graph) {
    let best = null;
    let bd = Infinity;
    for (const [id, n] of parsed.nodes) {
      if (!graph.has(id)) continue;
      const d = hav({ lat: latlng.lat, lon: latlng.lng }, n);
      if (d < bd) { bd = d; best = id; }
    }
    return { id: best, d: bd };
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(x, p) {
      const n = { x, p }; this.a.push(n);
      let i = this.a.length - 1;
      while (i) {
        const q = (i - 1) >> 1;
        if (this.a[q].p <= p) break;
        this.a[i] = this.a[q]; i = q;
      }
      this.a[i] = n;
    }
    pop() {
      if (!this.a.length) return null;
      const root = this.a[0]; const last = this.a.pop();
      if (this.a.length) {
        let i = 0;
        while (true) {
          const l = i * 2 + 1; const r = l + 1;
          if (l >= this.a.length) break;
          const c = r < this.a.length && this.a[r].p < this.a[l].p ? r : l;
          if (this.a[c].p >= last.p) break;
          this.a[i] = this.a[c]; i = c;
        }
        this.a[i] = last;
      }
      return root.x;
    }
    get length() { return this.a.length; }
    get peekPriority() { return this.a.length ? this.a[0].p : Infinity; }
  }

  function aStar(parsed, graph, startId, endId) {
    const open = new MinHeap();
    const g = new Map([[startId, 0]]);
    const prev = new Map();
    const prevEdge = new Map();
    const closed = new Set();
    const goal = parsed.nodes.get(endId);
    open.push(startId, 0);
    let loops = 0;
    while (open.length && loops++ < 750000) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      if (cur === endId) break;
      closed.add(cur);
      for (const e of graph.get(cur) || []) {
        if (closed.has(e.to)) continue;
        const ng = g.get(cur) + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng); prev.set(e.to, cur); prevEdge.set(e.to, e);
          const n = parsed.nodes.get(e.to);
          open.push(e.to, ng + hav(n, goal) * .70);
        }
      }
    }
    if (!prev.has(endId) && startId !== endId) return null;
    const ids = [endId]; const edges = [];
    let c = endId;
    while (c !== startId) {
      edges.push(prevEdge.get(c)); c = prev.get(c);
      if (c == null) return null;
      ids.push(c);
    }
    ids.reverse(); edges.reverse();
    return { ids, edges };
  }


  function bearing(a, b) {
    const p1 = a[0] * Math.PI / 180; const p2 = b[0] * Math.PI / 180;
    const dl = (b[1] - a[1]) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function angleDiff(a, b) { return ((b - a + 540) % 360) - 180; }
  function cardinal(deg) {
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return dirs[Math.round(deg / 45) % 8];
  }

  function buildCumulative(coords) {
    const c = [0];
    for (let i = 1; i < coords.length; i++) {
      c.push(c[i - 1] + hav({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }));
    }
    return c;
  }

  function targetPhrase(edge) {
    if (edge?.name && !['Super Redway', 'Redway', 'Leisure route', 'shared path'].includes(edge.name)) return ` onto ${edge.name}`;
    if (edge?.cls === 'superredway') return ' onto the Super Redway';
    if (edge?.cls === 'redway') return ' onto the Redway';
    if (edge?.cls === 'leisure') return ' onto the leisure route';
    if (edge?.cls === 'shared') return ' onto the shared path';
    return '';
  }

  function buildManeuvers(coords, edges, cumulative, { ids = [], graph, endLabel = 'your destination', endGap = 0 } = {}) {
    const maneuvers = [];
    for (let i = 1; i < coords.length - 1; i++) {
      // Look beyond tiny digitisation segments, without smoothing across a nearby junction.
      let a = i - 1, b = i + 1;
      while (a > 0 && cumulative[i] - cumulative[a] < 10 && !isJunction(ids[a], graph)) a--;
      while (b < coords.length - 1 && cumulative[b] - cumulative[i] < 10 && !isJunction(ids[b], graph)) b++;
      const delta = angleDiff(bearing(coords[a], coords[i]), bearing(coords[i], coords[b]));
      const abs = Math.abs(delta), incoming = edges[i - 1], outgoing = edges[i];
      const junction = isJunction(ids[i], graph);
      const enteredRedway = ['superredway', 'redway'].includes(outgoing?.cls) && !['superredway', 'redway'].includes(incoming?.cls);
      const namedChange = outgoing?.name && outgoing.name !== incoming?.name && !['Super Redway','Redway','Leisure route','shared path'].includes(outgoing.name);
      // Following a curving path is not a succession of turns. Keep decision points
      // and genuine hairpins, rather than suppressing real junctions by distance.
      if (!enteredRedway && !(junction && (abs >= 28 || namedChange)) && abs < 150) continue;
      let icon = '↑', instruction;
      if (abs >= 150) { icon = '↶'; instruction = `Follow the sharp bend${targetPhrase(outgoing)}`; }
      else if (abs >= 58) { icon = delta > 0 ? '↱' : '↰'; instruction = `Turn ${delta > 0 ? 'right' : 'left'}${targetPhrase(outgoing)}`; }
      else if (abs >= 28) { icon = delta > 0 ? '↗' : '↖'; instruction = `Bear ${delta > 0 ? 'right' : 'left'}${targetPhrase(outgoing)}`; }
      else instruction = `Continue${targetPhrase(outgoing)}`;
      const previous = maneuvers[maneuvers.length - 1];
      if (!junction && previous && cumulative[i] - previous.at < 25 && previous.instruction === instruction) continue;
      maneuvers.push({ index: i, at: cumulative[i], icon, instruction });
    }
    maneuvers.push({ index: coords.length - 1, at: cumulative.at(-1) || 0, icon: '●',
      instruction: endGap > 20 ? `Mapped route ends near ${endLabel}; check the remaining approach` : `Approach ${endLabel}`,
      arrive: true });
    return maneuvers;
  }

  function isJunction(id, graph) {
    return graph && new Set((graph.get(id) || []).map(e => e.to)).size > 2;
  }

  function initialInstruction(coords, edges) {
    if (coords.length < 2) return 'Follow the route';
    const dir = cardinal(bearing(coords[0], coords[1]));
    const e = edges[0];
    if (e?.name && !['Super Redway', 'Redway', 'Leisure route', 'shared path'].includes(e.name)) return `Head ${dir} on ${e.name}`;
    if (e?.cls === 'superredway') return `Head ${dir} on the Super Redway`;
    if (e?.cls === 'redway') return `Head ${dir} on the Redway`;
    if (e?.cls === 'leisure') return `Head ${dir} on the leisure route`;
    if (e?.cls === 'shared') return `Head ${dir} on the shared path`;
    return `Head ${dir}`;
  }


  const MAX_APPROACH = 150;

  function endpointCandidates(parsed, graph, point) {
    const seen = new Set(), best = [];
    const scale = Math.cos(point.lat * Math.PI / 180);
    for (const [from, edges] of graph) for (const edge of edges) {
      const to = edge.to, lo = from < to ? from : to, hi = from < to ? to : from;
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = parsed.nodes.get(lo), b = parsed.nodes.get(hi);
      if (!a || !b) continue;
      const ax = (a.lon - point.lng) * scale, ay = a.lat - point.lat;
      const dx = (b.lon - a.lon) * scale, dy = b.lat - a.lat;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const projected = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
      const d = hav({lat:point.lat, lon:point.lng}, projected);
      if (d <= MAX_APPROACH && (best.length < 32 || d < best.at(-1).d)) {
        best.push({key, lo, hi, t, d, projected}); best.sort((a,b) => a.d-b.d);
        if (best.length > 32) best.pop();
      }
    }
    // Do not jump to a distant alternative just because its route is cheaper.
    return best.filter(x => x.d <= (best[0]?.d ?? 0) + 50);
  }

  function planRoute(parsed, baseGraph, start, end, mode = 'cycle', endLabel = 'your destination') {
    const starts = endpointCandidates(parsed, baseGraph, start), ends = endpointCandidates(parsed, baseGraph, end);
    if (!starts.length || !ends.length) {
      const err = new Error(`The ${!starts.length ? 'start' : 'destination'} is over ${MAX_APPROACH} metres from a usable path. Choose an entrance or move its pin closer to a path.`);
      err.code = 'ENDPOINT_TOO_FAR'; throw err;
    }
    // Split edges at projected endpoints. This preserves one-way rules and handles
    // two pins on the same edge without detouring to its original endpoints.
    const nodes = new Map(parsed.nodes), graph = new Map(baseGraph), splits = new Map();
    let sequence = 0;
    for (const c of [...starts, ...ends]) {
      if (c.t < 1e-8) { c.id = c.lo; continue; }
      if (c.t > 1-1e-8) { c.id = c.hi; continue; }
      if (!splits.has(c.key)) splits.set(c.key, []);
      const list = splits.get(c.key), existing = list.find(x => Math.abs(x.t-c.t)<1e-8);
      c.id = existing?.id || `snap:${sequence++}`;
      if (!existing) { list.push(c); nodes.set(c.id,{...c.projected,id:c.id}); graph.set(c.id,[]); }
    }
    for (const list of splits.values()) {
      list.sort((a,b) => a.t-b.t);
      const {lo,hi} = list[0], chain=[{id:lo,t:0},...list,{id:hi,t:1}];
      for (const [a,b,reverse] of [[lo,hi,false],[hi,lo,true]]) {
        const original=baseGraph.get(a)||[], replaced=original.filter(e=>e.to===b);
        graph.set(a,(graph.get(a)||[]).filter(e=>e.to!==b));
        for(const edge of replaced) {
          const ordered=reverse?[...chain].reverse():chain;
          for(let i=0;i<ordered.length-1;i++) {
            const u=ordered[i],v=ordered[i+1], fraction=Math.abs(v.t-u.t);
            graph.set(u.id,[...(graph.get(u.id)||[]),{...edge,to:v.id,d:edge.d*fraction,cost:edge.cost*fraction}]);
          }
        }
      }
    }
    const network={...parsed,nodes};
    const result=aStarMulti(network,graph,starts,ends,end);
    if(!result) {const err=new Error('No connected route between these entrances. Try another entrance or travel mode.');err.code='NO_ROUTE';throw err;}
    if (result.ids.length < 2) { const err=new Error('Start and destination attach to the same point. Choose distinct entrances to plan a route.'); err.code='NO_ROUTE'; throw err; }
    const coords=result.ids.map(id=>{const n=nodes.get(id);return[n.lat,n.lon];});
    const cumulative=buildCumulative(coords), mix={superredway:0,redway:0,leisure:0,shared:0,road:0};
    for(const edge of result.edges) mix[Object.hasOwn(mix,edge.cls)?edge.cls:'road']+=edge.d;
    const networkDist=result.edges.reduce((sum,e)=>sum+e.d,0), approachDist=result.startSnap+result.endSnap;
    return { parsed:network, graph, result, coords, cumulative, mix, networkDist, approachDist,
      dist:networkDist+approachDist, mins:networkDist/(mode==='cycle'?4.17:1.34)/60+approachDist/1.34/60,
      snaps:{start:result.startSnap,end:result.endSnap},
      roadPercent:networkDist?Math.round(mix.road/networkDist*100):0,
      redwayPercent:networkDist?Math.round((mix.superredway+mix.redway)/networkDist*100):0,
      maneuvers:buildManeuvers(coords,result.edges,cumulative,{ids:result.ids,graph,endLabel,endGap:result.endSnap}),
      initialInstruction:result.startSnap>20?'Join the mapped route using an accessible approach':initialInstruction(coords,result.edges),
      startNodeId:result.ids[0],endNodeId:result.ids.at(-1) };
  }

  function routeErrorMessage(err) {
    if (['ENDPOINT_TOO_FAR','NO_ROUTE'].includes(err?.code)) return err.message;
    if (/unsupported format/i.test(err?.message||'')) return 'The downloaded map needs an app update. Reload the app and retry.';
    if (err?.name === 'AbortError' || /abort|timeout/i.test(err?.message||'')) return 'Map download timed out. Check your connection, then retry.';
    return 'Could not load a route. Check your connection and retry, or choose a different entrance.';
  }

  function hasArrived(position, destination, remainingOnRoute) {
    if (!destination || !Number.isFinite(position.coords.accuracy) || position.coords.accuracy > 35) return false;
    return remainingOnRoute < 30 && hav({lat:position.coords.latitude,lon:position.coords.longitude},{lat:destination.lat,lon:destination.lng}) < 22;
  }

  function remainingJourney(route, progress, position, start, end, mode) {
    const mapped=Math.max(0,route.networkDist-progress);
    const point={lat:position.lat,lon:position.lng};
    const endDistance=hav(point,{lat:end.lat,lon:end.lng});
    const startApproach=progress<5 && route.coords.length?hav(point,{lat:route.coords[0][0],lon:route.coords[0][1]}):0;
    const endApproach=mapped<22?endDistance:route.snaps.end;
    return {distance:mapped+startApproach+endApproach,mins:mapped/(mode==='cycle'?4.17:1.34)/60+(startApproach+endApproach)/1.34/60};
  }

  return { parseBundledNetwork, hav, isRedway, allowed, edgeClass, multiplier, edgeDisplayName, buildGraph, nearestCandidates, aStarMulti, nearestNode, aStar, bearing, angleDiff, cardinal, buildCumulative, targetPhrase, buildManeuvers, initialInstruction, planRoute, routeErrorMessage, hasArrived, remainingJourney };
});
