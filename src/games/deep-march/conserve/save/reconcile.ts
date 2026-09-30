/**
 * Make a loaded ledger conserve again (design doc §10.2: "the totals win; the
 * difference goes to the suspended pool, and is logged").
 *   1. sanitize: negative / fractional pool values → non-negative integers;
 *   2. per kind, deficit (Σ pools < total) → added to the suspended pool;
 *      excess (Σ pools > total) → taken back from the pools in REPAIR_TAKE_ORDER.
 * Pure: returns new vectors and the list of repairs, never mutates its input.
 */
import { REPAIR_TAKE_ORDER } from "../config";
import { POOL_IDS, type PoolId } from "../ledger/pools";
import type { PoolVectors } from "../ledger/particleLedger";
import { PARTICLE_TYPES, type ParticleType } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";

/**
 * caches: `delta` particles of the lost pool that no cache claims, moved to the suspended pool (reconcileCaches.ts);
 * base: the base's free storage changed by `delta` to fit pool B, no pool moved (reconcileBase.ts).
 */
export type RepairCause = "sanitized" | "deficit" | "excess" | "caches" | "base";
/** One correction: `delta` particles of `type` added to (> 0) or removed from (< 0) `pool`. */
export type Repair = { type: ParticleType; pool: PoolId; delta: number; cause: RepairCause };
export type Reconciled = { pools: PoolVectors; repairs: Repair[] };

function sanitizeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0;
}

function sanitizePools(pools: Readonly<Record<PoolId, readonly number[]>>, repairs: Repair[]): PoolVectors {
  const out = {} as PoolVectors;
  for (const id of POOL_IDS) {
    out[id] = pools[id].map((raw, i) => {
      const clean = sanitizeCount(raw);
      if (clean !== raw) repairs.push({ type: PARTICLE_TYPES[i], pool: id, delta: clean - raw, cause: "sanitized" });
      return clean;
    });
  }
  return out;
}

function takeExcess(pools: PoolVectors, index: number, excess: number, order: readonly PoolId[], repairs: Repair[]): void {
  let left = excess;
  for (const id of order) {
    const take = Math.min(left, pools[id][index]);
    if (take === 0) continue;
    pools[id][index] -= take;
    repairs.push({ type: PARTICLE_TYPES[index], pool: id, delta: -take, cause: "excess" });
    left -= take;
    if (left === 0) return;
  }
}

export function reconcilePools(totals: ReadonlyParticleVector, pools: Readonly<Record<PoolId, readonly number[]>>, order: readonly PoolId[] = REPAIR_TAKE_ORDER): Reconciled {
  const repairs: Repair[] = [];
  const clean = sanitizePools(pools, repairs);
  totals.forEach((total, i) => {
    const held = POOL_IDS.reduce((sum, id) => sum + clean[id][i], 0);
    if (held < total) {
      clean.suspended[i] += total - held;
      repairs.push({ type: PARTICLE_TYPES[i], pool: "suspended", delta: total - held, cause: "deficit" });
    } else if (held > total) {
      takeExcess(clean, i, held - total, order, repairs);
    }
  });
  return { pools: clean, repairs };
}

/** Particles moved by the conservation repairs (sanitizing aside). */
export function repairedParticles(repairs: readonly Repair[]): number {
  return repairs.filter((r) => r.cause !== "sanitized" && r.cause !== "base").reduce((sum, r) => sum + Math.abs(r.delta), 0);
}
