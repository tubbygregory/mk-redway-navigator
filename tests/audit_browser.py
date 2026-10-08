"""Focused v0.14 release regressions using the real UI; no production test hooks."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import os
import re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect
from browser_smoke import plan

ROOT = Path(__file__).resolve().parents[1]
CULTURAL_TRACKS = {
    'blue': ('Blue', 'Ancient & Modern Milton Keynes'),
    'yellow': ('Yellow', 'Cars, Boats & Trains'),
    'green': ('Green', 'Rivers, Lakes & Dinosaurs'),
    'iron': ('Iron', 'Romans, Rivers, Trams & Trains'),
    'cornflower': ('Cornflower', 'Woods, Frogs & a Toot'),
}
CULTURAL_COLOURS = {'blue': 'rgb(60, 120, 216)', 'yellow': 'rgb(213, 165, 0)',
                    'green': 'rgb(35, 134, 74)', 'iron': 'rgb(95, 102, 112)',
                    'cornflower': 'rgb(100, 149, 237)'}

def upload(page, xml):
    page.locator('#gpxFileInput').set_input_files({'name':'audit.gpx','mimeType':'application/gpx+xml','buffer':xml.encode()})

def gpx(points, name='Audit route'):
    return f'<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>{name}</name><trkseg>{points}</trkseg></trk></gpx>'

POINTS = '<trkpt lat="52.025" lon="-.783"/><trkpt lat="52.026" lon="-.7815"/><trkpt lat="52.027" lon="-.780"/>'

def exported_points(page):
    if page.locator('#routeMoreMenu').is_hidden():
        page.locator('#routeMoreBtn').click()
    with page.expect_download() as downloaded:
        page.locator('#exportGpxBtn').click()
    document = ET.fromstring(Path(downloaded.value.path()).read_text())
    return [(float(point.get('lat')), float(point.get('lon'))) for point in document.findall('.//{*}trkpt')]

def source_track_points(route_id, variant):
    document = ET.fromstring((ROOT / 'cultural-routes' / f'gpx-{route_id}-{variant}.gpx').read_bytes())
    points = document.findall('.//{*}trkpt') or document.findall('.//{*}rtept')
    coordinates = [(round(float(point.get('lat')), 6), round(float(point.get('lon')), 6)) for point in points]
    return [point for index, point in enumerate(coordinates) if not index or point != coordinates[index - 1]]

def assert_source_geometry(actual, route_id, variant):
    expected = source_track_points(route_id, variant)
    assert len(actual) == len(expected), (route_id, variant, len(actual), len(expected))
    if variant == 'short':
        # The published "short" files are open shortcuts. Never fabricate a
        # closing edge or relabel them as the complete advertised shorter loop.
        assert expected[0] != expected[-1], (route_id, 'shortcut source is unexpectedly closed')
        assert actual == expected, (route_id, 'shortcut geometry changed')
    else:
        assert actual[0] == actual[-1] and expected[0] == expected[-1], (route_id, 'full loop is open')
        # The app may rotate a closed loop to the nearest point, while preserving
        # every source edge and its direction.
        loop = expected[:-1]
        assert any(actual[:-1] == loop[index:] + loop[:index]
                   for index, point in enumerate(loop) if point == actual[0]), (route_id, 'full loop geometry changed')

def assert_navigation_hit(page):
    for selector in ['#goTabBtn', '#exploreRoutesBtn', '#savedPlacesBtn']:
        control = page.locator(selector)
        expect(control).to_be_visible()
        expect(control).to_be_enabled()
        hit = control.evaluate('''(el) => {
            const rect = el.getBoundingClientRect();
            const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {reachable: el.contains(target), covering: target?.outerHTML};
        }''')
        assert hit['reachable'], (selector, hit['covering'])

def back_to_destination(page):
    # Export expands route details. On a phone in landscape, collapse those
    # details with their normal handle to expose the planner's Back control.
    if page.viewport_size['width'] < 900 and page.locator('#routeSheetHandle').get_attribute('aria-expanded') == 'true':
        page.locator('#routeSheetHandle').click()
        expect(page.locator('#routeSheetHandle')).to_have_attribute('aria-expanded', 'false')
    page.locator('#plannerBack').click()

def review_cultural_tracks(page, url, screenshots=False, check_offline_join=False):
    """Exercise every published track through Explore and export its real geometry."""
    popups, external_gpx = [], []
    page.on('popup', lambda popup: popups.append(popup.url))
    page.on('request', lambda request: external_gpx.append(request.url)
            if 'getaroundmk.org.uk' in request.url and '.gpx' in request.url else None)
    for route_id, (colour, title) in CULTURAL_TRACKS.items():
        for variant, label in [('main', 'Full route'), ('short', 'Shortcut track')]:
            page.locator('#exploreRoutesBtn').click()
            card = page.locator('.route-' + route_id)
            expect(card).to_contain_text('shorter ride in guide')
            expect(card).to_contain_text('Shortcut GPX is a segment, not the complete shorter loop')
            if screenshots and route_id == 'blue' and variant == 'main':
                (ROOT / 'test-results').mkdir(exist_ok=True)
                page.screenshot(path=str(ROOT / 'test-results' / f'cultural-explore-{page.viewport_size["width"]}.png'))
            card.get_by_role('button', name=label, exact=True).click()
            expect(page.locator('#exploreSheet')).to_be_hidden()
            if check_offline_join and route_id == 'blue' and variant == 'main':
                # The first unseen full GPX and a manually chosen starting
                # point must produce a real joining leg using the cached graph.
                page.locator('#startSearch').fill('52.0467,-0.7378')
                page.locator('#startSearch').press('Enter')
                page.get_by_role('button', name='Map coordinates', exact=False).click()
                expect(page.locator('#routeStatus')).to_have_text('Route to Cultural Route start / join · then Blue track')
                expect(page.locator('.route-line')).to_have_count(1)
                assert page.locator('.route-line').evaluate('(el) => getComputedStyle(el).stroke') == 'rgb(169, 37, 29)'
            expect(page.locator('#routeStatus')).to_contain_text('Cultural Route')
            expect(page.locator('#routeStatus')).not_to_contain_text('Finding a route')
            name = colour + ' · ' + title + (' shortcut track' if variant == 'short' else '')
            expect(page.locator('#endSearch')).to_have_value(re.compile('^' + re.escape(name) + r' (start / join|finish)$'))
            expect(page.locator('#culturalRouteLegend')).to_contain_text(colour + ': official GPX track')
            expect(page.locator('#redwayStat')).to_have_text('Unknown')
            expect(page.locator('#roadStat')).to_have_text('Unknown')
            track = page.locator('.cultural-route-line')
            expect(track).to_have_count(1)
            assert track.evaluate('(el) => getComputedStyle(el).stroke') == CULTURAL_COLOURS[route_id]
            expect(page.locator('#routeMix')).to_be_hidden()
            expect(page.locator('#routeInsights')).to_be_hidden()
            assert_source_geometry(exported_points(page), route_id, variant)
            if screenshots and route_id == 'blue' and variant == 'short':
                page.screenshot(path=str(ROOT / 'test-results' / f'cultural-shortcut-{page.viewport_size["width"]}.png'))
            page.get_by_role('button', name='Clear route', exact=True).click()
            assert page.url == url, (route_id, variant, page.url)
    assert not popups, popups
    assert not external_gpx, external_gpx

def review_cultural_failure(page, url):
    """A local missing/corrupt track keeps the current route and offers in-app retry."""
    popups = []
    page.on('popup', lambda popup: popups.append(popup.url))
    for route_id, variant, response in [
        ('blue', 'full', {'status': 404, 'body': 'Not found'}),
        ('yellow', 'short', {'status': 200, 'body': '<gpx><trk>', 'content_type': 'application/gpx+xml'}),
    ]:
        preserved_name = 'Preserved route · Romans, Rivers, Trams &amp; Trains'
        preserved_title = 'Preserved route · Romans, Rivers, Trams & Trains'
        upload(page, gpx(POINTS, preserved_name))
        expect(page.locator('#startSearch')).to_have_value(preserved_title + ' start')
        original = exported_points(page)
        original_distance = page.locator('#distanceStat').inner_text()
        back_to_destination(page)
        # Destination details and their collapsed summary must both leave the
        # persistent section controls reachable by touch, including landscape.
        assert_navigation_hit(page)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Destination horizontal overflow'
        (ROOT / 'test-results').mkdir(exist_ok=True)
        if route_id == 'blue':
            page.screenshot(path=str(ROOT / 'test-results' / f'cultural-place-expanded-{page.viewport_size["width"]}.png'))
        page.locator('#placeSheetHandle').click()
        expect(page.locator('#placeSheetHandle')).to_have_attribute('aria-expanded', 'false')
        assert_navigation_hit(page)
        if route_id == 'blue':
            page.screenshot(path=str(ROOT / 'test-results' / f'cultural-place-collapsed-{page.viewport_size["width"]}.png'))
        page.locator('#placeSheetHandle').click()
        expect(page.locator('#placeSheetHandle')).to_have_attribute('aria-expanded', 'true')
        pattern = '**/cultural-routes/gpx-' + route_id + ('-main.gpx' if variant == 'full' else '-short.gpx')
        page.route(pattern, lambda route, request, response=response: route.fulfill(**response))
        page.locator('#exploreRoutesBtn').click()
        card = page.locator('.route-' + route_id)
        label = 'Full route' if variant == 'full' else 'Shortcut track'
        card.get_by_role('button', name=label, exact=True).click()
        expect(card.locator('.cultural-load-error')).to_contain_text('could not be loaded')
        retry = card.get_by_role('button', name='Retry ' + label.lower(), exact=True)
        expect(retry).to_be_visible()
        expect(page.locator('#exploreSheet')).to_be_visible()
        expect(page.locator('#startSearch')).to_have_value(preserved_title + ' start')
        expect(page.locator('#endSearch')).to_have_value(preserved_title + ' finish')
        expect(page.locator('#distanceStat')).to_have_text(original_distance)
        assert not card.locator('a[data-gpx-download]').count()
        assert page.url == url
        # A filter-driven card re-render must not discard the error/recovery UI.
        page.locator('[data-explore-filter="heritage"]').click()
        page.locator('[data-explore-filter="all"]').click()
        expect(retry).to_be_visible()
        page.locator('#closeExplore').click()
        page.locator('#directionsBtn').click()
        assert exported_points(page) == original, 'Failed Cultural Route load changed the usable route'
        back_to_destination(page)
        page.unroute(pattern)
        page.locator('#exploreRoutesBtn').click()
        retry.click()
        expect(page.locator('#exploreSheet')).to_be_hidden()
        expect(page.locator('#routeStatus')).to_contain_text('Cultural Route')
        expect(page.locator('#routeStatus')).not_to_contain_text('Finding a route')
        expect(page.locator('.cultural-route-line')).to_have_count(1)
        assert page.locator('.cultural-route-line').evaluate('(el) => getComputedStyle(el).stroke') == CULTURAL_COLOURS[route_id]
        expect(page.locator('#redwayStat')).to_have_text('Unknown')
        assert_source_geometry(exported_points(page), route_id, 'main' if variant == 'full' else 'short')
        page.get_by_role('button', name='Clear route', exact=True).click()
        assert page.url == url
    assert not popups, popups

def local_place_fixtures(page, url):
    """Use the deployed runtime index, also available in a clean live-review job."""
    response = page.request.get(urljoin(url, 'data/places.json'))
    assert response.ok, ('Local place data', response.status)
    data = response.json()
    assert data['format'] == 'mk-redway-places-v1'
    entries = {entry['id']: entry for entry in data['entries']}
    fixtures = {
        'warbler': entries['w1071871187'],
        'bannatyne': entries['w34961242'],
        'huntley': entries['w359122007'],
    }
    assert fixtures['warbler']['name'] == 'Warbler on the Wharf'
    assert fixtures['bannatyne']['name'] == 'Bannatyne Health Club'
    assert fixtures['huntley']['name'] == '8-55' and fixtures['huntley']['street'] == 'Huntley Crescent'
    assert fixtures['huntley']['kind'] == 'building' and fixtures['huntley'].get('house_number') != '25'
    return fixtures

def save_selected_destination(page, expected):
    """Observe coordinates through real Save/persistence, without app-state hooks."""
    page.locator('#saveFavouriteBtn').click()
    expect(page.locator('#toast')).to_have_text('Favourite saved')
    saved = page.evaluate("JSON.parse(localStorage.getItem('mk-redway-saved-v1')).favourites")
    assert len(saved) == 1, saved
    destination = saved[0]
    assert abs(destination['lat'] - expected['lat']) < .0000001, (destination, expected)
    assert abs(destination['lng'] - expected['lon']) < .0000001, (destination, expected)
    page.locator('#closePlace').click()
    page.locator('#savedPlacesBtn').click()
    expect(page.locator('#favouritesList .saved-remove')).to_have_count(1)
    page.locator('#favouritesList .saved-remove').click()
    expect(page.locator('#favouritesList .saved-remove')).to_have_count(0)
    page.locator('#closeSaved').click()
    return destination

def review_local_place_search(page, url, offline=False, fixtures=None, screenshots=False, with_location=False):
    """Real MK POIs/addresses remain findable during empty, failed and offline searches."""
    fixtures = fixtures or local_place_fixtures(page, url)
    requests = []
    page.on('request', lambda request: requests.append(request.url)
            if 'nominatim.openstreetmap.org/search' in request.url else None)
    pattern = '**/nominatim.openstreetmap.org/search?*'
    response = {'status': 200, 'json': []}
    def public_search(route, request):
        route.fulfill(headers={'Access-Control-Allow-Origin': '*'}, **response)
    if not offline:
        page.route(pattern, public_search)
    else:
        assert page.evaluate('navigator.onLine') is False, 'Offline browser emulation was lost'
    if page.get_by_role('button', name='Not now', exact=True).is_visible():
        page.get_by_role('button', name='Not now', exact=True).click()
    if with_location:
        page.get_by_role('button', name='Show my location', exact=True).click()
        expect(page.locator('.user-pulse')).to_be_visible()
    try:
        cases = [
            ('warbler', 'Warbler', re.compile('^Warbler on the Wharf'), 200),
            ('bannatyne', 'Bannatynes', re.compile('^Bannatyne Health Club'), 503),
            ('huntley', '25 Huntley Crescent', re.compile('^8-55 Huntley Crescent'), 200),
        ]
        row_and_pin = []
        for key, query, canonical, status in cases:
            response = {'status': status, 'body': 'Unavailable'} if status == 503 else {'status': 200, 'json': []}
            if key == 'huntley':
                # The public response contains only invalid/outside points. A
                # source-backed local building must still be offered truthfully.
                response = {'status': 200, 'json': [
                    {'lat': '55.95', 'lon': '-3.19', 'name': 'Outside coverage fixture'},
                    {'lat': 'not-a-coordinate', 'lon': '-.74', 'name': 'Invalid coordinate fixture'},
                    {'lat': '', 'lon': '', 'name': 'Empty coordinate fixture'}, None,
                ]}
            for selection in (['row', 'pin'] if key == 'warbler' else ['row']):
                before = len(requests)
                page.locator('#homeSearch').fill('')
                page.locator('#homeSearch').press_sequentially(query, delay=15)
                suggestion = page.locator('.typeahead-item').filter(has=page.locator('strong', has_text=canonical)).first
                expect(suggestion).to_be_visible()
                assert suggestion.bounding_box()['height'] >= 44, (key, 'small suggestion target')
                # Wait beyond the shared geocoder pacing interval: a delayed
                # public autocomplete request is still a privacy regression.
                page.wait_for_timeout(1100)
                assert len(requests) == before, ('Typing sent public search', query, requests)
                if screenshots:
                    (ROOT / 'test-results').mkdir(exist_ok=True)
                    theme = page.locator('html').get_attribute('data-theme')
                    page.screenshot(path=str(ROOT / 'test-results' / f'address-typeahead-{page.viewport_size["width"]}-{key}-{theme}.png'))
                page.locator('#homeSearchSubmit').click()
                expect(page.locator('#resultsTitle')).to_contain_text('Local matches')
                if page.locator('#resultsSheetHandle').get_attribute('aria-expanded') == 'false':
                    page.locator('#resultsSheetHandle').click()
                    expect(page.locator('#resultsSheetHandle')).to_have_attribute('aria-expanded', 'true')
                expect(page.locator('#resultsMessage')).to_have_attribute('role', 'status')
                expect(page.locator('#resultsMessage')).to_contain_text('offline' if offline else 'unavailable' if status == 503 else 'No online match')
                assert len(requests) == before + (0 if offline else 1), ('Explicit search request count', query, requests)
                rows = page.locator('.result-item')
                names = rows.locator('.result-copy strong').all_text_contents()
                index = next(index for index, name in enumerate(names) if canonical.search(name))
                row = rows.nth(index)
                expect(row).to_be_visible()
                assert row.bounding_box()['height'] >= 44, (key, 'small result target')
                expect(page.locator('.search-result-marker')).to_have_count(len(names))
                assert not any('fixture' in name for name in names), names
                if with_location:
                    expect(row.locator('.result-copy > small').first).to_contain_text(re.compile(r'\d.*(?:mi|km|ft|m)'))
                if key == 'huntley':
                    expect(row.locator('.result-copy > small').first).to_contain_text('Building match')
                    expect(row.locator('.result-accuracy')).to_have_text('Number 25 not found locally · check entrance on map')
                    expect(page.locator('#resultsPrecisionHelp')).to_have_count(1)
                    expect(page.locator('#resultsPrecisionHelp')).to_contain_text('approximate locations, not verified front doors')
                    assert not any(re.match(r'^25\s+Huntley Crescent', name) for name in names), names
                    colours = row.locator('.result-accuracy').evaluate('(el) => [getComputedStyle(el).color, getComputedStyle(el.closest("#resultsSheet")).backgroundColor]')
                    assert contrast_ratio(*colours) >= 4.5, ('Address accuracy contrast', colours)
                    # Long building warnings must leave the last alternative
                    # reachable through the real scrolling list on narrow phones.
                    rows.last.scroll_into_view_if_needed()
                    expect(rows.last).to_be_visible()
                    assert rows.last.evaluate('(el) => {const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), 'Last address result is covered'
                    list_scroll = page.locator('#resultsList').evaluate('(el) => ({needed:el.scrollHeight>el.clientHeight, top:el.scrollTop})')
                    assert not list_scroll['needed'] or list_scroll['top'] > 0, 'Address list did not scroll'
                    if screenshots:
                        page.screenshot(path=str(ROOT / 'test-results' / f'address-last-result-{page.viewport_size["width"]}-{theme}.png'))
                    row.scroll_into_view_if_needed()
                if screenshots:
                    page.screenshot(path=str(ROOT / 'test-results' / f'address-results-{page.viewport_size["width"]}-{key}-{theme}.png'))
                primary = row.locator('.result-copy strong').inner_text()
                if selection == 'pin':
                    # On a short/narrow phone the expanded results cover the
                    # centre of the map. Use the normal handle to expose pins.
                    if page.locator('#resultsSheetHandle').get_attribute('aria-expanded') == 'true':
                        page.locator('#resultsSheetHandle').click()
                        expect(page.locator('#resultsSheetHandle')).to_have_attribute('aria-expanded', 'false')
                    page.locator('.search-result-marker').nth(index).click()
                else:
                    row.click()
                expect(page.locator('#placeName')).to_have_text(primary)
                if key == 'huntley':
                    expect(page.locator('#placeAddress')).to_contain_text('Huntley Crescent')
                    expect(page.locator('#placeAddress')).to_contain_text('Building match · Exact house number 25 not found in local data · check entrance on map')
                destination = save_selected_destination(page, fixtures[key])
                assert canonical.search(destination['name']), destination
                if key == 'huntley':
                    assert 'Exact house number 25 not found in local data' in destination['address'], destination
                if key == 'warbler':
                    row_and_pin.append({name: destination[name] for name in ['name', 'address', 'lat', 'lng']})
        assert row_and_pin[0] == row_and_pin[1], ('Row and map pin selected different destinations', row_and_pin)
        if not offline:
            # A submitted, valid provider match takes precedence over its local
            # representation. Duplicates and invalid coordinates cannot add pins.
            warbler = fixtures['warbler']
            submitted = {
                'osm_type': 'way', 'osm_id': 1071871187,
                'lat': str(warbler['lat']), 'lon': str(warbler['lon']), 'name': warbler['name'],
                'address': {'road': warbler['street'], 'city': 'Milton Keynes', 'postcode': warbler['postcode']},
                'display_name': 'Submitted-provider result fixture: Warbler on the Wharf, Milton Keynes',
            }
            response = {'status': 200, 'json': [submitted, submitted, {'lat': '', 'lon': '', 'name': 'Invalid fixture'}]}
            before = len(requests)
            page.locator('#homeSearch').fill('Warbler')
            page.locator('#homeSearchSubmit').click()
            expect(page.locator('#resultsTitle')).to_contain_text('Results for')
            if page.locator('#resultsSheetHandle').get_attribute('aria-expanded') == 'false':
                page.locator('#resultsSheetHandle').click()
                expect(page.locator('#resultsSheetHandle')).to_have_attribute('aria-expanded', 'true')
            expect(page.locator('.result-item')).to_have_count(1)
            expect(page.locator('.search-result-marker')).to_have_count(1)
            expect(page.locator('.result-item .result-address')).to_have_text(', '.join([warbler['street'], 'Milton Keynes', warbler['postcode']]))
            assert len(requests) == before + 1, requests
            page.locator('.result-item').click()
            save_selected_destination(page, warbler)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Address search overflow'
        print(f'PASS local place search {page.viewport_size["width"]}x{page.viewport_size["height"]}: real Warbler/Bannatyne/Huntley building, row/pin identity, no public typing requests, ' + ('offline' if offline else 'empty/503/outside-invalid provider results'))
    finally:
        if not offline:
            page.unroute(pattern, public_search)
        page.locator('#homeSearch').fill('')

def contrast_ratio(foreground, background):
    def luminance(colour):
        channels = [int(value) / 255 for value in re.findall(r'\d+', colour)[:3]]
        linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
        return sum(value * weight for value, weight in zip(linear, [.2126, .7152, .0722]))
    dark, light = sorted([luminance(foreground), luminance(background)])
    return (light + .05) / (dark + .05)

def assert_action_contrast(page, selector):
    expect(page.locator(selector)).to_be_visible()
    expect(page.locator(selector)).to_be_enabled()
    colours = page.locator(selector).evaluate('(el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor]; }')
    assert contrast_ratio(*colours) >= 4.5, (selector, colours)

def assert_control_hit(page, selector, min_height=44):
    """Inspect the real hit target without locator.click's implicit scrolling."""
    control = page.locator(selector)
    expect(control).to_be_visible()
    box = control.bounding_box()
    assert box and box['height'] >= min_height, (selector, box)
    hit = control.evaluate('''(el) => {
        const rect = el.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {reachable: el.contains(target), covering: target?.outerHTML};
    }''')
    assert hit['reachable'], (selector, box, hit['covering'], 'Control is obscured or outside the visible panel')

