/**
 * Explosive chess paints on the shared grid board.
 */

import {
  createGridBoard,
  type GridBoard,
  type GridCellPaint,
} from "../../platform/play/grid-board";
import { COLOR_BLUE, COLOR_RED, type GameInstance } from "./engine";
import boardCss from "./board-cells.css?raw";

export type BoardRenderer = GridBoard & {
  setLastMove: (row: number | null, col: number | null) => void;
  clearLastMove: () => void;
  setExplosionHighlight: (cells: number[] | null) => void;
};

function seatClass(color: number): string {
  if (color === COLOR_RED) return "seat-red";
  if (color === COLOR_BLUE) return "seat-blue";
  return "";
}

export function createBoardRenderer(mount: HTMLElement, game: GameInstance): BoardRenderer {
  let lastMove: { row: number; col: number } | null = null;
  let flash: Set<number> | null = null;

  const board = createGridBoard(mount, {
    css: boardCss,
    get size() {
      return game.boardSize;
    },
    paintCell(row, col): GridCellPaint {
      const idx = game.cellIndex(row, col);
      const count = game.counts[idx] ?? 0;
      const color = game.colors[idx] ?? 0;
      const classes = [seatClass(color)];
      if (count > 0) classes.push(`dots-${Math.min(count, 4)}`);
      if (flash?.has(idx)) classes.push("emphasis");
      if (lastMove && lastMove.row === row && lastMove.col === col) classes.push("last");
      return { className: classes.filter(Boolean).join(" ") };
    },
    isHoverValid(row, col) {
      return game.isValidMove(row, col, game.currentTurn);
    },
  });

  return Object.assign(board, {
    setLastMove(row: number | null, col: number | null) {
      const next = row !== null && col !== null ? { row, col } : null;
      const changed =
        (lastMove?.row ?? null) !== (next?.row ?? null) ||
        (lastMove?.col ?? null) !== (next?.col ?? null);
      lastMove = next;
      if (changed && next) board.revealCell(next.row, next.col);
    },
    clearLastMove() {
      lastMove = null;
    },
    setExplosionHighlight(cells: number[] | null) {
      flash = cells ? new Set(cells) : null;
    },
  });
}
