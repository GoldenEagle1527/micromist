export const EXPAND_MS = 780;

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
  property = "width",
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
      if (property && event.propertyName !== property) return;
      done();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(done, ms + 80);
  });
}

export function playDestRect(): DOMRect {
  const main = document.querySelector<HTMLElement>(".main");
  if (!main) {
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }
  const rect = main.getBoundingClientRect();
  return new DOMRect(
    rect.left,
    rect.top,
    rect.width,
    Math.max(0, window.innerHeight - rect.top),
  );
}

export function applyFixedBox(el: HTMLElement, rect: DOMRectReadOnly): void {
  el.style.position = "fixed";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.inset = "auto";
  el.style.margin = "0";
}

export function clearFixedBox(el: HTMLElement): void {
  el.style.position = "";
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  el.style.right = "";
  el.style.bottom = "";
  el.style.inset = "";
  el.style.margin = "";
  el.style.transition = "";
  el.style.opacity = "";
  el.style.borderRadius = "";
}

export function boxTransition(ms: number): string {
  const ease = `${ms}ms var(--ease-soft)`;
  const fade = `${ms}ms var(--ease-out)`;
  return [
    `left ${ease}`,
    `top ${ease}`,
    `width ${ease}`,
    `height ${ease}`,
    `opacity ${fade}`,
    `border-radius ${fade}`,
    `background ${fade}`,
    `border-color ${fade}`,
    `box-shadow ${fade}`,
  ].join(", ");
}

export type Flyer = {
  fly: HTMLElement;
  from: DOMRect;
};

export function makeFlyer(card: HTMLElement): Flyer {
  const rect = card.getBoundingClientRect();
  const fly = card.cloneNode(true) as HTMLElement;
  fly.removeAttribute("data-game");
  fly.removeAttribute("href");
  fly.removeAttribute("aria-current");
  fly.setAttribute("aria-hidden", "true");
  fly.tabIndex = -1;
  fly.classList.add("is-fly");
  fly.classList.remove("is-ghost", "is-squeezed");
  applyFixedBox(fly, rect);
  fly.style.transform = "none";
  document.body.appendChild(fly);
  return { fly, from: new DOMRect(rect.left, rect.top, rect.width, rect.height) };
}

export function clearFlyer(fly: HTMLElement | null): void {
  fly?.remove();
}

export function findCard(slug: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.card[data-game="${CSS.escape(slug)}"]`,
  );
}

export function otherCards(slug: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".card[data-game]")].filter(
    (el) => el.dataset.game !== slug,
  );
}

export function applySqueeze(
  card: HTMLElement,
  source: DOMRectReadOnly,
  dest: DOMRectReadOnly,
): void {
  const cx = source.left + source.width / 2;
  const cy = source.top + source.height / 2;
  const rect = card.getBoundingClientRect();
  const ox = rect.left + rect.width / 2;
  const oy = rect.top + rect.height / 2;
  let dx = ox - cx;
  let dy = oy - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    dx = dest.width >= dest.height ? 1 : 0;
    dy = dest.width >= dest.height ? 0 : 1;
  } else {
    dx /= len;
    dy /= len;
  }
  const push = Math.max(dest.width, dest.height) * 0.92;
  card.style.setProperty("--squeeze-x", `${dx * push}px`);
  card.style.setProperty("--squeeze-y", `${dy * push}px`);
  card.style.setProperty("--squeeze-s", "0.78");
  card.classList.add("is-squeezed");
}

export function clearSqueeze(card: HTMLElement): void {
  card.classList.remove("is-squeezed");
  card.style.removeProperty("--squeeze-x");
  card.style.removeProperty("--squeeze-y");
  card.style.removeProperty("--squeeze-s");
}

export function clearAllSqueezes(): void {
  document.querySelectorAll<HTMLElement>(".card.is-squeezed").forEach(clearSqueeze);
}
