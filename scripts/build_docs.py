#!/usr/bin/env python3
"""Static tutorial site generator for GitHub Pages (docs/).

Reads registry.json (actors.<slug>.listing / ppe_events / status) plus each
actors/<slug>/README.md and INPUT_SCHEMA.json, and generates, for every actor
with status "live":

  docs/<slug>/index.html   - a tutorial page: full README content rendered to
                              HTML (What you get, Use cases, Input, Pricing,
                              Related/Suite section, FAQ, Reliability, ...),
                              plus injected copy-paste code examples (cURL,
                              Python, JavaScript) built from INPUT_SCHEMA
                              prefill values, a "Run it in the Apify Console"
                              button, canonical/OG tags and JSON-LD.
  docs/index.html          - a catalog grouped by cluster.
  docs/sitemap.xml, docs/robots.txt, docs/.nojekyll, docs/style.css

Design notes
------------
* Read-only inputs: registry.json, actors/**. This script only ever writes
  under docs/ (plus itself). It never touches git, the network, or Apify.
* "Related Actors" reuses the suite-clustering idea from
  scripts/draft_suite_sections.py: rather than importing that module's SUITES
  dict (which can lag behind what's actually been applied to READMEs, e.g. a
  newly-added suite member), this generator renders each actor's own
  README "## factpipe <X> Suite/Toolkit" or "## Related factpipe Actors"
  section verbatim -- that section *is* the SUITES grouping, already
  materialized into the README by draft_suite_sections.py --apply. This is
  robust to actors being added to a suite later, and to new actors entirely:
  rerunning this script just picks up whatever is live in registry.json and
  whatever each README currently says.
* A small stdlib-only markdown -> HTML converter (headings, bold, inline
  code, fenced code blocks, links, lists, tables, blockquotes) renders README
  section bodies. No external dependencies, no external JS in the output.

Run with:  ~/.local/bin/python3.12 scripts/build_docs.py
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTORS_DIR = ROOT / "actors"
REGISTRY_PATH = ROOT / "registry.json"
DOCS_DIR = ROOT / "docs"

SITE_BASE = "https://neob001.github.io/data-portfolio"
STORE_ORG = "factpipe"
SITE_NAME = "factpipe Actor Tutorials"

# Fixed catalog clusters for docs/index.html, per D2 distribution pages scope.
CLUSTERS = {
    "Compliance": [
        "ofac-sanctions-screening",
        "eu-vat-validation",
        "uk-company-lookup",
        "france-company-lookup",
        "sam-gov-contracts",
        "eu-ted-tenders-monitor",
        "federal-register-monitor",
        "fda-recalls-monitor",
        "sec-edgar-filings-search",
    ],
    "Website audit": [
        "sitemap-url-extractor",
        "lighthouse-auditor",
        "email-security-checker",
        "broken-link-checker",
        "dns-records-lookup",
    ],
    "Jobs & company data": [
        "company-jobs-scraper",
    ],
    "Other": [
        "us-weather-forecast",
        "wikipedia-scraper",
        "open-food-facts-scraper",
        "ecb-exchange-rates",
    ],
}
CLUSTER_ORDER = ["Compliance", "Website audit", "Jobs & company data", "Other"]

# Populated at runtime with the slugs of every live actor, so internal
# factpipe Store links can be rewritten to relative tutorial-page links.
LIVE_SLUGS: set[str] = set()

# README section titles that get their own dedicated treatment; anything else
# (e.g. "Lists covered", "No personal data", "Source and licence", "How
# matching works", "Switching from...") is rendered generically, in the
# order it appears in the README, so no README content is silently dropped.
CODE_EXAMPLES_AFTER = "use cases"


# --------------------------------------------------------------------------
# Tiny markdown -> HTML converter (headings, bold, italics, inline code,
# fenced code blocks, links, unordered/ordered lists, tables, blockquotes).
# --------------------------------------------------------------------------

_CODE_SPAN_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_FACTPIPE_LINK_RE = re.compile(r"^https://apify\.com/factpipe/([a-z0-9-]+)/?$")


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def _rewrite_href(url: str) -> str:
    """Point links at sibling factpipe Actors to their own tutorial page."""
    m = _FACTPIPE_LINK_RE.match(url)
    if m and m.group(1) in LIVE_SLUGS:
        return f"../{m.group(1)}/"
    return url


def render_inline(text: str) -> str:
    """Render one line/run of inline markdown. Input is raw (unescaped)."""
    text = esc(text)

    def code_sub(m: re.Match) -> str:
        return f"<code>{m.group(1)}</code>"

    text = _CODE_SPAN_RE.sub(code_sub, text)

    def link_sub(m: re.Match) -> str:
        label, url = m.group(1), m.group(2)
        return f'<a href="{_rewrite_href(url)}">{label}</a>'

    text = _LINK_RE.sub(link_sub, text)
    text = _BOLD_RE.sub(lambda m: f"<strong>{m.group(1)}</strong>", text)
    text = _ITALIC_RE.sub(lambda m: f"<em>{m.group(1)}</em>", text)
    return text


def _split_table_row(line: str) -> list[str]:
    row = line.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


_TABLE_SEP_RE = re.compile(r"^\|?\s*:?-{2,}")


def render_markdown(text: str) -> str:
    """Render a block of README markdown (one or more paragraphs) to HTML."""
    lines = text.strip("\n").split("\n")
    out: list[str] = []
    para: list[str] = []
    i, n = 0, len(lines)

    def flush() -> None:
        if para:
            # GitHub renders a single newline inside a paragraph as a line
            # break (GFM soft-break), which is how these READMEs' FAQ
            # "**Question?**\nAnswer." pairs are meant to display.
            rendered = render_inline("\n".join(para).strip()).replace("\n", "<br>\n")
            out.append(f"<p>{rendered}</p>")
            para.clear()

    while i < n:
        raw = lines[i]
        stripped = raw.strip()

        if stripped.startswith("```"):
            flush()
            lang = stripped[3:].strip()
            code_lines: list[str] = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            cls = f' class="language-{esc(lang)}"' if lang else ""
            out.append(f"<pre><code{cls}>{esc(chr(10).join(code_lines))}</code></pre>")
            continue

        heading_m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading_m:
            flush()
            level = min(len(heading_m.group(1)) + 1, 6)  # nest one below page H1/H2
            out.append(f"<h{level}>{render_inline(heading_m.group(2))}</h{level}>")
            i += 1
            continue

        if stripped.startswith(">"):
            flush()
            quote_lines = []
            while i < n and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append(f"<blockquote><p>{render_inline(' '.join(quote_lines))}</p></blockquote>")
            continue

        if re.match(r"^[-*]\s+", stripped):
            flush()
            items = []
            while i < n and re.match(r"^[-*]\s+", lines[i].strip()):
                items.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            out.append("<ul>" + "".join(f"<li>{render_inline(it)}</li>" for it in items) + "</ul>")
            continue

        if re.match(r"^\d+\.\s+", stripped):
            flush()
            items = []
            while i < n and re.match(r"^\d+\.\s+", lines[i].strip()):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i].strip()))
                i += 1
            out.append("<ol>" + "".join(f"<li>{render_inline(it)}</li>" for it in items) + "</ol>")
            continue

        if stripped.startswith("|") and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1].strip()):
            flush()
            header = _split_table_row(stripped)
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(_split_table_row(lines[i]))
                i += 1
            thead = "<tr>" + "".join(f"<th>{render_inline(h)}</th>" for h in header) + "</tr>"
            tbody = "".join(
                "<tr>" + "".join(f"<td>{render_inline(c)}</td>" for c in r) + "</tr>" for r in rows
            )
            out.append(f'<div class="table-wrap"><table><thead>{thead}</thead><tbody>{tbody}</tbody></table></div>')
            continue

        if stripped == "":
            flush()
            i += 1
            continue

        para.append(stripped)
        i += 1

    flush()
    return "\n".join(out)


def find_first_md_table(text: str) -> tuple[list[str] | None, list[list[str]] | None, int, int]:
    """Locate the first pipe-table in text; return (header, rows, start_line, end_line)."""
    lines = text.split("\n")
    for i in range(len(lines) - 1):
        if lines[i].strip().startswith("|") and _TABLE_SEP_RE.match(lines[i + 1].strip()):
            header = _split_table_row(lines[i])
            j = i + 2
            rows = []
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(_split_table_row(lines[j]))
                j += 1
            return header, rows, i, j
    return None, None, -1, -1


# --------------------------------------------------------------------------
# README parsing
# --------------------------------------------------------------------------

_H1_RE = re.compile(r"^#\s+(.*)$", re.M)
_H2_RE = re.compile(r"^##\s+(.*)$", re.M)


def parse_readme(text: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Return (h1_title, intro_markdown, [(section_title, section_body), ...])."""
    h1_m = _H1_RE.search(text)
    h1_title = h1_m.group(1).strip() if h1_m else ""
    h2_matches = list(_H2_RE.finditer(text))
    intro_start = h1_m.end() if h1_m else 0
    intro_end = h2_matches[0].start() if h2_matches else len(text)
    intro = text[intro_start:intro_end].strip("\n")

    sections = []
    for idx, m in enumerate(h2_matches):
        title = m.group(1).strip()
        start = m.end()
        end = h2_matches[idx + 1].start() if idx + 1 < len(h2_matches) else len(text)
        sections.append((title, text[start:end].strip("\n")))
    return h1_title, intro, sections


