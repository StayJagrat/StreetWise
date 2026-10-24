#!/usr/bin/env bash
# Extracts a San Francisco basemap (OpenStreetMap data, Protomaps build) into apps/web/public/tiles/sf.pmtiles.
# Needs the pmtiles CLI (brew install pmtiles) and network once. After that the map works with no internet.
# The file is git-ignored (tens of MB); every teammate runs this once, and the demo laptop must have it.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="${1:-$(curl -s https://build-metadata.protomaps.dev/builds.json | python3 -c 'import sys,json; print(sorted(json.load(sys.stdin), key=lambda x: x["key"])[-1]["key"])')}"
echo "Extracting San Francisco from $BUILD"
pmtiles extract "https://build.protomaps.com/$BUILD" apps/web/public/tiles/sf.pmtiles --bbox=-122.54,37.69,-122.34,37.84 --maxzoom=15
ls -lh apps/web/public/tiles/sf.pmtiles
