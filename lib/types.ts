// Shapes shared by the server modules and sent to the browser as JSON.

export type Source = 'local' | 'audius' | 'archive' | 'radio' | 'jamendo' | 'soundcloud';

// One playable item. Local files, online songs and radio stations all use this shape.
export interface Track {
  id: string;
  source?: Source | string;
  title: string;
  artist?: string;
  album?: string | null;
  albumArtist?: string;
  duration?: number;
  cover?: string | null;
  stream?: string;
  year?: number | string | null;
  genre?: string | null;
  trackNo?: number | null;
  discNo?: number | null;
  link?: string | null;
  live?: boolean;
  download?: string | null;
  ext?: string;
  addedAt?: number;
  artistRef?: string | null;
  kind?: 'track' | 'set' | 'artist';
}

export interface EqSettings {
  enabled: boolean;
  preset: string;
  gains: number[];
}

export interface Settings {
  folders: string[];
  listenbrainzToken: string;
  jamendoClientId: string;
  eq: EqSettings;
  volume: number;
  phone: { enabled: boolean; token: string };
  icon: string;
}

export interface Playlist {
  id: string;
  name: string;
  created: number;
  updated: number;
  tracks: Track[];
}

export interface HistoryEntry {
  track: Track;
  at: number;
}

export interface Data {
  version: number;
  settings: Settings;
  favorites: Record<string, { track: Track; at: number }>;
  playlists: Playlist[];
  history: HistoryEntry[];
  playCounts: Record<string, number>;
  lastPlayed: Record<string, number>;
  radioStations: Record<string, Track>;
}

// An Error with an HTTP status, so route handlers can throw and the server answers with it.
export interface HttpError extends Error {
  status?: number;
  code?: string;
}

export function httpError(message: string, status: number): HttpError {
  return Object.assign(new Error(message), { status });
}

export interface Lyrics {
  synced: string | null;
  plain: string | null;
}
