#!/bin/zsh
# Read every Workday career site on the owner's Mac and hand the result to the nightly cloud build.
#
# Why: since 2026-11-16 Workday answers robots.txt with HTTP 429 to cloud IPs (GitHub runners, Apify) while the same
# request from the owner's Mac gets 200, so the cloud build lost ~4,000 Workday sites (~350k jobs). This script runs the
# SAME build_index.mjs code (robots.txt rule R1 per host, same pacing and 429 backoff, newest 500 jobs per site) with
# --ats workday --emit-boards, and force-pushes the file to the data-only branch `workday-data`. The nightly workflow
# reads that branch and adds those boards with --boards-from (file must be complete, <= 36 h old, >= 500 boards;
# otherwise it fetches Workday itself, as before).
#
#   scripts/jobs_index/workday_local.sh            # full run (~1.5-2.5 h), then push
#   scripts/jobs_index/workday_local.sh --no-push  # run only (tests)
#   WORKDAY_LIMIT=30 scripts/jobs_index/workday_local.sh --no-push   # small smoke run
#
# Zero-token. Needs node >= 22, git, the deploy key ~/.ssh/data_portfolio_deploy. Never touches the repo's working tree:
# the code comes from a detached worktree of origin/main, the data commit is made in a separate bare repo.
# Last line of output: "WORKDAY_LOCAL OK <boards> boards / <jobs> jobs ..." or "WORKDAY_LOCAL FAIL <reason>".
set -u
setopt pipefail
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy

REPO=${0:A:h:h:h}
WORK=${WORKDAY_LOCAL_DIR:-$HOME/Library/Caches/factpipe-workday}
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/data_portfolio_deploy -o BatchMode=yes"
PUSH=1; [[ "${1:-}" == "--no-push" ]] && PUSH=0
MIN_BOARDS=${WORKDAY_MIN_BOARDS:-500}
fail() { print -r -- "WORKDAY_LOCAL FAIL $*"; exit 1; }

mkdir -p "$WORK" || fail "cannot create $WORK"
# One run at a time.
if ! mkdir "$WORK/lock" 2>/dev/null; then
  if [[ -n "$(find "$WORK/lock" -maxdepth 0 -mmin +360 2>/dev/null)" ]]; then rm -rf "$WORK/lock"; mkdir "$WORK/lock"; else fail "another run is in progress ($WORK/lock)"; fi
fi
trap 'rm -rf "$WORK/lock"' EXIT

# 1. Code + board list = origin/main (WORKDAY_LOCAL_REF to test a branch), in a detached worktree (the main checkout is left alone).
REF=${WORKDAY_LOCAL_REF:-origin/main}
git -C "$REPO" fetch -q origin main || fail "git fetch origin main"
if [[ ! -d "$WORK/src/.git" && ! -f "$WORK/src/.git" ]]; then
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add -q --detach "$WORK/src" "$REF" || fail "git worktree add $REF"
else
  git -C "$WORK/src" checkout -q --detach --force "$REF" || fail "git checkout $REF in worktree"
fi
SRC_SHA=$(git -C "$WORK/src" rev-parse --short HEAD)

# 2. Read Workday (same flags as the cloud build, longer queue budget: nothing else runs in parallel here).
OUT="$WORK/workday_boards.jsonl.gz"
rm -rf "$WORK/index" "$OUT.tmp"
LIMIT_ARGS=()
[[ -n "${WORKDAY_LIMIT:-}" ]] && LIMIT_ARGS=(--limit "$WORKDAY_LIMIT")
T0=$SECONDS
node --max-old-space-size=4096 "$WORK/src/scripts/jobs_index/build_index.mjs" --ats workday \
  --boards "$WORK/src/scripts/jobs_index/boards.json" "${LIMIT_ARGS[@]}" \
  --workday-max-jobs 500 --workday-site-budget-s 90 --workday-budget-min "${WORKDAY_BUDGET_MIN:-150}" \
  --codec gz --no-tech --out "$WORK/index" --emit-boards "$OUT.tmp" > /dev/null 2> "$WORK/last_run.log" \
  || fail "build_index.mjs exited $? (see $WORK/last_run.log)"
