#!/usr/bin/env python3
"""Module 2 (demand_capture): find public, fresh "where do I get this data"
questions. Zero token. Sources limited to officially-readable APIs:
- Stack Exchange API (anonymous quota, ToS-compliant)
- GitHub Search API (unauthenticated, low rate)
- Apify community forum (public Discourse JSON)
Reddit and X are SKIPPED: their official APIs require credentials we do not
have, and scraping them against ToS is out (addendum 3.2 rule).

Writes/merges targets/demand_signals.json. Never posts anything.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "factpipe-demand-monitor/1.0"}

TRIGGERS = re.compile(
    r"(is there an api for|where can i (get|find) data|how (do|can) i scrape|dataset of|"
    r"need a list of|looking for data|any tool that extracts|scraper for|export all|"
    r"bulk download|monitor prices on|track changes on|api to get|get all (the )?jobs|"
    r"sanctions list|sec filings|company data api|sitemap.*(extract|all urls)|"
    r"how to (get|fetch|download|retrieve)|api for|download all|fetch all|get data from|"
    r"programmatically (get|access|download))", re.I)

PII = re.compile(r"(email(s)? of|phone number|personal|profile[s]? of|find people|contact info)", re.I)

# keyword -> our actor slug
HAVE_MAP = [
    (re.compile(r"sec |edgar|10-k|8-k|13f|sec filing", re.I), "sec-edgar-filings-search"),
    (re.compile(r"\bted\b|eu tender|procurement notice", re.I), "eu-ted-tenders-monitor"),
    (re.compile(r"companies house|uk compan(y|ies) (data|api|number)", re.I), "uk-company-lookup"),
    (re.compile(r"federal register", re.I), "federal-register-monitor"),
    (re.compile(r"fda|recall(s)? data", re.I), "fda-recalls-monitor"),
    (re.compile(r"ofac|sanction|sdn list", re.I), "ofac-sanctions-screening"),
    (re.compile(r"weather (api|data|forecast)", re.I), "us-weather-forecast"),
    (re.compile(r"greenhouse|lever\.co|ashby|careers? page|job posting|job listing", re.I), "company-jobs-scraper"),
    (re.compile(r"sitemap", re.I), "sitemap-url-extractor"),
]


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


SE_QUERIES = ["sec filings api", "sanctions list api", "job postings api", "sitemap urls",
              "company data api", "fda recalls data", "weather forecast api", "tender data api",
              "scrape data"]


def stackexchange():
    hits = []
    for query in SE_QUERIES:
        q = urllib.parse.quote(query)
        url = (f"https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation"
               f"&q={q}&site=stackoverflow&pagesize=10&filter=default")
        try:
            for it in fetch(url).get("items", []):
                hits.append({
                    "platform": "stackoverflow",
                    "url": it.get("link"),
                    "title": it.get("title", ""),
                    "body": query,  # keep the matched vertical for classification
                    "created_at": datetime.fromtimestamp(it.get("creation_date", 0), tz=timezone.utc).isoformat(),
                    "engagement": it.get("score", 0) + it.get("answer_count", 0),
                    "answered": it.get("is_answered", False),
                })
            time.sleep(0.5)
        except Exception as e:
            print(f"WARN stackexchange '{query}': {e}", file=sys.stderr)
    return hits


def github():
    hits = []
    for q in ('"is there an api" data in:title,body type:issue state:open',
              '"where can i get" data api in:title type:issue state:open'):
        url = f"https://api.github.com/search/issues?q={urllib.parse.quote(q)}&sort=created&order=desc&per_page=15"
        try:
            for it in fetch(url).get("items", []):
                hits.append({
                    "platform": "github",
                    "url": it.get("html_url"),
                    "title": it.get("title", ""),
                    "body": (it.get("body") or "")[:400],
                    "created_at": it.get("created_at"),
                    "engagement": it.get("comments", 0) + (it.get("reactions", {}) or {}).get("total_count", 0),
                    "answered": False,
                })
            time.sleep(7)  # unauthenticated search: 10 req/min
        except Exception as e:
            print(f"WARN github: {e}", file=sys.stderr)
    return hits


def apify_forum():
    hits = []
    for q in ("data api", "scraper for"):
        url = f"https://forum.apify.com/search.json?q={urllib.parse.quote(q)}"
        try:
            req = urllib.request.Request(url, headers={**UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.load(r)
            topics = {t["id"]: t for t in d.get("topics", [])}
            for p in d.get("posts", [])[:15]:
                t = topics.get(p.get("topic_id"), {})
                hits.append({
                    "platform": "apify-forum",
                    "url": f"https://forum.apify.com/t/{p.get('topic_id')}",
                    "title": t.get("title", ""),
                    "body": (p.get("blurb") or "")[:400],
                    "created_at": p.get("created_at"),
                    "engagement": t.get("reply_count", 0) or 0,
                    "answered": bool(t.get("has_accepted_answer")),
                })
            time.sleep(1)
        except Exception as e:
            print(f"WARN apify forum: {e}", file=sys.stderr)
    return hits


def classify(hit):
    text = f"{hit['title']} {hit['body']}"
    if PII.search(text):
        return "skip", None
    if not TRIGGERS.search(text):
        return "skip", None
    for rx, slug in HAVE_MAP:
        if rx.search(text):
            return "have", slug
    return "buildable", None


def freshness_hours(iso):
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600)
    except Exception:
        return 9999


def main() -> None:
    path = ROOT / "targets" / "demand_signals.json"
    existing = json.loads(path.read_text()) if path.exists() else {"signals": []}
    seen = {s["url"] for s in existing["signals"]}

    new = 0
    for hit in stackexchange() + github() + apify_forum():
        if not hit["url"] or hit["url"] in seen:
            continue
        fh = freshness_hours(hit["created_at"])
        if fh < 1 or fh > 14 * 24:
            continue
        match_type, slug = classify(hit)
        if match_type == "skip":
            continue
        commercial = 2 if re.search(r"(business|client|company|willing to pay|budget|production)",
                                    f"{hit['title']} {hit['body']}", re.I) else 1
        score = round(commercial * (hit["engagement"] + 1) / (1 + fh / 24), 3)
        existing["signals"].append({
            **hit, "match_type": match_type, "matched_actor": slug,
            "capture_score": score, "status": "new",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        })
        seen.add(hit["url"])
        new += 1

    path.write_text(json.dumps(existing, indent=2))
    fresh = [s for s in existing["signals"] if s["status"] == "new"]
    fresh.sort(key=lambda s: -s["capture_score"])
    print(f"new hits: {new}; open signals: {len(fresh)}")
    for s in fresh[:10]:
        print(f"- [{s['match_type']}{':' + s['matched_actor'] if s['matched_actor'] else ''}] "
              f"score={s['capture_score']} {s['platform']} | {s['title'][:80]} | {s['url']}")


if __name__ == "__main__":
    main()
