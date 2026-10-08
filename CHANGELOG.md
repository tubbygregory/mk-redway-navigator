# Changelog

## 0.14.9

- Turn the favourite action red and label it Saved when the selected destination is already saved; synchronise after removal, reselection and reload.
- Add explicit map-pin selection and cancellation for Home, Work and favourites, with controls to change existing Home/Work locations.
- Persist Saved changes transactionally, report storage failures honestly, validate stored records and avoid silently losing favourites at the capacity boundary.
- Calculate a walking/cycling joining leg to a Cultural Route in the app's standard red, retaining the source GPX track in its designated colour and transferring guidance at the join.
- Preserve source geometry, generic GPX behaviour and safe GPS/cancellation handling; explain connector failures rather than substituting an invented link.
- Increase small Saved/Explore touch targets, restore clear keyboard focus and record the full rendered UX review in UX-REVIEW-2026-10-08-v0149.md.
- Reveal the route More menu immediately on short screens instead of opening it below the visible panel.
- Prevent status toasts and long-press release clicks from intercepting or accidentally activating controls.

## 0.14.8

- Add a compact, source-attributed MK place/address index for local suggestions and offline searches; typing still makes no Nominatim requests.
- Match punctuation and possessive/plural variants locally, including the recorded Bannatynes search; retain mapped local matches when submitted online search is empty or unavailable.
- Preserve house numbers, distinct addresses and nearby branches, and keep search relevance ahead of distance.
- Reject malformed or out-of-coverage coordinates before displaying or selecting results; clear stale pins and cancel abandoned queued searches.
- Offer honest building matches for incompletely mapped addresses such as Huntley Crescent, without inventing house-number or entrance coordinates.
- Validate index provenance/schema, runtime-only packaging and real online/offline search interactions at root and subpath deployments.

## 0.14.7

- Load verified, unchanged Cultural Route GPX files from the app’s own site and precache them for offline Explore use.
- Replace the failed external GPX browser handoff with an in-app retry and import guidance that preserves the current route.
- Keep the destination panel above the bottom navigation so Explore remains reachable without clearing the destination.
- Label official shortcut files as segments, distinguish them from complete shorter rides in the guide, and preserve original source attribution and geometry.
- Validate source hashes, geometry and the published runtime assets; exercise all ten tracks online/offline at root and subpath deployments.

## 0.14.6

- Replace the approximate vector logo with the supplied stylised MK artwork, recoloured to the app's primary red while preserving its route, arrow, start dot and illustrated map.
- Regenerate favicon, Apple/PWA/maskable icons and the launch image with the existing sizing and safe-area composition.
- Refresh versioned icon references and the shell cache so installed copies can receive the corrected artwork.
- Preserve red selected-route styling, navigation/offline fixes and installed-iPhone dark surfaces.

## 0.14.5

- Discard delayed pin lookups, submitted search results and GPX loads after their destination, query or screen changes.
- Cancel pending navigation starts when the selected route changes and preserve planned routes when initial GPS accuracy is poor.
- Keep online shell, routing and basemap requests working when browser cache storage is unavailable.
- Validate complete PMTiles downloads and existing cached maps before reporting offline readiness; distinguish connection failures from missing deployment data.
- Restore turn instructions at one-way forks and turning tunnel entries while retaining underpass context and unlit warnings.
- Exclude mapped bridges from estimated road crossings and align producer/consumer numeric validation without changing routing weights or the v6 schema.
- Keep Explore's Close control reachable while scrolling and improve placeholder and primary-button contrast in explicit themes.
- Display the selected route in the app's primary red in both planning and navigation.
- Adopt the newly supplied MK route-map logo, match its route mark to the app's primary red, and regenerate favicons, Apple/PWA/maskable icons and the launch image.
- Repair the branding-test syntax error introduced with the new logo so the deployment gates can run.
- Add focused regressions while preserving launcher sizing, installed-iPhone dark surfaces and all release gates.

## 0.14.4

