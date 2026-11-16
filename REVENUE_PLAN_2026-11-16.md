# factpipe revenue update — 2026-11-16

Data: Console Insights (Nov 1-16, read 11-16), public Store API (30-day users), jobs-index build report 2026-11-15.

## Results
- **Nov 1-16 revenue $74.15, profit $72.95** (Oct full month $17.12). Run-rate ~$140-150/month. Targets "Nov >= $30" and ">= 20 paying users by Dec 31" are already met.
- Jobs Feed = 98%: 23 paying + 101 free users, 37,238 results, $72.52 profit. 157 users / 30 days (54 in the last 7).
- The $3 -> $5 price (Nov 6) did not cost paying users: 13 paying in all of October, 23 in Nov 1-16.
- Acquisition: 118 starts vs 79 detail-page viewers -> most usage comes via API / integrations / AI agents, not Store browsing.
- Index 2026-11-15: 796,249 unique jobs (856k before cross-board dedupe), 19,390 boards, 0 skipped, build 111 min. 12/12 nightly builds green.
- New today: jobs-bulk-feed ($2/1k) and expired-jobs-checker ($0.10/1k) published.

## Next levers (ranked by expected revenue)
| # | Lever | Needs | Expected |
|---|---|---|---|
| 1 | One combined price change at the next window (schedule ~Nov 23, effective ~Dec 7 after 14-day notice): job-result $5 -> $7/1k (tiers 6.30/5.60/4.90) + P3 $0.01 per run with results | owner approval (P4) + notice text | +40% per paid job: ~+$60/month at current volume, + ~$10/month run fees; leader is $12/1k + $0.01/run with 1,575 users |
| 2 | More ATS sources in the index (Jobs Feed coverage) | legal screen (running), then APPROVE per source | more matching jobs per search -> more paid results |
| 3 | Bulk feed + checker adoption | live 11-16; watch 2 weeks | one data buyer pulling daily new jobs = $60-100/month |
| 4 | Store reviews: Jobs Feed has 0 ratings (leader 4.1, 1,575 users) | one passive README line, owner approval | rank in "job listings"/"jobs api" pools |

## Maintenance found 11-16
- Apify API token on this Mac rejected (401) since ~11-12 -> scripts, weekly report, sync_listings and example-task publishing blocked until the owner saves a valid token to ~/.apify_token.
- 3 small Actors were flagged "Under maintenance" on 11-13 (auto-test could not start them); cleared by 11-16, no action needed.
- Listing claims overstated after the dedupe (850,000+/800,000+ jobs, 20,000+ sites): corrected in repo (790,000+ / 19,000+); live listing update waits for owner approval.
