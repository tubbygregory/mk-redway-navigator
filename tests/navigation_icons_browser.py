"""Rendered navigation-icon gate for the built artifact and deployed release.

Real browser geolocation is opt-in and measured. Artwork is inspected as rendered,
including native touch targets; the local PWA cases exercise root and subpath
service-worker scopes. iPhone/standalone emulation does not prove Safari behaviour.
"""
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from design_polish_browser import GPS, IOS, RangeHandler, hit


ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "test-results" / "navigation-icons"
KINDS = ("dot", "arrow", "cyclist", "cow")


class RuntimeHandler(RangeHandler):
    """Expose the same runtime at a project subpath without altering its assets."""

    def translate_path(self, path):
        if urlsplit(path).path.startswith("/navigator/"):
            path = "/" + path.split("/navigator/", 1)[1]
        return super().translate_path(path)


def capture(page, name):
    CAPTURES.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(CAPTURES / f"{name}.png"))


def new_context(browser, width=390, height=844, theme="light", *, offline=False,
                initial_icon=None, blocked_storage=False):
    mobile = width < 900
    context = browser.new_context(
        viewport={"width": width, "height": height},
        service_workers="allow" if offline else "block",
        is_mobile=mobile, has_touch=mobile,
        user_agent=IOS if mobile else None,
        color_scheme="dark" if theme == "system" else "light",
        geolocation=GPS,
    )
    settings = {"themeChoice": theme, "voiceEnabled": False}
    if initial_icon is not None:
        settings["navigationIcon"] = initial_icon
    # Seed once per tab: subsequent reloads must read the user's persisted choice.
    seed = """(() => {
        if (!sessionStorage.getItem('navigation-icon-fixture')) {
            localStorage.setItem('mk-redway-settings-v1', SETTINGS);
            sessionStorage.setItem('navigation-icon-fixture', '1');
        }
    })();""".replace("SETTINGS", json.dumps(json.dumps(settings)))
    if blocked_storage:
        # A single script guarantees seed-before-block ordering; ordering of
        # separate Playwright init scripts is intentionally unspecified.
        seed += """(() => {
            const write = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (this === localStorage && key === 'mk-redway-settings-v1')
                    throw new DOMException('Storage blocked by browser', 'SecurityError');
                return write.call(this, key, value);
            };
        })();"""
    context.add_init_script(seed)
    context.add_init_script("""(() => {
        window.iconGeoRequests = 0;
        window.iconGeoFixes = [];
        for (const name of ['getCurrentPosition', 'watchPosition']) {
            const original = navigator.geolocation[name].bind(navigator.geolocation);
            navigator.geolocation[name] = (success, ...args) => {
                window.iconGeoRequests++;
                return original(position => {
                    const c = position.coords;
                    window.iconGeoFixes.push({lat:c.latitude, lng:c.longitude,
                        accuracy:c.accuracy, heading:c.heading, speed:c.speed});
                    success(position);
                }, ...args);
            };
        }
    })();""")
    if mobile:
        context.add_init_script("Object.defineProperty(navigator, 'standalone', {value:true, configurable:true});")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors, providers, requests = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    page.on("request", lambda request: providers.append(request.url)
            if "nominatim.openstreetmap.org" in request.url else None)
    page.route("**/nominatim.openstreetmap.org/**", lambda route: route.fulfill(json=[]))
    page.route("**/api/interpreter", lambda route: route.abort())
    return context, page, errors, providers, requests


def load(page, url):
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#app")).to_have_attribute("data-app-version", (ROOT / "VERSION").read_text().strip())
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    if page.locator("#locationIntroDismiss").is_visible():
        page.locator("#locationIntroDismiss").click()


def open_choices(page):
    page.locator("#visibleSettingsBtn").click()
    group = page.locator("#navigationIconChoice")
    expect(group).to_have_attribute("role", "group")
    expect(group).to_have_accessible_name("Your map icon")
    expect(group.locator("button[data-navigation-icon-choice]")).to_have_count(4)
    return group


