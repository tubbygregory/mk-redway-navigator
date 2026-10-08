"""Validation for the bounded, source-derived MK place/address search asset.

v1 stores OSM object IDs and explicit name/address tags separately. Way locations
are labelled centres, never inferred entrances or interpolated house numbers.
"""
import datetime as dt
import math
import re

FORMAT = "mk-redway-places-v1"
SOURCE = "OpenStreetMap / Geofabrik"
BOUNDS = {"south": 51.955, "west": -0.905, "north": 52.155, "east": -0.615}
MAX_ENTRIES = 50_000
TEXT_LIMITS = {"name": 200, "house_number": 40, "street": 200,
               "postcode": 32, "locality": 160, "category": 80}
LOCATIONS = {"mapped point", "building centre", "mapped feature centre"}


def _timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Place index timestamp must be an ISO timestamp")
    match = re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))", value)
    if match is None or any(int(part or 0) > limit for part, limit in zip(match.groups(), (23, 59))):
        raise ValueError("Place index timestamp must use a canonical ISO timezone")
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Invalid place index timestamp") from exc
    if stamp.tzinfo is None:
        raise ValueError("Place index timestamp must include its timezone")
    return stamp


def _text(value, limit):
    return (isinstance(value, str) and 0 < len(value) <= limit
            and value == value.strip() and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def validate_places(data):
    """Reject malformed or misleading v1 search data; return release counts."""
    required = {"format", "source", "source_timestamp", "source_sha256", "generated_at", "bounds", "entries"}
    if not isinstance(data, dict) or set(data) != required or data.get("format") != FORMAT or data.get("source") != SOURCE:
        raise ValueError("Unsupported place index format or source")
    digest = data.get("source_sha256")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise ValueError("Place index needs a source SHA256")
    source_stamp, generated_stamp = _timestamp(data["source_timestamp"]), _timestamp(data["generated_at"])
    latest = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=24)
    if source_stamp > latest or generated_stamp > latest:
        raise ValueError("Place index timestamp is unexpectedly in the future")
    if source_stamp > generated_stamp:
        raise ValueError("Place index generation predates its source snapshot")
    if data["bounds"] != BOUNDS:
        raise ValueError("Place index must use the supported MK bounds")
    entries = data["entries"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ENTRIES:
        raise ValueError("Place index is empty or exceeds its reviewed limit")
    ids = set()
    required_entry = {"id", "kind", "lat", "lon", "location"}
    allowed_entry = required_entry | set(TEXT_LIMITS) | {"aliases"}
    for entry in entries:
        if not isinstance(entry, dict) or not required_entry <= set(entry) or not set(entry) <= allowed_entry:
            raise ValueError("Malformed place index entry")
        source_id = entry["id"]
        if not isinstance(source_id, str) or re.fullmatch(r"[nw][1-9][0-9]{0,19}", source_id) is None or source_id in ids:
            raise ValueError("Invalid or duplicate place source ID")
        ids.add(source_id)
        lat, lon = entry["lat"], entry["lon"]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lon)):
            raise ValueError("Place coordinates must be numbers")
        if not (BOUNDS["south"] <= lat <= BOUNDS["north"] and BOUNDS["west"] <= lon <= BOUNDS["east"]
                and math.isfinite(lat) and math.isfinite(lon)):
            raise ValueError("Non-finite or outside-MK place coordinate")
        for key, limit in TEXT_LIMITS.items():
            if key in entry and not _text(entry[key], limit):
                raise ValueError(f"Invalid place text field: {key}")
        location = entry["location"]
        if not isinstance(location, str) or location not in LOCATIONS or (source_id.startswith("n")) != (location == "mapped point"):
            raise ValueError("Place location must distinguish mapped points from derived centres")
        kind = entry["kind"]
        if kind == "place":
            valid_kind = bool(entry.get("name") and entry.get("category"))
        elif kind == "address":
            valid_kind = bool(entry.get("street") and (entry.get("house_number") or entry.get("name")))
        elif kind == "building":
            valid_kind = bool(entry.get("name") and entry.get("street") and not entry.get("house_number"))
        else:
            valid_kind = False
        if not valid_kind:
            raise ValueError("Place entry lacks the source fields required by its kind")
        if "aliases" in entry:
            aliases = entry["aliases"]
            if not isinstance(aliases, list) or not 1 <= len(aliases) <= 8 or not all(_text(alias, 200) for alias in aliases):
                raise ValueError("Invalid place aliases")
            folded = [alias.casefold() for alias in aliases]
            if len(set(folded)) != len(folded) or entry.get("name", "").casefold() in folded:
                raise ValueError("Duplicate place aliases")
    return {"entries": len(entries)}
