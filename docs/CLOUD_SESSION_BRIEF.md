# Cloud session brief: voice assistant, photo report, onboarding

You are building four self-contained pieces for Streetwise (Cal Hacks 13.0, deadline Sun Oct 25 2026, 9:00 AM PT) on branch **`assistant`**, which already contains everything on `engine-demo-data`. A teammate is changing the backend and the live walk on other branches at the same time, so **stay in new files** and keep edits to shared files to the one-liners listed below.

Read first, nothing else: `AGENTS.md`, `docs/PRODUCT_DECISIONS.md`, and the sections named in each piece. Do not read the whole repo, and never `cat` anything in `data/cache/` (large JSON).

## Token and cost rules (budget about $90; stop and report at $90)
- Plan once in 10 lines, then implement. No exploratory refactors, no re-reading a file you just wrote, no rewriting working code.
- Use `grep -n` and line-range reads. Batch independent tool calls in one turn. Write each file in one go.
- Mock the Anthropic API in tests (patch the HTTP call). Allow at most **3 live Claude calls in total** as a smoke test. Use `claude-haiku-5-5` for extraction and classification, `claude-sonnet-5-5` for the assistant's tool loop. Use prompt caching (`cache_control` on the system prompt and tool list).
- Commit and push after each piece (`git push -u origin assistant`). Work must survive if the budget runs out. Checkpoints: after Piece 1 report cost; after Piece 3 report cost; stop at $90.
- Medium reasoning effort is enough. Do not spawn subagents unless a task needs a search across more than 10 files.

## Environment (cloud has no `.env`)
Set these as environment secrets before starting, or the live smoke test is skipped: `ANTHROPIC_API_KEY` (required for Pieces 1 and 3). `APIFY_TOKEN` is only for Piece 5. Never print, log or commit a key. Read keys with `os.environ` (the helper `_key()` in `services/api/vision.py` also reads a local `.env`).
Setup: `python3 -m venv .venv && .venv/bin/pip install -r services/requirements.txt pytest httpx` then `cd streetwise-web && npm ci`.
`data/cache/*.json` is committed, so the engine boots in about 3 s with no network. The basemap `sf.pmtiles` is not in git, so the map will be blank in the cloud: verify frontend work with `npx tsc --noEmit` and `npm run build`, and backend work with `fastapi.testclient.TestClient`. Do not try visual map testing.

## Hard rules (from `AGENTS.md` and `PRODUCT_DECISIONS.md`)
- The only design is Abhishek's: use `streetwise-web/src/styles/tokens.css` variables, the mascots in `public/mascots/` and existing classes (`.card`, `.btn`, `.chip`, `.sheet`). No new colours, no new fonts, no new npm dependencies.
- The score is deterministic Python. The assistant may call the engine; it never edits `services/engine/*`.
- No crime or homelessness data. Never use the words safe, unsafe, dangerous, sketchy. The app never calls 911, never sends a text by itself, never submits a 311 report. It drafts, and the user taps to share.
- Files you must not edit: `services/engine/**`, `services/api/live_walk.py`, `services/api/demo_data.py`, `streetwise-web/src/lib/store.ts`, `lib/engine.ts`, `lib/voice.ts`. Shared files you may touch only as stated: `services/api/main.py` (one `include_router` line per router), `streetwise-web/src/App.tsx` (one `<Route>` per screen), `Plan.tsx` and `Walk.tsx` (one mount line for a component).

---

## Piece 1: the assistant backend (highest value, do first, about 40% of the budget)

Goal: one request like "Get me from Powell BART to Mission Dolores Park leaving at 11, and tell Maya" becomes tool calls against the real engine and returns a spoken answer plus actions the app executes.

**File:** `services/api/assistant.py` (an `APIRouter`, like `vision.py`; register with one line in `main.py`). Keep the core a pure function `run_assistant(engine, text, context, call_llm=default_llm)` with no FastAPI types, so `services/agents/scout.py` can reuse it later for Agentverse.

**Endpoint:** `POST /api/assistant` with `{text, walk_id, context: {position: [lon, lat] | null, day, minute, route_id?, destination?}}` returning `{say, actions, trace}`.
- `say`: at most 2 short sentences, spoken aloud. Numbers first, plain words.
- `actions`: a list the frontend executes: `{type: "route", data: DemoData}` (same shape as `/api/route-demo`), `{type: "share", url, text}`, `{type: "open", path}` (for example `/walk`), `{type: "report", kind}`.
- `trace`: `[{agent, text, reason}]` for the agent feed: one entry per tool call (agent `scout` for routing, `watcher` for the walk, `reporter` for reports). Also publish each as an `agent.log` envelope to the walk room using the existing `WalkRoom` in `main.py` (grep `class WalkRoom`) so the control room shows the agents working.

