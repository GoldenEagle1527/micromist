/**
 * In-site split (§3.3 table): each kind's site allocation → terrain body, resource
 * nodes and creatures, as integers that add back up exactly (every bucket floors
 * its share; the last bucket with a non-zero share takes the rest).
 */
import { SITE_SPLIT, type SiteShares } from "../config";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { zeroVector, type ParticleVector, type ReadonlyParticleVector } from "../particles/particleVector";

export type SiteSplit = { terrain: ParticleVector; nodes: ParticleVector; creatures: ParticleVector };

const BUCKETS = ["terrain", "nodes", "creatures"] as const;

export function splitCount(count: number, shares: SiteShares): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  let last = -1;
  BUCKETS.forEach((b, j) => {
    if (shares[b] > 0) last = j;
  });
  if (last < 0) return out;
  let used = 0;
  BUCKETS.forEach((b, j) => {
    if (j === last || shares[b] <= 0) return;
    out[j] = Math.floor(count * shares[b]);
    used += out[j];
  });
  out[last] = count - used;
  return out;
}

export function splitSite(alloc: ReadonlyParticleVector): SiteSplit {
  const split: SiteSplit = { terrain: zeroVector(), nodes: zeroVector(), creatures: zeroVector() };
  PARTICLE_TYPES.forEach((type, k) => {
    const [t, n, c] = splitCount(alloc[k], SITE_SPLIT[type]);
    split.terrain[k] = t;
    split.nodes[k] = n;
    split.creatures[k] = c;
  });
  return split;
}
