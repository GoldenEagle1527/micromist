/**
 * Node test for the macro terrain regions (regions.ts / regionParams.ts / density.ts):
 * region-size statistics, determinism, seams, bounds, floaters, collision,
 * thin-sheet counts / generation cost / fine terrain classes per region, and a
 * top-down region map PNG.
 * Run: npm run test:regions   (env SEEDS=1,7,12345  MAP=/path/regions-map.png  LOWSPEC=1)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { TERRAIN as DESKTOP, terrainForDevice } from "../src/games/deep-march/terrain/config";
import { ALL_REGIONS_MASK, createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRegionMask, columnRowPlan, columnRows, generateColumnMesh, latticeCoord, latticeSpacing, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { REGION_COLORS, REGION_COUNT, REGION_KEYS, createRegionSample, MACRO } from "../src/games/deep-march/terrain/regions";
import { ENV_KINDS, SURFACE_TYPES } from "../src/games/deep-march/terrain/terrainInfo";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { DiverController } from "../src/games/deep-march/scene/diver";

const TERRAIN = process.env.LOWSPEC ? terrainForDevice(true) : DESKTOP;
const SEEDS = (process.env.SEEDS ?? "1,7,12345").split(",").map(Number);
const MAP = process.env.MAP ?? "/workspace/deep-march-shots/regions-map.png";
const iso = TERRAIN.isoLevel;
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
  ms: 0, cols: 0, tris: 0, floaters: 0, water: 0, cells: 0,
  env: new Array(ENV_KINDS.length).fill(0), surf: new Array(SURFACE_TYPES.length).fill(0),
  runs: 0, thin05: 0, thin10: 0, scans: 0,
}));
const patchAll: number[] = [];

/** Nearest region cores (edge ≥ minEdge) to a point, one per region. */
function cores(f: DensityField, x0: number, z0: number, minEdge: number): ([number, number] | null)[] {
  const best: ([number, number, number] | null)[] = REGION_KEYS.map(() => null);
  for (let z = -600; z <= 600; z += 8) for (let x = -600; x <= 600; x += 8) {
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
  const rows = columnRows(field);
  const sp = latticeSpacing(field);

  // ---------- 1. region-size statistics ----------
  {
    const step = 4, N = 500; // 2000 × 2000 units
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
    const big = sizes.filter((d) => d >= 80).length;
    const areaBig = sizes.filter((d) => d >= 80).reduce((a, d) => a + d * d, 0) / sizes.reduce((a, d) => a + d * d, 0);
    console.log("  region share: " + REGION_KEYS.map((k, i) => `${k} ${pct(share[i], N * N)}`).join(" · "));
    console.log(`  patches (2000×2000 u, interior): ${sizes.length}, equivalent diameter mean ${mean.toFixed(0)} u, median ${sizes[sizes.length >> 1].toFixed(0)} u, ≥ 80 u ${pct(big, sizes.length)} of patches / ${(areaBig * 100).toFixed(1)}% of area`);
    check("most patches ≥ 80 u across", big / sizes.length >= 0.8 && areaBig >= 0.97, `${pct(big, sizes.length)} of patches`);
    // blend band width perpendicular to the border: from a border point (dominant ≈ 0.5)
    // walk along ± the weight gradient until the dominant weight reaches 0.99 on each side
    const rnd = mulberry32(seed);
    const dom = (x: number, z: number) => field.regions.sample(x, z, rs).dominant;
    const widths: number[] = [];
    for (let t = 0; t < 40000 && widths.length < 300; t++) {
      const x = (rnd() - 0.5) * 1600, z = (rnd() - 0.5) * 1600;
      const d0 = dom(x, z);
      if (d0 > 0.56) continue;
      const gx = dom(x + 0.5, z) - dom(x - 0.5, z), gz = dom(x, z + 0.5) - dom(x, z - 0.5);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) continue;
      let a = 0, b = 0;
      while (a < 80 && dom(x + (gx / gl) * a, z + (gz / gl) * a) < 0.99) a += 0.25;
      while (b < 80 && dom(x - (gx / gl) * b, z - (gz / gl) * b) < 0.99) b += 0.25;
      if (a < 80 && b < 80) widths.push(a + b);
    }
    widths.sort((a, b) => a - b);
    const wMed = widths[widths.length >> 1], wMean = widths.reduce((a, b) => a + b, 0) / widths.length;
    console.log(`  blend band (perpendicular, dominant < 0.99): median ${wMed.toFixed(1)} u, mean ${wMean.toFixed(1)} u, p10 ${widths[Math.floor(widths.length * 0.1)].toFixed(1)}, p90 ${widths[Math.floor(widths.length * 0.9)].toFixed(1)} (${widths.length} border points; MACRO.band ${MACRO.band})`);
    check("blend band ≈ 15–20 u", wMed >= 13 && wMed <= 21, `median ${wMed.toFixed(1)} u`);
  }

  // ---------- 2. region map PNG (first seed) ----------
  const spawn = field.regions.spawnPoint();
  const sr = field.regions.sample(spawn.x, spawn.z, rs);
  console.log(`  spawn (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}): ${REGION_KEYS[sr.id]} weight ${sr.dominant.toFixed(2)} edge ${sr.edge.toFixed(0)} u`);
  check("spawn inside reef forest core", sr.id === 1 && sr.dominant >= 0.99, `${REGION_KEYS[sr.id]} ${sr.dominant.toFixed(2)}`);
  if (seed === SEEDS[0]) writeMap(field, spawn, MAP);

  // ---------- 3. determinism ----------
  {
    const f2 = createDensityField(seed, TERRAIN);
    const rnd = mulberry32(seed * 3 + 1);
    let same = 0;
    for (let i = 0; i < 3000; i++) {
      const x = (rnd() - 0.5) * 2000, y = -28 + rnd() * 45, z = (rnd() - 0.5) * 2000;
      if (field.sample(x, y, z) === f2.sample(x, y, z)) same++;
    }
    const c = cores(field, spawn.x, spawn.z, 25);
    let colSame = 0, colN = 0;
    for (const p of c) {
      if (!p) continue;
      const cx = colOf(p[0]), cz = colOf(p[1]);
      const a = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin);
      const b = generateColumnMesh(f2, cx, cz, columnRows(f2), TERRAIN.floaterMargin);
      colN++;
      const eq = (u: ArrayLike<number>, v: ArrayLike<number>) => u.length === v.length && Array.from(u).every((q, i) => q === v[i]);
      if (eq(a.positions, b.positions) && eq(a.indices, b.indices) && eq(a.info!.env, b.info!.env) && eq(a.info!.regionId, b.info!.regionId) && eq(a.info!.spawn.pos, b.info!.spawn.pos)) colSame++;
    }
    check("determinism (fresh field: samples + one column per region identical)", same === 3000 && colSame === colN, `samples ${same}/3000, columns ${colSame}/${colN}`);
  }

  // ---------- 4. per-region columns: cost, classes, thin sheets, collision ----------
  const c = cores(field, spawn.x, spawn.z, 30);
  for (let r = 0; r < REGION_COUNT; r++) {
    const p = c[r];
    if (!p) { console.log(`  (no ${REGION_KEYS[r]} core within 600 u)`); continue; }
    const A = acc[r];
    const bx = colOf(p[0]), bz = colOf(p[1]);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const t0 = performance.now();
      const m = generateColumnMesh(field, bx + dx, bz + dz, rows, TERRAIN.floaterMargin);
      A.ms += performance.now() - t0;
      A.cols++;
      A.tris += m.indices.length / 3;
      A.floaters += m.stats.floaters;
      const info = m.info!;
      for (let i = 0; i < info.env.length; i++) {
        const ix = i % info.nx, iz = Math.floor(i / (info.nx * info.ny));
        const rc = iz * info.nx + ix;
        if (info.regionId[rc] !== r || info.regionW[rc] < 230) continue;
        const y = latticeCoord((info.cj0 + (Math.floor(i / info.nx) % info.ny)) * info.stride, field);
        if (y < -8 && r !== 5) continue; // count the explorable band (trench: all)
        if (y > 14) continue;
        A.cells++;
        if (info.env[i]) { A.water++; A.env[info.env[i]]++; }
      }
      for (let i = 0; i < info.spawn.count; i++) if (info.spawn.region[i] === r && info.spawn.regionW[i] >= 230) A.surf[info.spawn.type[i]]++;
    }
    // thin sheets: vertical scans (0.04 u) at random points of the region (weight ≥ 0.9) within ±500 u
    const rnd = mulberry32(seed * 101 + r);
    let scans = 0;
    for (let t = 0; t < 200000 && scans < 250; t++) {
      const x = spawn.x + (rnd() - 0.5) * 1000, z = spawn.z + (rnd() - 0.5) * 1000;
      if (field.regions.sample(x, z, rs).id !== r || rs.dominant < 0.9) continue;
      scans++;
      let inS = true, start = -30;
      for (let y = -30; y <= 17; y += 0.04) {
        const s = field.sample(x, y, z) >= iso;
        if (s && !inS) { inS = true; start = y; }
        if (!s && inS) {
          inS = false;
          if (start > -30) { A.runs++; const th = y - start; if (th < 0.5) A.thin05++; if (th < 1.0) A.thin10++; }
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
    for (let rad = 20; rad < 600 && !bxz; rad += 10) {
      for (let a = 0; a < 64 && !bxz; a++) {
        const x = spawn.x + Math.cos((a / 64) * Math.PI * 2) * rad, z = spawn.z + Math.sin((a / 64) * Math.PI * 2) * rad;
        const s = field.regions.sample(x, z, rs);
        if (s.dominant < 0.55 && (seed === SEEDS[0] ? rs.w[5] > 0.3 || rs.w[3] > 0.3 : true)) bxz = [x, z];
      }
    }
    const [bx, bz] = bxz!;
    const W = 4;
    const cx0 = colOf(bx) - 2, cz0 = colOf(bz) - 2;
    const s = field.regions.sample(bx, bz, rs);
    console.log(`  border block ${W}×${W} columns at (${bx.toFixed(0)}, ${bz.toFixed(0)}): ` + REGION_KEYS.map((k, i) => (rs.w[i] > 0 ? `${k} ${rs.w[i].toFixed(2)}` : "")).filter(Boolean).join(" / ") + ` (dominant ${s.dominant.toFixed(2)})`);
    const m = n - 1;
    const H = rows.gjMax - rows.gjMin + 1;
    const GW = W * m;
    const solid = new Uint8Array(GW * GW * H);
    const out = new Map<string, ColumnMeshData>();
    for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      const r = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, undefined, true, (dens, px, py) => {
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
      const y = -30 + rnd() * 50;
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
    check("density within global and per-column (region-mask) bounds", viol === 0, `${viol} violations in ${tested} samples`);
    check("skipped rows of per-column plans are really uniform across the floater window", planViol === 0, `${planViol} violations`);
  }
}

// ---------- summary ----------
patchAll.sort((a, b) => a - b);
console.log(`ALL patches: ${patchAll.length}, mean ${(patchAll.reduce((a, b) => a + b, 0) / patchAll.length).toFixed(0)} u, median ${patchAll[patchAll.length >> 1].toFixed(0)} u, ≥ 80 u ${pct(patchAll.filter((d) => d >= 80).length, patchAll.length)}`);
const reefMs = acc[1].ms / Math.max(1, acc[1].cols);
console.log("per region (core columns: 5×5 per seed; thin-sheet scans: 250 per seed):");
for (let r = 0; r < REGION_COUNT; r++) {
  const A = acc[r];
  if (!A.cols) continue;
  const w = A.water || 1, st = A.surf.reduce((a, b) => a + b, 0) || 1;
  console.log(`  ${REGION_KEYS[r].padEnd(8)} gen ${(A.ms / A.cols).toFixed(1)} ms/column (${((A.ms / A.cols / reefMs) * 100).toFixed(0)}% of reef) · ${(A.tris / A.cols / 1000).toFixed(1)}k tri · floaters removed ${A.floaters} · water ${pct(A.water, A.cells)} of the band`);
  console.log(`           env: ` + ENV_KINDS.slice(1).map((k, i) => `${k} ${((A.env[i + 1] / w) * 100).toFixed(0)}%`).join(" "));
  console.log(`           surfaces: ` + SURFACE_TYPES.map((k, i) => `${k} ${((A.surf[i] / st) * 100).toFixed(0)}%`).join(" "));
  console.log(`           thin sheets: ${A.thin05} runs < 0.5 u, ${A.thin10} < 1.0 u of ${A.runs} solid runs in ${A.scans} scans (${((A.thin05 / Math.max(1, A.scans)) * 100).toFixed(1)} per 100 scans)`);
}
const E = (r: number, k: string) => acc[r].env[ENV_KINDS.indexOf(k as never)] / Math.max(1, acc[r].water);
check("sand plains: mostly open water + flat seabed", E(0, "open") + E(0, "flat") >= 0.7, `${((E(0, "open") + E(0, "flat")) * 100).toFixed(0)}%`);
check("canyon belt: canyon + cliff + slope present", E(2, "canyon") + E(2, "cliff") > 0.08, `canyon ${(E(2, "canyon") * 100).toFixed(0)}% cliff ${(E(2, "cliff") * 100).toFixed(0)}%`);
check("cave warren: cave/overhang dominate", E(3, "cave") + E(3, "overhang") >= 0.5 && E(3, "cave") > E(1, "cave"), `cave ${(E(3, "cave") * 100).toFixed(0)}% overhang ${(E(3, "overhang") * 100).toFixed(0)}%`);
check("cave warren: little open water", acc[3].water / Math.max(1, acc[3].cells) < acc[1].water / Math.max(1, acc[1].cells), `water ${pct(acc[3].water, acc[3].cells)} vs reef ${pct(acc[1].water, acc[1].cells)}`);
check("deep trench: mostly open water", E(5, "open") >= 0.5, `${(E(5, "open") * 100).toFixed(0)}%`);
const thinWorst = Math.max(...acc.map((A) => A.thin05 / Math.max(1, A.scans)));
check("thin sheets (< 0.5 u) stay rare in every region", thinWorst < 0.15, `worst ${(thinWorst * 100).toFixed(1)} per 100 scans`);
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

// ---------- PNG map ----------
function writeMap(f: DensityField, spawn: { x: number; z: number }, path: string) {
  const S = 1000; // 1 px = 1 unit, centred on the origin, north (−z) up
  const px = Buffer.alloc((S * 3 + 1) * S);
  const rgb = REGION_COLORS.map((c) => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16)));
  const rsm = createRegionSample();
  for (let y = 0; y < S; y++) {
    px[y * (S * 3 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const r = f.regions.sample(x - S / 2, y - S / 2, rsm);
      let R = 0, G = 0, B = 0;
      for (let q = 0; q < REGION_COUNT; q++) { R += r.w[q] * rgb[q][0]; G += r.w[q] * rgb[q][1]; B += r.w[q] * rgb[q][2]; }
      const shade = r.dominant < 0.55 ? 0.55 : 1; // border line
      const o = y * (S * 3 + 1) + 1 + x * 3;
      const grid = (x - S / 2) % 100 === 0 || (y - S / 2) % 100 === 0 ? 0.85 : 1;
      px[o] = R * shade * grid; px[o + 1] = G * shade * grid; px[o + 2] = B * shade * grid;
    }
  }
  // spawn marker: white ring + cross; origin: small black cross
  const put = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const o = y * (S * 3 + 1) + 1 + x * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const sx = Math.round(spawn.x + S / 2), sy = Math.round(spawn.z + S / 2);
  for (let a = 0; a < 360; a++) for (const rr of [9, 10, 11]) put(Math.round(sx + Math.cos((a * Math.PI) / 180) * rr), Math.round(sy + Math.sin((a * Math.PI) / 180) * rr), [255, 255, 255]);
  for (let d = -14; d <= 14; d++) for (const w of [-1, 0, 1]) { put(sx + d, sy + w, [255, 255, 255]); put(sx + w, sy + d, [255, 255, 255]); }
  for (let d = -6; d <= 6; d++) { put(S / 2 + d, S / 2, [0, 0, 0]); put(S / 2, S / 2 + d, [0, 0, 0]); }
  const crcT = new Uint32Array(256).map((_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0))]));
  console.log(`  region map → ${path} (1000 × 1000 u around the origin, 1 px = 1 u, north up, grid 100 u, white = spawn)`);
}
void ALL_REGIONS_MASK;
