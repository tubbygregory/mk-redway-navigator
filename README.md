# MK Redway Navigator v0.10.2

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

### Official MK route classification

The deployment build now treats **Get Around MK** as the authority for the route categories and the city's **13 Super Redway corridors**. The official corridor references are maintained in `scripts/official_route_rules.json` and matched onto OpenStreetMap geometry at build time. This means an incomplete OSM bicycle-route relation no longer creates a gap in a Super Redway where the underlying Redway runs alongside the corresponding H/V grid-road corridor.

The build distinguishes:

- **Super Redway** — the 13 official Get Around MK Super Route corridors, matched onto OSM Redway geometry using route relations, H/V references and grid-road corridor proximity.
- **Redway** — shared paths mapped with `foot=designated` and `bicycle=designated`, consistent with MK OSM mapping practice.
- **Leisure route** — OSM route metadata where available, using the same category terminology shown by the official Get Around MK interactive map.
- **Shared path** — other usable traffic-free/shared paths.
- ordinary/quiet/major roads remain separate routing classes.

Super Redways receive the strongest preference for cycling, followed by Redways, leisure routes and other shared paths. The map overlay uses different styling for the classified path types.

The public Get Around MK cycling map includes Ordnance Survey/Crown-copyright cartography and does not provide an openly reusable raw GIS download on the public page. For that reason this project **does not copy council/OS map geometry**: official classification facts come from Get Around MK, while routable geometry remains OpenStreetMap-derived.

### Offline Milton Keynes map + routing

GitHub Actions attempts to create `data/mk-basemap.pmtiles` from a recent Protomaps daily OpenStreetMap-derived vector basemap. The app normally displays that same-origin PMTiles map when available.

In **Saved → Offline Milton Keynes**, choose **Download** to keep the complete MK basemap, routing graph and app dependencies in browser storage. Once downloaded, map browsing, saved-place selection, route calculation and live navigation can work without a data connection.

Address/place search still uses Nominatim and therefore needs an internet connection. When offline, use a saved destination or tap the map.

The app does **not** bulk-download tiles from `tile.openstreetmap.org`; OSM's public raster tile service does not permit offline-prefetch features.



## v0.10.2 — direct Get Around MK map integration

With Milton Keynes City Council permission confirmed by the project owner, the build now reads the three official cycle-path layers directly from the Get Around MK interactive map. GitHub Actions opens the council map in headless Chromium, enables **Redway Super Routes**, **Redway Routes** and **Leisure Routes** independently, and saves the resulting official line classification as `data/council_routes.geojson`.

`build_network.py` then matches those official council lines onto the detailed OpenStreetMap routing topology. Council classification takes priority; OSM bicycle relations and the previous H/V Super Route corridor matcher remain fallback logic only. A last-known-good council extract is cached so a temporary council-site outage does not break deployment.

The deployment log should contain an **Extract official Get Around MK cycle-path layers** step followed by output similar to:

```text
Wrote data/council_routes.geojson: ... lines — {'super_redway': ..., 'redway': ..., 'leisure': ...}
Loaded ... official Get Around MK line features.
Official website geometry matched ... Super Redway, ... Redway and ... leisure OSM ways.
```

## v0.10.0 — official Get Around MK Super Route classification

The build now anchors Super Redway classification to the official Get Around MK 13-route network rather than trusting OSM relation naming alone. It recognises the official H/V route references and road-name aliases, uses mapped bicycle relations where present, and fills relation gaps by matching Redway geometry running alongside the corresponding grid-road corridor.

Official source pages:

- `https://getaroundmk.org.uk/cycling/where-to-ride/super-redways`
- `https://getaroundmk.org.uk/interactive-map`

The generated `network.json` is now format `mk-redway-network-v3` and records the classification sources and official route references used by the build.

## v0.9.3 — settings moved to the logo

The separate **Settings** map pill has been removed. Tap the **MK Redway logo at the left of the search bar** to open Settings. A one-time coachmark explains this on the first launch after updating to v0.9.3, then stores a local flag so it does not appear again on that browser/device.

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
- Super Redway classification now uses the official Get Around MK 13-corridor designation matched to OSM geometry. Leisure-route geometry still depends on reusable OSM metadata because the public council map does not expose an open raw GIS layer.
- Browser/PWA background GPS on iOS remains more restricted than a native iOS navigation app.
- Nominatim place/address search is online-only.


## v0.9.1 — reliable spoken navigation

Voice guidance is now initialised synchronously from the **Start** button tap so it satisfies iOS user-activation requirements. Spoken prompts use a persistent queue instead of cancelling the Web Speech synthesizer for every instruction. Navigation announces an advance warning and a junction instruction, plus rerouting and arrival messages. The speaker button can re-initialise speech after iOS has suspended the PWA.

On iOS Home Screen web apps, keep the app in the foreground for reliable spoken guidance; iOS/WebKit can suspend web-app audio when backgrounded or the screen is locked.


## v0.10.2 routing-build reliability

The routing build no longer uses public Overpass servers for its normal OSM refresh. GitHub Actions downloads Geofabrik's small Buckinghamshire OSM PBF extract, parses it locally with pyosmium, and then matches the official Get Around MK route layers onto that graph. The extract is cached between builds. This avoids intermittent Overpass 504s, DNS failures and mirror certificate problems.

If the Geofabrik refresh itself is unavailable, the last valid `data/network.json` remains the fallback.
