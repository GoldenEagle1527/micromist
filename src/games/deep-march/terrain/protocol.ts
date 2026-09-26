import type { TerrainSettings } from "./config";
import type { ColumnStats } from "./mesher";
import type { ChunkTerrainInfo } from "./terrainInfo";

/** Messages between the main thread and `mesher.worker.ts`. */
export type MesherRequest =
  | { type: "init"; seed: number; settings: TerrainSettings }
  | { type: "column"; id: number; cx: number; cz: number };

export type MesherResponse = {
  type: "column";
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Removed floating lattice points owned by the column: (i, j, k) triplets. */
  removed: Int32Array;
  stats: ColumnStats;
  /** Generation-time terrain classification of the column. */
  info: ChunkTerrainInfo | null;
  infoMs: number;
  ms: number;
};
