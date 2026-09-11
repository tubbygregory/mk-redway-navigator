#!/usr/bin/env python3
"""Build the static Milton Keynes walking/cycling routing network for GitHub Pages.

The browser normally routes entirely from data/network.json. This script runs during
GitHub Pages deployment so end users do not depend on a public Overpass instance.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request

SOUTH, WEST, NORTH, EAST = 51.955, -0.905, 52.155, -0.615
HIGHWAYS = (
    "path|cycleway|footway|pedestrian|bridleway|track|steps|living_street|"
    "residential|service|unclassified|tertiary|tertiary_link|secondary|"
    "secondary_link|primary|primary_link"
)
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]
KEEP_TAGS = {
    "highway", "bicycle", "foot", "access", "oneway", "oneway:bicycle",
    "name", "ref", "bridge", "tunnel", "lit", "surface", "tracktype",
    "smoothness", "segregated",
}
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "network.json"
TMP = ROOT / "data" / "network.json.tmp"


def request_tile(s: float, w: float, n: float, e: float, tile_no: int) -> dict:
    query = (
        f'[out:json][timeout:120];'
        f'way["highway"~"^({HIGHWAYS})$"]({s},{w},{n},{e});'
        f'(._;>;);out body;'
    )
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    # Rotate the first endpoint so four tile requests are not all concentrated on one host.
    ordered = ENDPOINTS[tile_no % len(ENDPOINTS):] + ENDPOINTS[:tile_no % len(ENDPOINTS)]
    for endpoint in ordered:
        for attempt in range(2):
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=payload,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                        "Accept": "application/json",
                        "User-Agent": "MKRedwayNavigator-PoC/0.7 GitHub-Pages-build",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=150) as response:
                    if response.status != 200:
                        raise RuntimeError(f"HTTP {response.status}")
                    return json.load(response)
            except Exception as exc:  # noqa: BLE001 - deployment fallback is intentional
                last_error = exc
                wait = 3 + attempt * 5
                print(f"Tile {tile_no + 1}: {endpoint} attempt {attempt + 1} failed: {exc}; retrying in {wait}s", flush=True)
                time.sleep(wait)
    raise RuntimeError(f"All Overpass endpoints failed for tile {tile_no + 1}: {last_error}")


def existing_network_is_valid() -> bool:
    if not OUT.exists():
        return False
    try:
        with OUT.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return (
            data.get("format") == "mk-redway-network-v1"
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

def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    age = existing_network_age_days()
    if existing_network_is_valid() and age is not None and age < 7 and os.environ.get("FORCE_NETWORK_REFRESH") != "1":
        print(f"Reusing cached routing network generated {age:.1f} days ago.", flush=True)
        return 0
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
    try:
        for i, tile in enumerate(tiles):
            print(f"Fetching routing tile {i + 1}/{len(tiles)}…", flush=True)
            data = request_tile(*tile, tile_no=i)
            for element in data.get("elements", []):
                typ = element.get("type")
                if typ == "node" and "lat" in element and "lon" in element:
                    nodes_by_osm[int(element["id"])] = (float(element["lat"]), float(element["lon"]))
                elif typ == "way" and len(element.get("nodes", [])) > 1:
                    tags = {k: str(v) for k, v in (element.get("tags") or {}).items() if k in KEEP_TAGS}
                    ways_by_osm[int(element["id"])] = ([int(x) for x in element["nodes"]], tags)
    except Exception as exc:  # noqa: BLE001
        print(f"Network refresh failed: {exc}", file=sys.stderr)
        if existing_network_is_valid():
            print("Keeping the cached network.json restored by GitHub Actions.", flush=True)
            return 0
        return 2

    referenced = set()
    for node_ids, _ in ways_by_osm.values():
        referenced.update(node_ids)
    referenced.intersection_update(nodes_by_osm.keys())

    # Replace long OSM node ids with dense integer ids. This materially reduces download size.
    remap = {osm_id: idx for idx, osm_id in enumerate(sorted(referenced))}
    compact_nodes = [
        [remap[osm_id], round(nodes_by_osm[osm_id][0], 6), round(nodes_by_osm[osm_id][1], 6)]
        for osm_id in sorted(referenced)
    ]
    compact_ways = []
    for way_id, (node_ids, tags) in ways_by_osm.items():
        compact = [remap[x] for x in node_ids if x in remap]
        if len(compact) > 1:
            compact_ways.append([way_id, compact, tags])

    payload = {
        "format": "mk-redway-network-v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "bbox": [SOUTH, WEST, NORTH, EAST],
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
