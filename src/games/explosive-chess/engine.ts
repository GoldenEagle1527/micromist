/**
 * 爆炸棋 — core rules (faithful port of raincurtain game.js)
 */

export const COLOR_EMPTY = 0;
export const COLOR_RED = 1;
export const COLOR_BLUE = 2;

export const WIN_MODE_ANNIHILATION = "annihilation";
export const WIN_MODE_STEPS = "steps";
export const WIN_MODE_AREA = "area";

export type CellColor = typeof COLOR_EMPTY | typeof COLOR_RED | typeof COLOR_BLUE;
export type PlayerColor = typeof COLOR_RED | typeof COLOR_BLUE;
export type WinMode =
  | typeof WIN_MODE_ANNIHILATION
  | typeof WIN_MODE_STEPS
  | typeof WIN_MODE_AREA;
export type Winner = PlayerColor | "draw" | null;

export type GameConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam?: number;
};

export type AnimationFrame = {
  explodedCell: number;
  affectedCells: number[];
};

export type MoveResult = {
  animationFrames: AnimationFrame[];
  winner: Winner;
  winReason: string;
  gameOver: boolean;
};

export type FullState = {
  counts: number[];
  colors: number[];
  currentTurn: PlayerColor;
  stepCount: number;
  gameOver: boolean;
  winner: Winner;
  winReason: string;
};

export type GameInstance = {
  readonly boardSize: number;
  readonly currentTurn: PlayerColor;
  readonly stepCount: number;
  readonly gameOver: boolean;
  readonly winner: Winner;
  readonly winReason: string;
  readonly config: { boardSize: number; winMode: WinMode; winParam: number | undefined };
  readonly counts: Uint8Array;
  readonly colors: Uint8Array;
  readonly capacities: Uint8Array;
  isValidMove: (row: number, col: number, playerColor: PlayerColor) => boolean;
  makeMove: (row: number, col: number, playerColor: PlayerColor) => MoveResult | null;
  computeHash: () => number;
  getCellCounts: () => { red: number; blue: number };
  getFullState: () => FullState;
  loadFullState: (state: FullState) => void;
  getCell: (row: number, col: number) => { count: number; color: number; capacity: number };
  reset: () => void;
  forceGameOver: (winnerVal: Winner, reason?: string) => void;
  cellIndex: (row: number, col: number) => number;
};

/**
 * Create a game instance.
 * boardSize should be an odd integer in 9–23 (default 9 in UI).
 */
