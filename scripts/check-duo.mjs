// Duo layout in fresh browsers with a simulated TV. It needs the private files in .local/duo/, so a public checkout skips it.
import { existsSync } from 'node:fs';
import { networkQuiet, openPreview, root } from './browser.mjs';

if (!existsSync(root + '.local/duo/glass/manifest.json')) {
  console.log('Duo checks skipped: this checkout has no private files in .local/duo/.');
  process.exit(0);
}

const KEY = 'cleanframe.home.v1';
const DEFAULTS = ['netflix', 'youtube', 'primevideo', 'disneyplus', 'appletv', 'spotify'];
const EXTRA = ['Qa12345678.StreamA', 'Qa12345678.StreamB', 'Qa12345678.StreamC'];
const failures = [];
let passed = 0, section = '';
function check(name, ok, detail) {
  if (ok) passed++;
  else { failures.push(section + ': ' + name + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail))); }
}

/* Runs in the page, before the app. The same public API shape as the real adapter expects. */
function installTv(seed) {
  if (seed && !localStorage.getItem(seed.key)) localStorage.setItem(seed.key, JSON.stringify(seed.value));
  const tv = window.__tv = { launched: [], controls: [], sources: [] };
  const catalogue = [['org.tizen.netflix-app', 'Netflix'], ['9Ur5IzDKqV.TizenYouTube', 'YouTube'], ['org.tizen.primevideo', 'Prime Video'], ['MCmYXNxgcu.DisneyPlus', 'Disney+'],
    ['com.samsung.tv.aria-video', 'Apple TV'], ['rJeHak5zRg.Spotify', 'Spotify'], ['Qa12345678.StreamA', 'Stream A'], ['Qa12345678.StreamB', 'Stream B'], ['Qa12345678.StreamC', 'Stream C']]
    .map(([id, name]) => ({ id, name, show: true, iconPath: '' }));
  const hdmi = [1, 2, 3].map(number => ({ type: 'HDMI', number }));
  window.tizen = {
    ApplicationControlData: function (key, value) { this.key = key; this.value = value; },
    ApplicationControl: function (operation, uri, mime, category, data) { this.operation = operation; this.data = data; },
    application: {
      getCurrentApplication: () => ({ appInfo: { id: 'nClrkHome1.FrameHome' } }),
      getAppsInfo(ok) { setTimeout(() => ok(catalogue), 0); },
      launch(id, ok) { tv.launched.push(id); setTimeout(ok, 0); },
      launchAppControl(control, id, ok) { tv.controls.push({ id, data: control.data.map(item => item.key + '=' + item.value) }); setTimeout(ok, 0); }
    },
    systeminfo: { getPropertyValue(name, ok) { setTimeout(() => ok({ connected: hdmi.slice(0, 2), disconnected: hdmi.slice(2) }), 0); } },
    tvwindow: { getSource: () => hdmi[0], setSource(source, ok) { tv.sources.push(source.number); setTimeout(() => ok(source), 0); } }
  };
}

const preview = await openPreview({ duo: true });
async function open({ home, look, time, clock } = {}) {
  const context = await preview.browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => check('no page error', false, error.message));
  page.on('response', response => { if (response.status() >= 400) check('no failed request', false, response.status() + ' ' + response.url()); });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { temperature_2m: 12.4, weather_code: 3 } }) }));
  const value = home || look ? { dock: home || DEFAULTS, look: { layout: 'duo', ...look } } : null;
  await page.addInitScript(installTv, value ? { key: KEY, value } : null);
  if (clock) await page.clock.install();
  if (time) await page.clock.setFixedTime(new Date(time));
  await page.goto(preview.baseURL + '/home/');
  await ready(page);
  return page;
}
const ready = async page => {
  await page.waitForFunction(() => window.ShoreQA && ShoreQA.ready && ShoreQA.ready());
  await networkQuiet(page);
};
const state = page => page.evaluate(() => ShoreQA.state());
const where = page => page.evaluate(() => ShoreQA.where());
const nav = (page, ...keys) => page.evaluate(list => ShoreQA.nav(list), keys);
const tv = page => page.evaluate(() => window.__tv);
const settled = page => page.waitForTimeout(40);
async function goTo(page, action) {
  for (let i = 0; i < 30 && (await where(page)).focusAction !== action; i++) await nav(page, 'right');
  for (let i = 0; i < 30 && (await where(page)).focusAction !== action; i++) await nav(page, 'left');
  check('reaches ' + action, (await where(page)).focusAction === action, await where(page));
}
async function openFromHome(page, action) { await goTo(page, action); await nav(page, 'ok'); await settled(page); }

