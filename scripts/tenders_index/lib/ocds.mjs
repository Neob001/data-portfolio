// OCDS release / compiled release -> normalized tender record. Pure (no I/O).
// Used for UK Find a Tender and Contracts Finder (one release = one notice) and for the
// OCP Data Registry bulk files (one compiled release = one contracting process, latest state).
import { clean, countryCode, cpvList, deriveStatus, finalize, isoTs, langCode, num, orgSupplierName, snippet, uniq } from './normalize.mjs';

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function classifications(rel) {
  const out = { cpv: [], unspsc: [], naics: [] };
  const add = (c) => {
    if (!c || !c.id) return;
    const scheme = String(c.scheme || '').toUpperCase();
    if (scheme.startsWith('CPV')) out.cpv.push(String(c.id));
    else if (scheme === 'UNSPSC') out.unspsc.push(String(c.id).replace(/\D/g, ''));
    else if (scheme.startsWith('NAICS')) out.naics.push(String(c.id));
  };
  const tender = rel.tender || {};
  add(tender.classification);
  for (const c of arr(tender.additionalClassifications)) add(c);
  const items = [...arr(tender.items), ...arr(rel.awards).flatMap((a) => arr(a.items)), ...arr(rel.contracts).flatMap((c) => arr(c.items))];
  for (const it of items) {
    add(it.classification);
    for (const c of arr(it.additionalClassifications)) add(c);
  }
  for (const lot of arr(tender.lots)) for (const c of arr(lot.classifications || lot.classification)) add(c);
  return { cpv: cpvList(out.cpv), unspsc: uniq(out.unspsc).filter(Boolean), naics: uniq(out.naics) };
}

/** Notice type of one release: from its tags (UK APIs) or, for compiled releases, the furthest stage. */
export function ocdsNoticeType(rel, { compiled = false } = {}) {
  const tags = arr(rel.tag).map(String);
  const tender = rel.tender || {};
  if (tags.includes('tenderCancellation') || tags.includes('awardCancellation') || tags.includes('contractTermination')
    || (tender.status === 'cancelled' && !arr(rel.awards).length)) return 'cancellation';
  if (!compiled && tags.length) {
    if (tags.some((t) => t.startsWith('contract') || t === 'implementation')) {
      // UK award notices are tagged award+contract: report them as awards.
      return tags.some((t) => t.startsWith('award')) ? 'award' : 'contract';
    }
    if (tags.some((t) => t.startsWith('award'))) return 'award';
    if (tags.some((t) => t.startsWith('tender'))) return 'tender';
    if (tags.some((t) => t.startsWith('planning'))) return 'planning';
    return 'other';
  }
  if (arr(rel.contracts).length) return 'contract';
  if (arr(rel.awards).some((a) => a.status !== 'pending' && a.status !== 'cancelled')) return 'award';
  if (tender.title || tender.tenderPeriod || tender.status) {
    if (tender.status === 'planned' || tender.status === 'planning') return 'planning';
    return 'tender';
  }
  if (rel.planning) return 'planning';
  return 'other';
}

const statusHint = (s) => ({ active: 'open', complete: 'closed', unsuccessful: 'closed', cancelled: 'cancelled', withdrawn: 'cancelled' }[s] || null);

function buyerOf(rel) {
  const parties = arr(rel.parties);
  const bid = rel.buyer?.id;
  const party = (bid && parties.find((p) => p.id === bid)) || parties.find((p) => arr(p.roles).includes('buyer'))
    || parties.find((p) => arr(p.roles).includes('procuringEntity'));
  const name = clean(rel.buyer?.name) || clean(party?.name) || clean(rel.tender?.procuringEntity?.name);
  const addr = party?.address || {};
  return { name, country: countryCode(addr.country) || countryCode(addr.countryName) };
}

function suppliersOf(rel) {
  const parties = arr(rel.parties);
  const byId = new Map(parties.map((p) => [p.id, p]));
  const out = [];
  const refs = [...arr(rel.awards).filter((a) => a.status !== 'cancelled' && a.status !== 'unsuccessful').flatMap((a) => arr(a.suppliers))];
  for (const s of refs) {
    const p = byId.get(s.id) || {};
    const schemes = [p.identifier?.scheme, ...arr(p.additionalIdentifiers).map((i) => i.scheme)];
    if (/^GB-COH-/i.test(String(s.id || p.id || ''))) schemes.push('GB-COH');
    const name = orgSupplierName(s.name || p.name, schemes);
    if (name) out.push(name);
  }
  return uniq(out);
}