# --------------------------------------------------------------------------
# INPUT_SCHEMA -> example input object + code examples
# --------------------------------------------------------------------------

def placeholder_for(prop: dict) -> object:
    t = prop.get("type")
    if t == "string":
        return "value"
    if t == "array":
        return ["value"]
    if t in ("integer", "number"):
        return 1
    if t == "boolean":
        return True
    return None


def build_example_input(schema: dict) -> dict:
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    obj = {}
    for key, prop in props.items():
        if not isinstance(prop, dict):
            continue
        if "prefill" in prop:
            obj[key] = prop["prefill"]
        elif key in required:
            obj[key] = prop.get("default", placeholder_for(prop))
    return obj


def code_examples_html(slug: str, example_input: dict) -> str:
    input_json = json.dumps(example_input, indent=2)
    input_json_compact = json.dumps(example_input)
    actor_ref = f"{STORE_ORG}~{slug}"
    actor_ref_slash = f"{STORE_ORG}/{slug}"

    curl_cmd = (
        f'curl "https://api.apify.com/v2/acts/{actor_ref}/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \\\n'
        f'  -X POST \\\n'
        f'  -H "Content-Type: application/json" \\\n'
        f"  -d '{input_json_compact}'"
    )

    python_code = (
        "from apify_client import ApifyClient\n\n"
        'client = ApifyClient("YOUR_APIFY_TOKEN")\n\n'
        f"run_input = {input_json}\n\n"
        f'run = client.actor("{actor_ref_slash}").call(run_input=run_input)\n\n'
        'for item in client.dataset(run["defaultDatasetId"]).iterate_items():\n'
        "    print(item)\n"
    )

    js_input = json.dumps(example_input, indent=2)
    js_code = (
        "import { ApifyClient } from 'apify-client';\n\n"
        "const client = new ApifyClient({ token: 'YOUR_APIFY_TOKEN' });\n\n"
        f"const input = {js_input};\n\n"
        f"const run = await client.actor('{actor_ref_slash}').call(input);\n\n"
        "const { items } = await client.dataset(run.defaultDatasetId).listItems();\n"
        "console.log(items);\n"
    )

    console_url = f"https://apify.com/{actor_ref_slash}"

    return f"""
<h2 id="code-examples">Copy-paste code examples</h2>
<p>Every example runs the Actor and fetches its results in one call. Swap
<code>YOUR_APIFY_TOKEN</code> for your own token from the
<a href="https://console.apify.com/settings/integrations">Apify Console integrations page</a>,
and edit the input to fit your own data.</p>
<p><a class="button" href="{esc(console_url)}" target="_blank" rel="noopener">Run it in the Apify Console &rarr;</a></p>

<h3>cURL</h3>
<pre><code class="language-bash">{esc(curl_cmd)}</code></pre>

<h3>Python (apify-client)</h3>
<pre><code class="language-python">{esc(python_code)}</code></pre>

<h3>JavaScript (apify-client)</h3>
<pre><code class="language-javascript">{esc(js_code)}</code></pre>
""".strip()


