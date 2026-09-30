/**
 * test:scan fixtures: synthetic terrain surfaces shaped like the column meshes the
 * scanner reads (positions / normals / surface count / box, a skirt tail after the
 * surface), and helpers to read a scan record back as world points.
 */
import { unpackPoint, type ScanPoint } from "../../src/games/deep-march/scene/sonarScan/scanGrid";
import type { ScanRecord } from "../../src/games/deep-march/scene/sonarScan/scanRecord";
import { ScanSweep, type ScanSource } from "../../src/games/deep-march/scene/sonarScan/scanSweep";

export type Height = (x: number, z: number) => number;

/** One 32 m column at (cx, cz) (its min corner), 1 m vertex grid, flat-ish normals, plus `skirt` extra vertices far below (not surface). */
export function column(cx: number, cz: number, h: Height, skirt = 64): ScanSource {
  const n = 33 * 33;
  const pos = new Float32Array((n + skirt) * 3), nrm = new Float32Array((n + skirt) * 3);
  let lo = Infinity, hi = -Infinity, o = 0;
  for (let i = 0; i <= 32; i++)
    for (let k = 0; k <= 32; k++, o += 3) {
      const x = cx + i, z = cz + k, y = h(x, z);
      const gx = h(x + 0.5, z) - h(x - 0.5, z), gz = h(x, z + 0.5) - h(x, z - 0.5);
      const l = Math.hypot(gx, 1, gz);
      pos.set([x, y, z], o);
      nrm.set([-gx / l, 1 / l, -gz / l], o);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  for (let s = 0; s < skirt; s++, o += 3) {
    pos.set([cx + (s % 32), lo - 1000, cz], o); // skirts hang far below: never recorded
    nrm.set([0, -1, 0], o);
  }
  return { positions: pos, normals: nrm, count: n, box: [cx, lo, cz, cx + 32, hi, cz + 32] };
}

/** Columns covering [x0, x1) × [z0, z1) (multiples of 32). */
export function terrain(h: Height, x0: number, x1: number, z0: number, z1: number): ScanSource[] {
  const out: ScanSource[] = [];
  for (let x = x0; x < x1; x += 32) for (let z = z0; z < z1; z += 32) out.push(column(x, z, h));
  return out;
}

/** A whole ping at once (as when a newer ping or the dive's end finishes it). */
export function pingAll(rec: ScanRecord, o: { x: number; y: number; z: number }, radius: number, src: ScanSource[]): ScanSweep {
  const s = new ScanSweep(rec.begin(o.x, o.y, o.z, radius), src);
  s.finish();
  rec.evict(rec.now);
  return s;
}

/** Every recorded point in world space. */
export function pointsOf(rec: ScanRecord): ScanPoint[] {
  const out: ScanPoint[] = [];
  for (const t of rec.tiles.values()) for (const p of t.pts.values()) out.push(unpackPoint(p, t.tx, t.tz, { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 }));
  return out;
}

/** Record fingerprint: tile keys, points, LRU stamps (order-independent). */
export function fingerprint(rec: ScanRecord): string {
  return [...rec.tiles.values()]
    .map((t) => `${t.tx},${t.tz}:${[...t.pts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e.join("=")).join(";")}`)
    .sort()
    .join("|");
}
