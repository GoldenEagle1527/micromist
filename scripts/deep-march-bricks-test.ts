/**
 * Sparse 8³ bricks (terrain/bricks.ts) vs the dense mesher (bricks: false).
 *  1. bit-exact: positions, normals, AO, region weights, indices, removed floating points and the
 *     floater count, across seeds × random columns at every LOD level (columns
 *     with floaters included and counted);
 *  2. step-4 coarse margin: sign check of every step-4-resolvable raw sample
 *     against sampleRaw at level 0 (misses, and the 0-miss margin needed —
 *     REFINE_MARGIN4 must be ≥ 2× it);
 *  3. time per column and noise samples, dense vs bricks.
 * Run: npm run test:bricks
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRegionMask, columnRowPlan, columnRows, generateColumnMesh, lodCoord, lodPoints, lodSpacing, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { coarseResolve } from "../src/games/deep-march/terrain/refine";
import { REFINE_MARGIN4 } from "../src/games/deep-march/terrain/bricks";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const same = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  if (a.length !== b.length) return Math.max(a.length, b.length, 1);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) d++;
  return d;
};
const diff = (a: ColumnMeshData, b: ColumnMeshData, ra: number[], rb: number[]) =>
  same(a.positions, b.positions) + same(a.normals, b.normals) + same(a.ao, b.ao) + same(a.region, b.region) + same(a.indices, b.indices) + same(a.removed, b.removed) + same(ra, rb) + (a.stats.floaters !== b.stats.floaters ? 1 : 0);

// 1 + 3
const SEEDS = [1, 7, 42, 99, 2024];
const COLS = [6, 5, 4, 3];
const agg = COLS.map(() => ({ cols: 0, diff: 0, floaterCols: 0, floaters: 0, dMs: 0, bMs: 0, dS: 0, bS: 0 }));
for (const seed of SEEDS) {
  const dense = createDensityField(seed, { ...TERRAIN, bricks: false });
  const brick = createDensityField(seed, TERRAIN);
  let rnd = seed * 7919 + 13;
  const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let lod = 0; lod < COLS.length; lod++) {
    const rows = columnRows(dense, lod);
    const size = TERRAIN.boundsSize * (1 << lod);
    const a = agg[lod];
    for (let c = 0; c < COLS[lod]; c++) {
      const wx = (next() - 0.5) * 2400, wz = (next() - 0.5) * 2400;
      const cx = Math.floor((wx + TERRAIN.boundsSize / 2) / size), cz = Math.floor((wz + TERRAIN.boundsSize / 2) / size);
      const fm = TERRAIN.floaterMargin * (1 << lod);
      const rd: number[] = [], rb: number[] = [];
      let t = performance.now();
      const md = generateColumnMesh(dense, cx, cz, rows, fm, rd, false, undefined, lod);
      a.dMs += performance.now() - t;
      t = performance.now();
      const mb = generateColumnMesh(brick, cx, cz, rows, fm, rb, false, undefined, lod);
      a.bMs += performance.now() - t;
      a.diff += diff(md, mb, rd, rb);
      a.cols++;
      a.dS += md.stats.noiseSamples;
      a.bS += mb.stats.noiseSamples;
      if (md.stats.floaters > 0) {
        a.floaterCols++;
        a.floaters += md.stats.floaters;
      }
    }
  }
}
console.log(`bricks: seeds ${SEEDS.join(", ")}`);
let totalFloaterCols = 0;
for (let lod = 0; lod < COLS.length; lod++) {
  const a = agg[lod];
  totalFloaterCols += a.floaterCols;
  check(a.diff === 0, `L${lod} bricks == dense (${a.cols} columns, ${a.floaterCols} with floaters / ${a.floaters} floaters)`, `${a.diff} differing values`);
  console.log(`  info L${lod}: ${(a.dMs / a.cols).toFixed(0)} → ${(a.bMs / a.cols).toFixed(0)} ms/column (${((100 * (a.dMs - a.bMs)) / a.dMs).toFixed(0)}% saved), noise samples ${(a.dS / a.cols / 1000).toFixed(1)}k → ${(a.bS / a.cols / 1000).toFixed(1)}k`);
}
check(totalFloaterCols > 0, "floater removal exercised", `${totalFloaterCols} columns with floaters`);

// 2. step-4 margin at level 0
function step4Gaps(field: DensityField, cx: number, cz: number, lod: number, out: { miss: number; need: number; hit: number }, margin: number) {
  const s = field.settings, iso = s.isoLevel;
  const rows = columnRows(field, lod);
  const n = lodPoints(field, lod), sp = lodSpacing(field, lod);
  const px = n + 2, py = rows.gjMax - rows.gjMin + 3, pz = n + 2;
  const x0 = lodCoord(cx * (n - 1), field, lod), y0 = lodCoord(rows.gjMin, field, lod), z0 = lodCoord(cz * (n - 1), field, lod);
  const plan = columnRowPlan(field, rows, columnRegionMask(field, cx, cz, lod), lod);
  const K = lod > 0 ? 1 : s.smoothCells, half = lod > 0 ? 0 : (field.smoothWeights.length - 1) / 2, R = half * K;
  const RY = py + 2 * R;
  const rawNeed = new Uint8Array(RY);
  for (let j = 0; j < py; j++) if (!plan.rowSkip[j]) for (let d = 0; d <= 2 * R; d++) rawNeed[j + d] = 1;
  const yOf = (r: number) => y0 + (r - R - 1) * sp;
  const cls = new Uint8Array(px * RY * pz), raw = new Float32Array(cls.length), exact = new Uint8Array(cls.length);
  const bnd = new Float64Array(1);
  for (let k = 0; k < pz; k++)
    for (let i = 0; i < px; i++)
      for (let r = 0; r < RY; r++) {
        if (!rawNeed[r]) continue;
        const idx = (k * RY + r) * px + i;
        const c = field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, bnd);
        cls[idx] = c;
        if (c) raw[idx] = bnd[0];
      }
  coarseResolve({ px, RY, pz, rawNeed, cls, raw, exact }, iso, Infinity,
    (i, r, k) => field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp),
    (i, r, k, b) => field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, b),
    { coarseSamples: 0, resolved: 0, unresolved: 0 }, 4,
    (idx, gap, solid) => {
      const i = idx % px, r = Math.floor(idx / px) % RY, k = Math.floor(idx / (px * RY));
      const v = field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp);
      if (gap > margin) out.hit++;
      if (v >= iso !== solid) {
        out.need = Math.max(out.need, gap);
        if (gap > margin) out.miss++;
      }
    });
}
for (let lod = 0; lod < REFINE_MARGIN4.length; lod++) {
  const m = REFINE_MARGIN4[lod];
  const o = { miss: 0, need: 0, hit: 0 };
  for (const seed of [3, 11, 58, 77]) {
    const f = createDensityField(seed, TERRAIN);
    let rnd = seed * 104729;
    const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let c = 0; c < 5; c++) {
      const size = TERRAIN.boundsSize * (1 << lod);
      const wx = (next() - 0.5) * 3000, wz = (next() - 0.5) * 3000;
      step4Gaps(f, Math.floor((wx + 16) / size), Math.floor((wz + 16) / size), lod, o, m);
    }
  }
  check(o.miss === 0, `L${lod} step-4 resolved samples on the right side of iso`, `${o.miss} misses in ${o.hit}`);
  check(m >= 2 * o.need, `L${lod} step-4 margin ≥ 2× the largest gap that still missed`, `${m} vs 2 × ${o.need.toFixed(2)} (20 fresh columns)`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all bricks checks passed");
