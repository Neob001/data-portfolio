# tenders_index: nightly global public-procurement index for `actors/government-tenders-api`

Owner approval S-3 (2026-11-17). Zero-token pipeline (Node 22, no dependencies; stdlib Python publisher), same pattern as `scripts/jobs_index`: free GitHub Actions build -> assets of the `tenders-index` release -> the Actor reads the release (no live scraping at run time).

```
approved sources --(incremental fetch, throttled)--> state/records/<source>.jsonl.gz --(retention, dedupe)--> index/ --> release tenders-index
```

## Commands

```bash
cd scripts/tenders_index
node build_index.mjs                                   # all sources, incremental, -> index/ (state in state/)
node build_index.mjs --days 2 --out /tmp/t --state /tmp/t/state --registry-pubs za,ug   # local smoke run
node --test tests/*.test.mjs && python3 test_publish_release.py
GITHUB_TOKEN=... python3 publish_release.py OWNER/REPO index   # what the workflow runs
```

Options: `--sources ted,uk-fts,uk-cf,sam,ocds`, `--registry-pubs <slugs>`, `--window-days 90`, `--days N` (at most N days per day-sliced source; SAM stops at the cutoff), `--budget-min 40` (no new day/file after N minutes), `--registry-max-mb 2500` (compressed registry downloads per night), `--sam-max-mb`, `--codec br|gz`, `--now ISO` (tests).

## Sources (screen: `state/source_screen_tenders_2026-11-17.md`)

Only sources with a proposed APPROVE line are built. robots.txt rule R1 applies to every host we read.

| Source id | What | Endpoint | Licence | Incremental unit |
|---|---|---|---|---|
| `ted` | EU + EEA tenders and awards (Tenders Electronic Daily) | `POST api.ted.europa.eu/v3/notices/search`, `publication-date=YYYYMMDD`, 250/page, 1 s between requests | COM_REUSE (Decision 2011/833/EU) | publication day (weekdays) |
| `uk-fts` | UK Find a Tender (above threshold) | `GET find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom&updatedTo` (cursor), 1.5 s | OGL v3.0 | update day |
| `uk-cf` | UK Contracts Finder (below threshold) | `GET contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom&publishedTo` (cursor), 1.5 s | OGL v3.0 | publication day |
| `sam` | US federal contract opportunities | public SAM.gov extract `ContractOpportunitiesFullCSV.csv?privacy=Public` (no key), streamed once per night | US public domain | whole file (all listed notices) |
| `ocds-<slug>` | 16 national platforms (AU, CA-QC, EC, DE, GT, HN, NL, PY, PE, ZA, GB-Scotland, UG, ZM, BR, BG, GR) | OCP Data Registry bulk file `data.open-contracting.org/en/publication/{id}/download?name={year}.jsonl.gz` (compiled releases) | per publication, see `registry_publications.json` | registry collection (re-read only when the redirect URL, which carries the collection id, changes; ~monthly) |

**Day-sliced sources** (TED, FTS, CF): `state/cursors.json` remembers each day fetched completely. Every night re-reads the last 3 days (late notices, updates) and then fills missing days of the 90-day window, newest first, until `--budget-min`. A fresh state therefore backfills over the first nights (TED ≈ 4 min per publication day here, so ~8 days per night inside the budget; UK ~1-8 min per day).

**Personal data:** no contact point is ever read into a record (OCDS `contactPoint`/`contactPerson`, SAM contact columns, TED person/e-mail/phone fields are not requested). Descriptions are cut to 500 characters with e-mails and phone numbers redacted (`lib/normalize.mjs:redactContacts`). `supplier_names` v1 only lists suppliers with an organisation-only register id (GB-COH, GB-CHC, GB-SC, GB-NIC) and no sole-trader marker; UK suppliers (Find a Tender, Contracts Finder) without a Companies House or charity number, TED winners, SAM awardees and all registry suppliers are omitted.

## Record (flat, `lib/normalize.mjs:RECORD_FIELDS`)

