# Streetwise · JP development

A voice-first walking companion for San Francisco. Route conditions come from deterministic Python calculations using arrival-time opening hours, lighting evidence and access to help. Scores describe conditions, not the likelihood of personal safety.

All development in this checkout belongs to **JP**. The current main engine, API and frontend snapshot has been integrated into JP; no changes are pushed to main.

- [Team handoff](docs/HANDOFF.md)
- [JP workflow and completion notes](docs/WORKFLOW.md)
- [Supabase setup](docs/SUPABASE.md)
- [PWA guide](streetwise-web/README.md)

## Run locally

```powershell
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -r services/requirements.txt
.venv/Scripts/python.exe -m uvicorn services.api.main:app --host 127.0.0.1 --port 8000
# A second terminal:
cd streetwise-web
npm ci
npm run dev
```

The PWA uses port 5173 and proxies its API and WebSocket traffic to port 8000. The cached demonstration works without provider credentials. External integrations show their availability rather than impersonating a connected provider. Demo shops are labelled simulated; reports remain drafts and no emergency calls are automatic.

## Layout

`streetwise-web/` contains the existing React/Vite design. `services/engine/` owns scoring and routing; `services/api/` owns walk sessions and the gateway; `services/agents/` contains the Fetch.ai adapters. `supabase/` stores private operational database migrations. Server credentials belong in ignored environment files only.
