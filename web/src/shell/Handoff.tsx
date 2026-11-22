// "Playing on: Computer — Continue here": shown when another device plays (or recently paused).
import { useEffect, useState } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { Cover } from '../components/common.tsx';
import { usePlayer } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime } from '../lib/format.ts';
import { DEVICE_ID, deviceName, remoteTime, takeOver, useRemote } from '../lib/session.ts';

export function Handoff() {
  const r = useRemote();
  const p = usePlayer('state', 'track');
  const [dismissedFor, setDismissed] = useState<string | null>(null);
  const [, tick] = useState(0);

  const show = Boolean(r && r.deviceId !== DEVICE_ID && dismissedFor !== r.track.id + r.deviceId
    && (r.playing || Date.now() - r.at < 6 * 3600e3)
    && !(p.playing && p.track?.id === r.track.id));

  // The time on the banner keeps counting while the other device plays.
  useEffect(() => {
    if (!show) return;
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [show]);

  if (!show || !r) return <div className="handoff" hidden role="region" />;
  return (
    <div className="handoff" role="region" aria-label={tr('Continue listening')}>
      <Cover src={r.track.cover} label={r.track.title} className="handoff__cv" />
      <div className="handoff__text">
        <span className="handoff__label">{r.playing ? tr('Playing on: {d}', { d: deviceName(r.device) }) : tr('Paused on: {d}', { d: deviceName(r.device) })}</span>
        <span className="handoff__title">
          <span className="handoff__name">{r.track.title}</span>
          <span className="handoff__time">{r.track.live ? tr('live') : fmtTime(remoteTime(r))}</span>
        </span>
      </div>
      <button type="button" className="btn btn--primary" onClick={() => { setDismissed(null); takeOver(); }}><Icon name="play" size={16} />{tr('Continue here')}</button>
      <IconButton icon="close" size={18} label={tr('Hide')} onClick={() => setDismissed(r.track.id + r.deviceId)} />
    </div>
  );
}
