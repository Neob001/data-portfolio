# Bulk Job Postings Feed — All New Jobs Daily

A **bulk job postings feed** for job boards, HR-tech products and labour-market research: every open job from **20,000+ company career sites** on Workday, Greenhouse, Lever, Ashby, Personio, Teamtailor, Workable and Recruitee, delivered as flat JSON rows. Run it once for the whole index (about **860,000 unique jobs**), then schedule it daily: with `sinceLastRun` (on by default) each run returns **only the jobs it has not delivered before**, so you get every new job once and never pay twice for the same posting.

No keyword search, no ranking, no scraping during your run: the Actor streams a prebuilt index that is rebuilt every night from the employers' own applicant tracking systems, so even a full delivery of 800,000+ jobs is fast and cheap.

## Quick start

1. Click **Start** with the prefilled input: `postedWithinDays: 3`, `maxResults: 100`. The run takes well under a minute.
2. You get 100 jobs posted in the last 3 days, newest first, in the same flat schema as the [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed).
3. Click **Start** again: `sinceLastRun` skips the 100 you already have and delivers the next 100. For the full feed, clear `maxResults` (default 100,000) and `postedWithinDays`, then schedule the Actor daily.

## What you get

One flat record per job opening. This one is from a local run of the prefilled input on November 3, 2026 (index build of November 2):

```json
{
  "job_id": "ashby:clipboard:09b687bd-a7a9-479f-80cc-8b460eb4d99a",
  "title": "Office and Events Manager",
  "company_name": "Clipboard",
  "company_board": "clipboard",
  "ats": "ashby",
  "department": "General",
  "team": "General",
  "employment_type": "full_time",
  "seniority": "manager",
  "workplace_type": "hybrid",
  "locations": ["Hybrid (San Francisco, CA)"],
  "country_codes": ["US"],
  "remote": true,
  "salary_min": 85000,
  "salary_max": 120000,
  "salary_currency": "USD",
  "salary_period": "year",
  "salary_source": "structured",
  "years_experience_min": null,
  "visa_sponsorship": null,
  "posted_at": "2026-11-02T00:04:40.403Z",
  "updated_at": null,
  "apply_url": "https://jobs.ashbyhq.com/clipboard/09b687bd-a7a9-479f-80cc-8b460eb4d99a/application",
  "job_url": "https://jobs.ashbyhq.com/clipboard/09b687bd-a7a9-479f-80cc-8b460eb4d99a",
  "description_text": null,
  "description_snippet": "ABOUT CLIPBOARD Our mission is to uplift as many communities as possible. We do this through our app-based marketplace that connects healthcare professionals with the workplaces that need amazing workers. This enables hundreds of thousands of people to achieve financial stability for themselves…",
  "description_status": "not_requested",
  "duplicate_sources": [],
  "match_score": null,
  "matched_in": null,
  "source_url": "https://api.ashbyhq.com/posting-api/job-board/clipboard?includeCompensation=true",
  "fetched_at": "2026-11-02T11:05:12.046Z"
}
```

A few more rows from a local run with `postedWithinDays: 2` (7,242 jobs, one per platform shown):

| Title | Company | Location | Platform | Seniority | Salary |
|---|---|---|---|---|---|
| Senior Application Engineer | 3M | CN, Shanghai | Workday | senior | — |
| Senior AI Security Engineer | Abacus Insights | India | Greenhouse | senior | — |
| Senior Technical Recruiter & Portfolio Owner | Agile Defense | Remote | Lever | senior | from 110,000 USD |
| Senior Solution Architect / Facharchitekt* | Accso – Accelerated Solutions GmbH | München, Bayern, Deutschland | Recruitee | senior | from 87,500 EUR |
| Office Manager:in (m/w/d) 1KOMMA5° Bielefeld | 1KOMMA5° Bielefeld GmbH | Bielefeld | Personio | manager | — |
| Insurance Admin & Sales Support Intern | Burjline Builders | Manama, Bahrain | Teamtailor | intern | — |

Need fewer columns? List them in `fields` (e.g. `["job_id", "title", "company_name", "country_codes", "posted_at", "job_url"]`) for smaller datasets and faster exports.

## Use cases

- **Job boards and aggregators**: fill and refresh your board with direct-from-employer jobs and apply links every day, without running crawlers.
- **HR-tech and recruiting products**: a daily firehose of new openings for matching, alerts or sourcing tools.
- **Labour-market and investment research**: hiring volume by company, country, platform and seniority, day by day.
- **Data warehouses and AI pipelines**: one flat schema, stable `job_id`s, deterministic enrichment (no AI at run time).

## Input

| Field | Type | Notes |
|---|---|---|
| `ats` | string[] | Any of `greenhouse`, `lever`, `ashby`, `workable`, `recruitee`, `workday`, `personio`, `teamtailor`. Empty = all |
| `countries` | string[] | ISO country codes (`US`, `DE`, `GB`). Jobs whose location names no country (just "Remote") are excluded when set |
| `remote` | `any` \| `remote_only` \| `onsite_only` | `onsite_only` excludes jobs marked remote |
| `seniority` | string[] | `intern`, `entry`, `mid`, `senior`, `lead`, `manager`, `director`, `executive`, read from the job title. Jobs without a level word are excluded when set |
| `postedWithinDays` | integer | Only jobs first published in the last N days. Empty = the whole index |
| `sinceLastRun` | boolean | Default `true`: skip every job this Actor already delivered for the same filters (see FAQ) |
| `maxResults` | integer | Default 100,000, maximum 2,000,000. Newest jobs come first |
| `fields` | string[] | Output fields to keep. Empty = all |

