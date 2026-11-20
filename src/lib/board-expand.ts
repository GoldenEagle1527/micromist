export const SLIDE_MS = 780;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
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
      if (property && event.propertyName !== property) return;
      done();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(done, ms + 80);
  });
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
export const CARD_MAJOR_WIDTH = 3;
export const CARD_MAJOR_HEIGHT = 2;

function cellOf(el: Element, fallback = 32): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue("--board-cell"));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function majorOf(el: Element): number {
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

/** Top-left of the visible board: flush under the topbar, at the shell's left edge. */
export function boardOrigin(shell: HTMLElement, main: HTMLElement): { x: number; y: number } {
  const shellRect = shell.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  return { x: 0, y: mainRect.top - shellRect.top };
}

export function applyBoardOrigin(shell: HTMLElement, main: HTMLElement): { x: number; y: number } {
  const origin = boardOrigin(shell, main);
  shell.style.setProperty("--board-origin-x", `${origin.x}px`);
  shell.style.setProperty("--board-origin-y", `${origin.y}px`);
  return origin;
}

/** Snap a board inside `main` so its edges sit on the visible major grid. */
export function measureBoard(shell: HTMLElement, main: HTMLElement): Omit<BoardLayout, "places"> {
  const major = majorOf(shell);
  const origin = applyBoardOrigin(shell, main);
  const shellRect = shell.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  const relLeft = mainRect.left - shellRect.left;
  const relTop = mainRect.top - shellRect.top;
  const relRight = relLeft + mainRect.width;
  const relBottom = relTop + mainRect.height;
  const startX = origin.x + snapLine(relLeft - origin.x, major, "ceil");
  const startY = origin.y + snapLine(relTop - origin.y, major, "ceil");
  const endX = origin.x + snapLine(relRight - origin.x, major, "floor");
  const endY = origin.y + snapLine(relBottom - origin.y, major, "floor");
  const width = Math.max(major, endX - startX);
  const height = Math.max(major, endY - startY);
  return {
    left: startX - relLeft,
    top: startY - relTop,
    cols: Math.max(1, Math.round(width / major)),
    rows: Math.max(1, Math.round(height / major)),
  };
}

/** Viewport span used when the floor slides, snapped up to a whole number of major cells. */
export function boardSlideSpan(shell: HTMLElement, main: HTMLElement): number {
  const major = majorOf(shell);
  const width = main.getBoundingClientRect().width;
  return Math.max(major, Math.ceil(width / major) * major);
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

/** Menu-style tiles fill the board like lobby cards. Play puts chrome to the side or top and the board in the remaining cells. */
export function placeShellTiles(
  cols: number,
  rows: number,
  tileCount: number,
  boardIndex = -1,
): BoardPlace[] {
  if (boardIndex < 0 || boardIndex >= tileCount) {
    return placeCards(cols, rows, tileCount);
  }
  const chromeCount = tileCount - 1;
  const gap = 1;
  let cardW = Math.min(CARD_MAJOR_WIDTH, Math.max(1, cols));
  let cardH = Math.min(CARD_MAJOR_HEIGHT, Math.max(1, rows));
  const boardMin = 2;
  const canSide = chromeCount > 0 && cols >= cardW + gap + boardMin;
  const chrome: BoardPlace[] = [];

  if (canSide) {
    const needH = chromeCount * cardH + gap * Math.max(0, chromeCount - 1);
    if (needH > rows) {
      const fit = Math.floor((rows - gap * Math.max(0, chromeCount - 1)) / Math.max(1, chromeCount));
      cardH = Math.max(1, fit);
    }
    for (let i = 0; i < chromeCount; i += 1) {
      chrome.push({
        column: 1,
        row: 1 + i * (cardH + gap),
        width: cardW,
        height: cardH,
      });
    }
    const board: BoardPlace = {
      column: cardW + gap + 1,
      row: 1,
      width: Math.max(1, cols - cardW - gap),
      height: rows,
    };
    return [...chrome.slice(0, boardIndex), board, ...chrome.slice(boardIndex)];
  }

  if (chromeCount === 0) {
    return [{ column: 1, row: 1, width: cols, height: rows }];
  }

  const topRows = Math.min(rows, cardH);
  const packed = placeCards(cols, topRows, chromeCount);
  const usedRows = packed.reduce((max, place) => Math.max(max, place.row + place.height - 1), 0);
  let boardRow = usedRows + gap + 1;
  let boardH = rows - usedRows - gap;
  if (boardH < 1) {
    boardRow = Math.max(1, rows);
    boardH = 1;
  }
  const board: BoardPlace = {
    column: 1,
    row: boardRow,
    width: cols,
    height: boardH,
  };
  return [...packed.slice(0, boardIndex), board, ...packed.slice(boardIndex)];
}

export function layoutBoard(shell: HTMLElement, main: HTMLElement, count: number): BoardLayout {
  const base = measureBoard(shell, main);
  return { ...base, places: placeCards(base.cols, base.rows, count) };
}

export function layoutShellBoard(
  shell: HTMLElement,
  main: HTMLElement,
  tileCount: number,
  boardIndex = -1,
): BoardLayout {
  const base = measureBoard(shell, main);
  return { ...base, places: placeShellTiles(base.cols, base.rows, tileCount, boardIndex) };
}
