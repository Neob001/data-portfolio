# factpipe revenue plan — 2026-11-03

Data: Console Insights (Oct final), Apify Store API demand scans (state/demand_scan_2026-11-03.txt), leader portfolio (fantastic-jobs), jobs-index build report 2026-11-02.

## Where we are
- October revenue $17.12 (profit $16.63). Jobs Feed = ~100%: 13 paying + 124 free users, 37,583 jobs delivered at $3/1k. Nov 1-2: 5 paying users.
- Jobs Feed $5/1k from 2026-11-06 (P2). Index 890k jobs / 20k boards, 100% run success since 10-14, quality score 84/100.

## The market we can legally serve
- The big job-data pools on the Apify Store are commercial job boards whose terms forbid scraping: Indeed 11.5k real users, Naukri 5.2k, Glassdoor 2.6k, Upwork 1.6k, StepStone 926, SEEK 899, Wellfound 778, LinkedIn ~18k. Our rules keep us out of all of them (correctly).
- Our segment = company career sites (ATS). Its leader (fantastic-jobs) has: career-site job listing API 1,632 users / 163k runs at $12/1k + $0.01 per run; career-site FEED 281 users at $2.50/1k + $0.10 per run; expired-jobs API 12 users at $0.75 per run; per-ATS APIs 75-175 users each at $2-2.50/1k.
- Coverage expansion under our rules is nearly exhausted (iCIMS/Oracle/BambooHR terms, SmartRecruiters/SuccessFactors robots). Remaining legal sources are small: Arbeitsagentur ~154 users, Himalayas ~211 (research running).

## Levers, ranked by expected revenue

| # | Lever | Needs | Expected impact |
|---|---|---|---|
| 1 | Jobs Feed $3 -> $5/1k (P2) | done, live Nov 6 | +67% per paid job: ~$20 -> ~$33/month at October volume |
| 2 | **Bulk job feed** Actor (all new jobs daily, no ranking, no descriptions) for data buyers - the leader's feed has 281 users | build (running) + publish/price approval | volume buyers: 5 paying x 50k jobs/month x $2/1k = ~$500/month; even 1-2 buyers beat today's total |
| 3 | Per-run start fee on Jobs Feed (leader charges $0.01/run) | price change, earliest ~Nov 23 (one change per month) | 1,214 runs/month today; ~$4-12/month now, scales with schedules |
| 4 | **Expired-jobs checker** (which postings closed) - leader $0.75/run | build (running) + approval | small: ~$20-50/month, near-zero cost |
| 5 | Price review after Nov 6 data (leader is at $12/1k) | 2 weeks of data | if paying users hold at $5, test $7-8 in December |
| 6 | Arbeitsagentur (official German job portal API, ~1M jobs) / Himalayas | legal research (running), then source approval | small direct demand (154 / 211 users), more coverage for Jobs Feed |

## What we stop / don't do
- No more Store-ranking work: 90% of Jobs Feed page visitors have no referrer (direct/API/AI tools), Store search sends ~3%.
- No new official-data or website Actors; no ToS-forbidden job boards.

## Targets
- November >= $30 (price) ; December >= $60 with the bulk feed live; Jobs Feed paying users >= 20 by Dec 31.
