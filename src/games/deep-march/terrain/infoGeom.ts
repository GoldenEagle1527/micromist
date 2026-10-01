/**
 * Geometry of one column's terrain classification (terrainInfoGen.ts): the
 * input record, the class sub-lattice (every `stride` lattice points) the column
 * owns, and the region-aware scan reach.
 */
import type { DensityField } from "./density";
import { columnRegionMask, latticeCoord, latticeSpacing, type ColumnRows } from "./columnLattice";
import { ENV_T } from "./terrainInfo";
import { REGION } from "./regions";
import type { LineSampler } from "./infoLines";

/** 8 horizontal directions (dx, dz): +x, +x+z, +z, −x+z, −x, −x−z, −z, +x−z. */
export const DIRS = [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1];

export type ColumnInfoInput = {
  field: DensityField;
  rows: ColumnRows;
  cx: number;
  cz: number;
  /** Padded final density grid of the column (index (k·py + j)·px + i, padding 1). */
  dens: Float32Array;
  px: number;
  py: number;
  positions: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  sampler: LineSampler;
  /** Test/reference: read own lines from the sampler too (ignores floater removal). */
  ownFromSampler?: boolean;
  /** Column removed no floating rock → its own lines equal the sampler bit-for-bit and may be cached. */
  floaterFree?: boolean;
};

export type InfoGeom = {
  field: DensityField;
  iso: number;
  /** Lattice points per axis and spacing. */
  n: number;
  sp: number;
  /** Class stride (lattice points) and class cell size (units). */
  S: number;
  C: number;
  gjMin: number;
  /** Lattice rows of the column and the world y of row gjMin. */
  nyL: number;
  y0: number;
  gi0: number;
  gk0: number;
  /** First class cell and class cell counts. */
  ci0: number;
  cj0: number;
  ck0: number;
  nx: number;
  ny: number;
  nz: number;
  /** Column near the cave warren / canyon belt (long scans). */
  longCol: boolean;
  /** Ring of sampled lines around the own cells (class cells). */
  RING: number;
};

export function infoGeom(inp: ColumnInfoInput): InfoGeom {
  const { field, rows, cx, cz } = inp;
  const s = field.settings;
  const iso = s.isoLevel;
  const n = s.numPointsPerAxis;
  const sp = latticeSpacing(field);
  const S = Math.max(1, Math.round(ENV_T.classSpacing / sp));
  const C = S * sp;
  const { gjMin, gjMax } = rows;
  const nyL = gjMax - gjMin + 1;
  const y0 = latticeCoord(gjMin, field);
  const gi0 = cx * (n - 1);
  const gk0 = cz * (n - 1);
  const ci0 = Math.ceil(gi0 / S), ci1 = Math.floor((gi0 + n - 2) / S);
  const ck0 = Math.ceil(gk0 / S), ck1 = Math.floor((gk0 + n - 2) / S);
  const cj0 = Math.ceil(gjMin / S), cj1 = Math.floor(gjMax / S);
  const nx = ci1 - ci0 + 1, nz = ck1 - ck0 + 1, ny = cj1 - cj0 + 1;
  // Region-aware reach: columns near the cave warren / canyon belt scan farther.
  const colMask = columnRegionMask(field, cx, cz);
  const longCol = (colMask & ((1 << REGION.CAVE) | (1 << REGION.CANYON))) !== 0;
  const RING = longCol ? ENV_T.ringAxisLong : ENV_T.ringAxis;
  return { field, iso, n, sp, S, C, gjMin, nyL, y0, gi0, gk0, ci0, cj0, ck0, nx, ny, nz, longCol, RING };
}