MINS=$(( (SECONDS - T0) / 60 ))

# 3. Sanity: complete file with enough boards.
END=$(gunzip -c "$OUT.tmp" | tail -1)
[[ "$END" == *'"_end":true'* ]] || fail "emitted file has no _end line"
read BOARDS JOBS RL <<< "$(print -r -- "$END" | python3 -c 'import json,sys; e=json.load(sys.stdin); w=e["by_ats"].get("workday",{}); print(e["boards"], e["jobs"], w.get("rate_limited",0))')"
MIN_REQ=$MIN_BOARDS; [[ -n "${WORKDAY_LIMIT:-}" ]] && MIN_REQ=1
(( BOARDS >= MIN_REQ )) || fail "only $BOARDS boards read (< $MIN_REQ); not pushed (rate-limited: $RL)"
# Shrink guard: a run that reads far fewer boards than the last pushed one (Workday's weekly maintenance, Friday
# ~23:00-03:00 Pacific, answers ERR_TENANT_OUTAGE / an HTML page for robots.txt, which rule R1 skips) must not replace
# a still-usable file. Only while that file is < 36 h old (the build ignores older ones anyway, so then push).
LAST="$WORK/last_pushed"   # "<boards> <epoch seconds>" of the last push
SHRINK_PCT=${WORKDAY_SHRINK_PCT:-60}
if (( PUSH )) && [[ -z "${WORKDAY_LIMIT:-}" && -z "${WORKDAY_FORCE_PUSH:-}" && -r "$LAST" ]]; then
  read LAST_BOARDS LAST_TS < "$LAST"
  if (( ${LAST_BOARDS:-0} > 0 && $(date +%s) - ${LAST_TS:-0} < 36 * 3600 && BOARDS * 100 < LAST_BOARDS * SHRINK_PCT )); then
    fail "only $BOARDS boards read vs $LAST_BOARDS on the last push (< ${SHRINK_PCT}%; Workday maintenance or outage?); previous file kept, not pushed (WORKDAY_FORCE_PUSH=1 overrides)"
  fi
fi
mv -f "$OUT.tmp" "$OUT"
SIZE=$(( $(stat -f %z "$OUT") / 1024 / 1024 ))
SUMMARY="$BOARDS boards / $JOBS jobs, ${SIZE} MB, ${MINS} min, rate-limited $RL, code $SRC_SHA"

# 4. Push to the data-only branch (orphan, one commit, force) from a separate bare repo.
if (( PUSH )); then
  if [[ ! -d "$WORK/data.git" ]]; then
    git init -q --bare "$WORK/data.git" || fail "git init data.git"
    git -C "$WORK/data.git" remote add origin "$(git -C "$REPO" remote get-url origin)" || fail "remote add"
  fi
  D=(git -C "$WORK/data.git" -c user.name="factpipe workday-local" -c user.email="noreply@factpipe.invalid")
  BLOB=$("${D[@]}" hash-object -w "$OUT") || fail "hash-object"
  TREE=$(printf '100644 blob %s\tworkday_boards.jsonl.gz\n' "$BLOB" | "${D[@]}" mktree) || fail "mktree"
  COMMIT=$("${D[@]}" commit-tree "$TREE" -m "workday boards $(date -u +%Y-%m-%dT%H:%M:%SZ): $SUMMARY") || fail "commit-tree"
  "${D[@]}" push -q --force origin "${COMMIT}:refs/heads/workday-data" || fail "git push workday-data"
  print -r -- "$BOARDS $(date +%s)" > "$LAST"
  "${D[@]}" prune --expire=now >/dev/null 2>&1   # only this script writes to data.git
  print -r -- "WORKDAY_LOCAL OK $SUMMARY, pushed workday-data ${COMMIT:0:7}"
else
  print -r -- "WORKDAY_LOCAL OK $SUMMARY (not pushed)"
fi