# --------------------------------------------------------------------------
# Pricing table (sourced from registry ppe_events; row wording cross-checked
# against the README's own pricing table so no claim is invented).
# --------------------------------------------------------------------------

def money_per_1000(usd: float) -> str:
    per1000 = usd * 1000
    if abs(per1000 - round(per1000)) < 1e-9:
        return f"${round(per1000):.0f}"
    return f"${per1000:.2f}"


def money_each(usd: float) -> str:
    s = f"{usd:.4f}".rstrip("0")
    if s.endswith("."):
        s = s[:-1]
    return f"${s}"


def pricing_section_html(ppe_events: dict, readme_pricing_body: str) -> str:
    readme_header, readme_rows, tstart, tend = find_first_md_table(readme_pricing_body)
    readme_meaning = {}
    if readme_header and readme_rows:
        try:
            event_idx = [h.lower() for h in readme_header].index("event")
            meaning_idx = [h.lower() for h in readme_header].index("meaning")
            for row in readme_rows:
                event_key = re.sub(r"[`*]", "", row[event_idx]).strip()
                readme_meaning[event_key] = row[meaning_idx]
        except (ValueError, IndexError):
            pass

    rows_html = []
    for event_key, meta in ppe_events.items():
        usd = meta.get("proposed_price_usd", 0)
        meaning = readme_meaning.get(event_key) or meta.get("description", "")
        rows_html.append(
            "<tr>"
            f"<td><code>{esc(event_key)}</code></td>"
            f"<td><strong>{money_per_1000(usd)} per 1,000</strong> ({money_each(usd)} each)</td>"
            f"<td>{render_inline(meaning)}</td>"
            "</tr>"
        )
    table = (
        '<div class="table-wrap"><table><thead><tr><th>Event</th><th>Price</th><th>Meaning</th></tr></thead>'
        f"<tbody>{''.join(rows_html)}</tbody></table></div>"
    )

    # Keep any remaining README prose (e.g. the "Example: ... cost $X" line)
    # that isn't the table itself.
    if tstart >= 0:
        lines = readme_pricing_body.split("\n")
        remainder = "\n".join(lines[:tstart] + lines[tend:]).strip("\n")
    else:
        remainder = readme_pricing_body
    remainder_html = render_markdown(remainder) if remainder.strip() else ""

    return table + "\n" + remainder_html


