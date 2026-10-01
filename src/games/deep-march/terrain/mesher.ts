/**
 * Column mesher: CPU port of SebLague `MarchingCubes.compute` +
 * `MeshGenerator.UpdateChunkMesh`, generating one full-height column
 * (hard floor → hard ceiling) per job, with floating-rock removal.
 *
 * Global lattice: point (gi, gj, gk) sits at (-b/2 + g * spacing) on each axis,
 * spacing = boundsSize / (numPointsPerAxis - 1). Column (cx, cz) owns
 * gi ∈ [cx*(n-1), cx*(n-1) + n-2] (same for z) and meshes points
 * cx*(n-1) .. cx*(n-1)+n-1, so neighbouring columns share their seam points.
 *
 * Vertically a column spans lattice rows gjMin..gjMax, where both end rows are
 * "hard": the density's lower bound at that height exceeds isoLevel, i.e. solid
 * everywhere (below the undulating hard floor, above the rock ceiling). Those
 * rows anchor the rock.
 *
 * Passes: density grid (mesherSample.ts, slab skipping mesherRefine.ts / bricks.ts)
 * → floating rock removal (mesherFloaters.ts, floaterSearch.ts) → marching cubes
 * (mesherMarch.ts) → fine normals, skirts, AO, bounds (mesherSurface.ts).
 *
 * Other differences from the reference: gradient normals from the padded grid,
 * shared per-edge vertices (indexed), rows provably above/below iso (from
 * field.bounds) skip noise, and the field's vertical smoothing is assembled from
 * raw lattice rows (no extra noise evaluations). Mesh-only jobs run the passes
 * over sparse 8³ bricks (bricks.ts, same output; bricks off = dense).
 */
import { ALL_REGIONS_MASK, type DensityField } from "./density";
import { columnRegionMask, columnRowPlan, lodCoord, lodPoints, lodSpacing, type ColumnRows } from "./columnLattice";
import { buildColumnTerrainInfo, createLineSampler } from "./terrainInfoGen";
import type { ChunkTerrainInfo } from "./terrainInfo";
import { RegionWeightSampler, packRegionWeights, regionGridSpacing } from "./regionWeights";
import type { ColumnGrid, ColumnMeshData, ColumnStats } from "./mesherGrid";
import { sampleDensity } from "./mesherSample";
import { removeFloaters } from "./mesherFloaters";
import { marchCubes } from "./mesherMarch";
import { addSkirts, fineNormals, positionBounds, vertexAo } from "./mesherSurface";
import { mc } from "./mesherScratch";

export type { ColumnMeshData, ColumnStats } from "./mesherGrid";
export { columnRegionMask, columnRowPlan, columnRows, latticeCoord, latticeSpacing, lodCoord, lodPoints, lodSpacing, type ColumnRows, type RowPlan } from "./columnLattice";

export function generateColumnMesh(
  field: DensityField,
  cx: number,
  cz: number,
  rows: ColumnRows,
  floaterMargin: number,
  /** Debug/test: receives global (gi, gj, gk) of every removed point in the padded grid. */
  debugRemoved?: number[],
  /** Also build the terrain classification (ChunkTerrainInfo). Default true. */
  withInfo = true,
  /** Debug/test: final padded density grid after floater removal (index (k·py + j)·px + i, padding 1). */
  debugGrid?: (dens: Float32Array, px: number, py: number, pz: number) => void,
  /**
   * LOD level: lattice spacing × 2^lod, `rows` / (cx, cz) on that level's lattice
   * (columnRows(field, lod)). Levels > 0 mesh the unsmoothed field (the smoothing
   * kernel is finer than their cells), skip the terrain info, and add skirts.
   */
  lod = 0,
  /** Add skirt quads along the column sides (for LOD transitions). Default: lod > 0. */
  skirts = lod > 0,
): ColumnMeshData {
  const s = field.settings;
  const n = lodPoints(field, lod);
  const sp = lodSpacing(field, lod);
  const { gjMin, gjMax } = rows;
  const ny = gjMax - gjMin + 1;
  const gi0 = cx * (n - 1);
  const gk0 = cz * (n - 1);
  if (lod > 0) withInfo = false;

  // Row classification: 0 = sample, 1 = always water, 2 = always solid (hard).
  // rowFill: value written into skipped rows (a bound, so its side of iso is right).
  // The window mask covers floaterMargin = settings.floaterMargin; a larger margin falls back to all regions.
  const mask = floaterMargin <= s.floaterMargin * (1 << lod) ? columnRegionMask(field, cx, cz, lod) : ALL_REGIONS_MASK;
  const { rowFill, rowKind, rowSkip } = columnRowPlan(field, rows, mask, lod);
  // Padded grid: one extra lattice point on every side.
  const px = n + 2, py = ny + 2, pz = n + 2;
  const g: ColumnGrid = {
    field, iso: s.isoLevel, lod, n, sp, ny, px, py, pz, plane: px * py, size: px * py * pz,
    x0: lodCoord(gi0, field, lod), y0: lodCoord(gjMin, field, lod), z0: lodCoord(gk0, field, lod),
    gi0, gk0, gjMin, rowKind, rowFill, rowSkip,
  };
  const stats: ColumnStats = { floaters: 0, floaterPoints: 0, ambiguous: 0, searched: 0, noiseSamples: 0, rawPoints: 0, coarseSamples: 0 };

  const { dens, state, bricks } = sampleDensity(g, !withInfo && !debugGrid, stats);
  const removedList = removeFloaters(g, dens, state, bricks, floaterMargin, stats, debugRemoved);
  if (debugGrid) debugGrid(dens, px, py, pz);

  const marched = marchCubes(g, dens, state, bricks);
  if (lod > 0) fineNormals(field, sp, marched.vcount);
  const surfaceVerts = marched.vcount;
  const { vcount, icount, skirtSrc } = skirts ? addSkirts(sp, surfaceVerts, marched.icount) : { vcount: surfaceVerts, icount: marched.icount, skirtSrc: [] as number[] };

  const positions = mc.pos.slice(0, vcount * 3);
  const normals = mc.nrm.slice(0, vcount * 3);
  const indices = vcount <= 65535 ? Uint16Array.from(mc.idx.subarray(0, icount)) : mc.idx.slice(0, icount);
  const ao = vertexAo(field, positions, normals, surfaceVerts, vcount, skirtSrc);
  // macro-region weights for the material system: global grid → identical at every LOD
  // (classification-only info jobs don't render the mesh)
  const region = withInfo ? new Uint8Array(0) : packRegionWeights(positions, surfaceVerts, vcount, new RegionWeightSampler(field.regions, regionGridSpacing(field.settings.worldScale)), skirtSrc, field.wallWeight, field.crackWeight);
  let info: ChunkTerrainInfo | null = null;
  let infoMs = 0;
  if (withInfo) {
    const t0 = performance.now();
    info = buildColumnTerrainInfo({
      field, rows, cx, cz, dens, px, py, positions, normals, ao,
      sampler: createLineSampler(field, rows),
      floaterFree: stats.floaters === 0,
    });
    infoMs = performance.now() - t0;
  }
  const bounds = positionBounds(positions, vcount);
  return { positions, normals, ao, region, indices, surfaceVerts, bounds, removed: Int32Array.from(removedList), stats, info, infoMs };
}