def read_saved_places(page):
    return page.evaluate("JSON.parse(localStorage.getItem('mk-redway-saved-v1') || '{\"home\":null,\"work\":null,\"favourites\":[]}')")

def assert_browse_attribution(page):
    credit = page.locator('.leaflet-control-attribution')
    expect(credit).to_have_count(1)
    osm = credit.locator('a[href="https://www.openstreetmap.org/copyright"]')
    expect(osm).to_have_count(1)
    expect(osm).to_be_visible()
    expect(credit.get_by_role('link', name='Protomaps', exact=True)).to_have_count(1)
    if page.viewport_size['width'] <= page.viewport_size['height'] or page.viewport_size['width'] >= 900:
        page.wait_for_function('''() => {
            const credit = document.querySelector('.leaflet-control-attribution').getBoundingClientRect();
            const overlay = document.querySelector('#exploreUI').getBoundingClientRect();
            return credit.top >= overlay.bottom + 4;
        }''')
    else:
        box = credit.bounding_box()
        assert box['y'] > page.viewport_size['height'] / 2, ('Landscape credit moved from its bottom placement', box)
    for link in [osm, credit.get_by_role('link', name='Protomaps', exact=True)]:
        box = link.bounding_box()
        assert 0 <= box['y'] and box['y'] + box['height'] <= page.viewport_size['height'], box
        assert link.evaluate('''(el) => {const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'''), ('Attribution link is covered', box)

