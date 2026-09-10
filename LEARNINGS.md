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

## 2026-09-11 — go-live session (accounts connected)
- GitHub home: https://github.com/Neob001/data-portfolio (public), pushed via write deploy key `~/.ssh/data_portfolio_deploy`; `core.sshCommand` set in-repo, so plain `git push` works.
- Apify account `capacious_threshold` (FREE plan, $5 credit/month, ACTORS_PUBLIC_ALL enabled). Token stored at `~/.apify_token` (chmod 600); export `APIFY_TOKEN=$(cat ~/.apify_token)` before scripts.
- Actor creation via `POST /v2/acts` with `sourceType: GIT_REPO` + `gitRepoUrl ...#main:actors/<slug>` builds straight from the public monorepo — no per-actor deploy keys needed. All 3 builds succeeded first try.
- Staging runs: SEC + TED SUCCEEDED with real data; UK failed by design with the correct "bring your own key" error. Staging schedules `staging-sec-edgar` / `staging-eu-ted` run 2x/day (06:00/18:00 UTC) exercising `sinceLastRun`.
- SEC display names can carry ticker suffixes, e.g. "Piedmont Lithium Inc. (PLL, PLLTL)" — harmless, but a future polish is stripping ticker parens in cleanName().
- Chrome automation: `type` into GitHub inputs drops characters; use `form_input` with refs for anything that must be exact.
