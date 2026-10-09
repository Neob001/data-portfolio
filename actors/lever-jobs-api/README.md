# Lever Jobs API — Search All Lever Job Postings

A **Lever jobs API** and **Lever job board scraper** in one: search every open job on **1,574 Lever company job boards** (Palantir, Spotify, Zoox, Shield AI, Veeva, Gopuff…) by keyword, location, remote, department and posting date, and get flat, deduplicated JSON: title, department, locations, country codes, remote flag, salary range (where the employer publishes one), employment type, apply link and full description. Paste any Lever board URL ("https://jobs.lever.co/palantir") to fetch it live. **$2 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["sales"]`, `maxResults: 20`, `maxPerCompany: 3`. The run usually takes under a minute.
2. You get the 20 most relevant Lever jobs for "sales" (account executives, sales development, sales engineers…), at most 3 per company: jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.04 (20 jobs × $0.002)**, which fits in Apify's free monthly credit. Then name the companies you track (`companies: ["Palantir", "Spotify"]`), add `locations` or `remote`, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening, from a real run:

```json
{
  "job_id": "lever:pointclickcare:5aaaf912-ca44-4ccf-a307-9178e6a152ab",
  "title": "(US) Sales Development Representative",
  "company_name": "PointClickCare",
  "company_board": "pointclickcare",
  "ats": "lever",
  "department": "Acute & Payer",
  "team": "Sales",
  "employment_type": "full_time",
  "workplace_type": "remote",
  "locations": [
    "Remote, USA"
  ],
  "country_codes": [
    "US"
  ],
  "remote": true,
  "salary_min": 76000,
  "salary_max": 85000,
  "salary_currency": "USD",
  "salary_period": "year",
  "posted_at": "2026-10-08T15:01:24.432Z",
  "updated_at": null,
  "apply_url": "https://jobs.lever.co/pointclickcare/5aaaf912-ca44-4ccf-a307-9178e6a152ab/apply",
  "job_url": "https://jobs.lever.co/pointclickcare/5aaaf912-ca44-4ccf-a307-9178e6a152ab",
  "description_text": "At PointClickCare our mission is simple: to help providers deliver…",
  "description_snippet": "At PointClickCare our mission is simple: to help providers deliver exceptional care. And that starts with our people. As a leading health…",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": 100,
  "matched_in": "title",
  "source_url": "https://api.lever.co/v0/postings/pointclickcare?mode=json",
  "fetched_at": "2026-10-09T03:35:17.669Z"
}
```

- `employment_type` comes from Lever's commitment field, `workplace_type` from its workplace setting, and the `salary_*` fields from the pay range the employer publishes on Lever (otherwise `null`, never guessed). `posted_at` is the posting's creation date; Lever has no update date, so `updated_at` is `null`.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Lever postings API for every company at once**: one call searches thousands of Lever boards instead of calling `api.lever.co/v0/postings/<company>` one by one.
- **Lever jobs scraper for job boards**: Lever jobs filtered by keyword, location, remote and department, with salary ranges where the employer publishes them.
- **Tracking specific companies**: `companies: ["Palantir", "Spotify"]`, scheduled daily with `sinceLastRun: true`.
- **Sales and recruiting intelligence**: which teams companies on Lever are growing, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `companies` | string[] | Company names (`Palantir`) or Lever board tokens (`palantir`). Empty = every Lever company in the index |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other`. Normalized from Lever's commitment field (Full-time, Part-time, Contract, Intern…). Jobs without one are excluded when this is set. |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from Lever for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: Lever board URLs or tokens, fetched directly from Lever. URLs of other platforms are ignored with a warning |

**Lever board references accepted in live mode:**

| Form | Example |
|---|---|
| Board page | `https://jobs.lever.co/palantir` (any page of the board) |
| EU board | `https://jobs.eu.lever.co/acme` |
| API URL | `https://api.lever.co/v0/postings/palantir` |
| Token | `palantir`, `lever:palantir` or `lever:eu:acme` |

**How it works.** Without `companyUrls`, the Actor searches a compact search index of every Lever board in our directory, rebuilt daily from Lever's public API, and downloads only the Lever parts of it for your date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then fetches the full description live from Lever (one API call per company), which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-10-09: **50,951 open jobs** on **1,574 Lever company job boards**, including Palantir, Spotify, Zoox, Shield AI, Veeva, Gopuff.

Boards were discovered from Common Crawl's public URL index and validated against Lever's API. Every indexed board had at least one open job when last checked. A company that isn't indexed yet works in live mode through `companyUrls`.

## Sources and terms

Only Lever's official, public, unauthenticated [Postings API](https://github.com/lever/postings-api), which Lever publishes for displaying and syndicating open jobs: Published postings "are publicly viewable" and "may be scraped by third parties"; we respect its 1 request/s crawl delay. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

## factpipe Jobs Data

All of these Actors search the same daily index of open jobs from 10,000+ company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job from every platform, every filter, ranked by relevance.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api) (this Actor): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.

## FAQ

**Do I need a Lever account or API key?**
No. This is the public job-board API that powers each company's Lever careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: `jobs.lever.co/`**`palantir`**. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against Lever during your run. Live mode (`companyUrls`) always reads Lever directly.

**Are EU Lever boards (jobs.eu.lever.co) supported?**
Yes. EU boards are in the index like any other, and in live mode `https://jobs.eu.lever.co/<company>` or `lever:eu:<company>` reads Lever's EU API.

**Why is a Lever run with full descriptions slower?**
Lever's API asks crawlers for one request per second, and we respect that. Full descriptions need one request per company, so 20 jobs from 7 companies add about 7 seconds. Set `includeDescription: false` if the 300-character snippet is enough.

**What happens to Greenhouse, Ashby, Workable or Recruitee URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no Lever board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other Lever scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always Lever), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

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

Official Lever API only. Retries with backoff, per-host rate limits (Lever 1 request/s), a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
