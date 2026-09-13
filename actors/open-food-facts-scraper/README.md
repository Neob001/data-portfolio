# Open Food Facts Scraper — Nutrition & Barcode Lookup API

Look up **food products by barcode (EAN/UPC)** or **keyword** and get clean, flat JSON from **Open Food Facts**, the largest open food database (millions of products worldwide): **nutrition facts per 100 g**, ingredients, allergens, traces, **Nutri-Score**, **NOVA group**, **Eco-Score**, brands, categories, labels and product image. Uses only the official Open Food Facts APIs — no HTML scraping, no proxies. Unknown barcodes are free.

## What you get

One record per product:

```json
{
  "query": "3017624010701",
  "found": true,
  "barcode": "3017624010701",
  "product_name": "Nutella",
  "brands": ["Ferrero"],
  "quantity": "400.0 g",
  "serving_size": "15 g",
  "categories": ["breakfasts", "spreads", "sweet-spreads"],
  "countries": ["france", "united-kingdom"],
  "labels": ["no-gluten"],
  "packaging": ["glass-jar"],
  "ingredients_text": "Sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, fat-reduced cocoa 7.4%, emulsifier: lecithins (soy), vanillin.",
  "allergens": ["milk", "nuts", "soybeans"],
  "traces": ["nuts"],
  "nutriscore_grade": "e",
  "nova_group": 4,
  "ecoscore_grade": "d",
  "energy_kcal_100g": 539,
  "fat_100g": 30.9,
  "saturated_fat_100g": 10.6,
  "carbohydrates_100g": 57.5,
  "sugars_100g": 56.3,
  "fiber_100g": null,
  "proteins_100g": 6.3,
  "salt_100g": 0.107,
  "sodium_100g": 0.0428,
  "image_url": "https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.100.400.jpg",
  "last_modified_at": "2026-08-05T12:48:26.000Z",
  "product_url": "https://world.openfoodfacts.org/product/3017624010701",
  "license": "ODbL 1.0 (Open Food Facts contributors)",
  "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
  "source_url": "https://world.openfoodfacts.org/api/v2/product/3017624010701.json?fields=...",
  "fetched_at": "2026-09-13T12:00:00.000Z"
}
```

## Use cases

- **Nutrition & diet apps**: resolve scanned barcodes to calories, macros, allergens and Nutri-Score.
- **E-commerce & grocery catalogs**: enrich product listings with ingredients, allergens, labels and images.
- **Food research & market analysis**: collect products by keyword and country with Nutri-Score and NOVA processing level.
- **AI agents**: tiny input schema, deterministic output — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `barcodes` | string[] | EAN-13, EAN-8, UPC-A or GTIN-14 |
| `searchTerms` | string[] | Product keywords, e.g. `peanut butter` |
| `country` | string | Optional search filter, e.g. `united-states`, `france` |
| `maxResultsPerSearch` | integer | Products per search term (default 50, max 1000) |

Crowd-sourced data: some products have incomplete fields; missing values are `null`, never guessed.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `product-result` | **$1.00 per 1,000** ($0.001 each) | One product with a name or nutrition data delivered. **Unknown barcodes, empty products, duplicates and empty runs are never charged.** No start fee. |

Example: 10,000 products cost **$10.00**. You only pay for delivered results.

## FAQ

**Do I need an Open Food Facts API key?**
No. The official Open Food Facts API is keyless. The Actor sends an identifying User-Agent as Open Food Facts requests and respects its published rate limits.

**Can I look up UPC barcodes from US products?**
Yes. UPC-A (12 digits), EAN-13, EAN-8 and GTIN-14 are accepted; spaces and dashes are removed automatically.

**Can I use the data commercially?**
Open Food Facts data is licensed under the Open Database License (ODbL): commercial use is allowed with attribution, and databases you publish that are derived from it must stay under ODbL. Every record carries `license` and `product_url` for attribution.

**Does it include contributor or user data?**
No. Only product facts are requested; contributor usernames are never collected.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official Open Food Facts APIs, rate limits respected (product reads and searches paced separately), retries with backoff, structured failure reporting, daily health checks and issue triage.