- Align the Explore close button to the top-right of its header, with a 44px touch target.
- Shorten the default search placeholder to “Search places” on initial load, resize and after saving a place.

## 0.14.3

- Fixed low-contrast About/Data text and selected controls in dark mode, including explicit appearance overrides.
- Fixed offline opening of previously unseen shared route links at both root and subpath installations.
- Keep the routing graph across app-shell updates and fall back to it on network or HTTP failures; avoid caching failed assets.
- Cancel delayed navigation starts after leaving the planner or replacing the route, prevent duplicate pending starts, and ignore inaccurate GPS fixes for guidance/rerouting.
- Guard basemap load events/timeouts against replacing a newer layer and discard stale live-routing responses.
- Validate routing data before reporting offline downloads complete and preserve useful download error messages.
- Reject malformed network nodes/ways in the browser and serialize concurrent submitted/reverse geocoder request slots.
- Added focused service-worker, navigation-state and browser regressions. Retained the fitted MKRW logo and existing routing weights/schema.

## 0.14.2

- Refine the MKRW roundabout mark for small app-icon and search-bar use with more internal breathing room and no white launcher border.
- Export an opaque full-bleed Apple touch icon, a dedicated full-bleed maskable icon with the essential mark inside the platform safe zone, and refreshed standard/favicons.
- Replace the raster About wordmark with the live vector mark plus theme-aware text, and bump the service-worker shell so existing installs can pick up the new branding.


## 0.14.1

- Adopt the approved MKRW roundabout identity across the app, install icon, launch screen and About wordmark.
- Add scalable SVG, 16/32px PNG and multi-size ICO favicons; provide a separate maskable icon with a safe central mark.
- Version icon URLs and refresh the shell cache so existing installations can obtain the new artwork.

## 0.14.0

- Fix explicit Dark and High Contrast Settings/download surfaces independently of the device theme; verify all appearance choices against both OS schemes.
- Implement the practical October design-review improvements; see `REVIEW-AUDIT.md` for verified scope and deliberate limitations.
- Add local type-ahead suggestions, numbered search-result pins and favourite shortcut chips without using the public Nominatim service for autocomplete.
- Add Explore MK with the five Get Around MK Cultural Routes and official full/short GPX source links.
- Add GPX import/export and shareable route links for sending a planned journey to a phone.
- Add mapped underpass, road-crossing and unlit-distance summaries, with optional lighting-aware and Super Route-aware cycling preferences.
- Add H/V grid-road context to mapped underpass instructions, named Super Route labels, roundabout/U-turn guidance and warnings before mapped unlit stretches.
- Add automatic after-sunset navigation dark mode, explicit light/dark/high-contrast appearance choices, and move offline-map management from Saved into Settings.
- Add a first-run location explanation and explicit opt-in control, plus route alternatives with time labels directly on the map.
- Bump the generated routing-data format to v6 so the new underpass and route metadata is rebuilt and validated.

- Final validation: reject malformed/out-of-range GPX, treat imported labels as text, preserve imported geometry across mode changes, disclose unknown route conditions, and transfer imported tracks as GPX files.
- Correct the A* lower bound for combined optional preferences without changing routing weights; respect bicycle-specific direction and implicit roundabout one-way rules.
- Count contiguous mapped crossing ways, label short-road-link estimates, and preserve unlit warnings at underpasses.

## 0.13.1

- Fix the bright white Saved control in system dark mode.
- Make the installed iOS bottom-edge viewport blend follow the active dark theme instead of fading to white.
- Keep offline/settings auxiliary surfaces on dark theme tokens.
- Add a dedicated installed-iOS dark-mode regression check.

## 0.13.0

