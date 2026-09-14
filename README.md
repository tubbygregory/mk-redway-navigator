# MK Redway Navigator v0.9.2

Installable GitHub Pages proof of concept for Redway-first walking and cycling navigation in Milton Keynes.

## Core features

- Search by place, address or postcode.
- Walking and cycling route profiles.
- Maximum Redway / Balanced / Fastest preferences.
- Locally hosted MK routing graph generated during deployment.
- Multi-point network snapping to avoid isolated-path routing failures.
- Live GPS navigation, heading-up map, spoken turn instructions and automatic rerouting.
- Responsive portrait/landscape PWA interface.
- Home Screen / PWA installation helper.

## Existing v0.9 features

### Saved places

Home, Work and up to 30 favourites are stored locally in the browser using `localStorage`; no account or server is involved. Open **Saved** from the main map. Home/Work can be set by search or by tapping a point on the map; selected destinations can be saved directly as favourites.

### Better MK route classification

The deployment build distinguishes:

- **Super Redway** — best-effort from OSM bicycle-route relations explicitly identifying Super Redways/Super Routes.
- **Redway** — shared paths mapped with `foot=designated` and `bicycle=designated`, consistent with MK OSM mapping practice.
- **Leisure route** — best-effort from named local leisure/cultural bicycle-route relations.
- **Shared path** — other usable traffic-free/shared paths.
- ordinary/quiet/major roads remain separate routing classes.

Super Redways receive the strongest preference for cycling, followed by Redways, leisure routes and other shared paths. The map overlay uses different styling for the classified path types.

### Offline Milton Keynes map + routing

GitHub Actions attempts to create `data/mk-basemap.pmtiles` from a recent Protomaps daily OpenStreetMap-derived vector basemap. The app normally displays that same-origin PMTiles map when available.

In **Saved → Offline Milton Keynes**, choose **Download** to keep the complete MK basemap, routing graph and app dependencies in browser storage. Once downloaded, map browsing, saved-place selection, route calculation and live navigation can work without a data connection.

Address/place search still uses Nominatim and therefore needs an internet connection. When offline, use a saved destination or tap the map.

The app does **not** bulk-download tiles from `tile.openstreetmap.org`; OSM's public raster tile service does not permit offline-prefetch features.


## v0.9.2 — voice and distance settings

A new **Settings** sheet adds persistent controls for:

- **Voice guidance** — turn spoken instructions on or off. The navigation speaker button stays in sync with this preference. Re-enabling voice from Settings or navigation also provides the direct user gesture iOS may require to restart speech.
- **Distance units** — choose **Metric (km / m)** or **Miles & yards (mi / yd)**. The choice applies to route length, remaining distance, turn-distance banners, route snap distances and spoken advance instructions.

Settings are stored locally with `localStorage`; no account or server is involved.

## Deploy

1. Upload the contents of this project to the root of your GitHub repository.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Commit to `main`.
4. Open **Actions → Deploy to GitHub Pages**.
5. The first v0.9 deployment has two data-build steps:
   - `Build current MK routing network`
   - `Build offline Milton Keynes basemap`
6. Both data steps are resilient: if a refresh fails and a previous cached file exists, the previous file is kept. If the PMTiles build fails on the very first deployment, online mapping still works and the Offline button reports that the package is unavailable.

The PMTiles extract may add several minutes to a cold deployment. GitHub Actions caches it and the build script refreshes it roughly monthly.

## Data and attribution

Routing and basemap data are derived from OpenStreetMap. Keep the visible **© OpenStreetMap contributors** attribution in the app. The Protomaps basemap is distributed as an ODbL Produced Work and is suitable for a self-hosted/offline extract with attribution.

See `DATA-LICENCE.md`.

## Proof-of-concept limitations

- Saved places are device/browser-local and do not sync between devices.
- Super Redway and leisure-route classification depends on what has been mapped in OpenStreetMap route relations; the normal Redway classification remains available even where relation metadata is incomplete.
- Browser/PWA background GPS on iOS remains more restricted than a native iOS navigation app.
- Nominatim place/address search is online-only.


## v0.9.1 — reliable spoken navigation

Voice guidance is now initialised synchronously from the **Start** button tap so it satisfies iOS user-activation requirements. Spoken prompts use a persistent queue instead of cancelling the Web Speech synthesizer for every instruction. Navigation announces an advance warning and a junction instruction, plus rerouting and arrival messages. The speaker button can re-initialise speech after iOS has suspended the PWA.

On iOS Home Screen web apps, keep the app in the foreground for reliable spoken guidance; iOS/WebKit can suspend web-app audio when backgrounded or the screen is locked.
