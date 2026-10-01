/**
 * Region field queries beyond a point sample (regions.ts): the conservative
 * region mask of a rectangle (per-column density bounds) and the cores of a region.
 */
import { MACRO, type RegionSample } from "./regionTypes";
import type { SiteGrid } from "./regionSites";

  /**
   * Regions with non-zero weight anywhere in [x0,x1]×[z0,z1]. Site i can only have
   * weight where h_i(q) = max_j (signed distance of q past the bisector of (i, j),
   * on j's side) < band/2 (its factor for j vanishes beyond). Each term is a
   * distance to a fixed line, so h_i is 1-Lipschitz in warped space, and the warp
   * is (1 + L)-Lipschitz: a grid with step h and the threshold inflated by
   * (1 + L)·h·√2/2 cannot miss a region. Using only some j (the sites near the
   * nearest) under-estimates h_i, which keeps the test conservative.
   */
export function createMaskInRect(grid: SiteGrid): (x0: number, z0: number, x1: number, z1: number) => number {
  const { site, mX, mZ, mR, warpX, warpZ } = grid;
  const G = MACRO.cell;
  const B = MACRO.band;
  const mdist = new Float64Array(25);
  const msx = new Float64Array(25);
  const msz = new Float64Array(25);
  const mreg = new Int8Array(25);
  return (x0: number, z0: number, x1: number, z1: number) => {
    const h = 2.5;
    const L = MACRO.warpAmp * MACRO.warpFreq * 7; // |∇ simplex| < 7 per noise unit (measured max ≈ 6.9)
    const slack = (1 + L) * h * Math.SQRT1_2 + 0.25;
    const lim = B / 2 + slack;
    const nx = Math.max(1, Math.ceil((x1 - x0) / h)), nz = Math.max(1, Math.ceil((z1 - z0) / h));
    let mask = 0;
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = x0 + ((x1 - x0) * ix) / nx, z = z0 + ((z1 - z0) * iz) / nz;
        const qx = warpX(x, z), qz = warpZ(x, z);
        const gx = Math.floor(qx / G), gz = Math.floor(qz / G);
        let dmin = Infinity;
        let n = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const sl = site(gx + dx, gz + dz);
          const d = Math.hypot(mX[sl] - qx, mZ[sl] - qz);
          mdist[n] = d;
          msx[n] = mX[sl];
          msz[n] = mZ[sl];
          mreg[n] = mR[sl];
          if (d < dmin) dmin = d;
          n++;
        }
        for (let i = 0; i < n; i++) {
          if (mask & (1 << mreg[i])) continue;
          // necessary condition first (t ≥ Δd / 2), then the bisector test
          if (mdist[i] - dmin >= 2 * lim) continue;
          let hi = 0;
          const di2 = mdist[i] * mdist[i];
          for (let j = 0; j < n && hi < lim; j++) {
            if (j === i || mdist[j] - dmin >= 2 * lim) continue;
            const lx = msx[j] - msx[i], lz = msz[j] - msz[i];
            const past = (di2 - mdist[j] * mdist[j]) / (2 * Math.sqrt(lx * lx + lz * lz));
            if (past > hi) hi = past;
          }
          if (hi < lim) mask |= 1 << mreg[i];
        }
      }
    }
    return mask;
  };
}

  /**
   * Cores of region `r`, nearest the origin first: each site of r (mapped back
   * through the warp by fixed-point iteration p = s − warp(p)) refined to the
   * point of maximum border distance within ±36 units that is still in r.
   */
export function createCoresOf(grid: SiteGrid, sample: (x: number, z: number, out: RegionSample) => RegionSample, tmp: RegionSample) {
  const { site, mX, mZ, mR, warpX, warpZ } = grid;
  return (r: number, max: number) => {
    const found: { d: number; x: number; z: number }[] = [];
    for (let R = 3; R <= 48 && found.length < max; R *= 2) {
      found.length = 0;
      for (let cz = -R; cz <= R; cz++) for (let cx = -R; cx <= R; cx++) {
        const sl = site(cx, cz);
        if (mR[sl] !== r) continue;
        const sx = mX[sl], sz = mZ[sl];
        let px = sx, pz = sz;
        for (let it = 0; it < 16; it++) {
          const nx = sx - (warpX(px, pz) - px);
          const nz = sz - (warpZ(px, pz) - pz);
          px = nx;
          pz = nz;
        }
        found.push({ d: Math.hypot(px, pz), x: px, z: pz });
      }
    }
    found.sort((p, q) => p.d - q.d);
    return found.slice(0, max).map((c) => {
      let bx = c.x, bz = c.z, be = -1;
      for (let dz = -36; dz <= 36; dz += 6) for (let dx = -36; dx <= 36; dx += 6) {
        const s = sample(c.x + dx, c.z + dz, tmp);
        if (s.id !== r) continue;
        if (s.edge > be + 1e-9) {
          be = s.edge;
          bx = c.x + dx;
          bz = c.z + dz;
        }
      }
      return { x: bx, z: bz, edge: Math.max(0, be) };
    });
  };
}
