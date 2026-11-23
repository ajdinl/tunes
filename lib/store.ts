// The server's copy of the user data: lib/data.ts kept in a single JSON file. Writes are
// atomic (tmp + rename) and debounced so the disk is not written on every click.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DataStore, defaults } from './data.ts';
import type { Data } from './types.ts';

export { cleanTrack, ICONS, DEFAULT_ICON } from './data.ts';
export type { PlaylistPatch, SettingsPatch } from './data.ts';

// Shows folders inside the home folder as ~/…, so the user name isn't on screen (or in
// screenshots). Folders typed with ~ are expanded again when saved.
export function tildify(f: string): string {
  const home = os.homedir();
  return f === home ? '~' : f.startsWith(home + path.sep) ? '~' + f.slice(home.length) : f;
}

export class Store extends DataStore {
  file: string;
  timer: NodeJS.Timeout | undefined;

  constructor(file: string) {
    let raw: Partial<Data> | null = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Data>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Cannot read', file, '-', (e as Error).message);
    }
    super(raw, defaults([path.join(os.homedir(), 'Music', 'Tunes')]));
    this.file = file;
    this.timer = undefined;
  }

  override save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  protected override showFolder(f: string): string { return tildify(f); }
  protected override storeFolder(f: string): string { return f.startsWith('~') ? path.join(os.homedir(), f.slice(1)) : f; }
}
