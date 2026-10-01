/**
 * Generation-time terrain classification — the data future biome / spawning
 * systems read. Built in the mesher worker for every column right after the
 * final density (vertical smoothing + floating-rock removal) and the mesh, and
 * shipped to the main thread as typed arrays (`ChunkTerrainInfo`). Nothing here
 * depends on the player; the same seed gives the same data (per device preset:
 * the low-spec lattice is coarser, so values differ slightly between presets).
 *
 * World scale: the rendered world is the base field magnified by
 * `worldScale` (config.ts). Classification runs on the base field (all unit
 * figures below are base units); a store built with `scale` takes world
 * coordinates in its queries and returns world positions / distances.
 *
 * Codes and thresholds: terrainCodes.ts; the per-column data: terrainInfoData.ts;
 * the generator (mesher worker): terrainInfoGen.ts.
 *
 * ── Main-thread API (TerrainInfoStore, kept by ChunkManager as `terrain`) ──
 *    getEnvAt(x, y, z)                → EnvSample | null (null = column not generated yet)
 *    getRegionAt(x, z)                → RegionInfo (pure; works without loaded columns)
 *    getSpawnCandidates(bounds, filter?) → SpawnCandidate[]
 *    forEachSpawn(fn)                 visit all loaded candidates without allocating arrays
 *  e.g. corals:  getSpawnCandidates(b, c => c.type === "floor-flat" && !c.sheltered)
 *       shells:  … c.type === "crevice" || c.type === "cave-floor"
 *       lurkers: … c.type === "ceiling" && c.env === "cave"
 */

import { REGION_COUNT, REGION_KEYS, createRegionField, createRegionSample, type RegionField } from "./regions";
import { ENV, ENV_KINDS, SURFACE_TYPES, type EnvironmentKind } from "./terrainCodes";
import type { Bounds, ChunkTerrainInfo, EnvSample, RegionInfo, SpawnCandidate, TerrainGeometry } from "./terrainInfoData";

export { REGION_COUNT, REGION_KEYS };
export * from "./terrainCodes";
export * from "./terrainInfoData";

const q4 = (v: number) => (v >= 255 ? Infinity : v / 4);

/** Holds every loaded column's ChunkTerrainInfo and answers queries. */
export class TerrainInfoStore {
  private readonly cols = new Map<string, ChunkTerrainInfo>();
  private readonly g: TerrainGeometry;
  private readonly sp: number;
  private readonly regions: RegionField;
  private readonly rs = createRegionSample();
  /** Bumped whenever a column is added or removed. */
  version = 0;
  /** World scale (stored data is in base units = world / scale). */
  readonly scale: number;

  constructor(g: TerrainGeometry) {
    this.g = g;
    this.scale = g.scale ?? 1;
    this.sp = g.boundsSize / (g.numPointsPerAxis - 1);
    this.regions = createRegionField(g.seed, g.layout ?? null);
  }

  /** Macro region at (x, z) with blend weights (pure function of seed + position). */
  getRegionAt(x: number, z: number): RegionInfo {
    const r = this.regions.sample(x / this.scale, z / this.scale, this.rs);
    return { id: r.id, key: REGION_KEYS[r.id], weights: Array.from(r.w), dominant: r.dominant, edge: r.edge * this.scale };
  }

  set(info: ChunkTerrainInfo) {
    this.cols.set(`${info.cx},${info.cz}`, info);
    this.version++;
  }

  delete(cx: number, cz: number) {
    if (this.cols.delete(`${cx},${cz}`)) this.version++;
  }

  get(cx: number, cz: number): ChunkTerrainInfo | undefined {
    return this.cols.get(`${cx},${cz}`);
  }

  columns(): IterableIterator<ChunkTerrainInfo> {
    return this.cols.values();
  }

  /** Column owning global lattice index gi on one axis. */
  private owner(gi: number): number {
    return Math.floor(gi / (this.g.numPointsPerAxis - 1));
  }

