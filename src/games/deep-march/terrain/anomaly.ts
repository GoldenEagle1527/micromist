/**
 * 异常地形 (design doc §4.2 渗入, §4.5): around every open crack the generation's
 * terrain is wrong — baked into the density field (the tide builds each
 * generation's field from its layout; nothing changes during a generation, D11):
 *
 *   k(x, z) = strength · smoothstep(1 − d / R)    d = distance to the crack's mouth
 *                                                 along the ring and inward; 0 exactly
 *                                                 beyond R = 300 m
 *   warp    W → W · (1 + 2k)                      wilder, twisted rock
 *   strata  layer → layer · (1 − 2k)              the layering flattens, then inverts
 *   barbs   ceiling noise pulled down / floor     barbs hanging from the rock ceiling,
 *           noise pushed up in hashed cones       spikes rising from the floor
 *
 * Every change keeps each term inside the range the density's conservative bounds
 * already assume (the warp only moves where bounded noise is sampled; |layer| does
 * not grow; the barbs only move the undulation noise within [−NB, NB]), so brick
 * skipping and row bounds stay valid, and the WASM path gets the same W (bit-exact
 * with JS). Strength 0 / no crack: null, the field is untouched bit for bit. R is
 * below the crack's 600 m − 120 m clearance from the base: the frozen zone never sees it.
 * Base units (like the density's ctx); metres in ANOMALY.
 */
import { WALL_UNIT, type WallShape, type WallSpec } from "./wallGeometry";

export const ANOMALY = {
  /** Reach around a crack's mouth (m). */
  radius: 300,
  /** Domain-warp gain at k = 1 (design: W × (1 + 2χ_l)). */
  warp: 2,
  /** Barb cells (m), the share of cells with a barb, barb base radius (m), floor spikes' share of the ceiling barbs' reach. */
  cell: 44,
  chance: 0.7,
  barbRadius: 13,
  floorShare: 0.6,
} as const;

export type Anomaly = {
  /** k at a base-unit (x, z): 0 … strength, exactly 0 beyond the reach of every crack. */
  weight: (x: number, z: number) => number;
  /** Ceiling undulation noise n ∈ [−nb, nb] with the barbs (pulled toward −nb: lower rock). */
  ceiling: (x: number, z: number, n: number, k: number, nb: number) => number;
  /** Floor undulation noise with the spikes (pushed toward +nb: higher floor). */
  floor: (x: number, z: number, n: number, k: number, nb: number) => number;
  /** Strata factor at weight k (1 → −1). */
  strata: (k: number) => number;
};

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function hash01(seed: number, i: number, j: number, salt: number): number {
  let h = (seed ^ 0x3b9ac9ff ^ Math.imul(salt, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ i, 0x85ebca6b) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) ^ j, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The generation's anomaly, or null (no strength, no open crack). */
export function createAnomaly(shape: WallShape, spec: WallSpec, seed: number): Anomaly | null {
  const strength = Math.min(1, spec.anomaly ?? 0);
  if (!(strength > 0) || spec.cracks.length === 0) return null;
  const U = WALL_UNIT, R = ANOMALY.radius / U, P = shape.perimeter;
  const mouths = spec.cracks.map((c) => (((c.s / U) % P) + P) % P);
  const loc = new Float64Array(2);
  const C = ANOMALY.cell / U, r = ANOMALY.barbRadius / U, margin = Math.min(0.45, r / C);

  const weight = (x: number, z: number): number => {
    shape.locate(x, z, loc);
    const inward = loc[0] < 0 ? -loc[0] : 0;
    if (inward >= R) return 0;
    let along = Infinity;
    for (const s of mouths) {
      const ds = Math.abs(loc[1] - s);
      along = Math.min(along, ds > P / 2 ? P - ds : ds);
    }
    const d = Math.hypot(along, inward);
    return d >= R ? 0 : strength * smooth01(1 - d / R);
  };

  /** A cone 1 at its tip, 0 at its rim (t², C1 at the rim), one per hashed cell. */
  const barb = (x: number, z: number, salt: number): number => {
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    if (hash01(seed, gx, gz, salt) >= ANOMALY.chance) return 0;
    const px = (gx + margin + (1 - 2 * margin) * hash01(seed, gx, gz, salt + 1)) * C;
    const pz = (gz + margin + (1 - 2 * margin) * hash01(seed, gx, gz, salt + 2)) * C;
    const t = 1 - Math.hypot(x - px, z - pz) / r;
    return t > 0 ? t * t : 0;
  };

  return {
    weight,
    ceiling: (x, z, n, k, nb) => n - (n + nb) * k * barb(x, z, 11),
    floor: (x, z, n, k, nb) => n + (nb - n) * k * ANOMALY.floorShare * barb(x, z, 23),
    strata: (k) => 1 - 2 * k,
  };
}
