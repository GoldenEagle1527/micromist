/**
 * Synthetic density fields for the ground-probe tests: a floor plane
 * (height a + b·x + c·z) with optional bumps, a pit, a ceiling and a region
 * weight — solid where density ≥ 0. Only what GroundProbe reads is provided.
 */
import type { DensityField } from "../../src/games/deep-march/terrain/density";
import type { RegionSample } from "../../src/games/deep-march/terrain/regions";

export type FakeGround = {
  slopeDeg?: number;
  /** Box bumps: centre, half-size (m) and height above the floor. */
  bumps?: { x: number; z: number; half: number; h: number }[];
  /** Pit at the origin: radius and depth. */
  pit?: { r: number; depth: number };
  /** Rock above this height. */
  ceiling?: number;
  dominant?: number;
};

export function fakeField(g: FakeGround): DensityField {
  const t = Math.tan(((g.slopeDeg ?? 0) * Math.PI) / 180);
  const floor = (x: number, z: number) => {
    let y = x * t;
    for (const b of g.bumps ?? []) if (Math.abs(x - b.x) <= b.half && Math.abs(z - b.z) <= b.half) y += b.h;
    if (g.pit && Math.hypot(x, z) < g.pit.r) y -= g.pit.depth;
    return y;
  };
  const sample = (x: number, y: number, z: number) => Math.max(floor(x, z) - y, g.ceiling !== undefined ? y - g.ceiling : -Infinity);
  const regions = {
    sample: (_x: number, _z: number, out: RegionSample) => {
      out.dominant = g.dominant ?? 1;
      return out;
    },
  };
  return { settings: { isoLevel: 0 }, sample, regions } as unknown as DensityField;
}
