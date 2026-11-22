// Toasts, the context menu and the confirm/input dialog: small stores that components
// render (Toasts, Menu, AskDialog), so code outside React can show them too.
import { useSyncExternalStore } from 'react';

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const l of listeners) l(); },
    use: () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => value),
  };
}

// ---------------------------------------------------------------- toasts
export interface Toast {
  id: number;
  msg: string;
  error: boolean;
  out: boolean;
  action?: string;
  onAction?: () => void;
}
export const toasts = createStore<Toast[]>([]);
let toastId = 0;

export function toast(msg: string, { action, onAction, error = false, timeout = 3500 }: { action?: string; onAction?: () => void; error?: boolean; timeout?: number } = {}): void {
  const t: Toast = { id: ++toastId, msg, error, out: false, action, onAction };
  toasts.set([...toasts.get(), t]);
  setTimeout(() => {
    toasts.set(toasts.get().map((x) => (x.id === t.id ? { ...x, out: true } : x)));
    setTimeout(() => dismissToast(t.id), 250);
  }, timeout);
}

export function dismissToast(id: number): void {
  toasts.set(toasts.get().filter((x) => x.id !== id));
}

// ---------------------------------------------------------------- context menu
export interface MenuAction { label: string; icon?: string; action: () => void; disabled?: boolean }
export interface SubMenu { label: string; items: MenuEntry[] }
export type MenuEntry = MenuAction | SubMenu | '-' | null | false | undefined;
export interface MenuState { x: number; y: number; items: MenuEntry[]; returnFocus: Element | null }

export const menu = createStore<MenuState | null>(null);

export function openMenu(x: number, y: number, items: MenuEntry[]): void {
  menu.set({ x, y, items, returnFocus: document.activeElement });
}
export function closeMenu(): void {
  if (menu.get()) menu.set(null);
}

// ---------------------------------------------------------------- dialog
export interface AskOptions { value?: string; placeholder?: string; confirm?: string; danger?: boolean; input?: boolean }
export interface AskState extends AskOptions { title: string; resolve: (v: string | true | null) => void }
export const asking = createStore<AskState | null>(null);

// Resolves to the text typed (input dialogs), true (confirm dialogs) or null (cancelled).
export function ask(title: string, opts: AskOptions & { input: false }): Promise<true | null>;
export function ask(title: string, opts?: AskOptions): Promise<string | null>;
export function ask(title: string, opts: AskOptions = {}): Promise<string | true | null> {
  return new Promise((resolve) => {
    asking.get()?.resolve(null);
    asking.set({ title, input: true, ...opts, resolve });
  });
}
