// Small building blocks shared by the screens. Class names match css/app.css.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { media } from '../lib/media.ts';
import { Icon } from './Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { SOURCES, cx } from '../lib/format.ts';
import { player } from '../lib/player.ts';
import type { Context, Track } from '../lib/store.ts';

export function Cover({ src, label = '', className = '' }: { src?: string | null; label?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const empty = !src || failed;
  return (
    <div className={cx('cv', className, empty && 'cv--empty')} data-initial={empty ? initial : undefined}>
      {!empty && <img src={media(src)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </div>
  );
}

export function Collage({ covers, label }: { covers: (string | null | undefined)[]; label: string }) {
  const list = [...new Set(covers.filter(Boolean) as string[])].slice(0, 4);
  if (list.length < 4) return <Cover src={list[0]} label={label} className="tile__cv" />;
  return (
    <div className="cv cv--collage tile__cv">
      {list.map((c) => <img key={c} src={media(c)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />)}
    </div>
  );
}

export function SourceTag({ source }: { source?: string }) {
  const src = source || '';
  const s = SOURCES[src] || { name: src, short: src };
  return <span className={'src src--' + src} title={tr(s.name)}>{tr(s.short)}</span>;
}

export function Header({ title, kicker, meta, art, actions = [], big = false }:
  { title: ReactNode; kicker?: ReactNode; meta?: ReactNode; art?: ReactNode; actions?: ReactNode[]; big?: boolean }) {
  const shown = actions.filter(Boolean);
  return (
    <header className={cx('hd', art ? 'hd--art' : '', big && 'hd--big')}>
      {art || null}
      <div className="hd__text">
        {kicker ? <p className="hd__kicker">{kicker}</p> : null}
        <h1 className="hd__title" tabIndex={-1}>{title}</h1>
        {meta ? <p className="hd__meta">{meta}</p> : null}
        {shown.length ? <div className="hd__actions">{shown}</div> : null}
      </div>
    </header>
  );
}

export function Section({ title, link, children }: { title: ReactNode; link?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec__head">
        <h2 className="sec__title">{title}</h2>
        {link ? <a className="sec__link" href={link.href}>{link.label}</a> : null}
      </div>
      {children}
    </section>
  );
}

export interface ChipOption<T extends string = string> { value: T; label: string }

// A row of toggle chips; labels are translated here (like the old chips()).
export function Chips<T extends string>({ options, value, onPick, label }: { options: ChipOption<T>[]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cx('chip', o.value === value && 'is-on')} aria-pressed={o.value === value}
          onClick={() => onPick(o.value)}>{tr(o.label)}</button>
      ))}
    </div>
  );
}

// Chips that keep their own selection (the screen only needs to know when it changes).
export function ChipPicker<T extends string>({ options, initial, onPick, label }: { options: ChipOption<T>[]; initial: T; onPick: (v: T) => void; label: string }) {
  const [value, setValue] = useState(initial);
  return <Chips options={options} value={value} label={label} onPick={(v) => { setValue(v); onPick(v); }} />;
}

export function FilterInput({ placeholder, onChange }: { placeholder: string; onChange: (v: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <label className="filter">
      <Icon name="search" size={16} />
      <input className="field field--filter" type="search" placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => { const v = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(() => onChange(v), 120); }} />
    </label>
  );
}

export function Loading({ text }: { text?: string }) {
  return <p className="loading" role="status"><span className="loading__dot" />{text || tr('Loading…')}</p>;
}

export function ErrorBox({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="err" role="alert">
      <p>{msg}</p>
      {retry ? <button type="button" className="btn" onClick={retry}><Icon name="refresh" size={16} />{tr('Try again')}</button> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function playButtons(tracks: Track[], context: Context): ReactNode[] {
  if (!tracks.length) return [];
  return [
    <button key="play" type="button" className="btn btn--primary" onClick={() => player.playList(tracks, 0, { shuffle: false, context })}><Icon name="play" size={18} />{tr('Play')}</button>,
    <button key="shuffle" type="button" className="btn" onClick={() => player.playList(tracks, -1, { shuffle: true, context })}><Icon name="shuffle" size={18} />{tr('Shuffle')}</button>,
  ];
}

export interface Tile { key: string; title: string; sub?: string; href: string; cover?: string | null; collage?: (string | null | undefined)[]; play?: () => void }

export function Grid({ items, round = false }: { items: Tile[]; round?: boolean }) {
  return (
    <div className={cx('grid', round && 'grid--round')}>
      {items.map((it) => (
        <div className="tile" key={it.key}>
          <a className="tile__link" href={it.href} aria-label={it.title}>
            {it.collage ? <Collage covers={it.collage} label={it.title} /> : <Cover src={it.cover} label={it.title} className="tile__cv" />}
          </a>
          {it.play ? <button type="button" className="tile__play" aria-label={tr('Play ') + it.title} onClick={it.play}><Icon name="play" size={18} /></button> : null}
          <a className="tile__title" href={it.href} tabIndex={-1}>{it.title}</a>
          {it.sub ? <span className="tile__sub">{it.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function NotFound({ text, back }: { text: string; back: string }) {
  return <div className="view"><div className="note"><p>{text}</p><a className="btn" href={back}>{tr('Back')}</a></div></div>;
}