def block_saved_writes(page, name='QuotaExceededError'):
    # Browser storage failures are an environmental condition, not an app hook.
    page.evaluate('''(name) => {
        window.restoreSavedStorage = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key === 'mk-redway-saved-v1') throw new DOMException('Storage unavailable', name);
            return window.restoreSavedStorage.call(this, key, value);
        };
    }''', name)

def restore_saved_writes(page):
    page.evaluate('Storage.prototype.setItem = window.restoreSavedStorage; delete window.restoreSavedStorage;')

def saved_map_point(page):
    picker = page.locator('#savedPlacePicker').bounding_box()
    viewport = page.viewport_size
    # Use exposed map, clear of the picker, navigation and floating controls.
    if viewport['width'] >= 600:
        return {'x': viewport['width'] * .72, 'y': viewport['height'] * .46}
    overlay = page.locator('#exploreUI').bounding_box()
    credit = page.locator('.leaflet-control-attribution').bounding_box()
    y = max(picker['y'] + picker['height'] + 18, overlay['y'] + overlay['height'] + 18,
            credit['y'] + credit['height'] + 10, viewport['height'] * .58)
    if y > viewport['height'] - 110:
        return {'x': viewport['width'] * .72, 'y': viewport['height'] * .46}
    return {'x': viewport['width'] * .42, 'y': y}

