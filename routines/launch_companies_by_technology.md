# Launch companies-by-technology (owner APPROVE "listing companies-by-technology", 2026-11-17)

Approved listing (registry.json `listing`) and price: company-result $0.015 (Store tiers FREE 0.015 / BRONZE 0.0135 /
SILVER 0.012 / GOLD 0.0105). Change nothing else: no other price, title, Actor or live listing. CLAUDE.md rule 6 applies
(free plan only; on BudgetExceeded STOP, never work around it). Never read, print, copy or type the Apify token; use it only via
`export APIFY_TOKEN=$(tr -d '[:space:]' < ~/.apify_token)` inside commands. Never include the owner's e-mail anywhere.
If a permission or safety-classifier denial blocks a step, stop and report it; do not work around it.

Env: `cd scripts && unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy`, python `~/.local/bin/python3.12`.
Push: `GIT_SSH_COMMAND="ssh -i ~/.ssh/data_portfolio_deploy" git push -q origin HEAD:main`. Commit trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Phase A — stage (on/after the first nightly build with companies_tech, 2026-11-17)
1. `git pull --rebase`. Download `manifest.json` and `build_report.json` (name from the manifest) of release `jobs-index`
   (https://github.com/Neob001/data-portfolio/releases/download/jobs-index/<file>). Required: manifest names the
   `companies_tech` asset, build_report `companies_tech` has no `error`, companies with a technology > 5,000, asset 3-20 MB.
   Else stop and report (do not stage).
2. Local run on the real asset: `cd actors/companies-by-technology && npm install --no-audit --no-fund` (if needed) and
   run the Actor locally with input `{"technologies":["Snowflake"],"minJobsMentioning":2,"maxResults":20}` (apify-cli
   `apify run` if installed, else `node src/main.js` with APIFY_LOCAL_STORAGE_DIR in the scratchpad and the input in
   key_value_stores/default/INPUT.json). Required: 20 rows, every row has company/domain-or-board fields, `technologies`
   containing Snowflake, job counts > 0. Also `node --test tests/*.test.mjs` passes. Else stop and report.
3. `get('/users/me/limits')`: monthly usage below $3.00, else stop (wait for the cycle reset on the 10th).
4. registry.json: companies-by-technology status "staging". `create_staging_actor.py companies-by-technology` (private
   Actor, listing, build; sets staging_started_at). Wait for the build to SUCCEED (poll `/actor-builds/<id>`).
   Set the Actor's default run options to memory 2048 MB, timeout 300 s if the create call did not.
5. PPE pricing on the private Actor: try `PUT /acts/<id>` with `pricingInfos` = the existing list + one
   `{"pricingModel":"PAY_PER_EVENT","pricingPerEvent":{"actorChargeEvents":{"company-result":{"eventTitle":"Company result",
   "eventDescription":"One company whose open job posts name the requested technologies, with its tech stack and job counts.",
   "eventTieredPricingUsd":{"FREE":{"tieredEventPriceUsd":0.015},"BRONZE":{"tieredEventPriceUsd":0.0135},
   "SILVER":{"tieredEventPriceUsd":0.012},"GOLD":{"tieredEventPriceUsd":0.0105}}}}}}`. If the API refuses, set exactly
   that price in Apify Console (Actor > Publication > Monetization, pay per event, event name `company-result`) via
   Claude in Chrome if available; if neither works, leave it unpriced and report (publish_actors.py will not publish an
   unpriced Actor). Verify via `get('/acts/<id>')` that the last pricingInfo is PAY_PER_EVENT with company-result FREE 0.015.
6. Sample cloud run: `staging_run.py companies-by-technology '{"technologies":["Snowflake"],"minJobsMentioning":2,"maxResults":20}'`
   — SUCCEEDED with 20 items. Then `{"technologies":["NotARealTechnologyXyz"],"maxResults":5}` — finishes with 0 items
   and no charge (clear status message). Any failure: stop and report.
7. Commit registry/state changes + a LEARNINGS line (sample results, own usage), push.

## Phase B — publish (on/after staging_started_at + 48 h, i.e. 2026-11-19)
1. `git pull --rebase`. registry status is "staging" with staging_started_at >= 48 h ago, else stop.
2. Health: last nightly jobs-index build green and companies_tech present (as in A1); `staging_run.py` sample as in A6
   SUCCEEDED with 20 items.
3. `publish_actors.py` (publishes only staging Actors past 48 h with PPE pricing). Confirm `isPublic` true and the Store page
   https://apify.com/factpipe/companies-by-technology answers 200.
4. registry: status "live", launched_at now. Cross-link (traffic routing, STRATEGY §3.4): add one line for
   companies-by-technology ("Companies by Technology — companies whose job posts name a technology, $15 per 1,000 companies")
   to the "## factpipe Jobs & Hiring Data" section of the READMEs of ats-jobs-feed and companies-hiring only. No other
   README text changes. `rebuild_actors.py ats-jobs-feed companies-hiring companies-by-technology` (usage check first).
5. CI loop (sync_shared/sync_jobs_core/make_ats_actors --check, scripts/jobs_index/test_publish_release.py, every Actor's
   `node --test tests/*.test.mjs`; tech-stack-detector failing only on missing cheerio locally is expected), commit, push.
6. LEARNINGS line; short plain-language report for the owner (link, sample results, own usage).
