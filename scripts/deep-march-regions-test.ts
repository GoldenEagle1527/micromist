/**
 * Node test for the macro terrain regions (regions.ts / regionParams.ts / density.ts):
 * region-size statistics, determinism, seams, bounds, floaters, collision,
 * thin-sheet counts / generation cost / fine terrain classes per region, and a
 * top-down region map PNG. Distances scale with TERRAIN.worldScale (W): region
 * sizes / bands / search radii are the base design × W; fine terrain classes come
 * from the base-scale classification field (config.baseTerrain) as in the game;
 * generation cost is measured on world columns of every LOD level.
 * Run: npm run test:regions   (env SEEDS=1,7,12345  MAP=/path/regions-map.png  LOWSPEC=1)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { TERRAIN as DESKTOP, baseTerrain, terrainForDevice } from "../src/games/deep-march/terrain/config";
import { ALL_REGIONS_MASK, createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRegionMask, columnRowPlan, columnRows, generateColumnMesh, latticeCoord, latticeSpacing, lodCoord, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { REGION_COLORS, REGION_COUNT, REGION_KEYS, createRegionSample, MACRO } from "../src/games/deep-march/terrain/regions";
import { ENV_KINDS, SURFACE_TYPES } from "../src/games/deep-march/terrain/terrainInfo";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { DiverController } from "../src/games/deep-march/scene/diver";
import { findSpawn, type SpawnSpot } from "../src/games/deep-march/terrain/spawn";

const TERRAIN = process.env.LOWSPEC ? terrainForDevice(true) : DESKTOP;
const SEEDS = (process.env.SEEDS ?? "1,7,12345").split(",").map(Number);
const MAP = process.env.MAP ?? "/workspace/deep-march-shots/regions-map-mega.png";
const iso = TERRAIN.isoLevel;
const WS = TERRAIN.worldScale;
const LEVELS = TERRAIN.lodLevels;
let failures = 0;
const check = (name: string, ok: boolean, info: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${info}`);
  if (!ok) failures++;
};
const pct = (a: number, b: number) => `${b ? ((a / b) * 100).toFixed(1) : "–"}%`;
const rs = createRegionSample();
const n = TERRAIN.numPointsPerAxis;
const colOf = (x: number) => Math.round(x / TERRAIN.boundsSize);

// per-region accumulators over all seeds
const acc = REGION_KEYS.map(() => ({
  ms: 0, cols: 0, tris: 0, floaters: 0, water: 0, cells: 0, infoMs: 0, infoCols: 0,
  lodMs: new Array(LEVELS).fill(0), lodTris: new Array(LEVELS).fill(0), lodCols: new Array(LEVELS).fill(0),
  env: new Array(ENV_KINDS.length).fill(0), surf: new Array(SURFACE_TYPES.length).fill(0),
  runs: 0, thin05: 0, thin10: 0, scans: 0, lowCells: 0, lowCanyon: 0,
}));
const patchAll: number[] = [];
const mapPanels: { field: DensityField; spawn: SpawnSpot; seed: number }[] = [];

/** Nearest region cores (edge ≥ minEdge) to a point, one per region. */
function cores(f: DensityField, x0: number, z0: number, minEdge: number): ([number, number] | null)[] {
  const best: ([number, number, number] | null)[] = REGION_KEYS.map(() => null);
  for (let z = -600 * WS; z <= 600 * WS; z += 8 * WS) for (let x = -600 * WS; x <= 600 * WS; x += 8 * WS) {
    f.regions.sample(x0 + x, z0 + z, rs);
    if (rs.edge < minEdge) continue;
    const d = Math.hypot(x, z);
    const b = best[rs.id];
    if (!b || d < b[0]) best[rs.id] = [d, x0 + x, z0 + z];
  }
  return best.map((b) => (b ? [b[1], b[2]] : null));
}

