/**
 * CPU port of SebLague `MarchingCubes.compute` + `MeshGenerator.UpdateChunkMesh`.
 *
 * Differences from the reference:
 * - density grid is padded by one sample so vertex normals come from the
 *   density gradient (seamless across chunks) instead of RecalculateNormals;
 * - vertices are shared per grid edge (indexed geometry, ~6× fewer vertices);
 * - rows whose density provably can't cross isoLevel skip the noise call.
 */
import type { DensityField } from "./density";
import { CORNER_OFFSETS, EDGE_CORNER_A, EDGE_CORNER_B, TRI_TABLE } from "./tables";
import { seaWorldColor } from "./colors";

export type ChunkMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Number of density samples actually evaluated with noise (perf stat). */
  noiseSamples: number;
};

let scratchPos = new Float32Array(1 << 16);
let scratchNrm = new Float32Array(1 << 16);
let scratchIdx = new Uint32Array(1 << 16);

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
}

export function chunkCentre(cx: number, cy: number, cz: number, boundsSize: number): [number, number, number] {
  return [cx * boundsSize, cy * boundsSize, cz * boundsSize];
}

/** Quick reject: true when the chunk can't contain any surface. */
export function chunkIsTrivial(field: DensityField, cy: number): boolean {
  const s = field.settings;
  const n = s.numPointsPerAxis;
  const spacing = s.boundsSize / (n - 1);
  const y0 = cy * s.boundsSize - s.boundsSize / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = -1; j <= n; j++) {
    const b = field.base(y0 + j * spacing);
    if (b < lo) lo = b;
    if (b > hi) hi = b;
  }
  return hi + field.noiseMax < s.isoLevel || lo > s.isoLevel;
}

