// Sound engine against a simulated clock and fake audio objects. No browser and no TV.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const BANK = { rate: 48000, notes: 8, families: { verre: { file: 'verre.pcm', sounds: {} }, bois: { file: 'bois.pcm', sounds: {} } } };
const GESTURES = ['edge', 'switch', 'ok', 'back', 'panelIn', 'panelOut', 'wake', 'launch', 'sourceOn', 'sourceOff', 'error'].concat(Array.from({ length: 8 }, (_, i) => 'select' + i));
for (const family of Object.values(BANK.families)) GESTURES.forEach((name, i) => { family.sounds[name] = [i * 10, 10]; });
const SAMPLES = GESTURES.length * 10;

function engine({ web = true, element = true, tv = false, answer = 200, refuseContext = false } = {}) {
  const log = { requests: [], started: [], stopped: [], elements: [], beeps: [], contexts: [], listeners: {} };
  const clock = { now: 0 };
  class Node { connect() {} disconnect() {} }
  class AudioContext {
    constructor() {
      if (refuseContext) throw Error('No audio here');
      this.state = 'running'; this.currentTime = 0; this.destination = new Node(); log.contexts.push(this);
    }
    createBiquadFilter() { return Object.assign(new Node(), { Q: {}, frequency: {} }); }
    createGain() { return Object.assign(new Node(), { gain: { value: 1, setTargetAtTime() {} } }); }
    createStereoPanner() { return Object.assign(new Node(), { pan: { value: 0 } }); }
    createBufferSource() { return Object.assign(new Node(), { start(at) { log.started.push({ buffer: this.buffer, at }); }, stop() { log.stopped.push(this.buffer); } }); }
    resume() { this.state = 'running'; log.resumed = (log.resumed || 0) + 1; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; log.suspended = (log.suspended || 0) + 1; }
  }
  class AudioBuffer {
    constructor({ length, sampleRate }) { this.length = length; this.sampleRate = sampleRate; this.data = new Float32Array(length); }
    getChannelData() { return this.data; }
  }
  class Audio {
    constructor(url) { this.url = url; this.plays = 0; this.paused = 0; log.elements.push(this); }
    play() { this.plays++; return Promise.resolve(); }
    pause() { this.paused++; }
  }
  class XMLHttpRequest {
    open(method, url) { this.url = url; }
    send() { log.requests.push(this); }
  }
  const document = { hidden: false, addEventListener(name, run) { log.listeners[name] = run; } };
  const window = {
    CleanFrameSounds: BANK, XMLHttpRequest, performance: { now: () => clock.now },
    ArrayBuffer, DataView, Int16Array, Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    URL: { createObjectURL: blob => blob }
  };
  if (web) Object.assign(window, { AudioContext, AudioBuffer });
  if (element) window.Audio = Audio;
  else { delete window.Blob; delete window.URL; }
  if (tv) window.tizen = { tvaudiocontrol: { playSound: type => log.beeps.push(type) } };
  vm.runInNewContext(readFileSync(new URL('../app/sound.js', import.meta.url), 'utf8'), { window, document });
  const arrive = (status = answer) => { const xhr = log.requests.shift(); xhr.status = status; xhr.response = new Int16Array(SAMPLES).buffer; xhr.onload(); };
  return { Sound: window.Sound, log, clock, document, arrive };
}
function ready(options) { const e = engine(options); e.Sound.setFamily('verre'); e.arrive(); return e; }
const names = e => [...e.Sound.played].map(p => p.name);

test('a style is fetched once, and a sound before it arrives stays silent', () => {
  const e = engine();
  assert.equal(e.Sound.setFamily('verre'), false);
  e.Sound.setFamily('verre');
  assert.equal(e.log.requests.length, 1);
  assert.equal(e.log.requests[0].url, 'assets/sounds/verre.pcm');
  e.Sound.play('ok');
  assert.deepEqual(names(e), []);
  assert.equal(e.log.contexts.length, 0, 'nothing opens the audio before the first real sound');
  e.arrive();
  assert.equal(e.Sound.ready(), true);
  e.Sound.play('ok');
  assert.deepEqual(names(e), ['ok']);
});

