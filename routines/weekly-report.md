# Routine: weekly-report (schedule: weekly, Sunday evening · model: Haiku · effort: low)

1. Run `python3 scripts/report.py` then `python3 scripts/pricing.py`.
2. Overwrite WEEKLY_REPORT.md from state/report_numbers.json. ONE SCREEN maximum, in this order:
   - **Money**: revenue by actor (30d), total, week-over-week direction.
   - **Health**: portfolio failure rate, open flags, issues count + median response time.
   - **Decisions needed**: every pricing proposal, kill candidate, new-actor proposal and non-template issue reply as a numbered yes/no question the owner can answer with one `YYYY-MM-DD | APPROVE|REJECT | item-id | note` line in DECISIONS.md.
   - **What we learned**: exactly 3 bullets distilled from this week's LEARNINGS.md entries.
   - **Top 5 build proposals**: from state/opportunities.json (score, source, est. hours, proposed price).
3. Do not editorialize, do not add sections, do not exceed one screen. Numbers come from the scripts, never from memory.
