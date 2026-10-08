import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from cultural_routes import validate_cultural_routes

SOURCE = "https://getaroundmk.org.uk/wp-content/uploads/2020/07/"
ROUTES = (
    ("blue", "Blue", "Ancient & Modern Milton Keynes"),
    ("yellow", "Yellow", "Cars, Boats & Trains"),
    ("green", "Green", "Rivers, Lakes & Dinosaurs"),
    ("iron", "Iron", "Romans, Rivers, Trams & Trains"),
    ("cornflower", "Cornflower", "Woods, Frogs & a Toot"),
)
CLOSED = [(52, -.78), (52.001, -.779), (52.002, -.78), (52, -.78)]
OPEN = CLOSED[:2]


def gpx(coords, *, route=False):
    point_tag, start, finish = ("rtept", "<rte>", "</rte>") if route else (
        "trkpt", "<trk><trkseg>", "</trkseg></trk>")
    points = "".join(f'<{point_tag} lat="{lat}" lon="{lon}"/>' for lat, lon in coords)
    return ('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">'
            + start + points + finish + '</gpx>').encode()


class CulturalRoutesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.manifest = {
            "sourcePage": "https://getaroundmk.org.uk/cycling/where-to-ride/cultural-routes",
            "verifiedOn": "2026-10-08", "routes": [],
        }
        for route_id, color, title in ROUTES:
            route = {"id": route_id, "color": color, "title": title, "files": {}}
            for variant, suffix, coords in (("full", "main", CLOSED), ("shortcut", "short", OPEN)):
                filename = f"gpx-{route_id}-{suffix}.gpx"
                data = gpx(coords)
                (self.directory / filename).write_bytes(data)
                route["files"][variant] = {
                    "path": filename, "sourceUrl": SOURCE + filename,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            self.manifest["routes"].append(route)
        self.write_manifest(self.manifest)

    def write_manifest(self, manifest):
        (self.directory / "manifest.json").write_text(json.dumps(manifest))

    def replace_gpx(self, variant, data, *, update_hash=True):
        entry = self.manifest["routes"][0]["files"][variant]
        (self.directory / entry["path"]).write_bytes(data)
        if update_hash:
            entry["sha256"] = hashlib.sha256(data).hexdigest()
            self.write_manifest(self.manifest)

    def test_validated_runtime_files_include_manifest_and_ten_tracks(self):
        expected = {"manifest.json"} | {f"gpx-{route_id}-{suffix}.gpx"
            for route_id, _, _ in ROUTES for suffix in ("main", "short")}
        self.assertEqual(validate_cultural_routes(self.directory), sorted(expected))
        self.replace_gpx("shortcut", gpx(OPEN, route=True))
        self.assertEqual(validate_cultural_routes(self.directory), sorted(expected))

    def test_rejects_wrong_manifest_shape_and_source_identity(self):
        changes = [
            lambda m: m.update(sourcePage="https://example.org/cultural-routes"),
            lambda m: m.update(verifiedOn="2026-02-30"),
            lambda m: m.update(routes="five routes"),
            lambda m: m["routes"].pop(),
            lambda m: m["routes"][0].update(id="invented"),
            lambda m: m["routes"].__setitem__(1, copy.deepcopy(m["routes"][0])),
            lambda m: m["routes"][0].update(title="Invented official route"),
            lambda m: m["routes"][0]["files"].pop("shortcut"),
            lambda m: m["routes"][0]["files"]["full"].update(path="../gpx-blue-main.gpx"),
            lambda m: m["routes"][0]["files"]["full"].update(sourceUrl=SOURCE + "gpx-blue-short.gpx"),
            lambda m: m["routes"][0]["files"]["full"].update(sha256="not a checksum"),
        ]
        for change in changes:
            manifest = copy.deepcopy(self.manifest)
            change(manifest)
            self.write_manifest(manifest)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_cultural_routes(self.directory)

    def test_rejects_invalid_manifest_json(self):
        for data in (b'{"routes":', b'\xff', b'[]'):
            (self.directory / "manifest.json").write_bytes(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                validate_cultural_routes(self.directory)

    def test_rejects_changed_source_bytes_missing_files_and_extra_assets(self):
        self.replace_gpx("full", gpx(CLOSED) + b"\n", update_hash=False)
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            validate_cultural_routes(self.directory)
        self.replace_gpx("full", gpx(CLOSED))
        (self.directory / "diagnostics.txt").write_text("not a runtime asset")
        with self.assertRaisesRegex(ValueError, "Unexpected files"):
            validate_cultural_routes(self.directory)
        (self.directory / "diagnostics.txt").unlink()
        (self.directory / "gpx-blue-main.gpx").unlink()
        with self.assertRaises(ValueError):
            validate_cultural_routes(self.directory)

    def test_rejects_malformed_and_entity_xml_even_when_hash_matches(self):
        samples = (b"<gpx>", b"<html>Unavailable</html>",
                   b'<!DOCTYPE gpx [<!ENTITY a "unsafe">]>' + gpx(CLOSED))
        for data in samples:
            self.replace_gpx("full", data)
            with self.subTest(data=data[:40]), self.assertRaises(ValueError):
                validate_cultural_routes(self.directory)

    def test_rejects_nonfinite_missing_and_outside_mk_coordinates(self):
        for point in (("NaN", -.78), ("Infinity", -.78), (91, -.78), (51.9, -.78), (52, -.95)):
            self.replace_gpx("shortcut", gpx([point, OPEN[1]]))
            with self.subTest(point=point), self.assertRaises(ValueError):
                validate_cultural_routes(self.directory)
        self.replace_gpx("shortcut", gpx(OPEN).replace(b'lon="-0.78"', b""))
        with self.assertRaises(ValueError):
            validate_cultural_routes(self.directory)

    def test_rejects_incorrect_loop_claims_and_disconnected_sections(self):
        self.replace_gpx("full", gpx(CLOSED[:-1]))
        with self.assertRaisesRegex(ValueError, "must be closed"):
            validate_cultural_routes(self.directory)
        self.replace_gpx("full", gpx(CLOSED))
        self.replace_gpx("shortcut", gpx(CLOSED))
        with self.assertRaisesRegex(ValueError, "must be open"):
            validate_cultural_routes(self.directory)
        self.replace_gpx("shortcut", gpx(OPEN))
        extra_section = gpx(CLOSED).replace(b"</trk>", b'<trkseg><trkpt lat="52" lon="-.78"/><trkpt lat="52.01" lon="-.77"/></trkseg></trk>')
        self.replace_gpx("full", extra_section)
        with self.assertRaisesRegex(ValueError, "one continuous"):
            validate_cultural_routes(self.directory)

    def test_rejects_unusable_and_excessive_geometry(self):
        for coords in ([], [OPEN[0]], [OPEN[0], OPEN[0]]):
            self.replace_gpx("shortcut", gpx(coords))
            with self.subTest(coords=coords), self.assertRaises(ValueError):
                validate_cultural_routes(self.directory)
        self.replace_gpx("shortcut", gpx(OPEN * 50_001))
        with self.assertRaisesRegex(ValueError, "point count"):
            validate_cultural_routes(self.directory)
        self.replace_gpx("shortcut", b" " * (10 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, "oversized"):
            validate_cultural_routes(self.directory)


if __name__ == "__main__":
    unittest.main()
