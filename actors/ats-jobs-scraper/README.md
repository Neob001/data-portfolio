# Greenhouse, Lever & Ashby Jobs Scraper — Job Board API

<!-- factpipe:hero:start -->

**Scrape open jobs from Greenhouse, Lever, Ashby, Workable and Recruitee job boards: pick platforms and companies, filter by keyword, location and remote. Salary where published. $3 per 1,000 jobs.**

| Title | Company | Locations | Workplace | Salary min |
|---|---|---|---|---|
| (Senior) Backend Software Engineer (Java) - Met… | Celonis | Munich, Germany | unknown | — |
| Senior Mechanical Engineer - Lethality | Anduril Industries | Costa Mesa, California, United States | unknown | — |
| Software Engineer, Manufacturing Infrastructure | SpaceX | Starbase, TX | unknown | — |

*Real output from the “Greenhouse engineering jobs” example, run on September 27, 2026.*

**Try a ready-made example:** [Greenhouse engineering jobs](https://apify.com/factpipe/ats-jobs-scraper/examples/greenhouse-engineering-jobs) · [Lever sales jobs](https://apify.com/factpipe/ats-jobs-scraper/examples/lever-sales-jobs) · [Ashby startup jobs (newest)](https://apify.com/factpipe/ats-jobs-scraper/examples/ashby-startup-jobs)

<!-- factpipe:hero:end -->

A **Greenhouse jobs scraper**, **Lever jobs API**, **Ashby job board API**, plus **Workable jobs** and **Recruitee jobs**, in one Actor. Pick the applicant tracking systems (ATS) you want, optionally name companies, add keywords, and get every open job as flat, deduplicated JSON: title, department, locations, country codes, remote flag, salary range (where the employer publishes one), apply link and full description. It already knows 10,900+ company job boards. You can also paste any board URL ("https://job-boards.greenhouse.io/gitlab", "https://jobs.lever.co/acme") to fetch it live. **$3 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `ats: ["greenhouse"]`, `keywords: ["product"]`, `maxResults: 20`. The run takes well under a minute.
2. You get the 20 most relevant Greenhouse jobs for "product" (product manager, product designer…): jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.06** (20 jobs × $0.003), which fits in Apify's free monthly credit. Then add `lever` and `ashby`, name the `companies` you track, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening:

```json
{
  "job_id": "greenhouse:gitlab:8638232002",
  "title": "AI Transformation Owner, CRO",
  "company_name": "GitLab",
  "company_board": "gitlab",
  "ats": "greenhouse",
  "department": "Enablement",
  "team": null,
  "employment_type": null,
  "workplace_type": "remote",
  "locations": ["Remote, United States"],
  "country_codes": ["US"],
  "remote": true,
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "salary_period": null,
  "posted_at": "2026-07-22T17:38:40.000Z",
  "updated_at": "2026-09-14T20:01:39.000Z",
  "apply_url": "https://job-boards.greenhouse.io/gitlab/jobs/8638232002",
  "job_url": "https://job-boards.greenhouse.io/gitlab/jobs/8638232002",
  "description_text": "GitLab is the intelligent orchestration platform for DevSecOps…",
  "description_snippet": "GitLab is the intelligent orchestration platform for DevSecOps. GitLab enables organizations to increase developer productivity…",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": null,
  "matched_in": null,
  "source_url": "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true",
  "fetched_at": "2026-09-25T03:20:41.000Z"
}
```

- The same fields for every ATS. Greenhouse's job-board API has no employment type or pay range, so those stay `null` there. They are never guessed.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with both an old and a new ATS board). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Job boards and aggregators**: pull every Greenhouse, Lever and Ashby job in one normalized schema instead of writing five integrations.
- **Tracking specific companies**: `companies: ["Datadog", "Ramp"]`, scheduled daily with `sinceLastRun: true`.
- **Recruiting and talent intelligence**: competitors' open roles, departments, locations and published salary ranges.
- **Sales and lead generation**: who is hiring which team, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).

## Input

