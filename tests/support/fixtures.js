// Test fixtures: a small music library made of generated WAV files, so the tests need no
// real music and no internet. WAV files carry RIFF INFO tags, which music-metadata reads.
import fs from 'node:fs';
import path from 'node:path';

// 8 kHz, mono, 8-bit: about 8 KB per second, so a three-minute song is about 1.4 MB.
const RATE = 8000;

function infoChunk(tags) {
  const ids = { title: 'INAM', artist: 'IART', album: 'IPRD', track: 'ITRK', year: 'ICRD', genre: 'IGNR' };
  const parts = [];
  for (const [k, id] of Object.entries(ids)) {
    if (tags[k] === undefined || tags[k] === null) continue;
    let value = Buffer.from(String(tags[k]) + '\0', 'utf8');
    if (value.length % 2) value = Buffer.concat([value, Buffer.alloc(1)]);
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(value.length, 4);
    parts.push(head, value);
  }
  if (!parts.length) return Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from('INFO'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('LIST', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// A WAV file of `seconds` length: a quiet tone, so it is real audio and not just silence.
export function makeWav(seconds, tags = {}) {
  const samples = Math.round(seconds * RATE);
  const data = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) data[i] = 128 + Math.round(6 * Math.sin((2 * Math.PI * 220 * i) / RATE));
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);        // PCM
  fmt.writeUInt16LE(1, 10);       // mono
  fmt.writeUInt32LE(RATE, 12);
  fmt.writeUInt32LE(RATE, 16);    // byte rate
  fmt.writeUInt16LE(1, 20);       // block align
  fmt.writeUInt16LE(8, 22);       // bits per sample
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0, 'ascii');
  dataHead.writeUInt32LE(data.length, 4);
  const info = infoChunk(tags);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + fmt.length + info.length + dataHead.length + data.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, fmt, info, dataHead, data]);
}

// The demo library used by the API and end-to-end tests.
export const LIBRARY = [
  { file: 'Nadia Vale/Blue Hours/01 Morning Light.wav', seconds: 200, tags: { title: 'Morning Light', artist: 'Nadia Vale', album: 'Blue Hours', track: 1, year: 2021, genre: 'Jazz' } },
  { file: 'Nadia Vale/Blue Hours/02 Slow River.wav', seconds: 190, tags: { title: 'Slow River', artist: 'Nadia Vale', album: 'Blue Hours', track: 2, year: 2021, genre: 'Jazz' } },
  { file: 'Nadia Vale/Blue Hours/03 Paper Boats.wav', seconds: 180, tags: { title: 'Paper Boats', artist: 'Nadia Vale', album: 'Blue Hours', track: 3, year: 2021, genre: 'Jazz' } },
  { file: 'The Fen Lights/Static/01 Northbound.wav', seconds: 170, tags: { title: 'Northbound', artist: 'The Fen Lights', album: 'Static', track: 1, year: 2019, genre: 'Rock' } },
  { file: 'The Fen Lights/Static/02 Low Tide.wav', seconds: 160, tags: { title: 'Low Tide', artist: 'The Fen Lights', album: 'Static', track: 2, year: 2019, genre: 'Rock' } },
  // No tags at all: artist and album come from the folders, the title from the file name.
  { file: 'Untagged Artist/Loose Tapes/04 Night Bus.wav', seconds: 150, tags: {} },
];

// A synced .lrc file next to one song.
export const SIDECAR = {
  file: 'Nadia Vale/Blue Hours/01 Morning Light.lrc',
  text: '[00:01.00]First line of the morning\n[00:05.50]Second line of the morning\n',
};

export function makeLibrary(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const t of LIBRARY) {
    const p = path.join(dir, t.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, makeWav(t.seconds, t.tags));
  }
  fs.writeFileSync(path.join(dir, SIDECAR.file), SIDECAR.text);
  return dir;
}

// A fresh data folder whose db.json points at the given music folder.
export function makeDataDir(dataDir, musicDir, settings = {}) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ version: 1, settings: { folders: [musicDir], ...settings } }));
  return dataDir;
}
