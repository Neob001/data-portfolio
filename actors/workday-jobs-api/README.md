# Workday Jobs API — Search Workday Career Sites

<!-- factpipe:hero:start -->

**Search open jobs on 4,000+ Workday career sites (NVIDIA, Salesforce, Adobe, Intel…) by keyword, location and remote, or read any myworkdayjobs.com site live. Full descriptions. $2 per 1,000 jobs.**

| Title | Company | Locations | Workplace | Employment |
|---|---|---|---|---|
| Senior Software Engineer | Abbott | United States - California - Sylmar | unknown | — |
| Internship: Software Engineer Avanade Agentic E… | Avanade | Brussels | unknown | full_time |
| Sr. Software Engineer - CloudOps | ACE | Coppell, TX | unknown | — |

*Real output from the “Software engineer jobs on Workday career sites” example, run on October 10, 2026.*

**Try a ready-made example:** [Software engineer jobs on Workday career sites](https://apify.com/factpipe/workday-jobs-api/examples/workday-software-engineer-jobs) · [Remote jobs on Workday career sites (last 7 days)](https://apify.com/factpipe/workday-jobs-api/examples/workday-remote-jobs)

<!-- factpipe:hero:end -->

A **Workday jobs API** and **Workday job scraper** in one: search open jobs on **4,796 Workday career sites** (NVIDIA, Salesforce, Adobe, Intel…) by keyword, location, remote and posting date, and get flat, deduplicated JSON: title, company, locations, country codes, remote flag, posting date, apply link and full description. Paste any Workday career-site URL ("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite") to read it live. **$2 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["engineer"]`, `maxResults: 20`, `maxPerCompany: 3`. The run usually takes under a minute.
2. You get the 20 most relevant Workday jobs for "engineer" at large employers (software, hardware, field and sales engineers…), at most 3 per company: jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.04 (20 jobs × $0.002)**, which fits in Apify's free monthly credit. Then name the companies you track (`companies: ["NVIDIA", "Salesforce"]`), add `locations` or `remote`, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening, from a real run:

```json
{
  "job_id": "workday:adobe.wd5/external_experienced:R171485",
  "title": "Senior Site Reliability Engineer - Observability",
  "company_name": "Adobe",
  "company_board": "adobe.wd5/external_experienced",
  "ats": "workday",
  "department": null,
  "team": null,
  "employment_type": null,
  "workplace_type": "unknown",
  "locations": [
    "Bucharest"
  ],
  "country_codes": [
    "RO"
  ],
  "remote": null,
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "salary_period": null,
  "posted_at": "2026-10-08T00:00:00.000Z",
  "updated_at": null,
  "apply_url": "https://adobe.wd5.myworkdayjobs.com/external_experienced/job/Bucharest/Senior-Site-Reliability-Engineer---Observability_R171485/apply",
  "job_url": "https://adobe.wd5.myworkdayjobs.com/external_experienced/job/Bucharest/Senior-Site-Reliability-Engineer---Observability_R171485",
  "description_text": "The Team\n\nWe are a globally distributed team inside Adobe Developer…",
  "description_snippet": "The Team We are a globally distributed team inside Adobe Developer Platforms. We own the observability platform Adobe's engineering ecosystem runs on…",
  "description_status": "included",
  "duplicate_sources": [
    "workday:adobe.wd5/external_experienced:R169504"
  ],
  "match_score": 100,
  "matched_in": "title",
  "source_url": "https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs",
  "fetched_at": "2026-10-09T11:29:47.802Z"
}
```

- `posted_at` is a **date derived from Workday's "Posted N Days Ago" label** when the site was read (UTC midnight; "Posted 30+ Days Ago" becomes 30 days before, meaning *30 days or more*, see the FAQ). Workday job lists publish no pay range or department, so the `salary_*`, `department` and `team` fields are `null` (never guessed). `workplace_type` comes from the site's remote type where shown (Remote, Hybrid, Flex, On-site), otherwise from the location text, and `employment_type` from its time type. Lists name only the primary location of a multi-location job; with `includeDescription` the delivered row lists every location.
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

- **Workday jobs API across employers**: one call searches thousands of Workday career sites (`*.myworkdayjobs.com`) instead of scripting each employer's job search page.
- **Workday job scraper for job boards and aggregators**: enterprise jobs (healthcare, finance, retail, manufacturing, tech) filtered by keyword, location and remote, refreshed daily with `sinceLastRun: true`.
- **Tracking specific employers**: `companies: ["NVIDIA", "Salesforce"]`, or their career-site URLs in `companyUrls`, scheduled daily.
- **Recruiting and sales intelligence**: which large employers are hiring which roles, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `keywordScope` | `title` \| `title_and_description` | Default `title_and_description` |
| `companies` | string[] | Company names (`NVIDIA`) or Workday board tokens (`nvidia.wd5/NVIDIAExternalCareerSite`). Empty = every Workday company in the index |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other`. Normalized from the time type a Workday site shows in its job list (Full time, Part time). Many sites don't show one; their jobs are excluded when this is set. |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from Workday for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: Workday board URLs or tokens, fetched directly from Workday. URLs of other platforms are ignored with a warning |

**Workday board references accepted in live mode:**

| Form | Example |
|---|---|
| Career site | `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`, also with a locale: `…/en-US/NVIDIAExternalCareerSite` |
| Job page | `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/…` (reads that job's whole site) |
| myworkdaysite.com | `https://wd1.myworkdaysite.com/recruiting/paypal/jobs` |
| Token | `nvidia.wd5/NVIDIAExternalCareerSite` or `workday:nvidia.wd5/NVIDIAExternalCareerSite` |

**How it works.** Without `companyUrls`, the Actor searches a compact search index of the Workday career sites in our directory, rebuilt daily from each site's public job list, and downloads only the Workday parts of it for your date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then reads the full description live from the site (one request per job), which also drops jobs closed since the nightly build (not delivered, not charged). Until the index holds Workday jobs, a search reads a few built-in Workday sites live instead.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Directory of 2026-10-09: **4,796 Workday career sites** listing **850,315 open jobs**, including NVIDIA, Salesforce, Adobe, Intel, Target, Boeing. The search index keeps the newest 300 jobs of each site (about half of all listed jobs); live mode reads up to 2,000 per site.

Sites were discovered from Common Crawl's public URL index and validated against each site's own job list (at least one open job, and robots.txt allows reading it). They join the daily search index with its nightly build. Any other Workday career site works in live mode through `companyUrls`.

## Sources and terms

Only the public career sites employers publish on Workday (`<company>.<wdN>.myworkdayjobs.com/<site>`): the same job list and job pages any visitor sees, read through the JSON endpoint those pages load. Before reading a site we check its host's robots.txt (career sites allow `/<site>/`; a site whose rules disallow its job pages or that endpoint is skipped), send a descriptive User-Agent, read one page at a time per site, keep to a few requests per second across all Workday hosts (4/s in this Actor, under 7/s in the nightly index build) and back off on HTTP 429. Job data only: no candidate or recruiter profiles, no logins (`myworkday.com` tenant apps are never touched), no LinkedIn or Indeed.

## factpipe Jobs Data

All of these Actors search the same daily index of open jobs from 10,000+ company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job from every platform, every filter, ranked by relevance.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.
- [Workday Jobs API](https://apify.com/factpipe/workday-jobs-api) (this Actor): every Workday career site in our directory (large employers), or any Workday site live.

## FAQ

**Do I need a Workday account or API key?**
No. Workday career sites are public: these are the job lists and job pages any visitor of the employer's careers site sees. No key, no login.

**How do I find a company's board token?**
It is `<company>.<wdN>/<site>` from the career-site URL: `https://`**`nvidia.wd5`**`.myworkdayjobs.com/`**`NVIDIAExternalCareerSite`** is `nvidia.wd5/NVIDIAExternalCareerSite`. Or paste the URL itself, or type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against Workday during your run. Live mode (`companyUrls`) always reads Workday directly.

**How is `posted_at` derived for Workday jobs?**
Workday career sites show a relative label instead of a date: "Posted Today", "Posted Yesterday", "Posted 5 Days Ago" or "Posted 30+ Days Ago". We turn it into a date relative to when the site was read (nightly for the index, during your run in live mode): today, yesterday, 5 days earlier, and for "30+" exactly 30 days earlier, which means *30 days or more*. The date is set to UTC midnight, so it can be a day off around midnight in the employer's time zone. `postedWithinDays` and `sinceLastRun` use this date.

**Which Workday URLs work in `companyUrls`?**
Any page of a public Workday career site on `myworkdayjobs.com` (with or without a locale such as `/en-US/`), a job URL (its whole site is read), or the `myworkdaysite.com/recruiting/<company>/<site>` form. Internal Workday tenants on `myworkday.com` need a login and are not supported.

**Do keywords search Workday job descriptions?**
In the daily index, keywords match job titles: Workday job lists carry no description. With `includeDescription` (the default) every delivered job's full description is read live from its site. In live mode (`companyUrls`), too, keywords match titles.

**Do you respect robots.txt and rate limits?**
Yes. Before reading a Workday site we read its host's robots.txt and skip any site whose rules disallow its job pages or the JSON endpoint they load. Requests are spaced (one at a time per site; at most 4 per second across all Workday hosts in this Actor, under 7 per second in the nightly index build) and back off on HTTP 429 and `Retry-After`.

**Do I get every job of employers with thousands of openings?**
Workday itself lists at most 2,000 jobs per site. Live mode reads up to 2,000 per site, newest first, within a 2.5-minute budget per site; the nightly index keeps the newest 300 per site. `RUN_SUMMARY` counts the sites that were cut short (`boards_truncated`).

**What happens to Greenhouse, Lever, Ashby, Workable or Recruitee URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no Workday board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other Workday scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always Workday), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

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

Public Workday career sites only, robots.txt checked per host. Retries with backoff (honouring `Retry-After`), a polite global request rate, a time budget per site so a 2,000-job site never stalls a run, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is unreachable or has no Workday jobs yet.
