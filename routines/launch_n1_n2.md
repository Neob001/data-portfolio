# Launch N1/N2 (jobs-bulk-feed, expired-jobs-checker) — run on/after 2026-11-10

Owner-approved 2026-11-03 (DECISIONS "N1 jobs-bulk-feed publish", "N2 expired-jobs-checker publish"). Prices already set in the
Console (verified via API 2026-11-03), icons and listings done. Run when the owner says "launch N1/N2". CLAUDE.md rule 6 applies:
free plan only; if BudgetExceeded appears, STOP — never work around it. Change no price, title or other Actor.

Env: `cd scripts && export APIFY_TOKEN=$(cat ~/.apify_token) && unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy`, python `~/.local/bin/python3.12`.

1. `git pull --rebase`. `get('/users/me/limits')`: cycle startAt 2026-11-10 (or later) and monthlyUsageUsd < 1.0, else stop.
2. Prices via API: jobs-bulk-feed (Rfmoj3qtukvcC5ihh) only `job-result` FREE 0.002 / BRONZE 0.0018 / SILVER 0.0016 / GOLD 0.0014;
   expired-jobs-checker (nT117PX5oSpwS4oxs) only `job-checked` 0.0001. Else stop.
3. `rebuild_actors.py jobs-bulk-feed expired-jobs-checker`; samples only:
   `staging_run.py jobs-bulk-feed '{"postedWithinDays":3,"maxResults":100,"sinceLastRun":false}'`, `staging_run.py expired-jobs-checker '{}'` — both SUCCEEDED, >0 items.
4. `publish_actors.py`; `publish_tasks.py --only new-jobs-last-24h-bulk us-jobs-bulk-feed remote-jobs-bulk-feed check-if-jobs-still-open`.
5. Cross-links: add both Actors to "## factpipe Jobs & Hiring Data" in the READMEs of ats-jobs-feed, remote-jobs-feed, ats-jobs-scraper,
   companies-hiring, company-jobs-scraper, and to the "## factpipe Jobs Data" template in scripts/make_ats_actors.py (then regenerate).
   `readme_hero.py jobs-bulk-feed expired-jobs-checker`.
6. registry: both status "live", launched_at now. Clean-clone CI loop (sync_shared/sync_jobs_core/make_ats_actors --check, publisher tests,
   every actor's node --test). Commit + push.
7. `rebuild_actors.py` for every Actor whose README changed (expected cost < $0.30 of the $5 credit). `build_docs.py`, commit + push.
8. LEARNINGS line with sample results and own usage after the work.
