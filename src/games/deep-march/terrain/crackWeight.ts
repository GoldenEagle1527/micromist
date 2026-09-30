/**
 * Crack glow weight per vertex (MVP plan M8, design doc §4.4 / §4.5): how deep a
 * vertex sits inside an open crack's notch, baked by the mesher into the region
 * weights' spare byte (regionWeights.ts, byte 7 → the chaos seabed program's
 * aChaos) — no extra bandwidth, the same value at every LOD (a pure function of
 * the vertex position).
 *
 *   inset = sd + facet(s, y)        how far behind the uncracked inner face (≥ 0 in a notch)
 *   w     = max_i notch_i(s, y) · min(1, inset / depth_i)
 *
 * 1 on the notch's deepest line (its "membrane", the pale light behind it), falling
 * to 0 at the mouth and outside the opening. Null without open cracks: the bytes
 * stay 0 and the mesher does no extra work.
 */
import type { WallShape } from "./wallGeometry";

export type CrackWeight = (x: number, y: number, z: number) => number;

/** invS = 1 / worldScale (world position → base units, like the density field). */
export function createCrackWeight(shape: WallShape, invS: number): CrackWeight | null {
  if (shape.notches === 0) return null;
  const loc = new Float64Array(2);
  return (x, y, z) => {
    shape.locate(x * invS, z * invS, loc);
    const s = loc[1], yb = y * invS;
    const inset = loc[0] + shape.facet(s, yb);
    if (inset <= 0) return 0;
    let w = 0;
    for (let i = 0; i < shape.notches; i++) {
      const p = shape.notch(i, s, yb);
      if (p <= 0) continue;
      const v = p * Math.min(1, inset / Math.max(1e-6, shape.notchDepth(i)));
      if (v > w) w = v;
    }
    return w;
  };
}
