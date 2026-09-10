#!/usr/bin/env python3
"""Level-1 auto-repair, zero token. For blocked / site_down / timeout only.

Usage: autofix_l1.py <actor_slug> <failure_class>
Re-runs the actor with its last input up to 3 times with growing waits.
Exit 0 = a retry SUCCEEDED (incident closed, no model needed).
Exit 1 = still failing -> the repair Routine may escalate per model tiering.
Exit 2 = wrong failure class for L1 (do not call a model for this either;
         classify again or open a report line).
"""
import json
import sys
import time
from pathlib import Path

from apify_api import get, post

ROOT = Path(__file__).resolve().parent.parent
L1_CLASSES = {"blocked", "site_down", "timeout"}
WAITS_S = [60, 600, 3600]


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: autofix_l1.py <actor_slug> <failure_class>")
    slug, failure_class = sys.argv[1], sys.argv[2]
    if failure_class not in L1_CLASSES:
        print(f"{failure_class} is not an L1 class {sorted(L1_CLASSES)}")
        return 2

    registry = json.loads((ROOT / "registry.json").read_text())
    actor_id = registry["actors"][slug]["apify_actor_id"]

    last = get(f"/acts/{actor_id}/runs", limit=1, desc=1)["data"]["items"]
    if not last:
        print("no previous run found")
        return 1
    run_id = last[0]["id"]
    inp = get(f"/actor-runs/{run_id}")["data"].get("options", {})
    # Re-run with the same input; Apify proxy rotation happens server-side.
    last_input = get(f"/key-value-stores/{last[0]['defaultKeyValueStoreId']}/records/INPUT")

    for attempt, wait in enumerate(WAITS_S, 1):
        print(f"attempt {attempt}: waiting {wait}s then re-running {slug}")
        time.sleep(wait)
        run = post(f"/acts/{actor_id}/runs?waitForFinish=300", last_input or {})["data"]
        status = run.get("status")
        print(f"attempt {attempt}: status={status}")
        if status == "SUCCEEDED":
            return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
