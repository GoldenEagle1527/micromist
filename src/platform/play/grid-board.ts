/**
 * The one play board: a square CSS grid.
 * Platform owns chrome (checkerboard, lines, hover, pan).
 * Games inject CSS for `.grid-cell` and set `className` per cell.
 *
 * Custom properties on the board host (light/dark):
 * --grid-bg --grid-line --grid-cell-light --grid-cell-dark
 * --grid-tint-red --grid-tint-blue --grid-emphasis
 * --grid-ring-last --grid-ring-hint
 * --grid-hover-valid --grid-hover-invalid
 * --grid-piece-red --grid-piece-blue --grid-piece-black --grid-piece-white
 * --grid-piece-neutral --grid-piece-shadow --grid-piece-white-edge
 * --grid-n --grid-cell-size --grid-mark-scale
 */

import shadowCss from "./grid-board-shadow.css?raw";

export type GridCellPaint = {
  className?: string;
};

export type GridBoardSource = {
  size: number;
  /** Injected into the board shadow tree. Selectors see `.grid-cell`. */
  css?: string;
  paintCell: (row: number, col: number) => GridCellPaint;
  isHoverValid?: (row: number, col: number) => boolean;
};

export type GridBoard = {
  resize: () => void;
  render: () => void;
  pixelToCell: (px: number, py: number) => { row: number; col: number } | null;
  setHoverCell: (row: number | null, col: number | null) => void;
  clearHover: () => void;
  revealCell: (row: number, col: number) => void;
  destroy: () => void;
  readonly surface: HTMLElement;
  readonly cellSize: number;
  readonly hover: { row: number; col: number } | null;
  /** Mobile UA: starts zoomed to a usable cell size; pinch and pan to see the rest. */
  readonly panEnabled: boolean;
};

type ThemeColors = {
  background: string;
  gridLine: string;
  cellLight: string;
  cellDark: string;
  empty: string;
  red: string;
  blue: string;
  black: string;
  white: string;
  whiteEdge: string;
  dotShadow: string;
  hoverValid: string;
  hoverInvalid: string;
  redCellBg: string;
  blueCellBg: string;
  lastMove: string;
  explosion: string;
  path: string;
};

const LIGHT_COLORS: ThemeColors = {
  background: "#f5f0e8",
  gridLine: "rgba(0, 0, 0, 0.06)",
  cellLight: "#faf7f2",
  cellDark: "#e8e0d4",
  empty: "#d4cec4",
  red: "#e53935",
  blue: "#1e88e5",
  black: "#1a1a1a",
  white: "#efe8d8",
  whiteEdge: "rgba(60, 40, 10, 0.28)",
  dotShadow: "rgba(0, 0, 0, 0.25)",
  hoverValid: "rgba(76, 175, 80, 0.25)",
  hoverInvalid: "rgba(244, 67, 54, 0.15)",
  redCellBg: "rgba(229, 57, 53, 0.15)",
  blueCellBg: "rgba(30, 136, 229, 0.15)",
  lastMove: "rgba(255, 165, 0, 0.8)",
  explosion: "rgba(255, 193, 7, 0.45)",
  path: "rgba(46, 125, 50, 0.95)",
};

const DARK_COLORS: ThemeColors = {
  background: "#1a1a1e",
  gridLine: "rgba(255, 255, 255, 0.06)",
  cellLight: "#2a2a30",
  cellDark: "#222228",
  empty: "#3a3a42",
  red: "#ef5350",
  blue: "#42a5f5",
  black: "#0e0e10",
  white: "#efe8d8",
  whiteEdge: "rgba(255, 255, 255, 0.22)",
  dotShadow: "rgba(0, 0, 0, 0.5)",
  hoverValid: "rgba(76, 175, 80, 0.2)",
  hoverInvalid: "rgba(244, 67, 54, 0.15)",
  redCellBg: "rgba(239, 83, 80, 0.2)",
  blueCellBg: "rgba(66, 165, 245, 0.2)",
  lastMove: "rgba(255, 215, 0, 0.8)",
  explosion: "rgba(255, 213, 79, 0.4)",
  path: "rgba(129, 199, 132, 0.95)",
};


