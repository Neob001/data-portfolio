// Pure robots.txt evaluation (RFC 9309): user-agent groups, longest-match Allow/Disallow with `*` and `$`.
// Used before calling an endpoint that is not a documented public API (Workday career-site JSON):
// a path robots.txt disallows is never requested.

/** robots.txt text -> [{ agents: [lowercase tokens], rules: [{ allow, path }] }] */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur || (key !== 'allow' && key !== 'disallow')) continue;
    if (key === 'disallow' && value === '') continue; // "Disallow:" (empty) allows everything
    cur.rules.push({ allow: key === 'allow', path: value });
  }
  return groups;
}

function ruleRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Rules for our product token (e.g. "factpipe-jobs-feed"), else the `*` group(s); [] when none. */
export function rulesFor(groups, productToken) {
  const token = String(productToken || '').toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && a && token.startsWith(a)));
  const use = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return use.flatMap((g) => g.rules);
}

/** Is `path` (with query) allowed? Longest matching rule wins; a tie goes to Allow. No rule -> allowed. */
export function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path || !ruleRegex(r.path).test(path)) continue;
    const len = r.path.replace(/\*/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

/**
 * Robots verdict for a set of paths on one host: { allowed, reason }.
 * `fetched` is { status, text } of GET /robots.txt, or { error } when it could not be fetched.
 * RFC 9309: 4xx (no robots.txt) = everything allowed; 5xx / unreachable = assume everything disallowed.
 */
export function robotsVerdict(fetched, userAgent, paths) {
  if (!fetched || fetched.error || (fetched.status >= 500)) return { allowed: false, reason: 'robots.txt unreachable' };
  if (fetched.status >= 400) return { allowed: true, reason: `robots.txt HTTP ${fetched.status}` };
  // Asked with Accept: text/html, Workday hosts answer /robots.txt with their HTML app: not a robots file.
  if (/^\s*</.test(fetched.text || '')) return { allowed: false, reason: 'robots.txt answered with an HTML page' };
  const rules = rulesFor(parseRobots(fetched.text), userAgent);
  for (const p of paths) {
    // Workday site names are case-insensitive: a path must be allowed as written AND lowercased.
    if (!isAllowed(rules, p) || !isAllowed(rules.map((r) => ({ ...r, path: r.path.toLowerCase() })), p.toLowerCase())) {
      return { allowed: false, reason: `robots.txt disallows ${p}` };
    }
  }
  return { allowed: true, reason: 'robots.txt allows' };
}
