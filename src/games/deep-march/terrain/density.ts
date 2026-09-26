/**
 * Density field — SebLague `NoiseDensity.compute` ridged noise, reworked so the
 * field is continuous everywhere (no straight shelves / flat plates), and driven
 * by macro terrain regions (regions.ts, parameters in regionParams.ts):
 *
 *   p'    = p + W(x,z) · warp(p)                 low-frequency 3D domain warp
 *                                                (W = region-blended warp strength)
 *   D_r   = bias_r + slope_r · (H_r(x,z) − y)    region base height field
 *         + nw_r · ridged(p')                    reference multi-octave ridged noise with a
 *                                                rounded crest (|n| → √(n² + r²))
 *         + la_r · layer(p')                     soft layering (two sine harmonics)
 *         + e_r · erosion(p')                    one higher-frequency detail octave
 *         + floorWeight · smoothstep(...)        undulating hard floor (region height)
 *         + ceilingSlope · ramp(y − ceilH)       undulating rock ceiling (C1 ramp)
 *         + extra_r(p')                          region-only terms (caves, boulders)
 *   raw   = Σ_r w_r(x,z) · D_r                   region weights, C1 across ~15–20-unit bands
 *   final = Σ w_i · raw(x, y + (i − 2)·h, z)    vertical binomial [1 4 6 4 1]/16 smoothing
 *
 * The shared noise shapes (warp, ridged, layer, erosion) are evaluated once per
 * sample; region terms only where their weight is non-zero. xz-only quantities
 * (region weights, H_r, floor / ceiling heights) are cached per (x, z), so a
 * column of samples pays for them once.
 *
 * The rounded crest and the vertical smoothing make the rock water-worn: sheets
 * thinner than the kernel vanish and shelf rims come out blunt. h is a whole
 * number of lattice cells so the mesher computes `final` exactly from its raw rows.
 *
 * Bounds: each region's D_r has analytic per-y bounds; since raw is a convex
 * combination, [min_r lo_r, max_r hi_r] over the regions present is a valid
 * bound. `bounds(y)` uses all regions (global, for the column height);
 * `boundsForMask(mask, y)` only the regions in `mask` (per-column row skipping).
 */
import type { TerrainSettings } from "./config";
import { createSimplex3, mulberry32 } from "./noise";
import { REGION_PARAMS, type RegionParams } from "./regionParams";
import { REGION, REGION_COUNT, createRegionField, createRegionSample, type RegionField } from "./regions";

export type DensityField = {
  settings: TerrainSettings;
  /** World seed the field was built from (for deterministic per-position hashing). */
  seed: number;
  /** Macro regions driving the field (pure function of seed + x, z). */
  regions: RegionField;
  /** Full density at a world position (vertically smoothed; this is the terrain). */
  sample: (x: number, y: number, z: number) => number;
  /** Unsmoothed density; sample = Σ smoothWeights[i] · sampleRaw(x, y + (i − h)·smoothStep, z), h = (len − 1)/2. */
  sampleRaw: (x: number, y: number, z: number) => number;
  /**
   * sampleRaw with the (x, z) region context snapped to the nearest lattice line —
   * for heuristics sampled at arbitrary points (mesh AO), where the exact
   * per-point region blend is not worth its cost. Deterministic.
   */
  sampleRawCoarse: (x: number, y: number, z: number) => number;
  /** Vertical tap spacing of the smoothing kernel (a whole number of lattice cells). */
  smoothStep: number;
  /** Binomial vertical smoothing weights (odd length, sum 1). */
  smoothWeights: number[];
  /** Conservative [min, max] of sample(x, y, z) over all x, z. */
  bounds: (y: number, out: Float64Array) => void;
  /** Conservative [min, max] of sample over every (x, z) whose non-zero regions are within `mask`. */
  boundsForMask: (mask: number, y: number, out: Float64Array) => void;
  /** Gradient pointing toward solid (central difference; the field is continuous). */
  gradient: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
};

/** Every region bit set. */
export const ALL_REGIONS_MASK = (1 << REGION_COUNT) - 1;

