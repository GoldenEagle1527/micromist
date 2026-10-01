/**
 * Surface passes after marching cubes (mesher.ts), on the shared scratch buffers:
 * fine-field normals on coarse levels, LOD skirts, then the per-vertex ambient
 * occlusion and the tight bounds of the final arrays.
 */
import type { DensityField } from "./density";
import { latticeSpacing } from "./columnLattice";
import { ensureScratch, growIndices, mc } from "./mesherScratch";

/**
 * A coarse lattice's central differences only see the field at its own spacing:
 * normals (and so the shader's floor / wall / moss split, triplanar weights and
 * AO) came out different per level, and surfaces visibly changed material when a
 * column swapped level. Re-derive them from the same field level 0 sees, at a
 * step of level 0's spacing (coarser for the far rings, whose vertices are too
 * sparse to carry that detail without speckle), so all levels shade alike.
 */
export function fineNormals(field: DensityField, sp: number, vcount: number) {
  const eps = Math.max(latticeSpacing(field), sp / 4);
  const inv = 1 / eps;
  const raw = field.sampleRaw;
  const pos = mc.pos, nrm = mc.nrm, grad = mc.grad;
  for (let v = 0; v < vcount; v++) {
    const o = v * 3;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
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
    const dot = -(gx * nrm[o] + gy * nrm[o + 1] + gz * nrm[o + 2]) / len;
    if (dot < 0.2) continue;
    grad[v] = len;
    nrm[o] = -gx / len;
    nrm[o + 1] = -gy / len;
    nrm[o + 2] = -gz / len;
  }
}

/**
 * Columns of different LOD levels do not share seam vertices, so tiny cracks can
 * open along a level change. Every triangle edge lying in a column side plane gets
 * a skirt quad hanging from it into the rock (along −normal, 2 cells deep, both
 * windings): invisible inside rock where neighbours match, it fills the crack
 * where they don't. Skirt vertices come after the surface vertices; returns the
 * new counts and each skirt vertex's surface source.
 */
export function addSkirts(sp: number, surfaceVerts: number, icount0: number): { vcount: number; icount: number; skirtSrc: number[] } {
  const skirtSrc: number[] = [];
  let vcount = surfaceVerts;
  let icount = icount0;
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
      mc.pos[oq + a] = mc.pos[o + a] - mc.nrm[o + a] * depth;
      mc.nrm[oq + a] = mc.nrm[o + a];
    }
    mc.side[q] = 0;
    skirtSrc.push(v);
    return q;
  };
  const triCount = icount;
  for (let t = 0; t < triCount; t += 3) {
    for (let e = 0; e < 3; e++) {
      const u = mc.idx[t + e], v = mc.idx[t + ((e + 1) % 3)];
      if (u >= surfaceVerts || v >= surfaceVerts || !(mc.side[u] & mc.side[v])) continue;
      const us = skirtVert(u), vs = skirtVert(v);
      growIndices(icount + 12);
      mc.idx.set([u, v, vs, u, vs, us, v, u, us, v, us, vs], icount);
      icount += 12;
    }
  }
  return { vcount, icount, skirtSrc };
}

/**
 * Ambient occlusion: compare the density a short way out along the normal with
 * what a flat surface (same gradient) would give. Concave spots — cave corners,
 * crevices, under overhangs — stay denser → darker. Skirt vertices copy their source.
 */
export function vertexAo(field: DensityField, positions: Float32Array, normals: Float32Array, surfaceVerts: number, vcount: number, skirtSrc: number[]): Float32Array {
  const iso = field.settings.isoLevel;
  const ao = new Float32Array(vcount);
  const AO_STEPS = [0.8, 2.2];
  const AO_WEIGHTS = [0.55, 0.45];
  for (let v = 0; v < surfaceVerts; v++) {
    const o = v * 3;
    const g = Math.max(0.3, mc.grad[v]);
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
  return ao;
}

/** Tight AABB of the positions: minX, minY, minZ, maxX, maxY, maxZ (empty: zeros). */
export function positionBounds(positions: Float32Array, vcount: number): Float32Array {
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
  return bounds;
}
