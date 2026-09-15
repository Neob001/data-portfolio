# FDA Recalls Scraper API — Food, Drug & Device Recalls

Search and monitor **FDA recalls and enforcement reports** across food, drugs, and medical devices via the **official openFDA API**. Filter by keyword, classification (Class I/II/III), and report date; run on a schedule in incremental mode to catch every new recall the day FDA publishes it. Clean, flat JSON records for supply-chain risk, QA, retail compliance, and news monitoring.

## What you get

```json
{
  "recall_number": "F-0609-2015",
  "event_id": "69516",
  "product_type": "Food",
  "classification": "Class I",
  "status": "Terminated",
  "recalling_firm": "Oasis Brands, Inc",
  "city": "Miami",
  "state": "FL",
  "country": "United States",
  "product_description": "Crema GuateLinda (Guatemalan Style Cream)...",
  "reason_for_recall": "Virginia State (VDACS) found Listeria monocytogenes...",
  "product_quantity": "144 pieces",
  "distribution_pattern": "FL, GA, NC, and TN",
  "voluntary_mandated": "Voluntary: Firm initiated",
  "recall_initiation_date": "2014-10-01",
  "report_date": "2014-10-15",
  "source_url": "https://api.fda.gov/food/enforcement.json?...",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## Use cases

- **Supply-chain risk**: monitor recalls touching your suppliers, ingredients, or product categories.
- **Retail & food-service compliance**: daily incremental runs feed your QA workflow automatically.
- **Healthcare & pharmacovigilance**: track drug and device Class I recalls as they publish.
- **AI agents**: small input schema, deterministic output — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `category` | `food` \| `drug` \| `device` | Which enforcement database |
| `searchTerm` | string | Optional keywords |
| `classifications` | string[] | `Class I`, `Class II`, `Class III` |
| `reportedAfter` | `YYYY-MM-DD` | Lower bound on report date |
| `maxResults` | integer | Cap on charged results (default 100) |
| `sinceLastRun` | boolean | Incremental monitoring mode |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `recall-result` | **$3.00 per 1,000** ($0.003 each) | One recall record delivered. **Empty runs are never charged.** |

Example: 1,000 recall records cost **$3.00**. You only pay for delivered results.

## factpipe Compliance Suite

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

## FAQ

**Do I need an openFDA API key?**
No. The Actor calls the official openFDA enforcement endpoints without a key and respects their rate limits.

**Can I get only serious (Class I) recalls?**
Yes. Set `classifications` to `Class I` and schedule daily with `sinceLastRun: true` for a new-recall alert feed.

**Which recalls are covered?**
All openFDA enforcement reports for food, drugs and medical devices, with recalling firm, product, reason, quantity and distribution pattern.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official openFDA API, polite rate limiting, retries with backoff, structured failure reporting, daily issue triage.
