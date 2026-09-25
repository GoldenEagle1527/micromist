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
  hardFloorHeight: number;
  hardFloorWeight: number;
  /** shaderParams.xy: terracing `(y % x) * y` */
  terraceHeight: number;
  terraceWeight: number;

  /**
   * Extension (not in the reference scene): rock ceiling. Above `ceilingHeight`
   * density rises by `ceilingSlope` per unit so the ocean becomes a vast cave.
   */
  ceilingHeight: number;
  ceilingSlope: number;
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
  terraceHeight: 5.08,
  terraceWeight: 1.06,

  ceilingHeight: 14,
  ceilingSlope: 3,
};

/**
 * Lighter preset for touch / low-core devices: coarser voxels (≈0.6× triangles)
 * and a shorter view distance.
 */
export function terrainForDevice(): TerrainSettings {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  if (!coarse && cores > 4) return TERRAIN;
  return { ...TERRAIN, numPointsPerAxis: 22, viewDistance: 34 };
}

/** SeaWorldColours / Sea World shader settings from the reference scene. */
export const SEA_COLORS = {
  /** Camera background == fog colour (sRGB). */
  fog: [0, 0.1677149, 0.4528302] as const,
  fogDstMultiplier: 0.81,
  /** shaderParams: h = ((y + pow(ny*.5+.5, z) * x) / y) % 1 */
  params: [2.2, 10.74, 1.11] as const,
  /** Gradient keys (sRGB) + times (0..65535). */
  keys: [
    [0.8207547, 0.0038714937, 0.0038714937, 0],
    [0.8396226, 0.6737195, 0.059407253, 10595],
    [0.5834407, 0.41131186, 0.745283, 22499],
    [0.16019939, 0.43997237, 0.754717, 35187],
    [0.13915095, 0.21354534, 0.5, 51277],
    [0.3688814, 0.063412234, 0.5377358, 59518],
    [0.81960785, 0.003921569, 0.003921569, 65535],
  ] as const,
};
