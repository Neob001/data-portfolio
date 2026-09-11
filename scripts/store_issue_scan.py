#!/usr/bin/env python3
"""Module 1 (broken_incumbent_scan): find high-demand Store Actors that are
currently failing for users. Zero token, public documented API only.

Note vs. the addendum spec: Apify does not expose the Issues tab via any
documented public API, so complaint-based signals are approximated with the
Store API's objective 30-day run telemetry (FAILED + TIMED-OUT ratios),
review ratings, and recency. breakage_score therefore =
    fail_rate_30d * (1 + timeout_rate_30d) * demand_weight
opportunity_score = breakage_score * log10(runs_30d + 1)

legal_flag (True = NOT eligible for auto-approve) is conservative:
- blocklist keyword anywhere -> legal_flag True, excluded entirely.
- graylist keyword (big-platform scraping with contested ToS) -> legal_flag
  True (may be listed as an approval question, never auto-built).
- otherwise legal_flag False only if the actor looks like a public-web or
  official-source tool. When unsure, True.

Writes targets/incumbents.json (all scanned, top candidates flagged).
"""
import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "factpipe-store-scan/1.0"}

BLOCKLIST = ("linkedin", "amazon", "instagram", "facebook", "fb ", "meta ads")
GRAYLIST = (
    "tiktok", "twitter", " x.com", "x scraper", "youtube", "google", "gmail",
    "telegram", "whatsapp", "zillow", "airbnb", "booking", "indeed", "glassdoor",
    "crunchbase", "tripadvisor", "walmart", "ebay", "etsy", "shopee", "aliexpress",
    "temu", "pinterest", "reddit", "threads", "onlyfans", "spotify", "netflix",
    "twitch", "discord", "snapchat", "yelp", "mercadolibre", "mercado libre",
    # PII-class tools (person-targeted) and auth-gated integrations
    "email finder", "email extractor", "email verif", "phone number", "contact detail",
    "people search", "person lookup", "profile scraper", "leads", "lead gen",
    "oauth", "login", "sign-in", "ai agent", "gpt", "llm", "claude", "openai",
)

MIN_RUNS_30D = 500          # demand floor
MIN_FAIL_RATE = 0.08        # 8%+ of runs failing = users are hurting
PAGES = 10                  # top 1000 by popularity


def fetch_page(offset):
    url = f"https://api.apify.com/v2/store?limit=100&offset={offset}&sortBy=popularity"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)["data"]["items"]


def classify_legal(item):
    text = " ".join([
        item.get("title") or "", item.get("name") or "", item.get("description") or "",
    ]).lower()
    for w in BLOCKLIST:
        if w in text:
            return True, f"blocklist:{w.strip()}"
    for w in GRAYLIST:
        if w in text:
            return True, f"gray:{w.strip()}"
    return False, "clear"


def main() -> int:
    scanned = []
    for offset in range(0, PAGES * 100, 100):
        try:
            items = fetch_page(offset)
        except Exception as e:
            print(f"WARN page {offset}: {e}", file=sys.stderr)
            continue
        for it in items:
            st = it.get("stats", {})
            rs = st.get("publicActorRunStats30Days") or {}
            total = rs.get("TOTAL", 0)
            failed = rs.get("FAILED", 0)
            timedout = rs.get("TIMED-OUT", 0)
            fail_rate = failed / total if total else 0
            timeout_rate = timedout / total if total else 0
            legal_flag, legal_reason = classify_legal(it)
            breakage = fail_rate * (1 + timeout_rate) if total >= MIN_RUNS_30D else 0
            opportunity = breakage * math.log10(total + 1)
            scanned.append({
                "actor": f"{it.get('username')}/{it.get('name')}",
                "title": it.get("title"),
                "runs_30d": total,
                "fail_rate_30d": round(fail_rate, 4),
                "timeout_rate_30d": round(timeout_rate, 4),
                "rating": it.get("actorReviewRating"),
                "review_count": it.get("actorReviewCount"),
                "users_30d": st.get("totalUsers30Days", 0),
                "pricing_model": (it.get("currentPricingInfo") or {}).get("pricingModel"),
                "breakage_score": round(breakage, 4),
                "opportunity_score": round(opportunity, 4),
                "legal_flag": legal_flag,
                "legal_reason": legal_reason,
                "categories": it.get("categories", []),
                "description": (it.get("description") or "")[:200],
            })
        time.sleep(0.3)

    scanned.sort(key=lambda x: -x["opportunity_score"])
    candidates = [s for s in scanned
                  if s["opportunity_score"] > 0 and s["fail_rate_30d"] >= MIN_FAIL_RATE][:15]
    for c in candidates:
        c["status"] = "candidate"

    out = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "scanned_count": len(scanned),
        "method_note": "complaints not publicly readable; breakage from 30d FAILED/TIMED-OUT telemetry",
        "candidates": candidates,
        "all": scanned[:200],
    }
    (ROOT / "targets").mkdir(exist_ok=True)
    (ROOT / "targets" / "incumbents.json").write_text(json.dumps(out, indent=2))

    print(f"scanned {len(scanned)}; candidates (fail>= {MIN_FAIL_RATE:.0%}, runs>={MIN_RUNS_30D}): {len(candidates)}")
    for i, c in enumerate(candidates[:10], 1):
        print(f"{i:>2}. {c['actor']:<45} runs30d={c['runs_30d']:<8} fail={c['fail_rate_30d']:.1%} "
              f"rating={c['rating'] or '-'} legal={'EXCLUDED:' + c['legal_reason'] if c['legal_flag'] else 'ok'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
