# MK Redway Navigator

A proof-of-concept walking and cycling navigator for the Milton Keynes Redway network.

## v0.6 — full-viewport mobile shell + broad smartphone support

The interface now uses a map-first flow familiar from modern navigation apps rather than a permanent control panel:

**Search → place → Directions → route preview → Start → navigation**

Highlights:

- compact floating destination search over the map
- searches addresses, postcodes and place names within Milton Keynes
- route planner with searchable start and destination fields
- current-location start
- compact route preview with Cycle / Walk and Redway preference controls
- dedicated full-screen navigation mode
- heading-up navigation: the map rotates so your direction of travel stays at the top
- GPS heading with movement/route-direction fallback and smoothing
- adaptive portrait and landscape layouts across modern iPhone and Android screen sizes
- full dynamic-viewport shell with safe-area handling for notches, Dynamic Island and home/navigation indicators
- turn-by-turn manoeuvre banner
- spoken guidance using the browser speech engine
- live GPS progress, ETA and remaining distance
- automatic rerouting after moving materially off route
- recenter and voice controls
- iOS/Android safe-area and Home Screen/PWA support

The visual language is original to MK Redway Navigator; it uses the same general interaction model as established map apps rather than copying another app pixel-for-pixel.

## Routing features

- **Cycle / Walk** modes
- **Maximum Redway / Balanced / Fastest** cycling preferences
- Redway-biased A* routing in the browser
- distance, estimated time and percentage of route on traffic-free paths
- turn instructions generated from route geometry and OpenStreetMap way names
- GPS route-progress matching and off-route detection
- automatic rerouting using the already-loaded local route graph where possible

## Data and services

- Base map: OpenStreetMap
- Path/road data: OpenStreetMap via public Overpass API endpoints
- Address/place search: OpenStreetMap Nominatim
- Map renderer: Leaflet 1.9.4 + leaflet-rotate 0.2.4

Nominatim searches are only made when a user submits a search and the app rate-limits searches to roughly one request per second. Public OSM services are suitable for this small proof of concept, not a high-volume production service.

## Publish with GitHub Pages

1. Upload all files in this folder to the **root** of your GitHub repository.
2. Keep `.github/workflows/pages.yml`.
3. Commit the files to `main`.
4. In **Settings → Pages**, set the source to **GitHub Actions**.
5. Open **Actions → Deploy to GitHub Pages** and wait for the green tick.
6. Reload the Pages site. If an older version remains cached on iPhone, fully close/reopen it; if necessary remove and re-add the Home Screen app.

Typical URL:

`https://YOUR-USERNAME.github.io/mk-redway-navigator/`

## iPhone installation

Open the GitHub Pages URL in Safari and choose **Share → Add to Home Screen**. The installed PWA removes most Safari chrome and is the intended iPhone presentation.

Live navigation requires location permission. Voice guidance uses the browser's speech-synthesis support.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Browsers treat localhost as a secure context for development, but the deployed GitHub Pages HTTPS site is the better test for iPhone GPS behaviour.

## Proof-of-concept limitations

- Public Overpass/Nominatim servers can occasionally be slow or unavailable.
- Redway classification is inferred from OpenStreetMap tagging rather than an authoritative MK Council routing dataset.
- Turn instructions are derived from route geometry, not a production-grade manoeuvre engine such as Valhalla. Complex multi-branch Redway junctions therefore still need real-world testing.
- Browser/PWA background-location behaviour on iOS is more limited than a native iOS app, particularly with the screen locked.
- Temporary closures and hazards are not represented reliably.

For production, the next architectural step would be a verified Milton Keynes network plus a dedicated routing engine/backend such as Valhalla or GraphHopper.

## Mobile viewport compatibility (v0.6)

v0.6 removes the previous JavaScript root-height override that could leave a grey strip under the app in iOS standalone mode. The map shell now fills the CSS dynamic viewport (`100dvh`) while `visualViewport` is used only to keep search-result panels usable when an on-screen keyboard is open.

The responsive rules are designed around modern phone classes rather than one exact handset: roughly 320–600 CSS px portrait widths and phone landscape views up to 1100 px wide / 600 px high. Safe-area insets are honoured where exposed by iOS/Android browsers, and collapse to zero on devices without cut-outs.
