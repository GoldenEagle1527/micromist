/**
 * test:scan fixtures: synthetic terrain surfaces shaped like the column meshes the
 * scanner reads (indexed, surface vertices first, a skirt after them), a ping run to
 * the end, and helpers to read a scan record back (world triangles, open edges).
 */
import { decodeNormal, dequantXZ, dequantY } from "../../src/games/deep-march/scene/sonarScan/scanGrid";
import type { ScanRecord } from "../../src/games/deep-march/scene/sonarScan/scanRecord";
import { ScanSweep, type ScanSource } from "../../src/games/deep-march/scene/sonarScan/scanSweep";

export type Height = (x: number, z: number) => number;
export type V3 = { x: number; y: number; z: number };

/** One square column at (cx, cz) (min corner), `size` m, vertices every `step` m, plus a skirt strip far below. */
export function column(cx: number, cz: number, h: Height, size = 32, step = 1): ScanSource {
  const m = Math.round(size / step) + 1, surface = m * m;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++)
    for (let k = 0; k < m; k++) {
      const x = cx + i * step, z = cz + k * step, y = h(x, z);
      const gx = h(x + 0.5, z) - h(x - 0.5, z), gz = h(x, z + 0.5) - h(x, z - 0.5), l = Math.hypot(gx, 1, gz);
      pos.push(x, y, z);
      nrm.push(-gx / l, 1 / l, -gz / l);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  const at = (i: number, k: number) => i * m + k;
  for (let i = 0; i < m - 1; i++)
    for (let k = 0; k < m - 1; k++) idx.push(at(i, k), at(i, k + 1), at(i + 1, k), at(i + 1, k), at(i, k + 1), at(i + 1, k + 1)); // up-facing
  pos.push(cx, lo - 1000, cz, cx + size, lo - 1000, cz); // skirt: never recorded
  nrm.push(0, -1, 0, 0, -1, 0);
  idx.push(0, surface, surface + 1);
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), index: Uint32Array.from(idx), surface, box: [cx, lo, cz, cx + size, hi, cz + size] };
}

/** Columns covering [x0, x1) × [z0, z1). */
export function terrain(h: Height, x0: number, x1: number, z0: number, z1: number, size = 32, step = 1): ScanSource[] {
  const out: ScanSource[] = [];
  for (let x = x0; x < x1; x += size) for (let z = z0; z < z1; z += size) out.push(column(x, z, h, size, step));
  return out;
}

/**
 * Columns as the chunk manager picks them around a viewer at (vx, vz): level-L columns
 * are 32·2^L m wide with vertices every 2^L m, split while within 32·2^(L−1) m.
 */
export function lodTerrain(h: Height, vx: number, vz: number, levels = 4): ScanSource[] {
  const out: ScanSource[] = [];
  const node = (l: number, x: number, z: number) => {
    const size = 32 << l, dx = Math.max(x - vx, 0, vx - x - size), dz = Math.max(z - vz, 0, vz - z - size);
    if (l > 0 && Math.hypot(dx, dz) < 32 * 2 ** (l - 1)) for (const [i, k] of [[0, 0], [1, 0], [0, 1], [1, 1]]) node(l - 1, x + (i * size) / 2, z + (k * size) / 2);
    else out.push(column(x, z, h, size, 2 ** l));
  };
  const top = 32 << (levels - 1);
  for (let x = -2 * top; x < 2 * top; x += top) for (let z = -2 * top; z < 2 * top; z += top) node(levels - 1, x, z);
  return out;
}

/** A whole ping at once (as when a newer ping or the dive's end finishes it). */
export function pingAll(rec: ScanRecord, o: V3, radius: number, src: ScanSource[]): ScanSweep {
  const s = new ScanSweep(rec.begin(o.x, o.y, o.z, radius), src);
  s.finish();
  rec.evict(rec.now);
  return s;
}

export type WorldTri = { a: V3; b: V3; c: V3; n: V3 };

/** Every recorded triangle in world space (with its first corner's normal). */
export function trianglesOf(rec: ScanRecord): WorldTri[] {
  const out: WorldTri[] = [];
  const nv = [0, 0, 0];
  for (const { mesh: m, tx, tz } of rec.tiles.values()) {
    const v = (i: number): V3 => ({ x: dequantXZ(m.pos[i * 3], tx), y: dequantY(m.pos[i * 3 + 1]), z: dequantXZ(m.pos[i * 3 + 2], tz) });
    for (let k = 0; k < m.idx.length; k += 3) {
      decodeNormal(m.nrm[m.idx[k] * 2], m.nrm[m.idx[k] * 2 + 1], nv, 0);
      out.push({ a: v(m.idx[k]), b: v(m.idx[k + 1]), c: v(m.idx[k + 2]), n: { x: nv[0], y: nv[1], z: nv[2] } });
    }
  }
  return out;
}

const key = (p: V3) => `${Math.round(p.x * 1024)},${Math.round(p.y * 16)},${Math.round(p.z * 1024)}`;

/** Edges by use count (world-grid keys, direction-free): 1 = open border, 2 = shared, > 2 = overlap. */
export function edgeUse(tris: WorldTri[]): Map<string, { n: number; a: V3; b: V3 }> {
  const m = new Map<string, { n: number; a: V3; b: V3 }>();
  for (const t of tris)
    for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
      const ka = key(a), kb = key(b), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = m.get(k);
      if (e) e.n++;
      else m.set(k, { n: 1, a, b });
    }
  return m;
}

/** Footprint (m², x / z projection) of world triangles. */
export const footprintOf = (tris: WorldTri[]): number => tris.reduce((s, t) => s + Math.abs((t.b.x - t.a.x) * (t.c.z - t.a.z) - (t.c.x - t.a.x) * (t.b.z - t.a.z)) / 2, 0);

/** Record fingerprint: tiles with their exact buffers (order-independent). */
export function fingerprint(rec: ScanRecord): string {
  return [...rec.tiles.values()]
    .map((t) => `${t.tx},${t.tz}:${t.mesh.pos.join(",")}/${t.mesh.nrm.join(",")}/${t.mesh.idx.join(",")}`)
    .sort()
    .join("|");
}
