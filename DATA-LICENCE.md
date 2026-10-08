# Data sources and licences

The application code's MIT licence does not replace the licences governing map data and third-party software.

## Milton Keynes City Council / Get Around MK

Official Super Redway, Redway and Leisure Route classifications are obtained from the selected KML/KMZ sources referenced by the [Get Around MK interactive map](https://getaroundmk.org.uk/interactive-map). Official corridor references also use [Get Around MK Super Redways](https://getaroundmk.org.uk/cycling/where-to-ride/super-redways).

Source attribution:

> Official route classification: Milton Keynes City Council / Get Around MK.

Council geometry is a build input, matched onto connected OSM ways. Raw extraction and diagnostic files are not part of the website artifact. Only the explicitly selected Get Around MK route-layer files are treated as route-classification sources.

The Explore MK catalogue uses the five Cultural Routes published by [Get Around MK](https://getaroundmk.org.uk/cycling/where-to-ride/cultural-routes). The website includes unchanged copies of the official full-route and shortcut GPX files, verified against that page on 8 October 2026, so they can load reliably inside the app and offline. Original source URLs and SHA256 hashes are recorded in [the Cultural Routes manifest](./cultural-routes/manifest.json). The shortcut files contain open segments, not complete shorter loops; consult the official guide for the shorter rides. These source files retain their upstream data rights and are not relicensed under the application’s MIT licence.

## OpenStreetMap and Geofabrik

Routing topology and the local mapped-place/address index are derived from © OpenStreetMap contributors via the [Geofabrik Buckinghamshire extract](https://download.geofabrik.de/europe/united-kingdom/england/buckinghamshire.html). The index uses explicit source names, address tags and mapped node/way geometry within the app’s existing MK bounds; building centres do not identify verified entrances. Its source timestamp and hash are recorded in the runtime metadata. Raw OSM inputs are not deployed.

OpenStreetMap data is licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution and applicable share-alike obligations continue to apply to derived data. See [OpenStreetMap copyright and licence information](https://www.openstreetmap.org/copyright). The generated network and place/address index retain this data licence and are not covered solely by the application's MIT licence.

The online raster fallback uses OpenStreetMap's tile service, subject to its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). The app does not bulk-download that service for offline use.

## Protomaps basemap

The offline map is an MK extract from the [Protomaps daily basemap builds](https://build.protomaps.com/). Retain Protomaps and OpenStreetMap attribution, together with applicable upstream data notices. PMTiles is a file format, not a licence for its contents. Consult the [Protomaps basemap documentation](https://docs.protomaps.com/basemaps/) for source and attribution details.

## Browser libraries

Leaflet 1.9.4, Leaflet Rotate 0.2.4 and Protomaps Leaflet 5.1.0 are self-hosted in the deployment. Their upstream copyright and licence notices apply independently of the application licence. Versioned download sources are recorded in `runtime-dependencies.json`.

## Independence

MK Redway Navigator is an independent project and is not an official Milton Keynes City Council service. Source attribution does not imply endorsement.

The deployed `vendor/` directory includes upstream licence notices for these libraries.
