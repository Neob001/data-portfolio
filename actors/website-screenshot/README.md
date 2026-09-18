# Website Screenshot API — Bulk Full-Page Screenshots of Any URL

Capture **full-page or viewport screenshots of any list of URLs in bulk** — desktop or mobile, PNG or JPEG — and get one clean JSON record per page with the stored image URL, dimensions, file size and status. Cookie/consent banners are hidden automatically before capture.

This Actor runs headless Chrome itself: **no screenshot API key, no rate limits, no browser to host** — feed it a URL list and get back deterministic, storable images plus a flat dataset.

## Quick start

1. Click **Start** with the two prefilled URLs (`https://example.com`, `https://www.wikipedia.org`). It usually finishes in well under two minutes.
2. You get two full-page desktop PNG screenshots, each stored in the run's key-value store with a direct download URL, plus a dataset row per page.
3. That first run costs $0.004, well within Apify's free monthly credit. Then swap in your own URL list or schedule it.

## What you get

```json
{
  "url": "https://example.com/",
  "final_url": "https://example.com/",
  "status_code": 200,
  "ok": true,
  "error": null,
  "screenshot_key": "0f2c9a1b8e7d4c3f6a5b2e1d0c9b8a7f6e5d4c3b.png",
  "screenshot_url": "https://api.apify.com/v2/key-value-stores/abcXYZ123/records/0f2c9a1b8e7d4c3f6a5b2e1d0c9b8a7f6e5d4c3b.png",
  "width": 1280,
  "height": 936,
  "bytes": 41823,
  "format": "png",
  "page_title": "Example Domain",
  "taken_at": "2026-09-18T12:00:00.000Z",
  "source_url": "https://example.com/",
  "fetched_at": "2026-09-18T12:00:00.100Z"
}
```

## Use cases

- **Visual QA**: screenshot every page in a release checklist before and after a deploy and diff them.
- **Uptime & change monitoring**: schedule daily captures of key pages and alert when the layout changes unexpectedly.
- **Archiving & compliance**: keep a dated visual record of pages you need to prove existed in a given state.
- **SEO & marketing reports**: drop full-page screenshots straight into client reports next to Lighthouse and link-check results.
- **Thumbnails & previews**: generate link-preview or directory-listing thumbnails for a list of sites at once.

## Input

| Field | Type | Notes |
|---|---|---|
| `urls` | string[], required | Pages to screenshot; `example.com` works too. Duplicates removed automatically. |
| `fullPage` | boolean | Capture the whole scrollable page, not just the viewport (default `true`) |
| `viewportWidth` / `viewportHeight` | integer | Desktop viewport size (default 1280x800); ignored on mobile |
| `device` | `desktop` \| `mobile` | Mobile emulates 390x844 at 3x pixel density with a mobile user agent |
| `format` | `png` \| `jpeg` | Output image format (default `png`) |
| `jpegQuality` | integer | JPEG compression quality 1-100 (default 80); ignored for PNG |
| `waitUntil` | `load` \| `domcontentloaded` \| `networkidle2` | Navigation completion signal (default `networkidle2`) |
| `delayMs` | integer | Extra wait before capture, up to 10,000ms, for slow content |
| `hideCookieBanners` | boolean | Hide common cookie/consent banners with CSS before capture (default `true`) |
| `timeoutSecs` | integer | Per-page load timeout in seconds (default 30); one automatic retry on timeout |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `screenshot-taken` | **$2.00 per 1,000** ($0.002 each) | One screenshot successfully captured and stored. Invalid URLs, timeouts and failed navigations are never charged. |

Example: screenshotting 1,000 URLs costs **$2.00**. No start fee. You only pay for delivered images.

## factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Broken Link Checker](https://apify.com/factpipe/broken-link-checker) | Crawl a site and flag every broken internal/external link, image and asset | $1.50/1k |
| Website audit | [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | **Website Screenshot** (this Actor) | Bulk full-page or viewport screenshots, desktop or mobile | $2/1k |
| Domain audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |
| Domain audit | [DNS Records Lookup](https://apify.com/factpipe/dns-records-lookup) | Full DNS record set (A, AAAA, MX, TXT, NS, CNAME) for any list of domains | $1.50/1k |

**Use it together:**

- **Client health report:** pair full-page screenshots here with [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) scores and [Broken Link Checker](https://apify.com/factpipe/broken-link-checker) results for a single visual + technical audit deliverable.
- **Before/after evidence:** run this Actor before and after a fix flagged by [Broken Link Checker](https://apify.com/factpipe/broken-link-checker) to document the change.

## FAQ

**Does this click "Accept" on cookie banners?**
No. `hideCookieBanners` only injects CSS to hide common consent-banner elements (OneTrust, Cookiebot, Quantcast, Didomi and similar) so they don't clutter the screenshot. It never interacts with the page, so no consent is ever recorded on your behalf.

**Can it screenshot pages behind a login?**
No. This Actor loads each URL anonymously, the same way a logged-out visitor would. Pages that require authentication will be captured as their login or paywall screen.

**Will it work on JavaScript-heavy sites (React, Vue, infinite scroll)?**
Yes for standard client-side rendering — `waitUntil: networkidle2` (the default) waits for network activity to settle before capturing. For pages with delayed animations or lazy-loaded content, increase `delayMs` up to 10 seconds.

**What image formats are supported, and can I control file size?**
PNG (lossless, larger files) or JPEG (`jpegQuality` 1-100, smaller files). Both are stored in the run's key-value store with a stable `screenshot_key`; the dataset row gives you a direct download URL plus width, height and byte size.

**Am I charged when a page fails to load?**
No. Invalid URLs, DNS errors, navigation timeouts, HTTP errors and blocked requests are returned with an `error` code and are never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server.

## Reliability

Deterministic headless Chrome capture, one automatic retry on navigation timeout, per-page timeouts, structured failure reporting, daily health checks.
