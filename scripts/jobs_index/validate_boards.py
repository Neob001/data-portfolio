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
# Committed Workday candidates (career sites from discover_boards.py): unlike candidates.json this file
# is in git, so the nightly workflow validates them incrementally (--max-new per run).
WORKDAY_CANDIDATES = os.path.join(HERE, 'workday_candidates.json')
BOARDS = os.path.join(HERE, 'boards.json')
CHECKPOINT = os.path.join(HERE, 'state', 'validate.jsonl')
BANS = os.path.join(HERE, 'state', 'bans.json')  # {ats: unix time until which we must not call it}


def load_bans():
    try:
        with open(BANS) as f:
            return {k: v for k, v in json.load(f).items() if v > time.time()}
    except (OSError, ValueError):
        return {}


def save_ban(ats, seconds):
    bans = load_bans()
    bans[ats] = max(bans.get(ats, 0), time.time() + seconds)
    os.makedirs(os.path.dirname(BANS), exist_ok=True)
    with open(BANS, 'w') as f:
        json.dump(bans, f)
UA = 'factpipe-jobs-index/1.0 (+https://apify.com/factpipe; job-board syndication)'

# Per-ATS: worker count and minimum seconds between requests on that host.
POLICY = {
    'greenhouse': (8, 0.0),
    'lever': (8, 1.0),       # api.lever.co robots.txt Crawl-delay: 1 -> one request start per second (responses are slow, so several in flight)
    'ashby': (6, 0.0),
    'workable': (1, 3.0),    # ~3,650 requests at 1-2 req/s earned a 429 with Retry-After ~23h
    'recruitee': (8, 0.0),
    # Workday career sites (not a documented API): 4 hosts in parallel, one site at a time per host, one
    # request start per 250 ms across all Workday hosts, robots.txt checked per host before any call.
    'workday': (4, 0.25),
}
ROBOTS_AGENT = 'factpipe-jobs-index'


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


