/**
 * Density field — SebLague `NoiseDensity.compute` ridged noise, reworked so the
 * field is continuous everywhere (no straight shelves / flat plates):
 *
 *   p'    = p + warp(p)                         low-frequency 3D domain warp
 *   raw   = −(y + floorOffset)
 *         + ridged(p') · noiseWeight            reference multi-octave ridged noise with a
 *                                               rounded crest (|n| → √(n² + r²))
 *         + layerBias + layer(p')               soft layering: two sine harmonics whose
 *                                               phase and band height vary with xz
 *         + erosion(p')                         one higher-frequency detail octave
 *         + floorWeight · smoothstep(...)       undulating hard floor (xz-varying height)
 *         + ceilingSlope · ramp(y − ceilH(xz))  undulating rock ceiling (C1 ramp)
 *   final = Σ w_i · raw(x, y + (i − 2)·h, z)    vertical binomial [1 4 6 4 1]/16 smoothing
 *
 * The rounded crest and the vertical smoothing make the rock water-worn: the
 * ridged cusp produced paper-thin sheets with knife rims; now sheets thinner
 * than the kernel vanish and shelf rims come out blunt. h is a whole number of
 * lattice cells so the mesher computes `final` exactly from its raw rows.
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
  /** World seed the field was built from (for deterministic per-position hashing). */
  seed: number;
  /** Full density at a world position (vertically smoothed; this is the terrain). */
  sample: (x: number, y: number, z: number) => number;
  /** Unsmoothed density; sample = Σ smoothWeights[i] · sampleRaw(x, y + (i − h)·smoothStep, z), h = (len − 1)/2. */
  sampleRaw: (x: number, y: number, z: number) => number;
  /** Vertical tap spacing of the smoothing kernel (a whole number of lattice cells). */
  smoothStep: number;
  /** Binomial vertical smoothing weights (odd length, sum 1). */
  smoothWeights: number[];
  /** Conservative [min, max] of sample(x, y, z) over all x, z. */
  bounds: (y: number, out: Float64Array) => void;
  /** Gradient pointing toward solid (central difference; the field is continuous). */
  gradient: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
};

const TAU = Math.PI * 2;
/** Binomial smoothing weights (sum 1) for 1, 3 or 5 taps. */
export function smoothWeights(taps: number): number[] {
  if (taps >= 5) return [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  if (taps >= 3) return [1 / 4, 2 / 4, 1 / 4];
  return [1];
}

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

  const rs2 = s.ridgeSoftness * s.ridgeSoftness;
  const sampleRaw = (x: number, y: number, z: number): number => {
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
      // Smooth |n| ≈ √(n² + r²): rounded crest instead of the ridged cusp (which
      // made knife rims); away from the crest the value is unchanged.
      let v = Math.max(0, 1 - Math.sqrt(n * n + rs2));
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
    // plain simplex blended toward a ridged variant (1 − 2|n|): its creases give
    // angular facet edges / crisper rock (both in [−1, 1], so bounds are unchanged)
    const en = snoise(wx * es + ex[15], wy * es + ex[16], wz * es + ex[17]);
    const erosion = s.erosionAmplitude * (en + s.erosionRidge * (1 - 2 * Math.abs(en) - en));

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

  const rawBounds = (y: number, out: Float64Array) => {
    const b = -(y + s.floorOffset) + s.layerBias;
    // floor term decreases with (y − fh): min at the lowest floor, max at the highest
    out[0] = b - layerMax - E + floorTerm(y, s.hardFloorHeight - U) + ceilTerm(y, s.ceilingHeight + Uc);
    out[1] = b + noiseMax + layerMax + E + floorTerm(y, s.hardFloorHeight + U) + ceilTerm(y, s.ceilingHeight - Uc);
  };

  // --- vertical smoothing: binomial ([1 2 1]/4 or [1 4 6 4 1]/16), taps smoothStep apart ---
  // A sheet thinner than ~the kernel width loses its peak and vanishes; thicker
  // shelves keep their shape but their rims get blunter (wider kernel = rounder).
  // Taps sit on lattice rows (smoothStep = k · spacing), so the mesher evaluates
  // this exactly from its sampled rows at no extra noise cost.
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
  const bounds = (y: number, out: Float64Array) => {
    let lo = 0, hi = 0;
    for (let i = 0; i < SW.length; i++) {
      rawBounds(y + (i - half) * hs, tb);
      lo += SW[i] * tb[0];
      hi += SW[i] * tb[1];
    }
    out[0] = lo;
    out[1] = hi;
  };

  const gradient = (x: number, y: number, z: number, out: Float64Array, h = 0.1) => {
    const inv = 1 / (2 * h);
    out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) * inv;
    out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) * inv;
    out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) * inv;
  };

  return { settings: s, seed, sample, sampleRaw, smoothStep, smoothWeights: SW, bounds, gradient };
}
