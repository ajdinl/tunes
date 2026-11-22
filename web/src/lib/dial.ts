// Receiver dial: live audio spectrum, time ticks and the needle.
// The same renderer is used in the bottom bar and on the "Now Playing" screen.
import { useSyncExternalStore } from 'react';

import { STANDALONE } from './env.ts';
import { player } from './player.ts';
import type { Track } from './store.ts';

const AMBER = [255, 181, 71];
const NEEDLE = '#ff5e3a';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// How the dial looks, chosen per device in Settings → Appearance.
//   dial:    receiver scale with the live spectrum (default)
//   calm:    the same scale and needle, no moving spectrum
//   minimal: a thin progress line with a knob, no scale
//   color:   the spectrum in a color gradient
//   mirror:  the spectrum mirrored around the middle, like a waveform
export const DIAL_STYLES = ['dial', 'calm', 'minimal', 'color', 'mirror'] as const;
export type DialStyle = (typeof DIAL_STYLES)[number];
// Phones have no spectrum (no Web Audio graph there, see player.ts), so they always use
// Minimal; there is nothing to choose. (dialStylePhone stays in the synced prefs for
// older clients.)
const MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || STANDALONE;
export const PHONE_STYLES: readonly DialStyle[] = ['minimal'];
export const DEVICE_STYLES: readonly DialStyle[] = MOBILE ? PHONE_STYLES : DIAL_STYLES;
export const DIAL_PREF = MOBILE ? 'dialStylePhone' : 'dialStyle';
export const STYLE_KEY = MOBILE ? 'tunes.dialStylePhone' : 'tunes.dialStyle';
const DEFAULT_STYLE: DialStyle = MOBILE ? 'minimal' : 'dial';
let dialStyle: DialStyle = (() => {
  try { const v = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null'); return DEVICE_STYLES.includes(v) ? v : DEFAULT_STYLE; } catch { return DEFAULT_STYLE; }
})();
export const getDialStyle = (): DialStyle => dialStyle;
const styleListeners = new Set<() => void>();

export function setDialStyle(s: DialStyle): void {
  if (!DEVICE_STYLES.includes(s) || s === dialStyle) return;
  dialStyle = s;
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(s)); } catch { /* storage full */ }
  for (const d of dials) d.bars.fill(0);
  for (const l of styleListeners) l();
}

export function useDialStyle(): DialStyle {
  return useSyncExternalStore((cb) => { styleListeners.add(cb); return () => styleListeners.delete(cb); }, () => dialStyle);
}

// The theme's text color, for the minimal style (read again when the theme changes).
let ink = '';
let inkTheme = '';
function themeInk(): string {
  const theme = document.documentElement.dataset.theme || '';
  if (!ink || theme !== inkTheme) {
    inkTheme = theme;
    ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ece6d6';
  }
  return ink;
}

const dials = new Set<Dial>();
let raf = 0;
let freq: Uint8Array<ArrayBuffer> | null = null;

