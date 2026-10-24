"""Guardian notification by SMS (Twilio). The live link is the primary channel; SMS is the backup.

Never contacts emergency services. With no credentials it reports "not configured" and the walk carries on.
"""
from __future__ import annotations

import logging
import re

import httpx

log = logging.getLogger("streetwise.notify")
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


class Notifier:
    def __init__(self, sid: str = "", token: str = "", sender: str = ""):
        self.sid, self.token, self.sender = sid, token, sender

    @property
    def enabled(self) -> bool: return bool(self.sid and self.token and self.sender)

    async def sms(self, to: str | None, body: str) -> str:
        """Returns a short status for the agent log: 'sent', 'not configured', 'no number', or 'failed (...)'. Never raises."""
        if not self.enabled: return "not configured"
        if not to or not E164.match(to): return "no number"
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json", auth=(self.sid, self.token),
                                 data={"To": to, "From": self.sender, "Body": body[:600]})
            if r.status_code in (200, 201): return "sent"
            code = r.json().get("code") if r.headers.get("content-type", "").startswith("application/json") else r.status_code
            log.warning("twilio rejected the message: %s", code); return f"failed ({code})"
        except httpx.HTTPError as e:
            log.warning("twilio unreachable: %s", type(e).__name__); return f"failed ({type(e).__name__})"