- Apply the October mobile/desktop design review: long-press map pins, persistent map search, visible settings, browse-time location controls and a map-key layers button.
- Replace incomplete route-mix summaries with a five-category 100% stacked mix, merge duplicate cycling alternatives, hide the redundant walking preference and reduce minor approach warnings.
- Make route preview map-first with a mobile peek state, move secondary route actions behind More, simplify Saved, and move installation into Settings.
- Improve destination context and search-result comparison with deduplication, place type and distance where location is known.
- Add system dark mode, a dark packaged basemap flavour, a branded navigation banner, SVG maneuver/search icons, and time-remaining-first navigation status.
- Remove duplicate map attribution during basemap handover, expose desktop zoom/scale controls, and provide separate path-problem and app-problem report links.

## 0.12.6

- Remove unsupported council data-use claims while retaining source attribution and the independent-project notice.
- Add a concise route/navigation bug-report template with a privacy reminder.
- Prepare the first formal beta release; navigation behaviour remains unchanged.

## 0.12.5

- Check for updates when the app resumes or reconnects; provide a Settings update check and explicit reload without interrupting navigation.
- Show the running app version and bypass the HTTP cache when installing a new app shell.

- Prevent delayed current-location responses from replacing a manually searched starting point or interrupting endpoint searches.
- Cancel obsolete location requests when leaving the planner or moving the start pin.
- Preserve endpoint search text while results are open and verify delayed-location behaviour in mobile browser tests.

## 0.12.4

- Make every panel handle support swipe, tap and keyboard collapse/expand: search results, destination, route, Saved, Settings and installation.
- Keep panel titles or route summaries visible when collapsed and expand panels when reopened.
- Verify every handle using touch input in mobile browser release checks.

## 0.12.3

- Give starting-point and destination search an unobstructed view and explicit search buttons.
- Prevent dismissed or superseded search responses from reopening results.
- Make the route-panel handle work with swipe gestures, taps and keyboard activation.

## 0.12.2

- Keep the navigation location marker anchored while heading-up rotation settles; verify its screen position in browser gates.
- Keep the shorter search placeholder after viewport updates.
- Display calendar-only map dates without timezone shifts and identify the downloaded map’s own build date.

## 0.12.1

- Fix journey-time wrapping, landscape map-button overlap and undersized tap targets found in the live mobile review.
- Make map attribution readable and keep it clear of controls.
- Simplify route-preview copy and retain explicit unverified-approach information.
- Require all six council source files when validating cached classification data.

## 0.12.0

- Publish a validated browser-only Pages artifact.
- Self-host version-pinned browser dependencies and pin Python build dependencies.
- Record runtime data provenance, hashes and cache/fallback status.
- Validate council source identity, category counts, cached extracts and network structure.
- Add Settings → About & Data, privacy information and project links.
- Reduce background-network emphasis by zoom level and use consistent saved-place SVG icons.
- Replace historical README notes with current project documentation; remove obsolete workflow and bytecode.

## 0.11.0

- Accept network v5 in the frontend and gate deployment on browser loading.
- Honour all three council classifications while preserving access restrictions.
- Snap endpoints to segments with directed edge handling; block gaps above 150 metres.
- Include unverified approach distances and times; provide entrance-pin adjustment.
- Compare cycling preferences and road share, improve turn prompts and arrival checks.
- Add routing regressions and desktop/mobile browser smoke tests.
- Read the six verified council KML/KMZ sources directly. The reviewed leisure data contains about 150,000 short fragments; earlier 80,000-line limits were superseded.

## 0.10.4

Historical extraction-contamination and matching-performance safeguards. Earlier extraction limits and browser-capture descriptions are superseded by the direct-source pipeline.

## 0.10.3

Parse council KML/KMZ sources instead of interpreting Google internal vector traffic.

## 0.10.2

Integrate council geometry. Use Geofabrik Buckinghamshire data for local OSM builds and retain last-known-good data on source outages.

## 0.10.0

Introduce official Super Redway corridor identifiers and OSM corridor matching.

## 0.9.3

Move Settings into the search-bar logo with a first-run coachmark.

## 0.9.2

Add persistent voice and distance-unit settings.

## 0.9.1

Improve spoken guidance activation and prompt queuing on iOS.

## 0.9

Add local saved places, downloadable Milton Keynes mapping and PWA installation support.
