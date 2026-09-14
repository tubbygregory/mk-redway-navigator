#!/usr/bin/env python3
"""Extract council classifications from the KML sources used by its public map.

Discover current source URLs in the website HTML/JavaScript and select only the
six files verified against its Cycle Paths filter bindings. Never classify
Google basemap geometry or hidden layers by the currently selected filter.
Keep council attribution in DATA-LICENCE.md.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlparse
from typing import Any
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "council_routes.geojson"
DIAG = ROOT / "data" / "council-route-extract-diagnostics.json"
URL = "https://getaroundmk.org.uk/interactive-map"
BBOX = (-0.94, 51.93, -0.57, 52.18)  # west,south,east,north; generous MK envelope

CLASS_TERMS = {
    "super_redway": ("redway super", "super redway", "super route", "superroute"),
    "leisure": ("leisure route", "leisure"),
    "redway": ("redway route", "redways", "redway"),
}


def classify_text(*values: Any) -> str | None:
    text = " ".join(str(v or "") for v in values).lower()
    text = re.sub(r"\s+", " ", text)
    # Specific before general: Super Redway contains 'redway'.
    for cls in ("super_redway", "leisure", "redway"):
        if any(term in text for term in CLASS_TERMS[cls]):
            return cls
    return None


def valid_lonlat(pt: Any) -> bool:
    return (
        isinstance(pt, (list, tuple)) and len(pt) >= 2
        and isinstance(pt[0], (int, float)) and isinstance(pt[1], (int, float))
        and BBOX[0] <= float(pt[0]) <= BBOX[2]
        and BBOX[1] <= float(pt[1]) <= BBOX[3]
    )


def line_in_mk(coords: Any) -> bool:
    if not isinstance(coords, list) or len(coords) < 2:
        return False
    flat = coords
    while flat and isinstance(flat[0], list) and flat[0] and isinstance(flat[0][0], list):
        flat = [p for part in flat for p in part]
    return sum(1 for p in flat if valid_lonlat(p)) >= 2


def extract_kml(text: str, context: str = "") -> list[dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    out = []
    for pm in root.findall(".//{*}Placemark"):
        name = pm.findtext("{*}name") or ""
        desc = pm.findtext("{*}description") or ""
        cls = classify_text(context, name, desc)
        if not cls:
            continue
        for node in pm.findall(".//{*}LineString/{*}coordinates"):
            coords = []
            for token in (node.text or "").replace("\n", " ").split():
                parts = token.split(",")
                if len(parts) >= 2:
                    try:
                        coords.append([float(parts[0]), float(parts[1])])
                    except ValueError:
                        pass
            if line_in_mk(coords):
                out.append({"type": "Feature", "properties": {"route_class": cls, "name": name}, "geometry": {"type": "LineString", "coordinates": coords}})
    return out


def extract_kml_blob(blob: bytes, context: str = "") -> list[dict]:
    """Extract KML features from either a plain KML response or a KMZ archive."""
    if blob[:4] == b"PK\x03\x04":
        out: list[dict] = []
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".kml"):
                        out.extend(extract_kml(zf.read(name).decode("utf-8", "ignore"), f"{context} {name}"))
        except Exception:
            return []
        return out
    return extract_kml(blob.decode("utf-8", "ignore"), context)


def find_kml_urls(text: str, base_url: str = URL) -> list[str]:
    """Find literal KML/KMZ links in HTML/JS, including JSON-escaped URLs."""
    if not text:
        return []
    cleaned = text.replace("\\/", "/").replace("\\u0026", "&")
    found: list[str] = []
    patterns = [
        r"(?i)https?://[^\s\"'<>]+?\.(?:kml|kmz)(?:\?[^\s\"'<>]*)?",
        r"(?i)[\"']([^\"']+?\.(?:kml|kmz)(?:\?[^\"']*)?)[\"']",
    ]
    for idx, pattern in enumerate(patterns):
        for match in re.finditer(pattern, cleaned):
            raw = match.group(0) if idx == 0 else match.group(1)
            raw = raw.strip("\"' ").replace("&amp;", "&")
            url = urljoin(base_url, raw)
            if url not in found:
                found.append(url)
    return found


def dedupe(features: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for f in features:
        coords = f["geometry"]["coordinates"]
        # Rounded fingerprint tolerates duplicate payloads and reversed lines.
        rounded = tuple((round(float(p[0]), 5), round(float(p[1]), 5)) for p in coords if valid_lonlat(p))
        if len(rounded) < 2:
            continue
        rev = tuple(reversed(rounded))
        keyline = min(rounded, rev)
        key = (f["properties"].get("route_class"), keyline)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out



# Verified against the council site's Cycle Paths filter bindings. Discover the
# current URLs rather than capturing every KmlLayer.setMap call (including off).
SOURCE_FILES = {
    "Redway_Super_Routes.kmz": "super_redway",
    "GIS_Redway_layer_2019.kmz": "redway",
    **{f"LeisureRouteNetwork_9_04_2019-{i}.kmz": "leisure" for i in range(1, 5)},
}


def discover_sources(texts: list[str]) -> dict[str, str]:
    found = {}
    for text in texts:
        for url in find_kml_urls(text):
            name = urlparse(url).path.rsplit("/", 1)[-1]
            if name in SOURCE_FILES:
                if name in found and found[name] != url:
                    raise ValueError(f"Conflicting source URLs for {name}")
                found[name] = url
    missing = SOURCE_FILES.keys() - found.keys()
    if missing:
        raise ValueError(f"Missing required council sources: {sorted(missing)}")
    return found


def download(url: str) -> bytes:
    from urllib.request import Request, urlopen
    with urlopen(Request(url, headers={"User-Agent": "MK-Redway-Navigator/1.0"}), timeout=45) as response:
        body = response.read(20_000_001)
    if len(body) > 20_000_000:
        raise ValueError(f"Council response exceeds 20 MB: {url}")
    return body


def main() -> int:
    from html.parser import HTMLParser

    class Scripts(HTMLParser):
        def __init__(self):
            super().__init__()
            self.urls = []

        def handle_starttag(self, tag, attrs):
            if tag == "script" and dict(attrs).get("src"):
                url = urljoin(URL, dict(attrs)["src"])
                if urlparse(url).hostname == urlparse(URL).hostname:
                    self.urls.append(url)

    diagnostics = {"url": URL, "sources": [], "errors": []}
    features = []
    try:
        html = download(URL).decode("utf-8")
        parser = Scripts()
        parser.feed(html)
        scripts = [download(url).decode("utf-8") for url in dict.fromkeys(parser.urls)]
        sources = discover_sources([html, *scripts])
        for name, url in sources.items():
            cls = SOURCE_FILES[name]
            parsed = extract_kml_blob(download(url), cls.replace("_", " "))
            for feature in parsed:
                feature["properties"].update(route_class=cls, source_url=url,
                                              capture="council website KML source")
            parsed = dedupe(parsed)
            if not parsed:
                raise ValueError(f"No usable lines in required source: {name}")
            diagnostics["sources"].append({"url": url, "route_class": cls, "features": len(parsed)})
            features.extend(parsed)
        features = dedupe(features)
        counts = {cls: sum(f["properties"]["route_class"] == cls for f in features)
                  for cls in ("super_redway", "redway", "leisure")}
        diagnostics.update(feature_counts=counts, total_features=len(features))
        # Verified leisure KMZs contain about 150,000 short line fragments.
        # Source identity and cross-category checks guard against contamination.
        if not 20 <= len(features) <= 200_000 or not all(counts.values()):
            raise ValueError(f"Incomplete or contaminated extract: {counts}")
        geometries = {cls: {json.dumps(f["geometry"]["coordinates"]) for f in features
                           if f["properties"]["route_class"] == cls} for cls in counts}
        if any(geometries[a] == geometries[b] for a, b in
               (("super_redway", "redway"), ("super_redway", "leisure"), ("redway", "leisure"))):
            raise ValueError("Two council categories contain identical geometry sets")
        payload = {
            "type": "FeatureCollection",
            "name": "Get Around MK official cycle-path classifications",
            "source": URL,
            "permission": "Used with permission from Milton Keynes City Council as confirmed by the project owner.",
            "features": features,
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        tmp = OUT.with_suffix(".geojson.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(OUT)
        print(f"Wrote {OUT}: {len(features):,} lines — {counts}")
        return 0
    except Exception as exc:
        diagnostics["errors"].append(str(exc))
        print(f"Council-map extraction failed: {exc}; retaining any cached extract.")
        return 2
    finally:
        DIAG.parent.mkdir(parents=True, exist_ok=True)
        DIAG.write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

