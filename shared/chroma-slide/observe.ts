/**
 * Structured observation for chroma-slide agents.
 * Same board a human sees: color ids, the empty cell, and every legal slide.
 * No hidden cells. This module does not choose a move.
 */
import type { Phase, PlayerKind, Role, Seat } from "../multiplayer";
import {
  COLOR_NAMES,
  EMPTY,
  PRESETS,
  indexToRC,
  isLegalClick,
  isWon,
  type ColorName,
  type PresetId,
  type PuzzleState,
} from "./engine";

export type ChromaMove = {
  type: "move";
  row: number;
  col: number;
  index: number;
};

export type ChromaCellName = ColorName | "empty";

export type ChromaCell = {
  row: number;
  col: number;
  /** Color id 0..colorCount-1, or null on the empty cell. */
  color: number | null;
  /** Hue name. `empty` is the hole the tiles slide into. */
  name: ChromaCellName;
  empty: boolean;
};

export type ChromaPublicConfig = {
  preset: PresetId;
  size: number;
  colorCount: number;
  squareSide: number;
  /** Seed that dealt this puzzle. Null before the puzzle exists. */
  seed: number | null;
};

export type ChromaPublicState = {
  config: ChromaPublicConfig;
  /** Row-major grid. Flat index is `row * size + col`. */
  board: ChromaCell[][];
  empty: { row: number; col: number } | null;
  steps: number;
  won: boolean;
  /**
   * `"player"` while the puzzle still accepts a slide.
   * Null in the lobby and after a solve. This is the solver's turn, not a second color.
   */
  turn: "player" | null;
};

export type ChromaYou = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role;
  kind: PlayerKind;
  /** Always null. Tile hues are on `board`, not on the seat. */
  color: null;
  canConfig?: boolean;
};

export type ChromaObservation = {
  game: "chroma-slide";
  phase: Phase;
  you: ChromaYou;
  publicState: ChromaPublicState;
  /**
   * Slides this seat may play right now.
   * Empty when you are spectating, the puzzle is solved, or the room has not started.
   */
  legalActions: ChromaMove[];
  /** Solo puzzle. Always null. There is no opponent placement. */
  lastOpponentMove: null;
};

export function cellName(color: number): ChromaCellName {
  if (color === EMPTY) return "empty";
  return COLOR_NAMES[color] ?? "empty";
}

export function boardGrid(state: PuzzleState): ChromaCell[][] {
  const rows: ChromaCell[][] = [];
  for (let row = 0; row < state.size; row++) {
    const line: ChromaCell[] = [];
    for (let col = 0; col < state.size; col++) {
      const index = row * state.size + col;
      const value = state.board[index] ?? EMPTY;
      const empty = value === EMPTY;
      line.push({
        row,
        col,
        color: empty ? null : value,
        name: cellName(value),
        empty,
      });
    }
    rows.push(line);
  }
  return rows;
}

export function legalMovesFor(state: PuzzleState | null, seat: Seat, phase: Phase): ChromaMove[] {
  if (!state || seat !== "player" || phase !== "playing" || isWon(state)) return [];
  const actions: ChromaMove[] = [];
  for (let index = 0; index < state.board.length; index++) {
    if (!isLegalClick(state, index)) continue;
    const { row, col } = indexToRC(index, state.size);
    actions.push({ type: "move", row, col, index });
  }
  return actions;
}

export function publicConfig(preset: PresetId, seed: number | null): ChromaPublicConfig {
  const spec = PRESETS[preset];
  return {
    preset,
    size: spec.size,
    colorCount: spec.colorCount,
    squareSide: spec.squareSide,
    seed,
  };
}

export function buildPublicState(
  preset: PresetId,
  seed: number | null,
  puzzle: PuzzleState | null,
  phase: Phase,
): ChromaPublicState {
  if (!puzzle) {
    return {
      config: publicConfig(preset, seed),
      board: [],
      empty: null,
      steps: 0,
      won: false,
      turn: null,
    };
  }
  const empty = indexToRC(puzzle.emptyIndex, puzzle.size);
  const won = isWon(puzzle);
  return {
    config: publicConfig(puzzle.preset, seed),
    board: boardGrid(puzzle),
    empty,
    steps: puzzle.steps,
    won,
    turn: phase === "playing" && !won ? "player" : null,
  };
}

export function buildChromaObservation(input: {
  phase: Phase;
  you: ChromaYou;
  preset: PresetId;
  seed: number | null;
  puzzle: PuzzleState | null;
}): ChromaObservation {
  const publicState = buildPublicState(input.preset, input.seed, input.puzzle, input.phase);
  return {
    game: "chroma-slide",
    phase: input.phase,
    you: input.you,
    publicState,
    legalActions: legalMovesFor(input.puzzle, input.you.seat, input.phase),
    lastOpponentMove: null,
  };
}
