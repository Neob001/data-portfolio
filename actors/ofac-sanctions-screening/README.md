# OFAC Sanctions Screening API — SDN List Check for AML/KYC

Screen customer, vendor, and counterparty names against the **official US Treasury OFAC SDN sanctions list** — including the official alternate-names (AKA) list — and get a deterministic, auditable match result per name. The list is downloaded **fresh from treasury.gov on every run**, so results always reflect the current list. Built for KYC/AML onboarding checks, vendor due diligence, and payment screening.

## What you get

One record per screened name — including clean "no match" results for your audit trail:

```json
{
  "query": "Banco Nacional de Cuba",
  "matched": true,
  "match_count": 1,
  "top_match_name": "BANCO NACIONAL DE CUBA",
  "top_match_score": 1,
  "matches": [
    {
      "uid": "306",
      "sdn_name": "BANCO NACIONAL DE CUBA",
      "matched_name": "BANCO NACIONAL DE CUBA",
      "score": 1,
      "type": "unknown",
      "programs": "CUBA"
    }
  ],
  "list_publish_info": "OFAC SDN list, 17842 entries, downloaded 2026-09-11T12:00:00.000Z",
  "source_url": "https://www.treasury.gov/ofac/downloads/sdn.csv",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## How matching works

Deterministic and auditable — no AI guessing: names are normalized (case, accents, punctuation, corporate suffixes), then matched exactly and by token overlap against SDN names **and their official aliases**. You control the threshold with `minScore` (85 is a sensible compliance default; 100 = exact matches only). Scores and the matched alias are reported so reviewers can verify every hit.

> **Note**: screening is a decision-support tool. Potential matches should be reviewed by a human before action, per OFAC guidance.

## Input

| Field | Type | Notes |
|---|---|---|
| `names` | string[], required | People or organizations to screen |
| `minScore` | integer 50–100 | Match threshold in percent (default 85) |
| `includeAliases` | boolean | Screen against official AKAs (default true) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `name-screened` | **$3.00 per 1,000** ($0.003 each) | One name fully screened against the current list — both matches and documented "clear" results. Invalid/empty names are never charged. |

Example: 1,000 names screened cost **$3.00**. You only pay for delivered results.

## factpipe Compliance Suite

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

## FAQ

**Is the OFAC SDN list up to date?**
The Actor downloads the official US Treasury SDN and alternate-names files fresh on every run and returns the list publish date with each result.

**How does fuzzy matching work?**
Names are normalized (case, accents, punctuation, corporate suffixes), then scored by exact and token-overlap matching against every SDN name and, optionally, its official aliases. `minScore` sets the threshold in percent; 85 is a sensible compliance default, 100 means exact only.

**Is this enough for AML/KYC compliance?**
It is a fast, documented first-line screen against the US OFAC SDN list. Your compliance program decides whether additional lists (EU, UN, UK) or manual review are required; potential matches should always be reviewed by a person.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official US Treasury source files, fetched fresh each run; deterministic matching; structured failure reporting; daily issue triage.
