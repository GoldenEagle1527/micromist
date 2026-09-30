/**
 * Make the base agree with pool B after reconcilePools (the ledger wins, §10.2):
 * B = storage + building costs + frozen rock must hold exactly.
 *   1. at most BASE.maxStructures buildings (the newest extra ones drop out);
 *   2. while the buildings + frozen rock need more of a kind than B holds, the
 *      newest non-core building drops out; then the frozen rock is cut; a core
 *      B cannot even pay for leaves no base at all (B is left as it is);
 *   3. storage = what B holds beyond that; energy ≤ capacity.
 * Pools never move here; each changed storage count is logged (cause "base").
 * Pure: returns new data, never mutates.
 */
import { BASE } from "../config";
import { builtCost, cloneBase, energyCapacity, type BaseSave } from "../base/baseState";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import type { Repair } from "./reconcile";

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0);

/** B minus buildings minus frozen rock, per kind (negative = B cannot hold them). */
const freeOf = (b: BaseSave, pool: ReadonlyParticleVector) => {
  const built = builtCost(b.structures);
  return pool.map((n, k) => n - built[k] - b.frozenLocked[k]);
};

export function reconcileBase(base: BaseSave | null, pool: ReadonlyParticleVector): { base: BaseSave | null; repairs: Repair[] } {
  if (!base) return { base: null, repairs: [] };
  const b = cloneBase(base);
  const before = b.storage.map(count);
  b.frozenLocked = b.frozenLocked.map(count);
  b.structures = b.structures.slice(0, BASE.maxStructures);
  let free = freeOf(b, pool);
  while (free.some((n) => n < 0) && b.structures.some((s) => s.kind !== "core")) {
    const newest = b.structures.reduce((m, s) => (s.kind !== "core" && s.id > m.id ? s : m), { id: -1 } as { id: number });
    b.structures = b.structures.filter((s) => s.id !== newest.id);
    free = freeOf(b, pool);
  }
  free.forEach((n, k) => {
    if (n < 0) b.frozenLocked[k] = Math.max(0, b.frozenLocked[k] + n);
  });
  free = freeOf(b, pool);
  const out = free.some((n) => n < 0) ? null : b;
  const storage = out ? free : [...pool];
  const repairs: Repair[] = [];
  storage.forEach((n, k) => {
    if (n !== before[k]) repairs.push({ type: PARTICLE_TYPES[k], pool: "base", delta: n - before[k], cause: "base" });
  });
  if (!out) return { base: null, repairs };
  out.storage = storage;
  out.energy = Math.min(Math.max(0, out.energy), energyCapacity(out.structures));
  return { base: out, repairs };
}
