#!/usr/bin/env python3
"""Rebuild actors from the GitHub source (push first), at most 4 at a time (free plan: 16 GB build memory).

Usage: rebuild_actors.py <slug> [<slug> ...]
Prints one line per build; exits 1 if any build did not succeed.
"""
import json
import sys
import time
from pathlib import Path

from apify_api import get, post

ROOT = Path(__file__).resolve().parent.parent
BATCH = 4


def start(aid):
    for attempt in range(6):
        try:
            return post(f"/acts/{aid}/builds?version=0.1&tag=latest", {})["data"]["id"]
        except Exception as e:  # HTTP 402 when build memory is exhausted
            if attempt == 5:
                raise
            time.sleep(20 * (attempt + 1))
            last = e
    raise last


def wait(build_id):
    while True:
        try:
            s = get(f"/actor-builds/{build_id}")["data"]["status"]
        except Exception:
            s = "RUNNING"
        if s not in ("READY", "RUNNING"):
            return s
        time.sleep(10)


def main():
    ids = json.loads((ROOT / "state" / "actor_ids.json").read_text())
    reg = json.loads((ROOT / "registry.json").read_text())["actors"]
    slugs = sys.argv[1:]
    failed = 0
    for i in range(0, len(slugs), BATCH):
        batch = slugs[i:i + BATCH]
        started = {s: start(ids.get(s) or reg[s]["apify_actor_id"]) for s in batch}
        for s, b in started.items():
            status = wait(b)
            print(f"{status:<10} {s} build {b}", flush=True)
            failed += status != "SUCCEEDED"
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
