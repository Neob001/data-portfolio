# Routine: issues-daily (schedule: daily · model: Haiku; Sonnet ONLY for bug reproduction)

1. Run `python3 scripts/issue_triage.py`.
2. Template matches in state/issue_replies.json: post automatically ONLY for template classes the owner has enabled via an `APPROVE auto-reply-<template-id>` line in DECISIONS.md. Otherwise copy them into WEEKLY_REPORT.md "Issue replies awaiting approval".
3. For state/issues_for_model.json (you, Haiku): classify each issue (bug / feature request / user error / pricing) and draft a reply (max 120 words, friendly, concrete next step). Put drafts into WEEKLY_REPORT.md "Issue replies awaiting approval".
4. ONLY if an issue is a credible bug report with concrete failing input: reproduce with Sonnet — scope limited to running that one actor's tests locally with the reported input against `src/transform.js`. If reproduced, note it in the draft reply and add a line to WEEKLY_REPORT.md "Needs attention"; the repair path is the repair Routine, not you.

Response-time target: every new issue has a drafted reply within 6 hours of the daily run. Never promise features. Never discuss internals. Append counts to LEARNINGS.md (`date | issues | templated | drafted | reproduced`).