## Output fields

The same 32 fields as the [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed), so both datasets load into one table:

- **Identity and links**: `job_id` (stable: `ats:board:posting`), `job_url`, `apply_url`, `company_name`, `company_board`, `ats`, `duplicate_sources` (job_ids of the same opening on another board, collapsed into this row).
- **Role**: `title`, `department`, `team`, `employment_type`, `seniority` (from the title by fixed rules), `workplace_type`, `remote`.
- **Where**: `locations` (as written by the employer), `country_codes` (ISO).
- **Pay**: `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_source` (`structured` when the ATS publishes pay).
- **When**: `posted_at`, `updated_at`, `fetched_at` (when the nightly build read the board).
- **Text**: `description_snippet` (first ~300 characters). `description_text` is always `null` and `description_status` is `not_requested`: full descriptions are fetched live by the [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed), not by this bulk feed.
- `years_experience_min` comes only from ATSs that publish it (Personio); `visa_sponsorship`, `match_score` and `matched_in` are always `null` here (they need descriptions or keywords).
- `source_url`: the ATS API or feed the job was read from.

## Pricing (pay per event)

TODO(owner): Pricing — $X per 1,000 jobs (`job-result`, one event per delivered job). Set the price in the Console, then replace this line before publishing.

Jobs skipped by `sinceLastRun` are never charged. Set a maximum charge per run in Apify and the Actor stops cleanly when it is reached; with `sinceLastRun` the next run continues with the jobs not delivered yet.

## factpipe Jobs & Hiring Data

These Actors share the same nightly index of open jobs from 20,000+ company career sites:

- [Bulk Job Postings Feed](https://apify.com/factpipe/jobs-bulk-feed) (this Actor): every new job every day, as one bulk feed.
- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): keyword search ranked by relevance, every filter, full descriptions fetched live.
- [Expired Jobs Checker](https://apify.com/factpipe/expired-jobs-checker): is a job you already have still open? Open / closed per job_id or job URL.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever, Ashby & Workday Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api), [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api), [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) and [Workday Jobs API](https://apify.com/factpipe/workday-jobs-api): one platform each.
- [Career Page Scraper](https://apify.com/factpipe/company-jobs-scraper): give it a company homepage and it finds the careers page and ATS for you.

## FAQ

**How is this different from the Jobs Feed API (ats-jobs-feed)?**
The [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed) is a search: keywords, relevance ranking, company and department filters, live description fetch, typically tens to a few thousand jobs per run. This Actor is a bulk export: no keywords and no ranking, just every job that matches a few coarse filters, streamed in batches of 1,000, so it can deliver the whole index (800,000+ jobs) in one run. Use the bulk feed to mirror the data; use the Jobs Feed API to find specific jobs or to get full descriptions.

**How fresh is the data?**
The index is rebuilt every night from the employers' ATS APIs and feeds and published around 10:00 UTC (some days up to an hour later). Each row's `fetched_at` says when the build read that company's board; `posted_at` is the employer's own publish date. Schedule the Actor after about 11:00 UTC to get each new build's jobs on the same day. A run never contacts the job boards itself.

**How does `sinceLastRun` work?**
The Actor remembers a compact fingerprint of every job_id it delivered for your filter combination, in a named key-value store in your own Apify account (`factpipe-jobs-bulk-feed-state`, about 10 MB per million jobs). Later runs skip those jobs and charge nothing for them. Unlike a posting-date cursor, this also catches jobs that join the index with an older posting date (a company newly added to the index, for example). A run cut short by `maxResults`, your maximum charge or the run timeout continues where it stopped next time. Jobs that leave the index are forgotten after 14 days. Changing `ats`, `countries`, `remote`, `seniority` or `postedWithinDays` starts a separate feed; `maxResults` and `fields` do not.

**How long does a full run take?**
Locally the whole index (859,594 jobs) streams in about 10 seconds; on Apify most of the time goes into writing the rows to your dataset. Give a full first run a generous timeout (for example 1 hour) and at least 2 GB of memory for more CPU. If the run timeout comes close, the Actor stops cleanly, keeps what it delivered, and the next run continues.

**Why is `description_text` empty?**
Full descriptions are not part of the index (it would be many gigabytes); they are fetched live from each ATS by the [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed) for the jobs it delivers. Every row here has the first ~300 characters as `description_snippet`.

**Which companies are covered?**
About 20,000 company job boards with open jobs: Workday (about 5,000 career sites of large employers), Greenhouse, Workable, Ashby, Lever, Personio, Teamtailor and Recruitee. Workday sites contribute their newest 500 jobs each and Teamtailor sites their newest 1,000. Boards were discovered from Common Crawl's public URL index and validated against their ATS. LinkedIn, Indeed and other job sites are not scraped.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or the official Python/JavaScript clients, schedule it in Apify, and connect the dataset to Make, Zapier, n8n, Google Sheets or your warehouse through Apify integrations.

## Sources and terms

Only the public job-board APIs and feeds that the ATS vendors publish for displaying open jobs (Greenhouse Job Board API, Lever Postings API, Ashby Public Job Posting API, Workable and Recruitee public endpoints, Personio XML feed, Teamtailor RSS feed, Workday public career sites with robots.txt checked first). No logins, no personal profiles. The nightly build does all reading; this Actor only downloads the published index.

## Reliability

The index is published as build-stamped files with the previous build kept, so a run never sees a half-published index. Each part of the index is retried on a network error; a part that still fails is skipped and reported in the status message (with `sinceLastRun`, its jobs come with the next run). Every run writes a `RUN_SUMMARY` record (rows, skipped, stop reason, index build time).
