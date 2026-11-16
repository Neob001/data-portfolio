# factpipe weekly report — 2026-11-16 (rerun after token restore)

## Money
- **Live Actors 31 · with real users 4 · real users (30d) 160 (+59 vs 11-03: 101) · real runs (30d) 1,446 (+226: 1,220).** New 11-16: jobs-bulk-feed ($2/1k), expired-jobs-checker ($0.10/1k), too early to score.
- Actors with real users: **ats-jobs-feed 156 users / 1,405 runs (0% fail)**, ats-jobs-scraper 2, remote-jobs-feed 1, us-weather-forecast 1.
- Revenue (Console Insights, read 11-16): **Nov 1-16 $74.15 revenue / $72.95 profit** (Oct full month $17.12). Jobs Feed: 23 paying users at $5/1k, no paying-user loss after the 11-06 price change.
- Own usage this cycle: $0.16 of the $5 free credit.

## Health
- Apify token restored 11-16; health.py ran: **31 Actors checked, 0 flags**.
- Scorecard flag: uk-company-lookup 8% of runs failed (30d), 0 failures in the last 24h. All other live Actors 0-3%.
- Jobs index: nightly builds green (11-15: 796,249 jobs, 19,390 boards).

## Decisions needed (answer in DECISIONS.md, one line each)
1. Scorecard proposals (title/SEO test, then -30% price test after 30 more days at 0 users) for the 25 zero-user Actors listed in state/scorecard.md. Approve any? Name them, else "none".
2. pricing.py lists 15 KILL_REVIEW candidates (near-zero paid runs after 30d, state/pricing_proposals.json). Unpublish any? Default: keep all (they cost $0 while idle).

## What we learned
- The $3 to $5/1k change on Jobs Feed raised revenue with no loss of paying users. P4 ($7/1k + $0.01 per run with results) is approved and can be entered on 11-23 05:09 UTC (one price change per month).
- Traffic is mostly API, agents and integrations (118 starts vs 79 page viewers), so example-task pages and cross-links matter more than Store search ranking.
- The single API token is a single point of failure: when it broke (11-12 to 11-16), health checks, launches and task publishing all stopped.

## Top build proposals
1. JazzHR + Pinpoint sources into the jobs index (approved 11-16, in progress on a branch).
2. companies-house (score 1.54; 21.7k runs/30d, 49 users; UK gov API, free key needed).
3. open-food-facts (1.48; 271 runs/30d).
