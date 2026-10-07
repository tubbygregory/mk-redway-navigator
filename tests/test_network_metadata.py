import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_network import build_grid_road_index, infer_under_grid_road, KEEP_TAGS

class NetworkMetadataTests(unittest.TestCase):
    def test_only_intersecting_mapped_tunnel_receives_grid_road_name(self):
        nodes = {1:(52,-.781),2:(52,-.779),3:(51.9998,-.780),4:(52.0002,-.780),5:(52.0001,-.780),6:(52.0003,-.780)}
        rules = {"super_routes":[{"ref":"H5","aliases":["H5","Portway"]}]}
        index = build_grid_road_index({1:([1,2],{"highway":"primary","name":"Portway"})}, nodes, rules)
        self.assertEqual(infer_under_grid_road([3,4],{"tunnel":"yes"},nodes,index),"H5 Portway")
        for tags in ({"bridge":"yes"},{"highway":"crossing"},{"tunnel":"no"},{"tunnel":"building_passage"}):
            self.assertIsNone(infer_under_grid_road([3,4],tags,nodes,index))
        self.assertIsNone(infer_under_grid_road([5,6],{"tunnel":"yes"},nodes,index))
    def test_builder_retains_all_consumed_osm_metadata(self):
        self.assertTrue({"lit","tunnel","bridge","junction","footway","cycleway","crossing","oneway","oneway:bicycle"} <= KEEP_TAGS)
