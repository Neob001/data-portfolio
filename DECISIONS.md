# Decisions log

Owner writes one line per decision: `YYYY-MM-DD | APPROVE|REJECT | item-id | note`

Item ids come from WEEKLY_REPORT.md. Nothing ships to a new data source, changes price, or auto-replies to an issue class without an APPROVE line here.

<!-- decisions below this line -->

## Standing decisions (owner) — 2026-09-12
<!-- appended verbatim from owner-provided addendum-fast-revenue-modules.md on 2026-09-12 -->
2026-09-12 | APPROVE | AUTO-APPROVE replacements: yes | Top-3 opportunity_score per day, legal_flag == false, public site, no login. Build and publish without asking. Owner may veto within 24h by adding a REJECT line with the INC-id; a veto unpublishes the Actor.
2026-09-12 | APPROVE | AUTO-APPROVE demand builds ≤ 6h: yes | Buildable demand hits with estimated build ≤ 6h, legal_flag == false, no personal data. Build and stage without asking. Owner may veto within 24h by adding a REJECT line with the DC-id.
2026-09-12 | REJECT | AUTO-POST community replies | Never. Community replies are posted only after the owner ticks [x] in DAILY_APPROVALS.md.
2026-09-12 | REJECT | INC-3 | Europages replacement rejected (owner, in chat): CAPTCHA-gated ToS = no automated access; anti-bot arms race contradicts official-API moat. Official EU registries (INSEE/Sirene) queued as alternative.
2026-09-12 | REJECT | identity-verified sources (standing) | Owner, in chat: never pursue any data source or API whose access requires photo-ID + selfie identity verification (ID.me or equivalent). USPTO ODP dropped from the build queue under this rule. Applies to all future scans and proposals.
2026-09-13 | APPROVE | W1 | Owner, in chat: rewrite Store titles/descriptions for discovery immediately; goal = revenue ASAP.
2026-09-13 | APPROVE | W3 | Owner, in chat: build and publish wikipedia-data (official MediaWiki/Wikidata APIs, CC BY-SA attribution fields on every record; living/any person articles excluded per no-person-profiles rule).
2026-09-13 | APPROVE | W4 | Owner, in chat: build and publish open-food-facts (official OFF API, ODbL attribution on every record; contributor usernames excluded).
2026-09-15 | APPROVE | P1 price realignment | Owner, in chat: cut to competitor median — sec-edgar $8->$2, eu-ted $10->$3, ofac $10->$3, federal-register $5->$2.50, fda-recalls $5->$3, uk-company $4->$2.50 per 1,000. Evidence: niche scan 2026-09-15, we were 2-4x median with zero reviews.
2026-09-15 | APPROVE | N1 sam-gov-contracts | Owner, in chat: SAM.gov contract opportunities (official API, free key). Drop if key issuance requires photo-ID verification (standing rule).
2026-09-15 | APPROVE | N2 email-security-checker | Owner, in chat: SPF/DKIM/DMARC/MX domain audit via public DNS.
2026-09-15 | APPROVE | N3 ecb-exchange-rates | Owner, in chat: official ECB reference rates.
2026-09-15 | APPROVE | N4 eu-vat-validation | Owner, in chat: official EU VIES VAT number validation.
2026-09-15 | APPROVE | INC-4 lighthouse-auditor | Standing replacement decision: nexgendata/page-speed-analyzer fails 26.6% of 6,851 runs/30d; niche 7.5k-11.6k runs/mo at 15-24% failure. Built on open-source Lighthouse (Apache-2.0), not the Google PSI API (Google API terms forbid re-offering the API to third parties).
2026-09-15 | APPROVE | S1a suite README sections | Owner, in chat ("approve all"): replace "Related factpipe Actors" with factpipe Compliance Suite / Website Audit Toolkit sections in 11 READMEs (drafts/readme_suite), then rebuild.
2026-09-15 | APPROVE | N8 dns-records-lookup | Owner, in chat: public DNS resolvers; build + stage; publish after owner publish approval.
2026-09-15 | APPROVE | N7 broken-link-checker | Owner, in chat: user-supplied public URLs; build + stage; publish after owner publish approval.
2026-09-15 | APPROVE | N5 global sanctions as OFAC upgrade | Owner, in chat: add EU FSF consolidated list, UK Sanctions List and UN Security Council consolidated list to ofac-sanctions-screening (no new SKU, price unchanged).
2026-09-15 | APPROVE | france-sirene source | Owner, in chat: French company registry via official open-data APIs (recherche-entreprises.api.gouv.fr keyless / INSEE Sirene). No dirigeants/officers; sole-proprietor (personne physique) names excluded per no-PII rule.
2026-09-15 | REJECT | park uk-vat, cpsc-recalls, eu-safety-gate, grants-gov, sec-form4 | Owner, in chat: parked until gap_validation shows real demand (organic users).
2026-09-15 | APPROVE | PUB-3 publish dns-records-lookup, broken-link-checker, france-company-lookup | Owner, in chat: publish after clean staging at $1.50/1k domains, $1.50/1k pages, $3/1k companies.
2026-09-15 | APPROVE | A1-F first-run prefills + Quick start | Owner, in chat: small prefilled caps (defaults unchanged) + Quick start block in every README, then rebuild.
2026-09-15 | APPROVE | A1-S listing copy | Owner, in chat: eu-vat-validation title "EU VAT Validation API — VIES VAT Number Checker (Bulk)" + long-tail FAQ entries (SEC, SAM.gov, Companies House, EU tenders, sitemap).
2026-09-15 | APPROVE | A1-P pricing guard | Owner, in chat: rules-based weekly pricing guard in the scorecard; proposals only, no price changes until an Actor has >=5 organic users/30d.
2026-09-18 | APPROVE | PPE broken-link-checker | Owner, in chat: switch from pay-per-usage to PPE page-scanned $0.0015 (effective 2026-10-02 after Apify's 14-day notice); users emailed with reason: 'Moving to simple pay-per-page pricing: $1.50 per 1,000 pages scanned, with every link on each page checked at no extra cost.'
2026-09-18 | APPROVE | J1 jobs feed | Owner, in chat ("approve all"): aggregate public ATS job-board APIs (Greenhouse, Lever, Ashby + new sources Workable, SmartRecruiters, Recruitee) into a searchable deduplicated feed, $3/1k jobs. Drop any source whose terms forbid this use. No personal data (recruiter/hiring-manager names and emails stripped).
2026-09-18 | APPROVE | S2 website screenshot | Owner, in chat: bulk screenshots of user-supplied URLs.
2026-09-18 | APPROVE | N9 news monitor (GDELT) | Owner, in chat: keyword/company news + adverse-media screening from GDELT open data.
2026-09-18 | APPROVE | A2 App Store reviews | Owner, in chat: Apple's official public customer-reviews RSS feed; reviewer names dropped.
2026-09-18 | APPROVE | F1 freeze official-data niches | Owner, in chat: no new small official-data Actors; existing 19 are maintenance-only; spike monitor shelved.
2026-09-18 | APPROVE | D2 distribution pages | Owner, in chat: one-time static tutorial pages (GitHub Pages) per Actor with API examples.
2026-09-18 | REJECT | A2 App Store reviews | Auto-rejected under standing ToS rule (CLAUDE.md rule 3) before any code: Apple Media Services Terms (apple.com/legal/internet-services/itunes/us/terms.html) limit Content to personal, noncommercial use and prohibit automated scraping/analysis; the iTunes Search API terms grant no commercial redistribution. Owner's A2 approval superseded.
2026-09-19 | APPROVE | J1 index hosting A | Owner, in chat: daily GitHub Actions build; slim index published as public assets of GitHub release `jobs-index` (no secrets); the Actor reads it from the release URL.
2026-09-19 | APPROVE | PUB website-screenshot | Owner, in chat: "publish S2" at $2/1k screenshots.
