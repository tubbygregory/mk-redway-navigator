"""Release gate: load the real app and generated network in desktop/mobile Chromium.

No geocoding or live Overpass is needed: coordinate search is a normal offline UI
feature. A client/schema mismatch must fail this gate before Pages publication.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1] / "dist"


def plan(page, start, end):
    page.get_by_role('searchbox', name='Search for a destination', exact=True).fill(end)
    page.get_by_role('button', name='Search', exact=True).click()
    page.get_by_role('button', name='Map coordinates', exact=False).click()
    page.get_by_role('button', name='Directions', exact=True).click()
    page.get_by_role('searchbox', name='Starting location', exact=True).fill(start)
    page.get_by_role('searchbox', name='Starting location', exact=True).press('Enter')
    page.get_by_role('button', name='Map coordinates', exact=False).click()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for width, height in [(1280, 900), (390, 844)]:
                context = browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
                page = context.new_page()
                page.set_default_timeout(30000)
                errors, fallbacks = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda req: fallbacks.append(req.url) if '/api/interpreter' in req.url else None)
                page.route('**/api/interpreter', lambda route: route.abort())
                page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='networkidle')
                expect(page.locator('#visibleSettingsBtn')).to_be_visible()
                expect(page.locator('html')).to_have_attribute('data-routing-source', 'bundled')
                page.locator('#map').click(position={'x': width // 2, 'y': height // 2})
                expect(page.locator('#placeSheet')).to_be_hidden()
                plan(page, '52.0467,-0.7378', '52.025,-0.783')
                expect(page.locator('#routeStatus')).to_have_text('Route ready')
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                if width >= 900:
                    expect(page.get_by_role('button', name='Send to phone', exact=True)).to_be_visible()
                    expect(page.get_by_role('button', name='Send to phone', exact=True)).to_be_enabled()
                assert 1 <= page.locator('.route-option').count() <= 3
                expect(page.locator('#roadStat')).to_contain_text('%')
                mix_total = page.locator('#routeMixLegend b').evaluate_all("els => els.reduce((sum, el) => sum + Number(el.textContent.replace('%','')), 0)")
                assert mix_total == 100, mix_total
                if page.locator('#routeSheetHandle').get_attribute('aria-expanded') == 'false':
                    page.get_by_role('button', name='Expand route details', exact=True).click()
                expect(page.locator('#routeInsights')).to_be_visible()
                page.locator('.route-option').last.click()
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                page.get_by_role('button', name='Walk', exact=True).click()
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                expect(page.locator('.route-option')).to_have_count(0)
                # Genuine unmapped gap must block navigation and offer recovery.
                page.get_by_role('button', name='More', exact=True).click()
                page.get_by_role('button', name='Clear route', exact=True).click()
                plan(page, '52.0345,-0.774', '52.057,-0.718')
                expect(page.locator('#routeStatus')).to_contain_text('over 150 metres')
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_disabled()
                expect(page.get_by_role('button', name='Retry route', exact=True)).to_be_visible()
                page.get_by_role('button', name='More', exact=True).click()
                expect(page.get_by_role('button', name='Choose destination entrance', exact=True)).to_be_visible()
                assert not errors, errors
                assert not fallbacks, fallbacks
                print(f'PASS browser {width}x{height}: bundled v6, route choices, walking, blocked endpoint')
                page.get_by_role('button', name='Clear route', exact=True).click()
                page.locator('#visibleSettingsBtn').click()
                page.locator('#aboutData summary').click()
                expect(page.locator('#aboutVersion')).to_contain_text((ROOT.parent / 'VERSION').read_text().strip())
                expect(page.locator('#aboutNetwork')).not_to_have_text('Checking…')
                expect(page.locator('#aboutData')).to_contain_text('independent project')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
