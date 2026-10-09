#!/usr/bin/env python3
"""Tests for publish_release.py against an in-memory fake of the GitHub release API.

Invariant checked after every API call: manifest.json is either missing only inside the swap step
(delete -> rename), or every file it points to exists. Run: python3 test_publish_release.py
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import publish_release as pr  # noqa: E402


class FakeGitHub:
    def __init__(self, assets=None, fail_upload_after=None):
        self.assets_by_id, self.next_id, self.calls = {}, 1, []
        self.gap_open, self.max_gap_calls, self.gap_calls = False, 0, 0
        self.uploads, self.fail_upload_after = 0, fail_upload_after
        for name, data in (assets or {}).items():
            self._add(name, data)

    def _add(self, name, data):
        assert name not in self.names(), f"duplicate asset {name}"
        aid, self.next_id = self.next_id, self.next_id + 1
        self.assets_by_id[aid] = {"id": aid, "name": name, "data": data, "browser_download_url": name}
        return self.assets_by_id[aid]

    def names(self):
        return {a["name"] for a in self.assets_by_id.values()}

    def by_name(self, name):
        return next((a for a in self.assets_by_id.values() if a["name"] == name), None)

    def _check(self, op):
        self.calls.append(op)
        m = self.by_name("manifest.json")
        if m is None:
            assert self.gap_open or not self.calls_had_manifest, f"manifest missing outside the swap after {op}"
            self.gap_calls += 1
            return
        self.calls_had_manifest = True
        missing = pr.files_of(json.loads(m["data"])) - self.names()
        assert not missing, f"live manifest points at missing files {sorted(missing)[:3]} after {op}"

    calls_had_manifest = False

    # API surface used by publish()
    def release(self):
        return {"id": 1}

    def assets(self, rel_id):
        return [dict(a) for a in self.assets_by_id.values()]

    def upload(self, rel_id, name, payload, ctype):
        self.uploads += 1
        if self.fail_upload_after is not None and self.uploads > self.fail_upload_after:
            raise RuntimeError("upload failed")
        a = self._add(name, payload)
        self._check(f"upload {name}")
        return {"id": a["id"]}

    def delete(self, asset_id):
        name = self.assets_by_id[asset_id]["name"]
        if name == "manifest.json":
            self.gap_open = True
        del self.assets_by_id[asset_id]
        self._check(f"delete {name}")

    def rename(self, asset_id, name):
        assert name not in self.names()
        self.assets_by_id[asset_id]["name"] = name
        self.assets_by_id[asset_id]["browser_download_url"] = name  # GitHub's URL follows the name
        self.gap_open = False
        self._check(f"rename -> {name}")

    def download(self, asset):
        return self.by_name(asset["browser_download_url"])["data"]


def build_dir(built_at, shards=3):
    d = tempfile.mkdtemp()
    m = {"format": 2, "built_at": built_at, "jobs": 10, "directory": "directory.json.gz",
         "shards": [{"file": f"shards/s{i}.jsonl.br"} for i in range(shards)]}
    os.makedirs(os.path.join(d, "shards"))
    for i in range(shards):
        open(os.path.join(d, f"shards/s{i}.jsonl.br"), "wb").write(f"{built_at}-{i}".encode())
    open(os.path.join(d, "directory.json.gz"), "wb").write(b"dir")
    json.dump(m, open(os.path.join(d, "manifest.json"), "w"))
    return d


def legacy_release(shards=3):
    """The release as the old publisher left it: unstamped names."""
    m = {"format": 2, "built_at": "2026-10-08T03:18:07.165Z", "directory": "directory.json.gz",
         "shards": [{"file": f"shard-{i}.jsonl.br"} for i in range(shards)]}
    assets = {"manifest.json": json.dumps(m).encode(), "directory.json.gz": b"d"}
    assets.update({f"shard-{i}.jsonl.br": b"x" for i in range(shards)})
    return assets


class PublishTest(unittest.TestCase):
    def live(self, gh):
        return json.loads(gh.by_name("manifest.json")["data"])

    def test_build_id(self):
        self.assertEqual(pr.build_id({"built_at": "2026-10-09T03:18:07.165Z"}), "b20261009T031807")

    def test_first_publish_over_legacy_keeps_legacy_files_for_one_cycle(self):
        gh = FakeGitHub(legacy_release())
        bid = pr.publish(gh, build_dir("2026-10-09T03:18:07.165Z"), log=lambda *_: None)
        live = self.live(gh)
        self.assertEqual(live["directory"], f"{bid}-directory.json.gz")
        self.assertTrue(all(s["file"].startswith(bid + "-") for s in live["shards"]))
        self.assertIn("shard-0.jsonl.br", gh.names())  # previous build kept for in-flight runs
        self.assertNotIn(f"{bid}-manifest.json", gh.names())
        self.assertEqual(gh.gap_calls, 1)  # only the delete -> rename step

    def test_third_build_removes_the_oldest(self):
        gh = FakeGitHub(legacy_release())
        b1 = pr.publish(gh, build_dir("2026-10-09T03:18:07.165Z"), log=lambda *_: None)
        b2 = pr.publish(gh, build_dir("2026-10-10T03:18:07.165Z", shards=2), log=lambda *_: None)
        names = gh.names()
        self.assertFalse(any(n.startswith("shard-") for n in names))  # legacy gone
        self.assertIn(f"{b1}-shard-2.jsonl.br", names)  # previous build kept
        self.assertTrue(all(s["file"].startswith(b2) for s in self.live(gh)["shards"]))
        self.assertEqual(len(names), 1 + (1 + 3) + (1 + 2))

    def test_rerun_of_same_build_replaces_its_files(self):
        gh = FakeGitHub(legacy_release())
        d = build_dir("2026-10-09T03:18:07.165Z")
        pr.publish(gh, d, log=lambda *_: None)
        pr.publish(gh, d, log=lambda *_: None)
        self.assertEqual(len(self.live(gh)["shards"]), 3)

    def test_failed_upload_leaves_old_index_live_and_complete(self):
        gh = FakeGitHub(legacy_release(), fail_upload_after=2)
        with self.assertRaises(RuntimeError):
            pr.publish(gh, build_dir("2026-10-09T03:18:07.165Z"), log=lambda *_: None)
        self.assertEqual(self.live(gh)["shards"][0]["file"], "shard-0.jsonl.br")

    def test_unreadable_previous_manifest_skips_cleanup(self):
        assets = legacy_release()
        assets["manifest.json"] = b"{not json"
        gh = FakeGitHub(assets)
        gh.calls_had_manifest = False
        gh._check = lambda op: None  # the broken manifest itself can't be validated
        pr.publish(gh, build_dir("2026-10-09T03:18:07.165Z"), log=lambda *_: None)
        self.assertIn("shard-0.jsonl.br", gh.names())

    def test_empty_release(self):
        gh = FakeGitHub({})
        pr.publish(gh, build_dir("2026-10-09T03:18:07.165Z"), log=lambda *_: None)
        self.assertEqual(len(self.live(gh)["shards"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=1)
