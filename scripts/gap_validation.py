#!/usr/bin/env python3
"""Action 0 gap validation. Zero token, public Store API only.

For each candidate SKU: collect the competing Actors (relevance-filtered across several
buyer queries), their 30-day users/runs, failure rates, ratings, review counts, last
build / last modified dates and PPE price points, then score:

  demand    = log10(users30 + 1) + 0.5 * log10(runs30 + 1)
  weakness  = rating gap + failure rate + stale share of demand + unrated share
  incumbent = penalty when one actively maintained (<45d), well rated (>=4.5, >=3 reviews)
              Actor holds most of the demand
  score     = demand * weakness * access / sqrt(effort_days) - incumbent

Also ranks our own live Actors for their primary keywords and lists who beats us.
Writes state/gap_validation.json and state/gap_validation.md.
"""
import json
import math
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "factpipe-gap-validation/1.0"}
NOW = datetime.now(timezone.utc)
STALE_DAYS = 90
ACTIVE_DAYS = 45

# id, label, queries, relevance terms (any must appear in title/name/description), effort days,
# access factor (1 = keyless official; <1 = registration/terms friction), access note
CANDIDATES = [
    ("uk-vat", "UK VAT validation (HMRC)", ["uk vat", "hmrc vat", "vat number validation"],
     ["hmrc", "uk vat", "gb vat", "vat number", "vat valid", "vat check", "vat lookup", "vat verif", "vies"], 2, 0.9,
     "HMRC 'Check a UK VAT number' API: free developer-hub app, no ID check"),
    ("global-sanctions", "Global sanctions screening (OFAC+EU+UK+UN)", ["sanctions screening", "sanctions list", "ofac", "pep sanctions"],
     ["sanction", "ofac", "sdn", "ofsi", "watchlist", "aml screen"], 3, 1.0,
     "EU FSF, UK OFSI and UN XML lists are public downloads, no key"),
    ("eu-safety-gate", "EU Safety Gate (RAPEX) product alerts", ["safety gate", "rapex", "product recalls eu", "dangerous products"],
     ["safety gate", "rapex", "eu recall", "eu product recall"], 2, 0.9,
     "Safety Gate public portal and export; confirm reuse terms before build"),
    ("cpsc-recalls", "US CPSC consumer product recalls", ["cpsc recalls", "product recalls", "consumer product safety"],
     ["cpsc", "product recall", "consumer product"], 2, 1.0, "CPSC Recalls REST API, keyless, public domain"),
    ("sec-form4", "SEC Form 4 insider trading feed", ["insider trading", "form 4", "sec insider"],
     ["insider", "form 4", "form4"], 3, 1.0, "SEC EDGAR APIs, keyless (User-Agent)"),
    ("grants-gov", "Grants.gov federal grants", ["grants.gov", "federal grants", "grant opportunities"],
     ["grant"], 2, 1.0, "Grants.gov Search2 REST API and XML extract, keyless"),
    ("france-sirene", "France Sirene company registry", ["sirene", "french company", "siret", "france company data"],
     ["sirene", "siret", "siren", "insee", "pappers", "french compan", "france compan", "entreprises"], 4, 0.85,
     "INSEE Sirene API: free portal account + key (no ID check); annuaire-entreprises API keyless"),
    ("trademarks", "USPTO / EUIPO trademark search", ["trademark search", "uspto", "euipo", "trademark"],
     ["trademark", "uspto", "euipo", "wipo"], 5, 0.3,
     "BLOCKED for USPTO (ID.me standing REJECT 2026-09-12); EUIPO API needs OAuth app registration"),
    ("gleif-lei", "GLEIF LEI company lookup (pending N6)", ["lei lookup", "legal entity identifier", "gleif"],
     ["lei", "legal entity identifier", "gleif"], 2, 1.0, "GLEIF API, keyless, CC0"),
    ("broken-links", "Broken link checker (pending N7)", ["broken link checker", "broken links", "dead link"],
     ["broken link", "dead link", "404", "link checker", "url status"], 3, 1.0, "User-supplied public URLs"),
    ("dns-lookup", "DNS records lookup (pending N8)", ["dns lookup", "dns records", "domain dns"],
     ["dns"], 1, 1.0, "Public DNS resolvers"),
]

