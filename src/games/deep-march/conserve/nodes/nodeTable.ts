/**
 * Resource nodes of one generation (design doc §3.3, §7.1; plan M4): each site's
 * node share `split.nodes` (world/siteSplit.ts) cut into nodes, as a pure
 * function of the site table — the same nodes on every device, fixed until the
 * next tide.
 *
 *   count(share) = 0 below NODES.minSize (the share stays in the terrain body),
 *                  else ≈ share / meanSize, kept so that sizes fit min … max;
 *   ≤ NODES.perSite nodes per site (the largest counts give way; sizes stretch);
 *   sizes: largest remainder of the share over weights base + span · hash, then
 *          moved into [min, max] — Σ sizes = share exactly.
 * Node id = site · perSite + ordinal (kinds in storage order).
 */
import { NODES, NODE_SURFACE, type NodeSurface } from "../config";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { zeroVector, type ParticleVector } from "../particles/particleVector";
import { largestRemainder } from "../world/allocate";
import { HASH_SALT, siteHash } from "../world/siteHash";
import type { Site, SiteTable } from "../world/siteTable";

export type NodeSpec = {
  id: number;
  site: number;
  ordinal: number;
  /** Particle kind (storage index). */
  kind: number;
  /** Particles in the node at the start of the generation. */
  amount: number;
  surface: NodeSurface;
  /** Placement hash (uint32): the scene's deterministic surface search starts from it. */
  hash: number;
};

export type SiteNodes = {
  site: number;
  nodes: NodeSpec[];
  /** Node share too small for a node: stays in the site's terrain body. */
  unplaced: ParticleVector;
};

export type NodeTable = { gen: number; sites: SiteNodes[]; byId: ReadonlyMap<number, NodeSpec> };

export function nodeCount(share: number): number {
  const { minSize, meanSize, maxSize } = NODES;
  if (share < minSize) return 0;
  const nominal = Math.max(Math.ceil(share / maxSize), Math.round(share / meanSize));
  return Math.max(1, Math.min(Math.floor(share / minSize), nominal));
}

/** Largest counts give way (ties: the later kind) until the site has ≤ perSite nodes; never below 1. */
function capCounts(counts: number[]): number[] {
  const out = counts.slice();
  let total = out.reduce((a, n) => a + n, 0);
  while (total > NODES.perSite) {
    let j = -1;
    out.forEach((n, k) => {
      if (n > 1 && (j < 0 || n >= out[j])) j = k;
    });
    if (j < 0) break;
    out[j]--;
    total--;
  }
  return out;
}

const argBy = (parts: number[], better: (a: number, b: number) => boolean) => parts.reduce((best, p, i) => (better(p, parts[best]) ? i : best), 0);

/** Move units until every part is in [lo, hi] (the mean must be in range); Σ unchanged. */
export function clampSizes(parts: number[], lo: number, hi: number): number[] {
  for (let guard = parts.length * (hi + 1); guard > 0; guard--) {
    const over = parts.findIndex((p) => p > hi);
    const under = parts.findIndex((p) => p < lo);
    if (over < 0 && under < 0) break;
    if (over >= 0) {
      const j = argBy(parts, (a, b) => a < b);
      const d = Math.min(parts[over] - hi, hi - parts[j]);
      parts[over] -= d;
      parts[j] += d;
    } else {
      const j = argBy(parts, (a, b) => a > b);
      const d = Math.min(lo - parts[under], parts[j] - lo);
      parts[under] += d;
      parts[j] -= d;
    }
  }
  return parts;
}

export function nodeSizes(share: number, n: number, hash: (j: number) => number): number[] {
  if (n <= 0) return [];
  const w = Array.from({ length: n }, (_, j) => NODES.jitterBase + NODES.jitterSpan * hash(j));
  const hi = Math.max(NODES.maxSize, Math.ceil(share / n));
  const lo = Math.min(NODES.minSize, Math.floor(share / n));
  return clampSizes(largestRemainder(share, w, w), lo, hi);
}

export function siteNodes(table: SiteTable, site: Site): SiteNodes {
  const shares = site.split.nodes;
  const counts = capCounts(shares.map(nodeCount));
  const h = (salt: number) => siteHash(table.seed, table.gen, site.i, salt);
  const nodes: NodeSpec[] = [];
  const unplaced = zeroVector();
  let ordinal = 0;
  shares.forEach((share, k) => {
    if (counts[k] === 0) {
      unplaced[k] = share;
      return;
    }
    const first = ordinal;
    for (const amount of nodeSizes(share, counts[k], (j) => h(HASH_SALT.nodeSize + first + j))) {
      nodes.push({
        id: site.i * NODES.perSite + ordinal,
        site: site.i,
        ordinal,
        kind: k,
        amount,
        surface: NODE_SURFACE[PARTICLE_TYPES[k]],
        hash: Math.floor(h(HASH_SALT.node + ordinal) * 4294967296) >>> 0,
      });
      ordinal++;
    }
  });
  return { site: site.i, nodes, unplaced };
}

export function buildNodeTable(table: SiteTable): NodeTable {
  const sites = table.sites.map((s) => siteNodes(table, s));
  const byId = new Map<number, NodeSpec>();
  for (const s of sites) for (const n of s.nodes) byId.set(n.id, n);
  return { gen: table.gen, sites, byId };
}
