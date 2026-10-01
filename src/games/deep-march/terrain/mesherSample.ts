/**
 * Density grid of one column job (mesher.ts): raw lattice rows → vertically
 * smoothed padded grid + solid / water state.
 *
 * field.sample is a vertical binomial blur of sampleRaw with taps K rows apart, so
 * the blurred value of every sampled row is assembled exactly from raw rows
 * j − half·K … j + half·K (each raw row evaluated once).
 *
 * Slab skipping (mesh-only jobs): a cheap conservative bound (field.rawClass)
 * classifies each raw sample as deep-rock cap (exact value, no noise), sure water,
 * or unknown. Exact samples are taken only where they can influence the mesh:
 * within 2 lattice points (gradient + edge reach) of any final point that is not
 * sure water. Everything else keeps its water bound (< iso), so the marching-cubes
 * output is bit-identical to sampling everything exactly. Mesh-only jobs run this
 * over sparse 8³ bricks (bricks.ts, same output; bricks off = dense).
 */
import { refineMargin } from "./refine";
import { REFINE_MARGIN4, assemble, brickGrid, resolveCoarse, resolveNeed, scratchF32, scratchU8, type NeedResult } from "./bricks";
import type { BrickGrid } from "./brickBase";
import { SOLID, WATER, type ColumnGrid, type ColumnStats } from "./mesherGrid";
import { dilatedSamples, refineSamples } from "./mesherRefine";

export type SampledDensity = { dens: Float32Array; state: Uint8Array; bricks: BrickGrid | null };

/** skipSlabs: mesh-only job (no terrain info / debug grid), so slab skipping applies. */
export function sampleDensity(g: ColumnGrid, skipSlabs: boolean, stats: ColumnStats): SampledDensity {
  const { field, iso, lod, sp, px, py, pz, size, x0, y0, z0, rowFill, rowKind, rowSkip } = g;
  const s = field.settings;
  const K = lod > 0 ? 1 : s.smoothCells;
  const SW = lod > 0 ? [1] : field.smoothWeights;
  const half = (SW.length - 1) / 2;
  const R = half * K; // raw-row padding on each side
  const rawNeed = new Uint8Array(py + 2 * R);
  for (let j = 0; j < py; j++) if (!rowSkip[j]) for (let d = 0; d <= 2 * R; d++) rawNeed[j + d] = 1;
  const RY = py + 2 * R;
  const useBricks = skipSlabs && s.bricks !== false;
  const raw = useBricks ? scratchF32("raw", pz * RY * px) : new Float32Array(pz * RY * px); // index (k · RY + r) · px + i
  const yOf = (r: number) => y0 + (r - R - 1) * sp;
  for (let r = 0; r < RY; r++) if (rawNeed[r]) stats.rawPoints += px * pz;

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
      const bg = { px, RY, pz, rawNeed, cls, raw, exact: scratchU8("exact", cls.length).fill(0) };
      const at = (i: number, r: number, k: number) => field.sampleRaw(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp);
      if (margin !== null) {
        const c = resolveCoarse(bg, iso, lod < REFINE_MARGIN4.length ? REFINE_MARGIN4[lod] : null, margin, at, (i, r, k, b) => field.rawClass(x0 + (i - 1) * sp, yOf(r), z0 + (k - 1) * sp, b));
        stats.noiseSamples += c;
        stats.coarseSamples += c;
      }
      const r = resolveNeed(bg, brickGrid(px, py, pz), R, rowSkip, rowKind, at);
      stats.noiseSamples += r.evals;
      need = r.res;
    } else if (margin !== null) {
      refineSamples(field, cls, raw, rawNeed, rowSkip, rowKind, px, py, pz, RY, R, x0, z0, sp, yOf, margin, stats);
    } else {
      dilatedSamples(field, cls, raw, rawNeed, rowSkip, rowKind, px, py, pz, RY, R, x0, z0, sp, yOf, size, stats);
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
  return { dens, state, bricks };
}
