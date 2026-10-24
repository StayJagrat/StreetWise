# Streetwise · JP development

A walking companion for San Francisco, with route comparisons, spoken turns, guardian check-ins and requests for a place to wait. The existing Figma design, mascots and deterministic scoring engine are preserved. Scores describe mapped conditions and listed hours; they are not probabilities of personal safety.

**All work is on `JP`.** The reviewed main snapshot (`cec4172`) was merged into JP. Nothing from this work is merged or pushed into main.

## Run

Use Node 22.17+ and Python 3.12+. From the repository root:

```powershell
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -r services/requirements.txt
cd streetwise-web
npm ci
npm run build
cd ..
.venv/Scripts/python.exe -m uvicorn services.api.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** for the production PWA. For frontend development, run `npm run dev` in `streetwise-web/` in another terminal; port 5173 proxies both API and WebSocket traffic to port 8000.

Copy `.env.server.example` to ignored `.env.server.local` for optional Supabase persistence and Claude answers. The normal gateway stores rooms durably in local SQLite even without Supabase. Never put server credentials in frontend environment variables.

Phones need one HTTPS origin for app, API and WebSocket. Run one gateway worker with persistent disk; the current socket fan-out is process-local. A frontend-only static host cannot run this backend. Google OAuth needs its provider configuration and an allowed redirect for the deployed origin.

## What works

- Welcome/onboarding, guest account flow, setup/consent, SF start/destination search and departure-time comparison.
- Server-owned GPS replay or foreground device GPS, spoken turns and optional browser microphone.
- Private role-scoped walker, guardian, shop and control-room links with two-hour expiry.
- Server check-in deadlines, guardian alerts, receipt acknowledgment and separate walker resolution.
- Simulated place requests: waiting, refusal/timeout fallback, acceptance and recomputed route geometry/turns.
- Route evidence, unverified observations, reviewed report drafts, distinct arrival/end outcomes and stopped location sharing.
- Local recovery, private Supabase snapshots, installable PWA shell and a separately labelled cached offline replay.
- Claude answers grounded in current route facts. Speech uses browser APIs; Cartesia is not required.

Guest entry is the chosen flow for this build; Google sign-in is deferred at the user’s request. Agentverse adapters exist under `services/agents/`; the PWA currently runs deterministic agent roles in the gateway. Real business participation, push/background monitoring and emergency dispatch are not implemented.

## Verify

```powershell
.venv/Scripts/python.exe -m unittest services/api/test_pwa.py services/api/test_live_walk.py
cd streetwise-web
npm test
npm run build
npm audit
```

See [the current workflow](docs/WORKFLOW.md), [Supabase configuration](docs/SUPABASE.md), [PWA guide](streetwise-web/README.md) and [team handoff](docs/HANDOFF.md).
