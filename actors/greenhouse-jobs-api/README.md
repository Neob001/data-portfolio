# Greenhouse Jobs API — Search All Greenhouse Job Boards

<!-- factpipe:hero:start -->

**Search open jobs on 3,600+ Greenhouse job boards (Stripe, Databricks, Anthropic…) by keyword, location, remote and department, or fetch any Greenhouse board live. Full descriptions. $2 per 1,000 jobs.**

| Title | Company | Department | Locations | Workplace |
|---|---|---|---|---|
| Staff Software Engineer | Robinhood | ENG Data and AI Platform Division | New York, NY | unknown |
| Sr. Staff Software Engineer, Browser (New Produ… | Mozilla | New Products | Remote Canada | remote |
| Senior Software Engineer | Xometry | Software Engineering | North Bethesda, Maryland | unknown |

*Real output from the “Software Engineer jobs on Greenhouse job boards” example, run on October 9, 2026.*

**Try a ready-made example:** [Software Engineer jobs on Greenhouse job boards](https://apify.com/factpipe/greenhouse-jobs-api/examples/greenhouse-software-engineer-jobs) · [Remote jobs on Greenhouse job boards (last 7 days)](https://apify.com/factpipe/greenhouse-jobs-api/examples/greenhouse-remote-jobs)

<!-- factpipe:hero:end -->

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
  "seniority": "senior",
  "workplace_type": "remote",
  "locations": [
    "Remote - USA"
  ],
  "country_codes": [
    "US"
  ],
  "remote": true,
  "salary_min": 186065,
  "salary_max": 218900,
  "salary_currency": "USD",
  "salary_period": "year",
  "salary_source": "description",
  "years_experience_min": 5,
  "visa_sponsorship": null,
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

- Greenhouse's job-board API has no employment type or pay fields, so `employment_type` is always `null` here, and the `salary_*` fields come only from pay stated in the description text (`salary_source: "description"`, e.g. US pay-transparency ranges), otherwise `null`. They are never estimated. `posted_at` is the job's first publication date.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

**Enrichment (deterministic, no AI).** Every job gets `seniority` (`intern`, `entry`, `mid`, `senior`, `lead`, `manager`, `director`, `executive`), read from the title by fixed rules, including common German, French, Spanish, Dutch and Portuguese markers. It is `null` when the title has no level marker ("Software Engineer"): no guessing. When the run reads the job's full description (`includeDescription`, the default), the text also gives `years_experience_min` ("3+ years", "3–5 years" → 3), `visa_sponsorship` (`true` when offered, `false` when ruled out, `null` when not mentioned) and, for jobs without structured pay, the pay stated in the text (`salary_source: "description"`; the ATS's own pay fields are `structured` and never overwritten). Without the description these three stay `null`. Same input, same output: no language model, no estimates.

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
| `seniority` | string[] | `intern`, `entry`, `mid`, `senior`, `lead`, `manager`, `director`, `executive`, read from the job title. Jobs whose title has no level marker are excluded when this is set |
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
- [Greenhouse, Lever, Ashby & Workday Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api) (this Actor): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.
- [Workday Jobs API](https://apify.com/factpipe/workday-jobs-api): every Workday career site in our directory (large employers), or any Workday site live.

## FAQ

**Do I need a Greenhouse account or API key?**
No. This is the public job-board API that powers each company's Greenhouse careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: `job-boards.greenhouse.io/`**`gitlab`**. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against Greenhouse during your run. Live mode (`companyUrls`) always reads Greenhouse directly.

**Do Greenhouse jobs include salary?**
Greenhouse's public job-board API has no pay fields. When the job description states pay (for example the pay-transparency range many US employers publish: "$186,065—$218,900 USD" under "Annual base salary range"), the run reads it from the text with fixed rules and fills `salary_min`, `salary_max`, `salary_currency` and `salary_period` with `salary_source: "description"`. Otherwise they stay `null`: pay is never estimated. This needs the description (`includeDescription`, the default). Employment type is not in the API and stays `null`. For structured pay fields, [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api) and [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) also return the ranges employers enter in their ATS.

**What happens to Lever, Ashby, Workable, Recruitee or Workday URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no Greenhouse board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever, Ashby & Workday Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other Greenhouse scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always Greenhouse), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

| You want | Use here |
|---|---|
| Company name, board token or board URL | `companies` (index) or `companyUrls` (live) |
| Job title / search query | `keywords` (+ `keywordScope: "title"` for titles only) |
| Location or country | `locations` (text or ISO code) |
| Remote only | `remote: "remote_only"` |
| Date posted | `postedWithinDays` |
| Experience level / seniority | `seniority` (filter) → `seniority`, `years_experience_min` |
| Result limit | `maxResults` |
| Job description | `includeDescription` → `description_text` |
| Job id / URL / apply link | `job_id` / `job_url` / `apply_url` |
| Company / location / date | `company_name` / `locations` / `posted_at` |

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official Greenhouse API only. Retries with backoff, per-host rate limits, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
