import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeDomain, parseSpf, parseDmarc, evaluate, isNxDomain, joinTxt } from '../src/transform.js';

const cap = JSON.parse(readFileSync(fileURLToPath(new URL('../golden/dns_capture.json', import.meta.url)), 'utf8'));
const answersFor = (d) => ({
  mx: cap[d].mx, txt: cap[d].txt, dmarc: cap[d].dmarc, mtasts: cap[d].mtasts, tlsrpt: cap[d].tlsrpt,
  dkim: { google: cap[d].dkim_google, selector1: cap[d].dkim_selector1 },
});

test('domain normalization from URLs, emails and junk', () => {
  assert.equal(normalizeDomain('https://www.GitHub.com/about?x=1'), 'github.com');
  assert.equal(normalizeDomain('someone@example.co.uk'), 'example.co.uk');
  assert.equal(normalizeDomain('example.com.'), 'example.com');
  assert.equal(normalizeDomain('not a domain'), null);
  assert.equal(normalizeDomain('-bad-.com'), null);
  assert.equal(normalizeDomain(''), null);
});

test('github.com real DNS: SPF softfail, DMARC quarantine, DKIM found', () => {
  const r = evaluate('github.com', answersFor('github.com'));
  assert.equal(r.spf_present, true);
  assert.equal(r.spf_all, '~all');
  assert.ok(r.spf_dns_lookups >= 8);
  assert.equal(r.dmarc_policy, 'quarantine');
  assert.equal(r.dmarc_subdomain_policy, 'reject');
  assert.deepEqual(r.dmarc_report_domains, ['github.com']);
  assert.ok(!/dmarc@github\.com/.test(r.dmarc_record), 'mailbox local parts must be masked');
  assert.ok(r.mx_records.length >= 1);
  assert.ok(r.score > 50 && r.score < 100);
});

test('example.com real DNS: null-MX style domain with -all and p=reject', () => {
  const r = evaluate('example.com', answersFor('example.com'));
  assert.equal(r.spf_all, '-all');
  assert.equal(r.dmarc_policy, 'reject');
  assert.equal(r.dmarc_pct, 100);
});

test('nonexistent domain detected (never charged)', () => {
  assert.equal(isNxDomain(answersFor('thisdomaindoesnotexist-factpipe-4821.com')), true);
  assert.equal(isNxDomain(answersFor('github.com')), false);
});

test('SPF edge cases: multiple records, lookup limit, missing', () => {
  const two = parseSpf([['v=spf1 -all'], ['v=spf1 include:a.com ~all']]);
  assert.equal(two.multiple, true);
  const many = parseSpf([[`v=spf1 ${Array.from({ length: 11 }, (_, i) => `include:s${i}.com`).join(' ')} -all`]]);
  assert.equal(many.lookups, 11);
  const r = evaluate('x.com', { mx: [], txt: [['v=spf1 +all']], dmarc: { error: 'ENODATA' }, dkim: {} });
  assert.equal(r.spf_all, '+all');
  assert.equal(r.grade, 'F');
  assert.ok(r.issues.some((i) => /No DMARC/.test(i)));
  assert.equal(parseSpf({ error: 'ENODATA' }).present, false);
});

test('DMARC tag parsing tolerates spacing and case', () => {
  const d = parseDmarc([['v=DMARC1 ; P=Reject; pct=50 ; rua=mailto:a@x.com,mailto:b@Y.com']]);
  assert.equal(d.policy, 'reject');
  assert.equal(d.pct, 50);
  assert.deepEqual(d.rua_domains, ['x.com', 'y.com']);
  assert.deepEqual(joinTxt({ error: 'ENODATA' }), []);
});
