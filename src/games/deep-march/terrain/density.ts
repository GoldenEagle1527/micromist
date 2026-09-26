/**
 * Density field — SebLague `NoiseDensity.compute` ridged noise, reworked so the
 * field is continuous everywhere (no straight shelves / flat plates):
 *
 *   p'    = p + warp(p)                         low-frequency 3D domain warp
 *   final = −(y + floorOffset)
 *         + ridged(p') · noiseWeight            reference multi-octave ridged noise
 *         + layerBias + layer(p')               soft layering: two sine harmonics whose
 *                                               phase and band height vary with xz
 *         + erosion(p')                         one higher-frequency detail octave
 *         + floorWeight · smoothstep(...)       undulating hard floor (xz-varying height)
 *         + ceilingSlope · ramp(y − ceilH(xz))  undulating rock ceiling (C1 ramp)
 *
 * The reference sawtooth terrace `(y % 5.08) · 1.06` and the step hard floor
 * made density jump in y, which produced perfectly horizontal edges; both are
 * gone. Solid where density > isoLevel. `bounds(y)` gives a conservative
 * min/max over all xz so the mesher can still classify always-solid / always-
 * water rows without sampling them.
 */
import type { TerrainSettings } from "./config";
import { createSimplex3, mulberry32 } from "./noise";

export type DensityField = {
  settings: TerrainSettings;
  /** Full density at a world position. */
  sample: (x: number, y: number, z: number) => number;
  /** Conservative [min, max] of sample(x, y, z) over all x, z. */
  bounds: (y: number, out: Float64Array) => void;
  /** Gradient pointing toward solid (central difference; the field is continuous). */
  gradient: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
};

const TAU = Math.PI * 2;

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

export function createDensityField(seed: number, s: TerrainSettings): DensityField {
  const snoise = createSimplex3(seed);
  // Reference: System.Random(seed) → per-octave offsets in ±1000.
  const rand = mulberry32(seed);
  const offs = new Float64Array(s.octaves * 3);
  for (let i = 0; i < offs.length; i++) offs[i] = (rand() * 2 - 1) * 1000;
  // Extra offsets for the warp / layering / erosion fields (drawn after the
  // reference offsets so the ridged octaves keep their original placement).
  const ex = new Float64Array(8 * 3);
  for (let i = 0; i < ex.length; i++) ex[i] = (rand() * 2 - 1) * 1000;
  const [ox, oy, oz] = s.offset;

  const fw = s.warpFrequency;
  const W = s.warpStrength;
  const Wy = s.warpStrength * s.warpVertical;
  const LA = s.layerAmplitude;
  const layerMax = LA * 1.3; // |sin a + 0.3 sin b| ≤ 1.3
  const fxz = s.undulationFrequency;
  const U = s.floorUndulation * 1.02; // simplex |n| ≲ 1
  const Uc = s.ceilingUndulation * 1.02;
  const E = s.erosionAmplitude * 1.02;
  const fb = s.hardFloorBlend;
  const floorTerm = (y: number, fh: number) => s.hardFloorWeight * smooth01((fh + fb - y) / (2 * fb));
  const ceilTerm = (y: number, ch: number) => s.ceilingSlope * ramp(y - ch, s.ceilingRamp);

  let ampSum = 0;
  for (let j = 0, a = 1; j < s.octaves; j++, a *= s.persistence) ampSum += a;
  const noiseMax = ampSum * s.noiseWeight;

  const sample = (x: number, y: number, z: number): number => {
    // --- domain warp ---
    const wx = x + W * snoise(x * fw + ex[0], y * fw + ex[1], z * fw + ex[2]);
    const wy = y + Wy * snoise(x * fw + ex[3], y * fw + ex[4], z * fw + ex[5]);
    const wz = z + W * snoise(x * fw + ex[6], y * fw + ex[7], z * fw + ex[8]);

    // --- reference ridged noise (on warped position) ---
    let noise = 0;
    let frequency = s.noiseScale / 100;
    let amplitude = 1;
    let weight = 1;
    for (let j = 0; j < s.octaves; j++) {
      const n = snoise(
        wx * frequency + offs[j * 3] + ox,
        wy * frequency + offs[j * 3 + 1] + oy,
        wz * frequency + offs[j * 3 + 2] + oz,
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

    // --- xz fields (two lookups shared by layering, floor and ceiling) ---
    const na = snoise(x * fxz + ex[9], ex[10], z * fxz + ex[11]);
    const nb = snoise(x * fxz * 0.7 + ex[12], ex[13], z * fxz * 0.7 + ex[14]);

    // --- soft layering: band height and phase vary across xz ---
    const H = s.layerHeight * (1 + s.layerHeightVariation * nb);
    const t = (wy + s.layerPhaseVariation * na) / H;
    const layer = LA * (Math.sin(TAU * t) + 0.3 * Math.sin(2 * TAU * t + 1.3));

    // --- erosion detail ---
    const es = s.erosionFrequency;
    const erosion = s.erosionAmplitude * snoise(wx * es + ex[15], wy * es + ex[16], wz * es + ex[17]);

    // --- undulating hard floor / ceiling ---
    const fh = s.hardFloorHeight + s.floorUndulation * na;
    const ch = s.ceilingHeight + s.ceilingUndulation * nb;

    return (
      -(y + s.floorOffset) +
      noise * s.noiseWeight +
      s.layerBias +
      layer +
      erosion +
      floorTerm(y, fh) +
      ceilTerm(y, ch)
    );
  };

  const bounds = (y: number, out: Float64Array) => {
    const b = -(y + s.floorOffset) + s.layerBias;
    // floor term decreases with (y − fh): min at the lowest floor, max at the highest
    out[0] = b - layerMax - E + floorTerm(y, s.hardFloorHeight - U) + ceilTerm(y, s.ceilingHeight + Uc);
    out[1] = b + noiseMax + layerMax + E + floorTerm(y, s.hardFloorHeight + U) + ceilTerm(y, s.ceilingHeight - Uc);
  };

  const gradient = (x: number, y: number, z: number, out: Float64Array, h = 0.1) => {
    const inv = 1 / (2 * h);
    out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) * inv;
    out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) * inv;
    out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) * inv;
  };

  return { settings: s, sample, bounds, gradient };
}
