/**
 * Terrain + chunk settings. Values mirror SebLague/Marching-Cubes
 * `Scenes/Submarine.unity` (NoiseDensity + MeshGenerator components) unless noted.
 */
export type TerrainSettings = {
  /** Mesh generator */
  isoLevel: number;
  /**
   * World scale S (power of two): the density field is evaluated at p / S (see
   * density.ts), so every terrain shape, region and height is S× the base design
   * while the lattice, the diver and the vertical smoothing stay in world units.
   */
  worldScale: number;
  boundsSize: number;
  numPointsPerAxis: number;
  /** Added inside the noise lookup (MeshGenerator.offset). */
  offset: [number, number, number];
  /** Far edge of the terrain (units): coarse LOD columns reach this far; the haze ends here. */
  viewDistance: number;
  /**
   * Distance LOD (chunks.ts): level L columns are boundsSize·2^L wide with the same
   * lattice point count (spacing × 2^L). A level-L node splits into its four
   * level-(L−1) children while its footprint is within lodNear·2^(L−1) of the viewer,
   * so full resolution reaches lodNear and each coarser ring is twice as far / coarse.
   */
  lodLevels: number;
  lodNear: number;
  /** Terrain classification (base-scale columns) is built within this distance of the viewer. */
  infoRadius: number;

  /** NoiseDensity */
  octaves: number;
  lacunarity: number;
  persistence: number;
  noiseScale: number;
  noiseWeight: number;
  floorOffset: number;
  weightMultiplier: number;
  /** Hard floor: density += weight below ~height, blended over ±blend (smooth, no step). */
  hardFloorHeight: number;
  hardFloorWeight: number;
  hardFloorBlend: number;
  /** Amplitude of the xz variation of the hard floor height. */
  floorUndulation: number;

  /**
   * Soft layering replacing the reference sawtooth terrace `(y % 5.08) · 1.06`:
   * layerBias (= the sawtooth's mean, keeps overall openness) + two sine
   * harmonics of amplitude layerAmplitude, band height layerHeight varied by
   * ±layerHeightVariation and phase-shifted by up to layerPhaseVariation units across xz.
   */
  layerBias: number;
  layerAmplitude: number;
  layerHeight: number;
  layerHeightVariation: number;
  layerPhaseVariation: number;
  /** Frequency of the xz fields driving layering / floor / ceiling undulation. */
  undulationFrequency: number;

  /** Low-frequency 3D domain warp of the sample position. */
  warpFrequency: number;
  warpStrength: number;
  /** Vertical warp as a fraction of warpStrength. */
  warpVertical: number;

  /**
   * Water-worn rounding. ridgeSoftness rounds the ridged-noise crest (|n| →
   * √(n² + r²)); smoothCells is the tap spacing, in lattice cells, of the
   * vertical binomial smoothing that removes paper-thin shelves.
   */
  ridgeSoftness: number;
  smoothCells: number;
  /** Vertical smoothing kernel: 3 = [1 2 1]/4 (crisper), 5 = [1 4 6 4 1]/16 (rounder). */
  smoothTaps: number;

  /**
   * Fine ridged octaves (index ≥ fineOctaveFrom) are scaled by fineOctaveGain: their
   * 1–3 m cells read as dense pock-marks ("acne") on large rock faces. 1 = off.
   */
  fineOctaveFrom: number;
  fineOctaveGain: number;
  /** Higher-frequency erosion detail (plain simplex, ±amplitude). */
  erosionFrequency: number;
  erosionAmplitude: number;
  /** 0 = plain simplex detail, 1 = ridged (1 − 2|n|) detail with angular creases. */
  erosionRidge: number;

  /**
   * Extension (not in the reference scene): rock ceiling. Above
   * ceilingHeight (± ceilingUndulation across xz) density rises by
   * ceilingSlope per unit (C1 ramp over ceilingRamp) so the ocean is a vast cave.
   */
  ceilingHeight: number;
  ceilingSlope: number;
  ceilingRamp: number;
  ceilingUndulation: number;

  /**
   * Floating-rock removal search window (units beyond the column footprint).
   * Components that are still unresolved at this distance are kept.
   */
  floaterMargin: number;
  /**
   * Mesh jobs evaluate the full noise only near the surface, found by a coarse
   * pre-pass (terrain/refine.ts). Default on; false (?refine=0) = full evaluation.
   */
  refine?: boolean;
};

