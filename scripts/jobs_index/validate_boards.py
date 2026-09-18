#!/usr/bin/env python3
"""Validate discovered ATS board tokens against the official public job-board APIs.

Zero-token, stdlib only. Reads candidates.json (from discover_boards.py) and optionally the
existing boards.json (re-checks known boards too), calls each ATS API once per board with polite
per-host concurrency (<= 8; Lever paced to one request start per second, its robots.txt Crawl-delay), retries with
backoff, and keeps boards with >= 1 open job.

Resumable: each result is appended to state/validate.jsonl; re-runs skip boards checked within
--max-age-hours. Output: boards.json (sorted, minimal fields):
  [{"ats": "greenhouse", "token": "gitlab", "name": "GitLab", "jobs": 216, "checked": "2026-09-19"}, ...]
  Lever EU boards additionally carry "region": "eu".

Usage:
  python3 validate_boards.py                      # all candidates + known boards
  python3 validate_boards.py --ats ashby --limit 200
"""
from __future__ import annotations

import argparse
import html
import http.client
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = os.path.join(HERE, 'candidates.json')
BOARDS = os.path.join(HERE, 'boards.json')
CHECKPOINT = os.path.join(HERE, 'state', 'validate.jsonl')
UA = 'factpipe-jobs-index/1.0 (+https://apify.com/factpipe; job-board syndication)'

# Per-ATS: worker count and minimum seconds between requests on that host.
POLICY = {
    'greenhouse': (8, 0.0),
    'lever': (8, 1.0),       # api.lever.co robots.txt Crawl-delay: 1 -> one request start per second (responses are slow, so several in flight)
    'ashby': (6, 0.0),
    'workable': (1, 3.0),    # ~3,650 requests at 1-2 req/s earned a 429 with Retry-After ~23h
    'recruitee': (8, 0.0),
}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


class Pacer:
    def __init__(self, interval):
        self.interval, self.lock, self.next, self.blocked = interval, threading.Lock(), 0.0, False

    def wait(self):
        if self.interval <= 0:
            return
        with self.lock:
            now = time.time()
            wait = max(0.0, self.next - now)
            self.next = max(now, self.next) + self.interval
        if wait:
            time.sleep(wait)


def get(url, pacer, retries=3, timeout=90, want_json=True):
    """-> (status, body) ; status 0 on network failure after retries."""
    delay = 2
    for attempt in range(retries + 1):
        pacer.wait()
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json' if want_json else 'text/html'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, (json.loads(body) if want_json else body.decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            ra = e.headers.get('Retry-After') if e.headers else None
            if e.code == 429 and ra and ra.isdigit() and int(ra) > 300:
                pacer.blocked = True  # long block: stop calling this host (circuit breaker)
                return 429, None
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(min(60, int(ra)) if ra and ra.isdigit() else delay)
                delay *= 2
                continue
            return e.code, None
        except (ValueError, json.JSONDecodeError):
            return -1, None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException):
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            return 0, None
    return 0, None


def api_url(ats, token, region=None):
    t = urllib.parse.quote(token, safe='')
    return {
        'greenhouse': f'https://boards-api.greenhouse.io/v1/boards/{t}/jobs',
        'lever': f'https://api{".eu" if region == "eu" else ""}.lever.co/v0/postings/{t}?mode=json',
        'ashby': f'https://api.ashbyhq.com/posting-api/job-board/{t}',
        'workable': f'https://apply.workable.com/api/v1/widget/accounts/{t}',
        'recruitee': f'https://{t}.recruitee.com/api/offers/',
    }[ats]


def page_url(ats, token, region=None):
    t = urllib.parse.quote(token, safe='')
    return {'lever': f'https://jobs{".eu" if region == "eu" else ""}.lever.co/{t}', 'ashby': f'https://jobs.ashbyhq.com/{t}'}.get(ats)


def title_name(ats, page):
    m = re.search(r'<title[^>]*>([^<]{1,200})</title>', page or '', re.I)
    if not m:
        return None
    t = re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip()
    if ats == 'ashby':
        t = re.sub(r'\s+(jobs|careers)$', '', t, flags=re.I)
    return None if re.fullmatch(r'(?i)jobs|careers|ashby|lever|job board|404|not found|', t) else t


def count_and_name(ats, body):
    if ats == 'greenhouse':
        jobs = body.get('jobs') if isinstance(body, dict) else None
        name = next((j.get('company_name') for j in jobs or [] if j.get('company_name')), None)
    elif ats == 'lever':
        jobs, name = (body if isinstance(body, list) else None), None
    elif ats == 'ashby':
        jobs = [j for j in (body.get('jobs') or []) if j.get('isListed', True)] if isinstance(body, dict) else None
        name = None
    elif ats == 'workable':
        jobs = body.get('jobs') if isinstance(body, dict) else None
        name = (body.get('name') or '').strip() or None if isinstance(body, dict) else None
    else:
        jobs = body.get('offers') if isinstance(body, dict) else None
        name = next((o.get('company_name') for o in jobs or [] if o.get('company_name')), None)
    return (len(jobs) if isinstance(jobs, list) else None), name


