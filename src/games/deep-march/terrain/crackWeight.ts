/**
 * Crack darkness weight per vertex (design doc §4.4 / §4.5; the slits of wallSlit.ts):
 * how far past the lit lip of a slit a vertex sits, baked by the mesher into the
 * region weights' spare byte (regionWeights.ts, byte 7 → the chaos seabed program's
 * aChaos, which turns those surfaces black) — no extra bandwidth, the same value at
 * every LOD (a pure function of the vertex position).
 *
 *   inset = sd + face(s, y)                     how far behind the inner face
 *   w     = smoothstep((inset − shell) / dark)  0 on the face and the lip, 1 beyond
 *
 * Behind the face there is rock everywhere but inside a cut (and the outer face, only
 * ever seen through one), so only what lies past a slit's lip goes dark: the slit
 * opens onto nothing. Null without open cracks: the bytes stay 0 and the mesher does
 * no extra work.
 */
import { WALL_SHAPE } from "./wallConfig";
import { WALL_UNIT, type WallShape } from "./wallGeometry";

export type CrackWeight = (x: number, y: number, z: number) => number;

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** invS = 1 / worldScale (world position → base units, like the density field). */
export function createCrackWeight(shape: WallShape, invS: number): CrackWeight | null {
  if (shape.slits.count === 0) return null;
  const shell = WALL_SHAPE.slitShell / WALL_UNIT, dark = WALL_SHAPE.slitDark / WALL_UNIT;
  const loc = new Float64Array(2);
  return (x, y, z) => {
    shape.locate(x * invS, z * invS, loc);
    return smooth01((loc[0] + shape.face(loc[1], y * invS) - shell) / dark);
  };
}
