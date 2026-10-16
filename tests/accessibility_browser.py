"""Keyboard, enlarged-text/reflow and reduced-motion release gate.

Journeys use native keyboard input, never forced clicks or application state hooks.
Text is genuinely enlarged in layout (including fixed-pixel UI text), not stretched
with a transform. Browser/standalone emulation does not verify physical Safari.
"""
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright

from design_polish_browser import GPS, RangeHandler, attribution, hit, saved_fixture


ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "test-results" / "accessibility"
EVIDENCE = []


def capture(page, name):
    CAPTURES.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(CAPTURES / f"{name}.png"))


def new_page(browser, url, width=1280, height=900, theme="light", motion="no-preference"):
    context = browser.new_context(viewport={"width": width, "height": height},
                                  service_workers="block", geolocation=GPS,
                                  reduced_motion=motion)
    context.add_init_script("localStorage.setItem('mk-redway-settings-v1', " +
                            json.dumps(json.dumps({"themeChoice": theme, "voiceEnabled": False})) + ");")
    context.add_init_script("localStorage.setItem('mk-redway-saved-v1', " +
                            json.dumps(json.dumps(saved_fixture())) + ");")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors, providers = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: providers.append(request.url)
            if "nominatim.openstreetmap.org" in request.url else None)
    page.route("**/nominatim.openstreetmap.org/**", lambda route: route.fulfill(json=[]))
    page.route("**/api/interpreter", lambda route: route.abort())
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#app")).to_have_attribute("data-app-version", (ROOT / "VERSION").read_text().strip())
    expect(page.locator("html")).to_have_attribute("data-routing-source", "bundled")
    return context, page, errors, providers


def focus_evidence(page, label):
    """Tab must expose an outlined, usable target; inspect without auto-scroll."""
    # The browser's focus scroll and observed panel/credit resize settle on a
    # rendering frame. This waits for native layout; it never scrolls the page.
    try:
        page.wait_for_function("""() => {
            const el = document.activeElement, r = el.getBoundingClientRect();
            return r.left>=0 && r.top>=0 && r.right<=innerWidth+.5 && r.bottom<=innerHeight+.5 &&
                el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }""", timeout=1500)
    except PlaywrightTimeoutError:
        capture(page, "keyboard-focus-failure")
    detail = page.evaluate("""() => {
        const el = document.activeElement, r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return {id:el.id, text:el.textContent.trim().slice(0,100), rect:r.toJSON(),
            visible:el.matches(':focus-visible'), outline:s.outlineStyle,
            outlineWidth:parseFloat(s.outlineWidth), inViewport:r.left>=0 && r.top>=0 &&
                r.right<=innerWidth+.5 && r.bottom<=innerHeight+.5,
            nativeHit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    }""")
    assert detail["visible"] and detail["outline"] != "none" and detail["outlineWidth"] >= 2, (label, "No visible keyboard focus", detail)
    assert detail["inViewport"] and detail["nativeHit"], (label, "Keyboard focus is covered or clipped", detail)
    EVIDENCE.append({"action": label, **detail})


def tab_to(page, selector, reverse=False):
    """Traverse the real tab order; non-modal sheets do not imply a focus trap."""
    for _ in range(110):
        if page.evaluate("selector => document.activeElement.matches(selector)", selector):
            focus_evidence(page, selector)
            return
        page.keyboard.press("Shift+Tab" if reverse else "Tab")
    active = page.evaluate("document.activeElement.outerHTML")
    raise AssertionError(("Cannot reach control by keyboard", selector, active))


def activate(page, selector, key="Enter", reverse=False):
    tab_to(page, selector, reverse)
    page.keyboard.press(key)


def type_text(page, selector, value):
    tab_to(page, selector)
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.insert_text(value)


def dismiss_intro(page):
    if page.locator("#locationIntroDismiss").is_visible():
        activate(page, "#locationIntroDismiss")


