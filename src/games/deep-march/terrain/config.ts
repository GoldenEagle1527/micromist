/**
 * Terrain + chunk settings. Values mirror SebLague/Marching-Cubes
 * `Scenes/Submarine.unity` (NoiseDensity + MeshGenerator components) unless noted.
 */
export type TerrainSettings = {
  /** Mesh generator */
  isoLevel: number;
  boundsSize: number;
  numPointsPerAxis: number;
  /** Added inside the noise lookup (MeshGenerator.offset). */
  offset: [number, number, number];
  viewDistance: number;

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

  /** Higher-frequency erosion detail (plain simplex, ±amplitude). */
  erosionFrequency: number;
  erosionAmplitude: number;

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
};

export const TERRAIN: TerrainSettings = {
  isoLevel: 8,
  boundsSize: 10,
  numPointsPerAxis: 30,
  offset: [-0.64, 0, 0],
  viewDistance: 42,

  octaves: 8,
  lacunarity: 2,
  persistence: 0.54,
  noiseScale: 2.71,
  noiseWeight: 11.24,
  floorOffset: 1,
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

  erosionFrequency: 0.55,
  erosionAmplitude: 1.1,

  ceilingHeight: 14,
  ceilingSlope: 4,
  ceilingRamp: 2,
  ceilingUndulation: 3,

  floaterMargin: 12,
};

/** Touch / low-core devices get the light preset (coarser voxels, 512px textures). */
export function isLowSpecDevice(): boolean {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return coarse || cores <= 4;
}

/** Lighter preset: coarser voxels (≈0.6× triangles) and a shorter view distance. */
export function terrainForDevice(lowSpec = isLowSpecDevice()): TerrainSettings {
  return lowSpec ? { ...TERRAIN, numPointsPerAxis: 22, viewDistance: 34 } : TERRAIN;
}

/** Underwater look. Fog colour == camera background from the reference scene (sRGB). */
export const SEA_COLORS = {
  fog: [0, 0.1677149, 0.4528302] as const,
  fogDstMultiplier: 0.81,
};