# --------------------------------------------------------------------------
# Page templates
# --------------------------------------------------------------------------

def html_page(*, title: str, description: str, canonical: str, css_href: str,
              og_type: str, body: str, extra_head: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical)}">
<link rel="stylesheet" href="{css_href}">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:site_name" content="{esc(SITE_NAME)}">
<meta name="twitter:card" content="summary">
{extra_head}
</head>
<body>
{body}
</body>
</html>
"""


def json_ld_script(data: dict) -> str:
    payload = json.dumps(data, indent=2).replace("</", "<\\/")
    return f'<script type="application/ld+json">\n{payload}\n</script>'


def site_header(depth: int) -> str:
    home = "../index.html" if depth else "index.html"
    return f"""<header class="site-header">
  <div class="wrap">
    <a class="brand" href="{home}">factpipe</a>
    <span class="tagline">Actor tutorials &amp; API examples</span>
  </div>
</header>"""


def site_footer(depth: int) -> str:
    home = "../index.html" if depth else "index.html"
    store = f"https://apify.com/{STORE_ORG}"
    return f"""<footer class="site-footer">
  <div class="wrap">
    <p><a href="{home}">All factpipe Actor tutorials</a> &middot; <a href="{esc(store)}" target="_blank" rel="noopener">factpipe on Apify</a></p>
    <p class="muted">Generated from each Actor's README. Pricing shown is pay-per-result; see the Apify Console for current details.</p>
  </div>
