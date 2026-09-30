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
 * Floating rock removal (26-connectivity on solid lattice points):
 *  1. flood from hard rows inside the padded column → anchored;
 *  2. every remaining solid component is searched best-first (toward the hard
 *     rows) through the column *and* lazily sampled lattice points in a window
 *     `floaterMargin` units around it:
 *       - reaches a hard row / anchored point → keep;
 *       - reaches the window edge or the node cap → ambiguous → keep;
 *       - exhausted → the whole component is enclosed and unanchored → it is a
 *         true floater globally → remove (density forced below iso).
 *     Removal therefore only happens for components that are provably floating,
 *     which makes the decision identical in every column that touches the same
 *     component as long as it fits inside each column's window.
 *
 * Other differences from the reference: gradient normals from the padded grid,
 * shared per-edge vertices (indexed), rows provably above/below iso (from
 * field.bounds) skip noise, and the field's vertical smoothing is assembled from
 * raw lattice rows (no extra noise evaluations). Mesh-only jobs run the passes
 * over sparse 8³ bricks (bricks.ts, same output; bricks off = dense).
 */
import { ALL_REGIONS_MASK, type DensityField } from "./density";
import { columnRegionMask, columnRowPlan, latticeSpacing, lodCoord, lodPoints, lodSpacing, type ColumnRows } from "./columnLattice";
import { CORNER_OFFSETS, EDGE_CORNER_A, EDGE_CORNER_B, TRI_TABLE } from "./tables";
import { CLS_COARSE_SOLID, CLS_COARSE_WATER, coarseResolve, refineMargin } from "./refine";
import { REFINE_MARGIN4, assemble, brickGrid, cellMask, floodKeep, resolveCoarse, resolveNeed, scratchF32, scratchI32, scratchU8, type NeedResult } from "./bricks";
import { buildColumnTerrainInfo, createLineSampler } from "./terrainInfoGen";
import type { ChunkTerrainInfo } from "./terrainInfo";
import { RegionWeightSampler, packRegionWeights, regionGridSpacing } from "./regionWeights";

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

export { columnRegionMask, columnRowPlan, columnRows, latticeCoord, latticeSpacing, lodCoord, lodPoints, lodSpacing, type ColumnRows, type RowPlan } from "./columnLattice";

const SEARCH_NODE_CAP = 250_000;

let scratchPos = new Float32Array(1 << 16);
let scratchNrm = new Float32Array(1 << 16);
let scratchIdx = new Uint32Array(1 << 16);
let scratchGrad = new Float32Array(1 << 15);
/** Per vertex: bitmask of the column side planes its lattice edge lies in (skirts). */
let scratchSide = new Uint8Array(1 << 15);

function ensureScratch(n: number) {
  if (scratchPos.length >= n) return;
  let len = scratchPos.length;
  while (len < n) len *= 2;
  const p = new Float32Array(len);
  p.set(scratchPos);
  scratchPos = p;
  const q = new Float32Array(len);
  q.set(scratchNrm);
  scratchNrm = q;
  const g = new Float32Array(len / 3 + 1);
  g.set(scratchGrad.subarray(0, Math.min(scratchGrad.length, g.length)));
  scratchGrad = g;
  const sd = new Uint8Array(len / 3 + 1);
  sd.set(scratchSide.subarray(0, Math.min(scratchSide.length, sd.length)));
  scratchSide = sd;
}

const NEIGHBOURS: number[] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBOURS.push(dx, dy, dz);

// Grid point states
const WATER = 0;
const SOLID = 1;
const KEEP = 2;
const REMOVED = 3;

