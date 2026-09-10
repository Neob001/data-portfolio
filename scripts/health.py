#!/usr/bin/env python3
"""Zero-token daily health check. Writes state/health.json.

Flags an actor when: >=2 consecutive failed runs, or failure rate >5% in the
last 24h, or 24h row count < 50% of the 7-day median. Exit code 1 when
anything is flagged (so a Routine can decide to act), 0 when all green.
"""
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apify_api import get

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = json.loads((ROOT / "registry.json").read_text())


def runs_for(actor_id: str, limit: int = 200) -> list:
    return get(f"/acts/{actor_id}/runs", limit=limit, desc=1)["data"]["items"]


def main() -> int:
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)
    report = {"generated_at": now.isoformat(), "actors": {}, "flags": []}

    for slug, meta in REGISTRY.get("actors", {}).items():
        actor_id = meta.get("apify_actor_id")
        if not actor_id or meta.get("status") not in ("live", "staging"):
            continue
        runs = runs_for(actor_id)
        recent = [r for r in runs if r.get("startedAt", "") >= day_ago.isoformat()]
        week = [r for r in runs if r.get("startedAt", "") >= week_ago.isoformat()]

        failed24 = sum(1 for r in recent if r.get("status") not in ("SUCCEEDED", "RUNNING", "READY"))
        total24 = len(recent)
        consec = 0
        for r in runs:  # newest first
            if r.get("status") == "SUCCEEDED":
                break
            if r.get("status") in ("FAILED", "TIMED-OUT", "ABORTED"):
                consec += 1

        daily_rows = {}
        for r in week:
            day = r.get("startedAt", "")[:10]
            rows = (r.get("stats") or {}).get("datasetItemCount") or 0
            daily_rows[day] = daily_rows.get(day, 0) + rows
        today_rows = daily_rows.get(now.isoformat()[:10], 0) + daily_rows.get((now - timedelta(days=1)).isoformat()[:10], 0)
        median_rows = statistics.median(daily_rows.values()) if daily_rows else 0

        entry = {
            "runs_24h": total24,
            "failed_24h": failed24,
            "failure_rate_24h": round(failed24 / total24, 4) if total24 else 0,
            "consecutive_failures": consec,
            "rows_last_2d": today_rows,
            "median_daily_rows_7d": median_rows,
        }
        report["actors"][slug] = entry

        if consec >= 2:
            report["flags"].append({"actor": slug, "reason": "consecutive_failures", "value": consec})
        if total24 >= 5 and failed24 / total24 > 0.05:
            report["flags"].append({"actor": slug, "reason": "failure_rate", "value": entry["failure_rate_24h"]})
        if median_rows > 0 and today_rows < 0.5 * median_rows:
            report["flags"].append({"actor": slug, "reason": "row_count_drop", "value": today_rows})

    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "state" / "health.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"flags": report["flags"], "actors_checked": len(report["actors"])}, indent=2))
    return 1 if report["flags"] else 0


if __name__ == "__main__":
    sys.exit(main())