`notice_id` (`<source>:<id>`, stable), `source`, `country_code`, `buyer_name`, `buyer_country`, `title`, `description_snippet`, `notice_type` (planning|tender|award|contract|cancellation|other), `procedure_type`, `status` (open|closed|awarded|cancelled|unknown), `cpv_codes`, `naics_codes`, `unspsc_codes`, `value_amount`, `value_currency`, `published_at`, `deadline_at`, `award_date`, `supplier_names`, `lots_count`, `language`, `notice_url`, `source_url`, `fetched_at` (the night the index **first** read the notice; the Actor's `sinceLastRun` key, so late-published registry notices still count as new).

Mapping notes: TED notice types `cn-*`, `pin-cfc-*`, `qu-sy`, `subco` -> tender; `pin-*`, `pmc` -> planning; `can-*`, `veat` -> award; `can-modif`, `compl` -> contract; `corr` -> other. SAM: Solicitation / Combined Synopsis -> tender, Presolicitation / Sources Sought -> planning, Award Notice -> award, the rest other. OCDS releases (UK) by tag; compiled releases (registry) by the furthest stage (contracts > awards > tender > planning), `published_at` = that stage's date. Value 0 = not stated.

## Retention and dedupe

- Kept: every notice published in the last `--window-days` (90), plus older planning/tender notices whose deadline is still ahead (≤ 2 years old). Status is re-derived nightly (a tender past its deadline becomes `closed`; the Actor re-derives it again at run time).
- Cross-source dedupe (`lib/store.mjs`): same buyer country, notice type, publication day, buyer name and title core (TED's "Country – CPV –" prefix removed) = one notice; the more complete copy wins, ties go to TED > FTS > CF > SAM > registry.

## Index format (v1)

```
index/
  manifest.json      {format: 1, codec, built_at, notices, notices_before_dedupe, bytes, source_counts, country_counts,
                      notice_type_counts, status_counts, age_bands_days, build_report, shards: [{file, source, band, part,
                      notices, open, bytes, raw_bytes, countries, notice_types, published_from, published_to,
                      deadline_max, fetched_max}]}
  shards/<source>-b<band>-p<part>.jsonl.br   full records, newest first; bands = 0-3, 3-8, 8-32, 32-92, 92+ days; <= 24 MB raw
  build_report.json  per source: fetched, stored before/after, days done/pending, failures, bytes, timings; HTTP stats
```

The Actor skips whole shards by source, country, notice type, publication window, `deadline_max` (open only / deadline after) and `fetched_max` (sinceLastRun).

## Nightly workflow

`.github/workflows/tenders-index.yml`, 05:30 UTC, job timeout 58 min: restore `state/` from the Actions cache -> unit tests -> `build_index.mjs --budget-min 32` -> save state -> `publish_release.py` (copy of the jobs publisher: build-stamped assets, manifest swapped last, previous build kept one cycle).

## Measured (2026-11-16, this machine, `--days 2`)

Run on a Monday afternoon UTC (so "2 days" = Sunday + a partial Monday); this machine reaches the registry CDN at only ~40 KB/s, so registry timings here are network-bound.

| Source | Night 1 (fresh state) | Night 2 (state restored) | Notes |
|---|---|---|---|
| TED | 3,784 notices, 212 s | 3,784 (re-read), 181 s | 1 publication day = 16 pages of 250; ~12 s per page incl. 1 s gap |
| UK Find a Tender | 368 releases, 230 s | 392, 210 s | ~50 s per 100-release page (server-side) |
| UK Contracts Finder | 44, 26 s | 49, 22 s | weekend volume; weekdays ~300-600 per day |
| SAM.gov | 404, 44 s | 404, 39 s | stopped at the 2-day cutoff after 0.6 MB; nightly reads the whole ~244 MB extract |
| OCP registry | AU 65,386 compiled releases -> 11,957 kept; CA-QC 53,260 -> 9,594; HN 46,752 -> 11,696; NL 16,515 -> 2,419 (ZA, GB-SCT, UG, ZM cut by the 25-min budget; ZA alone: 3,056 -> 1,112 in 3 s) | carried, 0 requests | kept = the 90-day window + still-open tenders |

Index after night 2: **40,289 notices, 17 shards, 2.2 MB** (brotli q9, ~55 bytes per notice), 41 countries; night 2 made 30 HTTP requests (robots.txt included). Second-night `uk-cf`/`uk-fts`/`ted` stores grew by upsert, nothing re-delivered by the Actor (`sinceLastRun` keys on the first-seen `fetched_at`).

**Full nightly estimate (GitHub runner):** steady state ~15-25 min (TED 3 refresh days ≈ 10 min, FTS/CF 3 days ≈ 10-15 min, in parallel; SAM extract 1-3 min; registry: ~1 new monthly collection per night on average, 1-4 min). The first ~8 nights backfill the 90-day window and run to the 32-min budget (+ a day in flight + shard writing) ≈ 40-45 min. Full index ≈ 0.8-1.1 M notices (TED ~210 k, SAM ~100 k, UK ~60 k, registry ~0.5-0.7 M) ≈ 50-90 MB brotli.
