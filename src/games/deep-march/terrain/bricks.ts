/**
 * Sparse 8³ bricks for the column mesher (mesher.ts, mesh-only jobs).
 *
 * A level-0 column is 35 × 243 × 35 padded lattice points but the surface passes
 * through ~1.4 % of its cells; the dense passes (sample bookkeeping, density
 * assembly, the anchored flood, the marching-cubes scan) touched every point.
 * Here the padded grid is split into 8³ bricks and each pass works per brick:
 *  - resolveCoarse: coarse pre-pass 4 → 2 → 1: step-4 cells whose 8 corner nodes
 *    are all beyond REFINE_MARGIN4 of iso are certain (water / rock) as a whole;
 *    the rest go to step-2 cells (REFINE_MARGIN), the rest stay for exact
 *    evaluation (margins: 2× the largest gap that still missed a sign,
 *    measured by scripts/deep-march-bricks-test.ts);
 *  - resolveNeed: final-point status (certain water / rock / uncertain) with a
 *    sliding window over the raw taps, seeds (uncertain or bordering the opposite
 *    status) only in bricks that are not uniform with uniform face neighbours,
 *    the 2-point dilation only over active bricks (26-neighbourhood of seed
 *    bricks), exact samples only there;
 *  - assemble: density sums only where the mesh can read them (need points);
 *    uniform bricks are filled with their status;
 *  - floodKeep: the anchored flood (26-connectivity) marks whole all-rock bricks
 *    at once and walks points only inside mixed bricks;
 *  - cellMask: marching-cubes cells in bricks whose corners all share a sign are
 *    skipped (same scan order → same vertex order).
 * The output is bit-identical to the dense mesher (?bricks=0) as long as the
 * margins hold: every value the mesh reads (sign-change corners and their
 * gradient neighbours) is still an exact evaluation, every sign is unchanged.
 */
import { REFINE_STEP } from "./refine";

export const BRICK = 8;
const SH = 3;

/** Step-4 coarse margin (density units) per LOD level; levels without an entry skip the step-4 pass. */
export const REFINE_MARGIN4: readonly number[] = [36];