def review_saved_place_flow(page, context, url, fixtures=None, screenshots=False, themes=False, storage_failures=False):
    """Save is durable and map-picked Home/Work/favourites require no provider/GPS."""
    fixtures = fixtures or local_place_fixtures(page, url)
    requests = []
    page.on('request', lambda request: requests.append(request.url)
            if 'nominatim.openstreetmap.org' in request.url else None)
    location_observer = '''() => {
        window.savedLocationRequests = 0;
        const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (...args) => { window.savedLocationRequests++; return original(...args); };
    }'''
    context.add_init_script('(' + location_observer + ')();')
    page.evaluate(location_observer)
    if page.locator('#locationIntroDismiss').is_visible():
        page.locator('#locationIntroDismiss').click()
    page.locator('#homeSearch').fill('Warbler')
    suggestion = page.locator('.typeahead-item').filter(has=page.locator('strong', has_text=re.compile(r'^Warbler on the Wharf(?:,|$)')))
    expect(suggestion.first).to_be_visible()
    suggestion.first.click()
    expect(page.locator('#saveFavouriteLabel')).to_have_text('Save')
    original = read_saved_places(page)
    if storage_failures:
        block_saved_writes(page)
        page.locator('#saveFavouriteBtn').click()
        expect(page.locator('#toast')).to_contain_text('Browser storage is full or unavailable')
        expect(page.locator('#saveFavouriteLabel')).to_have_text('Save')
        expect(page.locator('#saveFavouriteBtn')).to_have_attribute('aria-pressed', 'false')
        assert read_saved_places(page) == original
        restore_saved_writes(page)
    page.locator('#saveFavouriteBtn').click()
    expect(page.locator('#saveFavouriteLabel')).to_have_text('Saved')
    saved = read_saved_places(page)
    assert len(saved['favourites']) == len(original['favourites']) + 1
    favourite = saved['favourites'][0]
    assert (favourite['lat'], favourite['lng']) == (fixtures['warbler']['lat'], fixtures['warbler']['lon'])
    for choice in ['light', 'dark', 'system', 'high-contrast'] if themes else [None]:
        if choice:
            page.emulate_media(color_scheme='dark' if choice == 'system' else 'light')
            page.locator('#visibleSettingsBtn').click()
            page.locator(f'[data-theme-choice="{choice}"]').click()
            page.locator('#closeSettings').click()
        assert_control_hit(page, '#saveFavouriteBtn')
        expect(page.locator('#saveFavouriteBtn')).to_have_attribute('aria-pressed', 'true')
        colours = page.locator('#saveFavouriteBtn').evaluate('''(el) => {
            const style = getComputedStyle(el); const root = getComputedStyle(document.documentElement);
            return [style.color, style.backgroundColor, root.getPropertyValue('--red').trim()];
        }''')
        assert contrast_ratio(colours[0], colours[1]) >= 4.5, colours
        assert page.locator('#saveFavouriteBtn').evaluate('''(el) => {
            const probe = document.createElement('span'); probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--red');
            document.body.append(probe); const red = getComputedStyle(probe).color; probe.remove();
            return getComputedStyle(el).backgroundColor === red;
        }'''), colours
        page.locator('#saveFavouriteBtn').click()
        expect(page.locator('#toast')).to_contain_text('Already saved')
        assert read_saved_places(page) == saved, 'Repeated Save duplicated or changed the favourite'
        assert_browse_attribution(page)
        if screenshots:
            page.screenshot(path=str(ROOT / 'test-results' / f'saved-confirmed-{page.viewport_size["width"]}-{choice or "offline"}.png'))
    assert page.evaluate('window.savedLocationRequests') == 0, 'Saving prompted for location'
    page.reload(wait_until='networkidle')
    assert_browse_attribution(page)
    quick_favourite = page.locator('.quick-favourite').filter(has_text='Warbler on the Wharf')
    assert quick_favourite.bounding_box()['height'] >= 44, 'Favourite shortcut touch target is too small'
    quick_favourite.click()
    expect(page.locator('#saveFavouriteLabel')).to_have_text('Saved')
    assert read_saved_places(page) == saved, 'Favourite did not survive reload'
    page.locator('#closePlace').click()
    page.locator('#savedPlacesBtn').click()
    remove = page.locator('.saved-remove').filter(has=page.locator('svg')).first
    if storage_failures:
        block_saved_writes(page, 'SecurityError')
        remove.click()
        expect(page.locator('#toast')).to_contain_text('Browser storage is full or unavailable')
        assert read_saved_places(page) == saved
        expect(page.locator('.saved-favourite-open').filter(has_text='Warbler on the Wharf')).to_be_visible()
        restore_saved_writes(page)
    remove.click()
    assert read_saved_places(page)['favourites'] == original['favourites']
    page.locator('#closeSaved').click()
    page.locator('#homeSearch').fill('Warbler')
    page.locator('.typeahead-item').filter(has=page.locator('strong', has_text=re.compile(r'^Warbler on the Wharf(?:,|$)'))).first.click()
    expect(page.locator('#saveFavouriteLabel')).to_have_text('Save')
    expect(page.locator('#saveFavouriteBtn')).to_have_attribute('aria-pressed', 'false')
    page.locator('#closePlace').click()

    for kind, control in [('home', '#setHomeBtn'), ('work', '#setWorkBtn'), ('favourite', '#addFavouriteBtn')]:
        page.locator('#savedPlacesBtn').click()
        page.locator(control).click()
        expect(page.locator('#savedPlacePicker')).to_be_visible()
        expect(page.locator('#savedPlacePickerHint')).to_contain_text('Search for a place, or choose a point on the map')
        assert not page.locator('#homeSearch').evaluate('(el) => el === document.activeElement'), 'Picker unexpectedly opened the keyboard'
        assert_control_hit(page, '#pickSavedOnMapBtn')
        assert_control_hit(page, '#cancelSavedPickBtn')
        page.locator('#pickSavedOnMapBtn').click()
        expect(page.locator('#savedPlacePickerHint')).to_contain_text('Tap the map to save')
        page.wait_for_timeout(300)  # Let the normal destination zoom animation finish.
        assert_browse_attribution(page)
        if screenshots:
            page.screenshot(path=str(ROOT / 'test-results' / f'saved-map-picker-{page.viewport_size["width"]}-{kind}.png'))
        point = saved_map_point(page)
        assert page.evaluate('''(point) => document.querySelector('#map').contains(document.elementFromPoint(point.x, point.y))''', point), (kind, point, 'Chosen test point is covered by UI')
        if kind == 'work' and page.viewport_size['width'] < 900:
            touch = context.new_cdp_session(page)
            touch.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            page.wait_for_timeout(2000)
            touch.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            touch.detach()
        else:
            page.locator('#map').click(position=point)
        expect(page.locator('#savedSheet')).to_be_visible()
        expect(page.locator('#savedPlacePicker')).to_be_hidden()
        expect(page.locator('#placeSheet')).to_be_hidden()
        selected = read_saved_places(page)
        place = selected['favourites'][0] if kind == 'favourite' else selected[kind]
        assert place and place['name'] == ('Saved pin 1' if kind == 'favourite' else kind.title()), place
        assert 51.95 < place['lat'] < 52.16 and -.90 < place['lng'] < -.60, place
        if kind != 'favourite':
            expect(page.locator('#' + kind + 'SavedLabel')).to_have_text(place['address'])
            expect(page.locator(control)).to_have_text('Change ' + kind.title())
        page.locator('#closeSaved').click()
        assert page.evaluate('window.savedLocationRequests') == 0, 'Picking a saved pin prompted for location'
        page.reload(wait_until='networkidle')
        assert read_saved_places(page) == selected, (kind, 'Chosen map point was not durable')
        if kind != 'favourite':
            assert_control_hit(page, '#quick' + kind.title() + 'Btn')
            page.locator('#quick' + kind.title() + 'Btn').click()
            expect(page.locator('#placeName')).to_have_text(kind.title())
            expect(page.locator('#placeAddress')).to_have_text(place['address'])
            expect(page.locator('#saveFavouriteLabel')).to_have_text('Save')
            page.locator('#closePlace').click()
        else:
            page.locator('#savedPlacesBtn').click()
            page.locator('.saved-remove').first.click()
            page.locator('#closeSaved').click()
    if themes and page.viewport_size['width'] == 390:
        for kind in ['home', 'work']:
            previous = read_saved_places(page)
            page.locator('#savedPlacesBtn').click()
            page.locator('#set' + kind.title() + 'Btn').click()
            page.locator('#pickSavedOnMapBtn').click()
            page.wait_for_timeout(300)
            point = saved_map_point(page); point['x'] += 35
            assert page.evaluate('(point) => document.querySelector("#map").contains(document.elementFromPoint(point.x,point.y))', point)
            page.locator('#map').click(position=point)
            expect(page.locator('#savedSheet')).to_be_visible()
            updated = read_saved_places(page)
            assert (updated[kind]['lat'], updated[kind]['lng']) != (previous[kind]['lat'], previous[kind]['lng']), 'Change pin retained the old point'
            assert updated['work' if kind == 'home' else 'home'] == previous['work' if kind == 'home' else 'home']
            assert updated['favourites'] == previous['favourites']
            expect(page.locator('#' + kind + 'SavedLabel')).to_have_text(updated[kind]['address'])
            page.locator('#closeSaved').click()
            assert page.evaluate('window.savedLocationRequests') == 0
            page.reload(wait_until='networkidle')
            assert read_saved_places(page) == updated
    before_cancel = read_saved_places(page)
    for cancel in ['#cancelSavedPickBtn', '#goTabBtn', '#visibleSettingsBtn', '#exploreRoutesBtn']:
        page.locator('#savedPlacesBtn').click()
        page.locator('#addFavouriteBtn').click()
        page.locator('#pickSavedOnMapBtn').click()
        point = saved_map_point(page)
        page.locator(cancel).click()
        expect(page.locator('#savedPlacePicker')).to_be_hidden()
        if cancel == '#cancelSavedPickBtn': page.locator('#closeSaved').click()
        elif cancel == '#visibleSettingsBtn': page.locator('#closeSettings').click()
        elif cancel == '#exploreRoutesBtn': page.locator('#closeExplore').click()
        page.locator('#map').click(position=point)
        expect(page.locator('#placeSheet')).to_be_hidden()
        assert read_saved_places(page) == before_cancel, (cancel, 'Cancelled picker saved a later map tap')
    assert not requests, requests
    assert page.evaluate('window.savedLocationRequests') == 0, 'Saving prompted for location'
    print(f'PASS Saved {page.viewport_size["width"]}x{page.viewport_size["height"]}: durable red Saved, deduplication, Home/Work/favourite pins, cancellation and no public/geolocation requests')

