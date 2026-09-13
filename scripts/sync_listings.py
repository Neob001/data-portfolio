#!/usr/bin/env python3
"""Zero-token Store listing sync. Source of truth: registry.json -> actors.<slug>.listing
({title, description, seoTitle, seoDescription, categories}).

Pushes each listing to Apify via PUT /v2/acts/{id} and mirrors title/description/
categories into actors/<slug>/.actor/actor.json so builds never drift. Never touches
name (Store URL), pricing, or isPublic. Usage: sync_listings.py [--dry-run] [slug ...]
"""
import json
import sys
import time
import urllib.error
from pathlib import Path

from apify_api import get, put

ROOT = Path(__file__).resolve().parent.parent
LIMITS = {"title": 60, "seoTitle": 60, "seoDescription": 160, "description": 220}


def retry(fn, *args):
    for attempt in range(5):
        try:
            return fn(*args)
        except urllib.error.HTTPError:
            raise
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))


def main() -> int:
    dry = "--dry-run" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    registry = json.loads((ROOT / "registry.json").read_text())
    errors = 0
    for slug, meta in registry["actors"].items():
        listing = meta.get("listing")
        if not listing or (only and slug not in only):
            continue
        too_long = {k: len(listing[k]) for k, n in LIMITS.items() if len(listing.get(k, "")) > n}
        if too_long:
            print(f"{slug}: SKIP, over length limits {too_long}")
            errors += 1
            continue

        aj_path = ROOT / "actors" / slug / ".actor" / "actor.json"
        aj = json.loads(aj_path.read_text())
        aj.update({k: listing[k] for k in ("title", "description", "categories")})
        if dry:
            print(f"{slug}: would PUT {json.dumps(listing)}")
            continue
        try:
            retry(put, f"/acts/{meta['apify_actor_id']}", listing)
        except urllib.error.HTTPError as e:
            print(f"{slug}: PUT failed {e.code} {e.read().decode()[:300]}")
            errors += 1
            continue
        aj_path.write_text(json.dumps(aj, indent=2) + "\n")
        live = retry(get, f"/acts/{meta['apify_actor_id']}")["data"]
        ok = live.get("title") == listing["title"] and live.get("description") == listing["description"]
        print(f"{slug}: {'OK' if ok else 'MISMATCH'} title={live.get('title')!r} categories={live.get('categories')}")
        errors += 0 if ok else 1
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
