// Gate verification for the Token Radar entry.
//
// Checks every row of the brief's gate against the built output and the
// sealed snapshot, and prints PASS/FAIL per row:
//
//   1. dashboard files: index.html + >=1 .css + >=1 .js, <=400 files and
//      <=4 MiB, valid names, no http:// or https:// anywhere in the files
//   2. board.json: 100..4000 rows, slugs from the snapshot, ranks 1..N
//      once each, implied values positive whole <= 1e14, non-increasing,
//      not all equal, farm steps 3..12 x 20..600 chars
//   3. coverage: all 40 watchlist slugs present
//   4. dossier.json is byte-for-byte what buildDossier writes, <= 1.5 MiB
//   5. screenshots: 3 PNGs (or JPEGs), each <= 512 KiB, long side <= 1440,
//      short side >= 800
//   6. determinism: main.ts run twice into two dirs gives byte-identical
//      outputs (diff -r)
//   7. page agreement: the dashboard's own farmSteps (app.js) reproduces
//      board.json's steps for every row, and data.js carries the same rows
//
//   node tools/check-gate.mjs [out-dir] [snapshot.json]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const outDir = process.argv[2] ?? join(repo, 'out');
const snapshotPath = process.argv[3] ?? join(repo, '..', 'token-radar-01-kit', 'input', 'snapshot.json');
const require = createRequire(import.meta.url);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = snapshot.watchlist;

// --- 1. dashboard files -------------------------------------------------
{
  const root = join(outDir, 'dashboard');
  const files = [];
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) files.push({ path: p, bad: 'dot-directory' });
        else walk(join(dir, e.name), p);
      } else if (e.isFile()) {
        files.push({ path: p, size: statSync(join(dir, e.name)).size });
      } else {
        files.push({ path: p, bad: 'not a regular file' });
      }
    }
  };
  walk(root);
  const totalBytes = files.reduce((n, f) => n + (f.size ?? 0), 0);
  const nameOk = (s) => /^[A-Za-z0-9._-]{1,128}$/.test(s);
  const badName = files.find((f) => !nameOk(f.path.split('/').pop()) || f.path.split('/').pop().startsWith('.') || f.path.split('/').pop().startsWith('-'));
  const badFile = files.find((f) => f.bad);
  let netOffender = null;
  for (const f of files) {
    const text = readFileSync(join(root, f.path), 'utf8');
    if (text.includes('http://') || text.includes('https://')) { netOffender = f.path; break; }
  }
  const hasHtml = files.some((f) => f.path === 'index.html');
  const hasCss = files.some((f) => f.path.endsWith('.css'));
  const hasJs = files.some((f) => f.path.endsWith('.js'));
  const ok = hasHtml && hasCss && hasJs && files.length <= 400 && totalBytes <= 4 * 1024 * 1024 && !badName && !badFile && !netOffender;
  check(
    'dashboard files',
    ok,
    `${files.length} files, ${totalBytes} bytes, html=${hasHtml} css=${hasCss} js=${hasJs}` +
      (badName ? ` bad name: ${badName.path}` : '') + (badFile ? ` ${badFile.bad}: ${badFile.path}` : '') +
      (netOffender ? ` network address in ${netOffender}` : ''),
  );
}

// --- 2 + 3. board.json ----------------------------------------------------
let board;
{
  const raw = readFileSync(join(outDir, 'board.json'), 'utf8');
  board = JSON.parse(raw).rows;
  const problems = [];
  if (!Array.isArray(board) || board.length < 100 || board.length > 4000) problems.push(`row count ${board?.length}`);
  const seen = new Set();
  const ranks = new Set();
  let prev = Infinity;
  let allEqual = board.length > 1;
  for (const r of board) {
    if (!snapSlugs.has(r.slug)) problems.push(`unknown slug ${r.slug}`);
    if (seen.has(r.slug)) problems.push(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') problems.push(`empty name ${r.slug}`);
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) problems.push(`bad rank ${r.slug}`);
    ranks.add(r.rank);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      problems.push(`bad implied value ${r.slug}: ${r.implied_value_usd}`);
    }
    if (r.implied_value_usd > prev) problems.push(`value rises at rank ${r.rank}`);
    prev = r.implied_value_usd;
    if (r.implied_value_usd !== board[0].implied_value_usd) allEqual = false;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      problems.push(`${r.slug}: ${r.farm_steps?.length} farm steps`);
    } else {
      for (const s of r.farm_steps) {
        const len = s.trim().length;
        if (len < 20 || len > 600) problems.push(`${r.slug}: farm step ${len} chars`);
      }
    }
  }
  for (let i = 1; i <= board.length; i++) if (!ranks.has(i)) problems.push(`rank ${i} missing`);
  if (allEqual) problems.push('all implied values equal');
  check('board.json', problems.length === 0, `${board.length} rows, rank 1 $${board[0].implied_value_usd.toLocaleString('en-US')} → rank ${board.length} $${board[board.length - 1].implied_value_usd.toLocaleString('en-US')}` + (problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : ''));
  const missing = watchlist.filter((s) => !seen.has(s));
  check('watchlist coverage', missing.length === 0, `${watchlist.length - missing.length}/${watchlist.length} covered` + (missing.length ? ` missing: ${missing.slice(0, 5).join(', ')}` : ''));
}