# Our live Actors and the buyer queries we should rank for
OWN = {
    "ofac-sanctions-screening": ["sanctions screening", "ofac"],
    "eu-vat-validation": ["vat validation", "vies"],
    "uk-company-lookup": ["companies house", "uk company lookup"],
    "sec-edgar-filings-search": ["sec edgar", "sec filings"],
    "sam-gov-contracts": ["sam.gov", "government contracts"],
    "eu-ted-tenders-monitor": ["public tenders", "eu tenders"],
    "fda-recalls-monitor": ["fda recalls", "fda"],
    "federal-register-monitor": ["federal register", "regulations monitor"],
    "lighthouse-auditor": ["lighthouse", "core web vitals"],
    "sitemap-url-extractor": ["sitemap", "broken links"],
    "email-security-checker": ["dmarc", "spf dkim"],
    "company-jobs-scraper": ["greenhouse jobs", "career page"],
    "ecb-exchange-rates": ["exchange rates", "ecb"],
    "wikipedia-scraper": ["wikipedia"],
    "open-food-facts-scraper": ["open food facts"],
    "us-weather-forecast": ["weather forecast"],
}


def http_json(url, attempts=5):
    for i in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def store(query, limit=40):
    url = f"https://api.apify.com/v2/store?limit={limit}&search={urllib.parse.quote(query)}"
    for _ in range(3):
        d = http_json(url)
        if d and d.get("data", {}).get("items"):
            return d["data"]["total"], d["data"]["items"]
        time.sleep(2)  # empty pages are usually transient
    return (d or {}).get("data", {}).get("total", 0), []


_detail_cache = {}


def detail(username, name):
    key = f"{username}~{name}"
    if key not in _detail_cache:
        d = http_json(f"https://api.apify.com/v2/acts/{urllib.parse.quote(key)}", attempts=3)
        _detail_cache[key] = (d or {}).get("data") or {}
    return _detail_cache[key]


def days_since(iso):
    if not iso:
        return None
    try:
        return (NOW - datetime.fromisoformat(iso.replace("Z", "+00:00"))).days
    except ValueError:
        return None


def ppe_price_per_1k(item):
    p = item.get("currentPricingInfo") or {}
    model = p.get("pricingModel") or "FREE"
    if model != "PAY_PER_EVENT":
        return model, None
    evs = (p.get("pricingPerEvent") or {}).get("actorChargeEvents") or {}
    prim = [v for v in evs.values() if v.get("isPrimaryEvent")] or [v for k, v in evs.items() if "start" not in k]
    if not prim:
        return model, None
    v = prim[0]
    price = v.get("eventPriceUsd")
    if price is None:
        tiers = v.get("eventTieredPricingUsd") or {}
        price = next((tiers[t]["tieredEventPriceUsd"] for t in ("FREE", "BRONZE") if t in tiers), None)
    return model, (round(price * 1000, 2) if price is not None else None)


def run_stats(item):
    s = item.get("stats") or {}
    r = s.get("publicActorRunStats30Days") or {}
    total = r.get("TOTAL", 0)
    failed = r.get("FAILED", 0) + r.get("TIMED-OUT", 0)
    return s.get("totalUsers30Days", 0), total, failed


def relevant(item, terms):
    # Title/name only: descriptions of broad lead-gen and OSINT tools mention every keyword.
    hay = " ".join([item.get("title") or "", (item.get("name") or "").replace("-", " ")]).lower()
    return any(re.search(r"\b" + re.escape(t), hay) for t in terms)


