// Duo layout in fresh browsers with a simulated TV. It needs the private files in .local/duo/, so a public checkout skips it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
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
  if (seed.value && !localStorage.getItem(seed.key)) localStorage.setItem(seed.key, JSON.stringify(seed.value));
  const frame = window.requestAnimationFrame;
  window.__frames = 0;
  window.requestAnimationFrame = run => { window.__frames++; return frame.call(window, run); };
  if (seed.noTv) return;
  window.__hidden = !!seed.hidden;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
  const tv = window.__tv = { launched: [], controls: [], sources: [], reads: 0, refuse: false, refuseSource: false, noSources: false, noApps: false, connected: [1, 2], keys: [], volume: { level: 18, muted: false, refuse: false } };
  tv.catalogue = [['org.tizen.netflix-app', 'Netflix'], ['9Ur5IzDKqV.TizenYouTube', 'YouTube'], ['org.tizen.primevideo', 'Prime Video'], ['MCmYXNxgcu.DisneyPlus', 'Disney+'],
    ['com.samsung.tv.aria-video', 'Apple TV'], ['rJeHak5zRg.Spotify', 'Spotify'], ['Qa12345678.StreamA', 'Stream A'], ['Qa12345678.StreamB', 'Stream B'], ['Qa12345678.StreamC', 'Stream C']]
    .concat(Array.from({ length: seed.more || 0 }, (_, i) => ['Qa12345678.Extra' + (i + 10), 'Extra ' + (i + 10)]))
    .filter(([id]) => !(seed.missing || []).includes(id))
    .map(([id, name]) => ({ id, name, show: true, iconPath: '' }));
  const hdmi = [1, 2, 3].map(number => ({ type: 'HDMI', number }));
  window.tizen = {
    ApplicationControlData: function (key, value) { this.key = key; this.value = value; },
    ApplicationControl: function (operation, uri, mime, category, data) { this.operation = operation; this.data = data; },
    application: {
      getCurrentApplication: () => ({ appInfo: { id: 'nClrkHome1.FrameHome' } }),
      getAppsInfo(ok, fail) { tv.reads++; setTimeout(() => (tv.noApps ? fail({ message: 'Applis illisibles.' }) : ok(tv.catalogue)), 0); },
      launch(id, ok, fail) { tv.launched.push(id); setTimeout(() => (tv.refuse ? fail({ message: 'La télé a refusé.' }) : ok()), 0); },
      launchAppControl(control, id, ok) { tv.controls.push({ id, data: control.data.map(item => item.key + '=' + item.value) }); setTimeout(ok, 0); }
    },
    systeminfo: {
      getPropertyValue(name, ok, fail) { setTimeout(() => (tv.noSources ? fail({ message: 'Entrées illisibles.' }) : ok({ connected: hdmi.filter(s => tv.connected.includes(s.number)), disconnected: hdmi.filter(s => !tv.connected.includes(s.number)) })), 0); },
      addPropertyValueChangeListener(name, run) { window.__plug = run; }
    },
    tvwindow: { getSource: () => hdmi[0], setSource(source, ok, fail) { tv.sources.push(source.number); setTimeout(() => (tv.refuseSource ? fail({ message: 'Entrée refusée.' }) : ok(source)), 0); } }
  };
  if (seed.noAudio) return;
  const refused = () => { if (tv.volume.refuse) throw Error('Refusé.'); };
  window.tizen.tvaudiocontrol = {
    getVolume: () => tv.volume.level, isMute: () => tv.volume.muted,
    setVolumeUp() { refused(); tv.volume.level = Math.min(100, tv.volume.level + 1); tv.volume.muted = false; },
    setVolumeDown() { refused(); tv.volume.level = Math.max(0, tv.volume.level - 1); tv.volume.muted = false; },
    setMute(value) { refused(); tv.volume.muted = value; }
  };
  window.tizen.tvinputdevice = {
    getKey: name => ({ VolumeUp: 447, VolumeDown: 448, VolumeMute: 449 }[name] ? { name, code: { VolumeUp: 447, VolumeDown: 448, VolumeMute: 449 }[name] } : null),
    registerKey(name) { tv.keys.push(name); },
    unregisterKey(name) { tv.keys = tv.keys.filter(key => key !== name); }
  };
}

