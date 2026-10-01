/**
 * Slab skipping on the dense (non-brick) path of a mesh-only column job
 * (mesher.ts sampleDensity): which inconclusive raw samples must be evaluated
 * exactly so the mesh matches full evaluation.
 */
import type { DensityField } from "./density";
import { CLS_COARSE_SOLID, CLS_COARSE_WATER, coarseResolve } from "./refine";
import { dilate, type ColumnStats } from "./mesherGrid";

/**
 * Slab skipping with the coarse pre-pass (terrain/refine.ts): inconclusive raw
 * samples far from the surface are resolved from coarse nodes; exact samples
 * are taken within 2 lattice points of every final point that is uncertain or
 * borders an opposite certain status (i.e. wherever the surface can pass), so
 * the mesh matches full evaluation as long as the refine margin holds.
 */
export function refineSamples(
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

/**
 * Without the coarse pre-pass: exact samples within 2 lattice points of every final
 * point that is not certainly water (seeds, dilated by 2 on every axis).
 */
export function dilatedSamples(
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
  size: number,
  stats: ColumnStats,
): void {
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
