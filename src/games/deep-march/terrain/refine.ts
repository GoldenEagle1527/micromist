/**
 * Coarse pre-pass for the mesher's slab skipping ("refine near the surface").
 *
 * The mesher needs exact raw samples only near the iso-surface. Before this
 * pass, every raw sample whose cheap bound (field.rawClass) was inconclusive
 * got the full noise evaluation — mostly solid rock and open water far from
 * any surface. Here the field is first evaluated on a coarse sub-lattice
 * (every REFINE_STEP points on each axis, clamped to the grid edges, cached);
 * an inconclusive raw sample whose 8 surrounding coarse nodes all lie on the
 * same side of iso by more than the margin is marked certain (water / solid)
 * and stores the trilinear value. The mesher then evaluates exactly only
 * around final points that are still uncertain or border an opposite
 * certain status (whole neighbourhoods, same dilation as before), so the
 * marching-cubes output and the floater removal are identical to full
 * evaluation as long as the margin holds.
 *
 * The margin is empirical (scripts/deep-march-refine-test.ts measures the
 * smallest margin with zero sign misses per LOD; the table is 2× that).
 * ?refine=0 (TerrainSettings.refine = false) disables the pass.
 */

/** Coarse node spacing in lattice points. */
export const REFINE_STEP = 2;

/**
 * Required |value − iso| of every coarse corner (density units, world field)
 * per LOD level. On the 1 u lattice (coarse cells 2 u at L0) the refine test
 * (3 seeds × 12 columns) needs 1.79 for 0 sign misses at L0; 8 is > 4× that.
 * L1+ are off: their coarse cells span 4+ u, the needed margin jumps to 14–31
 * and the saving is ≤ 10%.
 */
export const REFINE_MARGIN: readonly number[] = [8];

/** Margin for LOD `lod`, or null when the coarse pass is off at that level. */
export function refineMargin(lod: number): number | null {
  return lod < REFINE_MARGIN.length ? REFINE_MARGIN[lod] : null;
}

/** Raw sample classes (cls array): 0 unknown, 1 sure water (bound), 2 deep-rock cap (exact); added here: */
export const CLS_COARSE_WATER = 3;
export const CLS_COARSE_SOLID = 4;

export interface RefineGrid {
  px: number;
  RY: number;
  pz: number;
  /** Raw rows used by the mesher. */
  rawNeed: Uint8Array;
  /** Per raw sample (index (k · RY + r) · px + i) class, updated in place. */
  cls: Uint8Array;
  /** Raw values, updated in place (coarse-resolved samples get the trilinear value). */
  raw: Float32Array;
  /** Set to 1 where raw holds an exact evaluation made here (no re-evaluation needed). */
  exact: Uint8Array;
}

export interface RefineStats {
  /** Exact evaluations made by the coarse pass. */
  coarseSamples: number;
  /** Inconclusive samples resolved to certain water / solid. */
  resolved: number;
  /** Inconclusive samples left uncertain. */
  unresolved: number;
}

/** Cell [lo, hi] on one axis of `len` points with coarse nodes every `step` (plus the last point). */
function cellLo(c: number, len: number, step: number): number {
  const last = len - 1;
  const maxLo = last - (last % step === 0 ? step : last % step);
  return Math.max(0, Math.min(c - (c % step), maxLo));
}

/**
 * Resolve inconclusive raw samples from coarse nodes.
 * - sampleRaw(i, r, k): exact raw value at grid point;
 * - rawClass(i, r, k, bnd): the cheap bound class (only called on rows the mesher did not classify).
 */
export function coarseResolve(
  g: RefineGrid,
  iso: number,
  margin: number,
  sampleRaw: (i: number, r: number, k: number) => number,
  rawClass: (i: number, r: number, k: number, bnd: Float64Array) => number,
  stats: RefineStats,
  step = REFINE_STEP,
  /** Test hook: every inconclusive sample whose corners share a side, with the smallest corner |value − iso|. */
  onGap?: (idx: number, gap: number, solid: boolean) => void,
): void {
  const { px, RY, pz, rawNeed, cls, raw, exact } = g;
  const cache = new Float32Array(px * RY * pz).fill(NaN);
  const bnd = new Float64Array(1);
  const node = (i: number, r: number, k: number): number => {
    const idx = (k * RY + r) * px + i;
    let v = cache[idx];
    if (v === v) return v;
    const c = rawNeed[r] ? cls[idx] : rawClass(i, r, k, bnd);
    if (rawNeed[r]) {
      if (c !== 0) v = raw[idx];
    } else if (c !== 0) v = bnd[0];
    if (v !== v) {
      v = sampleRaw(i, r, k);
      stats.coarseSamples++;
      if (rawNeed[r]) {
        raw[idx] = v;
        exact[idx] = 1;
      }
    }
    cache[idx] = v;
    return v;
  };
  const lo = iso - margin, hi = iso + margin;
  for (let k = 0; k < pz; k++) {
    const k0 = cellLo(k, pz, step), k1 = Math.min(k0 + step, pz - 1);
    const fz = (k - k0) / (k1 - k0);
    for (let i = 0; i < px; i++) {
      const i0 = cellLo(i, px, step), i1 = Math.min(i0 + step, px - 1);
      const fx = (i - i0) / (i1 - i0);
      for (let r = 0; r < RY; r++) {
        if (!rawNeed[r]) continue;
        const idx = (k * RY + r) * px + i;
        if (cls[idx] !== 0) continue;
        const r0 = cellLo(r, RY, step), r1 = Math.min(r0 + step, RY - 1);
        const c000 = node(i0, r0, k0), c100 = node(i1, r0, k0), c010 = node(i0, r1, k0), c110 = node(i1, r1, k0);
        const c001 = node(i0, r0, k1), c101 = node(i1, r0, k1), c011 = node(i0, r1, k1), c111 = node(i1, r1, k1);
        const mn = Math.min(c000, c100, c010, c110, c001, c101, c011, c111);
        const mx = Math.max(c000, c100, c010, c110, c001, c101, c011, c111);
        if (onGap && (mx < iso || mn > iso)) onGap(idx, mx < iso ? iso - mx : mn - iso, mn > iso);
        let c: number;
        if (mx < lo) c = CLS_COARSE_WATER;
        else if (mn > hi) c = CLS_COARSE_SOLID;
        else {
          stats.unresolved++;
          continue;
        }
        stats.resolved++;
        cls[idx] = c;
        if (exact[idx]) continue; // a coarse node itself: keep the exact value
        const fy = (r - r0) / (r1 - r0);
        const a0 = c000 + (c100 - c000) * fx, a1 = c010 + (c110 - c010) * fx;
        const b0 = c001 + (c101 - c001) * fx, b1 = c011 + (c111 - c011) * fx;
        const a = a0 + (a1 - a0) * fy, b = b0 + (b1 - b0) * fy;
        raw[idx] = a + (b - a) * fz;
      }
    }
  }
}
