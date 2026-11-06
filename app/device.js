/* Public Tizen application APIs. No Mac server, network address or credentials. */
(function () {
  'use strict';
  var IDS = {
    netflix: 'org.tizen.netflix-app', youtube: '9Ur5IzDKqV.TizenYouTube',
    primevideo: 'org.tizen.primevideo', disneyplus: 'MCmYXNxgcu.DisneyPlus',
    appletv: 'com.samsung.tv.aria-video', spotify: 'rJeHak5zRg.Spotify'
  };
  var STREAMING = ['as6cYRgkPy.Binge', '73iTZRTc34.Stan', '5b8c3eb16b.BeamCTVDev',
    'cj37Ni3qXM.HBONow', 'LBUAQX1exg.Hulu', 'gzcc4LRFBF.Peacock', 'rJyOSqC6Up.CBSAllAccess',
    'Rk72oKFsRS.OtterKidsProd', '70fRFUwYlD.OtterGAProd', 'PvWgqxV3Xa.YouTubeTV',
    'XtU8fQk2gN.ESPN', 'ZmmGjO6VKO.slingtv', 'VtuWAiZdHN.STARZPlay', 'ckfgqqzvt0.dplus',
    'kk8MbItQ0H.VUDU', 'Jz7aUrV2Q4.Twitch', 'OK2Rdkjmsi.IMDbTV', 'Ob3XhAVMu6.amcplus',
    'KaLitts8bq.tenplaySamsungTizen', 'eYuOiOLYQX.KayoSports', 'Ne2ZsPWdKl.9NOW',
    '3KA0pm7a7V.TubiTV', 'rJeHak5zRg.Spotify', 'icp4AvUPiA.7plus'];
  var CONSUMER_SYSTEM = ['org.tizen.browser', 'com.microsoft.copilot', 'org.tizen.apple.apple-music'];
  var EXTRA_BRANDS = {'rJeHak5zRg.Spotify': 'spotify', '5b8c3eb16b.BeamCTVDev': 'hbomax', 'cj37Ni3qXM.HBONow': 'hbomax', '3KA0pm7a7V.TubiTV': 'tubi', 'org.tizen.apple.apple-music': 'applemusic'};
  var INTERNAL = ['adplatform.ADPlayer', 'WykOS4t4F0.cmsWebApp', '25emanual3.emanual',
    'd0m1lV1nt2.emanual', '2022ePop01.SmartTV',
    'ZODRT12q2l.WebAccountExtension', 'ByJlgt0XeD.CastSettingsApp', 'tv6pbVMQFF.PrivacyChoices'];
  var SELF = 'nClrkHome1.FrameHome';
  function api() { return window.tizen && window.tizen.application; }
  function selfId() {
    try { return api().getCurrentApplication().appInfo.id || SELF; }
    catch (err) { return SELF; }
  }
  function unavailable(done) {
    done({ message: 'Ouvrez CleanFrame sur la télé pour utiliser cette commande.', detail: 'L’aperçu web ne peut pas contrôler la télé.' });
  }
  function failure(err) {
    return { message: 'La télé n’a pas pu ouvrir cet écran.', detail: err && (err.message || err.name) || 'Réessayez, ou rouvrez CleanFrame depuis l’accueil Samsung.' };
  }
  function bounded(done, timeout) {
    var finished = false, timer = setTimeout(function () { finish({ message: 'La télé n’a pas répondu. Réessayez.' }); }, timeout || 8000);
    function finish(err, value) { if (finished) return; finished = true; clearTimeout(timer); done(err, value); }
    return finish;
  }
  var sourceCancel = null;
  function cancelSource() { if (sourceCancel) sourceCancel(); }
  function sources(done) {
    var sys = window.tizen && window.tizen.systeminfo, tvw = window.tizen && window.tizen.tvwindow;
    if (!sys || typeof sys.getPropertyValue !== 'function' || !tvw || typeof tvw.setSource !== 'function') { unavailable(done); return; }
    var finish = bounded(done);
    try {
      sys.getPropertyValue('VIDEOSOURCE', function (video) {
        var list = [], byPort = {}, active = null;
        try { if (typeof tvw.getSource === 'function') active = tvw.getSource(); } catch (err) { /* Status may be unavailable while discovery still works. */ }
        function record(src, connected) {
          if (!src || src.type !== 'HDMI' || typeof src.number !== 'number' || !isFinite(src.number) || src.number < 0 || Math.floor(src.number) !== src.number) return;
          var key = String(src.number), item = byPort[key];
          if (!item) {
            item = { number: src.number, name: 'HDMI ' + src.number, connected: false, active: !!(active && active.type === 'HDMI' && active.number === src.number), source: src };
            byPort[key] = item; list.push(item);
          }
          if (connected) { item.connected = true; item.source = src; }
        }
        if (video && Array.isArray(video.disconnected)) video.disconnected.forEach(function (src) { record(src, false); });
        if (video && Array.isArray(video.connected)) video.connected.forEach(function (src) { record(src, true); });
        list.sort(function (a, b) { return a.number - b.number; });
        finish(null, list);
      }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  function setSource(port, done) {
    cancelSource();
    var tvw = window.tizen && window.tizen.tvwindow, app = api(), finished = false;
    if (typeof port !== 'number' || !isFinite(port) || port < 0 || Math.floor(port) !== port) { done({ message: 'Cette entrée HDMI n’est pas disponible.' }); return; }
    if (!tvw || typeof tvw.setSource !== 'function' || !app || typeof app.launch !== 'function') { unavailable(done); return; }
    var timer = setTimeout(function () { finish({ message: 'La télé n’a pas répondu. Réessayez.' }); }, 8000);
    function finish(err, value) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (sourceCancel === cancel) sourceCancel = null;
      done(err, value);
    }
    function cancel() { finish({ message: 'Changement d’entrée annulé.', cancelled: true }); }
    sourceCancel = cancel;
    sources(function (err, list) {
      if (finished) return;
      if (err) { finish(err); return; }
      var input = null;
      list.some(function (item) { if (item.number === port) { input = item; return true; } return false; });
      if (!input) { finish({ message: 'Cette entrée HDMI n’est plus disponible.' }); return; }
      try {
        tvw.setSource(input.source, function (selected) {
          if (finished) return;
          if (selected && (selected.type !== 'HDMI' || selected.number !== port)) { finish({ message: 'La télé a choisi une autre entrée. Réessayez.' }); return; }
          try {
            app.launch('org.tizen.tv-viewer', function () { finish(null, input); }, function () {
              finish({ message: 'L’entrée est choisie, mais l’affichage TV n’a pas pu s’ouvrir.', detail: 'Utilisez la touche Source de la télécommande pour afficher l’entrée.' });
            });
          } catch (error) { finish({ message: 'L’entrée est choisie, mais l’affichage TV n’a pas pu s’ouvrir.' }); }
        }, function (error) { if (!finished) finish(failure(error)); });
      } catch (error) { finish(failure(error)); }
    });
  }
  function launchApp(id, done) {
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done);
    try { api().launch(id, function () { finish(null); }, function (err) { finish(failure(err)); }); }
    catch (err) { finish(failure(err)); }
  }
  function launch(brand, done) {
    if (!IDS[brand]) { done({message: 'Cette appli ne peut pas être lancée.'}); return; }
    launchApp(IDS[brand], done);
  }
  function art(done) {
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done);
    try {
      var data = [new tizen.ApplicationControlData('mode', ['fullscreen']), new tizen.ApplicationControlData('requester', ['mobile'])];
      var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
      api().launchAppControl(control, 'org.tizen.art-app', function () { finish(null); }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  function home(done) { launchApp('com.samsung.tv.csfs', done); }
  function settings(done) { launchApp('com.samsung.tv.coba.setting', done); }
  function apps(done) {
    if (!api()) { unavailable(done); return; }
    // Large installed catalogues can take longer than a launch response.
    var finish = bounded(function (err, found) { if (err) done(err); else done(null, found.apps, found.installed); }, 20000);
    try {
      api().getAppsInfo(function (list) {
        var known = {}, seen = {}, result = [], self = selfId();
        Object.keys(IDS).forEach(function (brand) { known[IDS[brand]] = brand; });
        list.forEach(function (a) {
          var primary = !!known[a.id], stream = STREAMING.indexOf(a.id) >= 0;
          var consumer = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/.test(a.id) || CONSUMER_SYSTEM.indexOf(a.id) >= 0;
          if (a.id === self || INTERNAL.indexOf(a.id) >= 0 || seen[a.id] || !a.name || (!primary && !stream && (!a.show || !consumer))) return;
          if (!primary && /(?:service|worker|preview|promotion|plugin|launcher|test|sdk|^ep[ -]|factory|daemon)/i.test(a.name + ' ' + a.id)) return;
          if (/-dummy$/.test(a.id) || a.id === 'com.samsung.tv.cobalt-yt') return;
          seen[a.id] = true;
          result.push({ appId: a.id, name: a.name, brand: known[a.id] || EXTRA_BRANDS[a.id] || '', icon: a.iconPath || '', rank: primary ? Object.keys(IDS).indexOf(known[a.id]) : (stream ? 20 : 30) });
        });
        result.sort(function (a, b) { return a.rank - b.rank || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        finish(null, { apps: result, installed: list.map(function (a) { return a.id; }) });
      }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  window.FrameDevice = { launch: launch, launchApp: launchApp, art: art, home: home, settings: settings, apps: apps, sources: sources, setSource: setSource, cancelSource: cancelSource };
}());
