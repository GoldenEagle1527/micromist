/**
 * Structured observation for Frontline Tide agents.
 * The board is the same one a human sees. This module does not choose an action.
 */
import { swapWouldMatch } from "./board";
import { frontlineTideConfig, swapsForDay } from "./config";
import { pathRowFor, seaColumn } from "./night";
import type { GameState, Phase as TidePhase, Terrain } from "./types";
import type { Phase, PlayerKind, Role, Seat } from "../multiplayer";
import type { TideAction, TideEffect } from "./actions";

export type TideColorName = "coral" | "kelp" | "foam";

export type TideCell = {
  row: number;
  col: number;
  terrain: Terrain;
  kind: "gem" | "defense" | "empty";
  color: number | null;
  colorName: TideColorName | null;
  tier: number | null;
  hp: number | null;
  maxHp: number | null;
};

export type TidePublicState = {
  day: number;
  hearts: number;
  points: number;
  swapsLeft: number;
  /** In-game phase. Night is resolved on the server before the next your_turn. */
  tidePhase: TidePhase | null;
  frontDir: -1 | 1 | null;
  /** Column the next tide will wash away. 0 is the shore. */
  washColumn: number | null;
  seaColumn: number | null;
  pathRow: number | null;
  bands: Terrain[];
  board: TideCell[][];
  t1Cost: number;
  swapsBudget: number;
};

export type TideYou = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role;
  kind: PlayerKind;
  color: null;
  canConfig?: boolean;
};

export type TideObservation = {
  game: "frontline-tide";
  phase: Phase;
  you: TideYou;
  publicState: TidePublicState;
  legalActions: TideAction[];
  effects: TideEffect[];
  lastOpponentMove: null;
};

const COLOR_NAMES: TideColorName[] = ["coral", "kelp", "foam"];

export function boardGrid(state: GameState): TideCell[][] {
  return state.board.map((row, r) =>
    row.map((cell, c) => ({
      row: r,
      col: c,
      terrain: state.bands[c] ?? "shoal",
      kind: cell.kind,
      color: cell.kind === "gem" ? cell.color : null,
      colorName: cell.kind === "gem" ? (COLOR_NAMES[cell.color] ?? "coral") : null,
      tier: cell.kind === "defense" ? cell.tier : null,
      hp: cell.kind === "defense" ? cell.hp : null,
      maxHp: cell.kind === "defense" ? cell.maxHp : null,
    })),
  );
}

export function legalActionsFor(state: GameState | null, seat: Seat, phase: Phase): TideAction[] {
  if (!state || seat !== "player" || phase !== "playing") return [];
  if (state.phase === "gameover") return [];
  const actions: TideAction[] = [];
  if (state.phase === "day_match") {
    const n = state.board.length;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const neighbors = [
          { row: r, col: c + 1 },
          { row: r + 1, col: c },
        ];
        for (const next of neighbors) {
          if (next.row >= n || next.col >= n) continue;
          if (!swapWouldMatch(state.board, state.bands, { r, c }, { r: next.row, c: next.col })) continue;
          actions.push({ type: "swap", row: r, col: c, row2: next.row, col2: next.col });
        }
      }
    }
    actions.push({ type: "end_phase" });
    return actions;
  }
  if (state.phase === "day_build") {
    if (state.points >= frontlineTideConfig.t1Cost) {
      const n = state.board.length;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (state.board[r]![c]!.kind === "defense") continue;
          actions.push({ type: "place", row: r, col: c });
        }
      }
    }
    actions.push({ type: "end_phase" });
  }
  return actions;
}

export function buildPublicState(state: GameState | null): TidePublicState {
  if (!state) {
    return {
      day: 1,
      hearts: frontlineTideConfig.hearts,
      points: 0,
      swapsLeft: frontlineTideConfig.dailySwaps,
      tidePhase: null,
      frontDir: null,
      washColumn: null,
      seaColumn: null,
      pathRow: null,
      bands: [],
      board: [],
      t1Cost: frontlineTideConfig.t1Cost,
      swapsBudget: frontlineTideConfig.dailySwaps,
    };
  }
  return {
    day: state.day,
    hearts: state.hearts,
    points: state.points,
    swapsLeft: state.swapsLeft,
    tidePhase: state.phase,
    frontDir: state.frontDir,
    washColumn: state.frontCol,
    seaColumn: seaColumn(state.board.length),
    pathRow: pathRowFor(state.board.length),
    bands: state.bands.slice(),
    board: boardGrid(state),
    t1Cost: frontlineTideConfig.t1Cost,
    swapsBudget: swapsForDay(state.day),
  };
}

export function buildTideObservation(input: {
  phase: Phase;
  you: TideYou;
  game: GameState | null;
  effects?: TideEffect[];
}): TideObservation {
  return {
    game: "frontline-tide",
    phase: input.phase,
    you: input.you,
    publicState: buildPublicState(input.game),
    legalActions: legalActionsFor(input.game, input.you.seat, input.phase),
    effects: input.effects ?? [],
    lastOpponentMove: null,
  };
}
