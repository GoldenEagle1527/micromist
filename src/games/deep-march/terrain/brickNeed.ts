/** Sparse bricks: final-point status, seeds, need and the exact evaluations (see bricks.ts for the whole scheme). */
import { type BrickGrid, type RawGrid, SH, isSolidCls, isWaterCls, scratchU8 } from "./brickBase";

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
