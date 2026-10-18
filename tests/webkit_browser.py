"""Real WebKit release gate for the built runtime and optional LIVE_URL.

This runs Playwright's pinned WebKit engine, not Chromium with an iPhone user
agent. Linux WebKit is useful Safari coverage, not a physical iOS/Safari claim.
Artifact offline checks close the real HTTP server after caching, requiring the
actual service worker to reload and route without an origin. Playwright WebKit's
set_offline emulation rejects cached navigation even in a minimal cache-first
app; a real origin disconnect succeeds. Therefore this test deliberately avoids
that emulation API. LIVE_URL checks the real UI and validated cached packages;
real WebKit disconnect coverage runs against the artifact, while the existing
Chromium production gate also requires a live-site offline reload. Neither gate
claims to prove installed iOS behaviour. An unreachable proxy blocks off-host
providers even when controlled requests bypass route interception; the runtime
hostname alone bypasses it. Local journeys need no geocoder.
"""
from advertising_fixture import block_adsense, external_provider_proxy
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
from threading import Thread
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_smoke import plan
from design_polish_browser import GPS, RangeHandler, hit
from navigation_icons_browser import assert_artwork, assert_marker, choose, open_choices


ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "test-results" / "webkit"
KINDS = ("dot", "arrow", "cyclist", "cow")


class RuntimeHandler(RangeHandler):
    def translate_path(self, path):
        if urlsplit(path).path.startswith("/navigator/"):
            path = "/" + path.split("/navigator/", 1)[1]
        return super().translate_path(path)


def capture(page, name):
    CAPTURES.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(CAPTURES / f"{name}.png"))


def new_page(browser, width=390, height=844, theme="dark", *, offline=False):
    context = browser.new_context(
        viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
        color_scheme="dark", geolocation=GPS,
        service_workers="allow" if offline else "block",
    )
    block_adsense(context)
    # Seed only once. A reload must restore the actual user's subsequent writes.
    context.add_init_script("""(() => {
        if (!sessionStorage.getItem('webkit-fixture-seeded')) {
            localStorage.setItem('mk-redway-settings-v1', SETTINGS);
            sessionStorage.setItem('webkit-fixture-seeded', '1');
        }
        window.webkitGeoCalls = 0;
        for (const name of ['getCurrentPosition', 'watchPosition']) {
            const original = navigator.geolocation[name].bind(navigator.geolocation);
            navigator.geolocation[name] = (...args) => {
                window.webkitGeoCalls++;
                return original(...args);
            };
        }
    })();""".replace("SETTINGS", json.dumps(json.dumps({"themeChoice": theme, "voiceEnabled": False}))))
    page = context.new_page()
    page.set_default_timeout(30000)
    errors, providers, fallbacks, responses = [], [], [], []

    def page_error(error):
        detail = {"name": error.name, "message": error.message, "stack": error.stack}
        errors.append(detail)
        print("WebKit page error: " + json.dumps(detail), flush=True)

    page.on("pageerror", page_error)
    page.on("response", lambda response: responses.append({"url": response.url, "status": response.status}))
    page.on("request", lambda request: providers.append(request.url)
            if "nominatim.openstreetmap.org" in request.url else None)
    page.on("request", lambda request: fallbacks.append(request.url)
            if "/api/interpreter" in request.url else None)
    page.route("**/nominatim.openstreetmap.org/**", lambda route: route.fulfill(json=[]))
    page.route("**/api/interpreter", lambda route: route.abort())
    return context, page, errors, providers, fallbacks, responses


def assert_provider_isolation(responses, runtime_url):
    """Controlled reloads must not silently execute live advertising code."""
    host = urlsplit(runtime_url).hostname
    external = [response for response in responses
                if urlsplit(response["url"]).scheme in ("http", "https")
                and urlsplit(response["url"]).hostname != host]
    assert not external, ("Unexpected provider HTTP responses", external)
    return external


def load(page, url):
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#app")).to_have_attribute("data-app-version", (ROOT / "VERSION").read_text().strip())
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    page.wait_for_function("""() => [...document.querySelectorAll('.leaflet-tile-container canvas')]
        .some(canvas => canvas.width >= 256 && canvas.height >= 256)""")
    if page.locator("#locationIntroDismiss").is_visible():
        page.locator("#locationIntroDismiss").click()


