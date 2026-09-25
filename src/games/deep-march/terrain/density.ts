/**
 * Port of SebLague `NoiseDensity.compute`:
 *
 *   noise = Σ ridged(snoise(pos * f + offsets[j] + offset)) with weight feedback
 *   final = -(y + floorOffset) + noise * noiseWeight + (y % terraceH) * terraceW
 *   if (y < hardFloor) final += hardFloorWeight
 *
 * Solid where density > isoLevel. Plus an optional rock ceiling (extension).
 */
import type { TerrainSettings } from "./config";
import { createSimplex3, mulberry32 } from "./noise";

export type DensityField = {
  settings: TerrainSettings;
  /** Full density at a world position. */
  sample: (x: number, y: number, z: number) => number;
  /** y-only part of the density (everything except the noise term). */
  base: (y: number) => number;
  /** Upper bound of `noise * noiseWeight` (noise term is always ≥ 0). */
  noiseMax: number;
  /** Central-difference gradient (points toward solid). */
  gradient: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
};

export function createDensityField(seed: number, s: TerrainSettings): DensityField {
  const snoise = createSimplex3(seed);
  // Reference: System.Random(seed) → per-octave offsets in ±1000.
  const rand = mulberry32(seed);
  const offs = new Float64Array(s.octaves * 3);
  for (let i = 0; i < offs.length; i++) offs[i] = (rand() * 2 - 1) * 1000;
  const [ox, oy, oz] = s.offset;

  const base = (y: number): number => {
    let v = -(y + s.floorOffset) + (y % s.terraceHeight) * s.terraceWeight;
    if (y < s.hardFloorHeight) v += s.hardFloorWeight;
    if (y > s.ceilingHeight) v += (y - s.ceilingHeight) * s.ceilingSlope;
    return v;
  };

  const sample = (x: number, y: number, z: number): number => {
    let noise = 0;
    let frequency = s.noiseScale / 100;
    let amplitude = 1;
    let weight = 1;
    for (let j = 0; j < s.octaves; j++) {
      const n = snoise(
        x * frequency + offs[j * 3] + ox,
        y * frequency + offs[j * 3 + 1] + oy,
        z * frequency + offs[j * 3 + 2] + oz,
      );
      let v = 1 - Math.abs(n);
      v = v * v * weight;
      weight = Math.max(Math.min(v * s.weightMultiplier, 1), 0);
      noise += v * amplitude;
      // Once the feedback weight hits 0 every further octave contributes 0.
      if (weight === 0) break;
      amplitude *= s.persistence;
      frequency *= s.lacunarity;
    }
    return base(y) + noise * s.noiseWeight;
  };

  let ampSum = 0;
  for (let j = 0, a = 1; j < s.octaves; j++, a *= s.persistence) ampSum += a;

  const gradient = (x: number, y: number, z: number, out: Float64Array, h = 0.15) => {
    out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) / (2 * h);
    out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) / (2 * h);
    out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) / (2 * h);
  };

  return { settings: s, sample, base, noiseMax: ampSum * s.noiseWeight, gradient };
}
