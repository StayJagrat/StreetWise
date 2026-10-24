"""Durable room snapshots. SQLite is the local journal; Supabase is an optional mirror.

The browser never receives database credentials or reads private room tables.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import threading
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
ROLES = ("walker", "guardian", "shop", "room")


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RoomRepository:
    def __init__(self, path: str | Path | None = None):
        path = path or os.getenv("STREETWISE_DB_PATH", str(ROOT / ".streetwise" / "rooms.sqlite3"))
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.lock = threading.RLock()
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, expires REAL NOT NULL, payload TEXT NOT NULL)")
        self.db.execute("DELETE FROM rooms WHERE expires < ?", (time.time(),))
        self.db.commit()
        self.cloud_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.cloud_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY", "")
        self.cloud_status = "pending" if self.cloud_url and self.cloud_key else "not_configured"

    def create(self, mode: str, profile: dict) -> tuple[dict, dict]:
        invite_secret = secrets.token_urlsafe(32)
        tokens = self.invite_tokens({"invite_secret": invite_secret})
        room = {"invite_secret": invite_secret,"id": secrets.token_urlsafe(18), "mode": mode, "created": time.time(),
                "expires": time.time() + 7200, "profile": profile,
                "capabilities": {role: digest(token) for role, token in tokens.items()},
                "history": [], "state": None, "sequence": 0}
        self.save(room)
        return room, tokens

    @staticmethod
    def invite_tokens(room: dict) -> dict:
        secret = room.get("invite_secret")
        return {role: hmac.new(secret.encode(), role.encode(), hashlib.sha256).hexdigest() for role in ROLES} if secret else {}

    def get(self, ident: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT payload FROM rooms WHERE id=? AND expires>?", (ident, time.time())).fetchone()
        return json.loads(row[0]) if row else None

    def recover(self, ident: str) -> dict | None:
        if not self.cloud_url or not self.cloud_key:
            return None
        try:
            result = requests.get(self.cloud_url + "/rest/v1/pwa_rooms", params={"id": "eq." + ident, "select": "payload"},
                headers={"apikey": self.cloud_key, "Authorization": "Bearer " + self.cloud_key}, timeout=4)
            if result.ok and result.json():
                room = result.json()[0]["payload"]
                if room["expires"] > time.time():
                    self.save(room)
                    return room
        except (requests.RequestException, ValueError, KeyError):
            pass
        return None

    def authorized(self, room: dict | None, role: str, token: str) -> bool:
        return bool(room and room["expires"] > time.time() and role in ROLES and token
                    and secrets.compare_digest(room["capabilities"].get(role, ""), digest(token)))

    def save(self, room: dict):
        with self.lock:
            self.db.execute("INSERT INTO rooms(id,expires,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires,payload=excluded.payload",
                            (room["id"], room["expires"], json.dumps(room, allow_nan=False)))
            self.db.commit()

    def prune(self):
        with self.lock:
            self.db.execute("DELETE FROM rooms WHERE expires < ?", (time.time(),))
            self.db.commit()

    def mirror(self, room: dict):
        if not self.cloud_url or not self.cloud_key:
            return
        try:
            result = requests.post(self.cloud_url + "/rest/v1/rpc/save_pwa_room", headers={
                "apikey": self.cloud_key, "Authorization": "Bearer " + self.cloud_key,
                "Content-Type": "application/json"}, json={"p_room": room}, timeout=5)
            self.cloud_status = "connected" if result.ok else "setup_required" if result.status_code == 404 else "retrying"
        except requests.RequestException:
            self.cloud_status = "retrying"

    def close(self):
        self.db.close()
