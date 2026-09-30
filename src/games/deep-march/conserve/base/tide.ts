/**
 * The tide's stub (G3; the tide itself is M7): what the core needs before the
 * player may call it, and the ring wall it would bring if it came now.
 */
import { BASE } from "../config";
import { wallThickness, externalShare } from "../chaos/wallModel";
import type { LedgerState } from "../ledger/particleLedger";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { allocationInput } from "../world/allocInput";
import type { TideForecast, TideReadiness } from "./port";

export function tideReadiness(energy: number, dives: number): TideReadiness {
  const { energy: energyNeeded, dives: divesNeeded } = BASE.tide;
  return { energy, energyNeeded, dives, divesNeeded, ready: energy >= energyNeeded && dives >= divesNeeded };
}

/** R' = N − P − B now → m and the wall thickness (chaos/wallModel.ts). */
export function tideForecast(state: LedgerState, totals: ReadonlyParticleVector): TideForecast {
  const m = externalShare(allocationInput(state), totals);
  return { m, thickness: wallThickness(m) };
}
