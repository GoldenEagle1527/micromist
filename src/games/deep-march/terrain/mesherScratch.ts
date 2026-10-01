/**
 * Growable per-worker output buffers of the column mesher (marching cubes,
 * normals, skirts): vertex positions / normals, indices, gradient magnitudes and
 * the per-vertex side-plane mask. Reallocated (doubled) only when a column needs more.
 */
export const mc = {
  pos: new Float32Array(1 << 16),
  nrm: new Float32Array(1 << 16),
  idx: new Uint32Array(1 << 16),
  grad: new Float32Array(1 << 15),
  /** Per vertex: bitmask of the column side planes its lattice edge lies in (skirts). */
  side: new Uint8Array(1 << 15),
};

/** Room for n position floats (n / 3 vertices). */
export function ensureScratch(n: number) {
  if (mc.pos.length >= n) return;
  let len = mc.pos.length;
  while (len < n) len *= 2;
  const p = new Float32Array(len);
  p.set(mc.pos);
  mc.pos = p;
  const q = new Float32Array(len);
  q.set(mc.nrm);
  mc.nrm = q;
  const g = new Float32Array(len / 3 + 1);
  g.set(mc.grad.subarray(0, Math.min(mc.grad.length, g.length)));
  mc.grad = g;
  const sd = new Uint8Array(len / 3 + 1);
  sd.set(mc.side.subarray(0, Math.min(mc.side.length, sd.length)));
  mc.side = sd;
}

/** Double the index buffer once if it holds fewer than `need` entries. */
export function growIndices(need: number) {
  if (mc.idx.length < need) {
    const q = new Uint32Array(mc.idx.length * 2);
    q.set(mc.idx);
    mc.idx = q;
  }
}
