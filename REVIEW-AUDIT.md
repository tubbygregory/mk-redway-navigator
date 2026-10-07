# October 2026 review audit — v0.14.0

Source: “MK Redway Navigator Review.pdf”, design review dated 6 October 2026 (24 pages). PR #6 was already merged when the final audit began, at 3d33acec53952b162103921406f07a0518b8cdb4. Its build, deploy, live-review and beta-release jobs subsequently passed. This follow-up repairs issues found in the merged code; it does not replace validated functionality.

## Product recommendations

| Recommendation | Implementation and qualification |
|---|---|
| Long-press pin; persistent search | Existing map pointer/long-press handling and home search retained. Nearby reverse-geocoded name is best effort. |
| Complete mix; duplicate alternatives; walking label | Five categories sum to 100% for generated routes; duplicate alternatives merged; cycling controls hidden for walking. Imported tracks now show unknown conditions rather than invented shared-path percentages. |
| Browse location and first-run opt-in | Locate control and blue dot; first-run explanation; automatic location only when Permissions API reports granted. |
| Settings, map key, Saved, install | Visible Settings; layers/key control; Saved owns Home/Work/favourites; offline/install/update/About in Settings. |
| Map-first route sheet; More; navigation hierarchy | Existing peek/full sheet; secondary actions under More; time remaining prominent; red navigation banner. |
| Suggestions, distances, pins, favourites | Local graph/saved suggestions only; submitted Nominatim results separate; result pin and row call the same destination selection handler. |
| Desktop sidebar and phone handoff | Compact endpoint/mode/preference URL through Web Share or clipboard; no backend or remote QR service. Imported tracks share/export GPX rather than a misleading endpoint URL. |
| Appearance and night navigation | Light/dark/system/high contrast; temporary sunset state only in system navigation; explicit appearance choices preserved; iOS shell regression retained. |
| Five Cultural Routes | Names, full/short distances and highlights checked against https://getaroundmk.org.uk/cycling/where-to-ride/cultural-routes. Source-hosted GPX files, no bundled copies. Fetch failures offer an explicit official download link without navigating the app away. All ten published GPX URLs matched the source page; direct requests from the audit environment returned 403, so no universal download/CORS availability is claimed. |
| GPX | Local import, XML/root/coordinate/size/point validation, no markup rendering; export geometry with escaped metadata. Multiple sections use the longest continuous section with notice, never fabricate connecting lines. Outside-MK tracks remain imported geometry; normal planner remains MK-bounded. |
| Underpasses, lighting, crossings | Explicit OSM lighting only; missing/other values unknown. Contiguous tunnel sections count once. Crossing ways count once per contiguous section; short road links are estimates, labelled as such. No claim of exhaustive crossing coverage. |
| Prefer lit / Super Routes | Finite cost preferences, never access overrides or absolute exclusion. A* heuristic corrected below minimum discounted edge cost. |
| Grid roads and Super Route names | OSM tunnel/corridor geometry and official H/V aliases provide available context; names are not invented underpass nameplates. |
| Guidance | Straight/slight/left/right/sharp/U-turn/arrival plus generic roundabout entry/exit; no unsupported numbered exits. Quiet-bend smoothing remains. Unlit warning retained when entering a tunnel. |
| Map hierarchy | Existing scale-dependent network styling, selected-route casing and subdued alternatives retained. Alternative labels are noninteractive and deduplicated. |
| Attribution/reporting | Single OSM credit, Protomaps credit, factual council/Get Around MK source and independent-project notice; path and app report links separate. No council endorsement or data-use authorization claim. |

## Deliberately limited or deferred

- Numbered cultural POI pins and spoken heritage narration: no verified coordinate/description catalogue or established republication basis is present. Source-guide links and short source-grounded highlights remain.
- Calculated connector to nearest official loop: the GPX line is imported independently of the local network. Straight-line nearest-point distance is not a verified connector; the app asks the user to join the line. Only exactly closed loops are rotated, so no closing geometry is fabricated.
- Full signed underpass names, destination signage and roundabout exit numbers: unavailable reliable topology/signage metadata. Generic guidance and inferred H/V context are used.
- Three-tap automatic route preview: destination detail/entrance confirmation is retained before Directions, so selecting a place does not unexpectedly request location. Saved shortcuts accelerate access without fabricating travel times.
- Per-segment council reporting: a council reporting link is available in route More; no prefilled segment-report interface is claimed because a supported council deep-link contract is unavailable.
- Explore shapes, parkland theme and nearby-loop promotional card: illustrative alternative design directions, not required replacements for the core point-to-point interface. Explore remains secondary.
- Crossing totals are estimates, not a complete crossing inventory; node-only OSM crossing tags are not represented in the compact node triples. Lighting coverage is incomplete, and untagged paths are not certified lit or safe.

## Data and release checks

Format remains `mk-redway-network-v6`: node triples and way triples with string metadata. Retained way tags include lit/tunnel/junction, bicycle one-way and crossing classification. Build validation rejects malformed metadata and duplicate way IDs. Network rebuild is forced for this validation release so new retained tags are present. No routing preference bypasses access checks.

Focused regressions cover unknown lighting, preference connectivity, A* against an independent shortest-path oracle, one-way overrides, grouped crossing/tunnel counts, and underpass lighting warnings. Browser audit adds malformed GPX, markup labels, export, out-of-MK import, multi-section handling, mode preservation, off-track join guidance, local-only typing and shared-link reconstruction at portrait, landscape and desktop sizes. Existing tests remain required.

The deployed archive is checked against the runtime allowlist after upload; raw OSM/council extracts, scripts, tests, diagnostics, Git metadata and caches are excluded. Production/live tests run before the beta tag is advanced to the validated descendant. Physical cycling and actual installed Safari/iOS testing remain necessary for GPS jitter, audio, battery, background suspension and real path conditions.
