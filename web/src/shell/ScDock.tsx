// SoundCloud links play in SoundCloud's own embedded player. It stays on screen (SoundCloud
// requires that), and can be folded down to a small bar.
import { useEffect, useRef } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { shell, useShell } from './ui.ts';
import { player, usePlayer } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { toast } from '../lib/feedback.ts';

export function ScDock() {
  const ui = useShell();
  const p = usePlayer('track');
  const body = useRef<HTMLDivElement>(null);

  // The widget puts its iframe here; React never renders children into this element.
  useEffect(() => { player.sc.host = body.current; }, []);
  useEffect(() => {
    const blocked = () => { shell.set({ scMin: false }); toast(tr('Tap play in the SoundCloud player to start')); };
    player.addEventListener('scblocked', blocked);
    return () => player.removeEventListener('scblocked', blocked);
  }, []);

  return (
    <section className={cx('scdock', ui.scMin && 'is-min')} hidden={p.track?.source !== 'soundcloud'} aria-label="SoundCloud">
      <div className="scdock__bar">
        <span className="scdock__label"><Icon name="cloud" size={16} />SoundCloud</span>
        <IconButton icon={ui.scMin ? 'chevronUp' : 'chevronDown'} size={18} label={ui.scMin ? tr('Show SoundCloud player') : tr('Fold SoundCloud player')}
          aria-expanded={!ui.scMin} onClick={() => shell.set({ scMin: !ui.scMin })} />
      </div>
      <div className="scdock__body" ref={body} />
    </section>
  );
}
