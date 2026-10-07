"""Reproduce branded browser/PWA icons from icons/app-logo.svg.

Authoring-only dependencies: cairosvg and Pillow. Runtime builds consume the
committed outputs; this helper documents the exact export geometry.
"""
from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
RED = "#ed001b"
source = (ICONS / "app-logo.svg").read_text()
mark_start = source.index('<g id="mark"')
mark_end = source.index('</g>', mark_start) + len('</g>')
mark = source[mark_start:mark_end]

def png(svg: str, path: Path, width: int, height=None, *, opaque=False):
    height = height or width
    raw = cairosvg.svg2png(bytestring=svg.encode(), output_width=width, output_height=height)
    image = Image.open(BytesIO(raw))
    if opaque:
        image = image.convert("RGB")
    image.save(path, optimize=True)

def canvas(body: str, bg="transparent"):
    bg_rect = "" if bg == "transparent" else f'<rect width="512" height="512" fill="{bg}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg_rect}{body}</svg>'

# Standard web/PWA art keeps the rounded tile and transparent corners.
for name, size in (("icon-192.png", 192), ("icon-512.png", 512),
                   ("favicon-16.png", 16), ("favicon-32.png", 32)):
    png(source, ICONS / name, size)

# Apple asks for a square, opaque touch icon; iOS supplies the corner mask.
apple_body = f'<rect width="512" height="512" fill="{RED}"/>{mark}'
png(canvas(apple_body), ICONS / "apple-touch-icon.png", 180, opaque=True)

# Maskable artwork: full-bleed red with all essential white artwork inside the
# central 80%-diameter safe circle. Decorative red continues to every edge.
mask_body = f'<rect width="512" height="512" fill="{RED}"/><g transform="translate(71.68 71.68) scale(.72)">{mark}</g>'
png(canvas(mask_body), ICONS / "icon-maskable-512.png", 512, opaque=True)

# Multi-resolution ICO for browsers that do not use SVG/PNG favicons.
raw = cairosvg.svg2png(bytestring=source.encode(), output_width=256, output_height=256)
Image.open(BytesIO(raw)).save(ICONS / "favicon.ico",
                              sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])

# Existing iPhone 16 / 16 Pro launch-image slot. Launch images are not masked.
body = source[source.index('<rect id='):source.rindex('</svg>')]
splash = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1179" height="2556">
<rect width="1179" height="2556" fill="white"/>
<svg x="409.5" y="1030" width="360" height="360" viewBox="0 0 512 512">{body}</svg>
<text x="589.5" y="1475" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="56" fill="#202020">MK Redway</text>
</svg>'''
png(splash, ICONS / "iphone16-splash.png", 1179, 2556, opaque=True)
print("Generated standard, Apple, maskable, favicon and launch assets")
