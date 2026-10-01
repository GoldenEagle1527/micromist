/**
 * Floating rock removal of one column job (mesher.ts; 26-connectivity on solid
 * lattice points):
 *  1. flood from hard rows inside the padded column → anchored;
 *  2. every remaining solid component is searched best-first (floaterSearch.ts);
 *     only components that are provably floating are removed (density forced
 *     below iso), which makes the decision identical in every column that touches
 *     the same component as long as it fits inside each column's window.
 */
import { floodKeep, scratchI32 } from "./bricks";
import type { BrickGrid } from "./brickBase";
import { KEEP, NEIGHBOURS, REMOVED, SOLID, type ColumnGrid, type ColumnStats } from "./mesherGrid";
import { createComponentSearch } from "./floaterSearch";

/**
 * Removes floaters from `dens` / `state`; returns the removed lattice points owned
 * by the column ((i, j, k) triplets, j relative to gjMin). debugRemoved receives
 * global (gi, gj, gk) of every removed point in the padded grid.
 */
export function removeFloaters(
  g: ColumnGrid, dens: Float32Array, state: Uint8Array, bricks: BrickGrid | null, floaterMargin: number, stats: ColumnStats, debugRemoved?: number[],
): number[] {
  const { iso, n, ny, sp, px, py, pz, plane, size, gi0, gk0, gjMin, rowKind } = g;
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
  // flood the stacked points' in-grid component with `to`; returns the points marked
  const flood = (to: number): number => {
    let marked = 0;
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
        marked++;
      }
    }
    return marked;
  };
  if (bricks) {
    floodKeep(bricks, state, stack, sp_);
    sp_ = 0;
  } else flood(KEEP);

  // --- 2. search remaining components -----------------------------------
  const Mi = Math.max(1, Math.ceil(floaterMargin / sp));
  const search = createComponentSearch(g, state, Mi, stats);
  for (let idx = 0; idx < size; idx++) {
    if (state[idx] !== SOLID) continue;
    const result = search(idx);
    const to = result === 2 ? REMOVED : KEEP;
    state[idx] = to;
    stack[sp_++] = idx;
    // flood this in-grid component with the decision
    const marked = 1 + flood(to);
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
  return removedList;
}
