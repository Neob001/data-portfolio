// SAM.gov Contract Opportunities public CSV extract -> normalized records. Pure (no I/O).
// The extract is sorted by PostedDate (newest first) and Windows-1252 encoded.
import { clean, deriveStatus, finalize, isoTs, num, snippet, uniq } from './normalize.mjs';

export const SAM_CSV_URL =
  'https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public';

/**
 * Incremental RFC 4180 CSV parser: feed() string chunks of any size, complete rows go to onRow.
 * Quoted fields with commas, doubled quotes and CR/LF across chunk boundaries are handled.
 */
export function createCsvParser(onRow) {
  let row = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let lastWasCR = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); const r = row; row = []; return onRow(r); };
  return {
    feed(chunk) {
      for (let i = 0; i < chunk.length; i += 1) {
        const c = chunk[i];
        if (quotePending) {
          quotePending = false;
          if (c === '"') { field += '"'; continue; }
          inQuotes = false;
        }
        if (inQuotes) {
          if (c === '"') quotePending = true;
          else field += c;
          continue;
        }
        if (lastWasCR) { lastWasCR = false; if (c === '\n') continue; }
        if (c === '"' && field === '') { inQuotes = true; continue; }
        if (c === ',') { endField(); continue; }
        if (c === '\r' || c === '\n') {
          lastWasCR = c === '\r';
          if (endRow() === false) return false;
          continue;
        }
        field += c;
      }
      return true;
    },
    end() {
      if (quotePending) { quotePending = false; inQuotes = false; }
      if (field !== '' || row.length > 0) return endRow();
      return true;
    },
  };
}

export function headerIndex(header) {
  const idx = Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, '').trim(), i]));
  for (const k of ['NoticeId', 'Title', 'PostedDate', 'Type', 'NaicsCode', 'Link']) {
    if (!(k in idx)) {
      const e = new Error(`SAM.gov CSV header changed: missing ${k}`);
      e.failureClass = 'schema_change';
      throw e;
    }
  }
  return idx;
}

const TYPES = {
  solicitation: 'tender',
  'combined synopsis/solicitation': 'tender',
  presolicitation: 'planning',
  'sources sought': 'planning',
  'award notice': 'award',
};

export function samNoticeType(t) {
  return TYPES[String(t || '').trim().toLowerCase()] || 'other';
}

/** SAM dates: "2026-09-14", "2026-09-14 10:22:33.123-04", "2026-12-31T12:00:00+01:00". */
export function samTs(v) {
  const s = clean(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*([+-]\d{2})(?::?(\d{2}))?$/.exec(s);
  if (m) return isoTs(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3]}:${m[4] || '00'}`);
  return isoTs(s);
}

/** CSV row -> normalized record. Contact columns (names, e-mails, phones, faxes) are never read. */
export function samRowToRecord(row, idx, { now = Date.now(), fetchedAt } = {}) {
  const g = (k) => (k in idx ? row[idx[k]] : undefined);
  const id = clean(g('NoticeId'));
  if (!id) return null;
  const type = samNoticeType(g('Type'));
  const active = clean(g('Active')) === 'Yes';
  const buyer = uniq([clean(g('Department/Ind.Agency')), clean(g('Sub-Tier')), clean(g('Office'))]).join(' · ') || null;
  const awardAmount = num(g('Award$'));
  const rec = {
    notice_id: `sam:${id}`,
    source: 'sam',
    country_code: 'US',
    buyer_name: buyer,
    buyer_country: 'US',
    title: snippet(g('Title'), 300),
    description_snippet: /^https?:\/\//.test(clean(g('Description')) || '') ? null : snippet(g('Description')),
    notice_type: type,
    procedure_type: clean(g('Type')),
    cpv_codes: [],
    naics_codes: uniq([clean(g('NaicsCode'))]),
    unspsc_codes: [],
    value_amount: type === 'award' ? awardAmount : null,
    value_currency: type === 'award' && awardAmount !== null ? 'USD' : null,
    published_at: samTs(g('PostedDate')),
    deadline_at: type === 'tender' || type === 'planning' ? samTs(g('ResponseDeadLine')) : null,
    award_date: type === 'award' ? samTs(g('AwardDate')) : null,
    supplier_names: [], // v1: awardees omitted (sole proprietors cannot be told apart in the extract)
    lots_count: null,
    language: 'en',
    notice_url: clean(g('Link')),
    source_url: SAM_CSV_URL,
  };
  rec.status = deriveStatus(rec, active ? null : 'closed', now);
  if (!active && rec.status === 'open') rec.status = 'closed';
  return finalize(rec, fetchedAt);
}
