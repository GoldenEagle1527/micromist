/** A brand-new world's ledger: all particles in the world, the lander cargo already locked in the base. */
import { GENESIS } from "../config";
import { ParticleLedger } from "../ledger/particleLedger";
import { vectorFromCounts, type ParticleCounts } from "../particles/particleVector";

export type GenesisSpec = { readonly totals: ParticleCounts; readonly landerCargo: ParticleCounts };

export function createGenesisLedger(spec: GenesisSpec = GENESIS): ParticleLedger {
  const ledger = ParticleLedger.genesis(vectorFromCounts(spec.totals));
  ledger.transferVector("world", "base", vectorFromCounts(spec.landerCargo));
  return ledger;
}