def get(url, pacer, retries=3, timeout=90, want_json=True, body=None, accept=None):
    """-> (status, body) ; status 0 on network failure after retries. body (dict) -> JSON POST."""
    delay = 2
    for attempt in range(retries + 1):
        pacer.wait()
        headers = {'User-Agent': UA, 'Accept': accept or ('application/json' if want_json else 'text/html'), 'Accept-Language': 'en-US'}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers, method='POST' if data else 'GET')
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, (json.loads(body) if want_json else body.decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            ra = e.headers.get('Retry-After') if e.headers else None
            if e.code == 429 and ra and ra.isdigit() and int(ra) > 300:
                pacer.blocked = int(ra)  # long block: stop calling this host (circuit breaker), remember it
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


def workday_parts(token):
    """'<tenant>.<wdN>/<site>' -> (tenant, wd, site, host)"""
    tw, _, site = token.partition('/')
    tenant, _, wd = tw.partition('.')
    return tenant.lower(), wd.lower(), site, f'{tenant.lower()}.{wd.lower()}.myworkdayjobs.com'


def api_url(ats, token, region=None):
    if ats == 'workday':
        tenant, _, site, host = workday_parts(token)
        return f'https://{host}/wday/cxs/{tenant}/{urllib.parse.quote(site, safe="")}/jobs'
    t = urllib.parse.quote(token, safe='')
    return {
        'greenhouse': f'https://boards-api.greenhouse.io/v1/boards/{t}/jobs',
        'lever': f'https://api{".eu" if region == "eu" else ""}.lever.co/v0/postings/{t}?mode=json',
        'ashby': f'https://api.ashbyhq.com/posting-api/job-board/{t}',
        'workable': f'https://apply.workable.com/api/v1/widget/accounts/{t}',
        'recruitee': f'https://{t}.recruitee.com/api/offers/',
    }[ats]


def page_url(ats, token, region=None):
    if ats == 'workday':
        _, _, site, host = workday_parts(token)
        return f'https://{host}/{urllib.parse.quote(site, safe="")}'
    t = urllib.parse.quote(token, safe='')
    return {'lever': f'https://jobs{".eu" if region == "eu" else ""}.lever.co/{t}', 'ashby': f'https://jobs.ashbyhq.com/{t}'}.get(ats)


def workday_name(page):  # noqa: C901
    """Company name from a Workday site's og:title ("Careers at X", "X Careers"); None otherwise.
    Same rules as workdayNameFromPage() in actors/ats-jobs-feed/src/core/feed.js."""
    m = (re.search(r'<meta[^>]*property="og:title"[^>]*content="([^"]{1,200})"', page or '', re.I)
         or re.search(r'<meta[^>]*content="([^"]{1,200})"[^>]*property="og:title"', page or '', re.I))
    if not m:
        return None
    t = re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip()
    n = (re.fullmatch(r'(?i)(?:careers?|jobs?|work|opportunities)\s+(?:at|with|@)\s+(.{2,80})', t)
         or re.fullmatch(r'(?i)(.{2,80}?)\s+(?:careers?|jobs?|career site|job opportunities)', t))
    name = re.sub(r'[!.]+$', '', n.group(1)).strip() if n else None
    name = re.sub(r'(?i)^(?:welcome to|join)\s+', '', name).strip() if name else None
    return None if not name or re.fullmatch(r'(?i)our|the|external|internal|search|find|all|global', name) else name


# ---------------------------------------------------------------- robots.txt (RFC 9309), Workday hosts
# Same semantics as actors/ats-jobs-feed/src/core/robots.js: our group or "*", longest match wins, a tie
# goes to Allow, 4xx = no robots.txt (all allowed), 5xx / unreachable = all disallowed.
def parse_robots(text):
    groups, cur, last_agent = [], None, False
    for raw in (text or '').splitlines():
        line = raw.split('#', 1)[0].strip()
        m = re.match(r'^([A-Za-z-]+)\s*:\s*(.*)$', line)
        if not m:
            continue
        key, value = m.group(1).lower(), m.group(2).strip()
        if key == 'user-agent':
            if not last_agent or cur is None:
                cur = {'agents': [], 'rules': []}
                groups.append(cur)
            cur['agents'].append(value.lower())
            last_agent = True
            continue
        last_agent = False
        if cur is None or key not in ('allow', 'disallow') or (key == 'disallow' and value == ''):
            continue
        cur['rules'].append((key == 'allow', value))
    return groups


def robots_rules(groups, agent=ROBOTS_AGENT):
    specific = [g for g in groups if any(a != '*' and a and agent.startswith(a) for a in g['agents'])]
    use = specific or [g for g in groups if '*' in g['agents']]
    return [r for g in use for r in g['rules']]


def _rule_rx(path):
    anchored = path.endswith('$')
    body = '.*'.join(re.escape(p) for p in (path[:-1] if anchored else path).split('*'))
    return re.compile('^' + body + ('$' if anchored else ''))


def robots_allowed(rules, path):
    best = None
    for allow, rule in rules:
        if not rule or not _rule_rx(rule).match(path):
            continue
        n = len(rule.replace('*', ''))
        if best is None or n > best[0] or (n == best[0] and allow and not best[1]):
            best = (n, allow)
    return True if best is None else best[1]


def workday_robots_verdict(status, text, token):
    """-> (allowed, reason) for a Workday site's CXS list/detail paths and its own pages."""
    if status == 0 or status >= 500:
        return False, 'robots.txt unreachable'
    if status >= 400:
        return True, f'robots.txt HTTP {status}'
    if re.match(r'\s*<', text or ''):
        return False, 'robots.txt answered with an HTML page'  # not a robots file: assume not allowed
    tenant, _, site, _ = workday_parts(token)
    rules = robots_rules(parse_robots(text))
    lower = [(a, r.lower()) for a, r in rules]
    for path in (f'/wday/cxs/{tenant}/{site}/jobs', f'/wday/cxs/{tenant}/{site}/job/', f'/{site}/'):
        if not robots_allowed(rules, path) or not robots_allowed(lower, path.lower()):
            return False, f'robots.txt disallows {path}'
    return True, 'robots.txt allows'


def workday_tenant_name(token):
    """Last-resort company name from the tenant: 'ibm' -> 'IBM', 'capitalone' -> 'Capitalone'
    (same as workdayTenantName() in actors/ats-jobs-feed/src/core/transform.js)."""
    t = workday_parts(token)[0]
    return t.upper() if len(t) <= 3 else t[:1].upper() + t[1:]


ROBOTS = {}  # host -> (status, text)
ROBOTS_LOCK = threading.Lock()


def host_robots(host, pacer):
    with ROBOTS_LOCK:
        if host in ROBOTS:
            return ROBOTS[host]
    # Accept text/plain: asked for text/html, Workday hosts answer /robots.txt with their HTML app page.
    status, text = get(f'https://{host}/robots.txt', pacer, retries=1, timeout=30, want_json=False, accept='text/plain, */*;q=0.1')
    with ROBOTS_LOCK:
        ROBOTS[host] = (status, text or '')
    return ROBOTS[host]


def title_name(ats, page):
    m = re.search(r'<title[^>]*>([^<]{1,200})</title>', page or '', re.I)
    if not m:
        return None
    t = re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip()
    if ats == 'ashby':
        t = re.sub(r'\s+(jobs|careers)$', '', t, flags=re.I)
    return None if re.fullmatch(r'(?i)jobs|careers|ashby|lever|job board|404|not found|', t) else t


def count_and_name(ats, body):
    if ats == 'workday':
        if not isinstance(body, dict) or not isinstance(body.get('jobPostings'), list):
            return None, None
        return (int(body.get('total') or 0) or len(body['jobPostings'])), None
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


def check(ats, token, region, pacers, prev=None):
    rec = {'ats': ats, 'token': token, 'checked': time.strftime('%Y-%m-%d', time.gmtime()), 'ts': time.time()}
    if ats == 'workday':
        # Before any call to a Workday site: its host's robots.txt must allow the CXS paths we read.
        r_status, r_text = host_robots(workday_parts(token)[3], pacers['workday'])
        allowed, reason = workday_robots_verdict(r_status, r_text, token)
        if not allowed:
            rec.update({'status': 'robots', 'reason': reason})
            return rec
        status, body = get(api_url(ats, token), pacers[ats], retries=2, timeout=45,
                           body={'appliedFacets': {}, 'limit': 20, 'offset': 0, 'searchText': ''})
    else:
        status, body = get(api_url(ats, token, region), pacers[ats], timeout=120 if ats == 'lever' else 60)
    rec['status'] = status
    if region:
        rec['region'] = region
    if status != 200:
        return rec
    n, name = count_and_name(ats, body)
    rec['jobs'] = n
    if n and ats == 'workday':
        name = (prev or {}).get('name') if (prev or {}).get('name_src') == 'page' else None
        if not name:
            st, page = get(page_url(ats, token), pacers['workday'], retries=1, timeout=30, want_json=False)
            name = workday_name(page) if st == 200 else None
            rec['name_src'] = 'page' if name else 'tenant'
        else:
            rec['name_src'] = 'page'
        rec['name'] = name or workday_tenant_name(token)
        return rec
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
    ap.add_argument('--max-new', type=int, default=0,
                    help='per ATS, check at most N never-checked candidates this run (0 = all); the rest wait for '
                         'the next run. Lets the nightly workflow work through workday_candidates.json incrementally.')
    args = ap.parse_args()
    only = {a for a in args.ats.split(',') if a}
    os.makedirs(os.path.dirname(CHECKPOINT), exist_ok=True)

    todo = {}
    cands = {}
    if os.path.exists(CANDIDATES):  # absent in CI: then only the known boards in boards.json are re-checked
        with open(CANDIDATES) as f:
            cands = json.load(f)
    sources = [cands]
    if os.path.exists(WORKDAY_CANDIDATES):  # committed, so CI sees it too
        with open(WORKDAY_CANDIDATES) as f:
            sources.append(json.load(f))
    for src in sources:
        for key, tokens in src.items():
            if key.startswith('_'):
                continue  # _comment
            ats, _, region = key.partition(':')
            for t in tokens:
                todo.setdefault((ats, t.lower(), region or None), t)
    known = {}
    if os.path.exists(BOARDS):
        with open(BOARDS) as f:
            for b in json.load(f):
                todo.setdefault((b['ats'], b['token'].lower(), b.get('region')), b['token'])
                known[(b['ats'], b['token'].lower(), b.get('region'))] = b

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
    bans = load_bans()
    for ats, until in bans.items():
        log(f'{ats}: skipped, rate-limit ban until {time.strftime("%Y-%m-%d %H:%M", time.gmtime(until))} UTC')
    per_ats = {}
    new_count = {}
    for (ats, low, region), tok in sorted(todo.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or "")):
        if (only and ats not in only) or ats in bans:
            continue
        prev = done.get((ats, low, region))
        # Definitive answers (200 / 404 / 410 / robots-disallowed; Workday also 403 "permission denied" = site not
        # public, 422 = wrong data center) are reused while fresh; transient failures are retried.
        final = (200, 404, 410, 'robots') + ((403, 422) if ats == 'workday' else ())
        if prev and prev.get('ts', 0) >= fresh and prev.get('status') in final:
            continue
        if prev is None and args.max_new:
            new_count[ats] = new_count.get(ats, 0) + 1
            if new_count[ats] > args.max_new:
                continue
        per_ats.setdefault(ats, []).append((tok, region))
    deferred = {a: n - args.max_new for a, n in new_count.items() if args.max_new and n > args.max_new}
    if deferred:
        log('never-checked candidates left for later runs (--max-new):', deferred)
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
                rec = check(ats, tok, region, pacers, done.get((ats, tok.lower(), region)))
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

        def run_host(ats, items):
            for tok, region in items:  # one site at a time per Workday host
                run(ats, tok, region)

        pools = []
        for ats, items in per_ats.items():
            pool = ThreadPoolExecutor(max_workers=POLICY[ats][0])
            if ats == 'workday':
                by_host = {}
                for tok, region in items:
                    by_host.setdefault(workday_parts(tok)[3], []).append((tok, region))
                for host_items in by_host.values():
                    pool.submit(run_host, ats, host_items)
            else:
                for tok, region in items:
                    pool.submit(run, ats, tok, region)
            pools.append(pool)
        for pool in pools:
            pool.shutdown(wait=True)
    for ats in per_ats:
        if pacers[ats].blocked:
            save_ban(ats, pacers[ats].blocked)
            log(f'{ats}: rate-limited (Retry-After {pacers[ats].blocked}s); ban recorded in state/bans.json, rest left for later')

    boards = []
    for (ats, low, region), r in done.items():
        if r.get('status') == 200 and r.get('jobs'):
            b = {'ats': ats, 'token': r['token'], 'name': r.get('name') or r['token'], 'jobs': r['jobs'], 'checked': r['checked']}
            if region:
                b['region'] = region
            boards.append(b)
    # Known boards with no check result here (another --ats, a banned ATS, no checkpoint) stay as they were.
    boards += [b for k, b in known.items() if k not in done]
    boards.sort(key=lambda b: (b['ats'], b.get('region') or '', b['token'].lower()))
    with open(BOARDS, 'w') as f:
        f.write('[\n' + ',\n'.join(json.dumps(b, ensure_ascii=False, separators=(',', ':')) for b in boards) + '\n]\n')
    summary = {}
    for b in boards:
        s = summary.setdefault(b['ats'], {'boards': 0, 'jobs': 0})
        s['boards'] += 1
        s['jobs'] += b['jobs']
    log('boards.json:', len(boards), 'boards', summary, f'({time.time() - t0:.0f}s)')
    blocked = {}
    for (ats, _, _), r in done.items():
        if r.get('status') == 'robots':
            blocked[ats] = blocked.get(ats, 0) + 1
    if blocked:
        log('skipped because robots.txt disallows the endpoint (never called):', blocked)


if __name__ == '__main__':
    main()
