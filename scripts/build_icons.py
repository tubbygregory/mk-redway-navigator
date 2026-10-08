"""Generate cohesive favicons, PWA, Apple touch and launch assets from the SVG mark."""
from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
source = (ICONS / "app-logo.svg").read_text()

def png(svg, path, width, height=None, *, opaque=False):
    raw = cairosvg.svg2png(bytestring=svg.encode(), output_width=width, output_height=height or width)
    image = Image.open(BytesIO(raw))
    if opaque:
        image = image.convert("RGB")
    image.save(path, optimize=True)

# Standard icon: the square map tile, transparent only at rounded corners.
for name, size in (("icon-192.png", 192), ("icon-512.png", 512),
                   ("favicon-16.png", 16), ("favicon-32.png", 32)):
    png(source, ICONS / name, size)

# Apple supplies its own corner mask. Opaque neutral background avoids black corners.
apple_svg = source.replace('<rect id="tile" x="4" y="4" width="504" height="504" rx="108" fill="#fafafa"/>',
    '<rect width="512" height="512" fill="#fafafa"/>')
png(apple_svg, ICONS / "apple-touch-icon.png", 180, opaque=True)

# The essential MK and arrow must remain inside the 80% maskable safe circle.
# Scale the entire tile to 70%; its outer neutral canvas bleeds through the mask.
inner = source[source.index('  <defs>'):source.rindex('</svg>')]
mask = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<rect width="512" height="512" fill="#fafafa"/>'
        '<g transform="translate(76.8 76.8) scale(.7)">' + inner + '</g></svg>')
png(mask, ICONS / "icon-maskable-512.png", 512, opaque=True)

raw = cairosvg.svg2png(bytestring=source.encode(), output_width=256, output_height=256)
Image.open(BytesIO(raw)).save(ICONS / "favicon.ico",
                              sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])

splash = (f'<svg xmlns="http://www.w3.org/2000/svg" width="1179" height="2556">'
          f'<rect width="1179" height="2556" fill="#fafafa"/>'
          f'<svg x="409.5" y="1030" width="360" height="360" viewBox="0 0 512 512">{inner}</svg>'
          f'<text x="589.5" y="1475" text-anchor="middle" font-family="sans-serif" '
          f'font-weight="700" font-size="56" fill="#23262b">MK Redway</text></svg>')
png(splash, ICONS / "iphone16-splash.png", 1179, 2556, opaque=True)
print("Generated standard, maskable, Apple, favicon and splash icons")
