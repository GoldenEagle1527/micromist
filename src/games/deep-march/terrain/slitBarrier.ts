/**
 * The diver cannot swim into a crack (playtest: a slit through a thin shell, darkness
 * beyond, never passable). The cut behind a slit's face is water (wallSlit.ts), so the
 * rock alone would let the diver in; this is the invisible pane across the opening:
 * inside a slit's lens (lateral < margin) the diver is held `margin` m in front of the
 * face plane, pushed back along the outline's inward normal, the outward speed removed.
 * Everywhere else the wall's rock and the world rectangle stop the diver as before.
 */
import type { DensityField } from "./density";

type Vec = { x: number; y: number; z: number };

/** Returns the outward speed removed (0 = untouched). */
export type SlitBarrier = (p: Vec, v: Vec) => number;

/** The field's slit barrier (null without open cracks); margin in world units. */
export function createSlitBarrier(field: DensityField, margin: number): SlitBarrier | null {
  const shape = field.wall?.shape;
  if (!shape || shape.slits.count === 0) return null;
  const S = field.settings.worldScale, invS = 1 / S, mb = margin * invS;
  const loc = new Float64Array(2), pt = new Float64Array(4);
  return (p, v) => {
    shape.locate(p.x * invS, p.z * invS, loc);
    const yb = p.y * invS;
    const over = loc[0] + shape.face(loc[1], yb) + mb;
    if (over <= 0 || shape.slits.lateral(loc[1], yb) >= mb) return 0;
    shape.point(loc[1], 0, pt);
    const nx = pt[2], nz = pt[3];
    p.x -= nx * over * S;
    p.z -= nz * over * S;
    const vn = v.x * nx + v.z * nz;
    if (vn <= 0) return 0;
    v.x -= nx * vn;
    v.z -= nz * vn;
    return vn;
  };
}