for (const seed of SEEDS) {
  console.log(`seed ${seed}`);
  const field = createDensityField(seed, TERRAIN);
  const base = createDensityField(seed, baseTerrain(TERRAIN));
  const baseRows = columnRows(base);
  const rows = columnRows(field);
  const sp = latticeSpacing(field);

  // ---------- 1. region-size statistics ----------
  {
    const step = 4 * WS, N = 500; // 2000·W × 2000·W units
    const grid = new Int8Array(N * N);
    const share = new Array(REGION_COUNT).fill(0);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const id = field.regions.sample((i - N / 2) * step, (j - N / 2) * step, rs).id;
      grid[j * N + i] = id;
      share[id]++;
    }
    const seen = new Uint8Array(N * N);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let s0 = 0; s0 < N * N; s0++) {
      if (seen[s0]) continue;
      const id = grid[s0];
      seen[s0] = 1;
      stack.push(s0);
      let a = 0, border = false;
      while (stack.length) {
        const c = stack.pop()!;
        a++;
        const x = c % N, y = (c - x) / N;
        if (x === 0 || y === 0 || x === N - 1 || y === N - 1) border = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const q = ny * N + nx;
          if (!seen[q] && grid[q] === id) { seen[q] = 1; stack.push(q); }
        }
      }
      if (!border) sizes.push(2 * Math.sqrt((a * step * step) / Math.PI)); // equivalent diameter
    }
    sizes.sort((a, b) => a - b);
    patchAll.push(...sizes);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const big = sizes.filter((d) => d >= 80 * WS).length;
    const areaBig = sizes.filter((d) => d >= 80 * WS).reduce((a, d) => a + d * d, 0) / sizes.reduce((a, d) => a + d * d, 0);
    console.log("  region share: " + REGION_KEYS.map((k, i) => `${k} ${pct(share[i], N * N)}`).join(" · "));
    console.log(`  patches (${2000 * WS}×${2000 * WS} u, interior): ${sizes.length}, equivalent diameter mean ${mean.toFixed(0)} u, median ${sizes[sizes.length >> 1].toFixed(0)} u, ≥ ${80 * WS} u ${pct(big, sizes.length)} of patches / ${(areaBig * 100).toFixed(1)}% of area`);
    check(`most patches ≥ ${80 * WS} u across`, big / sizes.length >= 0.8 && areaBig >= 0.97, `${pct(big, sizes.length)} of patches`);
    // blend band width perpendicular to the border: from a border point (dominant ≈ 0.5)
    // walk along ± the weight gradient until the dominant weight reaches 0.99 on each side.
    // "two-region" = points where exactly two regions have weight (a plain border);
    // "all" also starts at triple junctions (where a straight walk is not perpendicular).
    const rnd = mulberry32(seed);
    const dom = (x: number, z: number) => field.regions.sample(x, z, rs).dominant;
    const widths: number[] = [], widths2: number[] = [];
    for (let t = 0; t < 80000 && (widths.length < 300 || widths2.length < 300); t++) {
      const x = (rnd() - 0.5) * 1600 * WS, z = (rnd() - 0.5) * 1600 * WS;
      const d0 = dom(x, z);
      if (d0 > 0.56) continue;
      const two = d0 >= 0.5 && Array.from(rs.w).filter((w) => w > 0.01).length === 2;
      const gx = dom(x + 0.5 * WS, z) - dom(x - 0.5 * WS, z), gz = dom(x, z + 0.5 * WS) - dom(x, z - 0.5 * WS);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) continue;
      let a = 0, b = 0;
      const lim = 80 * WS, st = 0.25 * WS;
      while (a < lim && dom(x + (gx / gl) * a, z + (gz / gl) * a) < 0.99) a += st;
      while (b < lim && dom(x - (gx / gl) * b, z - (gz / gl) * b) < 0.99) b += st;
      if (a < lim && b < lim) {
        if (widths.length < 300) widths.push(a + b);
        if (two && widths2.length < 300) widths2.push(a + b);
      }
    }
    const q = (w: number[], p: number) => [...w].sort((u, v) => u - v)[Math.floor(w.length * p)];
    console.log(`  blend band (perpendicular, dominant < 0.99): two-region borders median ${q(widths2, 0.5).toFixed(1)} u, p10 ${q(widths2, 0.1).toFixed(1)}, p90 ${q(widths2, 0.9).toFixed(1)} · all border points incl. junctions median ${q(widths, 0.5).toFixed(1)}, p90 ${q(widths, 0.9).toFixed(1)} (MACRO.band ${MACRO.band} × W ${WS})`);
    check(`blend band ≈ ${15 * WS}–${20 * WS} u (median), ≤ ${25 * WS} u at p90 across plain borders, ≤ ${36 * WS} u p90 incl. junctions`, q(widths2, 0.5) >= 13 * WS && q(widths2, 0.5) <= 21 * WS && q(widths2, 0.9) <= 25 * WS && q(widths, 0.9) <= 36 * WS,
      `median ${q(widths2, 0.5).toFixed(1)} u, p90 ${q(widths2, 0.9).toFixed(1)} u / ${q(widths, 0.9).toFixed(1)} u`);
  }

  // ---------- 2. spawn (seeded region, open water with clearance) ----------
  const sp0 = findSpawn(field);
  const spawn = { x: sp0.x, z: sp0.z };
  {
    const sr = field.regions.sample(sp0.x, sp0.z, rs);
    let clear = true;
    for (let i = 0; i < 200 && clear; i++) {
      const a = i * 2.39996, b = Math.acos(1 - (2 * (i + 0.5)) / 200);
      clear = field.sample(sp0.x + 1.5 * Math.sin(b) * Math.cos(a), sp0.y + 1.5 * Math.cos(b), sp0.z + 1.5 * Math.sin(b) * Math.sin(a)) < iso;
    }
    const again = findSpawn(createDensityField(seed, TERRAIN));
    console.log(`  spawn (${sp0.x.toFixed(1)}, ${sp0.y.toFixed(1)}, ${sp0.z.toFixed(1)}) yaw ${((sp0.yaw * 180) / Math.PI).toFixed(0)}°: ${REGION_KEYS[sp0.region]} (seeded ${REGION_KEYS[field.regions.spawnRegion()]}) weight ${sr.w[sp0.region].toFixed(2)} edge ${sr.edge.toFixed(0)} u · clearance ${sp0.clearance} u · ${sp0.exits}/8 open sides`);
    check("spawn in the seeded region's core, in open water with clearance (1.5 u sphere clear, ≥ 2 exits)",
      sp0.region === field.regions.spawnRegion() && sr.w[sp0.region] >= 0.99 && clear && sp0.clearance >= 1.8 && sp0.exits >= 2,
      `${REGION_KEYS[sp0.region]} w ${sr.w[sp0.region].toFixed(2)}, sphere ${clear ? "clear" : "HITS ROCK"}`);
    check("spawn deterministic (fresh field → same spot)", again.x === sp0.x && again.y === sp0.y && again.z === sp0.z && again.yaw === sp0.yaw, `${again.x.toFixed(2)},${again.y.toFixed(2)},${again.z.toFixed(2)}`);
    mapPanels.push({ field, spawn: sp0, seed });
  }

  // ---------- 3. determinism ----------
  {
    const f2 = createDensityField(seed, TERRAIN);
    const rnd = mulberry32(seed * 3 + 1);
    let same = 0;
    for (let i = 0; i < 3000; i++) {
      const x = (rnd() - 0.5) * 2000 * WS, y = (-28 + rnd() * 45) * WS, z = (rnd() - 0.5) * 2000 * WS;
      if (field.sample(x, y, z) === f2.sample(x, y, z)) same++;
    }
    const c = cores(field, spawn.x, spawn.z, 25 * WS);
    const b2 = createDensityField(seed, baseTerrain(TERRAIN));
    let colSame = 0, colN = 0;
    for (const p of c) {
      if (!p) continue;
      const cx = colOf(p[0]), cz = colOf(p[1]);
      const a = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, undefined, false);
      const b = generateColumnMesh(f2, cx, cz, columnRows(f2), TERRAIN.floaterMargin, undefined, false);
      const L = LEVELS - 1, size = TERRAIN.boundsSize << L;
      const lx = Math.floor((p[0] + TERRAIN.boundsSize / 2) / size), lz = Math.floor((p[1] + TERRAIN.boundsSize / 2) / size);
      const la = generateColumnMesh(field, lx, lz, columnRows(field, L), TERRAIN.floaterMargin << L, undefined, false, undefined, L);
      const lb = generateColumnMesh(f2, lx, lz, columnRows(f2, L), TERRAIN.floaterMargin << L, undefined, false, undefined, L);
      const bcx = colOf(p[0] / WS), bcz = colOf(p[1] / WS);
      const ia = generateColumnMesh(base, bcx, bcz, baseRows, base.settings.floaterMargin).info!;
      const ib = generateColumnMesh(b2, bcx, bcz, columnRows(b2), b2.settings.floaterMargin).info!;
      colN++;
      const eq = (u: ArrayLike<number>, v: ArrayLike<number>) => u.length === v.length && Array.from(u).every((q, i) => q === v[i]);
      if (eq(a.positions, b.positions) && eq(a.indices, b.indices) && eq(la.positions, lb.positions) && eq(la.indices, lb.indices) && eq(ia.env, ib.env) && eq(ia.regionId, ib.regionId) && eq(ia.spawn.pos, ib.spawn.pos)) colSame++;
    }
    check("determinism (fresh field: samples + one level-0 / top-LOD / classification column per region identical)", same === 3000 && colSame === colN, `samples ${same}/3000, columns ${colSame}/${colN}`);
  }

  // ---------- 4. per-region columns: cost, classes, thin sheets, collision ----------
  const c = cores(field, spawn.x, spawn.z, 30 * WS);
  // JIT / cache warm-up (untimed) so the first region measured is not penalised
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) generateColumnMesh(field, colOf(spawn.x) + dx + 40, colOf(spawn.z) + dz, rows, TERRAIN.floaterMargin, undefined, false);
  for (let r = 0; r < REGION_COUNT; r++) {
    const p = c[r];
    if (!p) { console.log(`  (no ${REGION_KEYS[r]} core within ${600 * WS} u)`); continue; }
    const A = acc[r];
    const bx = colOf(p[0]), bz = colOf(p[1]);
    // world level-0 columns (3×3): generation cost, triangles, floaters
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const t0 = performance.now();
      const m = generateColumnMesh(field, bx + dx, bz + dz, rows, TERRAIN.floaterMargin, undefined, false);
      A.ms += performance.now() - t0;
      A.cols++;
      A.tris += m.indices.length / 3;
      A.floaters += m.stats.floaters;
    }
    // coarser LOD columns containing the core (2×2 per level)
    for (let L = 1; L < LEVELS; L++) {
      const size = TERRAIN.boundsSize << L, rl = columnRows(field, L);
      const lx = Math.floor((p[0] + TERRAIN.boundsSize / 2) / size), lz = Math.floor((p[1] + TERRAIN.boundsSize / 2) / size);
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
        const t0 = performance.now();
        const m = generateColumnMesh(field, lx + dx, lz + dz, rl, TERRAIN.floaterMargin << L, undefined, false, undefined, L);
        A.lodMs[L] += performance.now() - t0;
        A.lodTris[L] += m.indices.length / 3;
        A.lodCols[L]++;
      }
    }
    // fine classes: base-scale classification columns (5×5) around the core, as in the game
    const bbx = colOf(p[0] / WS), bbz = colOf(p[1] / WS);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const t0 = performance.now();
      const m = generateColumnMesh(base, bbx + dx, bbz + dz, baseRows, base.settings.floaterMargin);
      A.infoMs += performance.now() - t0;
      A.infoCols++;
      const info = m.info!;
      for (let i = 0; i < info.env.length; i++) {
        const ix = i % info.nx, iz = Math.floor(i / (info.nx * info.ny));
        const rc = iz * info.nx + ix;
        if (info.regionId[rc] !== r || info.regionW[rc] < 230) continue;
        const y = latticeCoord((info.cj0 + (Math.floor(i / info.nx) % info.ny)) * info.stride, base); // base units
        if (y < -8 && r !== 5) continue; // count the explorable band (trench: all)
        if (y > 14) continue;
        A.cells++;
        if (info.env[i]) { A.water++; A.env[info.env[i]]++; }
        if (info.env[i] && y <= 0) { A.lowCells++; if (info.env[i] === 7) A.lowCanyon++; } // canyon belt: inside the trenches
      }
      for (let i = 0; i < info.spawn.count; i++) if (info.spawn.region[i] === r && info.spawn.regionW[i] >= 230) A.surf[info.spawn.type[i]]++;
    }
    // thin sheets: vertical scans (0.08 u) of the world field at random points of the region
    // (weight ≥ 0.9) within ±500·W u, over the heights where the region can have surfaces
    const rnd = mulberry32(seed * 101 + r);
    const bnd = new Float64Array(2);
    let yA = Infinity, yB = -Infinity;
    for (let y = -40 * WS; y <= 30 * WS; y += 0.5) {
      field.boundsForMask(1 << r, y, bnd);
      if (bnd[0] <= iso && bnd[1] >= iso) { yA = Math.min(yA, y); yB = Math.max(yB, y); }
    }
    let scans = 0;
    for (let t = 0; t < 200000 && scans < 150; t++) {
      const x = spawn.x + (rnd() - 0.5) * 1000 * WS, z = spawn.z + (rnd() - 0.5) * 1000 * WS;
      if (field.regions.sample(x, z, rs).id !== r || rs.dominant < 0.9) continue;
      scans++;
      let inS = true, start = yA - 1;
      for (let y = yA - 1; y <= yB + 1; y += 0.08) {
        const s = field.sample(x, y, z) >= iso;
        if (s && !inS) { inS = true; start = y; }
        if (!s && inS) {
          inS = false;
          if (start > yA - 1) { A.runs++; const th = y - start; if (th < 0.5) A.thin05++; if (th < 1.0) A.thin10++; }
        }
      }
    }
    A.scans += scans;
  }

  // collision: dive around each region core with the real diver controller
  {
    let inRock = 0, ticks = 0, escaped = 0, runs = 0;
    const bnd = new Float64Array(2);
    const yLo = latticeCoord(rows.gjMin, field), yHi = latticeCoord(rows.gjMax, field);
    for (let r = 0; r < REGION_COUNT; r++) {
      const p = c[r];
      if (!p) continue;
      const d = new DiverController(field);
      d.spawn(p[0], p[1]);
      runs++;
      const rnd = mulberry32(seed * 7 + r);
      for (let step = 0; step < 60; step++) {
        d.look((rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.5);
        d.update(0.25, { forward: 1, strafe: rnd() - 0.5, up: rnd() < 0.3, down: rnd() < 0.3, sprint: rnd() < 0.5 });
        ticks += d.lastTicks;
        if (field.sample(d.position.x, d.position.y, d.position.z) >= iso) inRock++;
        field.bounds(d.position.y, bnd);
        if (d.position.y < yLo || d.position.y > yHi) escaped++;
      }
    }
    check("collision: diver never ends a step inside rock, stays inside the sealed world", inRock === 0 && escaped === 0, `${runs} dives, ${ticks} ticks, in rock ${inRock}, outside ${escaped}`);
  }

  // ---------- 5. border block: seams, bounds, row plans, floaters ----------
  {
    // a point on a border between two regions near the spawn
    let bxz: [number, number] | null = null;
    for (let rad = 20 * WS; rad < 600 * WS && !bxz; rad += 10 * WS) {
      for (let a = 0; a < 64 && !bxz; a++) {
        const x = spawn.x + Math.cos((a / 64) * Math.PI * 2) * rad, z = spawn.z + Math.sin((a / 64) * Math.PI * 2) * rad;
        const s = field.regions.sample(x, z, rs);
        if (s.dominant < 0.55 && (seed === SEEDS[0] ? rs.w[5] > 0.3 || rs.w[3] > 0.3 : true)) bxz = [x, z];
      }
    }
    const [bx, bz] = bxz!;
    const W = 3; // block width in level-0 columns
    const cx0 = colOf(bx) - 1, cz0 = colOf(bz) - 1;
    const s = field.regions.sample(bx, bz, rs);
    console.log(`  border block ${W}×${W} columns at (${bx.toFixed(0)}, ${bz.toFixed(0)}): ` + REGION_KEYS.map((k, i) => (rs.w[i] > 0 ? `${k} ${rs.w[i].toFixed(2)}` : "")).filter(Boolean).join(" / ") + ` (dominant ${s.dominant.toFixed(2)})`);
    const m = n - 1;
    const H = rows.gjMax - rows.gjMin + 1;
    const GW = W * m;
    const solid = new Uint8Array(GW * GW * H);
    const out = new Map<string, ColumnMeshData>();
    for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      const r = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, undefined, false, (dens, px, py) => {
        for (let k = 0; k < m; k++) for (let j = 0; j < H; j++) for (let i = 0; i < m; i++) {
          solid[((dz * m + k) * H + j) * GW + dx * m + i] = dens[((k + 1) * py + (j + 1)) * px + (i + 1)] >= iso ? 1 : 0;
        }
      });
      out.set(`${cx},${cz}`, r);
    }
    // seams: vertices on the shared planes must coincide exactly
    let seamV = 0, seamMiss = 0;
    const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    for (const [k, a] of out) {
      const [cx, cz] = k.split(",").map(Number);
      for (const [nx, nz, axis] of [[cx + 1, cz, 0], [cx, cz + 1, 2]] as const) {
        const b = out.get(`${nx},${nz}`);
        if (!b) continue;
        const plane = latticeCoord((axis === 0 ? cx : cz) * m + m, field);
        const setOf = (d: ColumnMeshData) => {
          const set = new Set<string>();
          for (let v = 0; v < d.positions.length; v += 3) if (Math.abs(d.positions[v + axis] - plane) < 1e-5) set.add(key(d.positions[v], d.positions[v + 1], d.positions[v + 2]));
          return set;
        };
        const sa = setOf(a), sb = setOf(b);
        for (const q of sa) { seamV++; if (!sb.has(q)) seamMiss++; }
        for (const q of sb) if (!sa.has(q)) seamMiss++;
      }
    }
    check("seams across the region border: shared-plane vertices identical", seamMiss === 0 && seamV > 0, `${seamV} seam vertices, ${seamMiss} unmatched`);
    // floaters: flood the owned block from the hard bottom/top rows
    const lab = new Uint8Array(solid.length);
    let floating = 0, comps = 0;
    const st: number[] = [];
    for (let s0 = 0; s0 < solid.length; s0++) {
      if (!solid[s0] || lab[s0]) continue;
      comps++;
      lab[s0] = 1;
      st.push(s0);
      let anchored = false, border = false;
      while (st.length) {
        const q = st.pop()!;
        const x = q % GW, y = Math.floor(q / GW) % H, z = Math.floor(q / (GW * H));
        if (y === 0 || y === H - 1) anchored = true;
        if (x === 0 || z === 0 || x === GW - 1 || z === GW - 1) border = true;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= GW || ny >= H || nz >= GW) continue;
          const ni = (nz * H + ny) * GW + nx;
          if (solid[ni] && !lab[ni]) { lab[ni] = 1; st.push(ni); }
        }
      }
      if (!anchored && !border) floating++;
    }
    let removed = 0;
    for (const r of out.values()) removed += r.stats.floaters;
    check("no floating rock left in the border block (26-connected flood from the hard rows)", floating === 0, `${comps} components, ${floating} floating, ${removed} removed by the mesher`);
    // bounds + per-column row plans
    const rnd = mulberry32(seed + 99);
    let viol = 0, planViol = 0, tested = 0;
    const bnd = new Float64Array(2);
    for (let t = 0; t < 20000; t++) {
      const x = latticeCoord(cx0 * m, field) + rnd() * W * TERRAIN.boundsSize, z = latticeCoord(cz0 * m, field) + rnd() * W * TERRAIN.boundsSize;
      const y = (-30 + rnd() * 50) * WS;
      const v = field.sample(x, y, z);
      field.bounds(y, bnd);
      if (v < bnd[0] - 1e-9 || v > bnd[1] + 1e-9) viol++;
      const mask = columnRegionMask(field, Math.floor((x + TERRAIN.boundsSize / 2) / TERRAIN.boundsSize), Math.floor((z + TERRAIN.boundsSize / 2) / TERRAIN.boundsSize));
      field.boundsForMask(mask, y, bnd);
      if (v < bnd[0] - 1e-9 || v > bnd[1] + 1e-9) viol++;
      tested++;
    }
    // every row a column plan skips must really be always-rock / always-water across its window
    for (const [k] of out) {
      const [cx, cz] = k.split(",").map(Number);
      const plan = columnRowPlan(field, rows, columnRegionMask(field, cx, cz));
      const y0 = latticeCoord(rows.gjMin, field);
      const margin = TERRAIN.floaterMargin + 1;
      for (let t = 0; t < 400; t++) {
        const j = Math.floor(rnd() * plan.py);
        if (!plan.rowSkip[j]) continue;
        const x = latticeCoord(cx * m, field) - margin + rnd() * (TERRAIN.boundsSize + 2 * margin);
        const z = latticeCoord(cz * m, field) - margin + rnd() * (TERRAIN.boundsSize + 2 * margin);
        const v = field.sample(x, y0 + (j - 1) * sp, z);
        if ((plan.rowKind[j] === 2) !== (v >= iso)) planViol++;
      }
    }
    // coarse LOD columns mesh the raw field: raw bounds per LOD column mask
    let lodViol = 0;
    for (let L = 1; L < LEVELS; L++) {
      const size = TERRAIN.boundsSize << L;
      for (let t = 0; t < 2000; t++) {
        const x = bx + (rnd() - 0.5) * size * 2, z = bz + (rnd() - 0.5) * size * 2, y = (-30 + rnd() * 50) * WS;
        const v = field.sampleRaw(x, y, z);
        const mask = columnRegionMask(field, Math.floor((x + TERRAIN.boundsSize / 2) / size), Math.floor((z + TERRAIN.boundsSize / 2) / size), L);
        field.rawBoundsForMask(mask, y, bnd);
        if (v < bnd[0] - 1e-9 || v > bnd[1] + 1e-9) lodViol++;
        tested++;
      }
    }
    viol += lodViol;
    check("density within global and per-column (region-mask) bounds, incl. raw bounds of every LOD", viol === 0, `${viol} violations in ${tested} samples (LOD ${lodViol})`);
    // LOD columns: seams between same-level neighbours identical; skirts only along column sides
    {
      let lodSeam = 0, lodMiss = 0, skirtBad = 0;
      for (let L = 1; L < LEVELS; L++) {
        const size = TERRAIN.boundsSize << L, rl = columnRows(field, L);
        const lx = Math.floor((bx + TERRAIN.boundsSize / 2) / size), lz = Math.floor((bz + TERRAIN.boundsSize / 2) / size);
        const a = generateColumnMesh(field, lx, lz, rl, TERRAIN.floaterMargin << L, undefined, false, undefined, L, false);
        const b = generateColumnMesh(field, lx + 1, lz, rl, TERRAIN.floaterMargin << L, undefined, false, undefined, L, false);
        const plane = lodCoord((lx + 1) * m, field, L);
        const setOf = (d: ColumnMeshData) => {
          const set = new Set<string>();
          for (let v = 0; v < d.positions.length; v += 3) if (Math.abs(d.positions[v] - plane) < 1e-5) set.add(key(d.positions[v], d.positions[v + 1], d.positions[v + 2]));
          return set;
        };
        const sa = setOf(a), sb = setOf(b);
        for (const q of sa) { lodSeam++; if (!sb.has(q)) lodMiss++; }
        for (const q of sb) if (!sa.has(q)) lodMiss++;
        // with skirts: extra vertices lie ≤ 2 cells inside the column footprint, extra triangles only
        const sk = generateColumnMesh(field, lx, lz, rl, TERRAIN.floaterMargin << L, undefined, false, undefined, L, true);
        const x0 = lodCoord(lx * m, field, L), z0 = lodCoord(lz * m, field, L), spL = size / m;
        for (let v = a.positions.length; v < sk.positions.length; v += 3) {
          const x = sk.positions[v], z = sk.positions[v + 2];
          if (x < x0 - 1e-4 - 2 * spL || x > x0 + size + 2 * spL || z < z0 - 1e-4 - 2 * spL || z > z0 + size + 2 * spL) skirtBad++;
        }
        if (sk.positions.length < a.positions.length || Array.from(a.positions).some((q, i) => q !== sk.positions[i])) skirtBad++;
      }
      check("LOD columns: same-level seams identical; skirts only add vertices near the column sides", lodMiss === 0 && lodSeam > 0 && skirtBad === 0, `${lodSeam} seam vertices, ${lodMiss} unmatched, ${skirtBad} bad skirt vertices`);
    }
    check("skipped rows of per-column plans are really uniform across the floater window", planViol === 0, `${planViol} violations`);
  }
}

