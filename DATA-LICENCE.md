# Data sources and licences

The application code's MIT licence does not replace the licences or permissions governing map data and third-party software.

## Milton Keynes City Council / Get Around MK

Official Super Redway, Redway and Leisure Route classifications are obtained from the selected KML/KMZ sources referenced by the [Get Around MK interactive map](https://getaroundmk.org.uk/interactive-map). Official corridor references also use [Get Around MK Super Redways](https://getaroundmk.org.uk/cycling/where-to-ride/super-redways).

Source attribution:

> Official route classification: Milton Keynes City Council / Get Around MK.

Council geometry is a build input, matched onto connected OSM ways. Raw extraction and diagnostic files are not part of the website artifact. Generic Google Maps rendering data is not used as route geometry.

## OpenStreetMap and Geofabrik

Routing topology is derived from © OpenStreetMap contributors via the [Geofabrik Buckinghamshire extract](https://download.geofabrik.de/europe/united-kingdom/england/buckinghamshire.html).

OpenStreetMap data is licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution and applicable share-alike obligations continue to apply to derived data. See [OpenStreetMap copyright and licence information](https://www.openstreetmap.org/copyright). The generated network is not covered solely by the application's MIT licence.

The online raster fallback uses OpenStreetMap's tile service, subject to its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). The app does not bulk-download that service for offline use.

## Protomaps basemap

The offline map is an MK extract from the [Protomaps daily basemap builds](https://build.protomaps.com/). Retain Protomaps and OpenStreetMap attribution, together with applicable upstream data notices. PMTiles is a file format, not a licence for its contents. Consult the [Protomaps basemap documentation](https://docs.protomaps.com/basemaps/) for source and attribution details.

## Browser libraries

Leaflet 1.9.4, Leaflet Rotate 0.2.4 and Protomaps Leaflet 5.1.0 are self-hosted in the deployment. Their upstream copyright and licence notices apply independently of the application licence. Versioned download sources are recorded in `runtime-dependencies.json`.

## Independence

MK Redway Navigator is an independent project and is not an official Milton Keynes City Council service. Source attribution does not imply endorsement.

The deployed `vendor/` directory includes upstream licence notices for these libraries.
