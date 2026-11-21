export const SIZE = 15;

export const DEFAULT_CAPTURES_TO_WIN = 3;
export const MIN_CAPTURES_TO_WIN = 1;
export const MAX_CAPTURES_TO_WIN = 9;

export type Stone = 0 | 1 | 2;
export type Player = 1 | 2;
export type Rules = "classic" | "series";

export type Pending =
  | { kind: "remove"; eligible: number[]; selected: number[] }
  | { kind: "flip" };

export type GameState = {
  size: number;
  board: Stone[];
  turn: Player;
  moves: number[];
  lastMove: number | null;
  winner: 0 | 1 | 2 | 3;
  winLine: number[] | null;
  rules: Rules;
  capturesToWin: number;
  captures: [number, number];
  pending: Pending | null;
};

export type StartConfig = {
  rules?: Rules;
  capturesToWin?: number;
};

export function other(player: Player): Player {
  return player === 1 ? 2 : 1;
}

export function idx(row: number, col: number, size = SIZE): number {
  return row * size + col;
}

export function rowOf(index: number, size = SIZE): number {
  return Math.floor(index / size);
}

export function colOf(index: number, size = SIZE): number {
  return index % size;
}

export function inBounds(row: number, col: number, size = SIZE): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

export function clampCapturesToWin(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CAPTURES_TO_WIN;
  return Math.min(MAX_CAPTURES_TO_WIN, Math.max(MIN_CAPTURES_TO_WIN, Math.floor(n)));
}

export function asRules(value: unknown): Rules {
  return value === "series" ? "series" : "classic";
}

export function emptyState(config: StartConfig = {}, size = SIZE): GameState {
  const rules = asRules(config.rules);
  return {
    size,
    board: Array<Stone>(size * size).fill(0),
    turn: 1,
    moves: [],
    lastMove: null,
    winner: 0,
    winLine: null,
    rules,
    capturesToWin: rules === "series" ? clampCapturesToWin(config.capturesToWin) : DEFAULT_CAPTURES_TO_WIN,
    captures: [0, 0],
    pending: null,
  };
}

export function isOver(state: GameState): boolean {
  return state.winner !== 0;
}

export function isEmpty(state: GameState, index: number): boolean {
  return index >= 0 && index < state.board.length && state.board[index] === 0;
}

