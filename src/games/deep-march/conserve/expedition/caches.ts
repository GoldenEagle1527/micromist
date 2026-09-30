/**
 * Lost caches (design doc §7.4, §10.1; G12): what a death leaves behind. Pure
 * list rules; the particles themselves move only through the ledger (P → L on
 * death, L → P on retrieval, L → S for the oldest when a 6th would be added).
 */
import { vectorTotal, type ParticleVector, type ReadonlyParticleVector } from "../particles/particleVector";
import type { SavedCache } from "../save/schema";

/** A lost cache as saved (id, world position, generation, contents). */
export type LostCache = SavedCache;

export function cacheTotal(c: { contents: ReadonlyParticleVector }): number {
  return vectorTotal(c.contents);
}

export function nextCacheId(list: readonly LostCache[]): number {
  return list.reduce((m, c) => Math.max(m, c.id), 0) + 1;
}

/** The cache that has to go (oldest = lowest id) before one more fits under `max`, or null. */
export function evictionFor(list: readonly LostCache[], max: number): LostCache | null {
  if (list.length < max) return null;
  return list.reduce((a, c) => (c.id < a.id ? c : a));
}

/**
 * Take up to `count` particles out of `contents` (largest kind first, ties: lower
 * index), in place. Returns the per-kind amounts taken.
 */
export function takeFromContents(contents: ParticleVector, count: number): ParticleVector {
  const taken = contents.map(() => 0);
  let left = count;
  while (left > 0) {
    let k = -1;
    contents.forEach((n, i) => {
      if (n > 0 && (k < 0 || n > contents[k])) k = i;
    });
    if (k < 0) break;
    const n = Math.min(left, contents[k]);
    contents[k] -= n;
    taken[k] += n;
    left -= n;
  }
  return taken;
}
