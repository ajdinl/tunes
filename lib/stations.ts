// Featured stations on the Radio page: listener-supported stations without ads, picked by
// hand. Every stream was played in a browser directly (as the phone-only version does) and
// through the server's proxy before it was added (2026-11-24); SomaFM was left out because
// browsers refuse its streams when they come straight from the source.
// The ids are the stations' radio-browser.info ids, so a station saved from search counts
// as the same one, and plays are reported to the database like any other station.
import type { Track } from './types.ts';

interface Featured {
  uuid: string; title: string; url: string; cover: string; link: string; where: string; genre: string; format: string;
}

const LIST: Featured[] = [
  {
    uuid: '9617a958-0601-11e8-ae97-52543be04c81', title: 'Radio Paradise', url: 'https://stream.radioparadise.com/aac-320',
    cover: 'https://radioparadise.com/apple-touch-icon.png', link: 'https://radioparadise.com', where: 'United States', genre: 'eclectic', format: 'AAC 320 kbps',
  },
  {
    uuid: 'd88c0d24-adb2-11e9-88f4-52543be04c81', title: 'Radio Paradise Mellow', url: 'https://stream.radioparadise.com/mellow-320',
    cover: 'https://radioparadise.com/apple-touch-icon.png', link: 'https://radioparadise.com', where: 'United States', genre: 'mellow', format: 'AAC 320 kbps',
  },
  {
    uuid: '961e6cac-0601-11e8-ae97-52543be04c81', title: 'NTS Radio 1', url: 'https://stream-relay-geo.ntslive.net/stream',
    cover: 'https://www.nts.live/apple-touch-icon.png', link: 'https://www.nts.live', where: 'United Kingdom', genre: 'underground', format: 'MP3 256 kbps',
  },
  {
    uuid: '9634ab94-0601-11e8-ae97-52543be04c81', title: 'NTS Radio 2', url: 'https://stream-relay-geo.ntslive.net/stream2',
    cover: 'https://www.nts.live/apple-touch-icon.png', link: 'https://www.nts.live', where: 'United Kingdom', genre: 'underground', format: 'MP3 256 kbps',
  },
  {
    uuid: '7b6aca3d-dfa3-47dd-9f57-820b04c3f339', title: 'FIP', url: 'https://icecast.radiofrance.fr/fip-hifi.aac',
    cover: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/FIP_logo_2021.svg/330px-FIP_logo_2021.svg.png', link: 'https://www.radiofrance.fr/fip',
    where: 'France', genre: 'eclectic', format: 'AAC 192 kbps',
  },
  {
    uuid: 'dd02972f-8d91-449d-8d64-bd636a4a9ed0', title: 'KEXP', url: 'https://kexp.streamguys1.com/kexp160.aac',
    cover: 'https://www.kexp.org/apple-touch-icon.png', link: 'https://www.kexp.org', where: 'United States', genre: 'indie', format: 'AAC 160 kbps',
  },
  {
    uuid: '766a0b33-3936-458b-ab92-db8500dccaf9', title: 'Radio Swiss Jazz', url: 'https://stream.srg-ssr.ch/srgssr/rsj/aac/192',
    cover: 'https://www.radioswissjazz.ch/social-media/rsj-web.png', link: 'https://www.radioswissjazz.ch', where: 'Switzerland', genre: 'jazz', format: 'AAC 192 kbps',
  },
];

// The same track shape lib/sources.ts gives stations from radio-browser.info.
export const FEATURED_STATIONS: Track[] = LIST.map((s) => ({
  id: 'radio:' + s.uuid,
  source: 'radio',
  title: s.title,
  artist: `${s.where} / ${s.genre}`,
  album: s.format,
  genre: s.genre,
  cover: s.cover,
  stream: `/api/stream/radio?sid=${encodeURIComponent(s.uuid)}&u=${encodeURIComponent(s.url)}`,
  link: s.link,
  live: true,
}));
