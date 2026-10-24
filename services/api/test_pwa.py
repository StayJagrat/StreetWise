"""Connected PWA invariants: real route updates, restart deadlines and role scopes."""
import asyncio
import math
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services/api"), str(ROOT / "services/engine")]
from connected_walk import ConnectedWalk
from live_walk import _until
from persistence import RoomRepository
from pwa_gateway import valid_message
from streetwise_engine.engine import Engine


class PermissionsTest(unittest.TestCase):
    def test_capabilities_are_scoped_and_expire(self):
        repo = RoomRepository(":memory:")
        room, tokens = repo.create("demo", {})
        self.assertTrue(repo.authorized(room, "walker", tokens["walker"]))
        self.assertEqual(repo.invite_tokens(repo.get(room["id"])), tokens)
        self.assertFalse(repo.authorized(room, "guardian", tokens["walker"]))
        self.assertNotIn(tokens["walker"], str(repo.get(room["id"])))
        room["expires"] = time.time() - 1
        self.assertFalse(repo.authorized(room, "walker", tokens["walker"]))
        repo.close()

    def test_forged_roles_nonfinite_and_demo_gps_are_rejected(self):
        self.assertFalse(valid_message({"type": "guardian.alert"}, "walker", "demo"))
        self.assertFalse(valid_message({"type": "walk.start", "replay": True}, "guardian", "demo"))
        position = {"type": "walk.position", "lngLat": [-122.4, 37.78], "speed": 0, "replay": False}
        self.assertFalse(valid_message(position, "walker", "demo"))
        self.assertTrue(valid_message(position, "walker", "live"))
        position["accuracy"] = math.nan
        self.assertFalse(valid_message(position, "walker", "live"))

    def test_shop_hours_roll_forward_from_any_departure(self):
        self.assertEqual(_until("12:00", 8 * 60), 12 * 60)
        self.assertEqual(_until("01:00", 23 * 60), 25 * 60)
        self.assertIsNone(_until("closed", 23 * 60))


class ConnectedWalkTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()

    async def asyncSetUp(self):
        self.messages = []
        async def emit(event):
            self.messages.append(event)
        self.live = ConnectedWalk("unit-connected", self.engine, emit, {"destination": "Transamerica", "origin": "Powell BART"})
        await asyncio.wait_for(self.live.accept("streetwise"), 40)

    async def asyncTearDown(self):
        await self.live.reset()

    def messages_of(self, kind):
        return [e["msg"] for e in self.messages if e["msg"]["type"] == kind]

    async def test_plan_geometry_and_shop_replanning_are_versioned(self):
        first = self.messages_of("walk.plan")[-1]["plan"]
        self.assertEqual(first["data"]["route"], self.live.routes["best"]["coords"])
        place = self.live.data["places"][0]
        await self.live.place_update({"id": place["id"], "openUntil": "closed", "safeHaven": False, "frontLight": False})
        second = self.messages_of("walk.plan")[-1]["plan"]
        self.assertGreater(second["version"], first["version"])
        self.assertEqual(second["data"]["routeSteps"]["streetwise"], self.live.routes["best"]["steps"])
        self.assertEqual(self.engine.sessions[self.live.session].overrides[place["id"]], -1)

    async def test_decline_then_accept_routes_to_a_confirmed_demo_place(self):
        self.live.running = True
        self.live.position = self.live._route()["coords"][0]
        await self.live.request_help_place()
        first = self.live.help_request
        await self.live.place_reply(first["id"], False)
        self.assertNotEqual(first["place"]["id"], self.live.help_request["place"]["id"])
        request = self.live.help_request
        await self.live.place_reply(request["id"], True)
        self.assertEqual(self.live.help_request["status"], "accepted")
        self.assertEqual(self.live.profile["destination"], request["place"]["name"])
        await self.live.handle({"msg": {"type": "walk.replan", "resumeDestination": True}})
        self.assertEqual(self.live.profile["destination"], "Transamerica")
        self.assertIsNone(self.live.original_goal)

    async def test_each_checkin_has_a_new_incident_and_resets_old_acknowledgment(self):
        self.live.running = True
        self.live.thresholds["stopSeconds"] = .001
        gap = self.live._route()["gap"]["range"]
        self.assertTrue(gap)
        self.live.distance = sum(gap) / 2
        self.live.last_distance = self.live.distance
        self.live.position = self.live.engine.point_at(self.live._route(), self.live.distance)
        self.live.stopped_at = time.monotonic()
        await self.live._after_stop()
        first = self.live.incident_id
        self.assertTrue(first)
        await self.live.reply("fine")
        self.live.stopped_at = time.monotonic()
        await self.live._after_stop()
        self.assertTrue(self.live.incident_id)
        self.assertNotEqual(first, self.live.incident_id)
        self.assertFalse(self.live.acknowledged)
        await self.live.handle({"msg": {"type": "checkin.reply", "reply": "fine", "incidentId": first}})
        self.assertTrue(self.live.checkin)

    async def test_restart_restores_a_pending_checkin_deadline(self):
        self.live.running = True
        self.live.replay = False
        self.live.checkin = True
        self.live.incident_id = "pending-incident"
        self.live.checkin_deadline = time.time() * 1000 + 20
        state = self.live.snapshot()
        await self.live.reset()
        await self.live.restore(state)
        await asyncio.sleep(.08)
        self.assertTrue(self.messages_of("guardian.alert"))
        self.assertEqual(self.messages_of("guardian.alert")[-1]["incidentId"], "pending-incident")

    async def test_stale_gps_and_stale_reply_do_not_clear_or_create_incidents(self):
        self.live.running = True
        self.live.replay = False
        applied = await self.live.position_update({"lngLat": self.live._route()["coords"][0], "fixTime": 0, "accuracy": 10, "speed": 0})
        self.assertFalse(applied)
        self.assertIsNone(self.live.stop_task)
        self.live.escalated = True
        self.live.incident_id = "new-incident"
        await self.live.handle({"id": "old-reply", "msg": {"type": "checkin.reply", "reply": "fine", "incidentId": "old-incident"}})
        self.assertTrue(self.live.escalated)
        await self.live.handle({"msg": {"type": "observation.add", "kind": "lighting", "note": "Lamp appears off"}})
        await self.live.finish("ended")
        self.assertIn("Lamp appears off", self.messages_of("report.ready")[-1]["text"])
        self.assertFalse(self.live.running)
        self.assertIsNone(self.live.position)
        self.assertEqual(self.messages_of("walk.end")[-1]["outcome"], "ended")


if __name__ == "__main__":
    unittest.main()
