# DRAFT — Action 1: optimize existing inventory (not live, needs owner approval)

Evidence date 2026-09-15. Sources: state/gap_validation.json and a Store search probe.

## What the Store search probe showed
- Search is full-text relevance first, popularity second. Our exact title "SEC EDGAR Filings Scraper API" ranks **#1**, and "sec edgar full text" / "edgar full-text search" rank **#16**. The short head term "sec edgar filings" matches 1,052 Actors, and we are not in the top 50: every top result also contains the phrase, so usage breaks the tie.
- Ranking is not strictly by usage (e.g. for "sam.gov", a 20-user Actor sits above a 113-user one), but every top-12 result has the query phrase in its title, and most have it in the slug.
- **So:** our titles are already keyword-dense, and rewriting them mostly reshuffles text matches. First real users (the popularity tiebreak) and long-tail phrases are the levers. Expected impact of listing rewrites: low. Expected impact of a better first run: medium, because it converts the traffic we already get.

## A1-F — First-run hook (recommended, highest value)
The Console form uses `prefill`; API users get `default`. We keep defaults for API users and lower only the prefilled caps, so a first run is fast, cheap and shows the best feature.

| Actor | Change | Prefilled first run then costs |
|---|---|---|
| sam-gov-contracts | prefill `maxResults` 25 (default 1000 stays) | ≤ $0.05 |
| sec-edgar-filings-search | prefill `maxResults` 25 | ≤ $0.05 |
| eu-ted-tenders-monitor | prefill `maxResults` 25 | ≤ $0.08 |
| federal-register-monitor | prefill `maxResults` 25 | ≤ $0.07 |
| fda-recalls-monitor | prefill `maxResults` 25 | ≤ $0.08 |
| sitemap-url-extractor | prefill `maxUrlsPerSite` 200 **and `checkStatus` true** (shows the 404 feature) | ≤ $0.06 |
| company-jobs-scraper | prefill `maxJobsPerCompany` 25 | ≤ $0.10 |
| others (VAT, OFAC, UK, email, lighthouse, ECB, weather, wiki, OFF) | none: prefills are already small | — |

We would also add a 3-line **"Quick start"** block at the top of every README: (1) click Start with the prefilled input, (2) what you get (row count and fields), (3) what the prefilled run costs. No README has one today.

## A1-S — Listing copy (optional, low impact)
Only one title lacks its buyer phrase as a contiguous string:
- eu-vat-validation: title `EU VAT Number Validation API — VIES Bulk Checker` → `EU VAT Validation API — VIES VAT Number Checker (Bulk)` (52 chars; "vat validation" becomes contiguous; still ranks for "vies").

Long-tail FAQ entries in READMEs (these match multi-word queries that are winnable):
- SEC: "How do I use EDGAR full-text search via API?", "How do I monitor new 8-K filings?"
- SAM.gov: "How do I get SAM.gov contract opportunities without an API key?"
- Companies House: "Is there a Companies House API without registering?"
- EU tenders: "How do I get TED tender notices by CPV code?"
- Sitemap: "How do I find 404 URLs listed in a sitemap?"

## A1-P — Pricing experiments (recommendation: do not start yet)
- A price test needs traffic to measure. Today every Actor has 0–1 organic users, so a weekly A/B shows noise, not elasticity.
- Mechanics limit it further. PPE price changes are Console-only (a Routine cannot apply or roll back prices by itself). Once an Actor has paying users, Apify limits price changes (monthly limit, and increases need advance notice to users), so a *weekly* rollback is only possible for decreases.
- Proposal: a zero-token **pricing guard** in the weekly scorecard, using the public Store API's organic users and runs:
  - Trigger a test only when an Actor has ≥ 5 organic users/30d.
  - No paid usage for 14 days → propose −20% (Console change after owner approval).
  - Paid runs growing 2 weeks in a row → propose a +25% test on that Actor only.
  - After any change, organic runs fall > 30% within 2 weeks → rollback proposal flagged URGENT in WEEKLY_REPORT.md.
  - The Routine prepares and alerts; the owner approves; the Console change is applied by the owner or the browser session; `apply_price_changes.py` then propagates it.

## Approval items
- A1-F first-run prefills + Quick start blocks (7 input schemas + 16 READMEs, then rebuild): yes/no
- A1-S VAT title + long-tail FAQ entries (5 READMEs): yes/no
- A1-P pricing guard in the weekly scorecard (no price changes now): yes/no