def choose(page, kind):
    selector = f'#navigationIconChoice button[data-navigation-icon-choice="{kind}"]'
    button = page.locator(selector)
    button.scroll_into_view_if_needed()
    hit(page, selector)
    dimensions = button.bounding_box()
    assert dimensions["width"] >= 44 and dimensions["height"] >= 44, (kind, dimensions)
    button.click()
    for other in KINDS:
        expect(page.locator(f'#navigationIconChoice button[data-navigation-icon-choice="{other}"]')).to_have_attribute(
            "aria-pressed", "true" if other == kind else "false")
    expect(page.locator("#navigationIconStatus")).to_contain_text("selected")
    return dimensions


def assert_artwork(page, selector):
    artwork = page.locator(selector)
    expect(artwork.locator("svg")).to_have_count(1)
    colours = artwork.evaluate("""element => {
        const red = document.createElement('span');
        red.style.color = 'var(--red)';
        element.appendChild(red);
        const appRed = getComputedStyle(red).color;
        red.remove();
        const colours = new Set();
        for (const node of element.querySelectorAll('svg, svg *')) {
            const style = getComputedStyle(node);
            colours.add(style.fill); colours.add(style.stroke);
        }
        return {appRed, colours:[...colours]};
    }""")
    assert colours["appRed"] in colours["colours"], (selector, "Missing app red", colours)
    assert "rgb(255, 255, 255)" in colours["colours"], (selector, "Missing white detail/outline", colours)
    assert artwork.locator("svg").evaluate("el => el.getBoundingClientRect().width >= 18"), selector
    return colours


def assert_marker(page, kind):
    marker = page.locator(f'.user-location-icon[data-navigation-icon="{kind}"]')
    expect(marker).to_be_visible()
    expect(page.locator(".user-location-icon")).to_have_count(1)
    if kind == "dot":
        expect(marker).to_have_class(re.compile(r"\buser-pulse\b"))
    else:
        assert_artwork(page, f'.user-location-icon[data-navigation-icon="{kind}"] .user-location-artwork')


def review_viewport(browser, url, width, height, theme):
    context, page, errors, providers, requests = new_context(browser, width, height, theme)
    tag = f"{width}x{height}-{theme}"
    evidence = {"viewport": [width, height], "theme": theme, "targets": {}}
    try:
        load(page, url)
        assert page.evaluate("window.iconGeoRequests") == 0, "First run requested GPS"
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="dot"][aria-pressed="true"]')).to_have_count(1)
        before_requests = len(requests)
        for kind in KINDS:
            evidence["targets"][kind] = choose(page, kind)
            evidence["targets"][kind]["artwork"] = assert_artwork(
                page, f'#navigationIconChoice [data-navigation-icon-choice="{kind}"] .navigation-icon-preview')
            expect(page.locator("#navigationIconStatus")).to_contain_text("Saved on this device")
        assert page.evaluate("window.iconGeoRequests") == 0, "Choosing an icon requested GPS"
        assert len(requests) == before_requests, ("Choosing an icon made a network request", requests[before_requests:])
        assert page.evaluate("JSON.parse(localStorage.getItem('mk-redway-settings-v1')).navigationIcon") == "cow"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Settings overflow"
        capture(page, tag + "-settings")
        page.reload(wait_until="networkidle")
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="cow"][aria-pressed="true"]')).to_have_count(1)
        page.locator("#closeSettings").click()
        context.grant_permissions(["geolocation"])
        page.get_by_role("button", name="Show my location", exact=True).click()
        assert_marker(page, "cow")
        # Existing markers must immediately reflect a change, not wait for the
        # next GPS fix or require a fresh navigation session.
        for kind in KINDS:
            open_choices(page)
            gps_before = page.evaluate("window.iconGeoRequests")
            choose(page, kind)
            assert page.evaluate("window.iconGeoRequests") == gps_before, "Changing an existing marker requested GPS"
            page.locator("#closeSettings").click()
            assert_marker(page, kind)
        if width == 390:
            # Navigation uses the same selected artwork, with real measured GPS.
            track = ''.join(f'<trkpt lat="{52.025+i*.0002}" lon="{-0.783+i*.0003}"/>' for i in range(11))
            xml = f'<gpx version="1.1"><trk><name>Icon check</name><trkseg>{track}</trkseg></trk></gpx>'
            page.locator("#gpxFileInput").set_input_files({"name": "icon.gpx", "mimeType": "application/gpx+xml", "buffer": xml.encode()})
            page.locator("#startNavBtn").click()
            expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
            assert_marker(page, "cow")
            capture(page, tag + "-cow-navigation")
            page.locator("#exitNavBtn").click()
        else:
            capture(page, tag + "-cow-map")
        assert not errors, errors
        assert not providers, providers
        print(f"PASS icons {tag}: four native targets/previews, opt-in GPS, persisted choice and live marker changes", flush=True)
        return evidence
    finally:
        context.close()


