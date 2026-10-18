"""Permanent root/subpath release-upgrade gate using the real update controls.

Run after scripts/build_site.py with all Git release tags available (CI checkout
fetch-depth: 0). By default the newest older numeric release and the oldest
of the latest three older releases are exercised. UPGRADE_FROM_REF selects one exact
source ref instead; CHROMIUM_EXECUTABLE optionally selects a local Chromium binary.

The previous browser shell is reconstructed from tracked files at that ref. Its
code is never executed by Python: RUNTIME is read with ast.literal_eval. Both
shells use the CURRENT validated geographic data and dependency-lock-verified
vendor assets. This exercises real service-worker/cache/settings migration, not
the exact historical published artifact or physical Safari/iPhone behaviour.
Evidence and failure screenshots go to test-results/release-upgrade/.
"""
from advertising_fixture import block_adsense
import ast
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from threading import Thread
import time
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ALLOWED = frozenset({
    "index.html", "styles.css", "app.js", "routing.js", "navigation-icons.js",
    "about.js", "sw.js", "manifest.webmanifest", "DATA-LICENCE.md", "LICENSE", ".nojekyll",
})
DATA_FILES = ("network.json", "places.json", "mk-basemap.pmtiles", "data-meta.json")
IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
SETTINGS = {"voiceEnabled": False, "units": "imperial", "themeChoice": "dark",
            "preferLit": True, "preferSuper": True, "navigationIcon": "cow"}
SAVED = {
    "home": {"name": "Home", "address": "Home in Milton Keynes", "lat": 52.041, "lng": -.761},
    "work": {"name": "Work", "address": "Work in Milton Keynes", "lat": 52.042, "lng": -.762},
    "favourites": [{"id": "upgrade-retained-favourite", "name": "Canal picnic place",
                    "address": "Grand Union Canal, Milton Keynes", "lat": 52.043, "lng": -.763}],
}


def version_tuple(value):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise ValueError(f"Expected a numeric release version, got {value!r}")
    return tuple(map(int, match.groups()))


def previous_releases(tags, current):
    """Cover the latest upgrade and a skipped release when history permits it."""
    current_number = version_tuple(current)
    older = sorted({tag for tag in tags if re.fullmatch(r"v\d+\.\d+\.\d+", tag)
                    and version_tuple(tag) < current_number}, key=version_tuple, reverse=True)
    if not older:
        raise ValueError("No previous release tag found. Fetch all published tags (checkout fetch-depth: 0).")
    # With fewer than three predecessors, run every distinct available origin.
    return list(dict.fromkeys((older[0], older[min(2, len(older) - 1)])))


def upgrade_refs(tags, current, override=None):
    # An explicit ref is exact: do not silently add a second historical origin.
    return [override] if override else previous_releases(tags, current)


def runtime_files(source):
    """Read the producer's literal runtime allowlist without executing old code."""
    assignments = [node.value for node in ast.parse(source).body
                   if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "RUNTIME"
                           for target in node.targets)]
    if len(assignments) != 1:
        raise ValueError("Expected one literal RUNTIME assignment in build_site.py")
    value = ast.literal_eval(assignments[0])
    if not isinstance(value, (tuple, list)) or not value or any(not isinstance(item, str) for item in value):
        raise ValueError("RUNTIME must be a nonempty list or tuple of strings")
    if len(value) != len(set(value)) or not set(value) <= RUNTIME_ALLOWED:
        raise ValueError("Unrecognised/duplicate historical runtime files; review the browser-only allowlist")
    if not {"index.html", "app.js", "sw.js"} <= set(value):
        raise ValueError("Historical shell is missing required runtime files")
    return tuple(value)


def worker_literal(source, name):
    match = re.search(r"\bconst\s+" + re.escape(name) + r"\s*=\s*(['\"])([^'\"]+)\1\s*;", source)
    if not match:
        raise ValueError(f"Missing literal service-worker {name}")
    return match.group(2)


def worker_shell(source):
    match = re.search(r"\bconst\s+SHELL\s*=\s*(\[[\s\S]*?\])\s*;", source)
    value = ast.literal_eval(match.group(1)) if match else None
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.startswith("./") for item in value):
        raise ValueError("Expected a literal list of local SHELL assets")
    return value


