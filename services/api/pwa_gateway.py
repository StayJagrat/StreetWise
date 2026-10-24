"""Role-scoped, recoverable PWA sessions. Only the gateway produces agent events."""
from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
import re
from collections import deque

from fastapi import APIRouter, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from connected_walk import ConnectedWalk
from persistence import RoomRepository

router = APIRouter()
repository: RoomRepository | None = None
engine = None
rooms = {}
mirror_task = None
dirty = set()
creation_times = {}
COMMANDS = {
    "walker": {"walk.accept", "walk.start", "walk.position", "walk.reset", "walk.end", "checkin.reply", "help.request", "walk.replan", "tracking.visibility", "observation.add", "demo.action"},
    "guardian": {"guardian.join", "guardian.ack"},
    "shop": {"place.update", "help.respond"},
    "room": {"walk.accept", "walk.start", "walk.reset", "walk.end", "audit.run", "demo.action"},
}


def valid_message(msg, role, mode):
    if not isinstance(msg, dict) or msg.get("type") not in COMMANDS.get(role, set()):
        return False
    kind = msg["type"]
    if kind.startswith("demo.") and mode != "demo":
        return False
    if kind in {"place.update", "help.respond"} and mode != "demo":
        return False  # live participation requires an independently verified business integration
    finite = lambda n: isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)
    if kind == "walk.position":
        ll = msg.get("lngLat")
        return (isinstance(ll, list) and len(ll) == 2 and all(finite(n) for n in ll)
                and -180 <= ll[0] <= 180 and -90 <= ll[1] <= 90
                and all(finite(msg.get(k, 0)) for k in ("speed", "heading", "progress", "fixTime", "accuracy"))
                and mode == "live" and msg.get("replay") is False)
    if kind == "walk.accept":
        return (msg.get("choice") in {"streetwise", "usual"}
                and all(isinstance(msg.get(k), dict) and all(finite(msg[k].get(n)) for n in ("lat", "lon")) for k in ("origin", "dest"))
                and isinstance(msg.get("day"), int) and 0 <= msg["day"] <= 6
                and isinstance(msg.get("minute"), int) and 0 <= msg["minute"] < 1440
                and ("thresholds" not in msg or (isinstance(msg["thresholds"], dict) and all(finite(v) and 0 < v <= 600 for v in msg["thresholds"].values()))))
    if kind == "walk.start":
        return msg.get("replay") is (mode == "demo") and finite(msg.get("timeScale", 6))
    if kind == "checkin.reply":
        return msg.get("reply") in {"fine", "help"} and msg.get("via") in {"voice", "tap"}
    if kind in {"guardian.join", "guardian.ack"}:
        return isinstance(msg.get("name" if kind.endswith("join") else "by"), str)
    if kind == "place.update":
        p = msg.get("place", {})
        return isinstance(p, dict) and isinstance(p.get("id"), str) and isinstance(p.get("openUntil"), str) and len(p["openUntil"]) <= 10
    if kind == "help.respond":
        return isinstance(msg.get("requestId"), str) and isinstance(msg.get("accepted"), bool)
    if kind == "tracking.visibility":
        return isinstance(msg.get("visible"), bool)
    if kind == "observation.add":
        return msg.get("kind") in {"lighting", "blocked_path", "closed_place"} and isinstance(msg.get("note", ""), str)
    if kind == "walk.end":
        return msg.get("outcome") in {"arrived", "ended", "incident"}
    if kind == "demo.action":
        return msg.get("action") in {"pause", "resume", "checkin", "finish"}
    return True


class ActiveRoom:
    def __init__(self, row):
        self.row = row
        self.clients = {}
        self.command_lock = asyncio.Lock()
        self.send_lock = asyncio.Lock()
        self.seen = set()
        self.live = ConnectedWalk(row["id"], engine, self.publish, row["profile"], row["mode"])

    async def persist(self):
        self.row["state"] = self.live.snapshot()
        repository.save(self.row)
        dirty.add(self.row["id"])

    async def publish(self, env):
        async with self.send_lock:
            kind = env["msg"]["type"]
            history = self.row["history"]
            if kind == "walk.reset":
                history = [e for e in history if e["msg"]["type"] in {"place.update", "guardian.join"}]
            elif kind in {"walk.position", "tracking.health", "walk.plan", "help.status"}:
                history = [e for e in history if e["msg"]["type"] != kind]
            if kind == "walk.end":
                history = [e for e in history if e["msg"]["type"] not in {"walk.position", "guardian.alert", "escalate", "observation.saved", "help.status"}]
            self.row["sequence"] += 1
            env["sequence"] = self.row["sequence"]
            self.row["history"] = [*history[-399:], env]
            # Local durable write finishes before delivery. Cloud I/O never blocks alerts.
            await self.persist()
            for sock in list(self.clients):
                try:
                    await asyncio.wait_for(sock.send_json(env), timeout=1)
                except (RuntimeError, WebSocketDisconnect, TimeoutError):
                    self.clients.pop(sock, None)


async def get_room(ident):
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", ident):
        return None
    if ident in rooms and rooms[ident].row["expires"] > time.time():
        return rooms[ident]
    row = repository.get(ident)
    if not row:
        row = await run_in_threadpool(repository.recover, ident)
    if not row:
        return None
    active = ActiveRoom(row)
    rooms[ident] = active
    if row["state"]:
        await active.live.restore(row["state"])
    return active


