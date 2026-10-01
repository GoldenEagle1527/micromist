/**
 * Terrain classification codes and thresholds (terrainInfo.ts).
 *
 * ── Classes ────────────────────────────────────────────────────────────────
 *  EnvCode (water cells; thresholds in ENV_T):
 *    cave      rock within 4.5 above and ≥ 6 of 8 horizontal directions closed
 *    overhang  rock within 3 above (open sideways: overhang, arch)
 *    canyon    two opposite vertical walls (x, z or diagonal pair), gap ≤ 6.5, a perpendicular side open
 *              (canyon belt: long reach, gap ≤ 13, one wall may slope, plus the water above up to
 *              the lower wall crest — see ENV_T.ringAxisLong)
 *    cliff     vertical wall within 2
 *    ridge     floor within 3, slope ≤ 35°, floor falls ≥ 1 in ≥ 5 of 8 directions (2 cells out)
 *    flat      floor within 4.5, slope < 22°        slope  floor within 4.5, slope ≥ 22°
 *    (no floor near: vertical side rock → cliff, other side rock → slope)
 *    open      the rest: no rock within 3 above, 4.5 below, none sideways within ~3
 *  SurfaceCode (spawn candidates, first match):
 *    ceiling     normal.y < −0.45
 *    cave-floor  floor-ish (normal.y ≥ 0.45) facing a cave cell
 *    crevice     concave (curv ≥ 0.12: neighbours within 1 u sit above the tangent plane)
 *    ledge-top   normal.y ≥ 0.6 and the floor 1–2 cells aside drops ≥ 2
 *    ridge       convex (curv ≤ −0.12) and normal.y ≥ 0.2
 *    floor-flat  normal.y ≥ 0.8     floor-slope  ≥ 0.45     wall  otherwise
 *  exposure = share of the 8 horizontal directions + up that are open from the
 *  cell in front; sheltered = exposure < 0.45, env cave/overhang, or AO < 0.4.
 */

export type EnvironmentKind = "open" | "flat" | "slope" | "cliff" | "cave" | "overhang" | "canyon" | "ridge";
/** EnvCode → kind; code 0 is solid rock. */
export const ENV_KINDS: readonly (EnvironmentKind | "rock")[] = ["rock", "open", "flat", "slope", "cliff", "cave", "overhang", "canyon", "ridge"];
export const ENV = { ROCK: 0, OPEN: 1, FLAT: 2, SLOPE: 3, CLIFF: 4, CAVE: 5, OVERHANG: 6, CANYON: 7, RIDGE: 8 } as const;

export type SurfaceType = "floor-flat" | "floor-slope" | "wall" | "ceiling" | "ledge-top" | "crevice" | "ridge" | "cave-floor";
export const SURFACE_TYPES: readonly SurfaceType[] = ["floor-flat", "floor-slope", "wall", "ceiling", "ledge-top", "crevice", "ridge", "cave-floor"];
export const SURF = { FLOOR_FLAT: 0, FLOOR_SLOPE: 1, WALL: 2, CEILING: 3, LEDGE_TOP: 4, CREVICE: 5, RIDGE: 6, CAVE_FLOOR: 7 } as const;

/** Classification thresholds (world units / degrees). */
export const ENV_T = {
  /** Target class-grid spacing; stride = round(this / lattice spacing). */
  classSpacing: 1,
  /** Horizontal scan: axis directions 3 cells, diagonals 2 cells (≈ 3 u). */
  ringAxis: 3,
  ringDiag: 2,
  caveUp: 4.5,
  caveClosed: 6,
  overhangUp: 3,
  canyonGap: 6.5,
  /**
   * Region-aware long reach (columns whose window touches the cave warren or the
   * canyon belt scan 7 axis / 5 diagonal cells ≈ 7.1–7.2 u): in the cave warren a
   * cell is cave when rock is within caveUpLong above and ≥ caveClosedLong of 8
   * sides are closed within caveReachLong, or (under a low roof ≤ overhangUp)
   * ≥ caveClosedLong − 1 sides (tunnels / chambers are wider than 3 u); in the
   * canyon belt a trench cell is canyon when two opposite walls (one vertical)
   * are ≤ canyonGapLong apart and a perpendicular direction stays open, and the
   * canyon label then extends upward to the lower wall crest.
   */
  ringAxisLong: 7,
  ringDiagLong: 5,
  caveUpLong: 8,
  caveClosedLong: 5,
  /** Cave warren: a side counts as closed when rock is within this distance. */
  caveReachLong: 5.3,
  canyonGapLong: 13,
  cliffDist: 2,
  ridgeFloor: 3,
  ridgeSlope: 35,
  ridgeDrop: 1,
  ridgeFalloff: 5,
  openClear: 4.5,
  floorNear: 4.5,
  flatSlope: 22,
  spawnCell: 1.5,
  frontOffset: 0.7,
  curvRadius: 1,
  concave: 0.12,
  convex: -0.12,
  ledgeDrop: 2,
  /** Convex points only count as ridge when facing up-ish (convex vertical faces stay walls). */
  ridgeMinNy: 0.2,
  shelteredExposure: 0.45,
  shelteredAo: 0.4,
} as const;
