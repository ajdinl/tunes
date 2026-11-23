// Small color helpers for the accent color: contrast against the theme, readable text on top,
// and the most vivid color of a cover image.
export type RGB = [number, number, number];

export const hexRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbHex = (c: RGB): string => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

// WCAG relative luminance and contrast ratio.
function luminance(c: RGB): number {
  const [r, g, b] = c.map((x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

// Lightens (dark themes) or darkens (light theme) a color until it stands out from the
// background enough to be used for text and thin lines.
export function fitTo(c: RGB, bg: RGB, light: boolean): RGB {
  const target = light ? 3.2 : 4.5;
  let out = c;
  for (let i = 0; i < 20 && contrast(out, bg) < target; i++) out = mix(out, light ? BLACK : WHITE, 0.08);
  return out;
}

// Text on an accent-colored button: a very dark shade of the color, or white, whichever reads better.
export function inkFor(c: RGB): RGB {
  const dark = mix(c, BLACK, 0.84);
  return contrast(dark, c) >= contrast(WHITE, c) ? dark : WHITE;
}

// The hover shade of an accent-colored button.
export const hoverFor = (c: RGB): RGB => mix(c, WHITE, 0.16);

// ------------------------------------------------------------ cover colors
const covers = new Map<string, Promise<RGB | null>>();

// The most vivid color of an image, or null for a grey cover (or one the browser may not read).
export function coverColor(url: string): Promise<RGB | null> {
  if (!url) return Promise.resolve(null);
  let p = covers.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { try { resolve(vivid(img)); } catch { resolve(null); } };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    covers.set(url, p);
    if (covers.size > 200) covers.delete(covers.keys().next().value!);
  }
  return p;
}

// Groups the pixels by hue, weighted by how saturated and how mid-bright they are, and
// returns the average color of the strongest group.
function vivid(img: HTMLImageElement): RGB | null {
  const n = 32;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const groups = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gr = px[i + 1], b = px[i + 2];
    const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
    const l = (max + min) / 510;
    const d = (max - min) / 255;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const w = s * s * Math.max(0, 1 - Math.abs(l - 0.55) * 1.8) * (px[i + 3] / 255);
    total += 1;
    if (w < 0.02) continue;
    let h = 0;
    if (max === r) h = ((gr - b) / (max - min) + 6) % 6;
    else if (max === gr) h = (b - r) / (max - min) + 2;
    else h = (r - gr) / (max - min) + 4;
    const grp = groups[Math.floor(h * 2) % 12];
    grp.w += w; grp.r += r * w; grp.g += gr * w; grp.b += b * w;
  }
  const best = groups.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < total * 0.015) return null; // practically grey
  return [best.r / best.w, best.g / best.w, best.b / best.w];
}
