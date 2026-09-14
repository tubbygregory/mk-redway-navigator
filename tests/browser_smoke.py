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
                page.get_by_role('button', name='Got it', exact=True).click()
                expect(page.locator('html')).to_have_attribute('data-routing-source', 'bundled')
                plan(page, '52.0467,-0.7378', '52.025,-0.783')
                expect(page.locator('#routeStatus')).to_contain_text('Using downloaded routing data')
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                expect(page.locator('.route-option')).to_have_count(3)
                expect(page.locator('#roadStat')).to_contain_text('%')
                expect(page.locator('#approachNote')).to_be_visible()
                page.get_by_role('button', name='Fastest', exact=False).filter(has=page.locator('strong')).click()
                expect(page.locator('#prefLabel')).to_have_text('Fastest')
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                page.get_by_role('button', name='Walk', exact=True).click()
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
                expect(page.locator('.route-option')).to_have_count(0)
                # Genuine unmapped gap must block navigation and offer recovery.
                page.get_by_role('button', name='Clear', exact=True).click()
                plan(page, '52.0345,-0.774', '52.057,-0.718')
                expect(page.locator('#routeStatus')).to_contain_text('over 150 metres')
                expect(page.get_by_role('button', name='Start', exact=True)).to_be_disabled()
                expect(page.get_by_role('button', name='Retry route', exact=True)).to_be_visible()
                expect(page.get_by_role('button', name='Choose destination entrance', exact=True)).to_be_visible()
                assert not errors, errors
                assert not fallbacks, fallbacks
                print(f'PASS browser {width}x{height}: bundled v5, route choices, walking, blocked endpoint')
                page.get_by_role('button', name='Clear', exact=True).click()
                page.get_by_role('button', name='Open settings', exact=True).click()
                page.locator('#aboutData summary').click()
                expect(page.locator('#aboutVersion')).to_contain_text('0.12.0')
                expect(page.locator('#aboutNetwork')).not_to_have_text('Checking…')
                expect(page.locator('#aboutData')).to_contain_text('independent project')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
