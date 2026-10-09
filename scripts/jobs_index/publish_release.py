#!/usr/bin/env python3
"""Publish a built jobs index to the `jobs-index` GitHub release without a gap for running Actors.

The old publisher deleted every asset first and uploaded the new ones afterwards, so for the whole
upload (~50 MB) manifest.json and the shards were missing and Actor runs failed with 404s. Now:

  1. upload the new build under build-stamped names (<build>-shard-<n>.jsonl.br, <build>-directory.json.gz)
     next to the old assets;
  2. upload the new manifest as <build>-manifest.json, delete manifest.json, rename the new one to
     manifest.json (the only gap is between those two API calls);
  3. delete assets that belong to neither the new build nor the previous one, so runs that read
     the previous manifest a moment ago can still fetch its shards for a whole day.

If anything fails before step 2, the old manifest and its files stay untouched.
Stdlib only. Usage: GITHUB_TOKEN=... publish_release.py OWNER/REPO INDEX_DIR
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
TAG = "jobs-index"


def build_id(manifest):
    """2026-10-09T03:18:07.165Z -> b20261009T031807"""
    return "b" + re.sub(r"[^0-9T]", "", manifest["built_at"])[:15]


def stamped_manifest(manifest, bid):
    """Copy of the local manifest whose directory/shard names point at the build-stamped assets,
    plus (asset_name, local_rel_path, content_type) for every file to upload."""
    m = json.loads(json.dumps(manifest))
    files = [(f"{bid}-directory.json.gz", manifest.get("directory") or "directory.json.gz", "application/gzip")]
    m["directory"] = files[0][0]
    for i, s in enumerate(m["shards"]):
        ext = s["file"].rsplit(".", 1)[-1]
        name = f"{bid}-shard-{i}.jsonl.{ext}"
        files.append((name, s["file"], "application/gzip" if ext == "gz" else "application/octet-stream"))
        s["file"] = name
    return m, files


def files_of(manifest):
    """Asset names a published manifest refers to."""
    if not manifest:
        return set()
    return {manifest.get("directory") or "directory.json.gz"} | {s["file"] for s in manifest.get("shards", [])}


def stale_assets(asset_names, new_manifest, previous_manifest):
    """Assets safe to delete: not the live manifest and not used by the new or the previous build."""
    keep = {"manifest.json"} | files_of(new_manifest) | files_of(previous_manifest)
    return sorted(n for n in asset_names if n not in keep)


class GitHub:
    def __init__(self, repo, token):
        self.repo, self.token = repo, token

    def call(self, method, url, body=None, ctype="application/json"):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "Content-Type": ctype})
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read()
        return json.loads(raw) if raw else None

    def release(self):
        try:
            return self.call("GET", f"{API}/repos/{self.repo}/releases/tags/{TAG}")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            return self.call("POST", f"{API}/repos/{self.repo}/releases", {
                "tag_name": TAG, "name": "jobs-index (rebuilt daily)", "prerelease": True,
                "body": "Slim jobs search index for actors/ats-jobs-feed. Replaced daily."})

    def assets(self, rel_id):
        out, page = [], 1
        while True:
            batch = self.call("GET", f"{API}/repos/{self.repo}/releases/{rel_id}/assets?per_page=100&page={page}")
            out += batch
            if len(batch) < 100:
                return out
            page += 1

    def upload(self, rel_id, name, payload, ctype):
        url = f"https://uploads.github.com/repos/{self.repo}/releases/{rel_id}/assets?name={name}"
        return self.call("POST", url, payload, ctype)

    def delete(self, asset_id):
        self.call("DELETE", f"{API}/repos/{self.repo}/releases/assets/{asset_id}")

    def rename(self, asset_id, name):
        self.call("PATCH", f"{API}/repos/{self.repo}/releases/assets/{asset_id}", {"name": name})

    def download(self, asset):
        req = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "factpipe-publisher"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()


def publish(gh, index_dir, log=print):
    local = json.load(open(os.path.join(index_dir, "manifest.json")))
    bid = build_id(local)
    manifest, files = stamped_manifest(local, bid)
    rel_id = gh.release()["id"]
    existing = {a["name"]: a for a in gh.assets(rel_id)}

    previous, previous_ok = None, True
    if "manifest.json" in existing:
        try:
            previous = json.loads(gh.download(existing["manifest.json"]))
        except Exception as e:  # can't tell which files running Actors still need: skip cleanup
            previous_ok = False
            log(f"previous manifest unreadable ({e}); old files kept, cleanup skipped")

    # 1. new build next to the old one. Asset uploads are all-or-nothing, so a file this build
    #    already uploaded (a rerun) is complete and may be live: keep it.
    for name, rel, ctype in files:
        if name in existing:
            continue
        with open(os.path.join(index_dir, rel), "rb") as f:
            gh.upload(rel_id, name, f.read(), ctype)
        log(f"uploaded {name}")

    # 2. manifest swap: upload under a temporary name, then replace manifest.json
    tmp = f"{bid}-manifest.json"
    if tmp in existing:
        gh.delete(existing[tmp]["id"])
    new = gh.upload(rel_id, tmp, json.dumps(manifest, separators=(",", ":")).encode(), "application/json")
    if "manifest.json" in existing:
        gh.delete(existing["manifest.json"]["id"])
    gh.rename(new["id"], "manifest.json")
    log(f"manifest.json -> build {bid} ({len(manifest['shards'])} shards, {manifest.get('jobs')} jobs)")

    # 3. drop builds older than the previous one
    if not previous_ok:
        return bid
    current = {a["name"]: a for a in gh.assets(rel_id)}
    for name in stale_assets(current, manifest, previous):
        gh.delete(current[name]["id"])
        log(f"deleted stale {name}")
    return bid


def main():
    repo, index_dir = sys.argv[1], sys.argv[2]
    publish(GitHub(repo, os.environ["GITHUB_TOKEN"]), index_dir)
    print(f"INDEX_BASE_URL=https://github.com/{repo}/releases/download/{TAG}")


if __name__ == "__main__":
    main()
