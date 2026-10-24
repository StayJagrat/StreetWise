# Streetwise

Walking navigation that scores route conditions from open places, lighting, and reachability at the minute you pass each block. Built for Cal Hacks 13.0 in San Francisco. The Night Walk Score is deterministic Python in `services/engine`; it uses no model or crime input. It describes conditions, not a safety rating.

## Start here

Read [the handoff](docs/HANDOFF.md) for the current plan, decisions, and demo state. The only app design is Abhishek's build in `streetwise-web/`; its [README](streetwise-web/README.md) documents the screens, data contract, and gateway messages.

## Layout

| Path | Purpose |
| --- | --- |
| `streetwise-web/` | React and Vite PWA, with Figma tokens and mascots |
| `services/engine/` | Deterministic scoring, routing, and route evidence |
| `services/api/` | FastAPI routes and WebSocket gateway |
| `services/agents/` | Fetch.ai agents |
| `services/hours/` | Place hours pipeline |
| `services/creao/` | Hours Detective client |
| `data/cache/` | Downtown pilot data cached for the demo |
| `scripts/` and `research/` | Data fetches and analysis |
| `legacy/web/` | Superseded frontend retained for its offline map reference |

## Run locally

Follow the commands in [docs/HANDOFF.md](docs/HANDOFF.md#run-it-locally). The API runs on port 8000 and the PWA on port 5173. No keys are required for the cached demo; local keys belong in the ignored `.env`.

The cached data covers the Powell BART to Transamerica Pyramid pilot area. Demo shops are labelled simulated. The app does not call 911 or submit reports to the city. When data is missing, the interface should say so.