def review_saved_place_matrix(browser, url):
    for width, height in [(320,568), (375,812), (390,844), (844,390), (1280,900)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, service_workers='block',
                                      is_mobile=width < 900, has_touch=width < 900,
                                      user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' if width < 900 else None)
        if width < 900:
            context.add_init_script("Object.defineProperty(navigator, 'standalone', {value:true, configurable:true});")
        page = context.new_page(); page.set_default_timeout(30000)
        page.route('**/nominatim.openstreetmap.org/**', lambda route: route.abort())
        page.goto(url, wait_until='networkidle')
        if width < 900:
            expect(page.locator('html')).to_have_class(re.compile(r'.*ios-standalone.*'))
        (ROOT / 'test-results').mkdir(exist_ok=True)
        if page.locator('#locationIntroDismiss').is_visible(): page.locator('#locationIntroDismiss').click()
        # Traverse into the search field with genuine keyboard input, so the
        # :focus-visible ring is tested rather than only matching a CSS rule.
        page.locator('#visibleSettingsBtn').focus()
        page.keyboard.press('Shift+Tab'); page.keyboard.press('Shift+Tab')
        expect(page.locator('#homeSearch')).to_be_focused()
        focus = page.locator('#homeSearch').evaluate('(el) => { const s=getComputedStyle(el); return [s.outlineStyle, parseFloat(s.outlineWidth)]; }')
        assert focus[0] != 'none' and focus[1] >= 2, focus
        page.screenshot(path=str(ROOT / 'test-results' / f'search-keyboard-focus-{width}.png'))
        review_saved_place_flow(page, context, url, screenshots=True, themes=True, storage_failures=True)
        # Opening More must reveal actual commands without a test clicking an
        # offscreen command and automatically scrolling it into view.
        plan(page, '52.0467,-0.7378', '52.025,-0.783')
        expect(page.locator('#routeStatus')).to_have_text('Route ready')
        if width < 900 and page.locator('#routeSheetHandle').get_attribute('aria-expanded') == 'true':
            page.locator('#routeSheetHandle').click()
        page.locator('#routeMoreBtn').click()
        page.wait_for_timeout(100)
        for selector in ['#moveStartBtn', '#moveEndBtn', '#exportGpxBtn', '#importGpxBtn', '#clearBtn', '#routeMoreBtn']:
            assert_control_hit(page, selector)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(ROOT / 'test-results' / f'route-more-reachable-{width}.png'))
        if width < 900:
            page.locator('#routeSheetHandle').click()
            expect(page.locator('#routeSheetHandle')).to_have_attribute('aria-expanded', 'false')
            expect(page.locator('#routeMoreMenu')).to_be_hidden()
            page.locator('#routeMoreBtn').click()
            expect(page.locator('#routeMoreBtn')).to_have_attribute('aria-expanded', 'true')
            expect(page.locator('#routeSheetHandle')).to_have_attribute('aria-expanded', 'true')
            page.wait_for_timeout(100)
            for selector in ['#moveStartBtn', '#exportGpxBtn', '#clearBtn', '#routeMoreBtn']:
                assert_control_hit(page, selector)
        context.close()