// raw sample classes (mesher / refine): 0 unknown, 1 sure water (bound), 2 deep-rock cap (exact), 3/4 coarse water / rock
const C_WATER = 3;
const C_SOLID = 4;
const isWaterCls = (c: number) => c === 1 || c === C_WATER;
const isSolidCls = (c: number) => c === 2 || c === C_SOLID;

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
function cellLo(c: number, len: number, step: number): number {
  const last = len - 1;
  const maxLo = last - (last % step === 0 ? step : last % step);
  return Math.max(0, Math.min(c - (c % step), maxLo));
}
/** Cell lows along an axis, and the last sample index each cell owns. */
function cells(len: number, step: number): { lo: number[]; end: number[] } {
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

/**
 * Coarse pre-pass 4 → 2 → 1 (see file comment). Resolved samples only get a class
 * (their values are never read: a resolved sample the mesh can see is re-evaluated).
 * m4 = null skips the step-4 level. Returns the number of exact node evaluations.
 */
export function resolveCoarse(
  g: RawGrid,
  iso: number,
  m4: number | null,
  m2: number,
  sampleRaw: (i: number, r: number, k: number) => number,
  rawClass: (i: number, r: number, k: number, bnd: Float64Array) => number,
): number {
  const { px, RY, pz, rawNeed, cls, raw, exact } = g;
  const cache = scratchF32("coarseCache", px * RY * pz).fill(NaN);
  const bnd = new Float64Array(1);
  let evals = 0;
  const node = (i: number, r: number, k: number): number => {
    const idx = (k * RY + r) * px + i;
    let v = cache[idx];
    if (v === v) return v;
    const c = rawNeed[r] ? cls[idx] : rawClass(i, r, k, bnd);
    if (c !== 0) v = rawNeed[r] ? raw[idx] : bnd[0];
    else {
      v = sampleRaw(i, r, k);
      evals++;
      if (rawNeed[r]) {
        raw[idx] = v;
        exact[idx] = 1;
      }
    }
    cache[idx] = v;
    return v;
  };
  /** Classify the unknown samples of box [i0..i1]×[r0..r1]×[k0..k1] against the corner nodes (ci0, ci1 …). */
  const unknownIn = (i0: number, i1: number, r0: number, r1: number, k0: number, k1: number): boolean => {
    for (let r = r0; r <= r1; r++) {
      if (!rawNeed[r]) continue;
      for (let k = k0; k <= k1; k++) {
        const row = (k * RY + r) * px;
        for (let i = i0; i <= i1; i++) if (cls[row + i] === 0) return true;
      }
    }
    return false;
  };
  const tryCell = (a0: number, a1: number, b0: number, b1: number, c0: number, c1: number, m: number, i0: number, i1: number, r0: number, r1: number, k0: number, k1: number): boolean => {
    let mn = Infinity, mx = -Infinity;
    for (const kk of [c0, c1]) for (const rr of [b0, b1]) for (const ii of [a0, a1]) {
      const v = node(ii, rr, kk);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const to = mx < iso - m ? C_WATER : mn > iso + m ? C_SOLID : 0;
    if (!to) return false;
    for (let r = r0; r <= r1; r++) {
      if (!rawNeed[r]) continue;
      for (let k = k0; k <= k1; k++) {
        const row = (k * RY + r) * px;
        for (let i = i0; i <= i1; i++) if (cls[row + i] === 0) cls[row + i] = to;
      }
    }
    return true;
  };
  const step2 = REFINE_STEP;
  const step4 = step2 * 2;
  const X4 = cells(px, step4), Y4 = cells(RY, step4), Z4 = cells(pz, step4);
  const X2 = cells(px, step2), Y2 = cells(RY, step2), Z2 = cells(pz, step2);
  const nextNode = (lo: number, len: number, step: number) => Math.min(lo + step, len - 1);
  // sub-cells (step 2) inside [lo, end] along an axis
  const subs = (C: { lo: number[]; end: number[] }, from: number, to: number) => {
    const out: number[] = [];
    for (let q = 0; q < C.lo.length; q++) if (C.lo[q] >= from && C.end[q] <= to) out.push(q);
    return out;
  };
  const xs = X4.lo.map((l, q) => subs(X2, l, X4.end[q]));
  const ys = Y4.lo.map((l, q) => subs(Y2, l, Y4.end[q]));
  const zs = Z4.lo.map((l, q) => subs(Z2, l, Z4.end[q]));
  for (let cz = 0; cz < Z4.lo.length; cz++) {
    const k0 = Z4.lo[cz], k1 = Z4.end[cz];
    for (let cy = 0; cy < Y4.lo.length; cy++) {
      const r0 = Y4.lo[cy], r1 = Y4.end[cy];
      for (let cx = 0; cx < X4.lo.length; cx++) {
        const i0 = X4.lo[cx], i1 = X4.end[cx];
        if (!unknownIn(i0, i1, r0, r1, k0, k1)) continue;
        if (m4 !== null && tryCell(i0, nextNode(i0, px, step4), r0, nextNode(r0, RY, step4), k0, nextNode(k0, pz, step4), m4, i0, i1, r0, r1, k0, k1)) continue;
        for (const qz of zs[cz]) for (const qy of ys[cy]) for (const qx of xs[cx]) {
          const a0 = X2.lo[qx], a1 = X2.end[qx], b0 = Y2.lo[qy], b1 = Y2.end[qy], c0 = Z2.lo[qz], c1 = Z2.end[qz];
          if (!unknownIn(a0, a1, b0, b1, c0, c1)) continue;
          tryCell(a0, nextNode(a0, px, step2), b0, nextNode(b0, RY, step2), c0, nextNode(c0, pz, step2), m2, a0, a1, b0, b1, c0, c1);
        }
      }
    }
  }
  return evals;
}

export type NeedResult = {
  /** Final-point status: 1 certain water, 2 certain rock, 0 uncertain (index (k·py + j)·px + i). */
  fs: Uint8Array;
  /** Exact density needed (within 2 points of a seed). */
  need: Uint8Array;
  /** Per brick: 1 = active (a seed brick or next to one). */
  active: Uint8Array;
  /** Per brick: 1 all certain water, 2 all certain rock, 0 otherwise. */
  brickFs: Uint8Array;
};

/**
 * Final-point status, seeds, need (2-point dilation) and the exact evaluations,
 * brick-sparse. R: raw-row padding of the vertical smoothing (taps j … j + 2R).
 */
export function resolveNeed(
  g: RawGrid,
  B: BrickGrid,
  R: number,
  rowSkip: Uint8Array,
  rowKind: Uint8Array,
  sampleRaw: (i: number, r: number, k: number) => number,
): { res: NeedResult; evals: number } {
  const { px, py, pz, bx, by, bz } = B;
  const { RY, cls, raw, exact } = g;
  const plane = px * py;
  const size = plane * pz;
  const taps = 2 * R + 1;
  const fs = scratchU8("fs", size);
  const brickFs = scratchU8("brickFs", B.count).fill(255);
  const merge = (b: number, f: number) => {
    const o = brickFs[b];
    brickFs[b] = o === 255 ? f : o === f ? f : 0;
  };
  // 1. status per final point: sliding window over the raw taps of each (i, k) line
  for (let k = 0; k < pz; k++) {
    const bk = (k >> SH) * by;
    for (let i = 0; i < px; i++) {
      const bi = i >> SH;
      let w = 0, sd = 0;
      const base = k * RY * px + i;
      for (let t = 0; t < taps - 1; t++) {
        const c = cls[base + t * px];
        if (isWaterCls(c)) w++;
        else if (isSolidCls(c)) sd++;
      }
      for (let j = 0; j < py; j++) {
        const cin = cls[base + (j + taps - 1) * px];
        if (isWaterCls(cin)) w++;
        else if (isSolidCls(cin)) sd++;
        let f: number;
        if (rowSkip[j]) f = rowKind[j] === 2 ? 2 : 1;
        else f = w === taps ? 1 : sd === taps ? 2 : 0;
        fs[(k * py + j) * px + i] = f;
        merge((bk + (j >> SH)) * bx + bi, f);
        const cout = cls[base + j * px];
        if (isWaterCls(cout)) w--;
        else if (isSolidCls(cout)) sd--;
      }
    }
  }
  // 2. seeds: uncertain, or a 6-neighbour with the opposite certain status — only
  //    in bricks that aren't uniform with identical face neighbours
  const seeds = scratchU8("seeds", size).fill(0);
  const seedBrick = scratchU8("seedBrick", B.count).fill(0);
  for (let cz = 0; cz < bz; cz++)
    for (let cy = 0; cy < by; cy++)
      for (let cx = 0; cx < bx; cx++) {
        const b = (cz * by + cy) * bx + cx;
        const f = brickFs[b];
        if (f === 1 || f === 2) {
          let same = true;
          if (cx > 0 && brickFs[b - 1] !== f) same = false;
          else if (cx < bx - 1 && brickFs[b + 1] !== f) same = false;
          else if (cy > 0 && brickFs[b - bx] !== f) same = false;
          else if (cy < by - 1 && brickFs[b + bx] !== f) same = false;
          else if (cz > 0 && brickFs[b - bx * by] !== f) same = false;
          else if (cz < bz - 1 && brickFs[b + bx * by] !== f) same = false;
          if (same) continue;
        }
        const i1 = Math.min(px, (cx + 1) << SH), j1 = Math.min(py, (cy + 1) << SH), k1 = Math.min(pz, (cz + 1) << SH);
        let any = 0;
        for (let k = cz << SH; k < k1; k++)
          for (let j = cy << SH; j < j1; j++) {
            const row = (k * py + j) * px;
            for (let i = cx << SH; i < i1; i++) {
              const idx = row + i;
              const v = fs[idx];
              if (v === 0) {
                seeds[idx] = 1;
                any = 1;
                continue;
              }
              const o = 3 - v;
              if ((i > 0 && fs[idx - 1] === o) || (i < px - 1 && fs[idx + 1] === o) || (j > 0 && fs[idx - px] === o) || (j < py - 1 && fs[idx + px] === o) || (k > 0 && fs[idx - plane] === o) || (k < pz - 1 && fs[idx + plane] === o)) {
                seeds[idx] = 1;
                any = 1;
              }
            }
          }
        seedBrick[b] = any;
      }
  // 3. active bricks = seed bricks dilated by one brick (26-neighbourhood; the 2-point dilation stays inside)
  const active = scratchU8("active", B.count).fill(0);
  const activeList: number[] = [];
  for (let cz = 0; cz < bz; cz++)
    for (let cy = 0; cy < by; cy++)
      for (let cx = 0; cx < bx; cx++) {
        if (!seedBrick[(cz * by + cy) * bx + cx]) continue;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const x = cx + dx, y = cy + dy, z = cz + dz;
              if (x < 0 || y < 0 || z < 0 || x >= bx || y >= by || z >= bz) continue;
              const nb = (z * by + y) * bx + x;
              if (!active[nb]) {
                active[nb] = 1;
                activeList.push(nb);
              }
            }
      }
  // 4. need = seeds dilated by 2 (Chebyshev), separable, over active bricks only
  const tmp = scratchU8("needTmp", size).fill(0);
  const need = scratchU8("need", size).fill(0);
  const pass = (from: Uint8Array, to: Uint8Array, axis: number) => {
    const len = axis === 0 ? px : axis === 1 ? py : pz;
    const stride = axis === 0 ? 1 : axis === 1 ? px : plane;
    for (const b of activeList) {
      const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
      const i1 = Math.min(px, (cx + 1) << SH), j1 = Math.min(py, (cy + 1) << SH), k1 = Math.min(pz, (cz + 1) << SH);
      for (let k = cz << SH; k < k1; k++)
        for (let j = cy << SH; j < j1; j++) {
          const row = (k * py + j) * px;
          for (let i = cx << SH; i < i1; i++) {
            const idx = row + i;
            if (!from[idx]) continue;
            const c = axis === 0 ? i : axis === 1 ? j : k;
            const lo = Math.max(0, c - 2) - c, hi = Math.min(len - 1, c + 2) - c;
            for (let d = lo; d <= hi; d++) to[idx + d * stride] = 1;
          }
        }
    }
  };
  pass(seeds, tmp, 0);
  seeds.fill(0);
  pass(tmp, seeds, 1);
  pass(seeds, need, 2);
  // 5. exact samples: every raw tap of a need point (unless exact already)
  let evals = 0;
  for (const b of activeList) {
    const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
    const i1 = Math.min(px, (cx + 1) << SH), j1 = Math.min(py, (cy + 1) << SH), k1 = Math.min(pz, (cz + 1) << SH);
    for (let k = cz << SH; k < k1; k++)
      for (let j = cy << SH; j < j1; j++) {
        if (rowSkip[j]) continue;
        const row = (k * py + j) * px;
        for (let i = cx << SH; i < i1; i++) {
          if (!need[row + i]) continue;
          for (let t = 0; t < taps; t++) {
            const idx = (k * RY + j + t) * px + i;
            if (cls[idx] === 2 || exact[idx]) continue;
            raw[idx] = sampleRaw(i, j + t, k);
            exact[idx] = 1;
            evals++;
          }
        }
      }
  }
  return { res: { fs, need, active, brickFs }, evals };
}

/**
 * Density + state of the padded grid. Need points get the exact smoothed value;
 * everything else only its (certain) side of iso.
 */
export function assemble(
  B: BrickGrid,
  n: NeedResult,
  raw: Float32Array,
  RY: number,
  SW: readonly number[],
  K: number,
  rowSkip: Uint8Array,
  rowKind: Uint8Array,
  rowFill: Float64Array,
  iso: number,
  dens: Float32Array,
  state: Uint8Array,
): void {
  const { px, py, pz, bx, by } = B;
  const half = (SW.length - 1) / 2;
  const R = half * K;
  const { fs, need, active, brickFs } = n;
  const wLo = iso - 1, sHi = iso + 1;
  for (let k = 0; k < pz; k++) {
    const rk = k * RY * px;
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      if (rowSkip[j]) {
        dens.fill(rowFill[j], row, row + px);
        state.fill(rowKind[j] === 2 ? SOLID : WATER, row, row + px);
        continue;
      }
      const c = rk + (j + R) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i0 = 0; i0 < px; i0 += BRICK) {
        const i1 = Math.min(px, i0 + BRICK);
        const b = bj + (i0 >> SH);
        if (!active[b]) {
          const solid = brickFs[b] === 2;
          dens.fill(solid ? sHi : wLo, row + i0, row + i1);
          state.fill(solid ? SOLID : WATER, row + i0, row + i1);
          continue;
        }
        for (let i = i0; i < i1; i++) {
          if (!need[row + i]) {
            const solid = fs[row + i] === 2;
            dens[row + i] = solid ? sHi : wLo;
            state[row + i] = solid ? SOLID : WATER;
            continue;
          }
          let v = 0;
          for (let t = 0; t < SW.length; t++) v += SW[t] * raw[c + (t - half) * K * px + i];
          dens[row + i] = v;
          state[row + i] = v >= iso ? SOLID : WATER;
        }
      }
    }
  }
}