</footer>"""


def build_actor_page(slug: str, meta: dict, readme_text: str, schema: dict) -> str:
    listing = meta.get("listing", {})
    ppe_events = meta.get("ppe_events", {})
    seo_title = listing.get("seoTitle") or listing.get("title") or slug
    seo_description = listing.get("seoDescription") or listing.get("description", "")
    canonical = f"{SITE_BASE}/{slug}/"
    store_url = f"https://apify.com/{STORE_ORG}/{slug}"

    h1_title, intro_md, sections = parse_readme(readme_text)
    display_title = h1_title or seo_title

    primary_event, primary_meta = next(iter(ppe_events.items())) if ppe_events else (None, {})
    price_badge = money_per_1000(primary_meta.get("proposed_price_usd", 0)) + " / 1,000" if primary_meta else ""

    example_input = build_example_input(schema)
    code_block = code_examples_html(slug, example_input)

    body_parts = [f"<h1>{render_inline(display_title)}</h1>"]
    if intro_md.strip():
        body_parts.append(render_markdown(intro_md))

    quick_facts = (
        '<div class="quick-facts">'
        f'<span class="badge">{esc(price_badge)}</span>' if price_badge else ""
    )
    quick_facts += (
        f'<a class="button" href="{esc(store_url)}" target="_blank" rel="noopener">View on Apify Store</a>'
        "</div>"
    )
    body_parts.append(quick_facts)

    # Inject the code examples right after "Use cases"; if a README doesn't
    # have that section (e.g. ofac-sanctions-screening), fall back to right
    # after "What you get"; if neither exists, append at the end.
    section_titles_norm = [t.lower().strip() for t, _ in sections]
    if CODE_EXAMPLES_AFTER in section_titles_norm:
        insert_after = CODE_EXAMPLES_AFTER
    elif "what you get" in section_titles_norm:
        insert_after = "what you get"
    else:
        insert_after = None

    for title, section_body in sections:
        norm = title.lower().strip()
        if norm.startswith("pricing"):
            rendered = pricing_section_html(ppe_events, section_body)
        else:
            rendered = render_markdown(section_body)
        body_parts.append(f'<h2 id="{esc(re.sub(r"[^a-z0-9]+", "-", norm).strip("-"))}">{render_inline(title)}</h2>')
        body_parts.append(rendered)
        if norm == insert_after:
            body_parts.append(code_block)

    if insert_after is None:
        body_parts.append(code_block)

    article = "\n".join(body_parts)

    json_ld = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": listing.get("title", display_title),
        "description": listing.get("description", seo_description),
        "url": canonical,
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Any (cloud, runs on Apify)",
    }
    if primary_meta:
        json_ld["offers"] = {
            "@type": "Offer",
            "priceCurrency": "USD",
            "price": f"{primary_meta.get('proposed_price_usd', 0) * 1000:.4f}".rstrip("0").rstrip("."),
            "description": f"Pay-per-result pricing: {money_per_1000(primary_meta.get('proposed_price_usd', 0))} per 1,000 {primary_event.replace('-', ' ')}s" if primary_event else "Pay-per-result pricing",
            "url": store_url,
        }

    extra_head = json_ld_script(json_ld)

    body = f"""{site_header(1)}
