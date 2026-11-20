export const SIZE = 15;

export type Stone = 0 | 1 | 2;
export type Player = 1 | 2;

export type GameState = {
  size: number;
  board: Stone[];
  turn: Player;
  moves: number[];
  winner: 0 | 1 | 2 | 3;
  winLine: number[] | null;
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

export function emptyState(size = SIZE): GameState {
  return {
    size,
    board: Array<Stone>(size * size).fill(0),
    turn: 1,
    moves: [],
    winner: 0,
    winLine: null,
  };
}

export function isOver(state: GameState): boolean {
  return state.winner !== 0;
}

export function isEmpty(state: GameState, index: number): boolean {
  return index >= 0 && index < state.board.length && state.board[index] === 0;
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

export function play(state: GameState, index: number): GameState | null {
  if (state.winner !== 0 || !isEmpty(state, index)) return null;
  const board = state.board.slice() as Stone[];
  board[index] = state.turn;
  const line = winningLine(board, state.size, index);
  const moves = state.moves.concat(index);
  let winner: GameState["winner"] = 0;
  let winLine: number[] | null = null;
  if (line) {
    winner = state.turn;
    winLine = line;
  } else if (moves.length >= board.length) {
    winner = 3;
  }
  return {
    size: state.size,
    board,
    turn: other(state.turn),
    moves,
    winner,
    winLine,
  };
}

export function resign(state: GameState, loser: Player): GameState {
  if (state.winner !== 0) return state;
  return {
    ...state,
    board: state.board.slice() as Stone[],
    moves: state.moves.slice(),
    winner: other(loser),
    winLine: null,
  };
}

export function undo(state: GameState, count = 1): GameState {
  if (count <= 0 || state.moves.length === 0) return state;
  const take = Math.min(count, state.moves.length);
  const moves = state.moves.slice(0, state.moves.length - take);
  const board = Array<Stone>(state.size * state.size).fill(0);
  let turn: Player = 1;
  for (const move of moves) {
    board[move] = turn;
    turn = other(turn);
  }
  return {
    size: state.size,
    board,
    turn,
    moves,
    winner: 0,
    winLine: null,
  };
}

export function cloneState(state: GameState): GameState {
  return {
    size: state.size,
    board: state.board.slice() as Stone[],
    turn: state.turn,
    moves: state.moves.slice(),
    winner: state.winner,
    winLine: state.winLine ? state.winLine.slice() : null,
  };
}

export function isValidState(data: unknown, size = SIZE): data is GameState {
  if (!data || typeof data !== "object") return false;
  const s = data as GameState;
  if (s.size !== size || !Array.isArray(s.board) || s.board.length !== size * size) {
    return false;
  }
  if (s.turn !== 1 && s.turn !== 2) return false;
  if (!Array.isArray(s.moves)) return false;
  if (s.winner !== 0 && s.winner !== 1 && s.winner !== 2 && s.winner !== 3) {
    return false;
  }
  for (const cell of s.board) {
    if (cell !== 0 && cell !== 1 && cell !== 2) return false;
  }
  let stones = 0;
  for (const cell of s.board) if (cell !== 0) stones += 1;
  if (s.moves.length !== stones) return false;
  for (const move of s.moves) {
    if (!Number.isInteger(move) || move < 0 || move >= s.board.length) return false;
  }
  return true;
}
