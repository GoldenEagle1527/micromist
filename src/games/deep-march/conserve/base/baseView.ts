/** The base as the scene and UI see it (port.ts BaseView), from its saved state. */
import { vectorTotal, type ParticleVector } from "../particles/particleVector";
import { energyCapacity, protectionRadius, storageCapacity, type BaseSave } from "./baseState";
import { isWorking, netRate } from "./energy";
import type { BaseView } from "./port";

/** storage: the free part of B (before founding: the lander cargo); tank: P. */
export function viewOf(s: BaseSave | null, storage: ParticleVector, tank: ParticleVector, dives: number): BaseView {
  const structures = s?.structures ?? [];
  const brownout = s?.brownout ?? false;
  return {
    founded: s !== null,
    center: s ? s.center : null,
    radius: protectionRadius(structures),
    buildings: structures.map((b) => ({ id: b.id, kind: b.kind, pos: b.pos, yaw: b.yaw, working: isWorking(b, brownout, storage), on: b.on })),
    storage: storage.slice(),
    stored: vectorTotal(storage),
    tank: tank.slice(),
    capacity: storageCapacity(structures),
    energy: s?.energy ?? 0,
    energyCap: energyCapacity(structures),
    energyRate: s ? netRate(structures, brownout, storage) : 0,
    brownout,
    dives,
  };
}
