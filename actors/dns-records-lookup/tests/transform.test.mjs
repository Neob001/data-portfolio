import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeDomain,
  sanitizeRecordTypes,
  joinTxt,
  maskMailboxes,
  isNxDomain,
  isAllTransientFailure,
  detectMailProvider,
  detectDnsProvider,
  detectVerificationTokens,
  formatMx,
  isNullMx,
  formatCaa,
  formatSoa,
  assemble,
  isChargeable,
  ALLOWED_RECORD_TYPES,
} from '../src/transform.js';

const cap = JSON.parse(readFileSync(fileURLToPath(new URL('../golden/dns_capture.json', import.meta.url)), 'utf8'));
const answersFor = (d) => ({
  a: cap[d].a, ns: cap[d].ns, soa: cap[d].soa, mx: cap[d].mx, txt: cap[d].txt,
  dmarcTxt: cap[d].dmarc, aaaa: cap[d].aaaa, cname: cap[d].cname, caa: cap[d].caa,
});

// ---- normalization ----

test('domain normalization keeps subdomains, strips scheme/path/port/trailing dot', () => {
  assert.equal(normalizeDomain('https://mail.Example.com:8080/path?x=1'), 'mail.example.com');
  assert.equal(normalizeDomain('someone@example.co.uk'), 'example.co.uk');
  assert.equal(normalizeDomain('example.com.'), 'example.com');
  assert.equal(normalizeDomain('docs.github.com'), 'docs.github.com');
  assert.equal(normalizeDomain('not a domain'), null);
  assert.equal(normalizeDomain('-bad-.com'), null);
  assert.equal(normalizeDomain(''), null);
});

test('www is kept by default and stripped only when stripWww is true', () => {
  assert.equal(normalizeDomain('www.example.com'), 'www.example.com');
  assert.equal(normalizeDomain('www.example.com', true), 'example.com');
  assert.equal(normalizeDomain('www.mail.example.com', true), 'mail.example.com');
});

test('sanitizeRecordTypes validates against the allowed set and falls back to the default', () => {
  assert.deepEqual(sanitizeRecordTypes(['mx', 'a', 'bogus']), ['A', 'MX']);
  assert.deepEqual(sanitizeRecordTypes([]), ALLOWED_RECORD_TYPES);
  assert.deepEqual(sanitizeRecordTypes(['SRV', 'nope']), ALLOWED_RECORD_TYPES);
  assert.deepEqual(sanitizeRecordTypes(undefined), ALLOWED_RECORD_TYPES);
});

// ---- masking ----

test('maskMailboxes hides local-parts, keeping the domain visible', () => {
  assert.equal(maskMailboxes('rua=mailto:dmarc@github.com'), 'rua=mailto:***@github.com');
  assert.equal(maskMailboxes('no emails here'), 'no emails here');
  assert.equal(
    maskMailboxes('rua=mailto:a@x.com,mailto:b@y.com'),
    'rua=mailto:***@x.com,mailto:***@y.com',
  );
});

// ---- provider detection ----

test('mail provider detection from MX hostnames', () => {
  assert.equal(detectMailProvider(['github-com.mail.protection.outlook.com']), 'Microsoft 365');
  assert.equal(detectMailProvider(['aspmx.l.google.com']), 'Google Workspace');
  assert.equal(detectMailProvider(['mx.zoho.com']), 'Zoho');
  assert.equal(detectMailProvider(['mx1.protonmail.ch']), 'Proton');
  assert.equal(detectMailProvider(['in1-smtp.messagingengine.com']), 'Fastmail');
  assert.equal(detectMailProvider(['us-smtp-inbound-1.mimecast.com']), 'Mimecast');
  assert.equal(detectMailProvider(['mx0a-00000000.pphosted.com']), 'Proofpoint');
  assert.equal(detectMailProvider(['inbound-smtp.us-east-1.amazonaws.com']), 'Amazon SES');
  assert.equal(detectMailProvider([]), null);
  assert.equal(detectMailProvider(['']), null);
});

