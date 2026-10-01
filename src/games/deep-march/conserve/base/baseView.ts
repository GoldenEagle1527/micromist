/** The base as the scene and UI see it (port.ts BaseView), from its saved state. */
import { vectorTotal, type ParticleVector } from "../particles/particleVector";
import { energyCapacity, protectionRadius, storageCapacity, type BaseSave } from "./baseState";
import { isFull, isWorking, netRate, onStandby } from "./energy";
import type { BaseView } from "./port";

/** storage: the free part of B (before founding: the lander cargo); tank: P. */
export function viewOf(s: BaseSave | null, storage: ParticleVector, tank: ParticleVector, dives: number): BaseView {
  const structures = s?.structures ?? [];
  const brownout = s?.brownout ?? false;
  const energy = s?.energy ?? 0, energyCap = energyCapacity(structures);
  const full = isFull(energy, energyCap);
  // the rate as if every fuelled producer ran: while full it is shown as 0 unless
  // even that falls (the reactor's standby would make the number flicker)
  const rate = s ? netRate(structures, brownout, storage) : 0;
  return {
    founded: s !== null,
    center: s ? s.center : null,
    radius: protectionRadius(structures),
    buildings: structures.map((b) => ({ id: b.id, kind: b.kind, pos: b.pos, yaw: b.yaw, working: isWorking(b, brownout, storage, full), on: b.on, standby: onStandby(b, full) })),
    storage: storage.slice(),
    stored: vectorTotal(storage),
    tank: tank.slice(),
    capacity: storageCapacity(structures),
    energy,
    energyCap,
    energyRate: full ? Math.min(0, rate) : rate,
    brownout,
    dives,
  };
}
