/**
 * Macro terrain regions — large (~80–150 unit) areas that each drive their own
 * density parameters (see regionParams.ts), so every terrain type forms an
 * explorable area instead of classes changing every few units.
 *
 * Pure and deterministic: a function of (seed, x, z) only — identical on every
 * device and quality preset, in the worker and on the main thread.
 *
 *  1. warp:   q = (x, z) + warpAmp · (n(x·f, z·f), n(…))   low-frequency domain warp, so
 *             region borders meander instead of running as straight Voronoi edges;
 *  2. sites:  one seeded site per `cell`-sized grid cell (jittered inside the cell),
 *             region id drawn per site from REGION_WEIGHTS (neighbouring sites of the
 *             same region merge into larger patches);
 *  3. blend:  site weight = smooth01(1 − (d_i − d_min) / band), normalised — the nearest
 *             site weighs 1, a site whose distance exceeds the nearest by `band` weighs 0,
 *             so the blend zone at a border is ≈ 15–20 units wide measured
 *             perpendicular to it (median ≈ 16 with band 14; wider where the border runs
 *             obliquely between sites / near triple junctions). C1-continuous everywhere. Weights of sites sharing a region add up.
 *
 * API:
 *   createRegionField(seed) → RegionField
 *     sample(x, z, out)    per-region weights (+ dominant id, edge distance) into a RegionSample
 *     regionAt(x, z)       dominant region id
 *     maskInRect(…)        bitmask of regions with non-zero weight anywhere in a rectangle
 *                          (conservative; used for per-column density bounds)
 *     spawnPoint()         (x, z) at the core of the reef-forest region nearest the origin
 */
import { createSimplex3, mulberry32 } from "./noise";

export const REGION = { SAND: 0, REEF: 1, CANYON: 2, CAVE: 3, TERRACE: 4, TRENCH: 5 } as const;
export type RegionKey = "sand" | "reef" | "canyon" | "cave" | "terrace" | "trench";
export const REGION_KEYS: readonly RegionKey[] = ["sand", "reef", "canyon", "cave", "terrace", "trench"];
export const REGION_COUNT = 6;
/** Relative frequency of each region (sand / reef common, cave / trench rare). */
export const REGION_WEIGHTS: readonly number[] = [0.25, 0.27, 0.15, 0.09, 0.16, 0.08];
/** Debug / map colours (sRGB hex). */
export const REGION_COLORS: readonly string[] = ["#e3c77a", "#3fc6a8", "#d9704a", "#8a63d2", "#6f9be0", "#1d3f8f"];

export const MACRO = {
  /** Site grid cell (units); jittered sites give regions ≈ 80–150 units across. */
  cell: 104,
  /** Site jitter inside its cell (fraction of the cell). */
  jitter: 0.8,
  /** Blend band: a site's weight falls to 0 once it is `band` farther than the nearest (→ ~15–20 u zones). */
  band: 14,
  warpAmp: 22,
  warpFreq: 0.0075,
} as const;

export type RegionSample = {
  /** Weight per region id (sum 1). */
  w: Float64Array;
  /** Dominant region id. */
  id: number;
  /** Weight of the dominant region (1 = region core, 0.5 = on the border). */
  dominant: number;
  /** Approximate distance (units) to the nearest border with another region (≥ 0; capped at 255). */
  edge: number;
  /** Per-site data of the blending sites (for site-specific shapes, e.g. canyon axis). */
  sites: number;
  siteW: Float64Array;
  siteRegion: Int8Array;
  /** Site hash in [0, 1) (orientation / variation seed). */
  siteHash: Float64Array;
};

export type RegionField = {
  seed: number;
  sample: (x: number, z: number, out: RegionSample) => RegionSample;
  regionAt: (x: number, z: number) => number;
  maskInRect: (x0: number, z0: number, x1: number, z1: number) => number;
  spawnPoint: () => { x: number; z: number };
};

export function createRegionSample(): RegionSample {
  return {
    w: new Float64Array(REGION_COUNT),
    id: 0,
    dominant: 1,
    edge: 255,
    sites: 0,
    siteW: new Float64Array(25),
    siteRegion: new Int8Array(25),
    siteHash: new Float64Array(25),
  };
}

function hash(seed: number, a: number, b: number, c: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h / 4294967296;
}

function smooth01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

const fieldCache = new Map<number, RegionField>();

