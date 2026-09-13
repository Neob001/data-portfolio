# Wikipedia Scraper API — Articles, Summaries & Full Text

Get **Wikipedia articles** as clean, flat JSON — by title, by URL, or by **keyword search** — in **any Wikipedia language**. Every record has the lead summary, optional full plain text, categories, Wikidata ID, coordinates, thumbnail and last-edit timestamp. Uses only the **official MediaWiki API**: no HTML parsing, no proxies, no broken selectors. Built for RAG pipelines, knowledge graphs, content enrichment and AI agents.

## What you get

One record per article:

```json
{
  "query": "https://en.wikipedia.org/wiki/Web_scraping",
  "found": true,
  "language": "en",
  "page_id": 2696619,
  "title": "Web scraping",
  "description": "Data scraping used for extracting data from websites",
  "summary": "Web scraping, web harvesting, or web data extraction is data scraping used for extracting data from websites...",
  "full_text": null,
  "word_count": null,
  "is_disambiguation": false,
  "categories": ["Web scraping"],
  "wikidata_id": "Q665452",
  "thumbnail_url": null,
  "latitude": null,
  "longitude": null,
  "last_edited_at": "2026-09-01T10:12:44Z",
  "revision_id": 1309876543,
  "length_bytes": 31254,
  "article_url": "https://en.wikipedia.org/wiki/Web_scraping",
  "license": "CC BY-SA 4.0",
  "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
  "attribution_url": "https://en.wikipedia.org/w/index.php?curid=2696619&action=history",
  "source_url": "https://en.wikipedia.org/w/api.php?...",
  "fetched_at": "2026-09-13T12:00:00.000Z"
}
```

## Use cases

- **RAG & LLM grounding**: pull summaries or full text for a list of topics in one run, with stable page IDs and revision IDs for citations.
- **Entity enrichment**: map names or keywords to Wikipedia pages, Wikidata IDs, categories and coordinates.
- **Research datasets**: collect articles for a keyword in any of 300+ languages.
- **AI agents**: tiny input schema, deterministic output — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `articles` | string[] | Titles (`Eiffel Tower`) or URLs (`https://de.wikipedia.org/wiki/Berlin`) |
| `searchQueries` | string[] | Keywords; top matching articles per query |
| `language` | string | Language code for titles and searches (default `en`) |
| `maxArticlesPerSearch` | integer | Top N per search query (default 10, max 500) |
| `fullText` | boolean | Include the complete plain-text body (default false) |

Redirects (e.g. `UK` → `United Kingdom`) are followed automatically. Disambiguation pages are flagged with `is_disambiguation: true`.

**Policy:** articles about individual people (Wikidata "instance of: human") are skipped and never charged. This Actor is for topics, places, organizations, products and concepts — not person profiles.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `article-result` | **$1.00 per 1,000** ($0.001 each) | One article delivered. **Not-found titles, skipped person articles, duplicates and empty runs are never charged.** No start fee. |

Example: 5,000 articles cost **$5.00**. You only pay for delivered results.

## FAQ

**Do I need a Wikipedia API key?**
No. The official MediaWiki API is open. The Actor identifies itself per Wikimedia's User-Agent policy and paces its requests.

**Can I get the full article text, not just the summary?**
Yes. Set `fullText: true` to add the complete plain-text body and a word count to every record.

**Which languages are supported?**
Every Wikipedia language edition. Set `language` (e.g. `de`, `fr`, `ja`) or pass URLs from any edition in the same run.

**Can I use Wikipedia content commercially?**
Wikipedia text is licensed CC BY-SA 4.0: reuse is allowed, including commercially, with attribution and share-alike. Every record carries `license`, `article_url` and `attribution_url` so you can attribute correctly.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official MediaWiki and Wikidata APIs, batched requests, retries with backoff, polite rate limiting, structured failure reporting, daily health checks and issue triage.
