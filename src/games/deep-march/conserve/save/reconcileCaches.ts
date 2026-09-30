/**
 * Make the lost caches agree with the lost pool L after reconcilePools (the
 * ledger wins, design doc §10.2):
 *   1. contents sanitized to counts; only the newest CACHES.max caches kept;
 *   2. a kind the caches over-state is cut from the oldest caches first; empty
 *      caches drop out;
 *   3. particles of L no cache claims move L → S (repair cause "caches").
 * Afterwards Σ caches = L exactly. Pure: returns new data, never mutates.
 */
import { CACHES } from "../config";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import type { PoolVectors } from "../ledger/particleLedger";
import type { Repair } from "./reconcile";
import type { SavedCache } from "./schema";

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0);

export function fitCachesToPool(list: readonly SavedCache[], lost: readonly number[]): { caches: SavedCache[]; unclaimed: number[] } {
  const caches = list.map((c) => ({ ...c, pos: [...c.pos] as SavedCache["pos"], contents: c.contents.map(count) })).sort((a, b) => a.id - b.id);
  const unclaimed = lost.map(() => 0);
  lost.forEach((pool, k) => {
    let claimed = caches.reduce((s, c) => s + c.contents[k], 0);
    for (const c of caches) {
      if (claimed <= pool) break;
      const cut = Math.min(c.contents[k], claimed - pool);
      c.contents[k] -= cut;
      claimed -= cut;
    }
    unclaimed[k] = pool - claimed;
  });
  return { caches: caches.filter((c) => c.contents.some((n) => n > 0)), unclaimed };
}

export function reconcileCaches(list: readonly SavedCache[], pools: PoolVectors, max: number = CACHES.max): { caches: SavedCache[]; pools: PoolVectors; repairs: Repair[] } {
  const kept = [...list].sort((a, b) => a.id - b.id).slice(-max);
  const { caches, unclaimed } = fitCachesToPool(kept, pools.lost);
  const out: PoolVectors = { ...pools, lost: pools.lost.slice(), suspended: pools.suspended.slice() };
  const repairs: Repair[] = [];
  unclaimed.forEach((n, k) => {
    if (n === 0) return;
    out.lost[k] -= n;
    out.suspended[k] += n;
    repairs.push({ type: PARTICLE_TYPES[k], pool: "suspended", delta: n, cause: "caches" });
  });
  return { caches, pools: out, repairs };
}
