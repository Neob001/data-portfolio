# Career Page Scraper — Jobs from Any Company Careers Page

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

Give it **any company website or careers page**: it finds the careers page, detects the job platform behind it and pulls every live job posting from that platform's **public job-board API or feed**. Eight platforms are supported: **Greenhouse, Lever, Ashby, Workable, Recruitee, Workday, Personio and Teamtailor** (incl. Teamtailor career sites on the company's own domain). No browser, no anti-bot fights: the same JSON and XML feeds the career pages themselves use. Direct board URLs (e.g. `boards.greenhouse.io/gitlab`) work too.

## Quick start

1. Click **Start** with the three prefilled inputs: GitLab's Greenhouse board, Ramp's Ashby board and the Red Hat homepage (the Actor finds Red Hat's careers page and its Workday site). It finishes in under a minute.
2. You get up to 25 open jobs per company with title, location, seniority, salary where published, description and apply link.
3. That first run costs at most $0.15, well within Apify's free monthly credit. Then paste your own company list or schedule it.

## What you get

One flat record per live job posting, with the same fields as the other factpipe jobs Actors plus four fields that say what was detected:

```json
{
  "query": "https://www.redhat.com",
  "found": true,
  "reason": null,
  "reason_detail": null,
  "careers_page_url": "https://www.redhat.com/en/jobs",
  "detected_platform": "workday",
  "job_id": "workday:redhat.wd5/jobs:R-055739-1",
  "title": "Principal Software Engineer - OpenShift Virtualization Windows Guests",
  "company_name": "Red Hat",
  "company_board": "redhat.wd5/jobs",
  "ats": "workday",
  "department": null,
  "team": null,
  "employment_type": null,
  "seniority": "senior",
  "workplace_type": "hybrid",
  "locations": ["Raanana"],
  "country_codes": ["IL"],
  "remote": false,
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "salary_period": null,
  "salary_source": null,
  "years_experience_min": 5,
  "visa_sponsorship": null,
  "posted_at": "2026-10-22T00:00:00.000Z",
  "updated_at": null,
  "apply_url": "https://redhat.wd5.myworkdayjobs.com/jobs/job/Raanana/Principal-Software-Engineer---OpenShift-Virtualization-Windows-Guests_R-055739-1/apply",
  "job_url": "https://redhat.wd5.myworkdayjobs.com/jobs/job/Raanana/Principal-Software-Engineer---OpenShift-Virtualization-Windows-Guests_R-055739-1",
  "description_text": "Job Summary:\nThe Red Hat OpenShift Virtualization team is looking for a Principal Software Engineer in Ra’anana Israel. …",
  "description_snippet": "Job Summary: The Red Hat OpenShift Virtualization team is looking for a Principal Software Engineer …",
  "description_status": "included",
  "duplicate_sources": [],
  "match_score": null,
  "matched_in": null,
  "source_url": "https://redhat.wd5.myworkdayjobs.com/wday/cxs/redhat/jobs/jobs",
  "fetched_at": "2026-10-22T10:23:38.067Z"
}
```

`seniority`, `years_experience_min`, `visa_sponsorship` and salaries stated in the description (`salary_source: "description"`) are read from the posting by fixed rules (no AI). Contact details inside descriptions are redacted.

A company without jobs gets **one free row** (`found: false`) that says why, for example:

```json
{
  "query": "https://www.adobe.com",
  "found": false,
  "reason": "unsupported_platform",
  "reason_detail": "The careers page https://careers.adobe.com/us/en uses phenom, a job platform this Actor does not read yet.",
  "careers_page_url": "https://careers.adobe.com/us/en",
  "detected_platform": "phenom",
  "source_url": "https://careers.adobe.com/us/en",
  "fetched_at": "2026-10-22T10:13:03.915Z"
}
```

(all job fields of such a row are `null` or `[]`). The dataset has two views: **Jobs** and **Detection per company**.

## Supported job platforms

| Platform | Detected from | Jobs read from |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/<board>`, `job-boards.greenhouse.io/<board>` links, the embed script `…/embed/job_board/js?for=<board>` (`grnhse_app`), `boards-api.greenhouse.io` calls in the page's own JavaScript | Greenhouse Job Board API |
| Lever | `jobs.lever.co/<company>` (also `jobs.eu.lever.co`) | Lever Postings API |
| Ashby | `jobs.ashbyhq.com/<company>` links and embeds | Ashby Posting API |
| Workable | `apply.workable.com/<company>`, `<company>.workable.com` | Workable widget API |
| Recruitee | `<company>.recruitee.com` | Recruitee Offers API |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/<site>`, `wd<N>.myworkdaysite.com/recruiting/<tenant>/<site>` | the career site's own job list (robots.txt checked first) |
| Personio | `<company>.jobs.personio.de` / `.com` links and iframes | Personio XML feed (robots.txt checked first) |
| Teamtailor | `<company>.teamtailor.com` links, or a page that **is** a Teamtailor career site on the company's own domain (e.g. `career.qliro.com`) | Teamtailor RSS feed (robots.txt checked first) |

Detected but not read (the company gets a free row with `reason: "unsupported_platform"` and the platform in `detected_platform`): SmartRecruiters, iCIMS, SAP SuccessFactors, Taleo, Oracle Recruiting Cloud, BambooHR, Jobvite, Eightfold, Phenom, Avature, Breezy, Pinpoint, JazzHR, Rippling, Dover, Gem, JOIN, softgarden, UKG, ADP, Dayforce, Paylocity, Zoho Recruit, Freshteam, Homerun, Jobylon, Comeet, Factorial.

## How detection works

1. **Direct board URL?** A Greenhouse/Lever/Ashby/… board URL in the input is read right away; no web page is fetched.
2. **robots.txt first.** Before the first page of any host, its `/robots.txt` is fetched (asked as `text/plain`). Only a robots.txt that exists (HTTP 2xx, `text/plain`) and allows the page counts as permission; a host with no robots file, an error or an HTML answer is not read (`reason: "robots_disallowed"`).
3. **Read the page you gave** (homepage or careers page) and look for job-board links, iframes, embed scripts, inline JSON and board-API calls in its JavaScript. Redirects are followed hop by hop (each new host's robots.txt first); a redirect that lands on a job board (e.g. `/careers` → `apply.workable.com/acme`) is used without fetching the board page.
4. **Follow careers links.** Links called "Careers", "Jobs", "Join us", "We're hiring", "Karriere", "Emplois"… or pointing to `/careers`, `/jobs`, `careers.<company>.com` are followed (best first, at most 3 per page, 2 levels deep, same company site). If no page links a careers page, common paths (`/careers`, `/jobs`, `/company/careers`, …) are tried. When a careers page lists jobs on the company's own front end, one posting page is read (its Apply button usually names the platform).
5. **Small budget per company:** at most 8 page requests (6 per host), one request per second per host, so a company site sees a handful of polite requests.
6. **Jobs:** up to 3 boards found for the company are read through the official APIs/feeds (newest first, up to `maxJobsPerCompany`), deduplicated, and returned with the same fields as the other factpipe jobs Actors.

An input that leads to a board already read in the same run gets `reason: "duplicate_input"` instead of the same jobs twice.

### Why a company has no job rows (`reason`)

| `reason` | Meaning |
|---|---|
| `invalid_url` | The input is not a website URL |
| `site_unreachable` | The website did not answer (DNS, timeout, HTTP error) |
| `robots_disallowed` | The site's robots.txt does not allow reading the pages we need, or the site has no robots.txt |
| `unsupported_platform` | The careers page uses a job platform this Actor does not read (see `detected_platform`) |
| `no_supported_ats_detected` | No supported job-board link found: an in-house careers system, or a page that loads its jobs with JavaScript only |
| `ats_board_empty` | The job board exists but lists no open job right now |
| `ats_board_not_found` | The job-board link on the careers page is dead (HTTP 404) |
| `ats_board_disallowed` | The job board's own robots.txt does not allow reading it |
| `ats_board_failed` | The job board did not answer after retries |
| `duplicate_input` | An earlier input of the same run leads to the same job board |
| `not_processed` | The run's time limit was reached before this company |

None of these rows is charged.

## Use cases

- **Recruiting & talent intelligence**: track competitors' live openings by team, level and location.
- **Sales signals**: hiring bursts reveal budgets and priorities — feed your CRM on a schedule.
- **Job boards & aggregators**: clean, deduplicated postings straight from source APIs, with descriptions.
- **AI agents**: tiny input schema, deterministic output — ideal via API or MCP.

## Switching from another career-page scraper

Same idea, same inputs: a list of company URLs in, flat job records out. Field mapping: `text/title → title`, `hostedUrl/absolute_url → job_url`, `categories.location/location.name → locations`. Plus `source_url` and `fetched_at` on every record. **You are only charged per job row delivered — companies where no supported platform is detected are free.**

**Output changes in October 2026** (more platforms, shared jobs schema): `company` → `company_name`, `board` → `company_board`, `location` → `locations` (list), `published_at` → `posted_at` (date-time), `job_id` is now `ats:board:posting_id`. `query`, `found`, `ats`, `reason`, `apply_url`, `job_url`, `source_url` and `fetched_at` are unchanged.

## Input

| Field | Type | Notes |
|---|---|---|
| `companyUrls` | string[], required | Company homepages, careers pages or direct job-board URLs (any of the 8 platforms; `teamtailor:<host>` for a Teamtailor custom domain) |
| `maxJobsPerCompany` | integer | Cap on charged job rows per company, newest first (default 200) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One live job posting delivered. **Detection misses, empty boards, and empty runs are never charged.** |

Example: 1,000 jobs cost **$2.00**. You only pay for delivered results.

## factpipe Jobs & Hiring Data

This Actor fetches jobs live from the career pages you give it. For search across many companies at once, the Actors below query a daily index of about 730,000 open jobs from 15,000 company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever, Ashby & Workday Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api): every Greenhouse job board in one search.
- [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api): every Lever job board, with salary where published.
- [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api): every Ashby job board: startup and AI jobs, with salary where published.
- [Workday Jobs API](https://apify.com/factpipe/workday-jobs-api): thousands of Workday career sites of large employers (NVIDIA, Salesforce, Adobe…), with full descriptions.

## FAQ

**Which job platforms are supported?**
Greenhouse, Lever, Ashby, Workable, Recruitee, Workday, Personio and Teamtailor, via their public job-board APIs and feeds. Give a company homepage or careers page and the Actor detects the platform, or pass a board URL directly.

**What if my company's careers page is not supported?**
You get one free row for that company with `found: false` and a `reason`: `unsupported_platform` when the careers page uses a platform we detect but don't read yet (named in `detected_platform`, e.g. SmartRecruiters, iCIMS, SuccessFactors, Phenom), `no_supported_ats_detected` for an in-house careers system or a page that only loads its jobs with JavaScript, or `robots_disallowed` when the site's robots.txt does not allow automated reading. Nothing is charged and the other companies of the run are processed normally. If you know the company's board URL (for example from an "Apply" link), paste that URL instead.

**Can I track hiring at many companies on a schedule?**
Yes. Put a list of company URLs in `companyUrls` and schedule the Actor; each run returns every live posting with title, department, location, seniority, salary where published and apply URL.

**Why did the Actor not read a website?**
It only reads sites whose robots.txt allows it (a missing robots.txt is not taken as permission) and makes at most 8 page requests per company, one per second per host. Job boards on Workday, Personio and Teamtailor are only read when their own robots.txt allows it.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official ATS APIs and feeds, robots.txt respected on every host, retries with backoff, one explanatory row instead of a failed run for any company that can't be read, structured failure reporting, health-checked daily, issues triaged daily.
