/**
 * Per-region density parameters (see density.ts for the formula and regions.ts
 * for the region layout). Every region r contributes
 *
 *   D_r = bias + slope·(H_r(x, z) − y)                  base height field
 *       + noiseWeight · ridged(p')                         shared ridged pillars / bumps
 *       + layerAmplitude · layer(p') + erosionAmplitude · erosion(p')
 *       + hardFloor(y, floorHeight ± floorUndulation) + ceiling(y, ceilingHeight ± ceilingUndulation)
 *       + extra_r(p')                                      region-only 3D terms (caves, boulders)
 *
 * and the field is D = Σ_r w_r(x, z) · D_r — exact parameter interpolation across
 * the ~15–20-unit blend band (all terms are linear in their parameters), with
 * conservative per-y bounds = union of the regions' bounds.
 *
 * Reef forest reproduces the pre-region terrain exactly (bias 0, slope 1, H = 2.99).
 */
import { REGION_COUNT } from "./regions";

export type RegionParams = {
  bias: number;
  slope: number;
  /** Constant part of H (the iso surface of the base term sits near y = H − (8 − bias)/slope). */
  height: number;
  noiseWeight: number;
  layerAmplitude: number;
  erosionAmplitude: number;
  warpStrength: number;
  floorHeight: number;
  floorUndulation: number;
  ceilingHeight: number;
  ceilingUndulation: number;
  /** Sand: elongated low dunes added to H. */
  dunes?: { amp: number; freqX: number; freqZ: number; swell: number };
  /**
   * Sand: sparse rounded boulders — at most one per `cell`² (probability `chance`),
   * each a y-rotated ellipsoid (radius rMin…rMax, height ratio flatMin…flatMax ≤ 1.2)
   * sunk `sink`·ry into the sand, roughened by the erosion octave (`bump`), and
   * merged with the floor by a smooth max (fillet `k`). `gain` = density per unit.
   */
  boulders?: {
    cell: number;
    chance: number;
    rMin: number;
    rMax: number;
    flatMin: number;
    flatMax: number;
    sink: number;
    bump: number;
    gain: number;
    k: number;
  };
  /**
   * Canyon: H = top ± topVar − depth·trench(u), trench from 1D-ish stretched noise
   * along a per-site axis; |n| < floorHalf → flat floor, wall over wallRun (noise units).
   */
  canyon?: {
    top: number;
    topVar: number;
    depth: number;
    across: number;
    along: number;
    floorHalf: number;
    wallRun: number;
    branch: number;
    jag: number;
  };
  /** Terraces: smooth staircase of a warped low-frequency field (thick plateaus, rounded rims). */
  terrace?: {
    base: number;
    stepMin: number;
    stepMax: number;
    levelMid: number;
    levelAmp: number;
    levelDetail: number;
    freq: number;
    rim: number;
    tilt: number;
    bumps: number;
    warp: number;
  };
  /** Caves: spaghetti tunnels (two zero-sets intersecting) ∪ blob chambers carved from solid rock. */
  caves?: {
    carve: number;
    tubeFreq: number;
    tubeWidth: number;
    ySquash: number;
    chamberFreq: number;
    chamberLevel: number;
    /** Carving fades to 0 below yMin / above yMax over `edge` units. */
    yMin: number;
    yMax: number;
    edge: number;
  };
};

const BASE: RegionParams = {
  bias: 0,
  slope: 1,
  height: 2.99, // −floorOffset + layerBias of the reference field
  noiseWeight: 11.24,
  layerAmplitude: 1.1,
  erosionAmplitude: 0.9,
  warpStrength: 2.4,
  floorHeight: -7,
  floorUndulation: 2.5,
  ceilingHeight: 14,
  ceilingUndulation: 3,
};

export const REGION_PARAMS: readonly RegionParams[] = [
  // 0 sand plains — broad gentle floor ≈ y −3.5, low dunes, sparse boulders, open water above
  {
    ...BASE,
    height: 4.3,
    noiseWeight: 1.1,
    layerAmplitude: 0,
    erosionAmplitude: 0.3,
    warpStrength: 1.6,
    dunes: { amp: 0.7, freqX: 0.05, freqZ: 0.018, swell: 1.1 },
    boulders: { cell: 17, chance: 0.45, rMin: 1.5, rMax: 4.4, flatMin: 0.85, flatMax: 1.15, sink: 0.15, bump: 0.9, gain: 1.8, k: 0.5 },
  },
  // 1 reef forest — the previous terrain (pillars and arches at varied heights)
  { ...BASE },
  // 2 canyon belt — thick plateau (top ≈ y 5) cut by long, deep, coherent trenches
  {
    ...BASE,
    height: 0,
    noiseWeight: 3.2,
    layerAmplitude: 0,
    erosionAmplitude: 1.1,
    warpStrength: 1.8,
    canyon: { top: 10, topVar: 1.6, depth: 11.5, across: 1 / 36, along: 1 / 190, floorHalf: 0.045, wallRun: 0.08, branch: 0.8, jag: 2.2 },
  },
  // 3 cave warren — solid rock with connected tunnels and chambers
  {
    ...BASE,
    bias: 13,
    slope: 0.1,
    height: 1,
    noiseWeight: 2.2,
    layerAmplitude: 0,
    erosionAmplitude: 1.0,
    warpStrength: 2.4,
    caves: { carve: 17, tubeFreq: 0.045, tubeWidth: 0.3, ySquash: 1.6, chamberFreq: 0.03, chamberLevel: 0.3, yMin: -8, yMax: 12, edge: 3 },
  },
  // 4 cliff terraces — thick plateaus with rounded rims, steep cliffs between, varied heights
  {
    ...BASE,
    height: 0,
    noiseWeight: 1.2,
    layerAmplitude: 0,
    erosionAmplitude: 0.8,
    warpStrength: 1.8,
    terrace: { base: 4, stepMin: 3.3, stepMax: 4.8, levelMid: 1.35, levelAmp: 1.2, levelDetail: 0.3, freq: 0.017, rim: 0.045, tilt: 2.2, bumps: 1.0, warp: 11 },
  },
  // 5 deep trench — the reef style sunk ~18 units, sparser pillars, hard floor at y ≈ −25
  {
    ...BASE,
    height: 2.99 - 20,
    noiseWeight: 9,
    layerAmplitude: 0.6,
    floorHeight: -25,
  },
];

if (REGION_PARAMS.length !== REGION_COUNT) throw new Error("REGION_PARAMS must cover every region");