def plan_route(page):
    type_text(page, "#homeSearch", "Warbler on the Wharf")
    expect(page.locator(".typeahead-item").first).to_contain_text("Warbler on the Wharf")
    activate(page, ".typeahead-item")
    expect(page.locator("#placeName")).to_contain_text("Warbler on the Wharf")
    activate(page, "#directionsBtn")
    type_text(page, "#startSearch", "52.025,-0.783")
    page.keyboard.press("Enter")
    expect(page.locator("#resultsList .result-item")).to_have_count(1)
    activate(page, "#resultsList .result-item")
    expect(page.locator("#routeStatus")).to_have_text("Route ready")


def keyboard_journey(browser, url):
    context, page, errors, providers = new_page(browser, url)
    try:
        dismiss_intro(page)
        plan_route(page)
        activate(page, "#preferLitBtn", "Space")
        expect(page.locator("#preferLitBtn")).to_have_attribute("aria-checked", "true")
        expect(page.locator("#routeStatus")).to_have_text("Route ready")
        activate(page, ".route-option:last-child", "Space")
        expect(page.locator(".route-option:last-child")).to_have_class("route-option selected")
        activate(page, "#routeMoreBtn")
        expect(page.locator("#routeMoreMenu")).to_be_visible()
        tab_to(page, "#exportGpxBtn", reverse=True)
        capture(page, "keyboard-route-options")
        activate(page, "#routeMoreBtn")
        activate(page, "#plannerBack")

        activate(page, "#savedPlacesBtn")
        activate(page, ".saved-rename")
        expect(page.locator("#favouriteNameInput")).to_be_focused()
        focus_evidence(page, "Opened favourite editor")
        page.keyboard.press("Escape")
        expect(page.locator(".saved-rename").first).to_be_focused()
        activate(page, ".saved-rename", "Space")
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.insert_text("Canal picnic place")
        page.keyboard.press("Enter")
        expect(page.locator("#favouritesList")).to_contain_text("Canal picnic place")
        activate(page, ".saved-remove", "Space")
        expect(page.locator("#undoFavouriteBtn")).to_be_focused()
        focus_evidence(page, "Undo favourite removal")
        page.keyboard.press("Enter")
        expect(page.locator("#favouritesList")).to_contain_text("Canal picnic place")
        capture(page, "keyboard-saved-undo")
        activate(page, "#closeSaved", reverse=True)

        activate(page, "#visibleSettingsBtn")
        activate(page, '[data-navigation-icon-choice="cow"]', "Space")
        expect(page.locator('[data-navigation-icon-choice="cow"]')).to_have_attribute("aria-pressed", "true")
        activate(page, '[data-theme-choice="dark"]', "Space", reverse=True)
        expect(page.locator("html")).to_have_attribute("data-theme", "dark")
        capture(page, "keyboard-settings")
        activate(page, "#closeSettings", reverse=True)

        activate(page, "#exploreRoutesBtn")
        activate(page, '[data-explore-filter="lakes"]', "Space")
        expect(page.locator('[data-explore-filter="lakes"]')).to_have_class("active")
        tab_to(page, ".cultural-route-actions button")
        capture(page, "keyboard-explore")
        activate(page, "#closeExplore", reverse=True)
        expect(page.locator("#exploreSheet")).to_be_hidden()
        assert not errors, errors
        assert not providers, providers
        print("PASS accessibility: keyboard-only local planning, route options, Saved rename/Escape/Undo, icon/theme and Explore", flush=True)
    finally:
        context.close()


def enlarge_text(page):
    """Equivalent text-only enlargement: snapshot sizes before changing inheritance.

    A root rem change misses the app's fixed-pixel text. Every existing element's
    computed size is doubled, keeping real layout, wrapping and native scrolling.
    """
    result = page.evaluate("""() => {
        const elements = [...document.querySelectorAll('body *')].filter(el => el instanceof HTMLElement);
        const original = window.accessibilityOriginalFonts ||= new WeakMap();
        // Restore before measuring a new screen, including freshly rendered
        // cards; repeated checks must not compound an earlier enlargement.
        elements.forEach(el => {
            if (!original.has(el)) original.set(el, el.style.fontSize);
            else el.style.fontSize = original.get(el);
        });
        const sizes = elements.map(el => parseFloat(getComputedStyle(el).fontSize));
        elements.forEach((el,i) => el.style.fontSize = `${sizes[i]*2}px`);
        return {before:sizes[elements.indexOf(document.querySelector('#homeSearch'))],
            after:parseFloat(getComputedStyle(document.querySelector('#homeSearch')).fontSize)};
    }""")
    assert result["after"] == result["before"] * 2, result
    return result


