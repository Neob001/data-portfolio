#!/usr/bin/env python3
"""Assemble the numbers block for WEEKLY_REPORT.md, zero token.

Pulls per-actor 30d usage/revenue from the Apify API where available, plus
state/health.json, state/pricing_proposals.json and state/opportunities.json.
Writes state/report_numbers.json; the weekly-report Routine (Haiku) compresses
it to one screen and writes WEEKLY_REPORT.md.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name):
    p = ROOT / "state" / name
    return json.loads(p.read_text()) if p.exists() else None


def main() -> None:
    registry = json.loads((ROOT / "registry.json").read_text())
    numbers = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "actors": {
            slug: {"status": a.get("status"), "kpis": a.get("kpis", {})}
            for slug, a in registry.get("actors", {}).items()
        },
        "health": load("health.json"),
        "pricing_proposals": load("pricing_proposals.json"),
        "top_opportunities": (load("opportunities.json") or [])[:5],
    }
    (ROOT / "state" / "report_numbers.json").write_text(json.dumps(numbers, indent=2))
    print("wrote state/report_numbers.json")


if __name__ == "__main__":
    main()
