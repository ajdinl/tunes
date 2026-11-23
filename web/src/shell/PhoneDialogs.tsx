// "Listen on phone" (QR codes for Wi-Fi and Tailscale) and "Add to Home Screen".
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { Loading } from '../components/common.tsx';
import { shell, useShell } from './ui.ts';
import { useInstallMethod, promptInstall, IS_IOS, IS_PHONE } from '../lib/install.ts';
import { api, store } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { toast } from '../lib/feedback.ts';
import { STANDALONE } from '../lib/env.ts';

function Modal({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
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

const Head = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="dlg__head"><h2 className="dlg__title">{title}</h2><IconButton icon="close" size={18} label={tr('Close')} onClick={onClose} /></div>
);

interface PhoneState { enabled: boolean; port?: number; wifi?: { url: string | null; qr: string | null }; tailscale?: { running: boolean; url: string | null; qr: string | null } }

export function PhoneDialog() {
  const ui = useShell();
  const [st, setSt] = useState<PhoneState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'wifi' | 'tailscale'>('wifi');
  const [busy, setBusy] = useState(false);
  const close = () => shell.set({ phone: false });

  const show = (s: PhoneState, e: string | null = null) => { setSt(s); setErr(e); store.setPhoneOn(s.enabled); };
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const s = await api<PhoneState>('/api/phone', { method: 'POST', body: { enabled: on } });
      show(s);
      if (!on) toast(tr('Phone access is off. The old link no longer works.'));
    } catch (e) { show({ enabled: false }, (e as Error).message); }
    setBusy(false);
  };

  useEffect(() => {
    if (!ui.phone) return;
    setSt(null); setErr(null); setTab('wifi');
    let stale = false;
    api<PhoneState>('/api/phone').then(async (s) => {
      if (stale) return;
      // One click: if it is off, turn it on and show the QR code right away.
      if (!s.enabled) await toggle(true); else show(s);
    }).catch((e) => { if (!stale) show({ enabled: false }, (e as Error).message); });
    return () => { stale = true; };
  }, [ui.phone]);

  // Other parts of the app (Settings) ask for this dialog with an event.
  useEffect(() => {
    const open = () => shell.set({ phone: true });
    document.addEventListener('open-phone', open);
    return () => document.removeEventListener('open-phone', open);
  }, []);

  let body: ReactNode;
  if (!st || busy) body = <Loading />;
  else if (!st.enabled) {
    body = (
      <>
        {err && <p className="err">{err}</p>}
        <p className="muted">{tr('Phone access is off. Once you turn it on, your music, playlists and favorites are the same as on this computer.')}</p>
        <div className="dlg__actions"><button type="button" className="btn btn--primary" onClick={() => toggle(true)}><Icon name="phone" size={16} />{tr('Turn on')}</button></div>
      </>
    );
  } else {
    const cur = tab === 'wifi' ? st.wifi : st.tailscale;
    body = (
      <>
        {err && <p className="err">{err}</p>}
        <div className="tabs tabs--small phone__tabs" role="tablist">
          {([['wifi', tr('At home (Wi-Fi)')], ['tailscale', tr('Away from home (Tailscale)')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" className={cx('tab', tab === k && 'is-on')} aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {cur?.qr ? (
          <>
            {/* The QR SVG comes from our own server (qrcode package). */}
            <div className="phone__qr" role="img" aria-label={tr('QR code to open on your phone')} dangerouslySetInnerHTML={{ __html: cur.qr }} />
            {tab === 'wifi' ? (
              <ol className="phone__steps">
                <li>{tr('Open the camera on your phone and point it at the code.')}</li>
                <li>{tr('Tap the link that appears. Tunes opens in the browser.')}</li>
                <li>{tr('The phone must be on the same Wi-Fi network as this computer.')}</li>
              </ol>
            ) : (
              <ol className="phone__steps">
                <li>{tr('On your phone, turn on the Tailscale app, signed in to the same account as this computer.')}</li>
                <li>{tr('Scan the code with your camera and tap the link.')}</li>
                <li>{tr('Works anywhere: at home, at work or on mobile data. The computer has to stay on.')}</li>
              </ol>
            )}
            <p className="phone__url">{cur.url}</p>
          </>
        ) : tab === 'tailscale' ? (
          <>
            <p>{st.tailscale?.running ? tr('Tailscale is running, but this computer doesn\'t have an address yet. Try again in a few seconds.')
              : tr('Tailscale isn\'t running on this computer. Start the Tailscale app (icon in the menu bar) and try again.')}</p>
            <p className="muted">{tr('Tailscale is free for personal devices: ')}<a href="https://tailscale.com/download" target="_blank" rel="noopener">tailscale.com/download</a></p>
          </>
        ) : <p>{tr('This computer isn\'t connected to a network. Connect to Wi-Fi and try again.')}</p>}
        <p className="muted phone__note">{tr('If macOS asks whether “node” may accept connections, click Allow.')}</p>
        <div className="dlg__actions">
          <button type="button" className="btn btn--ghost" onClick={() => toggle(false)}>{tr('Turn off access')}</button>
          <button type="button" className="btn" onClick={() => api<PhoneState>('/api/phone').then((x) => show(x))}><Icon name="refresh" size={16} />{tr('Refresh')}</button>
          <button type="button" className="btn btn--primary" onClick={close}>{tr('Done')}</button>
        </div>
      </>
    );
  }
  return (
    <Modal open={ui.phone} label={tr('Listen on phone')} onClose={close}>
      <Head title={tr('Listen on phone')} onClose={close} />
      {body}
    </Modal>
  );
}

// ---------------------------------------------------------------- install as an app
// Only the steps for this browser (lib/install.ts works out which). On phones it also
// explains Tailscale, so the home-screen app works away from home too.
const ON_TAILSCALE = location.hostname.endsWith('.ts.net') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(location.hostname);

export function InstallDialog() {
  const ui = useShell();
  const method = useInstallMethod();
  const [links, setLinks] = useState<{ tailscale: string | null } | null | 'error'>(null);
  const close = () => shell.set({ install: false });
  const title = IS_PHONE ? tr('Add to Home Screen') : tr('Install app');

  useEffect(() => {
    if (!ui.install || !IS_PHONE || ON_TAILSCALE || STANDALONE) return;
    setLinks(null);
    api<{ tailscale: string | null }>('/api/phone/links').then(setLinks).catch(() => setLinks('error'));
  }, [ui.install]);

  // Installed in the meantime (or this browser can't): nothing left to explain.
  useEffect(() => { if (ui.install && method === null) close(); }, [ui.install, method]);

  let steps: ReactNode = null;
  if (method === 'prompt') {
    steps = (
      <div className="dlg__actions">
        <button type="button" className="btn btn--primary" onClick={async () => { close(); if (await promptInstall()) toast(tr('Tunes is installed')); }}>
          <Icon name="plus" size={16} />{tr('Install app')}
        </button>
      </div>
    );
  } else if (method === 'ios') {
    steps = (
      <ol className="phone__steps">
        <li>{tr('Open this page in Safari.')}</li>
        <li>{tr('Tap the Share button (the square with an arrow pointing up).')}</li>
        <li>{tr('Choose “Add to Home Screen”, then “Add”.')}</li>
      </ol>
    );
  } else if (method === 'android') {
    steps = (
      <ol className="phone__steps">
        <li>{tr('Open this page in Chrome.')}</li>
        <li>{tr('Tap the ⋮ menu in the top right.')}</li>
        <li>{tr('Choose “Add to Home screen” or “Install app”.')}</li>
      </ol>
    );
  } else if (method === 'mac-safari') {
    steps = <p className="install__steps">{tr('In Safari, choose File → Add to Dock.')}</p>;
  } else if (method === 'desktop') {
    steps = <p className="install__steps">{tr('Click the install icon at the right end of the address bar, or open the browser menu and choose “Install Tunes”.')}</p>;
  }

  const tsSteps = (link: string | null) => (
    <div>
      <ol className="phone__steps">
        <li>{tr('Install Tailscale on your phone: ')}
          <a href={IS_IOS ? 'https://apps.apple.com/app/tailscale/id1470499037' : 'https://play.google.com/store/apps/details?id=com.tailscale.ipn'} target="_blank" rel="noopener">{IS_IOS ? 'App Store' : 'Google Play'}</a>
          {tr(', and sign in with the same account as on your computer.')}</li>
        <li>{tr('Open the Tailscale version with the button below.')}</li>
        <li>{tr('Add that one to your Home Screen. It works both at home and away.')}</li>
      </ol>
      {link && <a className="btn btn--primary" href={link}><Icon name="external" size={16} />{tr('Open Tailscale version')}</a>}
    </div>
  );

  let ts: ReactNode = null;
  // Tailscale reaches the computer from away; the phone-only version needs no computer.
  if (IS_PHONE && !STANDALONE) {
    if (ON_TAILSCALE) ts = <p>{tr('This version runs over Tailscale, so it works both at home and away. Add this one to your Home Screen.')}</p>;
    else if (links === null) ts = <p className="loading"><span className="loading__dot" />{tr('Loading…')}</p>;
    else if (links === 'error') ts = tsSteps(null);
    else if (links.tailscale) ts = tsSteps(links.tailscale);
    else ts = <><p className="muted">{tr('Tailscale isn\'t running on the computer. Start it there, then open this window again.')}</p>{tsSteps(null)}</>;
  }

  return (
    <Modal open={ui.install} label={title} onClose={close}>
      <Head title={title} onClose={close} />
      <p className="muted">{IS_PHONE ? tr('Tunes will open like a real app, full screen and with its own icon.') : tr('Tunes will open in its own window, with its own icon in the Dock or taskbar.')}</p>
      {steps}
      {ts && <><h3 className="install__h">{tr('Listening away from home (Tailscale)')}</h3><div className="install__ts">{ts}</div></>}
    </Modal>
  );
}
