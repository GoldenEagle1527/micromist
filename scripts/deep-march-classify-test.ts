/**
 * Node test for terrain/classify.ts: classifies sampled points across seeds,
 * reports the category distribution, runs brute-force sanity checks and times
 * the classifiers. Run: npm run test:classify   (env SEEDS=1,7 N=600)
 */
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh, latticeSpacing } from "../src/games/deep-march/terrain/mesher";
import {
  ENVIRONMENT_KINDS, classifyEnvironment, classifySurface, createTerrainProbe, raycastTerrain,
  EnvironmentTracker, type EnvironmentKind, type TerrainProbe,
} from "../src/games/deep-march/terrain/classify";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";

const SEEDS = (process.env.SEEDS ?? "1,7,12345").split(",").map(Number);
const N = Number(process.env.N ?? 700);
const AREA = 25; // |x|, |z| ≤ AREA (columns meshed for floater removal)
let failures = 0;
const check = (name: string, ok: boolean, info: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${info}`);
  if (!ok) failures++;
};

/** Brute-force: fraction of `dirs` random directions hitting rock within r (fine fixed steps). */
function hitFraction(p: TerrainProbe, x: number, y: number, z: number, r: number, dirs: number[][]): number {
  let hit = 0;
  for (const [dx, dy, dz] of dirs) {
    for (let t = 0.1; t <= r; t += 0.1) if (p.density(x + dx * t, y + dy * t, z + dz * t) >= 0) { hit++; break; }
  }
  return hit / dirs.length;
}
function randDirs(n: number, rnd: () => number, filter: (d: number[]) => boolean = () => true): number[][] {
  const out: number[][] = [];
  while (out.length < n) {
    const d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > 1 || l < 0.1) continue;
    const u = d.map((v) => v / l);
    if (filter(u)) out.push(u);
  }
  return out;
}

const total: Record<string, number> = {};
const surfTotal: Record<string, number> = {};
const shelterAll = [0, 0], exposedAll = [0, 0];
let samplesUsed = 0, envSamples = 0;
let envMs = 0, envCalls = 0, surfMs = 0, surfCalls = 0;

for (const seed of SEEDS) {
  const field = createDensityField(seed, TERRAIN);
  // Floater removal exactly like ChunkManager.isRemoved.
  const n = TERRAIN.numPointsPerAxis;
  const rows = columnRows(field);
  const sp = latticeSpacing(field);
  const h = TERRAIN.boundsSize / 2;
  const cols = new Map<string, Set<number>>();
  const cmax = Math.ceil(AREA / TERRAIN.boundsSize) + 1;
  for (let cx = -cmax; cx <= cmax; cx++) for (let cz = -cmax; cz <= cmax; cz++) {
    const m = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin);
    const set = new Set<number>();
    for (let q = 0; q < m.removed.length; q += 3) set.add((m.removed[q + 1] * (n - 1) + m.removed[q + 2]) * (n - 1) + m.removed[q]);
    cols.set(`${cx},${cz}`, set);
  }
  const isRemoved = (x: number, y: number, z: number) => {
    const gi = Math.floor((x + h) / sp), gj = Math.floor((y + h) / sp), gk = Math.floor((z + h) / sp);
    for (let dk = 0; dk <= 1; dk++) for (let di = 0; di <= 1; di++) {
      const ggi = gi + di, ggk = gk + dk;
      const cx = Math.floor(ggi / (n - 1)), cz = Math.floor(ggk / (n - 1));
      const set = cols.get(`${cx},${cz}`);
      if (!set || set.size === 0) continue;
      const li = ggi - cx * (n - 1), lk = ggk - cz * (n - 1);
      for (let dj = 0; dj <= 1; dj++) if (set.has(((gj + dj - rows.gjMin) * (n - 1) + lk) * (n - 1) + li)) return true;
    }
    return false;
  };
  const base = createTerrainProbe(field, isRemoved);
  const probe: TerrainProbe = { density: (x, y, z) => { samplesUsed++; return base.density(x, y, z); }, normal: base.normal };
  const rnd = mulberry32(seed * 7919 + 3);
  const dist: Record<string, number> = Object.fromEntries(ENVIRONMENT_KINDS.map((k) => [k, 0]));
  const sanity = { open: [0, 0], cave: [0, 0], flat: [0, 0], ceilingCave: [0, 0] };
  const sphere = randDirs(48, rnd);
  const sideUp = randDirs(40, rnd, (d) => d[1] > -0.2);
  const samples: { x: number; y: number; z: number; k: EnvironmentKind }[] = [];

  for (let got = 0; got < N; ) {
    const x = (rnd() * 2 - 1) * AREA, z = (rnd() * 2 - 1) * AREA, y = -6 + rnd() * 20;
    if (probe.density(x, y, z) > -0.5) continue; // diver-sized open point
    got++;
    const s0 = samplesUsed;
    const t0 = performance.now();
    const r = classifyEnvironment(probe, x, y, z);
    envMs += performance.now() - t0; envCalls++;
    envSamples += samplesUsed - s0;
    dist[r.kind]++;
    samples.push({ x, y, z, k: r.kind });
    // Sanity (independent brute force):
    const allFar = hitFraction(probe, x, y, z, 5, sphere) === 0;
    if (allFar) { sanity.open[0]++; if (r.kind === "open") sanity.open[1]++; else if (process.env.DBG) console.log("    open-miss", r.kind, JSON.stringify({ up: r.features.up, down: r.features.down, minSide: r.features.minSide, slope: r.features.floorSlope, fall: r.features.falloff })); }
    const roof = raycastTerrain(probe, x, y, z, 0, 1, 0, 3);
    if (roof && hitFraction(probe, x, y, z, 5, sideUp) >= 0.95) { sanity.cave[0]++; if (r.kind === "cave") sanity.cave[1]++; }
    if (roof && r.kind === "open") sanity.ceilingCave[0]++;
  }
  // Dedicated flat-floor sanity: 1.2 above a floor that is level ±0.5 over r2.5, clear r3 sideways/up.
  for (let tries = 0; tries < 6000; tries++) {
    const x = (rnd() * 2 - 1) * AREA, z = (rnd() * 2 - 1) * AREA, y0 = -6 + rnd() * 16;
    if (probe.density(x, y0, z) >= 0) continue;
    const f0 = raycastTerrain(probe, x, y0, z, 0, -1, 0, 12);
    if (!f0) continue;
    const y = f0.y + 1.2;
    if (probe.density(x, y, z) >= -0.3) continue;
    let lo = f0.y, hi = f0.y;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const f = raycastTerrain(probe, x + Math.cos(a) * 2.5, y, z + Math.sin(a) * 2.5, 0, -1, 0, 4);
      const fy = f ? f.y : -99;
      lo = Math.min(lo, fy); hi = Math.max(hi, fy);
    }
    if (hi - lo >= 1.0 || hitFraction(probe, x, y, z, 3, sideUp) > 0) continue;
    sanity.flat[0]++;
    const rr = classifyEnvironment(probe, x, y, z);
    const k = rr.kind;
    if (k === "flat") sanity.flat[1]++;
    else if (process.env.DBG) console.log("    flat-miss", k, rr.features.floorSlope.toFixed(1), rr.features.minSide.toFixed(1), rr.features.falloff, rr.features.wallSteep.toFixed(2));
  }
  console.log(`seed ${seed}: ${N} open-water points in |x|,|z|≤${AREA}, y∈[−6,14]`);
  console.log("  distribution: " + ENVIRONMENT_KINDS.map((k) => `${k} ${((dist[k] / N) * 100).toFixed(1)}%`).join(" · "));
  for (const k of ENVIRONMENT_KINDS) total[k] = (total[k] ?? 0) + dist[k];
  const pct = (a: number[]) => (a[0] ? `${a[1]}/${a[0]} (${((a[1] / a[0]) * 100).toFixed(0)}%)` : "n/a");
  check("clear sphere r5 → open", sanity.open[0] === 0 || sanity.open[1] / sanity.open[0] >= 0.95, pct(sanity.open));
  check("roof<3 & ≥95% side/up rays hit within 5 → cave", sanity.cave[0] === 0 || sanity.cave[1] / sanity.cave[0] >= 0.85, pct(sanity.cave));
  check("1.2 above floor, level ±0.5 over r2.5, clear r3 → flat", sanity.flat[0] === 0 || sanity.flat[1] / sanity.flat[0] >= 0.85, pct(sanity.flat));
  check("roof<3 never labelled open", sanity.ceilingCave[0] === 0, `${sanity.ceilingCave[0]}`);

  // Surfaces: drop from sampled water points in 6 directions.
  const sd: Record<string, number> = {};
  const orient = { floorDown: [0, 0], ceilUp: [0, 0], wallSide: [0, 0] };
  const shelteredCave = [0, 0], exposedOpen = [0, 0];
  for (const s of samples.slice(0, 300)) {
    for (const [dx, dy, dz, tag] of [[0, -1, 0, "down"], [0, 1, 0, "up"], [1, 0, 0, "side"], [0, 0, 1, "side"]] as const) {
      const hit = raycastTerrain(probe, s.x, s.y, s.z, dx, dy, dz, 8);
      if (!hit) continue;
      const t0 = performance.now();
      const info = classifySurface(probe, hit.x, hit.y, hit.z);
      surfMs += performance.now() - t0; surfCalls++;
      sd[info.type] = (sd[info.type] ?? 0) + 1;
      surfTotal[info.type] = (surfTotal[info.type] ?? 0) + 1;
      const ny = info.normal[1];
      if (tag === "down") { orient.floorDown[0]++; if (ny > -0.2) orient.floorDown[1]++; }
      if (tag === "up") { orient.ceilUp[0]++; if (ny < 0.2) orient.ceilUp[1]++; }
      if (tag === "side") { orient.wallSide[0]++; if (Math.abs(ny) < 0.95) orient.wallSide[1]++; }
      if (tag === "down" && s.k === "cave") { shelteredCave[0]++; if (info.sheltered) shelteredCave[1]++; else if (process.env.DBG) console.log("    cave-floor exposed", JSON.stringify({ ...info, t: hit.t })); }
      if (tag === "down" && s.k === "open") { exposedOpen[0]++; if (!info.sheltered) exposedOpen[1]++; }
    }
  }
  console.log("  surfaces: " + Object.entries(sd).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
  check("down-cast hits face up-ish", orient.floorDown[1] / orient.floorDown[0] >= 0.97, pct(orient.floorDown));
  check("up-cast hits face down-ish", orient.ceilUp[0] === 0 || orient.ceilUp[1] / orient.ceilUp[0] >= 0.97, pct(orient.ceilUp));
  console.log(`  cave floors sheltered ${pct(shelteredCave)} · open-water floors exposed ${pct(exposedOpen)}`);
  for (let i = 0; i < 2; i++) { shelterAll[i] += shelteredCave[i]; exposedAll[i] += exposedOpen[i]; }

  // Tracker hysteresis: a walk sampling 60 fps; count stable-label switches vs raw.
  const tr = new EnvironmentTracker(probe);
  let rawSwitch = 0, stableSwitch = 0, prevRaw: string | null = null, prevStable: string | null = null, maxSlice = 0, sliceSum = 0, slices = 0;
  for (let f = 0; f < 60 * 40; f++) {
    const t = f / 60;
    const x = -20 + t * 1.0, z = Math.sin(t * 0.3) * 6, y = 2 + Math.sin(t * 0.2) * 3;
    if (probe.density(x, y, z) >= 0) continue;
    const first = tr.kind === null;
    const t0 = performance.now();
    tr.update(x, y, z, 1 / 60);
    const dtMs = performance.now() - t0;
    if (!first) { maxSlice = Math.max(maxSlice, dtMs); sliceSum += dtMs; slices++; }
    const rk = tr.last?.kind ?? null;
    if (rk !== prevRaw) { if (prevRaw) rawSwitch++; prevRaw = rk; }
    if (tr.kind !== prevStable) { if (prevStable) stableSwitch++; prevStable = tr.kind; }
  }
  console.log(`  tracker walk 40 s: raw switches ${rawSwitch}, displayed switches ${stableSwitch}, per-frame cost mean ${(sliceSum / slices).toFixed(3)} ms, max ${maxSlice.toFixed(2)} ms (after first eval)`);
  check("hysteresis reduces flicker", stableSwitch <= rawSwitch, `${stableSwitch} ≤ ${rawSwitch}`);
}
for (const k of ENVIRONMENT_KINDS) check(`kind ${k} occurs (all seeds)`, total[k] > 0, `${total[k]}`);
check("cave floors sheltered (all seeds)", shelterAll[0] === 0 || shelterAll[1] / shelterAll[0] >= 0.8, `${shelterAll[1]}/${shelterAll[0]}`);
check("open-water floors exposed (all seeds)", exposedAll[1] / Math.max(1, exposedAll[0]) >= 0.8, `${exposedAll[1]}/${exposedAll[0]}`);
const all = Object.values(total).reduce((a, b) => a + b, 0);
console.log("ALL: " + ENVIRONMENT_KINDS.map((k) => `${k} ${((total[k] / all) * 100).toFixed(1)}%`).join(" · "));
console.log("surfaces ALL: " + Object.entries(surfTotal).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
console.log(`cost: classifyEnvironment ${(envMs / envCalls).toFixed(2)} ms/eval (${envCalls}, ${(envSamples / envCalls).toFixed(0)} density samples), classifySurface ${(surfMs / surfCalls).toFixed(2)} ms/call (${surfCalls})`);
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
