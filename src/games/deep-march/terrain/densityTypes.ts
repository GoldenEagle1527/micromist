/**
 * The density field's public shape (density.ts createDensityField) and the
 * constants shared by its parts and the mesher.
 */
import type { TerrainSettings } from "./config";
import { REGION_COUNT, type RegionField } from "./regions";
import type { WallTerm } from "./wallDensity";
import type { CrackWeight } from "./crackWeight";

export type DensityField = {
  settings: TerrainSettings;
  /** World seed the field was built from (for deterministic per-position hashing). */
  seed: number;
  /** Macro regions driving the field (pure function of seed + x, z; world coordinates). */
  regions: RegionField;
  /** Full density at a world position (vertically smoothed; this is the terrain). */
  sample: (x: number, y: number, z: number) => number;
  /** Unsmoothed density; sample = Σ smoothWeights[i] · sampleRaw(x, y + (i − h)·smoothStep, z), h = (len − 1)/2. */
  sampleRaw: (x: number, y: number, z: number) => number;
  /**
   * sampleRaw with the (x, z) region context snapped to the nearest lattice line —
   * for heuristics sampled at arbitrary points (mesh AO), where the exact
   * per-point region blend is not worth its cost. Deterministic.
   */
  sampleRawCoarse: (x: number, y: number, z: number) => number;
  /** Vertical tap spacing of the smoothing kernel (a whole number of lattice cells). */
  smoothStep: number;
  /** Binomial vertical smoothing weights (odd length, sum 1). */
  smoothWeights: number[];
  /** Conservative [min, max] of sample(x, y, z) over all x, z. */
  bounds: (y: number, out: Float64Array) => void;
  /** Conservative [min, max] of sample over every (x, z) whose non-zero regions are within `mask`. */
  boundsForMask: (mask: number, y: number, out: Float64Array) => void;
  /** Same for sampleRaw (no vertical smoothing; used by the coarse LOD meshes). */
  rawBoundsForMask: (mask: number, y: number, out: Float64Array) => void;
  /**
   * Cheap conservative class of sampleRaw at a world point (no noise evaluated):
   * 2 = certainly solid with a known value (the deep-rock cap, or ring-wall rock the
   *     wall alone fixes) — out[0] is then exactly sampleRaw's value;
   * 1 = certainly water — out[0] is an upper bound (< isoLevel; exact in the wall's
   *     void); 0 = unknown.
   * Lets the mesher skip noise where the exact value provably can't matter.
   */
  rawClass: (x: number, y: number, z: number, out: Float64Array) => number;
  /** Gradient pointing toward solid (central difference; the field is continuous). */
  gradient: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
  /** Ring-wall term (base units), null without a wall. */
  wall: WallTerm | null;
  /** WALL_BIT if the wall term can act anywhere in the world-space rectangle, else 0. */
  wallMask: (x0: number, z0: number, x1: number, z1: number) => number;
  /** Wall material weight at a world position (0 … 1); null without a wall. */
  wallWeight: ((x: number, y: number, z: number) => number) | null;
  /** Crack glow weight at a world position (0 … 1, crackWeight.ts); null without open cracks. */
  crackWeight: CrackWeight | null;
};

/** Every region bit set. */
export const ALL_REGIONS_MASK = (1 << REGION_COUNT) - 1;
/** Mask bit (above the region bits): the column is near the ring wall. */
export const WALL_BIT = 1 << REGION_COUNT;

/** Binomial smoothing weights (sum 1) for 1, 3 or 5 taps. */
export function smoothWeights(taps: number): number[] {
  if (taps >= 5) return [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  if (taps >= 3) return [1 / 4, 2 / 4, 1 / 4];
  return [1];
}

/** Raw density is capped at iso + RAW_CAP (deep rock; see densityEval.ts). */
export const RAW_CAP = 16;
