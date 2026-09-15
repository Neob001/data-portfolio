# Sanctions Screening API — OFAC, EU, UK & UN Lists for AML/KYC

Screen customer, vendor, counterparty and vessel names against **four official government sanctions lists in one run** — the **US Treasury OFAC SDN list**, the **EU consolidated financial sanctions list**, the **UK Sanctions List** (FCDO) and the **UN Security Council consolidated list** — including official aliases (AKAs), and get one deterministic, auditable match result per name. Every selected list is downloaded **fresh from the official publisher on every run**, so results reflect the current lists. Built for KYC/AML onboarding, sanctions and watchlist screening, vendor due diligence and payment screening.

**One price per name, however many lists you screen: $3 per 1,000 names.**

## Quick start

1. Click **Start** with the two prefilled names (`Banco Nacional de Cuba`, `Wholesome Bakery of Vermont`). It downloads all four lists fresh, which usually takes about a minute.
2. You get one result per name: the first is a confirmed OFAC match with score and program, the second a documented clear result.
3. That first run costs $0.006, well within Apify's free monthly credit. Then paste your own customer or vendor names.

## Lists covered

| `lists` value | Official list | Publisher & source | Terms |
|---|---|---|---|
| `OFAC_SDN` | Specially Designated Nationals and Blocked Persons (SDN) list, incl. alternate names | US Treasury OFAC — treasury.gov `sdn.csv` + `alt.csv` | US government public data |
| `EU` | Consolidated list of persons, groups and entities subject to EU financial sanctions | European Commission Financial Sanctions Files (FSF), public XML | Public EU dataset (data.europa.eu) |
| `UK` | UK Sanctions List (all UK designations; replaced the OFSI Consolidated List on 28 January 2026) | FCDO — sanctionslist.fcdo.gov.uk XML | Open Government Licence v3.0 |
| `UN` | United Nations Security Council Consolidated List | UN Security Council — scsanctions.un.org XML | Public UN data |

**Not covered:** PEP (politically exposed persons) lists, adverse media, OFAC's non-SDN lists (e.g. SSI, NS-MBS, CAPTA), national lists of individual EU member states, and other countries' sanctions lists. Screening is by name only; no dates of birth, ID numbers or addresses are returned.

## What you get

One record per screened name — including clean "no match" results for your audit trail. Matches from all lists are merged, sorted by score and capped at the 10 best:

