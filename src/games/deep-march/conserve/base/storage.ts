/**
 * Base storage moves (§6.3, §7.4, D16). `storage` is the free part of pool B:
 * each move goes through the ledger and updates `storage` in step, so
 * B = storage + buildings + frozen stays exact (test:ledger).
 *   pay       storage first, the rest from the tank (P → B), all or nothing;
 *   deposit   P → B, up to the free capacity;
 *   withdraw  B → P, up to the tank's room;
 *   release   B → S (放流), any amount, no cooldown;
 *   refund    a demolished building's cost back into storage (stays in B);
 *   scatter   a crushed building's cost out of the base (直视 ③: B → S).
 */
import { TANK } from "../config";
import type { ParticleLedger } from "../ledger/particleLedger";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { vectorTotal, type ParticleVector, type ReadonlyParticleVector } from "../particles/particleVector";

/** Storage + tank, per kind. */
export function fundsOf(ledger: ParticleLedger, storage: ReadonlyParticleVector): ParticleVector {
  const tank = ledger.pool("player");
  return storage.map((n, k) => n + tank[k]);
}

export function pay(ledger: ParticleLedger, storage: ParticleVector, cost: ReadonlyParticleVector): boolean {
  const funds = fundsOf(ledger, storage);
  if (cost.some((n, k) => n > funds[k])) return false;
  cost.forEach((n, k) => {
    const fromStorage = Math.min(n, storage[k]);
    storage[k] -= fromStorage;
    if (n > fromStorage) ledger.transfer("player", "base", PARTICLE_TYPES[k], n - fromStorage);
  });
  return true;
}

export function refund(storage: ParticleVector, cost: ReadonlyParticleVector): void {
  cost.forEach((n, k) => (storage[k] += n));
}

export function scatter(ledger: ParticleLedger, cost: ReadonlyParticleVector): void {
  cost.forEach((n, k) => n > 0 && ledger.transfer("base", "suspended", PARTICLE_TYPES[k], n));
}

export function deposit(ledger: ParticleLedger, storage: ParticleVector, capacity: number, kind: number | null): number {
  let room = Math.max(0, capacity - vectorTotal(storage));
  let moved = 0;
  ledger.pool("player").forEach((n, k) => {
    if (kind !== null && k !== kind) return;
    const take = Math.min(n, room);
    if (take <= 0) return;
    ledger.transfer("player", "base", PARTICLE_TYPES[k], take);
    storage[k] += take;
    room -= take;
    moved += take;
  });
  return moved;
}

/** Everything carried, capacity ignored (death inside the base). */
export function depositAll(ledger: ParticleLedger, storage: ParticleVector): number {
  return deposit(ledger, storage, Number.MAX_SAFE_INTEGER, null);
}

const wholeCount = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function withdraw(ledger: ParticleLedger, storage: ParticleVector, kind: number, count: number): number {
  const room = Math.max(0, TANK.capacity - ledger.poolTotal("player"));
  const n = Math.min(wholeCount(count), storage[kind] ?? 0, room);
  if (n <= 0) return 0;
  ledger.transfer("base", "player", PARTICLE_TYPES[kind], n);
  storage[kind] -= n;
  return n;
}

export function release(ledger: ParticleLedger, storage: ParticleVector, kind: number, count: number): number {
  const n = Math.min(wholeCount(count), storage[kind] ?? 0);
  if (n <= 0) return 0;
  ledger.transfer("base", "suspended", PARTICLE_TYPES[kind], n);
  storage[kind] -= n;
  return n;
}
