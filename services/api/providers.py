"""Optional speech and grounded answers. Missing providers have explicit fallbacks."""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict, deque

import requests
from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import pwa_gateway as gateway

router = APIRouter()
calls = defaultdict(deque)


@router.get("/api/config")
async def config():
    return {"supabaseUrl": os.getenv("SUPABASE_URL", ""), "supabaseAnonKey": os.getenv("SUPABASE_ANON_KEY", ""),
            "googleLogin": os.getenv("GOOGLE_AUTH_ENABLED", "").lower() == "true" and bool(os.getenv("SUPABASE_ANON_KEY")),
            "voice": "browser",
            "reasoning": "claude" if os.getenv("ANTHROPIC_API_KEY") else "deterministic",
            "agentverse": "not_connected", "imagery": bool(os.getenv("MAPILLARY_ACCESS_TOKEN"))}


async def authorized(ident, authorization):
    active = await gateway.get_room(ident)
    if not active or not gateway.repository.authorized(active.row, "walker", gateway.bearer(authorization)):
        raise HTTPException(403, "This walk link is invalid or expired.")
    stamps = calls[ident]
    while stamps and time.time() - stamps[0] > 60:
        stamps.popleft()
    if len(stamps) >= 45:
        raise HTTPException(429, "Voice is busy. Use the on-screen controls for a moment.")
    stamps.append(time.time())
    return active


class VoiceRequest(BaseModel):
    walkId: str
    text: str = Field(min_length=1, max_length=600)


@router.post("/api/voice/ask")
async def ask(body: VoiceRequest, authorization: str | None = Header(None)):
    active = await authorized(body.walkId, authorization)
    live = active.live
    data = live.data
    if not data:
        raise HTTPException(409, "Choose a route before asking about the walk.")
    places = [p["name"] for p in data["places"] if live.place_states.get(p["id"], p).get("openUntil") != "closed"]
    text = (f"Listed places along this route include {', '.join(places[:3])}. Hours are cached; access has not been confirmed."
            if places else "There are no listed open places in the route's current evidence. You can request a place to wait or contact your guardian.")
    provider = "deterministic"
    key = os.getenv("ANTHROPIC_API_KEY")
    if key:
        context = {"route": data["stats"], "places": [{"name": p["name"], "listedUntil": p["openUntil"], "simulated": p["simulated"]} for p in data["places"]],
                   "request": live.help_request, "replay": live.replay}
        try:
            result = await run_in_threadpool(requests.post, "https://api.anthropic.com/v1/messages", timeout=10,
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                json={"model": os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5"), "max_tokens": 240, "thinking": {"type": "disabled"},
                      "system": "You are Streetwise, a walking companion. Answer in at most two short sentences using only the supplied facts. State unknowns. Never promise safety, infer threatening people, claim a business is verified, or claim emergency services were contacted. Do not give unrelated advice. You cannot perform actions; the buttons execute actions.",
                      "messages": [{"role": "user", "content": json.dumps({"facts": context, "question": body.text})}]})
            if result.ok:
                answer = " ".join(c.get("text", "") for c in result.json().get("content", []) if c.get("type") == "text").strip()
                if answer:
                    text, provider = answer[:700], "claude"
        except (requests.RequestException, ValueError):
            pass
    await live.say("watcher", text)
    await live.log("watcher", "Answered a question from the route evidence.", f"Answer source: {provider}. No model output changes a score.")
    return {"text": text, "provider": provider}