test('a file inside the installed widget answers with status 0', () => {
  const e = engine();
  e.Sound.setFamily('verre');
  e.arrive(0);
  assert.equal(e.Sound.ready(), true);
});

test('only the chosen style stays in memory, and a late arrival is dropped', () => {
  const e = ready();
  let heard = 0;
  assert.equal(e.Sound.setFamily('bois', () => heard++), false);
  assert.equal(e.Sound.ready(), false);
  e.arrive();
  assert.equal(heard, 1, 'choosing a style plays it once it is here');
  assert.equal(e.Sound.setFamily('verre'), false, 'the first style was released');
  e.Sound.setFamily('bois');
  e.arrive();
  assert.equal(e.Sound.family(), 'bois');
  assert.equal(e.Sound.ready(), true);
});

test('Coupés and a muted TV are silent, and the level and night reach the output', () => {
  const e = ready();
  e.Sound.setLevel('coupes');
  e.Sound.play('ok');
  e.Sound.setLevel('discret');
  e.Sound.setMuted(true);
  e.Sound.play('ok');
  assert.deepEqual(names(e), []);
  e.Sound.setMuted(false);
  e.Sound.play('ok');
  assert.equal(e.Sound.output().gain.value, .4);
  assert.equal(e.Sound.filter().frequency.value, 20000);
  e.Sound.setNight(true);
  assert.ok(Math.abs(e.Sound.output().gain.value - .28) < 1e-9);
  assert.equal(e.Sound.filter().frequency.value, 3000);
  e.Sound.setLevel('normal');
  assert.equal(e.Sound.output().gain.value, .7);
});

test('a new sound of a voice replaces the last one, and other voices play along', () => {
  const e = ready();
  e.Sound.play('ok');
  e.Sound.play('panelIn');
  assert.equal(e.log.stopped.length, 0);
  e.Sound.play('back');
  assert.equal(e.log.stopped.length, 1);
});

test('the note picks the click, between the two ends of the scale', () => {
  const e = ready(), clip = note => e.Sound.clip('select', note);
  assert.equal(clip(-3), clip(0));
  assert.equal(clip(99), clip(7));
  assert.notEqual(clip(0), clip(7));
  assert.equal(clip(), clip(3));
});

test('a held key spaces its clicks and softens them', () => {
  const e = ready();
  for (let i = 0; i < 40; i++) { e.Sound.play('select', { note: 3 }); e.clock.now += 33; }
  const gains = [...e.Sound.played].map(p => p.gain);
  assert.ok(gains.length < 16, gains.length + ' clicks in 1.3 s');
  assert.ok(gains.length > 5, gains.length + ' clicks in 1.3 s');
  assert.equal(gains[0], 1);
  assert.ok(gains.every((gain, i) => !i || gain < gains[i - 1] || gain === .4), gains.join());
  e.clock.now += 1000;
  e.Sound.play('select', { note: 3 });
  assert.equal(e.Sound.played.at(-1).gain, 1, 'after a pause the clicks are whole again');
});

test('the position on screen becomes a gentle pan', () => {
  const e = ready();
  e.Sound.play('ok', { x: 0 });
  e.Sound.play('ok', { x: 1 });
  e.Sound.play('ok');
  assert.deepEqual([...e.Sound.played].map(p => p.pan), [-.4, .4, 0]);
});

test('the sound stops when another app takes over, and comes back after', () => {
  const e = ready();
  e.Sound.play('launch');
  e.document.hidden = true;
  e.log.listeners.visibilitychange();
  assert.equal(e.log.stopped.length, 1);
  assert.equal(e.log.suspended, 1);
  e.document.hidden = false;
  e.log.listeners.visibilitychange();
  assert.equal(e.log.resumed, undefined, 'coming back is silent until a key');
  e.Sound.play('ok');
  assert.equal(e.log.resumed, 1);
  assert.deepEqual(names(e), ['launch', 'ok']);
});

