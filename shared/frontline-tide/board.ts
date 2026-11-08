import { frontlineTideConfig } from "./config";
import { rngInt, type RngState } from "./rng";
import type {
  CascadeStep,
  Cell,
  GameState,
  GemCell,
  GemColor,
  Pos,
  SwapResult,
  Terrain,
} from "./types";

export function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => row.map((cell) => (cell.kind === "defense" ? { ...cell } : cell)));
}

export function inBounds(board: Cell[][], pos: Pos): boolean {
  return pos.r >= 0 && pos.c >= 0 && pos.r < board.length && pos.c < board[0].length;
}

export function isOrtho(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function gemColor(cell: Cell): GemColor | null {
  return cell.kind === "gem" ? cell.color : null;
}

function shoalBands(n: number): Terrain[] {
  return Array.from({ length: n }, () => "shoal" as Terrain);
}

function markRun(
  board: Cell[][],
  bands: Terrain[],
  mark: boolean[][],
  dr: number,
  dc: number,
  mode: "ortho" | "diagonal",
): void {
  const n = board.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const prevR = r - dr;
      const prevC = c - dc;
      const color = gemColor(board[r]![c]!);
      if (color === null) continue;
      if (mode === "ortho" && dr !== 0 && bands[c] === "rip") continue;
      if (
        prevR >= 0 &&
        prevC >= 0 &&
        prevR < n &&
        prevC < n &&
        gemColor(board[prevR]![prevC]!) === color &&
        !(mode === "ortho" && dr !== 0 && bands[prevC] === "rip")
      ) {
        continue;
      }
      const run: Pos[] = [];
      let rr = r;
      let cc = c;
      while (rr >= 0 && cc >= 0 && rr < n && cc < n && gemColor(board[rr]![cc]!) === color) {
        if (mode === "ortho" && dr !== 0 && bands[cc] === "rip") break;
        run.push({ r: rr, c: cc });
        rr += dr;
        cc += dc;
      }
      if (run.length < 3) continue;
      if (mode === "diagonal" && !run.some((p) => bands[p.c] === "reef")) continue;
      for (const p of run) mark[p.r]![p.c] = true;
    }
  }
}

export function findMatches(board: Cell[][], bands: Terrain[] = shoalBands(board.length)): Pos[] {
  const n = board.length;
  const mark: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const line = bands.length === n ? bands : shoalBands(n);
  markRun(board, line, mark, 0, 1, "ortho");
  markRun(board, line, mark, 1, 0, "ortho");
  markRun(board, line, mark, 1, 1, "diagonal");
  markRun(board, line, mark, 1, -1, "diagonal");
  const out: Pos[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mark[r]![c]) out.push({ r, c });
    }
  }
  return out;
}

function cellInMatch(board: Cell[][], bands: Terrain[], r: number, c: number): boolean {
  return findMatches(board, bands).some((p) => p.r === r && p.c === c);
}

export function spawnGemAvoiding(
  board: Cell[][],
  bands: Terrain[],
  r: number,
  c: number,
  rng: RngState,
): { cell: GemCell; rng: RngState } {
  const nColors = Math.max(1, Math.min(3, frontlineTideConfig.colors));
  let cursor = rng;
  let last: GemCell = { kind: "gem", color: 0 };
  for (let attempt = 0; attempt < nColors * 3; attempt++) {
    const rolled = rngInt(cursor, nColors);
    cursor = rolled.rng;
    const cell: GemCell = { kind: "gem", color: rolled.value as GemColor };
    board[r]![c] = cell;
    last = cell;
    if (!cellInMatch(board, bands, r, c)) return { cell, rng: cursor };
  }
  board[r]![c] = last;
  return { cell: last, rng: cursor };
}

function compactColumn(board: Cell[][], c: number): void {
  const n = board.length;
  let start = 0;
  for (let r = 0; r <= n; r++) {
    const wall = r < n && board[r][c].kind === "defense";
    if (r < n && !wall) continue;
    const gems: GemCell[] = [];
    for (let i = start; i < r; i++) {
      const cell = board[i][c];
      if (cell.kind === "gem") gems.push(cell);
      board[i][c] = { kind: "empty" };
    }
    let write = r - 1;
    for (let g = gems.length - 1; g >= 0; g--) {
      board[write][c] = gems[g];
      write -= 1;
    }
    if (wall) start = r + 1;
  }
}

/** Gems fall toward the bottom of each gap between defenses. Empties refill. */
export function collapseAndRefill(
  board: Cell[][],
  bands: Terrain[],
  rng: RngState,
): { board: Cell[][]; rng: RngState } {
  const next = cloneBoard(board);
  const n = next.length;
  for (let c = 0; c < n; c++) compactColumn(next, c);
  let cursor = rng;
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      if (next[r]![c]!.kind !== "empty") continue;
      const spawned = spawnGemAvoiding(next, bands, r, c, cursor);
      cursor = spawned.rng;
    }
  }
  return { board: next, rng: cursor };
}

export function refillEmpties(
  board: Cell[][],
  bands: Terrain[],
  rng: RngState,
): { board: Cell[][]; rng: RngState } {
  const next = cloneBoard(board);
  let cursor = rng;
  for (let r = 0; r < next.length; r++) {
    for (let c = 0; c < next.length; c++) {
      if (next[r]![c]!.kind !== "empty") continue;
      const spawned = spawnGemAvoiding(next, bands, r, c, cursor);
      cursor = spawned.rng;
    }
  }
  return { board: next, rng: cursor };
}

