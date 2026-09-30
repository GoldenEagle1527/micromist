/**
 * Conserve mode — bounded 10 × 10 world and its site table (conserve/world,
 * terrain/siteLayout + the layout paths of regions / density / spawn):
 *   - biome vocabulary = the terrain's regions (order and frequencies);
 *   - site hashes, largest-remainder allocation, in-site split: exact integers;
 *   - site table: same (seed, gen, R) → identical table; Σ_i a_{i,k} = R_k for
 *     random R; frozen sites get π = 0 and keep their stored values; edge sites
 *     get less; region draw monotone in R; δ monotone in rock and clamped ±δmax;
 *   - terrain layout: well-formed, centred; region field follows the layout
 *     inside, equals the endless field far outside; the δ term adds exactly
 *     S · Σ w_i δ_i to the raw density, 0 without a layout;
 *   - spawn: never on a wall-adjacent site; hard-edge clamp;
 *   - performance: the δ term costs ≤ 2 % per column (time per noise sample, same
 *     sites with and without δ; δ also reshapes the rock, reported separately).
 * Run: npm run test:world
 */
import { AFFINITY, BIOMES, BIOME_WEIGHTS, SITE_TABLE } from "../src/games/deep-march/conserve/config";
import { particleIndex } from "../src/games/deep-march/conserve/particles/particleTypes";
import { largestRemainder } from "../src/games/deep-march/conserve/world/allocate";
import { drawRegion, regionProbabilities } from "../src/games/deep-march/conserve/world/regionDraw";
import { HASH_SALT, siteHash } from "../src/games/deep-march/conserve/world/siteHash";
import { splitCount, splitSite } from "../src/games/deep-march/conserve/world/siteSplit";
import { allocatedTotals, buildSiteTable, type FrozenSite } from "../src/games/deep-march/conserve/world/siteTable";
import { summarizeSites } from "../src/games/deep-march/conserve/world/siteSummary";
import { genesisMeanRock, rockBias } from "../src/games/deep-march/conserve/world/terrainBias";
import { terrainLayoutOf } from "../src/games/deep-march/conserve/platform/terrainLayout";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh } from "../src/games/deep-march/terrain/mesher";
import { MACRO, REGION_KEYS, REGION_WEIGHTS, createRegionField, createRegionSample } from "../src/games/deep-march/terrain/regions";
import { assertSiteLayout, clampInsideRect, insideRect, layoutRect } from "../src/games/deep-march/terrain/siteLayout";
import { findSpawn } from "../src/games/deep-march/terrain/spawn";
import { DiverController, EDGE_MARGIN } from "../src/games/deep-march/scene/diver";
import { createChecker } from "./lib/checks";
import { genesisLayout, genesisTable, unbiased } from "./lib/worldFixture";

const c = createChecker();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let rs = 12345;
const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
const ROCK = particleIndex("lithic");
const LUMEN = particleIndex("lumen");
const FERRO = particleIndex("ferro");

c.section("biome vocabulary");
c.check(same(BIOMES, REGION_KEYS), "biomes in the terrain's region order", BIOMES.join(" "));
c.check(BIOMES.every((b, r) => BIOME_WEIGHTS[b] === REGION_WEIGHTS[r]), "biome frequencies = REGION_WEIGHTS");
c.check(BIOMES.every((b) => AFFINITY[b].lithic === 1), "rock affinity 1.0 in every biome (§3.4)");

