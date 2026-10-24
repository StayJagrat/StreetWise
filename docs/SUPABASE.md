# Supabase foundation on JP

## Cloud project

- Organization: Streetwise, Free plan.
- Development project: `streetwise-jp-dev`.
- Project reference: `myihzchlereyzckkavbn`.
- [Dashboard](https://supabase.com/dashboard/project/myihzchlereyzckkavbn).
- Project API URL: `https://myihzchlereyzckkavbn.supabase.co`.

This dedicated development project is separate from GitHub `main`. No GitHub integration or deployment trigger is connected. Keep future code work and pushes on `JP`.

JP was built/tested from `519db43`. The teammate's independent merge advanced main to `cec4172` during this work. The [workflow](WORKFLOW.md#updated-main-integration-handoff) names the existing FastAPI persistence hook and synchronization checks. This change does not yet persist the newly merged Python gateway's events.

## Schema

| Table | Purpose |
| --- | --- |
| `walk_sessions` | Phase, thresholds, latest replay position, bounded reconnect history, event sequence, reset generation and expiry |
| `walk_events` | Append-only accepted envelopes, one unique event ID, per-walk sequence |
| `place_catalog` | Four public demo locations with explicit fixture provenance |
| `walk_place_status` | Latest shop command per place and walk |
| `walk_incidents` | Check-in deadline, alert, acknowledgement and distinct resolution |
| `report_drafts` | Walk summaries and 311 drafts; status constrained to `draft` |

`record_walk_event(jsonb)` records an event and its projections atomically under a per-walk row lock. Duplicate envelopes return `inserted: false`; a reused ID with different content raises an error. `walk.reset` starts a new generation while retaining shop/guardian context. `walk.end` clears the latest position and strips position/alert packets from future reconnect history. Historical events remain service-only until retention cleanup.

All six tables have RLS enabled. The migration revokes table access and RPC execution from `anon`, `authenticated` and `PUBLIC`, then grants the existing `service_role` only the required table operations and functions. There are deliberately no public-read policies. See [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

The seed contains no real walker tracks, recordings, contact details or verified shop claims. It does not overwrite existing place evidence.

## Server configuration

At the repository root, copy `.env.server.example` to the ignored `.env.server.local`. This keeps privileged credentials outside Vite's `streetwise-web/` root and env loading directory. Set:

```dotenv
SUPABASE_URL=https://myihzchlereyzckkavbn.supabase.co
SUPABASE_SECRET_KEY=your-server-only-secret
```

Use an existing project secret from the dashboard's API Keys page; a legacy `SUPABASE_SERVICE_ROLE_KEY` is also accepted and is configured locally for this development project. Keep the value private. Never put a secret/service-role key in a `VITE_` variable, the web app's env files, client source, a URL, screenshot, README, or commit. A publishable/anon key cannot use this service-only schema. The adapter has no persisted auth session and applies a four-second request timeout.

```bash
npm ci
npm run db:check
npm run db:seed
npm run db:smoke
npm run relay
```

In a second terminal, run `npm run dev`. The existing Vite `/ws` proxy reaches the loopback-only relay on port 8787. Keep using an HTTPS tunnel for phone permissions. `GET http://127.0.0.1:8787/health` reports storage, persistence health and pending writes without exposing locations or credentials.

Omit the server env file and both Supabase variables to use the existing in-memory fallback. A partially configured or unavailable database fails startup explicitly. If persistence fails during an active demo, socket delivery continues while a bounded queue retries in order. Health becomes degraded. Pending writes are memory-resident and can be lost if that process exits; do not claim guaranteed durable delivery until the queue drains.

## Migration workflow

The source of truth is `supabase/migrations/20261024200000_walk_persistence.sql`; `supabase/seed.sql` supplies labeled fixtures. For a new empty project, apply the migration first and seed second, or use the linked Supabase CLI.

If bootstrapping through Dashboard SQL Editor, the CLI migration ledger is not automatically updated. Before later CLI pushes, link this development project and reconcile that one already applied version:

```bash
# Run from the repository root after normal Supabase CLI login.
npx supabase link --project-ref myihzchlereyzckkavbn
npx supabase migration repair 20261024200000 --status applied
npx supabase db push --dry-run
```

Verify the applied schema before recording a migration as applied. For subsequent changes, add a new timestamped migration, test it locally, inspect `db push --dry-run`, and push to the development project. Do not rerun the initial `create table` migration over existing tables, reset a hosted database, or connect an automatic deployment to GitHub `main`.

With Docker Desktop running, `npx supabase start` and `npx supabase db reset --local` create/recreate a disposable local database using this config and seed. The latter resets the local database only. Docker was not running during initial setup; use the embedded PostgreSQL tests below without Docker.

## Verification

```bash
cd streetwise-web
npm test
npm run build
```

Tests execute the complete migration and seed using PGlite, check RLS/grants and service-only function execution, exercise atomic rollback, duplicate IDs, state recovery, acknowledgement versus resolution, location redaction and retention. Separate real-WebSocket tests check room isolation, role/payload consistency, non-blocking delivery during a slow write and ordered retry.

`npm run db:smoke` is an explicit hosted test. It creates one labeled synthetic walk, checks actual API writes, guardian delivery, acknowledgement, resolution, a draft report and recovery after relay restart. It leaves that synthetic record under 24-hour demo retention; it does not upload real user data or delete existing records.

Verified on October 24: initial migration and seed applied in the dashboard; all six tables have RLS, browser roles have no SELECT grant, four fixture places exist, `db:check` and `db:smoke` pass, and browser control-room/guardian/shop actions persist through the relay. The initial migration was applied through SQL Editor, so follow the ledger reconciliation instructions above before a later CLI push.

To check cloud schema safely in SQL Editor:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select id, simulated, source from public.place_catalog order by id;
```

Demo sessions expire after 24 hours, renewed on reset. The running relay invokes `purge_expired_demo_walks()` hourly. If the relay is stopped, an operator/scheduled service must invoke that service-only function to enforce cleanup. It only deletes expired demo sessions and their dependent records; it does not delete live sessions.

## Next production boundary

This change does not authenticate a socket, prove guardian consent, authorize a shop owner, run safety timers on the server, deploy real agents, or provide reliable background alerts. It explicitly refuses live GPS on the demo relay/RPC. Implement those gateway capabilities before persisting actual walks or opening the service to real users. RLS protects the direct database API; it does not make an unauthenticated relay safe for live location data.

The existing dependency baseline reports six npm audit findings (including MapLibre critical and Vite high). They predate this change and require tested major-version upgrades. Keep the prototype on a trusted development network until that upgrade and the authenticated gateway are complete.
