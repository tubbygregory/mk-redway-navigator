"""Isolate the configured ad bootstrap while exercising the real application.

Only this exact publisher URL is blocked; geocoding, runtime assets and
unexpected external traffic retain each browser gate's existing assertions.
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
