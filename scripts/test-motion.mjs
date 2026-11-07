// Spring engine against a simulated clock and a fake element. No browser and no TV.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function engine({ hidden = false } = {}) {
  const timers = [];
  const window = { document: { hidden }, setTimeout: (run, ms) => timers.push({ run, ms }) };
  vm.runInNewContext(readFileSync(new URL('../app/motion.js', import.meta.url), 'utf8'), { window });
  return { M: window.Motion, timers };
}
function element() {
  return {
    style: {}, played: [],
    animate(frames, options) {
      const anim = { frames, options, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; }, onfinish: null };
      this.played.push(anim);
      return anim;
    }
  };
}
const xOf = transform => Number(/translate3d\((-?[\d.]+)px/.exec(transform)[1]);

test('the plan\'s spring table is what the engine uses', () => {
  const { M } = engine();
  const table = { select: [.32, .12], focus: [.35, .25], blur: [.28, 0], press: [.30, .20], panelIn: [.50, .15], digit: [.45, 0] };
  for (const [name, [d, b]] of Object.entries(table)) assert.deepEqual([M.SPRINGS[name].d, M.SPRINGS[name].b], [d, b], name);
});

test('the motion solves x" = -k x - c v with k = (2 pi / d)^2 and c = (1 - b) 4 pi / d', () => {
  const { M } = engine();
  for (const name of Object.keys(M.SPRINGS)) {
    const spring = M.SPRINGS[name], k = (2 * Math.PI / spring.d) ** 2, c = (1 - spring.b) * 4 * Math.PI / spring.d, dt = 1e-5;
    for (const t of [.01, .05, .1, .2]) {
      const a = M.state(spring, 100, 0, t), before = M.state(spring, 100, 0, t - dt), after = M.state(spring, 100, 0, t + dt);
      assert.ok(Math.abs((after.x - before.x) / (2 * dt) - a.v) < .05, name + ' speed at ' + t);
      assert.ok(Math.abs((after.v - before.v) / (2 * dt) + k * a.x + c * a.v) < 2, name + ' acceleration at ' + t);
    }
  }
});

test('no bounce stays on one side of the target; a bounce overshoots a little', () => {
  const { M } = engine();
  const least = spring => { let low = 0; for (let t = 0; t < 2; t += .002) low = Math.min(low, M.state(spring, 100, 0, t).x); return low; };
  assert.equal(least(M.SPRINGS.blur), 0);
  const focus = least(M.SPRINGS.focus);
  assert.ok(focus < -1 && focus > -20, 'overshoot ' + focus);
});

test('a move starts where the element is, ends on the target and settles', () => {
  const { M } = engine();
  const el = element();
  M.set(el, { x: 10 });
  M.to(el, { x: 110 }, 'select');
  assert.equal(M.valueOf(el).x, 110);
  assert.equal(M.valueOf(el).moving, true);
  const { frames, options } = el.played[0];
  assert.equal(xOf(frames[0].transform), 10);
  assert.equal(xOf(frames[frames.length - 1].transform), 110);
  assert.ok(options.duration > 150 && options.duration < 1000, 'duration ' + options.duration);
  el.played[0].onfinish();
  assert.equal(M.valueOf(el).moving, false, 'nothing runs at rest');
});

test('the settling time is the last moment the motion can be seen', () => {
  const { M } = engine();
  for (const name of Object.keys(M.SPRINGS)) {
    const spring = M.SPRINGS[name];
    for (const [x0, v0] of [[116, 0], [-800, 0], [3, 400], [0, -900]]) {
      const end = M.settle(spring, { x: { x0, v0 } });
      let last = 0;
      for (let t = 3; t > 0 && !last; t -= 1 / 240) { const st = M.state(spring, x0, v0, t); if (Math.abs(st.x) > .2 || Math.abs(st.v) > 1.6) last = t; }
      assert.ok(Math.abs(end - last) <= 2 / 120, name + ' ' + x0 + ' ' + v0 + ': ' + end + ' against ' + last);
    }
  }
});

test('a small move takes fewer keyframes, and still follows the spring', () => {
  const { M } = engine();
  const small = element(), large = element(), fade = element();
  M.set(small, { s: .877 });
  M.to(small, { s: 1 }, 'focus');
  M.set(large, { x: 0 });
  M.to(large, { x: 116 }, 'select');
  M.set(fade, { o: 0 });
  M.to(fade, { o: 1 }, 'blur');
  assert.equal(small.played[0].frames.length, 9);
  assert.equal(large.played[0].frames.length, 15);
  assert.equal(fade.played[0].frames.length, 9);
  const { frames, options } = small.played[0], seconds = options.duration / 1000, scaleOf = frame => Number(/scale\(([\d.]+)\)/.exec(frame.transform)[1]);
  let worst = 0;
  for (let t = 0; t <= seconds; t += 1 / 240) {
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1].offset * seconds < t) i++;
    const from = frames[i].offset * seconds, to = frames[i + 1].offset * seconds, u = (t - from) / (to - from);
    const shown = scaleOf(frames[i]) + (scaleOf(frames[i + 1]) - scaleOf(frames[i])) * u;
    worst = Math.max(worst, Math.abs(shown - (1 + M.state(M.SPRINGS.focus, -.123, 0, t).x)) * 106);
  }
  assert.ok(worst < 1, 'a tile strays by ' + worst + ' pixels');
});

