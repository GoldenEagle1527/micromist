/**
 * Marching cubes over one column job's final density grid (mesher.ts; CPU port of
 * SebLague `MarchingCubes.compute`): shared per-edge vertices (indexed), gradient
 * normals from the padded grid, and per vertex the column side planes its lattice
 * edge lies in (skirts). Output goes to the shared scratch buffers (mesherScratch.ts).
 */
import { CORNER_OFFSETS, EDGE_CORNER_A, EDGE_CORNER_B, TRI_TABLE } from "./tables";
import { cellMask, scratchI32 } from "./bricks";
import type { BrickGrid } from "./brickBase";
import type { ColumnGrid } from "./mesherGrid";
import { ensureScratch, growIndices, mc } from "./mesherScratch";

/** Returns the vertex and index counts written to mc.pos / mc.nrm / mc.grad / mc.side / mc.idx. */
export function marchCubes(g: ColumnGrid, dens: Float32Array, state: Uint8Array, bricks: BrickGrid | null): { vcount: number; icount: number } {
  const { iso, n, ny, sp, px, py, plane, x0, y0, z0, rowKind, rowSkip } = g;
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
              const pos = mc.pos, nrm = mc.nrm;
              const va = cornerVal[a];
              const vb = cornerVal[b];
              const f = Math.abs(vb - va) < 1e-9 ? 0.5 : (iso - va) / (vb - va);
              const o = vi * 3;
              pos[o] = x0 + (ai + (cornerI[b] - ai) * f) * sp;
              pos[o + 1] = y0 + (aj + (cornerJ[b] - aj) * f) * sp;
              pos[o + 2] = z0 + (ak + (cornerK[b] - ak) * f) * sp;
              gradAt(ai, aj, ak, ga, 0);
              gradAt(cornerI[b], cornerJ[b], cornerK[b], gb, 0);
              let nx = -(ga[0] + (gb[0] - ga[0]) * f);
              let nyv = -(ga[1] + (gb[1] - ga[1]) * f);
              let nz = -(ga[2] + (gb[2] - ga[2]) * f);
              const len = Math.hypot(nx, nyv, nz) || 1;
              mc.grad[vi] = len;
              nx /= len;
              nyv /= len;
              nz /= len;
              nrm[o] = nx;
              nrm[o + 1] = nyv;
              nrm[o + 2] = nz;
              const bi = cornerI[b], bk = cornerK[b];
              mc.side[vi] =
                (ai === 0 && bi === 0 ? 1 : 0) | (ai === n - 1 && bi === n - 1 ? 2 : 0) |
                (ak === 0 && bk === 0 ? 4 : 0) | (ak === n - 1 && bk === n - 1 ? 8 : 0);
            }
            tri[e] = vi;
          }
          if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
          growIndices(icount + 3);
          // Like the reference (vertexC, vertexB, vertexA): reversed so CCW faces the water.
          const idx = mc.idx;
          idx[icount++] = tri[2];
          idx[icount++] = tri[1];
          idx[icount++] = tri[0];
        }
      }
    }
  }
  return { vcount, icount };
}
