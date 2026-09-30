/**
 * Conserve mode — economy projection (plan M6; design doc §12 MVP tuning): pure
 * numbers, not a simulation of play. Assumptions: the base founded at the
 * world's centre in generation 1 (the lander cargo + the frozen 3 × 3 rock in
 * B), then every generation 7–8 dives of 200 particles, all locked in the base
 * (deposited or built), nothing carried at the tide. Each tide runs the real
 * chaos model (chaos/tide.ts). Expected for the average world (frozen rock =
 * the mean over seeds, m ≈ 0.934 after founding): the first crack in the gen
 * 3 → 4 tide; at only 1.1 % locked per generation, gen 4 → 5. Per seed, the
 * centre's rock moves it by a generation at most (a rock-heavy centre with fast
 * locking: gen 2 → 3, as the design allows). A regression guard for the tuning
 * (thresholds, wall curve, tank size, frozen area).
 * Run: npm run test:economy
 */
import { GENESIS, WORLD_SIZE } from "../src/games/deep-march/conserve/config";
import type { LedgerState } from "../src/games/deep-march/conserve/ledger/particleLedger";
import { vectorFromCounts } from "../src/games/deep-march/conserve/particles/particleVector";
import type { ChaosState } from "../src/games/deep-march/conserve/chaos/model";
import { chaosAtTide, tideChaosInput } from "../src/games/deep-march/conserve/chaos/tide";
import { createChecker } from "./lib/checks";
import { foundedRig } from "./lib/baseFixture";

const c = createChecker();
const SEEDS = [42, 7, 1234, 99, 2026];

type Run = { m0: number; gen1: number; firstCrackTide: number | null; mAtCrack: number; heal: number };

/** Tides after generations 1 … 12 locking `perGen` particles each; the first tide (g → g + 1) with an open crack. */
function project(seed: number, perGen: number): Run {
  const rig = foundedRig(seed);
  const tide = (now: ChaosState, gen: number) =>
    chaosAtTide(now, tideChaosInput({ state: rig.ledger.toState(), totals: rig.ledger.toState().totals, seed, gen, size: WORLD_SIZE, center: [0, -100, 0], siteHarvest: [] }));
  let now: ChaosState = { m: 1, stage: 0, wallThickness: 160, cracks: [] };
  const m0 = tide(now, 1).m;
  let gen1 = 0, first: number | null = null, mAt = 0, heal = 0;
  for (let gen = 1; gen <= 12 && first === null; gen++) {
    rig.ledger.transferVector("world", "base", [perGen, 0, 0, 0, 0, 0, 0]);
    now = tide(now, gen);
    if (gen === 1) gen1 = now.m;
    if (now.cracks.some((k) => k.open)) {
      [first, mAt] = [gen, now.m];
      // 放流 needed so the next tide heals it (m ≥ 0.91), one particle fewer must not
      const N = rig.ledger.grandTotal();
      heal = Math.ceil((0.91 - now.m) * N - 1e-6);
      rig.ledger.transferVector("base", "suspended", [heal - 1, 0, 0, 0, 0, 0, 0]);
      const almost = tide(now, gen + 1);
      rig.ledger.transferVector("base", "suspended", [1, 0, 0, 0, 0, 0, 0]);
      const healed = tide(now, gen + 1);
      if (!(almost.cracks.some((k) => k.open) && healed.cracks.every((k) => !k.open && k.healed))) heal = -1;
    }
  }
  return { m0, gen1, firstCrackTide: first, mAtCrack: mAt, heal };
}

c.section("after the founding");
for (const seed of SEEDS) {
  const r = project(seed, 1500);
  c.check(r.m0 > 0.925 && r.m0 < 0.945, `seed ${seed}: m after founding ≈ 0.934 (frozen 3 × 3 ≈ 6 %)`, r.m0.toFixed(4));
  c.check(r.gen1 > 0.91 && r.gen1 < 0.93, `seed ${seed}: end of gen 1 forecast ≈ 0.919 (stage 1 next)`, r.gen1.toFixed(4));
}

/** The average world: B after founding = the mean over the seeds; the ledger reduced to what m reads (P = 0, B). */
function nominalFirstCrack(perGen: number): { tide: number | null; m0: number } {
  const b0 = SEEDS.reduce((a, seed) => a + foundedRig(seed).ledger.poolTotal("base"), 0) / SEEDS.length;
  const totals = vectorFromCounts(GENESIS.totals);
  const zero = totals.map(() => 0);
  const stateAt = (locked: number): LedgerState => ({ totals, pools: { world: zero, player: zero, base: [Math.round(locked), ...zero.slice(1)], suspended: zero, lost: zero } });
  let now: ChaosState = { m: 1, stage: 0, wallThickness: 160, cracks: [] };
  const at = (gen: number, locked: number) => chaosAtTide(now, tideChaosInput({ state: stateAt(locked), totals, seed: 42, gen, size: WORLD_SIZE, center: [0, -100, 0], siteHarvest: [] }));
  const m0 = at(1, b0).m;
  for (let gen = 1; gen <= 12; gen++) {
    now = at(gen, b0 + gen * perGen);
    if (now.cracks.some((k) => k.open)) return { tide: gen, m0 };
  }
  return { tide: null, m0 };
}

c.section("first crack — the average world");
for (const perGen of [1400, 1500, 1600]) {
  const r = nominalFirstCrack(perGen);
  c.check(r.tide === 3, `${perGen / 200} dives × 200 / gen (${perGen / 1000} %): first crack in the gen 3 → 4 tide`, `m after founding ${r.m0.toFixed(4)}, tide after gen ${r.tide}`);
}
c.check(nominalFirstCrack(1100).tide === 4, "1.1 % / gen: gen 4 → 5", `tide after gen ${nominalFirstCrack(1100).tide}`);

c.section("first crack — per seed (the centre's rock moves it by one generation at most)");
for (const seed of SEEDS) {
  for (const dives of [7, 8]) {
    const r = project(seed, dives * 200);
    c.check(r.firstCrackTide === 2 || r.firstCrackTide === 3, `seed ${seed}, ${dives} dives × 200 / gen: gen 2 → 3 … 3 → 4`, `tide after gen ${r.firstCrackTide}, m after founding ${r.m0.toFixed(4)}, m ${r.mAtCrack.toFixed(4)}`);
  }
  const slow = project(seed, 1100);
  c.check(slow.firstCrackTide === 3 || slow.firstCrackTide === 4, `seed ${seed}, 1.1 % / gen: gen 3 → 4 … 4 → 5`, `tide after gen ${slow.firstCrackTide}, m ${slow.mAtCrack.toFixed(4)}`);
}

c.section("healing by release (放流)");
for (const seed of SEEDS) {
  const r = project(seed, 1500);
  c.check(r.heal > 0 && r.heal <= 2500, `seed ${seed}: releasing ${r.heal} heals the first crack at the next tide (one fewer does not)`, `${(r.heal / 1000).toFixed(2)} % of N`);
}
c.finish();
