# Expired Jobs Checker — Is This Job Posting Still Open?

An **expired jobs checker** for job boards, aggregators and recruiting tools: paste job IDs or job URLs and find out, per job, whether the posting is still **open** or has been **closed / expired** by the employer. It checks against a daily index of 20,000+ company career sites on Workday, Greenhouse, Lever, Ashby, Personio, Teamtailor, Workable and Recruitee, so a run with thousands of jobs takes seconds and never touches the employers' sites.

Remove dead listings from your job board, stop alerting candidates about filled roles, or measure how long jobs stay open.

## Quick start

1. Click **Start** with the prefilled input: five job IDs (one of them made up) and two job URLs. The run takes well under a minute.
2. You get one row per job: six `open` with title and company, and the made-up GitLab job `closed`, because GitLab's board is in today's index and that job is not.
3. Paste your own `job_id`s from any factpipe jobs Actor (e.g. the [Bulk Job Postings Feed](https://apify.com/factpipe/jobs-bulk-feed)) or job links, and schedule the check daily.

## What you get

Real output from a local run of the prefilled input on November 3, 2026 (index build of November 2), two of the seven rows:

```json
[
  {
    "input": "lever:palantir:5168e8fd-fec1-4fea-b7a1-81bdaea65850",
    "job_id": "lever:palantir:5168e8fd-fec1-4fea-b7a1-81bdaea65850",
    "status": "open",
    "status_reason": "in_index",
    "last_seen_index_built_at": "2026-11-02T11:04:55.585Z",
    "company_name": "Palantir Technologies",
    "title": "Forward Deployed Software Engineer",
    "ats": "lever",
    "job_url": "https://jobs.lever.co/palantir/5168e8fd-fec1-4fea-b7a1-81bdaea65850",
    "checked_at": "2026-11-03T04:53:44.583Z",
    "source_url": "https://api.lever.co/v0/postings/palantir?mode=json",
    "fetched_at": "2026-11-02T11:20:45.631Z"
  },
  {
    "input": "greenhouse:gitlab:1000000001",
    "job_id": "greenhouse:gitlab:1000000001",
    "status": "closed",
    "status_reason": "not_in_index",
    "last_seen_index_built_at": null,
    "company_name": "GitLab",
    "title": null,
    "ats": "greenhouse",
    "job_url": null,
    "checked_at": "2026-11-03T04:53:44.583Z",
    "source_url": "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true",
    "fetched_at": "2026-11-02T11:06:14.999Z"
  }
]
```

How a real list behaves: 10,000 job IDs taken from the November 1 index build and checked against the November 2 build came back 9,875 open, 72 closed and 53 unknown (49 of them on Workday sites with more open jobs than the index keeps per site, 4 on boards missing from the newer build; see FAQ).

## Use cases

- **Job boards and aggregators**: find expired listings daily and take them down before candidates click dead links.
- **Job alerts and newsletters**: drop filled roles before you send.
- **Recruiting and sales intelligence**: see which roles a company has filled or pulled, and how long postings stay open.
- **Data hygiene**: refresh the status of a jobs dataset you bought or built elsewhere, as long as the jobs are on the supported platforms.

## Input

| Field | Type | Notes |
|---|---|---|
| `jobIds` | string[] | `job_id` values from any factpipe jobs Actor, e.g. `greenhouse:gitlab:8396674002`, `workday:redhat.wd5/jobs:R-043519` |
| `jobUrls` | string[] | Job page or apply links on the eight platforms, e.g. `https://jobs.lever.co/acme/<id>`, `https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/Engineer_R123`. Company careers-page links work when an indexed job uses them (e.g. Greenhouse `?gh_jid=` links) |

Up to 200,000 jobs per run; identical inputs are checked once. The output has one row per input, in input order.

## Output fields

| Field | Meaning |
|---|---|
| `input` | The job_id or URL exactly as given |
| `job_id` | factpipe job_id of the job (`ats:board:posting`); `null` when the input is not a recognisable job |
| `status` | `open`, `closed` or `unknown` |
| `status_reason` | `in_index` / `duplicate_in_index` (open), `not_in_index` (closed), `board_partially_indexed` / `board_not_in_index` / `unrecognized_input` / `not_checked` (unknown) |
| `last_seen_index_built_at` | Build time of the index that lists the job (open rows), else `null` |
| `company_name`, `title`, `ats`, `job_url` | From the index for open jobs; closed rows keep the company (the title is gone with the job) |
| `checked_at` | When this run checked the job |
| `source_url`, `fetched_at` | Open and closed rows: the ATS API or feed URL the nightly build read the board from, and when. Unknown rows: the index manifest and its build time |

**Status rules.** `open`: today's index lists the job, directly or as a duplicate of the same opening on another board of the company (`duplicate_in_index`). `closed`: the nightly build read the company's board successfully and the job was not on it. `unknown`: the index cannot tell, because the board is not in today's index (not in our directory, failed that night, or no open jobs left), the board has more open jobs than the build keeps per site, the input is not a job ID or job URL we recognise, or the run stopped before deciding.

## Pricing (pay per event)

**$0.10 per 1,000 jobs checked** ($0.0001 per `job-checked`, one event per `open` or `closed` row). No start fee and no charge for platform usage: checking 10,000 jobs costs **$1**.

`unknown` rows are free. Set a maximum charge per run in Apify and the Actor stops cleanly when it is reached; the remaining jobs get no row and no charge (the status message says how many).

## factpipe Jobs & Hiring Data

These Actors share the same nightly index of open jobs from 20,000+ company career sites:

- [Expired Jobs Checker](https://apify.com/factpipe/expired-jobs-checker) (this Actor): open or closed, per job_id or job URL.
- [Bulk Job Postings Feed](https://apify.com/factpipe/jobs-bulk-feed): every new job every day, as one bulk feed.
- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): keyword search ranked by relevance, every filter, full descriptions fetched live.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Greenhouse, Lever, Ashby & Workday Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick the applicant tracking systems and companies you want.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
- [Greenhouse Jobs API](https://apify.com/factpipe/greenhouse-jobs-api), [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api), [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) and [Workday Jobs API](https://apify.com/factpipe/workday-jobs-api): one platform each.
- [Career Page Scraper](https://apify.com/factpipe/company-jobs-scraper): give it a company homepage and it finds the careers page and ATS for you.

## FAQ

**How is this different from the Jobs Feed API (ats-jobs-feed)?**
The [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed) finds jobs (keywords, filters, full descriptions). This Actor answers one question for jobs you already have: still open or not. It reads only the parts of the index that hold your jobs' companies, so checking 100,000 jobs is a single short run.

**How fresh is the answer?**
As fresh as the index: it is rebuilt every night from the employers' ATS APIs and feeds and published around 10:00 UTC (some days up to an hour later). A job closed after that night's build still shows `open` until the next build. `fetched_at` tells you when the build read the company's board. Schedule daily checks after about 11:00 UTC. Rarely, an employer unlists a job for a moment while editing it; if the nightly read happens in that moment, the job shows `closed` for one day (in a spot check of 8 `closed` jobs against the live ATS APIs, 7 were gone and 1 had been re-listed an hour after the build read its board).

**Why would a job be `unknown`?**
Mostly for two reasons. (1) The company's board is not in today's index: we don't cover it, its board could not be read that night, or it has no open jobs left (then the job is most likely closed too, but we can't prove it). (2) The board has more open jobs than the nightly build keeps per site (the newest 500 on a Workday site, 1,000 on Teamtailor), so an older job may be open but outside the index. Unknown rows are never charged.

**Which inputs are recognised?**
Any `job_id` from a factpipe jobs Actor, and job URLs on Greenhouse (`job-boards.greenhouse.io/<company>/jobs/<id>`, also `?gh_jid=`), Lever, Ashby, Workable, Recruitee, Workday (with or without the `/en-US/` locale), Personio and Teamtailor (including custom career domains and company careers pages that an indexed job links to). A board URL without a specific job is reported as `unrecognized_input`.

**What does `duplicate_in_index` mean?**
Some companies list the same opening on two boards (two Workday sites, a Teamtailor group site and a local site, or an old and a new ATS). The index keeps one copy and records the other job_ids; your job_id is open because its twin is listed. `job_url` points at the listed copy.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or the official Python/JavaScript clients, or connect it to Make, Zapier, n8n or Google Sheets through Apify integrations.

## Sources and terms

The Actor reads only the published factpipe jobs index, built nightly from the public job-board APIs and feeds that the ATS vendors publish for displaying open jobs. No logins, no personal data, and no requests to the employers' sites during your run.

## Reliability

Each part of the index is retried on a network error. When a part still cannot be read, only jobs of that platform that were not found elsewhere come back `unknown` with `not_checked`, never a wrong `closed`. Every run writes a `RUN_SUMMARY` record (open / closed / unknown counts, index build time, parts read).