<main class="wrap actor-page">
{article}
</main>
{site_footer(1)}"""

    return html_page(
        title=seo_title,
        description=seo_description,
        canonical=canonical,
        css_href="../style.css",
        og_type="website",
        body=body,
        extra_head=extra_head,
    )


def build_index_page(actors: dict) -> str:
    cards_by_cluster: dict[str, list[str]] = {name: [] for name in CLUSTER_ORDER}

    def cluster_of(slug: str) -> str:
        for name, slugs in CLUSTERS.items():
            if slug in slugs:
                return name
        return "Other"

    live = {slug: v for slug, v in actors.items() if v.get("status") == "live"}
    for slug, meta in sorted(live.items(), key=lambda kv: kv[1].get("listing", {}).get("title", kv[0])):
        cluster = cluster_of(slug)
        cards_by_cluster.setdefault(cluster, [])
        listing = meta.get("listing", {})
        ppe_events = meta.get("ppe_events", {})
        price = ""
        if ppe_events:
            _, first_meta = next(iter(ppe_events.items()))
            price = money_per_1000(first_meta.get("proposed_price_usd", 0)) + " / 1,000"
        title = listing.get("title", slug)
        desc = listing.get("description", "")
        store_url = f"https://apify.com/{STORE_ORG}/{slug}"
        card = f"""<article class="card">
  <h3><a href="{esc(slug)}/index.html">{render_inline(title)}</a></h3>
  <p>{render_inline(desc)}</p>
  <div class="card-meta">
    {f'<span class="badge">{esc(price)}</span>' if price else ''}
    <a href="{esc(slug)}/index.html">Tutorial &amp; API examples &rarr;</a>
    <a href="{esc(store_url)}" target="_blank" rel="noopener">Store page &rarr;</a>
  </div>
</article>"""
        cards_by_cluster[cluster].append(card)

    sections_html = []
    for cluster in CLUSTER_ORDER:
        cards = cards_by_cluster.get(cluster, [])
        if not cards:
            continue
        sections_html.append(
            f'<section class="cluster">\n<h2>{esc(cluster)}</h2>\n<div class="card-grid">\n'
            + "\n".join(cards)
            + "\n</div>\n</section>"
        )

    intro = f"""<p>{len(live)} factpipe Actors on Apify, each built on an official data
source or API. Pay only for delivered results &mdash; empty and failed lookups
are never charged. Every tutorial below has copy-paste cURL, Python and
JavaScript examples.</p>"""

    body = f"""{site_header(0)}
<main class="wrap">
<h1>factpipe Actor Tutorials</h1>
{intro}
{''.join(sections_html)}
</main>
{site_footer(0)}"""

    json_ld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": SITE_NAME,
        "url": f"{SITE_BASE}/",
        "description": "Tutorials and API examples for every live factpipe Actor on Apify.",
    }

    return html_page(
        title=SITE_NAME,
        description="Tutorials and copy-paste API examples for every live factpipe Actor on Apify: compliance data, website audits, jobs and more.",
        canonical=f"{SITE_BASE}/",
        css_href="style.css",
        og_type="website",
        body=body,
        extra_head=json_ld_script(json_ld),
    )


STYLE_CSS = """
:root {
  --bg: #ffffff;
  --fg: #1a1d23;
  --muted: #5b6472;
  --border: #e4e7eb;
  --accent: #1a5fb4;
  --accent-fg: #ffffff;
  --code-bg: #f4f6f8;
  --card-bg: #f9fafb;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --fg: #e9ebef;
    --muted: #9aa4b2;
    --border: #2a2e35;
    --accent: #6fa8f0;
    --accent-fg: #0c1420;
    --code-bg: #1c1f26;
    --card-bg: #1a1d23;
  }
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 20px;
}

.site-header, .site-footer {
  border-bottom: 1px solid var(--border);
}
.site-footer {
  border-top: 1px solid var(--border);
  border-bottom: none;
  margin-top: 3rem;
}
.site-header .wrap, .site-footer .wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
  padding-top: 1rem;
  padding-bottom: 1rem;
}
.site-header .brand {
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--fg);
  text-decoration: none;
}
.site-header .tagline {
  color: var(--muted);
  font-size: 0.95rem;
}
.site-footer p { margin: 0.25rem 0; }
.site-footer .muted { color: var(--muted); font-size: 0.85rem; }

main.wrap { padding-top: 2rem; padding-bottom: 2rem; }

h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 0.75rem; }
h2 { font-size: 1.35rem; margin: 2.2rem 0 0.8rem; border-top: 1px solid var(--border); padding-top: 1.6rem; }
h3 { font-size: 1.08rem; margin: 1.4rem 0 0.5rem; }

p { margin: 0.7rem 0; }
a { color: var(--accent); }

.quick-facts {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 1rem 0 0.5rem;
}

