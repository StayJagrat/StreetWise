# Product decisions (agreed Oct 24, after the skeptical-judge review)

Read with `docs/HANDOFF.md`. These override anything older in `docs/TOOLS_AND_TRACKS.md` or `docs/BRAND.md`.

## What Streetwise is
A PWA for smart travellers: walking navigation that picks routes by street conditions (what is open, lit, busy and reachable at the minute you pass), explains every choice, and comes with a personal voice agent that gets things done from one request. San Francisco only for this hackathon. Not a Google Maps competitor: it is an agentic, explainable safety-aware layer.

## Score rules
- **Crime is not in the score.** In our downtown test, reported crime was higher on the streets our conditions score rated best (busy streets generate more reports). It may appear only as an optional overlay, off by default, labelled "reported incidents, reflects reporting not risk".
- **No homelessness or encampment data anywhere.** It treats people as a hazard, and SF 311 encampment data measures complaints, not presence.
- The score stays deterministic Python. Models explain, plan and parse; they never change a number.
- Say "conditions, not a safety rating". Never claim a route is safe. Show validation honestly (a field-walk number).
- Add real "how busy": Apify Google Maps popular-times histograms, so a place counts by how busy it is at the arrival minute, not only open or closed.

## Headline feature: the voice agent
A personal agent that works through any earbuds (plain audio, no native app, no head gestures): "Get me home past an open pharmacy and text Maya" becomes one request. Built as Claude with tool use, where our engine is the tool set: plan route, search open places, start a guardian link, report a broken light, check hours.
- PWA limits to state plainly: the screen must stay awake (wake lock); browser speech recognition is unreliable, so tap fallbacks always stay.

## Agents must be real
Scout asks place agents "will you be open at 11:40?" over Agentverse, visibly, while the user plans. Every agent decision shows its reason. Not labels around one script.

## Vision (only the real uses)
- Photo of a broken streetlight, then Claude vision, then a structured 311 draft (never submitted).
- Dim stretch: Claude describes recent street imagery as an explanation only, never as a score input.
- No camera gimmick that feeds nothing.

## Onboarding
Animated logo and a one-screen minimalist overview, then Google sign-in used only to keep guardian contacts and settings, then "Ready for smart travel": start and destination, location permission. The guardian link stays login-free.

## Must ship / only if time / cut
- **Must ship:** onboarding animation, planner (done), real hours and popular-times data, agent feed with Fetch.ai on Agentverse, Claude tool-use voice assistant, one photo-to-311 flow, field-walk accuracy number, video and pitch.
- **Only if time is left:** Google sign-in, Mapillary block descriptions, hills, transit and events, the optional crime overlay.
- **Cut:** homelessness data, crime inside the score, Elastic.

## Questions judges will ask (prepare answers)
How do you know it is safer? False negatives? What if someone is wrongly reassured? Location privacy and retention? Could the guardian link be abused for stalking? Why is crime not in the score?
