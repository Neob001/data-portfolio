# jobs_index: company directory + jobs index for `actors/ats-jobs-feed`

Zero-token pipeline (stdlib Python + Node 22, no model calls, no API keys) that produces:

1. **`boards.json`**: the company directory. Every public ATS job board we know about that had at least one open job when it was last checked. This file is committed.
2. **`index/`**: the jobs index that the Actor downloads in search mode. It is rebuilt daily, hosted at the Actor's `INDEX_BASE_URL`, and not committed.

```
discover_boards.py  ->  candidates.json  ->  validate_boards.py  ->  boards.json  ->  build_index.mjs  ->  index/
  (Common Crawl)          (tokens)            (1 API call/board)     (directory)     (all jobs)            (upload)
```

## Commands

```bash
cd scripts/jobs_index
# (a) refresh the company directory (resumable: re-run to continue after an interruption)
~/.local/bin/python3.12 discover_boards.py            # latest 2 crawls; auto walk-back for hosts with no pages
~/.local/bin/python3.12 validate_boards.py            # rechecks boards not checked in the last 20h
# (b) build the index (from the repo root or anywhere)
node build_index.mjs                                  # -> index/  (add --transport curl behind an HTTP proxy)
node build_index.mjs --limit 500 --out /tmp/idx       # representative subset (round-robin across ATSs)
```

Then upload `index/` (manifest.json, directory.json.gz, shards/) to the host behind `INDEX_BASE_URL`.

## Sources and terms (checked 2026-09-18)

