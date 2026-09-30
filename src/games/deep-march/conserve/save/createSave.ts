/** A new world save at genesis. */
import { WORLD_SIZE } from "../config";
import type { ParticleLedger } from "../ledger/particleLedger";
import { allocationInput } from "../world/allocInput";
import { createGenesisLedger } from "../world/genesis";
import { withLedger } from "./saveLedger";
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
  const header: WorldSave = {
    v: SAVE_VERSION,
    id: spec.id,
    createdAt: spec.now,
    savedAt: spec.now,
    seedText: spec.seedText,
    seed: spec.seed >>> 0,
    size: { sitesX: WORLD_SIZE.sitesX, sitesZ: WORLD_SIZE.sitesZ },
    gen: 1,
    totals: [],
    ledger: { world: [], player: [], base: [], suspended: [], lost: [] },
    stats: { divesStarted: 0 },
    flags: {},
    generation: { allocInput: [], harvested: "", partial: [], dives: 0 },
    caches: [],
    base: null,
  };
  const ledger = spec.ledger ?? createGenesisLedger();
  return { ...withLedger(header, ledger), generation: { ...header.generation, allocInput: allocationInput(ledger.toState()) } };
}
