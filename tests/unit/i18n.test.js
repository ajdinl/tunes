// Every UI string must be in every dictionary, with the same {placeholders}.
// Strings are found in the code as tr('…') and plural(n, 'one', 'many'); the server's error
// messages (translated on the client) as `error: '…'` and httpError('…').
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { BS } from '../../web/src/i18n/bs.ts';
import { SR } from '../../web/src/i18n/sr.ts';
import { HR } from '../../web/src/i18n/hr.ts';
import { DE } from '../../web/src/i18n/de.ts';
import { TR } from '../../web/src/i18n/tr.ts';
import { SL } from '../../web/src/i18n/sl.ts';
import { MK } from '../../web/src/i18n/mk.ts';
import { SQ } from '../../web/src/i18n/sq.ts';
import { ES } from '../../web/src/i18n/es.ts';
import { FR } from '../../web/src/i18n/fr.ts';
import { PT } from '../../web/src/i18n/pt.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DICTS = { bs: BS, sr: SR, hr: HR, sl: SL, mk: MK, sq: SQ, de: DE, es: ES, fr: FR, pt: PT, tr: TR };

const files = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}i18n${path.sep}`));
const literal = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const unescape = (s) => s.replace(/\\(.)/g, '$1');
// A literal that is the whole argument (not the start of 'text ' + value).
const whole = String.raw`(?=\s*[,)}])`;

function collect(sources, patterns) {
  const out = new Set();
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of text.matchAll(re)) out.add(unescape(m[1] ?? m[2]));
  }
  return out;
}

const ui = collect(files(path.join(ROOT, 'web', 'src')), [new RegExp(String.raw`\btr\(\s*(?:${literal})`, 'g')]);
const plurals = collect(files(path.join(ROOT, 'web', 'src')), [new RegExp(String.raw`\bplural\([^,]+,\s*(?:${literal})`, 'g')]);
const server = collect([path.join(ROOT, 'server.ts'), ...files(path.join(ROOT, 'lib'))],
  [new RegExp(String.raw`\berror:\s*(?:${literal})${whole}`, 'g'), new RegExp(String.raw`\bhttpError\(\s*(?:${literal})${whole}`, 'g')]);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('finds the strings in the code', () => {
    expect(ui.size).toBeGreaterThan(300);
    expect(plurals.has('song')).toBe(true);
    expect(server.has('Song is missing')).toBe(true);
  });

  for (const [code, dict] of Object.entries(DICTS)) {
    it(`${code} has every UI and server string, with the same placeholders`, () => {
      const missing = [...ui, ...server].filter((s) => typeof dict[s] !== 'string');
      expect(missing).toEqual([]);
      const wrong = [...ui, ...server].filter((s) => placeholders(dict[s]).join() !== placeholders(s).join());
      expect(wrong).toEqual([]);
    });

    it(`${code} has plural forms for every plural() noun`, () => {
      const missing = [...plurals].filter((one) => !dict['plural:' + one]?.other);
      expect(missing).toEqual([]);
    });
  }
});
