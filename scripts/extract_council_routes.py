#!/usr/bin/env python3
"""Extract official MK cycle-path classifications from Get Around MK's interactive map.

This deliberately reads the public website rather than depending on an undocumented
hard-coded API URL. A headless Chromium session loads the map, enables the three
cycle-path categories, and captures route geometry from:
  * JSON/GeoJSON/KML network responses,
  * google.maps.Data layers, and
  * google.maps.Polyline instances created by the page, and
  * source KML/KMZ URLs used by google.maps.KmlLayer.

The result is data/council_routes.geojson with route_class values:
  super_redway, redway, leisure.

The project owner has stated that Milton Keynes City Council granted permission to
use the website's copyright map data. Keep council attribution in DATA-LICENCE.md.
"""
from __future__ import annotations

import asyncio
import io
import json
import math
import re
import zipfile
from pathlib import Path
from urllib.parse import urljoin
from typing import Any
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "council_routes.geojson"
DIAG = ROOT / "data" / "council-route-extract-diagnostics.json"
URL = "https://getaroundmk.org.uk/interactive-map"
BBOX = (-0.94, 51.93, -0.57, 52.18)  # west,south,east,north; generous MK envelope

CLASS_TERMS = {
    "super_redway": ("redway super", "super redway", "super route", "superroute"),
    "leisure": ("leisure route", "leisure"),
    "redway": ("redway route", "redways", "redway"),
}


def classify_text(*values: Any) -> str | None:
    text = " ".join(str(v or "") for v in values).lower()
    text = re.sub(r"\s+", " ", text)
    # Specific before general: Super Redway contains 'redway'.
    for cls in ("super_redway", "leisure", "redway"):
        if any(term in text for term in CLASS_TERMS[cls]):
            return cls
    return None


def valid_lonlat(pt: Any) -> bool:
    return (
        isinstance(pt, (list, tuple)) and len(pt) >= 2
        and isinstance(pt[0], (int, float)) and isinstance(pt[1], (int, float))
        and BBOX[0] <= float(pt[0]) <= BBOX[2]
        and BBOX[1] <= float(pt[1]) <= BBOX[3]
    )


def line_in_mk(coords: Any) -> bool:
    if not isinstance(coords, list) or len(coords) < 2:
        return False
    flat = coords
    while flat and isinstance(flat[0], list) and flat[0] and isinstance(flat[0][0], list):
        flat = [p for part in flat for p in part]
    return sum(1 for p in flat if valid_lonlat(p)) >= 2


def feature_from_geometry(geometry: dict, props: dict, default_class: str | None = None) -> list[dict]:
    typ = geometry.get("type")
    coords = geometry.get("coordinates")
    cls = classify_text(*(props.get(k) for k in ("route_class", "class", "type", "category", "name", "title", "layer", "description"))) or default_class
    if not cls:
        return []
    out: list[dict] = []
    if typ == "LineString" and line_in_mk(coords):
        out.append({"type": "Feature", "properties": {**props, "route_class": cls}, "geometry": {"type": "LineString", "coordinates": coords}})
    elif typ == "MultiLineString" and isinstance(coords, list):
        for line in coords:
            if line_in_mk(line):
                out.append({"type": "Feature", "properties": {**props, "route_class": cls}, "geometry": {"type": "LineString", "coordinates": line}})
    return out


