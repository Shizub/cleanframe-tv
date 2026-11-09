// Takes the README's pictures from the real app with the simulated TV, in a fresh browser.
// The last step needs NumPy and Pillow: set CLEANFRAME_PYTHON if python3 has neither.
//   npm run showcase [-- output-dir]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPreview, root } from './browser.mjs';

const output = resolve(process.argv[2] || join(root, 'docs/images'));
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'cleanframe-showcase-'));
mkdirSync(join(work, 'frames'));
const demoTv = readFileSync(join(root, 'demo/demo-tv.js'), 'utf8');
const weather = { current: { temperature_2m: 12.4, weather_code: 3 } };
const preview = await openPreview({ duo: true });

// The README is public, so stop before a wallpaper private to this computer can reach a picture.
async function refusePrivateWalls() {
  const catalog = await fetch(preview.baseURL + '/home/assets/duo-catalog.js').then(response => response.text());
  const published = new Set(readdirSync(join(root, 'duo-pack/themes')));
  const walls = [...catalog.slice(catalog.indexOf('"walls"')).matchAll(/"id":"([^"]+)"/g)].map(match => match[1]);
  const unpublished = walls.filter(id => !published.has(id));
  if (!walls.length || unpublished.length) throw new Error('No picture taken: this build shows wallpapers that are not public (' + unpublished.join(', ') + ').');
}

async function open(time, viewport = { width: 1920, height: 1080 }) {
  const context = await preview.browser.newContext({ viewport, timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(weather) }));
  await page.addInitScript(demoTv);
  await page.clock.setFixedTime(new Date(time));
  await page.goto(preview.baseURL + '/home/');
  await page.waitForFunction(() => window.ShoreQA && ShoreQA.ready && ShoreQA.ready());
  await page.waitForTimeout(1600);
  return page;
}
const nav = (page, ...keys) => page.evaluate(list => ShoreQA.nav(list), keys);
const focus = page => page.evaluate(() => ShoreQA.where().focusAction);
async function goTo(page, action) {
  for (let i = 0; i < 30 && await focus(page) !== action; i++) await nav(page, 'right');
  for (let i = 0; i < 30 && await focus(page) !== action; i++) await nav(page, 'left');
  if (await focus(page) !== action) throw new Error('Could not reach ' + action + ', stopped on ' + await focus(page));
}
async function shot(page, name) {
  await page.waitForTimeout(1100);
  await page.screenshot({ path: join(output, name + '.jpg'), type: 'jpeg', quality: 90 });
  console.log(name);
}

// Both halves of the hero, at the same minute, for assemble-showcase.py to join along a diagonal.
async function heroHalves() {
  for (const scheme of ['day', 'night']) {
    const page = await open('2026-11-05T20:41:00+01:00');
    await page.evaluate(value => ShoreQA.look({ scheme: value }), scheme);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(work, 'hero-' + scheme + '.png') });
    await page.context().close();
  }
}

// A short walk along the row, into the settings, and through two wallpapers.
async function filmFrames() {
  const page = await open('2026-11-05T09:41:00+01:00', { width: 1280, height: 720 });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async frame => {
    frames.push({ t: frame.metadata.timestamp, data: frame.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 86, maxWidth: 960, maxHeight: 540, everyNthFrame: 1 });
  const press = async (key, wait) => { await page.keyboard.press(key); await page.waitForTimeout(wait); };
  await page.waitForTimeout(900);
  for (let i = 0; i < 3; i++) await press('ArrowRight', 380);
  await page.waitForTimeout(300);
  for (let i = 0; i < 7; i++) await press('ArrowRight', 170);
  await page.waitForTimeout(500);
  for (const [key, wait] of [['Enter', 1000], ['ArrowDown', 500], ['Enter', 1100], ['ArrowRight', 500], ['Enter', 1500], ['ArrowRight', 500], ['ArrowDown', 500], ['Enter', 1500], ['Escape', 800], ['Escape', 1300]]) await press(key, wait);
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(200);
  frames.forEach((frame, i) => writeFileSync(join(work, 'frames', String(i).padStart(4, '0') + '.jpg'), Buffer.from(frame.data, 'base64')));
  writeFileSync(join(work, 'frames.json'), JSON.stringify(frames.map(frame => frame.t)));
  await page.context().close();
}

const MORNING = '2026-11-05T09:41:00+01:00', EVENING = '2026-11-05T22:30:00+01:00';
try {
  await refusePrivateWalls();
  let page = await open(MORNING);
  await shot(page, 'duo-day');
  await goTo(page, 'util.settings'); await nav(page, 'ok');
  await shot(page, 'duo-settings-day');
  await nav(page, 'down'); await nav(page, 'ok');
  await page.waitForTimeout(500);
  await nav(page, 'right'); await nav(page, 'down');
  await shot(page, 'duo-gallery-day');
  await page.context().close();

  page = await open(EVENING);
  await goTo(page, 'util.samsung');
  await shot(page, 'duo-night');
  await goTo(page, 'util.apps'); await nav(page, 'ok');
  await page.waitForTimeout(400);
  await shot(page, 'duo-apps-night');
  await page.context().close();

  page = await open(MORNING);
  await goTo(page, 'util.inputs'); await nav(page, 'ok');
  await page.waitForTimeout(400);
  await shot(page, 'duo-inputs-day');
  await page.context().close();

  page = await open(EVENING);
  await page.evaluate(() => ShoreQA.scene('editor'));
  await page.waitForTimeout(400);
  await shot(page, 'duo-editor-night');
  await page.context().close();

  page = await open(MORNING);
  await page.keyboard.press('=');
  await page.waitForTimeout(120);
  await page.keyboard.press('=');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(output, 'duo-volume-day.jpg'), type: 'jpeg', quality: 90 });
  console.log('duo-volume-day');
  await page.context().close();

  await heroHalves();
  await filmFrames();
  const assembled = spawnSync(process.env.CLEANFRAME_PYTHON || 'python3', [join(root, 'scripts/assemble-showcase.py'), work, output], { stdio: 'inherit' });
  if (assembled.status !== 0) throw new Error('assemble-showcase.py failed');
} finally {
  await preview.close();
  rmSync(work, { recursive: true, force: true });
}
