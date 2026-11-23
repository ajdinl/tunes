// A native <dialog> shown as a modal while `open` (Esc and the close button call onClose).
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { IconButton } from './Icon.tsx';
import { tr } from '../lib/i18n.ts';

export function Modal({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} className="dlg dlg--phone" aria-label={label} onClose={onClose}>
      <div className="dlg__body">{children}</div>
    </dialog>
  );
}

export const ModalHead = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="dlg__head"><h2 className="dlg__title">{title}</h2><IconButton icon="close" size={18} label={tr('Close')} onClick={onClose} /></div>
);
