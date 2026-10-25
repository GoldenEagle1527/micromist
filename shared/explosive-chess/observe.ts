/**
 * Structured observation for explosive-chess agents.
 * Same public information a human client already receives (`fullState` + own seat),
 * plus the legal placements enumerated from that board. No hidden cells.
 */
import {
  COLOR_BLUE,
  COLOR_RED,
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

export function buildExplosiveObservation(input: {
  phase: Phase;
  you: ExplosiveYou;
  config: ExplosivePublicConfig;
  game: GameInstance | null;
}): ExplosiveObservation {
  return {
    game: "explosive-chess",
    phase: input.phase,
    you: input.you,
    publicState: buildPublicState(input.config, input.game),
    legalActions: legalMoveActions(input.game, input.you.color, input.phase),
  };
}