export function generateChunkMesh(
  field: DensityField,
  cx: number,
  cy: number,
  cz: number,
): ChunkMeshData {
  const s = field.settings;
  const iso = s.isoLevel;
  const n = s.numPointsPerAxis;
  const p = n + 2; // padded
  const spacing = s.boundsSize / (n - 1);
  const [ccx, ccy, ccz] = chunkCentre(cx, cy, cz, s.boundsSize);
  const x0 = ccx - s.boundsSize / 2;
  const y0 = ccy - s.boundsSize / 2;
  const z0 = ccz - s.boundsSize / 2;

  if (chunkIsTrivial(field, cy)) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), indices: new Uint16Array(0), noiseSamples: 0 };
  }

  // Per-row classification: 0 = must sample, 1 = trivially below iso, 2 = above.
  const rowBase = new Float64Array(p);
  const rowKind = new Uint8Array(p);
  for (let j = 0; j < p; j++) {
    const b = field.base(y0 + (j - 1) * spacing);
    rowBase[j] = b;
    rowKind[j] = b + field.noiseMax < iso ? 1 : b > iso ? 2 : 0;
  }
  const rowSkip = new Uint8Array(p);
  for (let j = 0; j < p; j++) {
    const k = rowKind[j];
    if (k === 0) continue;
    let ok = true;
    for (let d = -2; d <= 2 && ok; d++) {
      const jj = j + d;
      if (jj >= 0 && jj < p && rowKind[jj] !== k) ok = false;
    }
    rowSkip[j] = ok ? 1 : 0;
  }

  // Density grid, index = (k * p + j) * p + i  (z-major like the reference).
  const dens = new Float32Array(p * p * p);
  let noiseSamples = 0;
  for (let k = 0; k < p; k++) {
    const wz = z0 + (k - 1) * spacing;
    for (let j = 0; j < p; j++) {
      const wy = y0 + (j - 1) * spacing;
      const row = (k * p + j) * p;
      if (rowSkip[j]) {
        dens.fill(rowBase[j], row, row + p);
        continue;
      }
      for (let i = 0; i < p; i++) {
        dens[row + i] = field.sample(x0 + (i - 1) * spacing, wy, wz);
      }
      noiseSamples += p;
    }
  }

  // Gradient at unpadded points (points toward solid).
  const grad = new Float32Array(n * n * n * 3);
  const inv = 1 / (2 * spacing);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const pi = ((k + 1) * p + (j + 1)) * p + (i + 1);
        const gi = ((k * n + j) * n + i) * 3;
        grad[gi] = (dens[pi + 1] - dens[pi - 1]) * inv;
        grad[gi + 1] = (dens[pi + p] - dens[pi - p]) * inv;
        grad[gi + 2] = (dens[pi + p * p] - dens[pi - p * p]) * inv;
      }
    }
  }

  const cornerVal = new Float32Array(8);
  const cornerI = new Int32Array(8);
  const cornerJ = new Int32Array(8);
  const cornerK = new Int32Array(8);
  // Shared-vertex cache: one vertex per grid edge (lower point index * 3 + axis).
  const edgeVertex = new Int32Array(n * n * n * 3).fill(-1);
  let vcount = 0;
  let icount = 0;
  const tri = new Int32Array(3);

  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const ci = i + CORNER_OFFSETS[c * 3];
          const cj = j + CORNER_OFFSETS[c * 3 + 1];
          const ck = k + CORNER_OFFSETS[c * 3 + 2];
          cornerI[c] = ci;
          cornerJ[c] = cj;
          cornerK[c] = ck;
          const v = dens[((ck + 1) * p + (cj + 1)) * p + (ci + 1)];
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
            // Canonical direction (a = lower corner) so neighbours share the vertex.
            if (cornerI[a] + cornerJ[a] + cornerK[a] > cornerI[b] + cornerJ[b] + cornerK[b]) {
              const tmp = a;
              a = b;
              b = tmp;
            }
            const ai = cornerI[a], aj = cornerJ[a], ak = cornerK[a];
            const axis = cornerI[b] !== ai ? 0 : cornerJ[b] !== aj ? 1 : 2;
            const key = ((ak * n + aj) * n + ai) * 3 + axis;
            let vi = edgeVertex[key];
            if (vi < 0) {
              vi = vcount++;
              edgeVertex[key] = vi;
              ensureScratch(vcount * 3);
              const va = cornerVal[a];
              const vb = cornerVal[b];
              const f = Math.abs(vb - va) < 1e-9 ? 0.5 : (iso - va) / (vb - va);
              const o = vi * 3;
              scratchPos[o] = x0 + (ai + (cornerI[b] - ai) * f) * spacing;
              scratchPos[o + 1] = y0 + (aj + (cornerJ[b] - aj) * f) * spacing;
              scratchPos[o + 2] = z0 + (ak + (cornerK[b] - ak) * f) * spacing;
              const ga = ((ak * n + aj) * n + ai) * 3;
              const gb = ((cornerK[b] * n + cornerJ[b]) * n + cornerI[b]) * 3;
              let nx = -(grad[ga] + (grad[gb] - grad[ga]) * f);
              let ny = -(grad[ga + 1] + (grad[gb + 1] - grad[ga + 1]) * f);
              let nz = -(grad[ga + 2] + (grad[gb + 2] - grad[ga + 2]) * f);
              const len = Math.hypot(nx, ny, nz) || 1;
              nx /= len;
              ny /= len;
              nz /= len;
              scratchNrm[o] = nx;
              scratchNrm[o + 1] = ny;
              scratchNrm[o + 2] = nz;
            }
            tri[e] = vi;
          }
          if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue; // degenerate
          if (scratchIdx.length < icount + 3) {
            const q = new Uint32Array(scratchIdx.length * 2);
            q.set(scratchIdx);
            scratchIdx = q;
          }
          // Like the reference (which stores vertexC, vertexB, vertexA), emit the
          // table triangle reversed so CCW front faces point into the water.
          scratchIdx[icount++] = tri[2];
          scratchIdx[icount++] = tri[1];
          scratchIdx[icount++] = tri[0];
        }
      }
    }
  }

  const positions = scratchPos.slice(0, vcount * 3);
  const normals = scratchNrm.slice(0, vcount * 3);
  const indices = vcount <= 65535 ? Uint16Array.from(scratchIdx.subarray(0, icount)) : scratchIdx.slice(0, icount);
  const colors = new Float32Array(vcount * 3);
  for (let v = 0; v < vcount; v++) {
    seaWorldColor(positions[v * 3 + 1], normals[v * 3 + 1], colors, v * 3);
  }
  return { positions, normals, colors, indices, noiseSamples };
}
