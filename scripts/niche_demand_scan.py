#!/usr/bin/env python3
"""Zero-token demand scan over a wide list of legally-safe niches.

For every candidate niche, query the public Store search and measure the
demand already flowing to the top incumbents (30-day users and runs), their
failure rates, ratings and effective per-result price. Rank by expected
time-to-first-paying-user:

    score = log10(users30 + 1) * weakness * legal / sqrt(build_hours)

Candidates are restricted to official/open APIs or user-supplied-URL
utilities (no PII, no login walls, no ID-verified sources, no platforms whose
ToS forbid automated access). Writes state/niche_demand.json.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "factpipe-niche-scan/1.0"}

# slug, store query, legal (0-1), build hours, source note
CANDIDATES = [
    # user-supplied-URL utilities (target chosen by the customer, public pages only)
    ("website-to-markdown", "website to markdown", 0.9, 4, "fetch public URL -> clean markdown for LLM/RAG"),
    ("broken-link-checker", "broken link checker", 0.95, 4, "crawl a site the customer names, report 4xx/5xx"),
    ("seo-audit", "seo audit", 0.9, 6, "on-page SEO checks of public pages"),
    ("meta-tags-extractor", "meta tags", 0.95, 3, "title/description/OG/Twitter tags"),
    ("structured-data-extractor", "schema.org structured data", 0.95, 4, "JSON-LD/microdata extraction"),
    ("rss-feed-reader", "rss feed", 0.95, 3, "parse RSS/Atom feeds"),
    ("website-change-monitor", "website change monitor", 0.9, 5, "diff public page content over time"),
    ("tech-stack-detector", "technology detector website", 0.9, 6, "detect CMS/frameworks from public HTML/headers"),
    ("pdf-text-extractor", "pdf text extraction", 0.95, 4, "extract text from public PDF URLs"),
    ("ssl-certificate-checker", "ssl certificate", 0.95, 3, "TLS cert expiry/issuer checks"),
    ("dns-records-lookup", "dns lookup", 0.95, 3, "DNS records via resolver"),
    ("http-redirect-checker", "redirect checker", 0.95, 2, "follow redirect chains, status codes"),
    ("robots-txt-checker", "robots.txt", 0.95, 2, "parse robots.txt rules"),
    ("website-screenshot", "website screenshot", 0.9, 5, "headless screenshot of public URL"),
    ("pagespeed-insights", "pagespeed lighthouse", 0.9, 4, "Google PageSpeed Insights official API"),
    ("email-domain-mx-check", "domain email mx", 0.8, 3, "MX/SPF/DMARC records for a domain (no personal data)"),
    # official / open data APIs
    ("vin-decoder", "vin decoder", 1.0, 3, "NHTSA vPIC official API"),
    ("vehicle-recalls", "vehicle recalls", 1.0, 3, "NHTSA recalls API"),
    ("eu-vat-validation", "vat number validation", 1.0, 3, "EU VIES official service"),
    ("lei-lookup", "lei legal entity identifier", 1.0, 3, "GLEIF API (CC0)"),
    ("sec-financial-statements", "financial statements", 1.0, 6, "SEC XBRL companyfacts API"),
    ("sec-insider-trading", "insider trading form 4", 1.0, 6, "SEC EDGAR Form 4 filings"),
    ("sec-13f-holdings", "13f institutional holdings", 1.0, 6, "SEC EDGAR 13F filings"),
    ("usaspending-contracts", "government contracts", 1.0, 5, "USAspending.gov official API"),
    ("sam-gov-opportunities", "sam.gov", 0.9, 5, "SAM.gov opportunities API (free key)"),
    ("grants-gov", "grants", 1.0, 5, "Grants.gov / NIH RePORTER"),
    ("clinical-trials", "clinical trials", 1.0, 5, "ClinicalTrials.gov API v2"),
    ("pubmed-articles", "pubmed", 1.0, 4, "NCBI E-utilities official API"),
    ("arxiv-papers", "arxiv", 1.0, 3, "arXiv API"),
    ("openalex-papers", "academic papers", 1.0, 4, "OpenAlex API (CC0)"),
    ("crossref-doi", "doi crossref", 1.0, 3, "Crossref REST API"),
    ("github-repos", "github", 0.8, 5, "GitHub REST API"),
    ("npm-packages", "npm packages", 0.95, 3, "npm registry API"),
    ("pypi-packages", "pypi", 0.95, 3, "PyPI JSON API"),
    ("hacker-news", "hacker news", 0.95, 3, "HN Algolia/Firebase API"),
    ("gdelt-news", "news monitoring", 0.9, 5, "GDELT DOC API (open)"),
    ("earthquakes", "earthquake", 1.0, 2, "USGS FDSN API"),
    ("air-quality", "air quality", 0.95, 3, "OpenAQ API"),
    ("world-bank-indicators", "world bank", 1.0, 3, "World Bank Indicators API"),
    ("fred-economic-data", "economic data", 0.95, 4, "FRED API (free key)"),
    ("exchange-rates-ecb", "exchange rates", 1.0, 2, "ECB reference rates"),
    ("public-holidays", "public holidays", 1.0, 2, "Nager.Date API"),
    ("open-library-books", "books isbn", 1.0, 3, "Open Library API"),
    ("fda-drug-labels", "drug database", 1.0, 4, "openFDA drug label/NDC API"),
    ("cpsc-product-recalls", "product recalls", 1.0, 3, "CPSC recalls API"),
    ("eu-sanctions-list", "eu sanctions", 1.0, 4, "EU consolidated financial sanctions file"),
    ("un-sanctions-list", "un sanctions", 1.0, 4, "UN Security Council consolidated list"),
    ("uk-sanctions-list", "uk sanctions", 1.0, 4, "UK OFSI consolidated list"),
    ("france-company-sirene", "sirene france company", 1.0, 5, "INSEE Sirene API"),
    ("gleif-company-hierarchy", "company ownership", 0.9, 5, "GLEIF relationship records"),
    ("podcast-index", "podcast", 0.9, 4, "Podcast Index API (free key)"),
    ("osm-points-of-interest", "openstreetmap", 0.7, 6, "Overpass API (usage policy limits)"),
    ("company-domain-info", "company website data", 0.8, 5, "public homepage metadata, no personal data"),
    ("app-privacy-policy", "privacy policy", 0.9, 4, "extract/monitor public policy pages"),
]


def store(q, limit=20):
    url = f"https://api.apify.com/v2/store?limit={limit}&search={urllib.parse.quote(q)}"
    for i in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.load(r)["data"]["items"]
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def ev_price(v):
    if "eventPriceUsd" in v:
        return v["eventPriceUsd"]
    t = v.get("eventTieredPricingUsd") or {}
    for tier in ("FREE", "BRONZE", "SILVER", "GOLD"):
        if tier in t:
            return t[tier].get("tieredEventPriceUsd")
    return None


def primary_price_per_1k(it):
    p = it.get("currentPricingInfo") or {}
    if p.get("pricingModel") != "PAY_PER_EVENT":
        return None
    evs = (p.get("pricingPerEvent") or {}).get("actorChargeEvents") or {}
    prim = [v for v in evs.values() if v.get("isPrimaryEvent")] or \
           [v for k, v in evs.items() if "start" not in k]
    pr = ev_price(prim[0]) if prim else None
    return round(pr * 1000, 2) if pr is not None else None


def main():
    results = []
    for slug, q, legal, hours, note in CANDIDATES:
        items = store(q)
        if items is None:
            print(f"WARN {slug}: store unreachable", file=sys.stderr)
            continue
        top = [i for i in items if i.get("username") != "factpipe"][:10]
        users30 = sum(i.get("stats", {}).get("totalUsers30Days", 0) for i in top)
        runs30 = sum((i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("TOTAL", 0) for i in top)
        fails = sum((i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("FAILED", 0) +
                    (i.get("stats", {}).get("publicActorRunStats30Days") or {}).get("TIMED-OUT", 0) for i in top)
        leader = max(top, key=lambda i: i.get("stats", {}).get("totalUsers30Days", 0)) if top else {}
        ratings = [i.get("actorReviewRating") for i in top if i.get("actorReviewRating")]
        fail_rate = fails / runs30 if runs30 else 0
        avg_rating = sum(ratings) / len(ratings) if ratings else 0
        weakness = 0.3 + (5 - avg_rating) / 5 * (1 if ratings else 0.6) + min(fail_rate * 4, 0.8) + (0.2 if len(ratings) < 3 else 0)
        score = math.log10(users30 + 1) * weakness * legal / math.sqrt(hours)
        prices = [p for p in (primary_price_per_1k(i) for i in top) if p]
        results.append({
            "slug": slug, "query": q, "source": note, "legal": legal, "build_hours": hours,
            "users30_top10": users30, "runs30_top10": runs30, "fail_rate": round(fail_rate, 3),
            "avg_rating": round(avg_rating, 2), "rated_count": len(ratings),
            "leader": f"{leader.get('username')}/{leader.get('name')}" if leader else None,
            "leader_users30": leader.get("stats", {}).get("totalUsers30Days", 0) if leader else 0,
            "median_price_per_1k": sorted(prices)[len(prices) // 2] if prices else None,
            "score": round(score, 3),
        })
        time.sleep(0.35)

    results.sort(key=lambda r: -r["score"])
    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "state" / "niche_demand.json").write_text(json.dumps(results, indent=2))
    print(f"{'#':<3}{'slug':<27}{'score':<7}{'u30':<7}{'runs30':<8}{'fail%':<7}{'rating':<7}{'$/1k':<7}{'h':<3}leader")
    for n, r in enumerate(results, 1):
        print(f"{n:<3}{r['slug']:<27}{r['score']:<7}{r['users30_top10']:<7}{r['runs30_top10']:<8}"
              f"{r['fail_rate']*100:<7.1f}{r['avg_rating']:<7}{str(r['median_price_per_1k']):<7}{r['build_hours']:<3}"
              f"{r['leader']} ({r['leader_users30']})")


if __name__ == "__main__":
    main()
