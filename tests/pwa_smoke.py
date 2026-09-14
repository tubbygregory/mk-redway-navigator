"""Root/subpath service-worker and offline release gate; optional live review."""
import base64
import json
import os
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import tempfile
from playwright.sync_api import sync_playwright, expect
from browser_smoke import plan

ROOT = Path(__file__).resolve().parents[1]
def capture(page, name):
    path = ROOT / "test-results" / (name + ".jpg")
    path.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(path), type="jpeg", quality=55)
    if os.environ.get("LIVE_URL"):
        print("REVIEW_IMAGE_" + name + "=" + base64.b64encode(path.read_bytes()).decode(), flush=True)

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
    capture(page, "first-run")
    page.get_by_role("button", name="Got it", exact=True).click()
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    page.evaluate("async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})); }")
    assert page.evaluate("navigator.serviceWorker.controller !== null")
    capture(page, "map")
    page.get_by_role("button", name="Install MK Redway as an app", exact=True).click()
    expect(page.locator("#installSheet")).to_be_visible()
    capture(page, "install")
    page.get_by_role("button", name="Close install instructions", exact=True).click()
    if live:
        page.get_by_role("searchbox", name="Search for a destination", exact=True).fill("Milton Keynes Central")
        page.get_by_role("button", name="Search", exact=True).click()
        expect(page.locator(".result-item").first).to_be_visible()
        capture(page, "search")
        page.get_by_role("button", name="Close search results", exact=True).click()
    plan(page, "52.0467,-0.7378", "52.025,-0.783")
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    assert page.locator("#timeStat").bounding_box()["height"] < 40, "Journey time wraps"
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
    swipe_handle(55)
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "false")
    expect(page.locator("#timeStat")).to_be_visible()
    expect(page.locator("#routeAlternatives")).to_be_hidden()
    capture(page, "route-collapsed")
    swipe_handle(-55)
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "true")
    expect(page.locator("#routeAlternatives")).to_be_visible()
    page.get_by_role("button", name="Collapse route details", exact=True).click()
    page.get_by_role("button", name="Expand route details", exact=True).press("Enter")
    expect(page.locator("#routeAlternatives")).to_be_visible()
    touch.detach()

    for name in ("Balanced", "Fastest", "Max Redway"):
        page.locator(".route-option").filter(has_text=name).click()
        expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    page.get_by_role("button", name="Walk", exact=True).click()
    expect(page.get_by_role("button", name="Start", exact=True)).to_be_enabled()
    page.get_by_role("button", name="Start", exact=True).click()
    expect(page.locator("#navBanner")).to_be_visible()
    page.wait_for_timeout(3000)  # Inspect the settled camera and asynchronous tiles.
    marker = page.locator(".user-pulse").bounding_box()
    assert marker, "Navigation location marker is missing"
    assert abs(marker["x"] + marker["width"] / 2 - 195) < 35, marker
    assert abs(marker["y"] + marker["height"] / 2 - 844 * .58) < 55, marker
    capture(page, "navigation")
    page.get_by_role("button", name="Exit", exact=True).click()
    page.get_by_role("button", name="Clear", exact=True).click()
    page.get_by_role("button", name="Open settings", exact=True).click()
    page.locator("#aboutData summary").click()
    expect(page.locator("#aboutVersion")).to_contain_text((ROOT / "VERSION").read_text().strip())
    capture(page, "about")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
    page.set_viewport_size({"width": 844, "height": 390})
    expect(page.get_by_role("button", name="Close settings", exact=True)).to_be_visible()
    saved = page.locator("#savedPlacesBtn").bounding_box()
    install = page.locator("#installAppBtn").bounding_box()
    assert install["x"] + install["width"] <= saved["x"], "Landscape map buttons overlap"
    capture(page, "landscape-settings")
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Close settings", exact=True).click()
    page.get_by_role("button", name="Open saved places", exact=True).click()
    capture(page, "saved")
    page.locator("#offlineDownloadBtn").click()
    expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
    page.get_by_role("button", name="Close saved places", exact=True).click()
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
    assert not errors, errors
    assert not external_shell, external_shell
    print("PASS PWA: " + url + " mobile, settings, modes, navigation, SW and offline routing/map")
    context.close()

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if os.environ.get("LIVE_URL"):
            review(browser, os.environ["LIVE_URL"], True)
        else:
            with tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / "mk-redway-navigator").symlink_to(ROOT / "dist", target_is_directory=True)
                for directory, suffix in ((ROOT / "dist", "/"), (Path(tmp), "/mk-redway-navigator/")):
                    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(directory)))
                    Thread(target=server.serve_forever, daemon=True).start()
                    try:
                        review(browser, f"http://127.0.0.1:{server.server_port}{suffix}")
                    finally:
                        server.shutdown()
        browser.close()
if __name__ == "__main__":
    main()