const NB: number[] = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NB.push(dx, dy, dz);

/**
 * Anchored flood (26-connectivity) from the `sp` seed points on `stack`: every
 * SOLID point connected to them becomes KEEP. All-rock bricks are marked whole.
 */
export function floodKeep(B: BrickGrid, state: Uint8Array, stack: Int32Array, sp: number): void {
  const { px, py, pz, bx, by, bz } = B;
  const plane = px * py;
  // bricks whose points are all rock (SOLID or KEEP)
  const rockCnt = scratchI32("rockCnt", B.count).fill(0);
  for (let k = 0; k < pz; k++) {
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i = 0; i < px; i++) if (state[row + i] !== WATER) rockCnt[bj + (i >> SH)]++;
    }
  }
  const full = scratchU8("fullBrick", B.count);
  const lo = (c: number) => c << SH;
  const hiX = (c: number) => Math.min(px, (c + 1) << SH), hiY = (c: number) => Math.min(py, (c + 1) << SH), hiZ = (c: number) => Math.min(pz, (c + 1) << SH);
  for (let cz = 0; cz < bz; cz++)
    for (let cy = 0; cy < by; cy++)
      for (let cx = 0; cx < bx; cx++) {
        const b = (cz * by + cy) * bx + cx;
        const vol = (hiX(cx) - lo(cx)) * (hiY(cy) - lo(cy)) * (hiZ(cz) - lo(cz));
        // 0 = has water (walk points), 1 = all rock not yet flooded, 2 = flooded, 3 = no rock at all
        full[b] = rockCnt[b] === vol ? 1 : rockCnt[b] === 0 ? 3 : 0;
      }
  const bstack = scratchI32("bstack", B.count);
  let bs = 0;
  const floodBrick = (b: number) => {
    full[b] = 2;
    const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
    const i1 = hiX(cx), j1 = hiY(cy), k1 = hiZ(cz);
    for (let k = lo(cz); k < k1; k++)
      for (let j = lo(cy); j < j1; j++) {
        const row = (k * py + j) * px;
        for (let i = lo(cx); i < i1; i++) if (state[row + i] === SOLID) state[row + i] = KEEP;
      }
    bstack[bs++] = b;
  };
  while (sp > 0 || bs > 0) {
    if (bs > 0) {
      const b = bstack[--bs];
      const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
      for (let q = 0; q < NB.length; q += 3) {
        const dx = NB[q], dy = NB[q + 1], dz = NB[q + 2];
        const x = cx + dx, y = cy + dy, z = cz + dz;
        if (x < 0 || y < 0 || z < 0 || x >= bx || y >= by || z >= bz) continue;
        const nb = (z * by + y) * bx + x;
        const f = full[nb];
        if (f === 1) {
          floodBrick(nb);
          continue;
        }
        if (f !== 0) continue;
        // mixed neighbour: its points within one step of this brick
        const i0 = dx === 0 ? lo(x) : dx > 0 ? lo(x) : hiX(x) - 1, i1 = dx === 0 ? hiX(x) - 1 : i0;
        const j0 = dy === 0 ? lo(y) : dy > 0 ? lo(y) : hiY(y) - 1, j1 = dy === 0 ? hiY(y) - 1 : j0;
        const k0 = dz === 0 ? lo(z) : dz > 0 ? lo(z) : hiZ(z) - 1, k1 = dz === 0 ? hiZ(z) - 1 : k0;
        for (let k = k0; k <= k1; k++)
          for (let j = j0; j <= j1; j++) {
            const row = (k * py + j) * px;
            for (let i = i0; i <= i1; i++)
              if (state[row + i] === SOLID) {
                state[row + i] = KEEP;
                stack[sp++] = row + i;
              }
          }
      }
      continue;
    }
    const idx = stack[--sp];
    const i = idx % px;
    const j = ((idx - i) / px) % py;
    const k = (idx - j * px - i) / plane;
    for (let q = 0; q < NB.length; q += 3) {
      const ii = i + NB[q], jj = j + NB[q + 1], kk = k + NB[q + 2];
      if (ii < 0 || jj < 0 || kk < 0 || ii >= px || jj >= py || kk >= pz) continue;
      const nidx = (kk * py + jj) * px + ii;
      if (state[nidx] !== SOLID) continue;
      const nb = ((kk >> SH) * by + (jj >> SH)) * bx + (ii >> SH);
      if (full[nb] === 1) floodBrick(nb);
      else {
        state[nidx] = KEEP;
        stack[sp++] = nidx;
      }
    }
  }
}

