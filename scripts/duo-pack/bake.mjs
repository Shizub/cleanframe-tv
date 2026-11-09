// Bakes the Duo glass for one wallpaper in a browser, on a computer, once.
//   node scripts/duo-pack/bake.mjs <work-dir> [--shared]
// The work directory holds wall-day.png and wall-night.png from make-walls.py.
// --shared also bakes what every wallpaper shares: the app tiles and the glyphs.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchOptions, root } from '../browser.mjs';

const args = process.argv.slice(2);
const shared = args.includes('--shared');
const workArg = args.find(arg => !arg.startsWith('--'));
if (!workArg) {
  console.error('Usage: node scripts/duo-pack/bake.mjs <work-dir> [--shared]');
  process.exit(2);
}
const work = resolve(workArg);
const out = join(work, 'out');
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const MOUNTS = [
  ['/lab.html', join(root, 'scripts/duo-pack/lab.html')],
  ['/fonts/manrope.woff2', join(root, 'app/assets/manrope.woff2')],
  ['/renderer/', join(root, 'scripts/duo-pack/renderer')],
  ['/icons/', join(root, 'app/assets/icons')],
  ['/walls/', work],
];

function fileFor(url) {
  for (const [prefix, target] of MOUNTS) {
    if (url === prefix) return target;
    if (prefix.endsWith('/') && url.startsWith(prefix)) {
      const path = normalize(join(target, url.slice(prefix.length)));
      return path.startsWith(target) ? path : null;
    }
  }
  return null;
}

const server = createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0]);
  const save = url.match(/^\/save\/([A-Za-z0-9._-]+)$/);
  if (request.method === 'POST' && save) {
    const parts = [];
    request.on('data', chunk => parts.push(chunk));
    request.on('end', () => { writeFileSync(join(out, save[1]), Buffer.concat(parts)); response.writeHead(204).end(); });
    return;
  }
  const file = fileFor(url);
  if (!file || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(readFileSync(file));
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const base = 'http://127.0.0.1:' + server.address().port;

const flags = ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// Playwright's own Chromium when it is installed, otherwise the computer's Chrome.
const browser = await chromium.launch(launchOptions(flags)).catch(() => chromium.launch({ ...launchOptions(flags), channel: 'chrome' }));
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => console.error('page error:', error.message));
  await page.goto(base + '/lab.html');
  await page.waitForFunction(() => window.labReady === true);
  await page.evaluate(() => window.bakeGlass());
  if (shared) {
    await page.evaluate(() => window.bakeIcons());
    await page.evaluate(() => window.bakeGlyphs());
  }
} finally {
  await browser.close();
  server.close();
}
