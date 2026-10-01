/**
 * The density field's seeded constants (density.ts): noise offsets drawn in the
 * reference order, the terrace step table, the shared vertical terms and the flat
 * per-region scalars every part of the field reads. Built once per field.
 */
import type { TerrainSettings } from "./config";
import { createSimplex3, mulberry32 } from "./noise";
import type { RegionParams } from "./regionParams";
import { REGION } from "./regions";
import type { SiteLayout } from "./siteLayout";
import type { WallTerm } from "./wallDensity";
import { RAW_CAP } from "./densityTypes";
import { ramp, smooth01 } from "./densityMath";

export type DensityCore = {
  seed: number;
  s: TerrainSettings;
  params: readonly RegionParams[];
  layout: SiteLayout | null;
  snoise: ReturnType<typeof createSimplex3>;
  /** Ridged octave offsets (reference: System.Random(seed) → ±1000). */
  offs: Float64Array;
  /** Warp / layering / erosion offsets. */
  ex: Float64Array;
  /** Region-term offsets (separate stream). */
  ro: Float64Array;
  /** World scale (power of two) and its inverse. */
  S: number;
  invS: number;
  iso: number;
  /** iso + RAW_CAP: raw density cap (deep rock). */
  capHi: number;
  floorTerm: (y: number, fh: number) => number;
  ceilTerm: (y: number, ch: number) => number;
  /** Exact maximum of the ridged noise. */
  noiseMax: number;
  /** Terrace step heights per level (levels −4 … 11 → index level + 4) and their cumulative start heights. */
  terraceSteps: Float64Array;
  terraceCum: Float64Array;
  /** Sand surface = H − sandIso. */
  sandIso: number;
  bP: RegionParams["boulders"];
  bGain: number;
  bBump: number;
  bK: number;
  pBias: Float64Array;
  pSlope: Float64Array;
  pNw: Float64Array;
  pLa: Float64Array;
  pEr: Float64Array;
  /** Bit 1: caves; bit 2: sand boulders. */
  pExtra: Uint8Array;
  caveP: (RegionParams["caves"] | undefined)[];
  /** Ring-wall term, set once the bounds exist (null without a wall). */
  wallRef: { term: WallTerm | null };
};

export function createDensityCore(seed: number, s: TerrainSettings, params: readonly RegionParams[], layout: SiteLayout | null): DensityCore {
  const snoise = createSimplex3(seed);
  // Reference: System.Random(seed) → per-octave offsets in ±1000.
  const rand = mulberry32(seed);
  const offs = new Float64Array(Math.max(8, s.octaves) * 3);
  for (let i = 0; i < 24; i++) offs[i] = (rand() * 2 - 1) * 1000;
  // Extra offsets for the warp / layering / erosion fields (drawn after the
  // reference offsets so the ridged octaves keep their original placement).
  const ex = new Float64Array(8 * 3);
  for (let i = 0; i < ex.length; i++) ex[i] = (rand() * 2 - 1) * 1000;
  // Octaves beyond the reference 8 (fine detail of the scaled world) draw after those.
  for (let i = 24; i < offs.length; i++) offs[i] = (rand() * 2 - 1) * 1000;
  // Region-term offsets (separate stream: the reference offsets above are unchanged).
  const rrand = mulberry32(seed ^ 0x3c6ef372);
  const ro = new Float64Array(32);
  for (let i = 0; i < ro.length; i++) ro[i] = (rrand() * 2 - 1) * 1000;
  // World scale: the whole field is evaluated at p / S ("base" coordinates) and its
  // values are stretched around iso by S, so every shape is S× larger while density
  // gradients (normals, AO, collision, thin-sheet smoothing) keep their magnitude.
  const S = s.worldScale;

  const fb = s.hardFloorBlend;
  const floorTerm = (y: number, fh: number) => s.hardFloorWeight * smooth01((fh + fb - y) / (2 * fb));
  const ceilTerm = (y: number, ch: number) => s.ceilingSlope * ramp(y - ch, s.ceilingRamp);

  // Ridged-noise maximum: each octave's v = (1 − √(n² + r²))² · weight ≤ (1 − r)² (weight ≤ 1),
  // so noise ≤ (1 − r)² · Σ amplitudes — a tight, exact bound (r = ridgeSoftness).
  let ampSum = 0;
  for (let j = 0, a = 1; j < s.octaves; j++, a *= s.persistence) ampSum += j >= s.fineOctaveFrom ? a * s.fineOctaveGain : a;
  const noiseMax = (1 - s.ridgeSoftness) ** 2 * ampSum;

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

  const bP = params[REGION.SAND].boulders;
  return {
    seed, s, params, layout, snoise, offs, ex, ro, S, invS: 1 / S, iso: s.isoLevel, capHi: s.isoLevel + RAW_CAP,
    floorTerm, ceilTerm, noiseMax, terraceSteps, terraceCum,
    sandIso: (s.isoLevel - params[REGION.SAND].bias) / params[REGION.SAND].slope,
    bP, bGain: bP ? bP.gain : 0, bBump: bP ? bP.bump : 0, bK: bP ? bP.k : 1,
    // Flat per-region scalars (monomorphic, cheap in the hot loop).
    pBias: Float64Array.from(params, (p) => p.bias),
    pSlope: Float64Array.from(params, (p) => p.slope),
    pNw: Float64Array.from(params, (p) => p.noiseWeight),
    pLa: Float64Array.from(params, (p) => p.layerAmplitude),
    pEr: Float64Array.from(params, (p) => p.erosionAmplitude),
    pExtra: Uint8Array.from(params, (p) => (p.caves ? 1 : 0) | (p.boulders && p === params[REGION.SAND] ? 2 : 0)),
    caveP: params.map((p) => p.caves),
    wallRef: { term: null },
  };
}
