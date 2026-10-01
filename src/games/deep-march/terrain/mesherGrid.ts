/**
 * Shared shapes of one column job (mesher.ts): the output records, the padded
 * grid geometry every pass works on, the grid point states and the 26-neighbourhood.
 */
import type { DensityField } from "./density";
import type { ChunkTerrainInfo } from "./terrainInfo";

export type ColumnStats = {
  /** Components removed as floating rock. */
  floaters: number;
  floaterPoints: number;
  /** Components kept only because the search hit the window edge / cap. */
  ambiguous: number;
  /** Lattice points visited by component searches (incl. lazily sampled). */
  searched: number;
  noiseSamples: number;
  /** Raw lattice samples the column's density grid is assembled from (noiseSamples / rawPoints = fraction evaluated). */
  rawPoints: number;
  /** Coarse pre-pass (refine): exact coarse-node evaluations (included in noiseSamples). */
  coarseSamples: number;
};

export type ColumnMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex ambient occlusion (1 = open water, 0 = fully enclosed). */
  ao: Float32Array;
  /** Per-vertex macro-region weights, 8 bytes per vertex (regionWeights.ts). */
  region: Uint8Array;
  indices: Uint16Array | Uint32Array;
  /** Vertices before the skirts (the real surface; the sonar scan records only these). */
  surfaceVerts: number;
  /** Tight AABB of `positions` (incl. skirts): minX, minY, minZ, maxX, maxY, maxZ (empty mesh: zeros). */
  bounds: Float32Array;
  /** Removed (floating) lattice points owned by this column: (i, j, k) triplets, j relative to gjMin. */
  removed: Int32Array;
  stats: ColumnStats;
  /** Generation-time terrain classification (class grid + spawn candidates); null if not requested. */
  info: ChunkTerrainInfo | null;
  /** Time spent building `info`, ms. */
  infoMs: number;
};

/**
 * One column job's padded grid: one extra lattice point on every side, index
 * (k · py + j) · px + i (padded coords); rows gjMin.. of the LOD level's lattice.
 */
export type ColumnGrid = {
  field: DensityField;
  iso: number;
  lod: number;
  /** Lattice points per axis and spacing of the level. */
  n: number;
  sp: number;
  /** Unpadded rows. */
  ny: number;
  px: number;
  py: number;
  pz: number;
  plane: number;
  size: number;
  /** World position of unpadded point (0, 0, 0). */
  x0: number;
  y0: number;
  z0: number;
  /** Global lattice index of unpadded point (0, 0, 0). */
  gi0: number;
  gk0: number;
  gjMin: number;
  /** Row classification: 0 = sample, 1 = always water, 2 = always solid (hard). */
  rowKind: Uint8Array;
  /** Value written into skipped rows (a bound, so its side of iso is right). */
  rowFill: Float64Array;
  rowSkip: Uint8Array;
};

// Grid point states
export const WATER = 0;
export const SOLID = 1;
export const KEEP = 2;
export const REMOVED = 3;

/** 26-neighbourhood offsets (dx, dy, dz triplets). */
export const NEIGHBOURS: number[] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBOURS.push(dx, dy, dz);

/** Binary max filter (Chebyshev radius rad) of a (k · py + j) · px + i grid. */
export function dilate(src: Uint8Array, px: number, py: number, pz: number, rad: number): Uint8Array {
  const a = new Uint8Array(src.length);
  const pass = (from: Uint8Array, to: Uint8Array, len: number, stride: number) => {
    to.fill(0);
    for (let idx = 0; idx < from.length; idx++) {
      if (!from[idx]) continue;
      const c = Math.floor(idx / stride) % len;
      const lo = Math.max(0, c - rad) - c, hi = Math.min(len - 1, c + rad) - c;
      for (let d = lo; d <= hi; d++) to[idx + d * stride] = 1;
    }
  };
  const b = new Uint8Array(src.length);
  pass(src, a, px, 1);
  pass(a, b, py, px);
  pass(b, a, pz, px * py);
  return a;
}
