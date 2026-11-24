"""Fill missing build inputs from the last published MK Redway map."""
from datetime import date
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

DATA = Path(__file__).resolve().parents[1] / "data"
SOURCE = "https://mkredway.co.uk/data/"
FILES = {
    "network.json": "network",
    "places.json": "places",
    "mk-basemap.pmtiles": "basemap",
}


def open_published(name):
    request = Request(SOURCE + name, headers={"Cache-Control": "no-cache"})
    return urlopen(request, timeout=30)


def main():
    missing = {name: key for name, key in FILES.items() if not (DATA / name).is_file()}
    if not missing:
        return

    DATA.mkdir(exist_ok=True)
    with open_published("data-meta.json") as response:
        metadata = json.load(response)

    for name, key in missing.items():
        target = DATA / name
        temporary = target.with_suffix(target.suffix + ".download")
        digest = hashlib.sha256()
        try:
            with open_published(name) as response, temporary.open("wb") as output:
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != metadata[key]["sha256"]:
                raise ValueError(f"Published {name} failed its metadata checksum")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        print(f"::warning::Using last published {name} after upstream refresh/cache miss")

    if "mk-basemap.pmtiles" in missing:
        for key, filename, pattern in (
            ("built_on", "mk-basemap-build.txt", "%Y-%m-%d"),
            ("source_date", "mk-basemap-source-date.txt", "%Y%m%d"),
        ):
            value = metadata["basemap"].get(key)
            if value:
                stamp = date.fromisoformat(value).strftime(pattern)
                (DATA / filename).write_text(stamp + "\n")


if __name__ == "__main__":
    main()
