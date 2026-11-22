// The receiver dial (spectrum, ticks, needle) as a seek slider.
// Mouse: press and drag seeks right away. Touch: a tap or a sideways drag seeks, but a
// vertical swipe (closing the app from the iPhone home bar, scrolling) is ignored.
import { useEffect, useRef, useState } from 'react';

import { Dial, useDialStyle } from '../lib/dial.ts';
import { player, usePlayer } from '../lib/player.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime, cx } from '../lib/format.ts';

export function DialView({ big = false }: { big?: boolean }) {
  const p = usePlayer('time', 'track');
  const style = useDialStyle();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const dial = useRef<Dial | null>(null);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);

  useEffect(() => {
    const d = new Dial(canvas.current!, { big });
    dial.current = d;
    return () => { d.destroy(); dial.current = null; };
  }, [big]);

  useEffect(() => {
    const el = box.current!;
    let dragging = false;
    let touch: { x: number; y: number } | null = null; // where a touch started, until we know which way it goes
    const d = () => dial.current!;
    const show = (e: PointerEvent) => {
      if (!player.track || player.track.live) return;
      d().hoverX = d().xAt(e.clientX);
      setTip({ x: d().hoverX!, text: fmtTime(d().timeAt(e.clientX)) });
    };
    const hide = () => { if (dial.current) dial.current.hoverX = null; setTip(null); };
    const move = (e: PointerEvent) => {
      if (touch && !dragging) {
        const dx = Math.abs(e.clientX - touch.x);
        const dy = Math.abs(e.clientY - touch.y);
        if (dy > 10 && dy > dx) { touch = null; hide(); return; }
        if (dx > 8) dragging = true; else return;
      }
      if (e.pointerType !== 'mouse' && !dragging) return;
      show(e);
      if (dragging) player.seek(d().timeAt(e.clientX));
    };
    const leave = () => { if (!dragging) hide(); };
    const down = (e: PointerEvent) => {
      if (!player.track || player.track.live) return;
      el.setPointerCapture(e.pointerId);
      if (e.pointerType === 'mouse') {
        dragging = true;
        player.seek(d().timeAt(e.clientX));
      } else {
        touch = { x: e.clientX, y: e.clientY };
      }
    };
    const up = (e: PointerEvent) => {
      if (touch && !dragging) player.seek(d().timeAt(e.clientX)); // a plain tap
      if (e.pointerType !== 'mouse') hide();
      dragging = false;
      touch = null;
    };
    const cancel = () => { dragging = false; touch = null; hide(); };
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 30 : 5;
      if (e.key === 'ArrowRight') { player.seek(player.time + step); e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'ArrowLeft') { player.seek(player.time - step); e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'Home') { player.seek(0); e.preventDefault(); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('keydown', key);
    };
  }, []);

  const t = p.track;
  const d = p.duration;
  const aria = t?.live
    ? { 'aria-valuetext': tr('Live') }
    : { 'aria-valuemax': Math.round(d || 0), 'aria-valuenow': Math.round(p.time), 'aria-valuetext': tr('{a} of {b}', { a: fmtTime(p.time), b: fmtTime(d) }) };
  return (
    <div ref={box} className={cx('dial', big && 'dial--big', t?.live && 'is-live')} data-style={style} role="slider" tabIndex={0}
      aria-label={tr('Position in song')} aria-valuemin={0} {...aria}>
      <canvas ref={canvas} className="dial__cv" aria-hidden="true" />
      <span className="dial__tip" hidden={!tip} style={tip ? { left: tip.x + 'px' } : undefined}>{tip?.text}</span>
    </div>
  );
}
