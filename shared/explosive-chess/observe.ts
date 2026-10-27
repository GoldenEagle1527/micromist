/**
 * Structured observation for explosive-chess agents.
 * Same public information a human client already receives (`fullState` + own seat),
 * plus the legal placements enumerated from that board. No hidden cells.
 */
import {
  COLOR_BLUE,
  COLOR_RED,
  type AnimationFrame,
  type FullState,
  type GameInstance,
  type PlayerColor,
  type Winner,
  type WinMode,
} from "./engine";
import type { Phase, PlayerKind, Role, Seat } from "../multiplayer";

export type CellColorName = "empty" | "red" | "blue";

export type MoveAction = {
  type: "move";
  row: number;
  col: number;
};

export type BoardCell = {
  row: number;
  col: number;
  count: number;
  color: CellColorName;
  capacity: number;
};

export type ExplosivePublicConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: "red" | "blue";
};

/** Shared view. `fullState` matches the human `state` payload. */
export type ExplosivePublicState = {
  config: ExplosivePublicConfig;
  fullState: FullState | null;
  /**
   * Row-major grid. Flat index `row * boardSize + col` matches
   * `fullState.counts` and `fullState.colors`.
   */
  board: BoardCell[][];
  /** Whose placement is next. Null before the match exists. */
  turn: "red" | "blue" | null;
};

export type ExplosiveYou = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role;
  kind: PlayerKind;
  /** Null for spectators. In this game the seat name is the piece color. */
  color: "red" | "blue" | null;
  /** True for the room creator. They may set_config while the room is still a lobby. */
  canConfig?: boolean;
};

export type CellCoord = {
  row: number;
  col: number;
};

/** One cell that burst, and the orthogonal neighbors that received an orb. */
export type ExplosionEffect = {
  exploded: CellCoord;
  spread: CellCoord[];
};

export type ExplosiveObservation = {
  game: "explosive-chess";
  phase: Phase;
  you: ExplosiveYou;
  publicState: ExplosivePublicState;
  /**
   * Placements this seat may play right now.
   * Empty when it is not your turn, the match is not in progress, or you are spectating.
   * Surrender is allowed during play but is not listed here.
   */
  legalActions: MoveAction[];
  /**
   * Explosions from the placement that produced this position.
   * Empty when that placement did not explode, or before any placement.
   * A cell with count 0 and color red or blue was emptied and still belongs to that color.
   */
  effects: ExplosionEffect[];
};

export function colorName(color: number): CellColorName {
  if (color === COLOR_RED) return "red";
  if (color === COLOR_BLUE) return "blue";
  return "empty";
}

export function playerColorValue(color: "red" | "blue"): PlayerColor {
  return color === "red" ? COLOR_RED : COLOR_BLUE;
}

export function winnerColorName(winner: Winner): "red" | "blue" | "draw" | null {
  if (winner === COLOR_RED) return "red";
  if (winner === COLOR_BLUE) return "blue";
  if (winner === "draw") return "draw";
  return null;
}

export function legalMoveActions(
  game: GameInstance | null,
  color: "red" | "blue" | null,
  phase: Phase,
): MoveAction[] {
  if (!game || !color || phase !== "playing" || game.gameOver) return [];
  const playerColor = playerColorValue(color);
  if (game.currentTurn !== playerColor) return [];
  const actions: MoveAction[] = [];
  for (let row = 0; row < game.boardSize; row++) {
    for (let col = 0; col < game.boardSize; col++) {
      if (game.isValidMove(row, col, playerColor)) {
        actions.push({ type: "move", row, col });
      }
    }
  }
  return actions;
}

export function buildPublicState(
  config: ExplosivePublicConfig,
  game: GameInstance | null,
): ExplosivePublicState {
  const publicConfig: ExplosivePublicConfig = {
    boardSize: config.boardSize,
    winMode: config.winMode,
    winParam: config.winParam,
    hostColor: config.hostColor,
  };
  if (!game) {
    return { config: publicConfig, fullState: null, board: [], turn: null };
  }
  const board: BoardCell[][] = [];
  for (let row = 0; row < game.boardSize; row++) {
    const line: BoardCell[] = [];
    for (let col = 0; col < game.boardSize; col++) {
      const cell = game.getCell(row, col);
      line.push({
        row,
        col,
        count: cell.count,
        color: colorName(cell.color),
        capacity: cell.capacity,
      });
    }
    board.push(line);
  }
  return {
    config: publicConfig,
    fullState: game.getFullState(),
    board,
    turn: game.currentTurn === COLOR_RED ? "red" : "blue",
  };
}

function coordFromIndex(index: unknown, boardSize: number): CellCoord | null {
  if (typeof index !== "number" || !Number.isInteger(index) || !Number.isInteger(boardSize) || boardSize <= 0) {
    return null;
  }
  if (index < 0 || index >= boardSize * boardSize) return null;
  return { row: Math.floor(index / boardSize), col: index % boardSize };
}

export function boardSizeFromCounts(counts: unknown): number {
  if (!Array.isArray(counts) || counts.length === 0) return 0;
  const size = Math.round(Math.sqrt(counts.length));
  return size * size === counts.length ? size : 0;
}

/** Row/col view of engine animation frames. Indices outside the board are dropped. */
export function effectsFromAnimationFrames(frames: unknown, boardSize: number): ExplosionEffect[] {
  if (!Array.isArray(frames) || boardSize <= 0) return [];
  const effects: ExplosionEffect[] = [];
  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    const rec = frame as Partial<AnimationFrame>;
    const exploded = coordFromIndex(rec.explodedCell, boardSize);
    if (!exploded) continue;
    const spread: CellCoord[] = [];
    if (Array.isArray(rec.affectedCells)) {
      for (const idx of rec.affectedCells) {
        const cell = coordFromIndex(idx, boardSize);
        if (cell) spread.push(cell);
      }
    }
    effects.push({ exploded, spread });
  }
  return effects;
}

function isCoord(value: unknown): value is CellCoord {
  if (!value || typeof value !== "object") return false;
  const rec = value as { row?: unknown; col?: unknown };
  return (
    typeof rec.row === "number" &&
    typeof rec.col === "number" &&
    Number.isInteger(rec.row) &&
    Number.isInteger(rec.col) &&
    rec.row >= 0 &&
    rec.col >= 0
  );
}

export function readExplosionEffects(value: unknown): ExplosionEffect[] {
  if (!Array.isArray(value)) return [];
  const effects: ExplosionEffect[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { exploded?: unknown; spread?: unknown };
    if (!isCoord(rec.exploded)) continue;
    const spread: CellCoord[] = [];
    if (Array.isArray(rec.spread)) {
      for (const cell of rec.spread) {
        if (isCoord(cell)) spread.push({ row: cell.row, col: cell.col });
      }
    }
    effects.push({ exploded: { row: rec.exploded.row, col: rec.exploded.col }, spread });
  }
  return effects;
}

export function buildExplosiveObservation(input: {
  phase: Phase;
  you: ExplosiveYou;
  config: ExplosivePublicConfig;
  game: GameInstance | null;
  effects?: ExplosionEffect[];
}): ExplosiveObservation {
  return {
    game: "explosive-chess",
    phase: input.phase,
    you: input.you,
    publicState: buildPublicState(input.config, input.game),
    legalActions: legalMoveActions(input.game, input.you.color, input.phase),
    effects: input.effects ?? [],
  };
}
