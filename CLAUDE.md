# data-portfolio operating rules (condensed — the full brief lives with the owner)

One-person, AI-native data business: narrow pay-per-event Actors on Apify Store from public, legally safe sources. Owner reviews ~1h/week via WEEKLY_REPORT.md and DECISIONS.md; everything else is automated.

## Hard constraints (never violate)
1. **No Anthropic API key anywhere.** No model calls at Actor runtime — Actors are deterministic Node.js. All model work runs as Claude Code Routines under the Max subscription.
2. **Zero-token first.** Every job tries scripts/ before any model. Escalation: script → Haiku → Sonnet → Opus/Fable, each only when the previous explicitly fails. Repair scope = one actor dir, make golden tests pass, no refactors. Max 1 Opus repair/actor/day.
3. **Legal:** public data only; no PII (no officers/PSC/person profiles); no login walls; no ToS-forbidden sources; avoid LinkedIn/Amazon/Instagram/Facebook. New sources need an APPROVE line in DECISIONS.md first.
4. **Pricing:** PPE only (rentals retired). Charge only successful non-empty results. Launch 10–20% below incumbent per-result cost; changes go through scripts/pricing.py proposals + owner approval.
5. Truncate everything fed to a model: last 200 log lines, tiny golden samples, one actor dir.

## Layout
- `actors/<slug>/`: src/ (main.js + pure transform.js + lib/ synced from shared/js — NEVER edit lib/ directly), tests/ (node --test vs golden/), INPUT_SCHEMA.json, .actor/, README.md.
- `scripts/`: zero-token jobs (health, classify_failure, autofix_l1, pricing, opportunity_scan, issue_triage, report, sync_shared).
- `routines/`: one prompt file per Routine — follow them exactly.
- `registry.json`: source of truth for every actor (id, status, pricing, KPIs).
- `DECISIONS.md`: owner approvals (`YYYY-MM-DD | APPROVE|REJECT | item-id | note`). Read at the start of every run.
- `LEARNINGS.md`: append-only; log every repair/issue/price change/launch.
- `state/`: script outputs (json), not hand-edited.

## Actor standard
Flat typed records, ISO dates, `source_url` + `fetched_at` on every record; explicit PPE events; retries/backoff/rate limits via shared http.js; structured failure classes (`http_error timeout blocked selector_miss schema_change site_down`); RUN_SUMMARY key-value record every run; 3–5 tiny golden fixtures with passing tests; README with use-case keywords, JSON sample, small input schema. One Actor = one action. 48h private staging before public.

## Workflow
After editing shared/js: run `python3 scripts/sync_shared.py` and commit the synced copies. Per-actor check: `cd actors/<slug> && npm test`. Model-written fixes go to `claude/*` branches, never straight to main.