c.section("site hash, allocation, split");
{
  const hs = Array.from({ length: 5000 }, (_, i) => siteHash(7, 1, i, HASH_SALT.region));
  c.check(hs.every((h) => h >= 0 && h < 1) && siteHash(7, 1, 3, 4) === siteHash(7, 1, 3, 4), "hash in [0, 1), deterministic");
  const base = siteHash(7, 1, 3, 4);
  c.check(base !== siteHash(8, 1, 3, 4) && base !== siteHash(7, 2, 3, 4) && base !== siteHash(7, 1, 4, 4) && base !== siteHash(7, 1, 3, 5), "every argument changes the hash");
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  c.check(Math.abs(mean - 0.5) < 0.02, "roughly uniform", `mean ${mean.toFixed(3)}`);
  let bad = 0;
  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 120), total = Math.floor(rnd() * 70000);
    const w = Array.from({ length: n }, () => (rnd() < 0.2 ? 0 : rnd() * 3));
    if (!w.some((x) => x > 0)) w[0] = 1;
    const tie = Array.from({ length: n }, () => rnd());
    const a = largestRemainder(total, w, tie);
    const sw = w.reduce((x, y) => x + y, 0);
    const ok = a.reduce((x, y) => x + y, 0) === total && a.every((v, i) => Number.isInteger(v) && v >= 0 && (w[i] > 0 || v === 0) && Math.abs(v - (total * w[i]) / sw) < 1 + 1e-9);
    if (!ok || !same(a, largestRemainder(total, w, tie))) bad++;
  }
  c.check(bad === 0, "largest remainder: Σ = total, integers, zero weight → 0, within 1 of the quota, deterministic (2000 random cases)", `${bad} bad`);
  c.check(same(largestRemainder(3, [1, 1, 1, 1], [0.1, 0.9, 0.5, 0.2]), [0, 1, 1, 1]), "ties broken by the tie hash");
  let splitBad = 0;
  for (let n = 0; n < 3000; n++) for (const sh of [{ terrain: 0.85, nodes: 0.15, creatures: 0 }, { terrain: 0, nodes: 0.55, creatures: 0.45 }, { terrain: 0, nodes: 0.9, creatures: 0.1 }]) {
    const p = splitCount(n, sh);
    if (p[0] + p[1] + p[2] !== n || p.some((v) => v < 0) || (sh.creatures === 0 && p[2] !== 0)) splitBad++;
  }
  c.check(splitBad === 0, "split: parts add up exactly, empty buckets stay empty (0 … 2999 × 3 tables)");
  const sp = splitSite([1000, 0, 400, 50, 0, 0, 0]);
  c.check(sp.terrain[ROCK] === 850 && sp.nodes[ROCK] === 150 && sp.nodes[LUMEN] === 220 && sp.creatures[LUMEN] === 180 && sp.nodes[FERRO] === 45 && sp.creatures[FERRO] === 5, "split shares: rock 85/15, lumen 55/45, others 90/10");
}

c.section("terrain bias δ");
{
  const mean = 654;
  const ds = Array.from({ length: 400 }, (_, i) => rockBias((i * mean * 3) / 400, mean));
  c.check(ds.every((d, i) => i === 0 || d >= ds[i - 1]), "monotone in the rock count");
  c.check(ds.every((d) => Math.abs(d) <= SITE_TABLE.maxBias) && rockBias(0, mean) === -SITE_TABLE.maxBias && rockBias(1e9, mean) === SITE_TABLE.maxBias, "clamped to ±δmax", `δmax ${SITE_TABLE.maxBias}`);
  c.check(rockBias(mean, mean) === 0 && Math.abs(rockBias(mean / 2, mean) + SITE_TABLE.beta * Math.LN2) < 1e-12, "δ(ā) = 0, δ(ā/2) = −β ln 2");
}

c.section("region draw");
{
  const totals = [66000, 0, 17000, 17000, 0, 0, 0];
  const full = regionProbabilities(totals, totals);
  c.check(Math.abs(full.reduce((a, b) => a + b, 0) - 1) < 1e-12 && BIOMES.every((b, r) => Math.abs(full[r] - BIOME_WEIGHTS[b] / 1) < 1e-12), "full world: the plain frequencies (inactive kinds leave the factor at 1)");
  let mono = true, prev = Infinity;
  for (let q = 17000; q >= 0; q -= 500) {
    const p = regionProbabilities([66000, 0, q, 17000, 0, 0, 0], totals);
    if (p[1] > prev + 1e-15) mono = false;
    prev = p[1];
  }
  c.check(mono && prev === 0, "P(reef) falls monotonically as R_lumen falls (0 when none is left)");
  const half = regionProbabilities([66000, 0, 8500, 17000, 0, 0, 0], totals);
  c.check(half[1] < full[1] && half[0] > full[0] && half[2] > full[2], "a scarcer signature shifts the draw to the other biomes");
  const count = (R: number[]) => {
    let reef = 0;
    for (let seed = 1; seed <= 60; seed++) reef += buildSiteTable({ seed, gen: 1, allocInput: R, totals }).sites.filter((s) => s.biome === "reef").length;
    return reef;
  };
  const nFull = count(totals), nHalf = count([66000, 0, 8500, 17000, 0, 0, 0]), nLow = count([66000, 0, 2000, 17000, 0, 0, 0]);
  c.check(nFull > nHalf && nHalf > nLow, "site tables: fewer reef sites as lumen runs out (60 seeds)", `${nFull} → ${nHalf} → ${nLow}`);
  c.check(drawRegion([0.5, 0.5], 0) === 0 && drawRegion([0.5, 0.5], 0.75) === 1 && drawRegion([0.3, 0.3, 0], 0.9999999) === 1, "draw by cumulative probability");
}

