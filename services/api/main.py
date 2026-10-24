"""Streetwise API. Thin: validates input, runs the engine off the event loop, and streams what the agents are doing over a WebSocket.

    cd services/api && ../../.venv/bin/uvicorn main:app --reload --port 8000
"""
import asyncio, json, os, sys, time, uuid
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "engine"))
from streetwise_engine.engine import Engine  # noqa: E402
from demo_data import build_demo_data  # noqa: E402
from live_walk import LiveWalk  # noqa: E402
from vision import router as vision_router  # noqa: E402

app = FastAPI(title="Streetwise API", version="0.1.0")
app.include_router(vision_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
engine: Engine | None = None
last_route: dict[str, dict] = {}


class Hub:
    """Per-session event bus. Agents publish; the PWA's trace panel and the control room subscribe."""
    def __init__(self): self.subs = defaultdict(set); self.history = defaultdict(lambda: deque(maxlen=200))

    async def publish(self, session, ev):
        self.history[session].append(ev)
        for q in list(self.subs[session]): q.put_nowait(ev)


hub = Hub()


def make_emit(session: str, loop):
    def emit(agent, kind, msg, data=None):
        ev = dict(ts=time.time(), agent=agent, kind=kind, msg=msg, data=data or {})
        asyncio.run_coroutine_threadsafe(hub.publish(session, ev), loop)
    return emit


@app.on_event("startup")
async def boot():
    global engine
    engine = await run_in_threadpool(Engine)


class LatLon(BaseModel): lat: float; lon: float
class RouteReq(BaseModel):
    session: str = "demo"; origin: LatLon; dest: LatLon
    day: int = Field(4, ge=0, le=6); minute: int = Field(22 * 60 + 50, ge=0, le=36 * 60)
class DeclareReq(BaseModel):
    session: str = "demo"; place_id: str; until_minute: int; day: int = 4; minute: int = 22 * 60 + 50
class SessionReq(BaseModel): session: str = "demo"


@app.get("/api/health")
async def health(): return dict(ok=engine is not None, boot_seconds=engine.boot_seconds if engine else None)


@app.get("/api/meta")
async def meta(): return engine.meta()


@app.get("/api/demo")
async def demo():
    """The same engine-backed data exported for the PWA's offline replay."""
    return await run_in_threadpool(build_demo_data, engine)


@app.get("/api/route-demo")
async def route_demo(lat: float, lon: float, name: str = "Destination", olat: float | None = None, olon: float | None = None, oname: str = "Start",
                     day: int = 4, minute: int = 23 * 60 + 4):
    """Engine-backed DemoData for any start and destination in San Francisco at any departure time (olat/olon omitted = Powell St BART)."""
    from demo_data import build_route_data
    if not (0 <= day <= 6 and 0 <= minute < 1440):
        raise HTTPException(422, "day must be 0-6 and minute 0-1439")
    origin = (olat, olon) if olat is not None and olon is not None else None
    try:
        return await run_in_threadpool(build_route_data, engine, lat, lon, name, origin, oname if origin else None, day, minute)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/search")
async def search(q: str, limit: int = 8):
    """Offline search over named places, streets and landmarks in the cached city."""
    return await run_in_threadpool(engine.search, q, min(limit, 20))


@app.get("/api/landmarks")
async def landmarks(): return engine.landmarks()


@app.get("/api/places")
async def places(session: str = "demo", day: int = 4, minute: int = 22 * 60 + 50):
    return await run_in_threadpool(engine.places, session, day, minute)


@app.get("/api/heat")
async def heat(session: str = "demo", day: int = 4, minute: int = 22 * 60 + 50):
    return await run_in_threadpool(engine.heat, session, day, minute)


@app.post("/api/route")
async def route(req: RouteReq):
    loop = asyncio.get_running_loop(); emit = make_emit(req.session, loop)
    out = await run_in_threadpool(engine.route, req.session, (req.origin.lat, req.origin.lon), (req.dest.lat, req.dest.lon), req.day, req.minute, emit)
    last_route[req.session] = dict(req=req.model_dump(), out=out); return out


@app.post("/api/agents/place/suggest")
async def suggest(req: SessionReq):
    lr = last_route.get(req.session)
    if not lr: raise HTTPException(409, "plan a route first")
    fast = next(r for r in lr["out"]["routes"] if r["id"] == "fast"); q = lr["req"]
    return await run_in_threadpool(engine.suggest_declarations, req.session, fast, q["day"], q["minute"])


@app.post("/api/agents/place/declare")
async def declare(req: DeclareReq):
    loop = asyncio.get_running_loop()
    try: info = await run_in_threadpool(engine.declare, req.session, req.place_id, req.until_minute, req.day, req.minute, make_emit(req.session, loop))
    except KeyError: raise HTTPException(404, "unknown place")
    lr = last_route.get(req.session)
    if not lr: return dict(declared=info, route=None)
    q = lr["req"]; out = await run_in_threadpool(engine.route, req.session, (q["origin"]["lat"], q["origin"]["lon"]), (q["dest"]["lat"], q["dest"]["lon"]), q["day"], q["minute"], make_emit(req.session, loop))
    before = {r["id"]: r["score"] for r in lr["out"]["routes"]}; last_route[req.session] = dict(req=q, out=out)
    return dict(declared=info, route=out, before=before)


@app.post("/api/agents/auditor/run")
async def audit(req: SessionReq):
    loop = asyncio.get_running_loop(); emit = make_emit(req.session, loop); lr = last_route.get(req.session)
    res = await run_in_threadpool(engine.audit, next((r for r in lr["out"]["routes"] if r["id"] == lr["out"]["recommended"]), None) if lr else None)
    emit("auditor", "step", f"{res['no_hours']} of {res['places']} places in the area have no listed hours; they count as closed.", res)
    emit("auditor", "done", f"{res['lamp_evidence']} lamp locations inferred from past 311 reports; {res['open_outages']} open outage reports subtracted from lighting.", res)
    return res


# ---------------- walks: the Watcher, the guardian page, the shop page ----------------
walks: dict[str, dict] = {}


class WalkStart(BaseModel): session: str = "demo"; route_id: str = "best"; walker: str = "Arya"; guardian: str = "Maya"
class WalkTick(BaseModel):
    walk_id: str; d: float; prev_d: float | None = None; stopped_s: float = 0; since_checkin_s: float | None = None; replied: bool = False
class DeclareShop(BaseModel):
    session: str = "demo"; until_minute: int; day: int = 4; minute: int = 22 * 60 + 50; safe_haven: bool = True; front_light: bool = True


def _pub(session, agent, kind, msg, data=None):
    ev = dict(ts=time.time(), agent=agent, kind=kind, msg=msg, data=data or {})
    return hub.publish(session, ev)


@app.post("/api/walk/start")
async def walk_start(req: WalkStart):
    lr = last_route.get(req.session)
    if not lr: raise HTTPException(409, "plan a route first")
    route = next((r for r in lr["out"]["routes"] if r["id"] == req.route_id), None)
    if not route: raise HTTPException(404, "unknown route")
    wid = uuid.uuid4().hex[:8]
    walks[wid] = dict(id=wid, session=req.session, route=route, walker=req.walker, guardian=req.guardian, status="walking", d=0.0, started=time.time(),
                      req=lr["req"], last_checkin="Not yet", ll=route["coords"][0], log=[])
    await _pub(req.session, "scout", "step", f"WalkPlan sent to Watcher: {route['label']}, score {route['score']}, {route['minutes']} min.", dict(why=f"{req.walker} chose this route", walk=wid))
    await _pub(f"walk-{wid}", "walk", "status", "walking", dict(status="walking", d=0, ll=route["coords"][0]))
    return dict(id=wid, guardian_path=f"/guardian/{wid}", guardian=req.guardian)


@app.post("/api/walk/tick")
async def walk_tick(t: WalkTick):
    w = walks.get(t.walk_id)
    if not w: raise HTTPException(404, "unknown walk")
    dec = engine.watcher_decide(w["route"], t.d, t.prev_d, t.stopped_s, t.since_checkin_s, t.replied)
    w["d"] = t.d; w["ll"] = engine.point_at(w["route"], t.d); st = w["status"]; d = dec["decision"]
    if d == "checkin": st = "checkin"
    elif d == "alert": st = "alert"
    elif d == "escalate": st = "escalated"
    elif d == "ok": st = "walking"; w["last_checkin"] = "I'm fine"
    changed = st != w["status"]
    if d in ("checkin", "ok", "quiet", "info") or (d in ("alert", "escalate") and changed):
        await _pub(w["session"], "watcher", "step", dec["msg"], dict(why=dec["why"], decision=d, walk=w["id"]))
    if d == "escalate" and changed:
        await _pub(w["session"], "rescuer", "step", f"Alert sent to {w['guardian']}'s live link. Handoff packet written. 911 not contacted.", dict(why="hackathon build never calls emergency services", walk=w["id"]))
    w["status"] = st
    await _pub(f"walk-{w['id']}", "walk", "position", st, dict(status=st, d=t.d, ll=w["ll"], msg=dec["msg"], last_checkin=w["last_checkin"]))
    return dict(decision=dec, status=st, ll=w["ll"])


@app.get("/api/walk/{wid}")
async def walk_get(wid: str):
    w = walks.get(wid)
    if not w: raise HTTPException(404, "unknown walk")
    r = w["route"]; return dict(id=wid, walker=w["walker"], guardian=w["guardian"], status=w["status"], d=w["d"], ll=w["ll"], last_checkin=w["last_checkin"], minutes=r["minutes"], km=r["km"],
                                 coords=r["coords"], shops=r["shops"], gap=r["gap"], score=r["score"], steps=r["steps"], req=w["req"])


@app.post("/api/walk/{wid}/clear")
async def walk_clear(wid: str):
    w = walks.get(wid)
    if not w: raise HTTPException(404, "unknown walk")
    w["status"] = "walking"; await _pub(w["session"], "rescuer", "done", f"{w['guardian']} is on it. Alert cleared.", dict(why="guardian cleared the alert", walk=wid))
    await _pub(f"walk-{wid}", "walk", "position", "cleared", dict(status="cleared", d=w["d"], ll=w["ll"], last_checkin=w["last_checkin"])); return dict(ok=True)


@app.post("/api/walk/{wid}/help")
async def walk_help(wid: str):
    w = walks.get(wid)
    if not w: raise HTTPException(404, "unknown walk")
    w["status"] = "escalated"; await _pub(w["session"], "watcher", "step", "Held for help. Alerting the guardian now.", dict(why="you asked for help", walk=wid))
    await _pub(w["session"], "rescuer", "step", f"Alert sent to {w['guardian']}'s live link. Handoff packet written. 911 not contacted.", dict(why="hackathon build never calls emergency services", walk=wid))
    await _pub(f"walk-{wid}", "walk", "position", "escalated", dict(status="escalated", d=w["d"], ll=w["ll"], last_checkin=w["last_checkin"])); return dict(ok=True)


@app.post("/api/walk/{wid}/finish")
async def walk_finish(wid: str):
    w = walks.get(wid)
    if not w: raise HTTPException(404, "unknown walk")
    w["status"] = "arrived"; await _pub(w["session"], "reporter", "done", "Arrived. Draft report saved, nothing submitted.", dict(why="reports are drafts until a person reviews them", walk=wid))
    await _pub(f"walk-{wid}", "walk", "position", "arrived", dict(status="arrived", d=w["d"], ll=w["ll"])); return dict(ok=True)


@app.get("/api/shop/{place_id}")
async def shop_get(place_id: str, session: str = "demo"):
    if place_id not in engine.W.place_index: raise HTTPException(404, "unknown place")
    pl = engine.W.places[engine.W.place_index[place_id]]; ctx = engine.sessions.get(session); until = (ctx.overrides.get(place_id) if ctx else None)
    return dict(id=place_id, name=pl["name"] or pl["cat"], cat=pl["cat"], hours=pl["hours"], hours_source=pl.get("hours_source"), ll=pl["ll"], declared_until=until,
                walks_nearby=sum(1 for w in walks.values() if w["status"] in ("walking", "checkin") and _near(w["route"], pl["ll"])))


def _near(route, ll, m=80):
    import math
    for c in route["coords"][::2]:
        if math.hypot((c[0] - ll[0]) * 88000, (c[1] - ll[1]) * 111000) <= m: return True
    return False


@app.post("/api/shop/{place_id}/declare")
async def shop_declare(place_id: str, req: DeclareShop):
    loop = asyncio.get_running_loop(); emit = make_emit(req.session, loop)
    try: info = await run_in_threadpool(engine.declare, req.session, place_id, req.until_minute, req.day, req.minute, emit)
    except KeyError: raise HTTPException(404, "unknown place")
    affected = [w for w in walks.values() if _near(w["route"], engine.W.places[engine.W.place_index[place_id]]["ll"])]
    lr = last_route.get(req.session); before = after = None
    if lr:
        q = lr["req"]; out = await run_in_threadpool(engine.route, req.session, (q["origin"]["lat"], q["origin"]["lon"]), (q["dest"]["lat"], q["dest"]["lon"]), q["day"], q["minute"], emit)
        before = {r["id"]: r["score"] for r in lr["out"]["routes"]}; after = {r["id"]: r["score"] for r in out["routes"]}; last_route[req.session] = dict(req=q, out=out)
    emit("scout", "step", f"Re-scored routes past {info['name'] or info['cat']}: {len(affected)} walk(s) nearby.", dict(why="a place changed its hours", affected=len(affected)))
    return dict(declared=info, affected=len(affected), before=before, after=after, route=last_route.get(req.session, {}).get("out"))


@app.get("/api/session/{session}/state")
async def session_state(session: str):
    """What the control room needs to follow a session from another device: the latest plan and the latest walk."""
    lr = last_route.get(session); mine = [w for w in walks.values() if w["session"] == session]
    w = max(mine, key=lambda x: x["started"]) if mine else None
    return dict(route=lr["out"] if lr else None, req=lr["req"] if lr else None,
                walk=dict(id=w["id"], status=w["status"], d=w["d"], ll=w["ll"], walker=w["walker"], guardian=w["guardian"], last_checkin=w["last_checkin"], route_id=w["route"]["id"]) if w else None)


@app.get("/api/why")
async def why(lat: float, lon: float, session: str = "demo", day: int = 4, minute: int = 22 * 60 + 50):
    res = await run_in_threadpool(engine.why, session, lat, lon, day, minute)
    if not res: raise HTTPException(404, "no street nearby")
    return res


@app.get("/api/debt")
async def debt(day: int = 4, minute: int = 22 * 60 + 50): return await run_in_threadpool(engine.darkness_debt, day, minute)


@app.post("/api/session/reset")
async def reset(req: SessionReq):
    engine.clear(req.session); last_route.pop(req.session, None); hub.history.pop(req.session, None); return dict(ok=True)


@app.websocket("/ws/{session}")
async def ws(sock: WebSocket, session: str):
    await sock.accept(); q: asyncio.Queue = asyncio.Queue(); hub.subs[session].add(q)
    try:
        for ev in list(hub.history[session]): await sock.send_json(ev)
        while True: await sock.send_json(await q.get())
    except WebSocketDisconnect: pass
    finally: hub.subs[session].discard(q)


# Abhishek's PWA uses one room per walk and sends typed envelopes. Keep this
# separate from the earlier trace stream above until its callers are retired.
class WalkRoom:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.history: deque[dict] = deque(maxlen=400)
        self.lock = asyncio.Lock()

    async def publish(self, env: dict, exclude: WebSocket | None = None):
        kind = env["msg"].get("type")
        async with self.lock:
            if kind == "walk.reset":
                self.history = deque((e for e in self.history if e["msg"].get("type") in ("place.update", "guardian.join")), maxlen=400)
            elif kind == "walk.start":
                self.history = deque((e for e in self.history if e["msg"].get("type") in ("agent.log", "walk.plan", "place.update", "guardian.join")), maxlen=400)
            elif kind == "walk.position":
                self.history = deque((e for e in self.history if e["msg"].get("type") != "walk.position"), maxlen=400)
            self.history.append(env)
            for peer in list(self.clients):
                if peer is exclude:
                    continue
                try:
                    await peer.send_json(env)
                except (RuntimeError, WebSocketDisconnect):
                    self.clients.discard(peer)


walk_rooms: dict[str, WalkRoom] = {}
live_walks: dict[str, LiveWalk] = {}


@app.websocket("/ws")
async def ws_walk(sock: WebSocket, walk: str = "demo", role: str = "unknown"):
    del role  # The role is part of the client URL; envelopes carry their sender.
    room = walk_rooms.setdefault(walk, WalkRoom())
    await sock.accept()
    async with room.lock:
        await sock.send_json({"kind": "history", "envelopes": list(room.history)})
        room.clients.add(sock)
    try:
        while True:
            try:
                env = json.loads(await sock.receive_text())
            except json.JSONDecodeError:
                continue
            if not isinstance(env, dict) or env.get("walkId") != walk or not isinstance(env.get("msg"), dict):
                continue
            kind = env["msg"].get("type")
            await room.publish(env, exclude=sock)
            # The local replay sends its own envelopes as `engine`. Only a
            # walker-originated accept activates server-side agent responses.
            if env.get("from") in ("walker", "room") and kind in ("walk.accept", "audit.run") and walk not in live_walks:
                live_walks[walk] = LiveWalk(walk, engine, room.publish)
            live = live_walks.get(walk)
            if live and env.get("from") != "engine":
                replay_places = kind == "walk.accept" and not live.routes
                await live.handle(env)
                if replay_places:
                    # A shop may have updated hours before the walker joined.
                    for prior in list(room.history):
                        if prior["msg"].get("type") == "place.update":
                            await live.place_update(prior["msg"].get("place"))
    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            room.clients.discard(sock)


WEB = ROOT / "streetwise-web" / "dist"
if WEB.exists():                                   # single-process deploy: the built PWA is served from the same origin
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        f = WEB / path
        return FileResponse(f if f.is_file() else WEB / "index.html")
