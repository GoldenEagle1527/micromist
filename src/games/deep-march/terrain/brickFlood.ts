/** Sparse bricks: density assembly, the anchored flood and the marching-cubes skip mask (see bricks.ts for the whole scheme). */
import { BRICK, type BrickGrid, KEEP, SH, SOLID, WATER, scratchI32, scratchU8 } from "./brickBase";
import type { NeedResult } from "./brickNeed";

/**
 * Density + state of the padded grid. Need points get the exact smoothed value;
 * everything else only its (certain) side of iso.
 */
export function assemble(
  B: BrickGrid,
  n: NeedResult,
  raw: Float32Array,
  RY: number,
  SW: readonly number[],
  K: number,
  rowSkip: Uint8Array,
  rowKind: Uint8Array,
  rowFill: Float64Array,
  iso: number,
  dens: Float32Array,
  state: Uint8Array,
): void {
  const { px, py, pz, bx, by } = B;
  const half = (SW.length - 1) / 2;
  const R = half * K;
  const { fs, need, active, brickFs } = n;
  const wLo = iso - 1, sHi = iso + 1;
  for (let k = 0; k < pz; k++) {
    const rk = k * RY * px;
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      if (rowSkip[j]) {
        dens.fill(rowFill[j], row, row + px);
        state.fill(rowKind[j] === 2 ? SOLID : WATER, row, row + px);
        continue;
      }
      const c = rk + (j + R) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i0 = 0; i0 < px; i0 += BRICK) {
        const i1 = Math.min(px, i0 + BRICK);
        const b = bj + (i0 >> SH);
        if (!active[b]) {
          const solid = brickFs[b] === 2;
          dens.fill(solid ? sHi : wLo, row + i0, row + i1);
          state.fill(solid ? SOLID : WATER, row + i0, row + i1);
          continue;
        }
        for (let i = i0; i < i1; i++) {
          if (!need[row + i]) {
            const solid = fs[row + i] === 2;
            dens[row + i] = solid ? sHi : wLo;
            state[row + i] = solid ? SOLID : WATER;
            continue;
          }
          let v = 0;
          for (let t = 0; t < SW.length; t++) v += SW[t] * raw[c + (t - half) * K * px + i];
          dens[row + i] = v;
          state[row + i] = v >= iso ? SOLID : WATER;
        }
      }
    }
  }
}

const NB: number[] = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NB.push(dx, dy, dz);

/**
 * Anchored flood (26-connectivity) from the `sp` seed points on `stack`: every
 * SOLID point connected to them becomes KEEP. All-rock bricks are marked whole.
 */
