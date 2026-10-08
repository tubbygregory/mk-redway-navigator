import base64
import hashlib
import json
import struct
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def png_header(path):
    data = path.read_bytes()[:26]
    if data[:8].hex() != "89504e470d0a1a0a":
        raise AssertionError(f"Not a PNG: {path}")
    width, height = struct.unpack(">II", data[16:24])
    return width, height, data[25]

class BrandingAssetsTests(unittest.TestCase):
    def test_manifest_and_export_sizes(self):
        version = (ROOT / "VERSION").read_text().strip()
        self.assertEqual(version, "0.14.9")
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text())
        expected = {
            "icons/icon-192.png": (192, 192),
            "icons/icon-512.png": (512, 512),
            "icons/icon-maskable-512.png": (512, 512),
        }
        for icon in manifest["icons"]:
            path = icon["src"].removeprefix("./").split("?")[0]
            self.assertEqual(icon["src"].split("v=")[-1], version)
            self.assertEqual(png_header(ROOT / path)[:2], expected[path])
        self.assertEqual({i["src"].removeprefix("./").split("?")[0] for i in manifest["icons"]}, set(expected))
        maskable = [i for i in manifest["icons"] if i["purpose"] == "maskable"]
        self.assertEqual(len(maskable), 1)
        self.assertEqual(png_header(ROOT / "icons/apple-touch-icon.png"), (180, 180, 2))
        self.assertEqual(png_header(ROOT / "icons/icon-maskable-512.png"), (512, 512, 2))
        self.assertEqual(png_header(ROOT / "icons/favicon-16.png")[:2], (16, 16))
        self.assertEqual(png_header(ROOT / "icons/favicon-32.png")[:2], (32, 32))
        self.assertEqual(png_header(ROOT / "icons/iphone16-splash.png")[:2], (1179, 2556))

    def test_markup_uses_supplied_artwork_without_old_white_wordmark(self):
        version = (ROOT / "VERSION").read_text().strip()
        html = (ROOT / "index.html").read_text()
        sw = (ROOT / "sw.js").read_text()
        self.assertNotIn("wordmark.png", html + sw)
        self.assertIn(f"app-logo.svg?v={version}", html)
        self.assertIn(f"app-logo.svg?v={version}", sw)
        self.assertIn("MK Redway</strong>", html)
        self.assertIn("mk-redway-shell-v39", sw)

        svg = ET.parse(ROOT / "icons/app-logo.svg").getroot()
        ns = {"svg": "http://www.w3.org/2000/svg"}
        self.assertEqual(svg.attrib["viewBox"], "0 0 512 512")
        images = svg.findall(".//svg:image", ns)
        self.assertEqual(len(images), 1)
        image = images[0]
        self.assertEqual(image.attrib["id"], "supplied-mk-artwork")
        for key, value in {"x": "0", "y": "0", "width": "512", "height": "512",
                           "preserveAspectRatio": "xMidYMid meet"}.items():
            self.assertEqual(image.attrib[key], value)
        href = image.attrib["href"]
        self.assertTrue(href.startswith("data:image/png;base64,"), "Artwork must work without an external image request")
        artwork = base64.b64decode(href.split(",", 1)[1], validate=True)
        self.assertEqual(artwork[:8].hex(), "89504e470d0a1a0a")
        self.assertEqual(struct.unpack(">II", artwork[16:24]), (1254, 1254))
        # Pin the recoloured supplied image so a redrawn approximation cannot replace it.
        self.assertEqual(hashlib.sha256(artwork).hexdigest(),
                         "954d6d293818e33e17eefbd3109105440b9dafce89ada49ef4d79c6057fa8bd3")
        self.assertIsNotNone(svg.find("svg:defs/svg:clipPath[@id='tile-clip']", ns))
        self.assertIs(svg.find("svg:g[@clip-path='url(#tile-clip)']/svg:image", ns), image)
        tile = svg.find("svg:rect[@id='tile']", ns)
        self.assertIsNotNone(tile)
        self.assertEqual(tile.attrib, {"id": "tile", "x": "4", "y": "4", "width": "504",
                                       "height": "504", "rx": "108", "fill": "#fafafa"})

if __name__ == "__main__":
    unittest.main()
