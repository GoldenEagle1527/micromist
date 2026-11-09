import { cloneBoard, ensurePlayable, fillFreshBoard, spawnGemAvoiding } from "./board";
import { frontlineTideConfig, openingBands, rollTerrain, swapsForDay, washWidthForDay } from "./config";
import { nextFront, nightEnemyCount, pathRowFor } from "./night";
import type { Cell, FrontDir, GameState, Terrain } from "./types";

export function createGame(seed: number = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0): GameState {
  const cfg = frontlineTideConfig;
  const size = cfg.boardSize;
  const bands = openingBands(size);
  const filled = fillFreshBoard({ seed: seed >>> 0 }, size, bands);
  const frontDir = cfg.frontDirStart as FrontDir;
  return {
    phase: "day_match",
    day: 1,
    hearts: cfg.hearts,
    points: 0,
    swapsLeft: swapsForDay(1),
    board: filled.board,
    bands,
    frontCol: frontDir < 0 ? 0 : size - 1,
    frontDir,
    enemies: [],
    spawnLeft: 0,
    spawnCooldown: 0,
    nextEnemyId: 1,
    clock: 0,
    rng: filled.rng,
    scrubbedRoad: [],
  };
}

export function enterBuild(state: GameState): GameState {
  if (state.phase !== "day_match") return state;
  return { ...state, phase: "day_build" };
}

export function enterNight(state: GameState): GameState {
  if (state.phase !== "day_build") return state;
  return {
    ...state,
    phase: "night",
    enemies: [],
    spawnLeft: nightEnemyCount(state.day),
    spawnCooldown: 0,
    nextEnemyId: 1,
  };
}

function shiftColumns(
  board: Cell[][],
  bands: Terrain[],
  dir: FrontDir,
  day: number,
  rng: GameState["rng"],
): { board: Cell[][]; bands: Terrain[]; rng: GameState["rng"]; freshCols: number[] } {
  const n = board.length;
  const width = Math.min(Math.max(1, washWidthForDay(day)), Math.max(1, n - 1));
  const next = cloneBoard(board);
  const shifted: Terrain[] = bands.slice();
  let cursor = rng;
  const freshTerrains: Terrain[] = [];
  for (let i = 0; i < width; i++) {
    const rolled = rollTerrain(cursor, day);
    cursor = rolled.rng;
    freshTerrains.push(rolled.terrain);
  }
  const freshCols = dir < 0
    ? Array.from({ length: width }, (_, i) => n - width + i)
    : Array.from({ length: width }, (_, i) => i);
  if (dir < 0) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n - width; c++) next[r]![c] = board[r]![c + width]!;
      for (const col of freshCols) next[r]![col] = { kind: "empty" };
    }
    for (let c = 0; c < n - width; c++) shifted[c] = bands[c + width] ?? "shoal";
  } else {
    for (let r = 0; r < n; r++) {
      for (let c = n - 1; c >= width; c--) next[r]![c] = board[r]![c - width]!;
      for (const col of freshCols) next[r]![col] = { kind: "empty" };
    }
    for (let c = n - 1; c >= width; c--) shifted[c] = bands[c - width] ?? "shoal";
  }
  for (let i = 0; i < width; i++) shifted[freshCols[i]!] = freshTerrains[i] ?? "shoal";
  for (const col of freshCols) {
    for (let r = 0; r < n; r++) {
      const spawned = spawnGemAvoiding(next, shifted, r, col, cursor);
      cursor = spawned.rng;
    }
  }
  return { board: next, bands: shifted, rng: cursor, freshCols };
}

/**
 * Push the battlefield one column the way the arrow points, flip the arrow,
 * and open the next day. There is no last day.
 */
export function completeFrontShift(state: GameState): GameState {
  if (state.phase !== "front_shift") return state;
  const nextDay = state.day + 1;
  const shifted = nextFront(state);
  const scrolled = shiftColumns(state.board, state.bands, state.frontDir, nextDay, state.rng);
  const playable = ensurePlayable(scrolled.board, scrolled.bands, scrolled.rng, nextDay);
  const rowChanged = pathRowFor(state.board.length, state.day) !== pathRowFor(state.board.length, nextDay);
  const scrubbedRoad = rowChanged
    ? Array.from({ length: state.board.length }, (_, col) => col)
    : scrolled.freshCols;
  return {
    ...state,
    phase: "day_match",
    day: nextDay,
    frontCol: shifted.frontCol,
    frontDir: shifted.frontDir,
    swapsLeft: swapsForDay(nextDay),
    board: playable.board,
    bands: scrolled.bands,
    rng: playable.rng,
    enemies: [],
    spawnLeft: 0,
    spawnCooldown: 0,
    scrubbedRoad,
  };
}
