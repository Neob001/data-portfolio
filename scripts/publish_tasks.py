#!/usr/bin/env python3
"""Create, verify and publish the example tasks in tasks.json (zero token).

For each task: create or update it (matched by name), run it once, and publish it only if the run
SUCCEEDED with at least one dataset item. Published tasks become Store landing pages at
https://apify.com/factpipe/<actor>/examples/<name>. Input keys are checked against the Actor's
INPUT_SCHEMA.json before anything is sent. Runs are sequential to stay inside the free plan's memory.

Usage: APIFY_TOKEN=... publish_tasks.py [--only <task-name> ...] [--no-run]
"""
import json
import sys
import time
from pathlib import Path

from apify_api import get, post, put

ROOT = Path(__file__).resolve().parent.parent


def wait_run(run_id, timeout=900):
    end = time.time() + timeout
    while time.time() < end:
        run = get(f"/actor-runs/{run_id}")["data"]
        if run["status"] not in ("READY", "RUNNING"):
            return run
        time.sleep(5)
    return get(f"/actor-runs/{run_id}")["data"]


def main():
    spec = json.loads((ROOT / "tasks.json").read_text())["tasks"]
    only = sys.argv[sys.argv.index("--only") + 1:] if "--only" in sys.argv else None
    ids = json.loads((ROOT / "state" / "actor_ids.json").read_text())
    existing = {t["name"]: t for t in get("/actor-tasks", limit=1000)["data"]["items"]}
    results = []
    for t in spec:
        if only and t["name"] not in only:
            continue
        slug = t["actor"]
        schema = json.loads((ROOT / "actors" / slug / "INPUT_SCHEMA.json").read_text())["properties"]
        unknown = set(t["input"]) - set(schema)
        if unknown:
            results.append((t["name"], f"SKIP unknown input fields {sorted(unknown)}"))
            continue
        views = list(json.loads((ROOT / "actors" / slug / ".actor" / "actor.json").read_text())
                     .get("storages", {}).get("dataset", {}).get("views", {}).keys())
        body = {"actId": ids[slug], "name": t["name"], "title": t["title"], "description": t["description"],
                "input": t["input"], "options": {"build": "latest", "memoryMbytes": 1024, "timeoutSecs": 3600}}
        if t["name"] in existing:
            task = put(f"/actor-tasks/{existing[t['name']]['id']}", {k: v for k, v in body.items() if k != "actId"})["data"]
        else:
            task = post("/actor-tasks", body)["data"]
        if "--no-run" not in sys.argv:
            run = wait_run(post(f"/actor-tasks/{task['id']}/runs", {})["data"]["id"])
            items = get(f"/datasets/{run['defaultDatasetId']}/items", clean=1, limit=1)
            items = items if isinstance(items, list) else items.get("data", [])
            if run["status"] != "SUCCEEDED" or not items:
                results.append((t["name"], f"NOT PUBLISHED: run {run['id']} {run['status']}, items {len(items)}"))
                continue
        put(f"/actor-tasks/{task['id']}", {"publicConfig": {"inputSchemaFields": list(t["input"]), "datasetView": views[0]}})
        task = put(f"/actor-tasks/{task['id']}", {"isPublic": True})["data"]
        results.append((t["name"], f"PUBLISHED https://apify.com/factpipe/{slug}/examples/{t['name']}"))
        print(results[-1], flush=True)
    for name, status in results:
        print(f"{name}: {status}")
    return 1 if any(not s.startswith("PUBLISHED") for _, s in results) else 0


if __name__ == "__main__":
    sys.exit(main())
