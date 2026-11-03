# Weekly factpipe report — 2026-11-03

## Money
- **29 live Actors · 4 with real users · 101 real users (30d) · 1,220 real runs (30d).**
- Since the 10-20 report (14 days, no report in between): real users 36 → 101 (+65), real runs 484 → 1,220 (+736). Almost all of it is one Actor.
- Actors with real users: **ats-jobs-feed** 98 users / 1,184 runs (+65, growing) · ats-jobs-scraper 1 / 11 (+1) · remote-jobs-feed 1 / 1 · us-weather-forecast 1 / 0.
- Revenue: not readable via API. Check https://console.apify.com/actors/insights (Monetization tab). Last known (10-22): Oct 1-22 $6.34 revenue, mostly Jobs Feed. Ats-jobs-feed goes $3 → $5/1k on 2026-11-06 (approved P2; apply registry `scheduled_price_change.todo_on_effective` that day).

## Health
- Fail rates (30d): uk-company-lookup 8%, fda-recalls-monitor 4%, ats-jobs-feed 3% (down from 8%). Every other Actor 0%.
- health.py: no flags, 29 Actors checked. scorecard.py flags uk-company-lookup (8%).
- Staging/auto-test: no Actor in staging. greenhouse/lever/ashby/workday-jobs-api are live, marked too_early (23-24 days). pricing.py: no changes pending.

## Decisions needed (one line each in DECISIONS.md)
The scorecard re-lists 21 "0 real users" proposals (new title/SEO copy, then -30% price test after 30 more days). Standing REJECTs from 10-14/10-21 already cover most; nothing is applied automatically.
1. Title/SEO test for sec-edgar-filings-search, eu-ted-tenders-monitor, uk-company-lookup, federal-register-monitor, fda-recalls-monitor, ofac-sanctions-screening (52d)? You REJECTED this twice; recommend keep REJECT.
2. company-jobs-scraper (51d, $2): already retitled 10-23 (C1). Wait 30 days before another test — agree?
3. wikipedia-scraper, open-food-facts-scraper, ecb-exchange-rates ($1/1k, 48-50d), sitemap-url-extractor ($0.3): title/SEO test? (rejected 10-21 for small website/data Actors; recommend keep REJECT)
4. email-security-checker, eu-vat-validation, dns-records-lookup, broken-link-checker, france-company-lookup, sam-gov-contracts (46-48d): title/SEO test? (recommend keep REJECT)
5. lighthouse-auditor ($10) and website-screenshot ($2): title/SEO test? (recommend keep REJECT)
6. companies-hiring ($5, 36d) and tech-stack-detector ($10, 33d), new proposals: title/SEO test? Companies-hiring is in the jobs cluster, so yes is plausible.
7. Retire any 0-user Actor? (rejected 10-21; recommend no for now)

## What we learned
(No LEARNINGS.md entries since 10-23; latest entries below.)
- Revenue tracks paying users, not free ones: Jobs Feed had 3 paying + 76 free users and made $6.24 of Oct 1-22's $6.34. Free users drive rank, so the $5 price move is the lever.
- Strict robots handling cost coverage: R1 now treats a missing robots.txt (404/410) as no restrictions per RFC 9309, reopening ~300 Teamtailor boards. All other cases stay "do not read".
- Workday's index lost ~23% of sites to build-budget pacing, and a 300-jobs-per-site cap truncated 501 sites. The cap is now 500 (est. +80k jobs). Check each build's build_report.json after pacing changes.

## Top build proposals (state/opportunities.json)
1. companies-house (score 1.54, 21.7k runs/30d, UK gov API with free key, ~8h). Officer/PSC data breaks the no-PII rule, so company-only scope and an APPROVE are needed.
2. open-food-facts (1.48, ~5h). Duplicates open-food-facts-scraper, which has 0 users.
3. wikipedia-data (1.32, ~4h). Duplicates wikipedia-scraper, which has 0 users.
Recommendation: build none; the jobs cluster is the only thing getting traction.
