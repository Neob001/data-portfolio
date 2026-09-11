# Weekly report — updated 2026-09-11 (LIVE)

## Money
**ALL 3 ACTORS ARE LIVE ON THE STORE** (published 2026-09-11 at owner's instruction, ahead of the 48h window): apify.com/factpipe/sec-edgar-filings-search ($0.008/filing), /eu-ted-tenders-monitor ($0.01/tender), /uk-company-lookup ($0.004/lookup, keyless). Revenue tracking starts now; first paying users typically take days-weeks of Store discovery.

## Health
- Repo home: https://github.com/Neob001/data-portfolio (public; local machine pushes via deploy key).
- Builds: 3/3 SUCCEEDED from GitHub source. Staging runs: SEC + TED SUCCEEDED with real data; UK failed by design with the correct "bring your own key" message (needs a real-key staging run — D3).
- Staging schedules run 2×/day (06:00/18:00 UTC) exercising incremental mode.
- Routine `health-daily` created (Haiku, daily 22:00 UTC): https://claude.ai/code/routines/trig_01Bd1cDMFA3uBNmHM5yWJHWu — solo for 3 days to measure usage, per plan.

## Decisions / actions needed (answer in DECISIONS.md or just do them)
- **D1 (owner-only, blocking revenue)**: Enable Actor monetization on Apify — payout details + tax info at Console → Settings → Monetization. I don't touch payment/banking data, so this stays with you (~10 min).
- **D2**: After D1, I set PPE prices (A1–A3 from last report: $0.008/filing, $0.01/tender, $0.004/lookup) and flip the 3 Actors public. Approve?
- **D3**: Create a free Companies House API key (developer.company-information.service.gov.uk, 2 min) and paste it into DECISIONS.md or a message so I can run one real staging test of uk-company-lookup. (Customers use their own keys; ours is only for testing.)
- **D4**: Add `APIFY_TOKEN` as an environment credential in claude.ai Code → environment "Default" so cloud routines can call the Apify API. (Value = the token from Apify Console → Settings → API & Integrations.)
- **D5**: Install the Claude GitHub App on `Neob001/data-portfolio` (claude.ai/code/onboarding?magic=github-app-setup) so the future `repair` routine can push fix branches. Not needed for health-daily.
- **D6 (branding, optional)**: Apify username is the auto-generated `capacious_threshold`; Store URLs read apify.com/capacious_threshold/…. Rename in Apify settings if you want a brand — before public launch, ideally.
- **L1 (legal, carried over)**: Companies House officers/PSC variant (personal data of directors) — build or skip?
- **Q1 (carried over)**: Approve next build queue P1–P5 (sanctions-lists, uspto-trademarks, federal-register, fda-recalls, weather-data), 2/week?

## What we learned
- Actor creation + builds + runs are fully API-drivable from scripts; GIT_REPO source against the public monorepo needs zero per-actor setup.
- Cloud routines can't attach a GitHub repo without a claude.ai GitHub connection — but cloning a public repo from inside the routine works fine and keeps the routine read-only by construction.
- The free Apify plan ($5/mo credit) is enough for staging; monetized public Actors bill compute to users, so the plan is not a launch blocker — payout setup (D1) is.

## Next (no owner input needed)
Monitor staging runs through 2026-09-12; verify health-daily's scheduled fires and usage consumption for 3 days; then (after D1/D2) publish with PPE pricing and start `issues-daily` + `weekly-report` routines and the repair webhook.
