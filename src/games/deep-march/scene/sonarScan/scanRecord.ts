/**
 * The sonar scan record (pure, no three): what the pings have seen, as recorded
 * points in 32 m tiles (scanGrid.ts). It is never refreshed from the live terrain:
 * only a ping overwrites it, and only inside that ping's sphere — so after a tide
 * the record shows the old terrain until the diver pings there again, and places
 * never pinged hold nothing.
 *
 * A ping (ScanPing) adds the surface points it sweeps over (the first per 2 m cell
 * wins) and clears every older point inside its sphere that it did not see again
 * (terrain that fell away, rock that is now water). Memory is bounded: past `cap`
 * points the least recently pinged tiles go first (LRU), never the current ping's.
 */
import { SCAN_GRID, cellKey, packPoint, packedDist2, tileKey } from "./scanGrid";

export type ScanTile = {
  readonly key: number;
  readonly tx: number;
  readonly tz: number;
  /** cell → packed point. */
  readonly pts: Map<number, number>;
  /** LRU stamp: the record clock of the last ping that touched the tile. */
  used: number;
  /** Record-wide change stamp of its last change (the view rebuilds its buffers). */
  version: number;
};

const CELL_KEYS = 1 << 19; // cellKey < 16 · 16 · 2048

export class ScanRecord {
  readonly tiles = new Map<number, ScanTile>();
  /** Point budget (LRU eviction beyond it). */
  readonly cap: number;
  private total = 0;
  private clock = 0;
  private changes = 0;

  constructor(cap: number) {
    this.cap = cap;
  }

  get points(): number {
    return this.total;
  }

  /** Record clock: +1 per ping. */
  get now(): number {
    return this.clock;
  }

  tile(tx: number, tz: number, create: boolean): ScanTile | null {
    const key = tileKey(tx, tz);
    let t = this.tiles.get(key) ?? null;
    if (!t && create) {
      t = { key, tx, tz, pts: new Map(), used: this.clock, version: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Decoding / tests: put a packed point straight into a tile. */
  put(t: ScanTile, cell: number, packed: number): void {
    if (!t.pts.has(cell)) this.total++;
    t.pts.set(cell, packed);
    this.bump(t);
  }

  /** Mark a tile changed. */
  bump(t: ScanTile): void {
    t.version = ++this.changes;
  }

  /** A ping from (ox, oy, oz) reaching `radius` m. */
  begin(ox: number, oy: number, oz: number, radius: number): ScanPing {
    this.clock++;
    return new ScanPing(this, ox, oy, oz, radius, this.clock);
  }

  /** Drop least recently pinged tiles until ≤ cap points (tiles stamped `keep` stay). Returns the points dropped. */
  evict(keep = this.clock): number {
    if (this.total <= this.cap) return 0;
    const order = [...this.tiles.values()].filter((t) => t.used < keep).sort((a, b) => a.used - b.used);
    let dropped = 0;
    for (const t of order) {
      if (this.total <= this.cap) break;
      dropped += t.pts.size;
      this.dropTile(t);
    }
    return dropped;
  }

  clear(): void {
    for (const t of [...this.tiles.values()]) this.dropTile(t);
    this.clock = 0;
  }

  /** @internal ScanPing */
  count(delta: number): void {
    this.total += delta;
  }

  /** Remove a tile (eviction, or emptied by a ping). */
  dropTile(t: ScanTile): void {
    this.total -= t.pts.size;
    this.tiles.delete(t.key);
  }
}

/** One ping's write into the record: add what it sees, then clear what it no longer sees. */
export class ScanPing {
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly radius: number;
  private readonly r2: number;
  private readonly rec: ScanRecord;
  private readonly stamp: number;
  /** Cells written by this ping (global keys). */
  private readonly fresh = new Set<number>();
  private readonly cleared = new Set<number>();
  added = 0;
  removed = 0;

  constructor(rec: ScanRecord, ox: number, oy: number, oz: number, radius: number, stamp: number) {
    this.rec = rec;
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.radius = radius;
    this.r2 = radius * radius;
    this.stamp = stamp;
  }

  /** A surface point the pulse reached (ignored outside the sphere, or if its cell already has this ping's point). */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number): boolean {
    const dx = x - this.ox, dy = y - this.oy, dz = z - this.oz;
    if (dx * dx + dy * dy + dz * dz > this.r2) return false;
    const T = SCAN_GRID.tile;
    const tx = Math.floor(x / T), tz = Math.floor(z / T);
    const lx = x - tx * T, lz = z - tz * T;
    const cell = cellKey(lx, y, lz);
    const t = this.rec.tile(tx, tz, true)!;
    const g = t.key * CELL_KEYS + cell;
    if (this.fresh.has(g)) return false;
    this.fresh.add(g);
    if (!t.pts.has(cell)) this.rec.count(1);
    t.pts.set(cell, packPoint(lx, y, lz, nx, ny, nz));
    t.used = this.stamp;
    this.rec.bump(t);
    this.added++;
    return true;
  }

  /** Clear tile (tx, tz): drop its older points inside the sphere (once per ping). */
  clearTile(tx: number, tz: number): void {
    const key = tileKey(tx, tz);
    if (this.cleared.has(key)) return;
    this.cleared.add(key);
    const t = this.rec.tiles.get(key);
    if (!t) return;
    let n = 0;
    for (const [cell, p] of t.pts) {
      if (this.fresh.has(key * CELL_KEYS + cell)) continue;
      if (packedDist2(p, tx, tz, this.ox, this.oy, this.oz) > this.r2) continue;
      t.pts.delete(cell);
      n++;
    }
    if (n === 0) return;
    this.rec.count(-n);
    this.removed += n;
    t.used = this.stamp;
    this.rec.bump(t);
    if (t.pts.size === 0) this.rec.dropTile(t);
  }

  /** Every tile the sphere overlaps (x / z), nearest first by its farthest corner: the clearing order. */
  tilesInReach(): { tx: number; tz: number; far: number }[] {
    const T = SCAN_GRID.tile;
    const out: { tx: number; tz: number; far: number }[] = [];
    for (let tx = Math.floor((this.ox - this.radius) / T); tx <= Math.floor((this.ox + this.radius) / T); tx++)
      for (let tz = Math.floor((this.oz - this.radius) / T); tz <= Math.floor((this.oz + this.radius) / T); tz++) {
        const nx = Math.max(tx * T - this.ox, 0, this.ox - (tx + 1) * T), nz = Math.max(tz * T - this.oz, 0, this.oz - (tz + 1) * T);
        if (nx * nx + nz * nz > this.r2) continue;
        const fx = Math.max(Math.abs(tx * T - this.ox), Math.abs((tx + 1) * T - this.ox)), fz = Math.max(Math.abs(tz * T - this.oz), Math.abs((tz + 1) * T - this.oz));
        out.push({ tx, tz, far: Math.hypot(fx, fz) });
      }
    return out.sort((a, b) => a.far - b.far);
  }
}
