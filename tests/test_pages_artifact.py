import io
import re
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PagesArtifactTests(unittest.TestCase):
    def check_archive(self, changed=None, extra=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            script = root / "scripts/check_pages_artifact.py"
            script.write_bytes((ROOT / "scripts/check_pages_artifact.py").read_bytes())
            (root / "dist/cultural-routes").mkdir(parents=True)
            files = {"index.html": b"<title>MK Redway</title>",
                     "ads.txt": (ROOT / "ads.txt").read_bytes(),
                     "cultural-routes/gpx-blue-main.gpx": b'<gpx><trk/></gpx>'}
            for name, body in files.items():
                (root / "dist" / name).write_bytes(body)
            archive = root / "artifact.tar"
            with tarfile.open(archive, "w") as uploaded:
                for name, body in files.items():
                    if name == "cultural-routes/gpx-blue-main.gpx" and changed is not None:
                        body = changed
                    info = tarfile.TarInfo("./" + name)
                    info.size = len(body)
                    uploaded.addfile(info, io.BytesIO(body))
                if extra:
                    info = tarfile.TarInfo("./scripts/build_network.py")
                    uploaded.addfile(info, io.BytesIO(b""))
            return subprocess.run([sys.executable, str(script), str(archive)],
                                  capture_output=True, text=True)

    def test_validated_runtime_contents_are_published(self):
        result = self.check_archive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("matching runtime files and contents", result.stdout)

    def test_changed_geometry_is_rejected_even_with_correct_filename(self):
        result = self.check_archive(changed=b'<gpx>different geometry</gpx>')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("content differs", result.stderr)

    def test_build_inputs_are_rejected(self):
        result = self.check_archive(extra=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("archive differs", result.stderr)

    def test_ads_txt_authorises_the_configured_google_publisher_and_is_packaged(self):
        from release_upgrade_browser import runtime_files
        runtime = runtime_files((ROOT / "scripts/build_site.py").read_text())
        self.assertIn("ads.txt", runtime)
        html = (ROOT / "index.html").read_text()
        publisher = re.search(r"adsbygoogle\.js\?client=ca-(pub-\d+)", html).group(1)
        records = [line.strip() for line in (ROOT / "ads.txt").read_text("ascii").splitlines()
                   if line.strip() and not line.lstrip().startswith("#")]
        self.assertEqual(records, [f"google.com, {publisher}, DIRECT, f08c47fec0942fa0"])