def review_storage(browser, url):
    for blocked in (False, True):
        context, page, errors, providers, _requests = new_context(
            browser, initial_icon="not-a-real-icon", blocked_storage=blocked)
        try:
            load(page, url)
            open_choices(page)
            expect(page.locator('[data-navigation-icon-choice="dot"][aria-pressed="true"]')).to_have_count(1)
            choose(page, "arrow")
            expect(page.locator("#navigationIconStatus")).to_contain_text(
                "for this visit" if blocked else "Saved on this device")
            if blocked:
                expect(page.locator("#navigationIconStatus")).to_contain_text("could not save")
            assert page.evaluate("window.iconGeoRequests") == 0
            page.locator("#closeSettings").click()
            context.grant_permissions(["geolocation"])
            page.get_by_role("button", name="Show my location", exact=True).click()
            assert_marker(page, "arrow")
            assert not errors, errors
            assert not providers, providers
        finally:
            context.close()
    print("PASS icon storage: invalid value falls back; blocked writes keep session choice and explain persistence failure", flush=True)


def arrow_angles(page):
    """Read rendered transforms, without access to private application state."""
    return page.evaluate("""() => {
        const angle = element => {
            const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
            return (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
        };
        const screen = angle(document.querySelector('.user-location-artwork'));
        const map = angle(document.querySelector('.leaflet-rotate-pane'));
        return {screen, map, course:(screen-map+360)%360};
    }""")


