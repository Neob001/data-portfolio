# Weekly report — 2026-09-13

## Money
- **Revenue: not visible via API.** No actor has any user besides us yet (see below), so it's almost certainly **$0**. For the exact number, check [Console → Insights → Monetization](https://console.apify.com/actors/insights). Final monthly numbers show up on the payout invoice.
- **11/11 actors public (9 + wikipedia and open-food-facts added 2026-09-13) with pay-per-event pricing.** The registry still listed fda-recalls as awaiting publish, but the API says it's public. Registry fixed.
- Leading indicators (all-time runs / users in the last 30 days): SEC 10/1 · TED 10/1 · UK-CH 7/1 · OFAC 5/1 · FedReg 4/1 · weather 3/1 · jobs 3/1 · sitemap 3/1 · FDA 2/1. **Every actor has exactly 1 user in the last 30 days, and that's us.** No outside users 2 days after launch.

## Health
- `health.py`: **0 flags**, 8 live actors checked. 0 failed runs in the last 24h. No actor has failed 2+ runs in a row.
- Staging schedules `staging-sec-edgar` and `staging-eu-ted` are on. Last run 2026-09-13 06:00Z, both SUCCEEDED. All 9 actors passed staging. Our only failed run ever is UK-CH on 2026-09-10, before the keyless fix, and it was expected.
- The Store runs a daily auto-test on each public actor, but those runs happen under Apify's account, so the API can't show them. No "under maintenance" flags seen.
- ⚠ Blind spot: the row-count-drop check is inactive because `datasetItemCount` reads 0.
- ⚠ Script problems this run:
  - `pricing.py` crashes on the system Python 3.9 (it can't parse a `Z` timestamp), so I ran it with Python 3.12. It found 0 price changes to suggest; all actors are still in their 60-day launch-pricing period.
  - `health.py` failed twice with an SSL EOF error through the local proxy, then passed on retry.

## Decisions needed (answer in DECISIONS.md)
1. ~~W1~~ **DONE 2026-09-13** (owner approved in chat): keyword-first titles, descriptions, SEO fields, categories (they were missing) and README pricing/FAQ are live on all 9 actors.
2. **W2**: Harden `scripts/` (retry on SSL/network errors, date parsing that works on Python 3.9, fix the `datasetItemCount` field)? No actor code touched. yes/no
3. ~~W3~~ **LIVE 2026-09-13**: apify.com/factpipe/wikipedia-scraper ($1/1K articles, person articles excluded and never charged).
4. ~~W4~~ **LIVE 2026-09-13**: apify.com/factpipe/open-food-facts-scraper ($1/1K products, ODbL attribution on every record).
5. **W5**: Build an INSEE/Sirene French company-register actor (official open API; the alternative queued after rejecting INC-3)? yes/no
6. **L1** (carried over): Build a Companies House officers/PSC variant? That data includes directors' personal details. yes/no

## What we learned
- **Staging with bad inputs catches billing bugs.** It caught two before launch: Companies House fuzzy-matching nonsense queries (which we would have charged for) and OFAC's percent-vs-fraction threshold mix-up. Every lookup actor now needs a staging run with a query that must return no match.
- **Store launch limits:** at most 5 publications per 24h. Publishing and accepting T&C can only be done by the owner in the Console. Every actor needs a keyless default input that returns results, or the daily auto-test will flag it as under maintenance.
- **Where our wedge is:** broken incumbents with high demand are mostly social or personal-data scrapers we can't legally replace; the replaceable ones sit around Store ranks 1000–3000. Auto-reject any target whose ToS page is itself behind bot checks (Europages) or that requires ID verification (USPTO).

## Top build proposals (state/opportunities.json, excluding ones already built or rejected)
| # | Slug | Source | Build | Competitors' demand (30d) | Score |
|---|---|---|---|---|---|
| 1 | open-food-facts | Open Food Facts API (ODbL) | 5h | 271 runs / 9 users, 7.4% fail | 1.48 |
| 2 | wikipedia-data | MediaWiki APIs | 4h | 230 runs / 21 users | 1.32 |
| 3 | github-repos | GitHub REST API | 6h | 472 runs / 25 users | 0.82 |
| 4 | clinical-trials | ClinicalTrials.gov v2 | 6h | 258 runs / 8 users | 0.41 |
