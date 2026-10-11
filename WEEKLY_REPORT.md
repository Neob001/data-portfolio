# factpipe weekly report — 2026-10-11

## Money
- **Live Actors: 29** (was 25) · **with real users: 4** (flat) · **real users 30d: 12** (was 4) · **real runs 30d: 184** (was 61)
- Actors with real users: ats-jobs-feed (9 users, +9 wk, 148 runs, growing), us-weather-forecast (1, 15 runs), remote-jobs-feed (1, 8), sitemap-url-extractor (1, 0 runs). ats-jobs-scraper dropped to 0 users (-1).
- Revenue: not readable via API. Last known: Sept $0.97; Oct 1-9 about $0.0014 (15 free users on Jobs Feed, 0 paying). Exact figure: https://console.apify.com/actors/insights (Monetization tab).

## Health
- health.py flag: ats-jobs-feed 22% failed (30d). Cause found 10-11 (OOM at 256/512 MB after the Workday index growth); fix `minMemoryMbytes: 1024` is in the repo. Watch next week.
- Other failure rates (30d): broken-link-checker 10%, website-screenshot 8%, lighthouse-auditor 7%. Rest 0%. Pricing guard: no changes.
- Staging: no Actors in staging; all 29 live. New this period: tech-stack-detector, greenhouse/lever/ashby/workday-jobs-api.

## Decisions needed (answer in DECISIONS.md)
1. sec-edgar-filings-search (30d, 0 users): test new title/SEO copy, then -30% price ($2.0/1k) if still 0 after 30 more days? (yes/no)
2. eu-ted-tenders-monitor (30d, 0 users): same title/SEO test, then -30% price ($3.0/1k)? (yes/no)
3. uk-company-lookup (30d, 0 users): same, then -30% ($2.5/1k)? (yes/no)
4. federal-register-monitor (30d, 0 users): same, then -30% ($2.5/1k)? (yes/no)
5. fda-recalls-monitor (30d, 0 users): same, then -30% ($3.0/1k)? (yes/no)
6. ofac-sanctions-screening (30d, 0 users): same, then -30% ($3.0/1k)? (yes/no)
7. Investigate the 7-10% failure rates on broken-link-checker, website-screenshot, lighthouse-auditor? (yes/no)

## What we learned
- ats-jobs-feed's failures were OOM kills: the Workday-doubled index (731k jobs) needs ~0.5-0.7 GB, so users who lower memory crashed; re-measure memory whenever data grows.
- Buyers pay for coverage, not low prices (leader charges $12/1k with 1,556 users); per-ATS demand is Workday 341, Ashby 301, Lever 257, Greenhouse 212 users, now all covered.
- Workday robots.txt returned HTML to a text/html request and read as "no rules"; fixed and 279 disallowing sites excluded. Rule: a non-text/plain robots answer is not permission.

## Top build proposals
1. companies-house (score 1.54, 8h, 49 users/30d demand)
2. open-food-facts (score 1.48, 5h, 9 users)
3. wikipedia-data (score 1.32, 4h, 21 users)
(Small official-data Actors were frozen 2026-09-18; a build needs a fresh yes.)
