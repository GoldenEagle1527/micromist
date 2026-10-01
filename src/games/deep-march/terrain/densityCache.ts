/**
 * Per-(x, z) cache of the density field (density.ts): xz-only quantities — region
 * weights, H_r, floor / ceiling heights, warp strength, site bias, nearby sand
 * boulders and the ring wall's signed distance — computed once per (x, z), so a
 * column of samples pays for them once. Slots are hashed from the exact float
 * bits of (x, z) (base coordinates).
 */
import { REGION, REGION_COUNT, createRegionSample, type RegionField } from "./regions";
import type { DensityCore } from "./densityCore";
import type { RegionHeight } from "./regionHeight";
import { ANOMALY, type Anomaly } from "./anomaly";
import { NB } from "./densityMath";

const CACHE_BITS = 12;
const CACHE = 1 << CACHE_BITS;
const R6 = REGION_COUNT;

export type DensityCache = ReturnType<typeof createDensityCache>;

/** anomaly: chaos stage 3+ anomalous terrain near open cracks (null: none). */
export function createDensityCache(core: DensityCore, baseRegions: RegionField, { height }: RegionHeight, anomaly: Anomaly | null) {
  const { seed, s, params, snoise, ex, bP, sandIso, wallRef } = core;
  const fxz = s.undulationFrequency;
  const cX = new Float64Array(CACHE).fill(NaN);
  const cZ = new Float64Array(CACHE).fill(NaN);
  const cN = new Uint8Array(CACHE); // active regions
  const cReg = new Uint8Array(CACHE * R6);
  const cW = new Float64Array(CACHE * R6);
  const cH = new Float64Array(CACHE * R6);
  const cFh = new Float64Array(CACHE * R6);
  const cCh = new Float64Array(CACHE * R6);
  const cNa = new Float64Array(CACHE);
  const cNb = new Float64Array(CACHE);
  const cWarp = new Float64Array(CACHE);
  const cLayer = new Uint8Array(CACHE);
  const cBias = new Float64Array(CACHE); // Σ w_i δ_i (exactly 0 without a layout)
  // ring wall: the term is an exact identity for terrain values ≥ cWallTh (−∞: everywhere,
  // sd ≤ skipSd), signed distance to the outline and arc length
  const cWallTh = new Float64Array(CACHE).fill(-Infinity);
  const cWallSd = new Float64Array(CACHE);
  const cWallS = new Float64Array(CACHE);
  const wallLoc = new Float64Array(2);
  const cStrata = new Float64Array(CACHE).fill(1);
  // Sand boulders overlapping (x, z) (≤ 2 per slot): horizontal normalised distance²,
  // centre height, vertical radius, size scale.
  const cBN = new Uint8Array(CACHE);
  const cBH2 = new Float64Array(CACHE * 2);
  const cBCy = new Float64Array(CACHE * 2);
  const cBRy = new Float64Array(CACHE * 2);
  const cBR = new Float64Array(CACHE * 2);
  const rs = createRegionSample();
  const bhash = (a: number, b: number, c: number) => {
    let h = (seed ^ 0x68e31da4) >>> 0;
    h = Math.imul(h ^ a, 0x85ebca6b) >>> 0;
    h = Math.imul((h ^ (h >>> 13)) ^ b, 0xc2b2ae35) >>> 0;
    h = Math.imul((h ^ (h >>> 16)) ^ c, 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  /** Boulders of the cells around (x, z) whose footprint (plus fillet margin) covers it. */
  const boulderCtx = (slot: number, x: number, z: number) => {
    let n = 0;
    const b = bP!;
    const gx = Math.floor(x / b.cell), gz = Math.floor(z / b.cell);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx, cz = gz + dz;
      if (bhash(cx, cz, 1) >= b.chance) continue;
      const bx = (cx + 0.2 + 0.6 * bhash(cx, cz, 2)) * b.cell;
      const bz = (cz + 0.2 + 0.6 * bhash(cx, cz, 3)) * b.cell;
      const u = bhash(cx, cz, 4);
      const r = b.rMin + (b.rMax - b.rMin) * u;
      const rx = r * (0.8 + 0.4 * bhash(cx, cz, 5)), rz = r * (0.8 + 0.4 * bhash(cx, cz, 6));
      const ry = r * (b.flatMin + (b.flatMax - b.flatMin) * bhash(cx, cz, 7));
      const th = bhash(cx, cz, 8) * Math.PI;
      const c = Math.cos(th), sn = Math.sin(th);
      const ex_ = x - bx, ez = z - bz;
      const ux = (ex_ * c + ez * sn) / rx, uz = (-ex_ * sn + ez * c) / rz;
      const h2 = ux * ux + uz * uz;
      if (h2 >= 1.69) continue; // beyond 1.3 radii: no contribution even with the fillet
      const cy = height(REGION.SAND, bx, bz, 0) - sandIso - b.sink * ry;
      const rm = Math.cbrt(rx * ry * rz);
      let q = n;
      if (n === 2) {
        q = cBH2[slot * 2] > cBH2[slot * 2 + 1] ? 0 : 1;
        if (h2 >= cBH2[slot * 2 + q]) continue;
      } else n++;
      cBH2[slot * 2 + q] = h2;
      cBCy[slot * 2 + q] = cy;
      cBRy[slot * 2 + q] = ry;
      cBR[slot * 2 + q] = rm;
    }
    cBN[slot] = n;
  };
  const hsum = new Float64Array(R6);
  const fbits = new Float64Array(2);
  const ibits = new Int32Array(fbits.buffer);
  const slotOf = (x: number, z: number) => {
    fbits[0] = x;
    fbits[1] = z;
    let h = Math.imul(ibits[0] ^ ibits[1], 0x9e3779b1) ^ Math.imul(ibits[2] ^ ibits[3], 0x85ebca77);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    return (h >>> (32 - CACHE_BITS)) & (CACHE - 1);
  };
  let lastX = NaN, lastZ = NaN, lastSlot = 0;
  const ctx = (x: number, z: number): number => {
    if (x === lastX && z === lastZ) return lastSlot;
    const slot = slotOf(x, z);
    lastX = x;
    lastZ = z;
    lastSlot = slot;
    if (cX[slot] === x && cZ[slot] === z) return slot;
    baseRegions.sample(x, z, rs);
    hsum.fill(0);
    for (let i = 0; i < rs.sites; i++) {
      const r = rs.siteRegion[i];
      hsum[r] += rs.siteW[i] * height(r, x, z, rs.siteHash[i]);
    }
    const na = snoise(x * fxz + ex[9], ex[10], z * fxz + ex[11]);
    const nb = snoise(x * fxz * 0.7 + ex[12], ex[13], z * fxz * 0.7 + ex[14]);
    const ak = anomaly ? anomaly.weight(x, z) : 0;
    const fa = ak > 0 ? anomaly!.floor(x, z, na, ak, NB) : na;
    const fc = ak > 0 ? anomaly!.ceiling(x, z, nb, ak, NB) : nb;
    let n = 0, warp = 0, layer = 0;
    const o = slot * R6;
    for (let r = 0; r < R6; r++) {
      const w = rs.w[r];
      if (w <= 0) continue;
      const p = params[r];
      cReg[o + n] = r;
      cW[o + n] = w;
      cH[o + n] = hsum[r] / w;
      cFh[o + n] = p.floorHeight + p.floorUndulation * fa;
      cCh[o + n] = p.ceilingHeight + p.ceilingUndulation * fc;
      warp += w * p.warpStrength;
      if (p.layerAmplitude !== 0) layer = 1;
      n++;
    }
    cN[slot] = n;
    cBN[slot] = 0;
    if (bP && rs.w[REGION.SAND] > 0) boulderCtx(slot, x, z);
    cNa[slot] = na;
    cNb[slot] = nb;
    cWarp[slot] = ak > 0 ? warp * (1 + ANOMALY.warp * ak) : warp;
    cLayer[slot] = layer;
    cStrata[slot] = ak > 0 ? anomaly!.strata(ak) : 1;
    cBias[slot] = rs.bias;
    const wall = wallRef.term;
    if (wall) {
      wall.shape.locate(x, z, wallLoc);
      cWallSd[slot] = wallLoc[0];
      cWallS[slot] = wallLoc[1];
      cWallTh[slot] = wall.identityFrom(wallLoc[0]);
    }
    cX[slot] = x;
    cZ[slot] = z;
    return slot;
  };

  return { cX, cZ, cN, cReg, cW, cH, cFh, cCh, cNa, cNb, cWarp, cLayer, cBias, cWallTh, cWallSd, cWallS, cStrata, cBN, cBH2, cBCy, cBRy, cBR, ctx };
}
