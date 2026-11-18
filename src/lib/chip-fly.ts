export const COLLAPSE_MS = 420;
export const FLY_MS = 560;
export const PAGE_MS = 360;
export const REVEAL_MS = 820;
export const DEEP_REVEAL_MS = 420;

const CONTENT_SEL = ".fx, h2, p, .badge, .card-cta, .chip-ic";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function afterTransition(
  el: HTMLElement,
  ms: number,
  property = "transform",
): Promise<void> {
  return new Promise((resolve) => {
    if (ms === 0) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== el) return;
      // Collapse also transitions background/border/box-shadow on the same
      // element. The first of those events must not end a later fly phase.
      if (property && event.propertyName !== property) return;
      done();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(done, ms + 80);
  });
}

export function chipCenter(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export type Flyer = {
  fly: HTMLElement;
  scale: number;
  origin: { x: number; y: number };
  originOffset: { x: number; y: number };
};

export function makeFlyer(card: HTMLElement): Flyer {
  const rect = card.getBoundingClientRect();
  const chip = card.querySelector(".chip-ic");
  if (!chip) {
    throw new Error("Game card is missing a chip icon");
  }
  const chipRect = chip.getBoundingClientRect();
  const fly = card.cloneNode(true) as HTMLElement;
  fly.removeAttribute("data-game");
  fly.removeAttribute("href");
  fly.removeAttribute("aria-current");
  fly.setAttribute("aria-hidden", "true");
  fly.tabIndex = -1;
  fly.classList.add("is-fly");
  fly.classList.remove("is-ghost", "is-away");
  fly.style.left = `${rect.left}px`;
  fly.style.top = `${rect.top}px`;
  fly.style.width = `${rect.width}px`;
  fly.style.height = `${rect.height}px`;
  fly.style.transform = "none";
  const ox = chipRect.left + chipRect.width / 2 - rect.left;
  const oy = chipRect.top + chipRect.height / 2 - rect.top;
  fly.style.transformOrigin = `${ox}px ${oy}px`;
  const scale = chipRect.width / rect.width;
  fly.style.setProperty("--chip-boost", String(1 / scale));
  fly.dataset.scale = String(scale);
  fly.dataset.originX = String(ox);
  fly.dataset.originY = String(oy);
  document.body.appendChild(fly);
  return {
    fly,
    scale,
    origin: {
      x: chipRect.left + chipRect.width / 2,
      y: chipRect.top + chipRect.height / 2,
    },
    originOffset: { x: ox, y: oy },
  };
}

export function clearFlyer(fly: HTMLElement | null): void {
  fly?.remove();
}

export function prepareCollapse(fly: HTMLElement, ms: number): void {
  const collapsingBits = fly.querySelectorAll<HTMLElement>(CONTENT_SEL);
  collapsingBits.forEach((el) => {
    el.style.transition = `opacity ${ms}ms var(--ease-out), transform ${ms}ms var(--ease-out)`;
  });
}

export function prepareExpand(fly: HTMLElement, ms: number): void {
  fly.querySelectorAll<HTMLElement>(CONTENT_SEL).forEach((el) => {
    el.style.transition = `opacity ${ms}ms var(--ease-out), transform ${ms}ms var(--ease-out)`;
    el.style.opacity = "";
    el.style.transform = "";
  });
  fly.style.removeProperty("--chip-boost");
  fly.style.background = "";
  fly.style.borderColor = "";
  fly.style.boxShadow = "";
}