test('DNS provider detection from NS hostnames', () => {
  assert.equal(detectDnsProvider(['hera.ns.cloudflare.com', 'elliott.ns.cloudflare.com']), 'Cloudflare');
  assert.equal(detectDnsProvider(['ns-1283.awsdns-32.org', 'ns-421.awsdns-52.com']), 'AWS Route 53');
  assert.equal(detectDnsProvider(['ns-cloud-a1.googledomains.com']), 'Google Cloud DNS');
  assert.equal(detectDnsProvider(['ns1-01.azure-dns.com']), 'Azure DNS');
  assert.equal(detectDnsProvider(['ns17.domaincontrol.com']), 'GoDaddy');
  assert.equal(detectDnsProvider(['dns1.registrar-servers.com']), 'Namecheap');
  assert.equal(detectDnsProvider(['ns1.digitalocean.com']), 'DigitalOcean');
  assert.equal(detectDnsProvider(['ns1.vercel-dns.com']), 'Vercel');
  assert.equal(detectDnsProvider(['dns1.p08.nsone.net']), 'NS1');
  assert.equal(detectDnsProvider([]), null);
});

test('verification token detection: service names only, deduplicated', () => {
  const txt = [
    'MS=6BF03E6AF5CB689E315FB6199603BABF2C88D805',
    'MS=ms44452932',
    'apple-domain-verification=RyQhdzTl6Z6x8ZP4',
    'atlassian-domain-verification=jjgw98',
    'docusign=087098e3-3d46-47b7-9b4e-8a23028154cd',
    'facebook-domain-verification=39xu4jzl7roi7x0n93l',
    'google-site-verification=82Le34',
    'google-site-verification=UTM-3akM',
    'stripe-verification=f88ef17321660a01',
    'zoom-domain-verification=abc123',
    'unrelated-record=xyz',
  ];
  assert.deepEqual(
    detectVerificationTokens(txt),
    ['microsoft', 'apple', 'atlassian', 'docusign', 'facebook', 'google', 'stripe', 'zoom'],
  );
  assert.deepEqual(detectVerificationTokens([]), []);
});

// ---- formatters ----

test('formatMx sorts by priority and formats as "prio host"', () => {
  assert.deepEqual(
    formatMx([{ priority: 10, exchange: 'b.com' }, { priority: 1, exchange: 'a.com' }]),
    ['1 a.com', '10 b.com'],
  );
  assert.deepEqual(formatMx({ error: 'ENODATA' }), []);
});

test('formatCaa renders issue/issuewild/iodef tags', () => {
  assert.deepEqual(
    formatCaa([{ critical: 0, issue: 'letsencrypt.org' }, { critical: 1, issuewild: 'digicert.com' }]),
    ['0 issue "letsencrypt.org"', '1 issuewild "digicert.com"'],
  );
  assert.deepEqual(formatCaa({ error: 'ENODATA' }), []);
});

test('formatSoa flattens to primary NS, serial and minimum TTL (no hostmaster email)', () => {
  const flat = formatSoa({ nsname: 'ns1.example.com', hostmaster: 'admin.example.com', serial: 5, minttl: 3600 });
  assert.deepEqual(flat, { soa_primary_ns: 'ns1.example.com', soa_serial: 5, soa_minimum_ttl: 3600 });
  assert.ok(!('hostmaster' in flat) && !('soa_hostmaster' in flat));
  assert.deepEqual(formatSoa({ error: 'ENOTFOUND' }), { soa_primary_ns: null, soa_serial: null, soa_minimum_ttl: null });
});

// ---- NXDOMAIN / reachability ----

test('NXDOMAIN detected only when A, NS and SOA all say ENOTFOUND', () => {
  assert.equal(isNxDomain(answersFor('this-domain-does-not-exist-factpipe-12345.com')), true);
  assert.equal(isNxDomain(answersFor('github.com')), false);
  assert.equal(isNxDomain({ a: { error: 'ENOTFOUND' }, ns: [], soa: { error: 'ENOTFOUND' } }), false);
});

test('isAllTransientFailure only trips when every performed query is a transient error', () => {
  const transient = { error: 'ETIMEOUT' };
  const definitive = { error: 'ENODATA' };
  const ok = ['1.2.3.4'];
  assert.equal(isAllTransientFailure([transient, transient, null]), true);
  assert.equal(isAllTransientFailure([transient, definitive]), false);
  assert.equal(isAllTransientFailure([transient, ok]), false);
  assert.equal(isAllTransientFailure([null, undefined]), false);
});

// ---- charge decision ----