export const TERRAIN: TerrainSettings = {
  isoLevel: 8,
  worldScale: 4,
  // Lattice from the feature scale of the ×4 world: 1.0 u L0 spacing (32 u columns,
  // 33² points), levels at 1 / 2 / 4 / 8 u. Geometry carries features of ~2 u and up;
  // finer detail belongs to the material. (Was 0.345 u / 10 u columns: 4× denser
  // relative to the features than the base design, ~3.6× the work to fill the view.)
  boundsSize: 32,
  numPointsPerAxis: 33,
  offset: [-0.64, 0, 0],
  viewDistance: 420,
  lodLevels: 4,
  lodNear: 32,
  infoRadius: 22,

  // 7 octaves (finest wavelength 2.3 u ≈ 2.3 cells): finer octaves are below the lattice.
  octaves: 7,
  lacunarity: 2,
  persistence: 0.54,
  noiseScale: 2.71,
  noiseWeight: 11.24,
  floorOffset: -0.3,
  weightMultiplier: 10,
  hardFloorHeight: -7,
  hardFloorWeight: 5,
  hardFloorBlend: 1.5,
  floorUndulation: 2.5,

  layerBias: 2.69,
  layerAmplitude: 1.1,
  layerHeight: 5.08,
  layerHeightVariation: 0.3,
  layerPhaseVariation: 2.5,
  undulationFrequency: 0.045,

  warpFrequency: 0.035,
  warpStrength: 2.4,
  warpVertical: 0.4,

  ridgeSoftness: 0.15,
  smoothCells: 1,
  // No vertical smoothing in the world field: every LOD level and collision see the
  // same raw field (the 1 u lattice cannot carry paper-thin shelves anyway).
  smoothTaps: 1,

  fineOctaveFrom: 5, // octaves 5+ (≈ 4.6 m wavelength and finer)
  fineOctaveGain: 0.45, // shallower small cells: no pock-marked "acne" on big faces / floors
  erosionFrequency: 0.3, // was 0.55: erosion creases ~2× larger and sparser, still angular
  erosionAmplitude: 0.9,
  erosionRidge: 0.5,

  ceilingHeight: 14,
  ceilingSlope: 4,
  ceilingRamp: 2,
  ceilingUndulation: 3,

  floaterMargin: 24,
};

/** Touch / low-core devices get the light preset (coarser voxels, 512px textures). */
export function isLowSpecDevice(): boolean {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return coarse || cores <= 4;
}

/**
 * Phone preset: the same lattice and field (same look up close), a shorter view
 * distance — the 8 u level is then never needed — and a smaller classification radius.
 */
export function terrainForDevice(lowSpec = isLowSpecDevice()): TerrainSettings {
  return lowSpec ? { ...TERRAIN, viewDistance: 230, infoRadius: 14 } : TERRAIN;
}

/**
 * Terrain classification lattice (base units): fixed, independent of the world
 * mesh lattice — base 10 u columns with 30 points (1.38 u world cells) and the
 * vertical [1 4 6 4 1] smoothing the classification thresholds were tuned on.
 */
export const INFO_GRID = { boundsSize: 10, numPointsPerAxis: 30, smoothCells: 1, smoothTaps: 5 } as const;

/**
 * Base-scale settings (worldScale 1, INFO_GRID lattice): the terrain
 * classification runs on this field — the world field at p / S (same octaves and
 * terms, evaluated at p / S in both) — so its class thresholds and scan reach keep
 * their meaning at every world scale and every world mesh lattice.
 */
export function baseTerrain(s: TerrainSettings): TerrainSettings {
  return { ...s, ...INFO_GRID, worldScale: 1, octaves: s.octaves, floaterMargin: 12 };
}

/** Underwater look. Fog colour == camera background from the reference scene (sRGB). */
export const SEA_COLORS = {
  fog: [0, 0.1677149, 0.4528302] as const,
  fogDstMultiplier: 0.81,
};