/**
 * Marching-cubes skip mask over cell bricks: cell (i, j, k) (corners at padded
 * i+1 … i+2 etc.) lies in cell brick (i>>3, j>>3, k>>3); 1 = every corner of every
 * cell in it has the same sign (KEEP = rock after floater removal), no triangles.
 */
export function cellMask(B: BrickGrid, state: Uint8Array): { mask: Uint8Array; cbx: number; cby: number } {
  const { px, py, pz, bx, by, bz } = B;
  // per point brick: bit 1 = has rock, bit 2 = has water
  const sign = scratchU8("signBrick", B.count).fill(0);
  for (let k = 0; k < pz; k++) {
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i = 0; i < px; i++) sign[bj + (i >> SH)] |= state[row + i] === KEEP ? 1 : 2;
    }
  }
  // cells: i ∈ [0, px − 3]; cell brick c covers corners [8c + 1, 8c + 9] → point bricks c, c + 1
  const cbx = (px - 2 + BRICK - 1) >> SH, cby = (py - 2 + BRICK - 1) >> SH, cbz = (pz - 2 + BRICK - 1) >> SH;
  const mask = scratchU8("cellMask", cbx * cby * cbz);
  for (let cz = 0; cz < cbz; cz++)
    for (let cy = 0; cy < cby; cy++)
      for (let cx = 0; cx < cbx; cx++) {
        let m = 0;
        for (let dz = 0; dz <= 1; dz++)
          for (let dy = 0; dy <= 1; dy++)
            for (let dx = 0; dx <= 1; dx++) {
              const x = cx + dx, y = cy + dy, z = cz + dz;
              if (x >= bx || y >= by || z >= bz) continue;
              m |= sign[(z * by + y) * bx + x];
            }
        mask[(cz * cby + cy) * cbx + cx] = m === 1 || m === 2 ? 1 : 0;
      }
  return { mask, cbx, cby };
}
