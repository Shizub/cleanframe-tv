// Takes the README's pictures from the real app with the simulated TV, in a fresh browser.
//   node scripts/capture-showcase.mjs [output-dir]
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openPreview, root } from './browser.mjs';

const output = resolve(process.argv[2] || join(root, 'docs/images'));
mkdirSync(output, { recursive: true });
const demoTv = readFileSync(join(root, 'demo/demo-tv.js'), 'utf8');
const weather = { current: { temperature_2m: 12.4, weather_code: 3 } };
const preview = await openPreview({ duo: true });

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

const MORNING = '2026-11-05T09:41:00+01:00', EVENING = '2026-11-05T22:30:00+01:00';
try {
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
} finally {
  await preview.close();
}
