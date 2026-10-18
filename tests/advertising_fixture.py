"""Isolate known optional provider requests while testing the real application.

Exact request fixtures isolate the ad bootstrap and startup OSM raster paths.
WebKit additionally blocks off-host traffic through an unreachable proxy because
service-worker-controlled requests can escape browser route interception.
"""
from contextlib import contextmanager
import re
import socket
from urllib.parse import urlsplit


ADSENSE_SCRIPT_URL = (
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
    "?client=ca-pub-8404673257565926"
)
# Playwright serialises this as a JavaScript RegExp; Python-only \A/\Z anchors
# do not anchor URLs in the browser protocol.
ADSENSE_SCRIPT_PATTERN = re.compile(r"^" + re.escape(ADSENSE_SCRIPT_URL) + r"$")


@contextmanager
def external_provider_proxy(runtime_url):
    """Keep external traffic blocked even when WebKit's SW bypasses routing.

    The runtime hostname alone bypasses this unreachable proxy. Reserving a
    bound, non-listening socket prevents another process taking its port while
    the browser runs; application/SW assets still use their genuine origin.
    """
    host = urlsplit(runtime_url).hostname
    if not host or urlsplit(runtime_url).scheme not in ("http", "https"):
        raise ValueError("Provider isolation needs an HTTP runtime hostname")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reserved:
        reserved.bind(("127.0.0.1", 0))
        yield {"server": f"http://127.0.0.1:{reserved.getsockname()[1]}", "bypass": host}


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
