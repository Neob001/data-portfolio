# factpipe weekly report — 2026-10-05

## Money
- **Live Actors: 25** (26 in registry) · **with real users: 4** · **real users 30d: 4** · **real runs 30d: 61**
- Week over week: sitemap-url-extractor +1 user (growing), companies-hiring -1; others flat.
- Actors with real users: us-weather-forecast (1 user, 15 runs), remote-jobs-feed (1, 9), ats-jobs-scraper (1, 3), sitemap-url-extractor (1, 0 runs).
- Revenue: not read this run (Console Insights is not in the public API). Last known: Sept = $0.97 ($0.80 profit). Current figure: https://console.apify.com/actors/insights (Monetization tab).

## Health
- health.py: no flags (25 checked). Pricing guard: no proposals.
- Failure rates (30d): broken-link-checker 12%, website-screenshot 10%, lighthouse-auditor 8%, ats-jobs-feed 6%. All others 0%.
- tech-stack-detector: listing icon differs from registry (icon never uploaded; Console was blank last attempt).
- ats-jobs-feed has the most runs (25) but 0 real users, so most are probably auto-tests.

## Decisions needed (answer in DECISIONS.md)
1. Retry the tech-stack-detector icon upload via Console next session? (yes/no)
2. Investigate the failures on broken-link-checker, website-screenshot and lighthouse-auditor (6-12%)? (yes/no)
3. Pricing/title proposals from the scorecard: none this week.

## What we learned
- Only paying-plan users produce revenue: Sept $0.97 came from weather (2 paying) and lighthouse (1 paying, thin margin from heavy compute).
- Store ranking is quality-score driven, so new Actors in crowded categories (jobs) stay invisible; the earners sit in small niches where we rank top-15.
- Timed-out runs count as failures in the quality score even when results were delivered; fix is deadline guards, and CI needs an opt-in (`ciInstall`) for Actors with npm deps.

## Top build proposals
1. companies-house (score 1.54, 8h, 49 users/30d demand)
2. open-food-facts (score 1.48, 5h, 9 users)
3. wikipedia-data (score 1.32, 4h, 21 users)
(Note: owner froze new small official-data Actors on 2026-09-18, so these need a fresh yes before any build.)