function valueOf(rel, type) {
  const sum = (vals) => {
    const ok = vals.filter((v) => v && num(v.amount)); // 0 = "not stated" on several platforms
    if (!ok.length) return null;
    const cur = ok[0].currency || null;
    if (ok.some((v) => (v.currency || null) !== cur)) return { amount: num(ok[0].amount), currency: cur };
    return { amount: num(ok.reduce((s, v) => s + Number(v.amount), 0)), currency: cur };
  };
  let v = null;
  if (type === 'contract') v = sum(arr(rel.contracts).map((c) => c.value));
  if (!v && (type === 'award' || type === 'contract')) v = sum(arr(rel.awards).filter((a) => a.status !== 'cancelled' && a.status !== 'unsuccessful').map((a) => a.value));
  if (!v && rel.tender?.value) v = sum([rel.tender.value]);
  if (!v && rel.planning?.budget?.amount) v = sum([rel.planning.budget.amount]);
  return v || { amount: null, currency: null };
}

function humanUrl(rel) {
  const docs = [...arr(rel.tender?.documents), ...arr(rel.awards).flatMap((a) => arr(a.documents)), ...arr(rel.planning?.documents)];
  const pick = docs.find((d) => /notice/i.test(d.documentType || '') && /^https?:/.test(d.url || '') && /html/i.test(d.format || 'text/html'));
  return pick?.url || null;
}

/**
 * @param rel OCDS release (or compiled release)
 * @param ctx { source, idPrefix, country, language, compiled, noticeUrl(rel), sourceUrl(rel), now, fetchedAt }
 */
export function ocdsToRecord(rel, ctx) {
  if (!rel || !(rel.id || rel.ocid)) return null;
  const tender = rel.tender || {};
  const type = ocdsNoticeType(rel, { compiled: ctx.compiled });
  const buyer = buyerOf(rel);
  const cls = classifications(rel);
  const value = valueOf(rel, type);
  const awards = arr(rel.awards).filter((a) => a.status !== 'cancelled');
  const awardDate = awards.map((a) => isoTs(a.date)).filter(Boolean).sort().pop() || null;
  const lots = arr(tender.lots).length || (new Set(arr(tender.items).map((i) => i.relatedLot).filter(Boolean)).size) || null;
  let title = clean(tender.title) || clean(awards[0]?.title) || clean(arr(rel.contracts)[0]?.title) || clean(rel.planning?.project);
  const description = clean(tender.description) || clean(awards[0]?.description) || clean(arr(rel.contracts)[0]?.description) || clean(rel.planning?.rationale);
  // Some platforms put a reference or order number in the title ("BSM 20/27", AusTender "4600094260"): use the description.
  if (title && /\d/.test(title) && title.length <= 30 && !/[a-z]{4,}/i.test(title.replace(/\d+/g, ' ')) && description) {
    title = description;
  }
  // A compiled release's `date` is its latest change, so the publication date of the notice the record
  // stands for is taken from the stage itself: award/contract date, else the tender's publication.
  const contractSigned = arr(rel.contracts).map((c) => isoTs(c.dateSigned)).filter(Boolean).sort().pop() || null;
  const published = ctx.compiled
    ? ((type === 'award' || type === 'contract') ? (awardDate || contractSigned) : null)
      || isoTs(tender.datePublished) || isoTs(tender.tenderPeriod?.startDate) || isoTs(rel.date)
    : isoTs(rel.date) || isoTs(tender.datePublished);
  const rec = {
    notice_id: `${ctx.idPrefix}:${ctx.compiled ? rel.ocid : rel.id}`,
    source: ctx.source,
    country_code: ctx.country || buyer.country,
    buyer_name: buyer.name,
    buyer_country: buyer.country || ctx.country || null,
    title: snippet(title, 300),
    description_snippet: snippet(description),
    notice_type: type,
    procedure_type: clean(tender.procurementMethodDetails) || clean(tender.procurementMethod),
    cpv_codes: cls.cpv,
    naics_codes: cls.naics,
    unspsc_codes: cls.unspsc,
    value_amount: value.amount,
    value_currency: value.amount === null ? null : clean(value.currency),
    published_at: published,
    deadline_at: type === 'award' || type === 'contract' ? null : isoTs(tender.tenderPeriod?.endDate) || null,
    award_date: type === 'award' || type === 'contract' ? awardDate : null,
    supplier_names: ctx.suppliers === false ? [] : suppliersOf(rel),
    lots_count: lots,
    language: langCode(rel.language) || ctx.language || null,
    notice_url: (ctx.noticeUrl && ctx.noticeUrl(rel)) || humanUrl(rel),
    source_url: ctx.sourceUrl(rel),
  };
  rec.status = deriveStatus(rec, statusHint(tender.status), ctx.now ?? Date.now());
  // A planning notice past its tender deadline is still "unknown", and tenders the source marks
  // complete/unsuccessful without a deadline are closed.
  return finalize(rec, ctx.fetchedAt);
}
