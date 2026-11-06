/* The Duo sounds: raw samples played apart from the drawing, with no dependency. A key never waits for a sound:
   one that is not ready stays silent. Web Audio comes first, then an audio element, then the TV's own beeps. */
(function (root) {
  'use strict';

  var FILES = 'assets/sounds/';
  var LEVELS = { normal: 1, discret: 0.4, coupes: 0 };
  var NIGHT = { gain: 0.7, cutoff: 3000 }, DAY_CUTOFF = 20000;
  /* A new sound of the same voice replaces the last one, so nothing piles up. */
  var VOICES = {
    select: 'click', edge: 'click', 'switch': 'click', ok: 'press', back: 'press', panelIn: 'air', panelOut: 'air',
    wake: 'note', launch: 'note', sourceOn: 'note', sourceOff: 'note', error: 'note'
  };
  var PAN = 0.4;
  /* A held key must not rattle: the clicks space out and soften. */
  var HOLD = { window: 0.22, wait: 0.06, waitStep: 0.012, waitMax: 0.16, softStep: 0.08, softMin: 0.4 };
  /* The TV's beeps have no pitch or gain, so only the gestures that need an answer use them. */
  var BEEPS = { select: 'MOVE', 'switch': 'MOVE', ok: 'SELECT', back: 'BACK', error: 'WARNING' };

  var method = root.AudioContext && root.AudioBuffer ? 'web' : root.Audio && root.Blob && root.URL ? 'element' : 'beep';
  var banks = {}, loading = {}, failed = {}, waiting = null;
  var family = 'verre', level = 'discret', night = false, muted = false;
  var ctx = null, filter = null, master = null, active = {}, lastClick = -1, streak = 0, played = [];

  function toBuffer(samples, from, count, rate) {
    var buffer = new root.AudioBuffer({ length: count, numberOfChannels: 1, sampleRate: rate }), channel = buffer.getChannelData(0), i;
    for (i = 0; i < count; i++) channel[i] = samples[from + i] / 32768;
    return buffer;
  }
  /* An audio element needs a real file, so each sound gets the header of a WAV around its samples. */
  function toElement(data, from, count, rate) {
    var head = new root.ArrayBuffer(44), view = new root.DataView(head);
    function tag(at, text) { for (var i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i)); }
    tag(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, count * 2, true);
    return new root.Audio(root.URL.createObjectURL(new root.Blob([head, data.slice(from * 2, (from + count) * 2)], { type: 'audio/wav' })));
  }
  /* Only the chosen style takes up memory. */
  function arrived(name, entry, data) {
    var samples = new root.Int16Array(data), sounds = {}, hear = waiting;
    loading[name] = false;
    if (name !== family) return;
    Object.keys(entry.sounds).forEach(function (key) {
      var range = entry.sounds[key], rate = root.CleanFrameSounds.rate;
      sounds[key] = method === 'web' ? toBuffer(samples, range[0], range[1], rate) : toElement(data, range[0], range[1], rate);
    });
    banks = {};
    banks[name] = sounds;
    waiting = null;
    if (hear) hear();
  }
  function lost(name) { loading[name] = false; failed[name] = true; }
  function fetchBank(name) {
    var entry = root.CleanFrameSounds && root.CleanFrameSounds.families[name], xhr;
    if (!entry || banks[name] || loading[name] || failed[name] || method === 'beep') return;
    loading[name] = true;
    xhr = new root.XMLHttpRequest();
    xhr.open('GET', FILES + entry.file);
    xhr.responseType = 'arraybuffer';
    // A file inside the installed widget answers with status 0.
    xhr.onload = function () { if (xhr.status === 200 || !xhr.status && xhr.response) arrived(name, entry, xhr.response); else lost(name); };
    xhr.onerror = function () { lost(name); };
    xhr.send();
  }
  /* True if the style is ready. Otherwise whenLoaded runs when its sounds arrive. */
  function setFamily(name, whenLoaded) {
    family = name;
    if (banks[name]) { waiting = null; return true; }
    if (whenLoaded) waiting = whenLoaded;
    fetchBank(name);
    return false;
  }

  function apply() {
    if (!ctx) return;
    master.gain.value = LEVELS[level] * (night ? NIGHT.gain : 1);
    filter.frequency.value = night ? NIGHT.cutoff : DAY_CUTOFF;
  }
  /* Created at the first sound: a browser refuses to open the audio before a key. */
  function open() {
    try {
      ctx = new root.AudioContext();
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0;
      master = ctx.createGain();
      filter.connect(master);
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null;
      use(root.Audio && root.Blob && root.URL ? 'element' : 'beep');
      return false;
    }
    apply();
    return true;
  }
  function hush(key) {
    var voice = active[key], time;
    if (!voice) return;
    delete active[key];
    if (voice.pause) { voice.pause(); return; }
    time = ctx.currentTime;
    voice.amp.gain.setTargetAtTime(0, time, 0.004);
    voice.source.stop(time + 0.02);
  }
  function stopAll() { Object.keys(active).forEach(hush); }
  function use(name) {
    stopAll();
    method = name;
    banks = {};
    loading = {};
    failed = {};
    fetchBank(family);
  }

  function clip(name, note) {
    var sounds = banks[family];
    if (!sounds) return null;
    if (name === 'select') return sounds['select' + Math.max(0, Math.min(7, Math.round(note === undefined ? 3 : note)))];
    return sounds[name] || null;
  }
  function holdGain() {
    var time = root.performance.now() / 1000, gap = time - lastClick, next = gap < HOLD.window ? streak + 1 : 0;
    if (next && gap < Math.min(HOLD.waitMax, HOLD.wait + next * HOLD.waitStep)) return 0;
    streak = next;
    lastClick = time;
    return Math.max(HOLD.softMin, 1 - streak * HOLD.softStep);
  }
  function startWeb(buffer, voice, gain, x) {
    var source, amp, pan, self, waking;
    if (!ctx && !open()) return false;
    if (ctx.state === 'suspended') {
      stopAll();
      waking = ctx.resume();
      if (waking && waking.catch) waking.catch(function () {});
    }
    hush(voice);
    source = ctx.createBufferSource();
    amp = ctx.createGain();
    pan = ctx.createStereoPanner();
    self = { source: source, amp: amp };
    source.buffer = buffer;
    amp.gain.value = gain;
    pan.pan.value = (x - 0.5) * 2 * PAN;
    source.connect(amp);
    amp.connect(pan);
    pan.connect(filter);
    source.onended = function () {
      amp.disconnect();
      pan.disconnect();
      if (active[voice] === self) delete active[voice];
    };
    source.start(ctx.currentTime);
    active[voice] = self;
    return true;
  }
  function startElement(element, voice, gain) {
    var playing;
    hush(voice);
    element.volume = Math.min(1, LEVELS[level] * (night ? NIGHT.gain : 1) * gain);
    element.currentTime = 0;
    playing = element.play();
    if (playing && playing.catch) playing.catch(function () {});
    active[voice] = element;
    return true;
  }
  function beep(type) {
    try { root.tizen.tvaudiocontrol.playSound(type); return true; }
    catch (err) { return false; }
  }

  /* options: x (0 to 1, from the left of the screen to the right) and note (for select). */
  function play(name, options) {
    var opts = options || {}, voice = VOICES[name], beeps = method === 'beep' || failed[family], sound = beeps ? BEEPS[name] : clip(name, opts.note), gain = 1, x = opts.x === undefined ? 0.5 : opts.x, done;
    if (!sound || muted || !LEVELS[level]) return;
    if (voice === 'click') gain = holdGain();
    if (!gain) return;
    done = beeps ? beep(sound) : method === 'web' ? startWeb(sound, voice, gain, x) : startElement(sound, voice, gain);
    if (!done) return;
    played.push({ name: name, note: opts.note, family: family, gain: gain, pan: beeps || method === 'element' ? 0 : (x - 0.5) * 2 * PAN, level: level, night: night, method: beeps ? 'beep' : method });
    if (played.length > 400) played.shift();
  }

  /* The sound stops as soon as an app or a source takes over. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    stopAll();
    if (ctx) ctx.suspend();
  });

  root.Sound = {
    play: play,
    family: function () { return family; },
    setFamily: setFamily,
    setLevel: function (name) {
      if (name === level) return;
      level = name;
      apply();
      if (!LEVELS[name]) stopAll();
    },
    setNight: function (value) {
      if (value === night) return;
      night = value;
      apply();
    },
    setMuted: function (value) {
      muted = value;
      if (value) stopAll();
    },
    ready: function () { return !!banks[family]; },
    method: function () { return method; },
    /* For the final check on the TV, where the method is decided by ear. */
    use: use,
    /* For the checks: what was played, and where to listen. */
    played: played,
    clip: clip,
    context: function () { return ctx; },
    output: function () { return master; },
    filter: function () { return filter; }
  };
}(window));
