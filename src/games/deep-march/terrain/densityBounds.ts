/**
 * Conservative bounds of the density field (density.ts):
 * - rawClassBase: per point, from the cached xz context (no noise): certainly
 *   solid with a known value, certainly water, or unknown (DensityField.rawClass);
 * - regionRawBounds: per region and height, over all (x, z) (each region's D_r has
 *   analytic per-y bounds; raw is a convex combination, so [min_r lo_r, max_r hi_r]
 *   over the regions present is a valid bound; the site bias widens it by
 *   [min(0, min δ), max(0, max δ)]);
 * - boundsForMask / rawBoundsForMask: over every (x, z) whose regions are in a mask
 *   (+ WALL_BIT: the wall term can act there), smoothed or raw, in world values.
 */
import { REGION, REGION_COUNT } from "./regions";
import { layoutBiasRange } from "./siteLayout";
import { WALL_BIT } from "./densityTypes";
import { NB, caveEnvelope } from "./densityMath";
import type { DensityCore } from "./densityCore";
import type { DensityCache } from "./densityCache";
import type { RegionHeight } from "./regionHeight";

const R6 = REGION_COUNT;

/** SW / hs: the vertical smoothing weights and tap spacing (world units). */
export function createDensityBounds(core: DensityCore, cache: DensityCache, { hRange }: RegionHeight, SW: number[], hs: number) {
  const { s, params, layout, S, invS, iso, capHi, floorTerm, ceilTerm, noiseMax, sandIso, wallRef, pBias, pSlope, pNw, pLa, pEr, pExtra, caveP, bGain, bBump, bK } = core;
  const { cN, cReg, cW, cH, cFh, cCh, cLayer, cBias, cWallTh, cWallSd, cWallS, cBN, cBR } = cache;
  const [biasLo, biasHi] = layoutBiasRange(layout);
  const wallB = new Float64Array(2);
  // |erosion| bound: e = n(1 − r) + r(1 − 2|n|) with |n| ≤ NB
  const erosionBound = NB * (1 + 2 * Math.abs(s.erosionRidge)) + Math.abs(s.erosionRidge);
  const capWorld = S === 1 ? capHi : iso + S * (capHi - iso);
  /** Per-point conservative bounds of evalRaw (see DensityField.rawClass); base coordinates. */
  const rawClassBase = (slot: number, y: number, out: Float64Array): number => {
    const n = cN[slot];
    const o = slot * R6;
    let lo = 0, hi = 0;
    const layerOn = cLayer[slot] !== 0;
    lo = hi = cBias[slot];
    for (let q = 0; q < n; q++) {
      const r = cReg[o + q];
      const w = cW[o + q];
      const common = pBias[r] + pSlope[r] * (cH[o + q] - y) + floorTerm(y, cFh[o + q]) + ceilTerm(y, cCh[o + q]);
      const spread = (layerOn ? Math.abs(pLa[r]) * 1.3 : 0) + Math.abs(pEr[r]) * erosionBound;
      let l = common - spread;
      let h = common + spread + pNw[r] * noiseMax;
      if (pExtra[r] & 1) l -= caveP[r]!.carve * caveEnvelope(caveP[r]!, y);
      if (pExtra[r] & 2 && cBN[slot] > 0) {
        let rMax = 0;
        for (let k = 0; k < cBN[slot]; k++) rMax = Math.max(rMax, cBR[slot * 2 + k]);
        h = Math.max(h, s.isoLevel + Math.abs(bGain) * (rMax + Math.abs(bBump) * erosionBound)) + (cBN[slot] * Math.abs(bK)) / 4;
      }
      lo += w * l;
      hi += w * h;
    }
    if (lo - 1e-7 < cWallTh[slot]) {
      // W is monotone in the terrain value: map the (rounding-padded) bounds through it;
      // where the wall alone fixes the value (solid behind the face, the void) it is exact
      const exact = wallRef.term!.bounds(Math.min(lo - 1e-7, capHi), hi + 1e-7, cWallSd[slot], cWallS[slot], y, wallB);
      lo = wallB[0];
      hi = wallB[1];
      if (exact && lo < capHi && lo !== iso) {
        out[0] = S === 1 ? lo : iso + S * (lo - iso);
        return lo > iso ? 2 : 1;
      }
      if (lo >= capHi) {
        out[0] = capWorld;
        return 2;
      }
    } else if (lo >= capHi + 1e-7) {
      out[0] = capWorld;
      return 2;
    }
    if (hi < iso - 1e-7) {
      out[0] = S === 1 ? hi : iso + S * (hi - iso);
      return 1;
    }
    return 0;
  };

  /** Raw bounds of region r at height y. */
  const regionRawBounds = (r: number, y: number, out: Float64Array) => {
    const p = params[r];
    const [Hlo, Hhi] = hRange[r];
    const la = Math.abs(p.layerAmplitude) * 1.3; // |sin a + 0.3 sin b| ≤ 1.3
    const e = Math.abs(p.erosionAmplitude) * NB;
    const fLo = p.floorHeight - p.floorUndulation * NB, fHi = p.floorHeight + p.floorUndulation * NB;
    const cLo = p.ceilingHeight - p.ceilingUndulation * NB, cHi = p.ceilingHeight + p.ceilingUndulation * NB;
    let lo = p.bias + p.slope * (Hlo - y) - la - e + floorTerm(y, fLo) + ceilTerm(y, cHi);
    let hi = p.bias + p.slope * (Hhi - y) + p.noiseWeight * noiseMax + la + e + floorTerm(y, fHi) + ceilTerm(y, cLo);
    if (p.caves) lo -= p.caves.carve * caveEnvelope(p.caves, y);
    if (p.boulders && r === REGION.SAND) {
      // boulder density ≤ iso + gain·(rMax + bump·1.5) inside its vertical reach; smooth max adds ≤ k/4
      const b = p.boulders;
      const ryMax = b.rMax * b.flatMax; // flatMax ≤ 1.2 ⇒ size scale cbrt(rx·ry·rz) ≤ 1.2·rMax
      const yLo = Hlo - sandIso - b.sink * ryMax - 1.6 * ryMax, yHi = Hhi - sandIso + 1.6 * ryMax;
      if (y >= yLo && y <= yHi) hi = Math.max(hi, s.isoLevel + b.gain * (b.rMax * 1.2 + b.bump * 1.5)) + b.k / 4;
    }
    if (layout) {
      lo += biasLo;
      hi += biasHi;
    }
    out[0] = Math.min(lo, capHi);
    out[1] = Math.min(hi, capHi);
  };

  const half = (SW.length - 1) / 2;
  const tb = new Float64Array(2);
  /** Raw bounds of region r at base height y, widened by the wall term if `nearWall`. */
  const maskRawBounds = (r: number, y: number, nearWall: boolean, out: Float64Array) => {
    regionRawBounds(r, y, out);
    const wall = wallRef.term;
    if (nearWall && wall) {
      out[0] = wall.lowerAt(y, out[0]);
      out[1] = capHi;
    }
  };
  const boundsForMask = (mask: number, y: number, out: Float64Array) => {
    let LO = Infinity, HI = -Infinity;
    const nearWall = (mask & WALL_BIT) !== 0;
    for (let r = 0; r < R6; r++) {
      if (!(mask & (1 << r))) continue;
      let lo = 0, hi = 0;
      for (let i = 0; i < SW.length; i++) {
        maskRawBounds(r, (y + (i - half) * hs) * invS, nearWall, tb);
        lo += SW[i] * (iso + S * (tb[0] - iso));
        hi += SW[i] * (iso + S * (tb[1] - iso));
      }
      if (lo < LO) LO = lo;
      if (hi > HI) HI = hi;
    }
    out[0] = LO;
    out[1] = HI;
  };
  const rawBoundsForMask = (mask: number, y: number, out: Float64Array) => {
    let LO = Infinity, HI = -Infinity;
    const nearWall = (mask & WALL_BIT) !== 0;
    for (let r = 0; r < R6; r++) {
      if (!(mask & (1 << r))) continue;
      maskRawBounds(r, y * invS, nearWall, tb);
      const lo = iso + S * (tb[0] - iso), hi = iso + S * (tb[1] - iso);
      if (lo < LO) LO = lo;
      if (hi > HI) HI = hi;
    }
    out[0] = LO;
    out[1] = HI;
  };

  return { rawClassBase, regionRawBounds, boundsForMask, rawBoundsForMask };
}
