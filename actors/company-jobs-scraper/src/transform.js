// Pure logic: ATS detection from HTML/URLs and job normalization for
// Greenhouse, Lever, and Ashby public job-board APIs.
import { isoDate } from './lib/records.js';

export const ATS_PATTERNS = [
  { ats: 'greenhouse', rx: /(?:boards|job-boards)\.greenhouse\.io\/([A-Za-z0-9_-]+)/ },
  { ats: 'greenhouse', rx: /greenhouse\.io\/embed\/job_board\?for=([A-Za-z0-9_-]+)/ },
  { ats: 'lever', rx: /jobs\.lever\.co\/([A-Za-z0-9_-]+)/ },
  { ats: 'ashby', rx: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/ },
];

/** Find ATS boards referenced anywhere in an HTML page or URL string. */
export function detectAtsBoards(text) {
  const found = [];
  const seen = new Set();
  for (const { ats, rx } of ATS_PATTERNS) {
    const g = new RegExp(rx.source, 'g');
    let m;
    while ((m = g.exec(text || '')) !== null) {
      const key = `${ats}:${m[1].toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); found.push({ ats, board: m[1] }); }
    }
  }
  return found;
}

export function apiUrlFor({ ats, board }) {
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`;
  if (ats === 'lever') return `https://api.lever.co/v0/postings/${board}?mode=json`;
  if (ats === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${board}`;
  return null;
}

/** Candidate careers-page paths to probe when the homepage shows no ATS link. */
export const CAREERS_PATHS = ['/careers', '/careers/', '/jobs', '/jobs/', '/join-us', '/company/careers', '/about/careers'];

const cat = (j, k) => j.categories?.[k] ?? null;

/** Normalize one raw ATS job into our flat record. */
export function normalizeJob(ats, board, raw) {
  if (ats === 'greenhouse') {
    if (!raw || !raw.absolute_url) return null;
    return {
      ats, board,
      company: raw.company_name || board,
      job_id: String(raw.id ?? raw.internal_job_id ?? ''),
      title: raw.title || null,
      department: null,
      team: null,
      location: raw.location?.name ?? null,
      remote: /remote/i.test(raw.location?.name || '') || null,
      employment_type: null,
      published_at: isoDate(raw.first_published),
      updated_at: isoDate(raw.updated_at),
      job_url: raw.absolute_url,
      apply_url: raw.absolute_url,
    };
  }
  if (ats === 'lever') {
    if (!raw || !raw.hostedUrl) return null;
    return {
      ats, board,
      company: board,
      job_id: String(raw.id ?? ''),
      title: raw.text || null,
      department: cat(raw, 'department') || cat(raw, 'team'),
      team: cat(raw, 'team'),
      location: cat(raw, 'location'),
      remote: raw.workplaceType ? raw.workplaceType === 'remote' : null,
      employment_type: cat(raw, 'commitment'),
      published_at: raw.createdAt ? isoDate(new Date(raw.createdAt)) : null,
      updated_at: null,
      job_url: raw.hostedUrl,
      apply_url: raw.applyUrl || raw.hostedUrl,
    };
  }
  if (ats === 'ashby') {
    if (!raw || !raw.jobUrl || raw.isListed === false) return null;
    return {
      ats, board,
      company: board,
      job_id: String(raw.id ?? ''),
      title: raw.title ? raw.title.trim() : null,
      department: raw.department || null,
      team: raw.team || null,
      location: raw.location || null,
      remote: raw.isRemote ?? null,
      employment_type: raw.employmentType || null,
      published_at: isoDate(raw.publishedAt),
      updated_at: null,
      job_url: raw.jobUrl,
      apply_url: raw.applyUrl || raw.jobUrl,
    };
  }
  return null;
}

/** Raw API response -> normalized jobs. Throws typed error on shape change. */
export function parseJobs(ats, board, response) {
  let list;
  if (ats === 'greenhouse') list = response?.jobs;
  else if (ats === 'lever') list = Array.isArray(response) ? response : undefined;
  else if (ats === 'ashby') list = response?.jobs;
  if (!Array.isArray(list)) {
    const e = new Error(`Unexpected ${ats} response shape for board ${board}`);
    e.failureClass = 'schema_change';
    throw e;
  }
  return list.map((r) => normalizeJob(ats, board, r)).filter(Boolean);
}