const preview = await openPreview({ duo: true });
async function open({ home, look, time, clock, more, missing, hidden, devices, noAudio, noTv, prepare, wait = true, viewport = { width: 1920, height: 1080 }, browser = preview.browser, url = preview.baseURL + '/home/' } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.sounds = [];
  page.failed = [];
  page.on('requestfailed', request => page.failed.push(request.url()));
  page.on('request', request => { if (request.url().endsWith('.pcm')) page.sounds.push(request.url().split('/').pop()); });
  page.on('pageerror', error => check('no page error', false, error.message));
  page.on('response', response => { if (response.status() >= 400) check('no failed request', false, response.status() + ' ' + response.url()); });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { temperature_2m: 12.4, weather_code: 3 } }) }));
  const value = home || look || devices ? { dock: home || DEFAULTS, look: { layout: 'duo', ...look }, devices } : null;
  // The clock first, so that the count of frames in installTv sees what the app asks of it.
  if (clock) await page.clock.install();
  await page.addInitScript(installTv, { key: KEY, value, more, missing, hidden, noAudio, noTv });
  if (time) await page.clock.setFixedTime(new Date(time));
  if (prepare) await prepare(page);
  await page.goto(url, { waitUntil: wait ? 'load' : 'commit' });
  if (wait) await ready(page);
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
/* Long enough for a spring to end, even on a loaded machine. */
const rested = page => page.waitForTimeout(900);
const card = page => page.evaluate(() => {
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cards = Array.prototype.filter.call(document.querySelectorAll('.duo-card'), el => getComputedStyle(el).visibility !== 'hidden');
  const el = cards[cards.length - 1], text = selector => { const found = el && el.querySelector(selector); return found ? found.textContent : null; };
  return { count: cards.length, box: box(el), title: text('.duo-title'), sub: text('.duo-sub'), field: box(el && el.querySelector('.duo-card-field')), plate: box(el && el.querySelector('.duo-plate')), focus: box(el && el.querySelector('.is-focus')),
    rows: el ? Array.prototype.map.call(el.querySelectorAll('.duo-line-name'), row => row.textContent) : [], checked: el ? Array.prototype.map.call(el.querySelectorAll('.duo-line.is-checked .duo-line-name'), row => row.textContent) : [] };
});
const value = (page, selector, key) => page.evaluate(([s, k]) => window.Motion.valueOf(document.querySelector(s))[k], [selector, key]);
const toast = page => page.evaluate(() => document.getElementById('duoToast').textContent);
const saved = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const loaded = page => page.waitForFunction(() => ShoreQA.state().catalog.loaded && !ShoreQA.state().catalog.loading);
/* What the launcher sees when it comes back on screen after another app. */
const comeBack = async page => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await loaded(page); await settled(page); };
const uninstall = (page, ...ids) => page.evaluate(list => { window.__tv.catalogue = window.__tv.catalogue.filter(a => !list.includes(a.id)); }, ids);
const lines = (page, where) => page.evaluate(column => Array.prototype.filter.call(document.querySelectorAll('.duo-eline.is-' + column), () => true).sort((a, b) => window.Motion.valueOf(a).y - window.Motion.valueOf(b).y).map(el => el.querySelector('.duo-eline-name').textContent), where);
const VOLUME = { up: 447, down: 448, mute: 449 };
const volumeKey = (page, name) => page.evaluate(code => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true })), VOLUME[name]);
const logos = page => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-card:not(.is-leaving) .duo-line img'), img => [img.getAttribute('src').split('/').pop(), img.naturalWidth > 0]));

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
    check('starting up shows no message', await toast(page) === '', await toast(page));
    const clock = await page.evaluate(() => { const boxes = Array.prototype.map.call(document.querySelectorAll('#duoClock > div'), el => el.getBoundingClientRect()); return { left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)), top: boxes[0].top }; });
    check('the clock is centred', Math.abs((clock.left + clock.right) / 2 - 960) < 16, clock);
    await page.context().close();
  }

  section = 'Arrival';
  {
    const opacity = page => page.evaluate(() => getComputedStyle(document.getElementById('duoHome')).opacity);
    const arrived = page => page.waitForFunction(() => getComputedStyle(document.getElementById('duoHome')).opacity === '1');
    const waiting = page => page.waitForFunction(() => document.getElementById('duoHome') && document.getElementById('duoHome').className.includes('is-arriving'));
    let release;
    const held = new Promise(done => { release = done; });
    let page = await open({ wait: false, prepare: p => p.route('**/assets/duo/wall-*.webp', async route => { await held; await route.continue(); }) });
    await waiting(page); await page.waitForTimeout(400);
    check('nothing shows while the wallpaper is on its way', await opacity(page) === '0', await opacity(page));
    release();
    await arrived(page);
    check('then the launcher arrives whole', await page.evaluate(() => document.getElementById('duoDayImg').naturalWidth > 0 && document.getElementById('duoHome').className === 'duo-home'));
    await page.context().close();
    page = await open({ prepare: p => p.route('**/assets/duo/glass/ring-*.webp', route => route.abort()) });
    await arrived(page);
    check('a missing image does not hold it', await opacity(page) === '1', await opacity(page));
    await page.context().close();
    page = await open({ wait: false, prepare: p => p.route('**/assets/duo/wall-night.webp', () => {}) });
    await waiting(page); await page.waitForTimeout(3000);
    check('nor does one that never comes', await opacity(page) === '1' && (await where(page)).focusCount === 1, await opacity(page));
    await page.context().close();
    page = await open({ look: { layout: 'dock' } });
    check('Dock does not wait', await page.evaluate(() => !document.getElementById('duoHome').className.includes('is-arriving')));
    await page.evaluate(() => ShoreQA.look({ layout: 'duo' })); await ready(page);
    check('nor does a change of layout, with its card already on screen', await opacity(page) === '1', await opacity(page));
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
    for (let i = 0; i < 3; i++) await nav(page, 'down');
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

  section = 'Panels';
  {
    const page = await open();
    await openFromHome(page, 'util.settings'); await rested(page);
    let c = await card(page);
    check('Settings is one card', c.count === 1 && c.title === 'Réglages', c);
    check('the card is centred', Math.abs((c.box.l + c.box.r) / 2 - 960) <= 1 && Math.abs((c.box.t + c.box.b) / 2 - 540) <= 1, c.box);
    check('the frost lines up with the wallpaper', Math.abs(c.field.l) <= 1 && Math.abs(c.field.t) <= 1, c.field);
    const around = await page.evaluate(() => ({
      home: getComputedStyle(document.getElementById('home')).visibility,
      scene: document.getElementById('scene').getBoundingClientRect().width,
      wall: document.getElementById('duoDayImg').getBoundingClientRect().width,
      sheet: document.getElementById('sheet').hidden, details: document.getElementById('appearance').hidden
    }));
    check('the wallpaper stays around the card', around.home === 'visible' && around.scene === 1920 && around.wall === 1920, around);
    check('the old panels stay out of the way', around.sheet && around.details, around);
    check('the clock and the row step aside', await value(page, '#duoFace', 'o') === 0);
    check('one selection stays active', (await where(page)).focusCount === 1, await where(page));
    check('Settings only lists what Duo uses', c.rows.join() === 'Apparence,Disposition,Sons,Applis de l’accueil,Samsung', c.rows);

    await nav(page, 'down'); await rested(page);
    c = await card(page);
    check('the plate follows the selection', Math.abs((c.plate.t + c.plate.b) - (c.focus.t + c.focus.b)) <= 2 && (await where(page)).focusAction === 'settings.group.layout', c);
    await nav(page, 'up'); await rested(page);
    const atTop = (await card(page)).plate;
    await page.keyboard.press('ArrowUp');
    check('a press at the end of a list bounces', await value(page, '.duo-plate', 'y') !== atTop.t - (await card(page)).box.t, await value(page, '.duo-plate', 'y'));
    await rested(page);
    check('the bounce comes back', JSON.stringify((await card(page)).plate) === JSON.stringify(atTop), (await card(page)).plate);
    for (let i = 0; i < 12; i++) { await page.keyboard.down('ArrowUp'); await page.waitForTimeout(33); }
    await page.keyboard.up('ArrowUp'); await rested(page);
    check('a held key leaves the plate in its place', JSON.stringify((await card(page)).plate) === JSON.stringify(atTop), (await card(page)).plate);

    await page.evaluate(() => ShoreQA.look({ scheme: 'night' })); await rested(page);
    await nav(page, 'ok'); await rested(page);
    c = await card(page);
    check('Apparence replaces Settings', c.count === 1 && c.title === 'Apparence' && (await where(page)).settingsGroup === 'scheme', c);
    check('it says what Auto follows', /Paris/.test(c.sub), c.sub);
    check('it marks the applied choice', c.checked.join() === 'Nuit' && (await where(page)).focusAction === 'choice.scheme.night', c);
    await nav(page, 'up');
    const during = await page.evaluate(() => ShoreQA.where().focusCount);
    check('only one line is selected while the plate glides', during === 1, during);
    await nav(page, 'ok'); await rested(page);
    c = await card(page);
    const frost = () => page.evaluate(() => document.querySelector('.duo-card-field').getAttribute('src'));
    check('OK applies a choice without closing', c.title === 'Apparence' && c.checked.join() === 'Jour' && (await state(page)).scheme === 'day', c);
    check('the card follows the sun', (await frost()).includes('frost-day') && await page.evaluate(() => document.getElementById('stage').className.includes('sch-day')), await frost());
    await nav(page, 'back'); await rested(page);
    c = await card(page);
    check('Back returns to the same line', c.title === 'Réglages' && c.count === 1 && (await where(page)).focusAction === 'settings.group.scheme', c);
    check('the line shows the new value', await page.evaluate(() => document.querySelector('.duo-line .duo-line-value').textContent) === 'Jour');
    await nav(page, 'back'); await rested(page);
    check('Back closes the card', (await page.evaluate(() => document.querySelectorAll('.duo-card').length)) === 0, await card(page));
    await nav(page, 'ok');
    check('a card that opens counts as the only selection', (await where(page)).focusCount === 1, await where(page));
    await nav(page, 'back');
    check('a card that closes no longer counts', (await where(page)).focusCount === 1 && (await where(page)).view === 'home', await where(page));
    await rested(page);
    check('the clock and the row come back', await value(page, '#duoFace', 'o') === 1);
    check('Home keeps its selection', (await where(page)).focusAction === 'util.settings' && (await where(page)).focusCount === 1, await where(page));
    await page.context().close();
  }
  {
    const page = await open();
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'ok'); await rested(page);
    let c = await card(page);
    check('Layout is a plain list', c.title === 'Disposition' && c.rows.join() === 'Liste,Barre,Duo' && c.checked.join() === 'Duo', c);
    const layouts = await page.evaluate(() => ShoreQA.actions());
    check('it offers the three layouts', layouts.join() === 'choice.layout.list,choice.layout.dock,choice.layout.duo', layouts);
    await nav(page, 'up', 'ok'); await ready(page);
    check('Dock can still be chosen', (await state(page)).layout === 'dock', (await state(page)).layout);
    const old = await page.evaluate(() => ({ cards: document.querySelectorAll('.duo-card').length, details: document.getElementById('appearance').hidden, scene: document.getElementById('scene').getBoundingClientRect().width, photo: document.getElementById('photo').naturalWidth, focus: ShoreQA.where().focusCount }));
    check('Dock has its own panels back', old.cards === 0 && !old.details && Math.abs(old.scene - 1920 * .48) < 1 && old.photo > 0 && old.focus === 1, old);
    await page.evaluate(() => ShoreQA.activate('choice.layout.list')); await ready(page);
    check('List can still be chosen', (await state(page)).layout === 'list', (await state(page)).layout);
    await page.evaluate(() => ShoreQA.activate('choice.layout.duo')); await ready(page); await rested(page);
    c = await card(page);
    const back = await page.evaluate(() => ({ details: document.getElementById('appearance').hidden, scene: document.getElementById('scene').getBoundingClientRect().width, home: getComputedStyle(document.getElementById('duoHome')).display, focus: ShoreQA.where().focusCount }));
    check('Duo comes back as a card', (await state(page)).layout === 'duo' && c.count === 1 && c.title === 'Disposition' && back.details && back.scene === 1920 && back.home === 'block' && back.focus === 1, [c, back]);
    await nav(page, 'back'); await rested(page);
    check('Back finds Settings as a card', (await card(page)).title === 'Réglages' && (await card(page)).count === 1, await card(page));
    await nav(page, 'back'); await rested(page);
    check('Home is whole again', await value(page, '#duoFace', 'o') === 1 && (await where(page)).focusCount === 1 && (await page.evaluate(() => document.querySelectorAll('.duo-app').length)) === 6, await where(page));
    await page.context().close();
  }

  section = 'Inputs card';
  {
    const page = await open();
    await openFromHome(page, 'util.inputs'); await rested(page);
    let c = await card(page);
    check('the list lands on the active input', (await where(page)).focusAction === 'input.1' && c.rows.join() === 'HDMI 1,HDMI 2,HDMI 3,Choisir les appareils' && c.checked.join() === 'HDMI 1', [await where(page), c]);
    check('it says which are asleep', await page.evaluate(() => document.querySelectorAll('.duo-line')[2].className.includes('is-dim') && document.querySelectorAll('.duo-line')[2].querySelector('.duo-line-value').textContent.includes('veille')));
    await nav(page, 'back'); await settled(page);
    await page.evaluate(() => { window.__tv.noSources = true; });
    await nav(page, 'ok'); await rested(page);
    c = await card(page);
    check('a refusal offers to try again', c.rows.join() === 'Réessayer' && (await where(page)).focusAction === 'inputs.retry' && c.sub.length > 0, [c, await where(page)]);
    await page.evaluate(() => { window.__tv.noSources = false; });
    await nav(page, 'ok'); await rested(page);
    check('trying again finds the list', (await card(page)).rows.length === 4 && (await where(page)).focusAction === 'input.1', await card(page));
    await page.context().close();
  }

  section = 'All apps card';
  {
    const page = await open({ more: 12 });
    await openFromHome(page, 'util.apps');
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded); await rested(page);
    const w = await where(page), c = await card(page);
    check('the first opening lands on the grid', w.zone === 'grid' && w.focusAction === 'apps.open.' + (await state(page)).catalog.ids[0] && w.focusCount === 1, w);
    check('the card has the size of the grid', c.box.w === 1560 && c.box.h === 900, c.box);
    const grid = await page.evaluate(() => ({ cells: document.querySelectorAll('.duo-cell').length, badges: document.querySelectorAll('.duo-cell-badge').length, broken: Array.prototype.filter.call(document.querySelectorAll('.duo-cell img'), img => !img.naturalWidth).length, tiles: document.querySelectorAll('.duo-cell .duo-tile').length }));
    check('every app and source has its cell', grid.cells === 24, grid);
    check('a badge marks those on Home', grid.badges === 6, grid);
    check('known apps have their icon, others their initials', grid.broken === 0 && grid.tiles === 15, grid);
    const lens = () => page.evaluate(() => { const r = document.querySelector('.duo-grid-lens').getBoundingClientRect(), f = document.querySelector('.duo-cell.is-focus .duo-cell-tile').getBoundingClientRect(); return Math.abs(r.left + r.right - f.left - f.right) <= 2 && Math.abs(r.top + r.bottom - f.top - f.bottom) <= 2; });
    check('the lens sits behind the selection', await lens());
    await page.keyboard.press('ArrowLeft'); await rested(page);
    check('Left at the edge keeps the selection', (await where(page)).focusAction === w.focusAction && await lens(), await where(page));
    await nav(page, 'right', 'right'); await rested(page);
    check('Right moves along the row', (await where(page)).focusAction === 'apps.open.' + (await state(page)).catalog.ids[2] && await lens(), await where(page));
    await nav(page, 'down', 'down'); await rested(page);
    check('the grid follows the selection down', await value(page, '.duo-grid', 'y') === -238 && await lens(), await value(page, '.duo-grid', 'y'));
    const inside = await page.evaluate(() => { const f = document.querySelector('.duo-cell.is-focus').getBoundingClientRect(), v = document.querySelector('.duo-grid-window').getBoundingClientRect(); return f.top >= v.top && f.bottom <= v.bottom; });
    check('the selection stays in the window', inside);
    for (let i = 0; i < 5; i++) await nav(page, 'down');
    await rested(page);
    check('Down stops on the last row', (await where(page)).focusAction === 'apps.open.hdmi2' && await lens(), await where(page));
    for (let i = 0; i < 6; i++) await nav(page, 'up');
    await rested(page);
    check('Up from the first row reaches the top button', (await where(page)).focusAction === 'apps.editor' && (await where(page)).focusCount === 1 && await value(page, '.duo-grid-lens', 'o') === 0, await where(page));
    await nav(page, 'ok'); await rested(page);
    check('it opens the editor', (await where(page)).view === 'editor' && (await card(page)).title === 'Applis de l’accueil' && (await card(page)).count === 1, await card(page));
    await nav(page, 'back'); await rested(page);
    check('Back returns to All apps', (await where(page)).view === 'apps' && (await card(page)).title === 'Toutes les applis' && (await where(page)).focusAction === 'apps.editor', await where(page));
    await nav(page, 'down', 'ok'); await settled(page);
    check('OK launches the app', (await tv(page)).launched.length === 1, await tv(page));
    await page.context().close();
  }
  {
    const page = await open();
    await loaded(page);
    await page.evaluate(() => { window.__tv.noApps = true; });
    await openFromHome(page, 'util.apps'); await rested(page);
    const c = await card(page);
    check('a failed read keeps a selection, on the way to try again', (await where(page)).focusAction === 'apps.retry' && (await where(page)).focusCount === 1, [c, await where(page)]);
    await page.evaluate(() => { window.__tv.noApps = false; });
    await nav(page, 'ok'); await loaded(page); await rested(page);
    check('trying again finds the grid', (await where(page)).zone === 'grid' && (await where(page)).focusCount === 1 && (await page.evaluate(() => document.querySelectorAll('.duo-cell').length)) === 12, await where(page));
    await page.context().close();
  }

  section = 'Editor card';
  {
    const page = await open();
    const y = id => page.evaluate(line => { const list = Array.prototype.filter.call(document.querySelectorAll('.duo-eline'), el => el.querySelector('.duo-eline-name').textContent === line); return window.Motion.valueOf(list[0]).y; }, id);
    const dock = () => saved(page).then(c => c.dock);
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok');
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded); await rested(page);
    check('the editor is one card', (await card(page)).count === 1 && (await card(page)).title === 'Applis de l’accueil', await card(page));
    check('it starts on the app selected on Home', (await where(page)).focusAction === 'editor.move.spotify' && (await where(page)).focusCount === 1, await where(page));
    for (let i = 0; i < 5; i++) await nav(page, 'up');
    check('Up walks to the first app', (await where(page)).focusAction === 'editor.move.netflix', await where(page));
    const others = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('.duo-eline.is-other'), () => true).length);
    check('the sources and the other apps are in their column', others === 6, others);
    check('the lines keep an even rhythm', await y('YouTube') - await y('Netflix') === 76 && await y('Prime Video') - await y('YouTube') === 76);

    await nav(page, 'ok', 'down', 'down');
    check('OK picks an app up and the keys carry it', (await state(page)).draft && (await state(page)).draft.order.indexOf('netflix') === 2, (await state(page)).draft);
    check('the hint says how', /OK pose/.test(await toast(page)), await toast(page));
    check('nothing is saved while carrying', (await dock())[0] === 'netflix', await dock());
    await nav(page, 'back'); await rested(page);
    check('Back puts it back', (await state(page)).draft === null && (await state(page)).home[0] === 'netflix' && (await where(page)).view === 'editor' && await y('Netflix') === 12, [await y('Netflix'), await where(page)]);
    await nav(page, 'ok', 'down', 'ok'); await rested(page);
    check('OK places it and saves', (await dock()).slice(0, 2).join() === 'youtube,netflix' && await y('YouTube') === 12 && await y('Netflix') === 88, await dock());
    check('the toast confirms it', await toast(page) === 'Ordre enregistré', await toast(page));
    await nav(page, 'right');
    check('Right reaches the remove button', (await where(page)).focusAction === 'editor.remove.netflix' && (await where(page)).focusCount === 1, await where(page));
    await nav(page, 'ok'); await rested(page);
    check('OK removes the app', !(await state(page)).home.includes('netflix') && (await dock()).length === 5, await dock());
    check('the selection follows it to the other column', (await where(page)).focusAction === 'editor.add.netflix', await where(page));
    check('the count follows', await page.evaluate(() => document.querySelector('.duo-count').textContent) === '5');
    await nav(page, 'ok'); await rested(page);
    check('OK puts it back in its place', (await state(page)).home[1] === 'netflix' && (await where(page)).focusAction === 'editor.remove.netflix', await state(page));
    await nav(page, 'left');
    for (let i = 0; i < 3; i++) await nav(page, 'up');
    check('Up reaches the top buttons', (await where(page)).focusAction === 'editor.done', await where(page));
    await nav(page, 'down');
    check('Down returns to the column it came from', (await where(page)).focusAction === 'editor.move.youtube', await where(page));
    await nav(page, 'up', 'left', 'ok'); await rested(page);
    check('Undo reverses the last change', !(await state(page)).home.includes('netflix') && /Annulé/.test(await toast(page)), [await state(page), await toast(page)]);
    await nav(page, 'right', 'ok'); await rested(page);
    check('Terminé closes the editor', (await where(page)).view === 'settings' && (await card(page)).title === 'Réglages', await where(page));
    await page.context().close();
  }
  {
    const page = await open({ home: ['netflix'] });
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok'); await rested(page);
    await nav(page, 'right', 'ok'); await rested(page);
    check('the last app stays', (await state(page)).home.join() === 'netflix' && /garder une appli/.test(await toast(page)), await toast(page));
    await page.context().close();
  }
  {
    const page = await open({ home: DEFAULTS.concat(EXTRA), more: 20 });
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok');
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded); await rested(page);
    const rows = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('.duo-eline.is-home'), () => true).map(el => window.Motion.valueOf(el).y));
    check('nine apps fit without a scroll hint', rows.length === 9 && rows.every((top, i) => !i || top - rows[i - 1] === 76) && rows[8] + 72 <= 704, rows);
    await nav(page, 'right', 'right');
    check('the other column is reached', (await where(page)).focusAction.startsWith('editor.add.'), await where(page));
    await nav(page, 'ok');
    check('a tenth app is refused', (await state(page)).home.length === 9 && /neuf applis/.test(await toast(page)), await toast(page));
    for (let i = 0; i < 15; i++) await nav(page, 'down');
    await rested(page);
    const seen = await page.evaluate(() => { const f = document.querySelector('.is-focus').getBoundingClientRect(), v = document.querySelector('.duo-editor-window').getBoundingClientRect(); return f.top >= v.top && f.bottom <= v.bottom; });
    check('a long list follows the selection', seen);
    await nav(page, 'left');
    const home = await page.evaluate(() => window.Motion.valueOf(document.querySelector('.duo-edot')).o);
    check('Left comes back to a remove button on screen', (await where(page)).focusAction.startsWith('editor.remove.') && home === 1, await where(page));
    await page.context().close();
  }

  section = 'HDMI sources';
  {
    const page = await open();
    await page.waitForFunction(() => ShoreQA.state().catalog.inputs.length === 3);
    await openFromHome(page, 'util.apps'); await rested(page);
    const cells = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-cell'), el => { const img = el.querySelector('img'); return [el.querySelector('.duo-cell-name').textContent, img ? img.getAttribute('src').split('/').pop() : '', !!img && img.naturalWidth > 0]; }));
    check('All apps lists the sources after the apps', cells.slice(-3).map(c => c[0]).join() === 'HDMI 1,HDMI 2,HDMI 3' && !cells.slice(0, -3).some(c => /HDMI/.test(c[0])), cells);
    check('a source without a device shows the HDMI logo', cells.slice(-3).every(c => c[1] === 'hdmi.webp' && c[2]), cells.slice(-3));
    await page.evaluate(() => ShoreQA.activate('apps.open.hdmi3')); await settled(page);
    let routed = await tv(page);
    check('OK in All apps switches to the source', routed.sources.at(-1) === 3 && routed.launched.at(-1) === 'org.tizen.tv-viewer', routed.sources);
    await page.evaluate(() => ShoreQA.activate('apps.editor')); await rested(page);
    check('the sources come first in the editor', (await lines(page, 'other')).slice(0, 3).join() === 'HDMI 1,HDMI 2,HDMI 3', await lines(page, 'other'));
    await page.evaluate(() => ShoreQA.activate('editor.add.hdmi2')); await rested(page);
    check('a source joins Home like an app', (await state(page)).home.at(-1) === 'hdmi2' && (await saved(page)).dock.at(-1) === 'hdmi2', (await state(page)).home);
    check('it is not recorded as an app', !(await saved(page)).appRecords.some(r => r.id === 'hdmi2'), (await saved(page)).appRecords);
    check('it leaves the other column', !(await lines(page, 'other')).includes('HDMI 2') && (await lines(page, 'home')).at(-1) === 'HDMI 2', await lines(page, 'other'));
    await nav(page, 'back'); await rested(page);
    await nav(page, 'back'); await rested(page);
    await goTo(page, 'home.app.hdmi2'); await rested(page);
    const row = () => page.evaluate(() => ({ apps: document.querySelectorAll('.duo-app').length, logo: document.querySelector('.duo-app.is-focus img').getAttribute('src').split('/').pop(), width: document.querySelector('.duo-app.is-focus img').naturalWidth, pill: document.getElementById('duoPillLabel').textContent, glass: document.querySelector('#duoCapApps img').getAttribute('src') }));
    let seen = await row();
    check('the row shows it, in glass made for seven', seen.apps === 7 && seen.logo === 'hdmi.webp' && seen.width > 0 && seen.pill === 'HDMI 2' && seen.glass.includes('apps7-') && (await where(page)).focusCount === 1, seen);
    await nav(page, 'ok'); await settled(page);
    routed = await tv(page);
    check('OK switches to the source', routed.sources.at(-1) === 2 && routed.launched.at(-1) === 'org.tizen.tv-viewer', routed.sources);
    check('the source is remembered', (await state(page)).lastApp === 'hdmi2', (await state(page)).lastApp);
    await page.reload(); await ready(page);
    seen = await row();
    check('it survives a restart', seen.apps === 7 && seen.pill === 'HDMI 2' && (await where(page)).focusAction === 'home.app.hdmi2', [seen, await where(page)]);
    await page.evaluate(() => { window.__tv.refuseSource = true; });
    await nav(page, 'ok'); await rested(page);
    const refused = await card(page);
    check('a refusal says so in a card', refused.title === 'HDMI 2' && /refusée/.test(refused.sub) && refused.rows.join() === 'Retour', refused);
    await nav(page, 'ok'); await rested(page);
    check('Retour comes back to the source', (await where(page)).focusAction === 'home.app.hdmi2' && (await where(page)).focusCount === 1, await where(page));
    await page.context().close();
  }
  {
    const page = await open({ home: DEFAULTS.concat('hdmi2') });
    await openFromHome(page, 'util.inputs'); await rested(page);
    for (let i = 0; i < 3; i++) await nav(page, 'down');
    check('the last line chooses the devices', (await where(page)).focusAction === 'inputs.devices', await where(page));
    await nav(page, 'ok'); await rested(page);
    let c = await card(page);
    const values = () => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-card:not(.is-leaving) .duo-line-value'), el => el.textContent));
    check('each port has its line', c.title === 'Appareils' && c.rows.join() === 'HDMI 1,HDMI 2,HDMI 3' && /nom de ce qui est branché/.test(c.sub), c);
    check('no device is chosen yet', (await values()).every(v => v === 'Non choisi'), await values());
    check('the selection is on a port', (await where(page)).focusAction === 'device.port.1' && (await where(page)).focusCount === 1, await where(page));
    await nav(page, 'down', 'ok'); await rested(page);
    c = await card(page);
    check('a port offers the devices', c.title === 'Appareil sur HDMI 2' && c.rows.join() === 'Nintendo Switch,PlayStation,Xbox,Apple TV,Autre appareil', c);
    check('each device has its logo', (await logos(page)).every(l => l[1]) && (await logos(page)).map(l => l[0]).join() === 'nintendoswitch.webp,playstation.webp,xbox.webp,appletv.webp,hdmi.webp', await logos(page));
    check('it starts on the choice in place', c.checked.join() === 'Autre appareil' && (await where(page)).focusAction === 'device.set.other', [c.checked, await where(page)]);
    await nav(page, 'up', 'up', 'up', 'up', 'ok'); await rested(page);
    c = await card(page);
    check('OK applies a device and stays', c.title === 'Appareil sur HDMI 2' && c.checked.join() === 'Nintendo Switch', c);
    check('the choice is saved', (await saved(page)).devices[2] === 'nintendoswitch', (await saved(page)).devices);
    await nav(page, 'back'); await rested(page);
    c = await card(page);
    check('the port shows its device', c.title === 'Appareils' && (await values())[1] === 'Nintendo Switch' && (await logos(page))[1][0] === 'nintendoswitch.webp' && (await where(page)).focusAction === 'device.port.2' && c.count === 1, [c, await values()]);
    await nav(page, 'up', 'ok'); await rested(page);
    check('another port starts on its own choice', (await card(page)).title === 'Appareil sur HDMI 1' && (await where(page)).focusAction === 'device.set.other', await where(page));
    await nav(page, 'back'); await rested(page);
    await nav(page, 'back'); await rested(page);
    c = await card(page);
    check('Entrées names the device and its port', c.title === 'Entrées' && c.rows[1] === 'Nintendo Switch · HDMI 2' && (await logos(page))[1][0] === 'nintendoswitch.webp' && (await where(page)).focusAction === 'inputs.devices', [c, await where(page)]);
    await nav(page, 'back'); await rested(page);
    await goTo(page, 'home.app.hdmi2'); await rested(page);
    const row = () => page.evaluate(() => ({ logo: document.querySelector('.duo-app.is-focus img').getAttribute('src').split('/').pop(), width: document.querySelector('.duo-app.is-focus img').naturalWidth, pill: document.getElementById('duoPillLabel').textContent }));
    let seen = await row();
    check('the row takes the logo and the name', seen.logo === 'nintendoswitch.webp' && seen.width > 0 && seen.pill === 'Nintendo Switch' && (await where(page)).focusCount === 1, seen);
    await openFromHome(page, 'util.apps'); await rested(page);
    const names = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-cell-name'), el => el.textContent));
    check('All apps takes the name', names.at(-2) === 'Nintendo Switch', names);
    await page.evaluate(() => ShoreQA.activate('apps.editor')); await rested(page);
    check('the editor names the device and its port', (await lines(page, 'home')).at(-1) === 'Nintendo Switch · HDMI 2', await lines(page, 'home'));
    await page.reload(); await ready(page);
    seen = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-app'), el => el.getAttribute('aria-label')));
    check('the device survives a restart', seen.at(-1) === 'Nintendo Switch', seen);
    await openFromHome(page, 'util.inputs'); await rested(page);
    await page.evaluate(() => ShoreQA.activate('inputs.devices')); await rested(page);
    await page.evaluate(() => ShoreQA.activate('device.port.2')); await rested(page);
    check('coming back starts on the device in place', (await where(page)).focusAction === 'device.set.nintendoswitch', await where(page));
    await nav(page, 'down', 'down', 'down', 'down', 'ok'); await rested(page);
    check('Autre appareil gives the port its name back', (await card(page)).checked.join() === 'Autre appareil' && !(await saved(page)).devices[2], await saved(page));
    await nav(page, 'back', 'back', 'back'); await rested(page);
    await goTo(page, 'home.app.hdmi2'); await rested(page);
    seen = await row();
    check('and the row its HDMI logo', seen.logo === 'hdmi.webp' && seen.pill === 'HDMI 2', seen);
    await page.context().close();
  }
  {
    const page = await open({ home: ['netflix', 'hdmi2', 'hdmi3'], devices: { 1: 'constructor', 2: 'xbox', x: 'xbox', 3: 'toaster' } });
    const s = await state(page);
    check('a saved device must be a known one', JSON.stringify(s.devices) === '{"2":"xbox"}', s.devices);
    const names = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.duo-app'), el => el.getAttribute('aria-label')));
    check('the row reads the saved devices', names.join() === 'Netflix,Xbox,HDMI 3', names);
    await page.context().close();
  }
  {
    const page = await open({ home: ['hdmi2', 'netflix'], look: { layout: 'dock' } });
    await loaded(page);
    check('a source on Home does not trouble Dock', (await state(page)).home.join() === 'hdmi2,netflix' && (await where(page)).focusCount === 1, await where(page));
    await page.evaluate(() => ShoreQA.activate('home.app.hdmi2')); await settled(page);
    check('and OK still switches to it', (await tv(page)).sources.at(-1) === 2, (await tv(page)).sources);
    await page.evaluate(() => ShoreQA.scene('apps')); await loaded(page);
    check('Dock keeps its own All apps', !(await page.evaluate(() => ShoreQA.actions())).some(a => a.startsWith('apps.open.hdmi')) && (await state(page)).catalog.inputs.length === 0, await page.evaluate(() => ShoreQA.actions()));
    await page.context().close();
  }

  section = 'The row follows the TV';
  {
    const page = await open({ missing: ['org.tizen.primevideo', 'rJeHak5zRg.Spotify'] });
    await loaded(page); await settled(page);
    check('the first opening keeps only the installed defaults', (await state(page)).home.join() === 'netflix,youtube,disneyplus,appletv', (await state(page)).home);
    check('it is saved', (await saved(page)).dock.join() === 'netflix,youtube,disneyplus,appletv', (await saved(page)).dock);
    const row = await page.evaluate(() => ({ apps: document.querySelectorAll('.duo-app').length, glass: document.querySelector('#duoCapApps img').getAttribute('src') }));
    check('the row and its glass follow', row.apps === 4 && row.glass.includes('apps4-'), row);
    check('the selection is on the first app', (await where(page)).focusAction === 'home.app.netflix' && (await where(page)).focusCount === 1, await where(page));
    await goTo(page, 'home.app.youtube');
    await uninstall(page, '9Ur5IzDKqV.TizenYouTube');
    await page.evaluate(() => window.__tv.catalogue.push({ id: 'Qa12345678.Fresh', name: 'Fresh', show: true, iconPath: '' }));
    await comeBack(page);
    check('an uninstalled app leaves the row', (await state(page)).home.join() === 'netflix,disneyplus,appletv' && (await page.evaluate(() => document.querySelectorAll('.duo-app').length)) === 3, (await state(page)).home);
    check('the selection moves to its neighbour', (await where(page)).focusAction === 'home.app.disneyplus' && (await where(page)).focusCount === 1, await where(page));
    check('a new app does not join the row by itself', !(await state(page)).home.includes('Qa12345678.Fresh'), (await state(page)).home);
    check('it arrives in All apps', (await state(page)).catalog.ids.includes('Qa12345678.Fresh'), (await state(page)).catalog.ids);
    const writes = (await state(page)).writes;
    await comeBack(page);
    check('a read that finds nothing new writes nothing', (await state(page)).writes === writes, [(await state(page)).writes, writes]);
    await page.context().close();
  }
  {
    const page = await open({ home: ['hdmi2', 'netflix', 'youtube'] });
    await loaded(page);
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok'); await rested(page);
    await page.evaluate(() => ShoreQA.activate('editor.remove.youtube')); await rested(page);
    check('a removed app waits in the recent ones', (await state(page)).recent.join() === 'youtube', (await state(page)).recent);
    await uninstall(page, 'org.tizen.netflix-app', '9Ur5IzDKqV.TizenYouTube');
    await comeBack(page); await rested(page);
    check('a source stays when the apps go', (await state(page)).home.join() === 'hdmi2', (await state(page)).home);
    check('a recent app that has gone leaves the list', (await state(page)).recent.length === 0 && !(await lines(page, 'other')).includes('YouTube'), await lines(page, 'other'));
    check('the editor keeps one selection', (await where(page)).focusCount === 1, await where(page));
    await page.context().close();
  }
  {
    const page = await open({ home: ['netflix'] });
    await loaded(page);
    await uninstall(page, 'org.tizen.netflix-app');
    await comeBack(page);
    check('a list without any app of the row leaves it alone', (await state(page)).home.join() === 'netflix', (await state(page)).home);
    await page.evaluate(() => { window.__tv.catalogue = []; });
    await comeBack(page);
    check('so does an empty list', (await state(page)).home.join() === 'netflix', (await state(page)).home);
    await page.context().close();
  }
  {
    const page = await open({ home: ['netflix', 'youtube'] });
    await loaded(page);
    await page.evaluate(() => { window.__tv.noApps = true; });
    await uninstall(page, 'org.tizen.netflix-app');
    await comeBack(page);
    check('a failed read leaves the row alone', (await state(page)).home.join() === 'netflix,youtube' && await toast(page) === '', [(await state(page)).home, await toast(page)]);
    await page.context().close();
  }
  {
    const page = await open();
    await loaded(page);
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok'); await rested(page);
    await nav(page, 'ok');
    const draft = (await state(page)).draft;
    await uninstall(page, 'org.tizen.netflix-app');
    await comeBack(page);
    check('an app being carried is not pulled away', JSON.stringify((await state(page)).draft) === JSON.stringify(draft) && (await state(page)).home.length === 6, (await state(page)).draft);
    await page.context().close();
  }
  {
    const page = await open({ hidden: true });
    await page.waitForTimeout(200);
    check('nothing is read during hidden startup', (await tv(page)).reads === 0, (await tv(page)).reads);
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await loaded(page);
    check('the TV is read once on screen', (await tv(page)).reads === 1 && (await state(page)).catalog.inputs.length === 3, (await tv(page)).reads);
    await page.context().close();
  }

  section = 'Sounds';
  const played = page => page.evaluate(() => Sound.played.slice());
  const heard = page => played(page).then(list => list.map(p => p.name).sort().join());
  const forget = page => page.evaluate(() => { Sound.played.length = 0; });
  const soundReady = page => page.waitForFunction(() => Sound.ready());
  /* One key, then long enough for the rule of held keys to let the next click through. */
  const hear = async (page, key) => { await forget(page); await page.keyboard.press(key); await page.waitForTimeout(260); return heard(page); };
  {
    const page = await open();
    await soundReady(page); await page.waitForTimeout(100);
    check('starting up is silent', await heard(page) === '', await heard(page));
    check('only the chosen style is read', page.sounds.join() === 'verre.pcm', page.sounds);
    await forget(page); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(260);
    const first = (await played(page))[0];
    check('a step along the row is a click', first && first.name === 'select' && first.family === 'verre' && first.level === 'discret', first);
    await forget(page); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(260);
    const second = (await played(page))[0];
    check('it rises and moves to the right', second.note > first.note && second.pan > first.pan, [first, second]);
    check('Up and Down are silent on Home', await hear(page, 'ArrowUp') === '' && await hear(page, 'ArrowDown') === '', await heard(page));
    await goTo(page, 'home.app.spotify'); await page.waitForTimeout(260);
    check('crossing to the controls is a wider click', await hear(page, 'ArrowRight') === 'switch', await heard(page));
    check('coming back too', await hear(page, 'ArrowLeft') === 'switch', await heard(page));
    await goTo(page, 'util.settings'); await page.waitForTimeout(260);
    check('the end of the row is a dull click', await hear(page, 'ArrowRight') === 'edge', await heard(page));
    await forget(page);
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(33); await page.keyboard.down('ArrowRight'); }
    await page.keyboard.up('ArrowRight'); await page.waitForTimeout(260);
    check('a held key at the end does not repeat it', (await played(page)).length <= 1, await heard(page));
    await goTo(page, 'home.app.netflix'); await page.waitForTimeout(260);
    await forget(page);
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 9; i++) { await page.waitForTimeout(33); await page.keyboard.down('ArrowRight'); }
    await page.keyboard.up('ArrowRight'); await page.waitForTimeout(260);
    const held = await played(page);
    check('a held key spaces its clicks and softens them', held.length > 1 && held.length < 10 && held.at(-1).gain < held[0].gain, held.map(p => p.gain));
    await goTo(page, 'home.app.youtube'); await page.waitForTimeout(260);
    check('OK on an app presses and launches', await hear(page, 'Enter') === 'launch,ok', await heard(page));
    check('Back on Home opens the card', await hear(page, 'Escape') === 'back,panelIn', await heard(page));
    await page.waitForTimeout(500);
    check('Back again closes it', await hear(page, 'Escape') === 'back,panelOut', await heard(page));
    await page.context().close();
  }
  {
    const page = await open();
    await soundReady(page);
    await goTo(page, 'util.settings'); await page.waitForTimeout(260);
    check('OK opens a card', await hear(page, 'Enter') === 'ok,panelIn', await heard(page));
    await rested(page);
    await forget(page); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(260);
    const low = (await played(page))[0];
    await forget(page); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(260);
    const high = (await played(page))[0];
    check('a list is higher at the top', high.name === 'select' && low.name === 'select' && high.note > low.note, [high, low]);
    check('the end of a list is a dull click', await hear(page, 'ArrowUp') === 'edge', await heard(page));
    check('Left and Right are silent in a list', await hear(page, 'ArrowLeft') === '', await heard(page));
    await page.keyboard.press('Escape'); await rested(page);
    await openFromHome(page, 'util.apps'); await loaded(page); await rested(page);
    check('a step in the grid is a click', await hear(page, 'ArrowRight') === 'select', await heard(page));
    check('the edge of the grid is a dull click', await hear(page, 'ArrowLeft') === 'select' && await hear(page, 'ArrowLeft') === 'edge', await heard(page));
    check('reaching the top button is a wider click', await hear(page, 'ArrowUp') === 'switch', await heard(page));
    check('Up from it is silent', await hear(page, 'ArrowUp') === '', await heard(page));
    await hear(page, 'Enter'); await rested(page);
    check('a move in the editor is a click', await hear(page, 'ArrowRight') === 'select', await heard(page));
    check('reaching the other column is a wider click', await hear(page, 'ArrowRight') === 'switch', await heard(page));
    await page.context().close();
  }
  {
    const page = await open({ home: ['netflix'] });
    await soundReady(page);
    await openFromHome(page, 'util.settings');
    await nav(page, 'down', 'down', 'down', 'ok'); await rested(page);
    await nav(page, 'right');
    check('a refusal is two knocks', await hear(page, 'Enter') === 'error', await heard(page));
    await page.context().close();
  }
  {
    const page = await open();
    await soundReady(page);
    await page.evaluate(() => { window.__tv.refuse = true; });
    await goTo(page, 'home.app.youtube'); await page.waitForTimeout(260);
    await forget(page); await page.keyboard.press('Enter'); await settled(page);
    check('a launch the TV refuses is heard as one', (await heard(page)).split(',').includes('error'), await heard(page));
    await page.context().close();
  }
  {
    const page = await open({ clock: true });
    await soundReady(page);
    await page.clock.fastForward(21000);
    check('the row stepping aside is silent', (await state(page)).duo.idle === true && await heard(page) === '', await heard(page));
    await page.clock.fastForward(120000);
    check('the minute changing is silent', await heard(page) === '', await heard(page));
    await page.keyboard.press('ArrowRight');
    check('the first key only wakes, with a low note', await heard(page) === 'wake' && (await where(page)).focusAction === 'home.app.netflix', [await heard(page), await where(page)]);
    await page.context().close();
  }
  {
    const page = await open();
    await soundReady(page);
    const level = () => page.evaluate(() => [Sound.output() && Sound.output().gain.value, Sound.filter() && Sound.filter().frequency.value]);
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => ShoreQA.look({ scheme: 'day' }));
    check('Discret is the default', Math.abs((await level())[0] - .4) < .001 && (await level())[1] === 20000 && (await state(page)).sound === 'discret', await level());
    await page.evaluate(() => ShoreQA.look({ scheme: 'night' }));
    check('the night is softer and less bright', Math.abs((await level())[0] - .28) < .001 && (await level())[1] === 3000, await level());
    await page.evaluate(() => ShoreQA.look({ scheme: 'day' }));
    await goTo(page, 'util.settings'); await nav(page, 'ok', 'down', 'down'); await nav(page, 'ok'); await rested(page);
    let c = await card(page);
    check('Sons offers its levels and its style', c.title === 'Sons' && c.rows.join() === 'Normal,Discret,Coupés,Style de son,Sortie du son' && c.checked.join() === 'Discret' && (await where(page)).focusAction === 'choice.sound.discret', [c, await where(page)]);
    check('it says what the night does', /nuit/.test(c.sub), c.sub);
    const lineValue = n => page.evaluate(i => document.querySelectorAll('.duo-card:not(.is-leaving) .duo-line-value')[i].textContent, n);
    check('the style line names the style', await lineValue(3) === 'Verre', await lineValue(3));
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(260);
    check('Normal is applied and heard at its level', await hear(page, 'Enter') === 'ok' && (await played(page))[0].level === 'normal' && (await level())[0] === 1 && (await saved(page)).look.sound === 'normal', [await played(page), await level()]);
    await nav(page, 'down', 'down'); await page.waitForTimeout(260);
    check('Coupés is silent, even for its own press', await hear(page, 'Enter') === '' && (await saved(page)).look.sound === 'coupes', await heard(page));
    check('and nothing plays afterwards', await hear(page, 'ArrowUp') === '', await heard(page));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await page.waitForTimeout(260);
    check('the sounds come back', await hear(page, 'ArrowDown') === 'select', await heard(page));
    await nav(page, 'down', 'down'); await page.waitForTimeout(260);
    await nav(page, 'ok'); await rested(page);
    c = await card(page);
    check('Style de son lists the eight, from the clearest to the lowest', c.title === 'Style de son' && c.rows.join() === 'Verre,Goutte,Zen,Galet,Bois,Feutre,Bronze,Ardoise' && c.checked.join() === 'Verre' && (await where(page)).focusAction === 'choice.soundStyle.verre', c);
    check('each says how it sounds', await lineValue(4) === 'chaud, comme un marimba', await lineValue(4));
    await nav(page, 'down', 'down', 'down', 'down'); await page.waitForTimeout(260);
    await forget(page); await page.keyboard.press('Enter');
    await page.waitForFunction(() => Sound.ready() && Sound.family() === 'bois'); await page.waitForTimeout(100);
    const bois = await played(page);
    check('choosing a style plays it once it is here', bois.length === 1 && bois[0].name === 'ok' && bois[0].family === 'bois', bois);
    check('the other styles stay unread until asked for', page.sounds.join() === 'verre.pcm,bois.pcm', page.sounds);
    check('it is saved', (await saved(page)).look.soundStyle === 'bois');
    check('the card marks it', (await card(page)).checked.join() === 'Bois', await card(page));
    await nav(page, 'back'); await rested(page);
    check('the line above shows it', await lineValue(3) === 'Bois', await lineValue(3));
    page.sounds.length = 0;
    await page.reload(); await ready(page); await soundReady(page);
    await page.waitForTimeout(100);
    check('a restart reads only that style', page.sounds.join() === 'bois.pcm' && (await state(page)).sound === 'normal', page.sounds);
    check('and it is silent, whatever the style', await heard(page) === '', await heard(page));
    await goTo(page, 'util.settings'); await nav(page, 'ok', 'down', 'down', 'ok', 'down', 'down', 'down', 'down', 'ok'); await settled(page);
    check('Sortie du son opens the TV\'s settings', (await tv(page)).launched.at(-1) === 'com.samsung.tv.coba.setting', (await tv(page)).launched);
    await page.context().close();
  }
  {
    const page = await open();
    await soundReady(page);
    await page.keyboard.press('ArrowRight');
    const signal = await page.evaluate(async () => {
      const ctx = Sound.context(), meter = ctx.createAnalyser(), data = new Float32Array(meter.fftSize);
      let peak = 0;
      Sound.output().connect(meter);
      Sound.play('wake');
      for (let i = 0; i < 12; i++) { await new Promise(done => setTimeout(done, 30)); meter.getFloatTimeDomainData(data); peak = Math.max(peak, ...data.map(Math.abs)); }
      return { state: ctx.state, peak };
    });
    check('the sound really reaches the output', signal.state === 'running' && signal.peak > .001, signal);
    await goTo(page, 'home.app.youtube'); await page.waitForTimeout(260);
    await page.keyboard.press('Enter');
    await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(150);
    check('it stops as soon as an app takes over', await page.evaluate(() => Sound.context().state) === 'suspended');
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await settled(page);
    check('coming back is silent, and a key opens it again', await hear(page, 'ArrowLeft') === 'select' && await page.evaluate(() => Sound.context().state) === 'running', await heard(page));
    await forget(page);
    await page.evaluate(() => { window.__tv.connected = [1, 2, 3]; window.__plug(); }); await settled(page);
    check('a device plugged in is two rising notes', await heard(page) === 'sourceOn', await heard(page));
    await forget(page);
    await page.evaluate(() => { window.__tv.connected = [1]; window.__plug(); }); await settled(page);
    check('a device unplugged is two falling ones', await heard(page) === 'sourceOff', await heard(page));
    await forget(page);
    await page.evaluate(() => { window.__tv.connected = [1, 3]; window.__hidden = true; window.__plug(); }); await settled(page);
    check('nothing is read or heard behind an app', await heard(page) === '', await heard(page));
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await openFromHome(page, 'util.inputs'); await rested(page);
    await page.evaluate(() => { window.__tv.connected = [1, 2, 3]; window.__plug(); }); await rested(page);
    check('an open Entrées follows the plug', await page.evaluate(() => !document.querySelectorAll('.duo-card:not(.is-leaving) .duo-line')[1].className.includes('is-dim')), await card(page));
    await page.evaluate(() => Sound.use('element')); await soundReady(page);
    const length = await page.evaluate(() => new Promise(done => { const clip = Sound.clip('ok'); clip.onerror = () => done(-1); clip.onloadedmetadata = () => done(clip.duration); if (clip.readyState >= 1) done(clip.duration); }));
    check('the audio element gets a file it can read', length > .05 && length < .2, length);
    await page.keyboard.press('Escape'); await settled(page);
    check('and plays it', (await played(page)).at(-1).method === 'element', (await played(page)).at(-1));
    await page.context().close();
  }
  {
    const page = await open({ look: { layout: 'dock' } });
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    check('List and Dock stay silent', page.sounds.length === 0 && await heard(page) === '', [page.sounds, await heard(page)]);
    await page.context().close();
  }

  section = 'Volume pill';
  const pill = page => page.evaluate(() => ({ o: window.Motion.valueOf(document.getElementById('duoVol')).o, value: document.querySelector('.duo-vol-value').textContent, fill: window.Motion.valueOf(document.querySelector('.duo-vol-fill')).x, icon: document.querySelector('.duo-vol-icon svg').querySelectorAll('path').length }));
  {
    const page = await open();
    await soundReady(page);
    check('Duo takes the volume keys', (await tv(page)).keys.join() === 'VolumeUp,VolumeDown,VolumeMute', (await tv(page)).keys);
    const box = await page.evaluate(() => { const r = document.getElementById('duoVol').getBoundingClientRect(), g = window.CleanFrameDuo.glass.vol; return { l: r.left, t: r.top, w: r.width, h: r.height, g, o: getComputedStyle(document.getElementById('duoVol')).opacity, images: Array.prototype.map.call(document.querySelectorAll('#duoVol img'), img => [img.getAttribute('src').split('/').pop(), img.naturalWidth > 0]) }; });
    check('the pill waits unseen on its baked glass', Number(box.o) === 0 && box.images.join() === 'vol-day.webp,true,vol-night.webp,true', box);
    const focus = (await where(page)).focusAction;
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(260);
    const before = (await where(page)).focusAction;
    await forget(page);
    await volumeKey(page, 'up');
    let v = await pill(page);
    check('a press changes the TV\'s volume', (await tv(page)).volume.level === 19, (await tv(page)).volume);
    check('the pill shows it', v.o === 1 && v.value === '19' && Math.abs(v.fill - (.19 * 228 - 228)) < .01 && v.icon === 3, v);
    const click = (await played(page))[0];
    check('each step is a click from its corner', click.name === 'select' && click.pan < -.3, click);
    check('the selection stays where it was', (await where(page)).focusAction === before && before !== focus, await where(page));
    await rested(page);
    const place = await page.evaluate(() => { const r = document.getElementById('duoVol').getBoundingClientRect(), g = window.CleanFrameDuo.glass.vol; return [r.left, r.top, g.x, g.y]; });
    check('it appears in place, on its glass', Math.abs(place[0] - place[2]) < 1 && Math.abs(place[1] - place[3]) < 1, place);
    await page.waitForTimeout(100); await forget(page);
    await volumeKey(page, 'down');
    check('Volume down follows', (await tv(page)).volume.level === 18 && (await pill(page)).value === '18', (await pill(page)));
    await page.waitForTimeout(260); await forget(page);
    await volumeKey(page, 'mute');
    v = await pill(page);
    check('Mute shows it and silences the launcher', (await tv(page)).volume.muted && v.value === 'Coupé' && v.fill === -228 && v.icon === 2 && await heard(page) === '', [v, await heard(page)]);
    check('no click while muted', await hear(page, 'ArrowRight') === '', await heard(page));
    await page.waitForTimeout(260);
    await forget(page);
    await volumeKey(page, 'up');
    check('a step brings the sound back, as on the TV', !(await tv(page)).volume.muted && (await pill(page)).value === '19' && await heard(page) === 'select', [await tv(page), await heard(page)]);
    await page.evaluate(() => { window.__tv.volume.level = 1; });
    await page.waitForTimeout(260);
    await volumeKey(page, 'down');
    check('volume zero is silent too', (await pill(page)).value === '0' && (await pill(page)).icon === 2 && await hear(page, 'ArrowLeft') === '', await pill(page));
    await volumeKey(page, 'up');
    await page.waitForTimeout(2800);
    check('the pill goes away by itself', (await pill(page)).o === 0, await pill(page));
    await page.evaluate(() => ShoreQA.look({ scheme: 'night' })); await page.waitForFunction(() => ShoreQA.state().duo.scheme === 'night');
    check('its glass follows the night', await page.evaluate(() => document.querySelector('#duoVol .duo-night').style.opacity) === '1');
    await page.evaluate(() => { window.__tv.volume.muted = true; window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(260);
    check('coming back reads the TV again', await hear(page, 'ArrowRight') === '', await heard(page));
    await page.evaluate(() => ShoreQA.look({ layout: 'dock' })); await ready(page);
    check('Dock gives the keys back', (await tv(page)).keys.length === 0, (await tv(page)).keys);
    const level = (await tv(page)).volume.level;
    await volumeKey(page, 'up');
    check('and leaves the volume to the TV', (await tv(page)).volume.level === level, (await tv(page)).volume);
    await page.evaluate(() => ShoreQA.look({ layout: 'duo' })); await ready(page);
    check('Duo takes them again', (await tv(page)).keys.length === 3, (await tv(page)).keys);
    await page.evaluate(() => { window.__tv.volume.refuse = true; });
    await volumeKey(page, 'up');
    check('a TV that refuses gets its keys back', (await tv(page)).keys.length === 0 && (await where(page)).focusCount === 1, (await tv(page)).keys);
    await page.context().close();
  }
  {
    const page = await open({ noAudio: true });
    check('without the audio API the keys stay with the TV', (await tv(page)).keys.length === 0, (await tv(page)).keys);
    await volumeKey(page, 'up');
    check('and nothing shows', await value(page, '#duoVol', 'o') === 0 && (await where(page)).focusCount === 1);
    await page.context().close();
  }

  section = 'Messages';
  {
    const page = await open();
    await page.keyboard.press('Escape'); await rested(page);
    let c = await card(page);
    check('Back on Home asks first', c.title === 'Quitter l’accueil ?' && c.rows.join() === 'Rester ici,Menu Samsung' && (await where(page)).focusAction === 'message.stay', c);
    check('it speaks of the Samsung menu', /menu Samsung/.test(c.sub), c.sub);
    await nav(page, 'right');
    check('Left and Right do nothing in a list', (await where(page)).focusAction === 'message.stay', await where(page));
    await nav(page, 'down', 'ok'); await settled(page);
    check('Menu Samsung opens the original Home', (await tv(page)).launched.includes('com.samsung.tv.csfs'), await tv(page));
    await page.waitForTimeout(100);
    check('and the card goes', (await where(page)).view === 'home', await where(page));
    await rested(page);
    await page.evaluate(() => { window.__tv.refuse = true; });
    await goTo(page, 'home.app.youtube');
    await nav(page, 'ok'); await rested(page);
    c = await card(page);
    check('a refusal says so in a card', c.title === 'YouTube' && /refusé/.test(c.sub) && c.rows.join() === 'Retour', c);
    await nav(page, 'ok'); await rested(page);
    check('Retour comes back to Home', (await where(page)).view === 'home' && (await where(page)).focusCount === 1, await where(page));
    await page.context().close();
  }

  section = 'Without a TV';
  {
    const page = await open({ noTv: true });
    check('the layout opens all the same', (await state(page)).layout === 'duo' && (await where(page)).focusCount === 1, await where(page));
    check('without a TV nothing takes the volume keys', await page.evaluate(() => getComputedStyle(document.getElementById('duoVol')).opacity) === '0');
    await goTo(page, 'home.app.youtube');
    await nav(page, 'ok'); await rested(page);
    let c = await card(page);
    check('OK on an app says what is missing', c.title === 'YouTube' && /sur la télé/.test(c.sub) && c.rows.join() === 'Retour' && (await where(page)).focusCount === 1, c);
    await nav(page, 'ok'); await rested(page);
    await openFromHome(page, 'util.apps'); await rested(page);
    check('All apps offers to try again', (await where(page)).focusAction === 'apps.retry' && (await where(page)).focusCount === 1, await where(page));
    await nav(page, 'back'); await rested(page);
    await openFromHome(page, 'util.inputs'); await rested(page);
    c = await card(page);
    check('Inputs too', c.rows.join() === 'Réessayer' && /sur la télé/.test(c.sub) && (await where(page)).focusCount === 1, c);
    await page.context().close();
  }

  section = 'At 720p';
  {
    /* The stage scales as one piece, so every box must be two thirds of its size at 1080p. */
    const boxes = (page, list) => page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
      const cards = Array.prototype.filter.call(document.querySelectorAll(selector), el => getComputedStyle(el).display !== 'none'), r = cards[cards.length - 1].getBoundingClientRect();
      return [selector, [r.left, r.top, r.right, r.bottom]];
    })), list);
    const large = await open({ look: { scheme: 'day' } }), small = await open({ look: { scheme: 'day' }, viewport: { width: 1280, height: 720 } });
    const both = async run => { await run(large); await run(small); };
    const drift = async list => { const a = await boxes(large, list), b = await boxes(small, list); return list.filter(key => a[key].some((v, i) => Math.abs(v * 2 / 3 - b[key][i]) > 1)).map(key => [key, a[key], b[key]]); };
    await both(async page => { await goTo(page, 'home.app.disneyplus'); await rested(page); });
    let off = await drift(['#duoDayImg', '#duoClock', '#duoDate', '#duoRing', '#duoCapApps img', '#duoCapCtrl img', '#duoLens', '.duo-app.is-focus', '#duoPill']);
    check('Home keeps its proportions and its glass stays aligned', off.length === 0, off);
    await both(async page => { await volumeKey(page, 'up'); await rested(page); });
    off = await drift(['#duoVol', '#duoVol img', '.duo-vol-track', '.duo-vol-value']);
    check('so does the volume pill', off.length === 0, off);
    await both(async page => { await goTo(page, 'util.settings'); await nav(page, 'ok', 'down', 'down', 'ok'); await rested(page); });
    off = await drift(['.duo-card', '.duo-card-field', '.duo-plate', '.duo-line.is-focus']);
    check('so does a card and its frost', off.length === 0, off);
    await both(async page => { await nav(page, 'back', 'back'); await rested(page); await openFromHome(page, 'util.apps'); await loaded(page); await rested(page); });
    off = await drift(['.duo-card', '.duo-card-field', '.duo-grid-lens', '.duo-cell.is-focus']);
    check('so does the grid and its lens', off.length === 0, off);
    check('there is still one selection', (await where(small)).focusCount === 1, await where(small));
    await large.context().close(); await small.context().close();
  }

  section = 'Nothing runs at rest';
  {
    const page = await open({ clock: true });
    /* Long enough for the last spring to end. The clock is faked, so this waits in real time. */
    const quiet = async name => {
      await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => {});
      check(name + ': no animation is left', await page.evaluate(() => document.getAnimations().length) === 0, await page.evaluate(() => document.getAnimations().map(a => [a.effect.target && (a.effect.target.id || a.effect.target.className), a.playState])));
      const before = await page.evaluate(() => window.__frames);
      await new Promise(done => setTimeout(done, 500));
      check(name + ': no frame is asked for', await page.evaluate(() => window.__frames) === before, [before, await page.evaluate(() => window.__frames)]);
    };
    check('the frames are really counted', await page.evaluate(() => { const before = window.__frames; requestAnimationFrame(() => {}); return window.__frames - before; }) === 1);
    await quiet('after starting');
    await page.keyboard.press('ArrowRight');
    await quiet('after a key');
    await page.clock.fastForward(21000);
    check('the row has stepped aside', (await state(page)).duo.idle === true);
    await quiet('with the row aside');
    await page.clock.fastForward(120000);
    await quiet('after the minute changes');
    await page.keyboard.press('ArrowRight');
    await quiet('after waking');
    await openFromHome(page, 'util.settings');
    await quiet('with a card open');
    await nav(page, 'back');
    await quiet('after a card closes');
    await volumeKey(page, 'up');
    await page.clock.fastForward(2500);
    await quiet('after the volume pill');
    await page.context().close();
  }

  section = 'Memory';
  {
    const page = await open({ more: 30 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const memory = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics'), dom = await cdp.send('Memory.getDOMCounters');
      return { heap: metrics.find(m => m.name === 'JSHeapUsedSize').value, nodes: dom.nodes, listeners: dom.jsEventListeners, images: await page.evaluate(() => document.images.length) };
    };
    const round = async () => {
      await goTo(page, 'util.settings'); await nav(page, 'ok', 'down', 'down', 'ok', 'down', 'down', 'ok'); await rested(page);
      await nav(page, 'back', 'back', 'back'); await rested(page);
      await openFromHome(page, 'util.apps'); await loaded(page); await nav(page, 'down', 'right'); await rested(page);
      await nav(page, 'back'); await rested(page);
      await openFromHome(page, 'util.inputs'); await rested(page);
      await nav(page, 'back'); await rested(page);
      await volumeKey(page, 'up'); await volumeKey(page, 'down');
      await goTo(page, 'home.app.netflix'); await rested(page);
    };
    await round(); await round();
    const before = await memory();
    for (let i = 0; i < 5; i++) await round();
    const after = await memory();
    check('the cards leave nothing behind', after.nodes - before.nodes < 40 && after.images <= before.images && after.listeners - before.listeners < 10, [before, after]);
    check('the heap does not grow by megabytes', after.heap - before.heap < 2 * 1024 * 1024, [before.heap, after.heap]);
    console.log('Duo memory after five more rounds: ' + (after.nodes - before.nodes) + ' nodes, ' + Math.round((after.heap - before.heap) / 1024) + ' KB of heap');
    await page.context().close();
  }

  /* The package itself, opened from its own files as on the TV: no server can hide a missing file. */
  section = 'Packaged widget';
  {
    const folder = root + '.local/qa/widget/';
    execFileSync('python3', ['-B', 'scripts/package.py', '--unsigned'], { cwd: root, stdio: 'ignore' });
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    execFileSync('python3', ['-I', '-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', root + 'dist/CleanFrame-unsigned.wgt', folder]);
    const browser = await chromium.launch({ headless: true, channel: process.env.CLEANFRAME_BROWSER_CHANNEL || undefined, args: ['--allow-file-access-from-files'] });
    try {
      const page = await open({ browser, url: 'file://' + folder + 'index.html' });
      const broken = () => page.evaluate(() => Array.prototype.filter.call(document.images, img => img.getAttribute('src') && !img.naturalWidth).map(img => img.getAttribute('src')));
      check('it opens in Duo from its own files', (await state(page)).layout === 'duo' && await page.evaluate(() => location.protocol) === 'file:', (await state(page)).layout);
      await page.waitForFunction(() => Sound.ready());
      await page.keyboard.press('ArrowRight');
      check('its sounds are there', (await page.evaluate(() => Sound.played.slice())).some(p => p.name === 'select' && p.method === 'web'));
      await openFromHome(page, 'util.apps'); await loaded(page); await rested(page);
      await nav(page, 'back'); await rested(page);
      await openFromHome(page, 'util.inputs'); await rested(page);
      await page.evaluate(() => ShoreQA.activate('inputs.devices')); await rested(page);
      await page.evaluate(() => ShoreQA.activate('device.port.1')); await rested(page);
      check('every image it asks for is inside', (await broken()).length === 0, await broken());
      check('no file is missing', page.failed.length === 0, page.failed);
      await page.context().close();
    } finally { await browser.close(); }
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
  {
    const page = await open({ more: 30 });
    const cdp = await page.context().newCDPSession(page);
    const measure = (keys, count = 44) => page.evaluate(async ([list, total]) => {
      const out = [];
      for (let i = 0; i < total; i++) {
        const key = new KeyboardEvent('keydown', { keyCode: list[Math.floor(i / 11) % list.length], bubbles: true });
        const start = performance.now();
        document.dispatchEvent(key);
        out.push(performance.now() - start);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return out.sort((a, b) => a - b)[Math.floor(total * .95)];
    }, [keys, count]);
    await openFromHome(page, 'util.settings'); await rested(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const list = await measure([40, 38]);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await nav(page, 'back'); await openFromHome(page, 'util.apps');
    await page.waitForFunction(() => ShoreQA.state().catalog.loaded); await rested(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const grid = await measure([40, 39, 38, 37]);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await nav(page, 'up', 'up', 'up', 'up', 'up', 'up', 'ok');
    await page.waitForFunction(() => ShoreQA.state().view === 'editor' && !ShoreQA.state().catalog.loading); await rested(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const editor = await measure([40, 38]);
    check('a key in a list costs little', list < 20, list);
    check('a key in the grid costs little', grid < 20, grid);
    check('a key in the editor costs little', editor < 20, editor);
    console.log('Panel key p95 at 4x slowdown: list ' + list.toFixed(1) + ', grid ' + grid.toFixed(1) + ', editor ' + editor.toFixed(1) + ' ms');
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
    check('no sound is read for nothing', !requests.some(url => url.endsWith('.pcm')), requests.filter(url => url.endsWith('.pcm')));
    check('the volume keys stay with the TV', (await tv(page)).keys.length === 0, (await tv(page)).keys);
    const direct = await page.evaluate(() => fetch('assets/duo/wall-day.webp').then(r => r.status));
    check('the private files are not served', direct === 404, direct);
    await context.close();
  } finally { await preview.close(); }
}

if (failures.length) { console.error(failures.join('\n')); console.error(failures.length + ' Duo checks failed; ' + passed + ' passed.'); process.exit(1); }
console.log(passed + ' Duo checks passed.');
