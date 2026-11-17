// robots.txt gate, owner rule R1 (2026-10-23): request /robots.txt with `Accept: text/plain`; only a 2xx
// text/plain file counts and it must allow the path; 404/410 = no restrictions; anything else (other 4xx,
// 5xx, unreachable, HTML) = do not read the host. Checked once per host per night, before any data request.
// Amendment R1a (owner, 2026-11-17): when a publisher's own download link redirects to an Amazon S3 storage
// host, and that host answers /robots.txt with S3's 403 AccessDenied/NoSuchKey error (no robots.txt object;
// RFC 9309 treats 4xx as "unavailable" = no rules), the host counts as having no restrictions. Only for
// redirect targets of an approved publisher's link (`viaPublisher`), never for a host we pick ourselves.
import { request, UA } from './http.mjs';

const S3_HOST = /^([a-z0-9][a-z0-9.-]*\.)?s3([.-][a-z0-9-]+)*\.amazonaws\.com$/i;

/** R1a: true when this robots.txt failure is S3 saying "no such object" for a publisher-linked host. */
export function storageHasNoRobots(host, err) {
  return Boolean(err && err.status === 403 && S3_HOST.test(host) && /^AmazonS3$/i.test(err.server || '')
    && /<Code>\s*(AccessDenied|NoSuchKey)\s*<\/Code>/.test(err.body || ''));
}

const TOKEN = 'factpipe-tenders-index';

/** RFC 9309 evaluation for `path`: our group (else *), longest match wins, ties -> Allow. */
export function robotsAllows(text, path, token = TOKEN) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" = allow everything
    const rx = new RegExp(`^${r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$')}`);
    if (!rx.test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

const cache = new Map();

/**
 * true when R1 lets us read `url`; the verdict per host is cached for the run.
 * opts.viaPublisher: `url` is the redirect target of an approved publisher's link (enables R1a).
 */
export async function robotsOk(url, log = () => {}, { viaPublisher = false } = {}) {
  const u = new URL(url);
  const key = viaPublisher ? `${u.host} via-publisher` : u.host;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const res = await request(`${u.protocol}//${u.host}/robots.txt`, { headers: { accept: 'text/plain', 'user-agent': UA }, retries: 1, minGapMs: 0, timeoutMs: 30000 });
        const type = res.headers.get('content-type') || '';
        const text = await res.text();
        if (!/^text\/plain/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) return { ok: false, why: `robots.txt is ${type || 'untyped'}` };
        return { ok: true, text };
      } catch (e) {
        if (e.status === 404 || e.status === 410) return { ok: true, text: '' };
        if (viaPublisher && storageHasNoRobots(u.host, e)) { log(`robots: ${u.host} has no robots.txt object (S3 403, rule R1a)`); return { ok: true, text: '' }; }
        return { ok: false, why: `robots.txt: ${e.message}` };
      }
    })());
  }
  const v = await cache.get(key);
  if (!v.ok) { log(`robots: ${u.host} not readable (${v.why})`); return false; }
  return robotsAllows(v.text, u.pathname + u.search);
}