export function createGame(config: GameConfig): GameInstance {
  const { boardSize, winMode, winParam } = config;
  const totalCells = boardSize * boardSize;

  const counts = new Uint8Array(totalCells);
  const colors = new Uint8Array(totalCells);
  const capacities = new Uint8Array(totalCells);

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const idx = r * boardSize + c;
      const isTop = r === 0;
      const isBottom = r === boardSize - 1;
      const isLeft = c === 0;
      const isRight = c === boardSize - 1;
      const edgeCount =
        (isTop ? 1 : 0) + (isBottom ? 1 : 0) + (isLeft ? 1 : 0) + (isRight ? 1 : 0);
      if (edgeCount >= 2) {
        capacities[idx] = 2;
      } else if (edgeCount === 1) {
        capacities[idx] = 3;
      } else {
        capacities[idx] = 4;
      }
    }
  }

  const neighborsTable: number[][] = new Array(totalCells);
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const idx = r * boardSize + c;
      const neighbors: number[] = [];
      if (r > 0) neighbors.push((r - 1) * boardSize + c);
      if (r < boardSize - 1) neighbors.push((r + 1) * boardSize + c);
      if (c > 0) neighbors.push(r * boardSize + (c - 1));
      if (c < boardSize - 1) neighbors.push(r * boardSize + (c + 1));
      neighborsTable[idx] = neighbors;
    }
  }

  let currentTurn: PlayerColor = COLOR_RED;
  let stepCount = 0;
  let gameOver = false;
  let winner: Winner = null;
  let winReason = "";

  function cellIndex(row: number, col: number): number {
    return row * boardSize + col;
  }

  function isValidMove(row: number, col: number, playerColor: PlayerColor): boolean {
    if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return false;
    if (gameOver) return false;
    const idx = cellIndex(row, col);
    const cellColor = colors[idx];
    return cellColor === COLOR_EMPTY || cellColor === playerColor;
  }

  function makeMove(row: number, col: number, playerColor: PlayerColor): MoveResult | null {
    if (!isValidMove(row, col, playerColor)) return null;
    if (playerColor !== currentTurn) return null;

    const idx = cellIndex(row, col);
    counts[idx] += 1;
    colors[idx] = playerColor;
    stepCount++;

    const explosionResult = processExplosions(idx);

    currentTurn = currentTurn === COLOR_RED ? COLOR_BLUE : COLOR_RED;

    if (explosionResult.winner) {
      gameOver = true;
      winner = explosionResult.winner;
      winReason = explosionResult.winReason;
    } else if (winMode === WIN_MODE_STEPS && winParam !== undefined && stepCount >= winParam) {
      const result = checkStepsWin();
      if (result) {
        gameOver = true;
        winner = result.winner;
        winReason = result.winReason;
      }
    }

    return {
      animationFrames: explosionResult.animationFrames,
      winner,
      winReason,
      gameOver,
    };
  }

  function processExplosions(startIdx: number): {
    animationFrames: AnimationFrame[];
    winner: Winner;
    winReason: string;
  } {
    const animationFrames: AnimationFrame[] = [];
    let explWinner: Winner = null;
    let explWinReason = "";

    if (counts[startIdx]! < capacities[startIdx]!) {
      return { animationFrames, winner: null, winReason: "" };
    }

    const queue = [startIdx];
    let queueHead = 0;

    while (queueHead < queue.length) {
      const currentIdx = queue[queueHead++]!;

      if (counts[currentIdx]! < capacities[currentIdx]!) continue;

      const explodingColor = colors[currentIdx]!;
      counts[currentIdx] = 0;

      const neighbors = neighborsTable[currentIdx]!;
      for (let i = 0; i < neighbors.length; i++) {
        const nIdx = neighbors[i]!;
        counts[nIdx] += 1;
        colors[nIdx] = explodingColor;

        if (counts[nIdx]! >= capacities[nIdx]!) {
          queue.push(nIdx);
        }
      }

      animationFrames.push({
        explodedCell: currentIdx,
        affectedCells: neighbors.slice(),
      });

      if (stepCount >= 2) {
        const checkResult = checkExplosionWin();
        if (checkResult) {
          explWinner = checkResult.winner;
          explWinReason = checkResult.winReason;
          break;
        }
      }
    }

    return { animationFrames, winner: explWinner, winReason: explWinReason };
  }

  function checkExplosionWin(): { winner: PlayerColor; winReason: string } | null {
    if (winMode === WIN_MODE_ANNIHILATION) {
      let redCount = 0;
      let blueCount = 0;
      for (let i = 0; i < totalCells; i++) {
        if (colors[i] === COLOR_RED) redCount++;
        else if (colors[i] === COLOR_BLUE) blueCount++;
      }
      if (redCount > 0 && blueCount === 0) {
        return { winner: COLOR_RED, winReason: "歼灭对手所有棋子" };
      }
      if (blueCount > 0 && redCount === 0) {
        return { winner: COLOR_BLUE, winReason: "歼灭对手所有棋子" };
      }
    } else if (winMode === WIN_MODE_AREA && winParam !== undefined) {
      let redCount = 0;
      let blueCount = 0;
      for (let i = 0; i < totalCells; i++) {
        if (colors[i] === COLOR_RED) redCount++;
        else if (colors[i] === COLOR_BLUE) blueCount++;
      }
      if (redCount >= winParam) {
        return { winner: COLOR_RED, winReason: `率先占据 ${winParam} 格` };
      }
      if (blueCount >= winParam) {
        return { winner: COLOR_BLUE, winReason: `率先占据 ${winParam} 格` };
      }
    }
    return null;
  }

  function checkStepsWin(): { winner: Winner; winReason: string } | null {
    let redCount = 0;
    let blueCount = 0;
    for (let i = 0; i < totalCells; i++) {
      if (colors[i] === COLOR_RED) redCount++;
      else if (colors[i] === COLOR_BLUE) blueCount++;
    }
    if (redCount > blueCount) {
      return {
        winner: COLOR_RED,
        winReason: `${winParam} 步后占据更多面积 (${redCount} vs ${blueCount})`,
      };
    }
    if (blueCount > redCount) {
      return {
        winner: COLOR_BLUE,
        winReason: `${winParam} 步后占据更多面积 (${blueCount} vs ${redCount})`,
      };
    }
    return {
      winner: "draw",
      winReason: `${winParam} 步后双方面积相同 (${redCount})`,
    };
  }

  function computeHash(): number {
    let hash = 0;
    for (let i = 0; i < totalCells; i++) {
      hash = (hash * 31 + counts[i]! * 7 + colors[i]! * 13) | 0;
    }
    return hash;
  }

  function getCellCounts(): { red: number; blue: number } {
    let redCount = 0;
    let blueCount = 0;
    for (let i = 0; i < totalCells; i++) {
      if (colors[i] === COLOR_RED) redCount++;
      else if (colors[i] === COLOR_BLUE) blueCount++;
    }
    return { red: redCount, blue: blueCount };
  }

  function getFullState(): FullState {
    return {
      counts: Array.from(counts),
      colors: Array.from(colors),
      currentTurn,
      stepCount,
      gameOver,
      winner,
      winReason,
    };
  }

  function loadFullState(state: FullState): void {
    counts.set(state.counts);
    colors.set(state.colors);
    currentTurn = state.currentTurn;
    stepCount = state.stepCount;
    gameOver = state.gameOver;
    winner = state.winner;
    winReason = state.winReason;
  }

  function getCell(row: number, col: number) {
    const idx = cellIndex(row, col);
    return {
      count: counts[idx]!,
      color: colors[idx]!,
      capacity: capacities[idx]!,
    };
  }

  function forceGameOver(winnerVal: Winner, reason?: string): void {
    gameOver = true;
    winner = winnerVal;
    winReason = reason || "";
  }

  function reset(): void {
    counts.fill(0);
    colors.fill(0);
    currentTurn = COLOR_RED;
    stepCount = 0;
    gameOver = false;
    winner = null;
    winReason = "";
  }

  return {
    get boardSize() {
      return boardSize;
    },
    get currentTurn() {
      return currentTurn;
    },
    get stepCount() {
      return stepCount;
    },
    get gameOver() {
      return gameOver;
    },
    get winner() {
      return winner;
    },
    get winReason() {
      return winReason;
    },
    get config() {
      return { boardSize, winMode, winParam };
    },
    get counts() {
      return counts;
    },
    get colors() {
      return colors;
    },
    get capacities() {
      return capacities;
    },
    isValidMove,
    makeMove,
    computeHash,
    getCellCounts,
    getFullState,
    loadFullState,
    getCell,
    reset,
    forceGameOver,
    cellIndex,
  };
}