/** Binary max filter (Chebyshev radius rad) of a (k · py + j) · px + i grid. */
function dilate(src: Uint8Array, px: number, py: number, pz: number, rad: number): Uint8Array {
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

/**
 * Slab skipping with the coarse pre-pass (terrain/refine.ts): inconclusive raw
 * samples far from the surface are resolved from coarse nodes; exact samples
 * are taken within 2 lattice points of every final point that is uncertain or
 * borders an opposite certain status (i.e. wherever the surface can pass), so
 * the mesh matches full evaluation as long as the refine margin holds.
 */
function refineSamples(
  field: DensityField,
  cls: Uint8Array,
  raw: Float32Array,
  rawNeed: Uint8Array,
  rowSkip: Uint8Array,
  rowKind: Uint8Array,
  px: number,
  py: number,
  pz: number,
  RY: number,
  R: number,
  x0: number,
  z0: number,
  sp: number,
  yOf: (r: number) => number,
  margin: number,
  stats: ColumnStats,
): void {
  const iso = field.settings.isoLevel;
  const exact = new Uint8Array(cls.length);
  const rs = { coarseSamples: 0, resolved: 0, unresolved: 0 };
  coarseResolve(
    { px, RY, pz, rawNeed, cls, raw, exact },
    iso,
    margin,
    (i, r, k) => field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp),
    (i, r, k, bnd) => field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, bnd),
    rs,
  );
  stats.noiseSamples += rs.coarseSamples;
  stats.coarseSamples += rs.coarseSamples;
  // Final-point status: 1 certain water, 2 certain solid, 0 uncertain.
  const plane = px * py;
  const fs = new Uint8Array(plane * pz);
  for (let k = 0; k < pz; k++)
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      if (rowSkip[j]) {
        fs.fill(rowKind[j] === 2 ? 2 : 1, row, row + px);
        continue;
      }
      for (let i = 0; i < px; i++) {
        let w = true, sd = true;
        for (let t = 0; t <= 2 * R && (w || sd); t++) {
          const c = cls[(k * RY + j + t) * px + i];
          if (c !== 1 && c !== CLS_COARSE_WATER) w = false;
          if (c !== 2 && c !== CLS_COARSE_SOLID) sd = false;
        }
        fs[row + i] = w ? 1 : sd ? 2 : 0;
      }
    }
  const seeds = new Uint8Array(plane * pz);
  for (let idx = 0; idx < fs.length; idx++) {
    const f = fs[idx];
    if (f === 0) {
      seeds[idx] = 1;
      continue;
    }
    const i = idx % px, j = Math.floor(idx / px) % py, k = Math.floor(idx / plane);
    const o = 3 - f;
    if ((i > 0 && fs[idx - 1] === o) || (i < px - 1 && fs[idx + 1] === o) || (j > 0 && fs[idx - px] === o) || (j < py - 1 && fs[idx + px] === o) || (k > 0 && fs[idx - plane] === o) || (k < pz - 1 && fs[idx + plane] === o))
      seeds[idx] = 1;
  }
  const need = dilate(seeds, px, py, pz, 2);
  for (let k = 0; k < pz; k++) {
    const wz = z0 + (k - 1) * sp;
    for (let i = 0; i < px; i++) {
      const wx = x0 + (i - 1) * sp;
      for (let r = 0; r < RY; r++) {
        if (!rawNeed[r]) continue;
        const idx = (k * RY + r) * px + i;
        const c = cls[idx];
        if (c === 2 || exact[idx]) continue;
        let ex = c === 0;
        for (let j = Math.max(0, r - 2 * R), je = Math.min(py - 1, r); !ex && j <= je; j++)
          if (!rowSkip[j] && need[(k * py + j) * px + i]) ex = true;
        if (!ex) continue;
        raw[idx] = field.sampleRaw(wx, yOf(r), wz);
        stats.noiseSamples++;
      }
    }
  }
}

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
  const iso = s.isoLevel;
  const n = lodPoints(field, lod);
  const sp = lodSpacing(field, lod);
  const lc = (g: number) => lodCoord(g, field, lod);
  const { gjMin, gjMax } = rows;
  const ny = gjMax - gjMin + 1;
  const gi0 = cx * (n - 1);
  const gk0 = cz * (n - 1);
  const x0 = lc(gi0);
  const y0 = lc(gjMin);
  const z0 = lc(gk0);
  if (lod > 0) withInfo = false;

  // Padded grid: one extra lattice point on every side.
  const px = n + 2;
  const py = ny + 2;
  const pz = n + 2;
  const plane = px * py; // index = (k * py + j) * px + i   (padded coords)
  const size = plane * pz;
  const stats: ColumnStats = { floaters: 0, floaterPoints: 0, ambiguous: 0, searched: 0, noiseSamples: 0, rawPoints: 0, coarseSamples: 0 };

  // Row classification: 0 = sample, 1 = always water, 2 = always solid (hard).
  // rowFill: value written into skipped rows (a bound, so its side of iso is right).
  // The window mask covers floaterMargin = settings.floaterMargin; a larger margin falls back to all regions.
  const mask = floaterMargin <= s.floaterMargin * (1 << lod) ? columnRegionMask(field, cx, cz, lod) : ALL_REGIONS_MASK;
  const plan = columnRowPlan(field, rows, mask, lod);
  const { rowFill, rowKind, rowSkip } = plan;

  // field.sample is a vertical binomial blur of sampleRaw with taps K rows
  // apart, so the blurred value of every sampled row is assembled exactly from
  // raw rows j − half·K … j + half·K (each raw row evaluated once).
  const K = lod > 0 ? 1 : s.smoothCells;
  const SW = lod > 0 ? [1] : field.smoothWeights;
  const half = (SW.length - 1) / 2;
  const R = half * K; // raw-row padding on each side
  const rawNeed = new Uint8Array(py + 2 * R);
  for (let j = 0; j < py; j++) if (!rowSkip[j]) for (let d = 0; d <= 2 * R; d++) rawNeed[j + d] = 1;
  const RY = py + 2 * R;
  const skipSlabs = !withInfo && !debugGrid;
  const useBricks = skipSlabs && s.bricks !== false;
  const raw = useBricks ? scratchF32("raw", pz * RY * px) : new Float32Array(pz * RY * px); // index (k · RY + r) · px + i
  const yOf = (r: number) => y0 + (r - R - 1) * sp;
  for (let r = 0; r < RY; r++) if (rawNeed[r]) stats.rawPoints += px * pz;

  // Slab skipping (mesh-only jobs): a cheap conservative bound (field.rawClass)
  // classifies each raw sample as deep-rock cap (exact value, no noise), sure
  // water, or unknown. Exact samples are taken only where they can influence the
  // mesh: within 2 lattice points (gradient + edge reach) of any final point that
  // is not sure water. Everything else keeps its water bound (< iso), so the
  // marching-cubes output is bit-identical to sampling everything exactly.
  let need: NeedResult | null = null;
  if (!skipSlabs) {
    for (let k = 0; k < pz; k++) {
      const wz = z0 + (k - 1) * sp;
      // x/z outer, y inner: consecutive samples share (x, z) (per-line region context)
      for (let i = 0; i < px; i++) {
        const wx = x0 + (i - 1) * sp;
        for (let r = 0; r < RY; r++) {
          if (!rawNeed[r]) continue;
          raw[(k * RY + r) * px + i] = field.sampleRaw(wx, yOf(r), wz);
          stats.noiseSamples++;
        }
      }
    }
  } else {
    const cls = useBricks ? scratchU8("cls", pz * RY * px).fill(0) : new Uint8Array(pz * RY * px);
    const bnd = new Float64Array(1);
    for (let k = 0; k < pz; k++) {
      const wz = z0 + (k - 1) * sp;
      for (let i = 0; i < px; i++) {
        const wx = x0 + (i - 1) * sp;
        for (let r = 0; r < RY; r++) {
          if (!rawNeed[r]) continue;
          const idx = (k * RY + r) * px + i;
          const c = field.rawClass(wx, yOf(r), wz, bnd);
          cls[idx] = c;
          if (c !== 0) raw[idx] = bnd[0];
        }
      }
    }
    const margin = s.refine === false ? null : refineMargin(lod);
    if (useBricks) {
      const g = { px, RY, pz, rawNeed, cls, raw, exact: scratchU8("exact", cls.length).fill(0) };
      const at = (i: number, r: number, k: number) => field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp);
      if (margin !== null) {
        const c = resolveCoarse(g, iso, lod < REFINE_MARGIN4.length ? REFINE_MARGIN4[lod] : null, margin, at, (i, r, k, b) => field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, b));
        stats.noiseSamples += c;
        stats.coarseSamples += c;
      }
      const r = resolveNeed(g, brickGrid(px, py, pz), R, rowSkip, rowKind, at);
      stats.noiseSamples += r.evals;
      need = r.res;
    } else if (margin !== null) {
      refineSamples(field, cls, raw, rawNeed, rowSkip, rowKind, px, py, pz, RY, R, x0, z0, sp, yOf, margin, stats);
    } else {
      // final points that are not certainly water (seeds), dilated by 2 on every axis
      const seeds = new Uint8Array(size);
      for (let k = 0; k < pz; k++)
        for (let j = 0; j < py; j++) {
          const row = (k * py + j) * px;
          if (rowSkip[j]) {
            if (rowKind[j] !== 1) seeds.fill(1, row, row + px);
            continue;
          }
          for (let i = 0; i < px; i++)
            for (let t = 0; t <= 2 * R; t++)
              if (cls[(k * RY + j + t) * px + i] !== 1) {
                seeds[row + i] = 1;
                break;
              }
        }
      const need = dilate(seeds, px, py, pz, 2);
      for (let k = 0; k < pz; k++) {
        const wz = z0 + (k - 1) * sp;
        for (let i = 0; i < px; i++) {
          const wx = x0 + (i - 1) * sp;
          for (let r = 0; r < RY; r++) {
            if (!rawNeed[r]) continue;
            const idx = (k * RY + r) * px + i;
            const c = cls[idx];
            if (c === 2) continue;
            let exact = c === 0;
            for (let j = Math.max(0, r - 2 * R), je = Math.min(py - 1, r); !exact && j <= je; j++)
              if (!rowSkip[j] && need[(k * py + j) * px + i]) exact = true;
            if (!exact) continue;
            raw[idx] = field.sampleRaw(wx, yOf(r), wz);
            stats.noiseSamples++;
          }
        }
      }
    }
  }

  const bricks = useBricks ? brickGrid(px, py, pz) : null;
  const dens = bricks ? scratchF32("dens", size) : new Float32Array(size);
  const state = bricks ? scratchU8("state", size) : new Uint8Array(size);
  if (bricks) assemble(bricks, need!, raw, RY, SW, K, rowSkip, rowKind, rowFill, iso, dens, state);
  else for (let k = 0; k < pz; k++) {
    const rk = k * RY * px;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      if (rowSkip[j]) {
        dens.fill(rowFill[j], row, row + px);
        state.fill(rowKind[j] === 2 ? SOLID : WATER, row, row + px);
        continue;
      }
      const c = rk + (j + R) * px;
      for (let i = 0; i < px; i++) {
        let v = 0;
        for (let t = 0; t < SW.length; t++) v += SW[t] * raw[c + (t - half) * K * px + i];
        dens[row + i] = v;
        state[row + i] = v >= iso ? SOLID : WATER;
      }
    }
  }

  // --- 1. anchored flood from hard rows -------------------------------------
  const stack = bricks ? scratchI32("stack", size) : new Int32Array(size);
  let sp_ = 0;
  for (let j = 0; j < py; j++) {
    if (rowKind[j] !== 2) continue;
    // Rows whose neighbours are hard too are all rock: mark them without
    // flooding (the flood from boundary hard rows reaches everything else).
    const seed = !(j > 0 && rowKind[j - 1] === 2 && j + 1 < py && rowKind[j + 1] === 2);
    for (let k = 0; k < pz; k++) {
      for (let i = 0; i < px; i++) {
        const idx = (k * py + j) * px + i;
        if (state[idx] === SOLID) {
          state[idx] = KEEP;
          if (seed) stack[sp_++] = idx;
        }
      }
    }
  }
  const floodInGrid = (to: number) => {
    while (sp_ > 0) {
      const idx = stack[--sp_];
      const i = idx % px;
      const j = ((idx - i) / px) % py;
      const k = Math.floor(idx / plane);
      for (let q = 0; q < NEIGHBOURS.length; q += 3) {
        const ii = i + NEIGHBOURS[q], jj = j + NEIGHBOURS[q + 1], kk = k + NEIGHBOURS[q + 2];
        if (ii < 0 || jj < 0 || kk < 0 || ii >= px || jj >= py || kk >= pz) continue;
        const nidx = (kk * py + jj) * px + ii;
        if (state[nidx] !== SOLID) continue;
        state[nidx] = to;
        stack[sp_++] = nidx;
      }
    }
  };
  if (bricks) {
    floodKeep(bricks, state, stack, sp_);
    sp_ = 0;
  } else floodInGrid(KEEP);

  // --- 2. search remaining components -----------------------------------
  const Mi = Math.max(1, Math.ceil(floaterMargin / sp));
  // Window-local coords: padded grid i=0 ↔ lx = Mi.
  const WX = px + 2 * Mi;
  const WZ = pz + 2 * Mi;
  const wx0 = gi0 - 1 - Mi; // global gi at lx = 0
  const wz0 = gk0 - 1 - Mi;
  const keyOf = (lx: number, ly: number, lz: number) => (lz * WX + lx) * py + ly;
  const outsideSolid = new Map<number, boolean>(); // lazily sampled, shared by searches
  const isOutsideSolid = (lx: number, ly: number, lz: number): boolean => {
    const key = keyOf(lx, ly, lz);
    let v = outsideSolid.get(key);
    if (v === undefined) {
      if (rowKind[ly] === 2) v = true;
      else if (rowKind[ly] === 1) v = false;
      else {
        const ox = lc(wx0 + lx), oy = y0 + (ly - 1) * sp, oz = lc(wz0 + lz);
        v = (lod > 0 ? field.sampleRaw(ox, oy, oz) : field.sample(ox, oy, oz)) >= iso;
        stats.noiseSamples++;
      }
      outsideSolid.set(key, v);
    }
    return v;
  };
  const halfRows = Math.ceil(py / 2) + 1;
  const priority = (ly: number) => {
    // distance (rows) to the nearest hard row: greedy toward anchors
    let d = halfRows;
    for (let j = ly; j >= 0 && ly - j < d; j--) if (rowKind[j] === 2) { d = ly - j; break; }
    for (let j = ly; j < py && j - ly < d; j++) if (rowKind[j] === 2) { d = j - ly; break; }
    return d;
  };
  const rowPriority = new Int32Array(py);
  for (let j = 0; j < py; j++) rowPriority[j] = priority(j);

  /** 0 = anchored, 1 = ambiguous, 2 = exhausted (floating). */
  const search = (startIdx: number): number => {
    const buckets: number[][] = [];
    let minBucket = Infinity;
    const visited = new Set<number>();
    const push = (key: number, ly: number) => {
      const p = rowPriority[ly];
      (buckets[p] ??= []).push(key);
      if (p < minBucket) minBucket = p;
    };
    const si = startIdx % px;
    const sj = ((startIdx - si) / px) % py;
    const sk = Math.floor(startIdx / plane);
    const startKey = keyOf(si + Mi, sj, sk + Mi);
    visited.add(startKey);
    push(startKey, sj);
    let count = 0;
    while (minBucket < Infinity) {
      const b = buckets[minBucket];
      if (!b || b.length === 0) {
        minBucket++;
        if (minBucket >= buckets.length) minBucket = Infinity;
        continue;
      }
      const key = b.pop()!;
      if (++count > SEARCH_NODE_CAP) {
        stats.searched += count;
        return 1;
      }
      const ly = key % py;
      const rest = (key - ly) / py;
      const lx = rest % WX;
      const lz = (rest - lx) / WX;
      if (rowKind[ly] === 2) {
        stats.searched += count;
        return 0;
      }
      if (lx === 0 || lz === 0 || lx === WX - 1 || lz === WZ - 1) {
        stats.searched += count;
        return 1;
      }
      for (let q = 0; q < NEIGHBOURS.length; q += 3) {
        const nx = lx + NEIGHBOURS[q], nyy = ly + NEIGHBOURS[q + 1], nz = lz + NEIGHBOURS[q + 2];
        if (nyy < 0 || nyy >= py) continue;
        const nkey = keyOf(nx, nyy, nz);
        if (visited.has(nkey)) continue;
        const gx = nx - Mi, gz = nz - Mi;
        if (gx >= 0 && gz >= 0 && gx < px && gz < pz) {
          const st = state[(gz * py + nyy) * px + gx];
          if (st === KEEP) {
            stats.searched += count;
            return 0;
          }
          if (st !== SOLID) continue;
        } else if (!isOutsideSolid(nx, nyy, nz)) continue;
        visited.add(nkey);
        push(nkey, nyy);
      }
    }
    stats.searched += count;
    return 2;
  };

  for (let idx = 0; idx < size; idx++) {
    if (state[idx] !== SOLID) continue;
    const result = search(idx);
    const to = result === 2 ? REMOVED : KEEP;
    state[idx] = to;
    stack[sp_++] = idx;
    let marked = 1;
    // flood this in-grid component with the decision
    while (sp_ > 0) {
      const cur = stack[--sp_];
      const i = cur % px;
      const j = ((cur - i) / px) % py;
      const k = Math.floor(cur / plane);
      for (let q = 0; q < NEIGHBOURS.length; q += 3) {
        const ii = i + NEIGHBOURS[q], jj = j + NEIGHBOURS[q + 1], kk = k + NEIGHBOURS[q + 2];
        if (ii < 0 || jj < 0 || kk < 0 || ii >= px || jj >= py || kk >= pz) continue;
        const nidx = (kk * py + jj) * px + ii;
        if (state[nidx] !== SOLID) continue;
        state[nidx] = to;
        stack[sp_++] = nidx;
        marked++;
      }
    }
    if (result === 2) {
      stats.floaters++;
      stats.floaterPoints += marked;
    } else if (result === 1) stats.ambiguous++;
  }

  // Remove floaters from the density field; collect owned removed points.
  const removedList: number[] = [];
  if (!bricks || stats.floaters > 0) for (let k = 0; k < pz; k++) {
    for (let j = 0; j < py; j++) {
      for (let i = 0; i < px; i++) {
        const idx = (k * py + j) * px + i;
        if (state[idx] !== REMOVED) continue;
        dens[idx] = Math.min(dens[idx], iso - 1);
        const ui = i - 1, uj = j - 1, uk = k - 1;
        if (debugRemoved) debugRemoved.push(gi0 + ui, gjMin + uj, gk0 + uk);
        if (ui >= 0 && uk >= 0 && ui <= n - 2 && uk <= n - 2 && uj >= 0 && uj < ny) removedList.push(ui, uj, uk);
      }
    }
  }

  if (debugGrid) debugGrid(dens, px, py, pz);

  // --- 3. gradient normals + marching cubes ----------------------------------
  // The field is continuous, so a plain central difference on the grid works.
  const gradAt = (i: number, j: number, k: number, out: Float32Array, o: number) => {
    const pi = ((k + 1) * py + (j + 1)) * px + (i + 1);
    const inv = 1 / (2 * sp);
    out[o] = (dens[pi + 1] - dens[pi - 1]) * inv;
    out[o + 1] = (dens[pi + px] - dens[pi - px]) * inv;
    out[o + 2] = (dens[pi + plane] - dens[pi - plane]) * inv;
  };
  const ga = new Float32Array(3);
  const gb = new Float32Array(3);

  const cornerVal = new Float32Array(8);
  const cornerI = new Int32Array(8);
  const cornerJ = new Int32Array(8);
  const cornerK = new Int32Array(8);
  const edgeVertex = (bricks ? scratchI32("edgeVertex", n * ny * n * 3) : new Int32Array(n * ny * n * 3)).fill(-1);
  // sparse bricks: skip cell bricks whose corners all share a sign (same scan order)
  const cm = bricks ? cellMask(bricks, state) : null;
  let vcount = 0;
  let icount = 0;
  const tri = new Int32Array(3);

  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      if (rowSkip[j + 1] && rowSkip[j + 2] && rowKind[j + 1] === rowKind[j + 2]) continue;
      const cmRow = cm ? ((k >> 3) * cm.cby + (j >> 3)) * cm.cbx : 0;
      for (let i = 0; i < n - 1; i++) {
        if (cm && cm.mask[cmRow + (i >> 3)]) {
          i |= 7;
          continue;
        }
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const ci = i + CORNER_OFFSETS[c * 3];
          const cj = j + CORNER_OFFSETS[c * 3 + 1];
          const ck = k + CORNER_OFFSETS[c * 3 + 2];
          cornerI[c] = ci;
          cornerJ[c] = cj;
          cornerK[c] = ck;
          const v = dens[((ck + 1) * py + (cj + 1)) * px + (ci + 1)];
          cornerVal[c] = v;
          if (v < iso) cubeIndex |= 1 << c;
        }
        if (cubeIndex === 0 || cubeIndex === 255) continue;

        const base = cubeIndex * 16;
        for (let t = 0; TRI_TABLE[base + t] !== -1; t += 3) {
          for (let e = 0; e < 3; e++) {
            const edge = TRI_TABLE[base + t + e];
            let a = EDGE_CORNER_A[edge];
            let b = EDGE_CORNER_B[edge];
            if (cornerI[a] + cornerJ[a] + cornerK[a] > cornerI[b] + cornerJ[b] + cornerK[b]) {
              const tmp = a;
              a = b;
              b = tmp;
            }
            const ai = cornerI[a], aj = cornerJ[a], ak = cornerK[a];
            const axis = cornerI[b] !== ai ? 0 : cornerJ[b] !== aj ? 1 : 2;
            const key = ((ak * ny + aj) * n + ai) * 3 + axis;
            let vi = edgeVertex[key];
            if (vi < 0) {
              vi = vcount++;
              edgeVertex[key] = vi;
              ensureScratch(vcount * 3);
              const va = cornerVal[a];
              const vb = cornerVal[b];
              const f = Math.abs(vb - va) < 1e-9 ? 0.5 : (iso - va) / (vb - va);
              const o = vi * 3;
              scratchPos[o] = x0 + (ai + (cornerI[b] - ai) * f) * sp;
              scratchPos[o + 1] = y0 + (aj + (cornerJ[b] - aj) * f) * sp;
              scratchPos[o + 2] = z0 + (ak + (cornerK[b] - ak) * f) * sp;
              gradAt(ai, aj, ak, ga, 0);
              gradAt(cornerI[b], cornerJ[b], cornerK[b], gb, 0);
              let nx = -(ga[0] + (gb[0] - ga[0]) * f);
              let nyv = -(ga[1] + (gb[1] - ga[1]) * f);
              let nz = -(ga[2] + (gb[2] - ga[2]) * f);
              const len = Math.hypot(nx, nyv, nz) || 1;
              scratchGrad[vi] = len;
              nx /= len;
              nyv /= len;
              nz /= len;
              scratchNrm[o] = nx;
              scratchNrm[o + 1] = nyv;
              scratchNrm[o + 2] = nz;
              const bi = cornerI[b], bk = cornerK[b];
              scratchSide[vi] =
                (ai === 0 && bi === 0 ? 1 : 0) | (ai === n - 1 && bi === n - 1 ? 2 : 0) |
                (ak === 0 && bk === 0 ? 4 : 0) | (ak === n - 1 && bk === n - 1 ? 8 : 0);
            }
            tri[e] = vi;
          }
          if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
          if (scratchIdx.length < icount + 3) {
            const q = new Uint32Array(scratchIdx.length * 2);
            q.set(scratchIdx);
            scratchIdx = q;
          }
          // Like the reference (vertexC, vertexB, vertexA): reversed so CCW faces the water.
          scratchIdx[icount++] = tri[2];
          scratchIdx[icount++] = tri[1];
          scratchIdx[icount++] = tri[0];
        }
      }
    }
  }

  // --- 3b. fine-field normals on coarse levels ---------------------------------
  // A coarse lattice's central differences only see the field at its own spacing:
  // normals (and so the shader's floor / wall / moss split, triplanar weights and
  // AO) came out different per level, and surfaces visibly changed material when a
  // column swapped level. Re-derive them from the same field level 0 sees, at a
  // step of level 0's spacing (coarser for the far rings, whose vertices are too
  // sparse to carry that detail without speckle), so all levels shade alike.
  if (lod > 0) {
    const eps = Math.max(latticeSpacing(field), sp / 4);
    const inv = 1 / eps;
    const raw = field.sampleRaw;
    for (let v = 0; v < vcount; v++) {
      const o = v * 3;
      const x = scratchPos[o], y = scratchPos[o + 1], z = scratchPos[o + 2];
      // forward differences (4 evaluations instead of 6; the half-step offset is
      // far below what shading can show)
      const c = raw(x, y, z);
      const gx = (raw(x + eps, y, z) - c) * inv;
      const gy = (raw(x, y + eps, z) - c) * inv;
      const gz = (raw(x, y, z + eps) - c) * inv;
      const len = Math.hypot(gx, gy, gz);
      if (!(len > 1e-6)) continue; // keep the lattice normal
      // guard: never flip against the lattice normal (sub-cell features the coarse
      // surface doesn't have would shade it inside out)
      const dot = -(gx * scratchNrm[o] + gy * scratchNrm[o + 1] + gz * scratchNrm[o + 2]) / len;
      if (dot < 0.2) continue;
      scratchGrad[v] = len;
      scratchNrm[o] = -gx / len;
      scratchNrm[o + 1] = -gy / len;
      scratchNrm[o + 2] = -gz / len;
    }
  }

  // --- 4. skirts --------------------------------------------------------------
  // Columns of different LOD levels do not share seam vertices, so tiny cracks can
  // open along a level change. Every triangle edge lying in a column side plane
  // gets a skirt quad hanging from it into the rock (along −normal, 2 cells deep,
  // both windings): invisible inside rock where neighbours match, it fills the
  // crack where they don't. Skirt vertices come after the surface vertices.
  const surfaceVerts = vcount;
  const skirtSrcList: number[] = [];
  if (skirts) {
    const depth = 2 * sp;
    const skirtOf = new Int32Array(surfaceVerts).fill(-1);
    const skirtVert = (v: number) => {
      let q = skirtOf[v];
      if (q >= 0) return q;
      q = vcount++;
      ensureScratch(vcount * 3);
      skirtOf[v] = q;
      const o = v * 3, oq = q * 3;
      for (let a = 0; a < 3; a++) {
        scratchPos[oq + a] = scratchPos[o + a] - scratchNrm[o + a] * depth;
        scratchNrm[oq + a] = scratchNrm[o + a];
      }
      scratchSide[q] = 0;
      skirtSrcList.push(v);
      return q;
    };
    const triCount = icount;
    for (let t = 0; t < triCount; t += 3) {
      for (let e = 0; e < 3; e++) {
        const u = scratchIdx[t + e], v = scratchIdx[t + ((e + 1) % 3)];
        if (u >= surfaceVerts || v >= surfaceVerts || !(scratchSide[u] & scratchSide[v])) continue;
        const us = skirtVert(u), vs = skirtVert(v);
        if (scratchIdx.length < icount + 12) {
          const q = new Uint32Array(scratchIdx.length * 2);
          q.set(scratchIdx);
          scratchIdx = q;
        }
        scratchIdx.set([u, v, vs, u, vs, us, v, u, us, v, us, vs], icount);
        icount += 12;
      }
    }
  }

  const positions = scratchPos.slice(0, vcount * 3);
  const normals = scratchNrm.slice(0, vcount * 3);
  const indices = vcount <= 65535 ? Uint16Array.from(scratchIdx.subarray(0, icount)) : scratchIdx.slice(0, icount);
  // Ambient occlusion: compare the density a short way out along the normal
  // with what a flat surface (same gradient) would give. Concave spots — cave
  // corners, crevices, under overhangs — stay denser → darker.
  const ao = new Float32Array(vcount);
  const AO_STEPS = [0.8, 2.2];
  const AO_WEIGHTS = [0.55, 0.45];
  const skirtSrc = skirtSrcList;
  for (let v = 0; v < surfaceVerts; v++) {
    const o = v * 3;
    const g = Math.max(0.3, scratchGrad[v]);
    let occ = 0;
    for (let q = 0; q < AO_STEPS.length; q++) {
      const t = AO_STEPS[q];
      // Unsmoothed field with lattice-snapped region context: AO is a heuristic,
      // and this keeps it at 1 noise eval per tap.
      const d = field.sampleRawCoarse(positions[o] + normals[o] * t, positions[o + 1] + normals[o + 1] * t, positions[o + 2] + normals[o + 2] * t);
      const expected = g * t; // iso - d on a plane
      occ += AO_WEIGHTS[q] * Math.min(1, Math.max(0, 1 - (iso - d) / expected));
    }
    ao[v] = 1 - occ;
  }
  for (let q = surfaceVerts; q < vcount; q++) ao[q] = ao[skirtSrc[q - surfaceVerts]];
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
  const bounds = new Float32Array(6);
  if (vcount > 0) {
    bounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (let o = 0; o < positions.length; o += 3) {
      for (let a = 0; a < 3; a++) {
        const v = positions[o + a];
        if (v < bounds[a]) bounds[a] = v;
        if (v > bounds[a + 3]) bounds[a + 3] = v;
      }
    }
  }
  return { positions, normals, ao, region, indices, surfaceVerts, bounds, removed: Int32Array.from(removedList), stats, info, infoMs };
}
