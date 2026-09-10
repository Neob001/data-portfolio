#!/usr/bin/env python3
"""Rule-based pricing proposals, zero token. Never changes prices itself:
writes proposals into state/pricing_proposals.json; the weekly report turns
them into yes/no questions and the owner approves in DECISIONS.md.

Rules (per actor, using registry KPIs updated by report.py):
- runs up >20% w/w AND paying_users flat/down  -> propose -10% (conversion problem)
- <3 paid runs in 30 days AND age > 30 days     -> propose KILL review
- top-quartile revenue AND failure_rate < 1%    -> propose +10% test
- first 60 days after launch                    -> keep launch price (10-20%
  below incumbent), no changes proposed
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    registry = json.loads((ROOT / "registry.json").read_text())
    actors = registry.get("actors", {})
    revenues = sorted(a.get("kpis", {}).get("revenue_30d", 0) for a in actors.values())
    top_q = revenues[int(len(revenues) * 0.75)] if revenues else 0
    now = datetime.now(timezone.utc)
    proposals = []

    for slug, a in actors.items():
        if a.get("status") != "live":
            continue
        k = a.get("kpis", {})
        launched = a.get("launched_at")
        age_days = (now - datetime.fromisoformat(launched)).days if launched else 0
        if age_days < 60:
            continue  # launch-pricing window
        if k.get("paid_runs_30d", 0) < 3 and age_days > 30:
            proposals.append({"actor": slug, "action": "KILL_REVIEW", "reason": "near-zero paid runs after 30d"})
        elif k.get("runs_wow_change", 0) > 0.2 and k.get("paying_users_wow_change", 1) <= 0:
            proposals.append({"actor": slug, "action": "PRICE_DOWN_10", "reason": "traffic up, conversion down"})
        elif k.get("revenue_30d", 0) >= top_q and k.get("failure_rate_30d", 1) < 0.01 and top_q > 0:
            proposals.append({"actor": slug, "action": "PRICE_UP_10_TEST", "reason": "top-quartile revenue, <1% failures"})

    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "state" / "pricing_proposals.json").write_text(
        json.dumps({"generated_at": now.isoformat(), "proposals": proposals}, indent=2),
    )
    print(json.dumps(proposals, indent=2))


if __name__ == "__main__":
    main()
