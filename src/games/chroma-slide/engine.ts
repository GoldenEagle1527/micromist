/** Pure engine for Chroma Slide / 滑动色块 */

export type PresetId = "small" | "medium" | "large";

export type Preset = {
  id: PresetId;
  size: number;
  colorCount: number;
  /** tiles per color; size² − 1 must equal colorCount × tilesPerColor */
  tilesPerColor: number;
};

export const PRESETS: Record<PresetId, Preset> = {
  small: { id: "small", size: 9, colorCount: 4, tilesPerColor: 20 },
  medium: { id: "medium", size: 13, colorCount: 6, tilesPerColor: 28 },
  large: { id: "large", size: 15, colorCount: 7, tilesPerColor: 32 },
};

/** Empty cell sentinel. Colored tiles are 0 .. colorCount-1. */
export const EMPTY = -1;

export type Board = number[]; // length size²; EMPTY or color id

export type PuzzleState = {
  preset: PresetId;
  size: number;
  colorCount: number;
  board: Board;
  emptyIndex: number;
  steps: number;
};

export type Rng = () => number; // [0, 1)

export function defaultRng(): Rng {
  return Math.random;
}

function assertPreset(p: Preset): void {
  const cells = p.size * p.size;
  if (p.colorCount * p.tilesPerColor !== cells - 1) {
    throw new Error(
      `Preset ${p.id}: ${p.colorCount}×${p.tilesPerColor} ≠ ${cells - 1}`,
    );
  }
}

/** Fisher–Yates shuffle in place. */
function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function newPuzzle(presetId: PresetId, rng: Rng = defaultRng()): PuzzleState {
  const preset = PRESETS[presetId];
  assertPreset(preset);
  const { size, colorCount, tilesPerColor } = preset;
  const cells = size * size;

  const tiles: number[] = [];
  for (let c = 0; c < colorCount; c++) {
    for (let i = 0; i < tilesPerColor; i++) tiles.push(c);
  }
  // Exactly one empty; pick its position among cells, then place shuffled tiles on the rest.
  const emptyIndex = Math.floor(rng() * cells);
  shuffleInPlace(tiles, rng);

  const board: Board = new Array(cells);
  let ti = 0;
  for (let i = 0; i < cells; i++) {
    if (i === emptyIndex) board[i] = EMPTY;
    else board[i] = tiles[ti++]!;
  }

  return {
    preset: presetId,
    size,
    colorCount,
    board,
    emptyIndex,
    steps: 0,
  };
}

export function indexToRC(index: number, size: number): { row: number; col: number } {
  return { row: Math.floor(index / size), col: index % size };
}

export function rcToIndex(row: number, col: number, size: number): number {
  return row * size + col;
}

/**
 * Click a tile on the same row or column as the empty cell.
 * Slides all tiles between empty and clicked toward the empty (15-puzzle multi-slide).
 * Returns a new state, or the same reference if the click is illegal.
 */
export function clickMove(state: PuzzleState, clickIndex: number): PuzzleState {
  const { size, board, emptyIndex } = state;
  if (clickIndex < 0 || clickIndex >= board.length) return state;
  if (clickIndex === emptyIndex) return state;
  if (board[clickIndex] === EMPTY) return state;

  const er = Math.floor(emptyIndex / size);
  const ec = emptyIndex % size;
  const cr = Math.floor(clickIndex / size);
  const cc = clickIndex % size;

  if (er !== cr && ec !== cc) return state; // not same row/col

  const next = board.slice();
  let newEmpty = emptyIndex;

  if (er === cr) {
    // Horizontal slide along row er
    if (cc < ec) {
      // click left of empty → tiles move right toward empty
      for (let c = ec; c > cc; c--) {
        next[rcToIndex(er, c, size)] = next[rcToIndex(er, c - 1, size)]!;
      }
      next[rcToIndex(er, cc, size)] = EMPTY;
      newEmpty = rcToIndex(er, cc, size);
    } else {
      // click right of empty → tiles move left toward empty
      for (let c = ec; c < cc; c++) {
        next[rcToIndex(er, c, size)] = next[rcToIndex(er, c + 1, size)]!;
      }
      next[rcToIndex(er, cc, size)] = EMPTY;
      newEmpty = rcToIndex(er, cc, size);
    }
  } else {
    // Vertical slide along col ec
    if (cr < er) {
      // click above empty → tiles move down toward empty
      for (let r = er; r > cr; r--) {
        next[rcToIndex(r, ec, size)] = next[rcToIndex(r - 1, ec, size)]!;
      }
      next[rcToIndex(cr, ec, size)] = EMPTY;
      newEmpty = rcToIndex(cr, ec, size);
    } else {
      // click below empty → tiles move up toward empty
      for (let r = er; r < cr; r++) {
        next[rcToIndex(r, ec, size)] = next[rcToIndex(r + 1, ec, size)]!;
      }
      next[rcToIndex(cr, ec, size)] = EMPTY;
      newEmpty = rcToIndex(cr, ec, size);
    }
  }

  return {
    ...state,
    board: next,
    emptyIndex: newEmpty,
    steps: state.steps + 1,
  };
}

/**
 * Win: each color forms exactly one axis-aligned rectangle.
 * The single empty may sit anywhere — including a corner of a color's
 * bounding box — as long as every bbox cell is either that color or EMPTY
 * (no foreign colors). Empty outside all bboxes is also fine.
 */
export function isWon(state: PuzzleState): boolean {
  const { size, colorCount, board } = state;
  for (let color = 0; color < colorCount; color++) {
    let minR = size;
    let maxR = -1;
    let minC = size;
    let maxC = -1;
    let count = 0;
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== color) continue;
      const r = Math.floor(i / size);
      const c = i % size;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      count++;
    }
    if (count === 0) continue;
    const area = (maxR - minR + 1) * (maxC - minC + 1);
    let emptyInBox = 0;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const v = board[rcToIndex(r, c, size)];
        if (v === color) continue;
        if (v === EMPTY) {
          emptyInBox++;
          continue;
        }
        return false; // foreign color inside this color's rectangle
      }
    }
    // Bounding box = this color's tiles + optional empties only
    if (count + emptyInBox !== area) return false;
  }
  return true;
}

/** Whether clicking this index would be a legal slide. */
export function isLegalClick(state: PuzzleState, clickIndex: number): boolean {
  if (clickIndex === state.emptyIndex) return false;
  if (state.board[clickIndex] === EMPTY) return false;
  const { size, emptyIndex } = state;
  const er = Math.floor(emptyIndex / size);
  const ec = emptyIndex % size;
  const cr = Math.floor(clickIndex / size);
  const cc = clickIndex % size;
  return er === cr || ec === cc;
}

/**
 * Colorblind-friendly-ish distinct hues for up to 7 colors.
 * Tuned for both light and dark surfaces.
 */
export const TILE_COLORS: readonly string[] = [
  "#e53935", // red
  "#1e88e5", // blue
  "#43a047", // green
  "#fdd835", // yellow
  "#8e24aa", // purple
  "#fb8c00", // orange
  "#00acc1", // cyan/teal
];
