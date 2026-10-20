# Weekly factpipe report — 2026-10-20

## Money
- **29 live Actors · 4 with real users · 36 real users (30d) · 484 real runs (30d).**
- Week over week (10-11 → 10-20): real users 12 → 36 (+24), real runs 184 → 484 (+300). Almost all of it is one Actor.
- Actors with real users: **ats-jobs-feed** 33 users / 465 runs (+24 wk, growing) · remote-jobs-feed 1 / 8 · sitemap-url-extractor 1 / 0 · us-weather-forecast 1 / 0.
- Revenue: not readable via API. Check https://console.apify.com/actors/insights (Monetization tab). Last known: Oct 1-9 was $0.0014, with most users on the free tier.

## Health
- Fail rates (30d): ats-jobs-feed 8%, lighthouse-auditor 6%, website-screenshot 6%. Every other Actor is at 0%.
- health.py: no flags, 29 Actors checked. scorecard.py flags the three above.
- Staging/auto-test: no Actor is in staging. The 3 newest Actors (greenhouse, lever, ashby) are live and marked too_early. Pricing check: no changes pending.

## Decisions needed (reply one line each in DECISIONS.md)
Scorecard proposal for every Actor with 0 real users after 30+ days: new title/SEO copy, then a -30% price test if still 0 after 30 more days. Nothing is applied automatically.
1. APPROVE title/SEO test for the 6 official-data Actors you REJECTED on 10-14 (sec-edgar-filings-search, eu-ted-tenders-monitor, uk-company-lookup, federal-register-monitor, fda-recalls-monitor, ofac-sanctions-screening)? The script re-listed them. Recommend keeping the REJECT.
2. company-jobs-scraper (38d, $2/1k): title/SEO test, in the jobs cluster?
3. wikipedia-scraper, open-food-facts-scraper, ecb-exchange-rates (35-36d, $1/1k): title/SEO test?
4. email-security-checker ($3), eu-vat-validation ($2), dns-records-lookup ($1.5), broken-link-checker ($1.5), france-company-lookup ($3), sam-gov-contracts ($2): title/SEO test?
5. lighthouse-auditor ($10) and website-screenshot ($2): title/SEO test? Both also have 6% failures.
6. Retire any of the above after 60 days with no users (proposal only)?

## What we learned
- Memory growth broke the jobs Actors: the Workday-sized index (731k jobs) and 2,000+ job requests OOM-killed runs at 256 MB to 1 GB with no log line, so minimum memory is now 2 GB. Re-measure peak memory whenever the data grows.
- Check parsers against real source text: enrichment spot checks caught "+$2.25/hr" parsed as salary, "C$" misread as CAD, and executive-title false positives. Compare parsed values with the source sentence on real rows.
- A robots check that doesn't get text/plain is not permission: Workday returned HTML for /robots.txt, so 76 disallowing sites were contacted once before the fix. Rule: an HTML answer means disallow.

## Top build proposals (state/opportunities.json)
1. companies-house (score 1.54, 21.7k runs/30d, UK gov API with a free key, ~8h). Includes officer/PSC data, which the no-PII rule forbids, so it needs an APPROVE and a company-only scope.
2. open-food-facts (1.48, 271 runs, ~5h). Duplicates the existing open-food-facts-scraper, which has 0 users.
3. wikipedia-data (1.32, 230 runs, ~4h). Duplicates the existing wikipedia-scraper, which has 0 users.
Recommendation: build none; the jobs cluster is the only thing getting traction.
