/**
 * Region weights at a point (regions.ts sample): pairwise bisector partition of
 * unity over the sites around the warped point, the blended site bias, the
 * dominant region and the exact distance to the nearest region border.
 */
import type { SiteLayout } from "./siteLayout";
import { MACRO, REGION_COUNT, type RegionSample } from "./regionTypes";
import type { SiteGrid } from "./regionSites";

function smooth01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function createRegionBlend(grid: SiteGrid, layout: SiteLayout | null): (x: number, z: number, out: RegionSample) => RegionSample {
  const { site, mX, mZ, mR, mH, mB, warpX, warpZ } = grid;
  const G = MACRO.cell;
  const B = MACRO.band;
  const dist = new Float64Array(25);
  const reg = new Int8Array(25);
  const hs = new Float64Array(25);
  const bs = new Float64Array(25);
  const sxs = new Float64Array(25);
  const szs = new Float64Array(25);
  const cand = new Int32Array(25);
  const near = new Int32Array(25);
  const HB = B / 2;
  return (x: number, z: number, out: RegionSample): RegionSample => {
    const qx = warpX(x, z), qz = warpZ(x, z);
    const gx = Math.floor(qx / G), gz = Math.floor(qz / G);
    let n = 0;
    let dmin = Infinity, imin = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const sl = site(gx + dx, gz + dz);
        const ddx = mX[sl] - qx, ddz = mZ[sl] - qz;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        dist[n] = d;
        reg[n] = mR[sl];
        hs[n] = mH[sl];
        bs[n] = mB[sl];
        sxs[n] = mX[sl];
        szs[n] = mZ[sl];
        if (d < dmin) {
          dmin = d;
          imin = n;
        }
        n++;
      }
    }
    // Candidates (Δd < B) and the sites that can still shape their weights (Δd < 2B).
    let nc = 0, nn = 0;
    for (let i = 0; i < n; i++) {
      const dd = dist[i] - dmin;
      if (dd < B) cand[nc++] = i;
      if (dd < 2 * B) near[nn++] = i;
    }
    out.w.fill(0);
    let sum = 0;
    out.sites = 0;
    let bias = 0;
    for (let a = 0; a < nc; a++) {
      const i = cand[a];
      const di2 = dist[i] * dist[i];
      let w = 1;
      for (let b = 0; b < nn && w > 0; b++) {
        const j = near[b];
        if (j === i) continue;
        const lx = sxs[j] - sxs[i], lz = szs[j] - szs[i];
        // signed distance from the bisector of (i, j), positive on i's side
        const t = (dist[j] * dist[j] - di2) / (2 * Math.sqrt(lx * lx + lz * lz));
        if (t >= HB) continue;
        w *= smooth01(0.5 + t / B);
      }
      if (w <= 0) continue;
      out.siteW[out.sites] = w;
      out.siteRegion[out.sites] = reg[i];
      out.siteHash[out.sites] = hs[i];
      out.sites++;
      out.w[reg[i]] += w;
      sum += w;
      bias += w * bs[i];
    }
    let best = 0;
    for (let r = 0; r < REGION_COUNT; r++) {
      out.w[r] /= sum;
      if (out.w[r] > out.w[best]) best = r;
    }
    for (let i = 0; i < out.sites; i++) out.siteW[i] /= sum;
    out.bias = layout ? bias / sum : 0;
    out.id = best;
    out.dominant = out.w[best];
    // exact distance (warped space) to the nearest bisector with a site of another region
    const r0 = reg[imin];
    let edge = Infinity;
    const d02 = dmin * dmin;
    for (let j = 0; j < n; j++) {
      if (reg[j] === r0) continue;
      const lx = sxs[j] - sxs[imin], lz = szs[j] - szs[imin];
      const t = (dist[j] * dist[j] - d02) / (2 * Math.sqrt(lx * lx + lz * lz));
      if (t < edge) edge = t;
    }
    out.edge = Math.min(255, Math.max(0, edge));
    return out;
  };
}
