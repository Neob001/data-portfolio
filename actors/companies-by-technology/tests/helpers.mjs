// Test helpers: build a tiny jobs index (with companies_tech.json.gz) from the golden boards, run the Actor core on it.
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexWriter } from '../src/core/index_writer.js';
import { normalizeTechInput, runTechnographics } from '../src/core/technographics.js';

export const load = (f) => JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), 'utf8'));
export const BUILT_AT = new Date('2026-11-17T03:30:00.000Z');

/** Golden boards -> index directory (as the nightly build writes it), -> { dir, manifest }. */
export async function buildGoldenIndex(boards = load('boards.json')) {
  const dir = await mkdtemp(join(tmpdir(), 'cbt-'));
  const w = await new IndexWriter(dir, { builtAt: BUILT_AT, codec: 'gz', tech: true }).open();
  for (const b of boards) await w.addBoard(b.board, b.name, b.jobs);
  const manifest = await w.finish();
  return { dir, manifest };
}

/** Run the core on an index dir -> { rows, charges, summary }. charge(): optional { eventChargeLimitReached } after n. */
export async function run(dir, rawInput, { limitAfter = null } = {}) {
  const rows = [];
  const charges = [];
  const summary = await runTechnographics(normalizeTechInput(rawInput), {
    indexBaseUrl: dir,
    pushData: async (r) => { rows.push(r); },
    charge: async (ev) => { charges.push(ev.eventName); return { eventChargeLimitReached: limitAfter !== null && charges.length >= limitAfter }; },
  });
  return { rows, charges, summary };
}
