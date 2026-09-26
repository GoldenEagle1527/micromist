/**
 * Node test for the generation-time terrain classification (terrainInfo.ts /
 * terrainInfoGen.ts): determinism, seam agreement, class / surface distribution,
 * brute-force sanity checks and the generation-cost delta.
 * Run: npm run test:terrain-info   (env SEEDS=1,7,12345 AREA=2 → (2·AREA+1)² columns, LOWSPEC=1)
 */
import { TERRAIN as DESKTOP, terrainForDevice } from "../src/games/deep-march/terrain/config";

const TERRAIN = process.env.LOWSPEC ? terrainForDevice(true) : DESKTOP;
import { createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { buildColumnTerrainInfo, createLineSampler } from "../src/games/deep-march/terrain/terrainInfoGen";
import {
  ENV, ENV_KINDS, ENV_T, SURFACE_TYPES, TerrainInfoStore, type ChunkTerrainInfo,
} from "../src/games/deep-march/terrain/terrainInfo";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";

const SEEDS = (process.env.SEEDS ?? "1,7,12345").split(",").map(Number);
const AREA = Number(process.env.AREA ?? 2);
let failures = 0;
const check = (name: string, ok: boolean, info: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${info}`);
  if (!ok) failures++;
};
const pct = (a: number, b: number) => `${a}/${b} (${b ? ((a / b) * 100).toFixed(1) : "–"}%)`;

function sameInfo(a: ChunkTerrainInfo, b: ChunkTerrainInfo): boolean {
  const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => x.length === y.length && Array.from(x).every((v, i) => v === y[i]);
  return eq(a.env, b.env) && eq(a.up, b.up) && eq(a.down, b.down) && eq(a.side, b.side) && eq(a.sides, b.sides) &&
    a.spawn.count === b.spawn.count && eq(a.spawn.pos, b.spawn.pos) && eq(a.spawn.type, b.spawn.type) &&
    eq(a.spawn.env, b.spawn.env) && eq(a.spawn.exposure, b.spawn.exposure) && eq(a.spawn.flags, b.spawn.flags) && eq(a.spawn.region, b.spawn.region);
}

/** Fine brute-force distance to rock along a direction (0.05 steps). */
function march(f: DensityField, x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number) {
  for (let t = 0.05; t <= max; t += 0.05) if (f.sample(x + dx * t, y + dy * t, z + dz * t) >= f.settings.isoLevel) return t;
  return Infinity;
}

const envTotal = new Array(ENV_KINDS.length).fill(0);
const surfTotal = new Array(SURFACE_TYPES.length).fill(0);
let msWith = 0, msWithout = 0, msInfo = 0, cols = 0, spawnTotal = 0;

for (const seed of SEEDS) {
  const field = createDensityField(seed, TERRAIN);
  const rows = columnRows(field);
  console.log(`seed ${seed}: ${(2 * AREA + 1) ** 2} columns around the origin`);

  // --- generate (with and without info, for the cost delta) ---
  const out = new Map<string, ColumnMeshData>();
  for (let cz = -AREA; cz <= AREA; cz++) for (let cx = -AREA; cx <= AREA; cx++) {
    let t0 = performance.now();
    generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, undefined, false);
    msWithout += performance.now() - t0;
    t0 = performance.now();
    const m = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin);
    msWith += performance.now() - t0;
    msInfo += m.infoMs;
    cols++;
    out.set(`${cx},${cz}`, m);
  }

  // --- determinism: fresh field, same seed → identical bytes ---
  const field2 = createDensityField(seed, TERRAIN);
  let detOk = 0;
  for (const [cx, cz] of [[0, 0], [1, -1], [-2, 2]]) {
    if (Math.abs(cx) > AREA || Math.abs(cz) > AREA) continue;
    const again = generateColumnMesh(field2, cx, cz, columnRows(field2), TERRAIN.floaterMargin).info!;
    if (sameInfo(again, out.get(`${cx},${cz}`)!.info!)) detOk++;
  }
  check("determinism (fresh field, same seed → identical info)", detOk === 3 || (AREA < 2 && detOk >= 1), `${detOk} columns identical`);

  // --- seam agreement ---
  // (1) own cells vs a reference that reads every line from the shared sampler
  //     (= exactly what neighbours see in their ring): differences only from floater removal.
  let refSame = 0, refCells = 0, edgeSame = 0, edgeCells = 0, cleanDiff = 0, cleanCols = 0;
  for (const [key, m] of out) {
    const [cx, cz] = key.split(",").map(Number);
    const ref = buildColumnTerrainInfo({
      field, rows, cx, cz, dens: new Float32Array(0), px: 0, py: 0,
      positions: m.positions, normals: m.normals, ao: m.ao, sampler: createLineSampler(field, rows), ownFromSampler: true,
    });
    const a = m.info!;
    const clean = m.stats.floaters === 0;
    if (clean) cleanCols++;
    for (let i = 0; i < a.env.length; i++) {
      if (clean && (a.env[i] !== ref.env[i] || a.up[i] !== ref.up[i] || a.down[i] !== ref.down[i] || a.side[i] !== ref.side[i])) cleanDiff++;
      const ix = i % a.nx, iz = Math.floor(i / (a.nx * a.ny));
      const edge = ix === 0 || iz === 0 || ix === a.nx - 1 || iz === a.nz - 1;
      const same = a.env[i] === ref.env[i];
      refCells++; if (same) refSame++;
      if (edge) { edgeCells++; if (same) edgeSame++; }
    }
  }
  check("floater-free columns: own grid == shared sampler, bit-exact", cleanDiff === 0, `${cleanDiff} differing cells in ${cleanCols} columns`);
  check("all columns: own cells == shared-sampler reference (diffs = floater removal)", refSame / refCells >= 0.995, pct(refSame, refCells) + ` · seam-edge cells ${pct(edgeSame, edgeCells)}`);
  // (2) class continuity across seams vs across interior cell borders (no seam artefact).
  let seamEq = 0, seamN = 0, inEq = 0, inN = 0;
  for (const [key, m] of out) {
    const [cx, cz] = key.split(",").map(Number);
    const a = m.info!;
    const b = out.get(`${cx + 1},${cz}`)?.info;
    for (let iz = 0; iz < a.nz; iz++) for (let iy = 0; iy < a.ny; iy++) {
      for (let ix = 0; ix + 1 < a.nx; ix++) {
        const p = a.env[(iz * a.ny + iy) * a.nx + ix], q = a.env[(iz * a.ny + iy) * a.nx + ix + 1];
        if (p && q) { inN++; if (p === q) inEq++; }
      }
      if (b && b.ck0 === a.ck0 && b.nz === a.nz && b.ci0 === a.ci0 + a.nx) {
        const p = a.env[(iz * a.ny + iy) * a.nx + a.nx - 1], q = b.env[(iz * b.ny + iy) * b.nx];
        if (p && q) { seamN++; if (p === q) seamEq++; }
      }
    }
  }
  const seamRate = seamEq / Math.max(1, seamN), inRate = inEq / Math.max(1, inN);
  check("class continuity across seams ≈ interior", seamN === 0 || seamRate >= inRate - 0.03, `seam ${(seamRate * 100).toFixed(1)}% vs interior ${(inRate * 100).toFixed(1)}% (${seamN} seam pairs)`);

  // --- distribution ---
  const envC = new Array(ENV_KINDS.length).fill(0);
  const surfC = new Array(SURFACE_TYPES.length).fill(0);
  let water = 0, spawns = 0, sheltered = 0;
  const cellsSeen = new Set<string>();
  let dupCells = 0;
  const store = new TerrainInfoStore({ seed, boundsSize: TERRAIN.boundsSize, numPointsPerAxis: TERRAIN.numPointsPerAxis });
  for (const m of out.values()) {
    const a = m.info!;
    store.set(a);
    for (const e of a.env) { envC[e]++; if (e) water++; }
    for (let i = 0; i < a.spawn.count; i++) {
      surfC[a.spawn.type[i]]++;
      if (a.spawn.flags[i] & 1) sheltered++;
      const C = ENV_T.spawnCell;
      const k = `${Math.floor(a.spawn.pos[i * 3] / C)},${Math.floor(a.spawn.pos[i * 3 + 1] / C)},${Math.floor(a.spawn.pos[i * 3 + 2] / C)}`;
      if (cellsSeen.has(k)) dupCells++;
      cellsSeen.add(k);
    }
    spawns += a.spawn.count;
  }
  spawnTotal += spawns;
  for (let i = 0; i < envC.length; i++) envTotal[i] += envC[i];
  for (let i = 0; i < surfC.length; i++) surfTotal[i] += surfC[i];
  console.log("  water classes: " + ENV_KINDS.slice(1).map((k, i) => `${k} ${((envC[i + 1] / water) * 100).toFixed(1)}%`).join(" · "));
  console.log(`  spawn candidates: ${spawns} (${(spawns / out.size).toFixed(0)}/column, sheltered ${((sheltered / spawns) * 100).toFixed(0)}%) · ` +
    SURFACE_TYPES.map((t, i) => `${t} ${surfC[i]}`).join(" · "));
  check("one candidate per spawn cell (no duplicates across columns)", dupCells === 0, `${dupCells} duplicates`);

  // --- sanity (brute force on the field) ---
  const rnd = mulberry32(seed * 31 + 7);
  const infos = [...out.values()].map((m) => m.info!);
  const pickCells = (code: number, max: number) => {
    const res: [number, number, number][] = [];
    for (let tries = 0; tries < 200000 && res.length < max; tries++) {
      const a = infos[Math.floor(rnd() * infos.length)];
      const i = Math.floor(rnd() * a.env.length);
      if (a.env[i] !== code) continue;
      const ix = i % a.nx, iy = Math.floor(i / a.nx) % a.ny, iz = Math.floor(i / (a.nx * a.ny));
      const h = TERRAIN.boundsSize / 2, sp = TERRAIN.boundsSize / (TERRAIN.numPointsPerAxis - 1);
      res.push([-h + (a.ci0 + ix) * a.stride * sp, -h + (a.cj0 + iy) * a.stride * sp, -h + (a.ck0 + iz) * a.stride * sp]);
    }
    return res;
  };
  let ok = 0, nOpen = 0;
  for (const [x, y, z] of pickCells(ENV.OPEN, 60)) {
    nOpen++;
    let clear = march(field, x, y, z, 0, 1, 0, 2.9) === Infinity && march(field, x, y, z, 0, -1, 0, 4.4) === Infinity;
    for (let d = 0; d < 8 && clear; d++) { const a = (d * Math.PI) / 4; clear = march(field, x, y, z, Math.cos(a), 0, Math.sin(a), 2.8) === Infinity; }
    if (clear) ok++;
    else if (process.env.DBG) {
      const ds = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => { const a = (d * Math.PI) / 4; return march(field, x, y, z, Math.cos(a), 0, Math.sin(a), 2.8).toFixed(2); });
      console.log("    open-miss", x.toFixed(2), y.toFixed(2), z.toFixed(2), "up", march(field, x, y, z, 0, 1, 0, 4.4).toFixed(2), "dn", march(field, x, y, z, 0, -1, 0, 4.4).toFixed(2), ds.join(" "), "env", JSON.stringify(store.getEnvAt(x, y, z)));
    }
  }
  check("open cells: no rock within 2.9 up, 4.4 down, 2.8 sideways (brute force)", ok / Math.max(1, nOpen) >= 0.95, pct(ok, nOpen));
  ok = 0; let nCave = 0;
  for (const [x, y, z] of pickCells(ENV.CAVE, 40)) {
    nCave++;
    let closed = 0;
    for (let d = 0; d < 8; d++) { const a = (d * Math.PI) / 4; if (march(field, x, y, z, Math.cos(a), 0, Math.sin(a), 3.3) < Infinity) closed++; }
    if (march(field, x, y, z, 0, 1, 0, 4.7) < Infinity && closed >= 5) ok++;
  }
  check("cave cells: roof ≤ 4.7 and ≥ 5/8 sides closed within 3.3 (brute force)", nCave === 0 || ok / nCave >= 0.9, pct(ok, nCave));
  // stored up / down vs brute force
  let distOk = 0, distN = 0;
  for (const code of [ENV.FLAT, ENV.SLOPE, ENV.OVERHANG, ENV.CLIFF]) {
    for (const [x, y, z] of pickCells(code, 25)) {
      const e = store.getEnvAt(x, y, z);
      if (!e) continue;
      const u = march(field, x, y, z, 0, 1, 0, 64), d = march(field, x, y, z, 0, -1, 0, 64);
      distN++;
      if (Math.abs(Math.min(u, 63) - Math.min(e.up, 63)) < 0.3 && Math.abs(Math.min(d, 63) - Math.min(e.down, 63)) < 0.3) distOk++;
      else if (process.env.DBG) console.log("    dist-miss", x.toFixed(2), y.toFixed(2), z.toFixed(2), "brute", u.toFixed(2), d.toFixed(2), "stored", e.up, e.down);
    }
  }
  check("stored up/down distances match brute force (±0.3)", distOk / Math.max(1, distN) >= 0.95, pct(distOk, distN));
  // spawn candidates sit on the rock surface, normals point into water
  let onSurf = 0, sN = 0, caveFloorSheltered = 0, caveFloors = 0;
  store.forEachSpawn((a, i) => {
    if (sN >= 3000) return;
    const x = a.spawn.pos[i * 3], y = a.spawn.pos[i * 3 + 1], z = a.spawn.pos[i * 3 + 2];
    const nx = a.spawn.nrm[i * 3] / 127, ny = a.spawn.nrm[i * 3 + 1] / 127, nz = a.spawn.nrm[i * 3 + 2] / 127;
    sN++;
    const iso = TERRAIN.isoLevel;
    if (field.sample(x + nx * 0.25, y + ny * 0.25, z + nz * 0.25) < iso && field.sample(x - nx * 0.25, y - ny * 0.25, z - nz * 0.25) >= iso) onSurf++;
    if (a.spawn.type[i] === 7) { caveFloors++; if (a.spawn.flags[i] & 1) caveFloorSheltered++; }
  });
  check("spawn points on the surface (water at +0.25n, rock at −0.25n)", onSurf / sN >= 0.95, pct(onSurf, sN));
  check("cave-floor candidates are sheltered", caveFloors === 0 || caveFloorSheltered === caveFloors, pct(caveFloorSheltered, caveFloors));
  // getEnvAt answers for water points in loaded columns
  let answered = 0, asked = 0;
  for (let t = 0; t < 400; t++) {
    const x = (rnd() * 2 - 1) * (AREA + 0.4) * 10, z = (rnd() * 2 - 1) * (AREA + 0.4) * 10, y = -6 + rnd() * 20;
    if (field.sample(x, y, z) >= TERRAIN.isoLevel - 0.5) continue;
    asked++;
    if (store.getEnvAt(x, y, z)) answered++;
  }
  check("getEnvAt answers for water points in loaded columns", answered / Math.max(1, asked) >= 0.99, pct(answered, asked));
  const q = store.getSpawnCandidates({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, (c) => c.type === "floor-flat" && !c.sheltered);
  console.log(`  query example: exposed floor-flat candidates in the 10×10 spawn column: ${q.length}` + (q[0] ? ` (first at ${q[0].x.toFixed(1)},${q[0].y.toFixed(1)},${q[0].z.toFixed(1)} depth ${q[0].depth.toFixed(1)} env ${q[0].env} region ${q[0].region})` : ""));
}

const water = envTotal.slice(1).reduce((a, b) => a + b, 0);
console.log("ALL water classes: " + ENV_KINDS.slice(1).map((k, i) => `${k} ${((envTotal[i + 1] / water) * 100).toFixed(1)}%`).join(" · "));
console.log("ALL surfaces: " + SURFACE_TYPES.map((t, i) => `${t} ${((surfTotal[i] / spawnTotal) * 100).toFixed(1)}%`).join(" · "));
for (let i = 1; i < ENV_KINDS.length; i++) check(`class ${ENV_KINDS[i]} occurs`, envTotal[i] > 0, `${envTotal[i]}`);
for (let i = 0; i < SURFACE_TYPES.length; i++) check(`surface ${SURFACE_TYPES[i]} occurs`, surfTotal[i] > 0, `${surfTotal[i]}`);
console.log(`cost: column ${(msWithout / cols).toFixed(1)} ms without info → ${(msWith / cols).toFixed(1)} ms with (+${(((msWith - msWithout) / msWithout) * 100).toFixed(1)}%); info build ${(msInfo / cols).toFixed(1)} ms/column`);
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