```json
{
  "query": "Abu Nidal Organisation",
  "matched": true,
  "match_count": 2,
  "best_score": 1,
  "top_match_name": "Abu Nidal Organisation",
  "top_match_score": 1,
  "lists_matched": ["EU", "UK"],
  "matches": [
    {
      "list": "EU",
      "list_entry_id": "EU.3502.46",
      "primary_name": "Abu Nidal Organisation",
      "matched_name": "Abu Nidal Organisation",
      "score": 1,
      "entity_type": "entity",
      "programs": "TERR",
      "program_list": ["TERR"],
      "listed_on": "2002-06-18",
      "uid": "EU.3502.46",
      "sdn_name": "Abu Nidal Organisation",
      "type": "entity"
    },
    {
      "list": "UK",
      "list_entry_id": "CTI0022",
      "primary_name": "Abu Nidal Organisation",
      "matched_name": "Abu Nidal Organisation",
      "score": 1,
      "entity_type": "entity",
      "programs": "The Counter-Terrorism (International Sanctions) (EU Exit) Regulations 2019",
      "program_list": ["The Counter-Terrorism (International Sanctions) (EU Exit) Regulations 2019"],
      "listed_on": "2020-12-31",
      "uid": "CTI0022",
      "sdn_name": "Abu Nidal Organisation",
      "type": "entity"
    }
  ],
  "lists_screened": ["OFAC_SDN", "EU", "UK", "UN"],
  "lists_unavailable": [],
  "lists_info": [
    { "list": "OFAC_SDN", "entries": 19388, "source_url": "https://www.treasury.gov/ofac/downloads/sdn.csv", "publication_date": null },
    { "list": "EU", "entries": 6234, "source_url": "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw", "publication_date": "2026-08-05" },
    { "list": "UK", "entries": 6340, "source_url": "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml", "publication_date": "2026-09-11" },
    { "list": "UN", "entries": 1011, "source_url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml", "publication_date": "2026-09-14" }
  ],
  "list_publish_info": "OFAC SDN list, 19388 entries; EU consolidated financial sanctions list, 6234 entries (published 2026-08-05); UK Sanctions List, 6340 entries (published 2026-09-11); UN Security Council consolidated list, 1011 entries (published 2026-09-14), downloaded 2026-09-15T12:00:00.000Z",
  "source_url": "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

Field notes:

- `list` / `list_entry_id` — which list matched and its official reference (OFAC UID, EU reference number, UK Unique ID, UN reference number).
- `entity_type` — `individual`, `entity`, `vessel`, `aircraft` or `null` when the list does not say.
- `programs` (text) and `program_list` (array) — sanctions programmes/regimes (e.g. `CUBA`, `IRQ`, `DRC`, UK regulation name). `listed_on` is the designation date when the list publishes one (OFAC's SDN file does not).
- `source_url` — the download URL of the list that produced the best match; for a clear result, the first list screened.
- `lists_unavailable` — lists that could not be downloaded this run (see Reliability). Legacy OFAC fields (`uid`, `sdn_name`, `type`, `top_match_*`, `list_publish_info`) are kept for existing integrations.

## How matching works

Deterministic and auditable — no AI guessing: names are normalized (case, accents and diacritics, punctuation, corporate suffixes), so `Qoussaï` matches `Qoussai`, then matched exactly and by token overlap against every listed name **and its official aliases, spelling variations and transliterations** on each selected list. Non-Latin-script originals are not matched. You control the threshold with `minScore` (85 is a sensible compliance default; 100 = exact matches only). Scores and the matched alias are reported so reviewers can verify every hit.

> **Note**: screening is a decision-support tool. Potential matches should be reviewed by a human before action, per OFAC, OFSI and EU guidance.

## Input

| Field | Type | Notes |
|---|---|---|
| `names` | string[], required | People, organizations or vessels to screen |
| `lists` | string[] | Any of `OFAC_SDN`, `EU`, `UK`, `UN` (default: all four) |
| `minScore` | integer 50–100 | Match threshold in percent (default 85) |
| `includeAliases` | boolean | Screen against official AKAs and name variations on all lists (default true) |

```json
{ "names": ["Banco Nacional de Cuba", "Wholesome Bakery of Vermont"], "lists": ["OFAC_SDN", "EU", "UK", "UN"], "minScore": 85 }
```

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `name-screened` | **$3.00 per 1,000** ($0.003 each) | One name fully screened against all selected lists that were available — both matches and documented "clear" results. One charge per name, regardless of how many lists you select. Invalid/empty names are never charged, and nothing is charged if none of the selected lists could be downloaded. |

Example: 1,000 names screened against all four lists cost **$3.00**. You only pay for delivered results.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | **OFAC Sanctions Screening** (this Actor) | Screen names against OFAC, EU, UK and UN sanctions lists with fuzzy matching | $3/1k |
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

**Which sanctions lists does it check?**
The US OFAC SDN list, the EU consolidated financial sanctions list, the UK Sanctions List (FCDO) and the UN Security Council consolidated list. Pick any combination with `lists`; the price per name stays the same.

**Are the lists up to date?**
Every selected list is downloaded fresh from its official publisher on every run. Each record carries `lists_info` with entry counts and the publication date each publisher states in its file (the OFAC SDN CSV does not include one).

**What about the OFSI Consolidated List?**
OFSI's Consolidated List closed on 28 January 2026; the FCDO UK Sanctions List is now the single source for all UK designations, and that is the list used here.

**How does fuzzy matching work?**
Names are normalized (case, accents, punctuation, corporate suffixes), then scored by exact and token-overlap matching against every listed name and, optionally, its official aliases. `minScore` sets the threshold in percent; 85 is a sensible compliance default, 100 means exact only.

**Does it cover PEPs or adverse media?**
No. This Actor screens official government sanctions lists only. It does not include politically exposed persons (PEP) databases, adverse media, or commercial watchlists.

**Is this enough for AML/KYC compliance?**
It is a fast, documented first-line sanctions screen across the four major official lists. Your compliance program decides whether additional lists, PEP checks or manual review are required; potential matches should always be reviewed by a person.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official source files, fetched fresh each run in parallel, with retries and backoff; deterministic matching; structured failure reporting; daily issue triage. If one list cannot be downloaded after retries, the run continues with the others and every record lists it in `lists_unavailable` (also recorded in the run's `RUN_SUMMARY`). If none of the selected lists can be downloaded, the run fails and nothing is charged.

Source licences: UK Sanctions List contains public sector information licensed under the Open Government Licence v3.0. OFAC, EU and UN lists are official public government publications.
