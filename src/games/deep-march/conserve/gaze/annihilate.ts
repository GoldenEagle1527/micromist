/**
 * 湮灭 (design doc §9.1 ④, D14): the eye's forced tide. The core falls, the
 * frozen area thaws; base, storage and tank go back to the world, which gathers
 * again, whole, without the diver — the unmanned tide of the ending. The final
 * save is generation + 1 with every particle in the world (W = N; P, B, S, L
 * empty), no base, no caches, no cracks, flags.endingA = "annihilated": from
 * then on the slot is read-only (isReadOnlySave), no new game+. Pure.
 */
import { POOL_IDS, type PoolId } from "../ledger/pools";
import type { ParticleVector } from "../particles/particleVector";
import { wallThickness } from "../chaos/wallModel";
import type { WorldSave } from "../save/schema";

export function annihilatedSave(save: WorldSave): WorldSave {
  const world = save.totals.slice();
  const ledger = {} as Record<PoolId, ParticleVector>;
  for (const id of POOL_IDS) ledger[id] = id === "world" ? world.slice() : world.map(() => 0);
  return {
    ...save,
    gen: save.gen + 1,
    ledger,
    generation: { allocInput: world.slice(), harvested: "", partial: [], dives: 0 },
    caches: [],
    base: null,
    chaos: { m: 1, stage: 0, wallThickness: wallThickness(1), cracks: [] },
    flags: { ...save.flags, endingA: "annihilated" },
  };
}