def review_cultural_navigation(browser, url):
    """A calculated red join hands over to the unchanged blue track on accurate GPS."""
    origin = {'latitude': 52.0467, 'longitude': -.7378, 'accuracy': 5}
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True,
                                  service_workers='block', permissions=['geolocation'], geolocation=origin,
                                  accept_downloads=True)
    page = context.new_page(); page.set_default_timeout(30000)
    page.route('**/nominatim.openstreetmap.org/**', lambda route: route.abort())
    page.goto(url, wait_until='networkidle')
    if page.locator('#locationIntroDismiss').is_visible(): page.locator('#locationIntroDismiss').click()
    page.locator('#browseLocateBtn').click()
    expect(page.locator('.user-pulse')).to_be_visible()
    page.locator('#exploreRoutesBtn').click()
    page.locator('.route-blue').get_by_role('button', name='Full route', exact=True).click()
    expect(page.locator('#routeStatus')).to_have_text('Route to Cultural Route start / join · then Blue track')
    expect(page.locator('.route-line')).to_have_count(1)
    assert page.locator('.route-line').evaluate('(el) => getComputedStyle(el).stroke') == 'rgb(169, 37, 29)'
    assert page.locator('.cultural-route-line').evaluate('(el) => getComputedStyle(el).stroke') == CULTURAL_COLOURS['blue']
    expect(page.locator('#culturalJoinLabel')).to_have_text('Red: start / join')
    expect(page.locator('#culturalTrackLabel')).to_contain_text('Blue: official GPX track')
    assert_source_geometry(exported_points(page), 'blue', 'main')
    if page.locator('#routeSheetHandle').get_attribute('aria-expanded') == 'true': page.locator('#routeSheetHandle').click()
    page.screenshot(path=str(ROOT / 'test-results' / 'cultural-red-join-blue-track.png'))
    page.locator('#startNavBtn').click()
    expect(page.locator('#app')).to_have_attribute('data-stage', 'navigation')
    expect(page.locator('#navEta')).not_to_have_text('Join route')
    # Use a surveyed GPX vertex on the closing side of the join. Handoff must
    # start a new loop rather than snap to its final segment and falsely arrive.
    # An inaccurate fix at that point must not complete the joining leg.
    vertices = source_track_points('blue', 'main')[:-1]
    target = min(vertices, key=lambda pair: (pair[0]-origin['latitude'])**2 + ((pair[1]-origin['longitude']) * .615)**2)
    closing_side = vertices[(vertices.index(target) - 1) % len(vertices)]
    context.set_geolocation({'latitude':closing_side[0], 'longitude':closing_side[1], 'accuracy':1000})
    expect(page.locator('#turnText')).to_have_text('Waiting for an accurate location')
    expect(page.locator('.route-line')).to_have_count(1)
    context.set_geolocation({'latitude':closing_side[0], 'longitude':closing_side[1], 'accuracy':5})
    expect(page.locator('#routeStatus')).to_have_text('Blue Cultural Route · unverified track')
    expect(page.locator('.route-line')).to_have_count(0)
    expect(page.locator('.cultural-route-line')).to_have_count(1)
    expect(page.locator('#app')).to_have_attribute('data-stage', 'navigation')
    expect(page.locator('#navRemain')).not_to_contain_text('0 m')
    page.screenshot(path=str(ROOT / 'test-results' / 'cultural-joined-blue-track.png'))
    page.locator('#exitNavBtn').click()
    assert_source_geometry(exported_points(page), 'blue', 'main')
    context.close()

    # Hold an actual geolocation API response while repeated taps and Back run
    # through the normal UI. A cancelled fix must not reopen navigation.
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True,
                                  service_workers='block')
    context.add_init_script('''(() => {
        const pending = []; window.culturalLocationRequests = 0;
        navigator.geolocation.getCurrentPosition = (success, failure) => { window.culturalLocationRequests++; pending.push({success, failure}); };
        window.completeCulturalLocation = () => {
            const request = pending.shift(); if (!request) throw new Error('No location request');
            request.success({coords:{latitude:52.0467,longitude:-.7378,accuracy:5}});
        };
    })();''')
    page = context.new_page(); page.set_default_timeout(30000)
    page.route('**/nominatim.openstreetmap.org/**', lambda route: route.abort())
    page.goto(url, wait_until='networkidle')
    if page.locator('#locationIntroDismiss').is_visible(): page.locator('#locationIntroDismiss').click()
    page.locator('#exploreRoutesBtn').click()
    page.locator('.route-blue').get_by_role('button', name='Full route', exact=True).click()
    expect(page.locator('#routeStatus')).to_contain_text('Choose a starting point')
    assert page.evaluate('window.culturalLocationRequests') == 0, 'Opening a Cultural Route requested GPS'
    page.locator('#startNavBtn').click()
    page.locator('#startNavBtn').click()
    assert page.evaluate('window.culturalLocationRequests') == 1, 'Repeated Start requested duplicate GPS'
    page.locator('#plannerBack').click()
    page.evaluate('window.completeCulturalLocation()')
    expect(page.locator('#app')).to_have_attribute('data-stage', 'place')
    expect(page.locator('#navBanner')).to_be_hidden()
    expect(page.locator('.route-line')).to_have_count(0)
    print('PASS Cultural navigation: red mapped join, designated Blue source track, accurate closing-side GPS handoff without false arrival, original export, repeated/cancelled Start')
    context.close()

