"""Offline integration checks for the typed live gateway adapter.

Run with: .venv/bin/python -m unittest services/api/test_live_walk.py
"""
import asyncio
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "engine"))
sys.path.insert(0, str(ROOT / "services" / "api"))

from streetwise_engine.engine import Engine  # noqa: E402
from live_walk import LiveWalk  # noqa: E402


class LiveWalkTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()

    async def asyncSetUp(self):
        self.messages = []

        async def emit(envelope):
            self.messages.append(envelope)

        self.live = LiveWalk("test-live", self.engine, emit)
        self.live.thresholds = {"stopSeconds": 0.03, "replySeconds": 0.04, "escalateSeconds": 0.04}

    async def asyncTearDown(self):
        await self.live.reset()

    def sent(self, kind):
        return [envelope["msg"] for envelope in self.messages if envelope["msg"]["type"] == kind]

    async def test_plan_shop_audit_and_watcher(self):
        await self.live.accept("streetwise")
        self.assertTrue(self.sent("walk.plan"))
        plan = self.sent("walk.plan")[-1]["plan"]
        self.assertGreaterEqual(plan["stats"]["streetwise"]["score"], plan["stats"]["shortest"]["score"])
        self.assertTrue(0 <= plan["stats"]["shortest"]["score"] <= 100)
        self.assertEqual(plan["thresholds"]["stopSeconds"], 0.03)
        self.assertTrue(self.sent("voice.say"))
        self.assertTrue(self.sent("agent.log"))
        self.assertTrue(all(e["from"] == "engine" and e["walkId"] == "test-live" for e in self.messages))

        choice = self.live.routes["best"]
        suggested = self.engine.suggest_declarations(self.live.session, choice, self.live.day, self.live.minute)
        self.assertTrue(suggested)
        await self.live.place_update({"id": suggested[0]["id"], "openUntil": "01:00", "safeHaven": True, "frontLight": True})
        changed = self.sent("walk.plan")[-1]["plan"]["stats"]
        self.assertIn("streetwise", changed)
        self.assertGreaterEqual(len(self.sent("walk.plan")), 2)
        self.assertIn("Front light and shop labels are not score inputs", self.sent("agent.log")[-1]["reason"])

        await self.live.audit()
        audit = self.sent("audit.result")[-1]
        self.assertTrue(audit["ranking"])
        self.assertIn("not submitted", audit["draft311"])

        await self.live.start()
        gap = choice["gap"]["range"]
        self.assertIsNotNone(gap)
        progress = (gap[0] + gap[1]) / 2 / (choice["km"] * 1000)
        stationary = {"lngLat": choice["coords"][len(choice["coords"]) // 2], "progress": progress, "speed": 0}
        await self.live.position_update(stationary)
        await self.live.position_update(stationary)
        await asyncio.sleep(0.05)
        self.assertEqual(len(self.sent("checkin.ask")), 1)
        self.assertGreater(self.sent("checkin.ask")[0]["deadline"], 0)
        self.assertIn("stopped 0.03 s", self.sent("agent.log")[-1]["reason"])
        await asyncio.sleep(0.05)
        self.assertEqual(len(self.sent("escalate")), 1)
        self.assertEqual(len(self.sent("guardian.alert")), 1)
        self.assertEqual(self.sent("guardian.alert")[0]["lngLat"], stationary["lngLat"])
        await self.live.reply("fine")
        self.assertFalse(self.live.escalated)
        self.assertIn("Check-in cleared", self.sent("agent.log")[-1]["text"])

    async def test_reply_cancels_escalation_and_start_is_idempotent(self):
        await self.live.accept("usual")
        await self.live.start()
        route = self.live.routes["fast"]
        gap = route["gap"]["range"]
        self.assertIsNotNone(gap)
        progress = (gap[0] + gap[1]) / 2 / (route["km"] * 1000)
        stationary = {"lngLat": route["coords"][len(route["coords"]) // 2], "progress": progress, "speed": 0}
        await self.live.position_update(stationary)
        await self.live.position_update(stationary)
        await asyncio.sleep(0.05)
        self.assertEqual(len(self.sent("checkin.ask")), 1)
        await self.live.reply("fine")
        await asyncio.sleep(0.05)
        self.assertFalse(self.sent("guardian.alert"))

    async def test_selected_destination_snap_and_no_default_fallback(self):
        await self.live.accept("streetwise", {
            "origin": {"lat": 37.784393, "lon": -122.4078906},
            # This engine-snapped endpoint is about 88 m north of the graph bbox.
            "dest": {"lat": 37.7947882, "lon": -122.402385},
        })
        self.assertTrue(self.live.routes)
        await self.live.reset()
        self.messages.clear()
        await self.live.accept("streetwise", {"dest": {"lat": 34.05, "lon": -118.24}})
        await self.live.start()
        self.assertFalse(self.live.routes)
        self.assertFalse(self.sent("walk.plan"))
        self.assertIn("no accepted route plan", self.sent("agent.log")[-1]["text"])


if __name__ == "__main__":
    unittest.main()
