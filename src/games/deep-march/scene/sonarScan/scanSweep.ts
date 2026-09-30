/**
 * One ping's scan, spread over the frames as its wavefront travels (pure, no three).
 * The sources are the terrain surfaces that were built when the ping went out
 * (column meshes: positions, normals, surface vertex count, bounds) — captured
 * then, so the record holds the terrain as it was at the ping. A source is scanned
 * once the front reaches its bounding box (nearest first, within a per-frame vertex
 * budget); a tile's stale points are cleared once the front has passed it. When
 * everything is done the record has exactly this ping's view inside its sphere.
 */
import type { ScanPing } from "./scanRecord";

export type ScanSource = {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Vertices to scan (the surface; skirts come after them). */
  count: number;
  /** World AABB: min xyz, max xyz. */
  box: ArrayLike<number>;
};

type Queued = { src: ScanSource; near: number };

export class ScanSweep {
  readonly ping: ScanPing;
  private readonly queue: Queued[];
  private readonly tiles: { tx: number; tz: number; far: number }[];
  private qi = 0;
  private ti = 0;
  /** Vertices scanned so far. */
  scanned = 0;

  constructor(ping: ScanPing, sources: readonly ScanSource[]) {
    this.ping = ping;
    const { ox, oy, oz, radius } = ping;
    this.queue = [];
    for (const src of sources) {
      const b = src.box;
      const dx = Math.max(b[0] - ox, 0, ox - b[3]), dy = Math.max(b[1] - oy, 0, oy - b[4]), dz = Math.max(b[2] - oz, 0, oz - b[5]);
      const near = Math.hypot(dx, dy, dz);
      if (near <= radius && src.count > 0) this.queue.push({ src, near });
    }
    this.queue.sort((a, b) => a.near - b.near);
    this.tiles = ping.tilesInReach();
  }

  get done(): boolean {
    return this.qi >= this.queue.length && this.ti >= this.tiles.length;
  }

  /** Sources waiting / total (the debug overlay, tests). */
  get pending(): number {
    return this.queue.length - this.qi;
  }

  /**
   * Advance to wavefront radius `front` (m), scanning at most ~`budget` vertices
   * (a source is never split). Returns the vertices scanned this call.
   */
  step(front: number, budget: number): number {
    let used = 0;
    while (this.qi < this.queue.length && this.queue[this.qi].near <= front && used < budget) {
      used += this.scan(this.queue[this.qi].src);
      this.qi++;
    }
    const clearTo = this.qi < this.queue.length ? Math.min(front, this.queue[this.qi].near) : front;
    while (this.ti < this.tiles.length && this.tiles[this.ti].far <= clearTo) {
      const t = this.tiles[this.ti++];
      this.ping.clearTile(t.tx, t.tz);
    }
    this.scanned += used;
    return used;
  }

  /** Scan and clear everything left (a newer ping, the dive ends). */
  finish(): void {
    this.step(Infinity, Infinity);
  }

  private scan(s: ScanSource): number {
    const p = s.positions, n = s.normals, ping = this.ping;
    for (let v = 0, o = 0; v < s.count; v++, o += 3) ping.add(p[o], p[o + 1], p[o + 2], n[o], n[o + 1], n[o + 2]);
    return s.count;
  }
}
