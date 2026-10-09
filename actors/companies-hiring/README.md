# Companies Hiring — Hiring Signals & Sales Leads by Role

<!-- factpipe:hero:start -->

**Find companies hiring for any role across 10,000+ company job boards (Greenhouse, Lever, Ashby, Workable, Recruitee): one row per company with open roles, hiring velocity and locations. $5 per 1,000 companies.**

| Company | Matching jobs | Open jobs | Posted 30d | Velocity |
|---|---|---|---|---|
| OpenAI | 106 | 827 | 283 | 0.34 |
| Bjak | 83 | 2300 | 1654 | 0.72 |
| Waymo | 38 | 356 | 103 | 0.29 |

*Real output from the “Companies hiring AI engineers” example, run on September 27, 2026.*

**Try a ready-made example:** [Companies hiring AI engineers](https://apify.com/factpipe/companies-hiring/examples/companies-hiring-ai-engineers) · [Companies hiring sales reps](https://apify.com/factpipe/companies-hiring/examples/companies-hiring-sales-reps) · [Fastest-hiring companies this month](https://apify.com/factpipe/companies-hiring/examples/fastest-hiring-companies) · [Companies hiring in Germany](https://apify.com/factpipe/companies-hiring/examples/companies-hiring-in-germany)

<!-- factpipe:hero:end -->

Find **companies that are hiring for a role right now**, as one row per company: how many matching jobs they have open, which titles, departments and locations, how fast they are posting, and a link to their careers page. The data comes from 10,900+ company job boards on Greenhouse, Lever, Ashby, Workable and Recruitee, read through their official public APIs and refreshed daily. Use it for **sales prospecting** (a company hiring 12 account executives is buying sales tools), **recruiting agencies** (who needs people like your candidates) and **market research** ("who is hiring AI engineers?"). **$5 per 1,000 companies**, and you pay only for the company rows you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["sales"]`, `minMatchingJobs: 3`, `maxResults: 20`. The run takes well under a minute.
2. You get the 20 companies with the most open sales jobs (sales in the title, department or team), each with its matching job titles, top departments and locations, remote share, hiring velocity and careers page.
3. That first run costs at most **$0.10** (20 companies × $0.005), which fits in Apify's free monthly credit. Then change the role (`["machine learning engineer"]`), add `locations: ["US"]`, or sort by `hiring_velocity` to find companies that are scaling fastest.

## What you get

One flat record per company. A company with job boards on several ATSs (for example an old Greenhouse board and a new Ashby board) is **one row**, and an opening listed on both boards is counted once:

```json
{
  "company_name": "Wayve",
  "company_board": "wayve",
  "ats": "greenhouse",
  "careers_url": "https://job-boards.greenhouse.io/wayve",
  "boards": [
    { "ats": "greenhouse", "token": "wayve", "careers_url": "https://job-boards.greenhouse.io/wayve", "open_jobs": 195 },
    { "ats": "ashby", "token": "wayve", "careers_url": "https://jobs.ashbyhq.com/wayve", "open_jobs": 183 }
  ],
  "ats_list": ["greenhouse", "ashby"],
  "careers_site_domain": null,
  "open_jobs_total": 207,
  "matching_jobs": 26,
  "matching_job_titles": [
    "Principal Machine Learning Engineer GAIA",
    "Machine Learning Engineer, Compiler",
    "Machine Learning Engineer",
    "Senior Machine Learning Engineer - AV Core",
    "Machine Learning Engineer, Driving Product"
  ],
  "departments_hiring": [
    { "department": "AV Engineering", "jobs": 9 },
    { "department": "Simulation, Evaluation, Validation", "jobs": 7 },
    { "department": "AI Platform", "jobs": 6 },
    { "department": "Product & Delivery", "jobs": 4 }
  ],
  "locations_hiring": [
    { "location": "London, United Kingdom", "jobs": 9 },
    { "location": "Sunnyvale, California USA", "jobs": 8 },
    { "location": "London", "jobs": 4 },
    { "location": "Sunnyvale", "jobs": 3 },
    { "location": "Herzliya, Israel", "jobs": 2 }
  ],
  "remote_share": 0,
  "newest_posting_at": "2026-09-24T15:22:21.313Z",
  "jobs_posted_last_30d": 78,
  "hiring_velocity": 0.38,
  "sample_job_urls": [
    "https://jobs.ashbyhq.com/wayve/e781b706-4494-472d-8831-74140ad1a10e",
    "https://jobs.ashbyhq.com/wayve/02628ce9-b78d-48f7-ad0a-689e317e14d4",
    "https://wayve.firststage.co/jobs?gh_jid=8752478002"
  ],
  "source_url": "https://boards-api.greenhouse.io/v1/boards/wayve/jobs?content=true",
  "fetched_at": "2026-09-25T03:19:24.360Z"
}
```

(A real row from a `["machine learning engineer"]` search on the 2026-09-25 index. Wayve lists most of its jobs on both Greenhouse and Ashby: 195 + 183 board listings, 207 distinct open jobs. `matching_job_titles` is shortened here: the Actor returns up to 10.)

| Field | Meaning |
|---|---|
| `open_jobs_total` | All open jobs of the company across its boards, whatever your filters (an opening on two boards counts once) |
| `matching_jobs` | Open jobs matching your keywords and filters |
| `matching_job_titles` | Up to 10 distinct matching titles, most relevant first |
| `departments_hiring`, `locations_hiring` | Top 5 departments/teams and locations of the matching jobs, with counts |
| `remote_share` | Share (0–1) of the matching jobs that are remote |
| `newest_posting_at` | Newest matching posting |
| `jobs_posted_last_30d` | Jobs on the board first posted in the last 30 days (matching or not) |
| `hiring_velocity` | `jobs_posted_last_30d / open_jobs_total`, rounded to 2 decimals. 1.0 means every open job is less than a month old |
| `careers_site_domain` | The domain the company's job posts link to, when that is not the ATS itself. This is **often a dedicated careers site** (`withwaymo.com`, `coupang.jobs`, `weareroku.com`), **not necessarily the company's main website**, so check it before using it as the company domain. `null` when all job links point to the ATS. We never guess a domain from the company name |
| `company_board`, `ats`, `careers_url`, `source_url` | The company's board with the most matching jobs: its token, ATS, public job-board page and the ATS API it was read from |
| `boards` | Every job board of the company: `{ats, token, careers_url, open_jobs}` (`open_jobs` per board, before cross-board de-duplication) |
| `ats_list` | The ATSs those boards use |
| `sample_job_urls` | Up to 3 matching job postings |

**Company data only.** Rows describe employers and their open roles. No recruiter, hiring-manager or employee names, e-mails or profiles are collected.

## Use cases

- **Sales prospecting**: companies hiring SDRs and account executives are growing their sales team, and will buy CRM, sales engagement and enablement tools. Companies hiring security engineers need security tooling. Export the list to your CRM and reach out while the budget is fresh.
- **Recruiting agencies**: find the companies with the most open roles in your niche ("data engineer", "nurse", "controller") and in your region, with the careers page to check first.
- **Investor and market research**: "who is hiring AI engineers?", which companies are scaling (high `hiring_velocity`), where teams are being built (`locations_hiring`), how remote-friendly a segment is (`remote_share`).
- **Competitive intelligence**: track which teams your competitors are growing, week by week.

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Roles, case-insensitive ("sales", "account executive", "ML engineer"). A title match counts first. Empty = count all open jobs |
| `keywordScope` | `title` \| `title_and_department` \| `title_and_description` | Default `title_and_department`: a job counts when a keyword is in its title, department or team |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `locations` | string[] | Only count jobs in these places: text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \| `remote_only` \| `onsite_only` | Only count remote (or non-remote) jobs |
| `departments` | string[] | Substring match on department or team |
| `postedWithinDays` | integer | Only count jobs posted in the last N days |
| `minMatchingJobs` | integer | Default 1. Only companies with at least this many matching jobs |
| `excludeCompanies` | string[] | Leave out these companies (your customers, your own company): names or board tokens |
| `sortBy` | `matching_jobs` \| `hiring_velocity` \| `newest` | Default `matching_jobs` (ties: more title matches first) |
| `maxResults` | integer | Default 100 company rows |

**How it works.** The Actor reads a compact search index of every job board in our directory, rebuilt daily from the ATS APIs, and aggregates it company by company. Keywords are matched the same way as in our jobs feeds: in the title first, then in the department or team. Boards are merged only when they are provably the same company (see Coverage), and the same opening listed on two boards (same normalized title and location, where location means the country when it is known) is counted once. It never stores a list of jobs, only running totals per company, so even "all companies hiring anything" finishes quickly.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `company-result` | **$5.00 per 1,000** ($0.005 each) | One company row delivered. **No start fee.** Runs with no matching company are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of 2026-09-25: **10,918 company job boards** with **345,976 open jobs**.

| ATS | Company boards | Open jobs |
|---|---|---|
| Greenhouse | 3,782 | 149,646 |
| Workable | 1,940 | 78,318 |
| Ashby | 2,836 | 54,511 |
| Lever | 1,604 | 50,718 |
| Recruitee | 756 | 12,783 |

`careers_site_domain` is known for about 5% of companies: those whose job links point to their own careers site, mostly on Greenhouse and Recruitee. For the rest it is `null`, and `careers_url` is the company's job board. The 10,918 boards make 10,865 company rows: 53 companies have two boards each (106 boards).

**When are two boards one company?** They must have the same company name, ignoring case, punctuation and legal suffixes such as Inc, Ltd or GmbH. They must also have either the same board token (`wayve` on Greenhouse and on Ashby; `lago-1` and `lago`) or provably the same openings: at least 3 shared jobs, or at least 30% of the smaller board's jobs. A shared name alone is not enough. We would rather list a company twice than merge two different companies: "Zip" (procurement software) and "Zip Co" (payments), or "Parallel" and "Parallel Learning", stay separate rows. Similar-looking names can therefore appear more than once, and `boards` shows which job board each row covers. Boards were discovered from Common Crawl's public URL index and validated against each ATS API.

## Sources and terms

Only official, public, unauthenticated job-board APIs that the ATS vendors publish for displaying and syndicating open jobs. No career-site HTML scraping, no logins, no LinkedIn.

| ATS | API | Reuse terms |
|---|---|---|
| Greenhouse | [Job Board API](https://developers.greenhouse.io/job-board.html) | "Job Board data is publicly available"; no authentication for GET |
| Lever | [Postings API](https://github.com/lever/postings-api) | Published postings "are publicly viewable" and "may be scraped by third parties" |
| Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | Public, unauthenticated posting API |
| Workable | [Public jobs endpoint](https://help.workable.com/hc/en-us/articles/115012771647) | Documented public endpoint for published jobs |
| Recruitee | [Careers Site API](https://docs.recruitee.com/reference/offers) | Public API returning published offers |
| Workday | Public career sites (`<company>.<wdN>.myworkdayjobs.com/<site>`) | Not a vendor-documented API: the job list and job pages each site loads for its visitors. Each host's robots.txt is checked first (career sites allow `/<site>/`); about 4 requests/s across all Workday hosts |

## factpipe Jobs & Hiring Data

All four Actors search the same daily index of 345,976 open jobs from 10,918 company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring) (this Actor): one row per company that is hiring for a role, as sales leads or market research.

## FAQ

**Does it give me contact people?**
No, by design. It gives company-level hiring signals: open roles, teams, locations and the careers page. Pair it with your own CRM or enrichment tool for contacts.

**How is "hiring velocity" calculated?**
Jobs first posted in the last 30 days divided by all open jobs on the board. A company with 40 open jobs, 30 of them posted this month, has velocity 0.75: it is actively adding roles, not just leaving old ones open.

**How fresh is the data?**
The index is rebuilt daily from the ATS APIs. `fetched_at` is when the company's board was read.

**Can I get the individual jobs too?**
Yes: run [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed) with the same keywords and `companies` set to the companies you picked.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official ATS APIs only. Retries with backoff, a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
