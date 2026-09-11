# MK Redway Navigator

A proof-of-concept walking and cycling router for the Milton Keynes Redway network.

The prototype deliberately prefers traffic-free shared paths and allows the user to choose how strongly ordinary roads should be penalised.

## v0.3 — iPhone 16 display optimisation

- iPhone 16 portrait layout tuned for its 393×852 CSS-pixel viewport
- Dynamic Island and Home Indicator safe-area handling
- map-first mobile layout with a scrollable, collapsible control sheet
- 44px+ touch targets and 16px search fields to avoid iOS input zoom
- iOS Safari visual-viewport resizing support for the keyboard/address bar
- Apple Home Screen metadata, 180px touch icon and iPhone 16 launch image

## Features

- Interactive Milton Keynes map
- Cycling and walking modes
- Maximum / Balanced / Fastest Redway preference
- Start/destination selection by address, postcode or tapping the map
- Current-location start over HTTPS
- Redway-biased A* routing in the browser
- Distance, estimated time and percentage of route on traffic-free paths
- Installable Progressive Web App (PWA)
- No API keys or backend required

## Data and services

- Base map: OpenStreetMap
- Path/road data: OpenStreetMap via public Overpass API endpoints
- Map renderer: Leaflet 1.9.4

This is a proof of concept, not a safety-certified navigation product. OpenStreetMap data may be incomplete or incorrect, and temporary closures/conditions are not represented reliably.

## Publish with GitHub Pages

1. Create a new public GitHub repository, for example `mk-redway-navigator`.
2. Upload all files from this folder to the repository root, including the `.github` folder.
3. Commit to the `main` branch.
4. Open **Settings → Pages** in the repository.
5. Under **Build and deployment → Source**, choose **GitHub Actions**.
6. The included workflow will publish the site automatically.
7. After the workflow completes, GitHub will show the public Pages URL.

Typical URL:

`https://YOUR-USERNAME.github.io/mk-redway-navigator/`

## Run locally

Because browser location and service workers require a secure context, use a local web server rather than opening `index.html` as a file.

Python:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080`

## Routing model

The prototype treats OpenStreetMap ways tagged with both `foot=designated` and `bicycle=designated` as Redway candidates. It also loads nearby paths and connecting roads and assigns different routing costs depending on mode and preference.

The three cycling profiles roughly mean:

- **Maximum** — major preference for Redway/traffic-free paths; road segments are expensive.
- **Balanced** — still prefers Redways, but accepts sensible road shortcuts.
- **Fastest** — mild Redway preference with more weight on total distance.

## Known proof-of-concept limitations

- Uses public Overpass servers directly, so routing can occasionally fail or be slow.
- Redway classification is inferred from OSM tagging rather than an authoritative council dataset.
- No turn-by-turn navigation yet.
- No live rerouting while moving.
- No temporary closure or hazard feed.
- Route calculations are limited to a corridor around the selected endpoints.

## Next steps

For a production version, move routing to a dedicated Valhalla/GraphHopper backend or bundle a verified MK graph, add turn-by-turn navigation, and validate the Redway classification against official GIS data.


## Geocoding

The proof of concept uses the public OpenStreetMap Nominatim search API only when the user explicitly submits an address or postcode. Searches are restricted to Milton Keynes and client-side requests are rate-limited to no more than about one per second. For a production-scale service, use a dedicated/self-hosted geocoder or a provider with suitable capacity and terms.
