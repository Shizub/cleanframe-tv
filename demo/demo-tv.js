/* A simulated Samsung TV for the browser demo. It has the shape of Tizen's public API, and nothing is ever launched. It is only added to the demo build, never to the TV package. */
(function () {
  'use strict';
  var APPS = [
    ['org.tizen.netflix-app', 'Netflix'], ['9Ur5IzDKqV.TizenYouTube', 'YouTube'], ['org.tizen.primevideo', 'Prime Video'], ['MCmYXNxgcu.DisneyPlus', 'Disney+'],
    ['com.samsung.tv.aria-video', 'Apple TV'], ['rJeHak5zRg.Spotify', 'Spotify'], ['cj37Ni3qXM.HBONow', 'Max'], ['org.tizen.apple.apple-music', 'Apple Music'],
    ['Demo123456.myCANAL', 'myCANAL'], ['Demo123456.francetv', 'france.tv'], ['Demo123456.ARTE', 'ARTE'], ['Jz7aUrV2Q4.Twitch', 'Twitch'],
    ['Demo123456.Deezer', 'Deezer'], ['Demo123456.Plex', 'Plex'], ['3KA0pm7a7V.TubiTV', 'Tubi'], ['Demo123456.Stremio', 'Stremio']
  ];
  var SCREENS = { 'com.samsung.tv.csfs': 'le menu Samsung', 'com.samsung.tv.coba.setting': 'les réglages de la télé', 'org.tizen.art-app': 'le Mode Art' };
  var HDMI = [1, 2, 3, 4].map(function (number) { return { type: 'HDMI', number: number }; });
  var source = HDMI[0], note = null, timer = null, volume = 18, muted = false, plugged = 2, plugListener = null;
  var VOLUME_KEYS = { VolumeUp: 447, VolumeDown: 448, VolumeMute: 449 };

  /* On a real TV the launcher hides and comes back. Here it stays, so it only hears about the return. */
  function opened(what) {
    document.dispatchEvent(new Event('visibilitychange'));
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:50%;top:32px;transform:translateX(-50%);z-index:9;padding:14px 26px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:600 26px Manrope,system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(note);
    }
    note.textContent = 'Démo : sur la télé, ' + what + ' s’ouvrirait ici.';
    note.style.display = 'block';
    clearTimeout(timer);
    timer = setTimeout(function () { note.style.display = 'none'; }, 2500);
  }
  function nameOf(id) {
    var found = APPS.filter(function (app) { return app[0] === id; })[0];
    if (found) return found[1];
    if (id === 'org.tizen.tv-viewer') return 'HDMI ' + source.number;
    return SCREENS[id] || id;
  }

  window.tizen = {
    ApplicationControlData: function (key, value) { this.key = key; this.value = value; },
    ApplicationControl: function (operation, uri, mime, category, data) { this.operation = operation; this.data = data; },
    application: {
      getCurrentApplication: function () { return { appInfo: { id: 'nClrkHome1.FrameHome' } }; },
      getAppsInfo: function (ok) {
        setTimeout(function () { ok(APPS.map(function (app) { return { id: app[0], name: app[1], show: true, iconPath: '' }; })); }, 120);
      },
      launch: function (id, ok) { setTimeout(function () { ok(); opened(nameOf(id)); }, 120); },
      launchAppControl: function (control, id, ok) { setTimeout(function () { ok(); opened(nameOf(id)); }, 120); }
    },
    systeminfo: {
      getPropertyValue: function (name, ok) { setTimeout(function () { ok({ connected: HDMI.slice(0, plugged), disconnected: HDMI.slice(plugged) }); }, 120); },
      addPropertyValueChangeListener: function (name, run) { plugListener = run; }
    },
    tvwindow: {
      getSource: function () { return source; },
      setSource: function (chosen, ok) { source = chosen; setTimeout(function () { ok(chosen); }, 120); }
    },
    tvaudiocontrol: {
      getVolume: function () { return volume; },
      isMute: function () { return muted; },
      setVolumeUp: function () { volume = Math.min(100, volume + 1); muted = false; },
      setVolumeDown: function () { volume = Math.max(0, volume - 1); muted = false; },
      setMute: function (value) { muted = value; }
    },
    tvinputdevice: {
      getKey: function (name) { return VOLUME_KEYS[name] ? { name: name, code: VOLUME_KEYS[name] } : null; },
      registerKey: function () {},
      unregisterKey: function () {}
    }
  };

  function press(code) {
    ['keydown', 'keyup'].forEach(function (type) {
      var event = new KeyboardEvent(type, { bubbles: true });
      Object.defineProperty(event, 'keyCode', { get: function () { return code; } });
      document.dispatchEvent(event);
    });
  }

  /* A keyboard has no volume keys: + - and X stand in, and P plugs or unplugs a device on HDMI 3. */
  document.addEventListener('keydown', function (event) {
    var code = { '+': 447, '=': 447, '-': 448, x: 449, X: 449 }[event.key];
    // Inside the page's frame, the arrows must not scroll the page around it.
    if (event.keyCode >= 37 && event.keyCode <= 40) event.preventDefault();
    if (code) press(code);
    if ((event.key === 'p' || event.key === 'P') && plugListener) { plugged = plugged === 2 ? 3 : 2; plugListener(); }
  });

  /* The page around the TV sends the on-screen remote's presses here. */
  window.addEventListener('message', function (event) {
    if (event.data && typeof event.data.remote === 'number') press(event.data.remote);
  });
}());
