// Shared controls: a group of option buttons (pick one), an on/off switch and tabs.
// Labels are English keys, translated here (like Chips in common.tsx).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';

export interface Option<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode; // a swatch, a small drawing or an image left of the label
}

// One choice out of a few, as buttons (Settings → Appearance), with an optional heading above
// and a hint below. `kind` names the buttons for styles and tests: class `<kind>-opt` and
// `data-<attr>="<value>"` (attr defaults to kind).
export function OptionGroup<T extends string>({ options, value, onPick, title, label = title, hint, kind, attr = kind }: {
  options: readonly Option<T>[];
  value: T;
  onPick: (v: T) => void;
  title?: string;  // heading, also the group's name
  label?: string;  // the group's name when there is no heading
  hint?: string;
  kind?: string;
  attr?: string;
}) {
  return (
    <>
      {title && <h3 className="form__label">{tr(title)}</h3>}
      <div className="theme-pick" role="group" aria-label={label && tr(label)}>
        {options.map((o) => (
          <button key={o.value} type="button" className={cx('theme-opt', !o.icon && 'theme-opt--text', kind && `${kind}-opt`)}
            aria-pressed={o.value === value} onClick={() => onPick(o.value)} {...(attr ? { [`data-${attr}`]: o.value } : {})}>
            {o.icon}{tr(o.label)}
          </button>
        ))}
      </div>
      {hint && <p className="muted">{tr(hint)}</p>}
    </>
  );
}

// An on/off switch. Name it with `label`, or with `labelledBy` when the text is next to it.
export function Switch({ on, onChange, label, labelledBy, ...rest }: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  labelledBy?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label && tr(label)} aria-labelledby={labelledBy}
      onClick={() => onChange(!on)} {...rest}>
      <span className="switch__knob" />
    </button>
  );
}

export interface Tab<T extends string> {
  value: T;
  label: string;
  href?: string; // a tab that is an address (Settings, Discover); otherwise a button
}

// A row of tabs: links when the tab is part of the address, buttons when it is screen state.
export function Tabs<T extends string>({ tabs, value, onPick, small = false, className }: {
  tabs: readonly Tab<T>[];
  value: T | undefined;
  onPick?: (v: T) => void;
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('tabs', small && 'tabs--small', className)} role="tablist">
      {tabs.map((t) => {
        const on = t.value === value;
        const props = { className: cx('tab', on && 'is-on'), role: 'tab', 'aria-selected': on, 'data-tab': t.value };
        return t.href
          ? <a key={t.value} href={t.href} {...props}>{tr(t.label)}</a>
          : <button key={t.value} type="button" onClick={() => onPick?.(t.value)} {...props}>{tr(t.label)}</button>;
      })}
    </div>
  );
}
