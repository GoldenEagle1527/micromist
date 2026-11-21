import {
  GomokuSolution,
  createDefaultGomokuSearcher,
  createGomokuSearcher,
  createScoreMap,
  type IGomokuMover,
  type IGomokuPiece,
  type IGomokuSearcher,
} from "@algorithm.ts/gomoku";
import {
  captureOf,
  colOf,
  inBounds,
  idx,
  isOver,
  other,
  playTurn,
  rowOf,
  type GameState,
  type Player,
  type Stone,
} from "./engine";

export type Difficulty = "easy" | "normal" | "hard";

/** MIT: https://github.com/guanghechen/algorithm.ts — 0=white, 1=black. */
const ENGINE_BLACK = 1;
const ENGINE_WHITE = 0;
const SCORE_MAP = createScoreMap(5);

function searcherFor(difficulty: Difficulty): (mover: IGomokuMover) => IGomokuSearcher {
  if (difficulty === "easy") {
    return (mover) =>
      createGomokuSearcher({
        searchContext: mover,
        narrowSearcherOptions: [
          {
            MAX_SEARCH_DEPTH: 1,
            MAX_CANDIDATE_COUNT: 6,
            MIN_PROMOTION_SCORE: SCORE_MAP.con[2]![2]! * 4,
            CANDIDATE_GROWTH_FACTOR: 4,
          },
        ],
        deepSearcherOption: {
          MAX_SEARCH_DEPTH: 2,
          MIN_PROMOTION_SCORE: SCORE_MAP.con[4]![1]!,
        },
      });
  }
  if (difficulty === "normal") {
    return (mover) =>
      createGomokuSearcher({
        searchContext: mover,
        narrowSearcherOptions: [
          {
            MAX_SEARCH_DEPTH: 2,
            MAX_CANDIDATE_COUNT: 8,
            MIN_PROMOTION_SCORE: SCORE_MAP.con[2]![2]! * 4,
            CANDIDATE_GROWTH_FACTOR: 8,
          },
          {
            MAX_SEARCH_DEPTH: 4,
            MAX_CANDIDATE_COUNT: 4,
            MIN_PROMOTION_SCORE: SCORE_MAP.con[3]![1]! * 2,
            CANDIDATE_GROWTH_FACTOR: 8,
          },
        ],
        deepSearcherOption: {
          MAX_SEARCH_DEPTH: 8,
          MIN_PROMOTION_SCORE: SCORE_MAP.con[4]![1]!,
        },
      });
  }
  return (mover) =>
    createDefaultGomokuSearcher(SCORE_MAP, mover, {
      MAX_ADJACENT: 5,
      CANDIDATE_GROWTH_FACTOR: 8,
    });
}

function piecesOf(state: GameState): IGomokuPiece[] {
  const size = state.size;
  const pieces: IGomokuPiece[] = [];
  for (let i = 0; i < state.board.length; i++) {
    const stone = state.board[i];
    if (stone === 0) continue;
    pieces.push({
      r: Math.floor(i / size),
      c: i % size,
      p: stone === 1 ? ENGINE_BLACK : ENGINE_WHITE,
    });
  }
  return pieces;
}

function firstEmpty(state: GameState): number {
  const found = state.board.findIndex((cell) => cell === 0);
  return found >= 0 ? found : Math.floor(state.board.length / 2);
}

function chooseClassic(state: GameState, difficulty: Difficulty): number {
  const size = state.size;
  const solution = new GomokuSolution({
    MAX_ROW: size,
    MAX_COL: size,
    MAX_ADJACENT: 5,
    MAX_DISTANCE_OF_NEIGHBOR: 2,
    deeperSearcher: searcherFor(difficulty),
  });
  solution.init(piecesOf(state));
  const nextPlayer = state.turn === 1 ? ENGINE_BLACK : ENGINE_WHITE;
  try {
    const [row, col] = solution.minimaxSearch(nextPlayer);
    if (row < 0 || col < 0 || !inBounds(row, col, size)) return firstEmpty(state);
    const index = idx(row, col, size);
    if (state.board[index] !== 0) return firstEmpty(state);
    return index;
  } catch {
    return firstEmpty(state);
  }
}

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

