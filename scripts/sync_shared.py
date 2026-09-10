#!/usr/bin/env python3
"""Copy shared/js/*.js into every actor's src/lib/.

Apify builds each actor from its own directory, so shared code must be
vendored in. shared/js/ is the single source of truth; run this after any
change there and commit the result. CI fails if a lib file drifts.
"""
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared" / "js"
ACTORS = ROOT / "actors"


def main(check_only: bool = False) -> int:
    drift = []
    for actor in sorted(p for p in ACTORS.iterdir() if p.is_dir()):
        lib = actor / "src" / "lib"
        lib.mkdir(parents=True, exist_ok=True)
        for src in sorted(SHARED.glob("*.js")):
            dst = lib / src.name
            if dst.exists() and filecmp.cmp(src, dst, shallow=False):
                continue
            if check_only:
                drift.append(str(dst.relative_to(ROOT)))
            else:
                shutil.copy2(src, dst)
                print(f"synced {dst.relative_to(ROOT)}")
    if check_only and drift:
        print("DRIFT (run scripts/sync_shared.py):\n  " + "\n  ".join(drift))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(check_only="--check" in sys.argv))