def no_overflow(page, label):
    problems = page.evaluate("""() => {
        const selectors = ['html','#app','.bottom-sheet:not([hidden])','#routeDetails','#resultsList'];
        return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el =>
            el.getClientRects().length && el.scrollWidth > el.clientWidth+2).map(el =>
                ({selector, width:el.clientWidth, content:el.scrollWidth})));
    }""")
    assert not problems, (label, "Horizontal overflow", problems)


def navigation_labels(page, label):
    """Text ranges must fit their own targets, even when the page cannot overflow."""
    items = page.locator("#homeNav .home-nav-button").evaluate_all("""buttons => buttons.map(el => {
        const span=el.querySelector('span'), range=document.createRange();
        range.selectNodeContents(span);
        const button=el.getBoundingClientRect(), nav=el.parentElement.getBoundingClientRect();
        return {text:span.textContent, font:getComputedStyle(span).font,
            fontFamily:getComputedStyle(span).fontFamily, button:button.toJSON(), nav:nav.toJSON(),
            fragments:[...range.getClientRects()].map(r=>({rect:r.toJSON(),
                nativeHit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})),
            nativeHit:el.contains(document.elementFromPoint(button.x+button.width/2,button.y+button.height/2))};
    })""")
    # Record before asserting so a CI failure retains the actual font/geometry.
    EVIDENCE.append({"case": label, "navigationLabels": items})
    nav = items[0]["nav"]
    assert nav["left"] >= 0 and nav["right"] <= page.viewport_size["width"], (label, nav)
    for item in items:
        button, nav = item["button"], item["nav"]
        assert button["width"] >= 44 and button["height"] >= 44 and item["nativeHit"], (label, item)
        assert button["left"] >= nav["left"] and button["right"] <= nav["right"], (label, item)
        for fragment in item["fragments"]:
            rect = fragment["rect"]
            assert fragment["nativeHit"] and rect["left"] >= button["left"] and rect["right"] <= button["right"] \
                and rect["top"] >= button["top"] and rect["bottom"] <= button["bottom"], (label, item)
    for index, item in enumerate(items):
        for other in items[index + 1:]:
            for left in item["fragments"]:
                for right in other["fragments"]:
                    a, b = left["rect"], right["rect"]
                    assert not (a["left"] < b["right"] and a["right"] > b["left"] and
                                a["top"] < b["bottom"] and a["bottom"] > b["top"]), (label, item, other)


def navigation_reflow_reference(browser, url):
    for width, theme in [(320, "light"), (320, "dark"), (390, "light")]:
        context, page, errors, providers = new_page(browser, url, width, 844, theme)
        try:
            dismiss_intro(page)
            for scale in (100, 200):
                if scale == 200:
                    enlarge_text(page)
                navigation_labels(page, f"{width}-{theme}-{scale}-percent-browse-navigation")
                for selector in ("#layersBtn", "#browseLocateBtn"):
                    hit(page, selector)
                    rect = page.locator(selector).bounding_box()
                    assert rect["width"] >= 44 and rect["height"] >= 44, (selector, rect)
            activate(page, "#exploreRoutesBtn")
            navigation_labels(page, f"{width}-{theme}-200-percent-Explore-navigation")
            capture(page, f"{width}-{theme}-200-percent-navigation-labels")
            assert not errors, errors
            assert not providers, providers
        except Exception:
            capture(page, f"{width}-{theme}-navigation-failure")
            (CAPTURES / f"{width}-{theme}-navigation-failure-geometry.json").write_text(
                json.dumps(EVIDENCE[-1:], indent=2) + "\n")
            raise
        finally:
            context.close()
    print("PASS accessibility: 320/390 navigation label ranges stay separate inside native 44px targets at 100/200%", flush=True)


