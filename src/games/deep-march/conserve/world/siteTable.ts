/**
 * Site table of one generation (design doc §3.2, §3.3, §5.2):
 *   (seed, gen, R, frozen) → per site: jitter, biome, variation hash, particle
 *   allocation a_{i,k}, in-site split and the terrain bias δ_i.
 * Pure and deterministic — the same table on every device and thread; the save
 * stores only R (generation.allocInput) and the frozen sites.
 *
 *   1. non-frozen sites: fresh jitter / variation hashes; biome drawn from
 *      regionProbabilities(R, N); frozen sites keep their stored values;
 *   2. π_{i,k} = A[r_i][k] · (base + span · hash(i, k)) · e_i (frozen: 0, edge: e);
 *   3. a_{·,k} = largestRemainder(R_k, π_{·,k})  ⇒  Σ_i a_{i,k} = R_k exactly;
 *   4. split and δ_i = rockBias(a_{i,rock}, ā_rock) (frozen: the stored δ).
 */
import { AFFINITY, BIOMES, SITE_TABLE, WORLD_SIZE, type Biome } from "../config";
import { PARTICLE_TYPES, particleIndex } from "../particles/particleTypes";
import { zeroVector, type ParticleVector, type ReadonlyParticleVector } from "../particles/particleVector";
import { largestRemainder } from "./allocate";
import { drawRegion, regionProbabilities } from "./regionDraw";
import { HASH_SALT, siteHash } from "./siteHash";
import { splitSite, type SiteSplit } from "./siteSplit";
import { genesisMeanRock, rockBias } from "./terrainBias";

/** A site kept as it is across tides (the base's 3 × 3, M5). */
export type FrozenSite = { i: number; jx: number; jz: number; region: number; hash: number; delta: number };

export type SiteTableInput = {
  seed: number;
  gen: number;
  /** R_k of this generation. */
  allocInput: ReadonlyParticleVector;
  /** N_k (genesis totals). */
  totals: ReadonlyParticleVector;
  frozen?: readonly FrozenSite[];
  size?: { sitesX: number; sitesZ: number };
};

export type Site = {
  /** Row-major index iz · sitesX + ix. */
  i: number;
  ix: number;
  iz: number;
  /** Jitter hashes in [0, 1) (position inside the cell; the terrain applies the jitter range). */
  jx: number;
  jz: number;
  /** Biome index (BIOMES / terrain region order). */
  region: number;
  biome: Biome;
  /** Variation hash in [0, 1) (canyon axis, …). */
  hash: number;
  /** Touches the world edge (allocation × edgeFactor). */
  edge: boolean;
  frozen: boolean;
  alloc: ParticleVector;
  split: SiteSplit;
  /** Terrain bias δ_i (raw density units). */
  delta: number;
};

export type SiteTable = { seed: number; gen: number; sitesX: number; sitesZ: number; allocInput: ParticleVector; sites: Site[] };

type Layout = Omit<Site, "alloc" | "split" | "delta"> & { frozenDelta: number };

function layoutSites(input: SiteTableInput, sitesX: number, sitesZ: number): Layout[] {
  const frozen = new Map((input.frozen ?? []).map((f) => [f.i, f]));
  const probs = regionProbabilities(input.allocInput, input.totals);
  const out: Layout[] = [];
  for (let iz = 0; iz < sitesZ; iz++) {
    for (let ix = 0; ix < sitesX; ix++) {
      const i = iz * sitesX + ix;
      const edge = ix === 0 || iz === 0 || ix === sitesX - 1 || iz === sitesZ - 1;
      const f = frozen.get(i);
      const h = (salt: number) => siteHash(input.seed, input.gen, i, salt);
      const region = f ? f.region : drawRegion(probs, h(HASH_SALT.region));
      out.push({
        i, ix, iz, edge,
        jx: f ? f.jx : h(HASH_SALT.jitterX),
        jz: f ? f.jz : h(HASH_SALT.jitterZ),
        region,
        biome: BIOMES[region],
        hash: f ? f.hash : h(HASH_SALT.variation),
        frozen: !!f,
        frozenDelta: f ? f.delta : 0,
      });
    }
  }
  return out;
}

/** Allocation weight without the affinity: jitter · edge factor (frozen sites: 0). */
function baseWeight(input: SiteTableInput, s: Layout, k: number): number {
  if (s.frozen) return 0;
  const jitter = SITE_TABLE.jitterBase + SITE_TABLE.jitterSpan * siteHash(input.seed, input.gen, s.i, HASH_SALT.alloc + k);
  return jitter * (s.edge ? SITE_TABLE.edgeFactor : 1);
}

/** π_{i,k} (unnormalised); if no site has affinity for kind k, the base weights alone. */
function kindWeights(input: SiteTableInput, layout: readonly Layout[], k: number): number[] {
  const base = layout.map((s) => baseWeight(input, s, k));
  const w = layout.map((s, i) => AFFINITY[s.biome][PARTICLE_TYPES[k]] * base[i]);
  return w.some((x) => x > 0) ? w : base;
}

export function buildSiteTable(input: SiteTableInput): SiteTable {
  const { sitesX, sitesZ } = input.size ?? WORLD_SIZE;
  const layout = layoutSites(input, sitesX, sitesZ);
  const alloc = layout.map(() => zeroVector());
  const tie = layout.map((s) => siteHash(input.seed, input.gen, s.i, HASH_SALT.tie));
  PARTICLE_TYPES.forEach((_, k) => {
    largestRemainder(input.allocInput[k], kindWeights(input, layout, k), tie).forEach((a, i) => (alloc[i][k] = a));
  });
  const rock = particleIndex("lithic");
  const meanRock = genesisMeanRock(input.totals, layout.length);
  const sites = layout.map(({ frozenDelta, ...s }, i): Site => ({
    ...s,
    alloc: alloc[i],
    split: splitSite(alloc[i]),
    delta: s.frozen ? frozenDelta : rockBias(alloc[i][rock], meanRock),
  }));
  return { seed: input.seed, gen: input.gen, sitesX, sitesZ, allocInput: input.allocInput.slice(), sites };
}

/** Σ_i a_{i,k} per kind (equals allocInput by construction; tests and diagnostics). */
export function allocatedTotals(table: SiteTable): ParticleVector {
  const sum = zeroVector();
  for (const s of table.sites) s.alloc.forEach((n, k) => (sum[k] += n));
  return sum;
}
