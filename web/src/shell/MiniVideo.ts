// Mini player for Safari (also as a Dock app), which has no Document Picture-in-Picture.
// Every browser that can float a video above other apps gets this instead: the cover, the song
// and the progress are drawn on a canvas, the canvas becomes a silent video, and that video
// goes into picture-in-picture. Its play/pause button controls the player; next/previous,
// where the browser shows them, come from the Media Session handlers the player already sets.
import { player } from '../lib/player.ts';
import type { PlayerEvent } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime } from '../lib/format.ts';
import { toast } from '../lib/feedback.ts';
import { shownTrack } from './Deck.tsx';
import { media } from '../lib/media.ts';
import { STANDALONE } from '../lib/env.ts';

const W = 640;
const H = 240;
const PAD = 24;
const BAR = 10;

export const videoPipSupported = (): boolean =>
  !player.mobile && document.pictureInPictureEnabled === true &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
  typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';

let video: HTMLVideoElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let open = false;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

export const videoMiniOpen = (): boolean => open;
export function onVideoMiniChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ---------------------------------------------------------------- play/pause both ways
// The video follows the player, and the window's own play/pause button drives the player.
// `want` is the state set from here, so the events of those calls aren't taken for a click.
let want = false;
function setVideo(playing: boolean): void {
  const v = video;
  if (!v) return;
  want = playing;
  if (playing && v.paused) v.play().catch(() => { /* not allowed right now */ });
  if (!playing && !v.paused) v.pause();
}
function follow(): void {
  if (open) setVideo(player.playing);
}
function fromWindow(playing: boolean): void {
  if (!open || playing === want) return;
  if (playing) { if (!player.playing) player.play(); return; }
  // Safari pauses the video when its window is closed, just before it says the window is
  // gone: wait a moment, and leave the music playing if that pause came with the closing.
  setTimeout(() => {
    if (open && document.pictureInPictureElement === video && video?.paused && player.playing) player.pause();
  }, 400);
}
// A paused video keeps showing its last frame, so a change while paused (another song,
// a seek) plays it for a moment to get the new picture into the window.
let refreshTimer = 0;
let shownAt = 0; // the song position in the window's last live frame
function refresh(): void {
  const v = video;
  if (!v || !open || player.playing) return;
  clearTimeout(refreshTimer);
  setVideo(true);
  refreshTimer = window.setTimeout(() => follow(), 150);
}

// ---------------------------------------------------------------- the picture
// Covers from other sites go through our image proxy: same origin, so the canvas stays readable.
let coverUrl = '';
let coverImg: HTMLImageElement | null = null;
function cover(src: string | null | undefined): HTMLImageElement | null {
  if (!src) return null;
  let url: string;
  try {
    const abs = new URL(media(src), location.href);
    // (The phone-only version has no proxy: there a cover from elsewhere may simply not load.)
    url = abs.origin === location.origin || !/^https?:$/.test(abs.protocol) || STANDALONE ? abs.href : '/api/img?u=' + encodeURIComponent(abs.href);
  } catch { return null; }
  if (url !== coverUrl) {
    coverUrl = url;
    coverImg = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (coverUrl === url) { coverImg = img; draw(); } };
    img.src = url;
  }
  return coverImg;
}

