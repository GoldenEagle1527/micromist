import { cloneBoard, ensurePlayable, fillFreshBoard, spawnGemAvoiding } from "./board";
import { frontlineTideConfig, openingBands, rollTerrain, swapsForDay } from "./config";
import { nextFront, nightEnemyCount } from "./night";
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
): { board: Cell[][]; bands: Terrain[]; rng: GameState["rng"] } {
  const n = board.length;
  const next = cloneBoard(board);
  const shifted: Terrain[] = bands.slice();
  const rolled = rollTerrain(rng, day);
  if (dir < 0) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n - 1; c++) next[r]![c] = board[r]![c + 1]!;
    }
    for (let c = 0; c < n - 1; c++) shifted[c] = bands[c + 1] ?? "shoal";
    shifted[n - 1] = rolled.terrain;
    for (let r = 0; r < n; r++) next[r]![n - 1] = { kind: "empty" };
  } else {
    for (let r = 0; r < n; r++) {
      for (let c = n - 1; c > 0; c--) next[r]![c] = board[r]![c - 1]!;
    }
    for (let c = n - 1; c > 0; c--) shifted[c] = bands[c - 1] ?? "shoal";
    shifted[0] = rolled.terrain;
    for (let r = 0; r < n; r++) next[r]![0] = { kind: "empty" };
  }
  const freshCol = dir < 0 ? n - 1 : 0;
  let cursor = rolled.rng;
  for (let r = 0; r < n; r++) {
    const spawned = spawnGemAvoiding(next, shifted, r, freshCol, cursor);
    cursor = spawned.rng;
  }
  return { board: next, bands: shifted, rng: cursor };
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
  const playable = ensurePlayable(scrolled.board, scrolled.bands, scrolled.rng);
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
  };
}
