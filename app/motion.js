/* Apple-style springs (duration + bounce) played by the compositor. No dependency, ES5, Chromium 85.
   Each move is sampled once into WAAPI keyframes, so nothing runs at rest. */
(function (root) {
  'use strict';

  var SPRINGS = {
    select: { d: 0.32, b: 0.12 },
    focus: { d: 0.35, b: 0.25 },
    blur: { d: 0.28, b: 0 },
    press: { d: 0.30, b: 0.20 },
    panelIn: { d: 0.50, b: 0.15 },
    panelOut: { d: 0.35, b: 0 },
    digit: { d: 0.45, b: 0 }
  };
  var KEYS = 28;
  var DEFAULTS = { x: 0, y: 0, s: 1, o: 1 };
  var EPS = { x: 0.2, y: 0.2, s: 0.0007, o: 0.003 };
  var jump = false;

  /* x and v are the distance to the target and its speed, t seconds after the start. */
  function state(spring, x0, v0, t) {
    var w0 = 2 * Math.PI / spring.d;
    var zeta = 1 - spring.b;
    var decay, c, s;
    if (zeta >= 1) {
      decay = Math.exp(-w0 * t);
      c = v0 + w0 * x0;
      return { x: decay * (x0 + c * t), v: decay * (v0 - w0 * c * t) };
    }
    var wd = w0 * Math.sqrt(1 - zeta * zeta);
    decay = Math.exp(-zeta * w0 * t);
    c = Math.cos(wd * t);
    s = Math.sin(wd * t);
    return {
      x: decay * (x0 * c + ((v0 + zeta * w0 * x0) / wd) * s),
      v: decay * (v0 * c - ((zeta * w0 * v0 + w0 * w0 * x0) / wd) * s)
    };
  }

  function settle(spring, channels) {
    var t, name, st, step = 1 / 120, end = 3;
    for (t = end; t > 0; t -= step) {
      for (name in channels) {
        st = state(spring, channels[name].x0, channels[name].v0, t);
        if (Math.abs(st.x) > EPS[name] || Math.abs(st.v) > EPS[name] * 8) return Math.min(end, t + step);
      }
    }
    return step;
  }

  /* Whole pixels only: a layer straddling two pixels turns soft on the TV. */
  function px(value) { return Math.round(value).toFixed(3); }
  function css(values) {
    return 'translate3d(' + px(values.x) + 'px,' + px(values.y) + 'px,0) scale(' + values.s.toFixed(4) + ')';
  }

  function record(el) {
    if (!el._m) el._m = { x: 0, y: 0, s: 1, o: 1, anim: null, spring: null, channels: null };
    return el._m;
  }

  function write(el, m) {
    el.style.transform = css(m);
    el.style.opacity = m.o === 1 ? '' : m.o.toFixed(3);
  }

  function set(el, values) {
    var m = record(el), key;
    if (m.anim) { m.anim.cancel(); m.anim = null; }
    for (key in values) if (key in DEFAULTS) m[key] = values[key];
    write(el, m);
  }

  function sameTarget(m, values) {
    var key;
    for (key in values) if (key in DEFAULTS && values[key] !== m[key]) return false;
    return true;
  }

  /* Moves to the target from the current position and speed, so a change of mind stays smooth. */
  function to(el, values, name) {
    var m = record(el), spring = SPRINGS[name] || SPRINGS.select, channels = {}, key, moving = false, now = null;
    if (jump || root.document.hidden || !el.animate) { set(el, values); return; }
    if (m.anim && m.spring === spring && sameTarget(m, values)) return;
    if (m.anim && m.anim.currentTime !== null) now = m.anim.currentTime / 1000;
    for (key in DEFAULTS) {
      var target = key in values ? values[key] : m[key], from = m[key], velocity = 0;
      if (now !== null && m.channels && m.channels[key]) {
        var st = state(m.spring, m.channels[key].x0, m.channels[key].v0, now);
        from = m[key] + st.x;
        velocity = st.v;
      }
      channels[key] = { x0: from - target, v0: velocity, target: target };
      if (Math.abs(channels[key].x0) > EPS[key] || Math.abs(velocity) > EPS[key]) moving = true;
    }
    if (!moving && !m.anim) { for (key in values) m[key] = values[key]; return; }
    var active = {};
    for (key in channels) if (Math.abs(channels[key].x0) > EPS[key] || Math.abs(channels[key].v0) > EPS[key]) active[key] = channels[key];
    var duration = settle(spring, active), frames = [], animateOpacity = 'o' in active, i, t, sample;
    for (i = 0; i <= KEYS; i++) {
      t = duration * i / KEYS;
      sample = {};
      for (key in channels) sample[key] = channels[key].target + (i === KEYS || !active[key] ? 0 : state(spring, channels[key].x0, channels[key].v0, t).x);
      var frame = { transform: css(sample) };
      if (animateOpacity) frame.opacity = Math.max(0, Math.min(1, sample.o)).toFixed(3);
      frames.push(frame);
    }
    if (m.anim) m.anim.cancel();
    for (key in channels) m[key] = channels[key].target;
    write(el, m);
    var anim = el.animate(frames, { duration: duration * 1000, easing: 'linear', fill: 'none' });
    m.anim = anim;
    m.spring = spring;
    m.channels = channels;
    anim.onfinish = function () { if (m.anim === anim) { m.anim = null; m.channels = null; } };
  }

  /* OK: the element settles down, then returns while keeping its speed. */
  function press(el, rest) {
    var m = record(el), base = rest === undefined ? m.s : rest;
    to(el, { s: base * 0.96 }, 'press');
    root.setTimeout(function () { to(el, { s: base }, 'press'); }, 90);
  }

  root.Motion = {
    SPRINGS: SPRINGS, state: state, settle: settle, set: set, to: to, press: press,
    setJump: function (value) { jump = value; },
    valueOf: function (el) { var m = record(el); return { x: m.x, y: m.y, s: m.s, o: m.o, moving: !!m.anim }; }
  };
}(window));
