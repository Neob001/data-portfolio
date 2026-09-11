# Company Career Page Jobs Scraper — working (verified Sep 2026)

Give it **any company website** — it finds the careers page, detects the ATS, and pulls every live job posting through the **official public job-board APIs** of Greenhouse, Lever, and Ashby. No brittle HTML scraping of career pages, no anti-bot fights: the same JSON feeds the career pages themselves use. Direct board URLs (e.g. `boards.greenhouse.io/gitlab`) work too.

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

| Event | Meaning |
|---|---|
| `job-result` | One live job posting delivered. **Detection misses, empty boards, and empty runs are never charged.** |

## Reliability

Official ATS APIs, retries with backoff, structured failure reporting, health-checked daily, issues triaged daily.
