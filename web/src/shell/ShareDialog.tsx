// "Share song" / "Share playlist": the link (copy), the browser's share sheet where there is one,
// and a QR code to open it on a phone (when the link is short enough for one). Phones skip this
// and go straight to their own share sheet (actions.ts).
import { useEffect, useRef, useState } from 'react';

import { Modal, ModalHead } from '../components/Modal.tsx';
import { Collage, Cover } from '../components/common.tsx';
import { Icon } from '../components/Icon.tsx';
import { shell, useShell } from './ui.ts';
import { copyText } from '../lib/actions.ts';
import { toast } from '../lib/feedback.ts';
import { tr } from '../lib/i18n.ts';
import { songs } from '../lib/format.ts';

// Longer links make a QR code too dense for a phone camera to read off a screen.
const QR_MAX = 1500;

export function ShareDialog() {
  const { share: item } = useShell();
  const link = item?.link;
  const field = useRef<HTMLInputElement>(null);
  const [qr, setQr] = useState('');
  const close = () => shell.set({ share: null });

  // The QR code library is only loaded when someone shares.
  useEffect(() => {
    setQr('');
    if (!link || link.length > QR_MAX) return;
    let stale = false;
    import('qrcode').then((q) => q.toString(link, { type: 'svg', margin: 1 })).then((svg) => { if (!stale) setQr(svg); }).catch(() => { /* the link is enough */ });
    return () => { stale = true; };
  }, [link]);

  if (!item || !link) return null;
  const title = item.kind === 'song' ? tr('Share song') : tr('Share playlist');
  const copy = async () => {
    if (await copyText(link, field.current)) toast(tr('Link copied'));
    else field.current?.select();
  };
  return (
    <Modal open label={title} onClose={close}>
      <ModalHead title={title} onClose={close} />
      <div className="share__song">
        {item.kind === 'song'
          ? <Cover src={item.covers[0]} label={item.title} className="share__cv" />
          : <div className="share__cv"><Collage covers={item.covers} label={item.title} /></div>}
        <div className="share__meta">
          <p className="share__title">{item.title}</p>
          {item.sub && <p className="muted share__artist">{item.sub}</p>}
        </div>
      </div>
      {item.left > 0 && <p className="muted share__left">{tr('Left out because others can’t play them: {n}', { n: songs(item.left) })}</p>}
      <div className="share__row">
        <input ref={field} className="field share__link" readOnly value={link} aria-label={tr('Link')} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn--primary" onClick={copy}><Icon name="copy" size={16} />{tr('Copy link')}</button>
      </div>
      {'share' in navigator && (
        <button type="button" className="btn btn--ghost" onClick={() => navigator.share({ title: item.title, url: link }).catch(() => { /* closed */ })}>
          <Icon name="share" size={16} />{tr('More ways to share…')}
        </button>
      )}
      {/* The SVG comes from the qrcode package, made here from our own link. */}
      {qr && <div className="phone__qr share__qr" role="img" aria-label={tr('QR code to open on your phone')} dangerouslySetInnerHTML={{ __html: qr }} />}
      <p className="muted">{tr('Whoever opens the link can listen right away in their browser: free, with no account or app.')}</p>
    </Modal>
  );
}
