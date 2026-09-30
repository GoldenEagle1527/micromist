/**
 * test:tide — the terrain across a real tide: inside the base's protection
 * zone the density of gen + 1 is bit-identical to gen's (10⁴ probes, the 9
 * frozen sites kept, the M5 follow-up applied), outside it the world changed
 * (negative control); the plan's layout is the one the session plays after it.
 */
import { BASE } from "../../src/games/deep-march/conserve/config";
import { wallStateOfChaos } from "../../src/games/deep-march/conserve/chaos/wallModel";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { mulberry32 } from "../../src/games/deep-march/terrain/noise";
import type { Checker } from "./checks";
import { runTide, tideRig } from "./tideFixture";

export function tideTerrainChecks(c: Checker): void {
  c.section("frozen 3 × 3 across a real tide (density bit-exact)");
  for (const seedText of ["abyss", "tide-7"]) {
    const { session: s, spot } = tideRig(seedText);
    const f1 = createDensityField(s.seed, TERRAIN, undefined, terrainLayoutOf(s.siteTable, s.wall));
    s.tide.call({ simple: false, lowMemory: false });
    const plan = s.tide.pending!;
    const next = terrainLayoutOf(plan.table, wallStateOfChaos(plan.chaos));
    const f2 = createDensityField(s.seed, TERRAIN, undefined, next);
    const rnd = mulberry32(s.seed);
    let same = 0, probes = 0;
    for (let i = 0; i < 10_000; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * BASE.radiusMax;
      const x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r, y = -170 + rnd() * 260;
      probes++;
      if (f1.sample(x, y, z) === f2.sample(x, y, z)) same++;
    }
    c.check(same === probes, `${seedText}: gen 1 → 2, density identical in the 120 m zone`, `${same}/${probes} probes`);
    let differ = 0;
    for (let i = 0; i < 2000; i++) {
      const x = (rnd() - 0.5) * 3000, z = (rnd() - 0.5) * 3000, y = -170 + rnd() * 260;
      if (Math.hypot(x - spot.x, z - spot.z) < 700) continue;
      if (f1.sample(x, y, z) !== f2.sample(x, y, z)) differ++;
    }
    c.check(differ > 200, `${seedText}: outside the frozen area the world changed (negative control)`, `${differ} of ~2000 probes differ`);
    runTide(s);
    c.check(JSON.stringify(terrainLayoutOf(s.siteTable, s.wall)) === JSON.stringify(next), `${seedText}: the session plays exactly the precomputed layout after the tide`);
  }
}
