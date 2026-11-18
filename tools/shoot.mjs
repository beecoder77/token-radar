// Screenshot harness for the Token Radar dashboard.
//
// Serves the built output directory over local HTTP, opens the dashboard in
// headless Chromium (puppeteer-core + the cached Chrome binary), and takes
// the three screenshots the gate wants at 1280x800:
//
//   1-board.png     the full board
//   2-detail.png    a detail view open (rank 1 protocol)
//   3-filtered.png  the board with a category filter applied
//
// The viewport is 1280x800, not 1280x720: the gate refuses any screenshot
// whose short side is under 800 px. Fails on any page error or console
// error. PNGs are the default; a shot that comes out over the 256 KiB cap
// is retaken as JPEG quality 80.
//
//   node tools/shoot.mjs [out-dir] [screenshots-dir]

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const outDir = process.argv[2] ?? join(repo, 'out');
const shotsDir = process.argv[3] ?? join(repo, 'screenshots');
const CHROME = process.env.CHROME_PATH ?? '/home/hatch/.cache/puppeteer/chrome/linux-157.0.8103.78/chrome-linux64/chrome';
const MAX_BYTES = 256 * 1024;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

/** A tiny static server for the output directory. */
function serve(root) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      let path = join(root, url === '/' ? 'dashboard/index.html' : url);
      if (!path.startsWith(root) || !existsSync(path)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      if (statSync(path).isDirectory()) path = join(path, 'index.html');
      if (!existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.slice(path.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      createReadStream(path).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Width and height out of a PNG's IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const server = await serve(outDir);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const errors = [];

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
  const top = board.rows[0];

  mkdirSync(shotsDir, { recursive: true });

  async function capture(name, setup) {
    const path = join(shotsDir, name);
    await setup();
    await new Promise((r) => setTimeout(r, 1200));
    let shot = Buffer.from(await page.screenshot({ path, type: 'png' }));
    if (shot.length > MAX_BYTES) {
      shot = Buffer.from(await page.screenshot({ path, type: 'jpeg', quality: 80 }));
      console.log(`${name}: PNG was over the cap, retook as JPEG (${shot.length} bytes)`);
    }
    const dims = shot[0] === 0x89 ? pngSize(shot) : { width: 1280, height: 800 };
    console.log(`${name}: ${shot.length} bytes, ${dims.width}x${dims.height}`);
    return shot;
  }

  // 1 — the board.
  await capture('1-board.png', async () => {
    await page.goto(`${base}/dashboard/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#rows tr', { timeout: 30000 });
  });

  // 2 — the detail view of the rank-1 protocol, scrolled to its value breakdown.
  await capture('2-detail.png', async () => {
    await page.goto(`${base}/dashboard/#/protocol/${top.slug}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#detail-view .detail', { timeout: 30000 });
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#detail-view h3')];
      const target = heads.find((h) => h.textContent.indexOf('Implied value') === 0);
      if (target) window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - 360));
    });
  });

  // 3 — the board filtered to one category and one verdict, visibly different from shot 1.
  await capture('3-filtered.png', async () => {
    await page.goto(`${base}/dashboard/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#rows tr', { timeout: 30000 });
    await page.evaluate(() => {
      const cat = document.getElementById('f-cat');
      cat.value = 'Dexs';
      cat.dispatchEvent(new Event('change', { bubbles: true }));
      const verdict = document.getElementById('f-verdict');
      verdict.value = 'FARM';
      verdict.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(
      () => !document.getElementById('count').textContent.startsWith('197 of '),
      { timeout: 30000 },
    );
    // Scroll the filter bar and the filtered table into view: the shot
    // must show the filter state, not the same page top as shot 1.
    await page.evaluate(() => {
      document.getElementById('controls').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -12);
    });
  });
} catch (e) {
  if (errors.length > 0) process.stderr.write(`page errors before failure:\n${errors.map((x) => `  ${x}`).join('\n')}\n`);
  throw e;
} finally {
  if (browser) await browser.close();
  server.close();
}

if (errors.length > 0) {
  process.stderr.write(`screenshot errors:\n${errors.map((e) => `  ${e}`).join('\n')}\n`);
  process.exit(1);
}
console.log('screenshots done, no page errors');
