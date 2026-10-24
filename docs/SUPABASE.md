# Supabase on JP

## Development project

The separate project is **streetwise-jp-dev**, reference `myihzchlereyzckkavbn`, in the Streetwise organization. [Open its dashboard](https://supabase.com/dashboard/project/myihzchlereyzckkavbn). This project's database branch label “main” is unrelated to GitHub main. All repository work stays on JP.

## Current PWA storage

`services/api/persistence.py` journals each private room in SQLite, then mirrors snapshots asynchronously to `public.pwa_rooms`. The snapshot contains state, deadlines, role capability hashes, a private invitation seed and bounded reconnect history. Only the server holds the service credential. The browser calls the gateway; it does not query this table.

Migration: `supabase/migrations/20261025010000_private_pwa_rooms.sql`, applied to this development project through SQL Editor. RLS is enabled; direct access and RPC execution are revoked from public browser roles. `save_pwa_room(jsonb)` accepts service-role writes and rejects an older sequence from replacing a newer snapshot. Local durable delivery does not wait for the cloud request. Health reports `connected`, `retrying`, `setup_required` or `not_configured` truthfully.

Each room expires after two hours. The running gateway removes expired local rooms and closes their sockets. The cloud save function purges expired snapshots on subsequent saves; if the service is completely idle/stopped, schedule equivalent service-only expiry cleanup if strict deletion timing is required. Expired role links are refused regardless of delayed physical cleanup. After a walk ends, position/alert/observation packets are removed from reconnect history and live position is cleared from state.

Use one API worker with persistent disk. Cloud snapshots support recovery when the local journal has no room, but the current WebSocket fan-out is not shared between multiple workers. Supabase mirror lag/retries are not guaranteed delivery or a background alert service.

## Configuration

Copy the root `.env.server.example` to ignored `.env.server.local`:

```dotenv
SUPABASE_URL=https://myihzchlereyzckkavbn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-value
ANTHROPIC_API_KEY=server-only-value
SUPABASE_ANON_KEY=public-client-key
GOOGLE_AUTH_ENABLED=false
```

A modern `SUPABASE_SECRET_KEY` is accepted instead of the legacy service-role key. Never put either privileged key in a `VITE_` variable, the web source tree, URL or commit. A public publishable/anon key cannot execute the private room RPC. The API exposes public auth configuration only through `/api/config`.

For Google login, configure a Google OAuth client in Supabase Authentication → Sign In / Providers, set allowed callback/redirect URLs for the deployed origin, and then enable `GOOGLE_AUTH_ENABLED=true`. The client uses Supabase OAuth and does not invent a logged-in session. Guests can use private walk links while the provider is unconfigured.

## Migrations and tests

The earlier foundation remains in `20261024200000_walk_persistence.sql`: six service-only event/projection tables and labelled demo seed records. The legacy Node relay uses those tables; the current FastAPI PWA uses `pwa_rooms`. Keep them distinct rather than importing four fixture places over the real engine's evidence.

Both hosted migrations were applied via Dashboard SQL Editor. Before any later CLI migration push, verify the schema, link this development project and reconcile the applied versions:

```bash
npx supabase link --project-ref myihzchlereyzckkavbn
npx supabase migration repair 20261024200000 --status applied
npx supabase migration repair 20261025010000 --status applied
npx supabase db push --dry-run
```

Add timestamped migrations for future changes. Do not reset this hosted project or rerun an initial create-table migration over existing tables. `npm test` in `streetwise-web/` executes migration/permission/sequence checks in PGlite without Docker or credentials. The legacy `db:check`, `db:seed` and `db:smoke` commands refer to the earlier event-log harness, not the normal Python gateway.

The current project's private snapshot write and recovery are verified using synthetic demo rooms. No real device location is used in automated testing.
