/** A new world save at genesis. */
import { WORLD_SIZE } from "../config";
import { genesisChaos } from "../chaos/model";
import type { ParticleLedger } from "../ledger/particleLedger";
import { allocationInput } from "../world/allocInput";
import { createGenesisLedger } from "../world/genesis";
import { SAVE_VERSION, type WorldSave } from "./schema";

export type NewSaveSpec = {
  id: string;
  seedText: string;
  seed: number;
  now: number;
  /** Defaults to the configured genesis. */
  ledger?: ParticleLedger;
};

export function createWorldSave(spec: NewSaveSpec): WorldSave {
  const state = (spec.ledger ?? createGenesisLedger()).toState();
  const allocInput = allocationInput(state);
  return {
    v: SAVE_VERSION,
    id: spec.id,
    createdAt: spec.now,
    savedAt: spec.now,
    seedText: spec.seedText,
    seed: spec.seed >>> 0,
    size: { sitesX: WORLD_SIZE.sitesX, sitesZ: WORLD_SIZE.sitesZ },
    gen: 1,
    totals: state.totals,
    ledger: state.pools,
    stats: { divesStarted: 0 },
    flags: {},
    generation: { allocInput, harvested: "", partial: [], dives: 0 },
    caches: [],
    base: null,
    chaos: genesisChaos(allocInput, state.totals),
  };
}
