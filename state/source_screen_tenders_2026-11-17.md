# Tenders source screen 2026-11-17 (S-3 global tenders index; subagent, not yet owner-reviewed)

Method: robots.txt requested with `Accept: text/plain` (rule R1: only a 2xx text/plain file counts and must allow the path; 404/410 = no restrictions; anything else = do not read), terms/licence pages read once, 1-3 sample API calls per source. Volumes are from those samples (2026-11-12/13, weekdays).

## Proposed DECISIONS.md lines

```
2026-11-17 | APPROVE | source tenders-ted | TED Search API v3 (api.ted.europa.eu, anonymous, documented "for reuse"); licence COM_REUSE (Decision 2011/833/EU, data.europa.eu); robots 404. Caveat: ted.europa.eu/en/legal-notice sits behind a JS robot check (HTTP 202) — owner to confirm the API docs + data.europa.eu licence suffice.
2026-11-17 | APPROVE | source tenders-sam | SAM.gov Contract Opportunities public extract (privacy=Public, no key); US public domain; SAM ToU allow "extracts ... public versions"; sam.gov robots allows /api/. Caveat: the 303 target (GSA S3 bucket falextracts) answers robots.txt 403 (S3 AccessDenied); same path as the live sam-gov-contracts Actor.
2026-11-17 | APPROVE | source tenders-uk-fts | UK Find a Tender OCDS API; OGL v3; robots 404; no auth; throttled.
2026-11-17 | APPROVE | source tenders-uk-cf | UK Contracts Finder OCDS API; OGL v3; robots 404; no auth; throttled.
2026-11-17 | APPROVE | source tenders-ocds-registry | OCP Data Registry bulk files (data.open-contracting.org, robots allow-all); only publications with CC0/CC BY/OGL/ODC-By/PDDL licences (16 listed below); per-publication licence + attribution in the README.
2026-11-17 | REJECT | source tenders-canadabuys | canadabuys.canada.ca robots.txt: "User-agent: * / Disallow: /" (only Googlebot/bingbot allowed) -> R1.
2026-11-17 | REJECT | source tenders-austender-api | api.tenders.gov.au/robots.txt answers HTTP 403 (JSON) -> R1 do not read. Australia comes in via the OCP registry copy (CC BY 3.0 AU) instead.
2026-11-17 | REJECT | source tenders-colombia-secop | www.datos.gov.co/robots.txt answers HTTP 403 -> R1.
2026-11-17 | REJECT | source tenders-france-boamp | boamp-datadila.opendatasoft.com robots.txt disallows /api/ for * -> R1.
2026-11-17 | REJECT | source tenders-chile-mercadopublico | API needs a ticket (API key) -> reject-for-now.
2026-11-17 | REJECT | source tenders-prozorro | public API open (robots 404) but no licence stated anywhere we could read (OCP registry: "License: -"); many suppliers are individual entrepreneurs (FOP) -> reject-for-now.
2026-11-17 | REJECT | source tenders-ocds-registry-nonopen | Registry publications with NC/share-alike/unstated licences: Rwanda (CC BY-NC-SA), Dominican Republic (ODbL share-alike), Kenya, Taiwan, Liberia (no licence), Moldova (licence = link to opendefinition.org only), Nigeria BPP + Uruguay ARCE (custom licences, not read) -> reject-for-now.
```

## Per source

