import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from data_validation import validate_network, validate_council, source_class, council_digest

class DataValidationTests(unittest.TestCase):
    def network(self):
        return {"format": "mk-redway-network-v5",
                "nodes": [[i, 52, -.75] for i in range(1002)],
                "ways": [[i, [i, i + 1], {"highway": "cycleway"}] for i in range(102)]}
    def test_populated_graph(self):
        self.assertEqual(validate_network(self.network())["ways"], 102)
    def test_rejects_empty_wrong_format_and_broken_references(self):
        for change in ({"nodes": []}, {"format": "mk-redway-network-v99"},
                       {"ways": [[i, [0, 9999], {}] for i in range(102)]}):
            with self.subTest(change=next(iter(change))), self.assertRaises(ValueError):
                validate_network({**self.network(), **change})
    def test_source_identity(self):
        self.assertEqual(source_class("https://getaroundmk.org.uk/maps/Redway_Super_Routes.kmz"), "super_redway")
        for url in ("https://maps.google.com/Redway_Super_Routes.kmz",
                    "https://getaroundmk.org.uk/basemap.kmz"):
            with self.assertRaises(ValueError):
                source_class(url)
    def test_geometry_digest_ignores_download_metadata_but_tracks_classification(self):
        data = {"features": [{"properties": {"route_class": "redway", "name": "Path"},
                              "geometry": {"coordinates": [[-.75, 52], [-.74, 52]]}}]}
        other = copy.deepcopy(data)
        other["extracted_at"] = "later"
        other["features"][0]["geometry"]["coordinates"].reverse()
        self.assertEqual(council_digest(data), council_digest(other))
        other["features"][0]["properties"]["route_class"] = "leisure"
        self.assertNotEqual(council_digest(data), council_digest(other))

    def test_council_rejects_contaminated_and_missing_categories(self):
        for data in ({"type": "FeatureCollection", "features": []},
                     {"type": "FeatureCollection", "features": [{}] * 200001}):
            with self.assertRaises(ValueError):
                validate_council(data)
