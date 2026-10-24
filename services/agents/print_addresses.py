"""Print every agent's address (derived from its seed). Reads seeds from .env / environment. Prints a markdown table with --md."""
import sys

from common import CORE, address_of, load_places, mode, slug

rows = [(c["name"], k, address_of(k)) for k, c in CORE.items()]
rows += [(f"streetwise-place-{slug(p['name'])}", "place:" + p["place_id"], address_of("place:" + p["place_id"])) for p in load_places()]
if "--md" in sys.argv:
    print("| Agent | Address |\n|---|---|"); [print(f"| {n} | `{a}` |") for n, _, a in rows]
else:
    for n, _, a in rows: print(f"{n:38s} {a}")
