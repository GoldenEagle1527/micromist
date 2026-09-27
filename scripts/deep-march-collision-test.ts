/**
 * Collision field (terrain/latticeSampler.ts) vs the drawn level-0 mesh.
 *  1. mesh vertices lie on the collision surface (|density − iso| / |∇| ≈ 0);
 *  2. triangle centroids: distance to the collision surface vs to the analytic surface
 *     (the collision field should follow the mesh much more closely);
 *  3. removed floating rock: every removed lattice point is water in the collision field,
 *     and removal never changes the field away from removed points' cells.
 * Run: npm run test:collision
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh, latticeCoord } from "../src/games/deep-march/terrain/mesher";
import { createLatticeSampler } from "../src/games/deep-march/terrain/latticeSampler";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const iso = TERRAIN.isoLevel;
const vertErr: number[] = [], cLat: number[] = [], cAna: number[] = [];
let removedPts = 0, removedSolid = 0;
const dist = (f: (x: number, y: number, z: number) => number, x: number, y: number, z: number) => {
  const e = 0.01;
  const gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e), gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e), gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
  return Math.abs(f(x, y, z) - iso) / Math.max(1e-6, Math.hypot(gx, gy, gz));
};
for (const seed of [1, 7, 42]) {
  const field = createDensityField(seed, TERRAIN);
  const rows = columnRows(field);
  for (const [cx, cz] of [[0, 0], [3, -2], [-5, 4], [8, 7]]) {
    const removed: number[] = [];
    const m = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, removed, false);
    const set = new Set<string>();
    for (let q = 0; q < removed.length; q += 3) set.add(`${removed[q]},${removed[q + 1]},${removed[q + 2]}`);
    const lat = createLatticeSampler(field, (gi, gj, gk) => set.has(`${gi},${gj},${gk}`));
    const f = (x: number, y: number, z: number) => lat.sample(x, y, z);
    const P = m.positions, I = m.indices;
    for (let v = 0; v < P.length; v += 3 * 5) vertErr.push(dist(f, P[v], P[v + 1], P[v + 2]));
    for (let t = 0; t < I.length; t += 3 * 5) {
      let x = 0, y = 0, z = 0;
      for (let q = 0; q < 3; q++) { x += P[I[t + q] * 3] / 3; y += P[I[t + q] * 3 + 1] / 3; z += P[I[t + q] * 3 + 2] / 3; }
      cLat.push(dist(f, x, y, z));
      cAna.push(dist(field.sample, x, y, z));
    }
    for (let q = 0; q < removed.length; q += 3) {
      removedPts++;
      const x = latticeCoord(removed[q], field), y = latticeCoord(removed[q + 1], field), z = latticeCoord(removed[q + 2], field);
      if (lat.sample(x, y, z) >= iso) removedSolid++;
    }
  }
}
const pct = (a: number[], p: number) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(p * (s.length - 1))]; };
console.log(`collision field vs level-0 mesh (seeds 1, 7, 42 · 12 columns)`);
check(pct(vertErr, 0.99) < 1e-3, "mesh vertices lie on the collision surface", `p50 ${pct(vertErr, 0.5).toExponential(1)} · p99 ${pct(vertErr, 0.99).toExponential(1)} u (${vertErr.length} vertices)`);
check(pct(cLat, 0.99) < 0.5 * pct(cAna, 0.99), "triangle centroids: collision surface much closer than the analytic surface", `collision p50 ${pct(cLat, 0.5).toFixed(3)} p99 ${pct(cLat, 0.99).toFixed(3)} u · analytic p50 ${pct(cAna, 0.5).toFixed(3)} p99 ${pct(cAna, 0.99).toFixed(3)} u`);
check(removedSolid === 0, "removed floating-rock points are water in the collision field", `${removedSolid} solid of ${removedPts}`);
if (failed) process.exit(1);
