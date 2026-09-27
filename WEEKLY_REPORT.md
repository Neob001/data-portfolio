# Weekly report — 2026-09-27

## Money
- **Revenue: $0.68 in September ($0.64 profit)**, all from `us-weather-forecast` (2 paying users). This is today's Console Insights reading, logged in LEARNINGS.md. This run didn't open the Console, so check the exact figure at https://console.apify.com/actors/insights (Monetization tab). The final number comes on the payout invoice.
- **24 live Actors · 4 with real users · 4 real users · 21 real runs (30d).** Change vs the first snapshot (2026-09-25, only 2 days ago): users with real Actors 2 → 4, real users 2 → 4, runs 26 → 21.
- Actors with real users: `us-weather-forecast` (1 real user, 16 runs; API shows 2 users/30d incl. auto-test), and in their first days `ats-jobs-scraper`, `companies-hiring` ($5/1k) and `remote-jobs-feed` (1 user each, 0 real runs yet).

## Health
- `health.py`: **0 flags** across 24 Actors. Scorecard flag: **`broken-link-checker` 20% of 30d runs failed** (older failures from the 09-18 maintenance incident; its PPE switch takes effect 2026-10-02).
- Staging: all 11 cloud runs of the jobs Actors passed 2026-09-27. `news-monitor` is still shelved and unpublished because GDELT rate-limits requests.
- `pricing.py` crashes on system Python 3.9 (it can't parse the `Z` timestamp suffix). It ran clean on python3.12 with 0 price proposals.

## Decisions needed
_None open._ The scorecard has 0 proposals, and SD1 (Store discounts) and RH1 (README first screen) were approved today.
1. Should the weekly and daily scripts switch to `~/.local/bin/python3.12`, or should `pricing.py` be patched to run on Python 3.9? (yes = switch interpreter)

## What we learned
- **The first revenue came from the one Actor with organic repeat use** (weather, $0.68). Official-data niches still have 0 real users, so jobs is the right place to keep betting.
- **Store funnel leaks at the input page:** 1,487 views → 120 input views → 25 starts. Half the views look like crawlers. Every Actor lacked the same basics (icon, published task, discounts), and those are now being fixed.
- **Tasks published through the API act as indexable Store landing pages** (`/examples/<task>`). Icons have to be uploaded in the Console, one full page load per Actor, because moving between Actors inside the Console app once overwrote a listing.

## Top build proposals (state/opportunities.json)
1. `companies-house`: score 1.54, 49 users / 21.7k runs per 30d, ~8h. Needs a free API key.
2. `open-food-facts`: 1.48, 9 users. We already have `open-food-facts-scraper`.
3. `wikipedia-data`: 1.32, 21 users. We already have `wikipedia-scraper`.

The official-data freeze (F1) applies to all three, so no new builds are proposed. Jobs remains the growth cluster.
