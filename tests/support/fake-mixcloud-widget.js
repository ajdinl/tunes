// A stand-in for Mixcloud's Widget API (https://widget.mixcloud.com/media/js/widgetApi.js),
// served to the browser by the end-to-end tests. It follows the documented surface the app
// uses (Mixcloud.PlayerWidget(iframe): ready, events.<name>.on, load, play, pause, seek,
// setVolume) and records every call in window.__mc.calls. window.__mc.end() finishes the show.
(() => {
  const state = { calls: [], widgets: [] };
  window.__mc = state;

  function PlayerWidget(iframe) {
    const handlers = {};
    const events = {};
    for (const name of ['progress', 'buffering', 'play', 'pause', 'ended', 'error']) {
      handlers[name] = [];
      events[name] = { on: (fn) => handlers[name].push(fn), off: (fn) => { handlers[name] = handlers[name].filter((f) => f !== fn); } };
    }
    const fire = (name, ...args) => handlers[name].forEach((fn) => fn(...args));
    const log = (name, ...args) => state.calls.push([name, ...args]);
    const src = new URL(iframe.src);
    let key = src.searchParams.get('feed');
    let position = 0;
    let playing = false;
    let timer = 0;
    const duration = 3600;
    const tick = () => { position += 1; fire('progress', position, duration); };
    const w = {
      events,
      ready: null,
      async play() {
        log('play');
        if (playing) return;
        playing = true;
        timer = setInterval(tick, 250);
        fire('play');
      },
      async pause() {
        log('pause');
        if (!playing) return;
        playing = false;
        clearInterval(timer);
        fire('pause');
      },
      async seek(seconds) { log('seek', seconds); position = seconds; fire('progress', position, duration); return true; },
      async setVolume(v) { log('setVolume', v); },
      async getIsPaused() { return !playing; },
      async load(newKey, startPlaying) {
        log('load', newKey, startPlaying);
        await w.pause();
        key = newKey;
        position = 0;
        if (startPlaying) await w.play();
      },
      // test controls
      end() { playing = false; clearInterval(timer); fire('ended'); },
      get key() { return key; },
      get playing() { return playing; },
    };
    // The real widget answers once the iframe has loaded; autoplay=1 starts the show.
    w.ready = new Promise((resolve) => setTimeout(() => { resolve(w); if (src.searchParams.get('autoplay') === '1') setTimeout(() => w.play(), 0); }, 50));
    state.widgets.push(w);
    state.end = () => state.widgets.at(-1).end();
    return w;
  }
  window.Mixcloud = { PlayerWidget };
})();