c.section("site table");
{
  const t1 = genesisTable(42), t2 = genesisTable(42);
  c.check(same(t1, t2), "same (seed, gen, R) → identical table");
  const g2 = buildSiteTable({ seed: 42, gen: 2, allocInput: t1.allocInput, totals: [66000, 0, 17000, 17000, 0, 0, 0] });
  c.check(!same(t1.sites.map((s) => s.region), g2.sites.map((s) => s.region)), "next generation redraws the layout");
  c.check(t1.sites.length === 100 && same(allocatedTotals(t1), t1.allocInput) && t1.allocInput[ROCK] === 65400, "genesis: 100 sites, Σ_i a_i = R (rock 65,400 after the lander cargo)");
  let bad = 0;
  for (let t = 0; t < 40; t++) {
    const R = [Math.floor(rnd() * 66000), 0, Math.floor(rnd() * 17000), Math.floor(rnd() * 17000), 0, 0, 0];
    const tb = buildSiteTable({ seed: 1 + t, gen: 1 + (t % 5), allocInput: R, totals: [66000, 0, 17000, 17000, 0, 0, 0] });
    if (!same(allocatedTotals(tb), R) || tb.sites.some((s) => s.alloc.some((n) => !Number.isInteger(n) || n < 0))) bad++;
    if (tb.sites.some((s) => s.split.terrain.some((n, k) => n + s.split.nodes[k] + s.split.creatures[k] !== s.alloc[k]))) bad++;
  }
  c.check(bad === 0, "Σ_i a_{i,k} = R_k and splits exact for 40 random R vectors");
  const frozen: FrozenSite[] = [44, 45, 46, 54, 55, 56, 64, 65, 66].map((i) => ({ i, jx: 0.5, jz: 0.5, region: 1, hash: 0.25, delta: -0.5 }));
  const tf = buildSiteTable({ seed: 42, gen: 3, allocInput: t1.allocInput, totals: [66000, 0, 17000, 17000, 0, 0, 0], frozen });
  const fz = tf.sites.filter((s) => s.frozen);
  c.check(fz.length === 9 && fz.every((s) => s.alloc.every((n) => n === 0)), "frozen sites: π = 0 (nothing allocated)");
  c.check(fz.every((s) => s.region === 1 && s.jx === 0.5 && s.hash === 0.25 && s.delta === -0.5), "frozen sites keep their stored layout and δ");
  c.check(same(allocatedTotals(tf), t1.allocInput), "Σ = R still holds with frozen sites");
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const edgeRock = meanOf(t1.sites.filter((s) => s.edge).map((s) => s.alloc[ROCK])), innerRock = meanOf(t1.sites.filter((s) => !s.edge).map((s) => s.alloc[ROCK]));
  c.check(t1.sites.filter((s) => s.edge).length === 36 && edgeRock < 0.7 * innerRock, "36 wall-adjacent sites get less (e = 0.6)", `rock ${edgeRock.toFixed(0)} vs ${innerRock.toFixed(0)}`);
  const byRock = [...t1.sites].sort((a, b) => a.alloc[ROCK] - b.alloc[ROCK]);
  c.check(byRock.every((s, i) => i === 0 || s.delta >= byRock[i - 1].delta), "δ ordered like the rock count across the sites");
  const reef = t1.sites.filter((s) => s.biome === "reef"), other = t1.sites.filter((s) => s.biome !== "reef" && !s.edge);
  c.check(meanOf(reef.map((s) => s.alloc[LUMEN])) > 3 * meanOf(other.map((s) => s.alloc[LUMEN])), "lumen concentrates in reef sites (affinity)");
  c.check(Math.abs(genesisMeanRock(t1.allocInput.map((n, k) => (k === ROCK ? 66000 : n)), 100) - 654) < 1e-9, "ā_rock = (66,000 − 600) / 100");
  const sum = summarizeSites(t1);
  console.log(`  info seed 42 genesis: ${BIOMES.map((b) => `${b} ${sum.byBiome[b]}`).join(" · ")} · δ ${sum.deltaMin.toFixed(2)} … ${sum.deltaMax.toFixed(2)}`);
}

