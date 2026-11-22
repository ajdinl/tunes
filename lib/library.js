// Local library: scans folders, reads tags (music-metadata), caches the
// result in data/library.json (the next scan only reads changed files) and
// watches the folders so new tracks show up right away.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import { parseFile, selectCover } from 'music-metadata';

// A line of synced lyrics: [mm:ss.xx]
const LRC_LINE = /^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/m;

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.webm']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'artwork'];
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

export const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.webm': 'audio/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

export class Library extends EventEmitter {
  constructor({ dataDir, getFolders }) {
    super();
    this.cacheFile = path.join(dataDir, 'library.json');
    this.coverDir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.coverDir, { recursive: true });
    this.getFolders = getFolders;
    this.entries = new Map(); // hash -> entry
    this.byPath = new Map();  // path -> hash
    this.scanning = null;
    this.watchers = [];
    this.lastScan = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      // Version 2: English fallback names. Older caches are rebuilt.
      if (raw.version === 2) for (const e of raw.entries || []) { this.entries.set(e.hash, e); this.byPath.set(e.path, e.hash); }
    } catch { /* first run */ }
  }

  tracks() {
    return [...this.entries.values()].map(toTrack);
  }

  get(h) { return this.entries.get(h); }

  async scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this._scan().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  async _scan() {
    const started = Date.now();
    const folders = this.getFolders().filter((f) => fs.existsSync(f));
    const files = [];
    for (const f of folders) await walk(f, files);
    const seen = new Set();
    let changed = 0;
    const todo = [];
    for (const { file, stat, root } of files) {
      const h = hash(file);
      seen.add(h);
      const prev = this.entries.get(h);
      if (prev && prev.mtime === stat.mtimeMs && prev.size === stat.size) continue;
      todo.push({ file, stat, h, root });
    }
    // Read tags in parallel, but limited so the disk is not overwhelmed.
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const { file, stat, h, root } = todo[i++];
        const entry = await readTags(file, stat, h, root);
        this.entries.set(h, entry);
        this.byPath.set(file, h);
        changed++;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const [h, e] of this.entries) {
      if (!seen.has(h)) { this.entries.delete(h); this.byPath.delete(e.path); changed++; }
    }
    this.lastScan = Date.now();
    if (changed) {
      await fsp.writeFile(this.cacheFile, JSON.stringify({ version: 2, entries: [...this.entries.values()] }));
      this.emit('changed', { count: this.entries.size, changed });
    }
    console.log(`Library: ${this.entries.size} files, ${changed} changed (${Date.now() - started} ms)`);
    return { count: this.entries.size, changed };
  }

  watch() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    let t;
    const onChange = () => { clearTimeout(t); t = setTimeout(() => this.scan().catch(console.error), 1500); };
    for (const f of this.getFolders()) {
      if (!fs.existsSync(f)) continue;
      try { this.watchers.push(fs.watch(f, { recursive: true }, onChange)); }
      catch (e) { console.warn('Cannot watch', f, e.message); }
    }
  }

  // Lyrics that come with the file itself, so they are certainly the right ones:
  // a .lrc file next to the song, or lyrics embedded in its tags.
  async lyrics(h) {
    const entry = this.entries.get(h);
    if (!entry) return null;
    const base = entry.path.slice(0, entry.path.length - path.extname(entry.path).length);
    for (const ext of ['.lrc', '.LRC']) {
      try {
        const text = await fsp.readFile(base + ext, 'utf8');
        if (text.trim()) return LRC_LINE.test(text) ? { synced: text, plain: null } : { synced: null, plain: text.trim() };
      } catch { /* no sidecar file */ }
    }
    let meta;
    try { meta = await parseFile(entry.path, { skipCovers: true, duration: false }); } catch { return null; }
    for (const l of meta.common.lyrics || []) {
      if (typeof l === 'string') { if (l.trim()) return LRC_LINE.test(l) ? { synced: l, plain: null } : { synced: null, plain: l.trim() }; continue; }
      if (Array.isArray(l?.syncText) && l.syncText.length && l.syncText.some((x) => Number.isFinite(x.timestamp))) {
        const lrc = l.syncText.map((x) => {
          const ms = Number(x.timestamp) || 0;
          const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
          const ss = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
          return `[${mm}:${ss}]${x.text || ''}`;
        }).join('\n');
        return { synced: lrc, plain: null };
      }
      const text = l?.text || (Array.isArray(l?.syncText) ? l.syncText.map((x) => x.text).join('\n') : '');
      if (text && text.trim()) return LRC_LINE.test(text) ? { synced: text, plain: null } : { synced: null, plain: text.trim() };
    }
    return null;
  }

  // Cover: cached on disk -> image in the album folder -> image embedded in the file.
  async cover(h) {
    const entry = this.entries.get(h);
    if (!entry) return null;
    const key = entry.coverKey || h;
    for (const ext of IMG_EXT) {
      const p = path.join(this.coverDir, key + ext);
      if (fs.existsSync(p)) return { file: p, type: MIME[ext] };
    }
    if (fs.existsSync(path.join(this.coverDir, key + '.none'))) return null;

    const dir = path.dirname(entry.path);
    try {
      const names = await fsp.readdir(dir);
      const imgs = names.filter((n) => IMG_EXT.includes(path.extname(n).toLowerCase()));
      const pick = imgs.find((n) => COVER_NAMES.includes(path.parse(n).name.toLowerCase()))
        || imgs.find((n) => path.parse(n).name === path.parse(entry.path).name)
        || (imgs.length === 1 ? imgs[0] : null);
      if (pick) {
        const ext = path.extname(pick).toLowerCase();
        const dest = path.join(this.coverDir, key + ext);
        await fsp.copyFile(path.join(dir, pick), dest);
        return { file: dest, type: MIME[ext] };
      }
    } catch { /* no access to the folder */ }

    try {
      const meta = await parseFile(entry.path, { skipPostHeaders: true });
      const pic = selectCover(meta.common.picture);
      if (pic) {
        const ext = pic.format.includes('png') ? '.png' : '.jpg';
        const dest = path.join(this.coverDir, key + ext);
        await fsp.writeFile(dest, pic.data);
        return { file: dest, type: MIME[ext] };
      }
    } catch { /* corrupt file */ }
    await fsp.writeFile(path.join(this.coverDir, key + '.none'), '');
    return null;
  }
}

