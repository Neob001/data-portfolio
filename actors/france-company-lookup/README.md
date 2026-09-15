# France Company Lookup API — SIREN, SIRET & Sirene Company Data

Look up **French companies** by **SIREN**, **SIRET** or company name and get a clean, flat JSON record from the official French government **API Recherche d'entreprises** (INSEE Sirene + RNE open data): legal form, NAF/APE activity code, head office address, headcount band, SME/ETI/GE category, creation and closure dates, active status, latest revenue, labels (ESS, RGE, Qualiopi...) and a computed intra-EU **VAT number**. Built for KYB checks, lead enrichment, CRM cleanup and AI-agent pipelines. **You are only charged for companies found** — misses are free.

*Mots-clés : recherche entreprise par SIREN, SIRET, nom ; base Sirene INSEE ; fiche entreprise ; code NAF / APE ; forme juridique ; numéro de TVA intracommunautaire ; annuaire des entreprises.*

## Quick start

1. Click **Start** with the prefilled queries (the name `Airbus` and EDF's SIREN `552081317`). It finishes in seconds.
2. You get up to 6 company records with legal form, NAF code, head office, headcount band, status and computed VAT number.
3. That first run costs at most $0.018, well within Apify's free monthly credit. Then swap in your own list or schedule it.

## What you get

```json
{
  "query": "552 081 317",
  "found": true,
  "reason": null,
  "siren": "552081317",
  "siret_head_office": "55208131766522",
  "company_name": "ELECTRICITE DE FRANCE",
  "company_full_name": "ELECTRICITE DE FRANCE (EDF)",
  "acronym": "EDF",
  "legal_form_code": "5599",
  "legal_form": "SA à conseil d'administration (s.a.i.)",
  "naf_code": "35.11Z",
  "naf_label": "Production d’électricité",
  "naf_2025_code": "35.11Y",
  "activity_section": "D",
  "activity_section_label": "Electricity, gas, steam and air conditioning supply",
  "employee_range_code": "53",
  "employee_range": "10,000+ employees",
  "employee_range_year": 2023,
  "company_category": "GE",
  "company_category_label": "Large enterprise (GE)",
  "creation_date": "1955-01-01",
  "closure_date": null,
  "is_active": true,
  "head_office_address": "22-30 22 AVENUE DE WAGRAM 75008 PARIS",
  "head_office_street": "22 AVENUE DE WAGRAM",
  "head_office_postal_code": "75008",
  "head_office_city": "PARIS",
  "head_office_department_code": "75",
  "head_office_department": "Paris",
  "head_office_region_code": "11",
  "head_office_region": "Île-de-France",
  "head_office_country": "France",
  "head_office_latitude": 48.876235098,
  "head_office_longitude": 2.2979350788,
  "establishments_count": 9157,
  "open_establishments_count": 3556,
  "revenue_eur": 118690000000,
  "net_income_eur": 11854000000,
  "financials_year": 2024,
  "is_ess": false,
  "is_association": false,
  "is_public_administration": false,
  "is_mission_company": false,
  "is_entertainment_licensee": false,
  "is_training_organization": true,
  "is_qualiopi_certified": true,
  "is_rge_certified": true,
  "is_organic_certified": false,
  "is_siae": false,
  "is_finess": true,
  "is_living_heritage_company": false,
  "has_responsible_purchasing_label": true,
  "has_egapro_index": true,
  "has_ghg_report": true,
  "vat_number_computed": "FR03552081317",
  "matched_siret": null,
  "establishment_is_head_office": null,
  "establishment_is_active": null,
  "establishment_address": null,
  "establishment_postal_code": null,
  "establishment_city": null,
  "establishment_naf_code": null,
  "establishment_employee_range_code": null,
  "establishment_creation_date": null,
  "establishment_closure_date": null,
  "last_update": "2026-09-14",
  "annuaire_url": "https://annuaire-entreprises.data.gouv.fr/entreprise/552081317",
  "source_url": "https://recherche-entreprises.api.gouv.fr/search?q=552081317&page=1&per_page=5&minimal=true&include=siege%2Ccomplements%2Cfinances%2Cmatching_etablissements",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

For a **SIRET** query you get the same company record plus the `establishment_*` fields of that exact establishment (address, status, activity, headcount band). Queries that do not resolve come back as `{"query": "...", "found": false, "reason": "not_found"}` and are never charged.

## No personal data

Company facts only. This Actor **never returns officers (dirigeants), shareholders or any person's name**. **Officers and sole-proprietor records are excluded**: an *entrepreneur individuel* (legal form 1000) is registered under the owner's own name and home address, so a SIREN/SIRET lookup for one returns `found: false, reason: "individual_entrepreneur_excluded"` and name searches silently skip them — never charged. Non-diffusible units (statut de diffusion partiel/non diffusible) and groupings of natural persons (indivisions) are excluded the same way. Name searches also ignore companies matched only through an officer's name, so a person's name cannot be turned into a list of their companies.

## Use cases

- **KYB / customer onboarding**: verify that a French counterparty exists, is active, and check its legal form, age and registered head office in bulk.
- **Lead enrichment**: turn company names or SIRENs into NAF sector, headcount band, SME/ETI/GE category, revenue and location for segmentation and scoring.
- **CRM cleanup**: normalise company names, fix SIREN/SIRET typos (checksums validated before any call) and flag closed companies.
- **Supplier & procurement checks**: confirm supplier status, compute the intra-EU VAT number, spot RGE / Qualiopi / ESS labels.
- **AI agents**: tiny input schema, deterministic flat JSON — ideal via the Apify API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `queries` | string[], required | Company names, 9-digit SIREN or 14-digit SIRET (spaces allowed), e.g. `Airbus`, `552081317`, `383 474 814 00100` |
| `maxResultsPerQuery` | integer, default 5 (1-100) | Companies per name search. `1` = single best-match mode: only a confident name match is returned, otherwise not found (free) |
| `postalCode` | string, optional | Name searches: establishment postal code, e.g. `75008` |
| `department` | string, optional | Name searches: department code, e.g. `69`, `2A`, `971` |
| `nafCode` | string, optional | Name searches: NAF/APE code, e.g. `62.01Z` |
| `onlyActive` | boolean, default `true` | Name searches: skip ceased companies. SIREN/SIRET lookups always return the company with `is_active` |
| `minEmployeeRange` | select, optional | Name searches: minimum INSEE headcount band (1+, 10+, 50+, 250+ ... employees) |

SIREN/SIRET lookups ignore filters and always return exactly that company. Invalid identifiers (failed Luhn checksum, wrong length) are reported without calling the API. The official API caps a search at 10,000 results (25 per page); this Actor pages automatically up to `maxResultsPerQuery`.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `company-found` | **$3 per 1,000** ($0.003 each) | One company record delivered with `found: true`. **Not-found queries, invalid identifiers, excluded sole proprietors and API failures are never charged.** |

Example: looking up 1,000 SIRENs that all resolve costs **$3**. A name search with `maxResultsPerQuery: 5` that returns 5 companies costs $0.015. Set a maximum charge per run in Apify and the Actor stops cleanly when it is reached.

## Source and licence

- Data: [API Recherche d'entreprises](https://recherche-entreprises.api.gouv.fr/docs/) operated by the Direction interministérielle du numérique (DINUM), aggregating the INSEE Sirene register, the RNE (INPI) and public labels. Open access, no account or API key.
- Licence: Sirene and Annuaire des Entreprises datasets are published on data.gouv.fr under the [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence), which allows reuse including commercial reuse with attribution. Source: INSEE (base Sirene), INPI (RNE), DINUM (Annuaire des Entreprises).
- Every record carries `source_url` (the exact API request) and `annuaire_url` (the public company page).
- `vat_number_computed` is **computed** from the SIREN with the standard French key formula (`FR` + key + SIREN). It shows what the VAT number is if the company is VAT-registered; it does not prove registration. Verify it with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation).
- Labels (`legal_form`, `naf_label`) are the official INSEE nomenclature labels in French.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Counterparty & KYB checks | **France Company Lookup** (this Actor) | SIREN/SIRET, legal form, NAF code, head office and status from the Sirene register | $3/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **VAT check:** take `vat_number_computed` from this Actor and confirm it is live in VIES with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation), which also returns the registered name and address.
- **KYB file:** confirm the French company is active here, then screen its registered name with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

## FAQ

**Do I need an INSEE or API key?**
No. The official API Recherche d'entreprises is open access with no account. The Actor handles rate limits (the API allows 7 requests per second per IP; the Actor stays below 5) and retries with backoff.

**Can I look up a list of SIREN or SIRET numbers in bulk?**
Yes. Pass hundreds or thousands of identifiers in one run; each resolves to one flat record. Checksums are validated first (including the La Poste SIRET exception), and not-found or invalid numbers are free.

**What is the difference between SIREN and SIRET?**
SIREN (9 digits) identifies the company (unité légale). SIRET (14 digits = SIREN + 5-digit NIC) identifies one establishment. A SIRET query returns the company plus that establishment's address, status and activity.

**Is the VAT number official?**
It is computed from the SIREN with the official key formula, which is how French intra-community VAT numbers are built. Only VAT-registered companies actually use it; validate it with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation).

**Why is a small business missing?**
Sole proprietors (entrepreneurs individuels) and companies that opted out of public diffusion are deliberately excluded because their records identify a private person. Everything else in the public Sirene register is searchable.

**How fresh is the data?**
The government API is updated daily from INSEE Sirene and the RNE; each record includes `last_update` and `fetched_at`.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server.

## Reliability

Official government API, polite rate limiting under the published quota, retries with backoff on 429/5xx, structured failure reporting per query, daily issue triage.
