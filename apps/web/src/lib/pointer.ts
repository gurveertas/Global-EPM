/**
 * Two small page-wide pointer helpers, installed once:
 *  - the glow on cards (.glow-card) follows the pointer, using CSS variables so nothing re-renders;
 *  - any text cut off with "…" (in tables, or anything with .truncate / data-tip) shows in full in a hover card.
 */
let tip: HTMLDivElement | null = null;
let tipFor: Element | null = null;

function cutOff(el: Element) {
  const h = el as HTMLElement;
  return h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 2;
}

/** The nearest element that is actually cutting its text off, if any. */
function clipped(start: Element | null): HTMLElement | null {
  let el = start as HTMLElement | null;
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    if (el.dataset?.tip) return el;
    const cs = getComputedStyle(el);
    if ((cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && cutOff(el)) return el;
    if (el.tagName === "TD" || el.tagName === "TABLE" || el.tagName === "BUTTON") break;
  }
  return null;
}

function hideTip() { tip?.remove(); tip = null; tipFor = null; }

function place(e: PointerEvent) {
  if (!tip) return;
  const r = tip.getBoundingClientRect();
  const x = Math.min(window.innerWidth - r.width - 8, e.clientX + 12);
  const y = e.clientY + 18 + r.height > window.innerHeight ? e.clientY - r.height - 12 : e.clientY + 18;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}

export function installPointerEffects() {
  if (typeof window === "undefined" || (window as any).__eszyPointer) return;
  (window as any).__eszyPointer = true;
  document.addEventListener("pointermove", (e) => {
    const target = e.target as Element | null;
    const card = target?.closest?.(".glow-card") as HTMLElement | null;
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
    if (e.pointerType !== "mouse") return;
    const el = target ? clipped(target) : null;
    if (!el) { if (tipFor) hideTip(); return; }
    if (el !== tipFor) {
      hideTip();
      const text = (el.dataset.tip || el.innerText || "").trim();
      if (!text) return;
      tip = document.createElement("div");
      tip.className = "overflow-tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = text;
      document.body.appendChild(tip);
      tipFor = el;
    }
    place(e);
  }, { passive: true });
  document.addEventListener("pointerdown", hideTip, { passive: true });
  window.addEventListener("scroll", hideTip, { passive: true, capture: true });
}