.badge {
  display: inline-block;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.2rem 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.button {
  display: inline-block;
  background: var(--accent);
  color: var(--accent-fg) !important;
  text-decoration: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.92rem;
}
.button:hover { opacity: 0.9; }

code {
  background: var(--code-bg);
  border-radius: 4px;
  padding: 0.1rem 0.35rem;
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  overflow-x: auto;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.85rem;
  white-space: pre;
}

.table-wrap { overflow-x: auto; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.65rem; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }

blockquote {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 3px solid var(--accent);
  background: var(--code-bg);
  border-radius: 0 6px 6px 0;
}
blockquote p { margin: 0.3rem 0; }

ul, ol { padding-left: 1.4rem; }
li { margin: 0.3rem 0; }

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  margin: 1rem 0 2rem;
}
.card {
  border: 1px solid var(--border);
  background: var(--card-bg);
  border-radius: 10px;
  padding: 1rem 1.1rem;
}
.card h3 { margin: 0 0 0.4rem; font-size: 1.02rem; }
.card h3 a { text-decoration: none; }
.card p { font-size: 0.9rem; color: var(--muted); margin: 0.4rem 0 0.7rem; }
.card-meta { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; font-size: 0.85rem; }

.cluster h2 { border-top: none; }

@media (max-width: 480px) {
  h1 { font-size: 1.55rem; }
  h2 { font-size: 1.2rem; }
}
""".strip() + "\n"


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> None:
    registry = json.loads(REGISTRY_PATH.read_text())
    actors = registry.get("actors", {})
    live_actors = {slug: meta for slug, meta in actors.items() if meta.get("status") == "live"}

    global LIVE_SLUGS
    LIVE_SLUGS = set(live_actors.keys())

    DOCS_DIR.mkdir(exist_ok=True)
    (DOCS_DIR / "style.css").write_text(STYLE_CSS)
    (DOCS_DIR / ".nojekyll").write_text("")

    written_pages = []
    warnings = []

    for slug, meta in sorted(live_actors.items()):
        readme_path = ACTORS_DIR / slug / "README.md"
        schema_path = ACTORS_DIR / slug / "INPUT_SCHEMA.json"
        if not readme_path.exists():
            warnings.append(f"{slug}: missing README.md, skipped")
            continue
        if not schema_path.exists():
            warnings.append(f"{slug}: missing INPUT_SCHEMA.json, skipped")
            continue

        readme_text = readme_path.read_text()
        try:
            schema = json.loads(schema_path.read_text())
        except json.JSONDecodeError as e:
            warnings.append(f"{slug}: INPUT_SCHEMA.json failed to parse ({e}), used empty schema")
            schema = {}

        _, _, sections = parse_readme(readme_text)
        section_titles = {t.lower() for t, _ in sections}
        for expected in ("what you get", "use cases", "pricing (pay per event)", "faq"):
            if expected not in section_titles:
                warnings.append(f"{slug}: README missing expected section '{expected}'")

        page_html = build_actor_page(slug, meta, readme_text, schema)
        out_dir = DOCS_DIR / slug
        out_dir.mkdir(exist_ok=True)
        (out_dir / "index.html").write_text(page_html)
        written_pages.append(slug)

    index_html = build_index_page(actors)
    (DOCS_DIR / "index.html").write_text(index_html)

    urls = [f"{SITE_BASE}/"] + [f"{SITE_BASE}/{slug}/" for slug in written_pages]
    sitemap_entries = "\n".join(f"  <url><loc>{esc(u)}</loc></url>" for u in urls)
    sitemap_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{sitemap_entries}\n"
        "</urlset>\n"
    )
    (DOCS_DIR / "sitemap.xml").write_text(sitemap_xml)

    robots_txt = f"User-agent: *\nAllow: /\n\nSitemap: {SITE_BASE}/sitemap.xml\n"
    (DOCS_DIR / "robots.txt").write_text(robots_txt)

    print(f"Generated {len(written_pages)} actor pages + docs/index.html")
    print(f"Files: docs/index.html, docs/style.css, docs/sitemap.xml, docs/robots.txt, docs/.nojekyll")
    print(f"Actor pages: {', '.join(written_pages)}")
    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