| ATS | Endpoint used | Docs / terms | Verdict |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | [developers.greenhouse.io/job-board.html](https://developers.greenhouse.io/job-board.html) | **Included.** The docs say job board data is publicly available and GET endpoints need no authentication. robots.txt disallows only `/embed/`. |
| Lever | `api.lever.co/v0/postings/{company}?mode=json` (EU: `api.eu.lever.co`) | [github.com/lever/postings-api](https://github.com/lever/postings-api) | **Included.** The README says published postings "are publicly viewable" and "may be scraped by third parties". robots.txt sets `Crawl-delay: 1`, which we honour: at most one Lever request starts per second. |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | [developers.ashbyhq.com/docs/public-job-posting-api](https://developers.ashbyhq.com/docs/public-job-posting-api) | **Included.** Public and unauthenticated. The docs and [ashbyhq.com terms](https://www.ashbyhq.com/terms) contain no restriction on reading published postings. |
| Workable | `apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true` | [help.workable.com: Using the Workable API to create a careers page](https://help.workable.com/hc/en-us/articles/115012771647) | **Included.** Workable documents the public `www.workable.com/api/accounts/{subdomain}?details=true`, which redirects to this widget endpoint. apply.workable.com robots.txt allows everything and sets `Content-Signal: search=yes`. The [customer terms](https://www.workable.com/terms) bind account holders, not readers of published jobs. **Rate limit:** after ~3,650 requests at 1–2 requests/s on 2026-09-18, it answered `429` with `Retry-After: 83276` (~23 h). The scripts now pace Workable at ≥3 s per request and stop calling it for the rest of the run on a long `Retry-After`. |
| Recruitee | `{company}.recruitee.com/api/offers/` | [docs.recruitee.com/reference/offers](https://docs.recruitee.com/reference/offers) ("Careers Site API") | **Included.** Public Careers Site API that "returns a collection of published company jobs" and needs no auth. |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` | [developers.smartrecruiters.com/docs/posting-api](https://developers.smartrecruiters.com/docs/posting-api) | **Excluded.** `api.smartrecruiters.com/robots.txt` is `User-agent: * / Disallow: /` (only LinkedInBot is allowed on `/v1/companies/`). The docs also present the Posting API as a customer tool for building their own career site, with API-key/OAuth authentication. |

**Personal data:** no ATS field that names a person (Greenhouse `metadata`, Recruitee `mailbox_email`, etc.) is copied into records. In descriptions, `actors/ats-jobs-feed/src/text.js:redactContacts` replaces the following with `[… redacted]`:
- e-mail addresses, including obfuscated ones like `name(at)domain`
- phone numbers
- labelled contact names ("Recruiter: Jane Doe", "Ansprechpartner: …")
- capitalized name runs in contact sentences, meaning sentences that held an e-mail or phone number or that invite the reader to contact someone ("Neem contact op met …", "Reach out to …")

This is best-effort, and it over-redacts contact lines rather than under-redacting them. On 12,800 real Recruitee descriptions it changed 21% of them, mostly by removing e-mail addresses.

## Discovery details (`discover_boards.py`)

- Hosts: `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.eu.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com`, `*.recruitee.com`. The board token is the first path segment, or the subdomain for Recruitee. Tokens are normalized (lowercase where the API is case-insensitive), reserved paths are removed and duplicates are dropped.
- The script first tries the public CDX API (`index.commoncrawl.org`) with sleeps and retries. When that fails (it returned HTTP 504 for every query on 2026-09-18), it reads the same index directly from `data.commoncrawl.org`: it binary-searches `cluster.idx` with Range requests, then fetches only the compressed CDX blocks where the board token changes.
- Recent crawls (2026-30, 2026-34) contain only `robots.txt` for `jobs.lever.co`. For any host with zero tokens, the script walks back through older crawls (`--walk-back`, default 12) until it finds board pages.
- The work is checkpointed per (crawl, host) in `state/discover/`.

## Validation details (`validate_boards.py`)

- One API call per board. Concurrency per ATS: Greenhouse 8, Recruitee 8, Ashby 6, Workable 1 with ≥3 s spacing. Lever is paced to one request start per second (Crawl-delay: 1), with up to 8 slow responses in flight. Retries use backoff and honour `Retry-After`.
- Keeps boards with ≥1 open job. Records `ats, token, name, jobs, checked` (plus `region: "eu"` for EU Lever).
- Lever and Ashby APIs don't return a company name, so the script reads the `<title>` of the hosted board page. Ashby titles are often just "Jobs", and then the token is used as the name.
- Results are checkpointed in `state/validate.jsonl`. A re-run only re-checks boards older than `--max-age-hours`, plus any earlier transient failures (429, 5xx, timeouts).
- Circuit breaker: a `429` with `Retry-After` > 300 s stops all calls to that ATS for the rest of the run. The builder does the same after 5 consecutive 429s.

## Index format (v1)

```
index/
  manifest.json          {format, built_at, boards, boards_fetched, jobs, jobs_before_dedupe, bytes,
                          ats_counts, age_bands_days, directory, shards:[{file, ats, band, part, jobs,
                          bytes, posted_from, posted_to, newest, oldest}]}
  directory.json.gz      [[ats, token, company_name, jobs, [shard indices]], ...]
  shards/<ats>-b<band>-p<part>.jsonl.gz   one Actor output record per line, newest posted_at first
  build_report.json      timings and failures of the build (not needed by the Actor)
```

- **Records** are exactly the Actor's output rows: same parsers (`actors/ats-jobs-feed/src/transform.js`), description truncated to 20,000 characters, `source_url` = the ATS API URL, and `fetched_at` = when the builder fetched the board.
- **Dedupe:** the same normalized company + title + locations across boards or ATSs is kept once (the most complete copy). The other job ids go in `duplicate_sources`.
- **Sharding:** one ATS × one posted-date band (0–2, 2–4, 4–8, 8–15, 15–31, 31–61, 61–121, 121–366 and 366+ days before `built_at`; undated jobs go in the last band). A band is split into parts of ≤5 MB gzip. This lets the Actor skip whole shards:
  - `ats` filter → other ATSs are never downloaded.
  - `postedWithinDays` / `sinceLastRun` → bands older than the cutoff are skipped.
  - `companies` → `directory.json.gz` maps the matching boards to their shards.
  - The rest is streamed shard by shard (gunzip + line reader, bounded memory), newest band first, and the run stops at `maxResults`.
- **Hosting:** any static HTTPS host (S3/R2/GCS bucket, GitHub Pages or release assets, an Apify key-value store with public URLs) that serves `GET {INDEX_BASE_URL}/manifest.json`, `/directory.json.gz` and `/shards/*.jsonl.gz` as-is (no content-encoding rewriting of the `.gz` files). For local testing, `INDEX_BASE_URL`/`JOBS_INDEX_URL` also accepts a `file://` URL or an absolute path.

## Measured (2026-09-18/19, this sandbox, via a local HTTP proxy)

**Discovery** (`--mode zipnum`, since the CDX API returned HTTP 504 for every query): the 2 latest crawls, plus a walk-back for Lever to CC-MAIN-2025-43/-30, took ~7 min per crawl pass. It produced **17,441 candidate tokens**: greenhouse 5,266, workable 4,470, ashby 3,547, lever 3,108 + 106 EU, recruitee 944.

**Validation:** ~16,600 boards checked in ~2.5 h, about half of that spent on Lever at 1 request/s. The result is **11,063 boards with ≥1 open job** in `boards.json`, listing 361,887 open jobs:

| ATS | Boards (with jobs) | Open jobs | Note |
|---|---|---|---|
| Greenhouse | 3,822 | 154,805 | |
| Ashby | 2,859 | 55,539 | |
| Workable | 1,979 | 84,660 | ~840 candidates still unchecked: Workable blocked this IP (429, ~23 h) |
| Lever | 1,626 | 53,754 | tokens from 2025 crawls, ~54% still live |
| Recruitee | 777 | 13,129 | |

**Full index build** (all ATSs except Workable, which was blocked; `--transport curl`): **9,084 boards → 277,273 jobs → 269,391 after dedupe**. Output: **441.8 MB gzip in 120 shards** (largest 4.9 MB), built in **29 min** (1,696 s fetch plus 46 s dedupe/shard), 0 failed boards. That is ~1.6 KB gz per job. Adding Workable's ~85k jobs extrapolates to ~355k jobs and ~580 MB. At ≥3 s per Workable request it adds ~1.7 h, but it runs in parallel with the other ATSs.

**Actor against the full local index:**
- Prefill input (engineer, remote_only, 7 days, 20 results): 1 shard read, 30 ms.
- A worst-case query matching almost nothing: all 120 shards streamed in ~7 s, peak RSS ~140 MB.
