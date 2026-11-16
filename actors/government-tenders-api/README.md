# Government Tenders API — Global Public Procurement Data

**Public tenders, RFPs and contract awards from 40+ countries in one normalized feed: EU TED, US SAM.gov, UK Find a Tender and Contracts Finder, plus 16 national open-data platforms (Australia, Canada/Québec, Germany, Netherlands, Brazil, Peru, Ecuador and more). Filter by keyword, CPV/NAICS code, country, value and deadline. $3.50 per 1,000 notices.**

Find **government contracts to bid on** and **who won what** without checking a dozen procurement portals. Every notice comes as the same flat JSON record, whatever the country: buyer, title, description, CPV/NAICS codes, estimated or awarded value, publication date, submission deadline, status (open, closed, awarded, cancelled) and a link to the official notice. The index is rebuilt every night from official APIs and open-data files, so a run takes seconds and never scrapes a portal. Use it for **bid and tender alerts** (new IT, construction or medical tenders in your countries every morning), **sales prospecting** (public buyers about to spend), **market and competitor research** (contract awards by sector and value) and **AI agents** that answer "which open tenders match our product?".

## Quick start

1. Click **Start** with the prefilled input: `keywords: ["software"]`, `openOnly: true`, `maxResults: 20`. The run takes a few seconds.
2. You get the 20 open calls for tender that mention software (title matches first), from every source, with buyer, country, deadline, value and notice link.
3. That first run costs at most **$0.07** (20 notices × $0.0035), which fits in Apify's free monthly credit. Then narrow it: `countries: ["DE", "FR"]`, `cpvCodes: ["72"]` (IT services), `minValue: 100000`, or schedule it daily with `sinceLastRun: true` to get only new notices.

## What you get

One flat record per notice. The same field names and types for every source:

```json
{
  "notice_id": "uk-fts:108639-2026",
  "source": "uk-fts",
  "country_code": "GB",
  "buyer_name": "Comann Eachdraidh Eirisgeidh",
  "buyer_country": "GB",
  "title": "Ionad Eilean nan Òige - Phase 3",
  "description_snippet": "This document contains the Stage 1 Tender for the Community Hub project Ionad Eilean Na Òige. 1.2 Tender design information is currently being prepared by the appointed design team and is expected to be completed by early 2027. Comann Eachdraidh Eirisgeidh are looking to appoint a suitably qualified and experienced contractor on a first stage tender who will then work with the team to finalise the price, scope of works and programme before being appointed to carry out the works. 1.3 The first…",
  "notice_type": "tender",
  "procedure_type": "Open procedure",
  "status": "open",
  "cpv_codes": [
    "45000000"
  ],
  "naics_codes": [],
  "unspsc_codes": [],
  "value_amount": 3000000,
  "value_currency": "GBP",
  "published_at": "2026-11-16T16:24:57Z",
  "deadline_at": "2026-12-16T12:00:00Z",
  "award_date": null,
  "supplier_names": [],
  "lots_count": 1,
  "language": "en",
  "notice_url": "https://www.find-tender.service.gov.uk/Notice/108639-2026",
  "source_url": "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/108639-2026",
  "fetched_at": "2026-11-16T16:37:55.485Z"
}
```

(A real row from UK Find a Tender in the index of 2026-11-16: an open call for tender with its deadline, estimated value and CPV code. TED, SAM.gov and national-platform rows have exactly the same fields.)

| Field | Meaning |
|---|---|
| `notice_id` | Stable ID `<source>:<id>`: the same notice has the same ID on every run |
| `source` | `ted`, `sam`, `uk-fts`, `uk-cf`, or `ocds-<country>` for a national platform (see Coverage) |
| `country_code`, `buyer_country` | ISO country of the buying authority |
| `buyer_name` | The contracting authority (an organisation, never a person) |
| `title`, `description_snippet` | As published, in the notice's language (TED titles also in English); the snippet is the first 500 characters |
| `notice_type` | `planning` (prior information, sources sought), `tender` (call for tender, solicitation), `award`, `contract` (signed or modified), `cancellation`, `other` |
| `status` | `open` (deadline still ahead when you run it), `closed`, `awarded`, `cancelled`, `unknown` |
| `cpv_codes`, `naics_codes`, `unspsc_codes` | Classification codes where the source publishes them |
| `value_amount`, `value_currency` | Awarded value for awards, estimated value otherwise; `null` when not published |
| `published_at`, `deadline_at`, `award_date` | ISO 8601 UTC |
| `supplier_names` | Awarded suppliers, **organisations only** (see FAQ) |
| `lots_count`, `procedure_type`, `language` | As published |
| `notice_url` | The official notice page; `source_url` is the API or open-data file it was read from |
| `fetched_at` | When our nightly index first read the notice |

