/**
 * Per-vertex macro-region weights (terrain/regionWeights.ts), baked by the mesher:
 *  1. quantisation: 6 bytes summing exactly to 255, deterministic;
 *  2. a global function of (x, z): independent samplers (different columns /
 *     caches / LOD levels) give bit-identical weights;
 *  3. every mesher vertex at LOD 0…3 carries exactly that function's value (so a
 *     point has the same material weights at every LOD: no material pop on swaps),
 *     skirts copy their source vertex;
 *  4. interpolation error vs the exact region field, and packing cost per column.
 * Run: npm run test:regionweights
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh, lodSpacing } from "../src/games/deep-march/terrain/mesher";
import { createRegionSample } from "../src/games/deep-march/terrain/regions";
import { REGION_STRIDE, RegionWeightSampler, packRegionWeights, quantizeWeights, regionGridSpacing } from "../src/games/deep-march/terrain/regionWeights";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

console.log("region weights");
// 1
const q = new Uint8Array(8);
let badSum = 0;
let rnd = 12345;
const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 20000; i++) {
  const w = [next(), next() * next(), 0, next() < 0.5 ? 0 : next(), 1e-7, next()];
  quantizeWeights(w, q, 0);
  const s = q[0] + q[1] + q[2] + q[3] + q[4] + q[5];
  const q2 = new Uint8Array(8);
  quantizeWeights(w, q2, 0);
  if (s !== 255 || q.some((v, k) => v !== q2[k])) badSum++;
}
quantizeWeights([0, 0, 0, 0, 0, 0], q, 0);
check(badSum === 0 && q[0] === 255, "quantised weights sum to 255, deterministic", `${badSum} bad of 20000`);

// 2 + 3 + 4
const SEEDS = [1, 7, 42];
let mismatch = 0, verts = 0, skirtBad = 0, sumBad = 0, cols = 0, fnBad = 0;
let maxErr = 0, packMs = 0, meshMs = 0;
const rs = createRegionSample();
for (const seed of SEEDS) {
  const field = createDensityField(seed, TERRAIN);
  const sp = regionGridSpacing(TERRAIN.worldScale);
  const a = new RegionWeightSampler(field.regions, sp), b = new RegionWeightSampler(field.regions, sp);
  const wa = new Float64Array(6), wb = new Float64Array(6);
  for (let i = 0; i < 4000; i++) {
    const x = (next() - 0.5) * 6000, z = (next() - 0.5) * 6000;
    // b sees the points in another order, with other points cached in between
    b.at(x + 33.3, z - 71.1, wb);
    a.at(x, z, wa);
    b.at(x, z, wb);
    for (let r = 0; r < 6; r++) if (wa[r] !== wb[r]) fnBad++;
    const e = field.regions.sample(x, z, rs);
    for (let r = 0; r < 6; r++) maxErr = Math.max(maxErr, Math.abs(e.w[r] - wa[r]));
  }
  for (let lod = 0; lod < 4; lod++) {
    const rows = columnRows(field, lod);
    const size = TERRAIN.boundsSize * (1 << lod);
    for (let c = 0; c < 3; c++) {
      // columns near region borders: pick the point, then its column at this LOD
      const wx = (next() - 0.5) * 2400, wz = (next() - 0.5) * 2400;
      const cx = Math.floor((wx + TERRAIN.boundsSize / 2) / size), cz = Math.floor((wz + TERRAIN.boundsSize / 2) / size);
      let t = performance.now();
      const m = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin * (1 << lod), undefined, false, undefined, lod);
      meshMs += performance.now() - t;
      const n = m.positions.length / 3;
      cols++;
      verts += n;
      check(m.region.length === n * REGION_STRIDE, `seed ${seed} lod ${lod} col ${c}: 8 bytes per vertex`, `${n} vertices`);
      // fresh sampler (as if another column / LOD evaluated the same points)
      const fresh = new RegionWeightSampler(field.regions, sp);
      t = performance.now();
      const ref = packRegionWeights(m.positions, n, n, fresh);
      packMs += performance.now() - t;
      for (let v = 0; v < n; v++) {
        let s = 0;
        for (let r = 0; r < 6; r++) s += m.region[v * 8 + r];
        if (s !== 255) sumBad++;
      }
      // surface vertices match the global function exactly; skirt vertices (pushed
      // 2·spacing down along the normal) carry their source vertex's weights
      const depth = 2 * lodSpacing(field, lod);
      const key = (x: number, y: number, z: number) => `${Math.round(x * 64)},${Math.round(y * 64)},${Math.round(z * 64)}`;
      const byPos = new Map<string, number>();
      for (let v = 0; v < n; v++) byPos.set(key(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]), v);
      for (let v = 0; v < n; v++) {
        let same = true;
        for (let r = 0; r < 6; r++) if (m.region[v * 8 + r] !== ref[v * 8 + r]) same = false;
        if (same) continue;
        mismatch++;
        const o = v * 3;
        const sx = m.positions[o] + m.normals[o] * depth, sy = m.positions[o + 1] + m.normals[o + 1] * depth, sz = m.positions[o + 2] + m.normals[o + 2] * depth;
        let u = byPos.get(key(sx, sy, sz));
        if (u === undefined) {
          // rounding-boundary case: nearest vertex within 1 mm
          for (let k = 0; k < n; k++) if (Math.abs(m.positions[k * 3] - sx) + Math.abs(m.positions[k * 3 + 1] - sy) + Math.abs(m.positions[k * 3 + 2] - sz) < 1e-3) u = k;
        }
        let ok = u !== undefined;
        if (u !== undefined) for (let r = 0; r < 8; r++) if (m.region[v * 8 + r] !== m.region[u * 8 + r]) ok = false;
        if (!ok) skirtBad++;
      }
    }
  }
}
check(fnBad === 0, "global function: independent samplers bit-identical", `${fnBad} differing weights`);
check(sumBad === 0, "mesher weights sum to 255 per vertex", `${sumBad} bad of ${verts}`);
check(skirtBad === 0, "every LOD's vertices carry the global function's weights (skirts: their source's)", `${mismatch} skirt vertices copy their source, ${skirtBad} unexplained, ${verts} vertices in ${cols} columns (LOD 0–3)`);
check(maxErr < 0.1, "grid interpolation close to the exact region field", `max |Δw| ${maxErr.toFixed(3)} (grid ${regionGridSpacing(TERRAIN.worldScale)} u, blend band ${17 * TERRAIN.worldScale} u)`);
check(packMs < meshMs * 0.15, "packing cost small vs meshing", `${packMs.toFixed(0)} ms packing vs ${meshMs.toFixed(0)} ms meshing (${cols} columns)`);
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all region-weight checks passed");