def review_action_contrast(browser, url):
    ctx = browser.new_context(viewport={'width':390,'height':844}, service_workers='block',
                              permissions=['geolocation'], geolocation={'latitude':52.0467,'longitude':-.7378,'accuracy':5})
    page = ctx.new_page()
    page.set_default_timeout(30000)
    page.goto(url, wait_until='networkidle')
    for system in ['light', 'dark']:
        page.emulate_media(color_scheme=system)
        for choice in ['light', 'dark', 'high-contrast', 'system']:
            page.locator('#visibleSettingsBtn').click()
            page.locator(f'[data-theme-choice="{choice}"]').click()
            page.locator('#closeSettings').click()
            page.locator('#homeSearch').fill('52.025,-0.783')
            page.locator('#homeSearchSubmit').click()
            page.locator('.result-item').first.click()
            assert_action_contrast(page, '#directionsBtn')
            page.locator('#directionsBtn').click()
            upload(page, gpx(POINTS))
            assert_action_contrast(page, '#startNavBtn')
            page.locator('#startNavBtn').click()
            assert_action_contrast(page, '#exitNavBtn')
            page.locator('#exitNavBtn').click()
            page.locator('#plannerBack').click()
    print('PASS action contrast: Directions, Start and Exit in all themes on light/dark systems')
    ctx.close()

def review_search_recovery(page, url):
    """Empty MK searches and denied/slow GPS retain manual, local recovery."""
    page.goto(url, wait_until='networkidle')
    if page.locator('#locationIntroDismiss').is_visible():
        page.locator('#locationIntroDismiss').click()
    requests = []
    page.on('request', lambda request: requests.append(request.url)
            if 'nominatim.openstreetmap.org/search' in request.url else None)
    pattern = '**/nominatim.openstreetmap.org/search?*'
    def no_match(route):
        route.fulfill(status=200, json=[], headers={'Access-Control-Allow-Origin': '*'})
    page.route(pattern, no_match)
    page.evaluate('''() => {
        window.recoveryOriginalLocation = navigator.geolocation.getCurrentPosition;
        window.recoveryLocationRequests = 0; window.recoveryLocationError = 1;
        navigator.geolocation.getCurrentPosition = (_success, error) => {
            window.recoveryLocationRequests++;
            error({code:window.recoveryLocationError});
        };
    }''')
    try:
        page.locator('#browseLocateBtn').click()
        expect(page.locator('#browseLocationRecovery')).to_be_visible()
        expect(page.locator('#browseLocationMessage')).to_contain_text('Location access is off')
        page.locator('#searchWithoutLocationBtn').click()
        expect(page.locator('#browseLocationRecovery')).to_be_hidden()
        assert page.locator('#homeSearch').evaluate('(el) => el === document.activeElement')
        assert page.evaluate('window.recoveryLocationRequests') == 1
        def empty_search():
            page.locator('#homeSearch').fill('Unmapped recovery fixture')
            page.locator('#homeSearchSubmit').click()
            expect(page.locator('#resultsTitle')).to_have_text('No matching places')
            expect(page.locator('#resultsList')).to_contain_text('couldn’t find that in the MK map area')
        empty_search()
        before = len(requests)
        page.locator('.result-recovery-actions').get_by_role('button', name='Try a postcode', exact=True).click()
        assert page.locator('#homeSearch').evaluate('(el) => el === document.activeElement')
        assert len(requests) == before, 'Postcode recovery made a public request'
        empty_search()
        page.locator('.result-recovery-actions').get_by_role('button', name='Choose on map', exact=True).click()
        expect(page.locator('#resultsTitle')).to_have_text('Choose a point on the map')
        page.locator('#closeResults').click()
        page.locator('#map').click(position={'x':page.viewport_size['width'] / 2, 'y':page.viewport_size['height'] * .4})
        expect(page.locator('#placeSheet')).to_be_hidden()
        empty_search()
        page.locator('.result-recovery-actions').get_by_role('button', name='Choose on map', exact=True).click()
        before = len(requests)
        page.locator('#map').click(position={'x':page.viewport_size['width'] / 2, 'y':page.viewport_size['height'] * .4})
        expect(page.locator('#placeSheet')).to_be_visible()
        expect(page.locator('#placeName')).to_have_text('Dropped pin')
        expect(page.locator('#placeAddress')).to_contain_text(re.compile(r'52\.\d+'))
        assert len(requests) == before, 'Choosing an explicit point made a public search'
        assert page.evaluate('window.recoveryLocationRequests') == 1
        plan(page, '52.0467,-0.7378', '52.025,-0.783')
        expect(page.locator('#routeStatus')).to_have_text('Route ready')
        location_before_retry = page.evaluate('window.recoveryLocationRequests')
        page.evaluate('window.recoveryLocationError = 3')
        page.locator('#useLocationBtn').click()
        expect(page.locator('#routeStatus')).to_have_text('Your location is taking a while. Search for a starting address or postcode instead.')
        assert page.evaluate('window.recoveryLocationRequests') == location_before_retry + 1
        page.locator('#plannerBack').click()
        print(f'PASS search recovery {page.viewport_size["width"]}x{page.viewport_size["height"]}: postcode edit, bounded map pick/cancel, denied/timeout GPS and no automatic location retries')
    finally:
        page.unroute(pattern, no_match)
        page.evaluate('''() => {
            navigator.geolocation.getCurrentPosition = window.recoveryOriginalLocation;
            delete window.recoveryOriginalLocation;
        }''')

