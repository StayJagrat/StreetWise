"""Typed PWA walk messages backed by the deterministic Streetwise engine.

This adapter shares the engine's route, scoring, and Watcher decisions with the
REST API. It does not start Agentverse agents or use a model to produce a score.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi.concurrency import run_in_threadpool

from demo_data import DAY, DEPART, DESTINATION, ORIGIN, _fixed_route_stats
from streetwise_engine.engine import Engine
from streetwise_engine.scoring import Ctx

Emit = Callable[[dict], Awaitable[None]]
DEFAULT_THRESHOLDS = {"stopSeconds": 90, "replySeconds": 45, "escalateSeconds": 90}


def _stats(route: dict) -> dict:
    return {"score": round(route["score"]), "longestEmptyM": route["gap"]["m"], "minutes": route["minutes"]}


def _until(text: str, departure: int) -> int | None:
    if text == "24h":
        return departure + 24 * 60
    try:
        hour, minute = map(int, text.split(":"))
    except (TypeError, ValueError):
        return None
    if not 0 <= hour < 24 or not 0 <= minute < 60:
        return None
    return hour * 60 + minute + (1440 if hour < 12 else 0)


class LiveWalk:
    def __init__(self, walk_id: str, engine: Engine, emit: Emit):
        self.walk_id = walk_id
        self.session = f"pwa:{walk_id}"
        self.engine = engine
        self.emit = emit
        self.routes: dict[str, dict] = {}
        self.choice = "streetwise"
        self.guardian = "Maya Chen"
        self.thresholds = DEFAULT_THRESHOLDS.copy()
        self.origin = ORIGIN
        self.dest = DESTINATION
        self.day = DAY
        self.minute = DEPART
        self.running = False
        self.checkin = False
        self.escalated = False
        self.acknowledged = False
        self.position: list[float] | None = None
        self.distance = 0.0
        self.last_distance: float | None = None
        self.stopped_at: float | None = None
        self.stop_task: asyncio.Task | None = None
        self.reply_task: asyncio.Task | None = None
        self.escalate_task: asyncio.Task | None = None
        self.input_ids: set[str] = set()

    async def send(self, msg: dict):
        await self.emit({"id": uuid.uuid4().hex, "walkId": self.walk_id, "ts": round(time.time() * 1000), "from": "engine", "msg": msg})

    async def log(self, agent: str, text: str, reason: str, to: str | None = None):
        msg = {"type": "agent.log", "agent": agent, "text": text, "reason": reason}
        if to:
            msg["to"] = to
        await self.send(msg)

    async def say(self, agent: str, text: str):
        await self.send({"type": "voice.say", "agent": agent, "text": text})

    def _route(self) -> dict:
        return self.routes["fast" if self.choice == "usual" else "best"]

    def _cancel(self, name: str):
        task = getattr(self, name)
        if task and task is not asyncio.current_task():
            task.cancel()
        setattr(self, name, None)

    def _cancel_timers(self):
        for name in ("stop_task", "reply_task", "escalate_task"):
            self._cancel(name)

    async def reset(self):
        self._cancel_timers()
        self.engine.clear(self.session)
        self.routes.clear()
        self.running = self.checkin = self.escalated = self.acknowledged = False
        self.position = self.last_distance = self.stopped_at = None
        self.distance = 0.0

    async def accept(self, choice: str, options: dict | None = None):
        if choice not in ("streetwise", "usual"):
            return
        options = options or {}
        guardian = options.get("guardian")
        if isinstance(guardian, str) and guardian.strip():
            self.guardian = guardian.strip()[:80]
        thresholds = options.get("thresholds")
        if isinstance(thresholds, dict):
            for key in DEFAULT_THRESHOLDS:
                value = thresholds.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value <= 600:
                    self.thresholds[key] = value
        origin = options.get("origin")
        dest = options.get("dest")
        if origin is not None or dest is not None:
            parsed_origin = self._point(origin) if origin is not None else ORIGIN
            parsed_dest = self._point(dest) if dest is not None else DESTINATION
            if parsed_origin is None or parsed_dest is None:
                await self.log("scout", "Could not plan the selected destination.", "Coordinates were missing or outside the cached pilot box.")
                return
            self.origin, self.dest = parsed_origin, parsed_dest
        day, minute = options.get("day"), options.get("minute")
        if isinstance(day, int) and not isinstance(day, bool) and 0 <= day <= 6:
            self.day = day
        if isinstance(minute, int) and not isinstance(minute, bool) and 0 <= minute <= 36 * 60:
            self.minute = minute
        self.choice = choice
        if not self.routes:
            result = await run_in_threadpool(self.engine.route, self.session, self.origin, self.dest, self.day, self.minute)
            self.routes = {r["id"]: r for r in result["routes"]}
            if "best" not in self.routes:
                self.routes["best"] = self.routes["fast"]
        await self._plan("Scored OSM streets, listed place hours, and SF 311 lighting evidence at each arrival minute. Conditions, not a safety rating.")
        await self.say("scout", f"The Streetwise route scores {round(self.routes['best']['score'])} versus {round(self.routes['fast']['score'])} for the shortest route. I'm ready to walk with you.")
        await self.log("scout", f"WalkPlan sent for {self.choice} route.", "Deterministic Python engine scored the same downtown corridor and minute as the map.", "Watcher")

    def _point(self, value: dict) -> tuple[float, float] | None:
        if not isinstance(value, dict):
            return None
        lat, lon = value.get("lat"), value.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return None
        south, west, north, east = self.engine.W.bbox
        # Route endpoints can sit just beyond the graph's bounding box. The
        # engine snaps them to its nearest node; allow the same 150 m snap
        # radius used by /api/route-demo, while rejecting points farther out.
        clat = min(north, max(south, float(lat)))
        clon = min(east, max(west, float(lon)))
        import math
        offset = math.hypot((float(lat) - clat) * 111_320, (float(lon) - clon) * 111_320 * math.cos(math.radians(float(lat))))
        if offset > 150:
            return None
        return float(lat), float(lon)

    async def _plan(self, reason: str, stats: dict | None = None):
        if stats is None:
            stats = {"streetwise": _stats(self.routes["best"]), "shortest": _stats(self.routes["fast"])}
        await self.send({"type": "walk.plan", "plan": {"routeId": "route-1", "stats": stats, "reason": reason,
                                                       "thresholds": self.thresholds.copy(), "guardian": self.guardian}})

    async def start(self):
        if not self.routes:
            await self.log("scout", "Walk did not start because there is no accepted route plan.",
                           "The selected destination was not routed; retry or choose another destination.")
            return
        self._cancel_timers()
        self.running = True
        self.checkin = self.escalated = self.acknowledged = False
        self.stopped_at = None
        self.last_distance = None
        await self.log("watcher", "Following live positions and the agreed check-in thresholds.", "The Watcher applies deterministic stop and reply rules to the chosen route.")

    async def position_update(self, msg: dict):
        if not self.running or not self.routes:
            return
        ll = msg.get("lngLat")
        if not isinstance(ll, list) or len(ll) != 2 or not all(isinstance(x, (int, float)) for x in ll):
            return
        progress = msg.get("progress", 0)
        speed = msg.get("speed", 0)
        if not isinstance(progress, (int, float)) or not isinstance(speed, (int, float)):
            return
        route = self._route()
        self.position = [float(ll[0]), float(ll[1])]
        self.last_distance = self.distance
        self.distance = min(route["km"] * 1000, max(0.0, float(progress) * route["km"] * 1000))
        moving = speed >= 0.5 or (self.last_distance is not None and abs(self.distance - self.last_distance) > 5)
        if moving:
            self.stopped_at = None
            self._cancel("stop_task")
            if not self.checkin and not self.escalated:
                decision = self.engine.watcher_decide(route, self.distance, self.last_distance, 0, None, False)
                if decision["decision"] == "info":
                    await self.say("watcher", decision["msg"])
                    await self.log("watcher", decision["msg"], decision["why"])
            return
        if self.checkin or self.escalated or self.stop_task:
            return
        self.stopped_at = time.monotonic()
        self.stop_task = asyncio.create_task(self._after_stop())

    async def _after_stop(self):
        try:
            await asyncio.sleep(self.thresholds["stopSeconds"])
            if not self.running or self.stopped_at is None:
                return
            route = self._route()
            # watcher_decide owns the near-open-place exception and stop decision.
            decision = self.engine.watcher_decide(route, self.distance, self.last_distance, 90, None, False)
            if decision["decision"] == "quiet":
                await self.log("watcher", decision["msg"], decision["why"])
            elif decision["decision"] == "checkin":
                decision["why"] = (f"stopped {self.thresholds['stopSeconds']:g} s on a segment with no open place within 60 m")
                self.checkin = True
                wait = self.thresholds["replySeconds"]
                await self.send({"type": "checkin.ask", "agent": "watcher", "text": decision["msg"],
                                 "reason": decision["why"], "windowSec": wait,
                                 "deadline": round(time.time() * 1000) + wait * 1000})
                await self.say("watcher", decision["msg"])
                await self.log("watcher", f"Asked for a check-in after {self.thresholds['stopSeconds']} seconds still.", decision["why"], "walker")
                self.reply_task = asyncio.create_task(self._after_reply())
        except asyncio.CancelledError:
            pass
        finally:
            self.stop_task = None

    async def _after_reply(self):
        try:
            await asyncio.sleep(self.thresholds["replySeconds"])
            if self.checkin:
                await self._escalate(f"No reply for {self.thresholds['replySeconds']} seconds")
        except asyncio.CancelledError:
            pass
        finally:
            self.reply_task = None

    async def _escalate(self, reason: str):
        if self.escalated or not self.running:
            return
        route = self._route()
        # The engine's 135 s rule is the default 90 s stop plus 45 s reply.
        decision = self.engine.watcher_decide(route, self.distance, self.last_distance, 90, 135, False)
        self.checkin = False
        self.escalated = True
        ll = self.position or route["coords"][0]
        where = next((step["street"] for step in route["steps"] if step["at_m"] <= self.distance < step["at_m"] + step["len_m"]), "the route")
        await self.send({"type": "escalate", "reason": reason, "lngLat": ll})
        await self.send({"type": "guardian.alert", "reason": reason, "lngLat": ll, "where": where})
        await self.log("watcher", decision["msg"], decision["why"], "Rescuer")
        await self.log("rescuer", f"Alert visible on {self.guardian}'s live link. No call or text was sent.", "Standing order: trusted contact first; this build does not contact emergency services.", "guardian")
        await self.say("rescuer", f"I've alerted {self.guardian.split()[0]} on the live link. Say I'm fine or tap the button if you're okay.")
        self.escalate_task = asyncio.create_task(self._after_escalate())

    async def _after_escalate(self):
        try:
            await asyncio.sleep(self.thresholds["escalateSeconds"])
            if self.escalated and not self.acknowledged:
                await self.log("rescuer", "Guardian has not acknowledged the live link alert. Route, time, and last position are ready for a handoff.",
                               "No automatic call or message is sent from this build.")
        except asyncio.CancelledError:
            pass
        finally:
            self.escalate_task = None

    async def reply(self, reply: str):
        if reply == "help":
            await self._escalate("Walker asked for help")
        elif reply == "fine" and (self.checkin or self.escalated):
            self._cancel("reply_task")
            self._cancel("escalate_task")
            self.checkin = self.escalated = False
            self.acknowledged = True
            self.stopped_at = None
            await self.say("watcher", "Okay. Walking with you.")
            await self.log("watcher", "Check-in cleared; continuing the walk.", "Walker answered the check-in.")

    async def guardian_ack(self, by: str):
        if self.escalated:
            self.acknowledged = True
            self._cancel("escalate_task")
            await self.log("rescuer", f"{by} acknowledged the live link alert.", "Guardian responded on the shared room.", "walker")

    async def place_update(self, place: dict):
        if not self.routes or not isinstance(place, dict):
            return
        ident = place.get("id")
        if ident not in self.engine.W.place_index:
            await self.log("scout", "Place update could not be matched to cached OSM data.", "No score change without a matching place ID.")
            return
        name = self.engine.W.places[self.engine.W.place_index[ident]]["name"] or "Place"
        until = _until(place.get("openUntil", "closed"), self.minute)
        with self.engine.lock:
            ctx = self.engine.sessions.setdefault(self.session, Ctx(self.day, self.minute))
            if until and until > self.minute:
                ctx.overrides[ident] = until
            else:
                ctx.overrides.pop(ident, None)
        stats = await run_in_threadpool(self._rescore)
        await self._plan(f"{name}'s simulated hours update was applied at the arrival minute. The fixed routes were re-scored by the Python engine. Conditions, not a safety rating.", stats)
        await self.log("scout", f"Re-scored the fixed routes after {name}'s simulated hours update: {stats['streetwise']['score']} vs {stats['shortest']['score']}.",
                       "Listed hours affect open places and empty stretches. Front light and shop labels are not score inputs.", "Watcher")

    def _rescore(self) -> dict:
        with self.engine.lock:
            ctx = self.engine.ctx(self.session, self.day, self.minute)
            return {"streetwise": _fixed_route_stats(self.engine, self.routes["best"], ctx),
                    "shortest": _fixed_route_stats(self.engine, self.routes["fast"], ctx)}

    async def audit(self):
        debt = await run_in_threadpool(self.engine.darkness_debt, self.day, self.minute, 1200, 3)
        ranking = [{"street": row["street"], "minutes": row["minutes"]} for row in debt["rows"]]
        if not ranking:
            await self.send({"type": "audit.result", "ranking": [], "draft311": "DRAFT — not submitted. No modeled street ranking is available."})
            return
        top = ranking[0]
        draft = (f"DRAFT — not submitted. Review streetlight conditions on {top['street']}. "
                 f"The model estimates {top['minutes']} walker-minutes on lower-light segments in a simulated overnight sample. "
                 "Confirm current conditions and report identifiers before filing.")
        await self.send({"type": "audit.result", "ranking": ranking, "draft311": draft})
        await self.log("auditor", f"Ranked modeled walker-minutes; top street is {top['street']} ({top['minutes']} min). Draft 311 text prepared.",
                       "Modeled trips, not observed foot traffic. Nothing was submitted.", "Reporter")

    async def handle(self, env: dict):
        ident = env.get("id")
        if isinstance(ident, str):
            if ident in self.input_ids:
                return
            self.input_ids.add(ident)
            if len(self.input_ids) > 2000:
                self.input_ids.clear()
        msg = env.get("msg", {})
        kind = msg.get("type")
        if kind == "walk.reset":
            await self.reset()
        elif kind == "walk.accept":
            await self.accept(msg.get("choice", "streetwise"), msg)
        elif kind == "walk.start":
            await self.start()
        elif kind == "walk.position":
            await self.position_update(msg)
        elif kind == "checkin.reply":
            await self.reply(msg.get("reply"))
        elif kind == "guardian.ack":
            await self.guardian_ack(msg.get("by", "Guardian"))
        elif kind == "place.update":
            await self.place_update(msg.get("place"))
        elif kind == "audit.run":
            await self.audit()
        elif kind == "walk.end":
            self.running = False
            self._cancel_timers()