// ---------- summary ----------
patchAll.sort((a, b) => a - b);
console.log(`ALL patches: ${patchAll.length}, mean ${(patchAll.reduce((a, b) => a + b, 0) / patchAll.length).toFixed(0)} u, median ${patchAll[patchAll.length >> 1].toFixed(0)} u, ≥ ${80 * WS} u ${pct(patchAll.filter((d) => d >= 80 * WS).length, patchAll.length)}`);
const reefMs = acc[1].ms / Math.max(1, acc[1].cols);
console.log(`per region (world scale ${WS}; level-0 columns 3×3 per seed, LOD 1…${LEVELS - 1} 2×2 per seed; classification: base-scale columns 5×5 per seed; thin-sheet scans: 150 per seed):`);
for (let r = 0; r < REGION_COUNT; r++) {
  const A = acc[r];
  if (!A.cols) continue;
  const w = A.water || 1, st = A.surf.reduce((a, b) => a + b, 0) || 1;
  console.log(`  ${REGION_KEYS[r].padEnd(8)} gen L0 ${(A.ms / A.cols).toFixed(1)} ms/column (${((A.ms / A.cols / reefMs) * 100).toFixed(0)}% of reef) · ${(A.tris / A.cols / 1000).toFixed(1)}k tri · floaters removed ${A.floaters} · classification ${(A.infoMs / Math.max(1, A.infoCols)).toFixed(0)} ms/base column · water ${pct(A.water, A.cells)} of the band`);
  console.log(`           LOD: ` + A.lodMs.map((ms, L) => (L === 0 ? null : `L${L} ${(ms / Math.max(1, A.lodCols[L])).toFixed(0)} ms ${(A.lodTris[L] / Math.max(1, A.lodCols[L]) / 1000).toFixed(1)}k tri`)).filter(Boolean).join(" · "));
  console.log(`           env: ` + ENV_KINDS.slice(1).map((k, i) => `${k} ${((A.env[i + 1] / w) * 100).toFixed(0)}%`).join(" "));
  console.log(`           surfaces: ` + SURFACE_TYPES.map((k, i) => `${k} ${((A.surf[i] / st) * 100).toFixed(0)}%`).join(" "));
  console.log(`           thin sheets: ${A.thin05} runs < 0.5 u, ${A.thin10} < 1.0 u of ${A.runs} solid runs in ${A.scans} scans (${((A.thin05 / Math.max(1, A.scans)) * 100).toFixed(1)} per 100 scans)`);
}
const E = (r: number, k: string) => acc[r].env[ENV_KINDS.indexOf(k as never)] / Math.max(1, acc[r].water);
check("sand plains: mostly open water + flat seabed", E(0, "open") + E(0, "flat") >= 0.7, `${((E(0, "open") + E(0, "flat")) * 100).toFixed(0)}%`);
const lowCan = acc[2].lowCanyon / Math.max(1, acc[2].lowCells);
check("canyon belt: trenches read as canyon (≥ 8% of all water, ≥ 50% of water cells below the rim y ≤ 0)", E(2, "canyon") >= 0.08 && lowCan >= 0.5, `canyon ${(E(2, "canyon") * 100).toFixed(0)}% of water, ${(lowCan * 100).toFixed(0)}% inside trenches · cliff ${(E(2, "cliff") * 100).toFixed(0)}%`);
check("cave warren: tunnels read as cave (cave ≥ 40%, more than overhang)", E(3, "cave") >= 0.4 && E(3, "cave") > E(3, "overhang"), `cave ${(E(3, "cave") * 100).toFixed(0)}% overhang ${(E(3, "overhang") * 100).toFixed(0)}%`);
check("cave warren: little open water", acc[3].water / Math.max(1, acc[3].cells) < acc[1].water / Math.max(1, acc[1].cells), `water ${pct(acc[3].water, acc[3].cells)} vs reef ${pct(acc[1].water, acc[1].cells)}`);
check("deep trench: mostly open water", E(5, "open") >= 0.5, `${(E(5, "open") * 100).toFixed(0)}%`);
// spawn regions over many seeds: every region reachable, roughly uniform
{
  const cnt = new Array(REGION_COUNT).fill(0);
  let bad = 0, msMax = 0;
  const N = Number(process.env.SPAWN_SEEDS ?? 60);
  for (let sd = 1; sd <= N; sd++) {
    const f = createDensityField(sd, TERRAIN);
    const t0 = performance.now();
    const sp = findSpawn(f);
    msMax = Math.max(msMax, performance.now() - t0);
    cnt[sp.region]++;
    if (sp.region !== f.regions.spawnRegion() || f.sample(sp.x, sp.y, sp.z) >= iso || sp.clearance < 1.8) bad++;
  }
  console.log(`spawn regions over seeds 1…${N}: ` + REGION_KEYS.map((k, i) => `${k} ${cnt[i]}`).join(" · ") + ` · slowest search ${msMax.toFixed(0)} ms`);
  check("spawn: all 6 regions occur, every spawn in its seeded region with clearance", cnt.every((v) => v > 0) && bad === 0, `${bad} bad`);
}
writeMap(mapPanels, MAP);
const thinWorst = Math.max(...acc.map((A) => A.thin05 / Math.max(1, A.scans)));
check("thin sheets (< 0.5 u) stay rare in every region", thinWorst < 0.15, `worst ${(thinWorst * 100).toFixed(1)} per 100 scans`);
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

