"""Shared release validation. Invalid data must never replace last-known-good data."""
import hashlib
import json
import math
from urllib.parse import urlparse

FORMAT = "mk-redway-network-v5"
SOURCES = {
    "Redway_Super_Routes.kmz": "super_redway",
    "GIS_Redway_layer_2019.kmz": "redway",
    **{f"LeisureRouteNetwork_9_04_2019-{i}.kmz": "leisure" for i in range(1, 5)},
}

def source_class(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "getaroundmk.org.uk":
        raise ValueError("Council geometry must come from the Get Around MK HTTPS origin")
    name = parsed.path.rsplit("/", 1)[-1]
    if name not in SOURCES:
        raise ValueError("Unrecognised council layer")
    return SOURCES[name]

def validate_council(data):
    if data.get("type") != "FeatureCollection":
        raise ValueError("Expected council FeatureCollection")
    features = data.get("features", [])
    if not 20 <= len(features) <= 200_000:
        raise ValueError("Council feature count outside reviewed limits")
    groups = {key: set() for key in ("super_redway", "redway", "leisure")}
    source_names = set()
    for feature in features:
        props, geometry = feature["properties"], feature["geometry"]
        cls = props["route_class"]
        if source_class(props.get("source_url", "")) != cls:
            raise ValueError("Council source/category mismatch")
        source_names.add(urlparse(props["source_url"]).path.rsplit("/", 1)[-1])
        coords = geometry["coordinates"]
        if geometry["type"] != "LineString" or len(coords) < 2:
            raise ValueError("Invalid council line")
        if not all(len(p) >= 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p[:2])
                   and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in coords):
            raise ValueError("Invalid council coordinate")
        if sum(-.94 <= p[0] <= -.57 and 51.93 <= p[1] <= 52.18 for p in coords) < 2:
            raise ValueError("Council line outside MK")
        line = tuple(tuple(p[:2]) for p in coords)
        groups[cls].add(min(line, line[::-1]))
    if source_names != set(SOURCES):
        raise ValueError("Incomplete council source set")
    limits = {"super_redway": (1, 500), "redway": (10, 15_000), "leisure": (10, 180_000)}
    for cls, (low, high) in limits.items():
        if not low <= len(groups[cls]) <= high:
            raise ValueError(f"Implausible {cls} count: {len(groups[cls])}")
    for a, b in (("super_redway", "redway"), ("super_redway", "leisure"), ("redway", "leisure")):
        if groups[a] == groups[b]:
            raise ValueError("Identical council classification layers")
    return {key: len(value) for key, value in groups.items()}

def council_digest(data):
    # Ignore download timestamps, source URL query strings and feature order.
    lines = []
    for feature in data["features"]:
        coords = tuple(tuple(p[:2]) for p in feature["geometry"]["coordinates"])
        props = feature["properties"]
        lines.append((props["route_class"], props.get("name", ""), min(coords, coords[::-1])))
    raw = json.dumps(sorted(set(lines)), separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()

def validate_network(data):
    if data.get("format") != FORMAT:
        raise ValueError("Unsupported routing network format")
    nodes, ways = data.get("nodes", []), data.get("ways", [])
    if len(nodes) <= 1000 or len(ways) <= 100:
        raise ValueError("Routing graph is empty or implausibly small")
    ids = set()
    for node in nodes:
        if len(node) != 3 or not isinstance(node[0], int) or node[0] in ids:
            raise ValueError("Invalid or duplicate routing node")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in node[1:]):
            raise ValueError("Non-finite routing coordinate")
        if not -90 <= node[1] <= 90 or not -180 <= node[2] <= 180:
            raise ValueError("Routing coordinate out of range")
        ids.add(node[0])
    for way in ways:
        if len(way) != 3 or len(way[1]) < 2 or not isinstance(way[2], dict):
            raise ValueError("Malformed routing way")
        if not all(node in ids for node in way[1]):
            raise ValueError("Routing way references missing node")
    return {"nodes": len(nodes), "ways": len(ways)}