def navigation_font_stress(browser, url):
    context, page, errors, providers = new_page(browser, url, 320, 844)
    try:
        dismiss_intro(page)
        enlarge_text(page)
        for family in ("Arial", "DejaVu Sans", "Noto Sans"):
            page.locator("#homeNav span").evaluate_all("""(spans, family) =>
                spans.forEach(span => span.style.fontFamily = `"${family}", sans-serif`)
            """, family)
            navigation_labels(page, f"320-200-percent-font-{family}")
            for selector in ("#layersBtn", "#browseLocateBtn"):
                hit(page, selector)
            capture(page, "320-200-percent-font-" + family.replace(" ", "-"))
        assert not errors, errors
        assert not providers, providers
    except Exception:
        capture(page, "320-font-navigation-failure")
        (CAPTURES / "320-font-navigation-failure-geometry.json").write_text(
            json.dumps(EVIDENCE[-1:], indent=2) + "\n")
        raise
    finally:
        context.close()
    print("PASS accessibility: 320px 200% navigation fits Arial, DejaVu Sans and Noto Sans text metrics", flush=True)


def reflow_journey(browser, url, theme):
    context, page, errors, providers = new_page(browser, url, 320, 844, theme)
    try:
        # CI's DejaVu system font has wider metrics than some cloud desktops.
        # Retain one native-font case and one wider-font complete journey.
        if theme == "light":
            page.add_style_tag(content='body {font-family:"DejaVu Sans", sans-serif;}')
        dismiss_intro(page)
        plan_route(page)
        sizes = enlarge_text(page)
        no_overflow(page, theme + " enlarged route")
        if page.locator("#routeSheetHandle").get_attribute("aria-expanded") == "false":
            activate(page, "#routeSheetHandle")
        tab_to(page, "#startNavBtn")
        tab_to(page, "#preferSuperBtn", reverse=True)
        activate(page, "#routeMoreBtn")
        tab_to(page, "#clearBtn", reverse=True)
        # Exercise a real fallback font with inter-line gaps, where the union
        # centre of the wrapped credit is not part of the clickable inline link.
        page.add_style_tag(content=".map-attribution a {font-family:Arial,sans-serif !important;}")
        credit = attribution(page)
        assert len(credit[0]["fragments"]) >= 2, ("Wrapped credit regression did not wrap", credit)
        assert all(item["nativeHit"] and all(fragment["nativeHit"] for fragment in item["fragments"])
                   for item in credit), credit
        EVIDENCE.append({"case": f"320-{theme}-wrapped-credits", "links": credit})
        capture(page, f"320-{theme}-200-percent-route")
        activate(page, "#plannerBack")
        activate(page, "#visibleSettingsBtn")
        enlarge_text(page)
        no_overflow(page, theme + " enlarged settings")
        activate(page, '[data-theme-choice="high-contrast"]', "Space")
        expect(page.locator("html")).to_have_attribute("data-theme", "high-contrast")
        activate(page, f'[data-theme-choice="{theme}"]', "Space", reverse=True)
        expect(page.locator("html")).to_have_attribute("data-theme", theme)
        capture(page, f"320-{theme}-200-percent-themes")
        tab_to(page, '[data-navigation-icon-choice="cow"]')
        tab_to(page, "#offlineDownloadBtn")
        capture(page, f"320-{theme}-200-percent-settings")
        activate(page, "#aboutData > summary", "Space")
        expect(page.locator("#aboutData")).to_have_attribute("open", "")
        no_overflow(page, theme + " enlarged About")
        capture(page, f"320-{theme}-200-percent-about")
        activate(page, "#closeSettings", reverse=True)
        activate(page, "#savedPlacesBtn")
        enlarge_text(page)
        no_overflow(page, theme + " enlarged Saved")
        tab_to(page, ".saved-rename")
        capture(page, f"320-{theme}-200-percent-saved")
        activate(page, "#closeSaved", reverse=True)
        activate(page, "#exploreRoutesBtn")
        enlarge_text(page)
        no_overflow(page, theme + " enlarged Explore")
        tab_to(page, ".cultural-route-actions button")
        capture(page, f"320-{theme}-200-percent-explore")
        activate(page, "#closeExplore", reverse=True)
        attribution(page)
        EVIDENCE.append({"case": f"320-{theme}-200-percent-route", "fontSizes": sizes})
        assert not errors, errors
        assert not providers, providers
        print(f"PASS accessibility: 320px {theme}, 200% text, Route/Settings/Saved/Explore keyboard reachability and credits", flush=True)
    except Exception:
        capture(page, f"320-{theme}-failure")
        geometry = page.locator("#app, .bottom-sheet:not([hidden]), .map-attribution, .map-attribution a").evaluate_all("""elements => elements.map(el => {
            const r=el.getBoundingClientRect();
            return {id:el.id, class:el.className, text:el.matches('a')?el.textContent:'',
                rect:r.toJSON(), font:getComputedStyle(el).font, active:el===document.activeElement,
                fragments:[...el.getClientRects()].map(r=>({rect:r.toJSON(),
                    nativeHit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}))};
        })""")
        (CAPTURES / f"320-{theme}-failure-geometry.json").write_text(json.dumps(geometry, indent=2) + "\n")
        raise
    finally:
        context.close()


