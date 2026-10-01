/** Small shared shaping functions of the density field (density.ts). */
import type { RegionParams } from "./regionParams";

export const TAU = Math.PI * 2;
/** Simplex output bound used for conservative bounds. */
export const NB = 1.05;

/** C1 ramp: 0 for u ≤ 0, quadratic over [0, b], then linear with slope 1. */
export function ramp(u: number, b: number): number {
  if (u <= 0) return 0;
  if (u < b) return (u * u) / (2 * b);
  return u - b / 2;
}

export function smooth01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Vertical extent of cave carving: 1 between yMin and yMax, C1 falloff over `edge`. */
export function caveEnvelope(c: NonNullable<RegionParams["caves"]>, y: number): number {
  return smooth01((y - c.yMin) / c.edge) * smooth01((c.yMax - y) / c.edge);
}
