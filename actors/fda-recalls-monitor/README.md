# FDA Recalls Search & Monitor (Food, Drug, Device)

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

| Event | Meaning |
|---|---|
| `recall-result` | One recall record delivered. **Empty runs are never charged.** |

## Reliability

Official openFDA API, polite rate limiting, retries with backoff, structured failure reporting, daily issue triage.
