/**
 * Collision field that matches the drawn level-0 mesh.
 *
 * Marching cubes places the surface by linear interpolation between level-0
 * lattice points, so on the 1 u lattice the mesh can sit up to ~0.3 u (p99) away
 * from the analytic surface — twice the diver's collider. This sampler returns the
 * trilinear interpolation of the density at the 8 surrounding lattice points,
 * which on every cell edge equals what the mesher interpolated (and inside a cell
 * is the natural continuation), so the diver touches the rock it sees.
 *
 * It needs no mesh: corner values come from the analytic field (field.sample, as
 * level 0 meshes it) and are cached per lattice point. Removed floating rock is
 * applied per corner exactly as the mesher does (removed points → min(v, iso − 1)),
 * through `isRemovedPoint` (global lattice indices; the chunk manager answers from
 * the level-0 columns it has built).
 */
import type { DensityField } from "./density";
import { latticeSpacing } from "./mesher";

export type RemovedPoint = (gi: number, gj: number, gk: number) => boolean;

export interface LatticeSampler {
  /** Trilinear density at (x, y, z) from the level-0 lattice corners. */
  sample(x: number, y: number, z: number): number;
  /** Drop cached corner values. */
  clear(): void;
}

const OFF = 1 << 17; // lattice index offset: keys stay exact below 2^49
const SPAN = 1 << 18;

export function createLatticeSampler(field: DensityField, isRemovedPoint: RemovedPoint = () => false, capacity = 8192): LatticeSampler {
  const s = field.settings;
  const iso = s.isoLevel;
  const sp = latticeSpacing(field);
  const h = s.boundsSize / 2;
  const cache = new Map<number, number>();
  const corner = (gi: number, gj: number, gk: number): number => {
    const key = ((gi + OFF) * SPAN + (gk + OFF)) * 8192 + (gj + 4096);
    let v = cache.get(key);
    if (v === undefined) {
      if (cache.size >= capacity) cache.clear();
      v = field.sample(-h + gi * sp, -h + gj * sp, -h + gk * sp);
      cache.set(key, v);
    }
    return v >= iso && isRemovedPoint(gi, gj, gk) ? Math.min(v, iso - 1) : v;
  };
  return {
    sample(x, y, z) {
      const fx = (x + h) / sp, fy = (y + h) / sp, fz = (z + h) / sp;
      const gi = Math.floor(fx), gj = Math.floor(fy), gk = Math.floor(fz);
      const tx = fx - gi, ty = fy - gj, tz = fz - gk;
      const c000 = corner(gi, gj, gk), c100 = corner(gi + 1, gj, gk);
      const c010 = corner(gi, gj + 1, gk), c110 = corner(gi + 1, gj + 1, gk);
      const c001 = corner(gi, gj, gk + 1), c101 = corner(gi + 1, gj, gk + 1);
      const c011 = corner(gi, gj + 1, gk + 1), c111 = corner(gi + 1, gj + 1, gk + 1);
      const a0 = c000 + (c100 - c000) * tx, a1 = c010 + (c110 - c010) * tx;
      const b0 = c001 + (c101 - c001) * tx, b1 = c011 + (c111 - c011) * tx;
      const a = a0 + (a1 - a0) * ty, b = b0 + (b1 - b0) * ty;
      return a + (b - a) * tz;
    },
    clear() {
      cache.clear();
    },
  };
}
