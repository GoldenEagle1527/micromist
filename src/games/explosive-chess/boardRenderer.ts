/**
 * 爆炸棋 — canvas board renderer (adapted for micromist MD3 CSS vars)
 */

import {
  COLOR_BLUE,
  COLOR_RED,
  type GameInstance,
  type PlayerColor,
} from "./engine";

export type BoardRenderer = {
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
};

type ThemeColors = {
  background: string;
  gridLine: string;
  cellLight: string;
  cellDark: string;
  empty: string;
  red: string;
  blue: string;
  dotShadow: string;
  hoverValid: string;
  hoverInvalid: string;
  redCellBg: string;
  blueCellBg: string;
  lastMove: string;
  explosion: string;
};

const LIGHT_COLORS: ThemeColors = {
  background: "#f5f0e8",
  gridLine: "rgba(0, 0, 0, 0.06)",
  cellLight: "#faf7f2",
  cellDark: "#e8e0d4",
  empty: "#d4cec4",
  red: "#e53935",
  blue: "#1e88e5",
  dotShadow: "rgba(0, 0, 0, 0.25)",
  hoverValid: "rgba(76, 175, 80, 0.25)",
  hoverInvalid: "rgba(244, 67, 54, 0.15)",
  redCellBg: "rgba(229, 57, 53, 0.15)",
  blueCellBg: "rgba(30, 136, 229, 0.15)",
  lastMove: "rgba(255, 165, 0, 0.8)",
  explosion: "rgba(255, 193, 7, 0.45)",
};

const DARK_COLORS: ThemeColors = {
  background: "#1a1a1e",
  gridLine: "rgba(255, 255, 255, 0.06)",
  cellLight: "#2a2a30",
  cellDark: "#222228",
  empty: "#3a3a42",
  red: "#ef5350",
  blue: "#42a5f5",
  dotShadow: "rgba(0, 0, 0, 0.5)",
  hoverValid: "rgba(76, 175, 80, 0.2)",
  hoverInvalid: "rgba(244, 67, 54, 0.15)",
  redCellBg: "rgba(239, 83, 80, 0.2)",
  blueCellBg: "rgba(66, 165, 245, 0.2)",
  lastMove: "rgba(255, 215, 0, 0.8)",
  explosion: "rgba(255, 213, 79, 0.4)",
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

export function createBoardRenderer(
  canvas: HTMLCanvasElement,
  game: GameInstance,
): BoardRenderer {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    throw new Error("2d context unavailable");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const boardSize = game.boardSize;
  let cellSize = 32;
  let canvasSize = 0;
  const padding = 2;
  let hoverCell: { row: number; col: number } | null = null;
  let lastMoveCell: { row: number; col: number } | null = null;
  let explosionHighlight: Set<number> | null = null;
  let cachedIsDark: boolean | null = null;

  function isDark(): boolean {
    if (cachedIsDark === null) {
      cachedIsDark = detectDarkTheme();
    }
    return cachedIsDark;
  }

  function getColors(): ThemeColors {
    return isDark() ? DARK_COLORS : LIGHT_COLORS;
  }

  function resize(): void {
    cachedIsDark = detectDarkTheme();
    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const availableWidth = wrapperRect.width - padding * 2;
    const availableHeight = wrapperRect.height - padding * 2;
    const available = Math.min(availableWidth, availableHeight);
    cellSize = Math.max(Math.floor(available / boardSize), 1);
    canvasSize = cellSize * boardSize;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render(): void {
    const colors = getColors();
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        drawCell(r, c, colors);
      }
    }

    drawGridLines(colors);

    if (hoverCell) {
      drawHoverHighlight(hoverCell.row, hoverCell.col, colors);
    }
  }

  function drawCell(row: number, col: number, colors: ThemeColors): void {
    const x = col * cellSize;
    const y = row * cellSize;
    const idx = game.cellIndex(row, col);
    const count = game.counts[idx]!;
    const color = game.colors[idx]!;

    const isLightCell = (row + col) % 2 === 0;
    ctx.fillStyle = isLightCell ? colors.cellLight : colors.cellDark;
    ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);

    if (color === COLOR_RED) {
      ctx.fillStyle = colors.redCellBg;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    } else if (color === COLOR_BLUE) {
      ctx.fillStyle = colors.blueCellBg;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }

    if (explosionHighlight?.has(idx)) {
      ctx.fillStyle = colors.explosion;
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }

    if (lastMoveCell && lastMoveCell.row === row && lastMoveCell.col === col) {
      ctx.strokeStyle = colors.lastMove;
      ctx.lineWidth = 2.5;
      const inset = 2;
      roundRect(ctx, x + inset, y + inset, cellSize - inset * 2, cellSize - inset * 2, 3);
      ctx.stroke();
    }

    if (count > 0) {
      drawDots(x, y, count, color as PlayerColor | 0, colors);
    }
  }

  function drawDots(
    x: number,
    y: number,
    count: number,
    playerColor: number,
    colors: ThemeColors,
  ): void {
    const dotColor =
      playerColor === COLOR_RED ? colors.red : playerColor === COLOR_BLUE ? colors.blue : colors.empty;
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

  function drawGridLines(colors: ThemeColors): void {
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= boardSize; i++) {
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
    const isValid = game.isValidMove(row, col, game.currentTurn);
    ctx.fillStyle = isValid ? colors.hoverValid : colors.hoverInvalid;
    ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
  }

  function pixelToCell(px: number, py: number): { row: number; col: number } | null {
    const rect = canvas.getBoundingClientRect();
    const x = px - rect.left;
    const y = py - rect.top;
    const col = Math.floor(x / (rect.width / boardSize));
    const row = Math.floor(y / (rect.height / boardSize));
    if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return null;
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

  function destroy(): void {
    lastMoveCell = null;
    hoverCell = null;
    explosionHighlight = null;
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
  };
}
