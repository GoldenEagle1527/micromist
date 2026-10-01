/**
 * Macro terrain regions — large (~80–150 unit) areas that each drive their own
 * density parameters (see regionParams.ts), so every terrain type forms an
 * explorable area instead of classes changing every few units.
 *
 * Pure and deterministic: a function of (seed, x, z) only — identical on every
 * device and quality preset, in the worker and on the main thread.
 *
 *  1. warp:   q = (x, z) + warpAmp · (n(x·f, z·f), n(…))   low-frequency domain warp, so
 *             region borders meander instead of running as straight Voronoi edges;
 *  2. sites:  one seeded site per `cell`-sized grid cell (jittered inside the cell),
 *             region id drawn per site from REGION_WEIGHTS (neighbouring sites of the
 *             same region merge into larger patches);
 *  3. blend:  pairwise bisector partition of unity: site weight
 *               w_i = Π_j smooth01(1/2 + t_ij / band),  t_ij = (d_j² − d_i²) / (2·|s_i − s_j|)
 *             (t_ij = signed distance from the bisector of sites i, j), normalised. Across
 *             any border the weights fall from 1 to 0 over exactly `band` (warped units)
 *             measured perpendicular to that border — no widening where borders run
 *             obliquely or near triple junctions (the old Δd = d_i − d_min blend widened
 *             by 1/sin(φ/2) there). C1 everywhere; only sites with Δd < band can have
 *             weight (t ≥ Δd/2), so the mask test below stays conservative. Weights of
 *             sites sharing a region add up.
 *
 * API:
 *   createRegionField(seed, layout?) → RegionField
 *     layout (siteLayout.ts): explicit sites for a finite rectangle of cells (bounded
 *     world); cells outside keep the seeded sites. sample() then also returns the
 *     blended site bias Σ w_i δ_i (0 without a layout).
 *     sample(x, z, out)    per-region weights (+ dominant id, edge distance) into a RegionSample
 *     regionAt(x, z)       dominant region id
 *     maskInRect(…)        bitmask of regions with non-zero weight anywhere in a rectangle
 *                          (conservative; used for per-column density bounds)
 *     coresOf(r, n)        cores (max border distance) of region r, nearest the origin first
 *     spawnRegion()        seeded spawn region (uniform over the 6; see spawn.ts)
 *
 * Parts: ids / tuning / types (regionTypes.ts), sites + warp (regionSites.ts),
 * the blend (regionBlend.ts), rectangle masks and cores (regionQueries.ts).
 */
import { layoutIndex, type SiteLayout } from "./siteLayout";
import { REGION_COUNT, createRegionSample, type RegionField } from "./regionTypes";
import { createSiteGrid, regionHash } from "./regionSites";
import { createRegionBlend } from "./regionBlend";
import { createCoresOf, createMaskInRect } from "./regionQueries";

export * from "./regionTypes";

const fieldCache = new Map<number, RegionField>();
const layoutCache = new WeakMap<SiteLayout, RegionField>();

export function createRegionField(seed: number, layout: SiteLayout | null = null): RegionField {
  const cached = layout ? layoutCache.get(layout) : fieldCache.get(seed);
  if (cached && cached.seed === seed) return cached;
  const grid = createSiteGrid(seed, layout);
  const { site, mX, mZ, warpX, warpZ } = grid;
  const sample = createRegionBlend(grid, layout);

  const tmp = createRegionSample();
  const regionAt = (x: number, z: number) => sample(x, z, tmp).id;
  const maskInRect = createMaskInRect(grid);
  const coresOf = createCoresOf(grid, sample, tmp);
  /** Spawn region: uniform over the 6 regions, drawn from the seed. */
  const spawnRegion = () => Math.min(REGION_COUNT - 1, Math.floor(regionHash(seed, 7, 13, 97) * REGION_COUNT));

  const warp = (x: number, z: number, out: { x: number; z: number }) => {
    out.x = warpX(x, z);
    out.z = warpZ(x, z);
  };
  const siteOf = (cx: number, cz: number, out: { x: number; z: number; li: number }) => {
    const sl = site(cx, cz);
    out.x = mX[sl];
    out.z = mZ[sl];
    out.li = layout ? layoutIndex(layout, cx, cz) : -1;
  };

  const f: RegionField = { seed, layout, sample, regionAt, maskInRect, coresOf, spawnRegion, warp, siteOf };
  if (layout) layoutCache.set(layout, f);
  else fieldCache.set(seed, f);
  return f;
}

/**
 * The same regions in world coordinates of a world scaled by S (density.ts
 * worldScale): positions are divided by S on the way in, distances multiplied
 * on the way out (edge, cores).
 */
export function scaleRegionField(base: RegionField, S: number): RegionField {
  const inv = 1 / S;
  return {
    seed: base.seed,
    layout: base.layout,
    sample: (x, z, out) => {
      base.sample(x * inv, z * inv, out);
      out.edge *= S;
      return out;
    },
    regionAt: (x, z) => base.regionAt(x * inv, z * inv),
    maskInRect: (x0, z0, x1, z1) => base.maskInRect(x0 * inv, z0 * inv, x1 * inv, z1 * inv),
    coresOf: (r, max) => base.coresOf(r, max).map((c) => ({ x: c.x * S, z: c.z * S, edge: c.edge * S })),
    spawnRegion: base.spawnRegion,
    warp: (x, z, out) => {
      base.warp(x * inv, z * inv, out);
      out.x *= S;
      out.z *= S;
    },
    siteOf: (cx, cz, out) => {
      base.siteOf(cx, cz, out);
      out.x *= S;
      out.z *= S;
    },
  };
}
