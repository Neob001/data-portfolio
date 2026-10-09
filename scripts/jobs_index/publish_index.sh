#!/usr/bin/env bash
# Publish a built jobs index (scripts/jobs_index/index/) so the Actor can read it at INDEX_BASE_URL
# (or the JOBS_INDEX_URL env var). Two interchangeable hosts, one function each. NOT run automatically.
#
#   source scripts/jobs_index/publish_index.sh
#   publish_github_release  OWNER/REPO          # needs $GITHUB_TOKEN (contents:write)
#   publish_apify_kvs       STORE_NAME_OR_ID    # needs $APIFY_TOKEN
#
# Files published (flat names, because release assets and KV records cannot contain "/"):
#   GitHub release: manifest.json, <build>-directory.json.gz, <build>-shard-<n>.jsonl.br
#   Apify KVS:      manifest.json, directory.json.gz, shard-<n>.jsonl.br
# The published manifest.json is rewritten so "directory" and every shard "file" use those names.
#
# INDEX_BASE_URL to configure afterwards:
#   (a) https://github.com/OWNER/REPO/releases/download/jobs-index
#   (b) https://api.apify.com/v2/key-value-stores/<STORE_ID>/records
#       (the store must be readable without a token: create it under the Actor owner's account and
#        share it publicly, or use Apify's public store URL)
set -euo pipefail

JOBS_INDEX_DIR="${JOBS_INDEX_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/index}"

_flat_manifest() {
  # manifest.json with shard paths rewritten to flat names -> stdout
  python3 - "$JOBS_INDEX_DIR/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for i, s in enumerate(m["shards"]):
    ext = s["file"].rsplit(".", 1)[-1]
    s["file"] = f"shard-{i}.jsonl.{ext}"
print(json.dumps(m, separators=(",", ":")))
PY
}

_each_file() {
  # "flat_name<TAB>local_path<TAB>content_type" per file to publish
  python3 - "$JOBS_INDEX_DIR" <<'PY'
import json, os, sys
d = sys.argv[1]
m = json.load(open(os.path.join(d, "manifest.json")))
print(f"directory.json.gz\t{d}/directory.json.gz\tapplication/gzip")
for i, s in enumerate(m["shards"]):
    ext = s["file"].rsplit(".", 1)[-1]
    ctype = "application/gzip" if ext == "gz" else "application/octet-stream"  # brotli: served as raw bytes
    print(f"shard-{i}.jsonl.{ext}\t{d}/{s['file']}\t{ctype}")
PY
}

# (a) GitHub release tagged "jobs-index": delete every old asset, then upload the new ones.
#     Manifest is uploaded LAST so readers never see a manifest pointing at missing shards
#     (there is still a short window with no manifest: the Actor then uses its live fallback).
publish_github_release() {
  # Gap-free publish (build-stamped asset names, manifest swapped last, previous build kept one
  # cycle for in-flight runs): see publish_release.py.
  python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/publish_release.py" "$1" "$JOBS_INDEX_DIR"
}

# (b) Apify key-value store: PUT one record per file. Records with the same key are overwritten,
#     so no delete is needed except for shards beyond the new count (removed below).
publish_apify_kvs() {
  local store="$1" api="https://api.apify.com/v2/key-value-stores"
  local auth=(-H "Authorization: Bearer ${APIFY_TOKEN:?set APIFY_TOKEN}")
  local n=0
  while IFS=$'\t' read -r name path ctype; do
    curl -fsS "${auth[@]}" -X PUT -H "Content-Type: $ctype" --data-binary @"$path" "$api/$store/records/$name" >/dev/null
    echo "uploaded $name"
    case "$name" in shard-*) n=$((n + 1));; esac
  done < <(_each_file)
  # remove stale shards from a previous, larger build
  for key in $(curl -fsS "${auth[@]}" "$api/$store/keys?limit=1000" | python3 -c 'import json,sys; print(" ".join(k["key"] for k in json.load(sys.stdin)["data"]["items"]))'); do
    case "$key" in shard-*)
      local i="${key#shard-}"; i="${i%%.*}"
      if [ "$i" -ge "$n" ]; then curl -fsS "${auth[@]}" -X DELETE "$api/$store/records/$key" >/dev/null; echo "deleted stale $key"; fi;;
    esac
  done
  _flat_manifest | curl -fsS "${auth[@]}" -X PUT -H "Content-Type: application/json" --data-binary @- "$api/$store/records/manifest.json" >/dev/null
  echo "INDEX_BASE_URL=https://api.apify.com/v2/key-value-stores/$store/records"
}
