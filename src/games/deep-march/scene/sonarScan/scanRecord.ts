/**
 * The sonar scan record (pure, no three): the seabed surfaces the pings have seen,
 * one quantised mesh per 32 m tile (tileMesh.ts). It is never refreshed from the
 * live terrain: only a ping overwrites it, and only inside that ping's sphere — so
 * after a tide the record shows the old terrain until the diver pings there again,
 * and places never pinged hold nothing.
 *
 * A ping commits tile by tile (ScanPing.commit): the old surface is cut along the
 * sphere and its outside part kept, the surface the ping saw is cut the same way and
 * its inside part added (sphereClip.ts: the two meet exactly). Terrain that fell away
 * or became open water inside the sphere is therefore gone from the record. Memory is
 * bounded: past `cap` vertices the least recently pinged tiles go first (LRU), never
 * the current ping's.
 */
import { SCAN_GRID, tileKey } from "./scanGrid";
import { clipSoup, type Sphere } from "./sphereClip";
import { buildMesh, meshVerts, newSoup, soupOf, soupTris, type Soup, type TileMesh } from "./tileMesh";

export type ScanTile = {
  readonly key: number;
  readonly tx: number;
  readonly tz: number;
  mesh: TileMesh;
  /** LRU stamp: the record clock of the last ping that changed the tile. */
  used: number;
  /** Record-wide change stamp of its last change (the view rebuilds its buffers). */
  version: number;
};

export class ScanRecord {
  readonly tiles = new Map<number, ScanTile>();
  /** Vertex budget (LRU eviction beyond it). */
  readonly cap: number;
  private total = 0;
  private surveyed = 0;
  private clock = 0;
  private changes = 0;

  constructor(cap: number) {
    this.cap = cap;
  }

  /** Recorded vertices (the memory measure). */
  get verts(): number {
    return this.total;
  }

  /** Surveyed seabed (m², footprint of the recorded surfaces). */
  get area(): number {
    return this.surveyed;
  }

  /** Record clock: +1 per ping. */
  get now(): number {
    return this.clock;
  }

  /** Put (or with null remove) a tile's surface; `used`: its LRU stamp. */
  set(tx: number, tz: number, mesh: TileMesh | null, used = this.clock): void {
    const key = tileKey(tx, tz);
    const old = this.tiles.get(key);
    if (old) this.dropTile(old);
    if (!mesh) return;
    this.tiles.set(key, { key, tx, tz, mesh, used, version: ++this.changes });
    this.total += meshVerts(mesh);
    this.surveyed += mesh.area;
  }

  /** A ping from (ox, oy, oz) reaching `radius` m. */
  begin(ox: number, oy: number, oz: number, radius: number): ScanPing {
    this.clock++;
    return new ScanPing(this, { x: ox, y: oy, z: oz, r: radius });
  }

  /** Drop least recently pinged tiles until ≤ cap vertices (tiles stamped `keep` stay). Returns the vertices dropped. */
  evict(keep = this.clock): number {
    if (this.total <= this.cap) return 0;
    const order = [...this.tiles.values()].filter((t) => t.used < keep).sort((a, b) => a.used - b.used);
    let dropped = 0;
    for (const t of order) {
      if (this.total <= this.cap) break;
      dropped += meshVerts(t.mesh);
      this.dropTile(t);
    }
    return dropped;
  }

  clear(): void {
    for (const t of [...this.tiles.values()]) this.dropTile(t);
    this.clock = 0;
  }

  dropTile(t: ScanTile): void {
    if (this.tiles.get(t.key) !== t) return;
    this.total -= meshVerts(t.mesh);
    this.surveyed -= t.mesh.area;
    this.tiles.delete(t.key);
  }
}

/** One ping's write into the record, tile by tile. */
export class ScanPing {
  readonly sphere: Sphere;
  private readonly rec: ScanRecord;
  private readonly done = new Set<number>();
  /** Triangles written / old triangles cut or removed (tests, debug). */
  added = 0;
  cut = 0;

  constructor(rec: ScanRecord, sphere: Sphere) {
    this.rec = rec;
    this.sphere = sphere;
  }

  /**
   * Tile (tx, tz): keep the old surface outside the sphere, add the part of `seen`
   * (the ping's soup for this tile, or null) inside it. Once per tile per ping.
   * Returns the triangles processed (the sweep's work measure).
   */
  commit(tx: number, tz: number, seen: Soup | null): number {
    const key = tileKey(tx, tz);
    if (this.done.has(key)) return 0;
    this.done.add(key);
    const old = this.rec.tiles.get(key);
    const next = newSoup();
    let cut = 0;
    if (old) cut = clipSoup(soupOf(old.mesh, tx, tz, newSoup()), this.sphere, "out", next);
    const kept = soupTris(next);
    if (seen) clipSoup(seen, this.sphere, "in", next);
    const added = soupTris(next) - kept;
    const work = (old ? old.mesh.idx.length / 3 : 0) + (seen ? soupTris(seen) : 0);
    if (cut === 0 && added === 0) return work; // untouched: no rebuild, no LRU bump
    this.cut += cut;
    this.added += added;
    this.rec.set(tx, tz, buildMesh(next, tx, tz), this.rec.now);
    return work;
  }

  /**
   * Every tile whose triangles can reach into the sphere (its footprint grown by the
   * pad overlaps it, x / z) with its farthest corner's distance (m).
   */
  tilesInReach(): { tx: number; tz: number; far: number }[] {
    const T = SCAN_GRID.tile, { x, z, r } = this.sphere, reach = r + SCAN_GRID.pad;
    const out: { tx: number; tz: number; far: number }[] = [];
    for (let tx = Math.floor((x - reach) / T); tx <= Math.floor((x + reach) / T); tx++)
      for (let tz = Math.floor((z - reach) / T); tz <= Math.floor((z + reach) / T); tz++) {
        const nx = Math.max(tx * T - x, 0, x - (tx + 1) * T), nz = Math.max(tz * T - z, 0, z - (tz + 1) * T);
        if (nx * nx + nz * nz > reach * reach) continue;
        const fx = Math.max(Math.abs(tx * T - x), Math.abs((tx + 1) * T - x)), fz = Math.max(Math.abs(tz * T - z), Math.abs((tz + 1) * T - z));
        out.push({ tx, tz, far: Math.hypot(fx, fz) });
      }
    return out;
  }
}
