/// <reference types="vite/client" />
// Which version of Tunes this is.
// - The usual one is served by the Tunes server on your computer (`npm start`).
// - The phone-only version (`vite build --mode standalone`, published on GitHub Pages) has no
//   server: it keeps your data in the browser and asks the music sources directly
//   (web/src/standalone). It lives under a sub-path (/tunes/), so app paths get BASE in front.
export const STANDALONE = import.meta.env.MODE === 'standalone';
export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

// A file that ships with the app (icons, fonts), at the right place in either version.
export const asset = (path: string): string => BASE + path.replace(/^\//, '');
