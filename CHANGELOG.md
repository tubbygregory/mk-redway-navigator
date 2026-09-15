# Changelog

## 0.12.5

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

Integrate council geometry with permission confirmed by the project owner. Use Geofabrik Buckinghamshire data for local OSM builds and retain last-known-good data on source outages.

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
