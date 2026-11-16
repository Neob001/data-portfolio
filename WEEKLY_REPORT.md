# factpipe weekly report — 2026-11-16

## Money
- **Live Actors 29 · with real users 4 · real users (30d) 160 (+59 vs 11-03: 101) · real runs (30d) 1,446 (+226: 1,220).** Live count unchanged.
- Actors with real users: **ats-jobs-feed 156 users / 1,405 runs (+58, 0% fail)**, ats-jobs-scraper 2 (+1), remote-jobs-feed 1, us-weather-forecast 1.
- Revenue: not readable via API. Check https://console.apify.com/actors/insights (Monetization tab). Last known: Oct final $17.12; Jobs Feed moved to $5/1k on 11-06, so watch paying users.

## Health
- **Apify API token (~/.apify_token) is rejected (HTTP 401).** health.py crashed; the scorecard and per-actor KPIs came from public endpoints only (news-monitor not fetchable). Failure rates, staging and auto-test status are NOT verified this week. Fix: issue a new token, save it to ~/.apify_token.
- Only flag from the scorecard: uk-company-lookup 8% of runs failed (30d). All other live Actors 0% (Jobs Feed 0%).
- 20+ Actors sit at 0 real users, 36-65 days live.

## Decisions needed (answer in DECISIONS.md, one line each)
1. Replace the Apify token (yes/no: will you issue one)? Weekly health and the 11-10 launch steps need it.
2. Run the overdue N1/N2 launch (jobs-bulk-feed $2/1k, expired-jobs-checker $0.10/1k; approved 11-03; cycle reset passed 11-10) plus `rebuild_actors.py ats-jobs-feed` so the Store README shows $5? Yes/no.
3. Apply P3 ($0.01 run fee on Jobs Feed) in an attended session on/after 11-23? Yes/no.
4. Scorecard proposals (title/SEO test, then -30% price test after 30 more days at 0 users), all 25: sec-edgar-filings-search, eu-ted-tenders-monitor, uk-company-lookup, federal-register-monitor, fda-recalls-monitor, ofac-sanctions-screening, company-jobs-scraper, sitemap-url-extractor, wikipedia-scraper, open-food-facts-scraper, ecb-exchange-rates, email-security-checker, eu-vat-validation, lighthouse-auditor, sam-gov-contracts, dns-records-lookup, france-company-lookup, broken-link-checker, website-screenshot, companies-hiring, tech-stack-detector, greenhouse-jobs-api, lever-jobs-api, ashby-jobs-api, workday-jobs-api. Approve any? (10-21: you rejected the six official-data and small website/data ones; company-jobs-scraper was retitled 10-23.) Name the ones to approve, else "none".

## What we learned
- P2 ($3 to $5/1k) took effect 11-06 and the Store listing is updated; the build was not rebuilt, so the README still shows the old price. Roll back only if paying users drop (2-week watch).
- Own-account budget guard works as designed (cycle reset 11-10), but the pending N1/N2 launch and rebuild are now overdue.
- Growth is Jobs Feed retention and direct/API use (Store search is not the channel); all sizeable legal job sources are exhausted, so growth means new products on the index and price.

## Top build proposals (state/opportunities.json)
1. companies-house (score 1.54; 21.7k runs/30d, 49 users; UK gov API, free key needed)
2. open-food-facts (1.48; 271 runs/30d)
3. wikipedia-data (1.32; 230 runs/30d)
