/**
 * Particle vectors: one non-negative integer count per particle kind, in
 * PARTICLE_TYPES order. Plain arrays so they serialize as they are.
 */
import { PARTICLE_TYPES, PARTICLE_TYPE_COUNT, particleIndex, type ParticleType } from "./particleTypes";

export type ParticleVector = number[];
export type ReadonlyParticleVector = readonly number[];

/** Sparse, readable form used by config tables: `{ lithic: 600, ferro: 80 }`. */
export type ParticleCounts = Partial<Record<ParticleType, number>>;

export function zeroVector(): ParticleVector {
  return new Array<number>(PARTICLE_TYPE_COUNT).fill(0);
}

export function vectorFromCounts(counts: ParticleCounts): ParticleVector {
  const v = zeroVector();
  for (const type of PARTICLE_TYPES) v[particleIndex(type)] = counts[type] ?? 0;
  return v;
}

export function copyVector(v: ReadonlyParticleVector): ParticleVector {
  return v.slice();
}

export function vectorTotal(v: ReadonlyParticleVector): number {
  let sum = 0;
  for (const n of v) sum += n;
  return sum;
}

export function isParticleCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** A well-formed vector: the right length and every entry a non-negative safe integer. */
export function isCountVector(v: unknown): v is ParticleVector {
  return Array.isArray(v) && v.length === PARTICLE_TYPE_COUNT && v.every(isParticleCount);
}

/** Right length and every entry a finite number (may still need sanitizing). */
export function isNumberVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === PARTICLE_TYPE_COUNT && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** a += b, in place. */
export function addInto(a: ParticleVector, b: ReadonlyParticleVector): ParticleVector {
  for (let k = 0; k < a.length; k++) a[k] += b[k];
  return a;
}
