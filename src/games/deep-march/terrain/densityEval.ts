/**
 * The density field's raw value at a base-coordinate point (density.ts evalRaw):
 * domain warp, soft layering, erosion detail, the region terms blended by the
 * cached region weights, the reference ridged noise (skipped deep inside rock:
 * raw is capped at iso + RAW_CAP), sand boulders and the ring-wall term. The
 * warp / erosion / ridged noise run in WebAssembly when enabled (bit-exact port).
 */
import { simplexTables } from "./noise";
import { getWasmNoise } from "./noiseWasm";
import { REGION_COUNT } from "./regions";
import { TAU, caveEnvelope, smooth01 } from "./densityMath";
import type { DensityCore } from "./densityCore";
import type { DensityCache } from "./densityCache";

const R6 = REGION_COUNT;

/** evalRaw(slot, x, y, z): slot = cache.ctx(x, z) of the same base point. */
export function createEvalRaw(core: DensityCore, cache: DensityCache): (slot: number, x: number, y: number, z: number) => number {
  const { seed, s, snoise, ex, ro, offs, floorTerm, ceilTerm, capHi, wallRef, pBias, pSlope, pNw, pLa, pEr, pExtra, caveP, bGain, bBump, bK } = core;
  const { cN, cReg, cW, cH, cFh, cCh, cNa, cNb, cWarp, cLayer, cBias, cWallTh, cWallSd, cWallS, cStrata, cBN, cBH2, cBCy, cBRy, cBR } = cache;
  const [ox, oy, oz] = s.offset;
  const fw = s.warpFrequency;
  const Wv = s.warpVertical;
  const part = new Float64Array(R6);
  const rs2 = s.ridgeSoftness * s.ridgeSoftness;
  const freq0 = s.noiseScale / 100;
  const es = s.erosionFrequency;
  // WebAssembly hot path (bit-exact port of the warp / erosion / ridged code below):
  // per-field block = simplex tables (1 KiB) + extra offsets + octave offsets + 4 results.
  const wasm = s.wasm === true ? getWasmNoise() : null;
  let wT = -1, wEx = 0, wOffs = 0, wOut = 0;
  if (wasm) {
    wT = wasm.alloc(1024 + (ex.length + offs.length + 4) * 8);
    if (wT >= 0) {
      const tables = simplexTables(seed);
      wasm.u8.set(tables.perm, wT);
      wasm.u8.set(tables.permMod12, wT + 512);
      wEx = wT + 1024;
      wOffs = wEx + ex.length * 8;
      wOut = wOffs + offs.length * 8;
      wasm.f64.set(ex, wEx >> 3);
      wasm.f64.set(offs, wOffs >> 3);
    }
  }
  const wF = wasm ? wasm.f64 : new Float64Array(4);
  const wO = wOut >> 3;
  const useWasm = !!wasm && wT >= 0;
  return (slot: number, x: number, y: number, z: number): number => {
    const W = cWarp[slot];
    // --- domain warp (+ the erosion simplex on the warped position) ---
    let wx: number, wy: number, wz: number, en: number;
    if (useWasm) {
      wasm!.warpErosion(wT, wEx, x, y, z, fw, W, Wv, es, wOut);
      wx = wF[wO];
      wy = wF[wO + 1];
      wz = wF[wO + 2];
      en = wF[wO + 3];
    } else {
      wx = x + W * snoise(x * fw + ex[0], y * fw + ex[1], z * fw + ex[2]);
      wy = y + W * Wv * snoise(x * fw + ex[3], y * fw + ex[4], z * fw + ex[5]);
      wz = z + W * snoise(x * fw + ex[6], y * fw + ex[7], z * fw + ex[8]);
      en = snoise(wx * es + ex[15], wy * es + ex[16], wz * es + ex[17]);
    }

    // --- soft layering: band height and phase vary across xz ---
    let layer = 0;
    if (cLayer[slot]) {
      const H = s.layerHeight * (1 + s.layerHeightVariation * cNb[slot]);
      const t = (wy + s.layerPhaseVariation * cNa[slot]) / H;
      layer = Math.sin(TAU * t) + 0.3 * Math.sin(2 * TAU * t + 1.3);
      if (cStrata[slot] !== 1) layer *= cStrata[slot];
    }

    // --- erosion detail: simplex blended toward a ridged variant (angular creases) ---
    const erosion = en + s.erosionRidge * (1 - 2 * Math.abs(en) - en);

    // --- region terms without the ridged noise (a lower bound: noise weights are ≥ 0) ---
    const n = cN[slot];
    const o = slot * R6;
    // site bias (+0 without a layout: d + 0 === d for every d ≠ −0, and d starts at +0)
    const bias = cBias[slot];
    let lower = bias;
    for (let q = 0; q < n; q++) {
      const r = cReg[o + q];
      let v =
        pBias[r] +
        pSlope[r] * (cH[o + q] - y) +
        pLa[r] * layer +
        pEr[r] * erosion +
        floorTerm(y, cFh[o + q]) +
        ceilTerm(y, cCh[o + q]);
      if (pExtra[r] & 1) {
        const c = caveP[r]!;
        const env = caveEnvelope(c, y);
        if (env > 0) {
          const f = c.tubeFreq, fy = f * c.ySquash;
          const n1 = snoise(wx * f + ro[30], wy * fy + ro[31], wz * f);
          const n2 = snoise(wx * f + ro[0], wy * fy + ro[2], wz * f + ro[4]);
          const tube = smooth01(1 - (n1 * n1 + n2 * n2) / (c.tubeWidth * c.tubeWidth));
          const fc = c.chamberFreq;
          const n3 = snoise(wx * fc + ro[6], wy * fc * 1.4 + ro[8], wz * fc + ro[10]);
          const chamber = smooth01((n3 - c.chamberLevel) / 0.25);
          // tunnels stay between the hard floor and the ceiling (world stays sealed)
          v -= c.carve * env * (1 - (1 - tube) * (1 - chamber));
        }
      }
      part[q] = v;
      lower += cW[o + q] * v;
    }
    // Deep inside rock the exact value is irrelevant: raw is capped at iso + RAW_CAP
    // (≥ RAW_CAP / |∇| units from any surface, beyond the smoothing reach), so the
    // expensive octave loop is skipped once the lower bound already exceeds the cap.
    if (lower >= capHi) return capHi < cWallTh[slot] ? wallRef.term!.apply(capHi, cWallSd[slot], cWallS[slot], y) : capHi;

    // --- reference ridged noise (on warped position) ---
    let noise = 0;
    if (useWasm) {
      noise = wasm!.ridged(wT, wOffs, s.octaves, wx, wy, wz, freq0, rs2, s.weightMultiplier, s.fineOctaveFrom, s.fineOctaveGain, s.persistence, s.lacunarity, ox, oy, oz);
    } else {
      let frequency = freq0;
      let amplitude = 1;
      let weight = 1;
      for (let j = 0; j < s.octaves; j++) {
        const nn = snoise(wx * frequency + offs[j * 3] + ox, wy * frequency + offs[j * 3 + 1] + oy, wz * frequency + offs[j * 3 + 2] + oz);
        // Smooth |n| ≈ √(n² + r²): rounded crest instead of the ridged cusp.
        let v = Math.max(0, 1 - Math.sqrt(nn * nn + rs2));
        v = v * v * weight;
        weight = Math.max(Math.min(v * s.weightMultiplier, 1), 0);
        noise += j >= s.fineOctaveFrom ? v * amplitude * s.fineOctaveGain : v * amplitude;
        if (weight === 0) break;
        amplitude *= s.persistence;
        frequency *= s.lacunarity;
      }
    }

    let d = bias;
    for (let q = 0; q < n; q++) {
      const r = cReg[o + q];
      let v = part[q] + pNw[r] * noise;
      if (pExtra[r] & 2) {
        const nb = cBN[slot];
        for (let k = 0; k < nb; k++) {
          const i2 = slot * 2 + k;
          const dy = (y - cBCy[i2]) / cBRy[i2];
          const de = Math.sqrt(cBH2[i2] + dy * dy);
          if (de > 1.6) continue;
          // fades far below any nearby surface by de = 1.6 (so the cutoff is seamless)
          const bv = s.isoLevel + bGain * (cBR[i2] * (1 - de) + bBump * erosion) - 40 * smooth01((de - 1.2) / 0.4);
          // polynomial smooth max (C1): rounded fillet where the boulder meets the sand
          const hk = Math.max(bK - Math.abs(v - bv), 0) / bK;
          v = Math.max(v, bv) + (hk * hk * bK) / 4;
        }
      }
      d += cW[o + q] * v;
    }
    const t = d < capHi ? d : capHi;
    return t < cWallTh[slot] ? wallRef.term!.apply(t, cWallSd[slot], cWallS[slot], y) : t;
  };
}
