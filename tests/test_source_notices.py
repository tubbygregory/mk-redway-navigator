"""Cache notice cleanup must not change route topology or classification."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_site import clean_source_notices

class SourceNoticeTests(unittest.TestCase):
    def test_only_obsolete_metadata_changes(self):
        geometry = {"type": "LineString", "coordinates": [[-.7, 52.0], [-.71, 52.01]]}
        original = {"council_geometry_permission": "obsolete", "generated_at": "2026-09-15",
                    "ways": [{"tags": {"_mk_class_source": "Get Around MK interactive map"
                              + " (used with council " + "permission) + OSM routable geometry",
                              "route_class": "redway"}, "geometry": geometry}]}
        cleaned = clean_source_notices(original)
        self.assertNotIn("council_geometry_permission", cleaned)
        self.assertEqual(cleaned["generated_at"], original["generated_at"])
        self.assertEqual(cleaned["ways"][0]["geometry"], geometry)
        self.assertEqual(cleaned["ways"][0]["tags"]["route_class"], "redway")
        self.assertEqual(cleaned["ways"][0]["tags"]["_mk_class_source"],
                         "Get Around MK interactive map + OSM routable geometry")
        self.assertIn("council_geometry_permission", original)

    def test_clean_data_is_unchanged(self):
        data = {"features": [{"properties": {"route_class": "leisure"}, "id": 7}], "nodes": []}
        self.assertEqual(clean_source_notices(data), data)
