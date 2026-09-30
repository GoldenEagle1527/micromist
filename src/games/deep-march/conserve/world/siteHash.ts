/**
 * Deterministic per-site hashes: (seed, gen, site, salt) → [0, 1). Integer mixing
 * only (Math.imul), so the main thread, the workers and node agree bit for bit.
 */

/** Salt of each per-site stream; allocation jitter uses alloc + particle index, node sizes nodeSize + node ordinal, node placement node + ordinal (ordinals < 64, so the streams never overlap); the ring cracks use crackThin (site = noise knot) and crackPick (gen = crack ordinal, site = candidate). */
export const HASH_SALT = { jitterX: 1, jitterZ: 2, variation: 3, region: 4, tie: 5, alloc: 16, nodeSize: 128, node: 256, crackThin: 512, crackPick: 1024 } as const;

function mix(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0xcc9e2d51);
  h = (h << 15) | (h >>> 17);
  h = Math.imul(h, 0x1b873593);
  return (h << 13) | (h >>> 19);
}

function finalize(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function siteHash(seed: number, gen: number, site: number, salt: number): number {
  let h = 0x5d0c3a1f ^ (seed | 0);
  h = mix(h, gen);
  h = mix(h, site);
  h = mix(h, salt);
  return finalize(h) / 4294967296;
}
