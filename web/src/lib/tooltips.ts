// Icon-only buttons describe themselves with aria-label; show the same text as a tooltip on
// hover. Labels change at runtime (Play/Pause, language switch), so keep them in sync.
const TIP = 'button[aria-label], a.ibtn[aria-label], [role="slider"][aria-label]';

function syncTip(el: Element): void {
  if (el.matches?.(TIP) && !el.hasAttribute('data-no-tip')) {
    const label = el.getAttribute('aria-label');
    if (label !== null && el.getAttribute('title') !== label) el.setAttribute('title', label);
  }
}

export function startTooltips(): void {
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') syncTip(r.target as Element);
      else for (const n of r.addedNodes) if (n.nodeType === 1) { syncTip(n as Element); (n as Element).querySelectorAll?.(TIP).forEach(syncTip); }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
}
