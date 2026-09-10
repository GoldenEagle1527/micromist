/** Pure engine for Chroma Slide / 滑动色块 */

export type PresetId = "easy" | "normal" | "hard";

export type Preset = {
  id: PresetId;
  size: number;
  colorCount: number;
  /** Target solid square side for each color (win shape). */
  squareSide: number;
};

/**
 * Difficulty = board & block size. Always 4 colors → 2×2 grid of equal squares.
 * size = squareSide × 2. Empty punches one cell inside the packing.
 *
 * easy   6×6:  4 × (3×3) — learn the slide + gather
 * normal 8×8:  4 × (4×4) — standard session
 * hard   10×10: 4 × (5×5) — denser herd, still phone-OK
 */
export const PRESETS: Record<PresetId, Preset> = {
  easy: { id: "easy", size: 6, colorCount: 4, squareSide: 3 },
  normal: { id: "normal", size: 8, colorCount: 4, squareSide: 4 },
  hard: { id: "hard", size: 10, colorCount: 4, squareSide: 5 },
};

/** Map legacy small/medium/large ids (old saves / scores). */
export function normalizePresetId(raw: unknown): PresetId | null {
  if (raw === "easy" || raw === "normal" || raw === "hard") return raw;
  if (raw === "small") return "easy";
  if (raw === "medium") return "normal";
  if (raw === "large") return "hard";
  return null;
}

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

/** @deprecated kept for call sites that only need a label — always `side×side`. */
export function squareLabel(side: number): string {
  return `${side}×${side}`;
}

function assertPreset(p: Preset): void {
  const cells = p.size * p.size;
  const block = p.squareSide * p.squareSide;
  if (p.colorCount * block !== cells) {
    throw new Error(
      `Preset ${p.id}: ${p.colorCount}×${p.squareSide}² ≠ ${p.size}×${p.size}`,
    );
  }
  if (p.size % p.squareSide !== 0) {
    throw new Error(
      `Preset ${p.id}: size ${p.size} not divisible by squareSide ${p.squareSide}`,
    );
  }
  const grid = p.size / p.squareSide;
  if (grid * grid !== p.colorCount) {
    throw new Error(
      `Preset ${p.id}: colorCount ${p.colorCount} ≠ (${grid})² grid`,
    );
  }
}

// Fail fast if a preset is ever reintroduced without a legal end state.
for (const p of Object.values(PRESETS)) assertPreset(p);

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
  const { size, colorCount, squareSide } = preset;
  const cells = size * size;
  const per = squareSide * squareSide;

  // Full packing of squares, then poke one empty (one color loses a tile).
  const tiles: number[] = [];
  for (let c = 0; c < colorCount; c++) {
    for (let i = 0; i < per; i++) tiles.push(c);
  }
  shuffleInPlace(tiles, rng);
  const board: Board = tiles.slice();
  const emptyIndex = Math.floor(rng() * cells);
  board[emptyIndex] = EMPTY;

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
 * Win: each color forms exactly one axis-aligned square of preset.squareSide.
 * The single empty may sit inside one color's square (that color is short one
 * tile) or, theoretically, outside — but with a perfect square packing the
 * empty always lands inside some block's cells when solved as a grid.
 */
export function isWon(state: PuzzleState): boolean {
  const { size, colorCount, board, preset } = state;
  const side = PRESETS[preset].squareSide;
  const target = side * side;

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
    // Every color must appear (empty removes at most one tile from one color).
    if (count === 0) return false;
    if (count !== target && count !== target - 1) return false;

    const h = maxR - minR + 1;
    const w = maxC - minC + 1;
    if (h !== side || w !== side) return false;

    let emptyInBox = 0;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const v = board[rcToIndex(r, c, size)];
        if (v === color) continue;
        if (v === EMPTY) {
          emptyInBox++;
          continue;
        }
        return false; // foreign color inside this color's square
      }
    }
    if (count + emptyInBox !== target) return false;
    if (count === target - 1 && emptyInBox !== 1) return false;
    if (count === target && emptyInBox !== 0) return false;
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
 * Colorblind-friendly-ish distinct hues (need ≥4; extras reserved).
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
  "#ec407a", // pink
  "#6d4c41", // brown
  "#546e7a", // blue-grey
  "#c0ca33", // lime
  "#5e35b1", // deep purple
  "#00897b", // teal
  "#d81b60", // magenta
  "#3949ab", // indigo
  "#ff7043", // deep orange
];

if (TILE_COLORS.length < Math.max(...Object.values(PRESETS).map((x) => x.colorCount))) {
  throw new Error("TILE_COLORS shorter than largest preset colorCount");
}
