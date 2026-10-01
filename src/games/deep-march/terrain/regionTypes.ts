/**
 * Macro terrain region ids, tuning and the shapes of the region field
 * (regions.ts createRegionField).
 */
import type { SiteLayout } from "./siteLayout";

export const REGION = { SAND: 0, REEF: 1, CANYON: 2, CAVE: 3, TERRACE: 4, TRENCH: 5 } as const;
export type RegionKey = "sand" | "reef" | "canyon" | "cave" | "terrace" | "trench";
export const REGION_KEYS: readonly RegionKey[] = ["sand", "reef", "canyon", "cave", "terrace", "trench"];
export const REGION_COUNT = 6;
/** Relative frequency of each region (sand / reef common, cave / trench rare). */
export const REGION_WEIGHTS: readonly number[] = [0.25, 0.27, 0.15, 0.09, 0.16, 0.08];
/** Debug / map colours (sRGB hex). */
export const REGION_COLORS: readonly string[] = ["#e3c77a", "#3fc6a8", "#d9704a", "#8a63d2", "#6f9be0", "#1d3f8f"];

export const MACRO = {
  /** Site grid cell (units); jittered sites give regions ≈ 80–150 units across. */
  cell: 104,
  /** Site jitter inside its cell (fraction of the cell). */
  jitter: 0.8,
  /** Blend band: a site's weight falls to 0 once it is `band` farther than the nearest (→ ~15–20 u zones). */
  band: 17,
  warpAmp: 20,
  warpFreq: 0.006,
} as const;

export type RegionSample = {
  /** Weight per region id (sum 1). */
  w: Float64Array;
  /** Dominant region id. */
  id: number;
  /** Weight of the dominant region (1 = region core, 0.5 = on the border). */
  dominant: number;
  /** Approximate distance (units) to the nearest border with another region (≥ 0; capped at 255 base units). */
  edge: number;
  /** Per-site data of the blending sites (for site-specific shapes, e.g. canyon axis). */
  sites: number;
  siteW: Float64Array;
  siteRegion: Int8Array;
  /** Site hash in [0, 1) (orientation / variation seed). */
  siteHash: Float64Array;
  /** Blended site density bias Σ siteW_i · δ_i (layout fields; 0 otherwise). */
  bias: number;
};

export type RegionField = {
  seed: number;
  /** Explicit site layout (bounded world) or null (endless seeded sites). */
  layout: SiteLayout | null;
  sample: (x: number, z: number, out: RegionSample) => RegionSample;
  regionAt: (x: number, z: number) => number;
  maskInRect: (x0: number, z0: number, x1: number, z1: number) => number;
  /** Up to `max` cores of region r (max-border-distance points), nearest the origin first. */
  coresOf: (r: number, max: number) => { x: number; z: number; edge: number }[];
  /** Region the diver spawns in for this seed (uniform over all 6). */
  spawnRegion: () => number;
  /** The domain warp: sample() finds sites around warp(x, z) (frozenZone.ts). */
  warp: (x: number, z: number, out: { x: number; z: number }) => void;
  /** Site of grid cell (cx, cz) (warped space) and its layout index (−1: seeded, outside the layout). */
  siteOf: (cx: number, cz: number, out: { x: number; z: number; li: number }) => void;
};

export function createRegionSample(): RegionSample {
  return {
    w: new Float64Array(REGION_COUNT),
    id: 0,
    dominant: 1,
    edge: 255,
    sites: 0,
    siteW: new Float64Array(25),
    siteRegion: new Int8Array(25),
    siteHash: new Float64Array(25),
    bias: 0,
  };
}
