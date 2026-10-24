"""Export a keyless, offline street basemap from the same cached OSM extract."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ways = json.loads((ROOT / "data/cache/osm_ways.json").read_text(encoding="utf-8"))
def simplify(coords, tolerance=.000025):
    if len(coords) < 3:
        return coords
    a,b=coords[0],coords[-1]
    dx,dy=b[0]-a[0],b[1]-a[1]
    length=dx*dx+dy*dy
    far,index=0,0
    for i,p in enumerate(coords[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
        d=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
        if d>far: far,index=d,i
    if far<=tolerance*tolerance: return [a,b]
    return simplify(coords[:index+1],tolerance)[:-1]+simplify(coords[index:],tolerance)

features = []
groups = {}
for way in ways:
    tags = way.get("tags", {})
    coords = [[round(p["lon"], 5), round(p["lat"], 5)] for p in way.get("geometry", [])]
    coords = [p for i, p in enumerate(coords) if not i or p != coords[i - 1]]
    if len(coords) < 2:
        continue
    key=(tags.get("name", ""),tags.get("highway") in {"primary", "secondary", "tertiary", "trunk", "motorway"})
    groups.setdefault(key,[]).append(simplify(coords))
for (name,major),lines in groups.items():
    features.append({"type":"Feature","properties":{"name":name,"major":major},"geometry":{"type":"MultiLineString","coordinates":lines}})

target = ROOT / "streetwise-web/public/data/sf-streets.geojson"
target.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
print(f"Offline OSM streets: {len(features)} street groups, {target.stat().st_size / 1024 / 1024:.1f} MiB")
