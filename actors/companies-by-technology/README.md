# Companies by Technology — Technographics from Job Posts

Find **companies that use a technology**, such as Snowflake, Salesforce, dbt, Kubernetes, SAP or HubSpot, from what their own job posts say. You get one row per company: which of your technologies its open jobs name and in how many jobs, its wider tech stack (top 15 technologies with categories), its open job count and its careers page. The data comes from the open jobs of **19,000+ companies' career sites** on Greenhouse, Lever, Ashby, Workable, Recruitee, Workday, Personio, Teamtailor, JazzHR and Pinpoint, refreshed every night. Use it for **sales prospecting and lead generation** (companies hiring Snowflake engineers run Snowflake), **account-based marketing**, **competitive displacement** (who still runs the tool you replace) and **market sizing**. **$15 per 1,000 companies**, and you pay only for the company rows you get.

## Quick start

1. Click **Start** with the prefilled input: `technologies: ["Snowflake"]`, `minJobsMentioning: 2`, `maxResults: 20`. The run takes well under a minute.
2. You get the 20 companies with the most open jobs that name Snowflake, each with its tech stack, open jobs and careers page.
3. That first run costs at most **$0.30** (20 companies × $0.015), which fits in Apify's free monthly credit. Then try `["Salesforce", "HubSpot"]`, `["dbt", "Snowflake"]` with `match: "all"`, or add `countries: ["DE", "GB"]`.

## What you get

One flat record per company:

```json
{
  "company_name": "Addepto",
  "company_board": "addepto",
  "ats": "recruitee",
  "careers_url": "https://addepto.recruitee.com/",
  "boards": [
    { "ats": "recruitee", "token": "addepto", "careers_url": "https://addepto.recruitee.com/", "open_jobs": 10, "jobs_with_text": 10 }
  ],
  "technologies_matched": [
    { "technology": "dbt", "jobs": 4 },
    { "technology": "Snowflake", "jobs": 4 }
  ],
  "top_technologies": [
    { "technology": "Databricks", "category": "Data warehouse & lakehouse", "jobs": 10 },
    { "technology": "Microsoft Azure", "category": "Cloud platforms & services", "jobs": 6 },
    { "technology": "Python", "category": "Programming languages", "jobs": 6 },
    { "technology": "Amazon Web Services (AWS)", "category": "Cloud platforms & services", "jobs": 4 },
    { "technology": "Apache Airflow", "category": "Data integration & orchestration", "jobs": 3 }
  ],
  "jobs_mentioning_matched": 7,
  "open_jobs_total": 10,
  "jobs_with_text": 10,
  "sample_job_urls": [
    "https://addepto.recruitee.com/o/data-engineer-gcp-snowflake-dbt",
    "https://addepto.recruitee.com/o/new-business-manager-united-kingdom",
    "https://addepto.recruitee.com/o/data-engineer-azure-data-factory"
  ],
  "source_url": "https://addepto.recruitee.com/api/offers/",
  "fetched_at": "2026-11-16T16:09:06.319Z"
}
```

(A real row from a `["Snowflake", "dbt"]` search on a local build of the index, 2026-11-17. `top_technologies` is shortened here: the Actor returns up to 15.)

| Field | Meaning |
|---|---|
| `technologies_matched` | Your technologies that the company's open jobs name, with the number of jobs naming each, most first |
| `jobs_mentioning_matched` | Open jobs naming at least one of your technologies (each job counted once) |
| `top_technologies` | The company's tech stack as its job posts describe it: up to 15 technologies with category and job count, whatever you searched for |
| `open_jobs_total` | All open jobs of the company in tonight's index |
| `jobs_with_text` | Open jobs whose full description was read. Lower than `open_jobs_total` where the platform's job list has no descriptions (Workday career sites: titles only), so a technology can only be found in the job title there |
| `sample_job_urls` | Up to 3 public job posts that name your technologies, to check the context |
| `company_board`, `ats`, `careers_url`, `source_url`, `boards` | The company's job board(s): token, applicant tracking system, public careers page and the ATS API or feed it was read from |

**Company data only.** Rows describe employers and the technologies their job posts name. No person data: no recruiter, hiring-manager or employee names, e-mails or profiles.

## Use cases

- **Sales prospecting**: companies hiring people who work with your product's ecosystem are your best leads. A company whose jobs name Snowflake and dbt is building a modern data stack and buys data-quality, observability and BI tools; one naming Salesforce and Outreach in many sales jobs buys sales tooling.
- **Competitive displacement**: list companies whose jobs still name the tool you replace (`["Tableau"]`, `["Jenkins"]`, `["Oracle Database"]`) and reach out with a migration offer.
- **Account-based marketing**: check your target accounts with `companies` and see their whole stack in `top_technologies`.
- **Partner and agency sales**: consultancies find companies hiring for SAP S/4HANA, Salesforce, ServiceNow or Workday projects.
- **Market research**: how many companies in Germany name Databricks vs Snowflake, or Kubernetes vs ECS, this month.

## Input

| Field | Type | Notes |
|---|---|---|
| `technologies` | string[] | Names or common aliases, case-insensitive: "Snowflake", "Google BigQuery", "k8s", "golang", "C#", "Power BI" (up to 50). Unknown names are reported with suggestions |
| `match` | `any` \| `all` | Default `any`. `all`: the company's jobs name every technology (not necessarily in one job) |
| `countries` | string[] | Only count jobs in these countries: ISO codes (`US`, `GB`, `DE`) or English names |
| `locations` | string[] | Only count jobs in these places, as written in the posting ("London", "California") |
| `departments` | string[] | Only count jobs whose department or team contains one of these words ("Engineering", "Data") |
| `minJobsMentioning` | integer | Default 1. Only companies with at least this many open jobs naming the technologies |
| `companies` | string[] | Only these companies (names or board tokens). Without `technologies`, each row lists every technology the company's jobs name |
| `maxResults` | integer | Default 100 company rows, most jobs mentioning the technologies first |

