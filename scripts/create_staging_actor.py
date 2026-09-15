#!/usr/bin/env python3
"""Create a private Apify Actor for a registry entry (status staging) that builds from the GitHub monorepo.

Idempotent: if the Actor name already exists on the account, it reuses it. Writes the Actor id to
registry.json and state/actor_ids.json, applies the registry listing (title, description, SEO, categories),
then starts a build. PPE pricing and publishing stay Console-only.
Usage: create_staging_actor.py <slug> [<slug> ...]
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from apify_api import get, post, put

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/Neob001/data-portfolio.git"


def main():
    reg_path = ROOT / "registry.json"
    ids_path = ROOT / "state" / "actor_ids.json"
    registry = json.loads(reg_path.read_text())
    ids = json.loads(ids_path.read_text())
    mine = {a["name"]: a["id"] for a in get("/acts", my=1, limit=1000)["data"]["items"]}
    for slug in sys.argv[1:]:
        meta = registry["actors"][slug]
        listing = meta["listing"]
        aid = mine.get(slug)
        if not aid:
            aid = post("/acts", {
                "name": slug,
                "isPublic": False,
                "versions": [{"versionNumber": "0.1", "sourceType": "GIT_REPO", "buildTag": "latest",
                              "gitRepoUrl": f"{REPO}#main:actors/{slug}", "envVars": []}],
                "defaultRunOptions": {"build": "latest", "timeoutSecs": 300, "memoryMbytes": 1024},
            })["data"]["id"]
        put(f"/acts/{aid}", {k: listing[k] for k in ("title", "description", "seoTitle", "seoDescription", "categories") if k in listing})
        build = post(f"/acts/{aid}/builds?version=0.1&tag=latest", {})["data"]["id"]
        meta["apify_actor_id"] = aid
        meta.setdefault("staging_started_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        ids[slug] = aid
        print(f"{slug}: actor {aid}, build {build} started")
    reg_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n")
    ids_path.write_text(json.dumps(ids, indent=2) + "\n")


if __name__ == "__main__":
    main()