test('the launcher can open the audio ahead of a key, once, in silence, and not behind an app', () => {
  const e = ready();
  e.document.hidden = true;
  e.Sound.prepare();
  assert.equal(e.log.contexts.length, 0);
  e.document.hidden = false;
  e.Sound.prepare();
  e.Sound.prepare();
  assert.equal(e.log.contexts.length, 1);
  assert.equal(e.log.started.length, 0);
  e.Sound.play('ok');
  assert.equal(e.log.contexts.length, 1);
  assert.equal(e.log.started.length, 1);
});

test('at rest the audio output closes, and a sound or the launcher opens it again', () => {
  const e = ready();
  e.Sound.rest();
  assert.equal(e.log.contexts.length, 0, 'resting does not open what is closed');
  e.Sound.prepare();
  e.Sound.rest();
  assert.equal(e.log.contexts[0].state, 'suspended');
  e.Sound.play('wake');
  assert.equal(e.log.contexts[0].state, 'running');
  assert.deepEqual(names(e), ['wake']);
  e.Sound.rest();
  e.Sound.prepare();
  assert.equal(e.log.contexts[0].state, 'running');
});

test('only Web Audio has something to open, and a refusal goes to the next method', () => {
  const element = ready({ web: false });
  element.Sound.prepare();
  assert.equal(element.log.contexts.length, 0);
  const refused = ready({ refuseContext: true });
  refused.Sound.prepare();
  assert.equal(refused.Sound.method(), 'element');
});

test('without Web Audio, an audio element plays a real WAV of the same samples', () => {
  const e = ready({ web: false });
  assert.equal(e.Sound.method(), 'element');
  e.Sound.setNight(true);
  e.Sound.play('ok');
  const played = e.log.elements.find(el => el.plays === 1);
  assert.ok(played);
  assert.ok(Math.abs(played.volume - .28) < 1e-9);
  const [head, data] = played.url.parts, view = new DataView(head), tag = at => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.deepEqual([view.getUint32(4, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true), view.getUint32(40, true)], [36 + 20, 1, 48000, 16, 20]);
  assert.equal(data.byteLength, 20);
  assert.equal(played.url.type, 'audio/wav');
  e.Sound.play('back');
  assert.equal(played.paused, 1, 'a voice still replaces itself');
});

test('a TV that refuses the audio context falls back to the audio element', () => {
  const e = ready({ refuseContext: true });
  assert.equal(e.Sound.method(), 'web');
  e.Sound.play('ok');
  assert.equal(e.Sound.method(), 'element');
  assert.deepEqual(names(e), []);
  e.arrive();
  e.Sound.play('ok');
  assert.deepEqual(names(e), ['ok']);
  assert.equal(e.Sound.played[0].method, 'element');
});

test('with neither, the TV\'s beeps answer the gestures that need one', () => {
  const e = engine({ web: false, element: false, tv: true });
  assert.equal(e.Sound.method(), 'beep');
  e.Sound.setFamily('verre');
  assert.equal(e.log.requests.length, 0, 'no samples are fetched for nothing');
  e.Sound.play('ok');
  e.Sound.play('panelIn');
  e.Sound.play('back');
  e.Sound.play('error');
  assert.deepEqual(e.log.beeps, ['SELECT', 'BACK', 'WARNING']);
  e.Sound.setLevel('coupes');
  e.Sound.play('ok');
  assert.equal(e.log.beeps.length, 3);
});

test('samples that cannot be read fall back to the beeps, and no TV means silence', () => {
  const e = engine({ tv: true });
  e.Sound.setFamily('verre');
  e.log.requests.shift().onerror();
  e.Sound.play('ok');
  assert.deepEqual(e.log.beeps, ['SELECT']);
  const quiet = engine();
  quiet.Sound.setFamily('verre');
  quiet.arrive(404);
  quiet.Sound.play('ok');
  assert.deepEqual(names(quiet), []);
});

test('the check on the TV can choose the method', () => {
  const e = ready();
  e.Sound.use('element');
  assert.equal(e.Sound.ready(), false);
  e.arrive();
  e.Sound.play('ok');
  assert.equal(e.Sound.played[0].method, 'element');
});
