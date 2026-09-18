// Pure text helpers: HTML -> plain text, contact redaction, truncation, normalization keys.

export const DESCRIPTION_MAX = 20000;
export const SNIPPET_MAX = 300;

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×', laquo: '«', raquo: '»', shy: '',
  zwj: '', zwnj: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** HTML (possibly entity-escaped, as Greenhouse serves it) -> readable plain text. */
export function htmlToText(html) {
  if (html === null || html === undefined) return null;
  let s = String(html);
  // Greenhouse escapes the whole HTML body once ("&lt;p&gt;") - unescape before stripping tags.
  if (/&lt;\/?[a-z]/i.test(s) && !/<\/?[a-z][^>]*>/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr|table|section|article|blockquote|header|footer)>/gi, '\n')
    .replace(/<(p|div|ul|ol|h[1-6]|tr|table|section|article|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s || null;
}

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// North-American style (separators required so years, amounts and IDs survive)...
const PHONE_NA_RX = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b(?:\s?(?:x|ext\.?)\s?\d{1,5})?/gi;
// ...and international numbers, which must start with "+" and a country code.
const PHONE_INTL_RX = /\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){2,4}\b/g;
// "Recruiter: Jane Doe", "Hiring manager - John Smith", "Contact person: ..." -> the name is dropped.
// Label words match case-insensitively; the name after them must be 2-4 Capitalized words.
const ci = (w) => w.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const PERSON_LABELS = ['recruiter', 'hiring manager', 'talent partner', 'talent acquisition partner', 'talent acquisition specialist',
  'recruiting contact', 'recruiting partner', 'recruiting coordinator', 'contact person', 'your contact', 'point of contact',
  'ansprechpartnerin', 'ansprechpartner', 'contactpersoon'].map(ci).join('|');
const PERSON_LABEL_RX = new RegExp(String.raw`\b(${PERSON_LABELS})[ \t]*[:\-–][ \t]*\p{Lu}[\p{Ll}'’-]+(?:[ \t]+(?:(?:van|der|den|de|von|da|di|du|le|la|del|ten|ter)[ \t]+)*\p{Lu}[\p{Ll}'’-]+){1,3}(?![\p{L}])`, 'gu');

// "jane.doe(at)acme.fi", "jane [at] acme [dot] com", "jane at acme dot com"
const OBFUSCATED_EMAIL_RX = /[A-Za-z0-9._%+-]+\s?(?:\(at\)|\[at\]|\{at\}|\sat\s)\s?[A-Za-z0-9-]+(?:\s?(?:\.|\(dot\)|\[dot\]|\sdot\s)\s?[A-Za-z0-9-]+)+/gi;
// European local numbers ("06-12345678", "030 1234 5678", "06 - 11 38 92 33"): only redacted inside
// contact sentences, where a leading-zero digit group is a phone number rather than an amount or an id.
const LOCAL_PHONE_RX = /(?<![\w.,])\(?0\d{1,4}\)?(?:\s?[./-]?\s?\d{2,4}){2,5}(?![\w,])/g;
// A sentence is a "contact sentence" when it already contained an e-mail / phone number, or names a
// contact role / invites the reader to contact someone.
const CONTACT_SENTENCE_RX = new RegExp([
  String.raw`\[(?:email|phone) redacted\]`,
  String.raw`\b(?:recruiter|hiring manager|talent acquisition (?:partner|specialist|lead|manager)|talent partner|contact ?person|contactpersoon|ansprechpartner(?:in)?|point of contact)\b`,
  String.raw`\b(?:reach out to|get in touch with|contact (?:me|us|[A-Z]\w+ [A-Z])|neem (?:dan )?contact op met|contact opnemen met|terecht bij|bel (?:dan )?met|app of bel|steht (?:dir|ihnen|euch)|wende (?:dich|dir|sie sich) an|melde dich bei|puhelin|soita)\b`,
].join('|'), 'i');
const NAME_PARTICLES = 'van|der|den|de|von|da|di|du|le|la|del|ten|ter|bin|al|el|dos|das';
const CAP = String.raw`(?<![\p{L}\p{N}_-])\p{Lu}[\p{Ll}'’]+(?:-\p{Lu}?[\p{Ll}'’]+)?`;
const NAME_RUN_RX = new RegExp(`${CAP}(?:[ \\t]+(?:(?:${NAME_PARTICLES})[ \\t]+)*${CAP}){0,3}`, 'gu');
// A lone capitalized word counts as a name only right after words that introduce a person.
const NAME_INTRO_RX = /(?:\b(?:met|with|bij|to|an|contact|bel|call|ask|mit|naar|contacteer|kontaktiere|via|or|of|and|en|und|dir|ihnen)|,)\s*$/i;
// Capitalized words that are not names.
const NOT_NAMES = new Set(('I We Our Us You Your Please Feel Questions Question Contact Recruiter Recruiters Recruiting Talent Acquisition '
  + 'Team Hiring Manager Partner People Human Resources HR Email E-mail Mail Phone Call WhatsApp LinkedIn Teams Zoom Monday Tuesday '
  + 'Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December '
  + 'Heb Bel Neem Stuur Vragen Wil Je Jij Onze Voor Bei Fragen Kontakt Wir Sie Du Ihr Pour Nous Vous Des For If Any The This Do Send '
  + 'Reach Apply Application Applications Via Or And Of To With At Contactpersoon Ansprechpartner Ansprechpartnerin Mocht App '
  + 'English Dutch German French Spanish Italian Nederlands Engels Duits Deutsch Englisch Français Anglais').split(' '));

