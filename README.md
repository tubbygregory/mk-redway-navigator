# MK Redway Navigator

Walking and cycling navigation for Milton Keynes, with a preference for the Redway network. An installable, independent web app currently in beta.

**[Open MK Redway Navigator — mkredway.co.uk](https://mkredway.co.uk)**

## What it does

Plan a journey around Milton Keynes, compare cycling routes and follow location-based instructions. No account is required.

## Key features

- Cycling preferences: Maximum Redway, Balanced and Fastest; separate walking mode.
- Route previews with distance, estimated time and road share.
- Live navigation, spoken guidance and automatic rerouting.
- Home, Work and favourites saved on this device.
- Downloadable Milton Keynes map and routing data.
- Mobile portrait/landscape layouts and Home Screen installation.

## Routing philosophy

OpenStreetMap supplies connected topology and access restrictions. Council route classifications influence preferences; they do not establish legal access. Maximum Redway favours classified paths, Balanced trades preference against distance, and Fastest prioritises estimated travel time.

Endpoints snap to usable path segments while retaining one-way restrictions. Gaps up to 150 metres are shown as unverified approaches and included in estimates; larger gaps block navigation. Choose the actual entrance when a destination pin is away from a path. Estimates cannot account for every closure, surface condition or crossing.

## Official MK route classification

The build reads six explicitly selected Get Around MK KML/KMZ sources for Super Redway, Redway and Leisure Route geometry, then matches them onto OSM ways. It does not treat generic Google Maps rendering traffic as council routes.

Council classifications take priority where matched. OSM tags, route relations and official corridor rules provide fallback classifications elsewhere. Validated cached data can be retained during source outages. About & Data and the build metadata identify this state.

## Offline operation

Choose **Saved → Offline Milton Keynes → Download** before leaving signal. Saved destinations, map browsing and local routing work offline after the required files are cached. Address/place searches use Nominatim and require connectivity; use saved places, coordinates or a map pin offline.

Browser storage can be evicted or cleared. iOS can suspend GPS and speech when the app is backgrounded or the screen is locked.

## Architecture

- `index.html`, `styles.css`, `app.js`: interface, map and navigation lifecycle.
- `routing.js`: shared routing engine used by the browser and regression tests.
- `about.js`: independent data and privacy presentation.
- `sw.js`: app-shell caching and offline PMTiles range responses.
- `scripts/`: council extraction, OSM network generation, basemap extraction and validated site packaging.
- `data/data-meta.json`: generated runtime provenance, format, hashes and freshness.
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
- Online geocoding depends on an external service.
- Saved places stay in one browser; there is no account or cloud sync.
- Browser emulation cannot establish real-world GPS, speech, battery or iOS background behaviour.

## Licence

Application code is [MIT licensed](LICENSE). Data and bundled third-party libraries retain their own licences; the MIT licence does not relicense them. See [data documentation](DATA-LICENCE.md) and [CHANGELOG.md](CHANGELOG.md).