function scorePoint(board: Stone[], size: number, index: number, color: Player): number {
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

function candidates(board: Stone[], size: number, radius = 2): number[] {
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

/** One capture outweighs any shape score. Closer to the goal counts more. */
const CAPTURE_UNIT = 2_000_000;

function shapeDelta(state: GameState, me: Player): number {
  const opp = other(me);
  let score = 0;
  const cells = candidates(state.board, state.size, 1);
  for (const index of cells) {
    score += scorePoint(state.board, state.size, index, me);
    score -= scorePoint(state.board, state.size, index, opp) * 1.15;
  }
  return score;
}

function evalSeries(state: GameState, root: Player): number {
  const opp = other(root);
  if (state.winner === root) return 1_000_000_000;
  if (state.winner === opp) return -1_000_000_000;
  const mine = captureOf(state, root);
  const theirs = captureOf(state, opp);
  if (state.winner === 3) return (mine - theirs) * CAPTURE_UNIT;
  return (mine - theirs) * CAPTURE_UNIT + (mine * mine - theirs * theirs) * 50_000 + shapeDelta(state, root);
}

function rankedMoves(state: GameState): number[] {
  const me = state.turn;
  const opp = other(me);
  const ranked = candidates(state.board, state.size, 2).map((index) => {
    const attack = scorePoint(state.board, state.size, index, me);
    const defend = scorePoint(state.board, state.size, index, opp);
    return { index, score: attack + defend * 1.15 };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((item) => item.index);
}

class SeriesBudget {
  deadline: number;
  cut = false;
  constructor(ms: number) {
    this.deadline = performance.now() + ms;
  }
  expired(): boolean {
    if (performance.now() < this.deadline) return false;
    this.cut = true;
    return true;
  }
}

/**
 * Same shape as the classic engine's search: order nearby candidates, keep fewer
 * of them as the ply grows, and look one ply further after a capture.
 * One ply here is a whole series turn (place, lift five, flip).
 */
function seriesSearch(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  root: Player,
  limits: readonly number[],
  ply: number,
  extensions: number,
  budget: SeriesBudget,
): number {
  if (budget.expired()) return evalSeries(state, root);
  if (isOver(state) || depth === 0) return evalSeries(state, root);
  const branch = limits[Math.min(ply, limits.length - 1)] ?? 3;
  const spots = rankedMoves(state).slice(0, branch);
  const maximizing = state.turn === root;
  let best = maximizing ? -Infinity : Infinity;
  for (const index of spots) {
    if (budget.expired()) break;
    const next = playTurn(state, index);
    if (!next) continue;
    const captured = next.captures[state.turn - 1]! > state.captures[state.turn - 1]!;
    let childDepth = depth - 1;
    let childExt = extensions;
    if (captured && childDepth === 0 && childExt > 0 && !isOver(next)) {
      childDepth = 1;
      childExt -= 1;
    }
    const value = seriesSearch(next, childDepth, alpha, beta, root, limits, ply + 1, childExt, budget);
    if (maximizing) {
      if (value > best) best = value;
      if (value > alpha) alpha = value;
    } else {
      if (value < best) best = value;
      if (value < beta) beta = value;
    }
    if (beta <= alpha) break;
  }
  return best === Infinity || best === -Infinity ? evalSeries(state, root) : best;
}

function seriesPlan(difficulty: Difficulty): {
  maxDepth: number;
  limits: readonly number[];
  extensions: number;
  budgetMs: number;
} {
  if (difficulty === "easy") return { maxDepth: 2, limits: [5, 3], extensions: 0, budgetMs: 80 };
  if (difficulty === "normal") return { maxDepth: 3, limits: [8, 5, 3], extensions: 1, budgetMs: 160 };
  return { maxDepth: 4, limits: [10, 6, 4, 3], extensions: 2, budgetMs: 320 };
}

function chooseSeries(state: GameState, difficulty: Difficulty): number {
  const me = state.turn;
  const ordered = rankedMoves(state);
  if (!ordered.length) return firstEmpty(state);
  for (const index of ordered) {
    const next = playTurn(state, index);
    if (next?.winner === me) return index;
  }

  const plan = seriesPlan(difficulty);
  const budget = new SeriesBudget(plan.budgetMs);
  let chosen = ordered[0]!;
  for (let depth = 2; depth <= plan.maxDepth; depth++) {
    if (budget.expired()) break;
    budget.cut = false;
    const branch = plan.limits[0] ?? ordered.length;
    let bestScore = -Infinity;
    let bestIndex = chosen;
    let finished = true;
    for (const index of ordered.slice(0, branch)) {
      if (budget.expired()) {
        finished = false;
        break;
      }
      const next = playTurn(state, index);
      if (!next) continue;
      const captured = next.captures[me - 1]! > state.captures[me - 1]!;
      let childDepth = depth - 1;
      let childExt = plan.extensions;
      if (captured && childDepth === 0 && childExt > 0 && !isOver(next)) {
        childDepth = 1;
        childExt -= 1;
      }
      const value = seriesSearch(next, childDepth, -Infinity, Infinity, me, plan.limits, 1, childExt, budget);
      if (value > bestScore) {
        bestScore = value;
        bestIndex = index;
      }
    }
    if (finished && !budget.cut) chosen = bestIndex;
  }
  return chosen;
}

export function chooseMove(state: GameState, difficulty: Difficulty): number {
  if (state.rules === "series") return chooseSeries(state, difficulty);
  return chooseClassic(state, difficulty);
}