**How it works.** Every night we read the open jobs of every career site in our directory through the platforms' public job APIs and feeds (see Sources). While the full description of each job is still in memory, a fixed dictionary of **600+ technologies** in 27 categories is matched against its title and description, and the counts are stored per company. The Actor reads those counts (one small file, a few MB) and aggregates them. No language model and no guessing: the same post always gives the same technologies.

**Precision first.** Ambiguous names are only counted in technical context:
- `Go`, `R`, `C`, `Rust`, `Swift`, `Spark`, `Chef`, `Puppet`, `Helm` and similar words count only when they appear in a list next to other technologies ("Python, Go and Rust"), and only when the same post also names a related technology; "ready to go", "R&D", "(C) 2025", "Series C" never count.
- `Excel` the verb, `Tableau` in French ("tableau de bord"), DBT therapy, "snowflake schema", HVAC airflow, Jenkins the surname, "Workday" the noun, GCP in pharma (Good Clinical Practice) and LLM the law degree are excluded.
- A vendor's own career site is not counted as a user of its own product (Snowflake's jobs naming Snowflake), nor are investor mentions ("backed by Salesforce Ventures") or alumni mentions ("ex-Stripe").
- `sample_job_urls` lets you check the context yourself.

## Pricing

| Event | Price | Meaning |
|---|---|---|
| `company-result` | **$15.00 per 1,000** ($0.015 each) | One company row delivered. **No start fee.** Runs with no matching company are never charged. |

Example: 2,000 companies cost **$30**. Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Use with AI agents (MCP)

AI agents can find, run and pay for this Actor on their own; nothing to set up on our side.

- **Connect:** add `https://mcp.apify.com?tools=factpipe/companies-by-technology` to Claude, ChatGPT, Cursor, VS Code or any other MCP client and sign in with your Apify account. The agent sees the input schema, a description of every output field and this README.
- **Example:** "Which companies in the UK use both Snowflake and dbt?" becomes the input `{"technologies": ["Snowflake", "dbt"], "match": "all", "countries": ["GB"], "maxResults": 20}`.
- **Cap the spend:** pass `maxTotalChargeUsd` when starting the run (API or the Python/JavaScript client). The Actor stops at the cap and keeps the companies already delivered; you are never charged above it.
- **Output:** flat JSON with the same fields on every run, read from the source by fixed rules (no language model, no estimates), so results can be cited as they are. `allFieldsDatasetUrl` in the run output has every field; `resultsDatasetUrl` has the table columns.

## Coverage

The nightly index holds **790,000+ open jobs from 19,000+ career sites**. Descriptions are read for Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, Teamtailor and Pinpoint jobs. **Workday** career sites (about half of all jobs, mostly large employers) list titles only, so for them a technology is found only when the job title names it ("Salesforce Administrator", "SAP FICO Consultant"); `jobs_with_text` shows this per company. JazzHR descriptions are filled in over several nights.

A technology named in a job post means the company works with it, plans to, or (for agencies and consultancies) serves clients who do; it is a signal, not an audited inventory.

## Sources and terms

Only official, public, unauthenticated job-board APIs and feeds that the ATS vendors publish for displaying and syndicating open jobs, plus public career pages where a platform has no feed (JazzHR job pages' schema.org JobPosting data). robots.txt is checked for every career-site host. No logins, no LinkedIn. The job descriptions themselves are not published by this Actor; only the technology counts per company are.

## factpipe Jobs & Hiring Data

These Actors share the same nightly index:

- [Companies by Technology](https://apify.com/factpipe/companies-by-technology) (this Actor): companies whose job posts name a technology, with their tech stack.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company hiring for a role, as sales leads or market research.
- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job, every filter, ranked by relevance (to see the individual jobs behind a row).
- [Bulk Job Postings Feed](https://apify.com/factpipe/jobs-bulk-feed): every new job every day as one bulk feed.

## FAQ

**How is this different from website technology lookups?**
Website scanners see the scripts on a public web page (analytics tags, CMS). Job posts reveal the internal stack that never shows on a website: the data warehouse, ERP, CRM, cloud, languages and DevOps tools a team works with every day.

**Does it give me contact people?**
No, by design. It gives company-level signals and the careers page. Pair it with your own CRM or enrichment tool for contacts.

**Why does a company with many jobs show few matches?**
Either its jobs don't name your technology, or its career site lists titles only (Workday; see `jobs_with_text`).

**How fresh is it?**
The index is rebuilt every night. `fetched_at` is when the company's board was read.

**Which technologies are covered?**
600+ in 27 categories: data warehouses, data integration and orchestration, databases, BI, product analytics, AI/ML, cloud, DevOps, observability, security, languages, frameworks, mobile, testing, CRM and sales tools, marketing automation, support, e-commerce and payments, ERP and finance, HR and payroll, collaboration, design and CAD, IT infrastructure, low-code and RPA, embedded and hardware, healthcare IT. If a name is not recognised, the run says so and suggests close matches.

**Can I get the individual jobs?**
Yes: run [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed) with `companies` set to the companies you picked and the technology as a keyword.

## Reliability

Deterministic rules, golden tests on tricky negatives, retries with backoff when reading the index, and a `RUN_SUMMARY` record on every run (rows, charged events, unknown technologies, index build time).