def review_arrow_course(browser, url):
    context, page, errors, providers, _requests = new_context(browser, theme="dark")
    cdp = context.new_cdp_session(page)
    try:
        load(page, url)
        open_choices(page)
        choose(page, "arrow")
        page.locator("#closeSettings").click()
        context.grant_permissions(["geolocation"])
        cdp.send("Emulation.setGeolocationOverride", {**GPS, "heading": 90, "speed": 3})
        # An eastbound track establishes a known heading-up camera, while the
        # arrow must still wait for measured travel rather than the route bearing.
        track = ''.join(f'<trkpt lat="52.025" lon="{-0.783+i*.0004}"/>' for i in range(16))
        xml = f'<gpx version="1.1"><trk><name>Eastbound icon check</name><trkseg>{track}</trkseg></trk></gpx>'
        page.locator("#gpxFileInput").set_input_files({"name": "eastbound.gpx", "mimeType": "application/gpx+xml", "buffer": xml.encode()})
        page.locator("#startNavBtn").click()
        expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
        expect(page.locator('.user-location-artwork[data-heading-known="true"]')).to_be_visible()
        page.wait_for_function("""() => {
            const el = document.querySelector('.user-location-artwork');
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            return Math.abs(Math.atan2(m.b,m.a)*180/Math.PI) < 2;
        }""")
        moving = arrow_angles(page)
        assert abs(moving["course"] - 90) < 2, moving
        capture(page, "arrow-heading-up")

        def fix(latitude, longitude, accuracy, heading, speed):
            before = page.evaluate("window.iconGeoFixes.length")
            cdp.send("Emulation.setGeolocationOverride", {
                "latitude": latitude, "longitude": longitude, "accuracy": accuracy,
                "heading": heading, "speed": speed})
            page.wait_for_function("""args => window.iconGeoFixes.slice(args.before).some(fix =>
                Math.abs(fix.lat-args.latitude)<.000001 &&
                Math.abs(fix.lng-args.longitude)<.000001 &&
                fix.accuracy===args.accuracy && fix.heading===args.heading && fix.speed===args.speed)""",
                arg={"before": before, "latitude": latitude, "longitude": longitude,
                     "accuracy": accuracy, "heading": heading, "speed": speed})

        fix(52.025, -.783, 5, 180, 0)
        stationary = arrow_angles(page)
        assert abs(stationary["course"] - moving["course"]) < 2, (moving, stationary)
        fix(52.025, -.7828, 150, 180, 3)
        expect(page.locator("#turnText")).to_have_text("Waiting for an accurate location")
        poor = arrow_angles(page)
        assert abs(poor["course"] - moving["course"]) < 2, (moving, poor)
        fix(52.02508, -.7826, 5, 0, 3)
        recovered = arrow_angles(page)
        assert 0 < recovered["course"] < 80, recovered
        assert abs(recovered["course"] - moving["course"]) > 5, (moving, recovered)
        expect(page.locator("#turnText")).not_to_have_text("Waiting for an accurate location")
        page.locator("#exitNavBtn").click()
        expect(page.locator('.user-location-artwork[data-heading-known="false"]')).to_be_visible()
        stopped = arrow_angles(page)
        assert min(stopped["screen"], 360-stopped["screen"]) < .1, stopped
        before = page.evaluate("window.iconGeoFixes.length")
        cdp.send("Emulation.setGeolocationOverride", {**GPS, "heading": 270, "speed": 3})
        page.wait_for_timeout(150)  # A stopped navigation watch must not consume a new fix.
        assert page.evaluate("window.iconGeoFixes.length") == before, "Exit left a GPS watch running"
        assert not errors, errors
        assert not providers, providers
        print("PASS arrow course: real CDP GPS, heading-up compensation, stationary/poor-GPS hold, recovery and neutral stopped marker", flush=True)
    finally:
        cdp.detach()
        context.close()


def review_offline(browser, url, label):
    context, page, errors, providers, _requests = new_context(browser, offline=True)
    try:
        load(page, url)
        page.evaluate("""async () => {
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) await new Promise(resolve =>
                navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
        }""")
        open_choices(page)
        choose(page, "cow")
        page.locator("#offlineDownloadBtn").click()
        expect(page.locator("#offlineStatus")).to_contain_text("available offline", timeout=120000)
        context.set_offline(True)
        page.reload(wait_until="networkidle")
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="cow"][aria-pressed="true"]')).to_have_count(1)
        choose(page, "cyclist")
        page.reload(wait_until="networkidle")
        open_choices(page)
        expect(page.locator('[data-navigation-icon-choice="cyclist"][aria-pressed="true"]')).to_have_count(1)
        assert page.evaluate("window.iconGeoRequests") == 0
        page.locator("#closeSettings").click()
        context.grant_permissions(["geolocation"])
        page.get_by_role("button", name="Show my location", exact=True).click()
        assert_marker(page, "cyclist")
        capture(page, label + "-offline-cyclist")
        assert not errors, errors
        assert not providers, providers
        print(f"PASS icons {label}: actual offline shell, selection changes/persistence and GPS marker", flush=True)
    finally:
        context.close()


def main():
    server = None
    url = os.environ.get("LIVE_URL")
    if not url:
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RuntimeHandler, directory=str(ROOT / "dist")))
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
                review_storage(browser, url)
                review_arrow_course(browser, url)
                review_offline(browser, url, "root")
                if server:
                    review_offline(browser, url + "navigator/", "subpath")
            finally:
                browser.close()
    finally:
        CAPTURES.mkdir(parents=True, exist_ok=True)
        (CAPTURES / "native-icon-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        if server:
            server.shutdown()
    print("PASS navigation icon gate: " + url, flush=True)


if __name__ == "__main__":
    main()