**No personal data.** Contact names, e-mail addresses and phone numbers of procurement officers are never copied; e-mails and phone numbers inside descriptions are replaced by `[email redacted]` / `[phone redacted]`.

## Use cases

- **Tender alerts for bidders**: every morning, the new calls for tender in your sector (CPV `72` IT, `45` construction, `33` medical, `90` cleaning and waste) and countries, with deadline and value. Schedule with `sinceLastRun: true` and send to Slack, e-mail or a Google Sheet.
- **Public-sector sales prospecting**: buyers that just published prior information notices or sources-sought notices are about to buy; award notices show who buys what and for how much.
- **Competitive intelligence**: contract awards by sector, buyer and value across the EU, UK and US; UK award notices list the winning companies.
- **Market research and analysis**: one schema for 40+ countries, ready for a data warehouse or a BI dashboard, instead of a different parser per portal.
- **AI agents and RAG**: an agent can call the Actor with keywords and filters and get clean, citable JSON with official notice links.

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Words or phrases in the title or description, case- and accent-insensitive; title matches rank first. Empty = all notices |
| `keywordMatch` | `any` \| `all` | Default `any` |
| `countries` | string[] | ISO codes of the buying authority: `DE`, `FR`, `US`, `GB`, `AU`... |
| `openOnly` | boolean | Only notices whose submission deadline is still ahead at run time |
| `noticeTypes` | string[] | `planning`, `tender`, `award`, `contract`, `cancellation`, `other` |
| `cpvCodes` | string[] | CPV prefixes (`72` = IT services, `4523` = road works) |
| `naicsCodes` | string[] | NAICS prefixes (SAM.gov notices) |
| `buyers` | string[] | Text in the buyer's name (`NHS`, `ministry of defence`, `Stadt`) |
| `minValue`, `maxValue`, `currency` | number, string | Value range in the notice's own currency; set `currency` to compare like with like |
| `publishedWithinDays` | integer | Only notices published in the last N days |
| `deadlineAfter` | date | Only notices with a deadline on or after this date |
| `sources` | string[] | Limit to sources (`ted`, `sam`, `uk-fts`, `uk-cf`, `ocds-au`...) |
| `sortBy` | `relevance` \| `newest` \| `deadline` \| `value` | Default: relevance with keywords, deadline with `openOnly`, else newest |
| `sinceLastRun` | boolean | Only notices added to the index since this Actor last delivered for the same filters |
| `maxResults` | integer | Default 100 |

**How it works.** A nightly job on our side reads every source through its official API or open-data file, normalizes each notice to the record above, removes notices published twice (an above-threshold German tender on TED and on the national platform is one row), and publishes a compact index. The Actor reads only the parts of that index your filters need (by source, country, deadline and publication date), so most runs finish in seconds. Statuses are recomputed when you run it: a tender whose deadline passed this morning is `closed`.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `notice-result` | **$3.50 per 1,000** ($0.0035 each) | One tender, award or contract notice delivered. **No start fee.** Runs with no matching notice are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Use with AI agents (MCP)

AI agents can find, run and pay for this Actor on their own; nothing to set up on our side.

- **Connect:** add `https://mcp.apify.com?tools=factpipe/government-tenders-api` to Claude, ChatGPT, Cursor, VS Code or any other MCP client and sign in with your Apify account. The agent sees the input schema, a description of every output field and this README.
- **Example:** "Find open IT tenders in Germany and Austria worth over €100,000" becomes the input `{"countries": ["DE", "AT"], "cpvCodes": ["72"], "openOnly": true, "minValue": 100000, "currency": "EUR", "maxResults": 20}`.
- **Cap the spend:** pass `maxTotalChargeUsd` when starting the run (API or the Python/JavaScript client). The Actor stops at the cap and keeps the notices already delivered; you are never charged above it.
- **Output:** flat JSON with the same fields on every run, read from official sources by fixed rules (no language model, no estimates), so results can be cited with their `notice_url`. `allFieldsDatasetUrl` in the run output has every field; `resultsDatasetUrl` has the table columns.