def no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal document overflow"


def select_coordinates(page, value):
    page.locator("#homeSearch").fill(value)
    page.locator("#homeSearchSubmit").click()
    page.get_by_role("button", name="Map coordinates", exact=False).click()


def review_viewport(browser, url, width, height, theme):
    context, page, errors, providers, fallbacks, responses = new_page(browser, width, height, theme)
    tag = f"{width}x{height}-{theme}"
    try:
        load(page, url)
        assert page.evaluate("window.webkitGeoCalls") == 0, "First run requested location"
        open_choices(page)
        expect(page.locator(".settings-group-title")).to_have_text(["Journey", "Appearance", "Offline & app"])
        for kind in KINDS:
            choose(page, kind)
            assert_artwork(page, f'[data-navigation-icon-choice="{kind}"] .navigation-icon-preview')
        for choice, resolved in [("light", "light"), ("dark", "dark"),
                                 ("high-contrast", "high-contrast"), ("system", "dark")]:
            page.locator(f'[data-theme-choice="{choice}"]').click()
            expect(page.locator("html")).to_have_attribute("data-theme", resolved)
            no_overflow(page)
        page.locator(f'[data-theme-choice="{theme}"]').click()
        capture(page, tag + "-settings")
        if width == 390:
            page.set_viewport_size({"width": 844, "height": 390})
            no_overflow(page)
            hit(page, "#closeSettings")
            choose(page, "cow")
            capture(page, "844x390-landscape-settings")
            page.set_viewport_size({"width": width, "height": height})
        page.locator("#closeSettings").click()

        # Persist a favourite through the real UI, including its edited name.
        select_coordinates(page, "52.025,-0.783")
        page.locator("#saveFavouriteBtn").click()
        expect(page.locator("#saveFavouriteBtn")).to_have_attribute("aria-pressed", "true")
        expect(page.locator("#saveFavouriteLabel")).to_have_text("Saved")
        page.locator("#closePlace").click()
        page.locator("#savedPlacesBtn").click()
        expect(page.locator(".saved-favourite-row")).to_have_count(1)
        page.locator(".saved-rename").click()
        page.locator("#favouriteNameInput").fill("WebKit riverside stop")
        page.locator("#favouriteNameSaveBtn").click()
        expect(page.locator(".saved-favourite-open strong")).to_have_text("WebKit riverside stop")
        capture(page, tag + "-saved")
        page.reload(wait_until="networkidle")
        page.locator("#savedPlacesBtn").click()
        expect(page.locator(".saved-favourite-open strong")).to_have_text("WebKit riverside stop")
        page.locator("#closeSaved").click()
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="cow"]')).to_have_attribute("aria-pressed", "true")
        page.locator("#closeSettings").click()

        assert page.evaluate("window.webkitGeoCalls") == 0, "Settings, Saved or coordinate search requested location"
        # Directions deliberately requests the current start before the user
        # replaces it. Grant permission at that user action, never at first run.
        context.grant_permissions(["geolocation"])
        plan(page, "52.0467,-0.7378", "52.025,-0.783")
        assert page.evaluate("window.webkitGeoCalls") == 1, "Directions should request one starting location"
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        if page.locator("#routeSheetHandle").get_attribute("aria-expanded") == "false":
            page.locator("#routeSheetHandle").click()
        options = page.locator(".route-option")
        assert 1 <= options.count() <= 3, "Cycling route alternatives missing"
        for index in range(options.count()):
            options.nth(index).click()
            expect(page.locator("#startNavBtn")).to_be_enabled()
            hit(page, "#startNavBtn")
        capture(page, tag + "-route")
        page.locator("#walkBtn").click()
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        expect(page.locator(".route-option")).to_have_count(0)
        page.locator("#routeMoreBtn").click()
        page.locator("#clearBtn").click()

        page.locator("#exploreRoutesBtn").click()
        expect(page.locator(".cultural-route-card")).to_have_count(5)
        hit(page, "#closeExplore")
        capture(page, tag + "-explore")
        page.locator("#closeExplore").click()

        # Real WebKit XML parsing/File input and navigation, with safe text names.
        if width == 390:
            title = 'WebKit &lt;b&gt;ride&lt;/b&gt; &amp; river'
            xml = ('<gpx version="1.1"><trk><name>' + title + '</name><trkseg>' +
                   ''.join(f'<trkpt lat="{52.025+i*.0002}" lon="{-0.783+i*.0003}"/>'
                           for i in range(11)) + '</trkseg></trk></gpx>')
            page.locator("#gpxFileInput").set_input_files({
                "name": "webkit.gpx", "mimeType": "application/gpx+xml", "buffer": xml.encode()})
            expect(page.locator("#startSearch")).to_have_value("WebKit <b>ride</b> & river start")
            expect(page.locator("#routeTrackStatus")).to_have_text("Track conditions unverified")
            expect(page.locator("#startNavBtn")).to_be_enabled()
            page.locator("#startNavBtn").click()
            expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
            assert_marker(page, "cow")
            hit(page, "#exitNavBtn")
            capture(page, tag + "-gpx-navigation")
            page.locator("#exitNavBtn").click()
        else:
            assert page.evaluate("window.webkitGeoCalls") == 1, "Route controls requested another location"
        no_overflow(page)
        assert not errors, errors
        assert not providers, providers
        assert not fallbacks, fallbacks
        external = assert_provider_isolation(responses, url)
        print(f"PASS WebKit {tag}: rendered map, themes/icons, Saved persistence, alternatives/walking, Explore and privacy", flush=True)
        return {"viewport": [width, height], "theme": theme, "page_errors": errors,
                "provider_requests": providers, "fallback_requests": fallbacks,
                "provider_http_responses": external}
    finally:
        context.close()