def safe_asset(path, prefix, extensions):
    parts = PurePosixPath(path).parts
    return (len(parts) >= 2 and parts[0] == prefix and ".." not in parts
            and not path.startswith("/") and PurePosixPath(path).suffix.lower() in extensions)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def prepare_previous(old, current, ref):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", ref) or ".." in ref:
        raise ValueError("UPGRADE_FROM_REF must be a safe Git tag, branch name or commit ID")
    commit = git("rev-parse", "--verify", ref + "^{commit}").decode().strip()
    show = lambda path: git("show", f"{commit}:{path}")
    old_version = show("VERSION").decode().strip()
    new_version = (ROOT / "VERSION").read_text().strip()
    if version_tuple(old_version) >= version_tuple(new_version):
        raise ValueError(f"Upgrade source {old_version} must precede current {new_version}")
    runtime = runtime_files(show("scripts/build_site.py").decode())
    tracked = git("ls-tree", "-r", "--name-only", commit).decode().splitlines()
    historic_files = set(runtime) | {path for path in tracked
        if safe_asset(path, "icons", {".svg", ".png", ".ico"})
        or path == "cultural-routes/manifest.json"
        or safe_asset(path, "cultural-routes", {".gpx"})}
    old.mkdir(parents=True)
    for relative in sorted(historic_files):
        target = old / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(show(relative))
    (old / "data").mkdir()
    for name in DATA_FILES:
        shutil.copy2(current / "data" / name, old / "data" / name)
    meta = json.loads((old / "data/data-meta.json").read_text())
    meta["app_version"] = old_version
    (old / "data/data-meta.json").write_text(json.dumps(meta) + "\n")
    dependencies = json.loads(show("runtime-dependencies.json"))
    for item in dependencies:
        relative = item["path"]
        if not safe_asset(relative, "vendor", {".js", ".css", ".png", ".txt"}):
            raise ValueError(f"Unexpected historical dependency path: {relative}")
        source = current / relative
        if hashlib.sha256(source.read_bytes()).hexdigest() != item.get("sha256"):
            raise ValueError(f"Current vendor asset does not match historical dependency lock: {relative}. "
                             "Supply reviewed prior vendor assets before testing this dependency upgrade.")
        target = old / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return {"ref": ref, "commit": commit, "version": old_version,
            "reconstruction": "Previous tracked browser shell; current validated geographic data and lock-matching vendor assets"}


class UpgradeHandler(SimpleHTTPRequestHandler):
    """A real range-capable origin that switches releases without changing URLs."""
    def log_message(self, *_args):
        pass

    def translate_path(self, path):
        path = urlsplit(path).path
        if self.server.scope != "/" and path.startswith(self.server.scope):
            path = "/" + path[len(self.server.scope):]
        self.directory = str(self.server.runtime)
        return super().translate_path(path)

    def reject_outside_scope(self):
        if self.server.scope != "/" and not urlsplit(self.path).path.startswith(self.server.scope):
            self.server.escaped_requests.append(self.path)
            self.send_error(404, "Outside configured project deployment")
            return True
        return False

    def do_HEAD(self):
        self.server.requests.append({"release": self.server.runtime.name, "path": self.path})
        if not self.reject_outside_scope():
            super().do_HEAD()

    def do_GET(self):
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        self.server.requests.append({"release": self.server.runtime.name, "path": self.path})
        if self.reject_outside_scope():
            return
        if self.server.fail_graph and urlsplit(self.path).path.endswith("/data/network.json"):
            self.server.graph_failures += 1
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"Intentional upgrade graph failure")
            return
        path = Path(self.translate_path(self.path))
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if path.name == "mk-basemap.pmtiles" and path.is_file() and match:
            size = path.stat().st_size
            start = int(match.group(1))
            end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
            if start >= size or end < start:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            with path.open("rb") as stream:
                stream.seek(start)
                self.wfile.write(stream.read(end - start + 1))
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def raw_state(page):
    return page.evaluate("""() => ({settings:JSON.parse(localStorage.getItem('mk-redway-settings-v1')),
        saved:JSON.parse(localStorage.getItem('mk-redway-saved-v1'))})""")