  /** Class of the water around (x, y, z): nearest class cell; if that is rock, the nearest water cell around it. */
  getEnvAt(wx0: number, wy0: number, wz0: number): EnvSample | null {
    const W = this.scale;
    const x = wx0 / W, y = wy0 / W, z = wz0 / W;
    const h = this.g.boundsSize / 2;
    const sp = this.sp;
    // Stride is the same for every column; take it from any loaded one.
    const any = this.cols.values().next().value as ChunkTerrainInfo | undefined;
    if (!any) return null;
    const S = any.stride;
    const ci = Math.round((x + h) / sp / S);
    const ck = Math.round((z + h) / sp / S);
    const info = this.cols.get(`${this.owner(ci * S)},${this.owner(ck * S)}`);
    if (!info) return null;
    const cj = Math.round((y + h) / sp / S);
    const ix0 = ci - info.ci0, iz0 = ck - info.ck0;
    const iy0 = Math.min(info.ny - 1, Math.max(0, cj - info.cj0));
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= 1 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const ix = ix0 + dx, iy = iy0 + dy, iz = iz0 + dz;
        if (ix < 0 || iy < 0 || iz < 0 || ix >= info.nx || iy >= info.ny || iz >= info.nz) continue;
        const idx = (iz * info.ny + iy) * info.nx + ix;
        if (info.env[idx] === ENV.ROCK) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    }
    if (best < 0) return null;
    const ix = best % info.nx;
    const iy = Math.floor(best / info.nx) % info.ny;
    const iz = Math.floor(best / (info.nx * info.ny));
    const code = info.env[best];
    const rc = iz * info.nx + ix;
    const wx = -h + (info.ci0 + ix) * S * sp;
    const wz = -h + (info.ck0 + iz) * S * sp;
    return {
      kind: ENV_KINDS[code] as EnvironmentKind,
      code,
      up: q4(info.up[best]) * W,
      down: q4(info.down[best]) * W,
      side: q4(info.side[best]) * W,
      sides: info.sides[best],
      region: info.regionId[rc],
      regionKey: REGION_KEYS[info.regionId[rc]],
      regionWeight: info.regionW[rc] / 255,
      regionEdge: info.regionEdge[rc] * W,
      x: wx * W,
      y: (-h + (info.cj0 + iy) * S * sp) * W,
      z: wz * W,
    };
  }

  /** Decode candidate `i` of a column. */
  spawnAt(info: ChunkTerrainInfo, i: number): SpawnCandidate {
    const s = info.spawn;
    const W = this.scale;
    return {
      x: s.pos[i * 3] * W,
      y: s.pos[i * 3 + 1] * W,
      z: s.pos[i * 3 + 2] * W,
      nx: s.nrm[i * 3] / 127,
      ny: s.nrm[i * 3 + 1] / 127,
      nz: s.nrm[i * 3 + 2] / 127,
      type: SURFACE_TYPES[s.type[i]],
      env: ENV_KINDS[s.env[i]],
      exposure: s.exposure[i] / 255,
      sheltered: (s.flags[i] & 1) !== 0,
      curvature: s.curv[i] / 127,
      depth: 100 - s.pos[i * 3 + 1] * W,
      region: s.region[i],
      regionKey: REGION_KEYS[s.region[i]],
      regionWeight: s.regionW[i] / 255,
      regionEdge: s.regionEdge[i] * W,
      cx: info.cx,
      cz: info.cz,
      index: i,
    };
  }

  /** All loaded candidates inside bounds (y limits optional), optionally filtered. */
  getSpawnCandidates(wb: Bounds, filter?: (c: SpawnCandidate) => boolean): SpawnCandidate[] {
    const W = this.scale;
    const b: Bounds = {
      minX: wb.minX / W, maxX: wb.maxX / W, minZ: wb.minZ / W, maxZ: wb.maxZ / W,
      minY: wb.minY === undefined ? undefined : wb.minY / W,
      maxY: wb.maxY === undefined ? undefined : wb.maxY / W,
    };
    const out: SpawnCandidate[] = [];
    const size = this.g.boundsSize;
    for (const info of this.cols.values()) {
      const x0 = (info.cx - 0.5) * size, z0 = (info.cz - 0.5) * size;
      if (x0 > b.maxX || x0 + size < b.minX || z0 > b.maxZ || z0 + size < b.minZ) continue;
      const p = info.spawn.pos;
      for (let i = 0; i < info.spawn.count; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if ((b.minY !== undefined && y < b.minY) || (b.maxY !== undefined && y > b.maxY)) continue;
        const c = this.spawnAt(info, i);
        if (!filter || filter(c)) out.push(c);
      }
    }
    return out;
  }

  /** Visit every loaded candidate (column, index) without decoding (positions in base units: × scale for world). */
  forEachSpawn(fn: (info: ChunkTerrainInfo, i: number) => void) {
    for (const info of this.cols.values()) for (let i = 0; i < info.spawn.count; i++) fn(info, i);
  }
}
