/**
 * Worker-side builder of ChunkTerrainInfo (see terrainInfo.ts for the format).
 * Runs inside generateColumnMesh after floater removal and meshing; uses the
 * column's final density grid for its own cells, a line sampler (bit-identical
 * to the mesher's own arithmetic) for a 3-cell ring, and the mesh vertices for
 * spawn candidates. No ray marching: vertical distances come from full-height
 * line scans, horizontal ones from ≤ 3-cell grid scans with linear refinement.
 *
 * Parts: geometry (infoGeom.ts), lines (infoLines.ts), class grid
 * (infoClassGrid.ts, long scans infoScans.ts), spawn candidates (infoSpawn.ts).
 */
import type { ChunkTerrainInfo } from "./terrainInfo";
import { infoGeom, type ColumnInfoInput } from "./infoGeom";
import { buildLines } from "./infoLines";
import { classifyCells } from "./infoClassGrid";
import { spawnCandidates } from "./infoSpawn";

export type { ColumnInfoInput } from "./infoGeom";
export { createLineSampler, lineCacheStats, type LineSampler } from "./infoLines";

export function buildColumnTerrainInfo(inp: ColumnInfoInput): ChunkTerrainInfo {
  const g = infoGeom(inp);
  const L = buildLines(inp, g);
  const grid = classifyCells(g, L);
  const spawn = spawnCandidates(inp, g, L, grid);
  const { S, C, ci0, cj0, ck0, nx, ny, nz } = g;
  const { env, up8, down8, side8, sides, regionId, regionW, regionEdge } = grid;
  return {
    cx: inp.cx, cz: inp.cz, stride: S, spacing: C, ci0, cj0, ck0, nx, ny, nz,
    env, up: up8, down: down8, side: side8, sides, regionId, regionW, regionEdge,
    spawn,
  };
}
