// Skala risivera: spektar zvuka uživo, podeoci vremena i kazaljka.
// Isti crtač se koristi u traci na dnu i na ekranu "Sada svira".
import { player } from './player.js';

const AMBER = [255, 181, 71];
const NEEDLE = '#ff5e3a';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const dials = new Set();
let raf = 0;
let freq = null;

function loop() {
  raf = requestAnimationFrame(loop);
  if (document.hidden) return;
  const a = player.analysing ? player.analyser : null;
  if (a) {
    if (!freq || freq.length !== a.frequencyBinCount) freq = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(freq);
  }
  for (const d of dials) d.draw(a ? freq : null, a ? a.context.sampleRate : 44100);
}

export class Dial {
  constructor(canvas, { big = false } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.big = big;
    this.bars = new Float32Array(256);
    this.hoverX = null;
    this.font = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif';
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    dials.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(freq, sampleRate) {
    const { g, w, h } = this;
    if (!w || !h || this.c.offsetParent === null) return;
    g.clearRect(0, 0, w, h);
    const t = player.track;
    const live = Boolean(t?.live);
    const dur = player.duration;
    const progress = !live && Number.isFinite(dur) && dur > 0 ? Math.min(1, player.time / dur) : 0;

    const labelH = this.big ? 16 : 12;
    const tickH = this.big ? 10 : 7;
    const baseY = h - labelH - tickH - 2;
    const pad = this.big ? 18 : 12;
    const x0 = pad, x1 = w - pad, span = x1 - x0;

    // ---- spektar
    const gap = this.big ? 3 : 2;
    const bw = this.big ? 5 : 3;
    const n = Math.max(8, Math.min(256, Math.floor(span / (bw + gap))));
    const playing = player.playing && !reduced.matches;
    if (freq && playing) {
      const nyq = sampleRate / 2;
      const bins = freq.length;
      let prevBin = 1;
      for (let i = 0; i < n; i++) {
        const f = 30 * Math.pow(16000 / 30, (i + 1) / n);
        const bin = Math.min(bins - 1, Math.max(prevBin, Math.round((f / nyq) * bins)));
        let v = 0;
        for (let b = prevBin; b <= bin; b++) v = Math.max(v, freq[b]);
        prevBin = bin + 1;
        // Viši tonovi imaju manje energije: blago ih podižemo da skala izgleda ravnomerno.
        const tilt = 1 + (i / n) * 0.35;
        const target = Math.min(1, Math.pow(v / 255, 1.5) * tilt);
        this.bars[i] = target > this.bars[i] ? target : this.bars[i] * 0.9;
      }
    } else {
      for (let i = 0; i < n; i++) this.bars[i] *= 0.9;
    }
    const maxH = baseY - (this.big ? 10 : 6);
    const needleX = live ? x0 + span * stationPos(t) : x0 + span * progress;
    const lit = new Path2D(), dim = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (bw + gap);
      const bh = Math.max(1.5, this.bars[i] * maxH);
      (live || x < needleX ? lit : dim).rect(x, baseY - bh, bw, bh);
    }
    g.save();
    g.shadowColor = `rgba(${AMBER},0.75)`;
    g.shadowBlur = this.big ? 14 : 8;
    g.fillStyle = `rgba(${AMBER},0.95)`;
    g.fill(lit);
    g.shadowBlur = 0;
    g.fillStyle = `rgba(${AMBER},0.32)`;
    g.fill(dim);
    g.restore();

    // ---- podeoci i oznake
    g.strokeStyle = `rgba(${AMBER},0.55)`;
    g.fillStyle = `rgba(${AMBER},0.7)`;
    g.lineWidth = 1;
    g.font = `500 ${this.big ? 11 : 9.5}px ${this.font}`;
    g.textBaseline = 'top';
    const tickY = baseY + 3;
    g.beginPath();
    if (live) {
      // Radio: FM skala 87.5 – 108 MHz, kao na pravom risiveru.
      for (let mhz = 88; mhz <= 108; mhz += 0.5) {
        const x = x0 + span * ((mhz - 87.5) / 20.5);
        const major = mhz % 2 === 0;
        g.moveTo(Math.round(x) + 0.5, tickY);
        g.lineTo(Math.round(x) + 0.5, tickY + (major ? tickH : tickH * 0.5));
      }
      g.stroke();
      g.textAlign = 'center';
      const step = span < 300 ? 4 : 2;
      for (let mhz = 88; mhz <= 108; mhz += step) {
        g.fillText(String(mhz), x0 + span * ((mhz - 87.5) / 20.5), tickY + tickH + 2);
      }
    } else if (Number.isFinite(dur) && dur > 0) {
      const major = pickStep(dur, span);
      const minor = major / 4;
      for (let s = 0; s <= dur + 0.01; s += minor) {
        const x = x0 + span * (s / dur);
        const isMajor = Math.abs(s / major - Math.round(s / major)) < 0.001;
        g.moveTo(Math.round(x) + 0.5, tickY);
        g.lineTo(Math.round(x) + 0.5, tickY + (isMajor ? tickH : tickH * 0.45));
      }
      g.stroke();
      g.textAlign = 'center';
      for (let s = major; s < dur - major * 0.4; s += major) {
        g.fillText(label(s), x0 + span * (s / dur), tickY + tickH + 2);
      }
    } else {
      for (let x = x0; x <= x1; x += span / 40) { g.moveTo(Math.round(x) + 0.5, tickY); g.lineTo(Math.round(x) + 0.5, tickY + tickH * 0.45); }
      g.stroke();
    }

    // ---- pozicija pod mišem
    if (this.hoverX !== null && !live && dur > 0) {
      g.strokeStyle = 'rgba(236,230,214,0.45)';
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(Math.round(this.hoverX) + 0.5, 4);
      g.lineTo(Math.round(this.hoverX) + 0.5, baseY + tickH + 3);
      g.stroke();
      g.setLineDash([]);
    }

    // ---- kazaljka
    if (t) {
      const nx = Math.round(needleX) + 0.5;
      g.save();
      g.shadowColor = NEEDLE;
      g.shadowBlur = this.big ? 12 : 8;
      g.strokeStyle = NEEDLE;
      g.lineWidth = this.big ? 2.5 : 2;
      g.beginPath();
      g.moveTo(nx, 2);
      g.lineTo(nx, baseY + tickH + 3);
      g.stroke();
      g.restore();
    }
  }

  // Pretvara poziciju miša u vreme pesme.
  timeAt(clientX) {
    const r = this.c.getBoundingClientRect();
    const pad = this.big ? 18 : 12;
    const p = (clientX - r.left - pad) / (r.width - pad * 2);
    return Math.max(0, Math.min(1, p)) * player.duration;
  }

  xAt(clientX) {
    return clientX - this.c.getBoundingClientRect().left;
  }
}

function pickStep(dur, span) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const maxLabels = Math.max(2, Math.floor(span / 48));
  return steps.find((s) => dur / s <= maxLabels) || 3600;
}

function label(s) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:00`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Svaka stanica dobija svoju "frekvenciju" na skali.
function stationPos(t) {
  let x = 0;
  for (const ch of t?.id || '') x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.06 + (x % 1000) / 1000 * 0.88;
}

export function stationFreq(t) {
  return (87.5 + stationPos(t) * 20.5).toFixed(1);
}
