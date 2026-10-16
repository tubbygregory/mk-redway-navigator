"""Guard historical-release selection and reconstruction boundaries."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
import unittest

from release_upgrade_browser import (UpgradeHandler, previous_release, runtime_files, safe_asset,
                                     version_tuple, worker_literal, worker_shell)


class ReleaseUpgradeTests(unittest.TestCase):
    def test_project_origin_rejects_assets_that_escape_the_deployment_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            (runtime / "styles.css").write_text("fixture-style")
            server = ThreadingHTTPServer(("127.0.0.1", 0), UpgradeHandler)
            server.runtime, server.scope, server.fail_graph = runtime, "/project/", False
            server.requests, server.escaped_requests, server.graph_failures = [], [], 0
            Thread(target=server.serve_forever, daemon=True).start()
            try:
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                for method in ["GET", "HEAD"]:
                    connection.request(method, "/project/styles.css")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), b"fixture-style" if method == "GET" else b"")
                    connection.request(method, "/styles.css")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 404)
                    response.read()
                self.assertEqual(server.escaped_requests, ["/styles.css", "/styles.css"])
                connection.close()
            finally:
                server.shutdown()
                server.server_close()

    def test_release_selection_uses_numeric_order_and_excludes_current_future_and_prerelease(self):
        tags = ["v0.14.9", "v0.14.10", "v0.14.11", "v0.14.12", "v0.15.0",
                "v0.14.11-beta", "branch-looking-like-0.14.11", "v0.13.99"]
        self.assertEqual(previous_release(tags, "0.14.12"), "v0.14.11")
        self.assertEqual(previous_release(tags, "0.14.11"), "v0.14.10")
        self.assertEqual(previous_release(tags, "0.15.0"), "v0.14.12")

    def test_missing_history_fails_with_actionable_fetch_instruction(self):
        with self.assertRaisesRegex(ValueError, "Fetch all published tags"):
            previous_release(["v0.14.12", "v0.15.0"], "0.14.12")

    def test_non_release_versions_are_rejected(self):
        self.assertEqual(version_tuple("v1.2.10"), (1, 2, 10))
        for value in ["", "0.14", "0.14.12-beta", "0.14.12\n", "version0.14.12"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                version_tuple(value)

    def test_historical_script_is_parsed_without_executing_any_code(self):
        self.assertEqual(runtime_files("raise RuntimeError('must never execute')\n"
                                       "RUNTIME = ('index.html', 'app.js', 'sw.js')\n"),
                         ("index.html", "app.js", "sw.js"))
        with self.assertRaises(ValueError):
            runtime_files("RUNTIME = __import__('os').system('must never execute')")

    def test_reconstruction_rejects_raw_inputs_traversal_duplicates_and_missing_shell(self):
        for files in [("index.html", "app.js", "sw.js", "data/source.osm"),
                      ("index.html", "app.js", "sw.js", "../app.js"),
                      ("index.html", "app.js", "sw.js", "app.js"),
                      ("index.html", "app.js"), ()]:
            with self.subTest(files=files), self.assertRaises(ValueError):
                runtime_files("RUNTIME = " + repr(files))

    def test_asset_copy_boundary_rejects_other_trees_and_parent_paths(self):
        self.assertTrue(safe_asset("vendor/images/marker.png", "vendor", {".png"}))
        self.assertTrue(safe_asset("cultural-routes/gpx-blue-main.gpx", "cultural-routes", {".gpx"}))
        for path in ["/vendor/images/marker.png", "vendor/../secret.png", "raw/vendor/file.png",
                     "vendor/images/../../secret.png", "vendor/script.py"]:
            with self.subTest(path=path):
                self.assertFalse(safe_asset(path, "vendor", {".png"}))

    def test_worker_cache_names_and_versioned_shell_assets_are_derived(self):
        source = "const SHELL_CACHE = 'future-shell-v987';\nconst OFFLINE_CACHE = \"persist-v24\";\n" \
                 "const SHELL = ['./', './app.js', './icons/app-logo.svg?v=9.8.7'];"
        self.assertEqual(worker_literal(source, "SHELL_CACHE"), "future-shell-v987")
        self.assertEqual(worker_literal(source, "OFFLINE_CACHE"), "persist-v24")
        self.assertEqual(worker_shell(source), ["./", "./app.js", "./icons/app-logo.svg?v=9.8.7"])

    def test_dynamic_or_external_shell_declarations_require_review(self):
        for source in ["const SHELL = ['./', 'https://example.org/script.js'];",
                       "const SHELL = dynamicFiles();", "const SHELL = [fileName];"]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                worker_shell(source)
        with self.assertRaises(ValueError):
            worker_literal("const SHELL_CACHE = calculateCacheName();", "SHELL_CACHE")


if __name__ == "__main__":
    unittest.main()
