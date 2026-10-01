/**
 * The next generation, decided when the tide is called (design doc §5.1–5.3):
 * a pure function of the save at that moment.
 *   R' = N − P − B (world + suspended + lost: un-retrieved caches return);
 *   chaos' = chaosAtTide(chaos, R', the harvest) — exactly the forecast card's;
 *   table' = (seed, gen + 1, R', the base's frozen 3 × 3) → sites (the frozen
 *            ones keep jitter, biome, variation and δ: their terrain is bit-exact);
 *   summary for the HUD: biomes, stage, new / healed cracks, wall thickness.
 * R' is fixed from here on: what enters R during the warning (放流, fuel, a
 * death) waits in the suspended pool for the tide after (commit.ts).
 */
import { BIOMES, type Biome } from "../config";
import { forecastTide } from "../chaos/forecast";
import type { ChaosStage, ChaosState } from "../chaos/model";
import { tideChaosInput } from "../chaos/tide";
import type { ParticleVector } from "../particles/particleVector";
import { ledgerStateOf } from "../save/saveLedger";
import type { WorldSave } from "../save/schema";
import { allocationInput } from "../world/allocInput";
import { buildSiteTable, type SiteTable } from "../world/siteTable";

export type GenerationSummary = {
  gen: number;
  /** Sites per biome, most first (biomes without a site left out). */
  biomes: { biome: Biome; sites: number }[];
  stage: ChaosStage;
  m: number;
  wallThickness: number;
  /** Cracks the tide opened (new or reopened) / healed, and open after it. */
  newCracks: number;
  healed: number;
  open: number;
  /** 封界潮: this tide ended a gaze (chaos.gaze set before it: the only tide a gaze allows). */
  sealed: boolean;
};

export type TidePlan = {
  fromGen: number;
  gen: number;
  /** R' of the new generation (its site table's allocation input). */
  allocInput: ParticleVector;
  chaos: ChaosState;
  table: SiteTable;
  summary: GenerationSummary;
};

export function planTide(save: WorldSave, siteHarvest: readonly number[]): TidePlan {
  const state = ledgerStateOf(save);
  const allocInput = allocationInput(state);
  const gen = save.gen + 1;
  const f = forecastTide(
    save.chaos,
    tideChaosInput({ state, totals: save.totals, seed: save.seed, gen: save.gen, size: save.size, center: save.base?.center ?? null, siteHarvest }),
  );
  const table = buildSiteTable({ seed: save.seed, gen, allocInput, totals: save.totals, size: save.size, frozen: save.base?.frozen });
  const counts = new Map<Biome, number>();
  for (const s of table.sites) counts.set(s.biome, (counts.get(s.biome) ?? 0) + 1);
  const biomes = BIOMES.filter((b) => counts.has(b))
    .map((biome) => ({ biome, sites: counts.get(biome)! }))
    .sort((a, b) => b.sites - a.sites);
  const c = f.next;
  return {
    fromGen: save.gen,
    gen,
    allocInput,
    chaos: c,
    table,
    summary: { gen, biomes, stage: c.stage, m: c.m, wallThickness: c.wallThickness, newCracks: f.opening, healed: f.healing, open: f.open, sealed: save.chaos.gaze !== undefined },
  };
}