## Coverage

The index keeps every notice published in the last **90 days** plus older calls for tender that are still open, and is rebuilt nightly.

| Source | Countries | What | Refresh |
|---|---|---|---|
| **TED** (Tenders Electronic Daily), EU Publications Office | EU 27, EEA, candidate countries, EU institutions | Above-threshold calls for tender, prior information, contract awards, modifications (~3,300 notices per working day) | daily |
| **SAM.gov** Contract Opportunities, US GSA | United States (federal) | Solicitations, presolicitations, sources sought, award notices, special notices; NAICS codes | daily |
| **UK Find a Tender** | United Kingdom | Above-threshold notices (Procurement Act 2023 and legacy), awards with supplier company numbers | daily |
| **UK Contracts Finder** | England and UK-wide | Below-threshold opportunities and awards | daily |
| **National platforms** via the Open Contracting Data Registry | Australia (AusTender), Canada (Québec SEAO), Germany (oeffentlichevergabe.de), Netherlands (TenderNed), Brazil (Compras.gov.br), Peru (OECE), Ecuador (SERCOP), Paraguay (DNCP), Guatemala, Honduras, South Africa (eTenders), UK Scotland (Public Contracts Scotland), Uganda, Zambia, Bulgaria, Greece | Tenders, awards and contracts in OCDS format; UNSPSC codes where published | when the registry collects new data (about monthly) |

National-platform records reflect the platform's last open-data release, so their statuses and award data can lag the live portal by a few weeks; `fetched_at` shows when we first indexed each notice. Some platforms' open data has no link to a notice page (`notice_url` is then `null`; search the platform for the title).

## Sources and licences

Only official APIs and open-data files whose terms allow reuse; robots.txt is checked for every host.

| Source | Access | Licence / reuse terms |
|---|---|---|
| TED | TED Search API (anonymous, documented for reusers) | Reuse of Commission documents, Decision 2011/833/EU (attribution: © European Union, TED) |
| SAM.gov | Public Contract Opportunities data extract (no account, no key) | US Government work, public domain |
| Find a Tender, Contracts Finder | Official OCDS APIs | Open Government Licence v3.0 (Crown copyright) |
| National platforms | Bulk files of the [Open Contracting Data Registry](https://data.open-contracting.org) | Per publisher: CC BY 4.0 (Québec, Guatemala, Honduras, Paraguay, Peru, Zambia, Brazil, Greece), CC BY 3.0 AU (Australia), CC BY 3.0 EC (Ecuador), CC0 (Germany, Netherlands, Bulgaria), OGL v3.0 (Scotland), ODC-By (Uganda), ODC PDDL (South Africa) |

## FAQ

**Is this the full text of each tender?**
No: title, the first 500 characters of the description, codes, values and dates, plus the official notice link for the tender documents. That keeps runs fast and cheap; open `notice_url` for the full notice.

**Why are supplier names empty for most awards?**
By design. Many suppliers are sole traders, and their names are personal data. We list a supplier only when it carries a company or charity register number that only organisations have (today: UK Companies House and UK charity registers, on UK Find a Tender and Contracts Finder awards). Everything else stays empty rather than risk listing a person.

**Can I search in English across all countries?**
TED titles come in English as well as the original language. Other notices are in their original language (German, Spanish, Portuguese, Dutch...), so add the local word too (`["software", "Software", "logiciel"]`) or filter by CPV code, which is language-independent.

**How fresh is it?**
TED, SAM.gov and the UK sources are read every night. National platforms follow the Open Contracting Data Registry's collections (about monthly).

**Does it replace the EU TED and SAM.gov Actors?**
It covers both sources with the same filters (CPV, NAICS, countries, keywords, incremental mode) plus 18 more, in one schema.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official APIs and open-data files only, read by a nightly job with retries, backoff and per-host rate limits; the Actor itself reads a static index, so portal outages never fail your run. A `RUN_SUMMARY` record is written on every run.
