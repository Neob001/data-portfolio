# Gap validation — 2026-09-15

## Candidates (ranked)

Users and runs exclude Apify's daily auto-test (1 user, ~30 runs per Actor).

| # | Candidate | Rec | Score | Real users/30d | Real runs/30d | Competitors (with real users) | Wtd rating | Fail % | Stale demand | Median $/1k | Effort | Access |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Broken link checker (pending N7) | MAYBE | 1.89 | 45 | 3608 | 44 (8) | 2.75 | 0.5 | 2% | 2.0 | 3d | 1.0 |
| 2 | DNS records lookup (pending N8) | MAYBE | 1.75 | 78 | 595 | 60 (19) | 5.0 | 1.1 | 1% | 5.0 | 1d | 1.0 |
| 3 | UK VAT validation (HMRC) | LOW DEMAND (build only as cheap suite add-on) | 1.74 | 2 | 6331 | 24 (2) | unrated | 0.0 | 50% | 5.0 | 2d | 0.9 |
| 4 | France Sirene company registry | MAYBE | 1.28 | 44 | 664 | 69 (18) | 2.98 | 0.0 | 19% | 5.99 | 4d | 0.85 |
| 5 | GLEIF LEI company lookup (pending N6) | LOW DEMAND (build only as cheap suite add-on) | 1.25 | 11 | 100 | 53 (5) | unrated | 0.0 | 0% | 3.0 | 2d | 1.0 |
| 6 | Grants.gov federal grants | LOW DEMAND (build only as cheap suite add-on) | 1.18 | 7 | 26 | 62 (6) | unrated | 0.2 | 28% | 3.0 | 2d | 1.0 |
| 7 | SEC Form 4 insider trading feed | LOW DEMAND (build only as cheap suite add-on) | 0.76 | 10 | 748 | 61 (7) | 5.0 | 0.0 | 10% | 5.0 | 3d | 1.0 |
| 8 | EU Safety Gate (RAPEX) product alerts | LOW DEMAND (build only as cheap suite add-on) | 0.69 | 2 | 40 | 13 (2) | unrated | 0.0 | 0% | 9.0 | 2d | 0.9 |
| 9 | Global sanctions screening (OFAC+EU+UK+UN) | LOW DEMAND (build only as cheap suite add-on) | 0.59 | 12 | 295 | 71 (8) | 5.0 | 0.3 | 0% | 5.0 | 3d | 1.0 |
| 10 | USPTO / EUIPO trademark search | SKIP (access blocked) | 0.59 | 97 | 44765 | 79 (29) | unrated | 0.1 | 28% | 6.0 | 5d | 0.3 |
| 11 | US CPSC consumer product recalls | LOW DEMAND (build only as cheap suite add-on) | 0.0 | 0 | 0 | 41 (0) | unrated | 0.0 | 0% | 5.0 | 2d | 1.0 |

## Where our Actors rank

