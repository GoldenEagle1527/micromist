/**
 * Region sites (regions.ts): one seeded site per `cell`-sized grid cell (jittered
 * inside the cell; explicit layout sites inside a bounded world), memoised per
 * cell, and the low-frequency domain warp the sites are found around.
 */
import { createSimplex3, mulberry32 } from "./noise";
import { layoutIndex, type SiteLayout } from "./siteLayout";
import { MACRO, REGION_WEIGHTS } from "./regionTypes";

export function regionHash(seed: number, a: number, b: number, c: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h / 4294967296;
}

export type SiteGrid = ReturnType<typeof createSiteGrid>;

export function createSiteGrid(seed: number, layout: SiteLayout | null) {
  const noise = createSimplex3(seed ^ 0x51ab7e3);
  const rnd = mulberry32(seed ^ 0x77ac31);
  const ox = rnd() * 512, oz = rnd() * 512, oy = rnd() * 512;
  const G = MACRO.cell;
  const J = MACRO.jitter;
  const cum: number[] = [];
  let tot = 0;
  for (const w of REGION_WEIGHTS) cum.push((tot += w));
  const regionOfSite = (cx: number, cz: number) => {
    const r = regionHash(seed, cx, cz, 21) * tot;
    for (let i = 0; i < cum.length; i++) if (r < cum[i]) return i;
    return cum.length - 1;
  };
  // Direct-mapped memo of per-cell site data (x, z, region, hash).
  const MEMO = 1024;
  const mCx = new Int32Array(MEMO).fill(0x7fffffff);
  const mCz = new Int32Array(MEMO);
  const mX = new Float64Array(MEMO);
  const mZ = new Float64Array(MEMO);
  const mR = new Int8Array(MEMO);
  const mH = new Float64Array(MEMO);
  const mB = new Float64Array(MEMO);
  const site = (cx: number, cz: number): number => {
    const slot = (Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77)) >>> 22;
    if (mCx[slot] !== cx || mCz[slot] !== cz) {
      mCx[slot] = cx;
      mCz[slot] = cz;
      const li = layout ? layoutIndex(layout, cx, cz) : -1;
      if (li >= 0) {
        mX[slot] = (cx + (1 - J) / 2 + J * layout!.jx[li]) * G;
        mZ[slot] = (cz + (1 - J) / 2 + J * layout!.jz[li]) * G;
        mR[slot] = layout!.region[li];
        mH[slot] = layout!.hash[li];
        mB[slot] = layout!.bias[li];
      } else {
        mX[slot] = (cx + (1 - J) / 2 + J * regionHash(seed, cx, cz, 11)) * G;
        mZ[slot] = (cz + (1 - J) / 2 + J * regionHash(seed, cx, cz, 12)) * G;
        mR[slot] = regionOfSite(cx, cz);
        mH[slot] = regionHash(seed, cx, cz, 31);
        mB[slot] = 0;
      }
    }
    return slot;
  };
  const warpX = (x: number, z: number) => x + MACRO.warpAmp * noise(x * MACRO.warpFreq + ox, oy, z * MACRO.warpFreq);
  const warpZ = (x: number, z: number) => z + MACRO.warpAmp * noise(x * MACRO.warpFreq, oy + 37.1, z * MACRO.warpFreq + oz);
  return { site, mX, mZ, mR, mH, mB, warpX, warpZ };
}
