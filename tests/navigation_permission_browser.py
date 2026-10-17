"""Real Chromium geolocation revocation/restart gate for the built artifact.

Run after scripts/build_site.py. Uses browser geolocation and CDP permission
changes; navigator.geolocation and application functions are never replaced.
CHROMIUM_EXECUTABLE optionally selects a local Chromium binary. This checks
Chromium permission delivery, not physical phone/background behaviour.
"""
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from design_polish_browser import GPS, RangeHandler, hit


ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "test-results" / "navigation-permission"


def review_permission(browser, url):
    context = browser.new_context(viewport={"width": 390, "height": 844},
                                  geolocation=GPS, permissions=["geolocation"],
                                  service_workers="block", is_mobile=True, has_touch=True)
    context.add_init_script("localStorage.setItem('mk-redway-settings-v1', JSON.stringify({voiceEnabled:false, preferLit:true}));")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/nominatim.openstreetmap.org/**", lambda route: route.fulfill(json=[]))
    page.route("**/api/interpreter", lambda route: route.abort())
    cdp = context.new_cdp_session(page)
    try:
        page.goto(url, wait_until="networkidle")
        expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
        if page.locator("#locationIntroDismiss").is_visible():
            page.locator("#locationIntroDismiss").click()
        track = ''.join(f'<trkpt lat="52.025" lon="{-0.783+i*.0004}"/>' for i in range(16))
        xml = f'<gpx version="1.1"><trk><name>Permission recovery</name><trkseg>{track}</trkseg></trk></gpx>'
        page.locator("#gpxFileInput").set_input_files({"name": "permission.gpx",
            "mimeType": "application/gpx+xml", "buffer": xml.encode()})
        expect(page.locator("#app")).to_have_attribute("data-stage", "planner")
        summary = {name: page.locator(f"#{name}").inner_text()
                   for name in ("timeStat", "distanceStat", "routeTrackStatus")}
        settings = page.evaluate("localStorage.getItem('mk-redway-settings-v1')")
        page.locator("#startNavBtn").click()
        expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
        expect(page.locator(".user-location-icon")).to_be_visible()

        target = cdp.send("Target.getTargetInfo")["targetInfo"]
        origin = "{0.scheme}://{0.netloc}".format(urlsplit(url))

        def permission(setting):
            cdp.send("Browser.setPermission", {"permission": {"name": "geolocation"},
                "setting": setting, "origin": origin, "browserContextId": target["browserContextId"]})

        permission("denied")
        expect(page.locator("#app")).to_have_attribute("data-stage", "planner")
        expect(page.locator("#navBanner")).to_be_hidden()
        warning = page.locator("#routeStatus")
        expect(warning).to_be_visible()
        expect(warning).to_contain_text("Location access is off")
        expect(warning).to_contain_text("settings, then tap Start")
        assert "is-ready-preview" not in (warning.get_attribute("class") or "")
        hit(page, "#routeStatus")
        expect(page.locator("#startNavBtn")).to_be_enabled()
        assert {name: page.locator(f"#{name}").inner_text() for name in summary} == summary
        assert page.evaluate("localStorage.getItem('mk-redway-settings-v1')") == settings
        assert page.evaluate("(async () => (await navigator.permissions.query({name:'geolocation'})).state)()") == "denied"
        # A subsequent rendering turn cannot hide the persistent warning.
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        expect(warning).to_be_visible()
        CAPTURES.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(CAPTURES / "revoked-location.png"))
        evidence = {"revoked_stage": "planner", "retained_summary": summary,
                    "warning": warning.inner_text(), "warning_rect": warning.bounding_box(),
                    "permission": "denied"}

        permission("granted")
        expect(page.locator("#app")).to_have_attribute("data-stage", "planner")
        page.locator("#startNavBtn").click()
        expect(page.locator("#app")).to_have_attribute("data-stage", "navigation")
        expect(page.locator(".user-location-icon")).to_be_visible()
        assert {name: page.locator(f"#{name}").inner_text() for name in summary} == summary
        assert page.evaluate("localStorage.getItem('mk-redway-settings-v1')") == settings
        evidence["explicit_restart_stage"] = "navigation"
        page.locator("#exitNavBtn").click()
        expect(page.locator("#app")).to_have_attribute("data-stage", "planner")
        expect(warning).to_be_visible()
        expect(warning).to_have_text("Location access restored.")
        assert "access is off" not in warning.inner_text()
        evidence["exit_after_recovery_status"] = warning.inner_text()
        assert not errors, errors
        return evidence
    except Exception:
        CAPTURES.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(CAPTURES / "failure.png"))
        raise
    finally:
        cdp.detach()
        context.close()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RangeHandler, directory=str(ROOT / "dist")))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"))
            try:
                evidence = review_permission(browser, f"http://127.0.0.1:{server.server_port}/")
            finally:
                browser.close()
        CAPTURES.mkdir(parents=True, exist_ok=True)
        (CAPTURES / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    finally:
        server.shutdown()
    print("PASS actual Chromium GPS permission revocation: visible warning, retained route/settings and explicit restart", flush=True)


if __name__ == "__main__":
    main()
