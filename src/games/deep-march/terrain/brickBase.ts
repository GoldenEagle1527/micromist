/**
 * Shared parts of the sparse 8³ bricks (bricks.ts): brick size, raw sample
 * classes, point states, the brick grid, per-worker scratch buffers and the
 * coarse cell helpers (the same cells as refine.ts).
 */
export const BRICK = 8;
export const SH = 3;

/** Step-4 coarse margin (density units) per LOD level; levels without an entry skip the step-4 pass. */
export const REFINE_MARGIN4: readonly number[] = [36];

// raw sample classes (mesher / refine): 0 unknown, 1 sure water (bound), 2 deep-rock cap (exact), 3/4 coarse water / rock
export const C_WATER = 3;
export const C_SOLID = 4;
export const isWaterCls = (c: number) => c === 1 || c === C_WATER;
export const isSolidCls = (c: number) => c === 2 || c === C_SOLID;

// point states (mesher.ts)
export const WATER = 0;
export const SOLID = 1;
export const KEEP = 2;
export const REMOVED = 3;

export type BrickGrid = { px: number; py: number; pz: number; bx: number; by: number; bz: number; count: number };

export function brickGrid(px: number, py: number, pz: number): BrickGrid {
  const bx = (px + BRICK - 1) >> SH, by = (py + BRICK - 1) >> SH, bz = (pz + BRICK - 1) >> SH;
  return { px, py, pz, bx, by, bz, count: bx * by * bz };
}

// ---- scratch buffers (one job at a time per worker: reused, no per-column garbage)
const pool = new Map<string, ArrayBufferView>();
function scratch<T extends Uint8Array | Int32Array | Float32Array>(tag: string, ctor: { new (n: number): T }, n: number): T {
  let a = pool.get(tag) as T | undefined;
  if (!a || a.length < n) {
    a = new ctor(Math.ceil(n * 1.25));
    pool.set(tag, a);
  }
  return a.subarray(0, n) as T;
}
export const scratchU8 = (tag: string, n: number) => scratch(tag, Uint8Array, n);
export const scratchI32 = (tag: string, n: number) => scratch(tag, Int32Array, n);
export const scratchF32 = (tag: string, n: number) => scratch(tag, Float32Array, n);

/** Cell [lo, hi] on one axis of `len` points with coarse nodes every `step` (plus the last point) — as refine.ts. */
export function cellLo(c: number, len: number, step: number): number {
  const last = len - 1;
  const maxLo = last - (last % step === 0 ? step : last % step);
  return Math.max(0, Math.min(c - (c % step), maxLo));
}
/** Cell lows along an axis, and the last sample index each cell owns. */
export function cells(len: number, step: number): { lo: number[]; end: number[] } {
  const lo: number[] = [], end: number[] = [];
  for (let c = 0; c < len; c++) {
    const l = cellLo(c, len, step);
    if (lo.length === 0 || lo[lo.length - 1] !== l) {
      lo.push(l);
      end.push(c);
    } else end[end.length - 1] = c;
  }
  return { lo, end };
}

export type RawGrid = {
  px: number;
  RY: number;
  pz: number;
  rawNeed: Uint8Array;
  cls: Uint8Array;
  raw: Float32Array;
  /** 1 where raw holds an exact evaluation (coarse node or evaluated sample). */
  exact: Uint8Array;
};
