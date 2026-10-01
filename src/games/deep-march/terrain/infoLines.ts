/**
 * Full-height lattice lines of a column's classification (terrainInfoGen.ts):
 * own lines from the column's final density grid, a ring of lines around it from
 * a line sampler bit-identical to the mesher's own arithmetic (cached per field),
 * each with the nearest rock surface above / below every row.
 */
import type { DensityField } from "./density";
import { columnRegionMask, columnRowPlan, latticeCoord, latticeSpacing, type ColumnRows } from "./columnLattice";
import type { ColumnInfoInput, InfoGeom } from "./infoGeom";

export type LineSampler = (gi: number, gk: number, out: Float32Array) => void;

/**
 * Final density along the full-height lattice line (gi, gk), rows gjMin … gjMax,
 * computed exactly like the owning column's mesher does (same raw sample
 * coordinates, same row plan of the owning column's region mask, same smoothing
 * order, same Float32 rounding) — before floater removal.
 */
export function createLineSampler(field: DensityField, rows: ColumnRows): LineSampler {
  const s = field.settings;
  const n = s.numPointsPerAxis;
  const sp = latticeSpacing(field);
  const y0 = latticeCoord(rows.gjMin, field);
  const K = s.smoothCells;
  const SW = field.smoothWeights;
  const half = (SW.length - 1) / 2;
  const R = half * K;
  const fill = new Float32Array(1);
  let raw = new Float32Array(0);
  const needCache = new Map<number, Uint8Array>();
  return (gi, gk, out) => {
    const oi = Math.floor(gi / (n - 1)) * (n - 1);
    const ok = Math.floor(gk / (n - 1)) * (n - 1);
    const mask = columnRegionMask(field, oi / (n - 1), ok / (n - 1));
    const plan = columnRowPlan(field, rows, mask);
    const { py, rowSkip, rowFill } = plan;
    const ny = py - 2;
    let rawNeed = needCache.get(mask);
    if (!rawNeed) {
      rawNeed = new Uint8Array(py + 2 * R);
      for (let j = 0; j < py; j++) if (!rowSkip[j]) for (let d = 0; d <= 2 * R; d++) rawNeed[j + d] = 1;
      needCache.set(mask, rawNeed);
    }
    if (raw.length < py + 2 * R) raw = new Float32Array(py + 2 * R);
    const wx = latticeCoord(oi, field) + (gi - oi) * sp;
    const wz = latticeCoord(ok, field) + (gk - ok) * sp;
    for (let r = 0; r < py + 2 * R; r++) if (rawNeed[r]) raw[r] = field.sampleRaw(wx, y0 + (r - R - 1) * sp, wz);
    for (let ju = 0; ju < ny; ju++) {
      const j = ju + 1;
      if (rowSkip[j]) {
        fill[0] = rowFill[j];
        out[ju] = fill[0];
        continue;
      }
      const c = j + R;
      let v = 0;
      for (let t = 0; t < SW.length; t++) v += SW[t] * raw[c + (t - half) * K];
      out[ju] = v;
    }
  };
}

/**
 * Per-field cache of sampled lines (a worker meshes many neighbouring columns;
 * rings overlap each other and neighbours' own lines). Values are bit-identical
 * to fresh samples, so the cache never changes results.
 */
const LINE_CACHE_CAP = 6000;
const lineCaches = new WeakMap<DensityField, Map<number, Float32Array>>();
const lineKey = (gi: number, gk: number) => (gi + 50000) * 100000 + (gk + 50000);
function cachePut(cache: Map<number, Float32Array>, key: number, d: Float32Array) {
  if (cache.has(key)) return;
  if (cache.size >= LINE_CACHE_CAP) {
    // drop the oldest ~10 % (Map iterates in insertion order)
    let drop = LINE_CACHE_CAP / 10;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--drop <= 0) break;
    }
  }
  cache.set(key, d);
}
export const lineCacheStats = { hits: 0, misses: 0 };

export type Line = { d: Float32Array; above: Float32Array; below: Float32Array };

/** Line at class index offset (ix, iz) relative to the own-grid origin (may be in the ring). */
export type LineAt = (ix: number, iz: number) => Line;

export function buildLines(inp: ColumnInfoInput, g: InfoGeom): LineAt {
  const { dens, px, py } = inp;
  const { field, iso, sp, S, nyL, y0, gi0, gk0, ci0, ck0, nx, nz, RING } = g;
  const LW = nx + 2 * RING;
  const LD = nz + 2 * RING;
  const lines: Line[] = new Array(LW * LD);
  let cache = lineCaches.get(field);
  if (!cache) lineCaches.set(field, (cache = new Map()));
  const makeLine = (li: number, lk: number): Line => {
    const ci = ci0 - RING + li, ck = ck0 - RING + lk;
    let d: Float32Array;
    const key = lineKey(ci * S, ck * S);
    if (!inp.ownFromSampler && li >= RING && li < RING + nx && lk >= RING && lk < RING + nz) {
      d = new Float32Array(nyL);
      const i = ci * S - gi0, k = ck * S - gk0;
      for (let ju = 0; ju < nyL; ju++) d[ju] = dens[((k + 1) * py + (ju + 1)) * px + (i + 1)];
      if (inp.floaterFree) cachePut(cache, key, d);
    } else {
      const hit = inp.ownFromSampler ? undefined : cache.get(key);
      if (hit) {
        d = hit;
        lineCacheStats.hits++;
      } else {
        d = new Float32Array(nyL);
        inp.sampler(ci * S, ck * S, d);
        lineCacheStats.misses++;
        if (!inp.ownFromSampler) cachePut(cache, key, d);
      }
    }
    // Nearest rock surface above / below each row (linear crossing between rows).
    const above = new Float32Array(nyL);
    const below = new Float32Array(nyL);
    let a = Infinity;
    for (let ju = nyL - 1; ju >= 0; ju--) {
      const y = y0 + ju * sp;
      if (d[ju] >= iso) a = y;
      else if (ju + 1 < nyL && d[ju + 1] >= iso) a = y + ((iso - d[ju]) / (d[ju + 1] - d[ju])) * sp;
      above[ju] = a;
    }
    let b = -Infinity;
    for (let ju = 0; ju < nyL; ju++) {
      const y = y0 + ju * sp;
      if (d[ju] >= iso) b = y;
      else if (ju > 0 && d[ju - 1] >= iso) b = y - ((iso - d[ju]) / (d[ju - 1] - d[ju])) * sp;
      below[ju] = b;
    }
    return { d, above, below };
  };
  for (let lk = 0; lk < LD; lk++) for (let li = 0; li < LW; li++) lines[lk * LW + li] = makeLine(li, lk);
  return (ix: number, iz: number) => lines[(iz + RING) * LW + ix + RING];
}
