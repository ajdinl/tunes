// A stand-in for SoundCloud's Widget API (https://w.soundcloud.com/player/api.js), served to
// the browser by the end-to-end tests. It follows the documented surface the app uses
// (SC.Widget(iframe), bind, play, pause, seekTo, setVolume, getDuration, getCurrentSound,
// getSounds, getCurrentSoundIndex, load) and records every call in window.__sc.calls.
// window.__sc.nextSound() moves a set on to its next song, like the real widget does.
(() => {
  const Events = { READY: 'ready', PLAY: 'play', PAUSE: 'pause', PLAY_PROGRESS: 'playProgress', FINISH: 'finish', ERROR: 'error' };
  const SETS = {
    sets: [
      { id: 101, title: 'First Song', duration: 180000, user: { username: 'Nadia Vale' }, artwork_url: null },
      { id: 102, title: 'Second Song', duration: 150000, user: { username: 'Nadia Vale' }, artwork_url: null },
    ],
  };
  const soundsFor = (url) => (/\/sets\//.test(url) ? SETS.sets : [{ id: 7, title: 'Slow River', duration: 190000, user: { username: 'Nadia Vale' }, artwork_url: null }]);

  const state = { calls: [], widgets: [] };
  window.__sc = state;

  function Widget(iframe) {
    const handlers = {};
    const src = new URL(iframe.src);
    let url = src.searchParams.get('url');
    let sounds = soundsFor(url);
    let index = 0;
    let position = 0;
    let playing = false;
    let timer = 0;
    const fire = (ev, data) => (handlers[ev] || []).forEach((fn) => fn(data || {}));
    const log = (name, ...args) => state.calls.push([name, ...args]);
    const tick = () => {
      position += 250;
      fire(Events.PLAY_PROGRESS, { currentPosition: position, relativePosition: position / sounds[index].duration });
    };
    const w = {
      bind(ev, fn) { (handlers[ev] ||= []).push(fn); },
      unbind(ev) { delete handlers[ev]; },
      play() {
        log('play');
        if (playing) return;
        playing = true;
        timer = setInterval(tick, 250);
        fire(Events.PLAY);
      },
      pause() {
        log('pause');
        if (!playing) return;
        playing = false;
        clearInterval(timer);
        fire(Events.PAUSE);
      },
      toggle() { (playing ? w.pause : w.play)(); },
      seekTo(ms) { log('seekTo', ms); position = ms; fire(Events.PLAY_PROGRESS, { currentPosition: position }); },
      setVolume(v) { log('setVolume', v); },
      getDuration(cb) { cb(sounds[index].duration); },
      getPosition(cb) { cb(position); },
      getCurrentSound(cb) { cb(sounds[index]); },
      getSounds(cb) { cb(sounds); },
      getCurrentSoundIndex(cb) { cb(index); },
      isPaused(cb) { cb(!playing); },
      load(newUrl, opts = {}) {
        log('load', newUrl);
        w.pause();
        url = newUrl;
        sounds = soundsFor(url);
        index = 0;
        position = 0;
        setTimeout(() => { opts.callback?.(); if (opts.auto_play) w.play(); }, 30);
      },
      // test controls
      nextSound() {
        index = Math.min(index + 1, sounds.length - 1);
        position = 0;
        fire(Events.PLAY);
      },
      get url() { return url; },
      get playing() { return playing; },
    };
    state.widgets.push(w);
    state.nextSound = () => state.widgets.at(-1).nextSound();
    // The real widget fires READY once the iframe has loaded.
    setTimeout(() => fire(Events.READY), 50);
    return w;
  }
  Widget.Events = Events;
  window.SC = { Widget };
})();
