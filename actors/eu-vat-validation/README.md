# EU VAT Number Validation API — VIES Bulk Checker

Validate **EU VAT numbers in bulk** against the **official European Commission VIES service** and get a clean record per number: valid or invalid, the registered trader name and address (where the member state provides them), and the check timestamp. VIES throttles heavily and member-state services go offline often — this Actor retries automatically and **only charges for definitive answers**.

## What you get

```json
{
  "query": "IE6388047V",
  "checked": true,
  "country_code": "IE",
  "vat_number": "6388047V",
  "full_vat_number": "IE6388047V",
  "valid": true,
  "name": "GOOGLE IRELAND LIMITED",
  "address": "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4",
  "checked_at": "2026-09-15T07:36:47.788Z",
  "consultation_number": null,
  "source_url": "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

## Use cases

- **Invoicing & reverse charge**: verify a customer's VAT number before issuing a zero-rated B2B invoice.
- **Onboarding & KYB**: validate company VAT numbers in bulk and match the registered name.
- **CRM hygiene**: schedule re-validation of your customer base and catch deregistered numbers.
- **AI agents & automations**: call from Make, Zapier, n8n or MCP with a list of numbers.

## Input

| Field | Type | Notes |
|---|---|---|
| `vatNumbers` | string[], required | e.g. `IE6388047V`, `DE 811 569 869` |
| `defaultCountryCode` | string | Applied to numbers without a prefix |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `vat-checked` | **$2.00 per 1,000** ($0.002 each) | One definitive VIES answer (valid or invalid) delivered. Unrecognized formats and checks VIES could not answer are never charged. |

Example: validating 1,000 VAT numbers costs **$2.00**. Numbers VIES could not answer are free. No start fee. You only pay for delivered results.

## factpipe Compliance Suite

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

## FAQ

**Why do some countries return no name or address?**
Some member states (Germany, for example) do not disclose trader details through VIES. The validity result is still authoritative.

**What happens when VIES is busy or a country's service is down?**
The Actor retries with backoff. If VIES still cannot answer, the number is returned with `checked: false` and the VIES error code, and it is not charged.

**Is this the official validation?**
Yes. Every result comes from the European Commission's VIES REST service; `checked_at` is the timestamp VIES returned.

**Does it work for UK VAT numbers?**
Only Northern Ireland (XI prefix) is in VIES. Great Britain (GB) numbers are validated by HMRC and are reported as not recognized, never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic code against official sources, automatic retries with backoff, structured failure reporting, daily health checks and issue triage.
