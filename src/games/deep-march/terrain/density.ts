/**
 * Density field — SebLague `NoiseDensity.compute` ridged noise, reworked so the
 * field is continuous everywhere (no straight shelves / flat plates), and driven
 * by macro terrain regions (regions.ts, parameters in regionParams.ts):
 *
 *   p'    = p + W(x,z) · warp(p)                 low-frequency 3D domain warp
 *                                                (W = region-blended warp strength)
 *   D_r   = bias_r + slope_r · (H_r(x,z) − y)    region base height field
 *         + nw_r · ridged(p')                    reference multi-octave ridged noise with a
 *                                                rounded crest (|n| → √(n² + r²))
 *         + la_r · layer(p')                     soft layering (two sine harmonics)
 *         + e_r · erosion(p')                    one higher-frequency detail octave
 *         + floorWeight · smoothstep(...)        undulating hard floor (region height)
 *         + ceilingSlope · ramp(y − ceilH)       undulating rock ceiling (C1 ramp)
 *         + extra_r(p')                          region-only terms (caves, boulders)
 *   raw   = Σ_r w_r(x,z) · D_r + Σ_i w_i δ_i     region weights, C1 across ~15–20-unit bands;
 *                                                δ_i = per-site bias of an explicit site layout
 *                                                (bounded world, siteLayout.ts; 0 otherwise)
 *   final = Σ w_i · raw(x, y + (i − 2)·h, z)    vertical binomial [1 4 6 4 1]/16 smoothing
 *
 * The shared noise shapes (warp, ridged, layer, erosion) are evaluated once per
 * sample; region terms only where their weight is non-zero. xz-only quantities
 * (region weights, H_r, floor / ceiling heights) are cached per (x, z), so a
 * column of samples pays for them once.
 *
 * The rounded crest and the vertical smoothing make the rock water-worn: sheets
 * thinner than the kernel vanish and shelf rims come out blunt. h is a whole
 * number of lattice cells so the mesher computes `final` exactly from its raw rows.
 *
 * World scale (settings.worldScale = S): the public samplers evaluate everything
 * above at p / S and return iso + S·(value − iso), so the world is S× larger in
 * every direction with unchanged density gradients (octaves beyond the reference 8
 * are supported but off: finer than the lattice). The vertical smoothing and the
 * lattice stay in world units.
 *
 * Bounds: each region's D_r has analytic per-y bounds; since raw is a convex
 * combination, [min_r lo_r, max_r hi_r] over the regions present is a valid
 * bound. `bounds(y)` uses all regions (global, for the column height);
 * `boundsForMask(mask, y)` only the regions in `mask` (per-column row skipping).
 * The site bias is a convex combination of the layout's δ and 0 (sites outside it),
 * so the bounds widen by [min(0, min δ), max(0, max δ)].
 *
 * Parts: seeded constants (densityCore.ts), region heights (regionHeight.ts), the
 * per-(x, z) cache (densityCache.ts), evalRaw (densityEval.ts), bounds
 * (densityBounds.ts); the public type in densityTypes.ts.
 *
 * Ring wall (bounded world with layout.wall; wallDensity.ts): raw = W(raw_terrain)
 * where some (x, z) reach past the term's skip distance (else W is an exact identity
 * and is not evaluated). W is monotone in the terrain value, so per-point bounds map
 * through it; masks carry WALL_BIT for columns near the wall, whose row bounds become
 * [min(lo, void floor / roof), cap].
 *
 * Anomalous terrain (chaos stage 3+, layout.wall.anomaly; anomaly.ts): near open cracks
 * the per-(x, z) context scales W, flips the layering and pulls barbs from the ceiling /
 * floor undulation — each inside the ranges the bounds above already assume.
 */
import type { TerrainSettings } from "./config";
import { REGION_PARAMS, type RegionParams } from "./regionParams";
import { MACRO, REGION_COUNT, createRegionField, scaleRegionField } from "./regions";
import { layoutRect, type SiteLayout } from "./siteLayout";
import { createWallTerm } from "./wallDensity";
import { createWallShape } from "./wallGeometry";
import { createCrackWeight, type CrackWeight } from "./crackWeight";
import { createAnomaly } from "./anomaly";
import { ALL_REGIONS_MASK, WALL_BIT, smoothWeights, type DensityField } from "./densityTypes";
import { createDensityCore } from "./densityCore";
import { createRegionHeight } from "./regionHeight";
import { createDensityCache } from "./densityCache";
import { createEvalRaw } from "./densityEval";
import { createDensityBounds } from "./densityBounds";

export { ALL_REGIONS_MASK, RAW_CAP, WALL_BIT, smoothWeights, type DensityField } from "./densityTypes";

