import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

import osmium

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_places import build_places, extract_places
from place_validation import validate_places


def fixture(path):
    root = ET.Element("osm", version="0.6", generator="place-index-test")

    def node(source_id, lat, lon, tags=None):
        element = ET.SubElement(root, "node", id=str(source_id), version="1", lat=str(lat), lon=str(lon))
        for key, value in (tags or {}).items():
            ET.SubElement(element, "tag", k=key, v=value)

    def way(source_id, refs, tags):
        element = ET.SubElement(root, "way", id=str(source_id), version="1")
        for ref in refs:
            ET.SubElement(element, "nd", ref=str(ref))
        for key, value in tags.items():
            ET.SubElement(element, "tag", k=key, v=value)

    node(1, 52.0478, -.7333, {"name": "Warbler on the Wharf", "amenity": "bar",
                            "alt_name": "Warbler;The Wharf", "short_name": "Warbler",
                            "name:en": "Warbler on the Wharf", "brand": "Warbler",
                            "operator": "Not a supplied alias"})
    node(2, 52.04, -.75, {"addr:housenumber": "25", "addr:street": "Test Street", "addr:postcode": "MK1 2AB"})
    node(3, 52.04, -.75, {"addr:housenumber": "25", "addr:city": "Milton Keynes"})
    node(4, 52.04, -.75, {"name": "Milton Keynes", "place": "city"})
    node(5, 53, -.75, {"name": "Outside cafe", "amenity": "cafe"})
    node(6, 52.04, -.75, {"amenity": "cafe"})
    node(7, 52.04, -.75, {"addr:housenumber": "1-99", "addr:street": "Test Street", "addr:interpolation": "all"})
    node(8, 52.04, -.75, {"name": "Named street", "highway": "residential"})
    node(9, 52.04, -.75, {"addr:housename": "Source Cottage", "addr:street": "Test Street"})
    for source_id, point in zip(range(100, 104), [(52.0458, -.7423), (52.0462, -.7423),
                                               (52.0462, -.7419), (52.0458, -.7419)]):
        node(source_id, *point)
    refs = [100, 101, 102, 103, 100]
    way(201, refs, {"name": "8-55", "addr:street": "Huntley Crescent", "building": "residential"})
    way(202, refs, {"addr:housenumber": "10", "addr:street": "Test Street", "building": "yes"})
    way(203, refs, {"name": "Bannatyne Health Club", "leisure": "fitness_centre", "building": "yes", "brand": "Bannatyne"})
    way(204, refs, {"name": "Source park", "leisure": "park"})
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def payload(entries):
    return {"format": "mk-redway-places-v1", "source": "OpenStreetMap / Geofabrik",
            "source_timestamp": "2020-01-01T00:00:00Z", "source_sha256": "a" * 64,
            "generated_at": "2020-01-02T00:00:00Z",
            "bounds": {"south": 51.955, "west": -.905, "north": 52.155, "east": -.615},
            "entries": entries}


class PlacesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.xml = self.directory / "fixture.osm"
        fixture(self.xml)
        self.entries = extract_places(self.xml)

    def pbf(self):
        path = self.directory / "fixture.osm.pbf"
        header = osmium.io.Header()
        header.set("osmosis_replication_timestamp", "2020-01-01T00:00:00Z")
        with osmium.SimpleWriter(str(path), header=header) as writer:
            class Copy(osmium.SimpleHandler):
                def node(self, node):
                    writer.add_node(node)
                def way(self, way):
                    writer.add_way(way)
            Copy().apply_file(str(self.xml))
        return path

    def test_source_pois_aliases_and_explicit_addresses(self):
        entries = {entry["id"]: entry for entry in self.entries}
        self.assertEqual(set(entries), {"n1", "n2", "n9", "w201", "w202", "w203", "w204"})
        self.assertEqual(entries["n1"]["name"], "Warbler on the Wharf")
        self.assertEqual(entries["n1"]["aliases"], ["Warbler", "The Wharf"])
        self.assertEqual(entries["n1"]["location"], "mapped point")
        self.assertEqual(entries["n2"]["house_number"], "25")
        self.assertEqual(entries["n2"]["street"], "Test Street")
        self.assertEqual(entries["n9"]["kind"], "address")
        self.assertEqual(entries["n9"]["name"], "Source Cottage")
        self.assertNotIn("house_number", entries["n9"])
        self.assertEqual(entries["w203"]["category"], "fitness_centre")
        self.assertEqual(entries["w203"]["aliases"], ["Bannatyne"])
        self.assertEqual(validate_places(payload(self.entries)), {"entries": 7})

    def test_named_buildings_do_not_fabricate_number_25_or_an_entrance(self):
        building = next(entry for entry in self.entries if entry.get("street") == "Huntley Crescent")
        self.assertEqual(building["name"], "8-55")
        self.assertEqual(building["kind"], "building")
        self.assertNotIn("house_number", building)
        self.assertEqual(building["location"], "building centre")
        self.assertAlmostEqual(building["lat"], 52.046, places=6)
        self.assertAlmostEqual(building["lon"], -.7421, places=6)
        park = next(entry for entry in self.entries if entry["id"] == "w204")
        self.assertEqual(park["location"], "mapped feature centre")

    def test_writer_records_actual_source_header_hash_and_reuses_unchanged_data(self):
        source = self.pbf()
        output = self.directory / "places.json"
        data = build_places(source, output)
        self.assertEqual(data["source_timestamp"], "2020-01-01T00:00:00Z")
        self.assertEqual(data["source_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(data["entries"], self.entries)
        original = output.read_bytes()
        self.assertEqual(build_places(source, output), data)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(json.loads(original), data)

    def test_invalid_refresh_preserves_existing_output(self):
        output = self.directory / "places.json"
        original = json.dumps(payload(self.entries)).encode()
        output.write_bytes(original)
        # XML has geometry but lacks a verified PBF replication timestamp.
        with self.assertRaises(ValueError):
            build_places(self.xml, output)
        self.assertEqual(output.read_bytes(), original)
        self.assertFalse(output.with_name("places.json.tmp").exists())

    def test_cli_reports_cached_fallback_but_fails_without_a_valid_asset(self):
        output = self.directory / "places.json"
        original = json.dumps(payload(self.entries)).encode()
        output.write_bytes(original)
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / "scripts/build_places.py"),
                   "--source", str(self.xml), "--output", str(output)]
        cached = subprocess.run(command, capture_output=True, text=True, timeout=20)
        self.assertEqual(cached.returncode, 0, cached.stderr)
        self.assertIn("Keeping the validated cached place index", cached.stdout)
        self.assertIn("refresh failed", cached.stderr)
        self.assertEqual(output.read_bytes(), original)
        output.unlink()
        missing = subprocess.run(command, capture_output=True, text=True, timeout=20)
        self.assertEqual(missing.returncode, 2)
        self.assertFalse(output.exists())

    def test_rejects_invalid_missing_timezone_future_and_reversed_dates(self):
        future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=3)).isoformat()
        cases = [{"source_timestamp": "not a date"}, {"generated_at": "2020-01-02T00:00:00"},
                 {"generated_at": "not a date"},
                 {"source_timestamp": "2020-01-01T00:00:00"},
                 {"source_timestamp": "2020-01-01 00:00:00Z"},
                 {"generated_at": "20200102T000000Z"},
                 {"source_timestamp": "2020-01-01T00:00:00+00:60"},
                 {"generated_at": "2020-01-02T00:00:00-01:60"},
                 {"generated_at": "2020-01-02T00:00:00+24:00"},
                 {"generated_at": "2020-01-02T00:00:00+0000"},
                 {"source_timestamp": future, "generated_at": future}, {"generated_at": future},
                 {"generated_at": "2019-12-31T00:00:00Z"}]
        for changes in cases:
            data = payload(copy.deepcopy(self.entries))
            data.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_places(data)

    def test_rejects_bad_bounds_source_hash_empty_duplicate_and_unknown_fields(self):
        cases = [lambda d: d.update(bounds={**d["bounds"], "north": 53}),
                 lambda d: d.update(source="Unverified map"), lambda d: d.update(source_sha256="bad"),
                 lambda d: d.update(entries=[]), lambda d: d["entries"].append(d["entries"][0]),
                 lambda d: d.update(entries=[d["entries"][0]] * 50_001),
                 lambda d: d.update(unreviewed="field"), lambda d: d["entries"][0].update(phone="unwanted"),
                 lambda d: d["entries"][0].update(id="../../asset")]
        for change in cases:
            data = payload(copy.deepcopy(self.entries))
            change(data)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_places(data)

    def test_rejects_boolean_nonfinite_and_outside_bounds_coordinates(self):
        for field, value in (("lat", True), ("lon", False), ("lat", float("nan")),
                             ("lon", float("inf")), ("lat", 53), ("lon", -1)):
            data = payload(copy.deepcopy(self.entries))
            data["entries"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_places(data)

    def test_rejects_false_precision_unsupported_kinds_and_bad_text(self):
        changes = [lambda e: e.update(location="exact entrance"), lambda e: e.update(location=[]),
                   lambda e: e.update(kind="invented"), lambda e: e.update(name="x" * 201),
                   lambda e: e.update(name="hidden\ncontrol"), lambda e: e.update(aliases=["alias", "ALIAS"]),
                   lambda e: e.update(aliases=[e["name"]]), lambda e: e.pop("name"),
                   lambda e: e.update(category=None)]
        for change in changes:
            data = payload(copy.deepcopy(self.entries))
            change(data["entries"][0])
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_places(data)
        data = payload(copy.deepcopy(self.entries))
        next(e for e in data["entries"] if e["id"] == "w201")["location"] = "mapped point"
        with self.assertRaises(ValueError):
            validate_places(data)
        data = payload(copy.deepcopy(self.entries))
        next(e for e in data["entries"] if e["id"] == "w201")["house_number"] = "25"
        with self.assertRaises(ValueError):
            validate_places(data)
        data = payload(copy.deepcopy(self.entries))
        next(e for e in data["entries"] if e["id"] == "n2").pop("street")
        with self.assertRaises(ValueError):
            validate_places(data)


if __name__ == "__main__":
    unittest.main()
