# Career Page Jobs Scraper — Greenhouse, Lever & Ashby API

<!-- factpipe:hero:start -->

**Paste company websites: finds each careers page, detects Greenhouse, Lever or Ashby and returns every open job (title, location, remote, department, apply link) as flat JSON. $2 per 1,000 jobs.**

| Company | Title | Location | Department | Published at |
|---|---|---|---|---|
| GitLab | AI Engineer | Remote, Bangalore | — | 2026-05-22 |
| GitLab | AI Transformation Owner, CRO | Remote, United States | — | 2026-07-22 |
| GitLab | AI Transformation Owner, Product & Design | Remote, Canada; Remote, United Kingdom; Remote,… | — | 2026-08-19 |

*Real output from the “Scrape jobs from company career pages” example, run on September 27, 2026.*

**Try a ready-made example:** [Scrape jobs from company career pages](https://apify.com/factpipe/company-jobs-scraper/examples/scrape-career-pages)

<!-- factpipe:hero:end -->

Give it **any company website** — it finds the careers page, detects the ATS, and pulls every live job posting through the **official public job-board APIs** of Greenhouse, Lever, and Ashby. No brittle HTML scraping of career pages, no anti-bot fights: the same JSON feeds the career pages themselves use. Direct board URLs (e.g. `boards.greenhouse.io/gitlab`) work too.

## Quick start

1. Click **Start** with the two prefilled career pages (GitLab on Greenhouse, Ramp on Ashby). It finishes in under a minute.
2. You get up to 25 open jobs per company with title, location, department and apply link.
3. That first run costs at most $0.10, well within Apify's free monthly credit. Then swap in your own input or schedule it.

## What you get

One flat record per live job posting:

```json
{
  "query": "https://boards.greenhouse.io/gitlab",
  "found": true,
  "ats": "greenhouse",
  "board": "gitlab",
  "company": "GitLab",
  "job_id": "855665800",
  "title": "Senior Backend Engineer",
  "department": null,
  "location": "Remote",
  "remote": true,
  "employment_type": null,
  "published_at": "2026-08-14",
  "job_url": "https://job-boards.greenhouse.io/gitlab/jobs/855665800",
  "apply_url": "https://job-boards.greenhouse.io/gitlab/jobs/855665800",
  "source_url": "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs",
  "fetched_at": "2026-09-12T12:00:00.000Z"
}
```

## Use cases

- **Recruiting & talent intelligence**: track competitors' live openings by team and location.
- **Sales signals**: hiring bursts reveal budgets and priorities — feed your CRM on a schedule.
- **Job boards & aggregators**: clean, deduplicated postings straight from source APIs.
- **AI agents**: tiny input schema, deterministic output — ideal via API or MCP.

## Switching from another career-page scraper

Same idea, same inputs: a list of company URLs in, flat job records out. Field mapping: `text/title → title`, `hostedUrl/absolute_url → job_url`, `categories.location/location.name → location`. Plus `source_url` and `fetched_at` on every record. **You are only charged per job row delivered — companies where no supported ATS is detected are free.**

## Input

| Field | Type | Notes |
|---|---|---|
| `companyUrls` | string[], required | Company homepages or direct Greenhouse/Lever/Ashby board URLs |
| `maxJobsPerCompany` | integer | Cap on charged rows per company (default 200) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One live job posting delivered. **Detection misses, empty boards, and empty runs are never charged.** |

Example: 1,000 jobs cost **$2.00**. You only pay for delivered results.

## factpipe Jobs & Hiring Data

This Actor fetches jobs live from the career pages you give it. For search across many companies at once, the Actors below query a daily index of about 346,000 open jobs from 10,900 company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.

## FAQ

**Which applicant tracking systems are supported?**
Greenhouse, Lever and Ashby, via their official public job-board APIs. Give a company homepage and the Actor detects the ATS, or pass a board URL directly.

**Can I track hiring at many companies on a schedule?**
Yes. Put a list of company URLs in `companyUrls` and schedule the Actor; each run returns every live posting with title, department, location, remote flag and apply URL.

**What if a company uses another ATS?**
The company is reported as not found and nothing is charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official ATS APIs, retries with backoff, structured failure reporting, health-checked daily, issues triaged daily.
