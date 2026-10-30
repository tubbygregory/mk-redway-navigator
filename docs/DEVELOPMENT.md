# Developer guide

For a guide to using MK Redway Navigator, start with the [README](../README.md). This document covers the routing data, project structure, local checks, advertising configuration and deployment.

Run the commands below from the repository root.

## Routing philosophy

OpenStreetMap supplies connected topology and access restrictions. Council route classifications influence preferences; they do not establish legal access. Maximum Redway favours classified paths, Balanced trades preference against distance, and Fastest prioritises estimated travel time.

Endpoints snap to usable path segments while retaining one-way restrictions. Gaps up to 150 metres are shown as unverified approaches and included in estimates; larger gaps block navigation. Choose the actual entrance when a destination pin is away from a path. Estimates cannot account for every closure, surface condition or crossing.

## Official MK route classification

The build reads six explicitly selected Get Around MK KML/KMZ sources for Super Redway, Redway and Leisure Route geometry, then matches them onto OSM ways. Earlier extraction approaches risked collecting unrelated map traffic; the current extractor uses only the intended source files and validates their classes and feature counts.

Council classifications take priority where matched. OSM tags, route relations and official corridor rules provide fallback classifications elsewhere. Validated cached data can be retained during source outages. About & Data and the build metadata identify this state.

## Architecture

- `index.html`, `styles.css`, `app.js`: interface, map and navigation lifecycle.
- `navigation-icons.js`: local vector map-marker artwork and validated icon choices.
- `routing.js`: shared routing engine used by the browser and regression tests.
- `about.js`: independent data and privacy presentation.
- `sw.js`: app-shell caching and offline PMTiles range responses.
- `scripts/`: council extraction, OSM network generation, basemap extraction and validated site packaging.
- `data/data-meta.json`: generated runtime provenance, format, hashes and freshness.
- `data/places.json`: generated MK-only OpenStreetMap place/address index with source identity, coordinates and location precision; no raw extract is deployed.
- `dist/`: generated browser-only deployment artifact.

Leaflet, Leaflet Rotate and Protomaps Leaflet are version-pinned and self-hosted in the deployed artifact. The app shell makes no runtime request to unpkg.

The remaining map/navigation lifecycle stays together deliberately. Further extraction of search, storage and voice modules should be incremental and retain browser regression coverage.

## Advertising

The app loads Google AdSense asynchronously for publisher `ca-pub-8404673257565926`. Advertising is an online dependency and is not part of the offline package. About & Data explains Google advertising, cookies or identifiers, page URLs and advertising choices. Shared-route URLs can contain journey coordinates.

