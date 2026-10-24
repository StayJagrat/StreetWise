# Streetwise PWA

The existing Figma-based React/Vite app, extended on **JP** with connected walk sessions, onboarding, privacy, Claude answers and offline assets. Keep using the established tokens and mascots.

| Route | Purpose |
| --- | --- |
| `/` | Animated welcome, overview, install prompt and current walk |
| `/account` | Configured Supabase Google OAuth or guest entry |
| `/setup` | Walker/guardian details, replay vs device GPS, thresholds and consent |
| `/plan` | Start/destination search, departure time, comparison and route evidence |
| `/walk?walk=...` | Private walker session, turns, check-ins, help requests and observations |
| `/guardian/:walk` | Private invitation, live status, alerts and receipt acknowledgment |
| `/shop` | Private simulated business view for the selected demo request |
| `/room` | Private control room, deterministic replay, evidence, audit and agent log |
| `/privacy` | Sharing, voice and prototype limits |
| `/hub` | Development navigation |

## Develop and build

Use Node 22.17+. Run the Python gateway on port 8000 (see the root README), then:

```bash
npm ci
npm run dev
npm test
npm run build
npm audit
```

Vite on 5173 proxies `/api` and `/ws` to FastAPI. A production build is served by FastAPI from `dist/`, so app/API/WebSocket share one origin. HTTPS is required on phones for GPS, microphone and install; loopback works locally.

## Modes

The normal app uses the authenticated gateway. Setup selects either **server GPS replay** or **foreground device GPS**. Replay and simulated places are visibly labelled. Reloading reconnects to the same room and recovers its current versioned plan and deadlines; it does not reset the walk.

`/walk?engine=local&walk=offline-demo` is the separate cached browser replay. It loads the bundled fixture regardless of a previously searched destination. It needs no API, never sends real GPS and cannot provide connected guardian/Claude features. Browser speech availability depends on the device/browser.

MapLibre uses a bundled module worker and an offline GeoJSON SF street basemap by default. `VITE_BASEMAP=pmtiles` optionally selects the team's separately prepared local tile archive. The default does not depend on an unavailable external tile API. The manifest and service worker cache app screens, fonts, street geometry, icons and replay data. Updates wait for explicit user action instead of reloading during a walk.

Server secrets belong in the repository's ignored `.env.server.local`, outside Vite. `VITE_GATEWAY_URL` can point at a separate WebSocket gateway if required; same-origin hosting is simpler. The browser receives only public Supabase auth configuration and private role links, never service credentials.

The old Node relay remains under `relay/` for its foundation tests. It is not the current app gateway. See [workflow](../docs/WORKFLOW.md) and [Supabase](../docs/SUPABASE.md).
