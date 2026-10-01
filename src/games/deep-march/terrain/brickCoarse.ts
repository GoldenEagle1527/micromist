/** Sparse bricks: the coarse pre-pass 4 → 2 → 1 (see bricks.ts for the whole scheme). */
import { C_SOLID, C_WATER, type RawGrid, cells, scratchF32 } from "./brickBase";
import { REFINE_STEP } from "./refine";

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