test('the keyframes follow the spring within a pixel or two', () => {
  const { M } = engine();
  for (const name of Object.keys(M.SPRINGS)) {
    const el = element();
    M.set(el, { x: 0 });
    M.to(el, { x: 116 }, name);
    const { frames, options } = el.played[0], seconds = options.duration / 1000;
    assert.ok(frames.length <= 15, 'frames ' + frames.length);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames[frames.length - 1].offset, 1);
    frames.forEach((frame, i) => assert.ok(!i || frame.offset > frames[i - 1].offset, 'offsets rise'));
    let worst = 0;
    for (let t = 0; t <= seconds; t += 1 / 240) {
      let i = 0;
      while (i < frames.length - 2 && frames[i + 1].offset * seconds < t) i++;
      const from = frames[i].offset * seconds, to = frames[i + 1].offset * seconds, u = (t - from) / (to - from);
      const shown = xOf(frames[i].transform) + (xOf(frames[i + 1].transform) - xOf(frames[i].transform)) * u;
      worst = Math.max(worst, Math.abs(shown - (116 + M.state(M.SPRINGS[name], -116, 0, t).x)));
    }
    assert.ok(worst < 2, name + ' strays by ' + worst);
  }
});

test('changing target in mid-flight keeps the position and the speed', () => {
  const { M } = engine();
  const el = element();
  M.set(el, { x: 0 });
  M.to(el, { x: 100 }, 'select');
  const first = el.played[0];
  first.currentTime = 80;
  const at = M.state(M.SPRINGS.select, -100, 0, .08);
  M.to(el, { x: 300 }, 'select');
  assert.equal(first.cancelled, true);
  const second = el.played[1];
  assert.ok(Math.abs(xOf(second.frames[0].transform) - Math.round(100 + at.x)) <= 1);
  assert.ok(Math.abs(el._m.channels.x.v0 - at.v) < 1e-9);
  assert.ok(Math.abs(el._m.channels.x.x0 - (100 + at.x - 300)) < 1e-9);
});

test('nothing is animated when there is nothing to do', () => {
  const { M } = engine();
  const el = element();
  M.set(el, { x: 5 });
  M.to(el, { x: 5 }, 'select');
  assert.equal(el.played.length, 0);
  M.to(el, { x: 50 }, 'select');
  M.to(el, { x: 50 }, 'select');
  assert.equal(el.played.length, 1, 'the same target does not restart the move');
});

test('hidden pages and reduced motion jump straight to the target', () => {
  const hidden = engine({ hidden: true }), el = element();
  hidden.M.to(el, { x: 70 }, 'select');
  assert.equal(el.played.length, 0);
  assert.equal(xOf(el.style.transform), 70);
  const reduced = engine(), other = element();
  reduced.M.setJump(true);
  reduced.M.to(other, { x: 70, o: .5 }, 'select');
  assert.equal(other.played.length, 0);
  assert.equal(other.style.opacity, '0.500');
});

test('OK settles the element, then returns to its rest size', () => {
  const { M, timers } = engine();
  const el = element();
  M.set(el, { s: .877 });
  M.press(el);
  assert.ok(Math.abs(M.valueOf(el).s - .877 * .96) < 1e-9);
  assert.equal(timers[0].ms, 90);
  timers[0].run();
  assert.equal(M.valueOf(el).s, .877);
  M.press(el, 1);
  timers[1].run();
  assert.equal(M.valueOf(el).s, 1, 'an explicit rest wins over the current size');
});
