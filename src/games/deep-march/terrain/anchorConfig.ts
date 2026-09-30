/**
 * Surface-anchor search tunables (surfaceAnchor.ts, openWater.ts), metres.
 * Mode-agnostic: any feature that has to sit on the rock (resource nodes, M4)
 * or float in open water (lost caches) uses these.
 */
export const ANCHOR = {
  /** Vertical scan of a column: top, bottom and step (the smoothed field). */
  yTop: 96,
  yBottom: -170,
  scanStep: 1.5,
  /** Horizontal march toward a wall: reach and step. */
  wallReach: 40,
  wallStep: 1,
  /** Bisection steps on the iso surface (1.5 m / 2^12 ≈ 0.4 mm). */
  refine: 12,
  /** Search disc around the site point: radius as a fraction of the site cell. */
  discFraction: 0.42,
  /** Keep this far inside the world rectangle (the wall's inner face reaches ~42 m in). */
  worldMargin: 90,
  /** The site's own region must weigh at least this much at the anchor. */
  regionMin: 0.75,
  /** Minimum distance between two anchors of the same site. */
  spacing: 10,
  /** Attempts with the strict surface rule, then with the relaxed one ("rock"). */
  strictAttempts: 24,
  relaxedAttempts: 8,
  /** Rock must continue this far behind the surface (no floater nodes). */
  rockBehind: [2.5, 6] as readonly number[],
  /** Open water above floor / ledge anchors, and the "sheltered" roof search. */
  openAbove: 6,
  roofReach: 12,
  /** Ledge: the terrain drops by `ledgeDrop` within `ledgeReach` in at least one of 6 directions. */
  ledgeReach: 5,
  ledgeDrop: 3,
  /** Normal thresholds (n.y). */
  floorNy: 0.8,
  ledgeNy: 0.6,
  wallNy: 0.5,
  rockNy: -0.3,
} as const;

/** Open-water search (openWater.ts): clearance, probe step, search shells. */
export const OPEN_WATER = {
  clearance: 1.8,
  probeStep: 0.45,
  shellStep: 1,
  shells: 12,
} as const;

/**
 * Building ground (groundProbe.ts, conserve base M5): aim ray, floor scans of the
 * footprint, the slope / roughness / clearance tests, metres and degrees.
 */
export const GROUND = {
  /** Aim ray from the eye: reach and march step. */
  reach: 48,
  rayStep: 0.5,
  refine: 10,
  /** Floor scan step, and how far above / below the aimed point a floor may be. */
  scanStep: 0.75,
  scanAbove: 3,
  scanBelow: 14,
  /** Footprint samples: points on the rim and on the half-radius circle. */
  rimPoints: 8,
  /** Best-fit plane residual allowed (bumps / holes under the footprint). */
  roughness: 2.5,
  /** Deepest dip under the footprint the building's skirt can cover. */
  skirt: 6,
  /** Clearance columns (centre + 4 at this fraction of the radius), sample step. */
  clearanceAt: 0.7,
  clearanceStep: 2,
  /** Dominant region weight at the footprint centre (not on a biome blend). */
  regionMin: 0.6,
} as const;
