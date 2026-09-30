/**
 * The five pools of the particle ledger (design doc §3.3): N_k = W + P + B + S + L.
 *   world      W  condensed in the outer world (terrain, nodes, creatures)
 *   player     P  carried by the diver (canister)
 *   base       B  locked by the base (buildings, storage, frozen terrain)
 *   suspended  S  consumed / dissolved, returns to the world at the next tide
 *   lost       L  lost caches (left at death, not yet recovered)
 */
export const POOL_IDS = ["world", "player", "base", "suspended", "lost"] as const;

export type PoolId = (typeof POOL_IDS)[number];

export function isPoolId(value: unknown): value is PoolId {
  return typeof value === "string" && (POOL_IDS as readonly string[]).includes(value);
}
