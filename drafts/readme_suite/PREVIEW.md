# DRAFT — cluster cross-promotion sections (not live)

On approval each replaces the README's current `## Related factpipe Actors` section (`python3 scripts/draft_suite_sections.py --apply all`, then rebuild). Wikipedia, Open Food Facts, US Weather, ECB and Jobs keep their current links (low-value or unclustered: no investment).

---
### README of `ofac-sanctions-screening`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | **OFAC Sanctions Screening** (this Actor) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Supplier onboarding:** screen the company name here, confirm the VAT number with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation), then pull status and registered office from [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup).
- **Public-sector bidding:** screen the agencies and awardees you find with [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) or [EU Tenders](https://apify.com/factpipe/eu-ted-tenders-monitor).

---
### README of `eu-vat-validation`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | **EU VAT Validation** (this Actor) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Invoice and onboarding checks:** validate the VAT number here, screen the returned legal name with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening), and for UK entities add [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup).

---
### README of `uk-company-lookup`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | **UK Companies House Lookup** (this Actor) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **KYB file:** confirm the company is active here, screen the registered name with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening), and validate EU trading partners with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation).

---
### README of `sam-gov-contracts`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | **SAM.gov Contracts** (this Actor) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Bid pipeline across both markets:** run this with `sinceLastRun` on a daily schedule next to [EU Tenders](https://apify.com/factpipe/eu-ted-tenders-monitor), and watch [Federal Register](https://apify.com/factpipe/federal-register-monitor) for rule changes affecting your contract categories.
- **Teaming-partner due diligence:** screen partner names with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

---
### README of `eu-ted-tenders-monitor`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | **EU Tenders (TED)** (this Actor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Bid pipeline across both markets:** pair this with [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) for US federal opportunities.
- **Buyer and consortium checks:** validate EU partners with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) and screen them with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

---
### README of `federal-register-monitor`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | **Federal Register Monitor** (this Actor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Regulatory watch desk:** schedule this with [FDA Recalls](https://apify.com/factpipe/fda-recalls-monitor) for enforcement actions and [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) for how companies disclose the impact.

---
### README of `fda-recalls-monitor`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | **FDA Recalls Monitor** (this Actor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Product safety and supplier risk:** track new recalls here, follow related rulemaking with [Federal Register](https://apify.com/factpipe/federal-register-monitor), and check recalling firms' disclosures in [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search).

---
### README of `sec-edgar-filings-search`

#### factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | **SEC EDGAR Filings** (this Actor) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Disclosure and risk research:** combine filing searches with [Federal Register](https://apify.com/factpipe/federal-register-monitor) rule changes and [FDA Recalls](https://apify.com/factpipe/fda-recalls-monitor) enforcement history for the same companies.
- **Counterparty checks:** screen issuers and subsidiaries with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

---
### README of `sitemap-url-extractor`

#### factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | **Sitemap URL Extractor & 404 Checker** (this Actor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |

**Use it together:**

- **Full-site audit:** extract URLs here, send the live pages to [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) for Core Web Vitals, and check the domain's mail setup with [Email Security Checker](https://apify.com/factpipe/email-security-checker).

---
### README of `lighthouse-auditor`

#### factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | **Lighthouse Auditor** (this Actor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |

**Use it together:**

- **Audit every page, not just the homepage:** get the full URL list from [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) first, then audit it here.
- **Client health report:** add SPF/DKIM/DMARC results from [Email Security Checker](https://apify.com/factpipe/email-security-checker).

---
### README of `email-security-checker`

#### factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | **Email Security Checker** (this Actor) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |

**Use it together:**

- **Agency site-and-domain health report:** combine these results with [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) performance scores and [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) broken-URL counts.
