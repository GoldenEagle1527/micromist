/**
 * Per-vertex macro-region weights for the seabed material (scene/materialShader.ts).
 *
 * The 6 region weights (regions.ts) are sampled on a GLOBAL world-aligned grid
 * (REGION_GRID base units, i.e. × worldScale in world units) and interpolated
 * bilinearly, so a given (x, z) gets exactly the same weights in every column and
 * at every LOD level: no material pop when LOD levels swap. The weights are a pure
 * function of (seed, x, z), baked at generation time (mesher.ts) and packed as
 * 8 bytes per vertex (6 weights, largest-remainder quantised to sum exactly 255,
 * + 2 padding bytes) → shader attributes aRegA (sand, reef, canyon, cave) and
 * aRegB (terrace, trench), normalised.
 */
import { REGION_COUNT, createRegionSample, type RegionField } from "./regions";

/** Grid spacing in base units (the region blend band is 17 base units wide). */
export const REGION_GRID = 2;
/** Bytes per vertex in the packed buffer. */
export const REGION_STRIDE = 8;

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

/** Quantise 6 weights to bytes summing exactly to 255 (largest remainder, ties → lower index). */
export function quantizeWeights(w: ArrayLike<number>, out: Uint8Array, o: number): void {
  let sum = 0;
  for (let r = 0; r < REGION_COUNT; r++) sum += Math.max(0, w[r]);
  if (sum <= 0) {
    for (let r = 0; r < REGION_COUNT; r++) out[o + r] = r === 0 ? 255 : 0;
    return;
  }
  let used = 0;
  const rem = [0, 0, 0, 0, 0, 0];
  for (let r = 0; r < REGION_COUNT; r++) {
    const v = (Math.max(0, w[r]) / sum) * 255;
    const f = Math.floor(v);
    out[o + r] = f;
    rem[r] = v - f;
    used += f;
  }
  for (let left = 255 - used; left > 0; left--) {
    let best = 0;
    for (let r = 1; r < REGION_COUNT; r++) if (rem[r] > rem[best]) best = r;
    out[o + best]++;
    rem[best] = -1;
  }
}

/**
 * Packed weights for `count` vertices (xyz positions); `copyFrom[i]` (optional)
 * makes vertex surfaceCount + i reuse another vertex's weights (skirts).
 */
export function packRegionWeights(
  positions: Float32Array,
  surfaceCount: number,
  totalCount: number,
  sampler: RegionWeightSampler,
  copyFrom: ArrayLike<number> = [],
): Uint8Array {
  const out = new Uint8Array(totalCount * REGION_STRIDE);
  const w = new Float64Array(REGION_COUNT);
  for (let v = 0; v < surfaceCount; v++) {
    sampler.at(positions[v * 3], positions[v * 3 + 2], w);
    quantizeWeights(w, out, v * REGION_STRIDE);
  }
  for (let q = surfaceCount; q < totalCount; q++) out.copyWithin(q * REGION_STRIDE, copyFrom[q - surfaceCount] * REGION_STRIDE, copyFrom[q - surfaceCount] * REGION_STRIDE + REGION_STRIDE);
  return out;
}