async function walk(dir, out, root = dir) {
  let items;
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    if (it.name.startsWith('.')) continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) await walk(p, out, root);
    else if (it.isFile() && AUDIO_EXT.has(path.extname(it.name).toLowerCase())) {
      try { out.push({ file: p, stat: await fsp.stat(p), root }); } catch { /* deleted in the meantime */ }
    }
  }
}

async function readTags(file, stat, h, root) {
  const base = {
    hash: h, path: file, mtime: stat.mtimeMs, size: stat.size,
    added: Math.min(stat.birthtimeMs || stat.mtimeMs, stat.mtimeMs),
    ext: path.extname(file).toLowerCase(),
  };
  // Without tags, fall back to the folder structure: Artist/Album/track.mp3
  const parts = path.relative(root, file).split(path.sep).slice(0, -1);
  const folderArtist = parts.length >= 2 ? parts[parts.length - 2] : null;
  const folder = parts.length ? parts[parts.length - 1] : null;
  let c = {};
  let duration = 0;
  try {
    const meta = await parseFile(file, { skipCovers: true, duration: false });
    c = meta.common;
    duration = meta.format.duration || 0;
  } catch { /* file without tags: use the file name */ }
  const artist = c.artist || c.albumartist || folderArtist || 'Unknown artist';
  const album = c.album || folder || 'Unknown album';
  const albumArtist = c.albumartist || artist;
  return {
    ...base,
    title: c.title || path.parse(file).name.replace(/^\d+[\s.\-_]+/, ''),
    artist, album, albumArtist,
    year: c.year || null,
    genre: (c.genre && c.genre[0]) ? c.genre[0].split(/[,;/]| with /)[0].trim().slice(0, 40) : null,
    trackNo: c.track?.no || null,
    discNo: c.disk?.no || null,
    duration: Math.round(duration),
    coverKey: hash(albumArtist.toLowerCase() + '\u0000' + album.toLowerCase() + '\u0000' + path.dirname(file)),
  };
}

function toTrack(e) {
  return {
    id: 'local:' + e.hash,
    source: 'local',
    title: e.title,
    artist: e.artist,
    album: e.album,
    albumArtist: e.albumArtist,
    year: e.year,
    genre: e.genre,
    trackNo: e.trackNo,
    discNo: e.discNo,
    duration: e.duration,
    cover: '/api/local/cover/' + e.hash,
    stream: '/api/stream/local/' + e.hash,
    addedAt: e.added,
    ext: e.ext,
  };
}
