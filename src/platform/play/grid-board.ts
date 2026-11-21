/**
 * The one play board: explosive-chess checkerboard on canvas.
 * Games only change what sits in each cell (dots, tint, a stone, a fill).
 */

export type CellAccent = "none" | "red" | "blue";
export type DotColor = "red" | "blue" | "neutral";
export type StoneColor = "black" | "white";

export type GridCellPaint = {
  accent?: CellAccent;
  fill?: string | null;
  dots?: { count: number; color: DotColor };
  stone?: StoneColor | null;
  path?: boolean;
};

export type GridBoardSource = {
  size: number;
  paintCell: (row: number, col: number) => GridCellPaint;
  isHoverValid?: (row: number, col: number) => boolean;
};

export type GridBoard = {
  resize: () => void;
  render: () => void;
  pixelToCell: (px: number, py: number) => { row: number; col: number } | null;
  setHoverCell: (row: number | null, col: number | null) => void;
  clearHover: () => void;
  setLastMove: (row: number | null, col: number | null) => void;
  clearLastMove: () => void;
  setExplosionHighlight: (cells: number[] | null) => void;
  destroy: () => void;
  readonly cellSize: number;
  readonly hover: { row: number; col: number } | null;
  /** Mobile UA: board fills the host, but can be pinched and panned. */
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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

function ensureViewport(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement;
  if (parent?.classList.contains("grid-board-viewport")) return parent;
  const viewport = document.createElement("div");
  viewport.className = "grid-board-viewport";
  if (parent) parent.replaceChild(viewport, canvas);
  viewport.append(canvas);
  return viewport;
}

function getDotPositions(
  count: number,
  cx: number,
  cy: number,
  spread: number,
): { x: number; y: number }[] {
  switch (count) {
    case 1:
      return [{ x: cx, y: cy }];
    case 2:
      return [
        { x: cx - spread, y: cy + spread },
        { x: cx + spread, y: cy - spread },
      ];
    case 3:
      return [
        { x: cx, y: cy - spread },
        { x: cx - spread, y: cy + spread * 0.7 },
        { x: cx + spread, y: cy + spread * 0.7 },
      ];
    default:
      return [
        { x: cx - spread, y: cy - spread },
        { x: cx + spread, y: cy - spread },
        { x: cx - spread, y: cy + spread },
        { x: cx + spread, y: cy + spread },
      ];
  }
}

export function createGridBoard(
  canvas: HTMLCanvasElement,
  source: GridBoardSource,
): GridBoard {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    throw new Error("2d context unavailable");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const viewport = ensureViewport(canvas);
  const host = viewport.parentElement;
  const panEnabled = isMobileUA();

  let cellSize = 32;
  let canvasSize = 0;
  const padding = 2;
  let hoverCell: { row: number; col: number } | null = null;
  let lastMoveCell: { row: number; col: number } | null = null;
  let explosionHighlight: Set<number> | null = null;
  let cachedIsDark: boolean | null = null;
  let destroyed = false;
  let viewScale = 1;
  let viewTx = 0;
  let viewTy = 0;
  let ignoreClickUntil = 0;
  let dragging = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let gestureMoved = false;
  const TAP_SLOP = 12;
  let lastFitKey = "";

  function boardSize(): number {
    return Math.max(1, source.size);
  }

  function isDark(): boolean {
    if (cachedIsDark === null) {
      cachedIsDark = detectDarkTheme();
    }
    return cachedIsDark;
  }

  function getColors(): ThemeColors {
    return isDark() ? DARK_COLORS : LIGHT_COLORS;
  }

  function maxViewScale(): number {
    const n = boardSize();
    const minCell = 48;
    const needed = canvasSize > 0 ? (minCell * n) / canvasSize : 3;
    return Math.min(8, Math.max(3, needed));
  }

  function clampAxis(offset: number, scaled: number, span: number): number {
    if (scaled <= span + 0.5) return (span - scaled) / 2;
    const min = span - scaled;
    return Math.min(0, Math.max(min, offset));
  }

  function clampView(): void {
    const rect = viewport.getBoundingClientRect();
    const scaled = canvasSize * viewScale;
    viewTx = clampAxis(viewTx, scaled, rect.width);
    viewTy = clampAxis(viewTy, scaled, rect.height);
  }

  function applyView(): void {
    if (!panEnabled) {
      canvas.style.transform = "";
      return;
    }
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`;
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

  function resize(): void {
    if (destroyed) return;
    cachedIsDark = detectDarkTheme();
    const wrapperRect = viewport.getBoundingClientRect();
    const availableWidth = wrapperRect.width - padding * 2;
    const availableHeight = wrapperRect.height - padding * 2;
    if (availableWidth < 2 || availableHeight < 2) return;
    const available = Math.min(availableWidth, availableHeight);
    const n = boardSize();
    const fitKey = `${n}:${Math.round(available)}`;
    if (fitKey === lastFitKey && canvasSize > 0) {
      render();
      return;
    }
    const nChanged = lastFitKey !== "" && !lastFitKey.startsWith(`${n}:`);
    lastFitKey = fitKey;
    cellSize = Math.max(Math.floor(available / n), 1);
    canvasSize = cellSize * n;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (nChanged) viewScale = 1;
    clampView();
    applyView();
    render();
  }

  function render(): void {
    if (destroyed) return;
    const colors = getColors();
    const n = boardSize();
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        drawCell(r, c, n, colors);
      }
    }

    drawGridLines(n, colors);

    if (hoverCell) {
      drawHoverHighlight(hoverCell.row, hoverCell.col, colors);
    }
  }

  function drawCell(row: number, col: number, n: number, colors: ThemeColors): void {
    const x = col * cellSize;
    const y = row * cellSize;
    const idx = row * n + col;
    const paint = source.paintCell(row, col);
    const isLightCell = (row + col) % 2 === 0;
    ctx.fillStyle = isLightCell ? colors.cellLight : colors.cellDark;
    ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);

    if (paint.accent === "red") {
      ctx.fillStyle = colors.redCellBg;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    } else if (paint.accent === "blue") {
      ctx.fillStyle = colors.blueCellBg;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }

    if (paint.fill) {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = paint.fill;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      ctx.globalAlpha = 1;
    }

    if (explosionHighlight?.has(idx)) {
      ctx.fillStyle = colors.explosion;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }

    const isLast =
      lastMoveCell && lastMoveCell.row === row && lastMoveCell.col === col && !paint.path;
    if (paint.path || isLast) {
      ctx.strokeStyle = paint.path ? colors.path : colors.lastMove;
      ctx.lineWidth = 2.5;
      const inset = 2;
      roundRect(ctx, x + inset, y + inset, cellSize - inset * 2, cellSize - inset * 2, 3);
      ctx.stroke();
    }

    if (paint.dots && paint.dots.count > 0) {
      drawDots(x, y, paint.dots.count, paint.dots.color, colors);
    }

    if (paint.stone) {
      drawStone(x, y, paint.stone, colors);
    }
  }

  function drawDots(
    x: number,
    y: number,
    count: number,
    color: DotColor,
    colors: ThemeColors,
  ): void {
    const dotColor =
      color === "red" ? colors.red : color === "blue" ? colors.blue : colors.empty;
    const centerX = x + cellSize / 2;
    const centerY = y + cellSize / 2;
    const dotRadius = Math.max(cellSize * 0.12, 2);
    const spread = cellSize * 0.25;
    const positions = getDotPositions(count, centerX, centerY, spread);
    const shadowOffset = Math.max(dotRadius * 0.15, 0.5);

    for (const pos of positions) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + shadowOffset, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = colors.dotShadow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pos.x - dotRadius * 0.3, pos.y - dotRadius * 0.3, dotRadius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fill();
    }
  }

  function drawStone(x: number, y: number, stone: StoneColor, colors: ThemeColors): void {
    const cx = x + cellSize / 2;
    const cy = y + cellSize / 2;
    const radius = Math.max(cellSize * 0.22, 3);
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.12, radius, 0, Math.PI * 2);
    ctx.fillStyle = colors.dotShadow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = stone === "black" ? colors.black : colors.white;
    ctx.fill();
    if (stone === "white") {
      ctx.strokeStyle = colors.whiteEdge;
      ctx.lineWidth = Math.max(1, cellSize * 0.03);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx - radius * 0.28, cy - radius * 0.28, radius * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.fill();
  }

  function drawGridLines(n: number, colors: ThemeColors): void {
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const pos = i * cellSize;
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvasSize);
      ctx.moveTo(0, pos);
      ctx.lineTo(canvasSize, pos);
    }
    ctx.stroke();
  }

  function drawHoverHighlight(row: number, col: number, colors: ThemeColors): void {
    const x = col * cellSize;
    const y = row * cellSize;
    const isValid = source.isHoverValid ? source.isHoverValid(row, col) : true;
    ctx.fillStyle = isValid ? colors.hoverValid : colors.hoverInvalid;
    ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
  }

  function pixelToCell(px: number, py: number): { row: number; col: number } | null {
    const n = boardSize();
    const rect = canvas.getBoundingClientRect();
    const x = px - rect.left;
    const y = py - rect.top;
    const col = Math.floor(x / (rect.width / n));
    const row = Math.floor(y / (rect.height / n));
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

  function setLastMove(row: number | null, col: number | null): void {
    lastMoveCell = row !== null && col !== null ? { row, col } : null;
  }

  function clearLastMove(): void {
    lastMoveCell = null;
  }

  function setExplosionHighlight(cells: number[] | null): void {
    explosionHighlight = cells ? new Set(cells) : null;
  }

  const onWindowResize = () => resize();
  window.addEventListener("resize", onWindowResize);
  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", onWindowResize);
  const themeObserver = new MutationObserver(() => resize());
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
  canvas.addEventListener("click", onClickCapture, true);

  requestAnimationFrame(() => resize());

  function destroy(): void {
    destroyed = true;
    lastMoveCell = null;
    hoverCell = null;
    explosionHighlight = null;
    window.removeEventListener("resize", onWindowResize);
    visualViewport?.removeEventListener("resize", onWindowResize);
    themeObserver.disconnect();
    ro.disconnect();
    viewport.removeEventListener("touchstart", onTouchStart);
    viewport.removeEventListener("touchmove", onTouchMove);
    viewport.removeEventListener("touchend", onTouchEnd);
    viewport.removeEventListener("touchcancel", onTouchEnd);
    canvas.removeEventListener("click", onClickCapture, true);
    viewport.classList.remove("is-pan");
    host?.classList.remove("is-pan");
  }

  return {
    resize,
    render,
    pixelToCell,
    setHoverCell,
    clearHover,
    setLastMove,
    clearLastMove,
    setExplosionHighlight,
    destroy,
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
