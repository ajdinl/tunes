// Renders the toasts, the context menu and the dialog from lib/feedback.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';

import { Icon } from './Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { toasts, dismissToast, menu, closeMenu, asking } from '../lib/feedback.ts';
import type { MenuEntry, MenuAction, SubMenu } from '../lib/feedback.ts';

export function Toasts() {
  const list = toasts.use();
  return (
    <div className="toasts" id="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', t.error && 'toast--error', t.out && 'is-out')} role={t.error ? 'alert' : 'status'}>
          <span>{t.msg}</span>
          {t.action ? <button type="button" className="toast__act" onClick={() => { t.onAction?.(); dismissToast(t.id); }}>{t.action}</button> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- context menu
const visibleItems = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(':scope .menu__item')].filter((n) => n.offsetParent);

function MenuList({ items, sub = false, onPick, style, rootRef, onKeyDown }: {
  items: MenuEntry[]; sub?: boolean; onPick: (a: MenuAction) => void;
  style?: CSSProperties; rootRef?: Ref<HTMLDivElement>; onKeyDown?: (e: ReactKeyboardEvent) => void;
}) {
  return (
    <div ref={rootRef} className={cx('menu', sub && 'menu--sub')} role="menu" style={style} onKeyDown={onKeyDown}>
      {items.filter(Boolean).map((it, k) => {
        if (it === '-') return <div key={k} className="menu__sep" role="separator" />;
        if ((it as SubMenu).items) return <SubItem key={k} item={it as SubMenu} onPick={onPick} />;
        const a = it as MenuAction;
        return (
          <button key={k} type="button" className="menu__item" role="menuitem" tabIndex={-1} disabled={a.disabled}
            onClick={(e) => { e.stopPropagation(); onPick(a); }}>
            {a.icon ? <Icon name={a.icon} size={16} /> : null}{a.label}
          </button>
        );
      })}
    </div>
  );
}

function SubItem({ item, onPick }: { item: SubMenu; onPick: (a: MenuAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={cx('menu__item', 'menu__item--sub', open && 'is-open')} role="menuitem" tabIndex={-1} aria-haspopup="true"
      onKeyDown={(e) => {
        if ((e.key === 'ArrowRight' || e.key === 'Enter') && e.target === ref.current) {
          setOpen(true);
          requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.menu--sub .menu__item')?.focus());
          e.stopPropagation();
        }
      }}>
      {item.label}
      <MenuList items={item.items} sub onPick={onPick} />
    </div>
  );
}

export function ContextMenu() {
  const state = menu.use();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(state.x, innerWidth - r.width - 8), top: Math.min(state.y, innerHeight - r.height - 8) });
    visibleItems(ref.current)[0]?.focus();
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeMenu(); };
    document.addEventListener('pointerdown', down);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [state]);

  if (!state) return null;
  const restore = () => (state.returnFocus as HTMLElement | null)?.focus?.();
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = visibleItems(ref.current!);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { (document.activeElement?.closest('.menu--sub')?.parentElement as HTMLElement | null)?.focus(); e.preventDefault(); }
    if (e.key === 'Escape') { closeMenu(); restore(); e.stopPropagation(); }
  };
  return (
    <MenuList items={state.items} rootRef={ref} onKeyDown={onKeyDown}
      style={{ left: pos?.left ?? state.x, top: pos?.top ?? state.y, visibility: pos ? 'visible' : 'hidden' }}
      onPick={(a) => { closeMenu(); restore(); a.action(); }} />
  );
}

// ---------------------------------------------------------------- dialog
export function AskDialog() {
  const state = asking.use();
  const dlg = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state || !dlg.current) return;
    if (!dlg.current.open) dlg.current.showModal();
    field.current?.select();
  }, [state]);

  if (!state) return null;
  const finish = (ok: boolean) => {
    asking.set(null);
    state.resolve(ok ? (state.input ? (field.current?.value || '').trim() : true) : null);
  };
  return (
    <dialog ref={dlg} className="dlg" onClose={() => { if (asking.get() === state) finish(false); }} onCancel={(e) => { e.preventDefault(); finish(false); }}>
      <form className="dlg__body" method="dialog" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
        <h2 className="dlg__title">{state.title}</h2>
        {state.input ? <input ref={field} className="field" type="text" defaultValue={state.value || ''} placeholder={state.placeholder || ''} aria-label={state.title} /> : null}
        <div className="dlg__actions">
          <button type="button" className="btn btn--ghost" onClick={() => finish(false)}>{tr('Cancel')}</button>
          <button type="submit" className={cx('btn', state.danger ? 'btn--danger' : 'btn--primary')} value="ok">{state.confirm || tr('Save')}</button>
        </div>
      </form>
    </dialog>
  );
}