function detectDarkTheme(): boolean {
  const html = document.documentElement;
  const dataTheme = html.getAttribute("data-theme");
  if (dataTheme === "dark") return true;
  if (dataTheme === "light") return false;

  const surface = getComputedStyle(html).getPropertyValue("--md-sys-color-surface").trim();
  if (!surface) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  const temp = document.createElement("div");
  temp.style.color = surface;
  document.body.appendChild(temp);
  const computed = getComputedStyle(temp).color;
  document.body.removeChild(temp);
  const match = computed.match(/\d+/g);
  if (match) {
    const r = Number(match[0]);
    const g = Number(match[1]);
    const b = Number(match[2]);
    return r * 0.299 + g * 0.587 + b * 0.114 < 128;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPod|Windows Phone|webOS|BlackBerry/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return true;
  return false;
}

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMid(a: Touch, b: Touch): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function extraClasses(raw: string | undefined): string {
  if (!raw) return "";
  return raw.split(/\s+/).filter(Boolean).join(" ");
}

function applyThemeVars(el: HTMLElement, colors: ThemeColors): void {
  el.style.setProperty("--grid-bg", colors.background);
  el.style.setProperty("--grid-line", colors.gridLine);
  el.style.setProperty("--grid-cell-light", colors.cellLight);
  el.style.setProperty("--grid-cell-dark", colors.cellDark);
  el.style.setProperty("--grid-tint-red", colors.redCellBg);
  el.style.setProperty("--grid-tint-blue", colors.blueCellBg);
  el.style.setProperty("--grid-emphasis", colors.explosion);
  el.style.setProperty("--grid-ring-last", colors.lastMove);
  el.style.setProperty("--grid-ring-hint", colors.path);
  el.style.setProperty("--grid-hover-valid", colors.hoverValid);
  el.style.setProperty("--grid-hover-invalid", colors.hoverInvalid);
  el.style.setProperty("--grid-piece-red", colors.red);
  el.style.setProperty("--grid-piece-blue", colors.blue);
  el.style.setProperty("--grid-piece-black", colors.black);
  el.style.setProperty("--grid-piece-white", colors.white);
  el.style.setProperty("--grid-piece-neutral", colors.empty);
  el.style.setProperty("--grid-piece-shadow", colors.dotShadow);
  el.style.setProperty("--grid-piece-white-edge", colors.whiteEdge);
}

export function createGridBoard(mount: HTMLElement, source: GridBoardSource): GridBoard {
  const viewport = document.createElement("div");
  viewport.className = "grid-board-viewport";
  const surface = document.createElement("div");
  surface.className = "grid-board";
  viewport.append(surface);
  mount.append(viewport);

  const shadow = surface.attachShadow({ mode: "open" });
  const platformStyle = document.createElement("style");
  platformStyle.textContent = shadowCss;
  const gameStyle = document.createElement("style");
  gameStyle.textContent = source.css ?? "";
  const cells = document.createElement("div");
  cells.className = "grid-board-cells";
  shadow.append(platformStyle, gameStyle, cells);

  const host = viewport.parentElement;
  const panEnabled = isMobileUA();

  let cellSize = 32;
  let boardPx = 0;
  const padding = 2;
  let hoverCell: { row: number; col: number } | null = null;
  let cachedIsDark: boolean | null = null;
  let destroyed = false;
  let viewScale = 1;
  let viewTx = 0;
  let viewTy = 0;
  const MIN_CELL_PX = 48;
  let ignoreClickUntil = 0;
  let dragging = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let gestureMoved = false;
  const TAP_SLOP = 12;
  let lastFitKey = "";
  let panAnimId = 0;
  let slots: HTMLElement[] = [];

  function boardSize(): number {
    return Math.max(1, source.size);
  }

  function isDark(): boolean {
    if (cachedIsDark === null) {
      cachedIsDark = detectDarkTheme();
    }
    return cachedIsDark;
  }

  function scaleForCell(px: number): number {
    if (boardPx <= 0) return 1;
    return (px * boardSize()) / boardPx;
  }

  function maxViewScale(): number {
    return Math.min(8, Math.max(3, scaleForCell(MIN_CELL_PX)));
  }

  function defaultViewScale(): number {
    if (!panEnabled) return 1;
    return Math.min(maxViewScale(), Math.max(1, scaleForCell(MIN_CELL_PX)));
  }

  function markStrokeScale(): number {
    if (!panEnabled) return 1;
    return Math.max(cellSize, 1) / MIN_CELL_PX;
  }

  function centerView(): void {
    const rect = viewport.getBoundingClientRect();
    const scaled = boardPx * viewScale;
    viewTx = (rect.width - scaled) / 2;
    viewTy = (rect.height - scaled) / 2;
  }

  function clampAxis(offset: number, scaled: number, span: number): number {
    if (scaled <= span + 0.5) return (span - scaled) / 2;
    const min = span - scaled;
    return Math.min(0, Math.max(min, offset));
  }

  function clampView(): void {
    const rect = viewport.getBoundingClientRect();
    const scaled = boardPx * viewScale;
    viewTx = clampAxis(viewTx, scaled, rect.width);
    viewTy = clampAxis(viewTy, scaled, rect.height);
  }

  function applyView(): void {
    if (!panEnabled) {
      surface.style.transform = "";
      return;
    }
    surface.style.transformOrigin = "0 0";
    surface.style.transform = `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`;
  }

  function applyLayoutVars(): void {
    surface.style.setProperty("--grid-n", String(boardSize()));
    surface.style.setProperty("--grid-cell-size", `${cellSize}px`);
    surface.style.setProperty("--grid-mark-scale", String(markStrokeScale()));
  }

  function applyTheme(): void {
    applyThemeVars(surface, isDark() ? DARK_COLORS : LIGHT_COLORS);
  }

  function cancelPanAnim(): void {
    if (!panAnimId) return;
    cancelAnimationFrame(panAnimId);
    panAnimId = 0;
  }

  function easeOutCubic(t: number): number {
    return 1 - (1 - t) ** 3;
  }

  function animatePan(toTx: number, toTy: number): void {
    cancelPanAnim();
    const fromTx = viewTx;
    const fromTy = viewTy;
    const dist = Math.hypot(toTx - fromTx, toTy - fromTy);
    if (dist < 0.5) return;
    const duration = Math.min(420, Math.max(240, dist * 0.55));
    const started = performance.now();
    function tick(now: number): void {
      if (destroyed) {
        panAnimId = 0;
        return;
      }
      const t = Math.min(1, (now - started) / duration);
      const e = easeOutCubic(t);
      viewTx = fromTx + (toTx - fromTx) * e;
      viewTy = fromTy + (toTy - fromTy) * e;
      applyView();
      if (t < 1) {
        panAnimId = requestAnimationFrame(tick);
        return;
      }
      panAnimId = 0;
    }
    panAnimId = requestAnimationFrame(tick);
  }

  function revealCell(row: number, col: number): void {
    if (!panEnabled || destroyed || viewScale <= 1.001) return;
    if (pinchStartDist > 0 || (dragging && gestureMoved)) return;
    const rect = viewport.getBoundingClientRect();
    const scaled = boardPx * viewScale;
    if (scaled <= rect.width + 0.5 && scaled <= rect.height + 0.5) return;
    const span = cellSize * viewScale;
    const inset = Math.max(
      8,
      Math.min(span * 0.35, 28, rect.width * 0.1, rect.height * 0.1),
    );
    const x0 = col * cellSize * viewScale + viewTx;
    const y0 = row * cellSize * viewScale + viewTy;
    let dx = 0;
    let dy = 0;
    if (span + inset * 2 >= rect.width) {
      dx = (rect.width - span) / 2 - x0;
    } else if (x0 < inset) {
      dx = inset - x0;
    } else if (x0 + span > rect.width - inset) {
      dx = rect.width - inset - (x0 + span);
    }
    if (span + inset * 2 >= rect.height) {
      dy = (rect.height - span) / 2 - y0;
    } else if (y0 < inset) {
      dy = inset - y0;
    } else if (y0 + span > rect.height - inset) {
      dy = rect.height - inset - (y0 + span);
    }
    const toTx = clampAxis(viewTx + dx, scaled, rect.width);
    const toTy = clampAxis(viewTy + dy, scaled, rect.height);
    animatePan(toTx, toTy);
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number): void {
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const clamped = Math.min(maxViewScale(), Math.max(1, nextScale));
    const localX = (px - viewTx) / viewScale;
    const localY = (py - viewTy) / viewScale;
    viewScale = clamped;
    viewTx = px - localX * viewScale;
    viewTy = py - localY * viewScale;
    clampView();
    applyView();
  }

  function rebuildCells(n: number): void {
    cells.replaceChildren();
    slots = [];
    for (let i = 0; i < n * n; i++) {
      const root = document.createElement("div");
      const hover = document.createElement("div");
      hover.className = "grid-cell-hover";
      root.append(hover);
      cells.append(root);
      slots.push(root);
    }
  }

  function render(): void {
    if (destroyed) return;
    const n = boardSize();
    if (slots.length !== n * n) rebuildCells(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const slot = slots[r * n + c];
        if (!slot) continue;
        const paint = source.paintCell(r, c);
        const hovering = Boolean(hoverCell && hoverCell.row === r && hoverCell.col === c);
        const valid = hovering ? (source.isHoverValid ? source.isHoverValid(r, c) : true) : null;
        slot.className = [
          "grid-cell",
          (r + c) % 2 === 1 ? "is-dark" : "is-light",
          hovering ? (valid ? "is-hover-valid" : "is-hover-invalid") : "",
          extraClasses(paint.className),
        ]
          .filter(Boolean)
          .join(" ");
      }
    }
  }

  function resize(): void {
    if (destroyed) return;
    cachedIsDark = detectDarkTheme();
    applyTheme();
    const wrapperRect = viewport.getBoundingClientRect();
    const availableWidth = wrapperRect.width - padding * 2;
    const availableHeight = wrapperRect.height - padding * 2;
    if (availableWidth < 2 || availableHeight < 2) return;
    const available = Math.min(availableWidth, availableHeight);
    const n = boardSize();
    const fitKey = `${n}:${Math.round(available)}`;
    if (fitKey === lastFitKey && boardPx > 0) {
      applyLayoutVars();
      render();
      return;
    }
    const firstFit = lastFitKey === "";
    const nChanged = lastFitKey !== "" && !lastFitKey.startsWith(`${n}:`);
    lastFitKey = fitKey;
    cellSize = Math.max(Math.floor(available / n), 1);
    boardPx = cellSize * n;
    surface.style.width = `${boardPx}px`;
    surface.style.height = `${boardPx}px`;
    applyLayoutVars();

    if (panEnabled && (firstFit || nChanged)) {
      cancelPanAnim();
      viewScale = defaultViewScale();
      centerView();
    }
    clampView();
    applyView();
    render();
  }

  function pixelToCell(px: number, py: number): { row: number; col: number } | null {
    const n = boardSize();
    const rect = surface.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const col = Math.floor((px - rect.left) / (rect.width / n));
    const row = Math.floor((py - rect.top) / (rect.height / n));
    if (row < 0 || row >= n || col < 0 || col >= n) return null;
    return { row, col };
  }

  function setHoverCell(row: number | null, col: number | null): void {
    if (row === null || col === null) {
      if (hoverCell) {
        hoverCell = null;
        render();
      }
      return;
    }
    if (hoverCell && hoverCell.row === row && hoverCell.col === col) return;
    hoverCell = { row, col };
    render();
  }

  function clearHover(): void {
    if (hoverCell) {
      hoverCell = null;
      render();
    }
  }

  const onWindowResize = () => resize();
  window.addEventListener("resize", onWindowResize);
  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", onWindowResize);
  const themeObserver = new MutationObserver(() => {
    cachedIsDark = detectDarkTheme();
    applyTheme();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const ro = new ResizeObserver(() => resize());
  ro.observe(viewport);

  if (panEnabled) {
    viewport.classList.add("is-pan");
    host?.classList.add("is-pan");
  }

  function onTouchStart(event: TouchEvent): void {
    if (!panEnabled || destroyed) return;
    cancelPanAnim();
    gestureMoved = false;
    if (event.touches.length >= 2) {
      pinchStartDist = touchDist(event.touches[0]!, event.touches[1]!);
      pinchStartScale = viewScale;
      dragging = false;
      event.preventDefault();
      return;
    }
    if (event.touches.length === 1) {
      pinchStartDist = 0;
      dragging = true;
      lastTouchX = event.touches[0]!.clientX;
      lastTouchY = event.touches[0]!.clientY;
    }
  }

  function onTouchMove(event: TouchEvent): void {
    if (!panEnabled || destroyed) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      gestureMoved = true;
      ignoreClickUntil = performance.now() + 400;
      const a = event.touches[0]!;
      const b = event.touches[1]!;
      if (pinchStartDist > 0) {
        const mid = touchMid(a, b);
        zoomAt(mid.x, mid.y, pinchStartScale * (touchDist(a, b) / pinchStartDist));
      }
      dragging = false;
      return;
    }
    if (!dragging || event.touches.length !== 1) return;
    const x = event.touches[0]!.clientX;
    const y = event.touches[0]!.clientY;
    const dx = x - lastTouchX;
    const dy = y - lastTouchY;
    if (viewScale <= 1.001) return;
    if (!gestureMoved && Math.hypot(dx, dy) < TAP_SLOP) return;
    event.preventDefault();
    gestureMoved = true;
    ignoreClickUntil = performance.now() + 400;
    lastTouchX = x;
    lastTouchY = y;
    viewTx += dx;
    viewTy += dy;
    clampView();
    applyView();
  }

  function onTouchEnd(event: TouchEvent): void {
    if (!panEnabled || destroyed) return;
    if (event.touches.length >= 2) {
      pinchStartDist = touchDist(event.touches[0]!, event.touches[1]!);
      pinchStartScale = viewScale;
      dragging = false;
      return;
    }
    if (event.touches.length === 1) {
      pinchStartDist = 0;
      dragging = true;
      lastTouchX = event.touches[0]!.clientX;
      lastTouchY = event.touches[0]!.clientY;
      return;
    }
    dragging = false;
    pinchStartDist = 0;
    applyView();
  }

  function onClickCapture(event: Event): void {
    if (performance.now() >= ignoreClickUntil) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  const touchOpts: AddEventListenerOptions = { passive: false };
  viewport.addEventListener("touchstart", onTouchStart, touchOpts);
  viewport.addEventListener("touchmove", onTouchMove, touchOpts);
  viewport.addEventListener("touchend", onTouchEnd);
  viewport.addEventListener("touchcancel", onTouchEnd);
  surface.addEventListener("click", onClickCapture, true);

  applyTheme();
  requestAnimationFrame(() => resize());

  function destroy(): void {
    destroyed = true;
    cancelPanAnim();
    hoverCell = null;
    slots = [];
    window.removeEventListener("resize", onWindowResize);
    visualViewport?.removeEventListener("resize", onWindowResize);
    themeObserver.disconnect();
    ro.disconnect();
    viewport.removeEventListener("touchstart", onTouchStart);
    viewport.removeEventListener("touchmove", onTouchMove);
    viewport.removeEventListener("touchend", onTouchEnd);
    viewport.removeEventListener("touchcancel", onTouchEnd);
    surface.removeEventListener("click", onClickCapture, true);
    viewport.classList.remove("is-pan");
    host?.classList.remove("is-pan");
    viewport.remove();
  }

  return {
    resize,
    render,
    pixelToCell,
    setHoverCell,
    clearHover,
    revealCell,
    destroy,
    surface,
    get cellSize() {
      return cellSize;
    },
    get hover() {
      return hoverCell;
    },
    get panEnabled() {
      return panEnabled;
    },
  };
}
