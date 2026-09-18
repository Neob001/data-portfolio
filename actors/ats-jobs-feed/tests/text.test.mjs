import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, redactContacts, cleanDescription, DESCRIPTION_MAX, snippetOf, normKey, companyKey } from '../src/text.js';
import { codesFromLocation, countryCodes, countryCode } from '../src/geo.js';

test('htmlToText: tags, lists, entities, Greenhouse double-escaped HTML', () => {
  assert.equal(htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two &amp; three</li></ul>'), 'Hello world\n\n• One\n• Two & three');
  assert.equal(htmlToText('&lt;div&gt;&lt;p&gt;Escaped &amp;amp; body&lt;/p&gt;&lt;/div&gt;'), 'Escaped & body');
  assert.equal(htmlToText('<script>x()</script><style>.a{}</style>Text'), 'Text');
  assert.equal(htmlToText(null), null);
  assert.equal(htmlToText('<p> </p>'), null);
});

test('redaction: emails, NA and international phones, labelled recruiter/hiring-manager names', () => {
  const t = redactContacts('Questions? Email jane.doe@acme.com or call (415) 555-0132 / +44 20 7946 0958 or +49 30 12345678. '
    + 'Recruiter: Jane Doe\nHiring Manager - John Smith\nAnsprechpartnerin: Erika Mustermann');
  assert.ok(!/jane\.doe|555-0132|7946|12345678|Jane Doe|John Smith|Erika/.test(t), t);
  assert.match(t, /\[email redacted\]/);
  assert.match(t, /\[phone redacted\]/);
  assert.match(t, /Recruiter: \[name redacted\]/);
  assert.match(t, /Hiring Manager: \[name redacted\]/);
});

test('redaction: names, obfuscated e-mails and local phone numbers inside contact sentences', () => {
  // Patterns seen in real Recruitee/Greenhouse postings (names here are invented).
  const cases = {
    'Heb je vragen? Bel dan met Jons op 06-12345678 of stuur een mailtje.': 'Heb je vragen? Bel dan met [name redacted] op [phone redacted] of stuur een mailtje.',
    'Neem contact op met onze Recruiter, Danitsha Abdul via 06 1234 5678 of d.abdul@acme.nl.': 'Neem contact op met onze Recruiter, [name redacted] via [phone redacted] of [email redacted].',
    'Contact Jenni Kontkanen, jenni.kontkanen(at)csc.fi, +358 50 1234567.': 'Contact [name redacted], [email redacted], [phone redacted].',
    'Reach out to Maria van der Berg (Talent Partner) with questions.': 'Reach out to [name redacted] (Talent Partner) with questions.',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(redactContacts(input), want);
  const de = redactContacts('Für Fragen steht dir Erika Mustermann unter 030 1234 5678 zur Verfügung.');
  assert.ok(!/Erika|Mustermann|1234/.test(de), de);
  // Non-contact sentences keep their capitalized words and numbers.
  const plain = 'We build Customer Success tools in Berlin with Jane Street as a client. Salary 4.000 - 5.000 EUR, 0 to 100 in 30 days.';
  assert.equal(redactContacts(plain), plain);
});

test('redaction leaves salaries, years, percentages and requisition ids alone', () => {
  const s = 'Salary $120,000 - $150,000 per year, 401k, 20% bonus, founded 2012, req R4953, 3-5 years, +30% growth, 1,000+ customers.';
  assert.equal(redactContacts(s), s);
});

test('cleanDescription: redacts and truncates to 20,000 characters', () => {
  const long = `<p>${'word '.repeat(6000)} contact hr@acme.io</p>`;
  const d = cleanDescription(long);
  assert.ok(d.length <= DESCRIPTION_MAX);
  assert.ok(d.endsWith('…'));
  assert.ok(!d.includes('hr@acme.io'));
  assert.equal(cleanDescription(null, 'Plain  text\r\n\r\n\r\nok'), 'Plain  text\n\nok');
  assert.equal(snippetOf('a\n\nb'), 'a b');
  assert.ok(snippetOf('x'.repeat(400)).length <= 300);
});

test('normalization keys ignore case, accents, punctuation and legal suffixes', () => {
  assert.equal(normKey('Café  Déjà-Vu!'), 'cafe deja vu');
  assert.equal(companyKey('GitLab Inc.'), companyKey('gitlab'));
  assert.equal(companyKey('Acme GmbH'), 'acme');
});

test('country codes from free-text locations (best effort)', () => {
  const c = (s) => [...codesFromLocation(s)].sort();
  assert.deepEqual(c('San Francisco, CA'), ['US']);
  assert.deepEqual(c('Toronto, ON'), ['CA']);
  assert.deepEqual(c('Remote (US)'), ['US']);
  assert.deepEqual(c('London, UK'), ['GB']);
  assert.deepEqual(c('Berlin'), ['DE']);
  assert.deepEqual(c('Atlanta, Georgia'), ['US']);
  assert.deepEqual(c('Tbilisi, Georgia'), ['GE']);
  assert.deepEqual(c('İstanbul, İstanbul, Türkiye'), ['TR']);
  assert.deepEqual(c('Remote - EMEA'), []);
  assert.deepEqual(countryCodes(['Remote, United States', 'Remote, Canada'], ['USA']), ['CA', 'US']);
  assert.equal(countryCode('United Kingdom'), 'GB');
  assert.equal(countryCode('USA'), 'US');
  assert.equal(countryCode('Atlantis'), null);
});
