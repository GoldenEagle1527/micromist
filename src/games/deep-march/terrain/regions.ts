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
 *  3. blend:  pairwise bisector partition of unity: site weight
 *               w_i = Π_j smooth01(1/2 + t_ij / band),  t_ij = (d_j² − d_i²) / (2·|s_i − s_j|)
 *             (t_ij = signed distance from the bisector of sites i, j), normalised. Across
 *             any border the weights fall from 1 to 0 over exactly `band` (warped units)
 *             measured perpendicular to that border — no widening where borders run
 *             obliquely or near triple junctions (the old Δd = d_i − d_min blend widened
 *             by 1/sin(φ/2) there). C1 everywhere; only sites with Δd < band can have
 *             weight (t ≥ Δd/2), so the mask test below stays conservative. Weights of
 *             sites sharing a region add up.
 *
 * API:
 *   createRegionField(seed) → RegionField
 *     sample(x, z, out)    per-region weights (+ dominant id, edge distance) into a RegionSample
 *     regionAt(x, z)       dominant region id
 *     maskInRect(…)        bitmask of regions with non-zero weight anywhere in a rectangle
 *                          (conservative; used for per-column density bounds)
 *     coresOf(r, n)        cores (max border distance) of region r, nearest the origin first
 *     spawnRegion()        seeded spawn region (uniform over the 6; see spawn.ts)
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
  band: 17,
  warpAmp: 20,
  warpFreq: 0.006,
} as const;

export type RegionSample = {
  /** Weight per region id (sum 1). */
  w: Float64Array;
  /** Dominant region id. */
  id: number;
  /** Weight of the dominant region (1 = region core, 0.5 = on the border). */
  dominant: number;
  /** Approximate distance (units) to the nearest border with another region (≥ 0; capped at 255 base units). */
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
  /** Up to `max` cores of region r (max-border-distance points), nearest the origin first. */
  coresOf: (r: number, max: number) => { x: number; z: number; edge: number }[];
  /** Region the diver spawns in for this seed (uniform over all 6). */
  spawnRegion: () => number;
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
  const warpX = (x: number, z: number) => x + MACRO.warpAmp * noise(x * MACRO.warpFreq + ox, oy, z * MACRO.warpFreq);
  const warpZ = (x: number, z: number) => z + MACRO.warpAmp * noise(x * MACRO.warpFreq, oy + 37.1, z * MACRO.warpFreq + oz);

  const dist = new Float64Array(25);
  const reg = new Int8Array(25);
  const hs = new Float64Array(25);
  const sxs = new Float64Array(25);
  const szs = new Float64Array(25);
  const cand = new Int32Array(25);
  const near = new Int32Array(25);
  const HB = B / 2;
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
    }
    let best = 0;
    for (let r = 0; r < REGION_COUNT; r++) {
      out.w[r] /= sum;
      if (out.w[r] > out.w[best]) best = r;
    }
    for (let i = 0; i < out.sites; i++) out.siteW[i] /= sum;
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

  const tmp = createRegionSample();
  const regionAt = (x: number, z: number) => sample(x, z, tmp).id;

  /**
   * Regions with non-zero weight anywhere in [x0,x1]×[z0,z1]. Site i can only have
   * weight where h_i(q) = max_j (signed distance of q past the bisector of (i, j),
   * on j's side) < band/2 (its factor for j vanishes beyond). Each term is a
   * distance to a fixed line, so h_i is 1-Lipschitz in warped space, and the warp
   * is (1 + L)-Lipschitz: a grid with step h and the threshold inflated by
   * (1 + L)·h·√2/2 cannot miss a region. Using only some j (the sites near the
   * nearest) under-estimates h_i, which keeps the test conservative.
   */
  const mdist = new Float64Array(25);
  const msx = new Float64Array(25);
  const msz = new Float64Array(25);
  const mreg = new Int8Array(25);
  const maskInRect = (x0: number, z0: number, x1: number, z1: number) => {
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

  /**
   * Cores of region `r`, nearest the origin first: each site of r (mapped back
   * through the warp by fixed-point iteration p = s − warp(p)) refined to the
   * point of maximum border distance within ±36 units that is still in r.
   */
  const coresOf = (r: number, max: number) => {
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
  /** Spawn region: uniform over the 6 regions, drawn from the seed. */
  const spawnRegion = () => Math.min(REGION_COUNT - 1, Math.floor(hash(seed, 7, 13, 97) * REGION_COUNT));

  const f: RegionField = { seed, sample, regionAt, maskInRect, coresOf, spawnRegion };
  fieldCache.set(seed, f);
  return f;
}

/**
 * The same regions in world coordinates of a world scaled by S (density.ts
 * worldScale): positions are divided by S on the way in, distances multiplied
 * on the way out (edge, cores).
 */
export function scaleRegionField(base: RegionField, S: number): RegionField {
  const inv = 1 / S;
  return {
    seed: base.seed,
    sample: (x, z, out) => {
      base.sample(x * inv, z * inv, out);
      out.edge *= S;
      return out;
    },
    regionAt: (x, z) => base.regionAt(x * inv, z * inv),
    maskInRect: (x0, z0, x1, z1) => base.maskInRect(x0 * inv, z0 * inv, x1 * inv, z1 * inv),
    coresOf: (r, max) => base.coresOf(r, max).map((c) => ({ x: c.x * S, z: c.z * S, edge: c.edge * S })),
    spawnRegion: base.spawnRegion,
  };
}