| id | Endpoint | Licence | Terms on automated access / redistribution | robots.txt (R1) | Auth | Volume/day | History |
|---|---|---|---|---|---|---|---|
| tenders-ted | `POST https://api.ted.europa.eu/v3/notices/search` (expert query `publication-date=YYYYMMDD`, ≤250/page) | COM_REUSE = Commission Decision 2011/833/EU (data.europa.eu datasets `ted-1`, `ted-csv`): free reuse incl. commercial, with attribution | docs.ted.europa.eu Search API: "this API is primarily targeted at data reusers and does not require authentication, making it openly accessible to any system or user"; "TED API allows anonymous access to all services manipulating published notices". **ted.europa.eu legal notice is behind an AWS-style JS robot check** ("we need to verify that you're not a robot", HTTP 202) — the API host and docs are not gated | api.ted.europa.eu: 404 JSON -> no restrictions | none | 3,194 (11-12), 3,340 (11-13) | 1993+ via API |
| tenders-sam | `GET https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public` -> 303 to a pre-signed GSA S3 URL | US Government work, public domain (17 U.S.C. 105) | sam.gov/about/terms-of-use: "SAM.gov makes certain data available via APIs and extracts with URLs 'https://open.gsa.gov/api/' and 'https://sam.gov/data-services.' Automated data gathering, web scraping tools are prohibited" (= the website); "If you want to share data publicly, only share data from public versions of APIs". We read only the public extract | sam.gov: 200 text/plain, /api/ not disallowed. Redirect host falextracts.s3.amazonaws.com: robots.txt 403 (S3 AccessDenied for a missing key) | none | ~1,500-2,500 | full file = all notices still listed (~244 MB CSV, Windows-1252, sorted newest first) |
| tenders-uk-fts | `GET https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=&updatedTo=&limit=100&cursor=` | Open Government Licence v3.0 (site footer + T&C) | T&C: "You can reproduce content published on Find a Tender under the OGL"; prohibits only "Monitoring or crawling of a System that impairs or disrupts the System" | 404 -> no restrictions | none | 100+ releases (11-12, paged); 7 on a Sunday | 2021+ |
| tenders-uk-cf | `GET https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom=&publishedTo=&limit=100&cursor=` | OGL v3.0 | same T&C as FTS (shared) | 404 -> no restrictions | none | 100+ (11-13, paged; ~50 s per 100-release page) | 2016+ (archive 2011-15) |
| tenders-ocds-registry | `GET https://data.open-contracting.org/en/publication/{id}/download?name={year}.jsonl.gz` -> 302 to fastly.data.open-contracting.org (compiled releases) | per publication (table below) | open-contracting.org/terms-of-use: no clause on automated access; content under CC licences; data under each publisher's licence | data.open-contracting.org: `User-agent: * / Disallow:`; fastly.data.open-contracting.org: same | none | 1 redirect request per publication per night; a file is downloaded only when the registry has a new collection (monthly) | per publisher, years as files |
| tenders-canadabuys | canadabuys.canada.ca/opendata/pub/*.csv | OGL-Canada | — | **200 text/plain `User-agent: * Disallow: /`** | — | — | REJECT (R1) |
| tenders-austender-api | api.tenders.gov.au/ocds/findByDates/... | CC BY 3.0 AU | — | **403 JSON** | — | — | REJECT (R1); covered by registry pub 19 |
| tenders-colombia-secop | www.datos.gov.co (Socrata) | — | — | **403 text/html** | — | — | REJECT (R1) |
| tenders-france-boamp | boamp-datadila.opendatasoft.com/api/... | Licence Ouverte | — | **200 text/plain, `Disallow: /api/`** | — | — | REJECT (R1) |
| tenders-chile-mercadopublico | api.mercadopublico.cl | — | needs `ticket` (API key) | 404 | key | — | REJECT-for-now |
| tenders-prozorro | public-api.prozorro.gov.ua/api/2.5/tenders | **not stated** (registry pub 154: "License: -") | — | 404 | none | very high | REJECT-for-now (licence, FOP suppliers) |
| tenders-spain-placsp | contrataciondelestado.es / contrataciondelsectorpublico.gob.es | — | — | host unreachable from here (connection failed) | — | — | not screened |
| Paraguay DNCP direct API | contrataciones.gov.py/datos/api/v3 | CC BY 4.0 | needs a request token | unreachable | key | — | via registry pub 63 instead |

## OCP registry publications

APPROVE (open licence, still updated in 2026):

| pub | Publisher | Licence | 2026 file (gz) | Last collection |
|---|---|---|---|---|
| 19 | Australia: Department of Finance (AusTender) | CC BY 3.0 AU | 21.8 MB | 2026-11-12 |
| 79 | Canada: Québec SEAO | CC BY 4.0 | 20.3 MB | 2026-11-03 |
| 110 | Ecuador: SERCOP | CC BY 3.0 EC | 140.8 MB | 2026-11-10 |
| 136 | Germany: BMI (oeffentlichevergabe.de) | CC0 1.0 | 128.9 MB | 2026-11-16 |
| 142 | Guatemala: MINFIN | CC BY 4.0 | 377.0 MB | 2026-11-04 |
| 122 | Honduras: ONCAE | CC BY 4.0 | 16.6 MB | 2026-11-03 |
| 133 | Netherlands: TenderNed (Ministry of EZK) | CC0 1.0 | 9.7 MB | 2026-10-19 |
| 63 | Paraguay: DNCP | CC BY 4.0 | 106.5 MB | 2026-08-20 |
| 135 | Peru: OECE | CC BY 4.0 | 155.2 MB | 2026-10-04 |
| 143 | South Africa: National Treasury eTenders | ODC PDDL | 1.0 MB | 2026-09-20 |
| 39 | UK: Scotland (Public Contracts Scotland) | OGL v3.0 | 9.2 MB | 2026-10-30 |
| 130 | Uganda: PPDA | ODC-By | 1.4 MB | 2026-10-24 |
| 3 | Zambia: ZPPA | CC BY 4.0 | 13.3 MB | 2026-11-10 |
| 157 | Brazil: Compras.gov.br (federal) | CC BY 4.0 | 154.5 MB | 2026-10-27 |
| 162 | Bulgaria: Public Procurement Agency | CC0 | 35.1 MB | 2026-10-21 |
| 161 | Greece: Diavgis | CC BY 4.0 | 270.6 MB | 2026-11-03 |

Not used: UK FTS (41) and Contracts Finder (128) (read directly, fresher), all "OpenTender" publications (derived from TED, 6-monthly, end 2024), discontinued publishers ("no longer updated"), and the REJECT list above.

## Personal data (all sources)

- Never copied: contact points (names, e-mails, phones), `parties[].contactPoint`, SAM contact columns, TED `*-person`, `*-email`, `*-tel*`, `winner-*` contact fields.
- Free text (description snippet) has e-mails and phone numbers redacted.
- `supplier_names` v1: only suppliers carrying a company-registry identifier that cannot belong to a natural person (GB-COH, charity registers GB-CHC/GB-SC/GB-NIC) and whose name has no sole-trader marker. UK suppliers without such an identifier, TED winners, SAM awardees and every registry supplier are omitted in v1 (sole traders cannot be told apart reliably).
