#!/usr/bin/env python3
"""Build the static Milton Keynes walking/cycling routing network for GitHub Pages.

The browser routes from data/network.json so end users do not depend on a public
Overpass instance. The build also adds best-effort Milton Keynes route classes:
Super Redway, Redway, leisure route and other shared paths.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request

try:
    import osmium  # type: ignore
except ImportError:
    osmium = None

SOUTH, WEST, NORTH, EAST = 51.955, -0.905, 52.155, -0.615
HIGHWAYS = (
    "path|cycleway|footway|pedestrian|bridleway|track|steps|living_street|"
    "residential|service|unclassified|tertiary|tertiary_link|secondary|"
    "secondary_link|primary|primary_link"
)
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
KEEP_TAGS = {
    "highway", "bicycle", "foot", "access", "oneway", "oneway:bicycle",
    "name", "ref", "bridge", "tunnel", "lit", "surface", "tracktype",
    "smoothness", "segregated",
}
ROOT = Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "scripts" / "official_route_rules.json"
OUT = ROOT / "data" / "network.json"
OSM_PBF = ROOT / "data" / "buckinghamshire-latest.osm.pbf"
GEOFABRIK_URL = "https://download.geofabrik.de/europe/united-kingdom/england/buckinghamshire-latest.osm.pbf"
TMP = ROOT / "data" / "network.json.tmp"
COUNCIL_ROUTES = ROOT / "data" / "council_routes.geojson"



def download_geofabrik_pbf() -> Path:
    """Download the small Buckinghamshire OSM extract used for deterministic builds."""
    if OSM_PBF.exists() and OSM_PBF.stat().st_size > 5_000_000:
        age = (time.time() - OSM_PBF.stat().st_mtime) / 86400
        if age < 2:
            print(f"Reusing cached Geofabrik OSM extract ({OSM_PBF.stat().st_size / 1024 / 1024:.1f} MiB, {age:.1f} days old).", flush=True)
            return OSM_PBF
    tmp = OSM_PBF.with_suffix(OSM_PBF.suffix + ".tmp")
    OSM_PBF.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for attempt in range(3):
        try:
            print(f"Downloading current Buckinghamshire OSM extract from Geofabrik (attempt {attempt + 1}/3)…", flush=True)
            req = urllib.request.Request(GEOFABRIK_URL, headers={"User-Agent": "MKRedwayNavigator-PoC/0.10.2 GitHub-Pages-build"})
            with urllib.request.urlopen(req, timeout=180) as r, tmp.open("wb") as out:
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            if tmp.stat().st_size < 5_000_000:
                raise RuntimeError(f"Downloaded extract is unexpectedly small ({tmp.stat().st_size} bytes)")
            tmp.replace(OSM_PBF)
            print(f"Downloaded {OSM_PBF.stat().st_size / 1024 / 1024:.1f} MiB OSM extract.", flush=True)
            return OSM_PBF
        except Exception as exc:
            last = exc
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            wait = 3 + attempt * 5
            print(f"Geofabrik download attempt {attempt + 1} failed: {exc}; retrying in {wait}s", flush=True)
            time.sleep(wait)
    if OSM_PBF.exists() and OSM_PBF.stat().st_size > 5_000_000:
        print(f"Geofabrik refresh unavailable; using cached OSM extract ({OSM_PBF.stat().st_size / 1024 / 1024:.1f} MiB).", flush=True)
        return OSM_PBF
    raise RuntimeError(f"Could not download Geofabrik OSM extract: {last}")


def load_osm_from_pbf(path: Path) -> tuple[dict[int, tuple[float, float]], dict[int, tuple[list[int], dict[str, str]]], dict]:
    """Read routable ways, their nodes and bicycle relations from a local PBF."""
    if osmium is None:
        raise RuntimeError("Python package 'osmium' is required for the Geofabrik routing build")

    class WaysAndRelations(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways: dict[int, tuple[list[int], dict[str, str]]] = {}
            self.node_ids: set[int] = set()
            self.relations: list[dict] = []

        def way(self, w):
            tags_all = {t.k: t.v for t in w.tags}
            highway = tags_all.get("highway", "")
            if not re.fullmatch(rf"(?:{HIGHWAYS})", highway):
                return
            ids = [int(n.ref) for n in w.nodes]
            if len(ids) < 2:
                return
            tags = {k: str(v) for k, v in tags_all.items() if k in KEEP_TAGS}
            self.ways[int(w.id)] = (ids, tags)
            self.node_ids.update(ids)

        def relation(self, r):
            tags = {t.k: t.v for t in r.tags}
            if tags.get("route") != "bicycle":
                return
            members = []
            for m in r.members:
                if m.type == "w":
                    members.append({"type": "way", "ref": int(m.ref), "role": m.role})
            if members:
                self.relations.append({"type": "relation", "id": int(r.id), "tags": tags, "members": members})

    first = WaysAndRelations()
    first.apply_file(str(path), locations=False)

    class Nodes(osmium.SimpleHandler):
        def __init__(self, wanted: set[int]):
            super().__init__()
            self.wanted = wanted
            self.nodes: dict[int, tuple[float, float]] = {}

        def node(self, n):
            nid = int(n.id)
            if nid in self.wanted and n.location.valid():
                self.nodes[nid] = (float(n.location.lat), float(n.location.lon))

    second = Nodes(first.node_ids)
    second.apply_file(str(path), locations=False)

    # Limit the graph to the MK app extent after coordinates are available. Keep a small
    # buffer so paths crossing the boundary remain connected.
    margin = 0.01
    kept_ways: dict[int, tuple[list[int], dict[str, str]]] = {}
    referenced: set[int] = set()
    for wid, (ids, tags) in first.ways.items():
        pts = [second.nodes.get(n) for n in ids]
        if not any(pt and SOUTH - margin <= pt[0] <= NORTH + margin and WEST - margin <= pt[1] <= EAST + margin for pt in pts):
            continue
        clean = [n for n in ids if n in second.nodes]
        if len(clean) >= 2:
            kept_ways[wid] = (clean, tags)
            referenced.update(clean)
    nodes = {nid: second.nodes[nid] for nid in referenced}
    relation_json = {"elements": first.relations}
    print(f"Loaded {len(nodes):,} referenced nodes and {len(kept_ways):,} routable ways from Geofabrik.", flush=True)
    return nodes, kept_ways, relation_json


def request_overpass(query: str, label: str, rotate: int = 0, attempts: int = 2) -> dict:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    ordered = ENDPOINTS[rotate % len(ENDPOINTS):] + ENDPOINTS[: rotate % len(ENDPOINTS)]
    for endpoint in ordered:
        for attempt in range(attempts):
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=payload,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                        "Accept": "application/json",
                        "User-Agent": "MKRedwayNavigator-PoC/0.10 GitHub-Pages-build",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=150) as response:
                    if response.status != 200:
                        raise RuntimeError(f"HTTP {response.status}")
                    return json.load(response)
            except Exception as exc:  # noqa: BLE001 - resilient public-service fallback
                last_error = exc
                wait = 2 + attempt * 4
                print(f"{label}: {endpoint} attempt {attempt + 1} failed: {exc}; retrying in {wait}s", flush=True)
                time.sleep(wait)
    raise RuntimeError(f"All Overpass endpoints failed for {label}: {last_error}")


def request_tile(s: float, w: float, n: float, e: float, tile_no: int) -> dict:
    query = (
        f'[out:json][timeout:120];'
        f'way["highway"~"^({HIGHWAYS})$"]({s},{w},{n},{e});'
        f'(._;>;);out body;'
    )
    return request_overpass(query, f"Tile {tile_no + 1}", rotate=tile_no)


def request_cycle_relations() -> dict:
    # Relation-only response is small; member way IDs let us distinguish OSM-mapped
    # Super Redways and named leisure/cultural routes without another geometry dump.
    query = (
        f'[out:json][timeout:90];'
        f'relation["route"="bicycle"]({SOUTH},{WEST},{NORTH},{EAST});'
        f'out body;'
    )
    return request_overpass(query, "Cycle-route metadata", rotate=1, attempts=1)


def load_official_rules() -> dict:
    with RULES_PATH.open("r", encoding="utf-8") as f:
        rules = json.load(f)
    if not rules.get("super_routes"):
        raise RuntimeError("official_route_rules.json contains no Super Routes")
    return rules


def normalise_text(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def super_route_lookup(rules: dict) -> tuple[dict[str, str], dict[str, str]]:
    """Return normalised alias->ref and ref->display name maps."""
    aliases: dict[str, str] = {}
    names: dict[str, str] = {}
    for route in rules.get("super_routes", []):
        ref = str(route.get("ref") or "").upper().strip()
        if not ref:
            continue
        names[ref] = f"MK Redway Super Route {ref}"
        aliases[normalise_text(ref)] = ref
        for alias in route.get("aliases", []):
            key = normalise_text(alias)
            if key:
                aliases[key] = ref
    return aliases, names


def identify_super_ref(tags: dict[str, str], aliases: dict[str, str]) -> str | None:
    ref = normalise_text(tags.get("ref"))
    if ref in aliases:
        return aliases[ref]
    haystack = normalise_text(" ".join(str(tags.get(k) or "") for k in ("name", "ref", "description")))
    # Exact route-code tokens are strongest and avoid e.g. H6 matching H60.
    tokens = set(haystack.split())
    for alias, route_ref in aliases.items():
        if len(alias) <= 3 and alias in tokens:
            return route_ref
    # Road-name aliases such as Childs Way / Grafton Street are also official corridor identifiers.
    for alias, route_ref in aliases.items():
        if len(alias) > 3 and alias in haystack:
            return route_ref
    return None


def relation_classes(data: dict, rules: dict) -> tuple[dict[int, str], dict[int, str], dict[int, str]]:
    classes: dict[int, str] = {}
    names: dict[int, str] = {}
    refs: dict[int, str] = {}
    aliases, official_names = super_route_lookup(rules)
    leisure_terms = (
        "millennium", "cultural", "blue route", "yellow route", "green route",
        "iron route", "cornflower", "railway walk", "leisure", "heritage",
    )
    for element in data.get("elements", []):
        if element.get("type") != "relation":
            continue
        tags = element.get("tags") or {}
        name = str(tags.get("name") or tags.get("ref") or "").strip()
        descriptor = " ".join(str(tags.get(k) or "") for k in ("name", "ref", "description")).lower()
        official_ref = identify_super_ref(tags, aliases)
        cls = None
        if official_ref:
            cls = "super_redway"
            name = official_names[official_ref]
        elif re.search(r"(?:super\s*redway|redway\s*super|super\s*route)", descriptor):
            # Retain legacy OSM metadata only if it can be tied to one of the council's
            # official 13 corridors. This avoids unrelated bicycle relations being promoted.
            continue
        elif any(term in descriptor for term in leisure_terms) or str(tags.get("roundtrip", "")).lower() == "yes":
            cls = "leisure"
        if not cls:
            continue
        for member in element.get("members", []):
            if member.get("type") != "way":
                continue
            ref = member.get("ref")
            if ref is None:
                continue
            way_id = int(ref)
            if cls == "super_redway" or classes.get(way_id) != "super_redway":
                classes[way_id] = cls
                if name:
                    names[way_id] = name
                if official_ref:
                    refs[way_id] = official_ref
    return classes, names, refs


def is_redway_tags(tags: dict[str, str]) -> bool:
    return (
        tags.get("highway") in {"path", "cycleway", "footway"}
        and tags.get("bicycle") == "designated"
        and tags.get("foot") == "designated"
    )


def xy_m(lat: float, lon: float) -> tuple[float, float]:
    # Local equirectangular coordinates are accurate enough for 100-150 m corridor matching.
    lat0 = 52.05
    x = math.radians(lon) * 6371000 * math.cos(math.radians(lat0))
    y = math.radians(lat) * 6371000
    return x, y


def point_segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    if den <= 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)




def load_council_routes() -> list[dict]:
    """Load website-extracted official MK Council line classifications if available."""
    if not COUNCIL_ROUTES.exists():
        return []
    try:
        data = json.loads(COUNCIL_ROUTES.read_text(encoding="utf-8"))
        features = data.get("features") if isinstance(data, dict) else None
        if not isinstance(features, list):
            return []
        good = []
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties") or {}
            cls = props.get("route_class")
            geom = feature.get("geometry") or {}
            if cls not in {"super_redway", "redway", "leisure"} or geom.get("type") != "LineString":
                continue
            coords = geom.get("coordinates") or []
            pts = []
            for pt in coords:
                if isinstance(pt, list) and len(pt) >= 2:
                    try:
                        lon, lat = float(pt[0]), float(pt[1])
                    except (TypeError, ValueError):
                        continue
                    if WEST - 0.05 <= lon <= EAST + 0.05 and SOUTH - 0.05 <= lat <= NORTH + 0.05:
                        pts.append((lat, lon))
            if len(pts) >= 2:
                good.append({"class": cls, "points": pts, "properties": props})
        return good
    except Exception as exc:
        print(f"Official council route extract could not be read: {exc}", flush=True)
        return []


def build_council_route_index(features: list[dict]) -> dict[tuple[int, int], list[tuple[float, float, float, float, str, dict]]]:
    """Spatial index of official website line geometry for matching to OSM ways."""
    cell = 120.0
    index: dict[tuple[int, int], list[tuple[float, float, float, float, str, dict]]] = {}
    for feature in features:
        cls = feature["class"]
        props = feature.get("properties") or {}
        pts = feature["points"]
        for a, b in zip(pts, pts[1:]):
            ax, ay = xy_m(*a)
            bx, by = xy_m(*b)
            minx, maxx = min(ax, bx) - 45, max(ax, bx) + 45
            miny, maxy = min(ay, by) - 45, max(ay, by) + 45
            seg = (ax, ay, bx, by, cls, props)
            for gx in range(math.floor(minx / cell), math.floor(maxx / cell) + 1):
                for gy in range(math.floor(miny / cell), math.floor(maxy / cell) + 1):
                    index.setdefault((gx, gy), []).append(seg)
    return index


def match_council_class(
    node_ids: list[int],
    nodes_by_osm: dict[int, tuple[float, float]],
    index: dict[tuple[int, int], list[tuple[float, float, float, float, str, dict]]],
) -> tuple[str, dict] | None:
    """Match an OSM way to the official council path class by line proximity/coverage."""
    if len(node_ids) < 2 or not index:
        return None
    pts = [nodes_by_osm[n] for n in node_ids if n in nodes_by_osm]
    if len(pts) < 2:
        return None
    cell = 120.0
    scores: dict[str, float] = {"super_redway": 0.0, "redway": 0.0, "leisure": 0.0}
    props_by_class: dict[str, dict] = {}
    total = 0.0
    # Official website geometry may be cartographically offset a little from OSM. 32 m is
    # enough to tolerate that while remaining far tighter than the old corridor heuristic.
    max_dist = 32.0
    for a, b in zip(pts, pts[1:]):
        ax, ay = xy_m(*a); bx, by = xy_m(*b)
        length = math.hypot(bx - ax, by - ay)
        if length < 0.5:
            continue
        total += length
        # Sample midpoint plus quarter-points to avoid promoting a crossing way from one hit.
        for frac in (0.25, 0.5, 0.75):
            px, py = ax + (bx - ax) * frac, ay + (by - ay) * frac
            gx, gy = math.floor(px / cell), math.floor(py / cell)
            best: tuple[float, str, dict] | None = None
            for ix in range(gx - 1, gx + 2):
                for iy in range(gy - 1, gy + 2):
                    for x1, y1, x2, y2, cls, props in index.get((ix, iy), []):
                        d = point_segment_distance(px, py, x1, y1, x2, y2)
                        if d <= max_dist and (best is None or d < best[0] or (abs(d-best[0]) < 2 and cls == "super_redway")):
                            best = (d, cls, props)
            if best:
                _, cls, props = best
                scores[cls] += length / 3.0
                props_by_class.setdefault(cls, props)
    if total <= 0:
        return None
    # More-specific class wins where official layers overlap. Require substantial coverage.
    for cls in ("super_redway", "redway", "leisure"):
        if scores[cls] / total >= 0.55:
            return cls, props_by_class.get(cls, {})
    return None

def angle_diff(a: float, b: float) -> float:
    d = abs((a - b) % math.pi)
    return min(d, math.pi - d)


def build_official_corridor_index(
    ways_by_osm: dict[int, tuple[list[int], dict[str, str]]],
    nodes_by_osm: dict[int, tuple[float, float]],
    rules: dict,
) -> dict[tuple[int, int], list[tuple[float, float, float, float, float, str]]]:
    """Spatial index of official Super Route grid-road corridors from OSM road geometry."""
    aliases, _ = super_route_lookup(rules)
    cell = 180.0
    index: dict[tuple[int, int], list[tuple[float, float, float, float, float, str]]] = {}
    roadish = {
        "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
        "unclassified", "residential",
    }
    for _, (node_ids, tags) in ways_by_osm.items():
        if tags.get("highway") not in roadish:
            continue
        route_ref = identify_super_ref(tags, aliases)
        if not route_ref:
            continue
        pts = [nodes_by_osm[n] for n in node_ids if n in nodes_by_osm]
        for a, b in zip(pts, pts[1:]):
            ax, ay = xy_m(*a)
            bx, by = xy_m(*b)
            bearing = math.atan2(by - ay, bx - ax) % math.pi
            minx, maxx = min(ax, bx) - 140, max(ax, bx) + 140
            miny, maxy = min(ay, by) - 140, max(ay, by) + 140
            for gx in range(math.floor(minx / cell), math.floor(maxx / cell) + 1):
                for gy in range(math.floor(miny / cell), math.floor(maxy / cell) + 1):
                    index.setdefault((gx, gy), []).append((ax, ay, bx, by, bearing, route_ref))
    return index


def infer_official_super_route(
    node_ids: list[int],
    tags: dict[str, str],
    nodes_by_osm: dict[int, tuple[float, float]],
    corridor_index: dict[tuple[int, int], list[tuple[float, float, float, float, float, str]]],
) -> str | None:
    """Match an OSM Redway way to one of the council's 13 official Super Route corridors."""
    if not is_redway_tags(tags) or len(node_ids) < 2 or not corridor_index:
        return None
    pts = [nodes_by_osm[n] for n in node_ids if n in nodes_by_osm]
    if len(pts) < 2:
        return None
    cell = 180.0
    scores: dict[str, float] = {}
    total = 0.0
    matched = 0.0
    for a, b in zip(pts, pts[1:]):
        ax, ay = xy_m(*a)
        bx, by = xy_m(*b)
        length = math.hypot(bx - ax, by - ay)
        if length < 0.5:
            continue
        total += length
        mx, my = (ax + bx) / 2, (ay + by) / 2
        pbearing = math.atan2(by - ay, bx - ax) % math.pi
        gx, gy = math.floor(mx / cell), math.floor(my / cell)
        best: tuple[float, str] | None = None
        for ix in range(gx - 1, gx + 2):
            for iy in range(gy - 1, gy + 2):
                for rx1, ry1, rx2, ry2, rbearing, route_ref in corridor_index.get((ix, iy), []):
                    dist = point_segment_distance(mx, my, rx1, ry1, rx2, ry2)
                    if dist > 135:
                        continue
                    parallel = math.degrees(angle_diff(pbearing, rbearing)) <= 48
                    # Super Routes broadly follow the grid-road direction. Requiring
                    # a similar bearing prevents ordinary Redways that merely cross an
                    # H/V road at an underpass from being promoted to Super Route.
                    if not parallel:
                        continue
                    if best is None or dist < best[0]:
                        best = (dist, route_ref)
        if best:
            matched += length
            scores[best[1]] = scores.get(best[1], 0.0) + length
    if total <= 0 or matched / total < 0.55 or not scores:
        return None
    route_ref, score = max(scores.items(), key=lambda kv: kv[1])
    return route_ref if score / total >= 0.5 else None


