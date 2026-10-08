# MK Redway Navigator

Walking and cycling navigation for Milton Keynes, with a preference for the Redway network. An installable, independent web app currently in beta.

**[Open MK Redway Navigator — mkredway.co.uk](https://mkredway.co.uk)**

## What it does

Plan a journey around Milton Keynes, compare cycling routes and follow location-based instructions. No account is required.

## Key features

- Cycling preferences: Maximum Redway, Balanced and Fastest; separate walking mode, plus optional preferences for mapped lighting and named Super Routes.
- Route previews with distance, estimated time, complete route mix, road share, mapped underpasses/crossings/unlit distance and alternative-route labels on the map.
- Live navigation, spoken guidance, automatic rerouting, H/V grid-road underpass wording and low-glare night mode.
- Home, Work and favourites saved on this device, with quick shortcuts and local MK street, place and address suggestions.
- Explore MK cards for the five Get Around MK Cultural Routes, with source-verified full loops and shortcut GPX tracks available inside the app and offline, plus official route-guide links. Shortcut files are segments, not complete shorter loops.
- GPX import/export and shareable planned-route links for moving a route from desktop to phone.
- Downloadable Milton Keynes map and routing data managed from Settings.
- Map key and current-location controls available while browsing.
- Mobile portrait/landscape layouts, desktop planning controls, explicit appearance choices and Home Screen installation.

## Routing philosophy

OpenStreetMap supplies connected topology and access restrictions. Council route classifications influence preferences; they do not establish legal access. Maximum Redway favours classified paths, Balanced trades preference against distance, and Fastest prioritises estimated travel time.

Endpoints snap to usable path segments while retaining one-way restrictions. Gaps up to 150 metres are shown as unverified approaches and included in estimates; larger gaps block navigation. Choose the actual entrance when a destination pin is away from a path. Estimates cannot account for every closure, surface condition or crossing.

## Official MK route classification

The build reads six explicitly selected Get Around MK KML/KMZ sources for Super Redway, Redway and Leisure Route geometry, then matches them onto OSM ways. Earlier extraction approaches risked collecting unrelated map traffic; the current extractor uses only the intended source files and validates their classes and feature counts.

Council classifications take priority where matched. OSM tags, route relations and official corridor rules provide fallback classifications elsewhere. Validated cached data can be retained during source outages. About & Data and the build metadata identify this state.

## Offline operation

Choose **Settings → Offline Milton Keynes → Download** before leaving signal. Saved destinations, map browsing and local routing work offline after the required files are cached. The app also bundles mapped MK places and addresses for local suggestions and offline search. Submitted online searches add results from Nominatim, within the same MK bounds; typing sends no geocoding requests.

Address coverage follows OpenStreetMap and is incomplete. Exact mapped house numbers are kept distinct. Building/street matches are labelled as approximate when a requested house number is missing; their coordinates do not establish an entrance. Check the map and choose the actual entrance. The supported map area is not the entire council boundary or every postcode beginning with MK.

Browser storage can be evicted or cleared. iOS can suspend GPS and speech when the app is backgrounded or the screen is locked.

## Architecture

- `index.html`, `styles.css`, `app.js`: interface, map and navigation lifecycle.
- `routing.js`: shared routing engine used by the browser and regression tests.
- `about.js`: independent data and privacy presentation.
- `sw.js`: app-shell caching and offline PMTiles range responses.
- `scripts/`: council extraction, OSM network generation, basemap extraction and validated site packaging.
- `data/data-meta.json`: generated runtime provenance, format, hashes and freshness.
- `data/places.json`: generated MK-only OpenStreetMap place/address index with source identity, coordinates and location precision; no raw extract is deployed.
- `dist/`: generated browser-only deployment artifact.

Leaflet, Leaflet Rotate and Protomaps Leaflet are version-pinned and self-hosted in the deployed artifact. The app shell makes no runtime request to unpkg.

The remaining map/navigation lifecycle stays together deliberately. Further extraction of search, storage and voice modules should be incremental and retain browser regression coverage.

## Data sources and attribution

Official classification: Milton Keynes City Council / Get Around MK. Routing: © OpenStreetMap contributors, supplied through Geofabrik. Basemap: Protomaps and its upstream data contributors.

See [DATA-LICENCE.md](DATA-LICENCE.md) for source links and licensing boundaries. This is not an official Milton Keynes City Council service.

## Development / local testing

Use Python 3.12, Node.js and Docker (for basemap extraction).

```sh
python3 -m pip install -r requirements.txt
python3 -m playwright install --with-deps chromium
python3 scripts/extract_council_routes.py
python3 scripts/build_network.py
python3 scripts/build_places.py
bash scripts/build_offline_map.sh
python3 scripts/build_site.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/routing.test.cjs
python3 tests/browser_smoke.py
python3 -m http.server 8000 --directory dist
```

Data generation requires internet access and can take several minutes. Generated data, downloads and Python caches are not committed. Runtime dependency downloads occur during packaging, not in the user's browser.

## Deployment

`.github/workflows/pages.yml` builds and validates data, packages an explicit runtime allowlist into `dist/`, runs routing/browser release gates, and publishes that directory to GitHub Pages. A failed gate prevents publication, leaving the previous deployment available.

Use GitHub Actions as the Pages source. Runtime paths are relative so a project subpath and custom-domain root can use the same artifact. Source-only files and council diagnostics are excluded from Pages; diagnostics are separate Actions artifacts.

## Known limitations

- MK coverage is bounded; this is not a national route planner.
- Mapping and council classifications can be incomplete or older than current conditions.
- Online geocoding depends on an external service; local mapped places and addresses remain available offline.
- Saved places stay in one browser; there is no account or cloud sync.
- Browser emulation cannot establish real-world GPS, speech, battery or iOS background behaviour.

## Licence

Application code is [MIT licensed](LICENSE). Data and bundled third-party libraries retain their own licences; the MIT licence does not relicense them. See [data documentation](DATA-LICENCE.md) and [CHANGELOG.md](CHANGELOG.md).
