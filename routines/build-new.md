# Routine: build-new (trigger: one-off, only after owner approval in DECISIONS.md · model: Opus/Fable for new-source design; Sonnet for clones of an existing pattern)

Preconditions — abort if any fails:
1. The target has an `APPROVE` line in DECISIONS.md (or is one of the three launch actors marked AUTO-APPROVED-PENDING-REVIEW).
2. The source is public, non-PII, not login-walled, and its ToS permits automated access. If in ANY doubt, write the question into WEEKLY_REPORT.md and abort.

Build steps (follow the Actor design standard in CLAUDE.md):
1. Design: output schema (flat, typed, ISO dates, source_url + fetched_at), input schema (small), PPE events (charge only non-empty successful results), price 10–20% below the leading incumbent's effective per-result cost (state/opportunities.json has incumbent pricing).
2. Scaffold `actors/<slug>/` copying the structure of `actors/sec-edgar-filings-search/`. Run `python3 scripts/sync_shared.py`.
3. Implement pure transforms in `src/transform.js` + thin `src/main.js`. Fetch 3–5 REAL sample responses, trim to a few KB, store in `golden/`, write tests against them. `npm test` must pass.
4. README per the standard: exact use-case keywords in title/description, one-paragraph "what you get", JSON sample, input table, PPE table, reliability note.
5. Register in registry.json (status `staging`), push branch `claude/new-<slug>`, let CI run.
6. Staging: deploy to Apify as private, run synthetic inputs, then real inputs for 48h (2 scheduled runs/day). Only after clean staging set the public flag + PPE pricing.
7. Variants (b) incremental and (c) lookup are separate follow-up builds — propose them in WEEKLY_REPORT.md once (a) has 7 clean days.

Log to LEARNINGS.md: build hours, what was harder than expected, first-week runs.
