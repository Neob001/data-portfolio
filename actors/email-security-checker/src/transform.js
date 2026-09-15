// Pure logic: evaluate a domain's email authentication posture from DNS answers.
// Inputs are raw resolver results so tests run on golden captures without network.

export const DKIM_SELECTORS = [
  'google', 'selector1', 'selector2', 'default', 'k1', 'k2', 's1', 's2', 'dkim', 'mail',
  'smtp', 'mandrill', 'mxvault', 'zoho', 'protonmail', 'fm1', 'everlytickey1', 'sig1',
];

const DOMAIN_RX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** "https://www.Example.com/path" or "user@example.com" -> "example.com" (www stripped), else null. */
export function normalizeDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  return DOMAIN_RX.test(s) ? s : null;
}

/** resolveTxt output (string[][]) or {error} -> joined strings. */
export function joinTxt(answer) {
  return Array.isArray(answer) ? answer.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks))) : [];
}

const LOOKUP_MECHS = /^(include:|a$|a:|a\/|mx$|mx:|mx\/|ptr|exists:|redirect=)/;

export function parseSpf(txtAnswer) {
  const records = joinTxt(txtAnswer).filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));
  if (records.length === 0) return { present: false, record: null, all: null, lookups: 0, multiple: false };
  const terms = records[0].trim().split(/\s+/).slice(1);
  const allTerm = terms.find((t) => /^[-~?+]?all$/i.test(t));
  const lookups = terms.filter((t) => LOOKUP_MECHS.test(t.replace(/^[-~?+]/, '').toLowerCase())).length;
  return {
    present: true,
    record: records[0],
    all: allTerm ? (allTerm.length === 3 ? '+all' : allTerm.toLowerCase()) : null,
    lookups,
    multiple: records.length > 1,
  };
}

export function parseDmarc(txtAnswer) {
  const record = joinTxt(txtAnswer).find((t) => /^v=DMARC1/i.test(t.trim()));
  if (!record) return { present: false, record: null, policy: null, subdomain_policy: null, pct: null, rua_domains: [] };
  const tags = Object.fromEntries(
    record.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return i < 0 ? [p.toLowerCase(), ''] : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
    }),
  );
  // Report only the receiving domains, never mailbox local parts.
  const rua = (tags.rua || '').split(',').map((u) => u.trim().replace(/^mailto:/i, '').split('@')[1]).filter(Boolean);
  return {
    present: true,
    record: record.replace(/mailto:[^@;,\s]+@/gi, 'mailto:***@'),
    policy: (tags.p || '').toLowerCase() || null,
    subdomain_policy: (tags.sp || '').toLowerCase() || null,
    pct: tags.pct ? Number(tags.pct) : 100,
    rua_domains: [...new Set(rua.map((d) => d.toLowerCase()))],
  };
}

export const hasVersionRecord = (answer, prefix) => joinTxt(answer).some((t) => t.trim().toLowerCase().startsWith(prefix));

/** Score 0-100 plus a human-readable issue list. */
export function grade({ mxCount, spf, dmarc, dkimSelectors, mtaSts, tlsRpt }) {
  const issues = [];
  let score = 0;
  if (mxCount > 0) score += 10; else issues.push('No MX records: domain cannot receive mail (fine for non-mail domains, but then SPF should be "-all").');
  if (spf.present) {
    score += 15;
    if (spf.multiple) issues.push('Multiple SPF records: receivers treat this as a permanent error.');
    if (spf.all === '-all') score += 15;
    else if (spf.all === '~all') { score += 10; issues.push('SPF ends in ~all (softfail); -all is stricter.'); }
    else issues.push(`SPF ends in ${spf.all || 'no all mechanism'}: spoofed mail is not rejected.`);
    if (spf.lookups > 10) issues.push(`SPF needs ${spf.lookups} DNS lookups (limit 10): SPF will fail with permerror.`);
    else score += 5;
  } else issues.push('No SPF record.');
  if (dmarc.present) {
    score += 15;
    if (dmarc.policy === 'reject') score += 20;
    else if (dmarc.policy === 'quarantine') { score += 12; issues.push('DMARC policy is quarantine; reject gives full spoofing protection.'); }
    else issues.push('DMARC policy is none: monitoring only, spoofed mail is still delivered.');
    if (dmarc.pct !== null && dmarc.pct < 100) issues.push(`DMARC pct=${dmarc.pct}: policy applies to only part of the mail.`);
    if (dmarc.rua_domains.length === 0) issues.push('No DMARC aggregate reporting (rua).');
  } else issues.push('No DMARC record: domain can be spoofed freely.');
  if (dkimSelectors.length > 0) score += 10; else issues.push(`No DKIM key found on ${DKIM_SELECTORS.length} common selectors (custom selectors cannot be enumerated).`);
  if (mtaSts) score += 5;
  if (tlsRpt) score += 5;
  score = Math.min(100, score);
  const letter = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
  return { score, grade: letter, issues };
}

/** Assemble the output record from raw DNS answers for one domain. */
export function evaluate(domain, answers) {
  const mx = Array.isArray(answers.mx) ? answers.mx.slice().sort((a, b) => a.priority - b.priority) : [];
  const spf = parseSpf(answers.txt);
  const dmarc = parseDmarc(answers.dmarc);
  const dkimSelectors = Object.entries(answers.dkim || {})
    .filter(([, a]) => joinTxt(a).some((t) => /(^|;)\s*(v=DKIM1|k=rsa|k=ed25519|p=)/i.test(t)))
    .map(([s]) => s);
  const mtaSts = hasVersionRecord(answers.mtasts, 'v=stsv1');
  const tlsRpt = hasVersionRecord(answers.tlsrpt, 'v=tlsrptv1');
  const g = grade({ mxCount: mx.length, spf, dmarc, dkimSelectors, mtaSts, tlsRpt });
  return {
    domain,
    score: g.score,
    grade: g.grade,
    issues: g.issues,
    mx_records: mx.map((m) => `${m.priority} ${m.exchange}`),
    spf_present: spf.present,
    spf_record: spf.record,
    spf_all: spf.all,
    spf_dns_lookups: spf.lookups,
    dmarc_present: dmarc.present,
    dmarc_policy: dmarc.policy,
    dmarc_subdomain_policy: dmarc.subdomain_policy,
    dmarc_pct: dmarc.pct,
    dmarc_record: dmarc.record,
    dmarc_report_domains: dmarc.rua_domains,
    dkim_selectors_found: dkimSelectors,
    mta_sts: mtaSts,
    tls_rpt: tlsRpt,
  };
}

/** True when the resolver says the domain itself does not exist. */
export const isNxDomain = (answers) => [answers.mx, answers.txt].every((a) => a && a.error === 'ENOTFOUND');
