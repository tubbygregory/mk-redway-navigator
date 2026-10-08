"""Validate the source-hosted Cultural Route GPX copies used by the browser."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SOURCE_PAGE = "https://getaroundmk.org.uk/cycling/where-to-ride/cultural-routes"
SOURCE_DIRECTORY = "https://getaroundmk.org.uk/wp-content/uploads/2020/07/"
OFFICIAL_ROUTES = {
    "blue": ("Blue", "Ancient & Modern Milton Keynes"),
    "yellow": ("Yellow", "Cars, Boats & Trains"),
    "green": ("Green", "Rivers, Lakes & Dinosaurs"),
    "iron": ("Iron", "Romans, Rivers, Trams & Trains"),
    "cornflower": ("Cornflower", "Woods, Frogs & a Toot"),
}
MAX_GPX_BYTES = 10 * 1024 * 1024
MAX_POINTS = 100_000
GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1"
MK_BOUNDS = (51.955, -0.905, 52.155, -0.615)


def _read(path: Path, limit: int) -> bytes:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
            raise ValueError(f"Missing, linked or oversized Cultural Route asset: {path.name}")
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f"Oversized Cultural Route asset: {path.name}")
        return data
    except OSError as exc:
        raise ValueError(f"Cannot read Cultural Route asset: {path.name}") from exc


def _validate_gpx(data: bytes, variant: str, filename: str) -> None:
    try:
        text = data.decode("utf-8-sig")
        if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
            raise ValueError("DTD/entity declarations are unsupported")
        root = ET.fromstring(text)
        if root.tag != f"{{{GPX_NAMESPACE}}}gpx" or root.get("version") != "1.1":
            raise ValueError("Expected GPX 1.1 document")
        sections = [e for e in root.iter() if e.tag in
                    {f"{{{GPX_NAMESPACE}}}trkseg", f"{{{GPX_NAMESPACE}}}rte"}]
        if len(sections) != 1:
            raise ValueError("Expected one continuous GPX section")
        tag = "trkpt" if sections[0].tag.endswith("trkseg") else "rtept"
        points = [e for e in sections[0] if e.tag == f"{{{GPX_NAMESPACE}}}{tag}"]
        all_points = [e for e in root.iter() if e.tag in
                      {f"{{{GPX_NAMESPACE}}}trkpt", f"{{{GPX_NAMESPACE}}}rtept"}]
        if points != all_points or not 2 <= len(points) <= MAX_POINTS:
            raise ValueError("Invalid GPX point count or points outside the section")
        coords = [(float(point.attrib["lat"]), float(point.attrib["lon"])) for point in points]
        south, west, north, east = MK_BOUNDS
        if not all(math.isfinite(lat) and math.isfinite(lon)
                   and south <= lat <= north and west <= lon <= east for lat, lon in coords):
            raise ValueError("Non-finite or outside-MK GPX coordinate")
        if len(set(coords)) < 2:
            raise ValueError("GPX contains no usable geometry")
        closed = coords[0] == coords[-1]
        if (variant == "full") != closed:
            raise ValueError("Full routes must be closed; shortcut files must be open segments")
    except (UnicodeError, ET.ParseError, KeyError, ValueError) as exc:
        raise ValueError(f"Invalid Cultural Route GPX {filename}: {exc}") from exc


def validate_cultural_routes(directory: Path | str) -> list[str]:
    """Return only validated relative runtime filenames, without altering geometry."""
    directory = Path(directory)
    try:
        manifest = json.loads(_read(directory / "manifest.json", 100_000))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid Cultural Route manifest JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("sourcePage") != SOURCE_PAGE:
        raise ValueError("Cultural Route manifest must identify the official source page")
    try:
        stamp = manifest["verifiedOn"]
        if not isinstance(stamp, str) or dt.date.fromisoformat(stamp).isoformat() != stamp:
            raise ValueError("Invalid verification date")
    except (KeyError, ValueError) as exc:
        raise ValueError("Cultural Route manifest needs an ISO verification date") from exc
    routes = manifest.get("routes")
    if not isinstance(routes, list) or len(routes) != len(OFFICIAL_ROUTES):
        raise ValueError("Cultural Route manifest must contain exactly five official routes")
    seen = set()
    filenames = ["manifest.json"]
    for route in routes:
        if not isinstance(route, dict):
            raise ValueError("Invalid Cultural Route manifest entry")
        route_id = route.get("id")
        if not isinstance(route_id, str) or route_id not in OFFICIAL_ROUTES or route_id in seen:
            raise ValueError("Invalid or duplicate Cultural Route ID")
        seen.add(route_id)
        if (route.get("color"), route.get("title")) != OFFICIAL_ROUTES[route_id]:
            raise ValueError(f"Cultural Route identity differs from the official source: {route_id}")
        files = route.get("files")
        if not isinstance(files, dict) or set(files) != {"full", "shortcut"}:
            raise ValueError(f"Expected full and shortcut source files: {route_id}")
        for variant, suffix in (("full", "main"), ("shortcut", "short")):
            entry = files[variant]
            filename = f"gpx-{route_id}-{suffix}.gpx"
            if not isinstance(entry, dict) or entry.get("path") != filename or entry.get("sourceUrl") != SOURCE_DIRECTORY + filename:
                raise ValueError(f"Unexpected Cultural Route filename or source URL: {route_id}/{variant}")
            digest = entry.get("sha256")
            if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
                raise ValueError(f"Invalid Cultural Route source checksum: {filename}")
            data = _read(directory / filename, MAX_GPX_BYTES)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f"Cultural Route source checksum mismatch: {filename}")
            _validate_gpx(data, variant, filename)
            filenames.append(filename)
    if {path.name for path in directory.iterdir()} != set(filenames):
        raise ValueError("Unexpected files in the Cultural Route runtime directory")
    return sorted(filenames)
