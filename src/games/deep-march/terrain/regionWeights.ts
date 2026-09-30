/**
 * Per-vertex macro-region weights for the seabed material (scene/materialShader.ts).
 *
 * The 6 region weights (regions.ts) are sampled on a GLOBAL world-aligned grid
 * (REGION_GRID base units, i.e. × worldScale in world units) and interpolated
 * bilinearly, so a given (x, z) gets exactly the same weights in every column and
 * at every LOD level: no material pop when LOD levels swap. The weights are a pure
 * function of (seed, x, z), baked at generation time (mesher.ts) and packed as
 * 8 bytes per vertex (6 weights + the ring-wall weight, largest-remainder quantised
 * to sum exactly 255, + the chaos byte) → shader attributes aRegA (sand, reef,
 * canyon, cave) and aRegB (terrace, trench, wall), normalised; byte 7 → aChaos.
 *
 * Ring wall (bounded world): the wall material weight w (density.wallWeight, a pure
 * function of the vertex position, so equal at every LOD) takes its share and the
 * region weights are scaled by 1 − w. Without a wall byte 6 stays 0 and bytes 0–5
 * are exactly what they were before the wall existed (a zero weight never wins a
 * remainder).
 *
 * Chaos byte (M8, the former padding): the crack glow weight (density.crackWeight,
 * crackWeight.ts, a pure function of the position) × 255, rounded; 0 without open
 * cracks, so every other byte — and without cracks all eight — is exactly as before.
 */
import { REGION_COUNT, createRegionSample, type RegionField } from "./regions";

/** Grid spacing in base units (the region blend band is 17 base units wide). */
export const REGION_GRID = 2;
/** Bytes per vertex in the packed buffer. */
export const REGION_STRIDE = 8;
/** Byte (weight slot) of the ring-wall material. */
export const WALL_SLOT = REGION_COUNT;
/** Byte of the crack glow weight (chaos seabed program: aChaos). */
export const CHAOS_BYTE = 7;
const SLOTS = REGION_COUNT + 1;

export class RegionWeightSampler {
  private readonly cache = new Map<number, Float32Array>();
  private readonly rs = createRegionSample();
  private readonly inv: number;
  private readonly regionsField: RegionField;
  readonly spacing: number;

  /** regions: world-coordinate field (DensityField.regions); spacing in world units. */
  constructor(regionsField: RegionField, spacing: number) {
    this.regionsField = regionsField;
    this.spacing = spacing;
    this.inv = 1 / spacing;
  }

  private node(ix: number, iz: number): Float32Array {
    // grid indices stay far inside ±2^20 for any reachable world position
    const key = (ix + 1048576) * 2097152 + (iz + 1048576);
    let w = this.cache.get(key);
    if (!w) {
      w = new Float32Array(REGION_COUNT);
      const s = this.regionsField.sample(ix * this.spacing, iz * this.spacing, this.rs);
      for (let r = 0; r < REGION_COUNT; r++) w[r] = s.w[r];
      this.cache.set(key, w);
    }
    return w;
  }

  /** Bilinearly interpolated weights at (x, z) into out (length ≥ 6). */
  at(x: number, z: number, out: Float32Array | Float64Array): void {
    const gx = x * this.inv, gz = z * this.inv;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const a = this.node(ix, iz), b = this.node(ix + 1, iz), c = this.node(ix, iz + 1), d = this.node(ix + 1, iz + 1);
    for (let r = 0; r < REGION_COUNT; r++) {
      const top = a[r] + (b[r] - a[r]) * fx;
      const bot = c[r] + (d[r] - c[r]) * fx;
      out[r] = top + (bot - top) * fz;
    }
  }
}

export function regionGridSpacing(worldScale: number): number {
  return REGION_GRID * worldScale;
}

/**
 * Quantise the 6 region weights (+ the wall weight w[6], if w has 7 entries) to
 * bytes summing exactly to 255 (largest remainder, ties → lower index).
 */
export function quantizeWeights(w: ArrayLike<number>, out: Uint8Array, o: number): void {
  const n = Math.min(SLOTS, w.length);
  let sum = 0;
  for (let r = 0; r < n; r++) sum += Math.max(0, w[r]);
  if (sum <= 0) {
    for (let r = 0; r < n; r++) out[o + r] = r === 0 ? 255 : 0;
    return;
  }
  let used = 0;
  const rem = [0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < n; r++) {
    const v = (Math.max(0, w[r]) / sum) * 255;
    const f = Math.floor(v);
    out[o + r] = f;
    rem[r] = v - f;
    used += f;
  }
  for (let left = 255 - used; left > 0; left--) {
    let best = 0;
    for (let r = 1; r < n; r++) if (rem[r] > rem[best]) best = r;
    out[o + best]++;
    rem[best] = -1;
  }
}

/**
 * Packed weights for `count` vertices (xyz positions); `copyFrom[i]` (optional)
 * makes vertex surfaceCount + i reuse another vertex's weights (skirts); `wallWeight`
 * (optional, world position → 0 … 1): the ring-wall material share; `crackWeight`
 * (optional, 0 … 1): the chaos byte.
 */
export function packRegionWeights(
  positions: Float32Array,
  surfaceCount: number,
  totalCount: number,
  sampler: RegionWeightSampler,
  copyFrom: ArrayLike<number> = [],
  wallWeight: ((x: number, y: number, z: number) => number) | null = null,
  crackWeight: ((x: number, y: number, z: number) => number) | null = null,
): Uint8Array {
  const out = new Uint8Array(totalCount * REGION_STRIDE);
  const w = new Float64Array(wallWeight ? SLOTS : REGION_COUNT);
  for (let v = 0; v < surfaceCount; v++) {
    sampler.at(positions[v * 3], positions[v * 3 + 2], w);
    if (wallWeight) {
      const ww = wallWeight(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      for (let r = 0; r < REGION_COUNT; r++) w[r] *= 1 - ww;
      w[WALL_SLOT] = ww;
    }
    quantizeWeights(w, out, v * REGION_STRIDE);
    if (crackWeight) out[v * REGION_STRIDE + CHAOS_BYTE] = Math.round(Math.min(1, Math.max(0, crackWeight(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]))) * 255);
  }
  for (let q = surfaceCount; q < totalCount; q++) out.copyWithin(q * REGION_STRIDE, copyFrom[q - surfaceCount] * REGION_STRIDE, copyFrom[q - surfaceCount] * REGION_STRIDE + REGION_STRIDE);
  return out;
}
