/**
 * Conserve-mode tunables, in one place (design doc v0.5, MVP plan M1). Modules
 * import these; none hard-codes a number a designer might want to change.
 */
import type { PoolId } from "./ledger/pools";
import type { ParticleCounts } from "./particles/particleVector";

export const GENESIS = {
  /**
   * Particle totals N_k fixed at world creation. MVP: 3 active kinds, 100,000 in
   * all — rock as in the full game (so the frozen base area locks the same ~6 %),
   * the other kinds' share folded into lumen and ferro (design doc §12).
   */
  totals: { lithic: 66_000, lumen: 17_000, ferro: 17_000 } satisfies ParticleCounts,
  /** Lander cargo, moved world → base at genesis: exactly enough for the base core (§8.1). */
  landerCargo: { lithic: 600, ferro: 80 } satisfies ParticleCounts,
} as const;

/** Site grid of the bounded world (D17: 10 × 10, MVP included). */
export const WORLD_SIZE = { sitesX: 10, sitesZ: 10 } as const;

export const SAVE = {
  /** The single MVP save slot (G11: 1 slot until phase 4). */
  slotId: "main",
  /** Minimum time between two throttled save writes, ms (design doc §10.2). */
  throttleMs: 30_000,
} as const;

/**
 * Repairing a save that does not conserve: the totals win; a deficit is added to
 * the suspended pool, an excess is taken back from the pools in this order.
 */
export const REPAIR_TAKE_ORDER: readonly PoolId[] = ["suspended", "world", "lost", "player", "base"];