def extract_json(value: Any, context: str = "") -> list[dict]:
    out: list[dict] = []
    if isinstance(value, dict):
        if value.get("type") == "FeatureCollection" and isinstance(value.get("features"), list):
            for f in value["features"]:
                if isinstance(f, dict):
                    props = f.get("properties") or {}
                    cls = classify_text(context, *(props.values()))
                    geom = f.get("geometry") or {}
                    out.extend(feature_from_geometry(geom, props, cls))
        elif value.get("type") == "Feature" and isinstance(value.get("geometry"), dict):
            props = value.get("properties") or {}
            cls = classify_text(context, *(props.values()))
            out.extend(feature_from_geometry(value["geometry"], props, cls))
        else:
            # Common API shapes: {name/category, geometry:{...}} or {coordinates:[...]}
            descriptor = " ".join(str(value.get(k) or "") for k in ("name", "title", "type", "category", "layer", "description", "routeType"))
            cls = classify_text(context, descriptor)
            geom = value.get("geometry")
            if isinstance(geom, dict):
                out.extend(feature_from_geometry(geom, {"source_label": descriptor}, cls))
            coords = value.get("coordinates") or value.get("path") or value.get("points")
            if cls and isinstance(coords, list):
                # GeoJSON-style lon/lat path.
                if line_in_mk(coords):
                    out.append({"type": "Feature", "properties": {"route_class": cls, "source_label": descriptor}, "geometry": {"type": "LineString", "coordinates": coords}})
                # Google-style objects: [{lat,lng}, ...]
                elif len(coords) >= 2 and all(isinstance(p, dict) and "lat" in p and ("lng" in p or "lon" in p) for p in coords[:2]):
                    line = [[float(p.get("lng", p.get("lon"))), float(p["lat"])] for p in coords]
                    if line_in_mk(line):
                        out.append({"type": "Feature", "properties": {"route_class": cls, "source_label": descriptor}, "geometry": {"type": "LineString", "coordinates": line}})
            for k, v in value.items():
                if isinstance(v, (dict, list)):
                    out.extend(extract_json(v, f"{context} {descriptor} {k}"))
    elif isinstance(value, list):
        for item in value:
            out.extend(extract_json(item, context))
    return out


def extract_kml(text: str, context: str = "") -> list[dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    out = []
    for pm in root.findall(".//{*}Placemark"):
        name = pm.findtext("{*}name") or ""
        desc = pm.findtext("{*}description") or ""
        cls = classify_text(context, name, desc)
        if not cls:
            continue
        for node in pm.findall(".//{*}LineString/{*}coordinates"):
            coords = []
            for token in (node.text or "").replace("\n", " ").split():
                parts = token.split(",")
                if len(parts) >= 2:
                    try:
                        coords.append([float(parts[0]), float(parts[1])])
                    except ValueError:
                        pass
            if line_in_mk(coords):
                out.append({"type": "Feature", "properties": {"route_class": cls, "name": name}, "geometry": {"type": "LineString", "coordinates": coords}})
    return out


def extract_kml_blob(blob: bytes, context: str = "") -> list[dict]:
    """Extract KML features from either a plain KML response or a KMZ archive."""
    if blob[:4] == b"PK\x03\x04":
        out: list[dict] = []
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".kml"):
                        out.extend(extract_kml(zf.read(name).decode("utf-8", "ignore"), f"{context} {name}"))
        except Exception:
            return []
        return out
    return extract_kml(blob.decode("utf-8", "ignore"), context)


def find_kml_urls(text: str, base_url: str = URL) -> list[str]:
    """Find literal KML/KMZ links in HTML/JS, including JSON-escaped URLs."""
    if not text:
        return []
    cleaned = text.replace("\\/", "/").replace("\\u0026", "&")
    found: list[str] = []
    patterns = [
        r"(?i)https?://[^\s\"'<>]+?\.(?:kml|kmz)(?:\?[^\s\"'<>]*)?",
        r"(?i)[\"']([^\"']+?\.(?:kml|kmz)(?:\?[^\"']*)?)[\"']",
    ]
    for idx, pattern in enumerate(patterns):
        for match in re.finditer(pattern, cleaned):
            raw = match.group(0) if idx == 0 else match.group(1)
            raw = raw.strip("\"' ").replace("&amp;", "&")
            url = urljoin(base_url, raw)
            if url not in found:
                found.append(url)
    return found


