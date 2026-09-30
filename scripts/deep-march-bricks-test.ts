/**
 * Sparse 8³ bricks (terrain/bricks.ts) vs the dense mesher (bricks: false).
 *  1. bit-exact: positions, normals, AO, region weights, indices, removed floating points and the
 *     floater count, across seeds × random columns at every LOD level (columns
 *     with floaters included and counted);
 *  2. step-4 coarse margin: sign check of every step-4-resolvable raw sample
 *     against sampleRaw at level 0 (misses, and the 0-miss margin needed —
 *     REFINE_MARGIN4 must be ≥ 2× it);
 *  3. time per column and noise samples, dense vs bricks;
 *  4. bounded world (site layout with the δ term and the ring wall; genesis, ±δmax
 *     stress and a thin cracked wall): the conservative bounds (bounds, boundsForMask,
 *     rawBoundsForMask, rawClass incl. the wall's exact classes) contain the real
 *     density at 1.5·10⁵ sampled points — half of them on the wall-adjacent sites,
 *     the wall and the void beyond — and bricks == dense on edge / wall columns.
 * Run: npm run test:bricks
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRegionMask, columnRowPlan, columnRows, generateColumnMesh, lodCoord, lodPoints, lodSpacing, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { coarseResolve } from "../src/games/deep-march/terrain/refine";
import { REFINE_MARGIN4 } from "../src/games/deep-march/terrain/bricks";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { crackedLayout, genesisLayout, stressLayout } from "./lib/worldFixture";

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
// 4. bounded world: bounds with the δ term
{
  console.log("bounded world: conservative bounds with the site bias δ");
  const iso = TERRAIN.isoLevel, eps = 1e-9;
  let n = 0, edgeN = 0, bad = { bounds: 0, mask: 0, raw: 0, cls: 0 }, loMargin = Infinity;
  const out = new Float64Array(2), cb = new Float64Array(1);
  for (const seed of [7, 42]) {
    for (const [name, layout] of [["genesis", genesisLayout(seed)], ["stress ±δmax", stressLayout(seed)], ["cracked thin wall", crackedLayout(seed)]] as const) {
      const f = createDensityField(seed, TERRAIN, undefined, layout);
      const rows = columnRows(f, 0);
      const y0 = lodCoord(rows.gjMin, f, 0), y1 = lodCoord(rows.gjMax, f, 0);
      const rnd = mulberry32(seed * 31 + name.length);
      const half = 2080, cell = 416;
      for (let q = 0; q < 25000; q++) {
        let x: number, z: number;
        if (q % 2) {
          // wall-adjacent band: the outer site ring and one cell beyond the edge
          const side = Math.floor(rnd() * 4), t = (rnd() - 0.5) * 2 * half, d = half - cell + rnd() * 2 * cell;
          [x, z] = side === 0 ? [d, t] : side === 1 ? [-d, t] : side === 2 ? [t, d] : [t, -d];
          edgeN++;
        } else {
          x = (rnd() - 0.5) * 2 * half;
          z = (rnd() - 0.5) * 2 * half;
        }
        const y = y0 + rnd() * (y1 - y0);
        const v = f.sample(x, y, z), raw = f.sampleRaw(x, y, z);
        n++;
        f.bounds(y, out);
        if (v < out[0] - eps || v > out[1] + eps) bad.bounds++;
        loMargin = Math.min(loMargin, v - out[0]);
        const cx = Math.floor((x + TERRAIN.boundsSize / 2) / TERRAIN.boundsSize), cz = Math.floor((z + TERRAIN.boundsSize / 2) / TERRAIN.boundsSize);
        const mask = columnRegionMask(f, cx, cz, 0);
        f.boundsForMask(mask, y, out);
        if (v < out[0] - eps || v > out[1] + eps) bad.mask++;
        f.rawBoundsForMask(mask, y, out);
        if (raw < out[0] - eps || raw > out[1] + eps) bad.raw++;
        const k = f.rawClass(x, y, z, cb);
        if ((k === 2 && raw !== cb[0]) || (k === 1 && !(raw <= cb[0] + eps && cb[0] < iso))) bad.cls++;
      }
      // bricks == dense on columns across the edge and on wall-adjacent sites
      const dense = createDensityField(seed, { ...TERRAIN, bricks: false }, undefined, layout);
      let cd = 0, cols = 0;
      for (let lod = 0; lod < 3; lod++) {
        const size = TERRAIN.boundsSize * (1 << lod);
        const r = columnRows(dense, lod);
        // + the ring wall: its face, the outer face / void, a rounded corner, the crack at s = 0
        for (const [wx, wz] of [[2080, 100], [-2080, -600], [900, 1950], [-1800, 1800], [2020, -300], [2240, 40], [1880, 1880], [2050, 30]]) {
          const cx = Math.floor((wx + TERRAIN.boundsSize / 2) / size), cz = Math.floor((wz + TERRAIN.boundsSize / 2) / size);
          const fm = TERRAIN.floaterMargin * (1 << lod);
          const rd: number[] = [], rb: number[] = [];
          const md = generateColumnMesh(dense, cx, cz, r, fm, rd, false, undefined, lod);
          const mb = generateColumnMesh(f, cx, cz, r, fm, rb, false, undefined, lod);
          cd += diff(md, mb, rd, rb);
          cols++;
        }
      }
      check(cd === 0, `seed ${seed} ${name}: bricks == dense on edge / wall-adjacent columns`, `${cols} columns (L0–L2), ${cd} differing values`);
    }
  }
  check(bad.bounds === 0, "bounds(y) contain sample", `${bad.bounds} of ${n} outside (${edgeN} in the edge band), min margin ${loMargin.toFixed(2)}`);
  check(bad.mask === 0, "boundsForMask(column mask) contain sample", `${bad.mask} of ${n}`);
  check(bad.raw === 0, "rawBoundsForMask contain sampleRaw", `${bad.raw} of ${n}`);
  check(bad.cls === 0, "rawClass consistent (class 2 exact — cap or wall rock —, water bound below iso)", `${bad.cls} of ${n}`);
}

if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all bricks checks passed");