function loop(): void {
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
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  big: boolean;
  bars = new Float32Array(256);
  hoverX: number | null = null;
  font: string;
  ro: ResizeObserver;
  w = 0;
  h = 0;

  constructor(canvas: HTMLCanvasElement, { big = false } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d')!;
    this.big = big;
    this.font = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif';
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(canvas);
    this.resize();
    dials.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  // Stop drawing (used when the dial is rebuilt, e.g. after a language change).
  destroy(): void {
    dials.delete(this);
    this.ro.disconnect();
  }

  resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(freq: Uint8Array | null, sampleRate: number): void {
    const { g, w, h } = this;
    if (!w || !h || this.c.offsetParent === null) return;
    g.clearRect(0, 0, w, h);
    const t = player.track;
    const live = Boolean(t?.live);
    const dur = player.duration;
    const progress = !live && Number.isFinite(dur) && dur > 0 ? Math.min(1, player.time / dur) : 0;

    if (dialStyle === 'minimal') { this.drawMinimal(t, live, progress, dur); return; }

    const labelH = this.big ? 16 : 12;
    const tickH = this.big ? 10 : 7;
    const baseY = h - labelH - tickH - 2;
    const pad = this.big ? 18 : 12;
    const x0 = pad, x1 = w - pad, span = x1 - x0;

    // ---- spectrum
    const gap = this.big ? 3 : 2;
    const bw = this.big ? 5 : 3;
    const n = Math.max(8, Math.min(256, Math.floor(span / (bw + gap))));
    const style = dialStyle;
    const playing = player.playing && !reduced.matches && style !== 'calm';
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
        // Higher frequencies carry less energy, so they get a slight boost to keep the dial looking even.
        const tilt = 1 + (i / n) * 0.35;
        const target = Math.min(1, Math.pow(v / 255, 1.5) * tilt);
        this.bars[i] = target > this.bars[i] ? target : this.bars[i] * 0.9;
      }
    } else {
      for (let i = 0; i < n; i++) this.bars[i] *= 0.9;
    }
    const maxH = baseY - (this.big ? 10 : 6);
    const needleX = live ? x0 + span * stationPos(t) : x0 + span * progress;
    if (style === 'calm') {
      // No spectrum: a glowing line along the scale shows how far the song is.
      const y = baseY - 1;
      g.save();
      g.lineCap = 'round';
      g.lineWidth = this.big ? 3 : 2;
      g.strokeStyle = `rgba(${AMBER},0.25)`;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.shadowColor = `rgba(${AMBER},0.7)`;
      g.shadowBlur = this.big ? 10 : 6;
      g.strokeStyle = `rgba(${AMBER},0.95)`;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(live ? x1 : Math.max(x0, needleX), y); g.stroke();
      g.restore();
    } else {
      const mirror = style === 'mirror';
      const mid = baseY - maxH / 2;
      const lit = new Path2D(), dim = new Path2D();
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (bw + gap);
        const bh = Math.max(1.5, this.bars[i] * maxH);
        if (mirror) (live || x < needleX ? lit : dim).rect(x, mid - bh / 2, bw, bh);
        else (live || x < needleX ? lit : dim).rect(x, baseY - bh, bw, bh);
      }
      let paint: string | CanvasGradient = `rgba(${AMBER},0.95)`;
      if (style === 'color') {
        // Low notes cool, high notes warm.
        const grad = g.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, '#3fa7ff');
        grad.addColorStop(0.35, '#8b5cff');
        grad.addColorStop(0.65, '#ff4fa3');
        grad.addColorStop(1, '#ffb547');
        paint = grad;
      }
      g.save();
      g.shadowColor = style === 'color' ? 'rgba(255,255,255,0.35)' : `rgba(${AMBER},0.75)`;
      g.shadowBlur = this.big ? 14 : 8;
      g.fillStyle = paint;
      g.fill(lit);
      g.shadowBlur = 0;
      if (style === 'color') { g.globalAlpha = 0.3; g.fill(dim); }
      else { g.fillStyle = `rgba(${AMBER},0.32)`; g.fill(dim); }
      g.restore();
    }

    // ---- ticks and labels
    g.strokeStyle = `rgba(${AMBER},0.55)`;
    g.fillStyle = `rgba(${AMBER},0.7)`;
    g.lineWidth = 1;
    g.font = `500 ${this.big ? 11 : 9.5}px ${this.font}`;
    g.textBaseline = 'top';
    const tickY = baseY + 3;
    g.beginPath();
    if (live) {
      // Radio: FM scale 87.5 – 108 MHz, like on a real receiver.
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

    // ---- position under the mouse
    if (this.hoverX !== null && !live && dur > 0) {
      g.strokeStyle = 'rgba(236,230,214,0.45)';
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(Math.round(this.hoverX) + 0.5, 4);
      g.lineTo(Math.round(this.hoverX) + 0.5, baseY + tickH + 3);
      g.stroke();
      g.setLineDash([]);
    }

    // ---- needle
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

  // A thin progress line with a knob: nothing moves except the knob itself.
  drawMinimal(t: Track | null, live: boolean, progress: number, dur: number): void {
    const { g, w, h } = this;
    const pad = this.big ? 18 : 12;
    const x0 = pad, x1 = w - pad;
    const y = Math.round(h / 2) + 0.5;
    const text = themeInk();
    const knobX = x0 + (x1 - x0) * progress;
    g.save();
    g.lineCap = 'round';
    g.lineWidth = this.big ? 5 : 4;
    g.globalAlpha = 0.2;
    g.strokeStyle = text;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = `rgb(${AMBER})`;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(live ? x1 : Math.max(x0, knobX), y); g.stroke();
    if (this.hoverX !== null && !live && dur > 0) {
      g.globalAlpha = 0.35;
      g.fillStyle = text;
      g.beginPath(); g.arc(Math.max(x0, Math.min(x1, this.hoverX)), y, this.big ? 4 : 3, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    if (t && !live) {
      g.fillStyle = text;
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 4;
      g.beginPath(); g.arc(knobX, y, this.big ? 8 : 6, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // Converts the mouse position to a time in the track.
  timeAt(clientX: number): number {
    const r = this.c.getBoundingClientRect();
    const pad = this.big ? 18 : 12;
    const p = (clientX - r.left - pad) / (r.width - pad * 2);
    return Math.max(0, Math.min(1, p)) * player.duration;
  }

  xAt(clientX: number): number {
    return clientX - this.c.getBoundingClientRect().left;
  }
}

function pickStep(dur: number, span: number): number {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const maxLabels = Math.max(2, Math.floor(span / 48));
  return steps.find((s) => dur / s <= maxLabels) || 3600;
}

function label(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:00`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Each station gets its own "frequency" on the dial.
function stationPos(t: Track | null | undefined): number {
  let x = 0;
  for (const ch of t?.id || '') x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.06 + (x % 1000) / 1000 * 0.88;
}

export function stationFreq(t: Track | null | undefined): string {
  return (87.5 + stationPos(t) * 20.5).toFixed(1);
}
