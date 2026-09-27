/**
 * WASM noise (terrain/noiseWasm.ts) vs the JS implementation:
 *  1. simplex: bit-exact on random points (incl. far / negative coordinates);
 *  2. density field (world + classification settings): sampleRaw bit-exact, wasm on vs off;
 *  3. column meshes of every LOD level identical, wasm on vs off;
 *  4. speed: µs per sampleRaw and ms per column, on vs off (same process: shared JIT feedback
 *     favours WASM here; the separate-process benchmark is the fair one).
 * Run: npm run test:wasm
 */
import { TERRAIN, baseTerrain } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh } from "../src/games/deep-march/terrain/mesher";
import { createSimplex3, mulberry32, simplexTables } from "../src/games/deep-march/terrain/noise";
import { getWasmNoise } from "../src/games/deep-march/terrain/noiseWasm";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const w = getWasmNoise();
check(!!w, "WASM module instantiates", w ? "ok" : "unavailable");
if (!w) process.exit(1);
const SEEDS = [1, 7, 42, 12345];

let nDiff = 0, nTot = 0;
for (const seed of SEEDS) {
  const js = createSimplex3(seed);
  const t = w.alloc(1024);
  const tb = simplexTables(seed);
  w.u8.set(tb.perm, t);
  w.u8.set(tb.permMod12, t + 512);
  const rnd = mulberry32(seed + 5);
  for (let q = 0; q < 100000; q++) {
    const sc = q % 3 === 0 ? 3000 : q % 3 === 1 ? 30 : 0.5;
    const x = (rnd() - 0.5) * sc, y = (rnd() - 0.5) * sc, z = (rnd() - 0.5) * sc;
    nTot++;
    if (!Object.is(js(x, y, z), w.snoise(t, x, y, z))) nDiff++;
  }
}
check(nDiff === 0, "simplex bit-exact", `${nDiff} differing of ${nTot}`);

let fDiff = 0, fTot = 0, maxAbs = 0;
for (const seed of SEEDS) {
  for (const s of [TERRAIN, baseTerrain(TERRAIN)]) {
    const a = createDensityField(seed, { ...s, wasm: true }), b = createDensityField(seed, { ...s, wasm: false });
    const rnd = mulberry32(seed * 3 + 1);
    for (let q = 0; q < 50000; q++) {
      const x = (rnd() - 0.5) * 4000, y = -110 + rnd() * 250, z = (rnd() - 0.5) * 4000;
      const va = a.sampleRaw(x, y, z), vb = b.sampleRaw(x, y, z);
      fTot++;
      if (!Object.is(va, vb)) { fDiff++; maxAbs = Math.max(maxAbs, Math.abs(va - vb)); }
    }
  }
}
check(fDiff === 0, "density sampleRaw bit-exact (world + classification fields)", `${fDiff} differing of ${fTot} (max |Δ| ${maxAbs})`);

let mDiff = 0;
const time = { on: [0, 0, 0, 0], off: [0, 0, 0, 0], n: [0, 0, 0, 0] };
for (const seed of SEEDS.slice(0, 2)) {
  const a = createDensityField(seed, { ...TERRAIN, wasm: true }), b = createDensityField(seed, { ...TERRAIN, wasm: false });
  for (let lod = 0; lod < TERRAIN.lodLevels; lod++) {
    const rows = columnRows(a, lod);
    for (const [cx, cz] of [[0, 0], [2, -1], [-3, 2]]) {
      let t0 = performance.now();
      const mb = generateColumnMesh(b, cx, cz, rows, TERRAIN.floaterMargin << lod, undefined, false, undefined, lod);
      time.off[lod] += performance.now() - t0;
      t0 = performance.now();
      const ma = generateColumnMesh(a, cx, cz, rows, TERRAIN.floaterMargin << lod, undefined, false, undefined, lod);
      time.on[lod] += performance.now() - t0;
      time.n[lod]++;
      const eq = (u: ArrayLike<number>, v: ArrayLike<number>) => u.length === v.length && Array.from(u).every((q, i) => Object.is(q, v[i]));
      if (!(eq(ma.positions, mb.positions) && eq(ma.normals, mb.normals) && eq(ma.ao, mb.ao) && eq(ma.indices, mb.indices) && eq(ma.removed, mb.removed))) mDiff++;
    }
  }
}
check(mDiff === 0, "column meshes identical at every LOD level", `${mDiff} differing columns`);

// speed: sampleRaw on surface-band points (both fields warmed up)
{
  const a = createDensityField(1, { ...TERRAIN, wasm: true }), b = createDensityField(1, { ...TERRAIN, wasm: false });
  const pts = new Float64Array(3 * 200000);
  const rnd = mulberry32(99);
  for (let i = 0; i < pts.length; i += 3) { pts[i] = (rnd() - 0.5) * 300; pts[i + 1] = -40 + rnd() * 80; pts[i + 2] = (rnd() - 0.5) * 300; }
  const run = (f: typeof a) => { let acc = 0; const t0 = performance.now(); for (let i = 0; i < pts.length; i += 3) acc += f.sampleRaw(pts[i], pts[i + 1], pts[i + 2]); return [(performance.now() - t0) * 1000 / (pts.length / 3), acc]; };
  run(a); run(b);
  const [ta] = run(a), [tb] = run(b), [ta2] = run(a), [tb2] = run(b);
  const on = Math.min(ta, ta2), off = Math.min(tb, tb2);
  console.log(`  speed: sampleRaw ${off.toFixed(3)} → ${on.toFixed(3)} µs (${(off / on).toFixed(2)}×)`);
  console.log(`  speed: ms/column JS → WASM: ${time.n.map((n, l) => `L${l} ${(time.off[l] / n).toFixed(0)} → ${(time.on[l] / n).toFixed(0)}`).join(" · ")}`);
}
if (failed) process.exit(1);
