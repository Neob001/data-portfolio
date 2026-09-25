#!/usr/bin/env python3
"""Weekly revenue scorecard (SC1), zero token.

Per live Actor: real users and real runs in the last 30 days (Apify's daily auto-test, 1 user and
one run per day, is subtracted), week-over-week change from state/scorecard_history.json, failure
rate, and a traction verdict. Actors public for 30+ days with zero real users get a *proposal*
(title rewrite or price test) for the owner; nothing is changed automatically.

Revenue itself is only visible in the Apify Console (Insights > Monetization), not the API.

Writes state/scorecard.json, state/scorecard.md and appends to state/scorecard_history.json.
Usage: APIFY_TOKEN=... scorecard.py [--no-history]
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from apify_api import get

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "state"
NO_TRACTION_DAYS = 30


def fetch(aid):
    for attempt in range(4):
        try:
            return get(f"/acts/{aid}")["data"]
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


def days_since(iso):
    if not iso:
        return None
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).days


def primary_price_per_1k(act):
    infos = act.get("pricingInfos") or []
    events = ((infos[-1].get("pricingPerEvent") or {}).get("actorChargeEvents") or {}) if infos else {}
    prim = [v for v in events.values() if v.get("isPrimaryEvent")] or list(events.values())
    return round(prim[0]["eventPriceUsd"] * 1000, 2) if prim and prim[0].get("eventPriceUsd") is not None else None


def main():
    registry = json.loads((ROOT / "registry.json").read_text())["actors"]
    hist_path = STATE / "scorecard_history.json"
    history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    prev = history[-1]["actors"] if history else {}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    rows = {}
    for slug, meta in registry.items():
        aid = meta.get("apify_actor_id")
        if meta.get("status") != "live" or not aid:
            continue
        act = fetch(aid)
        if not act:
            rows[slug] = {"error": "api_unreachable"}
            continue
        s = act.get("stats") or {}
        r30 = s.get("publicActorRunStats30Days") or {}
        age = days_since(meta.get("launched_at")) or days_since(meta.get("staging_started_at")) or days_since(act.get("createdAt")) or 0
        tester_days = min(30, age) if act.get("isPublic") else 0
        runs30 = r30.get("TOTAL", 0)
        failed30 = r30.get("FAILED", 0) + r30.get("TIMED-OUT", 0)
        real_users = max(s.get("totalUsers30Days", 0) - (1 if tester_days else 0), 0)
        real_runs = max(runs30 - tester_days, 0)
        before = prev.get(slug, {})
        if real_users == 0 and age >= NO_TRACTION_DAYS:
            verdict = "no_traction"
        elif real_users == 0:
            verdict = "too_early"
        elif real_users > before.get("real_users_30", 0):
            verdict = "growing"
        else:
            verdict = "has_users"
        rows[slug] = {
            "public": act.get("isPublic"), "notice": act.get("notice"), "days_live": age,
            "price_per_1k": primary_price_per_1k(act),
            "real_users_30": real_users, "real_users_7": max(s.get("totalUsers7Days", 0) - (1 if tester_days else 0), 0),
            "real_runs_30": real_runs, "fail_rate_30": round(failed30 / runs30, 3) if runs30 else 0.0,
            "wow_users": real_users - before.get("real_users_30", 0) if before else None,
            "verdict": verdict,
        }

    proposals = [
        f"{slug}: {r['days_live']} days live, 0 real users. Proposal: test a new title/SEO copy for its top buyer search, "
        f"and if still 0 after 30 more days, a -30% price test (now ${r['price_per_1k']}/1k)."
        for slug, r in rows.items() if r.get("verdict") == "no_traction"
    ]
    health = [f"{slug}: {r['fail_rate_30']:.0%} of runs failed (30d)" for slug, r in rows.items() if r.get("fail_rate_30", 0) > 0.05]
    health += [f"{slug}: notice {r['notice']}" for slug, r in rows.items() if r.get("notice") not in (None, "NONE")]

    out = {"date": today, "actors": rows, "proposals": proposals, "health_flags": health,
           "totals": {"live": len(rows), "with_real_users": sum(1 for r in rows.values() if r.get("real_users_30")),
                      "real_users_30": sum(r.get("real_users_30", 0) for r in rows.values()),
                      "real_runs_30": sum(r.get("real_runs_30", 0) for r in rows.values())}}
    STATE.mkdir(exist_ok=True)
    (STATE / "scorecard.json").write_text(json.dumps(out, indent=2) + "\n")

    order = sorted(rows.items(), key=lambda kv: (-kv[1].get("real_users_30", 0), -kv[1].get("real_runs_30", 0), kv[0]))
    md = [f"# Scorecard {today}", "",
          f"Live Actors: {out['totals']['live']} · with real users: {out['totals']['with_real_users']} · "
          f"real users (30d): {out['totals']['real_users_30']} · real runs (30d): {out['totals']['real_runs_30']}",
          "Revenue: Apify Console > Insights > Monetization (not available via API).", "",
          "| Actor | Real users 30d | Δ week | Real runs 30d | Fail % | $/1k | Days live | Verdict |", "|---|---|---|---|---|---|---|---|"]
    for slug, r in order:
        if "error" in r:
            md.append(f"| {slug} | ? | | | | | | api error |")
            continue
        wow = "" if r["wow_users"] is None else f"{r['wow_users']:+d}"
        md.append(f"| {slug} | {r['real_users_30']} | {wow} | {r['real_runs_30']} | {r['fail_rate_30']*100:.0f} | "
                  f"{r['price_per_1k']} | {r['days_live']} | {r['verdict']} |")
    if proposals:
        md += ["", "## Proposals (owner decides)"] + [f"- {p}" for p in proposals]
    if health:
        md += ["", "## Health flags"] + [f"- {h}" for h in health]
    (STATE / "scorecard.md").write_text("\n".join(md) + "\n")

    if "--no-history" not in sys.argv:
        history = [h for h in history if h["date"] != today] + [{"date": today, "actors": {
            k: {"real_users_30": v.get("real_users_30", 0), "real_runs_30": v.get("real_runs_30", 0)} for k, v in rows.items()}}]
        hist_path.write_text(json.dumps(history, indent=1) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