def reduced_motion(browser, url):
    context, page, errors, providers = new_page(browser, url)
    try:
        dismiss_intro(page)
        activate(page, "#visibleSettingsBtn")
        thumb = page.locator("#voiceSettingBtn .switch-thumb")
        normal = thumb.evaluate("el => getComputedStyle(el).transitionDuration")
        assert any(float(value.rstrip('s')) > .01 for value in normal.split(',')), normal
        page.emulate_media(reduced_motion="reduce")
        expect(page.locator("#voiceSettingBtn")).to_have_attribute("aria-checked", "false")
        activate(page, "#voiceSettingBtn", "Space")
        expect(page.locator("#voiceSettingBtn")).to_have_attribute("aria-checked", "true")
        durations = page.locator("#voiceSettingBtn, #voiceSettingBtn .switch-thumb, .leaflet-zoom-animated").evaluate_all("""elements => elements.map(el =>
            ({class:el.className.baseVal || el.className, duration:getComputedStyle(el).transitionDuration}))""")
        assert all(all(float(value.rstrip('s')) <= .001 for value in item["duration"].split(','))
                   for item in durations), ("Reduced-motion transition remains", durations)
        capture(page, "reduced-motion-settings")
        page.emulate_media(reduced_motion="no-preference")
        assert thumb.evaluate("el => getComputedStyle(el).transitionDuration") == normal
        activate(page, "#closeSettings", reverse=True)
        tab_to(page, ".leaflet-control-zoom-in")
        zoom_normal = observe_map_motion(page, "Enter")
        assert zoom_normal["zoomAnimated"], ("Normal zoom baseline did not exercise animation", zoom_normal)
        page.emulate_media(reduced_motion="reduce")
        zoom_reduced = observe_map_motion(page, "Enter")
        assert not zoom_reduced["zoomAnimated"], ("Reduced-motion keyboard zoom still animates", zoom_reduced)
        # Native Leaflet keyboard panning must follow the same preference.
        tab_to(page, "#map", reverse=True)
        pan_reduced = observe_map_motion(page, "ArrowDown")
        assert len(pan_reduced["positions"]) == 2, ("Reduced-motion pan did not move once immediately", pan_reduced)
        page.emulate_media(reduced_motion="no-preference")
        pan_normal = observe_map_motion(page, "ArrowDown")
        assert len(pan_normal["positions"]) > 2, ("Normal pan baseline did not exercise animation", pan_normal)
        assert not errors, errors
        assert not providers, providers
        EVIDENCE.append({"case": "reduced-motion", "transitions": durations,
                         "zoomNormal": zoom_normal, "zoomReduced": zoom_reduced,
                         "panNormal": pan_normal, "panReduced": pan_reduced})
        print("PASS accessibility: dynamic reduced-motion stops UI transitions and native map zoom/pan; normal motion restored", flush=True)
    finally:
        context.close()