def cache_state(page, base, offline_cache):
    return page.evaluate("""async ({base, offlineCache}) => {
        const result={keys:await caches.keys(), assets:{}};
        const offline=await caches.open(offlineCache);
        for(const file of ['data/network.json','data/mk-basemap.pmtiles']) {
            const response=await offline.match(new URL(file,base));
            if (!response || !response.ok) throw new Error('Missing offline '+file);
            const bytes=await response.arrayBuffer();
            const hash=await crypto.subtle.digest('SHA-256',bytes);
            result.assets[file]={size:bytes.byteLength,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
        }
        return result;
    }""", {"base": base, "offlineCache": offline_cache})


def controlled(page):
    page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
    page.evaluate("async () => { await navigator.serviceWorker.ready; }")


def open_settings(page):
    if not page.locator("#settingsSheet").is_visible():
        page.locator("#visibleSettingsBtn").click()


def assert_preferences(page, theme):
    from playwright.sync_api import expect

    expect(page.locator("html")).to_have_attribute("data-theme", theme)
    expect(page.locator("#voiceSettingBtn")).to_have_attribute("aria-checked", "false")
    expect(page.locator('[data-units="imperial"]')).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator(f'[data-theme-choice="{theme}"]')).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator('[data-navigation-icon-choice="cow"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#preferLitBtn")).to_have_attribute("aria-checked", "true")
    expect(page.locator("#preferSuperBtn")).to_have_attribute("aria-checked", "true")


def assert_saved_ui(page):
    from playwright.sync_api import expect

    page.locator("#closeSettings").click()
    page.locator("#savedPlacesBtn").click()
    expect(page.locator("#homeSavedLabel")).to_have_text(SAVED["home"]["address"])
    expect(page.locator("#workSavedLabel")).to_have_text(SAVED["work"]["address"])
    expect(page.locator(".saved-favourite-open strong")).to_have_text(SAVED["favourites"][0]["name"])
    expect(page.locator(".saved-favourite-open small")).to_have_text(SAVED["favourites"][0]["address"])
    page.locator("#closeSaved").click()
    open_settings(page)


def assert_offline(context, page):
    """Reapply native Chromium emulation if document reload reset its flag.

    The origin has already been shut down, so this transition cannot allow a
    successful network request. It does not override navigator.onLine or fetch.
    """
    reapplied = page.evaluate("navigator.onLine")
    if reapplied:
        context.set_offline(False)
        context.set_offline(True)
    page.wait_for_function("navigator.onLine === false")
    assert page.evaluate("navigator.onLine") is False
    return int(reapplied)


def wait_for_fix(page, fixes, client, latitude, longitude):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if any(fix["client"] == client and fix["method"] == "watchPosition"
               and abs(fix["latitude"] - latitude) < .000001
               and abs(fix["longitude"] - longitude) < .000001 for fix in fixes):
            return
        page.wait_for_timeout(50)
    raise AssertionError(f"No live navigation GPS fix delivered for {client}: {fixes}")


def assert_guidance(page, version):
    from playwright.sync_api import expect

    expect(page.locator("#app")).to_have_attribute("data-app-version", version)
    expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
    expect(page.locator("#navBanner")).to_be_visible()
    expect(page.locator("#navBottom")).to_be_visible()
    expect(page.locator("#turnText")).not_to_have_text("")
    expect(page.locator('.user-location-icon[data-navigation-icon="cow"]')).to_be_visible()


def review(browser, previous, current, historical, current_version, out, scope, theme, label):
    from playwright.sync_api import expect

    old_worker = (previous / "sw.js").read_text()
    new_worker = (current / "sw.js").read_text()
    old_shell = worker_literal(old_worker, "SHELL_CACHE")
    new_shell = worker_literal(new_worker, "SHELL_CACHE")
    offline_cache = worker_literal(old_worker, "OFFLINE_CACHE")
    assert old_shell != new_shell, "A release upgrade must replace the app-shell cache"
    assert offline_cache == worker_literal(new_worker, "OFFLINE_CACHE"), "Review migration test for changed offline-cache name"
    server = ThreadingHTTPServer(("127.0.0.1", 0), UpgradeHandler)
    server.runtime, server.scope, server.fail_graph = previous, scope, False
    server.requests, server.escaped_requests, server.graph_failures = [], [], 0
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}{scope}"
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                  has_touch=True, user_agent=IOS, color_scheme="dark", service_workers="allow",
                                  geolocation={"latitude": 52.0467, "longitude": -.7378, "accuracy": 5})
    seeded = {"settings": {**SETTINGS, "themeChoice": theme}, "saved": SAVED}
    gps, fixes, external, errors, clients = [], [], [], [], {}
    context.expose_binding("recordUpgradeGps", lambda source, method:
                           gps.append({"client": clients[source["page"]], "method": method}))
    context.expose_binding("recordUpgradeFix", lambda source, fix:
                           fixes.append({"client": clients[source["page"]], **fix}))
    context.add_init_script("""(() => {
        Object.defineProperty(navigator,'standalone',{value:true,configurable:true});
        if (!sessionStorage.getItem('upgrade-seeded')) {
            const seed = SEED;
            localStorage.setItem('mk-redway-settings-v1',JSON.stringify(seed.settings));
            localStorage.setItem('mk-redway-saved-v1',JSON.stringify(seed.saved));
            sessionStorage.setItem('upgrade-seeded','1');
        }
        for (const method of ['getCurrentPosition','watchPosition']) {
            const original=navigator.geolocation[method].bind(navigator.geolocation);
            navigator.geolocation[method]=(...args)=>{
                window.recordUpgradeGps(method);
                const callback=args[0];
                args[0]=fix=>{
                    window.recordUpgradeFix({method,latitude:fix.coords.latitude,longitude:fix.coords.longitude,
                                             accuracy:fix.coords.accuracy});
                    callback(fix);
                };
                return original(...args);
            };
        }
    })();""".replace("SEED", json.dumps(seeded)))
    context.route("https://**/*", lambda route: (external.append(route.request.url), route.abort()))
    expected_advertising_requests = block_adsense(context)
    page, navigation = context.new_page(), context.new_page()
    for client, client_label in [(page, "normal"), (navigation, "navigation")]:
        clients[client] = client_label
        client.set_default_timeout(45000)
        client.on("pageerror", lambda error, name=client_label: errors.append({"client": name, "error": str(error)}))
    result = {"label": label, "scope": scope, "theme": theme, "source": historical,
              "current_version": current_version, "clients": 2}
    origin_stopped = False
    try:
        print(f"Upgrade {label}: install {historical['ref']} and download offline assets", flush=True)
        page.goto(base, wait_until="networkidle")
        expect(page.locator("#app")).to_have_attribute("data-app-version", historical["version"])
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        if page.locator("#locationIntroDismiss").is_visible():
            page.locator("#locationIntroDismiss").click()
        controlled(page)
        open_settings(page)
        assert_preferences(page, theme)
        assert_saved_ui(page)
        page.locator("#offlineDownloadBtn").click()
        expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
        before = raw_state(page)
        assert before == seeded, before
        old_cache = cache_state(page, base, offline_cache)
        assert old_shell in old_cache["keys"], old_cache
        for relative, value in old_cache["assets"].items():
            source = current / relative
            assert value == {"size": source.stat().st_size, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}
        assert not gps and not external and not errors, (gps, external, errors)
        # A second installed client uses real Start and the browser's accurate GPS.
        navigation.goto(base + "?from=52.0467,-0.7378&to=52.025,-0.783&mode=walk&lit=1&super=1",
                        wait_until="networkidle")
        controlled(navigation)
        expect(navigation.locator("#app")).to_have_attribute("data-app-version", historical["version"])
        expect(navigation.locator("#routeStatus")).to_have_text("Route ready")
        expect(navigation.locator("#startNavBtn")).to_be_enabled()
        assert not gps, "Restoring a shared route must not request location"
        context.grant_permissions(["geolocation"])
        navigation.locator("#startNavBtn").click()
        assert_guidance(navigation, historical["version"])
        context.set_geolocation({"latitude": 52.04675, "longitude": -.7378, "accuracy": 5})
        wait_for_fix(navigation, fixes, "navigation", 52.04675, -.7378)
        assert {request["method"] for request in gps} == {"getCurrentPosition", "watchPosition"}, gps
        assert all(request["client"] == "navigation" for request in gps), gps
        assert raw_state(navigation) == before
        documents = {client: client.evaluate("performance.timeOrigin") for client in clients}
        # The startup image is shell-cached but not loaded by this viewport. An
        # old client may request it after the new worker claims that document.
        old_query_asset = next(asset for asset in worker_shell(old_worker)
                               if asset.startswith("./icons/iphone16-splash.png?"))
        assert not navigation.evaluate("url => performance.getEntriesByType('resource').some(item => item.name === new URL(url,location.href).href)", old_query_asset)
        assert not server.escaped_requests, server.escaped_requests
        server.runtime, server.fail_graph = current, True
        page.get_by_role("button", name="Check for updates", exact=True).click()
        expect(page.get_by_role("button", name="Reload updated app", exact=True)).to_be_visible(timeout=120000)
        for client in clients:
            expect(client.locator("#appUpdateStatus")).to_have_text("An update is ready. Reload when you have finished your journey.")
            assert client.evaluate("performance.timeOrigin") == documents[client], "Update automatically reloaded a client"
            expect(client.locator("#app")).to_have_attribute("data-app-version", historical["version"])
        assert_guidance(navigation, historical["version"])
        context.set_geolocation({"latitude": 52.0468, "longitude": -.7378, "accuracy": 5})
        wait_for_fix(navigation, fixes, "navigation", 52.0468, -.7378)
        assert_guidance(navigation, historical["version"])
        active_cache = cache_state(navigation, base, offline_cache)
        assert new_shell in active_cache["keys"], active_cache
        result["active_cache_after_claim"] = active_cache
        assert active_cache["assets"] == old_cache["assets"], (old_cache, active_cache)
        navigation.screenshot(path=str(out / f"{label}-old-client-updated-guidance.png"))
        # Browser permissions are shared by origin. Stop guidance deliberately
        # before resetting permission, so reloads keep the original non-location
        # browsing/privacy checks and cannot silently obtain fresh coordinates.
        navigation.locator("#exitNavBtn").click()
        expect(navigation.locator("#app")).to_have_attribute("data-stage", "planner")
        context.clear_permissions()
        page.get_by_role("button", name="Reload updated app", exact=True).click()
        page.wait_for_load_state("networkidle")
        expect(page.locator("#app")).to_have_attribute("data-app-version", current_version)
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        assert page.evaluate("performance.timeOrigin") != documents[page]
        assert navigation.evaluate("performance.timeOrigin") == documents[navigation]
        expect(navigation.locator("#app")).to_have_attribute("data-app-version", historical["version"])
        controlled(page)
        after = raw_state(page)
        assert after == before, (before, after)
        new_cache = cache_state(page, base, offline_cache)
        assert new_cache["assets"] == old_cache["assets"], (old_cache, new_cache)
        assert new_shell in new_cache["keys"] and old_shell not in new_cache["keys"], new_cache
        assert server.graph_failures > 0, "Upgrade did not exercise the intentional HTTP 503 graph fallback"
        shell = worker_shell(new_worker)
        cached = page.evaluate(r"""async ({base, name, files}) => {
            const cache=await caches.open(name), result={};
            for (const file of files) {
                const response=await cache.match(new URL(file,base));
                if (!response || !response.ok) throw new Error('Missing updated shell asset '+file);
                if (/\.(?:js|css)$/.test(file)) {
                    const hash=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
                    result[file]=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
                }
            }
            return result;
        }""", {"base": base, "name": new_shell, "files": shell})
        assert "./navigation-icons.js" in cached, "Updated navigation-icon module is not cached"
        for relative, digest in cached.items():
            assert digest == hashlib.sha256((current / relative).read_bytes()).hexdigest(), relative
        print(f"Upgrade {label}: both clients notified without reload; active old guidance survives {old_shell} → {new_shell}", flush=True)
        # Stop the actual origin as well as browser emulation. No offline reload
        # or unseen navigation can fall back to a live development server.
        server.shutdown()
        server.server_close()
        origin_stopped = True
        context.set_offline(True)
        count_before_offline = len(server.requests)
        offline_reapplications = assert_offline(context, navigation)
        expect(navigation.locator("#app")).to_have_attribute("data-app-version", historical["version"])
        assert navigation.evaluate("performance.timeOrigin") == documents[navigation]
        current_query_assets = [asset for asset in shell
                                if urlsplit(asset).path == urlsplit(old_query_asset).path]
        assert len(current_query_assets) == 1, current_query_assets
        current_query_asset = current_query_assets[0]
        missing_query_asset = f"./icons/upgrade-missing-file.png?v={historical['version']}"
        offline_icons = navigation.evaluate("""async urls => {
            const result={};
            for (const [name,url] of Object.entries(urls)) {
                try {
                    const response=await fetch(url);
                    const bytes=await response.arrayBuffer();
                    const hash=await crypto.subtle.digest('SHA-256',bytes);
                    result[name]={status:response.status,size:bytes.byteLength,
                                  sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
                } catch(error) { result[name]={error:String(error)}; }
            }
            return result;
        }""", {"previous": old_query_asset, "current": current_query_asset, "missing": missing_query_asset})
        old_asset_response = offline_icons["previous"]
        current_asset_response = offline_icons["current"]
        missing_asset_response = offline_icons["missing"]
        # Compatibility serves the inspected current shell asset. CI regenerates
        # PNGs, so historical tracked bytes need not equal the deployed artifact.
        current_asset_file = current / urlsplit(current_query_asset).path
        expected_current_asset = {"status": 200, "size": current_asset_file.stat().st_size,
                                  "sha256": hashlib.sha256(current_asset_file.read_bytes()).hexdigest()}
        assert old_asset_response == current_asset_response == expected_current_asset, offline_icons
        assert set(missing_asset_response) == {"error"}, missing_asset_response
        assert len(server.requests) == count_before_offline, server.requests[count_before_offline:]
        # The old client follows its update notice only after a deliberate
        # Exit. Its actual reload happens with the real origin already stopped.
        navigation.locator("#plannerBack").click()
        open_settings(navigation)
        expect(navigation.get_by_role("button", name="Reload updated app", exact=True)).to_be_visible()
        navigation.get_by_role("button", name="Reload updated app", exact=True).click()
        navigation.wait_for_load_state("networkidle")
        expect(navigation.locator("#app")).to_have_attribute("data-app-version", current_version)
        expect(navigation.locator("html")).to_have_attribute("data-routing-source", "bundled")
        assert navigation.evaluate("performance.timeOrigin") != documents[navigation]
        offline_reapplications += assert_offline(context, navigation)
        assert raw_state(navigation) == before
        expect(navigation.locator("#routeStatus")).to_have_text("Route ready")
        navigation.locator("#plannerBack").click()
        open_settings(navigation)
        assert_preferences(navigation, theme)
        assert_saved_ui(navigation)
        assert cache_state(navigation, base, offline_cache)["assets"] == old_cache["assets"]
        page.reload(wait_until="networkidle")
        expect(page.locator("#app")).to_have_attribute("data-app-version", current_version)
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        offline_reapplications += assert_offline(context, page)
        assert raw_state(page) == before
        open_settings(page)
        assert_preferences(page, theme)
        assert_saved_ui(page)
        page.screenshot(path=str(out / f"{label}-offline-settings.png"))
        unseen = base + "?from=52.0471,-0.7381&to=52.025,-0.783&mode=walk&lit=1&super=1"
        assert not any(request["path"] == urlsplit(unseen).path + "?" + urlsplit(unseen).query for request in server.requests)
        page.goto(unseen, wait_until="networkidle")
        offline_reapplications += assert_offline(context, page)
        expect(page.locator("#app")).to_have_attribute("data-app-version", current_version)
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        expect(page.locator("#startNavBtn")).to_be_enabled()
        expect(page.locator("#walkBtn")).to_have_class("mode-chip active")
        assert raw_state(page) == before
        response = page.evaluate("""async () => {
            const response=await fetch('./data/mk-basemap.pmtiles',{headers:{Range:'bytes=0-7'}});
            return {status:response.status, bytes:Array.from(new Uint8Array(await response.arrayBuffer())),
                    range:response.headers.get('Content-Range')};
        }""")
        assert response == {"status": 206, "bytes": list((current / "data/mk-basemap.pmtiles").read_bytes()[:8]),
                            "range": f"bytes 0-7/{(current / 'data/mk-basemap.pmtiles').stat().st_size}"}, response
        assert len(server.requests) == count_before_offline, server.requests[count_before_offline:]
        assert gps == [{"client": "navigation", "method": "getCurrentPosition"},
                       {"client": "navigation", "method": "watchPosition"}], gps
        assert not external and not errors, (external, errors)
        assert not server.escaped_requests, server.escaped_requests
        assert cache_state(page, base, offline_cache)["assets"] == old_cache["assets"]
        page.screenshot(path=str(out / f"{label}-offline-unseen-route.png"))
        result.update({"status": "passed", "before": before, "after": after,
                       "old_cache": old_cache, "updated_cache": new_cache, "cached_current_code": cached,
                       "graph_http_503_responses": server.graph_failures, "offline_pmtiles_range": response,
                       "gps_requests": gps, "gps_fixes": fixes,
                       "normal_client_gps_requests": [request for request in gps if request["client"] == "normal"],
                       "external_requests": external, "page_errors": errors,
                       "expected_advertising_requests": expected_advertising_requests,
                       "escaped_scope_requests": server.escaped_requests,
                       "old_client_offline_query_asset": {"url": old_query_asset, **old_asset_response},
                       "current_offline_query_asset": {"url": current_query_asset, **current_asset_response},
                       "missing_offline_query_asset": {"url": missing_query_asset, **missing_asset_response},
                       "clients_not_automatically_reloaded": True, "old_client_guidance_survived_update": True,
                       "offline_origin_stopped": origin_stopped,
                       "offline_emulation_reapplications": offline_reapplications,
                       "offline_server_requests": len(server.requests) - count_before_offline})
        print(f"PASS release upgrade {label}: two clients; explicit online/offline reloads; saved preferences/data retained; offline route and PMTiles 206", flush=True)
        return result
    except Exception as error:
        result["failure"] = str(error)
        for client, client_label in clients.items():
            client.screenshot(path=str(out / f"{label}-{client_label}-failure.png"))
        (out / f"{label}-failure.json").write_text(json.dumps({**result, "requests": server.requests,
            "escaped_scope_requests": server.escaped_requests, "gps_requests": gps, "gps_fixes": fixes,
            "external_requests": external, "page_errors": errors,
            "expected_advertising_requests": expected_advertising_requests}, indent=2) + "\n")
        raise
    finally:
        context.close()
        if not origin_stopped:
            server.shutdown()
            server.server_close()


