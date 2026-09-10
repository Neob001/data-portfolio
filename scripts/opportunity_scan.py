#!/usr/bin/env python3
"""Zero-token opportunity scan of the Apify Store.

Queries the public Store API for a curated list of legally-safe data-source
keywords, aggregates incumbent stats, and scores each candidate:

    score = demand * incumbent_weakness * legal_safety / build_cost

Outputs state/opportunities.json (full data) and prints a ranked table.
No API token and no model required.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

STORE_URL = "https://api.apify.com/v2/store?limit={limit}&search={q}"
UA = "data-portfolio-opportunity-scan/1.0"

# Curated candidates. legal: 1.0 = official/public API or gov registry,
# 0.6 = public web, ToS-permissive, 0.0 = excluded (never scanned).
# build_cost: rough hours for a deterministic v1.
CANDIDATES = [
    # slug, store search query, legal, build_cost, source note
    ("sec-edgar", "sec edgar filings", 1.0, 6, "Official SEC APIs (data.sec.gov, efts.sec.gov)"),
    ("clinical-trials", "clinical trials", 1.0, 6, "Official ClinicalTrials.gov API v2"),
    ("fda-recalls", "fda recall", 1.0, 5, "Official openFDA enforcement API"),
    ("companies-house", "companies house", 1.0, 8, "UK gov API (needs free API key)"),
    ("uspto-trademarks", "trademark search", 1.0, 10, "USPTO open data APIs"),
    ("eu-tenders", "tenders procurement", 1.0, 10, "EU TED open data"),
    ("federal-register", "federal register", 1.0, 5, "Official federalregister.gov API"),
    ("sanctions-lists", "sanctions screening", 1.0, 8, "OFAC/EU/UN published lists"),
    ("nih-grants", "nih grants", 1.0, 6, "NIH RePORTER API"),
    ("hacker-news", "hacker news", 0.9, 4, "Official Firebase/Algolia HN API"),
    ("github-repos", "github repository data", 0.7, 6, "GitHub REST API (rate limits)"),
    ("product-hunt", "product hunt", 0.6, 8, "Public pages; official API is OAuth"),
    ("google-trends", "google trends", 0.4, 10, "Unofficial endpoints; brittle"),
    ("weather-data", "weather forecast", 0.9, 4, "NWS / open-meteo APIs"),
    ("crypto-listings", "crypto token listings", 0.5, 6, "Mixed ToS; exchange APIs vary"),
    ("job-postings-ats", "greenhouse lever jobs", 0.8, 6, "Public ATS JSON endpoints"),
    ("court-opinions", "court opinions", 0.8, 8, "CourtListener API (PII care needed)"),
    ("wikipedia-data", "wikipedia", 1.0, 4, "Official MediaWiki APIs"),
    ("open-food-facts", "food nutrition data", 1.0, 5, "Open Food Facts API (ODbL)"),
    ("flight-status", "flight status", 0.5, 8, "Mostly paywalled/licensed sources"),
]


def fetch(query: str, limit: int = 10) -> list:
    url = STORE_URL.format(limit=limit, q=urllib.parse.quote(query))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["data"]["items"]


def incumbent_metrics(items: list) -> dict:
    """Aggregate the top store results for one query into demand/weakness."""
    if not items:
        return {"demand": 0, "weakness": 1.0, "incumbents": []}
    top = items[:8]
    runs30 = sum(
        (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("TOTAL", 0)
        for i in top
    )
    users30 = sum(i.get("stats", {}).get("totalUsers30Days", 0) for i in top)
    fails30 = sum(
        (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("FAILED", 0)
        + (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("TIMED-OUT", 0)
        for i in top
    )
    ratings = [i.get("actorReviewRating") for i in top if i.get("actorReviewRating")]
    avg_rating = sum(ratings) / len(ratings) if ratings else 0
    fail_rate = fails30 / runs30 if runs30 else 0

    # weakness in [0.2, 2.0]: low ratings, high failure rates and few rated
    # incumbents all mean an easier wedge.
    weakness = 0.2
    weakness += (5 - avg_rating) / 5 if avg_rating else 0.6  # unrated market
    weakness += min(fail_rate * 4, 0.8)
    weakness += 0.2 if len(ratings) < 3 else 0

    incumbents = [
        {
            "actor": f"{i.get('username')}/{i.get('name')}",
            "title": i.get("title"),
            "rating": i.get("actorReviewRating"),
            "reviews": i.get("actorReviewCount"),
            "users30d": i.get("stats", {}).get("totalUsers30Days", 0),
            "runs30d": (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("TOTAL", 0),
            "failed30d": (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("FAILED", 0),
            "pricingModel": (i.get("currentPricingInfo") or {}).get("pricingModel"),
        }
        for i in top
    ]
    return {
        "demand_runs30d": runs30,
        "demand_users30d": users30,
        "avg_rating": round(avg_rating, 2),
        "fail_rate_30d": round(fail_rate, 4),
        "weakness": round(weakness, 3),
        "incumbents": incumbents,
    }


def main() -> None:
    out = []
    for slug, query, legal, build_cost, note in CANDIDATES:
        if legal <= 0:
            continue
        try:
            items = fetch(query)
        except Exception as e:  # network hiccup: record and continue
            print(f"WARN {slug}: {e}", file=sys.stderr)
            items = []
        m = incumbent_metrics(items)
        demand = m.get("demand_runs30d", 0) + 10 * m.get("demand_users30d", 0)
        score = (math.log10(demand + 1)) * m["weakness"] * legal / math.sqrt(build_cost)
        out.append(
            {
                "slug": slug,
                "query": query,
                "source": note,
                "legal_safety": legal,
                "build_cost_h": build_cost,
                "score": round(score, 3),
                **m,
            }
        )
        time.sleep(0.4)

    out.sort(key=lambda x: -x["score"])
    state = Path(__file__).resolve().parent.parent / "state"
    state.mkdir(exist_ok=True)
    (state / "opportunities.json").write_text(json.dumps(out, indent=2))

    print(f"{'rank':<5}{'slug':<20}{'score':<8}{'runs30d':<10}{'users30d':<10}"
          f"{'avgRating':<10}{'fail%':<7}{'legal':<6}{'est.h'}")
    for n, o in enumerate(out, 1):
        print(f"{n:<5}{o['slug']:<20}{o['score']:<8}{o.get('demand_runs30d', 0):<10}"
              f"{o.get('demand_users30d', 0):<10}{o.get('avg_rating', 0):<10}"
              f"{round(o.get('fail_rate_30d', 0) * 100, 1):<7}{o['legal_safety']:<6}{o['build_cost_h']}")


if __name__ == "__main__":
    main()
