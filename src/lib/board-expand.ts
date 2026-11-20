export const LIFT_MS = 620;
export const GROW_MS = 820;
export const SETTLE_MS = 480;
export const LIFT_ROWS = 2;

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

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
export const START_MAJOR_WIDTH = 2;
export const START_MAJOR_HEIGHT = 1;

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

export type PlayPieceSize = {
  width: number;
  height: number;
  gapBefore?: number;
};

export function placePlayPieces(
  cols: number,
  pieces: PlayPieceSize[],
  originColumn = 1,
  originRow = 1,
): BoardPlace[] {
  const places: BoardPlace[] = [];
  if (cols < 1) return places;
  let column = originColumn;
  let row = originRow;
  let rowHeight = 0;
  for (const piece of pieces) {
    const width = Math.max(1, Math.min(piece.width, cols));
    const height = Math.max(1, piece.height);
    const gap = Math.max(0, piece.gapBefore ?? 0);
    if (gap > 0) {
      if (rowHeight > 0) {
        row += rowHeight + gap;
        column = originColumn;
        rowHeight = 0;
      } else if (row > originRow) {
        row += gap;
      }
    }
    if (column > originColumn && column + width - 1 > originColumn + cols - 1) {
      column = originColumn;
      row += rowHeight;
      rowHeight = 0;
    }
    places.push({ column, row, width, height });
    column += width;
    rowHeight = Math.max(rowHeight, height);
    if (column > originColumn + cols - 1) {
      column = originColumn;
      row += rowHeight;
      rowHeight = 0;
    }
  }
  return places;
}

export function extentRows(places: BoardPlace[], originRow = 1): number {
  let maxRow = originRow;
  for (const place of places) {
    maxRow = Math.max(maxRow, place.row + place.height - 1);
  }
  return Math.max(1, maxRow - originRow + 1);
}

export function isSideCell(column: number, row: number, seed: BoardPlace): boolean {
  const beside = column < seed.column || column >= seed.column + seed.width;
  const inLiftBand = row <= seed.row + seed.height - 1;
  return beside && inLiftBand;
}

export function growStaggerMs(column: number, row: number, bornFromRow: number): number {
  return Math.max(0, row - bornFromRow) * 70 + Math.max(0, column - 1) * 28;
}
