// Ten-band equalizer with presets.
import { useEffect, useRef } from 'react';

import { IconButton } from '../components/Icon.tsx';
import { shell, useShell } from './ui.ts';
import { player, usePlayer, EQ_FREQS, EQ_PRESETS } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { Switch } from '../components/controls.tsx';

const fmtDb = (v: number) => (v > 0 ? '+' : '') + (v || 0);
const fmtFreq = (f: number) => (f >= 1000 ? f / 1000 + 'k' : String(f));

export function Equalizer() {
  const ui = useShell();
  const p = usePlayer('eq', 'track', 'state');
  const box = useRef<HTMLDivElement>(null);
  const eq = p.eq;

  useEffect(() => {
    if (ui.eq) box.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [ui.eq]);

  return (
    <div ref={box} className="eq" id="eq" role="dialog" aria-label={tr('Equalizer')} hidden={!ui.eq}>
      {ui.eq && (
        <>
          <div className="eq__head">
            <h2 className="eq__title">{tr('Equalizer')}</h2>
            <Switch on={eq.enabled} label="Equalizer on" onChange={(enabled) => player.setEq({ enabled })} />
            <IconButton icon="close" size={18} label={tr('Close equalizer')} onClick={() => shell.set({ eq: false })} />
          </div>
          <div className="eq__presets chips" role="group" aria-label={tr('Sound presets')}>
            {Object.keys(EQ_PRESETS).map((name) => (
              <button key={name} type="button" className={cx('chip', eq.preset === name && 'is-on')} disabled={!eq.enabled} aria-pressed={eq.preset === name}
                onClick={() => player.setEq({ preset: name, gains: EQ_PRESETS[name].slice() })}>{tr(name)}</button>
            ))}
          </div>
          <div className={cx('eq__bands', !eq.enabled && 'is-off')}>
            {EQ_FREQS.map((f, i) => (
              <div key={f} className="eq__band">
                <output className="eq__val">{fmtDb(eq.gains[i])}</output>
                <input className="eq__range" type="range" min="-12" max="12" step="1" value={String(eq.gains[i] || 0)} disabled={!eq.enabled}
                  aria-label={`${fmtFreq(f)} Hz`} aria-valuetext={fmtDb(eq.gains[i]) + ' dB'}
                  onChange={(e) => {
                    const gains = player.eq.gains.slice();
                    gains[i] = Number(e.target.value);
                    player.setEq({ gains, preset: tr('Custom') });
                  }} />
                <span className="eq__f">{fmtFreq(f)}</span>
              </div>
            ))}
          </div>
          {p.mobile && <p className="eq__note">{tr('On phones the equalizer is off so music keeps playing when the screen is locked.')}</p>}
          {!p.mobile && !p.analysing && p.track?.live && <p className="eq__note">{tr('This station plays directly, so the equalizer doesn\'t affect it.')}</p>}
        </>
      )}
    </div>
  );
}
