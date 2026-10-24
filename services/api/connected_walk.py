"""Connected PWA behavior, including replay, versioned routes and place handoffs."""
from __future__ import annotations

import asyncio
import math
import time
import uuid
import copy

from fastapi.concurrency import run_in_threadpool

from demo_data import build_route_data
from live_walk import LiveWalk, _until, _stats
from streetwise_engine.scoring import Ctx


def distance(a, b):
    return math.hypot((a[0] - b[0]) * 88000, (a[1] - b[1]) * 111000)


def project(coords, point):
    best, along, total = (float("inf"), 0.0), 0.0, 0.0
    for a, b in zip(coords, coords[1:]):
        x, y = (b[0] - a[0]) * 88000, (b[1] - a[1]) * 111000
        px, py = (point[0] - a[0]) * 88000, (point[1] - a[1]) * 111000
        length = math.hypot(x, y)
        fraction = max(0, min(1, (px * x + py * y) / (length * length))) if length else 0
        off = math.hypot(px - fraction * x, py - fraction * y)
        if off < best[0]:
            best = (off, along + fraction * length)
        along += length
        total += length
    return best[1] / max(total, 1), best[0]


class ConnectedWalk(LiveWalk):
    FIELDS = ("routes", "choice", "guardian", "thresholds", "origin", "dest", "day", "minute", "running",
              "checkin", "escalated", "acknowledged", "position", "distance", "time_scale", "replay",
              "fix_time", "tracking_visible", "checkin_deadline", "escalate_deadline", "version", "data", "incident_id",
              "profile", "help_request", "original_goal", "place_states", "demo_paused", "demo_stopped", "last_turn", "observations")

    def __init__(self, walk_id, engine, emit, profile=None, mode="demo"):
        super().__init__(walk_id, engine, emit)
        self.mode = mode
        self.profile = profile or {}
        self.version = 0
        self.data = None
        self.help_request = None
        self.original_goal = None
        self.place_states = {}
        self.replay_task = None
        self.health_task = None
        self.help_task = None
        self.demo_paused = False
        self.demo_stopped = False
        self.last_turn = -1
        self.planning = False
        self.observations = []

    def snapshot(self):
        return copy.deepcopy({key: getattr(self, key) for key in self.FIELDS})

    async def restore(self, state):
        for key in self.FIELDS:
            if key in state:
                setattr(self, key, state[key])
        ctx = self.engine.sessions.setdefault(self.session, Ctx(self.day, self.minute))
        for ident, place in self.place_states.items():
            ctx.overrides[ident] = _until(place.get("openUntil", "closed"), self.minute) or -1
        if self.running:
            if self.replay:
                self.replay_task = asyncio.create_task(self._replay())
            else:
                self.health_task = asyncio.create_task(self._health())
            if self.checkin:
                self.reply_task = asyncio.create_task(self._after_reply())
            if self.escalated and not self.acknowledged:
                self.escalate_task = asyncio.create_task(self._after_escalate())
        if self.help_request and self.help_request["status"] == "waiting":
            self.help_task = asyncio.create_task(self._help_timeout())

    async def reset(self):
        for name in ("replay_task", "health_task", "help_task"):
            self._cancel(name)
        await super().reset()
        self.data = self.help_request = self.original_goal = None
        self.observations = []
        self.demo_paused = self.demo_stopped = False
        self.last_turn = -1

    async def _plan(self, reason, stats=None):
        self.version += 1
        result = {"routes": list({r["id"]: r for r in self.routes.values()}.values()), "recommended": "best"}
        self.data = await run_in_threadpool(build_route_data, self.engine, self.dest[0], self.dest[1],
            self.profile.get("destination", "Destination"), self.origin, self.profile.get("origin", "Start"),
            self.day, self.minute, self.session, result)
        self.data["walker"]["name"] = self.profile.get("walkerName", "Walker")
        self.data["guardian"]["name"] = self.guardian
        self.data["guardian"]["initials"] = "".join(w[0] for w in self.guardian.split()[:2])
        await self.send({"type": "walk.plan", "plan": {"routeId": f"route-{self.version}", "version": self.version,
            "data": self.data, "stats": self.data["stats"], "reason": reason, "guardian": self.guardian,
            "thresholds": self.thresholds.copy()}})

    async def accept(self, choice, options=None):
        if self.running:
            return
        self.routes.clear()
        try:
            await super().accept(choice, options)
        except (ValueError, IndexError, KeyError):
            self.routes.clear()
            raise

    async def start(self, replay=True, scale=6):
        if self.running or not self.routes:
            return
        self.replay = replay and self.mode == "demo"
        self.time_scale = min(30, max(1, float(scale))) if self.replay else 1
        await super().start()
        self.distance = 0
        self.position = self._route()["coords"][0]
        if self.replay:
            self.replay_task = asyncio.create_task(self._replay())
        else:
            self.health_task = asyncio.create_task(self._health())
        await self.send({"type": "tracking.health", "status": "replay" if self.replay else "waiting",
                         "message": "Demo GPS replay" if self.replay else "Waiting for a fresh device location."})

    async def _replay(self):
        try:
            while self.running:
                await asyncio.sleep(0.75)
                if self.planning or self.demo_paused or self.checkin or self.escalated:
                    continue
                route = self._route()
                length = max(1, route["km"] * 1000)
                gap = route["gap"].get("range")
                if gap and not self.demo_stopped and self.distance >= sum(gap) / 2:
                    self.demo_stopped = True
                    self.demo_paused = True
                    await self.position_update({"lngLat": self.position, "speed": 0, "progress": self.distance / length,
                                                "replay": True, "fixTime": time.time() * 1000})
                    continue
                self.distance = min(length, self.distance + 1.35 * self.time_scale * 0.75)
                ll = self.engine.point_at(route, self.distance)
                msg = {"type": "walk.position", "lngLat": ll, "heading": 0, "speed": 1.35,
                       "progress": self.distance / length, "replay": True, "fixTime": time.time() * 1000, "accuracy": 0}
                await self.position_update(msg)
                await self.send(msg)
                if self.distance >= length:
                    await self.finish("arrived")
        except asyncio.CancelledError:
            pass

    async def _health(self):
        stale = False
        try:
            while self.running:
                await asyncio.sleep(5)
                lost = time.time() - self.fix_time > 15 or not self.tracking_visible
                if lost and not stale:
                    self._cancel("stop_task")
                    self.stopped_at = None
                    await self.send({"type": "tracking.health", "status": "stale", "message": "Location updates paused. Keep Streetwise visible; automatic stop detection is paused."})
                stale = lost
        except asyncio.CancelledError:
            pass

    async def position_update(self, msg):
        if not self.running or self.planning:
            return False
        if not self.replay:
            age = time.time() - msg.get("fixTime", 0) / 1000
            if age < -5 or age > 15 or msg.get("accuracy", 1000) > 60:
                self._cancel("stop_task")
                await self.send({"type": "tracking.health", "status": "imprecise", "message": "Waiting for a recent, more precise GPS fix. Stop detection is paused."})
                return False
            progress, off = project(self._route()["coords"], msg["lngLat"])
            msg["progress"] = progress
            if off > 80:
                self._cancel("stop_task")
                await self.send({"type": "tracking.health", "status": "off_route", "message": "You are away from the planned route. Replan from your current location."})
                self.position = msg["lngLat"]
                self.fix_time = time.time()
                return True
        self.fix_time = time.time()
        await super().position_update(msg)
        if not self.replay:
            await self.send({"type": "tracking.health", "status": "tracking", "message": "Location updated", "accuracy": msg.get("accuracy"), "fixTime": msg.get("fixTime")})
        if self.routes and not self.checkin and not self.escalated:
            steps = self._route()["steps"]
            upcoming = next((i for i, step in enumerate(steps) if step["at_m"] > self.distance + 5), len(steps) - 1)
            if upcoming != self.last_turn:
                self.last_turn = upcoming
                step = steps[upcoming]
                await self.say("watcher", f"{step['maneuver'].capitalize()} onto {step['street']} in {max(0, round(step['at_m'] - self.distance))} metres.")
        return True

    async def reply(self, reply):
        was_incident = self.checkin or self.escalated
        await super().reply(reply)
        if reply == "fine" and was_incident:
            self.demo_paused = False
            self.checkin_deadline = self.escalate_deadline = None
            self.incident_id = None
            await self.send({"type": "incident.resolved", "by": "walker", "reason": "Walker confirmed they are okay."})

    async def place_update(self, place):
        if not self.routes or place["id"] not in self.engine.W.place_index:
            return
        self.place_states[place["id"]] = place
        ctx = self.engine.sessions.setdefault(self.session, Ctx(self.day, self.minute))
        ctx.overrides[place["id"]] = _until(place["openUntil"], self.minute) or -1
        await self.replan("A simulated place changed its hours. Recomputed route geometry, turns and conditions from the current position.")

    async def replan(self, reason, destination=None):
        self.planning = True
        try:
            await self._replan(reason, destination)
        finally:
            self.planning = False

    async def _replan(self, reason, destination=None):
        if self.running and self.position:
            self.minute = int(self.minute + round(self.distance / 1.35 / 60))
            self.day = (self.day + int(self.minute) // 1440) % 7
            self.minute %= 1440
            self.origin = (self.position[1], self.position[0])
            self.profile["origin"] = "Current position"
        if destination:
            self.dest = (destination["lngLat"][1], destination["lngLat"][0])
            self.profile["destination"] = destination["name"]
        a, _ = self.engine.W.nearest_node(*self.origin)
        b, _ = self.engine.W.nearest_node(*self.dest)
        if a == b:
            await self.say("scout", "You are already at the mapped entrance. Confirm arrival when you reach the place.")
            return
        result = await run_in_threadpool(self.engine.route, self.session, self.origin, self.dest, self.day, self.minute)
        self.routes = {r["id"]: r for r in result["routes"]}
        self.routes.setdefault("best", self.routes["fast"])
        self.distance = 0
        self.last_distance = None
        self.last_turn = -1
        self._cancel("stop_task")
        self.stopped_at = None
        await self._plan(reason)
        await self.log("scout", "Published an updated route, geometry and turn instructions.", reason, "Watcher")
        await self.say("scout", "I've updated the route from your current position. The map and next turn now match the new plan.")

    async def request_help_place(self, exclude=None):
        if not self.running or not self.data:
            return
        self._cancel("help_task")
        exclude = exclude or []
        candidates = [{**p, **self.place_states.get(p["id"], {})} for p in self.data["places"] if p["id"] not in exclude]
        candidates = [p for p in candidates if p.get("openUntil", "closed") != "closed"]
        candidates.sort(key=lambda p: distance(self.position or self.data["start"]["lngLat"], p["lngLat"]))
        if not candidates:
            self.help_request = {"status": "unavailable", "id": uuid.uuid4().hex, "message": "No participating place has confirmed availability. You can contact your guardian or choose another destination."}
            await self.send({"type": "help.status", **self.help_request})
            return
        place = candidates[0]
        self.help_request = {"status": "waiting", "id": uuid.uuid4().hex, "place": place,
                             "expires": time.time() * 1000 + 60000, "excluded": exclude,
                             "message": f"Waiting for {place['name']} to confirm. This demo place is simulated."}
        await self.send({"type": "help.status", **self.help_request})
        await self.log("scout", f"Requested a place to wait at {place['name']}.", "A listed open business is not a confirmed assistance location.", "place agent")
        self.help_task = asyncio.create_task(self._help_timeout())

    async def _help_timeout(self):
        try:
            await asyncio.sleep(max(0, self.help_request["expires"] / 1000 - time.time()))
            if self.help_request and self.help_request["status"] == "waiting":
                await self.place_reply(self.help_request["id"], False)
        except asyncio.CancelledError:
            pass

    async def place_reply(self, request_id, accepted):
        request = self.help_request
        if not request or request["id"] != request_id or request["status"] != "waiting":
            return
        self._cancel("help_task")
        if not accepted or request["expires"] < time.time() * 1000:
            await self.log("scout", f"{request['place']['name']} did not accept the request. Trying another option.", "A refusal or timeout never counts as confirmed access.")
            await self.request_help_place([*request["excluded"], request["place"]["id"]])
            return
        if not self.original_goal:
            self.original_goal = {"lngLat": [self.dest[1], self.dest[0]], "name": self.profile.get("destination", "Destination")}
        request["status"] = "accepted"
        request["message"] = f"{request['place']['name']} accepted this demo request. Guidance is updating."
        await self.send({"type": "help.status", **request})
        self.demo_paused = False
        self.demo_stopped = True
        await self.replan("The simulated place accepted the request to wait inside.", request["place"])

    async def finish(self, outcome):
        if not self.running:
            return
        self.running = False
        self._cancel_timers()
        for name in ("replay_task", "health_task", "help_task"):
            self._cancel(name)
        summary = ("Arrived at the selected destination." if outcome == "arrived" else "Walk ended before arrival.") + " Location sharing has stopped."
        self.position = None
        self.help_request = None
        self.checkin = self.escalated = False
        await self.send({"type": "walk.end", "outcome": outcome, "summary": summary})
        notes = " ".join(f"Unverified {o['kind']}: {o['note'] or 'No further details supplied.'}" for o in self.observations)
        await self.send({"type": "report.ready", "text": "DRAFT — not submitted. Review the route evidence and observations before filing a city report. " + notes, "observations": self.observations})
        await self.log("reporter", "Walk summary saved. Location collection stopped.", "Reports remain drafts until reviewed by a person.")

    async def handle(self, env):
        msg = env["msg"]
        kind = msg["type"]
        if kind in {"checkin.reply", "guardian.ack"} and msg.get("reply") != "help" and msg.get("incidentId") != self.incident_id:
            return
        if kind == "walk.start":
            await self.start(msg.get("replay", True), msg.get("timeScale", 6))
        elif kind == "walk.end":
            await self.finish(msg.get("outcome", "ended"))
        elif kind == "help.request":
            await self.request_help_place()
        elif kind == "help.respond":
            await self.place_reply(msg["requestId"], msg["accepted"])
        elif kind == "walk.replan" and self.running:
            if msg.get("resumeDestination") and self.original_goal:
                goal = self.original_goal
                self.original_goal = None
                self.help_request = None
                await self.send({"type": "help.status", "status": "resumed", "id": uuid.uuid4().hex, "message": "Continuing to your original destination."})
                await self.replan("Walker resumed the original destination.", goal)
            else:
                await self.replan("Walker requested an updated route from the current position.")
        elif kind == "walk.position":
            return await self.position_update(msg)
        elif kind == "tracking.visibility":
            self.tracking_visible = msg["visible"]
            if not self.tracking_visible:
                self._cancel("stop_task")
        elif kind == "demo.action" and self.replay and self.running:
            action = msg["action"]
            if action == "finish":
                await self.finish("arrived")
            elif action == "checkin" and not self.checkin and not self.escalated:
                gap = self._route()["gap"].get("range")
                self.distance = sum(gap) / 2 if gap else self.distance
                self.position = self.engine.point_at(self._route(), self.distance)
                self.demo_paused = self.demo_stopped = True
                await self.send({"type": "walk.position", "lngLat": self.position, "progress": self.distance / max(1, self._route()["km"] * 1000), "heading": 0, "speed": 0, "replay": True})
                await self.position_update({"lngLat": self.position, "speed": 0, "progress": self.distance / max(1, self._route()["km"] * 1000)})
            elif action == "pause":
                self.demo_paused = True
            elif action == "resume":
                self.demo_paused = False
        elif kind == "observation.add" and self.running:
            observation = {"id": uuid.uuid4().hex, "kind": msg["kind"], "note": msg.get("note", "")[:300], "at": time.time() * 1000,
                           "status": "unverified", "lngLat": self.position, "usedForScore": False}
            self.observations = [*self.observations[-19:], {"kind": observation["kind"], "note": observation["note"], "status": "unverified"}]
            await self.send({"type": "observation.saved", "observation": observation})
            await self.log("reporter", f"Saved an unverified {msg['kind']} observation for review.", "A single report does not change a score or claim a current hazard.")
        else:
            await super().handle(env)
