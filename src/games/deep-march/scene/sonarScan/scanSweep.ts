/**
 * One ping's scan, spread over the frames as its wavefront travels (pure, no three).
 * The sources are the terrain surfaces drawn when the ping went out (column meshes:
 * positions, normals, index, surface vertex count, bounds) — captured then, so the
 * record holds the terrain as it was at the ping. A source is read once the front
 * reaches its box (nearest first): its surface triangles that touch the sphere are
 * snapped to the record's grid and binned by the tile of their centroid. A tile is
 * committed (ScanPing.commit) once the front has passed it and every source over it
 * has been read, so the record changes behind the front, never ahead of it.
 */
import { SCAN_GRID, snapXZ, snapY, tileKey } from "./scanGrid";
import type { ScanPing } from "./scanRecord";
import { newSoup, type Soup } from "./tileMesh";

export type ScanSource = {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Triangle indices (null: every 3 vertices). */
  index: ArrayLike<number> | null;
  /** Vertices of the real surface (skirts come after them and are skipped). */
  surface: number;
  /** World AABB: min xyz, max xyz. */
  box: ArrayLike<number>;
};

type Queued = { src: ScanSource; near: number };
type TileJob = { tx: number; tz: number; ready: number };

export class ScanSweep {
  readonly ping: ScanPing;
  private readonly queue: Queued[] = [];
  private readonly tiles: TileJob[] = [];
  private readonly bins = new Map<number, Soup>();
  private qi = 0;
  private ti = 0;
  /** Triangles read and committed so far. */
  work = 0;

  constructor(ping: ScanPing, sources: readonly ScanSource[]) {
    this.ping = ping;
    const { x, y, z, r } = ping.sphere;
    for (const src of sources) {
      const b = src.box;
      const near = Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5]));
      if (near <= r && src.surface > 0) this.queue.push({ src, near });
    }
    this.queue.sort((a, b) => a.near - b.near);
    const T = SCAN_GRID.tile;
    for (const t of ping.tilesInReach()) {
      let ready = t.far;
      for (const q of this.queue) {
        const b = q.src.box;
        if (b[0] <= (t.tx + 1) * T && b[3] >= t.tx * T && b[2] <= (t.tz + 1) * T && b[5] >= t.tz * T) ready = Math.max(ready, q.near);
      }
      this.tiles.push({ tx: t.tx, tz: t.tz, ready });
    }
    this.tiles.sort((a, b) => a.ready - b.ready);
  }

  get done(): boolean {
    return this.qi >= this.queue.length && this.ti >= this.tiles.length;
  }

  /** Sources not read yet. */
  get pending(): number {
    return this.queue.length - this.qi;
  }

  /** Advance to wavefront radius `front` (m) with about `budget` triangles of work (at least one step). */
  step(front: number, budget: number): number {
    let used = 0;
    while (this.qi < this.queue.length && this.queue[this.qi].near <= front && (used === 0 || used < budget)) used += this.read(this.queue[this.qi++].src);
    const readTo = this.qi < this.queue.length ? Math.min(front, this.queue[this.qi].near) : front;
    while (this.ti < this.tiles.length && this.tiles[this.ti].ready <= readTo && (used === 0 || used < budget)) {
      const t = this.tiles[this.ti++];
      const key = tileKey(t.tx, t.tz);
      used += this.ping.commit(t.tx, t.tz, this.bins.get(key) ?? null) + 1;
      this.bins.delete(key);
    }
    this.work += used;
    return used;
  }

  /** Read and commit everything left (a newer ping, the dive ends). */
  finish(): void {
    this.step(Infinity, Infinity);
  }

  /** Bin a source's surface triangles that touch the sphere; returns the triangles looked at. */
  private read(s: ScanSource): number {
    const { x, y, z, r } = this.ping.sphere, r2 = r * r, T = SCAN_GRID.tile;
    const p = s.positions, n = s.normals, ix = s.index, surf = s.surface;
    const tris = ix ? ix.length / 3 : Math.floor(surf / 3);
    const q = [0, 0, 0, 0, 0, 0, 0, 0, 0], v = [0, 0, 0];
    for (let t = 0; t < tris; t++) {
      let skip = false, reach = false;
      for (let k = 0; k < 3; k++) {
        const i = ix ? ix[t * 3 + k] : t * 3 + k;
        if (i >= surf) skip = true;
        v[k] = i;
        const qx = (q[k * 3] = snapXZ(p[i * 3])), qy = (q[k * 3 + 1] = snapY(p[i * 3 + 1])), qz = (q[k * 3 + 2] = snapXZ(p[i * 3 + 2]));
        const dx = qx - x, dy = qy - y, dz = qz - z;
        if (dx * dx + dy * dy + dz * dz < r2) reach = true; // the same test as sphereClip's
      }
      if (skip || !reach) continue;
      const key = tileKey(Math.floor((q[0] + q[3] + q[6]) / 3 / T), Math.floor((q[2] + q[5] + q[8]) / 3 / T));
      let bin = this.bins.get(key);
      if (!bin) this.bins.set(key, (bin = newSoup()));
      for (let k = 0; k < 3; k++) {
        const i = v[k];
        bin.p.push(q[k * 3], q[k * 3 + 1], q[k * 3 + 2]);
        bin.n.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      }
    }
    return tris;
  }
}
