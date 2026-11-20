# Routine: workday-local (local scheduled task, daily 17:00 JST = 08:00 UTC, before the ~11:00-12:00 UTC cloud build)

Owner OK 2026-11-21 ("yes, build the Workday part locally"): Workday answers robots.txt 429 to cloud IPs, 200 to the
owner's Mac. Background: scripts/jobs_index/README.md "Workday read on the owner's Mac".

Rules: zero-token job, no model work beyond starting/watching the script. Never print or copy tokens/keys (the script
uses the deploy key ~/.ssh/data_portfolio_deploy itself). Never send the owner's e-mail anywhere. Do not edit code here:
any fix goes to a claude/* branch and waits for the owner. If a permission check denies something, stop and report it.

Repo: /Users/neo/Library/Application Support/Claude/scratch-workspaces/506d9ec1-07a7-4c6b-96a3-08d75839c2e0/10005033-008c-466f-9bc2-a6661241c23b/scratch-2026-09-10-534c6f/data-portfolio

1. Start `scripts/jobs_index/workday_local.sh` from the repo as a background command (it takes ~1.5-2.5 h; it refuses to
   start if another run holds its lock).
2. Wait for it to finish (background-command notification or an until-loop on its process; do not poll more often than
   every 5 min). Its last line is `WORKDAY_LOCAL OK ...` or `WORKDAY_LOCAL FAIL <reason>`.
3. OK: done; report the line in one sentence (boards, jobs, rate-limited count). Expect ~4,000+ boards; if fewer than
   2,000 or rate-limited > 500, say so: Workday may be throttling the Mac too.
   FAIL: report the reason and the last 30 lines of ~/Library/Caches/factpipe-workday/last_run.log. Do not retry more
   than once.
