/**
 * The column lattice: global lattice / LOD lattice coordinates, the vertical
 * span of a column, and the per-field caches of the column row plans (which
 * rows are provably rock / water) and region masks. Shared by the mesher,
 * the brick passes, streaming and the terrain info (re-exported by mesher.ts).
 */
import { ALL_REGIONS_MASK, type DensityField } from "./density";

export type ColumnRows = { gjMin: number; gjMax: number };

/**
 * Per padded row j (j = 0 ↔ lattice row gjMin − 1): 0 = sample, 1 = always water,
 * 2 = always solid; rowFill = bound written into skipped rows; rowSkip = row and
 * its ±2 neighbours share a trivial kind. Identical for every column of a field.
 */
export type RowPlan = { py: number; rowKind: Uint8Array; rowFill: Float64Array; rowSkip: Uint8Array };

const planCache = new WeakMap<DensityField, Map<number, RowPlan>>();
const maskCache = new WeakMap<DensityField, Map<string, number>>();

/**
 * Regions (bitmask, + WALL_BIT) that can have non-zero weight anywhere a column's job reads
 * the field: its padded footprint plus the floater-search window. The column's
 * row plan uses only these regions' bounds, so rows that are always rock / water
 * *here* are skipped even though another region (e.g. the deep trench) needs them.
 */
export function columnRegionMask(field: DensityField, cx: number, cz: number, lod = 0): number {
  let m = maskCache.get(field);
  if (!m) maskCache.set(field, (m = new Map()));
  const key = `${lod},${cx},${cz}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const s = field.settings;
  const n = lodPoints(field, lod);
  // floater window: the same number of lattice cells at every LOD
  const Mi = Math.max(1, Math.ceil(s.floaterMargin / latticeSpacing(field))) + 2;
  const x0 = lodCoord(cx * (n - 1) - 1 - Mi, field, lod), x1 = lodCoord(cx * (n - 1) + n + Mi, field, lod);
  const z0 = lodCoord(cz * (n - 1) - 1 - Mi, field, lod), z1 = lodCoord(cz * (n - 1) + n + Mi, field, lod);
  // + WALL_BIT near the ring wall (bounded world): wider row bounds there
  const mask = field.regions.maskInRect(x0, z0, x1, z1) | field.wallMask(x0, z0, x1, z1);
  if (m.size > 20000) m.clear();
  m.set(key, mask);
  return mask;
}

export function columnRowPlan(field: DensityField, rows: ColumnRows, mask = ALL_REGIONS_MASK, lod = 0): RowPlan {
  let byMask = planCache.get(field);
  if (!byMask) planCache.set(field, (byMask = new Map()));
  const cacheKey = mask * 16 + lod;
  const cached = byMask.get(cacheKey);
  if (cached && cached.py === rows.gjMax - rows.gjMin + 3) return cached;
  const iso = field.settings.isoLevel;
  const sp = lodSpacing(field, lod);
  const y0 = lodCoord(rows.gjMin, field, lod);
  // LOD > 0 meshes the unsmoothed field (see generateColumnMesh)
  const boundsOf = lod > 0 ? field.rawBoundsForMask : field.boundsForMask;
  const py = rows.gjMax - rows.gjMin + 3;
  const rowFill = new Float64Array(py);
  const rowKind = new Uint8Array(py);
  const bnd = new Float64Array(2);
  for (let j = 0; j < py; j++) {
    boundsOf(mask, y0 + (j - 1) * sp, bnd);
    if (bnd[1] < iso) {
      rowKind[j] = 1;
      rowFill[j] = bnd[1];
    } else if (bnd[0] > iso) {
      rowKind[j] = 2;
      rowFill[j] = bnd[0];
    } else {
      rowKind[j] = 0;
      rowFill[j] = iso;
    }
  }
  const rowSkip = new Uint8Array(py);
  for (let j = 0; j < py; j++) {
    const k = rowKind[j];
    if (k === 0) continue;
    let ok = true;
    for (let d = -2; d <= 2 && ok; d++) {
      const jj = j + d;
      if (jj >= 0 && jj < py && rowKind[jj] !== k) ok = false;
    }
    rowSkip[j] = ok ? 1 : 0;
  }
  const plan = { py, rowKind, rowFill, rowSkip };
  byMask.set(cacheKey, plan);
  return plan;
}

export function latticeSpacing(field: DensityField): number {
  const s = field.settings;
  return s.boundsSize / (s.numPointsPerAxis - 1);
}

export function latticeCoord(g: number, field: DensityField): number {
  return -field.settings.boundsSize / 2 + g * latticeSpacing(field);
}

/**
 * LOD lattices: level L has spacing latticeSpacing · 2^L and the same origin, so its
 * points are a subset of the level-0 lattice and a level-L column (cx, cz) covers
 * exactly level-0 columns cx·2^L … cx·2^L + 2^L − 1 (quadtree-aligned).
 */
export function lodSpacing(field: DensityField, lod: number): number {
  const s = field.settings;
  return (s.boundsSize * (1 << lod)) / (lodPoints(field, lod) - 1);
}

/** Lattice points per column side at a LOD level: the same at every level (points of level L ⊂ level L − 1). */
export function lodPoints(field: DensityField, _lod: number): number {
  return field.settings.numPointsPerAxis;
}

export function lodCoord(g: number, field: DensityField, lod: number): number {
  return -field.settings.boundsSize / 2 + g * lodSpacing(field, lod);
}

/** Vertical lattice span of every column of a LOD level (same for all columns of a field). */
export function columnRows(field: DensityField, lod = 0): ColumnRows {
  const iso = field.settings.isoLevel;
  const b = new Float64Array(2);
  const hard = (gj: number) => {
    if (lod > 0) field.rawBoundsForMask(ALL_REGIONS_MASK, lodCoord(gj, field, lod), b);
    else field.bounds(latticeCoord(gj, field), b);
    return b[0] > iso;
  };
  const run = Math.max(8, 80 >> lod); // rows that must all be hard beyond the boundary row
  const allHard = (from: number, dir: number) => {
    for (let i = 0; i < run; i++) if (!hard(from + dir * i)) return false;
    return true;
  };
  let gjMin = 0;
  while (!allHard(gjMin, -1) && gjMin > -4000) gjMin--;
  let gjMax = 0;
  while (!allHard(gjMax, 1) && gjMax < 4000) gjMax++;
  return { gjMin, gjMax };
}
