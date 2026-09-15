#!/usr/bin/env python3
"""Run an actor with a JSON input and print status, RUN_SUMMARY and the dataset (zero token).

Usage: staging_run.py <slug> '<json input>' [--items N] [--timeout SECS]
Exits 1 when the run did not succeed.
"""
import json
import sys
import time

from apify_api import get, post

ROOT_IDS = __import__("pathlib").Path(__file__).resolve().parent.parent / "state" / "actor_ids.json"


def main():
    slug, payload = sys.argv[1], json.loads(sys.argv[2])
    show = int(sys.argv[sys.argv.index("--items") + 1]) if "--items" in sys.argv else 5
    timeout = int(sys.argv[sys.argv.index("--timeout") + 1]) if "--timeout" in sys.argv else 600
    aid = json.loads(ROOT_IDS.read_text())[slug]
    run = post(f"/acts/{aid}/runs", payload)["data"]
    deadline = time.time() + timeout
    while run["status"] in ("READY", "RUNNING") and time.time() < deadline:
        time.sleep(5)
        try:
            run = get(f"/actor-runs/{run['id']}")["data"]
        except Exception:
            pass
    summary = None
    try:
        summary = get(f"/key-value-stores/{run['defaultKeyValueStoreId']}/records/RUN_SUMMARY")
    except Exception:
        pass
    items = get(f"/datasets/{run['defaultDatasetId']}/items", clean=1, limit=1000)
    items = items if isinstance(items, list) else items.get("data", [])
    print(json.dumps({"run": run["id"], "status": run["status"], "secs": (run.get("stats") or {}).get("runTimeSecs"),
                      "usd": run.get("usageTotalUsd"), "summary": summary, "items": len(items)}, indent=1))
    for it in items[:show]:
        print(json.dumps(it, ensure_ascii=False)[:700])
    if run["status"] != "SUCCEEDED":
        log = get(f"/actor-runs/{run['id']}/log") if False else None
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