// --- 7a. page agreement: app.js farmSteps vs board.json -------------------
{
  const app = require(join(outDir, 'dashboard', 'app.js'));
  let mismatches = 0;
  let first = '';
  for (const row of board) {
    const pageSteps = app.farmSteps(row);
    const boardSteps = row.farm_steps;
    if (pageSteps.length !== boardSteps.length || pageSteps.some((s, i) => s !== boardSteps[i])) {
      mismatches++;
      if (!first) first = row.slug;
    }
  }
  check('page farm steps match board.json', mismatches === 0, `${board.length - mismatches}/${board.length} rows identical` + (mismatches ? ` first mismatch: ${first}` : ''));
}

// --- 7c. page agreement: app.js econFor vs board.json (both deposits) -----
{
  const app = require(join(outDir, 'dashboard', 'app.js'));
  let mismatches = 0;
  let first = '';
  for (const row of board) {
    for (const dep of [1000, 10000]) {
      const page = app.econFor(row, dep);
      const boardEcon = dep === 1000 ? row.farm_1000 : row.farm_10000;
      const same = ['cost_usd', 'slice_usd', 'net_usd', 'net_per_hour_usd', 'breakeven_odds', 'verdict']
        .every((k) => page[k] === boardEcon[k]);
      if (!same) {
        mismatches++;
        if (!first) first = `${row.slug}@$${dep}`;
        break;
      }
    }
  }
  check('page farm economics match board.json', mismatches === 0, `${board.length - mismatches}/${board.length} rows identical at both deposits` + (mismatches ? ` first mismatch: ${first}` : ''));
}

// --- 7b. data.js carries the same rows ------------------------------------
{
  const text = readFileSync(join(outDir, 'data.js'), 'utf8');
  const prefix = 'window.RADAR=';
  let ok = text.startsWith(prefix) && text.endsWith(';\n');
  let detail = '';
  if (ok) {
    const data = JSON.parse(text.slice(prefix.length, -2));
    const same = data.rows.length === board.length && data.rows.every((r, i) =>
      r.slug === board[i].slug && r.implied_value_usd === board[i].implied_value_usd &&
      JSON.stringify(r.farm_steps) === JSON.stringify(board[i].farm_steps));
    ok = same;
    detail = `${data.rows.length} rows, ${data.peers.length} peers, as_of ${data.as_of}`;
  }
  check('data.js matches board.json', ok, detail);
}