def existing_network_is_valid() -> bool:
    if not OUT.exists():
        return False
    try:
        with OUT.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return (
            data.get("format") in {"mk-redway-network-v1", "mk-redway-network-v2", "mk-redway-network-v3", "mk-redway-network-v4", "mk-redway-network-v5"}
            and len(data.get("nodes", [])) > 1000
            and len(data.get("ways", [])) > 100
        )
    except Exception:
        return False


def existing_network_age_days() -> float | None:
    if not OUT.exists():
        return None
    try:
        with OUT.open("r", encoding="utf-8") as f:
            data = json.load(f)
        stamp = data.get("generated_at")
        if not stamp:
            return None
        made = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if made.tzinfo is None:
            made = made.replace(tzinfo=dt.timezone.utc)
        return (dt.datetime.now(dt.timezone.utc) - made).total_seconds() / 86400
    except Exception:
        return None





def council_routes_sha256() -> str | None:
    if not COUNCIL_ROUTES.exists():
        return None
    h = hashlib.sha256()
    with COUNCIL_ROUTES.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def existing_network_council_hash() -> str | None:
    if not OUT.exists():
        return None
    try:
        with OUT.open("r", encoding="utf-8") as f:
            return json.load(f).get("council_geometry_sha256")
    except Exception:
        return None

