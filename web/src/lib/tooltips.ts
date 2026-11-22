// Tooltips that show right away on mouse hover. The browser's own title tooltip waits
// about two seconds, which feels broken on icon buttons.
// Text comes from title (moved to data-tip on first hover, so the native one never shows)
// or from aria-label (icon-only buttons describe themselves with it). Not on touch, and
// not where the same text is already visible (a link in the expanded sidebar).
const TARGETS = '[title], [data-tip], button[aria-label], a.ibtn[aria-label]';

let tip: HTMLDivElement | null = null;
let target: Element | null = null;

function textOf(el: Element): string {
  const title = el.getAttribute('title');
  if (title !== null) {
    (el as HTMLElement).dataset.tip = title;
    el.removeAttribute('title');
  }
  return ((el as HTMLElement).dataset.tip || el.getAttribute('aria-label') || '').trim();
}

function show(el: Element): void {
  const text = textOf(el);
  const visible = (el as HTMLElement).innerText?.trim();
  const clipped = (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth;
  if (!text || (visible === text && !clipped)) { hide(); return; }
  target = el;
  tip ||= Object.assign(document.createElement('div'), { className: 'tip' });
  tip.setAttribute('aria-hidden', 'true'); // screen readers already get the aria-label / title
  tip.textContent = text;
  document.body.append(tip);
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const left = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
  const above = r.top - t.height - 8;
  tip.style.left = left + 'px';
  tip.style.top = (above >= 6 ? above : r.bottom + 8) + 'px';
  tip.classList.add('is-on');
}

function hide(): void {
  target = null;
  tip?.classList.remove('is-on');
}

export function startTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.(TARGETS) || null;
    // The dial shows the time under the mouse itself.
    if (!el || el.closest('.dial')) { hide(); return; }
    if (el !== target) show(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) hide();
  });
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, hide, { capture: true, passive: true });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