// ---------- PNG map ----------
/** One 1000 × 1000-px panel per seed (1 px = W u, centred on the origin, north up), side by side. */
function writeMap(panels: { field: DensityField; spawn: SpawnSpot; seed: number }[], path: string) {
  const S = 1000, G = 12;
  const Wd = panels.length * S + (panels.length - 1) * G;
  const row = Wd * 3 + 1;
  const px = Buffer.alloc(row * S, 255);
  const rgb = REGION_COLORS.map((c) => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16)));
  const rsm = createRegionSample();
  const put = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= Wd || y >= S) return; const o = y * row + 1 + x * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  for (let y = 0; y < S; y++) px[y * row] = 0;
  panels.forEach(({ field: f, spawn }, pi) => {
    const X0 = pi * (S + G);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = f.regions.sample((x - S / 2) * WS, (y - S / 2) * WS, rsm);
      let R = 0, Gc = 0, B = 0;
      for (let q = 0; q < REGION_COUNT; q++) { R += r.w[q] * rgb[q][0]; Gc += r.w[q] * rgb[q][1]; B += r.w[q] * rgb[q][2]; }
      const shade = r.dominant < 0.55 ? 0.55 : 1; // border line
      const grid = (x - S / 2) % 100 === 0 || (y - S / 2) % 100 === 0 ? 0.85 : 1;
      put(X0 + x, y, [R * shade * grid, Gc * shade * grid, B * shade * grid]);
    }
    // spawn: white ring + cross with a black outline; origin: small black cross
    const sx = X0 + Math.round(spawn.x / WS + S / 2), sy = Math.round(spawn.z / WS + S / 2);
    for (let a = 0; a < 720; a++) for (const [rr, c] of [[8, 0], [9, 255], [10, 255], [11, 255], [12, 0]] as const) put(Math.round(sx + Math.cos((a * Math.PI) / 360) * rr), Math.round(sy + Math.sin((a * Math.PI) / 360) * rr), [c, c, c]);
    for (let d = -16; d <= 16; d++) for (const w of [-1, 0, 1]) { put(sx + d, sy + w, [255, 255, 255]); put(sx + w, sy + d, [255, 255, 255]); }
    for (let d = -6; d <= 6; d++) { put(X0 + S / 2 + d, S / 2, [0, 0, 0]); put(X0 + S / 2, S / 2 + d, [0, 0, 0]); }
  });
  const crcT = new Uint32Array(256).map((_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(Wd, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0))]));
  console.log(`region map → ${path} (seeds ${panels.map((p) => `${p.seed}: ${REGION_KEYS[p.spawn.region]} spawn`).join(", ")}; ${1000 * WS} × ${1000 * WS} u per panel, 1 px = ${WS} u, north up, grid ${100 * WS} u, white ring = spawn)`);
}
void ALL_REGIONS_MASK;