def check(ats, token, region, pacers):
    status, body = get(api_url(ats, token, region), pacers[ats], timeout=120 if ats == 'lever' else 60)
    rec = {'ats': ats, 'token': token, 'status': status, 'checked': time.strftime('%Y-%m-%d', time.gmtime()), 'ts': time.time()}
    if region:
        rec['region'] = region
    if status != 200:
        return rec
    n, name = count_and_name(ats, body)
    rec['jobs'] = n
    if n and not name and ats in ('lever', 'ashby'):
        st, page = get(page_url(ats, token, region), pacers[f'{ats}_page'], retries=1, timeout=30, want_json=False)
        name = title_name(ats, page) if st == 200 else None
    rec['name'] = name or token
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ats', default='')
    ap.add_argument('--limit', type=int, default=0, help='max boards per ATS (0 = all)')
    ap.add_argument('--max-age-hours', type=float, default=20, help='skip boards checked more recently than this')
    args = ap.parse_args()
    only = {a for a in args.ats.split(',') if a}
    os.makedirs(os.path.dirname(CHECKPOINT), exist_ok=True)

    todo = {}
    with open(CANDIDATES) as f:
        cands = json.load(f)
    for key, tokens in cands.items():
        ats, _, region = key.partition(':')
        for t in tokens:
            todo[(ats, t.lower(), region or None)] = t
    if os.path.exists(BOARDS):
        with open(BOARDS) as f:
            for b in json.load(f):
                todo.setdefault((b['ats'], b['token'].lower(), b.get('region')), b['token'])

    done = {}
    if os.path.exists(CHECKPOINT):
        with open(CHECKPOINT) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                done[(r['ats'], r['token'].lower(), r.get('region'))] = r
    fresh = time.time() - args.max_age_hours * 3600
    per_ats = {}
    for (ats, low, region), tok in sorted(todo.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or "")):
        if only and ats not in only:
            continue
        prev = done.get((ats, low, region))
        # Definitive answers (200 / 404 / 410) are reused while fresh; transient failures are retried.
        if prev and prev.get('ts', 0) >= fresh and prev.get('status') in (200, 404, 410):
            continue
        per_ats.setdefault(ats, []).append((tok, region))
    if args.limit:
        per_ats = {a: v[:args.limit] for a, v in per_ats.items()}
    log('to check:', {a: len(v) for a, v in per_ats.items()}, '| already fresh:', len(done))

    pacers = {}
    for ats, (_, interval) in POLICY.items():
        pacers[ats] = Pacer(interval)
        pacers[f'{ats}_page'] = Pacer(max(interval, 0.25))
    lock = threading.Lock()
    t0 = time.time()
    counter = {'n': 0, 'ok': 0}
    with open(CHECKPOINT, 'a') as ck:
        def run(ats, tok, region):
            if pacers[ats].blocked:
                return  # host asked us to back off for a long time; leave the rest for the next run
            try:
                rec = check(ats, tok, region, pacers)
            except Exception as e:  # noqa: BLE001 - one bad board never stops the sweep
                rec = {'ats': ats, 'token': tok, 'status': -2, 'error': str(e)[:200], 'ts': time.time()}
            with lock:
                ck.write(json.dumps(rec) + '\n')
                ck.flush()
                done[(ats, tok.lower(), region)] = rec
                counter['n'] += 1
                counter['ok'] += 1 if rec.get('jobs') else 0
                if counter['n'] % 250 == 0:
                    log(f"  {counter['n']} checked, {counter['ok']} with jobs, {time.time() - t0:.0f}s")

        pools = []
        for ats, items in per_ats.items():
            pool = ThreadPoolExecutor(max_workers=POLICY[ats][0])
            for tok, region in items:
                pool.submit(run, ats, tok, region)
            pools.append(pool)
        for pool in pools:
            pool.shutdown(wait=True)
    for ats in per_ats:
        if pacers[ats].blocked:
            log(f'{ats}: rate-limited with a long Retry-After; remaining boards left for the next run')

    boards = []
    for (ats, low, region), r in done.items():
        if r.get('status') == 200 and r.get('jobs'):
            b = {'ats': ats, 'token': r['token'], 'name': r.get('name') or r['token'], 'jobs': r['jobs'], 'checked': r['checked']}
            if region:
                b['region'] = region
            boards.append(b)
    boards.sort(key=lambda b: (b['ats'], b.get('region') or '', b['token'].lower()))
    with open(BOARDS, 'w') as f:
        f.write('[\n' + ',\n'.join(json.dumps(b, ensure_ascii=False, separators=(',', ':')) for b in boards) + '\n]\n')
    summary = {}
    for b in boards:
        s = summary.setdefault(b['ats'], {'boards': 0, 'jobs': 0})
        s['boards'] += 1
        s['jobs'] += b['jobs']
    log('boards.json:', len(boards), 'boards', summary, f'({time.time() - t0:.0f}s)')


if __name__ == '__main__':
    main()
