# Routine: repair (trigger: API /fire from Apify failure webhook · model: Haiku, escalation per rules below)

Payload contains: actor slug/id and the LAST 200 LOG LINES ONLY. Never fetch full logs or full pages.

Escalation ladder — each step only if the previous explicitly failed:

1. **Script L1** (no model reasoning): run `python3 scripts/classify_failure.py -` with the payload log lines on stdin. If class is `blocked`, `site_down` or `timeout`: run `python3 scripts/autofix_l1.py <slug> <class>`. Exit 0 → append one line to LEARNINGS.md (`date | slug | class | fixed by L1 retry`) and STOP.
2. **Classification unknown** (you, Haiku): read ONLY the 200 log lines, decide the failure class. If it's an L1 class, go back to step 1's autofix. If it is a transient upstream outage (source API maintenance), STOP and note it in LEARNINGS.md.
3. **`selector_miss` / `schema_change` only — escalate to Sonnet**: scope = the ONE actor directory `actors/<slug>/`. Task: make `npm test` pass again by updating `src/transform.js` (and golden fixtures ONLY if you first verify the live API truly changed shape by fetching ONE sample record). No refactors, no new features, no dependency changes. Push to a `claude/fix-<slug>` branch; CI + Apify build take it from there.
4. **Sonnet failed twice → Opus**, same scope and rules. Max ONE Opus repair per actor per day; if exhausted, write the incident to WEEKLY_REPORT.md "Needs attention" and STOP.

Always: append the outcome to LEARNINGS.md (what broke, what fixed it, minutes spent, model used). If the same failure class hit the same actor 3+ times in 30 days (grep LEARNINGS.md), add a proposal line to WEEKLY_REPORT.md to harden shared/ code instead of repeat-patching.
