#!/usr/bin/env python3
"""Flip staged actors public, zero token. Run ONLY after:
- the 48h staging window has passed (checked against registry), and
- health.py reports no flags, and
- PPE pricing is configured on the actor (checked via API).

Owner approval: DECISIONS/report item D2 approved 2026-09-11 (publish at
configured prices when staging ends). Prints one line per actor; exits 1 if
anything was skipped so the caller can report it.
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apify_api import BASE, auth_headers, get

ROOT = Path(__file__).resolve().parent.parent
STAGING_HOURS = 48


def put(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={**auth_headers(), "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main() -> int:
    registry = json.loads((ROOT / "registry.json").read_text())
    now = datetime.now(timezone.utc)
    skipped = 0
    for slug, meta in registry.get("actors", {}).items():
        aid = meta.get("apify_actor_id")
        if meta.get("status") != "staging" or not aid:
            continue
        started = datetime.fromisoformat(meta["staging_started_at"].replace("Z", "+00:00"))
        if now - started < timedelta(hours=STAGING_HOURS):
            print(f"SKIP {slug}: staging window not over ({now - started} elapsed)")
            skipped += 1
            continue
        actor = get(f"/acts/{aid}")["data"]
        infos = actor.get("pricingInfos") or []
        if not infos or infos[-1].get("pricingModel") != "PAY_PER_EVENT":
            print(f"SKIP {slug}: no PPE pricing configured")
            skipped += 1
            continue
        if actor.get("isPublic"):
            print(f"OK {slug}: already public")
            continue
        put(f"/acts/{aid}", {"isPublic": True})
        status = get(f"/acts/{aid}")["data"].get("isPublic")
        print(f"{'PUBLISHED' if status else 'FAILED'} {slug}: https://apify.com/factpipe/{slug}")
        if not status:
            skipped += 1
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
