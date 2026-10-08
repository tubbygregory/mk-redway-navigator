import json
import struct
import unittest
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
        self.assertEqual(version, "0.14.3")
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
        maskable = [i for i in manifest["icons"] if i["purpose"] == "maskable"]
        self.assertEqual(len(maskable), 1)
        self.assertEqual(png_header(ROOT / "icons/apple-touch-icon.png"), (180, 180, 2))
        self.assertEqual(png_header(ROOT / "icons/icon-maskable-512.png"), (512, 512, 2))
        self.assertEqual(png_header(ROOT / "icons/favicon-16.png")[:2], (16, 16))
        self.assertEqual(png_header(ROOT / "icons/favicon-32.png")[:2], (32, 32))
        self.assertEqual(png_header(ROOT / "icons/iphone16-splash.png")[:2], (1179, 2556))

    def test_markup_uses_current_vector_without_old_white_wordmark(self):
        version = (ROOT / "VERSION").read_text().strip()
        html = (ROOT / "index.html").read_text()
        sw = (ROOT / "sw.js").read_text()
        svg = (ROOT / "icons/app-logo.svg").read_text()
        self.assertNotIn("wordmark.png", html + sw)
        self.assertIn(f"app-logo.svg?v={version}", html)
        self.assertIn("MK Redway</strong>", html)
        self.assertIn("mk-redway-shell-v32", sw)
        self.assertNotIn('fill="#fff"/>\\n  <rect x="24"', svg)
        self.assertIn('x="4" y="4" width="504" height="504" rx="112"', svg)
        self.assertIn('matrix(.82 0 0 .82', svg)

if __name__ == "__main__":
    unittest.main()
