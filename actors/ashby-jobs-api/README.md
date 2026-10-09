# Ashby Jobs API — Search All Ashby Job Boards

A **Ashby jobs API** and **Ashby job board scraper** in one: search every open job on **2,790 Ashby company job boards** (OpenAI, Ramp, Notion, Snowflake, Harvey, Perplexity…) by keyword, location, remote, department and posting date, and get flat, deduplicated JSON: title, department, locations, country codes, remote flag, salary range (where the employer publishes one), employment type, apply link and full description. Paste any Ashby board URL ("https://jobs.ashbyhq.com/ramp") to fetch it live. **$2 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["engineer"]`, `maxResults: 20`, `maxPerCompany: 3`. The run usually takes under a minute.
2. You get the 20 most relevant Ashby jobs for "engineer", mostly at venture-backed startups, at most 3 per company: jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.04 (20 jobs × $0.002)**, which fits in Apify's free monthly credit. Then name the companies you track (`companies: ["OpenAI", "Ramp"]`), add `locations` or `remote`, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening, from a real run:

```json
{
  "job_id": "ashby:fal-ai:70031914-e873-451d-8d17-712bada15563",
  "title": "Senior Software Engineer, Machine Learning Infrastructure & Automation",
  "company_name": "fal",
  "company_board": "fal-ai",
  "ats": "ashby",
  "department": "Engineering",
  "team": "ML",
  "employment_type": "full_time",
  "workplace_type": "remote",
  "locations": [
    "Remote - USA"
  ],
  "country_codes": [
    "US"
  ],
  "remote": true,
  "salary_min": 170000,
  "salary_max": 230000,
  "salary_currency": "USD",
  "salary_period": "year",
  "posted_at": "2026-10-09T00:48:32.515Z",
  "updated_at": null,
  "apply_url": "https://jobs.ashbyhq.com/fal-ai/70031914-e873-451d-8d17-712bada15563/application",
  "job_url": "https://jobs.ashbyhq.com/fal-ai/70031914-e873-451d-8d17-712bada15563",
  "description_text": "fal is the generative media ecosystem powering the next generation of…",
  "description_snippet": "fal is the generative media ecosystem powering the next generation of AI products. We build the infrastructure, tools, and model access…",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": 100,
  "matched_in": "title",
  "source_url": "https://api.ashbyhq.com/posting-api/job-board/fal-ai?includeCompensation=true",
  "fetched_at": "2026-10-09T03:18:48.297Z"
}
```

- `employment_type`, `workplace_type` and `remote` come from Ashby's own fields, and the `salary_*` fields from the compensation the employer publishes on Ashby (otherwise `null`, never guessed). `posted_at` is the publication date; Ashby has no update date, so `updated_at` is `null`.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Ashby jobs API across every company**: one call searches thousands of Ashby boards instead of calling the Ashby posting API company by company.
- **Ashby job board scraper for startup job boards**: Ashby is popular with venture-backed startups, so it is a strong source for startup and AI jobs, with salary ranges where published.
- **Tracking specific companies**: `companies: ["OpenAI", "Ramp"]`, scheduled daily with `sinceLastRun: true`.
- **Investor and sales intelligence**: which startups are hiring which teams, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `companies` | string[] | Company names (`Ramp`) or Ashby board tokens (`ramp`). Empty = every Ashby company in the index |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other`. Normalized from Ashby's employment type (FullTime, PartTime, Contract, Intern, Temporary). Jobs without one are excluded when this is set. |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from Ashby for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: Ashby board URLs or tokens, fetched directly from Ashby. URLs of other platforms are ignored with a warning |

**Ashby board references accepted in live mode:**

| Form | Example |
|---|---|
| Board page | `https://jobs.ashbyhq.com/ramp` (any page of the board) |
| API URL | `https://api.ashbyhq.com/posting-api/job-board/ramp` |
| Token | `ramp` or `ashby:ramp` |

**How it works.** Without `companyUrls`, the Actor searches a compact search index of every Ashby board in our directory, rebuilt daily from Ashby's public API, and downloads only the Ashby parts of it for your date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then fetches the full description live from Ashby (one API call per company), which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-10-09: **54,302 open jobs** on **2,790 Ashby company job boards**, including OpenAI, Ramp, Notion, Snowflake, Harvey, Perplexity.

Boards were discovered from Common Crawl's public URL index and validated against Ashby's API. Every indexed board had at least one open job when last checked. A company that isn't indexed yet works in live mode through `companyUrls`.

## Sources and terms

Only Ashby's official, public, unauthenticated [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api), which Ashby publishes for displaying and syndicating open jobs: Public, unauthenticated posting API. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

## factpipe Jobs Data

All of these Actors search the same daily index of open jobs from 10,000+ company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job from every platform, every filter, ranked by relevance.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) (this Actor): every Ashby job board: startup and AI jobs, with salary where published.

## FAQ

**Do I need an Ashby account or API key?**
No. This is the public job-board API that powers each company's Ashby careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: `jobs.ashbyhq.com/`**`ramp`**. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against Ashby during your run. Live mode (`companyUrls`) always reads Ashby directly.

**Does it include Ashby salary ranges?**
Yes, where the employer publishes compensation on Ashby. The run requests Ashby's compensation data and maps the salary (or hourly) range to `salary_min`, `salary_max`, `salary_currency` and `salary_period`.

**What happens to Greenhouse, Lever, Workable or Recruitee URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no Ashby board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other Ashby scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always Ashby), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

| You want | Use here |
|---|---|
| Company name, board token or board URL | `companies` (index) or `companyUrls` (live) |
| Job title / search query | `keywords` (+ `keywordScope: "title"` for titles only) |
| Location or country | `locations` (text or ISO code) |
| Remote only | `remote: "remote_only"` |
| Date posted | `postedWithinDays` |
| Result limit | `maxResults` |
| Job description | `includeDescription` → `description_text` |
| Job id / URL / apply link | `job_id` / `job_url` / `apply_url` |
| Company / location / date | `company_name` / `locations` / `posted_at` |

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official Ashby API only. Retries with backoff, per-host rate limits, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
