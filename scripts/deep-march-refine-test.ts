/**
 * Coarse pre-pass ("refine", terrain/refine.ts) vs full evaluation.
 * Several seeds × columns at every LOD level (levels without the coarse pass must be unchanged):
 *  1. mesh + floater removal with refine on == refine off (positions, normals, AO, region weights, indices, removed points), bit-exact;
 *  2. sign check of every coarse-resolved raw sample against the true sampleRaw (mismatches, and the smallest
 *     margin that would still give 0 misses — REFINE_MARGIN should be ≥ 2× it);
 *  3. fraction of raw samples evaluated and time per column, on vs off.
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRegionMask, columnRowPlan, columnRows, generateColumnMesh, lodCoord, lodPoints, lodSpacing, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { coarseResolve, refineMargin } from "../src/games/deep-march/terrain/refine";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

const same = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) d++;
  return d;
};
const meshDiff = (a: ColumnMeshData, b: ColumnMeshData, ra: number[], rb: number[]) =>
  same(a.positions, b.positions) + same(a.normals, b.normals) + same(a.ao, b.ao) + same(a.region, b.region) + same(a.indices, b.indices) + same(ra, rb);

/** Sign check of the coarse pass on one column (replicates the mesher's raw grid). */
function signCheck(field: DensityField, cx: number, cz: number, lod: number) {
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
  const margin = refineMargin(lod) ?? Infinity;
  let resolved = 0, miss = 0, needMargin = 0, zeroMarginMiss = 0;
  const st = { coarseSamples: 0, resolved: 0, unresolved: 0 };
  coarseResolve(
    { px, RY, pz, rawNeed, cls, raw, exact },
    iso,
    margin,
    (i, r, k) => field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp),
    (i, r, k, b) => field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, b),
    st,
    undefined,
    (idx, gap, solid) => {
      const i = idx % px, r = Math.floor(idx / px) % RY, k = Math.floor(idx / (px * RY));
      const v = field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp);
      if (v >= iso !== solid) {
        zeroMarginMiss++;
        needMargin = Math.max(needMargin, gap);
        if (gap > margin) miss++;
      }
      if (gap > margin) resolved++;
    },
  );
  return { resolved, miss, needMargin, zeroMarginMiss };
}

const LODS = [
  { lod: 0, cols: 4 },
  { lod: 1, cols: 4 },
  { lod: 2, cols: 4 },
  { lod: 3, cols: 3 },
];
const SEEDS = [1, 7, 42];
const agg = LODS.map(() => ({ diff: 0, resolved: 0, miss: 0, needMargin: 0, onSamp: 0, offSamp: 0, rawPts: 0, onMs: 0, offMs: 0, cols: 0 }));
for (const seed of SEEDS) {
  const on = createDensityField(seed, TERRAIN);
  const off = createDensityField(seed, { ...TERRAIN, refine: false });
  let rnd = seed * 7919;
  const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let li = 0; li < LODS.length; li++) {
    const { lod, cols } = LODS[li];
    const rows = columnRows(on, lod);
    const a = agg[li];
    for (let c = 0; c < cols; c++) {
      const size = TERRAIN.boundsSize * (1 << lod);
      const wx = (next() - 0.5) * 900, wz = (next() - 0.5) * 900;
      const cx = Math.floor((wx + TERRAIN.boundsSize / 2) / size), cz = Math.floor((wz + TERRAIN.boundsSize / 2) / size);
      const fm = TERRAIN.floaterMargin * (1 << lod);
      const ra: number[] = [], rb: number[] = [];
      let t0 = performance.now();
      const mb = generateColumnMesh(off, cx, cz, rows, fm, rb, false, undefined, lod);
      a.offMs += performance.now() - t0;
      t0 = performance.now();
      const ma = generateColumnMesh(on, cx, cz, rows, fm, ra, false, undefined, lod);
      a.onMs += performance.now() - t0;
      a.diff += meshDiff(ma, mb, ra, rb);
      a.onSamp += ma.stats.noiseSamples;
      a.offSamp += mb.stats.noiseSamples;
      a.rawPts += ma.stats.rawPoints;
      a.cols++;
      if (refineMargin(lod) === null) continue;
      const sc = signCheck(on, cx, cz, lod);
      a.resolved += sc.resolved;
      a.miss += sc.miss;
      a.needMargin = Math.max(a.needMargin, sc.needMargin);
    }
  }
}
console.log(`refine: seeds ${SEEDS.join(", ")}`);
for (let li = 0; li < LODS.length; li++) {
  const a = agg[li], lod = LODS[li].lod;
  const m = refineMargin(lod);
  if (m === null) {
    console.log(`  L${lod} (${a.cols} columns): coarse pass off at this level · ${(a.offMs / a.cols).toFixed(0)} / ${(a.onMs / a.cols).toFixed(0)} ms/column`);
    check(a.diff === 0 && a.onSamp === a.offSamp, `L${lod} unchanged (full evaluation)`, `${a.diff} differing values, samples ${a.onSamp} vs ${a.offSamp}`);
    continue;
  }
  console.log(
    `  L${lod} (${a.cols} columns): evaluated ${((100 * a.onSamp) / a.rawPts).toFixed(1)}% of raw points with refine vs ${((100 * a.offSamp) / a.rawPts).toFixed(1)}% without · ` +
      `${(a.offMs / a.cols).toFixed(0)} → ${(a.onMs / a.cols).toFixed(0)} ms/column · ${a.resolved} samples resolved by the coarse pass · margin ${m}, 0-miss margin needed ${a.needMargin.toFixed(2)}`,
  );
  check(a.diff === 0, `L${lod} mesh + removed points identical to full evaluation`, `${a.diff} differing values`);
  check(a.miss === 0, `L${lod} coarse-resolved samples on the right side of iso`, `${a.miss} sign mismatches in ${a.resolved}`);
  check(m >= 2 * a.needMargin, `L${lod} margin ≥ 2× the largest gap that still missed`, `${m} vs 2 × ${a.needMargin.toFixed(2)}`);
}
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