| Actor | Query | Rank | Results | Who beats us (users/30d, rating, $/1k) |
|---|---|---|---|---|
| ofac-sanctions-screening | sanctions screening | 18 | 417 | mooseandraven/ofac-sanctions-screening-suite (2, -, 4.0); ryanclinton/opensanctions-search (3, -, 3.0); pink_comic/ofac-sanctions-screening (0, -, 2.0) |
| ofac-sanctions-screening | ofac | 39 | 13658 | mooseandraven/ofac-sanctions-screening-suite (2, -, 4.0); ryanclinton/ofac-sanctions-search (2, -, 2.0); gochujang/crypto-address-sanctions-checker (0, -, 10.0) |
| eu-vat-validation | vat validation | 8 | 158 | scrapers_lat/eu-vat-vies-validation-scraper (1, -, 15.0); n1ckyta/eu-invoice-vat-extractor (1, -, 40.0); devilscrapes/vies-vat-number-validator (1, -, 1.0) |
| eu-vat-validation | vies | 27 | 29075 | benthepythondev/vies-vat-validator (1, -, 2.0); scrapers_lat/eu-vat-vies-validation-scraper (1, -, 15.0); bgfc97/eu-vat-vies-validator (1, -, 5.0) |
| uk-company-lookup | companies house | >50 | 3278 | logiover/uk-companies-house-bulk-scraper (9, -, 1.5); scrapesage/companies-house-scraper (34, -, 4.0); parseforge/uk-companies-house-scraper (4, -, 7.5) |
| uk-company-lookup | uk company lookup | 4 | 2017 | ryanclinton/uk-companies-house (2, -, 2.0); automation-lab/companies-house-uk-company-search-scraper (4, -, 0.06); corent1robert/uk-companies-house-scraper (1, -, 2.0) |
| sec-edgar-filings-search | sec edgar | >50 | 1124 | constructive_calm/sec-edgar-scraper (7, 5, 0.4); logiover/sec-edgar-form-d-scraper (10, 1, 3.5); nexgendata/business-registration-lookup (0, -, 50.0) |
| sec-edgar-filings-search | sec filings | >50 | 1278 | benthepythondev/sec-edgar-filings-intelligence (2, -, 29.0); constant_quadruped/sec-edgar-filings-scraper (22, -, -); ryanclinton/edgar-filing-search (1, -, 2.0) |
| sam-gov-contracts | sam.gov | >50 | 326 | scrapesage/sam-gov-scraper (10, -, 2.5); automation-lab/samgov-government-contracts-scraper (4, -, 0.12); fortuitous_pirate/sam-gov-scraper (12, -, 3.0) |
| sam-gov-contracts | government contracts | >50 | 2667 | automation-lab/samgov-government-contracts-scraper (4, -, 0.12); nexgendata/singapore-gebiz-tenders (0, -, 50.0); lofomachines/public-tenders-scraper (6, -, 4.0) |
| eu-ted-tenders-monitor | public tenders | >50 | 2632 | foxlabs/ted-tenders (14, 5.0, 4.0); dltik/ted-europa-scraper (3, 3, 5.0); lofomachines/public-tenders-scraper (6, -, 4.0) |
| eu-ted-tenders-monitor | eu tenders | >50 | 691 | foxlabs/ted-tenders (14, 5.0, 4.0); maximedupre/eu-funding-tenders-scraper (3, -, 0.01); scrapers_lat/eu-ted-tenders-scraper (0, 5, 2.6) |
| fda-recalls-monitor | fda recalls | 35 | 355 | scrapers_lat/openfda-food-recalls-scraper (3, 5, 8.0); benthepythondev/fda-recall-intelligence (0, -, 50.0); ryanclinton/fda-food-recall-monitor (0, -, 2.0) |
| fda-recalls-monitor | fda | >50 | 633 | scrapers_lat/openfda-food-recalls-scraper (3, 5, 8.0); parseforge/fda-warning-letters-scraper (2, -, 21.0); benthepythondev/fda-recall-intelligence (0, -, 50.0) |
| federal-register-monitor | federal register | 33 | 1372 | ryanclinton/federal-register-search (0, -, 2.0); pink_comic/federal-register-search (0, -, 2.0); benthepythondev/federal-register-intelligence (0, -, 2.0) |
| federal-register-monitor | regulations monitor | 4 | 3579 | viniman27/ai-regulation-updates-monitor (1, -, 100.0); agentictools/federal-register-monitor (1, -, 1.0); great_pistachio/us-federal-regulations-monitor (1, -, 10.0) |
| lighthouse-auditor | lighthouse | 19 | 161 | nexgendata/page-speed-analyzer (13, -, 100.0); constant_quadruped/lighthouse-auditor (33, -, -); perryay/website-performance-auditor (9, -, 10.0) |
| lighthouse-auditor | core web vitals | 13 | 219 | alizarin_refrigerator-owner/pagespeed-insights (5, -, 0.01); alizarin_refrigerator-owner/google-lighthouse-checker (1, -, 0.01); fetchbase/website-performance-audit (4, -, 20.0) |
| sitemap-url-extractor | sitemap | >50 | 1675 | apify/sitemap-extractor (54, 3.24, 0.5); onescales/sitemap-url-extractor (16, 5, 30.0); crawlerbros/sitemap-url-extractor (17, 5, 2.0) |
| sitemap-url-extractor | broken links | >50 | 2948 | logiover/bulk-url-status-checker (15, -, 2.5); parseforge/broken-link-checker (5, 2.75, 1.2); khadinakbar/broken-link-checker (16, -, 1.0) |
| email-security-checker | dmarc | 39 | 1583 | ryanclinton/dns-record-lookup (2, -, 3.0); apivault_labs/email-deliverability-checker (4, -, 1.2); onescales/dmarc-checker (1, 5, 10.0) |
| email-security-checker | spf dkim | 21 | 187 | ryanclinton/dns-record-lookup (2, -, 3.0); apivault_labs/email-deliverability-checker (4, -, 1.2); mambalabs/domain-deliverability-checker (4, -, 5.0) |
| company-jobs-scraper | greenhouse jobs | >50 | 1385 | fantastic-jobs/greenhouse-jobs-api (134, 3, 2.0); automation-lab/greenhouse-jobs-scraper (31, 4, 2.0); jobo.world/greenhouse-jobs-scraper-api (60, 5, 4.0) |
| company-jobs-scraper | career page | 25 | 3453 | hirebase/job-search (92, 5, 3.0); piotrv1001/company-career-page-scraper (37, -, 3.0); fabro.dev/company-career-page-jobs (18, -, 2.0) |
| ecb-exchange-rates | exchange rates | >50 | 2142 | ryanclinton/exchange-rate-tracker (4, -, -); maged120/central-bank-of-egypt-todays-rates (4, -, 15.0); moving_beacon-owner1/binance-exchange-rate-scraper (7, -, 10.0) |
| ecb-exchange-rates | ecb | 17 | 145 | benthepythondev/forex-exchange-intelligence (4, -, 1.0); hypebridge/economic-calendar-api (1, -, 4.5); chrisp1211/currency-exchange-scraper-max (1, -, 0.4) |
| wikipedia-scraper | wikipedia | >50 | 942 | automation-lab/wikipedia-scraper (8, -, 1.15); santamaria-automations/wikipedia-scraper (2, -, 2.0); fatihtahta/wikipedia-scraper (1, -, 4.99) |
| open-food-facts-scraper | open food facts | 27 | 1907 | benthepythondev/open-food-facts-product-intelligence (0, -, 20.0); gentle_cloud/open-food-facts-scraper (0, -, -); crawlerbros/openfoodfacts-scraper (3, -, 5.0) |
| us-weather-forecast | weather forecast | 24 | 365 | xtracto/ventusky-weather-scraper (3, -, 0.8); fortuitous_pirate/windguru-forecast-agent (2, -, 3.5); lulzasaur/nws-weather-scraper (7, -, 10.0) |