def observe_map_motion(page, key):
    """Observe rendered DOM classes/positions during a real keyboard action."""
    page.evaluate("""() => {
        const pane = document.querySelector('.leaflet-map-pane');
        window.accessibilityMotion = {zoomAnimated:false, positions:[pane.style.transform]};
        window.accessibilityMotionObserver = new MutationObserver(() => {
            const result = window.accessibilityMotion;
            if (document.querySelector('.leaflet-zoom-anim')) result.zoomAnimated = true;
            if (!result.positions.includes(pane.style.transform)) result.positions.push(pane.style.transform);
        });
        window.accessibilityMotionObserver.observe(document.querySelector('#map'),
            {subtree:true, attributes:true, attributeFilter:['class','style']});
    }""")
    page.keyboard.press(key)
    page.wait_for_timeout(600)  # Covers the normal 250 ms Leaflet animation.
    return page.evaluate("""() => {
        window.accessibilityMotionObserver.disconnect();
        return window.accessibilityMotion;
    }""")


def initial_reduced_motion(browser, url):
    context, page, errors, providers = new_page(browser, url, motion="reduce")
    try:
        dismiss_intro(page)
        tab_to(page, ".leaflet-control-zoom-in")
        reduced = observe_map_motion(page, "Enter")
        assert not reduced["zoomAnimated"], reduced
        page.emulate_media(reduced_motion="no-preference")
        normal = observe_map_motion(page, "Enter")
        assert normal["zoomAnimated"], ("Opening with reduced motion permanently disabled normal zoom", normal)
        assert not errors, errors
        assert not providers, providers
        EVIDENCE.append({"case": "initial-reduced-motion", "reduced": reduced, "normal": normal})
        print("PASS accessibility: initial reduced-motion can switch back to normal map animation", flush=True)
    finally:
        context.close()


def search_focus_ownership(browser, url):
    context, page, errors, providers = new_page(browser, url)
    pending = []
    page.route("**/nominatim.openstreetmap.org/**", lambda route: pending.append(route))
    try:
        dismiss_intro(page)
        type_text(page, "#homeSearch", "Delayed keyboard focus fixture")
        page.keyboard.press("Enter")
        expect(page.locator("#resultsTitle")).to_have_text("Searching…")
        tab_to(page, "#homeSearchSubmit")
        page.wait_for_timeout(50)
        assert len(pending) == 1, providers
        pending.pop().fulfill(json=[{"lat": "52.025", "lon": "-.783", "name": "Delayed fixture result",
                                    "display_name": "Delayed fixture result, Milton Keynes"}])
        expect(page.locator("#resultsList .result-item")).to_have_count(1)
        expect(page.locator("#homeSearchSubmit")).to_be_focused()
        # A new keyboard-owned submission transfers directly to its result.
        type_text(page, "#homeSearch", "52.025,-0.783")
        page.keyboard.press("Enter")
        expect(page.locator("#resultsList .result-item")).to_have_count(1)
        expect(page.locator("#resultsList .result-item")).to_be_focused()
        focus_evidence(page, "Keyboard submission focuses result without stealing later focus")
        assert len(providers) == 1, providers
        assert not errors, errors
        print("PASS accessibility: submitted results receive keyboard focus without stealing a later focus choice", flush=True)
    finally:
        context.close()


def main():
    server = None
    url = os.environ.get("LIVE_URL")
    if not url:
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(RangeHandler, directory=str(ROOT / "dist")))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"))
            try:
                keyboard_journey(browser, url)
                navigation_reflow_reference(browser, url)
                navigation_font_stress(browser, url)
                for theme in ("light", "dark"):
                    reflow_journey(browser, url, theme)
                reduced_motion(browser, url)
                initial_reduced_motion(browser, url)
                search_focus_ownership(browser, url)
            finally:
                browser.close()
    finally:
        CAPTURES.mkdir(parents=True, exist_ok=True)
        (CAPTURES / "evidence.json").write_text(json.dumps(EVIDENCE, indent=2) + "\n")
        if server:
            server.shutdown()
    print("PASS keyboard, reflow and reduced-motion gate: " + url, flush=True)


if __name__ == "__main__":
    main()
