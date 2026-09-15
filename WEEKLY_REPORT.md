# Weekly report — updated 2026-09-15 (revenue sprint — shipped)

## Money
- **Revenue: still ~$0.** **16 live Actors** (5 published today, verified public with exact PPE). The first real outside user showed up: `us-weather-forecast` has 3 users (2 in the last 7 days); every other Actor is just us plus Apify's auto-tester.
- **Main cause, from market data:** our prices were **2–4× the competitor median** (SEC $8 vs $2, TED $10 vs $4, OFAC $10 vs $3), and generic search results are ranked by popularity. For queries like "sec edgar", "companies house", "wikipedia" or "sitemap" we rank below position 50; for narrower queries we sit around 18–39.
- **Price cuts (P1) LIVE, verified via API:** SEC $2, TED $3, OFAC $3, Federal Register $2.50, FDA $3, UK companies $2.50 per 1,000. Listings and READMEs updated and rebuilt.

## Health
- **Four bugs found and fixed in live Actors before any outside user ran into them** (all verified with live runs):
  1. `sinceLastRun` never worked on SEC, TED, Federal Register and FDA. The cursor was stored in the run's temporary storage, so scheduled customers would have been charged again for the same records every day. It now uses a persistent named store and handles capped runs correctly.
  2. SEC ignored `startDate` and `endDate`, returning results from 2004–2018 for "since Sept 1".
  3. SEC runs over 100 results **charged about 90% duplicates** because pages overlapped.
  4. SEC, TED, Federal Register and FDA stopped paginating early when a page contained one malformed record (FDA returned 99 of 133).
- **Verification:** repeat runs deliver 0 records and charge 0. Capped runs pick up where they left off with 0 overlapping IDs. Federal Register returned 139 of 139 against the API total.
- All 16 Actors rebuilt today and every build succeeded. The free plan's 16 GB memory cap allows only 4 builds at a time.

## Published today (5/5 of today's publish limit)
| Actor | Why this niche | Price | Staging |
|---|---|---|---|
| lighthouse-auditor | 7.5k–11.6k runs/mo, **15–24% of competitor runs fail**, only 158 competitors (page 1) | $10/1k audits (compute ~$0.003) | ✅ mobile/desktop, failures not charged |
| sam-gov-contracts | 9k runs/mo, top competitor rated 1.0/5; keyless official extract | $2/1k | ✅ incremental verified, contact emails/phones masked |
| email-security-checker | SPF/DKIM/DMARC, 198 competitors (page 1) | $3/1k domains | ✅ null MX and nonexistent domains handled |
| eu-vat-validation | 6.6k runs/mo from heavy B2B users | $2/1k checks | ✅ VIES throttling retried, never charged |
| ecb-exchange-rates | only 92 competitors (page 1 guaranteed) | $1/1k rows | ✅ cross rates, discontinued currencies not charged |

## Decisions / actions needed
1. ~~A1~~ **DONE:** Chrome reconnected; P1 prices applied and all 5 Actors priced and published.
2. **N5 — Global sanctions screening** (EU + UN + UK consolidated lists alongside OFAC, one listing): compliance buyers, highest willingness to pay, sanctions competitors unrated. About 5h. yes/no
3. **N6 — GLEIF LEI company lookup** (CC0 official API): 42 users/mo, 0% competitor failures, completes a KYB bundle with UK company, VAT and OFAC. About 3h. yes/no
4. **N7 — Broken link checker**: 52 users and 4k runs/mo; SEO bundle with the sitemap extractor and Lighthouse auditor. About 4h. yes/no
5. **N8 — DNS records lookup** (clone of the email-security checker's resolver): 74 users/mo in "dns lookup". About 2h. yes/no
6. **L1** (carried over): Companies House officers/PSC variant (directors' personal data). yes/no
7. **S1 — Action 0 + cross-promotion batch (2026-09-15, awaiting owner):** see state/gap_validation.md and drafts/readme_suite/PREVIEW.md. (a) Replace "Related factpipe Actors" with the cluster suite sections in 11 READMEs, then rebuild. (b) Builds: N8 DNS lookup, N7 broken links. (c) Park CPSC, EU Safety Gate, UK VAT, Grants.gov and Form 4 (no real demand). Fold global sanctions (N5) into the existing OFAC Actor rather than launching a new SKU. (d) France Sirene: needs new-source approval first.

## Analysis: what to launch next, and why
- **The official-data niches are small and crowded.** Across the top 10 competitors combined: SEC 26 users/30d, sanctions 9–12, clinical trials 8, VIN decoder 12. Large catalogs of AI-built Actors (ryanclinton, nexgendata) sit in almost every niche.
- **The pattern that wins first users:** a small total result set (under 300, so we land on page 1 by default), plus proven run volume, plus competitors that fail or rate poorly. Today's 5 builds were chosen that way. N5–N8 are the next best by the same rule, and each links into the catalog (KYB bundle, SEO bundle).
- **Build less, distribute more, once today's batch is live.** Revenue is currently limited by discovery, not catalog size. Measure search ranks and users for 7 days (re-measure 2026-09-22) before adding more than N5–N8.

## What we learned
- **Checking for non-empty output isn't enough.** Staging must compare delivered counts to the API total, and incremental Actors must pass a repeat-run test. That's how today's four live bugs surfaced.
- **Pricing must be benchmarked against the competitor median in the niche**, not against one incumbent. With zero reviews, price is one of the few levers we control.
- **Drop contact columns *and* redact free text** (SAM.gov descriptions embed officers' emails and phone numbers). And direct connections are 13× faster than the local proxy for Store API scans.