| Field | Type | Notes |
|---|---|---|
| `ats` | string[] | Any of `greenhouse`, `lever`, `ashby`, `workable`, `recruitee`, `workday`. Empty = all six |
| `companies` | string[] | Company names (`Datadog`) or board tokens (`datadog`, `greenhouse:datadog`). Empty = every company on the chosen platforms |
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other` |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from the ATS for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: board URLs or `ats:token` strings, fetched directly from the ATS (the `ats` selection does not apply to them) |

**Board URLs and tokens accepted in live mode:**

| ATS | Board URL | Token form |
|---|---|---|
| Greenhouse | `https://job-boards.greenhouse.io/gitlab`, `https://boards.greenhouse.io/gitlab` | `greenhouse:gitlab` |
| Lever | `https://jobs.lever.co/acme`, `https://jobs.eu.lever.co/acme` | `lever:acme`, `lever:eu:acme` |
| Ashby | `https://jobs.ashbyhq.com/acme` | `ashby:acme` |
| Workable | `https://apply.workable.com/acme` | `workable:acme` |
| Recruitee | `https://acme.recruitee.com` | `recruitee:acme` |
| Workday | `https://acme.wd5.myworkdayjobs.com/External` (any page, also `/en-US/…`) | `workday:acme.wd5/External` |

**How it works.** Without `companyUrls`, the Actor searches a compact search index of every job board in our directory, rebuilt daily from the ATS APIs. It downloads only the index parts for your chosen ATSs and date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then fetches the full description live from the company's ATS (one API call per company), which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$3.00 per 1,000** ($0.003 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-09-25: **345,976 open jobs** on **10,918 company job boards**.

| ATS | Company boards | Open jobs |
|---|---|---|
| Greenhouse | 3,782 | 149,646 |
| Workable | 1,940 | 78,318 |
| Ashby | 2,836 | 54,511 |
| Lever | 1,604 | 50,718 |
| Recruitee | 756 | 12,783 |

Boards were discovered from Common Crawl's public URL index and validated against each ATS API. Every indexed board had at least one open job when last checked. A company that isn't indexed yet works in live mode through `companyUrls`.

## Sources and terms

Only official, public, unauthenticated job-board APIs that the ATS vendors publish for displaying and syndicating open jobs. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

| ATS | API | Reuse terms |
|---|---|---|
| Greenhouse | [Job Board API](https://developers.greenhouse.io/job-board.html) | "Job Board data is publicly available"; no authentication for GET |
| Lever | [Postings API](https://github.com/lever/postings-api) | Published postings "are publicly viewable" and "may be scraped by third parties"; we respect its 1 request/s crawl delay |
| Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | Public, unauthenticated posting API |
| Workable | [Public jobs endpoint](https://help.workable.com/hc/en-us/articles/115012771647) | Documented public endpoint for published jobs; paced at one request per 3 s |
| Recruitee | [Careers Site API](https://docs.recruitee.com/reference/offers) | Public API returning published offers |
| Workday | Public career sites (`<company>.<wdN>.myworkdayjobs.com/<site>`) | Not a vendor-documented API: the job list and job pages each site loads for its visitors. Each host's robots.txt is checked first (career sites allow `/<site>/`); about 4 requests/s across all Workday hosts |

SmartRecruiters is deliberately **not** included, because its API host's robots.txt disallows automated access.

## factpipe Jobs & Hiring Data

All four Actors search the same daily index of 345,976 open jobs from 10,918 company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper) (this Actor): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.

## FAQ

**Do I need a Greenhouse, Lever or Ashby account or API key?**
No. These are the public job-board APIs that power each company's careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: `job-boards.greenhouse.io/`**`gitlab`**, `jobs.lever.co/`**`acme`**. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against the ATS during your run. Live mode (`companyUrls`) always reads the ATS directly.

**Why is there no salary on Greenhouse jobs?**
Greenhouse's public job-board API does not include pay ranges. Ashby, Lever and Recruitee publish them where the employer fills them in. We never extract or estimate salaries from free text.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official ATS APIs only. Retries with backoff, per-host rate limits (Lever 1 request/s, Workable one per 3 s), a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