/** Binomial smoothing weights (sum 1) for 1, 3 or 5 taps. */
export function smoothWeights(taps: number): number[] {
  if (taps >= 5) return [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  if (taps >= 3) return [1 / 4, 2 / 4, 1 / 4];
  return [1];
}

const TAU = Math.PI * 2;
/** Simplex output bound used for conservative bounds. */
const NB = 1.05;

/** C1 ramp: 0 for u ≤ 0, quadratic over [0, b], then linear with slope 1. */
function ramp(u: number, b: number): number {
  if (u <= 0) return 0;
  if (u < b) return (u * u) / (2 * b);
  return u - b / 2;
}

function smooth01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Vertical extent of cave carving: 1 between yMin and yMax, C1 falloff over `edge`. */
function caveEnvelope(c: NonNullable<RegionParams["caves"]>, y: number): number {
  return smooth01((y - c.yMin) / c.edge) * smooth01((c.yMax - y) / c.edge);
}

const CACHE_BITS = 12;
const CACHE = 1 << CACHE_BITS;
const R6 = REGION_COUNT;

export function createDensityField(seed: number, s: TerrainSettings, params: readonly RegionParams[] = REGION_PARAMS): DensityField {
  const snoise = createSimplex3(seed);
  // Reference: System.Random(seed) → per-octave offsets in ±1000.
  const rand = mulberry32(seed);
  const offs = new Float64Array(s.octaves * 3);
  for (let i = 0; i < offs.length; i++) offs[i] = (rand() * 2 - 1) * 1000;
  // Extra offsets for the warp / layering / erosion fields (drawn after the
  // reference offsets so the ridged octaves keep their original placement).
  const ex = new Float64Array(8 * 3);
  for (let i = 0; i < ex.length; i++) ex[i] = (rand() * 2 - 1) * 1000;
  // Region-term offsets (separate stream: the reference offsets above are unchanged).
  const rrand = mulberry32(seed ^ 0x3c6ef372);
  const ro = new Float64Array(32);
  for (let i = 0; i < ro.length; i++) ro[i] = (rrand() * 2 - 1) * 1000;
  const [ox, oy, oz] = s.offset;
  const regions = createRegionField(seed);

  const fw = s.warpFrequency;
  const Wv = s.warpVertical;
  const fxz = s.undulationFrequency;
  const fb = s.hardFloorBlend;
  const floorTerm = (y: number, fh: number) => s.hardFloorWeight * smooth01((fh + fb - y) / (2 * fb));
  const ceilTerm = (y: number, ch: number) => s.ceilingSlope * ramp(y - ch, s.ceilingRamp);

  let ampSum = 0;
  for (let j = 0, a = 1; j < s.octaves; j++, a *= s.persistence) ampSum += a;

  // Terrace step heights per level (seeded; levels −4 … 11 → index level + 4).
  const terraceSteps = new Float64Array(16);
  const terraceCum = new Float64Array(17); // height at the start of level (index), level 0 ↔ index 4 → 0
  {
    const t = params[REGION.TERRACE].terrace;
    const tr = mulberry32(seed ^ 0x1b873593);
    for (let i = 0; i < 16; i++) terraceSteps[i] = t ? t.stepMin + (t.stepMax - t.stepMin) * tr() : 0;
    terraceCum[4] = 0;
    for (let i = 4; i < 16; i++) terraceCum[i + 1] = terraceCum[i] + terraceSteps[i];
    for (let i = 3; i >= 0; i--) terraceCum[i] = terraceCum[i + 1] - terraceSteps[i];
  }

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

  // ---------------- per-(x, z) cache ----------------
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
  const rs = createRegionSample();
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
    regions.sample(x, z, rs);
    hsum.fill(0);
    for (let i = 0; i < rs.sites; i++) {
      const r = rs.siteRegion[i];
      hsum[r] += rs.siteW[i] * height(r, x, z, rs.siteHash[i]);
    }
    const na = snoise(x * fxz + ex[9], ex[10], z * fxz + ex[11]);
    const nb = snoise(x * fxz * 0.7 + ex[12], ex[13], z * fxz * 0.7 + ex[14]);
    let n = 0, warp = 0, layer = 0;
    const o = slot * R6;
    for (let r = 0; r < R6; r++) {
      const w = rs.w[r];
      if (w <= 0) continue;
      const p = params[r];
      cReg[o + n] = r;
      cW[o + n] = w;
      cH[o + n] = hsum[r] / w;
      cFh[o + n] = p.floorHeight + p.floorUndulation * na;
      cCh[o + n] = p.ceilingHeight + p.ceilingUndulation * nb;
      warp += w * p.warpStrength;
      if (p.layerAmplitude !== 0) layer = 1;
      n++;
    }
    cN[slot] = n;
    cNa[slot] = na;
    cNb[slot] = nb;
    cWarp[slot] = warp;
    cLayer[slot] = layer;
    cX[slot] = x;
    cZ[slot] = z;
    return slot;
  };

  // Flat per-region scalars (monomorphic, cheap in the hot loop).
  const pBias = Float64Array.from(params, (p) => p.bias);
  const pSlope = Float64Array.from(params, (p) => p.slope);
  const pNw = Float64Array.from(params, (p) => p.noiseWeight);
  const pLa = Float64Array.from(params, (p) => p.layerAmplitude);
  const pEr = Float64Array.from(params, (p) => p.erosionAmplitude);
  const pExtra = Uint8Array.from(params, (p) => (p.caves ? 1 : 0) | (p.boulders ? 2 : 0));
  const caveP = params.map((p) => p.caves);
  const boulderP = params.map((p) => p.boulders);

  const rs2 = s.ridgeSoftness * s.ridgeSoftness;
  const latSp = s.boundsSize / (s.numPointsPerAxis - 1);
  const latH = s.boundsSize / 2;
  const snap = (v: number) => -latH + Math.round((v + latH) / latSp) * latSp;
  const sampleRawCoarse = (x: number, y: number, z: number) => evalRaw(ctx(snap(x), snap(z)), x, y, z);
  const sampleRaw = (x: number, y: number, z: number) => evalRaw(ctx(x, z), x, y, z);
  const evalRaw = (slot: number, x: number, y: number, z: number): number => {
    const W = cWarp[slot];
    // --- domain warp ---
    const wx = x + W * snoise(x * fw + ex[0], y * fw + ex[1], z * fw + ex[2]);
    const wy = y + W * Wv * snoise(x * fw + ex[3], y * fw + ex[4], z * fw + ex[5]);
    const wz = z + W * snoise(x * fw + ex[6], y * fw + ex[7], z * fw + ex[8]);

    // --- reference ridged noise (on warped position) ---
    let noise = 0;
    let frequency = s.noiseScale / 100;
    let amplitude = 1;
    let weight = 1;
    for (let j = 0; j < s.octaves; j++) {
      const nn = snoise(wx * frequency + offs[j * 3] + ox, wy * frequency + offs[j * 3 + 1] + oy, wz * frequency + offs[j * 3 + 2] + oz);
      // Smooth |n| ≈ √(n² + r²): rounded crest instead of the ridged cusp.
      let v = Math.max(0, 1 - Math.sqrt(nn * nn + rs2));
      v = v * v * weight;
      weight = Math.max(Math.min(v * s.weightMultiplier, 1), 0);
      noise += v * amplitude;
      if (weight === 0) break;
      amplitude *= s.persistence;
      frequency *= s.lacunarity;
    }

    // --- soft layering: band height and phase vary across xz ---
    let layer = 0;
    if (cLayer[slot]) {
      const H = s.layerHeight * (1 + s.layerHeightVariation * cNb[slot]);
      const t = (wy + s.layerPhaseVariation * cNa[slot]) / H;
      layer = Math.sin(TAU * t) + 0.3 * Math.sin(2 * TAU * t + 1.3);
    }

    // --- erosion detail: simplex blended toward a ridged variant (angular creases) ---
    const es = s.erosionFrequency;
    const en = snoise(wx * es + ex[15], wy * es + ex[16], wz * es + ex[17]);
    const erosion = en + s.erosionRidge * (1 - 2 * Math.abs(en) - en);

    let d = 0;
    const n = cN[slot];
    const o = slot * R6;
    for (let q = 0; q < n; q++) {
      const r = cReg[o + q];
      let v =
        pBias[r] +
        pSlope[r] * (cH[o + q] - y) +
        pNw[r] * noise +
        pLa[r] * layer +
        pEr[r] * erosion +
        floorTerm(y, cFh[o + q]) +
        ceilTerm(y, cCh[o + q]);
      const extra = pExtra[r];
      if (extra & 1) {
        const c = caveP[r]!;
        const f = c.tubeFreq, fy = f * c.ySquash;
        const n1 = snoise(wx * f + ro[30], wy * fy + ro[31], wz * f);
        const n2 = snoise(wx * f + ro[0], wy * fy + ro[2], wz * f + ro[4]);
        const tube = smooth01(1 - (n1 * n1 + n2 * n2) / (c.tubeWidth * c.tubeWidth));
        const fc = c.chamberFreq;
        const n3 = snoise(wx * fc + ro[6], wy * fc * 1.4 + ro[8], wz * fc + ro[10]);
        const chamber = smooth01((n3 - c.chamberLevel) / 0.25);
        // tunnels stay between the hard floor and the ceiling (world stays sealed)
        v -= c.carve * caveEnvelope(c, y) * (1 - (1 - tube) * (1 - chamber));
      }
      if (extra & 2) {
        const b = boulderP[r]!;
        const fade = smooth01((b.top - y) / b.fade);
        if (fade > 0) {
          const nb = snoise(wx * b.freq + ro[12], wy * b.freq * 0.8 + ro[14], wz * b.freq + ro[16]);
          v += b.amp * fade * smooth01((nb - b.threshold) / b.soft);
        }
      }
      d += cW[o + q] * v;
    }
    return d;
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
    let hi = p.bias + p.slope * (Hhi - y) + p.noiseWeight * ampSum + la + e + floorTerm(y, fHi) + ceilTerm(y, cLo);
    if (p.caves) lo -= p.caves.carve * caveEnvelope(p.caves, y);
    if (p.boulders) hi += p.boulders.amp * smooth01((p.boulders.top - y) / p.boulders.fade);
    out[0] = lo;
    out[1] = hi;
  };

  // --- vertical smoothing: binomial ([1 2 1]/4 or [1 4 6 4 1]/16), taps smoothStep apart ---
  const smoothStep = (s.boundsSize / (s.numPointsPerAxis - 1)) * s.smoothCells;
  const SW = smoothWeights(s.smoothTaps);
  const half = (SW.length - 1) / 2;
  const hs = smoothStep;
  const sample = (x: number, y: number, z: number): number => {
    let v = 0;
    for (let i = 0; i < SW.length; i++) v += SW[i] * sampleRaw(x, y + (i - half) * hs, z);
    return v;
  };
  const tb = new Float64Array(2);
  const boundsForMask = (mask: number, y: number, out: Float64Array) => {
    let LO = Infinity, HI = -Infinity;
    for (let r = 0; r < R6; r++) {
      if (!(mask & (1 << r))) continue;
      let lo = 0, hi = 0;
      for (let i = 0; i < SW.length; i++) {
        regionRawBounds(r, y + (i - half) * hs, tb);
        lo += SW[i] * tb[0];
        hi += SW[i] * tb[1];
      }
      if (lo < LO) LO = lo;
      if (hi > HI) HI = hi;
    }
    out[0] = LO;
    out[1] = HI;
  };
  const bounds = (y: number, out: Float64Array) => boundsForMask(ALL_REGIONS_MASK, y, out);

  const gradient = (x: number, y: number, z: number, out: Float64Array, h = 0.1) => {
    const inv = 1 / (2 * h);
    out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) * inv;
    out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) * inv;
    out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) * inv;
  };

  return { settings: s, seed, regions, sample, sampleRaw, sampleRawCoarse, smoothStep, smoothWeights: SW, bounds, boundsForMask, gradient };
}
