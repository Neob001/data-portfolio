#!/usr/bin/env python3
"""README first screen (RH1): value line, a real sample-result table and links to the example tasks.

For each live Actor the block goes right under the H1, between hero markers, so reruns replace it.
Sample rows come from the latest successful run of the Actor's first published example task
(tasks.json), limited to the first columns of its dataset table view. Rerun after tasks change;
README changes need a rebuild to reach the Store.

Usage: APIFY_TOKEN=... readme_hero.py [slug ...]
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from apify_api import get

ROOT = Path(__file__).resolve().parent.parent
START, END = "<!-- factpipe:hero:start -->", "<!-- factpipe:hero:end -->"
MAX_COLS, MAX_ROWS, MAX_CELL = 5, 3, 48


def cell(value):
    if value is None or value == "" or value == []:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value[:3]) + (" …" if len(value) > 3 else "")
    elif isinstance(value, float):
        value = f"{value:g}"
    text = str(value).replace("|", "/").replace("\n", " ").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}T", text):
        text = text[:10]
    return text if len(text) <= MAX_CELL else text[: MAX_CELL - 1] + "…"


# Actors whose dataset view starts with columns that make a poor sample (flags, sparse columns).
HERO_FIELDS = {
    "tech-stack-detector": ["domain", "ecommerce_platform", "payment_processors", "cdn", "mail_provider"],
}

ACRONYMS = {"cdn": "CDN", "cms": "CMS", "url": "URL", "mx": "MX", "ns": "NS"}

PERSONAL_URL = re.compile(r"linkedin\.com/in/|facebook\.com/|twitter\.com/|x\.com/|instagram\.com/", re.I)


def pick_rows(slug, items, fields):
    """Up to MAX_ROWS varied, non-personal sample rows (one per company/title where possible)."""
    rows = [r for r in items if any(r.get(f) not in (None, "", []) for f in fields)
            and not PERSONAL_URL.search(json.dumps(r))]
    if slug == "broken-link-checker":
        rows = [r for r in rows if r.get("record_type") == "broken_link"] or rows
    rows = [r for r in rows if r.get("ok") is not False] or rows  # show successes, not failures
    key_field = ("company_name" if "company_name" in fields else "domain" if "domain" in fields
                 else fields[1] if len(fields) > 1 else fields[0])
    chosen, seen = [], set()
    for r in rows:
        k = str(r.get(key_field))
        if k in seen:
            continue
        seen.add(k)
        chosen.append(r)
        if len(chosen) == MAX_ROWS:
            break
    return chosen or rows[:MAX_ROWS]


def sample_rows(task_name):
    tasks = {t["name"]: t for t in get("/actor-tasks", limit=1000)["data"]["items"]}
    task = tasks.get(task_name)
    if not task:
        return None, None
    runs = get(f"/actor-tasks/{task['id']}/runs", desc=1, limit=5, status="SUCCEEDED")["data"]["items"]
    for run in runs:
        items = get(f"/datasets/{run['defaultDatasetId']}/items", clean=1, limit=20)
        items = items if isinstance(items, list) else items.get("data", [])
        if items:
            return items, run.get("finishedAt") or run.get("startedAt")
    return None, None


def render(slug, meta, tasks):
    actor = json.loads((ROOT / "actors" / slug / ".actor" / "actor.json").read_text())
    view = next(iter(actor["storages"]["dataset"]["views"].values()))
    labels = (view.get("display") or {}).get("properties") or {}
    fields = HERO_FIELDS.get(slug) or view["transformation"]["fields"][:MAX_COLS]
    items, when = sample_rows(tasks[0]["name"]) if tasks else (None, None)
    lines = [START, "", f"**{meta['listing']['description']}**", ""]
    if items:
        rows = pick_rows(slug, items, fields)
        lines.append("| " + " | ".join((labels.get(f) or {}).get("label") or ACRONYMS.get(f) or f.replace("_", " ").capitalize() for f in fields) + " |")
        lines.append("|" + "---|" * len(fields))
        for r in rows:
            lines.append("| " + " | ".join(cell(r.get(f)) for f in fields) + " |")
        day = datetime.fromisoformat(when.replace("Z", "+00:00")).strftime("%B %d, %Y").replace(" 0", " ")
        lines += ["", f"*Real output from the “{tasks[0]['title']}” example, run on {day}.*"]
    links = " · ".join(f"[{t['title']}](https://apify.com/factpipe/{slug}/examples/{t['name']})" for t in tasks)
    if links:
        lines += ["", f"**Try a ready-made example:** {links}"]
    lines += ["", END]
    return "\n".join(lines)


def main():
    registry = json.loads((ROOT / "registry.json").read_text())["actors"]
    all_tasks = json.loads((ROOT / "tasks.json").read_text())["tasks"]
    only = sys.argv[1:]
    for slug, meta in registry.items():
        if meta.get("status") != "live" or (only and slug not in only):
            continue
        path = ROOT / "actors" / slug / "README.md"
        text = path.read_text()
        block = render(slug, meta, [t for t in all_tasks if t["actor"] == slug])
        if START in text:
            text = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, text, count=1, flags=re.S)
        else:
            h1_end = text.index("\n", text.index("# ")) + 1
            text = text[:h1_end] + "\n" + block + "\n" + text[h1_end:]
        path.write_text(text)
        print(f"{slug}: {'table' if '|---' in block else 'no sample'}")


if __name__ == "__main__":
    main()
