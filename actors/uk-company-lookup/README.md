# UK Company Lookup (Companies House)

Look up **UK companies** by company number or name and get a clean, flat JSON record from the **official Companies House API**: legal status, incorporation date, SIC codes, registered office, accounts and confirmation-statement deadlines, insolvency and charges flags. Built for KYB checks, lead enrichment, and AI-agent pipelines. **You are only charged for successful lookups** — misses are free.

## What you get

```json
{
  "query": "Example Widgets Limited",
  "found": true,
  "company_number": "01234567",
  "company_name": "EXAMPLE WIDGETS LIMITED",
  "status": "active",
  "company_type": "ltd",
  "jurisdiction": "england-wales",
  "incorporated_on": "2012-03-15",
  "dissolved_on": null,
  "sic_codes": ["62012", "62020"],
  "registered_office": "1, Example Street, London, Greater London, EC1A 1AA, England",
  "registered_office_postcode": "EC1A 1AA",
  "accounts_next_due": "2026-12-31",
  "accounts_overdue": false,
  "confirmation_statement_next_due": "2026-11-15",
  "has_insolvency_history": false,
  "has_charges": true,
  "company_url": "https://find-and-update.company-information.service.gov.uk/company/01234567",
  "source_url": "https://api.company-information.service.gov.uk/company/01234567",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

Company facts only — this Actor deliberately returns **no personal data** (no officers, no PSC records).

## Use cases

- **KYB / vendor onboarding**: verify status, age, and filing compliance of UK counterparties in bulk.
- **Lead enrichment**: turn a list of company names into verified registry records with SIC codes and location.
- **Credit & risk signals**: overdue accounts, insolvency history, registered charges.
- **AI agents**: single-record lookup with a tiny input schema — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `companyNumbers` | string[] | e.g. `01234567`, `SC123456` |
| `companyNames` | string[] | Resolved via official search, best match |
| `apiKey` | secret string, optional | Works out of the box with no key. Optionally bring your own free key from [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/) for dedicated rate limits |

## Pricing (pay per event)

| Event | Meaning |
|---|---|
| `company-found` | One company successfully found and delivered. **Not-found lookups and empty runs are never charged.** |

## Reliability

Official government API, polite rate limiting inside Companies House quotas, retries with backoff, structured failure reporting, daily issue triage.
