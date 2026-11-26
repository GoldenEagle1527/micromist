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

export type BoardMarks = {
  lastMove: { row: number; col: number } | null;
  flash: Set<number> | null;
};

function seatClass(color: number): string {
  if (color === COLOR_RED) return "seat-red";
  if (color === COLOR_BLUE) return "seat-blue";
  return "";
}

export function createBoardRenderer(
  mount: HTMLElement,
  game: GameInstance,
  marks: BoardMarks,
): GridBoard {
  return createGridBoard(mount, {
    css: boardCss,
    get size() {
      return game.boardSize;
    },
    paintCell(row, col): GridCellPaint {
      const idx = game.cellIndex(row, col);
      const count = game.counts[idx] ?? 0;
      const color = game.colors[idx] ?? 0;
      const last = marks.lastMove;
      const classes = [seatClass(color)];
      if (count > 0) classes.push(`dots-${Math.min(count, 4)}`);
      if (marks.flash?.has(idx)) classes.push("emphasis");
      if (last && last.row === row && last.col === col) classes.push("last");
      return { className: classes.filter(Boolean).join(" ") };
    },
    isHoverValid(row, col) {
      return game.isValidMove(row, col, game.currentTurn);
    },
  });
}