function redactNamesInContactSentences(text) {
  return text.replace(/[^\n.!?]+[.!?]?/g, (sentence) => {
    if (!CONTACT_SENTENCE_RX.test(sentence)) return sentence;
    const out = sentence.replace(LOCAL_PHONE_RX, '[phone redacted]');
    return out.replace(NAME_RUN_RX, (run, offset, whole) => {
      // Peel non-name words ("Contact", "Recruiter") off both ends; redact what remains.
      const words = run.split(/\s+/);
      let a = 0;
      let b = words.length;
      while (a < b && NOT_NAMES.has(words[a])) a += 1;
      while (b > a && NOT_NAMES.has(words[b - 1])) b -= 1;
      if (a === b) return run;
      if (b - a === 1) {
        const before = whole.slice(0, offset) + words.slice(0, a).map((w) => `${w} `).join('');
        if (!NAME_INTRO_RX.test(before)) return run;
      }
      return [...words.slice(0, a), '[name redacted]', ...words.slice(b)].join(' ');
    });
  });
}

/**
 * Remove personal contact data from free text: e-mails (also "name(at)domain"), phone numbers,
 * labelled recruiter / hiring-manager names, and capitalized name runs inside contact sentences
 * ("Questions? Call Jane Doe on ..."). Best-effort, errs on the side of over-redacting contact lines.
 */
export function redactContacts(text) {
  if (!text) return text;
  const masked = text
    .replace(EMAIL_RX, '[email redacted]')
    .replace(OBFUSCATED_EMAIL_RX, '[email redacted]')
    .replace(PHONE_INTL_RX, '[phone redacted]')
    .replace(PHONE_NA_RX, '[phone redacted]')
    .replace(PERSON_LABEL_RX, (m, label) => `${label}: [name redacted]`);
  return redactNamesInContactSentences(masked);
}

export function truncate(text, max) {
  if (!text) return text ?? null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${sp > max * 0.8 ? cut.slice(0, sp) : cut}…`;
}

/** Plain-text description pipeline shared by every ATS parser. */
export function cleanDescription(html, plain) {
  const text = plain ? String(plain).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : htmlToText(html);
  return text ? truncate(redactContacts(text), DESCRIPTION_MAX) : null;
}

export function snippetOf(text) {
  if (!text) return null;
  return truncate(text.replace(/\s+/g, ' ').trim(), SNIPPET_MAX);
}

/** Case/diacritic/punctuation-insensitive key used for dedupe and matching. */
export function normKey(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COMPANY_SUFFIX_RX = /\b(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|b v|plc|corp|corporation|co|company|oy|ab|as|srl|spa|pty|pte|kk|nv)\b/g;
export function companyKey(s) {
  return normKey(s).replace(COMPANY_SUFFIX_RX, ' ').replace(/\s+/g, ' ').trim();
}

export const clean = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};