export function captureOf(state: GameState, player: Player): number {
  return state.captures[player - 1] ?? 0;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function winningLine(
  board: Stone[],
  size: number,
  index: number,
): number[] | null {
  const color = board[index];
  if (!color) return null;
  const r0 = rowOf(index, size);
  const c0 = colOf(index, size);
  for (const [dr, dc] of DIRS) {
    const cells = [index];
    for (const sign of [1, -1] as const) {
      let r = r0 + sign * dr;
      let c = c0 + sign * dc;
      while (inBounds(r, c, size) && board[idx(r, c, size)] === color) {
        cells.push(idx(r, c, size));
        r += sign * dr;
        c += sign * dc;
      }
    }
    if (cells.length >= 5) {
      cells.sort((a, b) => a - b);
      return cells;
    }
  }
  return null;
}

export function stonesInFives(board: Stone[], size: number, color: Player): number[] {
  const found = new Set<number>();
  for (const [dr, dc] of DIRS) {
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== color) continue;
      const r0 = rowOf(i, size);
      const c0 = colOf(i, size);
      const pr = r0 - dr;
      const pc = c0 - dc;
      if (inBounds(pr, pc, size) && board[idx(pr, pc, size)] === color) continue;
      const run: number[] = [];
      let r = r0;
      let c = c0;
      while (inBounds(r, c, size) && board[idx(r, c, size)] === color) {
        run.push(idx(r, c, size));
        r += dr;
        c += dc;
      }
      if (run.length >= 5) {
        for (const cell of run) found.add(cell);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

function boardFull(board: Stone[]): boolean {
  for (const cell of board) if (cell === 0) return false;
  return true;
}

function listStones(board: Stone[], color: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === color) out.push(i);
  return out;
}

function decideFullWinner(state: GameState): GameState {
  if (state.rules !== "series") {
    return { ...state, winner: 3, winLine: null, pending: null };
  }
  const black = state.captures[0];
  const white = state.captures[1];
  let winner: GameState["winner"] = 3;
  if (black > white) winner = 1;
  else if (white > black) winner = 2;
  return { ...state, winner, winLine: null, pending: null };
}

function passTurn(state: GameState): GameState {
  if (boardFull(state.board)) return decideFullWinner(state);
  return { ...state, turn: other(state.turn), pending: null };
}

function beginRemove(state: GameState): GameState {
  const eligible = stonesInFives(state.board, state.size, state.turn);
  if (eligible.length < 5) return passTurn(state);
  if (eligible.length === 5) return resolveRemove(state, eligible);
  return {
    ...state,
    pending: { kind: "remove", eligible, selected: [] },
    winLine: eligible,
  };
}

function afterCapture(state: GameState): GameState {
  if (captureOf(state, state.turn) >= state.capturesToWin) {
    return { ...state, winner: state.turn, pending: null, winLine: null };
  }
  const opp = other(state.turn);
  if (listStones(state.board, opp).length > 0) {
    return { ...state, pending: { kind: "flip" }, winLine: null };
  }
  const leftover = stonesInFives(state.board, state.size, state.turn);
  if (leftover.length >= 5) return beginRemove({ ...state, pending: null, winLine: null });
  return passTurn({ ...state, pending: null, winLine: null });
}

function resolveRemove(state: GameState, picked: number[]): GameState {
  const board = state.board.slice() as Stone[];
  for (const index of picked) board[index] = 0;
  const captures: [number, number] = [state.captures[0], state.captures[1]];
  captures[state.turn - 1] += 1;
  return afterCapture({
    ...state,
    board,
    captures,
    pending: null,
    winLine: null,
  });
}

function applyFlip(state: GameState, index: number): GameState | null {
  const opp = other(state.turn);
  if (state.board[index] !== opp) return null;
  const board = state.board.slice() as Stone[];
  board[index] = state.turn;
  const next: GameState = {
    ...state,
    board,
    lastMove: index,
    pending: null,
    winLine: null,
  };
  if (stonesInFives(board, state.size, state.turn).length >= 5) return beginRemove(next);
  return passTurn(next);
}

function selectRemove(state: GameState, index: number): GameState | null {
  const pending = state.pending;
  if (!pending || pending.kind !== "remove") return null;
  if (!pending.eligible.includes(index)) return null;
  const selected = pending.selected.includes(index)
    ? pending.selected.filter((cell) => cell !== index)
    : pending.selected.concat(index);
  if (selected.length === 5) return resolveRemove(state, selected);
  return {
    ...state,
    pending: { kind: "remove", eligible: pending.eligible, selected },
    winLine: pending.eligible,
  };
}

function placeStone(state: GameState, index: number): GameState | null {
  if (state.pending || state.winner !== 0 || !isEmpty(state, index)) return null;
  const board = state.board.slice() as Stone[];
  board[index] = state.turn;
  const moves = state.moves.concat(index);
  const base: GameState = {
    ...state,
    board,
    moves,
    lastMove: index,
    winLine: null,
    pending: null,
  };
  const line = winningLine(board, state.size, index);
  if (state.rules === "classic") {
    if (line) {
      return { ...base, winner: state.turn, winLine: line };
    }
    if (boardFull(board)) return { ...base, winner: 3 };
    return { ...base, turn: other(state.turn) };
  }
  if (line) return beginRemove(base);
  if (boardFull(board)) return decideFullWinner(base);
  return { ...base, turn: other(state.turn) };
}

/** Place, or click a capture/flip target, depending on pending. */
export function play(state: GameState, index: number): GameState | null {
  if (state.winner !== 0) return null;
  if (state.pending?.kind === "remove") return selectRemove(state, index);
  if (state.pending?.kind === "flip") return applyFlip(state, index);
  return placeStone(state, index);
}

export function canActOn(state: GameState, index: number): boolean {
  if (state.winner !== 0) return false;
  if (state.pending?.kind === "remove") return state.pending.eligible.includes(index);
  if (state.pending?.kind === "flip") return state.board[index] === other(state.turn);
  return isEmpty(state, index);
}

export function opensCapture(state: GameState, index: number, color: Player): boolean {
  if (state.pending || state.winner !== 0 || !isEmpty(state, index)) return false;
  const probe = cloneState(state);
  probe.turn = color;
  const next = play(probe, index);
  if (!next) return false;
  if (probe.rules === "classic") return next.winner === color;
  return (
    next.pending != null ||
    next.captures[color - 1] > probe.captures[color - 1] ||
    next.winner === color
  );
}

export function pickRemoveStones(state: GameState): number[] | null {
  const pending = state.pending;
  if (!pending || pending.kind !== "remove") return null;
  const need = 5 - pending.selected.length;
  if (need <= 0) return pending.selected.slice();
  const remain = pending.eligible.filter((cell) => !pending.selected.includes(cell));
  const line =
    state.lastMove != null ? winningLine(state.board, state.size, state.lastMove) : null;
  const ordered: number[] = [];
  if (line) {
    for (const cell of line) {
      if (remain.includes(cell) && !ordered.includes(cell)) ordered.push(cell);
    }
  }
  for (const cell of remain) if (!ordered.includes(cell)) ordered.push(cell);
  if (ordered.length < need) return null;
  return pending.selected.concat(ordered.slice(0, need));
}

export function pickFlipStone(state: GameState): number | null {
  if (!state.pending || state.pending.kind !== "flip") return null;
  const me = state.turn;
  const opp = other(me);
  const targets = listStones(state.board, opp);
  if (!targets.length) return null;
  let best = targets[0]!;
  let bestScore = -Infinity;
  for (const index of targets) {
    const board = state.board.slice() as Stone[];
    board[index] = me;
    let score = 0;
    if (winningLine(board, state.size, index)) score += 1_000_000;
    const r = rowOf(index, state.size);
    const c = colOf(index, state.size);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc, state.size)) continue;
        if (state.board[idx(rr, cc, state.size)] === me) score += 4;
        else if (state.board[idx(rr, cc, state.size)] === opp) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

export function resolvePendingGreedy(state: GameState): GameState {
  let next = state;
  while (next.pending && next.winner === 0) {
    if (next.pending.kind === "remove") {
      const picked = pickRemoveStones(next);
      if (!picked) break;
      next = resolveRemove(next, picked);
      continue;
    }
    const flip = pickFlipStone(next);
    if (flip == null) break;
    const flipped = applyFlip(next, flip);
    if (!flipped) break;
    next = flipped;
  }
  return next;
}

/** Finish a whole turn after a placement, resolving capture UI with greedy picks. */
export function playTurn(state: GameState, index: number): GameState | null {
  const next = play(state, index);
  if (!next) return null;
  return resolvePendingGreedy(next);
}

export function resign(state: GameState, loser: Player): GameState {
  if (state.winner !== 0) return state;
  return {
    ...cloneState(state),
    winner: other(loser),
    winLine: null,
    pending: null,
  };
}

export function undo(state: GameState, count = 1): GameState {
  if (count <= 0 || state.moves.length === 0) return state;
  if (state.rules === "series") return state;
  const take = Math.min(count, state.moves.length);
  const moves = state.moves.slice(0, state.moves.length - take);
  const board = Array<Stone>(state.size * state.size).fill(0);
  let turn: Player = 1;
  for (const move of moves) {
    board[move] = turn;
    turn = other(turn);
  }
  return {
    ...emptyState({ rules: "classic" }, state.size),
    board,
    turn,
    moves,
    lastMove: moves.length ? moves[moves.length - 1]! : null,
  };
}

export function cloneState(state: GameState): GameState {
  return {
    size: state.size,
    board: state.board.slice() as Stone[],
    turn: state.turn,
    moves: state.moves.slice(),
    lastMove: state.lastMove,
    winner: state.winner,
    winLine: state.winLine ? state.winLine.slice() : null,
    rules: state.rules,
    capturesToWin: state.capturesToWin,
    captures: [state.captures[0], state.captures[1]],
    pending: clonePending(state.pending),
  };
}

function clonePending(pending: Pending | null): Pending | null {
  if (!pending) return null;
  if (pending.kind === "flip") return { kind: "flip" };
  return {
    kind: "remove",
    eligible: pending.eligible.slice(),
    selected: pending.selected.slice(),
  };
}

function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2;
}

function isPending(value: unknown): value is Pending {
  if (!value || typeof value !== "object") return false;
  const p = value as Pending;
  if (p.kind === "flip") return true;
  if (p.kind !== "remove") return false;
  return Array.isArray(p.eligible) && Array.isArray(p.selected);
}

export function parseState(data: unknown, size = SIZE): GameState | null {
  if (!data || typeof data !== "object") return null;
  const s = data as Partial<GameState> & { board?: unknown; moves?: unknown };
  if (s.size !== size || !Array.isArray(s.board) || s.board.length !== size * size) {
    return null;
  }
  if (!isPlayer(s.turn)) return null;
  if (!Array.isArray(s.moves)) return null;
  if (s.winner !== 0 && s.winner !== 1 && s.winner !== 2 && s.winner !== 3) return null;
  for (const cell of s.board) {
    if (cell !== 0 && cell !== 1 && cell !== 2) return null;
  }
  for (const move of s.moves) {
    if (!Number.isInteger(move) || move < 0 || move >= s.board.length) return null;
  }
  const rules = asRules(s.rules);
  let captures: [number, number] = [0, 0];
  if (Array.isArray(s.captures) && s.captures.length >= 2) {
    const a = s.captures[0];
    const b = s.captures[1];
    if (typeof a === "number" && typeof b === "number" && a >= 0 && b >= 0) {
      captures = [Math.floor(a), Math.floor(b)];
    }
  }
  let pending: Pending | null = null;
  if (s.pending != null) {
    if (!isPending(s.pending)) return null;
    pending = clonePending(s.pending);
  }
  const lastMove =
    typeof s.lastMove === "number" && Number.isInteger(s.lastMove)
      ? s.lastMove
      : s.moves.length
        ? s.moves[s.moves.length - 1]!
        : null;
  if (rules === "classic") {
    let stones = 0;
    for (const cell of s.board) if (cell !== 0) stones += 1;
    if (s.moves.length !== stones) return null;
  }
  const winLine = Array.isArray(s.winLine)
    ? s.winLine.filter((n): n is number => Number.isInteger(n))
    : null;
  return {
    size,
    board: s.board.slice() as Stone[],
    turn: s.turn,
    moves: s.moves.slice(),
    lastMove,
    winner: s.winner,
    winLine: winLine && winLine.length ? winLine : null,
    rules,
    capturesToWin: rules === "series" ? clampCapturesToWin(s.capturesToWin) : DEFAULT_CAPTURES_TO_WIN,
    captures,
    pending,
  };
}

export function isValidState(data: unknown, size = SIZE): data is GameState {
  return parseState(data, size) != null;
}
