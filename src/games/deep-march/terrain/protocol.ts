import type { TerrainSettings } from "./config";
import type { ColumnStats } from "./mesher";
import type { SiteLayout } from "./siteLayout";
import type { ChunkTerrainInfo } from "./terrainInfo";

/**
 * Messages between the main thread and `mesher.worker.ts`.
 * - init: world seed, terrain settings and the bounded world's site layout (or null);
 * - column: mesh of LOD-`lod` column (cx, cz) of the world field;
 * - info: terrain classification of base-scale column (cx, cz) (baseTerrain field), no mesh.
 */
export type MesherRequest =
  | { type: "init"; seed: number; settings: TerrainSettings; layout: SiteLayout | null }
  | { type: "column"; id: number; cx: number; cz: number; lod: number }
  | { type: "info"; id: number; cx: number; cz: number };

export type MesherResponse = {
  type: "column" | "info";
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  /** Macro-region weights, 8 bytes per vertex (regionWeights.ts). */
  region: Uint8Array;
  indices: Uint16Array | Uint32Array;
  /** Tight mesh AABB (min xyz, max xyz) — frustum culling. */
  bounds: Float32Array;
  /** Removed floating lattice points owned by the column: (i, j, k) triplets. */
  removed: Int32Array;
  stats: ColumnStats;
  /** Generation-time terrain classification (info jobs). */
  info: ChunkTerrainInfo | null;
  infoMs: number;
  ms: number;
};