function fit(c: CanvasRenderingContext2D, s: string, max: number): string {
  if (c.measureText(s).width <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.measureText(s.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + '…';
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

export function draw(): void {
  const c = ctx;
  if (!c || !video) return;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const text = v('--text', '#ece6d6');
  const muted = v('--muted', '#9a9a9a');
  const font = v('--font', 'system-ui, sans-serif');
  c.fillStyle = v('--bg-2', '#0e0e10');
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';

  const t = shownTrack(player);
  if (!t) {
    c.fillStyle = muted;
    c.font = `500 28px ${font}`;
    c.textAlign = 'center';
    c.fillText(tr('Nothing playing'), W / 2, H / 2 + 10);
    c.textAlign = 'left';
    video.dataset.song = '';
    return;
  }
  const title = t.live && player.icyTitle ? player.icyTitle : t.title;
  const artist = t.live ? t.title : t.artist || '';
  // What the picture shows, also for the tests (the video itself is hidden).
  video.dataset.song = artist ? `${title} – ${artist}` : title;

  // Cover, square, cropped to fill.
  const size = H - PAD * 2 - BAR;
  const img = cover(t.cover);
  c.save();
  rounded(c, PAD, PAD, size, size, 12);
  c.clip();
  if (img && img.naturalWidth) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, PAD, PAD, size, size);
  } else {
    c.fillStyle = 'rgba(127, 127, 127, 0.22)';
    c.fillRect(PAD, PAD, size, size);
    c.fillStyle = muted;
    c.font = `650 72px ${font}`;
    c.textAlign = 'center';
    c.fillText((title || '♪').trim().charAt(0).toUpperCase(), PAD + size / 2, PAD + size / 2 + 26);
    c.textAlign = 'left';
  }
  c.restore();

  // Song, artist and time.
  const x = PAD * 2 + size;
  const max = W - x - PAD;
  c.fillStyle = text;
  c.font = `650 34px ${font}`;
  c.fillText(fit(c, title, max), x, PAD + 44);
  c.fillStyle = muted;
  c.font = `400 26px ${font}`;
  c.fillText(fit(c, artist, max), x, PAD + 86);
  const dur = player.duration;
  if (!video.paused) shownAt = player.time;
  c.font = `500 22px ${font}`;
  c.fillText(t.live ? tr('live') : `${fmtTime(player.time)} / ${fmtTime(dur)}`, x, PAD + size - 6);

  // Progress along the bottom edge.
  const progress = t.live ? 1 : Number.isFinite(dur) && dur > 0 ? Math.min(1, player.time / dur) : 0;
  c.fillStyle = 'rgba(127, 127, 127, 0.22)';
  c.fillRect(0, H - BAR, W, BAR);
  c.fillStyle = v('--amber', '#ffb547');
  c.fillRect(0, H - BAR, W * progress, BAR);
}

// ---------------------------------------------------------------- setup
// Made ahead (when the player bar appears), because the browser lets the video go into
// picture-in-picture only right inside the click, with its first frame already there.
export function prepareVideoMini(): void {
  if (video || !videoPipSupported()) return;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d');
  const v = document.createElement('video');
  v.className = 'mini-video';
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  video = v;
  v.srcObject = canvas.captureStream();
  draw();
  document.body.append(v);
  // A first frame needs a moment of playing; then it waits paused.
  want = true;
  v.play().then(() => { if (!open) setVideo(false); }).catch(() => { /* */ });

  v.addEventListener('play', () => fromWindow(true));
  v.addEventListener('pause', () => fromWindow(false));
  v.addEventListener('enterpictureinpicture', () => { open = true; draw(); follow(); refresh(); changed(); });
  v.addEventListener('leavepictureinpicture', () => { open = false; setVideo(false); changed(); });

  for (const e of ['track', 'icy', 'sound'] as PlayerEvent[]) player.addEventListener(e, () => { if (open) { draw(); refresh(); } });
  // Pausing also reports the time; only a real jump (a seek while paused) needs a new frame.
  player.addEventListener('time', () => { if (open) { draw(); if (Math.abs(player.time - shownAt) >= 1) refresh(); } });
  player.addEventListener('state', () => { if (open) { draw(); follow(); } });
  document.fonts?.ready.then(() => draw()).catch(() => { /* */ });
}

export function openVideoMini(): void {
  prepareVideoMini();
  const v = video;
  if (!v) return;
  draw();
  // Called straight from the click: no await before this.
  v.requestPictureInPicture().catch(() => toast(tr('The mini player couldn\'t open.'), { error: true }));
}

export function closeVideoMini(): void {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => { /* already closed */ });
}
