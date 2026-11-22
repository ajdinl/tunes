// Installing Tunes as an app (home screen on phones, Dock / taskbar on computers).
// Works out what this browser can do, so the app shows one button or one short set of
// steps instead of instructions for every platform.
import { useSyncExternalStore } from 'react';

// Chrome, Edge, Brave, Opera and Android Chrome fire this when Tunes can be installed with one click.
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export type InstallMethod =
  | 'prompt'       // the browser's own install dialog, one click
  | 'ios'          // Share → Add to Home Screen
  | 'android'      // ⋮ menu → Add to Home screen / Install app
  | 'mac-safari'   // File → Add to Dock
  | 'desktop'      // install icon in the address bar, or the browser menu
  | null;          // already installed, or the browser can't install apps (Firefox on a computer)

const ua = navigator.userAgent;
export const IS_IOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(ua);
const IS_MAC_SAFARI = /Macintosh/.test(ua) && /Version\/[\d.]+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
const IS_CHROMIUM = /Chrome|Chromium|Edg|OPR/.test(ua) && !/Firefox/.test(ua);

let prompt: InstallPromptEvent | null = null;
let installed = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

// Registered as soon as this module loads (the event can fire before the app renders).
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e as InstallPromptEvent; changed(); });
window.addEventListener('appinstalled', () => { prompt = null; installed = true; changed(); });

export function installMethod(): InstallMethod {
  if (installed) return null;
  if (prompt) return 'prompt';
  if (IS_IOS) return 'ios';
  if (IS_ANDROID) return 'android';
  if (IS_MAC_SAFARI) return 'mac-safari';
  if (IS_CHROMIUM) return 'desktop';
  return null;
}

export function useInstallMethod(): InstallMethod {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, installMethod);
}

// Opens the browser's install dialog. Resolves true when the user installed Tunes.
export async function promptInstall(): Promise<boolean> {
  const p = prompt;
  if (!p) return false;
  prompt = null; // a prompt can be used once
  changed();
  await p.prompt();
  const { outcome } = await p.userChoice;
  return outcome === 'accepted';
}

export const IS_PHONE = IS_IOS || IS_ANDROID;