def dedupe(features: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for f in features:
        coords = f["geometry"]["coordinates"]
        # Rounded fingerprint tolerates duplicate payloads and reversed lines.
        rounded = tuple((round(float(p[0]), 5), round(float(p[1]), 5)) for p in coords if valid_lonlat(p))
        if len(rounded) < 2:
            continue
        rev = tuple(reversed(rounded))
        keyline = min(rounded, rev)
        key = (f["properties"].get("route_class"), keyline)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


async def main() -> int:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise SystemExit("Playwright is required: pip install playwright")

    features: list[dict] = []
    diagnostics: dict[str, Any] = {"url": URL, "responses": [], "layers": {}, "errors": []}

    capture_script = r"""
    (() => {
      window.__mkCouncilPolylines = [];
      window.__mkCouncilDataFeatures = [];
      window.__mkCouncilKmlLayers = [];
      const copyPath = p => {
        try {
          const arr = p && typeof p.getArray === 'function' ? p.getArray() : p;
          return Array.from(arr || []).map(x => {
            const lat = typeof x.lat === 'function' ? x.lat() : x.lat;
            const lng = typeof x.lng === 'function' ? x.lng() : (x.lng ?? x.lon);
            return [Number(lng), Number(lat)];
          }).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
        } catch (_) { return []; }
      };
      const timer = setInterval(() => {
        try {
          const gm = window.google && window.google.maps;
          if (!gm) return;
          if (gm.Polyline && !gm.Polyline.__mkWrapped) {
            const Orig = gm.Polyline;
            function Wrapped(opts) {
              const obj = new Orig(opts);
              try {
                window.__mkCouncilPolylines.push({
                  path: copyPath((opts && opts.path) || obj.getPath()),
                  strokeColor: opts && opts.strokeColor,
                  title: opts && (opts.title || opts.name),
                  options: opts || {}
                });
              } catch (_) {}
              return obj;
            }
            Object.setPrototypeOf(Wrapped, Orig); Wrapped.prototype = Orig.prototype; Wrapped.__mkWrapped = true;
            gm.Polyline = Wrapped;
          }
          if (gm.Data && gm.Data.prototype && gm.Data.prototype.addGeoJson && !gm.Data.prototype.addGeoJson.__mkWrapped) {
            const origAdd = gm.Data.prototype.addGeoJson;
            const wrappedAdd = function(obj, options) {
              try { window.__mkCouncilDataFeatures.push({obj, options}); } catch (_) {}
              return origAdd.call(this, obj, options);
            };
            wrappedAdd.__mkWrapped = true;
            gm.Data.prototype.addGeoJson = wrappedAdd;
          }
          if (gm.KmlLayer && gm.KmlLayer.prototype && !gm.KmlLayer.__mkWrapped) {
            const Orig = gm.KmlLayer;
            const record = (obj, supplied, reason) => {
              try {
                const url = (typeof supplied === 'string' ? supplied : (supplied && supplied.url)) ||
                            (obj && typeof obj.getUrl === 'function' ? obj.getUrl() : '');
                if (url) window.__mkCouncilKmlLayers.push({url:String(url), reason, ts:Date.now()});
              } catch (_) {}
            };
            if (Orig.prototype.setMap && !Orig.prototype.setMap.__mkWrapped) {
              const origSetMap = Orig.prototype.setMap;
              const wrappedSetMap = function(map) { record(this, null, map ? 'setMap:on' : 'setMap:off'); return origSetMap.call(this, map); };
              wrappedSetMap.__mkWrapped = true;
              Orig.prototype.setMap = wrappedSetMap;
            }
            if (Orig.prototype.setUrl && !Orig.prototype.setUrl.__mkWrapped) {
              const origSetUrl = Orig.prototype.setUrl;
              const wrappedSetUrl = function(url) { record(this, url, 'setUrl'); return origSetUrl.call(this, url); };
              wrappedSetUrl.__mkWrapped = true;
              Orig.prototype.setUrl = wrappedSetUrl;
            }
            function Wrapped(...args) {
              const obj = Reflect.construct(Orig, args, Orig);
              record(obj, args[0], 'constructor');
              return obj;
            }
            Object.setPrototypeOf(Wrapped, Orig);
            Wrapped.prototype = Orig.prototype;
            Wrapped.__mkWrapped = true;
            gm.KmlLayer = Wrapped;
          }
        } catch (_) {}
      }, 1);
      setTimeout(() => clearInterval(timer), 30000);
    })();
    """

    layers = [
        ("Redway Super Routes", "super_redway"),
        ("Redway Routes", "redway"),
        ("Leisure Routes", "leisure"),
    ]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, locale="en-GB")

        for label, target_class in layers:
            page = await context.new_page()
            await page.add_init_script(capture_script)
            active = {"capture": False}
            layer_features: list[dict] = []

            async def on_response(resp, _label=label):
                if not active["capture"]:
                    return
                url = resp.url
                try:
                    ct = (resp.headers.get("content-type") or "").lower()
                    interesting = any(x in ct for x in ("json", "geojson", "xml", "kml")) or any(x in url.lower() for x in ("geojson", ".kml", "ajax", "api", "map", "route", "cycle", "redway"))
                    if not interesting:
                        return
                    body = await resp.body()
                    if len(body) > 20_000_000:
                        return
                    diagnostics["responses"].append({"layer": _label, "url": url, "status": resp.status, "content_type": ct, "bytes": len(body)})
                    text = body.decode("utf-8", "ignore")
                    context_text = f"{_label} {url}"
                    if "json" in ct or text.lstrip().startswith(("{", "[")):
                        try:
                            layer_features.extend(extract_json(json.loads(text), context_text))
                        except Exception:
                            pass
                    if "kml" in ct or "xml" in ct or "<kml" in text[:1000].lower():
                        layer_features.extend(extract_kml(text, context_text))
                except Exception as exc:
                    diagnostics["errors"].append(f"response {_label} {url}: {exc}")

            page.on("response", on_response)
            try:
                await page.goto(URL, wait_until="domcontentloaded", timeout=90000)
                await page.wait_for_timeout(4000)

                # Open the filter panel if it is collapsed.
                for button_name in ("Map Filter", "Map filter"):
                    try:
                        btn = page.get_by_role("button", name=re.compile(button_name, re.I))
                        if await btn.count():
                            await btn.first.click(timeout=2500)
                            await page.wait_for_timeout(500)
                            break
                    except Exception:
                        pass

                # Start from a known filter state. The site can retain selections.
                try:
                    cleared = await page.evaluate(r"""() => {
                      const clickable = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],a'));
                      const norm = el => ((el.textContent || el.value || '') + '').replace(/\s+/g,' ').trim().toLowerCase();
                      const el = clickable.find(x => norm(x) === 'clear all' || norm(x).includes('clear all'));
                      if (!el) return false;
                      el.click(); return true;
                    }""")
                    if cleared:
                        await page.wait_for_timeout(600)
                except Exception:
                    pass

                baseline = await page.evaluate("() => ({p:(window.__mkCouncilPolylines||[]).length,d:(window.__mkCouncilDataFeatures||[]).length,k:(window.__mkCouncilKmlLayers||[]).length})")

                # Select exactly one official layer. This makes otherwise anonymous JSON or
                # polyline payloads safely classifiable by the active website filter.
                selected = await page.evaluate(r"""(label) => {
                  const els = Array.from(document.querySelectorAll('label, li, div, span'));
                  const norm = s => (s || '').replace(/\s+/g,' ').trim();
                  const el = els.find(x => norm(x.textContent) === label) || els.find(x => norm(x.textContent).includes(label));
                  if (!el) return null;
                  const labelEl = el.closest('label') || el;
                  let input = labelEl.querySelector && labelEl.querySelector('input[type=checkbox],input[type=radio]');
                  if (!input && labelEl.htmlFor) input = document.getElementById(labelEl.htmlFor);
                  if (!input) {
                    const parent = labelEl.parentElement;
                    input = parent && parent.querySelector('input[type=checkbox],input[type=radio]');
                  }
                  if (input) {
                    if (!input.checked) input.click();
                    return {found:true,id:input.id||'',name:input.name||'',value:input.value||'',checked:!!input.checked};
                  }
                  labelEl.click(); return {found:true,id:'',name:'',value:'',checked:null};
                }""", label)
                diagnostics["layers"][label] = {"selected": bool(selected), "filter": selected or {}}
                if not selected:
                    raise RuntimeError(f"Could not find website filter '{label}'")

                active["capture"] = True
                applied = False
                try:
                    applied = bool(await page.evaluate(r"""() => {
                      const clickable = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],a'));
                      const norm = el => ((el.textContent || el.value || '') + '').replace(/\s+/g,' ').trim().toLowerCase();
                      const el = clickable.find(x => norm(x) === 'apply filters' || norm(x).startsWith('apply'));
                      if (!el) return false;
                      el.click(); return true;
                    }"""))
                except Exception:
                    pass
                diagnostics["layers"][label]["apply_clicked"] = applied
                await page.wait_for_timeout(12000)
                diagnostics["layers"][label]["final_url"] = page.url

                captured = await page.evaluate("""() => ({
                  polylines: window.__mkCouncilPolylines || [],
                  dataFeatures: window.__mkCouncilDataFeatures || [],
                  kmlLayers: window.__mkCouncilKmlLayers || []
                })""")
                for item in captured.get("dataFeatures", [])[baseline.get("d", 0):]:
                    layer_features.extend(extract_json(item.get("obj"), label))
                # The council map uses Google Maps KmlLayer. When the selected layer is
                # toggled on, setMap/getUrl exposes the original source KML/KMZ. Parse that
                # directly instead of trying to decode Google's internal vector tiles.
                kml_entries = captured.get("kmlLayers", [])[baseline.get("k", 0):]
                kml_urls: list[str] = []
                for entry in kml_entries:
                    url = str((entry or {}).get("url") or "")
                    if url and url not in kml_urls:
                        kml_urls.append(url)
                diagnostics["layers"][label]["kml_layers"] = kml_entries
                diagnostics["layers"][label]["kml_urls"] = kml_urls
                for kml_url in kml_urls:
                    try:
                        kr = await context.request.get(kml_url, timeout=30000)
                        if kr.ok:
                            blob = await kr.body()
                            parsed = extract_kml_blob(blob, label)
                            for f in parsed:
                                f.setdefault("properties", {})["capture"] = "google.maps.KmlLayer source"
                            layer_features.extend(parsed)
                        else:
                            diagnostics["errors"].append(f"KML {label} {kml_url}: HTTP {kr.status}")
                    except Exception as exc:
                        diagnostics["errors"].append(f"KML {label} {kml_url}: {exc}")

                for item in captured.get("polylines", [])[baseline.get("p", 0):]:
                    path = item.get("path") or []
                    if line_in_mk(path):
                        opts = item.get("options") or {}
                        layer_features.append({
                            "type": "Feature",
                            "properties": {
                                "route_class": target_class,
                                "name": item.get("title") or opts.get("name") or "",
                                "capture": "google.maps.Polyline",
                            },
                            "geometry": {"type": "LineString", "coordinates": path},
                        })
                # Because only one layer is enabled, any line extracted from that layer's
                # response is authoritatively assigned to the selected website category.
                for f in layer_features:
                    f.setdefault("properties", {})["route_class"] = target_class
                layer_features = dedupe(layer_features)
                diagnostics["layers"][label]["features"] = len(layer_features)
                features.extend(layer_features)
            except Exception as exc:
                diagnostics["errors"].append(f"layer {label}: {exc}")
                diagnostics["layers"].setdefault(label, {})["error"] = str(exc)
            finally:
                await page.close()

        await browser.close()

    features = dedupe(features)
    counts = {c: sum(1 for f in features if f["properties"].get("route_class") == c) for c in ("super_redway", "redway", "leisure")}
    diagnostics["feature_counts"] = counts
    DIAG.parent.mkdir(parents=True, exist_ok=True)
    DIAG.write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")

    # Require all three website layers. A partial scrape is worse than the last known-good
    # council extract because it could silently declassify valid paths.
    if len(features) < 20 or any(counts[c] == 0 for c in counts):
        print(f"Council-map extraction incomplete: {len(features)} usable lines ({counts}); retaining any cached extract.")
        return 2

    payload = {
        "type": "FeatureCollection",
        "name": "Get Around MK official cycle-path classifications",
        "source": URL,
        "permission": "Used with permission from Milton Keynes City Council as confirmed by the project owner.",
        "features": features,
    }
    tmp = OUT.with_suffix(".geojson.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(OUT)
    size = OUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT}: {len(features):,} lines — {counts}; {size:.2f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