async def mirror_loop():
    try:
        while True:
            await asyncio.sleep(2)
            repository.prune()
            for ident, active in list(rooms.items()):
                if active.row["expires"] < time.time():
                    await active.live.reset()
                    for sock in list(active.clients):
                        await sock.close(code=4403)
                    rooms.pop(ident, None)
            for ident in list(dirty):
                dirty.discard(ident)
                row = repository.get(ident)
                if row:
                    await run_in_threadpool(repository.mirror, row)
                    if repository.cloud_status == "retrying":
                        dirty.add(ident)
    except asyncio.CancelledError:
        pass


async def initialize(value):
    global engine, repository, mirror_task
    engine = value
    repository = RoomRepository()
    mirror_task = asyncio.create_task(mirror_loop())


async def shutdown():
    if mirror_task:
        mirror_task.cancel()
    for active in rooms.values():
        await active.persist()
        active.live._cancel_timers()
        for name in ("replay_task", "health_task", "help_task"):
            active.live._cancel(name)
    if repository:
        repository.close()


class RoomRequest(BaseModel):
    mode: str = "demo"
    walkerName: str = Field("Walker", min_length=1, max_length=80)
    guardianName: str = Field("My guardian", min_length=1, max_length=80)
    walkerPhone: str = Field("", max_length=30)
    consent: bool = False
    origin: str = Field("Start", max_length=100)
    destination: str = Field("Destination", max_length=100)


@router.post("/api/rooms")
async def create_room(body: RoomRequest, request: Request):
    if body.mode not in {"demo", "live"} or not body.consent:
        raise HTTPException(422, "Choose demo or device GPS and agree to this walk's sharing settings.")
    host = request.client.host if request.client else "local"
    stamps = [t for t in creation_times.get(host, []) if time.time() - t < 3600]
    if len(stamps) >= 40:
        raise HTTPException(429, "Too many new walks. Reuse your current walk or try again later.")
    creation_times[host] = [*stamps, time.time()]
    row, tokens = repository.create(body.mode, body.model_dump())
    dirty.add(row["id"])
    return {"id": row["id"], "tokens": tokens, "expires": row["expires"] * 1000, "mode": row["mode"]}


def visible_profile(row, role):
    profile = dict(row["profile"])
    if role not in {"walker", "guardian"}:
        profile.pop("walkerPhone", None)
    return profile


def bearer(header):
    return header.removeprefix("Bearer ") if header else ""


@router.get("/api/rooms/{ident}")
async def read_room(ident: str, role: str = "walker", authorization: str | None = Header(None)):
    active = await get_room(ident)
    if not active or not repository.authorized(active.row, role, bearer(authorization)):
        raise HTTPException(403, "This walk link is invalid or has expired. Ask the walker for a new link.")
    return {"mode": active.row["mode"], "profile": visible_profile(active.row, role), "envelopes": active.row["history"],
            "expires": active.row["expires"] * 1000}


@router.get("/api/rooms/{ident}/invites")
async def room_invites(ident: str, role: str = "walker", authorization: str | None = Header(None)):
    active = await get_room(ident)
    if role not in {"walker", "room"} or not active or not repository.authorized(active.row, role, bearer(authorization)):
        raise HTTPException(403, "Only the walker or private control room can manage invitations.")
    tokens = repository.invite_tokens(active.row)
    if not tokens:
        raise HTTPException(409, "This older walk keeps its invitations on the original device. Start a new walk for cross-device invitation management.")
    return {"tokens": tokens, "expires": active.row["expires"] * 1000}


@router.websocket("/ws")
async def websocket(sock: WebSocket, walk: str = "", role: str = "walker", token: str = ""):
    active = await get_room(walk)
    if not active or not repository.authorized(active.row, role, token):
        await sock.accept()
        await sock.close(code=4403)
        return
    await sock.accept()
    async with active.send_lock:
        await sock.send_json({"kind": "history", "envelopes": active.row["history"], "mode": active.row["mode"], "profile": visible_profile(active.row, role)})
        active.clients[sock] = role
    rate = deque()
    try:
        while True:
            raw = await sock.receive_text()
            if len(raw) > 20000:
                await sock.close(code=1009)
                break
            while rate and time.monotonic() - rate[0] > 10:
                rate.popleft()
            rate.append(time.monotonic())
            if len(rate) > 120:
                await sock.close(code=4429)
                break
            try:
                env = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue
            if (not isinstance(env, dict) or env.get("walkId") != walk or not isinstance(env.get("id"), str)
                    or len(env["id"]) > 100 or env.get("from") != role
                    or not valid_message(env.get("msg"), role, active.row["mode"])):
                await sock.send_json({"kind": "error", "message": "That command is not available for this walk or role."})
                continue
            async with active.command_lock:
                if env["id"] in active.seen:
                    continue
                active.seen.add(env["id"])
                env["ts"] = time.time() * 1000
                kind = env["msg"]["type"]
                if kind in {"guardian.ack", "checkin.reply"} and env["msg"].get("reply") != "help" and env["msg"].get("incidentId") != active.live.incident_id:
                    continue
                if kind == "walk.start" and (active.live.running or not active.live.routes):
                    continue
                if kind == "walk.accept" and active.live.running:
                    continue
                if kind == "guardian.join" and any(e["msg"]["type"] == "walk.end" for e in active.row["history"]):
                    continue
                # Terminal lifecycle events are emitted by the engine after applying them.
                if kind not in {"walk.end", "walk.position"}:
                    await active.publish(env)
                try:
                    applied = await active.live.handle(env)
                    if kind == "walk.position" and applied and active.live.running:
                        await active.publish(env)
                    await active.persist()
                except (ValueError, KeyError, IndexError) as exc:
                    await sock.send_json({"kind": "error", "message": "The selected route or command could not be applied. Choose another point inside San Francisco."})
    except WebSocketDisconnect:
        pass
    finally:
        active.clients.pop(sock, None)
