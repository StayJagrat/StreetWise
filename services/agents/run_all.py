"""Run every agent from one process (uagents Bureau, mailbox-capable) or as one OS process per agent.

    python run_all.py                    # Bureau, all agents
    python run_all.py --only scout,place # Bureau, subset ('place' = the simulated shop agents)
    python run_all.py --multiprocess     # one subprocess per agent (each uses its own port from the registry)
Run a single agent alone with:  python scout.py | watcher.py | rescuer.py | reporter.py | night_auditor.py | place_agent.py <place_id>
"""
import argparse
import subprocess
import sys

from common import BUREAU_PORT, CORE, HERE, load_places, local_bureau_policy, mode


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--multiprocess", action="store_true"); ap.add_argument("--only", default="")
    args = ap.parse_args(); only = {x.strip() for x in args.only.split(",") if x.strip()} or None
    if args.multiprocess:
        cmds = [[sys.executable, f"{k}.py"] for k in CORE if not only or k in only]
        if not only or "place" in only: cmds += [[sys.executable, "place_agent.py", p["place_id"]] for p in load_places()]
        procs = [subprocess.Popen(c, cwd=HERE) for c in cmds]
        try:
            for p in procs: p.wait()
        except KeyboardInterrupt:
            for p in procs: p.terminate()
        return
    from uagents import Bureau
    from registry import build_all
    bureau = Bureau(port=BUREAU_PORT, endpoint=[f"http://127.0.0.1:{BUREAU_PORT}/submit"], registration_policy=local_bureau_policy()) if mode() == "local" else Bureau(port=BUREAU_PORT)
    for a in build_all(only): bureau.add(a); print(f"  {a.name:36s} {a.address}")
    bureau.run()


if __name__ == "__main__":
    main()