def existing_network_format() -> str | None:
    if not OUT.exists():
        return None
    try:
        with OUT.open("r", encoding="utf-8") as f:
            return json.load(f).get("format")
    except Exception:
        return None

def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rules = load_official_rules()
    age = existing_network_age_days()
    current_council_hash = council_routes_sha256()
    cached_council_hash = existing_network_council_hash()
    if (
        existing_network_is_valid()
        and existing_network_format() == "mk-redway-network-v5"
        and age is not None and age < 7
        and current_council_hash == cached_council_hash
        and os.environ.get("FORCE_NETWORK_REFRESH") != "1"
    ):
        print(f"Reusing cached routing network generated {age:.1f} days ago; council layer is unchanged.", flush=True)
        return 0
    if current_council_hash != cached_council_hash:
        print("Council map extract changed; rebuilding routing classification.", flush=True)

    lat_mid = (SOUTH + NORTH) / 2
    lon_mid = (WEST + EAST) / 2
    overlap = 0.002
    tiles = [
        (SOUTH, WEST, lat_mid + overlap, lon_mid + overlap),
        (SOUTH, lon_mid - overlap, lat_mid + overlap, EAST),
        (lat_mid - overlap, WEST, NORTH, lon_mid + overlap),
        (lat_mid - overlap, lon_mid - overlap, NORTH, EAST),
    ]

    nodes_by_osm: dict[int, tuple[float, float]] = {}
    ways_by_osm: dict[int, tuple[list[int], dict[str, str]]] = {}
    cycle_relations: dict = {"elements": []}
    try:
        pbf = download_geofabrik_pbf()
        nodes_by_osm, ways_by_osm, cycle_relations = load_osm_from_pbf(pbf)
    except Exception as exc:  # noqa: BLE001
        print(f"Geofabrik routing refresh failed: {exc}", file=sys.stderr)
        if existing_network_is_valid():
            print("Keeping the cached network.json restored by GitHub Actions.", flush=True)
            return 0
        return 2

    route_classes: dict[int, str] = {}
    route_names: dict[int, str] = {}
    route_refs: dict[int, str] = {}
    try:
        route_classes, route_names, route_refs = relation_classes(cycle_relations, rules)
        super_count = sum(1 for x in route_classes.values() if x == "super_redway")
        leisure_count = sum(1 for x in route_classes.values() if x == "leisure")
        print(f"Classified {super_count:,} Super Redway way memberships and {leisure_count:,} leisure-route memberships from the local OSM extract.", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"Route-class metadata unavailable; continuing with Redway tag classification: {exc}", flush=True)

    # Prefer the actual line classifications captured from the council's interactive map.
    # We retain OSM relations/corridor inference only as fallback where the website extract
    # is unavailable or does not cover a particular edge.
    council_features = load_council_routes()
    council_index = build_council_route_index(council_features)
    council_matched = {"super_redway": 0, "redway": 0, "leisure": 0}
    council_props: dict[int, dict] = {}
    if council_features:
        print(f"Loaded {len(council_features):,} official Get Around MK line features.", flush=True)
        for way_id, (node_ids, tags) in ways_by_osm.items():
            # Only path/cycling-compatible OSM geometry should inherit an official path layer.
            if tags.get("highway") not in {"path", "cycleway", "footway", "pedestrian", "bridleway", "track"}:
                continue
            matched = match_council_class(node_ids, nodes_by_osm, council_index)
            if not matched:
                continue
            cls, props = matched
            route_classes[way_id] = cls
            council_props[way_id] = props
            council_matched[cls] += 1
            name = str(props.get("name") or props.get("title") or "").strip()
            ref = str(props.get("ref") or props.get("route_ref") or "").strip().upper()
            if cls == "super_redway":
                official_ref = identify_super_ref({"name": name, "ref": ref}, super_route_lookup(rules)[0])
                if official_ref:
                    route_refs[way_id] = official_ref
                    route_names[way_id] = super_route_lookup(rules)[1][official_ref]
                elif name:
                    route_names[way_id] = name
            elif name:
                route_names[way_id] = name
        print(
            "Official website geometry matched "
            f"{council_matched['super_redway']:,} Super Redway, "
            f"{council_matched['redway']:,} Redway and "
            f"{council_matched['leisure']:,} leisure OSM ways.",
            flush=True,
        )
    else:
        print("No current council-map geometry extract is available; using classification fallbacks.", flush=True)

    # Fallback for Super Route sections not captured from the interactive map.
    corridor_index = build_official_corridor_index(ways_by_osm, nodes_by_osm, rules)
    inferred = 0
    direct = 0
    aliases, official_names = super_route_lookup(rules)
    for way_id, (node_ids, tags) in ways_by_osm.items():
        if way_id in council_props or route_classes.get(way_id) == "super_redway":
            continue
        # Some Redway ways carry the H/V route reference themselves. Use that direct
        # official identifier before falling back to geometric corridor matching.
        route_ref = identify_super_ref(tags, aliases) if is_redway_tags(tags) else None
        if route_ref:
            direct += 1
        else:
            route_ref = infer_official_super_route(node_ids, tags, nodes_by_osm, corridor_index)
            if route_ref:
                inferred += 1
        if route_ref:
            route_classes[way_id] = "super_redway"
            route_refs[way_id] = route_ref
            route_names[way_id] = official_names[route_ref]
    print(f"Official identifiers added {direct:,} and corridor matching added {inferred:,} Super Redway way segments.", flush=True)

    referenced: set[int] = set()
    for node_ids, _ in ways_by_osm.values():
        referenced.update(node_ids)
    referenced.intersection_update(nodes_by_osm.keys())

    remap = {osm_id: idx for idx, osm_id in enumerate(sorted(referenced))}
    compact_nodes = [
        [remap[osm_id], round(nodes_by_osm[osm_id][0], 6), round(nodes_by_osm[osm_id][1], 6)]
        for osm_id in sorted(referenced)
    ]
    compact_ways = []
    for way_id, (node_ids, tags) in ways_by_osm.items():
        compact = [remap[x] for x in node_ids if x in remap]
        if len(compact) <= 1:
            continue
        if way_id in route_classes:
            tags["_mk_class"] = route_classes[way_id]
            if route_names.get(way_id):
                tags["_mk_route_name"] = route_names[way_id]
            if route_refs.get(way_id):
                tags["_mk_route_ref"] = route_refs[way_id]
            if way_id in council_props:
                tags["_mk_class_source"] = "Get Around MK interactive map (used with council permission) + OSM routable geometry"
            else:
                tags["_mk_class_source"] = "Get Around MK designation + OSM geometry" if route_classes[way_id] == "super_redway" else "OSM route metadata"
        compact_ways.append([way_id, compact, tags])

    payload = {
        "format": "mk-redway-network-v5",
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "bbox": [SOUTH, WEST, NORTH, EAST],
        "classification": "Get Around MK interactive-map Redway/Super Redway/Leisure geometry matched to Geofabrik/OSM routable geometry; OSM/corridor rules are fallback only",
        "osm_source": GEOFABRIK_URL,
        "council_geometry_source": "https://getaroundmk.org.uk/interactive-map?cycle-paths=1",
        "council_geometry_features": len(council_features),
        "council_geometry_sha256": current_council_hash,
        "council_geometry_permission": "Used with permission from Milton Keynes City Council as confirmed by the project owner.",
        "classification_sources": rules.get("sources", {}),
        "official_super_routes": [r.get("ref") for r in rules.get("super_routes", [])],
        "nodes": compact_nodes,
        "ways": compact_ways,
    }
    with TMP.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(TMP, OUT)
    mib = OUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT}: {len(compact_nodes):,} nodes, {len(compact_ways):,} ways, {mib:.2f} MiB", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
