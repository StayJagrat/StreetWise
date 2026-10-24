# Streetwise — web (PWA)

The front end for Streetwise, built from the Figma file *Streetwise — Cal Hacks 13.0*.
It is one React + Vite PWA with five screens that all join the same walk room:

| Route | Who | What |
|---|---|---|
| `/walk` | Walker, demo phone + earbuds | Scout's route offer → walking (street-sign turns, voice) → check-in → guardian alerted → home |
| `/guardian/:walk` | Judge's phone via QR | Live map, full-screen alert, "I'm on it", handoff packet. No install, no login |
| `/shop/:place` | Teammate as shopkeeper | Staying open / safe haven / front light → drives the place agent |
| `/room` | Laptop on stage | Map, agent feed with reasons, why-this-street card, darkness debt, replay timeline, guardian QR |
| `/setup` | Walker, once | Guardian + standing orders (stop 90 s, reply 45 s), "never calls 911" |

`/` is a hub with links to all of them.

## Run it

```bash
npm install
npm run assets        # regenerates mascots, icons and public/data/demo-route.json (already committed)
cd ../services/api && ../../.venv/bin/uvicorn main:app --port 8000 --reload --reload-dir . --reload-dir ../engine
# In another terminal:
cd streetwise-web && npm run dev   # app on :5173, proxies /ws to the API
```

PWAs need HTTPS for the mic, location and install. Put one tunnel in front of Vite and everything rides it — the app and the `/ws` room:

```bash
cloudflared tunnel --url http://localhost:5173     # or: ngrok http 5173
```

Open `https://<tunnel>/room` on the laptop, scan the QR with a second phone (guardian), open `/walk` on the demo phone and `/shop/cafe-mia` on a teammate's phone.

For the demo build: `npm run build && npm run preview` (port 4173, same `/ws` proxy).

## Demo mode vs live mode

**Demo mode (default)** — `src/lib/engine.ts` plays the five agents from cached data so the demo never depends on Wi-Fi or on the agents being up:

- GPS is replayed along the route, with the "DEMO · GPS REPLAY · ×N" tape always visible.
- One stop is injected on the dim stretch of Howard St. After the stop threshold the Watcher asks; if there's silence, the Rescuer alerts the guardian.
- Shop toggles re-score the block and the walker hears it.
- Replay speed is set in `/setup` (×6 by default; thresholds are scaled by the same factor and the UI says so).
- Reloading `/walk` starts a fresh walk (`walk.reset`).
- If the walker phone dies, press **Start demo walk here** in the control room.

**Live mode** — `VITE_ENGINE=off` (or `/walk?engine=off`): no local engine. The walker sends real GPS fixes, and the gateway's agents send everything else using the same messages.

## Wiring the gateway (Brain)

`src/lib/types.ts` is the contract. Every message is an envelope:

```json
{ "id": "…", "walkId": "demo", "ts": 1761373440000, "from": "engine|walker|guardian|shop|room|gateway", "msg": { "type": "…", … } }
```

The FastAPI gateway (`services/api/main.py`) now:

1. Accept `wss://…/ws?walk=<id>&role=<role>`.
2. Forward every envelope to everyone else in that walk's room.
3. Sends `{ "kind": "history", "envelopes": [...] }` to a late joiner.

`relay/server.mjs` remains an optional standalone development relay. For a separately hosted API, set `VITE_GATEWAY_URL=wss://your-gateway/ws`.

Message types the agents produce:

- `walk.plan`
- `voice.say`
- `checkin.ask`
- `escalate`
- `guardian.alert`
- `agent.log` (with `reason`, which shows in the control room)
- `walk.end`
- `audit.result`

The client produces:

- `walk.accept`, `walk.start`, `walk.position`
- `checkin.reply` (voice or tap)
- `guardian.join`, `guardian.ack`
- `place.update`
- `audit.run`

## Voice (Voice role)

`src/lib/voice.ts` uses browser speech as the stopgap. To use Cartesia instead:

- Swap the output with `setSpeaker({ speak, stop })`, using Sonic streamed via the gateway into Web Audio.
- Swap the input with `setListenerFactory(...)`, using Ink with turn detection.

The "Go this way" tap already unlocks audio, starts the mic and requests the screen wake lock. Speaking over the app stops playback.

## Map (City role)

The map uses MapLibre GL with OpenFreeMap vector tiles (keyless). They're recolored in `src/lib/mapStyle.ts` with the Figma `map/*` variables: Night for the walker and control room, Day for the guardian and shop. Tiles are cached by the service worker. If the tile server is unreachable, the route, lamps and places still draw.

`public/data/demo-route.json` holds the demo corridor:

- real OSM street geometry (OSRM foot routing), Montgomery BART → Mission → 4th → Howard → 5th → Folsom
- the shortest path for comparison
- dim stretches with their evidence text
- places, with `simulated: true` on everything not run by a teammate
- Route 1 stats from the data spike: 60 vs 49, 44 m vs 115 m, +2.1 min
- darkness-debt ranking

To match the stage numbers exactly, replace `route` / `shortest` / `dimStretches` with geometry exported from `data/spike_score.py`.

To show per-segment scores in the control room, drop a `public/data/segments.geojson`: LineString features with `properties.score` (0–100) and `properties.confidence`. Brighter and wider means a better score. It is never drawn as a crime heatmap.

## Honesty rules baked into the UI

- Demo tape on every replay.
- "Simulated" tag on fake shops.
- 311 reports are drafts only, with no invented case IDs.
- The walker, guardian and setup screens say plainly that Streetwise never calls 911.
- The guardian sees location only during an active walk.
- No mascots on the alert screens.

## Design source

Tokens in `src/styles/tokens.css` mirror the Figma variable collection *Streetwise* (Night/Day).

Fonts:

- Bricolage Grotesque (display)
- Instrument Sans (body)
- Barlow Condensed (signs and numbers)
- DM Mono (logs)

The mascots in `public/mascots/` are generated from the same SVG source as the Figma *Mascot* component set: Scout (pigeon), Watcher (raccoon), Rescuer (sea lion), Reporter (crow) and Night Auditor (moth), each with four states.
