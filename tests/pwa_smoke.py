"""Root/subpath service-worker and offline release gate; optional live review."""
import base64
import json
import os
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urljoin
import tempfile
from playwright.sync_api import sync_playwright, expect
from browser_smoke import plan
from audit_browser import local_place_fixtures, review_cultural_tracks, review_local_place_search

ROOT = Path(__file__).resolve().parents[1]
def capture(page, name):
    path = ROOT / "test-results" / (name + ".jpg")
    path.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(path), type="jpeg", quality=55)
    if os.environ.get("LIVE_URL"):
        print("REVIEW_IMAGE_" + name + "=" + base64.b64encode(path.read_bytes()).decode(), flush=True)


def check_panel_handle(page, context, panel_id, body_selector):
    panel = page.locator("#" + panel_id)
    handle = panel.locator(".sheet-handle")
    body = panel.locator(body_selector)
    stage = page.locator("#app").get_attribute("data-stage")
    touch = context.new_cdp_session(page)
    def swipe(dy):
        box = handle.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        touch.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + dy}]})
        touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    swipe(55)
    expect(handle).to_have_attribute("aria-expanded", "false")
    expect(body).to_be_hidden()
    expect(panel.locator(".sheet-summary")).to_be_visible()
    capture(page, panel_id + "-collapsed")
    swipe(-55)
    expect(handle).to_have_attribute("aria-expanded", "true")
    expect(body).to_be_visible()
    handle.tap()
    expect(body).to_be_hidden()
    handle.press("Enter")
    expect(body).to_be_visible()
    expect(page.locator("#app")).to_have_attribute("data-stage", stage)
    touch.detach()

