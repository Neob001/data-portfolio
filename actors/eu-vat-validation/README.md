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

## Related factpipe Actors

- [UK Companies House Lookup API — Company Data, No API Key](https://apify.com/factpipe/uk-company-lookup) — UK company registry records
- [OFAC Sanctions Screening API — SDN List Check for AML/KYC](https://apify.com/factpipe/ofac-sanctions-screening) — OFAC SDN sanctions screening
- [ECB Exchange Rates API — Official Euro FX Rates, History](https://apify.com/factpipe/ecb-exchange-rates) — official ECB euro exchange rates

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
