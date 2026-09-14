# Map and route data

MK Redway Navigator combines two data sources for different purposes.

## Milton Keynes City Council / Get Around MK

The official route classification and line geometry for **Redway Routes**, **Leisure Routes** and **Redway Super Routes** is obtained from the Get Around MK interactive map:

- https://getaroundmk.org.uk/interactive-map
- https://getaroundmk.org.uk/cycling/where-to-ride/super-redways

The project owner has confirmed that **Milton Keynes City Council has granted permission to use the copyright data** in this project. The GitHub build therefore loads the public Get Around MK interactive map and produces `data/council_routes.geojson` from the three official cycle-path layers. The app does not need the council website at runtime.

Retain this attribution when redistributing the project:

> Official Milton Keynes Redway classifications/geometry: Milton Keynes City Council / Get Around MK, used with permission.

Any third-party rights or attribution requirements that form part of the council's permission should also be retained. The project owner should keep a copy of the written permission with the project records.

## OpenStreetMap

OpenStreetMap remains the source of the detailed **routable network topology** used by the navigation engine. The council lines are matched to OSM ways so that official MK classifications are combined with connected, routable geometry.

- Routing topology: derived from OpenStreetMap data by `scripts/build_network.py`.
- Online fallback map: OpenStreetMap tiles, subject to the OpenStreetMap tile usage policy.
- Offline basemap: a Milton Keynes extract of Protomaps Basemap, derived from OpenStreetMap and distributed as an ODbL Produced Work.
- Required map attribution: `© OpenStreetMap contributors`.

OpenStreetMap data is available under the Open Database License (ODbL).

## Build-time extraction

`scripts/extract_council_routes.py` opens the public Get Around MK interactive map in a headless browser and enables these layers independently:

1. Redway Super Routes
2. Redway Routes
3. Leisure Routes

It captures the line data loaded/rendered by the website and stores a compact GeoJSON copy for build-time classification. If the website is temporarily unavailable or its implementation changes, GitHub Actions retains the previous successful council extract and the router falls back to its existing OSM/corridor classification rather than breaking the deployed app.
