import type { TerrainSettings } from "./config";

/** Messages between the main thread and `mesher.worker.ts`. */
export type MesherRequest =
  | { type: "init"; seed: number; settings: TerrainSettings }
  | { type: "chunk"; id: number; cx: number; cy: number; cz: number };

export type MesherResponse = {
  type: "chunk";
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  ms: number;
};
