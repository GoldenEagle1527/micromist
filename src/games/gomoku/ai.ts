import {
  colOf,
  inBounds,
  idx,
  isOver,
  other,
  play,
  rowOf,
  type GameState,
  type Player,
  type Stone,
} from "./engine";

export type Difficulty = "easy" | "normal" | "hard";

const FIVE = 100_000;
const OPEN_FOUR = 10_000;
const CLOSED_FOUR = 2_000;
const OPEN_THREE = 1_000;
const BROKEN_THREE = 700;
const CLOSED_THREE = 200;
const OPEN_TWO = 60;
const CLOSED_TWO = 15;

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function windowOf(
  board: Stone[],
  size: number,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: Player,
): string {
  let s = "";
  for (let k = -4; k <= 4; k++) {
    const r = row + k * dr;
    const c = col + k * dc;
    if (!inBounds(r, c, size)) {
      s += "x";
      continue;
    }
    const cell = k === 0 ? color : board[idx(r, c, size)];
    if (cell === color) s += "o";
    else if (cell === 0) s += ".";
    else s += "x";
  }
  return s;
}

function scoreWindow(s: string): number {
  if (s.includes("ooooo")) return FIVE;
  if (s.includes(".oooo.")) return OPEN_FOUR;
  if (
    s.includes("oooo.") ||
    s.includes(".oooo") ||
    s.includes("ooo.o") ||
    s.includes("o.ooo") ||
    s.includes("oo.oo")
  ) {
    return CLOSED_FOUR;
  }
  if (s.includes(".ooo.")) return OPEN_THREE;
  if (s.includes(".oo.o.") || s.includes(".o.oo.")) return BROKEN_THREE;
  if (s.includes("ooo.") || s.includes(".ooo") || s.includes("oo.o") || s.includes("o.oo")) {
    return CLOSED_THREE;
  }
  if (s.includes(".oo.")) return OPEN_TWO;
  if (s.includes("oo.") || s.includes(".oo") || s.includes("o.o")) return CLOSED_TWO;
  return 0;
}

export function scorePoint(
  board: Stone[],
  size: number,
  index: number,
  color: Player,
): number {
  const row = rowOf(index, size);
  const col = colOf(index, size);
  let total = 0;
  let fives = 0;
  let openFours = 0;
  let closedFours = 0;
  let openThrees = 0;
  for (const [dr, dc] of DIRS) {
    const value = scoreWindow(windowOf(board, size, row, col, dr, dc, color));
    if (value >= FIVE) fives += 1;
    else if (value >= OPEN_FOUR) openFours += 1;
    else if (value >= CLOSED_FOUR) closedFours += 1;
    else if (value >= OPEN_THREE) openThrees += 1;
    total += value;
  }
  if (fives) return FIVE * 2;
  if (openFours || closedFours >= 2) return OPEN_FOUR + 2_000;
  if (closedFours && openThrees) return OPEN_FOUR;
  if (openThrees >= 2) return OPEN_FOUR - 500;
  return total;
}

export function candidates(board: Stone[], size: number, radius = 2): number[] {
  const n = size * size;
  const marked = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (board[i] === 0) continue;
    any = true;
    const r = rowOf(i, size);
    const c = colOf(i, size);
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc, size)) continue;
        const j = idx(rr, cc, size);
        if (board[j] === 0) marked[j] = 1;
      }
    }
  }
  if (!any) return [idx(Math.floor(size / 2), Math.floor(size / 2), size)];
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (marked[i]) out.push(i);
  return out;
}

function evaluateBoard(board: Stone[], size: number, me: Player): number {
  const opp = other(me);
  let score = 0;
  const cells = candidates(board, size, 1);
  for (const index of cells) {
    score += scorePoint(board, size, index, me);
    score -= scorePoint(board, size, index, opp) * 1.15;
  }
  return score;
}

function winningMoves(
  state: GameState,
  color: Player,
  spots: number[],
): number[] {
  const hits: number[] = [];
  for (const index of spots) {
    const next = play({ ...state, turn: color }, index);
    if (next && next.winner === color) hits.push(index);
  }
  return hits;
}

function pickRandom(list: number[]): number {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!;
}

function rankedMoves(state: GameState, spots: number[]): { index: number; score: number }[] {
  const me = state.turn;
  const opp = other(me);
  const ranked = spots.map((index) => {
    const attack = scorePoint(state.board, state.size, index, me);
    const defend = scorePoint(state.board, state.size, index, opp);
    return { index, score: attack + defend * 1.15 };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function search(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  root: Player,
  maxBranch: number,
): number {
  if (isOver(state) || depth === 0) {
    if (state.winner === root) return FIVE * 4;
    if (state.winner === other(root)) return -FIVE * 4;
    if (state.winner === 3) return 0;
    return evaluateBoard(state.board, state.size, root);
  }
  const spots = rankedMoves(state, candidates(state.board, state.size, 2))
    .slice(0, maxBranch)
    .map((item) => item.index);
  const maximizing = state.turn === root;
  let best = maximizing ? -Infinity : Infinity;
  for (const index of spots) {
    const next = play(state, index);
    if (!next) continue;
    const value = search(next, depth - 1, alpha, beta, root, maxBranch);
    if (maximizing) {
      if (value > best) best = value;
      if (value > alpha) alpha = value;
    } else {
      if (value < best) best = value;
      if (value < beta) beta = value;
    }
    if (beta <= alpha) break;
  }
  return best === Infinity || best === -Infinity ? 0 : best;
}

export function chooseMove(state: GameState, difficulty: Difficulty): number {
  const size = state.size;
  const me = state.turn;
  const opp = other(me);
  const spots = candidates(state.board, size, 2);
  const wins = winningMoves(state, me, spots);
  if (wins.length) return pickRandom(wins);
  const blocks = winningMoves({ ...state, turn: opp }, opp, spots);
  if (blocks.length) return pickRandom(blocks);

  if (!spots.length) return Math.floor(state.board.length / 2);
  const ranked = rankedMoves(state, spots);
  if (!ranked.length) return spots[0]!;
  if (difficulty === "easy") {
    const pool = ranked.slice(0, Math.min(8, ranked.length));
    return pickRandom(pool.map((item) => item.index));
  }
  if (difficulty === "normal" || ranked.length <= 1) {
    const top = ranked[0]?.score ?? 0;
    const pool = ranked.filter((item) => item.score >= top - 80).map((item) => item.index);
    return pickRandom(pool.length ? pool : [ranked[0]!.index]);
  }

  const branch = ranked.slice(0, 12);
  let bestScore = -Infinity;
  let best: number[] = [branch[0]!.index];
  for (const item of branch) {
    const next = play(state, item.index);
    if (!next) continue;
    const value = search(next, 1, -Infinity, Infinity, me, 10);
    if (value > bestScore + 30) {
      bestScore = value;
      best = [item.index];
    } else if (value >= bestScore - 30) {
      if (value > bestScore) bestScore = value;
      best.push(item.index);
    }
  }
  return pickRandom(best);
}
