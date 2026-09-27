# Weekly report — 2026-09-27

## Money
- **Revenue: $0.68 in September ($0.64 profit)**, all from `us-weather-forecast` (2 paying users). This is today's Console Insights reading, logged in LEARNINGS.md. This run didn't open the Console, so check the exact figure at https://console.apify.com/actors/insights (Monetization tab). The final number comes on the payout invoice.
- **24 live Actors · 1 with a real user (us-weather-forecast: 1 real user, 16 runs in 30 days).** Correction: an earlier version of this report counted the three jobs Actors published 2026-09-27 as having real users; those were our own test runs, so the scorecard now holds Actors under 3 days old at "too early".
- Store-side changes made 2026-09-27 (owner-approved): custom icons on all 24 Actors, 34 published example tasks (Store landing pages), Store plan discounts on 23 Actors (Starter −10%, Scale −20%, Business −30%, Free unchanged), and a new README first screen (value line, real sample table, example links).

## Health
- `health.py`: **0 flags** across 24 Actors. Scorecard flag: **`broken-link-checker` 20% of 30d runs failed** (older failures from the 09-18 maintenance incident; its PPE switch takes effect 2026-10-02).
- Staging: all 11 cloud runs of the jobs Actors passed 2026-09-27. `news-monitor` is still shelved and unpublished because GDELT rate-limits requests.
- `pricing.py` crashes on system Python 3.9 (it can't parse the `Z` timestamp suffix). It ran clean on python3.12 with 0 price proposals.

## Decisions needed
_None open._ The scorecard has 0 proposals, and SD1 (Store discounts) and RH1 (README first screen) were approved today.
(The Python 3.9 crash in `pricing.py` is fixed; it no longer needs a decision.)

## What we learned
- **The first revenue came from the one Actor with organic repeat use** (weather, $0.68). Official-data niches still have 0 real users, so jobs is the right place to keep betting.
- **Store funnel leaks at the input page:** 1,487 views → 120 input views → 25 starts. Half the views look like crawlers. Every Actor lacked the same basics (icon, published task, discounts), and those are now being fixed.
- **Tasks published through the API act as indexable Store landing pages** (`/examples/<task>`). Icons have to be uploaded in the Console, one full page load per Actor, because moving between Actors inside the Console app once overwrote a listing.

## Top build proposals (state/opportunities.json)
1. `companies-house`: score 1.54, 49 users / 21.7k runs per 30d, ~8h. Needs a free API key.
2. `open-food-facts`: 1.48, 9 users. We already have `open-food-facts-scraper`.
3. `wikipedia-data`: 1.32, 21 users. We already have `wikipedia-scraper`.

The official-data freeze (F1) applies to all three, so no new builds are proposed. Jobs remains the growth cluster.
