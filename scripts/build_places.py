#!/usr/bin/env python3
"""Generate bounded local MK search data without geocoder requests.

Only explicit OSM POI/address/building tags produce entries. Numeric building
names such as Huntley's '8-55' remain building names; no house 25 is fabricated.
The separate asset leaves the routing v6 graph and weights unchanged.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sys

import osmium

from build_network import download_geofabrik_pbf
from place_validation import BOUNDS, FORMAT, SOURCE, TEXT_LIMITS, validate_places

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "places.json"
POI_TAGS = ("amenity", "shop", "tourism", "leisure", "office", "healthcare", "public_transport")
ALIAS_TAGS = ("alt_name", "name:en", "short_name", "brand")


def _text(tags, key, limit=200):
    text = str(tags.get(key) or "").strip()
    if not text or len(text) > limit or any(ord(char) < 32 or ord(char) == 127 for char in text):
        return ""
    return text


def _centre(points):
    """Derive a feature centre from source vertices, with stable small-polygon sums."""
    if len(points) >= 4 and points[0] == points[-1]:
        lat0, lon0 = points[0]
        area = x = y = 0.0
        for a, b in zip(points, points[1:]):
            ax, ay = a[1] - lon0, a[0] - lat0
            bx, by = b[1] - lon0, b[0] - lat0
            cross = ax * by - bx * ay
            area += cross
            x += (ax + bx) * cross
            y += (ay + by) * cross
        if abs(area) > 1e-18:
            return lat0 + y / (3 * area), lon0 + x / (3 * area)
        points = points[:-1]
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def _entry(tags, source_id, coordinates, *, way=False):
    lat, lon = coordinates
    if not (math.isfinite(lat) and math.isfinite(lon) and BOUNDS["south"] <= lat <= BOUNDS["north"]
            and BOUNDS["west"] <= lon <= BOUNDS["east"]):
        return None
    if tags.get("addr:interpolation"):
        return None
    name = _text(tags, "name") or _text(tags, "name:en")
    house_name = _text(tags, "addr:housename")
    number = _text(tags, "addr:housenumber", TEXT_LIMITS["house_number"])
    street = _text(tags, "addr:street")
    category = next((_text(tags, key, 80) for key in POI_TAGS if _text(tags, key, 80)), "")
    if not category and tags.get("railway") in {"station", "halt"}:
        category = tags["railway"]
    building = tags.get("building") not in {None, "", "no"}
    if name and category:
        kind = "place"
    elif street and (number or house_name):
        kind = "address"
        name = name or house_name
    elif name and street and building:
        kind = "building"
        category = _text(tags, "building", 80)
    else:
        return None
    entry = {"id": source_id, "kind": kind, "lat": round(lat, 6), "lon": round(lon, 6),
             "location": "building centre" if way and building else "mapped feature centre" if way else "mapped point"}
    fields = {"name": name, "house_number": number, "street": street,
              "postcode": _text(tags, "addr:postcode", 32),
              "locality": _text(tags, "addr:suburb", 160) or _text(tags, "addr:city", 160) or _text(tags, "addr:place", 160),
              "category": category}
    entry.update({key: value for key, value in fields.items() if value})
    aliases, seen = [], {name.casefold()}
    for key in ALIAS_TAGS:
        for value in str(tags.get(key) or "").split(";"):
            alias = _text({key: value}, key)
            if alias and alias.casefold() not in seen:
                aliases.append(alias)
                seen.add(alias.casefold())
    if aliases:
        entry["aliases"] = aliases[:8]
    return entry


def extract_places(source_path: Path | str) -> list[dict]:
    """Read nodes and ways from OSM XML/PBF, without inventing addresses or geometry."""
    class Places(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.entries = []

        def node(self, node):
            if not node.location.valid():
                return
            tags = {tag.k: tag.v for tag in node.tags}
            entry = _entry(tags, f"n{node.id}", (node.location.lat, node.location.lon))
            if entry:
                self.entries.append(entry)

        def way(self, way):
            tags = {tag.k: tag.v for tag in way.tags}
            if not (tags.get("addr:street") or any(tags.get(key) for key in POI_TAGS) or tags.get("railway") in {"station", "halt"}):
                return
            if len(way.nodes) < 2 or any(not node.location.valid() for node in way.nodes):
                return
            points = [(node.location.lat, node.location.lon) for node in way.nodes]
            entry = _entry(tags, f"w{way.id}", _centre(points), way=True)
            if entry:
                self.entries.append(entry)

    handler = Places()
    handler.apply_file(str(source_path), locations=True, idx="flex_mem")
    return sorted(handler.entries, key=lambda entry: entry["id"])


def build_places(source_path: Path | str, output_path: Path | str = OUT) -> dict:
    source_path, output_path = Path(source_path), Path(output_path)
    digest = hashlib.sha256()
    with source_path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    with osmium.io.Reader(str(source_path)) as reader:
        source_timestamp = reader.header().get("osmosis_replication_timestamp")
    if output_path.exists():
        try:
            previous = json.loads(output_path.read_text())
            validate_places(previous)
            if previous["source_sha256"] == digest.hexdigest() and previous["source_timestamp"] == source_timestamp:
                print(f"Reusing validated MK place index: {len(previous['entries']):,} entries", flush=True)
                return previous
        except (OSError, ValueError):
            pass
    payload = {"format": FORMAT, "source": SOURCE, "source_timestamp": source_timestamp,
               "source_sha256": digest.hexdigest(), "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
               "bounds": dict(BOUNDS), "entries": extract_places(source_path)}
    counts = validate_places(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(output_path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(output_path)
    print(f"Wrote {output_path}: {counts['entries']:,} source-derived entries, {output_path.stat().st_size:,} bytes", flush=True)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing OSM extract; defaults to the verified HTTPS Geofabrik helper")
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    try:
        build_places(args.source or download_geofabrik_pbf(), args.output)
        return 0
    except Exception as exc:
        print(f"MK place index refresh failed: {exc}", file=sys.stderr)
        try:
            previous = json.loads(args.output.read_text())
            validate_places(previous)
        except (OSError, ValueError):
            return 2
        print("Keeping the validated cached place index; its source date is unchanged.", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