def review(browser, url, live=False):
    context = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True,
                                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
                                  permissions=["geolocation"], geolocation={"latitude": 52.0467, "longitude": -.7378})
    page = context.new_page()
    page.set_default_timeout(45000)
    errors, external_shell = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda req: external_shell.append(req.url) if "unpkg.com" in req.url else None)
    page.goto(url, wait_until="networkidle")
    expected_version = (ROOT / "VERSION").read_text().strip()
    expect(page.locator("#app")).to_have_attribute("data-app-version", expected_version)
    metadata = context.request.get(urljoin(url, "data/data-meta.json"), headers={"Cache-Control": "no-cache"})
    assert metadata.ok, f"Runtime metadata returned {metadata.status}"
    assert metadata.json()["app_version"] == expected_version, "Runtime metadata is from a different release"
    capture(page, "first-run")
    expect(page.locator("#visibleSettingsBtn")).to_be_visible()
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    page.evaluate("async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})); }")
    assert page.evaluate("navigator.serviceWorker.controller !== null")
    capture(page, "map")
    expect(page.get_by_role("button", name="Show my location", exact=True)).to_be_visible()
    page.get_by_role("button", name="Show my location", exact=True).click()
    expect(page.locator(".user-pulse")).to_be_visible()
    page.get_by_role("button", name="Explore", exact=True).click()
    expect(page.locator("#exploreSheet")).to_be_visible()
    expect(page.locator(".cultural-route-card")).to_have_count(5)
    capture(page, "explore")
    page.get_by_role("button", name="Close Explore Milton Keynes", exact=True).click()
    page.locator("#visibleSettingsBtn").click()
    page.get_by_role("button", name="Install MK Redway as an app", exact=True).click()
    expect(page.locator("#installSheet")).to_be_visible()
    check_panel_handle(page, context, "installSheet", "#installSteps")
    capture(page, "install")
    page.get_by_role("button", name="Close install instructions", exact=True).click()
    if live:
        page.get_by_role("searchbox", name="Search for a destination", exact=True).fill("Milton Keynes Central")
        page.get_by_role("button", name="Search", exact=True).click()
        expect(page.locator(".result-item").first).to_be_visible()
        capture(page, "search")
        page.get_by_role("button", name="Close search results", exact=True).click()
    page.get_by_role("searchbox", name="Search for a destination", exact=True).fill("52.025,-0.783")
    page.get_by_role("button", name="Search", exact=True).click()
    expect(page.locator(".result-item").first).to_be_visible()
    check_panel_handle(page, context, "resultsSheet", "#resultsList")
    page.locator(".result-item").first.click()
    check_panel_handle(page, context, "placeSheet", ".place-actions")
    page.get_by_role("button", name="Close destination", exact=True).click()
    plan(page, "52.0467,-0.7378", "52.025,-0.783")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    assert page.locator("#timeStat").bounding_box()["height"] < 40, "Journey time wraps"
    mix_total = page.locator("#routeMixLegend b").evaluate_all("els => els.reduce((sum, el) => sum + Number(el.textContent.replace('%','')), 0)")
    assert mix_total == 100, mix_total
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "false")
    capture(page, "route")

    # Edit an explicit start while a route panel is already visible.
    search = page.get_by_role("searchbox", name="Starting location", exact=True)
    search.fill("John Lewis" if live else "Test station start")
    expect(page.locator("#routeSheet")).to_be_hidden()
    expect(page.locator("#resultsSheet")).to_be_visible()
    if not live:
        page.route("**/nominatim.openstreetmap.org/search?*", lambda route: route.fulfill(
            json=[{"lat": "52.0345", "lon": "-0.774", "name": "Test station start",
                   "display_name": "Test station start, Milton Keynes", "type": "station"}]))
    if live:
        search.press("Enter")  # Match the iPhone keyboard submission in the recording.
    else:
        page.get_by_role("button", name="Search starting location", exact=True).click()
    expect(page.locator(".result-item").first).to_be_visible()
    expect(page.locator("#routeSheet")).to_be_hidden()
    capture(page, "start-search")
    page.locator(".result-item").first.click()
    expect(page.locator("#routeSheet")).to_be_visible()
    expect(page.locator("#resultsSheet")).to_be_hidden()
    if not live:
        expect(search).to_have_value("Test station start")
        page.unroute("**/nominatim.openstreetmap.org/search?*")
    # Restore the deterministic journey before testing navigation.
    search.fill("52.0467,-0.7378")
    page.get_by_role("button", name="Search starting location", exact=True).click()
    page.get_by_role("button", name="Map coordinates", exact=False).click()
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    # Use actual touch input on the handle; body scrolling remains native.
    touch = context.new_cdp_session(page)
    def swipe_handle(dy):
        box = page.locator("#routeSheetHandle").bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        touch.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + dy}]})
        touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.get_by_role("button", name="Expand route details", exact=True).click()
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "true")
    expect(page.locator("#routeAlternatives")).to_be_visible()
    swipe_handle(55)
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "false")
    swipe_handle(-55)
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "true")
    page.get_by_role("button", name="Collapse route details", exact=True).click()
    page.get_by_role("button", name="Expand route details", exact=True).press("Enter")
    expect(page.locator("#routeAlternatives")).to_be_visible()
    touch.detach()

    options = page.locator(".route-option")
    assert 1 <= options.count() <= 3
    for i in range(options.count()):
        options.nth(i).click()
        expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    page.get_by_role("button", name="Walk", exact=True).click()
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    expect(page.locator("#prefBtn")).to_be_hidden()
    page.get_by_role("button", name="Start", exact=True).click()
    expect(page.locator("#navBanner")).to_be_visible()
    page.wait_for_timeout(3000)  # Inspect the settled camera and asynchronous tiles.
    marker = page.locator(".user-pulse").bounding_box()
    assert marker, "Navigation location marker is missing"
    assert abs(marker["x"] + marker["width"] / 2 - 195) < 35, marker
    assert abs(marker["y"] + marker["height"] / 2 - 844 * .58) < 55, marker
    capture(page, "navigation")
    page.get_by_role("button", name="Exit", exact=True).click()
    page.get_by_role("button", name="More", exact=True).click()
    page.get_by_role("button", name="Clear route", exact=True).click()

    # Starting an imported GPX away from its first point must preserve that track
    # rather than silently replacing it with a normal A-to-B route.
    gpx = """<?xml version="1.0"?>
    <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
      <trk><name>Regression GPX</name><trkseg>
        <trkpt lat="52.025000" lon="-0.783000"/>
        <trkpt lat="52.026000" lon="-0.781500"/>
        <trkpt lat="52.027000" lon="-0.780000"/>
      </trkseg></trk>
    </gpx>"""
    page.locator("#gpxFileInput").set_input_files({
        "name": "regression.gpx",
        "mimeType": "application/gpx+xml",
        "buffer": gpx.encode("utf-8")
    })
    expect(page.get_by_role("searchbox", name="Starting location", exact=True)).to_have_value("Regression GPX start")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    page.get_by_role("button", name="Start", exact=True).click()
    expect(page.locator("#navBanner")).to_be_visible()
    # The planner is intentionally hidden during navigation, so inspect the
    # underlying field directly rather than locating it by an exposed ARIA role.
    expect(page.locator("#startSearch")).to_have_value("Regression GPX start")
    page.get_by_role("button", name="Exit", exact=True).click()
    page.get_by_role("button", name="More", exact=True).click()
    page.get_by_role("button", name="Clear route", exact=True).click()

    page.locator("#visibleSettingsBtn").click()
    check_panel_handle(page, context, "settingsSheet", ".setting-row:not(.install-setting)")
    page.get_by_role("button", name="High contrast", exact=True).click()
    expect(page.locator("html")).to_have_attribute("data-theme", "high-contrast")
    page.get_by_role("button", name="System", exact=True).click()
    page.locator("#aboutData summary").click()
    expect(page.locator("#aboutVersion")).to_contain_text((ROOT / "VERSION").read_text().strip())
    page.get_by_role("button", name="Check for updates", exact=True).click()
    expect(page.locator("#appUpdateStatus")).to_contain_text("No newer update found")
    assert "permission" not in page.locator("#aboutData").inner_text().lower()
    expect(page.locator("#aboutData")).to_contain_text("not an official Milton Keynes City Council service")
    capture(page, "about")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
    page.set_viewport_size({"width": 844, "height": 390})
    expect(page.get_by_role("button", name="Close settings", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Landscape settings overflow"
    capture(page, "landscape-settings")
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Close settings", exact=True).click()
    page.get_by_role("button", name="Open saved places", exact=True).click()
    check_panel_handle(page, context, "savedSheet", ".saved-specials")
    capture(page, "saved")
    page.get_by_role("button", name="Close saved places", exact=True).click()
    page.locator("#visibleSettingsBtn").click()
    page.locator("#offlineDownloadBtn").click()
    expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
    page.get_by_role("button", name="Close settings", exact=True).click()
    context.set_offline(True)
    page.reload(wait_until="networkidle")
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    response = page.evaluate("""async () => {
      const r = await fetch('./data/mk-basemap.pmtiles', {headers:{Range:'bytes=0-7'}});
      return {status:r.status, length:(await r.arrayBuffer()).byteLength};
    }""")
    assert response == {"status": 206, "length": 8}, response
    plan(page, "52.0467,-0.7378", "52.025,-0.783")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    # This URL has never been requested online; its route parameters must not
    # prevent the service worker from serving the installed app document.
    page.goto(url + '?from=52.0467,-0.7378&to=52.025,-0.783&mode=walk&lit=1', wait_until="networkidle")
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    expect(page.locator("#routeStatus")).to_have_text("Route ready")
    expect(page.locator("#walkBtn")).to_have_class("mode-chip active")
    assert not errors, errors
    assert not external_shell, external_shell
    print("PASS PWA: " + url + " mobile, settings, modes, navigation, SW and offline routing/map")
    context.close()


def review_dark_shell(browser, url):
    """Installed iOS dark mode must not expose white legacy fallback surfaces."""
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        color_scheme="dark",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1"
    )
    context.add_init_script("""Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      get: () => true
    });""")
    page = context.new_page()
    page.set_default_timeout(45000)
    page.goto(url, wait_until="networkidle")
    expect(page.locator("html")).to_have_class(__import__("re").compile(r".*ios-standalone.*"))
    expect(page.locator("#savedPlacesBtn")).to_be_visible()
    expect(page.locator("#locationIntro")).to_be_visible()
    expect(page.locator("#locationIntro")).to_contain_text("Location is used on this device")
    page.get_by_role("button", name="Not now", exact=True).click()
    expect(page.locator("#locationIntro")).to_be_hidden()

    styles = page.evaluate("""() => {
      const saved = getComputedStyle(document.querySelector('#savedPlacesBtn'));
      const root = getComputedStyle(document.documentElement);
      const app = getComputedStyle(document.querySelector('#app'));
      const fade = getComputedStyle(document.querySelector('#app'), '::after');
      return {
        savedBackground: saved.backgroundColor,
        savedText: saved.color,
        rootBackground: root.backgroundColor,
        appBackground: app.backgroundColor,
        fade: fade.backgroundImage
      };
    }""")
    assert styles["savedBackground"] != "rgb(255, 255, 255)", styles
    assert styles["rootBackground"] == "rgb(17, 21, 26)", styles
    assert styles["appBackground"] == "rgb(17, 21, 26)", styles
    assert "255, 255, 255" not in styles["fade"], styles
    assert "17, 21, 26" in styles["fade"], styles
    capture(page, "dark-ios-shell")
    context.close()


def review_delayed_location(browser, url):
    """A late GPS result must never replace a manually chosen start."""
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    context.add_init_script("""(() => {
      const pending = [];
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
        value: (success, failure) => pending.push({success, failure})
      });
      window.finishTestLocation = (succeeded) => {
        const request = pending.shift();
        if (!request) throw new Error('No pending location request');
        if (succeeded) request.success({coords: {latitude: 52.0467, longitude: -.7378, accuracy: 10}});
        else request.failure({code: 1, message: 'Test location denied'});
      };
    })();""")
    page = context.new_page()
    page.set_default_timeout(45000)
    page.route("**/nominatim.openstreetmap.org/search?*", lambda route: route.fulfill(
        json=[{"lat": "52.0345", "lon": "-0.774", "name": "Station entrance",
               "display_name": "Station entrance, Milton Keynes"}]))
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#visibleSettingsBtn")).to_be_visible()
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    page.get_by_role("searchbox", name="Search for a destination", exact=True).fill("52.025,-0.783")
    page.get_by_role("button", name="Search", exact=True).click()
    page.get_by_role("button", name="Map coordinates", exact=False).click()
    page.get_by_role("button", name="Directions", exact=True).click()
    start = page.get_by_role("searchbox", name="Starting location", exact=True)
    start.fill("Station entrance")
    page.get_by_role("button", name="Search starting location", exact=True).click()
    page.locator(".result-item").first.click()
    expect(start).to_have_value("Station entrance")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    page.evaluate("window.finishTestLocation(true)")
    expect(start).to_have_value("Station entrance")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    capture(page, "manual-start-preserved")

    # A late failure must also leave a new query and its results alone.
    page.get_by_role("button", name="Use current location", exact=True).click()
    start.fill("Another station")
    page.get_by_role("button", name="Search starting location", exact=True).click()
    expect(page.locator(".result-item").first).to_be_visible()
    page.evaluate("window.finishTestLocation(false)")
    expect(start).to_have_value("Another station")
    expect(page.locator(".result-item").first).to_be_visible()
    expect(page.locator("#routeSheet")).to_be_hidden()

    # Leaving the planner cancels any outstanding current-location update.
    page.get_by_role("button", name="Close search results", exact=True).click()
    page.get_by_role("button", name="Use current location", exact=True).click()
    page.get_by_role("button", name="Back", exact=True).click()
    page.evaluate("window.finishTestLocation(true)")
    expect(page.locator("#placeSheet")).to_be_visible()
    expect(page.locator("#routeSheet")).to_be_hidden()
    page.get_by_role("button", name="Directions", exact=True).click()
    expect(start).to_have_value("Station entrance")
    # A pending navigation start must not reopen navigation after Back.
    page.get_by_role("button", name="Start", exact=True).click()
    page.get_by_role("button", name="Back", exact=True).click()
    page.evaluate("window.finishTestLocation(true)")
    expect(page.locator("#app")).to_have_attribute("data-stage", "place")
    expect(page.locator("#navBanner")).to_be_hidden()
    print("PASS manual start: delayed GPS success/failure, leaving planner and cancelled navigation Start: " + url)
    context.close()


def review_offline_cultural_tracks(browser, url):
    """A fresh installed shell must open every unseen Cultural Route offline."""
    context = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
        accept_downloads=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
    )
    context.add_init_script("""Object.defineProperty(navigator, 'standalone', {
      configurable: true, get: () => true
    });""")
    page = context.new_page()
    page.set_default_timeout(45000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    expect(page.locator("html")).to_have_class(__import__("re").compile(r".*ios-standalone.*"))
    if page.get_by_role("button", name="Not now", exact=True).is_visible():
        page.get_by_role("button", name="Not now", exact=True).click()
    # Do not open Explore online: its nearest-join hydration must not hide a
    # missing precache. Await activation, then make the first UI track loads offline.
    page.evaluate("async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})); }")
    page.locator("#visibleSettingsBtn").click()
    page.locator("#offlineDownloadBtn").click()
    expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
    page.get_by_role("button", name="Close settings", exact=True).click()
    places = local_place_fixtures(page, url)
    context.set_offline(True)
    page.reload(wait_until="networkidle")
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    # Chromium can reset its native online indicator during a cache-only SW
    # reload while requests remain blocked. Resend a real network transition;
    # never override navigator or satisfy offline searches through mocks.
    if page.evaluate("navigator.onLine"):
        context.set_offline(False)
        context.set_offline(True)
    assert page.evaluate("navigator.onLine") is False
    review_local_place_search(page, url, offline=True, fixtures=places)
    review_cultural_tracks(page, url)
    assert not errors, errors
    print("PASS unseen offline places and Cultural Routes: canonical local addresses/POIs, all ten source geometries, installed-iOS Chromium emulation: " + url)
    context.close()

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if os.environ.get("LIVE_URL"):
            review(browser, os.environ["LIVE_URL"], True)
            review_dark_shell(browser, os.environ["LIVE_URL"])
            review_delayed_location(browser, os.environ["LIVE_URL"])
            review_offline_cultural_tracks(browser, os.environ["LIVE_URL"])
        else:
            with tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / "mk-redway-navigator").symlink_to(ROOT / "dist", target_is_directory=True)
                for directory, suffix in ((ROOT / "dist", "/"), (Path(tmp), "/mk-redway-navigator/")):
                    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(directory)))
                    Thread(target=server.serve_forever, daemon=True).start()
                    try:
                        review(browser, f"http://127.0.0.1:{server.server_port}{suffix}")
                        review_dark_shell(browser, f"http://127.0.0.1:{server.server_port}{suffix}")
                        review_delayed_location(browser, f"http://127.0.0.1:{server.server_port}{suffix}")
                        review_offline_cultural_tracks(browser, f"http://127.0.0.1:{server.server_port}{suffix}")
                    finally:
                        server.shutdown()
        browser.close()
if __name__ == "__main__":
    main()