export function withSwapped(board: Cell[][], a: Pos, b: Pos): Cell[][] {
  const next = cloneBoard(board);
  const tmp = next[a.r][a.c];
  next[a.r][a.c] = next[b.r][b.c];
  next[b.r][b.c] = tmp;
  return next;
}

export function swapWouldMatch(board: Cell[][], bands: Terrain[], a: Pos, b: Pos): boolean {
  if (!isOrtho(a, b) || !inBounds(board, a) || !inBounds(board, b)) return false;
  if (board[a.r]![a.c]!.kind !== "gem" || board[b.r]![b.c]!.kind !== "gem") return false;
  return findMatches(withSwapped(board, a, b), bands).length > 0;
}

export function hasMove(board: Cell[][], bands: Terrain[]): boolean {
  const n = board.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c + 1 < n && swapWouldMatch(board, bands, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < n && swapWouldMatch(board, bands, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

function clearCells(board: Cell[][], cleared: Pos[]): Cell[][] {
  const next = cloneBoard(board);
  for (const p of cleared) next[p.r][p.c] = { kind: "empty" };
  return next;
}

export function scoreClear(bands: Terrain[], cleared: Pos[], chain: number): number {
  // The swap's first clear pays for every gem. Rip columns pay double.
  // Later chain steps add a flat bonus so a cascade stays readable.
  if (chain > 4) return 0;
  if (chain > 1) return frontlineTideConfig.chainFlatBonus;
  let points = 0;
  for (const pos of cleared) {
    points += bands[pos.c] === "rip" ? frontlineTideConfig.ripYield : frontlineTideConfig.matchPointsPerGem;
  }
  return points;
}

function reshuffleGems(board: Cell[][], bands: Terrain[], rng: RngState): { board: Cell[][]; rng: RngState } {
  const n = board.length;
  const spots: Pos[] = [];
  const gems: GemCell[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (cell.kind !== "gem") continue;
      spots.push({ r, c });
      gems.push(cell);
    }
  }
  let cursor = rng;
  let best = cloneBoard(board);
  for (let attempt = 0; attempt < 48; attempt++) {
    const bag = gems.map((g) => ({ ...g }));
    for (let i = bag.length - 1; i > 0; i--) {
      const roll = rngInt(cursor, i + 1);
      cursor = roll.rng;
      const j = roll.value;
      const tmp = bag[i];
      bag[i] = bag[j]!;
      bag[j] = tmp!;
    }
    const next = cloneBoard(board);
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i]!;
      next[p.r][p.c] = bag[i]!;
    }
    best = next;
    if (findMatches(next, bands).length === 0 && hasMove(next, bands)) return { board: next, rng: cursor };
  }
  return { board: best, rng: cursor };
}

/** Refill holes, then reshuffle tide marks if the day would have no legal swap. */
export function ensurePlayable(
  board: Cell[][],
  bands: Terrain[],
  rng: RngState,
): { board: Cell[][]; rng: RngState } {
  const filled = refillEmpties(board, bands, rng);
  if (findMatches(filled.board, bands).length === 0 && hasMove(filled.board, bands)) return filled;
  return reshuffleGems(filled.board, bands, filled.rng);
}

export function fillFreshBoard(
  rng: RngState,
  size: number,
  bands: Terrain[],
): { board: Cell[][]; rng: RngState } {
  const board: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ kind: "empty" as const })),
  );
  let cursor = rng;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const spawned = spawnGemAvoiding(board, bands, r, c, cursor);
      cursor = spawned.rng;
    }
  }
  return ensurePlayable(board, bands, cursor);
}

export function resolveSwap(state: GameState, a: Pos, b: Pos): SwapResult {
  if (state.phase !== "day_match") return { ok: false, reason: "phase" };
  if (state.swapsLeft <= 0) return { ok: false, reason: "no-swaps" };
  if (!inBounds(state.board, a) || !inBounds(state.board, b) || !isOrtho(a, b)) {
    return { ok: false, reason: "not-adjacent" };
  }
  if (state.board[a.r][a.c].kind !== "gem" || state.board[b.r][b.c].kind !== "gem") {
    return { ok: false, reason: "not-gem" };
  }

  let board = withSwapped(state.board, a, b);
  if (findMatches(board, state.bands).length === 0) return { ok: false, reason: "no-match" };

  const steps: CascadeStep[] = [];
  let rng = state.rng;
  let points = state.points;
  let chain = 0;
  while (chain < 32) {
    const cleared = findMatches(board, state.bands);
    if (cleared.length === 0) break;
    chain += 1;
    const gain = scoreClear(state.bands, cleared, chain);
    points += gain;
    const collapsed = collapseAndRefill(clearCells(board, cleared), state.bands, rng);
    steps.push({
      boardBeforeClear: board,
      cleared,
      points: gain,
      chain,
      boardAfter: collapsed.board,
    });
    board = collapsed.board;
    rng = collapsed.rng;
  }

  if (state.swapsLeft - 1 > 0 && !hasMove(board, state.bands)) {
    const fixed = reshuffleGems(board, state.bands, rng);
    board = fixed.board;
    rng = fixed.rng;
    if (steps.length > 0) steps[steps.length - 1] = { ...steps[steps.length - 1]!, boardAfter: board };
  }

  return {
    ok: true,
    steps,
    state: {
      ...state,
      board,
      rng,
      points,
      swapsLeft: state.swapsLeft - 1,
    },
  };
}
