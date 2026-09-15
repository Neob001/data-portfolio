// Pure logic for the official SAM.gov Contract Opportunities public CSV extract.
// The file is sorted by PostedDate descending, so readers can stop at a date cutoff.

export const SAM_CSV_URL =
  'https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public';

/**
 * Incremental RFC 4180 CSV parser: feed() string chunks of any size, get complete rows via onRow.
 * Handles quoted fields with commas, doubled quotes and embedded CR/LF across chunk boundaries.
 */
export function createCsvParser(onRow) {
  let row = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field; decide on next char
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
          inQuotes = false; // closing quote; fall through to handle c unquoted
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

const s = (v) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const money = (v) => {
  const t = (v ?? '').replace(/[$,\s]/g, '');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
};

/** Header row -> index lookup; throws schema_change when key columns disappear. */
export function headerIndex(header) {
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const k of ['NoticeId', 'Title', 'PostedDate', 'Type', 'NaicsCode', 'Link']) {
    if (!(k in idx)) {
      const e = new Error(`SAM.gov CSV header changed: missing ${k}`);
      e.failureClass = 'schema_change';
      throw e;
    }
  }
  return idx;
}

/**
 * CSV row -> flat opportunity record. Contact names, emails, phones and faxes of individual
 * contracting officers are deliberately dropped (no personal data); the notice link has them.
 */
export function rowToRecord(row, idx, descriptionChars = 2000) {
  const g = (k) => (k in idx ? row[idx[k]] : undefined);
  const id = s(g('NoticeId'));
  if (!id) return null;
  const desc = s(g('Description'));
  return {
    notice_id: id,
    title: s(g('Title')),
    solicitation_number: s(g('Sol#')),
    department: s(g('Department/Ind.Agency')),
    sub_tier: s(g('Sub-Tier')),
    office: s(g('Office')),
    posted_date: s(g('PostedDate')),
    notice_type: s(g('Type')),
    base_type: s(g('BaseType')),
    response_deadline: s(g('ResponseDeadLine')),
    archive_date: s(g('ArchiveDate')),
    set_aside_code: s(g('SetASideCode')),
    set_aside: s(g('SetASide')),
    naics_code: s(g('NaicsCode')),
    psc_code: s(g('ClassificationCode')),
    place_of_performance_city: s(g('PopCity')),
    place_of_performance_state: s(g('PopState')),
    place_of_performance_zip: s(g('PopZip')),
    place_of_performance_country: s(g('PopCountry')),
    active: s(g('Active')) === 'Yes',
    award_number: s(g('AwardNumber')),
    award_date: s(g('AwardDate')),
    award_amount: money(g('Award$')),
    awardee: s(g('Awardee')),
    organization_type: s(g('OrganizationType')),
    notice_url: s(g('Link')),
    additional_info_url: s(g('AdditionalInfoLink')),
    description: desc && desc.length > descriptionChars ? `${desc.slice(0, descriptionChars)}…` : desc,
  };
}

/** Compile user filters once. All provided filters must match (AND); values within one filter are OR. */
export function buildMatcher({ keywords = [], naicsCodes = [], setAsideCodes = [], noticeTypes = [], agencies = [], states = [] } = {}) {
  const low = (a) => a.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const kw = low(keywords);
  const naics = naicsCodes.map((x) => String(x).trim()).filter(Boolean);
  const sa = low(setAsideCodes);
  const types = low(noticeTypes);
  const ag = low(agencies);
  const st = low(states);
  return (rec) => {
    if (kw.length) {
      const hay = `${rec.title || ''} ${rec.description || ''}`.toLowerCase();
      if (!kw.some((k) => hay.includes(k))) return false;
    }
    if (naics.length && !naics.some((n) => (rec.naics_code || '').startsWith(n))) return false;
    if (sa.length && !sa.includes((rec.set_aside_code || '').toLowerCase())) return false;
    if (types.length && !types.includes((rec.notice_type || '').toLowerCase())) return false;
    if (ag.length) {
      const org = `${rec.department || ''} ${rec.sub_tier || ''} ${rec.office || ''}`.toLowerCase();
      if (!ag.some((a) => org.includes(a))) return false;
    }
    if (st.length && !st.includes((rec.place_of_performance_state || '').toLowerCase())) return false;
    return true;
  };
}
