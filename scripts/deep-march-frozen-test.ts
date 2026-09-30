/**
 * Conserve mode — the base's frozen area (plan M5; conserve/base/frozen.ts,
 * terrain/frozenZone.ts):
 *   - freezing the 3 × 3 around the core's site: 9 sites, their terrain rock
 *     locked (W → B) ≈ 6 % of all particles (10 × 10 world);
 *   - the §5.3 check passes on accepted spots, and there the terrain really is
 *     the same: later generations (other R, the 9 frozen sites kept) give the
 *     bit-identical density everywhere in the 120 m zone; without freezing it
 *     changes (negative control);
 *   - 100 seeds: share of core spots (wall clearance kept) that pass the check.
 * Run: npm run test:frozen
 */
import { BASE, GENESIS } from "../src/games/deep-march/conserve/config";
import { freezeArea, frozenIndices } from "../src/games/deep-march/conserve/base/frozen";
import { wallStateOf } from "../src/games/deep-march/conserve/chaos/wallModel";
import { terrainLayoutOf } from "../src/games/deep-march/conserve/platform/terrainLayout";
import { buildSiteTable, type SiteTable } from "../src/games/deep-march/conserve/world/siteTable";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { checkFrozenZone, frozenCellsAt } from "../src/games/deep-march/terrain/frozenZone";
import { createRegionField, scaleRegionField, type RegionField } from "../src/games/deep-march/terrain/regions";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { createChecker } from "./lib/checks";
import { genesisTable } from "./lib/worldFixture";

const c = createChecker();
const S = TERRAIN.worldScale;
const N = Object.values(GENESIS.totals).reduce((a, b) => a + b, 0);
const LIMIT = 2080 - BASE.wallClearance;

const regionsOf = (t: SiteTable): RegionField => scaleRegionField(createRegionField(t.seed, terrainLayoutOf(t)), S);

/** Accepted core spots of a table on a grid (step m), inside the wall clearance. */
function spots(t: SiteTable, step: number, max = Infinity): { x: number; z: number; frozen: Set<number> }[] {
  const regions = regionsOf(t);
  const out: { x: number; z: number; frozen: Set<number> }[] = [];
  for (let x = -LIMIT; x <= LIMIT && out.length < max; x += step) {
    for (let z = -LIMIT; z <= LIMIT && out.length < max; z += step) {
      const frozen = frozenCellsAt(regions, x, z, S);
      if (checkFrozenZone(regions, { x, z, radius: BASE.radiusMax, frozen, worldScale: S }).ok) out.push({ x, z, frozen });
    }
  }
  return out;
}

c.section("freezing the 3 × 3 (conserve/base/frozen.ts)");
{
  const t = genesisTable(42);
  const area = freezeArea(t, 55);
  c.check(area.sites.length === 9 && same(area.sites.map((s) => s.i), frozenIndices(55, 10, 10)), "9 sites around the core's site");
  c.check(area.locked[0] === area.sites.reduce((s, f) => s + t.sites[f.i].split.terrain[0], 0) && area.locked.slice(1).every((n) => n === 0), "locked = the 9 sites' terrain rock (rock only)");
  const shares: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const g = genesisTable(seed);
    for (const site of [33, 44, 55, 66]) shares.push(freezeArea(g, site).locked[0] / N);
  }
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  c.check(mean > 0.05 && mean < 0.075 && Math.min(...shares) > 0.04 && Math.max(...shares) < 0.09, "≈ 6 % of all particles (20 seeds × 4 interior sites)", `mean ${(mean * 100).toFixed(2)} %, ${(Math.min(...shares) * 100).toFixed(2)} … ${(Math.max(...shares) * 100).toFixed(2)} %`);
  c.check(frozenIndices(0, 10, 10).length === 4 && frozenIndices(99, 10, 10).length === 4, "a corner site freezes only the in-world part");
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

c.section("accepted spots keep the terrain across tides (terrain/frozenZone.ts)");
for (const seed of [42, 7, 1234]) {
  const t1 = genesisTable(seed);
  const found = spots(t1, 160, 3);
  c.check(found.length > 0, `seed ${seed}: accepted core spots exist`, `${found.length}`);
  const wall = wallStateOf(t1.allocInput, t1.allocInput.map((n, k) => n + (k === 0 ? 600 : k === 3 ? 80 : 0)));
  const f1 = createDensityField(seed, TERRAIN, undefined, terrainLayoutOf(t1, wall));
  const rnd = mulberry32(seed);
  let identical = 0, differ = 0, probes = 0;
  for (const spot of found) {
    const centre = [...spot.frozen].sort((a, b) => a - b)[4];
    const area = freezeArea(t1, centre);
    for (const gen of [2, 3]) {
      const alloc = t1.allocInput.map((n, k) => Math.max(0, Math.floor(n * (0.55 + 0.4 * rnd())) - (k === 0 ? area.locked[0] : 0)));
      const frozenT = buildSiteTable({ seed, gen, allocInput: alloc, totals: t1.allocInput, frozen: area.sites });
      const freeT = buildSiteTable({ seed, gen, allocInput: alloc, totals: t1.allocInput });
      const fz = createDensityField(seed, TERRAIN, undefined, terrainLayoutOf(frozenT, wall));
      const ff = createDensityField(seed, TERRAIN, undefined, terrainLayoutOf(freeT, wall));
      let same2 = true, changed = false;
      for (let i = 0; i < 400; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * BASE.radiusMax;
        const x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r, y = -160 + rnd() * 240;
        const v = f1.sample(x, y, z);
        if (fz.sample(x, y, z) !== v) same2 = false;
        if (ff.sample(x, y, z) !== v) changed = true;
        probes++;
      }
      if (same2) identical++;
      if (changed) differ++;
    }
  }
  c.check(identical === found.length * 2, `seed ${seed}: generations 2 and 3 with the 9 sites frozen — density bit-identical in the zone`, `${identical}/${found.length * 2} zone checks, ${probes} probes`);
  c.check(differ === found.length * 2, `seed ${seed}: the same tides without freezing change the zone (negative control)`, `${differ}/${found.length * 2}`);
}

c.section("valid core spots over 100 seeds (plan risk item)");
{
  let ok = 0, all = 0, worst = 1;
  for (let seed = 1; seed <= 100; seed++) {
    const t = genesisTable(seed);
    const regions = regionsOf(t);
    let s = 0, n = 0;
    for (let x = -LIMIT; x <= LIMIT; x += 185) {
      for (let z = -LIMIT; z <= LIMIT; z += 185) {
        n++;
        if (checkFrozenZone(regions, { x, z, radius: BASE.radiusMax, frozen: frozenCellsAt(regions, x, z, S), worldScale: S }).ok) s++;
      }
    }
    ok += s;
    all += n;
    worst = Math.min(worst, s / n);
  }
  c.check(ok / all > 0.4 && worst > 0.2, "the check passes on a large share of spots in every seed", `${((ok / all) * 100).toFixed(1)} % overall, worst seed ${(worst * 100).toFixed(1)} %`);
}

c.finish();