try {
  section = 'First run';
  {
    const page = await open();
    const s = await state(page), w = await where(page);
    check('a personal build opens in Duo', s.layout === 'duo', s.layout);
    check('Duo counts as a photo background', s.bg === 'photo', s.bg);
    check('the sun decides by default', s.scheme === 'auto', s.scheme);
    check('the last app has the selection', w.focusAction === 'home.app.netflix' && w.focus === 'Netflix', w);
    check('one selection is active', w.focusCount === 1, w);
    const images = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#duoHome img'), img => [img.getAttribute('src'), img.naturalWidth]));
    check('every image of the layout loaded', images.length > 20 && images.every(([, width]) => width > 0), images.filter(([, width]) => !width));
    const shown = await page.evaluate(() => {
      const visible = id => getComputedStyle(document.getElementById(id)).display !== 'none';
      return { duo: visible('duoHome'), dock: visible('dock'), caption: visible('caption'), date: document.getElementById('duoDate').textContent, temp: document.querySelector('.duo-temp').textContent, digits: document.querySelectorAll('#duoClock > div').length, pill: document.getElementById('duoPillLabel').textContent };
    });
    check('the other layouts are out of the way', shown.duo && !shown.dock && !shown.caption, shown);
    check('the date is in French', /^(dim|lun|mar|mer|jeu|ven|sam)\. \d{1,2} [a-zéû]+$/.test(shown.date), shown.date);
    check('the clock has four digits and a colon', shown.digits === 5, shown.digits);
    check('the weather reading reaches the ring', shown.temp === '12°', shown.temp);
    check('the selected name is shown', shown.pill === 'Netflix', shown.pill);
    const clock = await page.evaluate(() => { const boxes = Array.prototype.map.call(document.querySelectorAll('#duoClock > div'), el => el.getBoundingClientRect()); return { left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)), top: boxes[0].top }; });
    check('the clock is centred', Math.abs((clock.left + clock.right) / 2 - 960) < 16, clock);
    await page.context().close();
  }

  section = 'One to nine apps';
  for (let n = 1; n <= 9; n++) {
    const home = DEFAULTS.concat(EXTRA).slice(0, n);
    const page = await open({ home });
    const geo = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      const glass = id => { const b = window.CleanFrameDuo.glass[id]; return { l: b.x + 64, r: b.x + b.w - 64, ...b }; };
      const n = ShoreQA.state().home.length;
      return { n, apps: Array.prototype.map.call(document.querySelectorAll('.duo-app'), box), controls: Array.prototype.map.call(document.querySelectorAll('.duo-control'), box), capApps: glass('apps' + n), capCtrl: glass('ctrl' + n), pill: box(document.getElementById('duoPill')) };
    });
    check(n + ' apps are all in the row', geo.n === n && geo.apps.length === n && geo.controls.length === 5, geo.n);
    const items = geo.apps.concat(geo.controls);
    const clash = items.some((a, i) => i && a.l < items[i - 1].r - .5);
    check(n + ' apps do not overlap', !clash, items.map(a => Math.round(a.l)));
    check(n + ' apps stay in their capsule', geo.apps.every(a => a.l >= geo.capApps.l && a.r <= geo.capApps.r) && geo.controls.every(a => a.l >= geo.capCtrl.l && a.r <= geo.capCtrl.r), { apps: geo.capApps, controls: geo.capCtrl });
    check(n + ' apps leave a gap between the capsules', Math.abs(geo.capCtrl.l - geo.capApps.r - 28) < 1, [geo.capApps.r, geo.capCtrl.l]);
    check(n + ' apps are centred on the screen', Math.abs((geo.capApps.l + geo.capCtrl.r) / 2 - 960) <= 1 && geo.capApps.l >= 0 && geo.capCtrl.r <= 1920, [geo.capApps.l, geo.capCtrl.r]);
    check(n + ' apps keep the name on screen', geo.pill.l >= 80 && geo.pill.r <= 1840, geo.pill);
    await page.context().close();
  }

  section = 'Remote keys';
  {
    const page = await open();
    const order = DEFAULTS.map(id => 'home.app.' + id).concat(['util.art', 'util.inputs', 'util.apps', 'util.samsung', 'util.settings']);
    const seen = [(await where(page)).focusAction];
    for (let i = 1; i < order.length; i++) { await page.keyboard.press('ArrowRight'); seen.push((await where(page)).focusAction); }
    check('Right walks along apps, then controls', seen.join() === order.join(), seen);
    check('still one selection at the end', (await where(page)).focusCount === 1);
    const places = () => page.evaluate(() => {
      const x = el => window.Motion.valueOf(el).x;
      return { items: Array.prototype.map.call(document.querySelectorAll('.duo-app,.duo-control'), x), lens: x(document.getElementById('duoLens')) };
    });
    await page.waitForTimeout(400);
    const rest = await places();
    /* A bounce must leave everything where it was, however the key is pressed. */
    await page.keyboard.press('ArrowRight');
    const out = await places();
    check('a press at the end bounces', out.items[10] === rest.items[10] + 12 && out.lens === rest.lens + 12, out.lens);
    await page.waitForTimeout(400);
    check('the bounce comes back', JSON.stringify(await places()) === JSON.stringify(rest), await places());
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 31; i++) { await page.waitForTimeout(33); await page.keyboard.down('ArrowRight'); }
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(500);
    check('a held key leaves Settings in its place', JSON.stringify(await places()) === JSON.stringify(rest), await places());
    await page.evaluate(() => { ['ArrowRight', 'ArrowRight', 'ArrowRight'].forEach(key => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39, bubbles: true }))); });
    await page.waitForTimeout(500);
    check('a burst of presses leaves it too', JSON.stringify(await places()) === JSON.stringify(rest), await places());
    for (let i = 1; i < order.length; i++) await page.keyboard.press('ArrowLeft');
    check('Left walks back to the first app', (await where(page)).focusAction === order[0], await where(page));
    await page.waitForTimeout(400);
    const left = await places();
    await page.keyboard.down('ArrowLeft');
    for (let i = 0; i < 29; i++) { await page.waitForTimeout(33); await page.keyboard.down('ArrowLeft'); }
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(500);
    check('a held key leaves Netflix in its place', JSON.stringify(await places()) === JSON.stringify(left), await places());
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
    check('Up and Down do nothing on Home', (await where(page)).focusAction === order[0], await where(page));
    await page.keyboard.press('Escape');
    check('Back opens the choice to leave', (await where(page)).view === 'message', await where(page));
    await page.keyboard.press('Escape');
    check('Back again returns to Home', (await where(page)).view === 'home' && (await where(page)).focusAction === order[0], await where(page));
    await page.context().close();
  }

  section = 'The seven functions';
  {
    const page = await open();
    await goTo(page, 'home.app.youtube');
    await nav(page, 'ok'); await settled(page);
    check('OK launches the selected app', (await tv(page)).launched.pop() === '9Ur5IzDKqV.TizenYouTube', await tv(page));
    check('the launched app is remembered', (await state(page)).lastApp === 'youtube');

    await openFromHome(page, 'util.art');
    check('Art Mode asks the Art app', (await tv(page)).controls.some(c => c.id === 'org.tizen.art-app' && c.data.includes('mode=fullscreen')), await tv(page));

    await openFromHome(page, 'util.samsung');
    check('Menu Samsung opens the original Home', (await tv(page)).launched.includes('com.samsung.tv.csfs'), await tv(page));

    await openFromHome(page, 'util.inputs');
    check('Inputs opens the chooser', (await where(page)).settingsGroup === 'inputs', await where(page));
    const inputs = await page.evaluate(() => ShoreQA.actions());
    check('the TV inputs are listed', ['input.1', 'input.2', 'input.3'].every(action => inputs.includes(action)), inputs);
    for (let i = 0; i < 5 && (await where(page)).focusAction !== 'input.2'; i++) await nav(page, 'down');
    await nav(page, 'ok'); await settled(page);
    const routed = await tv(page);
    check('OK switches to that input', routed.sources.includes(2) && routed.launched.includes('org.tizen.tv-viewer'), routed);
    await nav(page, 'back'); await settled(page);
    check('Back leaves the inputs', (await where(page)).view === 'home', await where(page));

    await openFromHome(page, 'util.apps');
    check('All apps opens', (await where(page)).view === 'apps', await where(page));
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded);
    check('All apps reads the TV', (await state(page)).catalog.ids.length >= 9, (await state(page)).catalog.ids.length);
    await nav(page, 'back'); await settled(page);

    await openFromHome(page, 'util.settings');
    check('Settings opens', (await where(page)).view === 'settings', await where(page));
    const rows = await page.evaluate(() => ShoreQA.actions());
    check('Settings only offers what Duo uses', rows.some(a => /scheme/.test(a)) && !rows.some(a => /background|typography|focus/.test(a)), rows);
    for (let i = 0; i < 2; i++) await nav(page, 'down');
    await nav(page, 'ok'); await settled(page);
    check('Apps on Home opens the editor', (await where(page)).view === 'editor', await where(page));
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded);
    const before = (await state(page)).home.length;
    await nav(page, 'right', 'ok'); await settled(page);
    check('the editor removes an app', (await state(page)).home.length === before - 1, (await state(page)).home);
    await nav(page, 'back', 'down'); await settled(page);
    await nav(page, 'ok'); await settled(page);
    check('Samsung opens its group', (await where(page)).settingsGroup === 'samsung', await where(page));
    await page.evaluate(() => ShoreQA.activate('samsung.settings')); await settled(page);
    check('TV settings opens Samsung\'s settings', (await tv(page)).launched.includes('com.samsung.tv.coba.setting'), await tv(page));
    await nav(page, 'back', 'back'); await settled(page);
    check('Home is back with one app fewer', (await page.evaluate(() => document.querySelectorAll('.duo-app').length)) === before - 1);
    check('the glass follows the number of apps', (await page.evaluate(() => document.querySelector('#duoCapApps img').getAttribute('src'))).includes('apps' + (before - 1) + '-'));
    await page.context().close();
  }

  section = 'Rest';
  {
    const page = await open({ clock: true });
    await goTo(page, 'home.app.primevideo');
    await page.clock.fastForward(19000);
    check('the row stays for 20 seconds', (await state(page)).duo.idle === false);
    await page.clock.fastForward(1500);
    check('then it steps aside', (await state(page)).duo.idle === true);
    const row = () => page.evaluate(() => window.Motion.valueOf(document.getElementById('duoRow')).o);
    check('the row fades out', await row() === 0, await row());
    await page.keyboard.press('ArrowRight');
    check('the first key only brings it back', (await state(page)).duo.idle === false && (await where(page)).focusAction === 'home.app.primevideo', await where(page));
    check('the row fades in', await row() === 1, await row());
    await page.keyboard.press('ArrowRight');
    check('the next key moves again', (await where(page)).focusAction === 'home.app.disneyplus', await where(page));
    await goTo(page, 'util.settings'); await nav(page, 'ok'); await settled(page);
    await page.clock.fastForward(25000);
    check('no rest while a panel is open', (await state(page)).duo.idle === false);
    await page.context().close();
  }

  section = 'Day and night';
  {
    const level = async time => { const page = await open({ time }); const s = await state(page); await page.context().close(); return s.duo; };
    const noon = await level('2026-11-06T12:00:00+01:00');
    check('noon in Paris is day', noon.level === 0 && noon.scheme === 'day', noon);
    const dusk = await level('2026-11-06T18:00:00+01:00');
    check('dusk is between the two', dusk.level > 0 && dusk.level < 1, dusk);
    const late = await level('2026-11-06T23:00:00+01:00');
    check('late evening is night', late.level === 1 && late.scheme === 'night', late);

    const page = await open({ time: '2026-11-06T12:00:00+01:00' });
    const look = () => page.evaluate(() => ({
      stage: document.getElementById('stage').className.includes('sch-night'),
      night: Array.prototype.map.call(document.querySelectorAll('#duoHome .duo-night'), el => el.style.opacity),
      frost: document.getElementById('duoPillField').getAttribute('src'),
      sheet: document.getElementById('sheetBg').getAttribute('src')
    }));
    check('day: the night images are transparent', (await look()).night.every(o => o === '0') && !(await look()).stage, await look());
    await page.evaluate(() => ShoreQA.look({ scheme: 'night' })); await page.waitForFunction(() => ShoreQA.state().duo.scheme === 'night');
    const dark = await look();
    check('Night forces the night images', dark.night.every(o => o === '1') && dark.night.length > 7 && dark.stage, dark);
    check('Night changes the frost too', dark.frost.includes('frost-night') && dark.sheet.includes('frost-night'), dark);
    check('the choice is saved', (await page.evaluate(k => JSON.parse(localStorage.getItem(k)).look.scheme, KEY)) === 'night');
    await page.reload(); await ready(page);
    check('the choice survives a restart', (await state(page)).scheme === 'night' && (await state(page)).duo.level === 1, (await state(page)).duo);
    await page.context().close();
  }

  section = 'Sun position';
  {
    const page = await open();
    /* Independent values: altitude at local solar noon = 90 - latitude + declination. */
    const at = (time, lat, lon) => page.evaluate(([t, a, o]) => ShoreQA.sunAltitude(new Date(t), a, o), [time, lat, lon]);
    const close = (value, expected, margin = .5) => Math.abs(value - expected) <= margin;
    check('March equinox noon', close(await at('2026-03-20T11:53:00Z', 45.2, .78), 44.8), await at('2026-03-20T11:53:00Z', 45.2, .78));
    check('June solstice noon', close(await at('2026-06-21T11:58:00Z', 45.2, .78), 68.2), await at('2026-06-21T11:58:00Z', 45.2, .78));
    check('December solstice noon', close(await at('2026-12-21T11:55:00Z', 45.2, .78), 21.4), await at('2026-12-21T11:55:00Z', 45.2, .78));
    check('midnight in June is below the horizon', await at('2026-06-21T23:58:00Z', 45.2, .78) < -20);
    await page.context().close();
  }

  section = 'Settings preview';
  {
    const page = await open();
    await goTo(page, 'util.settings');
    await nav(page, 'ok', 'down', 'ok'); await settled(page);
    check('Layout opens', (await where(page)).settingsGroup === 'layout', await where(page));
    check('one selection stays active', (await where(page)).focusCount === 1, await where(page));
    const scene = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
      return { scene: box(document.getElementById('scene')), date: box(document.getElementById('duoDate')), row: box(document.getElementById('duoCapCtrl')), focus: document.querySelectorAll('#duoItems .is-focus').length };
    });
    check('the preview is at 48 %', Math.abs(scene.scene.w - 1920 * .48) < 1, scene.scene);
    check('the row fits in the preview', scene.row.r <= scene.scene.r + 1 && scene.row.l >= scene.scene.l, scene);
    check('the preview does not take the focus', scene.focus === 0, scene.focus);
    const choices = await page.evaluate(() => ShoreQA.actions());
    check('the three layouts are offered', ['choice.layout.list', 'choice.layout.dock', 'choice.layout.duo'].every(a => choices.includes(a)), choices);
    check('the single group repeats no title', await page.locator('.setting-label').count() === 0, await page.locator('.setting-label').allTextContents());
    await page.evaluate(() => ShoreQA.activate('choice.layout.dock')); await ready(page);
    check('Dock can still be chosen', (await state(page)).layout === 'dock', (await state(page)).layout);
    check('its photo and glass are loaded', await page.evaluate(() => document.getElementById('photo').naturalWidth > 0 && document.getElementById('dock').getBoundingClientRect().width > 0));
    await page.evaluate(() => ShoreQA.activate('choice.layout.list')); await ready(page);
    check('List can still be chosen', (await state(page)).layout === 'list', (await state(page)).layout);
    await page.evaluate(() => ShoreQA.activate('choice.layout.duo')); await ready(page);
    check('Duo comes back', (await state(page)).layout === 'duo' && (await page.evaluate(() => getComputedStyle(document.getElementById('duoHome')).display)) === 'block');
    await page.context().close();
  }
  {
    const page = await open({ home: DEFAULTS.concat(EXTRA) });
    await goTo(page, 'util.settings');
    await page.evaluate(() => { ShoreQA.activate('util.settings'); ShoreQA.activate('settings.editor'); });
    await settled(page);
    const rows = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.ed-home .er'), row => Math.round(row.getBoundingClientRect().top)));
    check('the editor does not promise a scroll', await page.locator('.ed-order-break.is-on').count() === 0);
    check('the editor keeps an even rhythm', rows.length === 9 && rows.every((top, i) => !i || top - rows[i - 1] === rows[1] - rows[0]), rows);
    await page.context().close();
  }

  section = 'Speed';
  {
    const page = await open();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // Keys arrive about every 30 ms when held. The limit is the plan's frame budget; the TV itself is only measured at the end.
    const times = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 44; i++) {
        const key = new KeyboardEvent('keydown', { keyCode: i % 22 < 11 ? 39 : 37, bubbles: true });
        const start = performance.now();
        document.dispatchEvent(key);
        out.push(performance.now() - start);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return out.sort((a, b) => a - b);
    });
    const p95 = times[Math.floor(times.length * .95)];
    check('a key costs little, even at a quarter of the speed', p95 < 20, p95);
    console.log('Duo key p95 at 4x slowdown: ' + p95.toFixed(1) + ' ms');
    await page.context().close();
  }
} finally {
  await preview.close();
}

/* A public preview has no Duo at all, even with a saved choice. */
section = 'Public build';
{
  const preview = await openPreview({ publicFonts: true });
  try {
    const context = await preview.browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('https://api.open-meteo.com/**', route => route.abort());
    await page.addInitScript(installTv, { key: KEY, value: { dock: DEFAULTS, look: { layout: 'duo' } } });
    await page.goto(preview.baseURL + '/home/');
    await page.waitForFunction(() => window.ShoreQA && ShoreQA.ready && ShoreQA.ready());
    check('the catalogue is empty', await page.evaluate(() => window.CleanFrameDuo === null));
    check('a saved Duo falls back to Dock', (await state(page)).layout === 'dock', (await state(page)).layout);
    check('nothing private is asked for', !requests.some(url => url.includes('/assets/duo/')), requests.filter(url => url.includes('/assets/duo/')));
    const direct = await page.evaluate(() => fetch('assets/duo/wall-day.webp').then(r => r.status));
    check('the private files are not served', direct === 404, direct);
    await context.close();
  } finally { await preview.close(); }
}

if (failures.length) { console.error(failures.join('\n')); console.error(failures.length + ' Duo checks failed; ' + passed + ' passed.'); process.exit(1); }
console.log(passed + ' Duo checks passed.');