def review_cached_runtime(browser, url, label, *, disconnect=None):
    context, page, errors, providers, fallbacks, responses = new_page(browser, offline=True)
    try:
        load(page, url)
        assert_provider_isolation(responses, url)
        assert page.evaluate("'serviceWorker' in navigator"), "WebKit lacks service-worker support"
        page.wait_for_function("navigator.serviceWorker.controller !== null")
        assert page.evaluate("navigator.serviceWorker.controller.scriptURL") == urljoin(url, "sw.js")
        metadata_response = context.request.get(urljoin(url, "data/data-meta.json"),
                                                headers={"Cache-Control": "no-cache"})
        assert metadata_response.ok, f"WebKit runtime metadata returned {metadata_response.status}"
        metadata = metadata_response.json()
        assert metadata["app_version"] == (ROOT / "VERSION").read_text().strip(), metadata
        open_choices(page)
        choose(page, "cyclist")
        page.locator("#offlineDownloadBtn").click()
        expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
        page.locator("#closeSettings").click()
        package = page.evaluate("""async () => {
            const cache = await caches.open('mk-redway-offline-v1');
            const graph = await cache.match(new URL('./data/network.json', location.href));
            const map = await cache.match(new URL('./data/mk-basemap.pmtiles', location.href));
            const graphBytes = graph?.ok ? await graph.clone().arrayBuffer() : new ArrayBuffer(0);
            const graphData = graph?.ok ? await graph.json() : null;
            const mapBytes = map?.ok ? await map.arrayBuffer() : new ArrayBuffer(0);
            const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
                .map(byte => byte.toString(16).padStart(2,'0')).join('');
            return {format:graphData?.format, nodes:graphData?.nodes?.length || 0,
                mapBytes:mapBytes.byteLength,
                mapMagic:String.fromCharCode(...new Uint8Array(mapBytes.slice(0,7))),
                graphHash:await hash(graphBytes), mapHash:await hash(mapBytes)};
        }""")
        assert package["format"] == "mk-redway-network-v6", package
        assert package["nodes"] > 1000 and package["mapBytes"] > 100000, package
        assert package["mapMagic"] == "PMTiles", package
        assert package["nodes"] == metadata["network"]["nodes"], package
        assert package["graphHash"] == metadata["network"]["sha256"], package
        assert package["mapHash"] == metadata["basemap"]["sha256"], package
        if disconnect:
            disconnect()
        # Artifact cases have no origin server now. Production cases explicitly
        # verify the cached package/retained preference without claiming a real
        # disconnect: WebKit's emulation API cannot provide that assertion.
        page.reload(wait_until="networkidle")
        assert_provider_isolation(responses, url)
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="cyclist"]')).to_have_attribute("aria-pressed", "true")
        expect(page.locator("#offlineStatus")).to_contain_text("available offline")
        page.locator("#closeSettings").click()
        response = page.evaluate("""async () => {
            const r = await fetch('./data/mk-basemap.pmtiles', {headers:{Range:'bytes=0-7'}});
            return {status:r.status, length:(await r.arrayBuffer()).byteLength};
        }""")
        assert response == {"status": 206, "length": 8}, response
        unseen = url + "?from=52.0467,-0.7378&to=52.025,-0.783&mode=walk&lit=1"
        page.goto(unseen, wait_until="networkidle")
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        expect(page.locator("#startNavBtn")).to_be_enabled()
        capture(page, label + "-offline-shared-route")
        assert page.evaluate("window.webkitGeoCalls") == 0
        assert not errors, errors
        assert not providers, providers
        assert not fallbacks, fallbacks
        external = assert_provider_isolation(responses, url)
        if disconnect:
            print(f"PASS WebKit {label}: real origin unavailable, SW reload/graph/PMTiles206, retained icon and unseen shared URL", flush=True)
        else:
            print("PASS WebKit production cache: validated graph/PMTiles, retained icon and shared route; real WebKit disconnect is covered by the artifact gate (emulation limitation)", flush=True)
        return {"scope": label, "origin_disconnected": bool(disconnect), "package": package,
                "range_response": response, "retained_icon": "cyclist", "unseen_shared_route": True,
                "provider_http_responses": external, "page_errors": errors}
    finally:
        context.close()