def scan_candidate(cid, label, queries, terms, effort, access, note):
    seen, totals = {}, []
    for q in queries:
        total, items = store(q)
        totals.append(total)
        for it in items:
            key = f"{it['username']}/{it['name']}"
            if it.get("username") != "factpipe" and key not in seen and relevant(it, terms):
                seen[key] = it
        time.sleep(0.3)
    comps = []
    for key, it in seen.items():
        users30, runs30, failed = run_stats(it)
        # Store auto-tests every public Actor once a day on its default input: that is 1 "user" and ~30 runs
        # a month with zero customers, so demand uses organic numbers.
        comps.append({"actor": key, "title": it.get("title"), "users30": max(users30 - 1, 1 if runs30 > 40 else 0), "runs30": max(runs30 - 30, 0),
                      "raw_users30": users30, "raw_runs30": runs30,
                      "fail_rate": round(failed / runs30, 3) if runs30 else 0.0,
                      "rating": round(it.get("actorReviewRating") or 0, 2) or None,
                      "reviews": it.get("actorReviewCount") or 0,
                      "pricing": ppe_price_per_1k(it)})
    comps.sort(key=lambda c: -c["users30"])
    # Maintenance dates only for Actors that hold demand (keeps API calls bounded).
    for c in comps[:10]:
        u, n = c["actor"].split("/", 1)
        d = detail(u, n)
        build = ((d.get("taggedBuilds") or {}).get("latest") or {}).get("finishedAt")
        c["last_build_days"] = days_since(build)
        c["modified_days"] = days_since(d.get("modifiedAt"))
        time.sleep(0.2)

    users = sum(c["users30"] for c in comps)
    runs = sum(c["runs30"] for c in comps)
    top = comps[:10]
    rated = [c for c in top if c["rating"] and c["reviews"] >= 1]
    demand_weight = sum(c["users30"] for c in top) or 1

    def age(c):
        vals = [v for v in (c.get("last_build_days"), c.get("modified_days")) if v is not None]
        return min(vals) if vals else None

    stale_share = sum(c["users30"] for c in top if (age(c) or 0) > STALE_DAYS) / demand_weight
    unrated_share = sum(c["users30"] for c in top if not c["rating"]) / demand_weight
    wavg_rating = (sum(c["rating"] * c["users30"] for c in rated) / max(1, sum(c["users30"] for c in rated))) if rated else None
    fail = (sum(c["runs30"] * c["fail_rate"] for c in top) / max(1, sum(c["runs30"] for c in top)))
    weakness = 0.2 + (((5 - wavg_rating) / 5) if wavg_rating else 0.35) + min(fail * 3, 0.9) \
        + 0.6 * stale_share + 0.3 * unrated_share
    demand = math.log10(users + 1) + 0.5 * math.log10(runs + 1)

    leader = top[0] if top else None
    strong_incumbent = bool(
        leader and leader["users30"] >= 0.5 * demand_weight and (leader["rating"] or 0) >= 4.5
        and leader["reviews"] >= 3 and (age(leader) is not None and age(leader) <= ACTIVE_DAYS)
        and leader["fail_rate"] < 0.05
    )
    score = demand * weakness * access / math.sqrt(effort) - (1.0 if strong_incumbent else 0)
    prices = sorted(p for c in top for m, p in [c["pricing"]] if p)
    if access < 0.5:
        rec = "SKIP (access blocked)"
    elif strong_incumbent:
        rec = "SKIP (strong maintained incumbent)"
    elif users < 15:
        rec = "LOW DEMAND (build only as cheap suite add-on)"
    elif score >= 2.5:
        rec = "BUILD"
    else:
        rec = "MAYBE"
    return {
        "id": cid, "label": label, "queries": queries, "store_results_max": max(totals) if totals else 0,
        "competitors_relevant": len(comps), "users30": users, "runs30": runs, "weighted_fail_rate": round(fail, 3),
        "weighted_rating": round(wavg_rating, 2) if wavg_rating else None, "rated_top10": len(rated), "reviews_top10": sum(c["reviews"] for c in top),
        "stale_demand_share": round(stale_share, 2), "unrated_demand_share": round(unrated_share, 2),
        "organic_actors": sum(1 for c in comps if c["users30"] > 0), "median_ppe_per_1k": prices[len(prices) // 2] if prices else None, "price_range_per_1k": [prices[0], prices[-1]] if prices else None,
        "strong_incumbent": strong_incumbent, "effort_days": effort, "access": access, "access_note": note,
        "score": round(score, 2), "recommendation": rec, "top_competitors": top[:5],
    }


def own_ranks(registry):
    out = {}
    for slug, queries in OWN.items():
        rows = []
        for q in queries:
            total, items = store(q, limit=50)
            idx = next((i for i, it in enumerate(items) if it.get("username") == "factpipe" and it.get("name") == slug), None)
            ahead = items[: idx if idx is not None else 5][:5]
            rows.append({"query": q, "total_results": total, "rank": idx + 1 if idx is not None else None,
                         "beating_us": [{"actor": f"{a['username']}/{a['name']}", "users30": run_stats(a)[0],
                                         "rating": round(a.get("actorReviewRating") or 0, 2) or None,
                                         "price_per_1k": ppe_price_per_1k(a)[1]} for a in ahead if a.get("username") != "factpipe"][:3]})
            time.sleep(0.3)
        out[slug] = rows
    return out


def fmt_md(cands, ranks):
    lines = ["# Gap validation — " + NOW.strftime("%Y-%m-%d"), "",
             "## Candidates (ranked)", "", "Users and runs exclude Apify's daily auto-test (1 user, ~30 runs per Actor).", "",
             "| # | Candidate | Rec | Score | Real users/30d | Real runs/30d | Competitors (with real users) | Wtd rating | Fail % | Stale demand | Median $/1k | Effort | Access |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for n, c in enumerate(cands, 1):
        lines.append(f"| {n} | {c['label']} | {c['recommendation']} | {c['score']} | {c['users30']} | {c['runs30']} | "
                     f"{c['competitors_relevant']} ({c['organic_actors']}) | {c['weighted_rating'] or 'unrated'} | {c['weighted_fail_rate']*100:.1f} | "
                     f"{int(c['stale_demand_share']*100)}% | {c['median_ppe_per_1k'] or '-'} | {c['effort_days']}d | {c['access']} |")
    lines += ["", "## Where our Actors rank", "", "| Actor | Query | Rank | Results | Who beats us (users/30d, rating, $/1k) |", "|---|---|---|---|---|"]
    for slug, rows in ranks.items():
        for r in rows:
            who = "; ".join(f"{b['actor']} ({b['users30']}, {b['rating'] or '-'}, {b['price_per_1k'] or '-'})" for b in r["beating_us"])
            lines.append(f"| {slug} | {r['query']} | {r['rank'] or '>50'} | {r['total_results']} | {who} |")
    return "\n".join(lines) + "\n"


def main():
    registry = json.loads((ROOT / "registry.json").read_text())
    cands = []
    for c in CANDIDATES:
        res = scan_candidate(*c)
        cands.append(res)
        print(f"scanned {res['id']:<18} users30={res['users30']:<5} score={res['score']:<6} {res['recommendation']}", flush=True)
    cands.sort(key=lambda c: -c["score"])
    prev = ROOT / "state" / "gap_validation.json"
    if "--no-own" in sys.argv and prev.exists():
        ranks = json.loads(prev.read_text()).get("own_ranks", {})
    else:
        ranks = own_ranks(registry)
    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "state" / "gap_validation.json").write_text(json.dumps({"generated_at": NOW.isoformat(), "candidates": cands, "own_ranks": ranks}, indent=2))
    (ROOT / "state" / "gap_validation.md").write_text(fmt_md(cands, ranks))
    print("wrote state/gap_validation.json and state/gap_validation.md")


if __name__ == "__main__":
    main()
