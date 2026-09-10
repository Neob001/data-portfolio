# Learnings (append-only)

## 2026-09-11 — bootstrap session
- Apify Store API (`/v2/store`) is public, no token needed, and returns 30-day run stats incl. FAILED counts, review ratings and full PPE pricing of incumbents — the whole opportunity scan is zero-token. `opportunity_scan.py` weights: log10(demand) × weakness × legal ÷ sqrt(build hours).
- Scan results 2026-09-11: uk-company-lookup demand dwarfs everything safe (21,687 incumbent runs/30d, unrated incumbents); TED incumbents fail 13.7% of runs (reliability is the wedge); SEC incumbents avg 4.0 rating with PPE at ~$0.01/filing (price+quality wedge). Google Trends & Product Hunt have big demand but fail our legal-safety filter — do not revisit.
- SEC full-text search endpoint `efts.sec.gov/LATEST/search-index` works keyless but REQUIRES a User-Agent header identifying the caller; page size fixed at 10; paginate with `from`.
- TED API v3 `POST /v3/notices/search` works keyless; multilingual fields come as `{lang: [values]}` maps (prefer `eng`); CPV codes arrive duplicated — dedupe; pagination via `page` or `iterationNextToken`.
- Companies House API has NO keyless access; decision: customers supply their own free key via secret input (removes our rate-limit exposure, zero owner ops). Officer/PSC data excluded from v1 as PII — owner legal call requested.
- Node 22.16 `node --test <dir>` fails; must glob `tests/*.test.mjs`.
- Local machine has no gh CLI, no Apify CLI, no Apify token — publishing and GitHub remain owner-gated (see WEEKLY_REPORT.md blockers).
- Pattern for all future actors: pure `transform.js` (testable without Apify SDK) + thin `main.js`; golden fixtures are trimmed REAL API captures (~10 KB).
