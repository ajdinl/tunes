// Radio stations as cards: tap to play, heart to save.
import { Icon } from './Icon.tsx';
import { Cover } from './common.tsx';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import { toast } from '../lib/feedback.ts';

export function StationGrid({ list }: { list: Track[] }) {
  const playingId = usePlayer('track').track?.id;
  useStore('stations');
  return (
    <div className="stations">
      {list.map((s) => {
        const saved = store.isStation(s.id);
        return (
          <div key={s.id} className={cx('station', playingId === s.id && 'is-playing')} data-id={s.id}>
            <button type="button" className="station__main" onClick={() => player.playList([s], 0, { shuffle: false, context: { label: 'Radio', href: '/radio' } })}>
              <Cover src={s.cover} label={s.title} className="station__cv" />
              <span className="station__text"><span className="station__name">{s.title}</span><span className="station__sub">{s.artist}</span></span>
            </button>
            <button type="button" className={cx('station__save', saved && 'is-on')} aria-pressed={saved}
              aria-label={saved ? tr('Remove from my stations') : tr('Save station')}
              onClick={async () => {
                const on = await store.toggleStation(s);
                toast(on ? tr('“{title}” is in your stations', { title: s.title }) : tr('Station removed'));
              }}><Icon name={saved ? 'heartFill' : 'heart'} size={17} /></button>
          </div>
        );
      })}
    </div>
  );
}
