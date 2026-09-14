#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/data"
OUT="$DATA/mk-basemap.pmtiles"
STAMP="$DATA/mk-basemap-build.txt"
TMP="$DATA/mk-basemap.tmp.pmtiles"
IMAGE="ghcr.io/protomaps/go-pmtiles:v1.31.2"
BBOX="-0.905,51.955,-0.615,52.155"
mkdir -p "$DATA"

if [[ -f "$OUT" && -f "$STAMP" && "${FORCE_OFFLINE_MAP_REFRESH:-0}" != "1" ]]; then
  built="$(head -n1 "$STAMP" 2>/dev/null || true)"
  if [[ "$built" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    now=$(date -u +%s)
    then=$(date -u -d "$built" +%s 2>/dev/null || echo 0)
    age=$(( (now - then) / 86400 ))
    if (( age >= 0 && age < 30 )); then
      echo "Reusing offline basemap built ${age} days ago ($(du -h "$OUT" | cut -f1))."
      exit 0
    fi
  fi
fi

build_url=""
build_date=""
for offset in $(seq 0 14); do
  candidate_date=$(date -u -d "-$offset day" +%Y%m%d)
  candidate="https://build.protomaps.com/${candidate_date}.pmtiles"
  echo "Checking Protomaps build ${candidate_date}…"
  if curl -fsSI --max-time 20 --retry 2 --retry-delay 2 "$candidate" >/dev/null; then
    build_url="$candidate"
    build_date="$candidate_date"
    break
  fi
done

if [[ -z "$build_url" ]]; then
  echo "No recent Protomaps daily build could be reached." >&2
  if [[ -f "$OUT" ]]; then
    echo "Keeping existing offline basemap." >&2
    exit 0
  fi
  exit 2
fi

rm -f "$TMP"
echo "Extracting Milton Keynes offline basemap from ${build_date}…"
docker run --rm \
  -v "$DATA:/data" \
  "$IMAGE" \
  extract "$build_url" /data/mk-basemap.tmp.pmtiles \
  --bbox="$BBOX" --maxzoom=15 --download-threads=8

if [[ ! -s "$TMP" ]]; then
  echo "Offline basemap extraction produced no file." >&2
  exit 3
fi

mv "$TMP" "$OUT"
date -u +%Y-%m-%d > "$STAMP"
printf '%s\\n' "$build_date" > "$DATA/mk-basemap-source-date.txt"
echo "Offline MK basemap ready: $(du -h "$OUT" | cut -f1)."
