// Music plays on one device (and one tab) at a time, and can continue on another device.
// The playing device reports what plays and where; the server tells the others over SSE.
import { useSyncExternalStore } from 'react';

import { player } from './player.ts';
import { api, store } from './store.ts';
import type { Context, Track } from './store.ts';
import { tr } from './i18n.ts';
import { toast } from './feedback.ts';
import { fmtTime } from './format.ts';

export interface RemoteSession {
  deviceId: string;
  device: string;
  track: Track;
  time: number;
  playing: boolean;
  index: number;
  queue?: Track[];
  context: Context | null;
  at: number;
}

// One id per tab (sessionStorage is per tab and survives a reload), so two Tunes tabs on the
// same computer count as two players: starting music in one pauses the other.
export const DEVICE_ID = (() => {
  let id: string | null = null;
  try { id = sessionStorage.getItem('tunes.player'); } catch { /* */ }
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('tunes.player', id); } catch { /* */ }
  }
  return id;
})();
// Send the device type; the device that displays it translates the name.
const DEVICE_KIND = player.mobile ? 'mobile' : 'computer';
export const deviceName = (kind: string): string => (kind === 'mobile' ? tr('Phone') : tr('Computer'));

let activeHere = false;   // whether something was played on this device this session
let lastReport = 0;
let ownsPlayback = false; // this device has told the others that playback is here

// ---- what plays on another device (rendered by the Handoff banner)
let remote: RemoteSession | null = null;
const listeners = new Set<() => void>();
function setRemote(r: RemoteSession | null): void {
  remote = r;
  for (const l of listeners) l();
}
export function useRemote(): RemoteSession | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => remote);
}

export function remoteTime(r: RemoteSession | null = remote): number {
  if (!r || r.track.live) return 0;
  const t = r.time + (r.playing ? (Date.now() - r.at) / 1000 : 0);
  return r.track.duration ? Math.min(t, r.track.duration - 1) : t;
}

function reportSession(force = false): void {
  const t = player.track;
  if (!t || !activeHere) return;
  // Playback just started here: take it over first, or the server would tell us to yield.
  if (player.playing && !ownsPlayback) { claimPlayback().then(() => reportSession(true)); return; }
  const now = Date.now();
  if (!force && now - lastReport < 5000) return;
  lastReport = now;
  const start = Math.max(0, player.index - 20);
  api<{ yield?: string }>('/api/session', { method: 'POST', body: {
    deviceId: DEVICE_ID, device: DEVICE_KIND, track: t, time: t.live ? 0 : player.time,
    playing: player.playing, index: player.index - start, queue: player.queue.slice(start, start + 500), context: player.context,
  } }).then((r) => { if (r?.yield) yieldTo(r.yield); }).catch(() => {});
}

// Another device started playing: stop here, so music never plays on two devices at once.
function yieldTo(device: string): void {
  ownsPlayback = false;
  if (!player.playing) return;
  player.pause();
  toast(tr('Music continues on: {d}', { d: deviceName(device) }));
}

// Tell the server (and through it every other device) that playback moved here.
function claimPlayback(): Promise<unknown> {
  ownsPlayback = true;
  return api('/api/session/takeover', { method: 'POST', body: { deviceId: DEVICE_ID, device: DEVICE_KIND } }).catch(() => {});
}

// "Continue here": the same queue, song and second as the other device.
export async function takeOver(): Promise<void> {
  try {
    const { session } = await api<{ session: RemoteSession | null }>('/api/session');
    if (!session) return;
    setRemote(session);
    const time = remoteTime(session);
    player.resumeAt(session.queue || [session.track], session.index, time, session.context);
    activeHere = true;
    claimPlayback(); // also sent when playback starts; here in case autoplay is blocked
    toast(session.track.live ? tr('Continued here') : tr('Continued here from {t}', { t: fmtTime(time) }));
  } catch (e) { toast((e as Error).message, { error: true }); }
}

// Server events: library changes, live radio titles, the app icon and other devices.
export function connectEvents(onLibrary: (count: number, changed: number) => void): void {
  const es = new EventSource('/api/events');
  es.addEventListener('library', async (e) => {
    await store.reloadLibrary();
    const d = JSON.parse((e as MessageEvent).data);
    if (d.changed) onLibrary(d.count, d.changed);
  });
  es.addEventListener('icy', (e) => { const d = JSON.parse((e as MessageEvent).data); player.setIcy(d.sid, d.title); });
  es.addEventListener('icon', (e) => store.setIcon(JSON.parse((e as MessageEvent).data).icon));
  es.addEventListener('session', (e) => setRemote(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('takeover', (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    if (d.deviceId !== DEVICE_ID) yieldTo(d.device);
  });
}

export function startSession(): void {
  player.addEventListener('state', () => {
    if (!player.playing) ownsPlayback = false; // the next play claims again
    if (player.playing && !activeHere) activeHere = true;
    reportSession(true); // claims first if playback just started
  });
  player.addEventListener('track', () => reportSession(true));
  player.addEventListener('time', () => reportSession(false));
  api<{ session: RemoteSession | null }>('/api/session').then(({ session }) => setRemote(session)).catch(() => {});
}
