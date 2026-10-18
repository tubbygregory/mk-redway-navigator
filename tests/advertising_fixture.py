"""Isolate known optional provider requests while testing the real application.

Only the exact ad bootstrap and documented startup OSM raster paths are handled;
geocoding, runtime assets and unexpected traffic retain existing gate assertions.
"""
import re


ADSENSE_SCRIPT_URL = (
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
    "?client=ca-pub-8404673257565926"
)
# Playwright serialises this as a JavaScript RegExp; Python-only \A/\Z anchors
# do not anchor URLs in the browser protocol.
ADSENSE_SCRIPT_PATTERN = re.compile(r"^" + re.escape(ADSENSE_SCRIPT_URL) + r"$")


def block_adsense(context):
    """Return observed ad requests and fail only the configured script fetch.

    Install after any catch-all context route because Playwright handles the
    most recently registered matching route first.
    """
    requests = []

    def block(route):
        requests.append(route.request.url)
        route.abort()

    context.route(ADSENSE_SCRIPT_PATTERN, block)
    return requests


def block_osm_fallback(context):
    """Record the existing startup raster fallback without contacting its host.

    The app adds OSM raster tiles before its bundled PMTiles layer is ready.
    Preserve strict unexpected-traffic checks for every other URL and query.
    """
    requests = []

    def block(route):
        requests.append(route.request.url)
        route.abort()

    context.route(re.compile(r"^https://[abc]\.tile\.openstreetmap\.org/\d+/\d+/\d+\.png$"), block)
    return requests