One responsive display unit (`7271687520`) appears after About & Data at the bottom of Settings, labelled “Advertisements”. It scrolls with the Settings content. `data-full-width-responsive="false"` [keeps it within the padded sheet](https://support.google.com/adsense/answer/9183460). The unit is requested once per page, only after the async bootstrap finishes and the slot is visible with a usable width. Hidden/collapsed Settings and offline/background states do not initiate it. The app does not request another ad when Settings reopens. No ad unit is placed on the route planning or navigation screen.

The root [`ads.txt`](../ads.txt) publishes Google's authorisation record for `pub-8404673257565926` and is included in the runtime Pages allowlist. Artifact/live PWA gates require a successful plain-text response and the matching publisher record. After deployment, use **Sites → mkredway.co.uk → Check for updates** in AdSense. [Google notes that recrawling can take a few days, or up to a month for low-traffic sites](https://support.google.com/adsense/answer/12171612); a live HTTP 200 does not establish that the account's status has refreshed.

The publisher must obtain site approval and configure advertising in AdSense. For personalised advertising to UK/EEA users, configure a [Google-certified consent management platform](https://support.google.com/adsense/answer/13554116), such as Google’s European regulations message under **Privacy & messaging**. The integration does not configure consent or guarantee ad delivery. No custom consent platform is added.

Browser request interception blocks the exact configured AdSense bootstrap URL, recording it separately where tests reject unexpected external traffic. WebKit also blocks external providers through a proxy guard, including controlled reloads that bypass interception. Those strict gates also record and block the existing numeric OpenStreetMap raster-tile fallback URLs; other destinations and paths remain unexpected. This isolates provider-driven content while retaining routing, location-permission and offline assertions. The browser smoke gate requires the publisher script and verifies route planning when its request is blocked. Provider-controlled ad rendering and placement need review in AdSense; the isolated gates do not validate live advertising content.

## Data sources and attribution

Official classification: Milton Keynes City Council / Get Around MK. Routing: © OpenStreetMap contributors, supplied through Geofabrik. Basemap: Protomaps and its upstream data contributors.

See [DATA-LICENCE.md](../DATA-LICENCE.md) for source links and licensing boundaries. This is not an official Milton Keynes City Council service.

The implemented design and friendliness review and remaining physical-device checks are recorded in [UX-REVIEW-2026-10-08-v01410.md](../UX-REVIEW-2026-10-08-v01410.md). The earlier [v0.14.9 review](../UX-REVIEW-2026-10-08-v0149.md) records the Saved and Cultural joining follow-up.

## Development / local testing

Use Python 3.12, Node.js and Docker (for basemap extraction).

```sh
python3 -m pip install -r requirements.txt
python3 -m playwright install --with-deps chromium webkit
python3 scripts/extract_council_routes.py
python3 scripts/build_network.py
python3 scripts/build_places.py
bash scripts/build_offline_map.sh
python3 scripts/build_site.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
python3 tests/browser_smoke.py
python3 tests/pwa_smoke.py
python3 tests/audit_browser.py
python3 tests/design_polish_browser.py
python3 tests/navigation_icons_browser.py
python3 tests/webkit_browser.py
git fetch --tags
python3 tests/release_upgrade_browser.py
python3 tests/offline_recovery_browser.py
python3 tests/navigation_permission_browser.py
python3 tests/accessibility_browser.py
python3 -m http.server 8000 --directory dist
```

The release-upgrade browser gate tests the newest numeric release tag older than `VERSION` and the oldest of the three newest prior tags, covering skipped releases; with less history it tests each available prior tag. Set `UPGRADE_FROM_REF` to test one specific older release. Each root/subpath case keeps two clients open, including real active navigation during the worker update. It reconstructs each release's tracked app shell and uses current validated geographic data and byte-matching vendor dependencies. It tests software/cache upgrades, rather than reconstructing historical geographic data. Fetch tags before running it.

The offline-recovery browser gate uses real HTTP header/body stalls, truncation and tab closure, then stops its origin to prove successful retry, offline routing and PMTiles range responses. It uses the production 30-second inactivity deadline; progressing downloads may take longer. The permission-recovery browser gate starts real Chromium geolocation and revokes permission through its browser permission controls, then requires an explicit restart after permission is restored. These checks do not establish physical iPhone background or speech behaviour.

The WebKit suite uses the actual Playwright WebKit engine. Its local offline cases stop the test server after caching, because WebKit's network-emulation switch can fail cached navigation even for a minimal independent service-worker app. A reserved, non-listening proxy blocks external providers while allowing the runtime host directly, including service-worker-controlled reloads that can bypass Playwright request interception. The suite rejects external HTTP responses and records full page-error stacks. Production WebKit checks validate the UI and offline cache; the live Chromium suite separately requires offline reloads. These checks cannot establish physical iPhone GPS, audio or background behaviour.

Data generation requires internet access and can take several minutes. Generated data, downloads and Python caches are not committed. Bundled map-library dependencies are downloaded during packaging. AdSense is loaded separately in the browser.

## Deployment

`.github/workflows/pages.yml` builds and validates data, packages an explicit runtime allowlist into `dist/`, runs routing/browser release gates, and publishes that directory to GitHub Pages. The existing release suites and actual-archive inspection remain required. Upgrade, WebKit, accessibility and offline/permission recovery jobs then test that same artifact in parallel; deployment waits for all of them. After deployment, the existing live review and new WebKit/accessibility checks must all pass before the immutable beta release is published.

Use GitHub Actions as the Pages source. Runtime paths are relative so a project subpath and custom-domain root can use the same artifact. Source-only files and council diagnostics are excluded from Pages; diagnostics are separate Actions artifacts.
