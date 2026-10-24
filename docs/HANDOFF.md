# Streetwise handoff: state, plan, where to start

Written Saturday Oct 24, 2026. Deadline: **Sunday Oct 25, 9:00 AM PT** (be at the venue by 8:00 AM). Read this first, then `README.md`.

## Decisions made

1. **Abhishek's frontend is the app.** `streetwise-web/` (React + Vite PWA, Figma tokens, five mascots, five screens) is the only frontend we build on. `apps/web` is our earlier frontend; keep it as a reference until the new one is wired to the backend, then delete it.
2. **Trunk branch = `main`** on `StayJagrat/StreetWise` (Jagrat renamed Abhishek's `streetwise-web` branch to `main`; same commit `519db43`).
3. **Work in small pieces.** One branch per piece, named plainly after the piece (`gateway`, `live-mode`, not `feat/gateway`), one small PR into `main`, merged as soon as it runs. No long-lived branches. Rebase on `main` before opening a PR.
4. **Design = Abhishek's Figma build only.** Colours, type, mascots, spacing and screens come from `streetwise-web/` (`src/styles/tokens.css`, `public/mascots/`). Do not bring in our older amber/Lamp brand (`docs/BRAND.md`, `docs/brand-sheet.html`), `apps/web` styles, or placeholder avatars. New UI must use his tokens and components, and any new element gets approved by Abhishek in Figma first.
5. **Codex is in charge while Claude Code is at its usage limit.** Claude resumes after the reset; Codex should leave notes in this file (see "Log") so nothing is lost.
6. **Keys live in `.env`** (git-ignored), never in code or chat. The Anthropic, Apify, Creao and Fetch keys were printed once into a Claude session log: rotate them after the hackathon.

## What exists

| Part | Where | State |
| --- | --- | --- |
| Frontend (Figma-faithful) | `streetwise-web/` | Works alone in demo mode (browser-only replay engine). Live mode (`VITE_ENGINE=off`) waits for a gateway |
| Scoring engine, routing, steps, why-this-street, darkness debt, Watcher rules | `services/engine/` | Working, deterministic, tested on the downtown pilot box |
| API (REST + WebSocket hub) | `services/api/main.py` | Working. Its WebSocket speaks our old protocol, not Abhishek's envelopes |
| Fetch.ai agents (Scout, Watcher, Rescuer, Reporter, Night Auditor, place agent) | `services/agents/` | 23/23 offline tests. Not on Agentverse yet |
| Hours pipeline (Apify + Claude parser) | `services/hours/` | Real 10-place pharmacy test works ($0.04). 3 of 10 matched to OSM. Not run at scale |
| Creao Hours Detective | `services/creao/` | Client and prompt done, key valid. No real run yet |
| Old frontend | `apps/web/` | Superseded. Has a self-hosted offline basemap (PMTiles) worth porting |
| Data cache | `data/cache/` | Pilot box only: lat 37.784 to 37.794, lng -122.416 to -122.400 |

## Important gap to decide first

Abhishek's demo corridor is Montgomery BART → Mission → 4th → Howard → 5th → Folsom. **Our cached data and engine only cover the pilot box around Powell St BART → Transamerica Pyramid.** Howard and Folsom are south of the box.

Pick one (recommended: A):
- **A. Move the demo to our box** (Powell BART → Pyramid, Friday 11:04 PM). Everything already scores there. Only `public/data/demo-route.json` and the start/end names change.
- **B. Keep his corridor** and download data for it with `scripts/fetch_data.py`. Overpass has been slow and flaky, so budget an hour and keep A as the fallback.

## The pieces, in order

Each piece ends with something you can see running.

### Piece 1: Import our backend (30 min)
Branch `backend-import`. Commit `services/`, `data/`, `docs/`, `research/`, `scripts/`, `README.md`, `.gitignore`, and move `apps/web` to `legacy/web`. Open a PR into the trunk. Check `git status` first; the hours raw files and `.env` are ignored.

### Piece 2: Gateway (1 h)
Branch `gateway`. Add `WS /ws?walk=<id>&role=<role>` to `services/api/main.py`, as in `streetwise-web/README.md` ("Wiring the gateway"):
- forward every envelope to everyone else in the walk's room;
- on join, send `{kind:"history", envelopes:[...]}`;
- keep the old `/ws/{session}` working until the old frontend is deleted.
Point `streetwise-web/vite.config.ts` `/ws` proxy at `127.0.0.1:8000` instead of the relay on 8787. Test: `/room` on one tab and `/walk` on another see each other's messages.

### Piece 3: Real route plan (2 h)
Branch `engine-demo-data`. Add `GET /api/demo` that returns Abhishek's `DemoData` shape (`streetwise-web/src/lib/types.ts`) built from the engine: `route`, `shortest`, `dimStretches` (with `lampEvidence`, `openPlaces`, `why`), `places`, `stats` (score, longest empty stretch, minutes for both routes), `darknessDebt`. Write the result to `streetwise-web/public/data/demo-route.json` so the demo works offline, and keep the endpoint for live mode. Numbers on stage must come from the engine, not the placeholder 60 vs 49.

### Piece 4: Live mode, agents drive the walk (3 h)
Branch `live-mode`. With `VITE_ENGINE=off`, the backend answers client messages with agent messages:
- `walk.accept` → `walk.plan` (+ `voice.say` from Scout, `agent.log` with `reason`)
- `walk.position` → Watcher rules (`watcher_decide` in the engine) → `checkin.ask`, then `escalate` and `guardian.alert` on silence
- `checkin.reply` → clear the alert
- `place.update` → re-score the route, send a new `walk.plan` plus `agent.log`
- `audit.run` → `audit.result` (ranking and the draft 311 text; nothing is ever submitted)
Reuse thresholds from `walk.plan.plan.thresholds` (default 90 s stop, 45 s reply, 90 s escalate).

### Piece 5: Fetch.ai on Agentverse (2 h)
Branch `agentverse`. Follow `services/agents/README.md`: fill the 8 seeds in `services/agents/.env`, run `run_all.py`, connect the Scout mailbox in Agentverse, confirm Scout answers in ASI:One chat. Make the gateway agents and the uAgents the same logic, called from both (do not fork it). README needs each agent's name, address and the Innovation Lab badges. Get the submission agent address from the Fetch resources doc.

### Piece 6: Real hours (2 h, run in the background)
Branch `hours-run`. Dry run first, then:
```bash
cd services/hours && ../../.venv-hours/bin/python run_pipeline.py --dry-run --categories restaurant,bar,cafe,"fast food restaurant","convenience store",pharmacy,pub,"liquor store",bakery --budget-usd 10
```
Remove `--dry-run` once the cost looks right. Check why only 3 of 10 places matched OSM (`match_osm.py` distance and name thresholds). Then `evaluate.py --parser claude` for an accuracy number, and run 3 places through Creao (`creao_client.py --limit 3`) to get the run share link for the README.

### Piece 7: Map polish (1 h)
Branch `map-offline`. Port the self-hosted Protomaps basemap from `legacy/web` into `streetwise-web/src/lib/mapStyle.ts` (keep his `map/*` Figma colours). OpenFreeMap tiles need the network; venue Wi-Fi is the biggest demo risk. Run `./scripts/fetch_tiles.sh` on every demo laptop.

### Piece 8: Search and the Google-style comparison (2 h)
Branch `search-and-baseline`.
- Destination search with the keyless Photon geocoder (`photon.komoot.io`), limited to the SF area, in Abhishek's Setup screen style.
- The "usual route" line: OSRM walking route (keyless), scored by our engine at the same minute, so the stage comparison is "what a map app sends you" versus Streetwise on the same formula.

### Piece 9: Look at the block, Claude vision on Mapillary (2 h)
Branch `block-vision`. For a dim stretch, fetch the nearest Mapillary street-level image (free key) and have Claude (`claude-sonnet-5-5`) describe what is visible in two plain sentences: lamps, shuttered or lit storefronts, scaffolding. Show it on the existing dim-stretch card with the capture date. **Explanation only, never an input to the score.** Say when no recent image exists. Do not cache or show Google Street View.

### Piece 10: Hills, transit and events (3 h, in this order, stop when time is short)
- Branch `hills`: elevation from Open-Meteo. Add a "flatter route" option and slope in the ETA. Steps and stairs from OSM stay as they are.
- Branch `transit-live`: 511.org real-time arrivals for the transit input (free key). Fall back to the BART schedule we already use.
- Branch `events`: Ticketmaster Discovery API (free key) for shows letting out near the route. Start as an agent note ("Orpheum lets out about 11:15 PM"); only make it a score input if it is documented in the formula and tested.
Each new signal needs a line in the formula docs and a "data missing" state.

### Piece 11: Proof and submission (rest of the night)
- Field walk: walk the demo route near 11 PM if possible; count open places and lit gaps versus the prediction. One honest number for the pitch.
- Anthropic track: pick the named community and confirm the rubric at the booth. Figma and MLH rubrics too.
- Rename or subtitle: a Paris app is also called "Streetwise".
- README with run steps, Devpost text, 3 to 5 min video, 3 min pitch, public repo with no keys, Creao agent ID and run link.

## Demo-day numbers to protect
Friday 11:04 PM, Powell BART → Transamerica Pyramid: typically about 55 vs 49, about +3.2 min, longest empty stretch about 450 m vs 650 m. Across random walks the median gain is about +5.9 to +7 points for about 0.2 to 0.5 extra minutes. The score uses no crime data and no model. Always say "conditions, not a safety rating".

## Run it locally

```bash
# backend (Python 3.14 is fine for the engine)
cd services/api && ../../.venv/bin/uvicorn main:app --port 8000 --reload --reload-dir . --reload-dir ../engine
# frontend
cd streetwise-web && npm install && npm run dev        # http://127.0.0.1:5173
# agents (Python 3.12 venv): see services/agents/README.md
# hours pipeline (Python venv .venv-hours): see services/hours/README.md
```

If `.venv`, `.venv-agents` or `.venv-hours` are missing, recreate them from `services/requirements.txt` and the matching requirements files.

## Rules we keep
- Nothing in the score comes from a model. Models explain, plan and parse; they never change a number.
- Nothing calls 911 and nothing is submitted to the city. Demo shops are labelled simulated.
- Say when data is missing. Never write "safe", "unsafe", "dangerous" or "sketchy".

## Log (add a line per finished piece; newest last)
- 2026-10-24: Trunk is `main`. Local branch `backend-import` holds Abhishek's commit plus our uncommitted backend. Nothing committed or pushed from our side yet.
- 2026-10-24: Piece 1 prepared on `backend-import`: moved the earlier frontend to `legacy/web`, staged the backend and supporting files, updated the root README and ignores, and confirmed the restarted API returns HTTP 200 in the browser. Commit awaits user approval.
- 2026-10-24: Piece 2 prepared on `gateway`: FastAPI now relays walk envelopes at `/ws`, replays room history to joiners, and keeps `/ws/{session}`. Vite proxies `/ws` to port 8000. Confirmed forwarding, history, legacy WebSocket, a production frontend build, and linked `/room` and `/walk` browser views. Commit awaits the user.
