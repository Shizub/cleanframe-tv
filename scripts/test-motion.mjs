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
