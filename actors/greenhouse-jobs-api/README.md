# Greenhouse Jobs API — Search All Greenhouse Job Boards

A **Greenhouse jobs API** and **Greenhouse job board scraper** in one: search every open job on **3,698 Greenhouse company job boards** (Stripe, Databricks, Anthropic, Datadog, Cloudflare, GitLab…) by keyword, location, remote, department and posting date, and get flat, deduplicated JSON: title, department, locations, country codes, remote flag, apply link and full description. Paste any Greenhouse board URL ("https://job-boards.greenhouse.io/gitlab") to fetch it live. **$2 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["software engineer"]`, `maxResults: 20`, `maxPerCompany: 3`. The run usually takes under a minute.
2. You get the 20 most relevant Greenhouse jobs for "software engineer" (backend, frontend, machine learning, platform…), at most 3 per company: jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.04 (20 jobs × $0.002)**, which fits in Apify's free monthly credit. Then name the companies you track (`companies: ["Stripe", "Datadog"]`), add `locations` or `remote`, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening, from a real run:

```json
{
  "job_id": "greenhouse:coinbase:8174232",
  "title": "Senior Software Engineer, Backend/Fullstack (Coinbase Advisor - Agentic Trading)",
  "company_name": "Coinbase",
  "company_board": "coinbase",
  "ats": "greenhouse",
  "department": "Engineering",
  "team": null,
  "employment_type": null,
  "workplace_type": "remote",
  "locations": [
    "Remote - USA"
  ],
  "country_codes": [
    "US"
  ],
  "remote": true,
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "salary_period": null,
  "posted_at": "2026-10-08T23:50:37.000Z",
  "updated_at": "2026-10-08T23:50:38.000Z",
  "apply_url": "https://www.coinbase.com/careers/positions/8174232?gh_jid=8174232",
  "job_url": "https://www.coinbase.com/careers/positions/8174232?gh_jid=8174232",
  "description_text": "Ready to do the most impactful work of your career? At Coinbase, we…",
  "description_snippet": "Ready to do the most impactful work of your career? At Coinbase, we are uncompromising on our mission to increase economic freedom. The bar…",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": 100,
  "matched_in": "title",
  "source_url": "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true",
  "fetched_at": "2026-10-09T03:18:53.181Z"
}
```

- Greenhouse's job-board API has no employment type or pay range, so `employment_type` and the `salary_*` fields are always `null` here. They are never guessed. `posted_at` is the job's first publication date.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Greenhouse API without integration work**: one call returns jobs from thousands of Greenhouse boards in one flat schema, instead of polling `boards-api.greenhouse.io` board by board.
- **Greenhouse job board scraper for aggregators**: feed a niche job board with Greenhouse jobs filtered by keyword, location and department, refreshed daily with `sinceLastRun: true`.
- **Tracking specific companies**: `companies: ["Stripe", "Datadog"]`, scheduled daily, to see new Greenhouse openings as they appear.
- **Recruiting and sales intelligence**: who is hiring which team, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `companies` | string[] | Company names (`Stripe`) or Greenhouse board tokens (`stripe`). Empty = every Greenhouse company in the index |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other`. Greenhouse's job-board API does not state an employment type, so Greenhouse jobs have none and are excluded when this is set. |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from Greenhouse for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: Greenhouse board URLs or tokens, fetched directly from Greenhouse. URLs of other platforms are ignored with a warning |

**Greenhouse board references accepted in live mode:**

| Form | Example |
|---|---|
| Board page | `https://job-boards.greenhouse.io/gitlab`, `https://boards.greenhouse.io/gitlab` |
| Embedded board | `https://boards.greenhouse.io/embed/job_board?for=gitlab` |
| API URL | `https://boards-api.greenhouse.io/v1/boards/gitlab` |
| Token | `gitlab` or `greenhouse:gitlab` |

**How it works.** Without `companyUrls`, the Actor searches a compact search index of every Greenhouse board in our directory, rebuilt daily from Greenhouse's public API, and downloads only the Greenhouse parts of it for your date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then fetches the full description live from Greenhouse (one API call per company), which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-10-09: **148,132 open jobs** on **3,698 Greenhouse company job boards**, including Stripe, Databricks, Anthropic, Datadog, Cloudflare, GitLab.

Boards were discovered from Common Crawl's public URL index and validated against Greenhouse's API. Every indexed board had at least one open job when last checked. A company that isn't indexed yet works in live mode through `companyUrls`.

## Sources and terms

Only Greenhouse's official, public, unauthenticated [Job Board API](https://developers.greenhouse.io/job-board.html), which Greenhouse publishes for displaying and syndicating open jobs: "Job Board data is publicly available"; no authentication for GET. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

## factpipe Jobs Data

All of these Actors search the same daily index of open jobs from 10,000+ company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job from every platform, every filter, ranked by relevance.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api) (this Actor): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.

## FAQ

**Do I need a Greenhouse account or API key?**
No. This is the public job-board API that powers each company's Greenhouse careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: `job-boards.greenhouse.io/`**`gitlab`**. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against Greenhouse during your run. Live mode (`companyUrls`) always reads Greenhouse directly.

**Why is there no salary or employment type on Greenhouse jobs?**
Greenhouse's public job-board API does not include pay ranges or employment types. We never extract or estimate them from free text. For pay data, [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api) and [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) return the ranges employers publish.

**What happens to Lever, Ashby, Workable or Recruitee URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no Greenhouse board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other Greenhouse scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always Greenhouse), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

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

Official Greenhouse API only. Retries with backoff, per-host rate limits, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
