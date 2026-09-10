# Weekly report — 2026-09-11 (bootstrap week)

## Money
No revenue yet — nothing is published. 3 Actors are code-complete with passing tests and are blocked ONLY on the account items below.

## Health
Portfolio: 3 actors `ready-to-stage`, 0 live. All 12 unit tests green. Live API smoke checks passed for SEC (efts.sec.gov) and TED (api.ted.europa.eu).

## Decisions needed (answer in DECISIONS.md: `YYYY-MM-DD | APPROVE|REJECT | item-id | note`)

**Blockers — the business cannot go live without these (do them once, ~20 min total):**
- **B1**: Create/verify Apify account with monetization (payout details) enabled, generate an API token, store it as API credential `APIFY_TOKEN` in the Claude Code cloud environment, and allow `api.apify.com`, `efts.sec.gov`, `api.ted.europa.eu`, `api.company-information.service.gov.uk` as custom domains.
- **B2**: Create an empty GitHub repo `data-portfolio` and give the local machine push access (install `gh` + `gh auth login`, or add a deploy key) so this repo can be pushed and Apify GitHub-linked builds set up.
- **B3**: The scratch build lives in a session-temporary folder — reply with a permanent folder (e.g. `~/code/data-portfolio`) to move it to, or approve B2 and it lives on GitHub.

**Launch approvals (marked AUTO-APPROVED-PENDING-REVIEW, will stage as soon as B1+B2 exist):**
- **A1** `sec-edgar-filings-search` — PPE `filing-result` @ $0.008 (incumbent ~$0.01).
- **A2** `eu-ted-tenders-monitor` — PPE `tender-result` @ $0.01 (incumbents costlier and failing 13.7% of runs).
- **A3** `uk-company-lookup` — PPE `company-found` @ $0.004; customers bring their own free Companies House key.

**Legal judgment needed:**
- **L1**: Companies House **officers/PSC** variant (director names, partial DOB, service addresses). Statutory public register, but it is personal data — build it, or keep the portfolio company-facts-only?
- **L2**: `job-postings-ats` (Greenhouse/Lever public JSON) — company job posts, generally fine, but confirm you're comfortable before it enters the build queue.

## Top build proposals (from live Store scan 2026-09-11 — full data in state/opportunities.json)

| # | id | score | incumbent runs/30d | inc. rating | inc. fail% | est. | source |
|---|---|---|---|---|---|---|---|
| P1 | sanctions-lists | 0.97 | 375 | unrated | 0.5% | 8h | OFAC/EU/UN published lists (compliance buyers pay well) |
| P2 | uspto-trademarks | 0.59 | **46,843** | 5.0 | 0.0% | 10h | USPTO open APIs — biggest safe demand pool, strong incumbents; win on price/variants |
| P3 | federal-register | 0.46 | 330 | 5.0 | 0.0% | 5h | federalregister.gov API — cheap build, regulatory-monitoring buyers |
| P4 | fda-recalls | 0.46 | 282 | 5.0 | 0.0% | 5h | openFDA enforcement API |
| P5 | weather-data | 0.85 | 1,014 | 4.0 | 0.0% | 4h | NWS/open-meteo — cheap build, agent-friendly |

Scored but rejected on legal safety: google-trends (85k runs/30d), product-hunt (3.2k). High-score but weak-revenue-thesis: open-food-facts, wikipedia-data (free alternatives everywhere) — deprioritized despite scores.

- **Q1**: Approve P1–P5 as the next build queue (2/week)? Approve/reject individually.

## What we learned
- The entire opportunity scan runs zero-token: the Store API publicly exposes incumbents' failure rates and PPE prices.
- Incumbent weakness is real: TED leaders fail 13.7% of runs; UK company-data incumbents have 21.7k runs/30d and no ratings.
- Pure-transform + golden-fixture architecture lets every future repair be a one-file Sonnet patch verified by `npm test`.

## Next (as soon as B1/B2 land)
Push repo → link Apify builds → 48h private staging with synthetic then real inputs → set PPE prices → public. Then create Routines (`health-daily` first, 3 days solo to measure usage), then `repair` webhook + `issues-daily` + `weekly-report`.