def main():
    from playwright.sync_api import sync_playwright

    current = ROOT / "dist"
    current_version = (ROOT / "VERSION").read_text().strip()
    if json.loads((current / "data/data-meta.json").read_text())["app_version"] != current_version:
        raise ValueError("dist metadata does not match VERSION; run scripts/build_site.py first")
    refs = upgrade_refs(git("tag", "--list").decode().splitlines(), current_version,
                        os.environ.get("UPGRADE_FROM_REF"))
    out = ROOT / "test-results/release-upgrade"
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="reconstructed-shell-", dir=out) as directory:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"))
            try:
                for ref in refs:
                    previous = Path(directory) / ref.replace("/", "-")
                    historical = prepare_previous(previous, current, ref)
                    print(f"Source: {historical['ref']} ({historical['commit']}); {historical['reconstruction']}", flush=True)
                    for scope, theme, deployment in [("/", "dark", "root"),
                                                     ("/" + ROOT.name + "/", "high-contrast", "subpath")]:
                        label = historical["version"] + "-" + deployment
                        results.append(review(browser, previous, current, historical, current_version, out, scope, theme, label))
            finally:
                browser.close()
    (out / "evidence.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"PASS release upgrade {len(results)}/{len(refs) * 2}: {len(refs)} historical origins, root/subpath, two concurrent clients, installed-iOS Chromium emulation", flush=True)


if __name__ == "__main__":
    main()
