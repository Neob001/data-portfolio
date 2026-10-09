# jobs_index: company directory + jobs index for `actors/ats-jobs-feed`

Zero-token pipeline (stdlib Python + Node 22, no model calls, no API keys) that produces:

1. **`boards.json`**: the company directory. Every public ATS job board we know about that had at least one open job when it was last checked. This file is committed.
2. **`index/`**: the slim jobs search index that the Actor reads in search mode (~40–60 MB). It is rebuilt daily, hosted at the Actor's `INDEX_BASE_URL`, and not committed. Full descriptions are fetched live by the Actor.

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
node build_index.mjs                                  # -> index/  (--transport curl behind an HTTP proxy; --skip-ats workable; --codec gz)
node build_index.mjs --limit 500 --out /tmp/idx       # representative subset (round-robin across ATSs)
```

Then publish with `publish_index.sh` (see Publishing and hosting).

## Sources and terms (checked 2026-09-18)

| ATS | Endpoint used | Docs / terms | Verdict |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | [developers.greenhouse.io/job-board.html](https://developers.greenhouse.io/job-board.html) | **Included.** The docs say job board data is publicly available and GET endpoints need no authentication. robots.txt disallows only `/embed/`. |
| Lever | `api.lever.co/v0/postings/{company}?mode=json` (EU: `api.eu.lever.co`) | [github.com/lever/postings-api](https://github.com/lever/postings-api) | **Included.** The README says published postings "are publicly viewable" and "may be scraped by third parties". robots.txt sets `Crawl-delay: 1`, which we honour: at most one Lever request starts per second. |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | [developers.ashbyhq.com/docs/public-job-posting-api](https://developers.ashbyhq.com/docs/public-job-posting-api) | **Included.** Public and unauthenticated. The docs and [ashbyhq.com terms](https://www.ashbyhq.com/terms) contain no restriction on reading published postings. |
| Workable | `apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true` | [help.workable.com: Using the Workable API to create a careers page](https://help.workable.com/hc/en-us/articles/115012771647) | **Included.** Workable documents the public `www.workable.com/api/accounts/{subdomain}?details=true`, which redirects to this widget endpoint. apply.workable.com robots.txt allows everything and sets `Content-Signal: search=yes`. The [customer terms](https://www.workable.com/terms) bind account holders, not readers of published jobs. **Rate limit:** after ~3,650 requests at 1–2 requests/s on 2026-09-18, it answered `429` with `Retry-After: 83276` (~23 h). The scripts now pace Workable at ≥3 s per request and stop calling it for the rest of the run on a long `Retry-After`. |
| Recruitee | `{company}.recruitee.com/api/offers/` | [docs.recruitee.com/reference/offers](https://docs.recruitee.com/reference/offers) ("Careers Site API") | **Included.** Public Careers Site API that "returns a collection of published company jobs" and needs no auth. |
| Workday | `POST {tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (list, 20 per page) and `GET …/wday/cxs/{tenant}/{site}/job/{path}` (one job) | Owner approval J3 (2026-10-09). No vendor API docs: this is the JSON each public career site loads for its visitors. | **Included, with robots.txt checks.** Tenant hosts publish `Allow: /{site}/` (+ a sitemap) and disallow other sites / `/refreshFacet/`. Before any call we evaluate the host's robots.txt (RFC 9309, longest match) for `/wday/cxs/{tenant}/{site}/jobs`, `…/job/` and `/{site}/` and skip the site if any is disallowed (or robots.txt is unreachable / answers with HTML). See "Workday" below. |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` | [developers.smartrecruiters.com/docs/posting-api](https://developers.smartrecruiters.com/docs/posting-api) | **Excluded.** `api.smartrecruiters.com/robots.txt` is `User-agent: * / Disallow: /` (only LinkedInBot is allowed on `/v1/companies/`). The docs also present the Posting API as a customer tool for building their own career site, with API-key/OAuth authentication. |

**Personal data:** no ATS field that names a person (Greenhouse `metadata`, Recruitee `mailbox_email`, etc.) is copied into records. In descriptions, `actors/ats-jobs-feed/src/core/text.js:redactContacts` replaces the following with `[… redacted]`:
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

## Workday (added 2026-10-09, owner approval J3)

A Workday "board" is one public career site, `https://<tenant>.<wdN>.myworkdayjobs.com/<site>`, with the token `<tenant>.<wdN>/<site>` (e.g. `nvidia.wd5/NVIDIAExternalCareerSite`). Parsing, fetching and robots logic live in the shared core (`actors/ats-jobs-feed/src/core/transform.js`, `feed.js`, `robots.js`).

- **Endpoints:** `POST /wday/cxs/<tenant>/<site>/jobs` with `{"appliedFacets":{},"limit":20,"offset":N,"searchText":""}` → `{total, jobPostings:[{title, externalPath, locationsText, postedOn, bulletFields, remoteType?, timeType?}]}`. `limit` > 20 is rejected (HTTP 400); `total` is only set on the first page (later pages say 0) and is capped at 2,000. One job: `GET /wday/cxs/<tenant>/<site>/job/<location>/<slug>` → `{jobPostingInfo: {jobDescription (HTML), location, additionalLocations, country, timeType, remoteType?, startDate, …}, hiringOrganization}`. A closed job answers 404, a non-public site 403 `permission denied`, a wrong `wdN` 422.
- **robots.txt (checked before any call, per host):** tenant hosts publish `Allow: /<site>/` per public site, `Disallow:` for internal sites and `/refreshFacet/`. We evaluate RFC 9309 rules (our group or `*`, longest match, tie → Allow) for `/wday/cxs/<tenant>/<site>/jobs`, `…/job/` and `/<site>/`, as written and lowercased (site names are case-insensitive), and skip the site when any is disallowed, when robots.txt is unreachable or 5xx, or when it comes back as HTML. Gotcha: **asked with `Accept: text/html`, Workday hosts answer `/robots.txt` with their HTML app page** — request it with `Accept: text/plain` (the first validation pass on 2026-10-09 missed this, see LEARNINGS).
- **Record mapping:** `job_id = workday:<token>:<requisition id>` (the part after the last `_` of the posting path, e.g. `JR2026537`, stable across runs; a second posting of the same requisition falls back to the full slug). `posted_at` = UTC midnight of fetch day − N for "Posted Today / Yesterday / N Days Ago / 30+ Days Ago" (30+ → −30 days, meaning *at least* 30 days). `locations`: the label, or for "N Locations" the primary location from the posting path; descriptions and the full location list come from the detail call, only for delivered jobs. `workplace_type` from `remoteType` (Flex → hybrid) else location text; `employment_type` from `timeType`; no salary/department in Workday lists. `apply_url` = `job_url + /apply`. Company name: the site page's `og:title` ("Careers at X" / "X Careers"), else the tenant (`ibm` → `IBM`, `capitalone` → `Capitalone`).
- **Index:** list pages only (no descriptions, so `kw` is empty and keywords match Workday titles; ~38 bytes per job brotli). Delivery fetches one detail per delivered job (404 → closed, skipped, not charged).
- **Politeness:** one request in flight per host (sites of a tenant are read one after another), a global pacer across all Workday hosts (Actor 250 ms, validation 250 ms, index build 150 ms between request starts), `Retry-After` honoured (shared `http.js`; a Retry-After above 60 s fails fast and trips the builder's 429 breaker).
- **Discovery:** `discover_boards.py --ats workday` adds `*.myworkdayjobs.com` and `*.myworkdaysite.com/recruiting/<tenant>/<site>` to the Common Crawl scan (zipnum works: these hosts are only 5–77 CDX blocks per crawl). `--max-blocks N` bounds a run and resumes there next time (`state/discover/*.progress`). The result is committed as `workday_candidates.json`, which `validate_boards.py` reads in CI too (`--max-new` caps never-checked candidates per night).

**Measured 2026-10-09 (this machine, direct connection):**
- **Discovery:** 6 crawls (CC-MAIN-2026-17 … 2026-39), zipnum, **387 s** in total → **6,380 candidate sites** on 3,540 tenants (one crawl alone: ~3,500 sites).
- **Validation:** all 6,380 checked in ~100 min (0.94 s per site at 4 requests/s: robots.txt once per host, one jobs POST, one site-page GET for the name) → **4,796 sites with ≥1 open job on 2,996 tenants, 850,315 listed jobs** (median 40 per site, 63 sites at Workday's 2,000 cap). Other answers: 612 sites with 0 jobs, 435 × 422 (wrong `wdN` / tenant gone), 164 × 403 (site not public), 88 × 404, 6 transient. **279 sites (220 tenants) are disallowed by their robots.txt and are never called**; 136 of those tenants have no usable site at all.
- **Index build cost per site** (300-site sample, `--workday-max-jobs 400`, 8 workers @ 150 ms): 4.9 requests and 6.9 s per site (sequential pages, ~1.4 s per request incl. pacing), **5.1 requests/s, 0.95 s of wall time per site**; 299/300 ok, 30 cut at the cap. Slim records cost ~36 bytes per job (brotli); 11% of Workday postings are same-title/same-location duplicates within a site and are folded by the dedupe.
- **Nightly budget:** the whole directory needs Σ ceil(min(total, cap)/20) requests: cap 200 → 19.8k, **300 → 23.6k**, 400 → 26.4k, 2000 → 41.1k. At 5.1 requests/s, cap 300 takes **~77 min** and keeps ~427k jobs (50% of listed; the newest 300 per site). The Workday queue runs in parallel with the other ATSs, whose fetch phase is bounded by Workable (1,979 boards × 3 s ≈ 99 min), so with `--workday-budget-min 85` (no new site after 85 min, ≤90 s tail per site) the fetch phase still ends at ~100 min; dedupe/shard grows by ~4 min (13 s per 23k Workday jobs measured) → build ≈ 110 min (step timeout raised 120 → 140). If a night is slow, the budget cut skips the last sites of a daily-rotated order, so different sites miss out on different nights. Index size: +~15 MB.
- **Actor (local):** workday-jobs-api prefill with the published index (no Workday yet) → live fallback over 5 built-in sites: 15 rows in 62 s; ats-jobs-feed live mode on NVIDIA (2,000 jobs) + Salesforce (1,554): both read in full, 20 rows in 117 s; search mode on a local index: 10 rows in 7 s (one detail call per delivered job).

## Index format (v2: slim search index)

```
index/
  manifest.json          {format: 2, codec: "brotli", built_at, boards, boards_fetched, jobs, jobs_before_dedupe,
                          bytes, ats_counts, age_bands_days, directory, shards:[{file, ats, band, part, jobs,
                          bytes, raw_bytes, posted_from, posted_to, newest, oldest}]}
  directory.json.gz      [[ats, token, company_name, jobs, [shard indices]], ...]
  shards/<ats>-b<band>-p<part>.jsonl.br   brotli (quality 11, 16 MB window); .jsonl.gz with --codec gz
  build_report.json      timings and failures of the build (not needed by the Actor)
```

**Shard content:**
- Line 1 is the board header: `{"_boards": {"<ats>:<token>": {"t": token, "r": "eu"?, "f": fetched_at, "kw": board words}}}`.
- Every other line is one slim job record. It carries `job_id, title, company_name, company_board, ats, department, team, employment_type, workplace_type, locations, country_codes, remote, salary_*, posted_at, updated_at, job_url, description_snippet`, plus `kw`.
- `apply_url` and `duplicate_sources` are included only when they are not the ATS default or empty. `source_url` (the ATS API URL) and `fetched_at` come from the board header.
- **No full descriptions.** The Actor fetches them live for the jobs it delivers (one API call per board).

**`kw` field** (`actors/ats-jobs-feed/src/core/keywords.js`):
- It holds the distinct lowercase words (stopwords removed) of the department, team and the first 1,500 description characters, minus the title's words. It is capped at 500 characters per job.
- Words found in ≥60% of a board's postings (company boilerplate, EEO text) are stored once per board in the header, and the Actor merges them back at read time.
- Title matching is phrase-at-word-start. Description matching needs every word of the keyword (or its plural). Adjacency inside descriptions is not preserved.

**Why these choices (measured on the real index, per 60k-job sample):**

| Layout | 270k jobs | 355k (+Workable) |
|---|---|---|
| slim fields, no kw, gzip | 40 MB | 53 MB |
| + 1,500-char kw, gzip | ~130 MB | ~170 MB |
| + distinct-word kw, board-shared words factored, cap 500, gzip | 70 MB | 92 MB |
| same, **brotli** q11/16 MB window (chosen) | **44 MB** | **58 MB** |

- Gzip cannot meet the ≤60 MB target with any useful `kw`. Brotli's large window folds each company's repeated text across the board's postings, because shards are ordered by board. Node decompresses it natively.
- **Sharding:** one ATS × one posted-date band (0–2, 2–4, 4–8, 8–15, 15–31, 31–61, 61–121, 121–366 and 366+ days before `built_at`). Each shard holds ≤32 MB raw and ≤5 MB compressed, with records grouped by board. The Actor skips whole shards:
  - `ats` filter → other ATSs are never downloaded.
  - `postedWithinDays` / `sinceLastRun` → older bands are skipped.
  - `companies` → `directory.json.gz` maps the matching boards to their shards.
- Within each shard the Actor sorts matches by `posted_at` before delivering, newest band first.
- **Dedupe:** the same normalized company + title + locations is kept once (the most complete copy). The other ids go in `duplicate_sources`.

## Publishing and hosting

- The Actor reads `JOBS_INDEX_URL` (env var), else the `INDEX_BASE_URL` constant in `src/feed.js`. It needs `GET {base}/manifest.json`, `{base}/directory.json.gz` and each `{base}/<shard file>` as raw bytes. Redirects are fine (GitHub release downloads redirect). `file://` URLs and absolute paths work for local tests.
- `publish_index.sh` (not run by the build; `source` it and call one function):
  - `publish_github_release OWNER/REPO`: uses `$GITHUB_TOKEN` to delete the old assets of release `jobs-index`, then uploads `directory.json.gz` and `shard-<n>.jsonl.br`, with `manifest.json` last. It prints `INDEX_BASE_URL=https://github.com/OWNER/REPO/releases/download/jobs-index`.
  - `publish_apify_kvs STORE`: uses `$APIFY_TOKEN` to PUT each record (`manifest.json`, `directory.json.gz`, `shard-<n>.jsonl.*`) and delete stale extra shards. It prints `INDEX_BASE_URL=https://api.apify.com/v2/key-value-stores/STORE/records`. The store must be publicly readable.
  - Both publish flat names, with the manifest rewritten to match.
- `github-workflow.yml.draft` is a daily GitHub Actions job (03:00 UTC, 330 min timeout). It restores `state/` from the Actions cache, re-validates boards (any ATS with an active ban in `state/bans.json` is skipped), builds the slim index, saves state and publishes to the release. To enable it, copy it to `.github/workflows/` (owner decision).
- **Rate-limit bans:** a `429` with `Retry-After` > 300 s makes `validate_boards.py` stop calling that ATS and record `{ats: until}` in `state/bans.json`. Both scripts skip a banned ATS until the ban expires. The builder also stops an ATS after 5 consecutive 429s.

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

**v1 full-description index build** (superseded by v2 below; all ATSs except Workable, which was blocked; `--transport curl`): **9,084 boards → 277,273 jobs → 269,391 after dedupe**. Output: **441.8 MB gzip in 120 shards** (largest 4.9 MB), built in **29 min** (1,696 s fetch plus 46 s dedupe/shard), 0 failed boards. That is ~1.6 KB gz per job. Adding Workable's ~85k jobs extrapolates to ~355k jobs and ~580 MB. At ≥3 s per Workable request it adds ~1.7 h, but it runs in parallel with the other ATSs.

**Full-description index (v1, superseded):** 441.8 MB gzip for 269,391 jobs.

**Slim search index (v2), 2026-09-19** (all ATSs except Workable, which is banned; `--transport curl --codec br`):
- **Size:** 269,386 jobs from 9,070 boards (277,276 before dedupe). **43.4 MB total** (brotli, 38 shards; largest 3.6 MB; 374.7 MB raw JSONL).
- **Build time:** 33.7 min (27.8 min fetching, bounded by Lever's 1 request/s; 5.9 min dedupe + brotli-11).
- **With Workable:** ~85k more jobs extrapolate to ~57 MB.

**Actor against the local slim index (live description fetches from this sandbox):**
- **Prefill** (engineer, remote_only, 7 days, 20 results, includeDescription true): 1 shard read, 17 boards fetched live for descriptions, **3.7 s**, peak memory 246 MB.
- **Worst-case keyword query** (`["kubernetes operator"]` all, all 38 shards, includeDescription true, maxResults 100): 67 matches from 45 boards, **84 s**, peak memory 307 MB. Most of that time is the live description calls. Large Greenhouse boards return multi-MB `content=true` payloads, and Lever is paced at 1 request/s.
- **Pure scan of all 38 shards with no match:** 3.4 s, 43 MB read.
