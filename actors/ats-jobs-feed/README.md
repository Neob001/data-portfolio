# Jobs Feed API — Greenhouse, Lever, Ashby & More Job Boards

Search **live job openings from 9,000+ companies** in one feed. The jobs come from the **official public job-board APIs** of Greenhouse, Lever, Ashby, Workable and Recruitee. Filter by keyword, location, country, remote, company, department, employment type and posting date. You get flat, deduplicated JSON with salary ranges wherever the employer publishes them. **$3 per 1,000 jobs**, and you pay only for jobs delivered.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["engineer"]`, `remote: "remote_only"`, `postedWithinDays: 7`, `maxResults: 20`. The run takes well under a minute.
2. You get the 20 newest remote engineering jobs posted in the last week, each with company, locations, country codes, apply link and (where published) salary.
3. That first run costs at most **$0.06** (20 jobs × $0.003), which fits in Apify's free monthly credit. Then change the filters or schedule the run with `sinceLastRun: true` to get a daily feed of new jobs only.

## What you get

One flat record per job opening:

```json
{
  "job_id": "ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  "title": "Security Engineer, Cloud",
  "company_name": "Ramp",
  "company_board": "ramp",
  "ats": "ashby",
  "department": "Engineering",
  "team": "Backend",
  "employment_type": "full_time",
  "workplace_type": "hybrid",
  "locations": ["New York, NY (HQ)", "Remote (Canada)", "Remote (US)", "Miami, FL"],
  "country_codes": ["CA", "US"],
  "remote": true,
  "salary_min": 211400,
  "salary_max": 290600,
  "salary_currency": "USD",
  "salary_period": "year",
  "posted_at": "2026-04-07T17:12:35.753Z",
  "updated_at": null,
  "apply_url": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
  "job_url": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  "description_text": "ABOUT RAMP\n\nRamp is building the smart infrastructure for finance teams…",
  "description_snippet": "ABOUT RAMP Ramp is building the smart infrastructure for finance teams, embedded in the transaction flow of every dollar a business spends…",
  "description_status": "included",
  "duplicate_sources": [],
  "source_url": "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true",
  "fetched_at": "2026-09-19T03:00:00.000Z"
}
```

- `workplace_type` is one of `remote`, `hybrid`, `onsite` or `unknown`. We never guess: when an ATS has no workplace field (Greenhouse), the value comes from the location text ("Remote, Canada"), and otherwise it is `unknown`.
- Salary fields are filled only when the ATS publishes structured compensation (Ashby, Lever, Recruitee). They are never estimated.
- `country_codes` are ISO 3166 alpha-2 codes. They come from the ATS's own country fields where available, and are otherwise inferred from the location text on a best-effort basis.
- `duplicate_sources` lists the other `job_id`s of the same opening. Example: a company that still has an old board live after switching ATS. Each opening is delivered and charged once.
- `description_text` is fetched **live from the company's ATS** for each delivered job (see below). `description_status` is `included`, `not_requested` (when `includeDescription: false`) or `unavailable` (the ATS could not be reached, or the posting has no text).
- **No personal data.** Recruiter and hiring-manager fields are never copied. In descriptions, e-mail addresses, phone numbers and names in contact lines ("Questions? Call Jane on …") are replaced with `[… redacted]`.

## Use cases

- **Job boards and aggregators**: a clean, deduplicated feed of direct-from-employer jobs with apply links, refreshed daily.
- **Sales and lead generation**: see who is hiring for which team and where. A hiring burst signals budget. Filter by department ("sales", "security") or by company list.
- **Recruiting and talent intelligence**: track competitors' openings, salary ranges and remote policy.
- **Job alerts and newsletters**: schedule with `sinceLastRun` to get only the jobs posted since the previous run.
- **AI agents and RAG**: small input, flat deterministic JSON, and full plain-text descriptions (up to 20,000 characters).

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. A title matches at a word start ("engineer" matches "Engineering Manager"). In the description, every word of the keyword must appear |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description`: title, department, team and the **first ~1,500 characters** of the description |
| `excludeKeywords` | string[] | Drops jobs whose **title** contains any of them |
| `locations` | string[] | City/state/country/region text as written in the posting, or an ISO country code (`US`, `DE`, `UK`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | `onsite_only` excludes jobs marked remote |
| `postedWithinDays` | integer | First published within the last N days |
| `companies` | string[] | Company names (`Datadog`) or board tokens (`datadog`, `greenhouse:datadog`) |
| `ats` | string[] | Any of `greenhouse`, `lever`, `ashby`, `workable`, `recruitee` |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other` |
| `maxResults` | integer | Default 100. Results come newest first |
| `includeDescription` | boolean | Default `true`. Fetches the full plain-text description (max 20,000 chars) live from the ATS for every delivered job. A 300-char snippet is always included. Set `false` for the fastest runs |
| `sinceLastRun` | boolean | Incremental feed: returns only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: board URLs (`https://job-boards.greenhouse.io/gitlab`, `https://jobs.lever.co/acme`, `https://jobs.ashbyhq.com/acme`, `https://apply.workable.com/acme`, `https://acme.recruitee.com`) or `ats:token` strings. These boards are fetched live, so you can use companies that are not in the index yet |

**How it works.** By default the Actor searches a compact, prebuilt search index of every board in our directory, rebuilt daily from the ATS APIs. The whole index is about 43 MB compressed. It holds every searchable field, plus the distinct words of each posting's first ~1,500 description characters. The Actor downloads only the parts that can match your `ats`, `companies` and date filters.

**Descriptions.** For every job it is about to deliver, the Actor fetches the description from the ATS. A single API call per company returns all of that company's jobs, so 100 jobs from 20 companies cost 20 calls. Lever and Workable calls are spaced out to respect their limits. A side benefit: a job the employer closed after the nightly build is detected and skipped, not delivered or charged. If a company's ATS can't be reached, the job is still delivered with `description_status: "unavailable"`.

**Live mode.** With `companyUrls` it fetches those boards live instead of using the index.

**Fallback.** If the index is ever unreachable, the run falls back to live-fetching a small set of large boards, so a scheduled run never fails empty.

**Incremental mode.** With `sinceLastRun: true`, the Actor keeps a small cursor per filter combination in a named key-value store in your Apify account (`factpipe-ats-jobs-feed-state`). Jobs already delivered are skipped and not charged. A second run straight after the first returns 0 jobs and costs $0. Note that the cursor follows each job's posting date, so a board added to the index later only contributes jobs posted after your last run.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$3.00 per 1,000** ($0.003 each) | One job record delivered, with or without its description. **No start fee. Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed at delivery time, and failed boards are never charged.** |

Example: 10,000 jobs cost **$30**. Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-09-19:

| ATS | Jobs in index |
|---|---|
| Greenhouse | 149,679 |
| Ashby | 54,408 |
| Lever | 52,493 |
| Recruitee | 12,806 |
| **Total** | **269,386** from **9,070** companies (after collapsing 7,890 duplicate listings) |

**Workable** is fully supported in live mode (`companyUrls`). Our directory holds 1,979 validated Workable boards with about 84,000 open jobs, but Workable rate-limited our requests on 2026-09-18, so those jobs join the index at the next paced rebuild after the ban expires. About 15% of indexed jobs carry a structured salary range.

Coverage grows as the directory is refreshed. Every board in the index had at least one open job when it was last checked. If a company you need is missing, pass its board URL in `companyUrls`.

## Sources and terms

Only official, public, unauthenticated job-board APIs that the ATS vendors publish for displaying and syndicating open jobs. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

| ATS | API | Reuse terms |
|---|---|---|
| Greenhouse | [Job Board API](https://developers.greenhouse.io/job-board.html) | "Job Board data is publicly available"; no authentication for GET |
| Lever | [Postings API](https://github.com/lever/postings-api) | Published postings "are publicly viewable" and "may be scraped by third parties"; we respect its 1 request/s crawl delay |
| Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | Public, unauthenticated posting API |
| Workable | [Public jobs endpoint](https://help.workable.com/hc/en-us/articles/115012771647) | Documented public endpoint for published jobs; robots.txt allows crawling |
| Recruitee | [Careers Site API](https://docs.recruitee.com/reference/offers) | Public API returning published offers |

SmartRecruiters is deliberately **not** included, because its API host's robots.txt disallows automated access.

## FAQ

**How is this different from LinkedIn or Indeed scrapers?**
We don't scrape any job site. Every job comes from the employer's own applicant tracking system, through the official public API that also powers the company's careers page. That makes the data first-party and current: a job is gone from the feed once the employer closes it. It also carries the direct apply link, and there are no reposts, recruiter spam or login walls. There is no ban risk and no proxy cost, which is why it costs $3 per 1,000 jobs.

**How fresh is the data?**
The search index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against the employer's ATS during your run, and closed jobs are dropped. `fetched_at` is when the index read that board, and `posted_at` is the employer's own publish date.

**Does keyword search cover the whole description?**
It covers the title, department, team and the first ~1,500 characters of each description, which is usually the role summary and the first requirements. Words that appear in most of one company's postings (its "About us" boilerplate) are matched per company. Use `keywordScope: "title"` for strict title searches.

**Which companies are covered?**
About 9,000 companies with open jobs on Greenhouse, Lever, Ashby and Recruitee in the index, plus 1,979 Workable boards in the directory (see Coverage). They were discovered from Common Crawl's public URL index and each was validated against its ATS API. Use `companies` to restrict the search, or `companyUrls` for any board that isn't indexed.

**Why do some jobs have no salary?**
Only some employers publish structured pay ranges, mostly on Ashby, Lever and Recruitee. We never extract or estimate salaries from free text.

**Can I get only new jobs every day?**
Yes. Schedule the Actor with `sinceLastRun: true`. Each run returns and charges only jobs that no earlier run with the same filters delivered.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or the official Python/JavaScript clients. You can connect it to Make, Zapier, n8n, Slack or Google Sheets through Apify integrations, or expose it to AI agents through the Apify MCP server.

## Related factpipe Actors

- [Career Page Jobs Scraper](https://apify.com/factpipe/company-jobs-scraper): give it a company *homepage* and it finds the careers page and ATS for you.

## Reliability

Official ATS APIs only. The Actor uses retries with backoff, per-host rate limits and structured failure reporting, and writes a `RUN_SUMMARY` record on every run. Its daily auto-test input has a built-in live fallback.
