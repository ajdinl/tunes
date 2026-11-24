// SoundCloud and Mixcloud play in their own embedded players. The one in use stays on
// screen (both services require that), and can be folded down to a small bar.
import { useEffect, useRef } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { shell, useShell } from './ui.ts';
import { player, usePlayer } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { toast } from '../lib/feedback.ts';

const NAMES: Record<string, string> = { soundcloud: 'SoundCloud', mixcloud: 'Mixcloud' };

export function ScDock() {
  const ui = useShell();
  const source = usePlayer('track').track?.source || '';
  const name = NAMES[source] || '';
  const scBody = useRef<HTMLDivElement>(null);
  const mcBody = useRef<HTMLDivElement>(null);

  // The widgets put their iframes here; React never renders children into these elements.
  useEffect(() => {
    player.sc.host = scBody.current;
    player.mc.host = mcBody.current;
  }, []);
  useEffect(() => {
    const blocked = () => {
      shell.set({ scMin: false });
      toast(tr('Tap play in the {name} player to start', { name: NAMES[player.track?.source || ''] || '' }));
    };
    player.addEventListener('scblocked', blocked);
    return () => player.removeEventListener('scblocked', blocked);
  }, []);

  return (
    <section className={cx('scdock', 'scdock--' + source, ui.scMin && 'is-min')} hidden={!name} aria-label={name || undefined}>
      <div className="scdock__bar">
        <span className="scdock__label"><Icon name="cloud" size={16} />{name}</span>
        <IconButton icon={ui.scMin ? 'chevronUp' : 'chevronDown'} size={18}
          label={ui.scMin ? tr('Show the {name} player', { name }) : tr('Fold the {name} player', { name })}
          aria-expanded={!ui.scMin} onClick={() => shell.set({ scMin: !ui.scMin })} />
      </div>
      <div className="scdock__body" ref={scBody} hidden={source !== 'soundcloud'} />
      <div className="scdock__body" ref={mcBody} hidden={source !== 'mixcloud'} />
    </section>
  );
}
