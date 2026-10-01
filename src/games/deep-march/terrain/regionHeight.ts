/**
 * Region base heights H_r (density.ts): dunes, branching canyons and seeded
 * terraces on top of each region's base height, plus conservative [min, max]
 * ranges of every H_r over all (x, z) for the field's bounds.
 */
import { NB, smooth01 } from "./densityMath";
import type { DensityCore } from "./densityCore";

export type RegionHeight = {
  /** Region base height H_r at (x, z); `siteHash` orients per-site shapes (canyon axis). */
  height: (r: number, x: number, z: number, siteHash: number) => number;
  /** Conservative [min, max] of H_r over all (x, z), per region. */
  hRange: [number, number][];
};

export function createRegionHeight(core: DensityCore): RegionHeight {
  const { params, snoise, ro, terraceSteps, terraceCum } = core;
  /** Region base height H_r at (x, z); `siteHash` orients per-site shapes (canyon axis). */
  const height = (r: number, x: number, z: number, siteHash: number): number => {
    const p = params[r];
    let H = p.height;
    if (p.dunes) {
      const d = p.dunes;
      H += d.amp * snoise(x * d.freqX + ro[0], ro[1], z * d.freqZ + ro[2]) + d.swell * snoise(x * 0.012 + ro[3], ro[4], z * 0.012 + ro[5]);
    }
    if (p.canyon) {
      const c = p.canyon;
      const th = siteHash * Math.PI;
      const cs = Math.cos(th), sn = Math.sin(th);
      // small 2D jag so walls are not perfectly smooth sheets
      const jx = x + c.jag * snoise(x * 0.09 + ro[6], ro[7], z * 0.09);
      const jz = z + c.jag * snoise(x * 0.09, ro[8], z * 0.09 + ro[9]);
      const u = jx * cs + jz * sn;
      const v = -jx * sn + jz * cs;
      const n1 = snoise(u * c.across + ro[10], v * c.along + ro[11], ro[12]);
      const n2 = snoise(u * c.across * 1.8 + ro[13], v * c.along * 1.5 + ro[14], ro[15]);
      const t1 = 1 - smooth01((Math.abs(n1) - c.floorHalf) / c.wallRun);
      const t2 = 1 - smooth01((Math.abs(n2) - c.floorHalf * 0.7) / c.wallRun);
      const t = 1 - (1 - t1) * (1 - c.branch * t2);
      H += c.top + c.topVar * snoise(x * 0.02 + ro[16], ro[17], z * 0.02) - c.depth * t;
    }
    if (p.terrace) {
      const t = p.terrace;
      const wx = x + t.warp * snoise(x * 0.025 + ro[18], ro[19], z * 0.025);
      const wz = z + t.warp * snoise(x * 0.025, ro[20], z * 0.025 + ro[21]);
      const lv =
        t.levelMid +
        t.levelAmp * snoise(wx * t.freq + ro[22], ro[23], wz * t.freq) +
        t.levelDetail * snoise(wx * t.freq * 3.7, ro[24], wz * t.freq * 3.7 + ro[25]);
      const level = Math.floor(lv);
      const f = lv - level;
      const li = Math.min(15, Math.max(0, level + 4));
      const st = smooth01((f - (0.5 - t.rim)) / (2 * t.rim));
      H +=
        8 - t.base + terraceCum[li] + terraceSteps[li] * st +
        t.tilt * snoise(x * 0.018 + ro[26], ro[27], z * 0.018) +
        t.bumps * snoise(x * 0.09 + ro[28], ro[29], z * 0.09);
    }
    return H;
  };
  /** Conservative [min, max] of H_r over all (x, z). */
  const heightRange = (r: number): [number, number] => {
    const p = params[r];
    let lo = p.height, hi = p.height;
    if (p.dunes) {
      const a = (p.dunes.amp + p.dunes.swell) * NB;
      lo -= a;
      hi += a;
    }
    if (p.canyon) {
      const c = p.canyon;
      lo += c.top - c.topVar * NB - c.depth;
      hi += c.top + c.topVar * NB;
    }
    if (p.terrace) {
      const t = p.terrace;
      const lvLo = t.levelMid - (t.levelAmp + t.levelDetail) * NB;
      const lvHi = t.levelMid + (t.levelAmp + t.levelDetail) * NB;
      const i0 = Math.min(15, Math.max(0, Math.floor(lvLo) + 4));
      const i1 = Math.min(15, Math.max(0, Math.floor(lvHi) + 4));
      const w = (t.tilt + t.bumps) * NB;
      lo += 8 - t.base + terraceCum[i0] - w;
      hi += 8 - t.base + terraceCum[i1 + 1] + w;
    }
    return [lo, hi];
  };
  const hRange = params.map((_, r) => heightRange(r));
  return { height, hRange };
}
