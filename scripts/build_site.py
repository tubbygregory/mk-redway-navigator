"""Validate inputs and assemble the browser-only Pages artifact."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen
from data_validation import validate_network, validate_council, council_digest

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
RUNTIME = ("index.html", "styles.css", "app.js", "routing.js", "about.js",
           "sw.js", "manifest.webmanifest", "DATA-LICENCE.md", "LICENSE", ".nojekyll")
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def read_optional(path):
    return json.loads(path.read_text()) if path.exists() else {}
def main():
    data = ROOT / "data"
    network = json.loads((data / "network.json").read_text())
    counts = validate_network(network)
    council = read_optional(data / "council-meta.json")
    extract = read_optional(data / "council_routes.geojson")
    if extract:
        validate_council(extract)
    linked = bool(extract) and council_digest(extract) == network.get("council_geometry_sha256")
    status = council.get("status", "cached") if linked else ("cached" if network.get("council_geometry_features") else "fallback")
    made = dt.datetime.fromisoformat(network["generated_at"].replace("Z", "+00:00"))
    age = (dt.datetime.now(dt.timezone.utc) - made).total_seconds() / 86400
    if age < -1:
        raise ValueError("Network generation date is in the future")
    basemap = data / "mk-basemap.pmtiles"
    with basemap.open("rb") as file:
        if file.read(8) != b"PMTiles\x03" or basemap.stat().st_size < 100_000:
            raise ValueError("Missing or invalid offline basemap")
    stamp = data / "mk-basemap-build.txt"
    meta = {
        "app_version": (ROOT / "VERSION").read_text().strip(),
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "network": {"format": network["format"], "generated_at": network["generated_at"],
                    "sha256": sha(data / "network.json"), "age_days": round(age, 1),
                    "stale": age >= 7, **counts},
        "osm": {"source": network.get("osm_source"), "updated_at": network.get("osm_updated_at")},
        "council": {"status": status, "extracted_at": council.get("extracted_at") if linked else None,
                    "geometry_sha256": network.get("council_geometry_sha256"),
                    "source": network.get("council_geometry_source"), "matches_latest_extract": linked},
        "basemap": {"built_on": stamp.read_text().strip() if stamp.exists() else None,
                    "source": "https://build.protomaps.com/", "source_date": dt.datetime.strptime((data / "mk-basemap-source-date.txt").read_text()[:8], "%Y%m%d").date().isoformat() if (data / "mk-basemap-source-date.txt").exists() else None, "sha256": sha(basemap)}
    }
    if status != "fresh" or age >= 7 or not linked:
        print(f"::warning::Publishing validated last-known-good data: council={status}, network age={age:.1f} days, latest classification matched={linked}")
    shutil.rmtree(DIST, ignore_errors=True)
    (DIST / "data").mkdir(parents=True)
    for name in RUNTIME:
        shutil.copy2(ROOT / name, DIST / name)
    shutil.copytree(ROOT / "icons", DIST / "icons")
    for name in ("network.json", "mk-basemap.pmtiles"):
        shutil.copy2(data / name, DIST / "data" / name)
    (DIST / "data" / "data-meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    dependencies = json.loads((ROOT / "runtime-dependencies.json").read_text())
    for item in dependencies:
        target = DIST / item["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(item["url"], timeout=60) as response:
            body = response.read()
        digest = hashlib.sha256(body).hexdigest()
        if not item.get("sha256") or item["sha256"] != digest:
            raise ValueError(f"Dependency checksum changed: {item['path']}")
        target.write_bytes(body)
        item["sha256"] = digest
    print("DEPENDENCY_LOCK=" + json.dumps(dependencies, separators=(",", ":")))
    allowed = set(RUNTIME) | {"data/network.json", "data/mk-basemap.pmtiles", "data/data-meta.json"}
    allowed.update(item["path"] for item in dependencies)
    allowed.update(str(path.relative_to(ROOT)) for path in (ROOT / "icons").glob("*") if path.is_file())
    actual = {str(path.relative_to(DIST)) for path in DIST.rglob("*") if path.is_file()}
    if actual != allowed:
        raise ValueError(f"Unexpected Pages files: {actual ^ allowed}")
    print("Pages runtime artifact: " + ", ".join(sorted(actual)))
    print(json.dumps(meta, indent=2))
if __name__ == "__main__":
    main()