// --- 5. screenshots -------------------------------------------------------
function imageSize(buf, name) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'PNG' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let at = 2;
    while (at < buf.length - 1) {
      if (buf[at] !== 0xff) break;
      const marker = buf[at + 1];
      const len = buf.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5), type: 'JPEG' };
      }
      at += 2 + len;
    }
    throw new Error(`${name}: cannot parse JPEG size`);
  }
  throw new Error(`${name}: neither PNG nor JPEG`);
}
{
  const dir = join(outDir, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  const problems = [];
  const details = [];
  if (names.length < 3 || names.length > 4) problems.push(`${names.length} images`);
  for (const name of names) {
    const buf = readFileSync(join(dir, name));
    if (buf.length > 512 * 1024) problems.push(`${name} ${buf.length} bytes over cap`);
    let size;
    try {
      size = imageSize(buf, name);
    } catch (e) {
      problems.push(e.message);
      continue;
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440) problems.push(`${name} long side ${long}`);
    if (short < 800) problems.push(`${name} short side ${short}`);
    details.push(`${name} ${size.type} ${size.width}x${size.height} ${Math.round(buf.length / 1024)} KiB`);
  }
  check('screenshots', problems.length === 0, details.join(' · ') + (problems.length ? ` — ${problems.join('; ')}` : ''));
}

// --- 4. dossier byte-equality ---------------------------------------------
{
  const { buildDossier } = await import(join(repo, 'vendor', 'makefun-board.ts'));
  const expected = buildDossier(outDir, { text_max_bytes: 65536 });
  const actual = readFileSync(join(outDir, 'dossier.json'));
  const same = Buffer.compare(Buffer.from(expected), actual) === 0;
  check('dossier matches buildDossier', same, `${actual.length} bytes, cap 1.5 MiB: ${actual.length <= 1.5 * 1024 * 1024 ? 'within' : 'OVER'}`);
}

// --- 6. determinism: run main.ts twice, diff -r ----------------------------
{
  const tmpA = '/tmp/tr-gate-a';
  const tmpB = '/tmp/tr-gate-b';
  for (const d of [tmpA, tmpB]) rmSync(d, { recursive: true, force: true });
  const run = (dir) =>
    spawnSync('node', ['main.ts', '--input', snapshotPath], {
      cwd: repo,
      env: { ...process.env, MAKEFUN_OUTPUT_DIR: dir },
      encoding: 'utf8',
    });
  const ra = run(tmpA);
  const rb = run(tmpB);
  let detail = '';
  let ok = ra.status === 0 && rb.status === 0;
  if (!ok) {
    detail = `run A exit ${ra.status}, run B exit ${rb.status}: ${(ra.stderr || rb.stderr || '').slice(0, 200)}`;
  } else {
    try {
      execFileSync('diff', ['-r', tmpA, tmpB], { encoding: 'utf8' });
      detail = 'two runs byte-identical';
    } catch (e) {
      ok = false;
      detail = `diff found: ${(e.stdout || '').slice(0, 300)}`;
    }
  }
  check('determinism (two runs byte-identical)', ok, detail);
  for (const d of [tmpA, tmpB]) rmSync(d, { recursive: true, force: true });
}

// --- 8. model agreement: accounting, bands, verdict counts ---------------
{
  const text = readFileSync(join(outDir, 'data.js'), 'utf8');
  const prefix = 'window.RADAR=';
  const data = JSON.parse(text.slice(prefix.length, -2));
  const problems = [];
  const a = data.accounting;
  if (a.ranked + a.already_trade + a.token_recorded_no_mcap + a.set_aside !== a.total) {
    problems.push(`accounting sums to ${a.ranked + a.already_trade + a.token_recorded_no_mcap + a.set_aside}, not ${a.total}`);
  }
  if (a.ranked !== board.length) problems.push(`accounting ranked ${a.ranked} != board ${board.length}`);
  for (const r of board) {
    if (!(r.band_p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.band_p90_usd)) problems.push(`${r.slug}: implied outside P10-P90`);
    if (!(r.rank_lo <= r.rank && r.rank <= r.rank_hi)) problems.push(`${r.slug}: rank outside rank range`);
    if (r.band_p10_usd <= 0 || r.band_p90_usd <= r.band_p10_usd) problems.push(`${r.slug}: bad band`);
  }
  for (const dep of ['1000', '10000']) {
    const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (const r of board) counts[r[dep === '1000' ? 'farm_1000' : 'farm_10000'].verdict]++;
    const meta = data.verdict_counts[dep];
    if (counts.FARM !== meta.FARM || counts.MARGINAL !== meta.MARGINAL || counts.SKIP !== meta.SKIP) {
      problems.push(`verdict counts @$${dep} differ from meta`);
    }
  }
  const v = data.validation;
  if (!(v.loo.median_miss > 0 && v.loo.within_3x >= 0 && v.loo.within_3x <= 1 && v.walk_forward.median_miss > 0)) {
    problems.push('validation numbers out of range');
  }
  check('model agreement (accounting, bands, verdicts)', problems.length === 0,
    `${a.ranked} ranked + ${a.already_trade} trade + ${a.token_recorded_no_mcap} token-no-mcap + ${a.set_aside} set aside = ${a.total}` +
    `; LOO ${v.loo.median_miss}x, walk-forward ${v.walk_forward.median_miss}x` + (problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : ''));
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\nALL ${results.length} GATE ROWS PASS` : `\n${failed} OF ${results.length} GATE ROWS FAIL`);
process.exit(failed === 0 ? 0 : 1);