**Claude tool loop** with a plain HTTPS call to `https://api.anthropic.com/v1/messages` (as `vision.py` does; no SDK). Model `claude-sonnet-5-5`, `max_tokens` 400, at most 4 tool rounds, 12 s total timeout. If the key is missing or the call fails, return a deterministic fallback answer (`say` explains that the assistant is offline and `actions` is empty); never raise a 500.

**Tools** (define as JSON schemas, execute against `engine`; lock with `engine.lock`; run blocking code with `run_in_threadpool`):
1. `resolve_place(query)`: use `engine.search(query)` (offline). Return the best match with `lat`, `lon`, `name`. "here" or "my location" resolves to `context.position`.
2. `plan_route(origin, destination, day, minute)`: call `build_route_data` from `services/api/demo_data.py` (signature: `engine, lat, lon, name, origin=(lat, lon), origin_name, day, depart`). Return the stats only to Claude (scores, minutes, longest empty stretch) and put the full `DemoData` in an action.
3. `find_open_places(near, category, within_m, minute)`: use `engine.places(session, day, minute)` (rows: `[id, lon, lat, name, cat, open(-1 unknown, 0 closed, 1 open), declared]`), filter by distance, return up to 5. Say so when hours are unknown.
4. `route_via(origin, via, destination, day, minute)`: two `build_route_data` calls (origin to via, via to destination); report both legs and the combined minutes. State clearly that the combined score is an average of the legs, not a re-score.
5. `explain_street(lat, lon, day, minute)`: `engine.why(...)`; return its `text`.
6. `share_walk(guardian_name)`: returns the guardian URL `/guardian/<walk_id>` as a `share` action. The app opens the phone's share sheet. The assistant must say "Tap to send"; it never claims a message was sent.
7. `draft_311(kind, note, lat, lon)`: a short plain draft, labelled as a draft, never submitted.

**System prompt** (keep under 250 words, cached): persona "Scout, the Streetwise travel agent"; one request, get it done; ask at most one clarifying question and only if the destination is ambiguous; always state the data limits ("places with no listed hours count as closed"); say "conditions, not a safety rating" once per plan; never promise safety; refuse crime, homelessness or "is this neighbourhood dangerous" questions by explaining that Streetwise scores conditions on a street, not neighbourhoods or people.

**Tests** (`services/api/test_assistant.py`, pytest, `TestClient`, Claude mocked with scripted tool-use responses): (a) a planning request produces a `route` action whose `stats` match `/api/route-demo` for the same inputs; (b) `find_open_places` filters by distance and open state; (c) a failing Claude call returns the fallback with HTTP 200; (d) the `trace` has one entry per tool call; (e) a crime question is refused politely. Then one live smoke call.

**Done when:** `pytest services/api/test_assistant.py` passes, the live smoke call plans Powell St BART to Mission Dolores Park in under 8 s, and `curl` on `/api/assistant` works against `uvicorn`.

## Piece 2: the assistant UI (about 15%)

Goal: a mic button on the planner and the walk screen. Hold or tap to talk, or type. The answer is spoken and the actions run.

**Files (new):** `streetwise-web/src/components/Assistant.tsx` + `assistant.css`, `streetwise-web/src/lib/assistantVoice.ts`, `streetwise-web/src/lib/assistantApi.ts`. Mount `<Assistant />` with one line each in `screens/Plan.tsx` and `screens/Walk.tsx`.
- `assistantVoice.ts`: `listenOnce(onTranscript, onError)` using `SpeechRecognition`/`webkitSpeechRecognition` with `interimResults: true`, language `en-US`, a 8 s cap; reuse `speak`, `stopSpeaking`, `unlockAudio` from `lib/voice.ts` (do not edit that file). `canListen()` is already exported there.
- UI: a round mic button in the style of `.round-btn` (grep `round-btn` in `screens/walk.css`), a small bottom sheet with the live transcript, Scout's `say` text with `<Mascot agent="scout" state="thinking|talking|done">`, and the `trace` as one-line agent rows (reuse `AgentRow` from `components/ui.tsx`). A text input is always available as the fallback (browser speech recognition is unreliable, and the Browser pane blocks the mic).
- Action handling: `route` calls the same code path as the planner's "Review with Scout" (`saveSettings` + `primeDemoData` from `lib/store.ts`, then `navigate('/walk')`); `share` calls `navigator.share` with a fallback to `navigator.clipboard`; `open` navigates.
- Respect `prefers-reduced-motion`. Keep the sheet small. Do not add a settings screen.

