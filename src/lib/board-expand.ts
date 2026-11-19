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
  el.style.margin = "0";
  el.style.inset = "unset";
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
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

export function boxTransition(
  ms: number,
  opacityMs = ms,
  opacityDelay = 0,
): string {
  const ease = `${ms}ms var(--ease-soft)`;
  const fade = `${opacityMs}ms var(--ease-out)${opacityDelay > 0 ? ` ${opacityDelay}ms` : ""}`;
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

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export type BoardPlace = {
  column: number;
  row: number;
  width: number;
  height: number;
};

export type BoardLayout = {
  left: number;
  top: number;
  cols: number;
  rows: number;
  places: BoardPlace[];
};

export const BOARD_MAJOR_STEPS = 4;
export const CARD_MAJOR_WIDTH = 2;
export const CARD_MAJOR_HEIGHT = 3;

function cellOf(el: Element, fallback = 32): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue("--board-cell"));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function majorOf(el: Element): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue("--board-major"));
  if (Number.isFinite(value) && value > 0) return value;
  return cellOf(el) * BOARD_MAJOR_STEPS;
}

function snapLine(value: number, cell: number, mode: "ceil" | "floor"): number {
  const n = value / cell;
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < 0.02) return nearest * cell;
  return (mode === "ceil" ? Math.ceil(n) : Math.floor(n)) * cell;
}

/** Snap a board inside `main` so its edges sit on the shell's grid (origin at shell 0,0). */
export function measureBoard(shell: HTMLElement, main: HTMLElement): Omit<BoardLayout, "places"> {
  const major = majorOf(shell);
  const shellRect = shell.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  const relLeft = mainRect.left - shellRect.left;
  const relTop = mainRect.top - shellRect.top;
  const relRight = relLeft + mainRect.width;
  const relBottom = relTop + mainRect.height;
  const startX = snapLine(relLeft, major, "ceil");
  const startY = snapLine(relTop, major, "ceil");
  const endX = snapLine(relRight, major, "floor");
  const endY = snapLine(relBottom, major, "floor");
  const width = Math.max(major, endX - startX);
  const height = Math.max(major, endY - startY);
  return {
    left: startX - relLeft,
    top: startY - relTop,
    cols: Math.max(1, Math.round(width / major)),
    rows: Math.max(1, Math.round(height / major)),
  };
}

export function placeCards(cols: number, rows: number, count: number): BoardPlace[] {
  const gap = 1;
  const n = Math.max(1, count);
  let cardW = Math.min(CARD_MAJOR_WIDTH, cols);
  let cardH = Math.min(CARD_MAJOR_HEIGHT, rows);
  const needRow = n * cardW + gap * Math.max(0, n - 1);
  const stacked = needRow > cols;
  if (stacked) {
    const needCol = n * cardH + gap * Math.max(0, n - 1);
    if (needCol > rows) {
      const fit = Math.floor((rows - gap * Math.max(0, n - 1)) / n);
      cardH = Math.max(1, fit);
    }
  }

  const places: BoardPlace[] = [];
  if (stacked) {
    const totalH = n * cardH + gap * Math.max(0, n - 1);
    const startC = Math.max(1, Math.floor((cols - cardW) / 2) + 1);
    const startR = Math.max(1, Math.floor((rows - totalH) / 2) + 1);
    for (let i = 0; i < n; i += 1) {
      places.push({
        column: startC,
        row: startR + i * (cardH + gap),
        width: cardW,
        height: cardH,
      });
    }
  } else {
    const totalW = n * cardW + gap * Math.max(0, n - 1);
    const startC = Math.max(1, Math.floor((cols - totalW) / 2) + 1);
    const startR = Math.max(1, Math.floor((rows - cardH) / 2) + 1);
    for (let i = 0; i < n; i += 1) {
      places.push({
        column: startC + i * (cardW + gap),
        row: startR,
        width: cardW,
        height: cardH,
      });
    }
  }
  return places;
}

export function layoutBoard(shell: HTMLElement, main: HTMLElement, count: number): BoardLayout {
  const base = measureBoard(shell, main);
  return { ...base, places: placeCards(base.cols, base.rows, count) };
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
  const major = parseFloat(getComputedStyle(card).getPropertyValue("--board-major")) || 128;
  const push = major;
  card.style.setProperty("--squeeze-x", `${dx * push}px`);
  card.style.setProperty("--squeeze-y", `${dy * push}px`);
  card.style.setProperty("--squeeze-s", "0.9");
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