export function floodKeep(B: BrickGrid, state: Uint8Array, stack: Int32Array, sp: number): void {
  const { px, py, pz, bx, by, bz } = B;
  const plane = px * py;
  // bricks whose points are all rock (SOLID or KEEP)
  const rockCnt = scratchI32("rockCnt", B.count).fill(0);
  for (let k = 0; k < pz; k++) {
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i = 0; i < px; i++) if (state[row + i] !== WATER) rockCnt[bj + (i >> SH)]++;
    }
  }
  const full = scratchU8("fullBrick", B.count);
  const lo = (c: number) => c << SH;
  const hiX = (c: number) => Math.min(px, (c + 1) << SH), hiY = (c: number) => Math.min(py, (c + 1) << SH), hiZ = (c: number) => Math.min(pz, (c + 1) << SH);
  for (let cz = 0; cz < bz; cz++)
    for (let cy = 0; cy < by; cy++)
      for (let cx = 0; cx < bx; cx++) {
        const b = (cz * by + cy) * bx + cx;
        const vol = (hiX(cx) - lo(cx)) * (hiY(cy) - lo(cy)) * (hiZ(cz) - lo(cz));
        // 0 = has water (walk points), 1 = all rock not yet flooded, 2 = flooded, 3 = no rock at all
        full[b] = rockCnt[b] === vol ? 1 : rockCnt[b] === 0 ? 3 : 0;
      }
  const bstack = scratchI32("bstack", B.count);
  let bs = 0;
  const floodBrick = (b: number) => {
    full[b] = 2;
    const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
    const i1 = hiX(cx), j1 = hiY(cy), k1 = hiZ(cz);
    for (let k = lo(cz); k < k1; k++)
      for (let j = lo(cy); j < j1; j++) {
        const row = (k * py + j) * px;
        for (let i = lo(cx); i < i1; i++) if (state[row + i] === SOLID) state[row + i] = KEEP;
      }
    bstack[bs++] = b;
  };
  while (sp > 0 || bs > 0) {
    if (bs > 0) {
      const b = bstack[--bs];
      const cx = b % bx, cy = Math.floor(b / bx) % by, cz = Math.floor(b / (bx * by));
      for (let q = 0; q < NB.length; q += 3) {
        const dx = NB[q], dy = NB[q + 1], dz = NB[q + 2];
        const x = cx + dx, y = cy + dy, z = cz + dz;
        if (x < 0 || y < 0 || z < 0 || x >= bx || y >= by || z >= bz) continue;
        const nb = (z * by + y) * bx + x;
        const f = full[nb];
        if (f === 1) {
          floodBrick(nb);
          continue;
        }
        if (f !== 0) continue;
        // mixed neighbour: its points within one step of this brick
        const i0 = dx === 0 ? lo(x) : dx > 0 ? lo(x) : hiX(x) - 1, i1 = dx === 0 ? hiX(x) - 1 : i0;
        const j0 = dy === 0 ? lo(y) : dy > 0 ? lo(y) : hiY(y) - 1, j1 = dy === 0 ? hiY(y) - 1 : j0;
        const k0 = dz === 0 ? lo(z) : dz > 0 ? lo(z) : hiZ(z) - 1, k1 = dz === 0 ? hiZ(z) - 1 : k0;
        for (let k = k0; k <= k1; k++)
          for (let j = j0; j <= j1; j++) {
            const row = (k * py + j) * px;
            for (let i = i0; i <= i1; i++)
              if (state[row + i] === SOLID) {
                state[row + i] = KEEP;
                stack[sp++] = row + i;
              }
          }
      }
      continue;
    }
    const idx = stack[--sp];
    const i = idx % px;
    const j = ((idx - i) / px) % py;
    const k = (idx - j * px - i) / plane;
    for (let q = 0; q < NB.length; q += 3) {
      const ii = i + NB[q], jj = j + NB[q + 1], kk = k + NB[q + 2];
      if (ii < 0 || jj < 0 || kk < 0 || ii >= px || jj >= py || kk >= pz) continue;
      const nidx = (kk * py + jj) * px + ii;
      if (state[nidx] !== SOLID) continue;
      const nb = ((kk >> SH) * by + (jj >> SH)) * bx + (ii >> SH);
      if (full[nb] === 1) floodBrick(nb);
      else {
        state[nidx] = KEEP;
        stack[sp++] = nidx;
      }
    }
  }
}

/**
 * Marching-cubes skip mask over cell bricks: cell (i, j, k) (corners at padded
 * i+1 … i+2 etc.) lies in cell brick (i>>3, j>>3, k>>3); 1 = every corner of every
 * cell in it has the same sign (KEEP = rock after floater removal), no triangles.
 */
export function cellMask(B: BrickGrid, state: Uint8Array): { mask: Uint8Array; cbx: number; cby: number } {
  const { px, py, pz, bx, by, bz } = B;
  // per point brick: bit 1 = has rock, bit 2 = has water
  const sign = scratchU8("signBrick", B.count).fill(0);
  for (let k = 0; k < pz; k++) {
    const bk = (k >> SH) * by;
    for (let j = 0; j < py; j++) {
      const row = (k * py + j) * px;
      const bj = (bk + (j >> SH)) * bx;
      for (let i = 0; i < px; i++) sign[bj + (i >> SH)] |= state[row + i] === KEEP ? 1 : 2;
    }
  }
  // cells: i ∈ [0, px − 3]; cell brick c covers corners [8c + 1, 8c + 9] → point bricks c, c + 1
  const cbx = (px - 2 + BRICK - 1) >> SH, cby = (py - 2 + BRICK - 1) >> SH, cbz = (pz - 2 + BRICK - 1) >> SH;
  const mask = scratchU8("cellMask", cbx * cby * cbz);
  for (let cz = 0; cz < cbz; cz++)
    for (let cy = 0; cy < cby; cy++)
      for (let cx = 0; cx < cbx; cx++) {
        let m = 0;
        for (let dz = 0; dz <= 1; dz++)
          for (let dy = 0; dy <= 1; dy++)
            for (let dx = 0; dx <= 1; dx++) {
              const x = cx + dx, y = cy + dy, z = cz + dz;
              if (x >= bx || y >= by || z >= bz) continue;
              m |= sign[(z * by + y) * bx + x];
            }
        mask[(cz * cby + cy) * cbx + cx] = m === 1 || m === 2 ? 1 : 0;
      }
  return { mask, cbx, cby };
}
