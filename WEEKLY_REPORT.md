# factpipe weekly report — 2026-11-23

## Money
- **Live Actors 32 · with real users 3 (was 4) · real users (30d) 168 (+8 vs 11-16: 160) · real runs (30d) 1,512 (+66).** New 11-20: companies-by-technology ($15/1k, 0 users yet).
- Actors with real users: **ats-jobs-feed 164 users / 1,460 runs (+8, 2% fail)**, ats-jobs-scraper 3 (+1), remote-jobs-feed 1. us-weather-forecast dropped to 0.
- Revenue: not readable by API/this run. Check https://console.apify.com/actors/insights (Monetization tab). Last known: Nov 1-16 $74.15 (Oct $17.12).

## Health
- health.py: 32 Actors checked, 0 flags. Scorecard flags: uk-company-lookup 8%, remote-jobs-feed 11%, companies-hiring 11% runs failed (30d); companies-by-technology listing icon differs from registry.
- Jobs index: Workday read on the Mac (4,645 boards, Sun-Fri 17:00 JST, shrink guard merged 11-21). Staging/auto-test: no new flags this run.
- Ops note: GitHub clone was very slow this run (shallow clone worked).

## Decisions needed (answer yes/no in DECISIONS.md)
1. P4 Jobs Feed price change ($7/1k + $0.01 run fee, approved text) is due today (after 05:09 UTC). Enter it now? yes/no
2. Scorecard proposals (new title/SEO copy; if still 0 users after 30 more days, -30% price test) for the 0-user Actors, listed in state/scorecard.json `proposals` (26): sec-edgar-filings-search, eu-ted-tenders-monitor, uk-company-lookup, federal-register-monitor, fda-recalls-monitor, ofac-sanctions-screening, us-weather-forecast, company-jobs-scraper, sitemap-url-extractor, wikipedia-scraper, open-food-facts-scraper, ecb-exchange-rates, email-security-checker, eu-vat-validation, lighthouse-auditor, sam-gov-contracts, dns-records-lookup, france-company-lookup, broken-link-checker, website-screenshot, companies-hiring, tech-stack-detector, greenhouse-jobs-api, lever-jobs-api, ashby-jobs-api, workday-jobs-api. Approve all / name which / none?
3. pricing.py KILL_REVIEW list (near-zero paid runs, e.g. ecb-exchange-rates, email-security-checker, eu-vat-validation, lighthouse-auditor, sam-gov-contracts, dns-records-lookup, france-company-lookup, website-screenshot; full list state/pricing_proposals.json): unpublish any? Default keep (idle cost $0).

## What we learned
- Cloud IPs (GitHub runners, Apify) get Workday robots.txt 429s; reading from the owner's Mac recovered 512k jobs, and Saturday maintenance needed a shrink guard.
- Technographics: repeated company boilerplate (e.g. customer-logo paragraphs) inflates matches; the fix drops paragraphs repeated across a board's jobs. Listing live 11-20.
- Tenders index is live with TED + SAM.gov + UK + OCP sources (463k notices first build) under new robots rule R1a.

## Top build proposals (state/opportunities.json)
1. companies-house (score 1.54, 49 users/30d demand)
2. open-food-facts (1.48, 9 users)
3. wikipedia-data (1.32, 21 users)