c.section("terrain layout");
{
  const table = genesisTable(7);
  const layout = terrainLayoutOf(table);
  let ok = true;
  try {
    assertSiteLayout(layout, REGION_KEYS.length);
  } catch {
    ok = false;
  }
  c.check(ok && layout.cx0 === -5 && layout.cz0 === -5 && layout.nx === 10, "well-formed, centred on the origin (cells −5 … 4)");
  const S = TERRAIN.worldScale;
  const rect = layoutRect(layout, MACRO.cell * S);
  c.check(rect.x0 === -2080 && rect.x1 === 2080, "world rectangle ±2080 m (10 × 416 m)");
  const free = createRegionField(7), bounded = createRegionField(7, layout);
  c.check(createRegionField(7, layout) === bounded && bounded !== free && free.layout === null, "fields cached per layout, the endless field untouched");
  const a = createRegionSample(), b = createRegionSample();
  let farDiff = 0, farBias = 0, match = 0;
  for (let i = 0; i < 4000; i++) {
    // base units: ≥ 3 cells outside the rectangle
    const ang = rnd() * Math.PI * 2, r = 520 + 3 * MACRO.cell + rnd() * 600;
    const x = Math.cos(ang) * r * 1.5, z = Math.sin(ang) * r * 1.5;
    free.sample(x, z, a);
    bounded.sample(x, z, b);
    if (!same(Array.from(a.w), Array.from(b.w)) || a.edge !== b.edge) farDiff++;
    if (b.bias !== 0) farBias++;
  }
  c.check(farDiff === 0 && farBias === 0, "far outside: identical to the endless field, no bias (4000 points)");
  for (const s of table.sites) {
    const x = (layout.cx0 + s.ix + 0.1 + 0.8 * s.jx) * MACRO.cell, z = (layout.cz0 + s.iz + 0.1 + 0.8 * s.jz) * MACRO.cell;
    if (bounded.regionAt(x, z) === s.region) match++;
  }
  c.check(match >= 85, "inside: the region at a site is the layout's (warp aside)", `${match}/100 sites`);
  let biasBad = 0, freeBias = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (rnd() - 0.5) * 1400, z = (rnd() - 0.5) * 1400;
    bounded.sample(x, z, b);
    free.sample(x, z, a);
    if (a.bias !== 0) freeBias++;
    if (!(b.bias >= Math.min(0, ...layout.bias) - 1e-12 && b.bias <= Math.max(0, ...layout.bias) + 1e-12)) biasBad++;
  }
  c.check(freeBias === 0 && biasBad === 0, "bias: 0 on the endless field, within the layout's δ range inside");
  // δ term in the density: layout with δ vs the same layout with δ = 0
  const withD = createDensityField(7, TERRAIN, undefined, layout), noD = createDensityField(7, TERRAIN, undefined, unbiased(layout));
  const plain = createDensityField(7, TERRAIN), unb = createDensityField(7, TERRAIN, undefined, unbiased(layout));
  let dBad = 0, n = 0, capped = 0;
  const cap = TERRAIN.isoLevel + S * 16;
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 4400, y = (rnd() - 0.5) * 200, z = (rnd() - 0.5) * 4400;
    const v1 = withD.sampleRaw(x, y, z), v0 = noD.sampleRaw(x, y, z);
    if (v1 >= cap - 1e-9 || v0 >= cap - 1e-9) { capped++; continue; }
    withD.regions.sample(x, z, b);
    n++;
    if (Math.abs(v1 - v0 - S * b.bias) > 1e-9 * (1 + Math.abs(v1))) dBad++;
  }
  c.check(dBad === 0, "raw density: layout − unbiased layout = S · Σ w_i δ_i exactly (below the rock cap)", `${n} samples, ${capped} capped, ${dBad} off`);
  let farD = 0;
  for (let i = 0; i < 4000; i++) {
    const ang = rnd() * Math.PI * 2, r = (520 + 3 * MACRO.cell) * S * 1.5 + rnd() * 2000;
    const x = Math.cos(ang) * r, y = (rnd() - 0.5) * 200, z = Math.sin(ang) * r;
    if (plain.sampleRaw(x, y, z) !== unb.sampleRaw(x, y, z) || plain.sampleRaw(x, y, z) !== withD.sampleRaw(x, y, z)) farD++;
  }
  c.check(farD === 0, "raw density far outside the world: bit-identical to the free dive", `${farD} of 4000 differ`);
}

