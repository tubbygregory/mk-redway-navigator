"""Focused v0.14 release regressions using the real UI; no production test hooks."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import os
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

def upload(page, xml):
    page.locator('#gpxFileInput').set_input_files({'name':'audit.gpx','mimeType':'application/gpx+xml','buffer':xml.encode()})

def gpx(points, name='Audit route'):
    return f'<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>{name}</name><trkseg>{points}</trkseg></trk></gpx>'

POINTS = '<trkpt lat="52.025" lon="-.783"/><trkpt lat="52.026" lon="-.7815"/><trkpt lat="52.027" lon="-.780"/>'

def review(browser, url):
    for width, height in [(390,844),(844,390),(1280,900)]:
        ctx = browser.new_context(viewport={'width':width,'height':height}, color_scheme='dark', accept_downloads=True,
                                  permissions=['geolocation'],geolocation={'latitude':52.0467,'longitude':-.7378,'accuracy':5})
        page=ctx.new_page();page.set_default_timeout(30000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(url,wait_until='networkidle')
        expect(page.locator('html')).to_have_attribute('data-routing-source','bundled')
        # Local typing never sends a public geocoder request.
        requests=[];page.on('request',lambda r: requests.append(r.url) if 'nominatim.openstreetmap.org/search' in r.url else None)
        page.locator('#homeSearch').fill('Portway')
        expect(page.locator('.typeahead-item').first).to_be_visible()
        assert not requests
        page.locator('#homeSearch').fill('')
        upload(page,gpx(POINTS))
        expect(page.locator('#routeStatus')).to_have_text('Imported GPX · unverified track')
        expect(page.locator('#routeMix')).to_be_hidden();expect(page.locator('#routeInsights')).to_be_hidden()
        expect(page.locator('#routePreferences')).to_be_hidden()
        page.locator('#walkBtn').click()
        expect(page.locator('#routeStatus')).to_have_text('Imported GPX · unverified track')
        expect(page.locator('#startSearch')).to_have_value('Audit route start')
        # Rejection must leave the usable route and endpoints untouched.
        for invalid in ['<gpx>', gpx('<trkpt/><trkpt lat="52" lon="-1"/>'),
                        gpx('<trkpt lat="91" lon="-1"/><trkpt lat="52" lon="-1"/>'),
                        '<!DOCTYPE gpx [<!ENTITY x "test">]>'+gpx(POINTS), '<html>'+POINTS+'</html>']:
            upload(page,invalid)
            expect(page.locator('#toast')).to_contain_text('could not be read')
            expect(page.locator('#startSearch')).to_have_value('Audit route start')
        upload(page,gpx(POINTS,'&lt;img src=x onerror="window.gpxExecuted=1"&gt;'))
        # Leaflet tooltips are activated through the real SVG elements.
        page.locator('.leaflet-interactive').evaluate_all("els => els.forEach(el => el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true})))")
        assert not page.locator('.leaflet-tooltip img').count()
        assert page.evaluate('window.gpxExecuted || 0') == 0
        # A route outside MK remains a local imported line and can be exported.
        upload(page,gpx('<trkpt lat="55.94" lon="-3.2"/><trkpt lat="55.95" lon="-3.19"/>','Edinburgh'))
        expect(page.locator('#startSearch')).to_have_value('Edinburgh start')
        page.locator('#routeMoreBtn').click()
        with page.expect_download() as downloaded:
            page.locator('#exportGpxBtn').click()
        data=Path(downloaded.value.path()).read_text();doc=ET.fromstring(data)
        points=doc.findall('.//{*}trkpt');assert len(points)==2 and points[0].get('lat')=='55.940000'
        # Distinct segments must not get a fabricated connecting edge.
        multiple='<gpx><trk><trkseg><trkpt lat="52" lon="-.8"/><trkpt lat="52" lon="-.799"/></trkseg><trkseg>'+POINTS+'</trkseg></trk></gpx>'
        upload(page,multiple);expect(page.locator('#toast')).to_contain_text('longest continuous section')
        if width<900:
            page.locator('#startNavBtn').click()
            expect(page.locator('#turnText')).to_have_text('Join the imported route')
            expect(page.locator('#navEta')).to_have_text('Join route')
            page.locator('#exitNavBtn').click()
        # Shared links reconstruct a request; malformed mode/pref cannot reach cost lookups.
        page.goto(url+'?from=52.0467,-0.7378&to=52.025,-0.783&mode=walk&pref=bogus&lit=1&super=1',wait_until='networkidle')
        expect(page.locator('#routeStatus')).to_have_text('Route ready')
        expect(page.locator('#walkBtn')).to_have_class('mode-chip active')
        expect(page.locator('#routePreferences')).to_be_hidden()
        assert not errors,errors
        (ROOT/'test-results').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'test-results'/f'audit-{width}.png'))
        print(f'PASS audit {width}x{height}: GPX validation/security/export/mode/off-track and local suggestions/shared route')
        ctx.close()

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT/'dist')))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            review(browser,os.environ.get('LIVE_URL') or f'http://127.0.0.1:{server.server_port}/')
            browser.close()
    finally:server.shutdown()
if __name__=='__main__':main()