/** layout: explicit finite site layout (bounded world); null = the endless seeded field. */
export function createDensityField(
  seed: number,
  s: TerrainSettings,
  params: readonly RegionParams[] = REGION_PARAMS,
  layout: SiteLayout | null = null,
): DensityField {
  const core = createDensityCore(seed, s, params, layout);
  const { S, invS, iso, capHi, wallRef } = core;
  const baseRegions = createRegionField(seed, layout);
  const regions = S === 1 ? baseRegions : scaleRegionField(baseRegions, S);
  const heights = createRegionHeight(core);
  const wallShape = layout && layout.wall ? createWallShape(layoutRect(layout, MACRO.cell), layout.wall, seed) : null;
  // chaos stage 3+ anomalous terrain near open cracks (null: none, the field is untouched)
  const anomaly = wallShape && layout?.wall ? createAnomaly(wallShape, layout.wall, seed) : null;
  const cache = createDensityCache(core, baseRegions, heights, anomaly);
  const ctx = cache.ctx;
  const evalRaw = createEvalRaw(core, cache);

  const latSp = s.boundsSize / (s.numPointsPerAxis - 1);
  const latH = s.boundsSize / 2;
  const snap = (v: number) => -latH + Math.round((v + latH) / latSp) * latSp;
  // Public samplers take world coordinates; evalRaw / ctx work in base coordinates (p / S;
  // S is a power of two, so the division is exact and the per-(x, z) cache keys stay exact).
  const sampleRawCoarse =
    S === 1
      ? (x: number, y: number, z: number) => evalRaw(ctx(snap(x), snap(z)), x, y, z)
      : (x: number, y: number, z: number) => {
          const bx = snap(x) * invS, bz = snap(z) * invS;
          return iso + S * (evalRaw(ctx(bx, bz), x * invS, y * invS, z * invS) - iso);
        };
  const sampleRaw =
    S === 1
      ? (x: number, y: number, z: number) => evalRaw(ctx(x, z), x, y, z)
      : (x: number, y: number, z: number) => {
          const bx = x * invS, bz = z * invS;
          return iso + S * (evalRaw(ctx(bx, bz), bx, y * invS, bz) - iso);
        };

  // --- vertical smoothing: binomial ([1 2 1]/4 or [1 4 6 4 1]/16), taps smoothStep apart ---
  const smoothStep = (s.boundsSize / (s.numPointsPerAxis - 1)) * s.smoothCells;
  const SW = smoothWeights(s.smoothTaps);
  const half = (SW.length - 1) / 2;
  const hs = smoothStep;
  const sample = (x: number, y: number, z: number): number => {
    let v = 0;
    for (let i = 0; i < SW.length; i++) v += SW[i] * sampleRaw(x, y + (i - half) * hs, z);
    return v;
  };
  const { rawClassBase, regionRawBounds, boundsForMask, rawBoundsForMask } = createDensityBounds(core, cache, heights, SW, hs);
  const rawClass =
    S === 1
      ? (x: number, y: number, z: number, out: Float64Array) => rawClassBase(ctx(x, z), y, out)
      : (x: number, y: number, z: number, out: Float64Array) => rawClassBase(ctx(x * invS, z * invS), y * invS, out);

  // --- ring wall: tMin = a lower bound of the terrain's raw value at any height ---
  let wallMask = (_x0: number, _z0: number, _x1: number, _z1: number) => 0;
  let wallWeight: DensityField["wallWeight"] = null;
  let crackWeight: CrackWeight | null = null;
  if (wallShape) {
    const tb = new Float64Array(2);
    let tMin = Infinity;
    for (let y = -80; y <= 60; y += 0.25) for (let r = 0; r < REGION_COUNT; r++) {
      regionRawBounds(r, y, tb);
      if (tb[0] < tMin) tMin = tb[0];
    }
    const w = (wallRef.term = createWallTerm(wallShape, iso, capHi, tMin));
    const loc = new Float64Array(2);
    const sdAt = (x: number, z: number) => {
      wallShape.locate(x * invS, z * invS, loc);
      return loc[0];
    };
    // sd is convex (the outline is convex): its maximum over a rectangle is at a corner
    wallMask = (x0, z0, x1, z1) => (Math.max(sdAt(x0, z0), sdAt(x1, z0), sdAt(x0, z1), sdAt(x1, z1)) > w.skipSd ? WALL_BIT : 0);
    wallWeight = (x, y, z) => {
      wallShape.locate(x * invS, z * invS, loc);
      return w.weight(loc[0], loc[1], y * invS);
    };
    crackWeight = createCrackWeight(wallShape, invS);
  }
  const allMask = ALL_REGIONS_MASK | (wallShape ? WALL_BIT : 0);
  const bounds = (y: number, out: Float64Array) => boundsForMask(allMask, y, out);

  const gradient = (x: number, y: number, z: number, out: Float64Array, h = 0.1) => {
    const inv = 1 / (2 * h);
    out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) * inv;
    out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) * inv;
    out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) * inv;
  };

  return {
    settings: s, seed, regions, sample, sampleRaw, sampleRawCoarse, rawClass, smoothStep, smoothWeights: SW, bounds, boundsForMask, rawBoundsForMask, gradient,
    wall: wallRef.term, wallMask, wallWeight, crackWeight,
  };
}