test('isChargeable: only found domains with at least one delivered record are charged', () => {
  assert.equal(isChargeable({ found: true, record_count: 3 }), true);
  assert.equal(isChargeable({ found: true, record_count: 0 }), false);
  assert.equal(isChargeable({ found: false, record_count: 5 }), false);
  assert.equal(isChargeable(null), false);
});

// ---- record assembly from golden captures ----

test('github.com real DNS: A, MX (Microsoft 365), NS (AWS Route 53), SPF+DMARC present, verification tokens', () => {
  const r = assemble('github.com', ALLOWED_RECORD_TYPES, answersFor('github.com'));
  assert.deepEqual(r.a, ['20.205.243.166']);
  assert.deepEqual(r.aaaa, []);
  assert.deepEqual(r.mx, ['0 github-com.mail.protection.outlook.com']);
  assert.equal(r.mail_provider, 'Microsoft 365');
  assert.equal(r.dns_provider, 'AWS Route 53');
  assert.equal(r.soa_primary_ns, 'ns-1707.awsdns-21.co.uk');
  assert.equal(r.soa_serial, 1);
  assert.equal(r.soa_minimum_ttl, 86400);
  assert.equal(r.cname, null);
  assert.equal(r.caa.length, 7);
  assert.equal(r.has_spf, true);
  assert.equal(r.has_dmarc, true);
  assert.deepEqual(r.verification_tokens, ['microsoft', 'apple', 'atlassian', 'docusign', 'facebook', 'google', 'stripe']);
  assert.ok(r.record_count > 10);
});

test('unrequested record types are returned as null and excluded from record_count', () => {
  const r = assemble('github.com', ['MX', 'NS'], answersFor('github.com'));
  assert.equal(r.a, null);
  assert.equal(r.txt, null);
  assert.equal(r.soa_primary_ns, null);
  assert.equal(r.caa, null);
  assert.ok(Array.isArray(r.mx) && Array.isArray(r.ns));
  // still computed regardless of what was requested
  assert.equal(r.mail_provider, 'Microsoft 365');
  assert.equal(r.has_spf, true);
  assert.equal(r.record_count, r.mx.length + r.ns.length);
});

test('example.com real DNS: SPF -all, DMARC p=reject, mailbox local-parts masked', () => {
  const r = assemble('example.com', ALLOWED_RECORD_TYPES, answersFor('example.com'));
  assert.deepEqual(r.a.sort(), ['104.20.23.154', '172.66.147.243'].sort());
  assert.equal(r.dns_provider, 'Cloudflare');
  assert.equal(r.mail_provider, null);
  assert.equal(r.has_spf, true);
  assert.equal(r.has_dmarc, true);
  assert.deepEqual(r.caa, []);
  assert.equal(r.cname, null);
});

test('CNAME host (www.github.com) resolves through the alias; A follows the chain', () => {
  const r = assemble('www.github.com', ALLOWED_RECORD_TYPES, answersFor('www.github.com'));
  assert.equal(r.cname, 'github.com');
  assert.deepEqual(r.a, ['20.205.243.166']);
});

test('nonexistent domain: every field is empty/null once assembled (not used when NXDOMAIN, but must not throw)', () => {
  const r = assemble('this-domain-does-not-exist-factpipe-12345.com', ALLOWED_RECORD_TYPES, answersFor('this-domain-does-not-exist-factpipe-12345.com'));
  assert.deepEqual(r.a, []);
  assert.deepEqual(r.mx, []);
  assert.deepEqual(r.ns, []);
  assert.equal(r.soa_primary_ns, null);
  assert.equal(r.record_count, 0);
  assert.equal(isChargeable({ ...r, found: false }), false);
});

test('ENODATA for a requested type yields an empty array, not an error', () => {
  assert.deepEqual(joinTxt({ error: 'ENODATA' }), []);
  const r = assemble('example.com', ['CAA'], answersFor('example.com')); // example.com CAA is ENODATA in golden
  assert.deepEqual(r.caa, []);
});

test('RFC 7505 null MX renders as empty mx list with null_mx flag', () => {
  const nullMx = [{ priority: 0, exchange: '' }];
  assert.equal(isNullMx(nullMx), true);
  assert.deepEqual(formatMx(nullMx), []);
  assert.equal(isNullMx([{ priority: 10, exchange: 'mx.example.com' }]), false);
  assert.equal(isNullMx({ error: 'ENODATA' }), false);
});
