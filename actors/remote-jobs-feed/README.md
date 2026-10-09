# Remote Jobs API — Remote & Work-From-Home Jobs Feed

<!-- factpipe:hero:start -->

**Remote and work-from-home jobs from 10,000+ companies' official Greenhouse, Lever, Ashby, Workable and Recruitee job boards. Filter by region or time zone, ranked by relevance. $3 per 1,000 jobs.**

| Title | Company | Locations | Workplace | Salary min |
|---|---|---|---|---|
| Spanish Speaking Automotive Customer Service Ag… | Mercier Consultancy Group | Spain | remote | — |
| Customer Success Manager | Menlo Security | US - Distributed | remote | — |
| Director of Customer Success | Feathr | USA | remote | — |

*Real output from the “Remote customer support jobs” example, run on September 27, 2026.*

**Try a ready-made example:** [Remote customer support jobs](https://apify.com/factpipe/remote-jobs-feed/examples/remote-customer-support-jobs) · [Remote designer jobs open to Europe](https://apify.com/factpipe/remote-jobs-feed/examples/remote-designer-jobs-europe) · [Remote marketing jobs in the US](https://apify.com/factpipe/remote-jobs-feed/examples/remote-marketing-jobs-us)

<!-- factpipe:hero:end -->

Get **remote and work-from-home jobs from 6,000+ companies** in one feed, straight from the employers' own job boards on Greenhouse, Lever, Ashby, Workable and Recruitee. Filter by region or time zone ("US", "Europe", "EMEA", "Worldwide", "CET", "UTC-5"), keyword, company, department and posting date. Keyword searches are **ranked by relevance**, so jobs with your keyword in the title come first. You get flat, deduplicated JSON with apply links and salary ranges wherever the employer publishes them. **$3 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["developer"]`, `maxResults: 20`. Remote-only and "posted in the last 7 days" are built in. The run takes well under a minute.
2. You get the 20 most relevant remote developer jobs posted in the last week, each with company, locations, country codes, apply link and (where published) salary.
3. That first run costs at most **$0.06** (20 jobs × $0.003), which fits in Apify's free monthly credit. Add `timezonesOrRegions: ["Europe"]` (or "US", "Worldwide", "EST"...), or schedule the run daily with `sinceLastRun: true` to get only new remote jobs.

## What you get

One flat record per remote job opening:

```json
{
  "job_id": "ashby:ramp:d84bbf19-572a-499c-9c87-0c154ce85caf",
  "title": "Account Manager | Mid-Market",
  "company_name": "Ramp",
  "company_board": "ramp",
  "ats": "ashby",
  "department": "Sales",
  "team": "Account Manager",
  "employment_type": "full_time",
  "workplace_type": "remote",
  "locations": ["New York, NY (HQ)", "San Francisco, CA", "Remote (US)"],
  "country_codes": ["US"],
  "remote": true,
  "salary_min": 190000,
  "salary_max": 260000,
  "salary_currency": "USD",
  "salary_period": "year",
  "posted_at": "2025-06-05T17:33:32.680Z",
  "updated_at": null,
  "apply_url": "https://jobs.ashbyhq.com/ramp/d84bbf19-572a-499c-9c87-0c154ce85caf/application",
  "job_url": "https://jobs.ashbyhq.com/ramp/d84bbf19-572a-499c-9c87-0c154ce85caf",
  "description_text": "ABOUT RAMP\n\nRamp is building the smart infrastructure for finance teams…",
  "description_snippet": "ABOUT RAMP Ramp is building the smart infrastructure for finance teams, embedded in the transaction flow of every dollar a business spends…",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": 100,
  "matched_in": "title",
  "source_url": "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true",
  "fetched_at": "2026-09-25T03:40:12.000Z"
}
```

- Every job is marked remote by the employer: the ATS's own remote/workplace field, or the word "remote" (or "anywhere", "work from home") in its location. Hybrid jobs are included only when the ATS also flags them as open to remote candidates.
- `match_score` (0–100) and `matched_in` (`title`, `department` or `description`) show why a job matched your keywords. Both are `null` without keywords.
- Salary fields are filled only when the ATS publishes a structured pay range. They are never estimated.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Remote job boards and newsletters**: a daily feed of new remote jobs with direct apply links, filtered by region.
- **Job seekers and career coaches**: remote roles open to your time zone, with salary where published.
- **Remote-work research**: which companies hire remotely, for which roles, from which regions.
- **AI agents and RAG**: small input, flat deterministic JSON, full plain-text descriptions.

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `timezonesOrRegions` | string[] | `Worldwide` / `Anywhere`, `US`, `Canada`, `North America`, `LATAM`, `Americas`, `Europe`, `UK`, `EMEA`, `Middle East`, `Africa`, `APAC`, `Asia`, `ANZ`, time zones (`EST`, `PST`, `CET`, `GMT`, `IST`, `UTC-5`, `UTC+1`…) or any country name or ISO code. A job matches when its locations fall in one of them, **or when it says it is open anywhere / worldwide** |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Extra location text as written in the posting ("Remote (EU)") or ISO codes, OR-ed with the regions |
| `postedWithinDays` | integer | Default **7** |
| `companies` | string[] | Company names or board tokens |
| `ats` | string[] | `greenhouse`, `lever`, `ashby`, `workable`, `recruitee`, `workday` |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other` |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from the ATS for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | Live mode: fetch these job boards directly (remote jobs only) |

**How regions work.** A region is a list of country codes plus the words postings use for it. "Europe" matches jobs located in any European country, and jobs whose location says "Europe", "EU", "EMEA" or "CET". Country codes come from the ATS or from the location text ("Remote (US)" → US). Every region also includes jobs open worldwide ("Remote - Anywhere", "Worldwide", "Global"). For strict country matching, use `locations: ["US"]` instead.

**How it works.** The Actor searches a compact search index of every job board in our directory, rebuilt daily from the ATS APIs, and downloads only the parts that can match your filters. With keywords, it ranks every matching job before delivering the top `maxResults`. It then fetches the full description live from each company's ATS, which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$3.00 per 1,000** ($0.003 each) | One remote job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun` and jobs found closed are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-09-25: **85,567 remote jobs** from **6,047 companies**, of 345,976 open jobs on 10,918 company job boards. 8,666 of those remote jobs were posted in the 7 days before the build.

| ATS | Remote jobs in index |
|---|---|
| Ashby | 30,462 |
| Workable | 25,131 |
| Greenhouse | 16,394 |
| Lever | 11,968 |
| Recruitee | 1,612 |

Only 584 remote jobs say explicitly that they are open worldwide ("Anywhere", "Worldwide", "Global"). Most remote jobs are limited to a country or region, which is why `timezonesOrRegions` matters.

## Sources and terms

Only official, public, unauthenticated job-board APIs that the ATS vendors publish for displaying and syndicating open jobs. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

| ATS | API | Reuse terms |
|---|---|---|
| Greenhouse | [Job Board API](https://developers.greenhouse.io/job-board.html) | "Job Board data is publicly available"; no authentication for GET |
| Lever | [Postings API](https://github.com/lever/postings-api) | Published postings "are publicly viewable" and "may be scraped by third parties"; we respect its 1 request/s crawl delay |
| Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | Public, unauthenticated posting API |
| Workable | [Public jobs endpoint](https://help.workable.com/hc/en-us/articles/115012771647) | Documented public endpoint for published jobs |
| Recruitee | [Careers Site API](https://docs.recruitee.com/reference/offers) | Public API returning published offers |
| Workday | Public career sites (`<company>.<wdN>.myworkdayjobs.com/<site>`) | Not a vendor-documented API: the job list and job pages each site loads for its visitors. Each host's robots.txt is checked first (career sites allow `/<site>/`); about 4 requests/s across all Workday hosts |

## factpipe Jobs & Hiring Data

These Actors search the same daily index of 345,976 open jobs from 10,918 company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed) (this Actor): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.

## FAQ

**How is this different from remote job boards?**
Every job comes from the employer's own applicant tracking system through its official public API, so there are no reposts, expired listings or paywalled apply links. A job disappears from the feed once the employer closes it.

**Can I get only jobs open to my country?**
Yes. Put your country or region in `timezonesOrRegions` ("Germany", "Europe", "US"). Jobs limited to other regions are left out. Jobs open worldwide are included.

**How fresh is the data?**
The index is rebuilt daily, and each delivered job is re-checked live against the ATS when descriptions are on (the default).

**Can I get only new remote jobs every day?**
Yes. Schedule the Actor with `sinceLastRun: true`. Each run returns and charges only jobs no earlier run with the same filters delivered.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official ATS APIs only. Retries with backoff, per-host rate limits, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