**Done when:** `npx tsc --noEmit` and `npm run build` pass, and a Vite dev run with the API running shows a typed request ("Powell BART to Ferry Building at 11") opening the walk preview. If you have no browser, show the request and response with `curl` and state that the UI was type-checked only.

## Piece 3: photo to a 311 draft (about 15%)

Goal: the user photographs a broken streetlight, Claude reads it, and a structured draft appears. Nothing is submitted.

**Files (new):** `services/api/report.py` (router, one line in `main.py`), `streetwise-web/src/components/ReportSheet.tsx` + `report.css`.
- `POST /api/report-photo` (multipart: `image`, `lat`, `lon`, `note?`). Reject files over 4 MB. The client resizes to at most 1280 px on the long side and JPEG 0.8 before upload (canvas), which also keeps token cost low.
- Claude vision (`claude-haiku-5-5`, `max_tokens` 300) returns strict JSON: `{category: "streetlight_out" | "streetlight_flickering" | "other" | "not_a_street_issue", confidence: 0..1, description, visible_hazards: []}`. Parse defensively; on bad JSON return `category: "other"`.
- Build the draft server-side from a template, with the address from the nearest named street (`engine.why(...)["street"]`, falling back to coordinates). Text begins "DRAFT, not submitted." Never add case IDs.
- If `category` is `not_a_street_issue` or confidence is below 0.5, say so and let the user retake the photo.
- UI: `ReportSheet` is opened by the assistant's `report` action and by a small "Report a light" link on the walk screen's arrived state (one mount line). Uses `<input type="file" accept="image/*" capture="environment">`, shows the photo, the finding, the draft, and "Copy draft" and "Share" buttons. Use the Reporter mascot.

**Tests:** mocked Claude responses for each category; oversized file rejected; draft never contains "submitted" without "not". One live call with a generated test image.

## Piece 4: onboarding (about 15%)

Goal: first launch shows an animated logo, a three-card overview, optional Google sign-in, then "Ready for smart travel?" and the planner.

**Files (new):** `streetwise-web/src/screens/Onboarding.tsx` + `onboarding.css`. Route `/welcome` (one `<Route>` line in `App.tsx`). Change nothing else: after finishing, set `localStorage['streetwise:onboarded']='1'` and navigate to `/plan`. Add a small `useEffect` redirect to `/welcome` in `screens/Home.tsx` only if the flag is missing (one place, guarded by try/catch because storage can be blocked).
- Animation: CSS keyframes only (no new dependencies): the wordmark "streetwise" fading in letter by letter, the five mascots (`public/mascots/*-idle.svg`) arriving one after another, a soft route line drawing across the background. Under 2.5 s, skippable, and a still state for `prefers-reduced-motion`.
- Overview: three cards, one line each: "Routes scored block by block", "Agents that check in and ask first", "A guardian link, never a 911 call". Swipe or tap.
- Google sign-in: use Google Identity Services (`https://accounts.google.com/gsi/client`) only when `VITE_GOOGLE_CLIENT_ID` is set; otherwise show "Continue as guest". Store only name, email and picture in `localStorage` (`streetwise:user`) and say plainly in the UI that this is a demo-grade sign-in with no server account. The guardian page needs no login.
- Final card: "Ready for smart travel?" with one button to `/plan`, and a line "Location is asked only when you tap Use my location."

**Done when:** `tsc` and `build` pass, `/welcome` renders, and first-run versus returning-run redirects behave.

## Piece 5 (only if budget remains): busy places from popular times

The Apify Google Maps actor returns `popularTimesHistogram`. Extend `services/hours/fetch_apify.py` to keep it, write `data/cache/popular_times.json` as `{place_id: {Mo: [24 ints], ...}}` using the existing match step in `services/hours/match_osm.py`, and expose "busy now" as text only in `/api/assistant` (`find_open_places` rows) and the place cards. **Do not change the score or `WEIGHTS`.** If you believe the score should use it, write the proposed formula change in `docs/HANDOFF.md` under a new heading and stop. Real runs spend Apify credit: dry-run first with `--dry-run`, cap at `--budget-usd 5`, restaurants, bars, cafes and pharmacies only.

---

## Final report (when done or at $90)
In `docs/HANDOFF.md` Log, add one line per finished piece, then reply with: what was finished, what was verified and how (tests, build, live calls), what was not verified, total cost so far, and the exact commands to run it. Open a PR from `assistant` into `engine-demo-data` and do not merge it.