c.section("spawn and edge");
{
  for (const seed of [1, 42]) {
    const layout = genesisLayout(seed);
    const f = createDensityField(seed, TERRAIN, undefined, layout);
    const sp = findSpawn(f);
    const rect = layoutRect(layout, MACRO.cell * TERRAIN.worldScale);
    c.check(insideRect(rect, sp.x, sp.z, MACRO.cell * TERRAIN.worldScale), `seed ${seed}: spawn on an inner site (≥ one site from the edge)`, `(${sp.x.toFixed(0)}, ${sp.y.toFixed(0)}, ${sp.z.toFixed(0)}) ${REGION_KEYS[sp.region]}, clearance ${sp.clearance.toFixed(1)}`);
  }
  {
    // backstop: with an open edge (no wall) a diver swimming at it is held EDGE_MARGIN inside
    const layout = genesisLayout(1, false);
    const f = createDensityField(1, TERRAIN, undefined, layout);
    const world = layoutRect(layout, MACRO.cell * TERRAIN.worldScale);
    const d = new DiverController(f);
    d.edge = world;
    const sp = findSpawn(f);
    d.spawnAt(world.x1 - 30, sp.y, sp.z, -Math.PI / 2); // yaw −90°: forward = +x
    let maxX = -Infinity;
    for (let i = 0; i < 200; i++) {
      d.update(0.05, { forward: 1, strafe: 0, up: false, down: false, sprint: true });
      maxX = Math.max(maxX, d.position.x);
    }
    c.check(maxX <= world.x1 - EDGE_MARGIN + 1e-9 && maxX > world.x1 - EDGE_MARGIN - 0.5, "diver swimming into the edge stops EDGE_MARGIN inside", `max x ${maxX.toFixed(2)} (edge ${world.x1})`);
  }
  const rect = { x0: -10, z0: -10, x1: 10, z1: 10 };
  const p = { x: 12, z: 0 }, v = { x: 0.3, z: 0.1 };
  const hit = clampInsideRect(rect, 2, p, v);
  c.check(p.x === 8 && v.x === 0 && v.z === 0.1 && hit === 0.3, "edge clamp: held margin inside, outward velocity removed");
  const q = { x: 0, z: 0 }, w = { x: 1, z: 1 };
  c.check(clampInsideRect(rect, 2, q, w) === 0 && w.x === 1 && q.x === 0, "inside: untouched");
  const r2 = { x: -9, z: 9.5 }, w2 = { x: 0.2, z: -0.1 };
  c.check(clampInsideRect(rect, 2, r2, w2) === 0 && r2.x === -8 && r2.z === 8 && w2.x === 0.2, "moving back in: position clamped, inward velocity kept");
}

c.section("performance (δ term)");
{
  // Same sites with δ vs δ = 0: δ also reshapes the rock (more / less surface to
  // mesh), so the term's own cost is the time per evaluated noise sample; the raw
  // column times are reported alongside (fastest of interleaved rounds). No wall
  // here: its cost is test:wall's.
  const layout = genesisLayout(7, false);
  const fD = createDensityField(7, TERRAIN, undefined, layout), f0 = createDensityField(7, TERRAIN, undefined, unbiased(layout));
  const rows = columnRows(fD);
  const cols = [[3, 2], [-20, 11], [40, -33], [-51, -48], [12, 57], [60, 5], [-8, -30], [25, 25]];
  const run = (f: typeof fD) => {
    let samples = 0;
    const t = performance.now();
    for (const [cx, cz] of cols) samples += generateColumnMesh(f, cx, cz, rows, TERRAIN.floaterMargin, undefined, false, undefined, 0).stats.noiseSamples;
    return { ms: (performance.now() - t) / cols.length, samples };
  };
  run(fD);
  run(f0); // warm-up
  let bestD = Infinity, best0 = Infinity, sD = 0, s0 = 0;
  for (let round = 0; round < 7; round++) {
    const a = run(fD), b = run(f0);
    bestD = Math.min(bestD, a.ms);
    best0 = Math.min(best0, b.ms);
    sD = a.samples;
    s0 = b.samples;
  }
  const perSample = bestD / sD / (best0 / s0);
  c.check(perSample <= 1.02, "δ term: time per noise sample ≤ +2 %", `×${perSample.toFixed(3)} · columns ${best0.toFixed(1)} → ${bestD.toFixed(1)} ms (×${(bestD / best0).toFixed(3)}; noise samples ×${(sD / s0).toFixed(3)} from the reshaped rock)`);
  const free = createDensityField(7, TERRAIN);
  run(free);
  let bestF = Infinity;
  for (let round = 0; round < 3; round++) bestF = Math.min(bestF, run(free).ms);
  console.log(`  info free dive (no layout): ${bestF.toFixed(1)} ms/column (plan reference 107 ms/column on this machine)`);
}

c.finish();