def review_local_offline(browser, label):
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RuntimeHandler, directory=str(ROOT / "dist")))
    Thread(target=server.serve_forever, daemon=True).start()
    closed = False

    def disconnect():
        nonlocal closed
        server.shutdown()
        server.server_close()
        closed = True
        # Independently prove a real connection failure rather than a mocked
        # fetch/cache result. No application implementation is changed.
        try:
            connection = socket.create_connection(("127.0.0.1", server.server_port), timeout=1)
        except ConnectionRefusedError:
            return
        connection.close()
        raise AssertionError("WebKit offline origin still accepts network connections")

    suffix = "navigator/" if label == "subpath" else ""
    try:
        return review_cached_runtime(browser, f"http://127.0.0.1:{server.server_port}/" + suffix,
                                     label, disconnect=disconnect)
    finally:
        if not closed:
            server.shutdown()
            server.server_close()


def main():
    server = None
    url = os.environ.get("LIVE_URL")
    if not url:
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RuntimeHandler, directory=str(ROOT / "dist")))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/"
    evidence = {"engine": "WebKit", "url": url, "viewports": [], "offline": []}
    try:
        with external_provider_proxy(url) as proxy, sync_playwright() as playwright:
            browser = playwright.webkit.launch(executable_path=os.environ.get("WEBKIT_EXECUTABLE"), proxy=proxy)
            evidence["engine_version"] = browser.version
            try:
                for width, height, theme in [(320, 568, "light"), (390, 844, "dark")]:
                    evidence["viewports"].append(review_viewport(browser, url, width, height, theme))
                if server:
                    for label in ("root", "subpath"):
                        evidence["offline"].append(review_local_offline(browser, label))
                else:
                    evidence["production_cache"] = review_cached_runtime(browser, url, "production")
                    evidence["offline_emulation_limitation"] = (
                        "WebKit context.set_offline rejects cache-first navigation; "
                        "real origin disconnect is required by the artifact gate. "
                        "Live Chromium separately requires production offline reload.")
            finally:
                browser.close()
    finally:
        CAPTURES.mkdir(parents=True, exist_ok=True)
        (CAPTURES / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        if server:
            server.shutdown()
    print("PASS actual WebKit gate: " + url, flush=True)


if __name__ == "__main__":
    main()
