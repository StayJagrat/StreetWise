"""Single place that knows every agent: builders, names, and addresses."""
from common import CORE, address_of, load_places, slug
from night_auditor import build_night_auditor
from place_agent import build_place_agent
from rescuer import build_rescuer
from reporter import build_reporter
from scout import build_scout
from watcher import build_watcher

CORE_BUILDERS = dict(scout=build_scout, watcher=build_watcher, rescuer=build_rescuer, reporter=build_reporter, night_auditor=build_night_auditor)


def build_all(only: set[str] | None = None) -> list:
    agents = [b() for k, b in CORE_BUILDERS.items() if not only or k in only]
    if not only or "place" in only: agents += [build_place_agent(p) for p in load_places()]
    return agents
