/**
 * Explosive chess paints on the shared canvas grid board.
 */

import {
  createGridBoard,
  type GridBoard,
  type GridCellPaint,
} from "../../platform/play/grid-board";
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
  readonly panEnabled: boolean;
};

function accentOf(color: number): GridCellPaint["accent"] {
  if (color === COLOR_RED) return "red";
  if (color === COLOR_BLUE) return "blue";
  return "none";
}

function dotColorOf(color: number): "red" | "blue" {
  return color === COLOR_RED ? "red" : "blue";
}

export function createBoardRenderer(
  canvas: HTMLCanvasElement,
  game: GameInstance,
): BoardRenderer {
  const board: GridBoard = createGridBoard(canvas, {
    get size() {
      return game.boardSize;
    },
    paintCell(row, col): GridCellPaint {
      const idx = game.cellIndex(row, col);
      const count = game.counts[idx] ?? 0;
      const color = game.colors[idx] ?? 0;
      return {
        accent: accentOf(color),
        dots:
          count > 0
            ? { count, color: dotColorOf(color as PlayerColor | 0) }
            : undefined,
      };
    },
    isHoverValid(row, col) {
      return game.isValidMove(row, col, game.currentTurn);
    },
  });
  return board;
}
