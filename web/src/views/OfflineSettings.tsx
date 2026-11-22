// Settings for the offline buffer: on/off, how many songs ahead, storage limit, usage.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { Icon } from '../components/Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { songs } from '../lib/format.ts';
import { offline, fmtSize, HOME } from '../lib/offline.ts';
import type { OfflineSettings as Prefs } from '../lib/offline.ts';
import { toast } from '../lib/feedback.ts';

const LIMITS = [100, 250, 500, 1024, 2048, 4096, 8192];
const NARROW: CSSProperties = { width: 'auto', minWidth: '0', flex: 'none' };
let uid = 0;

export function OfflineSettings() {
  const [id] = useState(() => 'offline-' + ++uid);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...offline.settings }));
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  // Follow cache changes while mounted.
  useEffect(() => {
    if (!offline.supported) return;
    let alive = true;
    const update = () => {
      setPrefs({ ...offline.settings });
      offline.status().then((s) => { if (alive) { setUsage(s); setClearing(false); } });
    };
    update();
    offline.addEventListener('change', update);
    return () => { alive = false; offline.removeEventListener('change', update); };
  }, []);

  if (!offline.supported) {
    return <div className="form"><p className="muted">{tr('This browser can\'t store songs for offline playback.')}</p></div>;
  }

  const limits = [...new Set([...LIMITS, prefs.limitMB])].sort((a, b) => a - b);
  const count = usage?.count || 0;
  const clear = async () => {
    setClearing(true);
    await offline.clear();
    toast(tr('Downloaded songs cleared'));
  };

  return (
    <div className="form">
      <p className="muted">{tr('Downloads the current song and the next ones in the queue to this device, so music keeps playing when the connection drops.')}</p>
      <div className="row">
        <button type="button" className="switch" role="switch" aria-labelledby={id + '-on'} aria-checked={prefs.enabled}
          onClick={() => offline.setSettings({ enabled: !offline.settings.enabled })}><span className="switch__knob" /></button>
        <span id={id + '-on'}>{tr('Download songs ahead')}</span>
      </div>
      <div className="row">
        <label htmlFor={id + '-ahead'}>{tr('Songs to keep ahead')}</label>
        <select className="field" id={id + '-ahead'} style={NARROW} disabled={!prefs.enabled} value={String(prefs.ahead)}
          onChange={(e) => offline.setSettings({ ahead: Number(e.target.value) })}>
          {Array.from({ length: 10 }, (_, i) => <option key={i} value={String(i + 1)}>{String(i + 1)}</option>)}
        </select>
      </div>
      <div className="row">
        <label htmlFor={id + '-limit'}>{tr('Storage limit')}</label>
        <select className="field" id={id + '-limit'} style={NARROW} disabled={!prefs.enabled} value={String(prefs.limitMB)}
          onChange={(e) => offline.setSettings({ limitMB: Number(e.target.value) })}>
          {limits.map((mb) => <option key={mb} value={String(mb)}>{fmtSize(mb * 1048576)}</option>)}
        </select>
      </div>
      <p className="muted" aria-live="polite">
        {usage ? tr('Downloaded for offline') + ': ' + (count ? `${songs(count)}, ${fmtSize(usage.bytes)}` : tr('nothing yet')) : ''}
      </p>
      <p className="muted">{tr('Songs you haven\'t played for 3 days are deleted automatically.')}</p>
      <button type="button" className="btn btn--ghost" disabled={clearing || !count} onClick={clear}><Icon name="trash" size={16} />{tr('Clear downloaded songs')}</button>
      {HOME ? <p className="muted">{tr('On this computer, songs from your own folders are not downloaded: they are already here.')}</p> : null}
    </div>
  );
}
