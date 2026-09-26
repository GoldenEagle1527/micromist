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
  /**
   * Far rings (level ≥ farLodFrom) use this many cells per column side instead of
   * numPointsPerAxis − 1 (same footprint, coarser lattice): they are hundreds of metres
   * away in fog, so fewer triangles / samples. 0 = off.
   */
  farLodCells: number;
  farLodFrom: number;
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
};

export const TERRAIN: TerrainSettings = {
  isoLevel: 8,
  worldScale: 4,
  boundsSize: 10,
  numPointsPerAxis: 30,
  offset: [-0.64, 0, 0],
  viewDistance: 420,
  lodLevels: 5,
  lodNear: 20,
  farLodCells: 22, // 29 → 22 cells: L3 / L4 spacing × 1.32, ≈ 0.58× triangles
  farLodFrom: 3,
  infoRadius: 22,

  octaves: 10, // reference 8 + log2(worldScale): fine detail at the diver's scale
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
  smoothTaps: 5,

  erosionFrequency: 0.55,
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

/** Lighter preset: coarser voxels (≈0.6× triangles), fewer LOD rings, a shorter view distance. */
export function terrainForDevice(lowSpec = isLowSpecDevice()): TerrainSettings {
  return lowSpec ? { ...TERRAIN, numPointsPerAxis: 22, viewDistance: 230, lodLevels: 4, lodNear: 18, infoRadius: 14, farLodCells: 16 } : TERRAIN;
}

/**
 * Base-scale settings (worldScale 1, the reference 8 octaves): the terrain
 * classification runs on this field — the world field at p / S — so its
 * class thresholds and scan reach keep their meaning at every world scale.
 */
export function baseTerrain(s: TerrainSettings): TerrainSettings {
  return { ...s, worldScale: 1, octaves: Math.max(1, s.octaves - Math.round(Math.log2(s.worldScale))), floaterMargin: 12 };
}

/** Underwater look. Fog colour == camera background from the reference scene (sRGB). */
export const SEA_COLORS = {
  fog: [0, 0.1677149, 0.4528302] as const,
  fogDstMultiplier: 0.81,
};
