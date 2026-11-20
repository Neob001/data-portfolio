// --boards-from (Workday read on the owner's Mac, 2026-11-21): only a complete, fresh, large-enough file is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoardsFile } from '../build_index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'boards-from-'));
const job = (i) => ({ job_id: `workday:acme.wd1/ext:${i}`, title: `Engineer ${i}`, fetched_at: '2026-11-21T08:00:00Z' });
const line = (i) => JSON.stringify({ board: { ats: 'workday', token: `acme${i}.wd1/ext` }, name: `Acme ${i}`, jobs: [job(i)] });
const end = (builtAt, boards) => JSON.stringify({ _end: true, built_at: builtAt, ats: ['workday'], boards, jobs: boards });
const write = (name, lines) => { const p = join(dir, name); writeFileSync(p, gzipSync(`${lines.join('\n')}\n`)); return p; };
const NOW = Date.parse('2026-11-21T12:00:00Z');

test('a complete, fresh file with enough boards is used', async () => {
  const p = write('ok.gz', [line(1), line(2), line(3), end('2026-11-21T09:00:00Z', 3)]);
  const r = await readBoardsFile(p, { maxAgeH: 36, minBoards: 3, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].board.token, 'acme1.wd1/ext');
});

test('incomplete, stale, too small, corrupt or missing files are refused (the build then fetches as usual)', async () => {
  const cases = [
    [write('noend.gz', [line(1), line(2)]), /incomplete/],
    [write('stale.gz', [line(1), end('2026-11-19T09:00:00Z', 1)]), /stale/],
    [write('small.gz', [line(1), end('2026-11-21T09:00:00Z', 1)]), /too few/],
    [write('corrupt.gz', ['{not json', end('2026-11-21T09:00:00Z', 1)]), /corrupt/],
    [join(dir, 'missing.gz'), /unreadable/],
  ];
  for (const [p, rx] of cases) {
    const r = await readBoardsFile(p, { maxAgeH: 36, minBoards: 2, now: NOW });
    assert.equal(r.ok, false, p);
    assert.match(r.reason, rx);
    assert.deepEqual(r.items, []);
  }
  const trunc = join(dir, 'trunc.gz');
  writeFileSync(trunc, gzipSync(`${line(1)}\n${end('2026-11-21T09:00:00Z', 1)}\n`).subarray(0, 30));
  assert.match((await readBoardsFile(trunc, { now: NOW })).reason, /unreadable/);
});