def review(browser, url):
    for width, height in [(390,844),(844,390),(1280,900)]:
        ctx = browser.new_context(viewport={'width':width,'height':height}, color_scheme='dark', accept_downloads=True, service_workers='block',
                                  permissions=['geolocation'],geolocation={'latitude':52.0467,'longitude':-.7378,'accuracy':5})
        page=ctx.new_page();page.set_default_timeout(30000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(url,wait_until='networkidle')
        expect(page.locator('html')).to_have_attribute('data-routing-source','bundled')
        # Explicit themes must override the opposite OS scheme, including old
        # iOS fallback surfaces that otherwise leave white-on-white controls.
        page.locator('#visibleSettingsBtn').click()
        for system in ['light', 'dark']:
            page.emulate_media(color_scheme=system)
            for choice in ['light', 'dark', 'high-contrast', 'system']:
                page.locator(f'[data-theme-choice="{choice}"]').click()
                effective = system if choice == 'system' else choice
                expect(page.locator('html')).to_have_attribute('data-theme', effective)
                expected = {'light':'rgb(255, 255, 255)', 'dark':'rgb(21, 25, 30)', 'high-contrast':'rgb(0, 0, 0)'}[effective]
                for selector in ['.settings-sheet > .sheet-heading', '#offlineDownloadBtn']:
                    colours = page.locator(selector).evaluate('(el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color]; }')
                    assert colours[0] == expected, (system, choice, selector, colours)
                    assert colours[0] != colours[1], (selector, colours)
                # Selected settings and About text must stay readable in explicit
                # dark mode even when the operating system is light (and vice versa).
                accent = 'rgb(169, 37, 29)' if effective == 'light' else 'rgb(255, 138, 128)'
                for selector in ['.theme-choice button.active', '.unit-choice button.active']:
                    assert page.locator(selector).evaluate('(el) => getComputedStyle(el).color') == accent
                about_color = page.locator('#aboutData').evaluate('(el) => getComputedStyle(el).color')
                assert about_color == {'light':'rgb(32, 32, 32)', 'dark':'rgb(243, 244, 246)', 'high-contrast':'rgb(255, 255, 255)'}[effective]
                # Search prompts must remain readable when the explicit theme
                # differs from the operating system's colour scheme.
                for selector in ['#homeSearch', '#startSearch', '#endSearch']:
                    placeholder = page.locator(selector).evaluate('(el) => getComputedStyle(el, "::placeholder").color')
                    assert contrast_ratio(placeholder, expected) >= 4.5, (system, choice, selector, placeholder, expected)
        page.locator('#closeSettings').click()
        review_local_place_search(page, url, screenshots=True, with_location=True)
        review_search_recovery(page, url)
        # Local typing never sends a public geocoder request.
        requests=[];page.on('request',lambda r: requests.append(r.url) if 'nominatim.openstreetmap.org/search' in r.url else None)
        page.locator('#homeSearch').fill('Portway')
        expect(page.locator('.typeahead-item').first).to_be_visible()
        assert not requests
        page.locator('#homeSearch').fill('')
        # Loading Explore must work even if the external source rejects CORS or
        # becomes unavailable. It must never hand GPX loading to a blank browser.
        page.route('**/getaroundmk.org.uk/**/*.gpx',lambda route:route.abort())
        review_cultural_tracks(page, url, screenshots=True)
        review_cultural_failure(page, url)
        page.locator('#exploreRoutesBtn').click()
        assert page.locator('.explore-filters button.active').evaluate('(el) => getComputedStyle(el).color') == 'rgb(92, 198, 138)'
        # The sticky handle must not cover Explore's header or Close control
        # after browsing the lower route cards.
        assert page.locator('#exploreSheet').evaluate('(el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; }') > 0
        assert page.locator('#closeExplore').evaluate('''(el) => {
            const rect = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }''')
        page.locator('#closeExplore').click()
        expect(page.locator('#exploreSheet')).to_be_hidden()
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
        # Filled action labels need normal-text contrast even in the
        # high-contrast theme, including mobile Start and desktop handoff.
        page.locator('#plannerBack').click()
        page.locator('#visibleSettingsBtn').click()
        page.locator('[data-theme-choice="high-contrast"]').click()
        page.locator('#closeSettings').click()
        assert_action_contrast(page, '#directionsBtn')
        page.locator('#directionsBtn').click()
        action = '#startNavBtn' if width < 900 else '#sendToPhoneBtn'
        assert_action_contrast(page, action)
        assert not errors,errors
        (ROOT/'test-results').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'test-results'/f'audit-{width}.png'))
        print(f'PASS audit {width}x{height}: ten Cultural Route source geometries/local failure recovery, GPX validation/security/export/mode/off-track and local suggestions/shared route')
        ctx.close()

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT/'dist')))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            url = os.environ.get('LIVE_URL') or f'http://127.0.0.1:{server.server_port}/'
            review_action_contrast(browser, url)
            review_saved_place_matrix(browser, url)
            review_cultural_navigation(browser, url)
            review(browser, url)
            browser.close()
    finally:server.shutdown()
if __name__=='__main__':main()