export function createRegionField(seed: number): RegionField {
  const cached = fieldCache.get(seed);
  if (cached) return cached;
  const noise = createSimplex3(seed ^ 0x51ab7e3);
  const rnd = mulberry32(seed ^ 0x77ac31);
  const ox = rnd() * 512, oz = rnd() * 512, oy = rnd() * 512;
  const G = MACRO.cell;
  const J = MACRO.jitter;
  const B = MACRO.band;
  const cum: number[] = [];
  let tot = 0;
  for (const w of REGION_WEIGHTS) cum.push((tot += w));
  const regionOfSite = (cx: number, cz: number) => {
    const r = hash(seed, cx, cz, 21) * tot;
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
  const site = (cx: number, cz: number): number => {
    const slot = (Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77)) >>> 22;
    if (mCx[slot] !== cx || mCz[slot] !== cz) {
      mCx[slot] = cx;
      mCz[slot] = cz;
      mX[slot] = (cx + (1 - J) / 2 + J * hash(seed, cx, cz, 11)) * G;
      mZ[slot] = (cz + (1 - J) / 2 + J * hash(seed, cx, cz, 12)) * G;
      mR[slot] = regionOfSite(cx, cz);
      mH[slot] = hash(seed, cx, cz, 31);
    }
    return slot;
  };
  const siteX = (cx: number, cz: number) => mX[site(cx, cz)];
  const siteZ = (cx: number, cz: number) => mZ[site(cx, cz)];
  const warpX = (x: number, z: number) => x + MACRO.warpAmp * noise(x * MACRO.warpFreq + ox, oy, z * MACRO.warpFreq);
  const warpZ = (x: number, z: number) => z + MACRO.warpAmp * noise(x * MACRO.warpFreq, oy + 37.1, z * MACRO.warpFreq + oz);

  const dist = new Float64Array(25);
  const reg = new Int8Array(25);
  const hs = new Float64Array(25);
  const sample = (x: number, z: number, out: RegionSample): RegionSample => {
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
        if (d < dmin) {
          dmin = d;
          imin = n;
        }
        n++;
      }
    }
    out.w.fill(0);
    let sum = 0;
    out.sites = 0;
    let other = Infinity; // nearest site of another region than the nearest site
    const r0 = reg[imin];
    for (let i = 0; i < n; i++) {
      if (reg[i] !== r0 && dist[i] < other) other = dist[i];
      const w = smooth01(1 - (dist[i] - dmin) / B);
      if (w <= 0) continue;
      out.siteW[out.sites] = w;
      out.siteRegion[out.sites] = reg[i];
      out.siteHash[out.sites] = hs[i];
      out.sites++;
      out.w[reg[i]] += w;
      sum += w;
    }
    let best = 0;
    for (let r = 0; r < REGION_COUNT; r++) {
      out.w[r] /= sum;
      if (out.w[r] > out.w[best]) best = r;
    }
    for (let i = 0; i < out.sites; i++) out.siteW[i] /= sum;
    out.id = best;
    out.dominant = out.w[best];
    // distance to the bisector with the nearest foreign site ≈ (d_other − d_min) / 2 (signed toward r0)
    out.edge = Math.min(255, Math.max(0, (other - dmin) / 2));
    return out;
  };

  const tmp = createRegionSample();
  const regionAt = (x: number, z: number) => sample(x, z, tmp).id;

  /**
   * Regions with non-zero weight anywhere in [x0,x1]×[z0,z1]. Weight of region r is
   * > 0 iff some site of r is within `band` of the nearest; (d_i − d_min) is
   * 2·(1 + warp slope)-Lipschitz, so a grid with step h and a band inflated by
   * 2·(1+L)·h·√2/2 cannot miss a region.
   */
  const maskInRect = (x0: number, z0: number, x1: number, z1: number) => {
    const h = 2.5;
    const L = MACRO.warpAmp * MACRO.warpFreq * 3; // |∇ simplex| ≲ 3 per noise unit
    const slack = 2 * (1 + L) * h * Math.SQRT1_2 + 0.5;
    const nx = Math.max(1, Math.ceil((x1 - x0) / h)), nz = Math.max(1, Math.ceil((z1 - z0) / h));
    let mask = 0;
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = x0 + ((x1 - x0) * ix) / nx, z = z0 + ((z1 - z0) * iz) / nz;
        const qx = warpX(x, z), qz = warpZ(x, z);
        const gx = Math.floor(qx / G), gz = Math.floor(qz / G);
        let dmin = Infinity;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(siteX(gx + dx, gz + dz) - qx, siteZ(gx + dx, gz + dz) - qz);
          dist[(dz + 2) * 5 + dx + 2] = d;
          if (d < dmin) dmin = d;
        }
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (dist[(dz + 2) * 5 + dx + 2] - dmin < B + slack) mask |= 1 << mR[site(gx + dx, gz + dz)];
        }
      }
    }
    return mask;
  };

  /**
   * Core of the reef-forest region nearest the origin: the nearest reef site
   * (mapped back through the warp by fixed-point iteration p = s − warp(p)),
   * then the point of maximum border distance within ±36 units of it.
   */
  const spawnPoint = () => {
    let best = { d: Infinity, x: 0, z: 0 };
    for (let r = 2; r <= 24 && best.d === Infinity; r *= 2) {
      for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
        const sl = site(cx, cz);
        if (mR[sl] !== REGION.REEF) continue;
        const sx = mX[sl], sz = mZ[sl];
        let px = sx, pz = sz;
        for (let it = 0; it < 16; it++) {
          const nx = sx - (warpX(px, pz) - px);
          const nz = sz - (warpZ(px, pz) - pz);
          px = nx;
          pz = nz;
        }
        const d = Math.hypot(px, pz);
        if (d < best.d) best = { d, x: px, z: pz };
      }
    }
    let bx = best.x, bz = best.z, be = -1;
    for (let dz = -36; dz <= 36; dz += 6) for (let dx = -36; dx <= 36; dx += 6) {
      const s = sample(best.x + dx, best.z + dz, tmp);
      if (s.id !== REGION.REEF) continue;
      if (s.edge > be + 1e-9) {
        be = s.edge;
        bx = best.x + dx;
        bz = best.z + dz;
      }
    }
    return { x: bx, z: bz };
  };

  const f: RegionField = { seed, sample, regionAt, maskInRect, spawnPoint };
  fieldCache.set(seed, f);
  return f;
}
