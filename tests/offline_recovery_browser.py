"""Real HTTP interruption/retry gate for offline downloads at root and subpath.

Run after scripts/build_site.py. Header/body stalls use the production 30-second
inactivity deadline; no application timers, navigator flags, fetch implementations
or service workers are replaced. The origin is stopped for the final offline
reload, unseen route and PMTiles range request. CHROMIUM_EXECUTABLE optionally
selects a Chromium binary; OFFLINE_RECOVERY_SITE selects an existing site artifact
(for example a historical negative control). Evidence goes to test-results/.
"""
from advertising_fixture import block_adsense
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Event, Thread
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(os.environ.get("OFFLINE_RECOVERY_SITE", ROOT / "dist")).resolve()
OFFLINE_CACHE = "mk-redway-offline-v1"


class RecoveryHandler(SimpleHTTPRequestHandler):
    """Serve genuine files/ranges, or an interrupted full-map HTTP response."""
    def log_message(self, *_args):
        pass

    def translate_path(self, path):
        path = urlsplit(path).path
        if self.server.scope != "/" and path.startswith(self.server.scope):
            path = "/" + path[len(self.server.scope):]
        self.directory = str(SITE)
        return super().translate_path(path)

    def outside_scope(self):
        if self.server.scope != "/" and not urlsplit(self.path).path.startswith(self.server.scope):
            self.server.escaped.append(self.path)
            self.send_error(404, "Outside project deployment")
            return True
        self.server.requests.append({"method": self.command, "path": self.path,
                                     "range": self.headers.get("Range")})
        return False

    def do_HEAD(self):
        if not self.outside_scope():
            super().do_HEAD()

    def map_headers(self, status, length, content_range=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if content_range:
            self.send_header("Content-Range", content_range)
        self.end_headers()

    def do_GET(self):
        if self.outside_scope():
            return
        path = Path(self.translate_path(self.path))
        if path.name != "mk-basemap.pmtiles" or not path.is_file():
            super().do_GET()
            return
        size = path.stat().st_size
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        try:
            if match:
                start = int(match.group(1))
                end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
                if start >= size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                self.map_headers(206, end - start + 1, f"bytes {start}-{end}/{size}")
                with path.open("rb") as stream:
                    stream.seek(start)
                    self.wfile.write(stream.read(end - start + 1))
                return
            mode, release = self.server.mode, Event()
            record = {"mode": mode, "bytes_sent": 0, "connection_closed": False}
            self.server.downloads.append(record)
            self.server.releases.append(release)
            self.server.download_started.set()
            if mode == "header-stall":
                release.wait(45)
                self.close_connection = True
                return
            self.map_headers(200, size)
            with path.open("rb") as stream:
                if mode in {"body-stall", "truncated"}:
                    chunk = stream.read(65536)
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    record["bytes_sent"] += len(chunk)
                    if mode == "body-stall":
                        release.wait(45)
                    self.close_connection = True
                    return
                while chunk := stream.read(65536):
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    record["bytes_sent"] += len(chunk)
                    if mode == "streaming" and release.wait(.03):
                        self.close_connection = True
                        return
        except (BrokenPipeError, ConnectionResetError):
            if not match:
                record["connection_closed"] = True

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def open_settings(page):
    if page.locator("#locationIntroDismiss").is_visible():
        page.locator("#locationIntroDismiss").click()
    if not page.locator("#settingsSheet").is_visible():
        page.locator("#visibleSettingsBtn").click()


def assert_no_map(page, base):
    """A failed transfer must never leave a map in any app cache."""
    cached = page.evaluate("""async base => {
        const result=[];
        for (const name of await caches.keys()) {
            const response=await (await caches.open(name)).match(new URL('data/mk-basemap.pmtiles',base));
            if (response) result.push({name,status:response.status,size:(await response.blob()).size});
        }
        return result;
    }""", base)
    assert cached == [], cached
    assert "Ready for offline journeys" not in page.locator("#offlineStatus").inner_text()


def start_download(page, server, mode):
    server.mode = mode
    server.download_started.clear()
    page.locator("#offlineDownloadBtn").click()
    assert server.download_started.wait(5), f"No actual {mode} HTTP download reached the origin"
    return server.downloads[-1]


def release_transfers(server):
    for release in server.releases:
        release.set()


def native_offline(context, page):
    # Chromium can reset this flag after reload. The real origin is already
    # stopped, so reapplying native emulation cannot permit a live response.
    reapplied = bool(page.evaluate("navigator.onLine"))
    if reapplied:
        context.set_offline(False)
        context.set_offline(True)
    page.wait_for_function("navigator.onLine === false")
    assert page.evaluate("navigator.onLine") is False
    return int(reapplied)


def review(browser, scope, label, out):
    from playwright.sync_api import expect

    server = ThreadingHTTPServer(("127.0.0.1", 0), RecoveryHandler)
    server.scope, server.mode = scope, "healthy"
    server.requests, server.escaped, server.downloads, server.releases = [], [], [], []
    server.download_started = Event()
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}{scope}"
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                  has_touch=True, service_workers="allow")
    errors, external = [], []
    context.route("https://**/*", lambda route: (external.append(route.request.url), route.abort()))
    expected_advertising_requests = block_adsense(context)
    context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
    page = context.new_page()
    page.set_default_timeout(45000)
    result = {"scope": scope, "label": label, "inactivity_seconds": 30, "faults": [],
              "app_sha256": hashlib.sha256((SITE / "app.js").read_bytes()).hexdigest()}
    origin_stopped = False
    try:
        page.goto(base, wait_until="networkidle")
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
        page.evaluate("async () => { await navigator.serviceWorker.ready; }")
        open_settings(page)
        expect(page.locator("#offlineDownloadBtn")).to_have_text("Download")
        assert_no_map(page, base)
        for mode in ("header-stall", "body-stall", "truncated"):
            print(f"Recovery {label}: actual HTTP {mode}", flush=True)
            started = time.monotonic()
            record = start_download(page, server, mode)
            if mode != "truncated":
                expect(page.locator("#offlineDownloadBtn")).to_be_disabled()
            if mode == "body-stall":
                expect(page.locator("#offlineStatus")).to_contain_text("Downloading map")
            expected = "Download failed" if mode == "truncated" else "Download stalled"
            expect(page.locator("#offlineStatus")).to_contain_text(expected, timeout=38000)
            elapsed = time.monotonic() - started
            expect(page.locator("#offlineDownloadBtn")).to_be_enabled()
            expect(page.locator("#offlineDownloadBtn")).to_have_text("Download")
            assert_no_map(page, base)
            if mode != "truncated":
                assert 28 <= elapsed < 38, f"Expected the real production inactivity deadline: {elapsed}"
            result["faults"].append({"mode": mode, "elapsed_seconds": round(elapsed, 2),
                                     "bytes_sent": record["bytes_sent"], "status": page.locator("#offlineStatus").inner_text(),
                                     "retry_enabled": True, "map_cached": False})
            release_transfers(server)
        print(f"Recovery {label}: close tab during a real streaming response, reopen and retry", flush=True)
        interrupted = start_download(page, server, "streaming")
        expect(page.locator("#offlineStatus")).to_contain_text("Downloading map")
        page.close()
        release_transfers(server)
        page = context.new_page()
        page.set_default_timeout(45000)
        page.goto(base, wait_until="networkidle")
        open_settings(page)
        expect(page.locator("#offlineDownloadBtn")).to_have_text("Download")
        expect(page.locator("#offlineDownloadBtn")).to_be_enabled()
        assert_no_map(page, base)
        assert 0 < interrupted["bytes_sent"] < (SITE / "data/mk-basemap.pmtiles").stat().st_size
        start_download(page, server, "healthy")
        expect(page.locator("#offlineStatus")).to_contain_text("Ready for offline journeys", timeout=120000)
        expect(page.locator("#offlineDownloadBtn")).to_have_text("Remove")
        assets = page.evaluate("""async ({base,name}) => {
            const cache=await caches.open(name), assets={};
            for (const file of ['data/network.json','data/mk-basemap.pmtiles']) {
                const response=await cache.match(new URL(file,base));
                if (!response || response.status!==200) throw new Error('Missing complete offline '+file);
                const bytes=await response.arrayBuffer();
                const digest=await crypto.subtle.digest('SHA-256',bytes);
                assets[file]={size:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
            }
            return assets;
        }""", {"base": base, "name": OFFLINE_CACHE})
        for file, value in assets.items():
            source = SITE / file
            assert value == {"size": source.stat().st_size, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}
        server.shutdown()
        server.server_close()
        origin_stopped = True
        request_count = len(server.requests)
        context.set_offline(True)
        page.reload(wait_until="networkidle")
        reapplied = native_offline(context, page)
        open_settings(page)
        expect(page.locator("#offlineStatus")).to_contain_text("Ready for offline journeys")
        unseen = base + "?from=52.0467,-0.7378&to=52.025,-0.783&mode=walk&lit=1&super=1"
        assert not any("?from=" in item["path"] for item in server.requests)
        page.goto(unseen, wait_until="networkidle")
        reapplied += native_offline(context, page)
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        expect(page.locator("#startNavBtn")).to_be_enabled()
        part = page.evaluate("""async () => {
            const response=await fetch('./data/mk-basemap.pmtiles',{headers:{Range:'bytes=0-7'}});
            return {status:response.status,range:response.headers.get('Content-Range'),
                    bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};
        }""")
        size = (SITE / "data/mk-basemap.pmtiles").stat().st_size
        assert part == {"status": 206, "range": f"bytes 0-7/{size}", "bytes": list(b"PMTiles\x03")}, part
        assert len(server.requests) == request_count
        assert not errors, errors
        assert not external, external
        assert not server.escaped, server.escaped
        page.screenshot(path=str(out / f"{label}-offline-recovered-route.png"))
        result.update({"status": "passed", "interrupted_bytes_sent": interrupted["bytes_sent"],
                       "assets": assets, "offline_origin_stopped": True, "offline_server_requests": 0,
                       "offline_emulation_reapplications": reapplied, "offline_pmtiles_range": part,
                       "page_errors": errors, "external_requests": external,
                       "expected_advertising_requests": expected_advertising_requests,
                       "escaped_scope_requests": server.escaped})
        print(f"PASS recovery {label}: header/body timeout, truncation, tab close/reopen, retry, offline route + range206", flush=True)
        return result
    except Exception:
        if not page.is_closed():
            page.screenshot(path=str(out / f"{label}-failure.png"))
        (out / f"{label}-failure.json").write_text(json.dumps({**result, "downloads": server.downloads,
            "requests": server.requests, "page_errors": errors, "external_requests": external,
            "expected_advertising_requests": expected_advertising_requests,
            "escaped_scope_requests": server.escaped}, indent=2) + "\n")
        raise
    finally:
        release_transfers(server)
        context.close()
        if not origin_stopped:
            server.shutdown()
            server.server_close()


def main():
    from playwright.sync_api import sync_playwright

    out = ROOT / "test-results/offline-recovery"
    out.mkdir(parents=True, exist_ok=True)
    assert (SITE / "data/mk-basemap.pmtiles").is_file(), "Build the site before running this gate"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"))
        try:
            results = [review(browser, scope, label, out) for scope, label in
                       [("/", "root"), ("/" + ROOT.name + "/", "subpath")]]
        finally:
            browser.close()
    (out / "evidence.json").write_text(json.dumps(results, indent=2) + "\n")
    print("PASS offline recovery 2/2: genuine HTTP faults and offline root/subpath navigation", flush=True)


if __name__ == "__main__":
    main()
