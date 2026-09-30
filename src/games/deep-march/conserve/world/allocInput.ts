/**
 * The allocation input of a generation (§3.3): R_k = N_k − P_k − B_k — everything
 * not carried by the player or locked in the base (world + suspended + lost), which
 * is what a tide spreads over the sites. Fixed for the whole generation (stored in
 * the save), so the terrain never changes between two tides.
 */
import type { LedgerState } from "../ledger/particleLedger";
import type { ParticleVector } from "../particles/particleVector";

export function allocationInput(state: LedgerState): ParticleVector {
  return state.totals.map((n, k) => Math.max(0, n - state.pools.player[k] - state.pools.base[k]));
}
