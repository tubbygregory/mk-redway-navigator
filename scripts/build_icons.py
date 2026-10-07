"""Reproduce icon assets from the approved vector master.
Optional authoring dependencies: cairosvg==2.8.2, Pillow. Not a runtime dependency.
"""
from pathlib import Path
from io import BytesIO
import cairosvg
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'icons'
source = (ICONS / 'app-logo.svg').read_text()
body = source[source.index('  <rect'):source.rindex('</svg>')]
def render(svg, filename, size):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(ICONS / filename), output_width=size, output_height=size)
for name, size in [('icon-192.png',192),('icon-512.png',512),('apple-touch-icon.png',180),('favicon-16.png',16),('favicon-32.png',32)]:
    render(source,name,size)
# All artwork lies inside the central 80%-diameter safe circle.
mask = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="white"/><g transform="translate(102.4 102.4) scale(.6)">'+body+'</g></svg>'
render(mask,'icon-maskable-512.png',512)
# ICO supplies native browser sizes, alongside the scalable SVG favicon.
raw=cairosvg.svg2png(bytestring=source.encode(),output_width=256,output_height=256)
Image.open(BytesIO(raw)).save(ICONS/'favicon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
splash='<svg xmlns="http://www.w3.org/2000/svg" width="1179" height="2556"><rect width="1179" height="2556" fill="white"/><svg x="429.5" y="1060" width="320" height="320" viewBox="0 0 512 512">'+body+'</svg><text x="589.5" y="1460" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="56" fill="#202020">MK Redway</text></svg>'
cairosvg.svg2png(bytestring=splash.encode(),write_to=str(ICONS/'iphone16-splash.png'))
print('Generated standard, Apple, maskable, favicon and launch assets')
