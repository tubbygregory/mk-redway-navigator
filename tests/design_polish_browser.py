"""Rendered design/friendliness gate for the runtime artifact and live release.

Native hit testing detects controls covered by sheets, even when Playwright could
scroll them into view. Browser GPS is controlled; provider searches are intercepted
at the browser boundary. No public geocoder or application test hooks are used.
Chromium iPhone/standalone emulation is not physical Safari verification.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "test-results" / "design-polish"
IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
GPS = {"latitude": 52.025, "longitude": -.783, "accuracy": 5}


class RangeHandler(SimpleHTTPRequestHandler):
    """Serve actual PMTiles ranges so the rendered basemap matches production."""

    def log_message(self, *_args):
        pass

    def do_GET(self):
        path = Path(self.translate_path(self.path))
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if match and path.name == "mk-basemap.pmtiles" and path.is_file():
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
            with path.open("rb") as data:
                data.seek(start)
                self.wfile.write(data.read(end - start + 1))
            return
        super().do_GET()


def screenshot(page, name):
    CAPTURES.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(CAPTURES / f"{name}.png"))


def hit(page, selector):
    """Require an existing, in-viewport native click target without auto-scroll."""
    page.wait_for_function("""selector => {
        const el = document.querySelector(selector);
        if (!el || !el.getClientRects().length) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
            r.right <= innerWidth && r.bottom <= innerHeight &&
            el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2));
    }""", arg=selector, timeout=10000)


def attribution(page):
    selectors = [
        '.map-attribution a[href="https://www.openstreetmap.org/copyright"]',
        '.map-attribution a[href="https://protomaps.com/"]',
    ]
    for selector in selectors:
        expect(page.locator(selector)).to_have_count(1)
        hit(page, selector)
    return page.locator(".map-attribution a").evaluate_all("""links => links.map(el => {
        const r=el.getBoundingClientRect();
        return {text:el.textContent, rect:r.toJSON(),
            nativeHit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    })""")


def saved_fixture():
    def place(name, index):
        return {"name": name, "address": f"Fixture point {index}, Milton Keynes",
                "lat": 52.04 + index / 10000, "lng": -.76 + index / 10000}
    return {"home": place("Home", 1), "work": place("Work", 2), "favourites": [
        {"id": f"design-fixture-{i}", **place(f"Favourite {i} with a longer name", i)}
        for i in range(10)
    ]}


def new_page(browser, url, width, height, theme="light", saved=None):
    mobile = width < 900
    context = browser.new_context(
        viewport={"width": width, "height": height}, service_workers="block",
        is_mobile=mobile, has_touch=mobile, color_scheme="dark" if theme == "system" else "light",
        geolocation=GPS, accept_downloads=True,
        user_agent=IOS if mobile else None,
    )
    # Observe the real browser API without changing its answers or timing.
    context.add_init_script("""(() => {
        window.designGeo = {requests:0, watches:0, fixes:[]};
        for (const method of ['getCurrentPosition', 'watchPosition']) {
            const original = navigator.geolocation[method].bind(navigator.geolocation);
            navigator.geolocation[method] = (success, ...args) => {
                window.designGeo[method === 'getCurrentPosition' ? 'requests' : 'watches']++;
                return original(position => {
                    window.designGeo.fixes.push({lat:position.coords.latitude,
                        lng:position.coords.longitude, accuracy:position.coords.accuracy});
                    success(position);
                }, ...args);
            };
        }
    })();""")
    context.add_init_script("localStorage.setItem('mk-redway-settings-v1', " +
                            json.dumps(json.dumps({"themeChoice": theme, "voiceEnabled": False})) + ");")
    if mobile:
        context.add_init_script("Object.defineProperty(navigator, 'standalone', {value:true, configurable:true});")
    if saved is not None:
        context.add_init_script("localStorage.setItem('mk-redway-saved-v1', " + json.dumps(json.dumps(saved)) + ");")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors, searches = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: searches.append(request.url)
            if "nominatim.openstreetmap.org" in request.url else None)
    page.route("**/nominatim.openstreetmap.org/**", lambda route: route.fulfill(json=[]))
    page.route("**/api/interpreter", lambda route: route.abort())
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#app")).to_have_attribute("data-app-version", (ROOT / "VERSION").read_text().strip())
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    page.wait_for_function("""() => Array.from(document.querySelectorAll('.leaflet-tile-container canvas'))
        .some(canvas => canvas.width >= 256 && canvas.height >= 256)""")
    if page.locator("#locationIntroDismiss").is_visible():
        page.locator("#locationIntroDismiss").click()
    assert page.evaluate("window.designGeo.requests + window.designGeo.watches") == 0, "First run prompted for location"
    return context, page, errors, searches


def warbler_route(page):
    page.locator("#homeSearch").fill("Warbler on the Wharf")
    page.locator(".typeahead-item").filter(has=page.locator("strong", has_text=re.compile(r"^Warbler on the Wharf(?:,|$)"))).first.click()
    page.locator("#directionsBtn").click()
    page.locator("#startSearch").fill("52.025,-0.783")
    page.locator("#startSearch").press("Enter")
    page.get_by_role("button", name="Map coordinates", exact=False).click()
    expect(page.locator("#routeStatus")).to_have_text("Route ready")


def expand_route(page):
    if page.locator("#routeSheetHandle").get_attribute("aria-expanded") == "false":
        page.locator("#routeSheetHandle").click()
    expect(page.locator("#routeSheetHandle")).to_have_attribute("aria-expanded", "true")


def review_viewport(browser, url, width, height, theme):
    context, page, errors, searches = new_page(browser, url, width, height, theme, saved_fixture())
    tag = f"{width}x{height}-{theme}"
    try:
        page.locator("#savedPlacesBtn").click()
        expect(page.locator(".saved-favourite-row")).to_have_count(10)
        hit(page, "#closeSaved")
        saved_credit = attribution(page)
        screenshot(page, tag + "-saved")
        page.locator("#closeSaved").click()
        page.locator("#exploreRoutesBtn").click()
        expect(page.locator(".cultural-route-card")).to_have_count(5)
        hit(page, "#closeExplore")
        explore_credit = attribution(page)
        card = page.locator(".route-blue")
        full = card.get_by_role("button", name="Full route", exact=True)
        short = card.get_by_role("button", name="Shortcut track", exact=True)
        assert full.evaluate("el => getComputedStyle(el).backgroundColor") != short.evaluate("el => getComputedStyle(el).backgroundColor"), "Full route has no visual priority"
        description = short.get_attribute("aria-describedby")
        expect(page.locator("#" + description)).to_contain_text("segment, not the complete shorter loop")
        assert page.locator("#" + description).evaluate("el => parseFloat(getComputedStyle(el).fontSize)") >= 13, "Shortcut helper text is too small"
        screenshot(page, tag + "-explore")
        page.locator("#exploreSheet").evaluate("el => el.scrollTop = el.scrollHeight")
        hit(page, "#closeExplore")
        attribution(page)
        page.locator("#closeExplore").click()

        warbler_route(page)
        action = "#startNavBtn" if width < 900 else "#sendToPhoneBtn"
        expect(page.locator(action)).to_be_enabled()
        # This mapped destination has a real approach gap: the summary warning
        # must survive both collapse and scrolling through condition statistics.
        expect(page.locator("#routeApproachSummary")).to_be_visible()
        expect(page.locator("#routeApproachSummary")).to_contain_text(re.compile(r"approach|mapped", re.I))
        hit(page, action)
        expand_route(page)
        hit(page, action)
        details = page.locator("#routeDetails")
        scrollable = details.evaluate("el => el.scrollHeight > el.clientHeight")
        if width < 900:
            assert scrollable, "Small-screen route details do not scroll"
        if scrollable:
            details.evaluate("el => el.scrollTop = el.scrollHeight")
            page.wait_for_function("() => document.querySelector('#routeDetails').scrollTop > 0")
            hit(page, action)
        for index in range(page.locator(".route-option").count()):
            page.locator(".route-option").nth(index).click()
            expect(page.locator(action)).to_be_enabled()
            hit(page, action)
        screenshot(page, tag + "-route-details")

        navigation_credit = None
        if width < 900:
            for selector in ["#preferLitBtn", "#preferSuperBtn"]:
                expand_route(page)
                page.locator(selector).click()
                expect(page.locator("#routeStatus")).to_have_text("Route ready")
            context.grant_permissions(["geolocation"])
            page.locator("#startNavBtn").click()
            expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
            expect(page.locator("#turnText")).to_have_text("Join the mapped route using an accessible approach")
            navigation_credit = attribution(page)
            hit(page, "#exitNavBtn")
            screenshot(page, tag + "-long-instruction")
            page.locator("#exitNavBtn").click()
        if width == 390:
            page.locator("#plannerBack").click()
            page.locator("#exploreRoutesBtn").click()
            page.locator(".route-blue").get_by_role("button", name="Full route", exact=True).click()
            expect(page.locator("#routeStatus")).to_have_text("Route to Cultural Route start / join · then Blue track")
            if page.locator("#routeSheetHandle").get_attribute("aria-expanded") == "true":
                page.locator("#routeSheetHandle").click()
            expect(page.locator("#routeTrackStatus")).to_have_text("Track conditions unverified")
            expect(page.locator("#culturalRouteLegend")).to_contain_text("Red: start / join")
            expect(page.locator("#culturalRouteLegend")).to_contain_text("Blue: official GPX track")
            hit(page, "#routeTrackStatus")
            hit(page, "#culturalRouteLegend")
            hit(page, "#startNavBtn")
            screenshot(page, tag + "-compact-cultural-summary")
        assert not searches, (tag, "Local planning/Explore/Saved sent a geocoder request", searches)
        assert not errors, errors
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), tag + " overflows horizontally"
        navigation_result = "multiline navigation" if width < 900 else "desktop handoff"
        print(f"PASS design {tag}: Saved/Explore credits, scroll-safe route actions, approach warning, {navigation_result}", flush=True)
        return {"viewport": [width, height], "theme": theme, "saved": saved_credit,
                "explore": explore_credit, "navigation": navigation_credit}
    finally:
        context.close()


def exposed_map_point(page):
    return page.evaluate("""() => {
        const map = document.querySelector('#map');
        for (const y of [.55, .4, .7, .3]) for (const x of [.45, .65, .3]) {
            const point = {x:innerWidth*x, y:innerHeight*y};
            if (map.contains(document.elementFromPoint(point.x,point.y))) return point;
        }
        throw new Error('No exposed map point for a native pin choice');
    }""")


def read_saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('mk-redway-saved-v1'))")


def review_friendly_actions(browser, url):
    context, page, errors, searches = new_page(browser, url, 390, 844)
    try:
        page.locator("#savedPlacesBtn").click()
        expect(page.locator("#favouritesList")).to_contain_text(re.compile(r"Keep your .* handy"))
        expect(page.locator("#favouritesList")).to_contain_text("map pin")
        page.locator("#addFavouriteBtn").click()
        page.locator("#savedFavouriteNameInput").fill("Canal picnic spot")
        page.locator("#pickSavedOnMapBtn").click()
        page.locator("#map").click(position=exposed_map_point(page))
        expect(page.locator("#savedSheet")).to_be_visible()
        first = read_saved(page)["favourites"][0]
        assert first["name"] == "Canal picnic spot", first
        page.locator(".saved-rename").first.click()
        page.locator("#favouriteNameInput").fill("Our picnic place")
        page.locator("#favouriteNameSaveBtn").click()
        renamed = read_saved(page)["favourites"][0]
        assert renamed["name"] == "Our picnic place"
        assert (renamed["lat"], renamed["lng"], renamed["id"]) == (first["lat"], first["lng"], first["id"])
        page.locator(".saved-remove").first.click()
        assert read_saved(page)["favourites"] == []
        hit(page, "#undoFavouriteBtn")
        screenshot(page, "friendly-favourite-undo")
        page.locator("#undoFavouriteBtn").click()
        assert read_saved(page)["favourites"] == [renamed]
        expect(page.locator("#savedUndoNotice")).to_be_hidden()
        page.locator("#closeSaved").click()
        expect(page.locator(".quick-favourite")).to_contain_text("Our picnic place")
        assert not searches, "Pin naming, renaming or Undo sent a geocoder request"
        assert page.evaluate("window.designGeo.requests + window.designGeo.watches") == 0

        page.locator("#homeSearch").fill("zzqv design unmatched destination")
        assert not searches, "Typing triggered a provider search"
        page.locator("#homeSearch").press("Enter")
        expect(page.locator("#resultsList")).to_contain_text("We couldn’t find that in the MK map area")
        postcode = page.get_by_role("button", name="Try a postcode", exact=True)
        postcode.click()
        expect(page.locator("#homeSearch")).to_be_focused()
        page.locator("#homeSearch").press("Enter")
        page.get_by_role("button", name="Choose on map", exact=True).click()
        page.locator("#map").click(position=exposed_map_point(page))
        expect(page.locator("#placeSheet")).to_be_visible()
        expect(page.locator("#placeName")).to_have_text("Dropped pin")
        assert len(searches) == 2 and all("/search?" in request for request in searches), searches
        assert page.evaluate("window.designGeo.requests + window.designGeo.watches") == 0, "Search recovery requested location"
        screenshot(page, "friendly-search-map-recovery")

        page.locator("#visibleSettingsBtn").click()
        for heading in ["Journey", "Appearance", "Offline & app"]:
            expect(page.get_by_role("heading", name=heading, exact=True)).to_have_count(1)
        page.locator("#voiceSettingBtn").click()
        expect(page.locator("#voiceSettingBtn")).to_have_attribute("aria-checked", "true")
        page.locator("#voiceSettingBtn").click()
        for theme in ["light", "dark", "system", "high-contrast"]:
            page.locator(f'[data-theme-choice="{theme}"]').click()
            expected = "light" if theme == "system" else theme
            expect(page.locator("html")).to_have_attribute("data-theme", expected)
        screenshot(page, "friendly-grouped-settings")
        page.locator("#closeSettings").click()
        assert not errors, errors
        print("PASS friendly actions: local named pins, rename/Undo, useful empty/search recovery, grouped settings and all themes", flush=True)
    finally:
        context.close()


def review_arrival(browser, url):
    context, page, errors, searches = new_page(browser, url, 390, 844, "dark")
    try:
        points = [(52.025 + index * .0002, -.783 + index * .0003) for index in range(11)]
        track = ''.join(f'<trkpt lat="{lat}" lon="{lng}"/>' for lat, lng in points)
        xml = f'<gpx version="1.1"><trk><name>Picnic &amp; canal</name><trkseg>{track}</trkseg></trk></gpx>'
        page.locator("#gpxFileInput").set_input_files({"name": "arrival.gpx", "mimeType": "application/gpx+xml", "buffer": xml.encode()})
        expect(page.locator("#routeStatus")).to_have_text("Imported GPX · unverified track")
        context.grant_permissions(["geolocation"])
        page.locator("#startNavBtn").click()
        expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
        expect(page.locator("#arrivalSummary")).to_be_hidden()
        for lat, lng in points[1:]:
            before = page.evaluate("window.designGeo.fixes.length")
            context.set_geolocation({"latitude": lat, "longitude": lng, "accuracy": 5})
            page.wait_for_function("""args => window.designGeo.fixes.slice(args.before).some(fix =>
                Math.abs(fix.lat-args.lat) < .000001 && Math.abs(fix.lng-args.lng) < .000001)""",
                arg={"before": before, "lat": lat, "lng": lng})
        expect(page.locator("#arrivalSummary")).to_be_visible()
        expect(page.locator("#arrivalDestination")).to_contain_text("Picnic & canal")
        expect(page.locator("#navBanner")).to_be_hidden()
        hit(page, "#arrivalDoneBtn")
        page.wait_for_timeout(4500)  # It must outlast the previous brief arrival toast.
        expect(page.locator("#arrivalSummary")).to_be_visible()
        hit(page, "#arrivalDoneBtn")
        screenshot(page, "friendly-persistent-arrival")
        page.locator("#arrivalDoneBtn").click()
        expect(page.locator("#arrivalSummary")).to_be_hidden()
        expect(page.locator("#app")).to_have_attribute("data-stage", "explore")
        expect(page.locator("#exploreUI")).to_be_visible()
        hit(page, "#homeSearchSubmit")
        expect(page.locator("#endSearch")).to_have_value("Picnic & canal finish")
        expect(page.locator(".route-line")).to_have_count(1)
        assert not searches, searches
        assert not errors, errors
        print("PASS arrival: real browser GPS follows imported geometry, named summary persists until Done", flush=True)
    finally:
        context.close()


def main():
    server = None
    url = os.environ.get("LIVE_URL")
    if not url:
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RangeHandler, directory=str(ROOT / "dist")))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/"
    evidence = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"))
            try:
                for width, height, theme in [(320, 568, "light"), (390, 844, "dark"),
                                             (844, 390, "system"), (1280, 900, "high-contrast")]:
                    evidence.append(review_viewport(browser, url, width, height, theme))
                review_friendly_actions(browser, url)
                review_arrival(browser, url)
            finally:
                browser.close()
    finally:
        CAPTURES.mkdir(parents=True, exist_ok=True)
        (CAPTURES / "native-attribution-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        if server:
            server.shutdown()
    print("PASS design/friendliness gate: " + url, flush=True)


if __name__ == "__main__":
    main()
