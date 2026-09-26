/**
 * Generation-time terrain classification — the data future biome / spawning
 * systems read. Built in the mesher worker for every column right after the
 * final density (vertical smoothing + floating-rock removal) and the mesh, and
 * shipped to the main thread as typed arrays (`ChunkTerrainInfo`). Nothing here
 * depends on the player; the same seed gives the same data (per device preset:
 * the low-spec lattice is coarser, so values differ slightly between presets).
 *
 * ── Data per column (ChunkTerrainInfo) ─────────────────────────────────────
 *  (a) Class grid — water classification on a sub-lattice every `stride`
 *      lattice points (≈ 1 unit: stride 3 × 0.345 on desktop, 2 × 0.476 on
 *      low-spec). Cell (ix, iy, iz) is the global lattice point
 *      ((ci0 + ix)·stride, (cj0 + iy)·stride, (ck0 + iz)·stride); array index
 *      (iz · ny + iy) · nx + ix. Per cell:
 *        env    EnvCode (ROCK for solid cells)
 *        up     distance to rock straight up, ×4 (0.25 u steps, 255 = ≥ 63.75)
 *        down   distance to rock straight down, ×4
 *        side   nearest horizontal rock within the scan range, ×4 (255 = none)
 *        sides  bit d set = rock within range in horizontal direction d
 *               (d = 0 … 7: +x, +x+z, +z, −x+z, −x, −x−z, −z, +x−z)
 *      Seam consistency: each column reads its own cells from the final
 *      density grid and a 3-cell ring around it from exactly the same
 *      arithmetic the neighbour uses for its own lattice, so both sides of a
 *      seam see identical occupancy (floater removal is the only exception —
 *      the ring does not know the neighbour's removed rock).
 *  (b) Spawn candidates — one per 1.5-unit world cell that contains surface:
 *      the mesh vertex nearest to a seeded jitter point of the cell (cells are
 *      owned by the column whose footprint contains the jitter point, so each
 *      appears exactly once). Struct-of-arrays, `count` entries:
 *        pos (x,y,z) · nrm (×127, points into water) · type SurfaceCode ·
 *        env (EnvCode of the water in front) · exposure (0…255) ·
 *        flags (bit 0 sheltered) · curv (−127 concave … 127 convex) ·
 *        region (macro region id) · regionW (dominant weight ×255) · regionEdge (units to border, cap 255)
 *  (c) Macro terrain region (regions.ts) — the region layout that also drives
 *      the density parameters: sand / reef / canyon / cave / terrace / trench,
 *      ~80–150-unit areas with ~18-unit blend bands. Region is a function of
 *      (x, z) only, so it is stored per class-cell column (nx · nz, index
 *      iz · nx + ix): regionId · regionW (dominant weight ×255, 255 = core,
 *      ~128 = on a border) · regionEdge (distance to the nearest border, units,
 *      cap 255). Future biome = region × env / surface type.
 *
 * ── Classes ────────────────────────────────────────────────────────────────
 *  EnvCode (water cells; thresholds in ENV_T):
 *    cave      rock within 4.5 above and ≥ 6 of 8 horizontal directions closed
 *    overhang  rock within 3 above (open sideways: overhang, arch)
 *    canyon    two opposite vertical walls (x, z or diagonal pair), gap ≤ 6.5, a perpendicular side open
 *    cliff     vertical wall within 2
 *    ridge     floor within 3, slope ≤ 35°, floor falls ≥ 1 in ≥ 5 of 8 directions (2 cells out)
 *    flat      floor within 4.5, slope < 22°        slope  floor within 4.5, slope ≥ 22°
 *    (no floor near: vertical side rock → cliff, other side rock → slope)
 *    open      the rest: no rock within 3 above, 4.5 below, none sideways within ~3
 *  SurfaceCode (spawn candidates, first match):
 *    ceiling     normal.y < −0.45
 *    cave-floor  floor-ish (normal.y ≥ 0.45) facing a cave cell
 *    crevice     concave (curv ≥ 0.12: neighbours within 1 u sit above the tangent plane)
 *    ledge-top   normal.y ≥ 0.6 and the floor 1–2 cells aside drops ≥ 2
 *    ridge       convex (curv ≤ −0.12) and normal.y ≥ 0.2
 *    floor-flat  normal.y ≥ 0.8     floor-slope  ≥ 0.45     wall  otherwise
 *  exposure = share of the 8 horizontal directions + up that are open from the
 *  cell in front; sheltered = exposure < 0.45, env cave/overhang, or AO < 0.4.
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

import { REGION_COUNT, REGION_KEYS, createRegionField, createRegionSample, type RegionField, type RegionKey } from "./regions";

export { REGION_COUNT, REGION_KEYS };

// ───────────────────────── codes ─────────────────────────

export type EnvironmentKind = "open" | "flat" | "slope" | "cliff" | "cave" | "overhang" | "canyon" | "ridge";
/** EnvCode → kind; code 0 is solid rock. */
export const ENV_KINDS: readonly (EnvironmentKind | "rock")[] = ["rock", "open", "flat", "slope", "cliff", "cave", "overhang", "canyon", "ridge"];
export const ENV = { ROCK: 0, OPEN: 1, FLAT: 2, SLOPE: 3, CLIFF: 4, CAVE: 5, OVERHANG: 6, CANYON: 7, RIDGE: 8 } as const;

export type SurfaceType = "floor-flat" | "floor-slope" | "wall" | "ceiling" | "ledge-top" | "crevice" | "ridge" | "cave-floor";
export const SURFACE_TYPES: readonly SurfaceType[] = ["floor-flat", "floor-slope", "wall", "ceiling", "ledge-top", "crevice", "ridge", "cave-floor"];
export const SURF = { FLOOR_FLAT: 0, FLOOR_SLOPE: 1, WALL: 2, CEILING: 3, LEDGE_TOP: 4, CREVICE: 5, RIDGE: 6, CAVE_FLOOR: 7 } as const;

/** Classification thresholds (world units / degrees). */
export const ENV_T = {
  /** Target class-grid spacing; stride = round(this / lattice spacing). */
  classSpacing: 1,
  /** Horizontal scan: axis directions 3 cells, diagonals 2 cells (≈ 3 u). */
  ringAxis: 3,
  ringDiag: 2,
  caveUp: 4.5,
  caveClosed: 6,
  overhangUp: 3,
  canyonGap: 6.5,
  cliffDist: 2,
  ridgeFloor: 3,
  ridgeSlope: 35,
  ridgeDrop: 1,
  ridgeFalloff: 5,
  openClear: 4.5,
  floorNear: 4.5,
  flatSlope: 22,
  spawnCell: 1.5,
  frontOffset: 0.7,
  curvRadius: 1,
  concave: 0.12,
  convex: -0.12,
  ledgeDrop: 2,
  /** Convex points only count as ridge when facing up-ish (convex vertical faces stay walls). */
  ridgeMinNy: 0.2,
  shelteredExposure: 0.45,
  shelteredAo: 0.4,
} as const;

// ───────────────────────── data ─────────────────────────

export type ChunkTerrainInfo = {
  cx: number;
  cz: number;
  /** Lattice points per class cell step. */
  stride: number;
  /** World units per class cell step (= stride × lattice spacing). */
  spacing: number;
  ci0: number;
  cj0: number;
  ck0: number;
  nx: number;
  ny: number;
  nz: number;
  env: Uint8Array;
  up: Uint8Array;
  down: Uint8Array;
  side: Uint8Array;
  sides: Uint8Array;
  /** Macro region per class-cell column (nx · nz, index iz · nx + ix). */
  regionId: Uint8Array;
  regionW: Uint8Array;
  regionEdge: Uint8Array;
  spawn: {
    count: number;
    pos: Float32Array;
    nrm: Int8Array;
    type: Uint8Array;
    env: Uint8Array;
    exposure: Uint8Array;
    flags: Uint8Array;
    curv: Int8Array;
    region: Uint8Array;
    regionW: Uint8Array;
    regionEdge: Uint8Array;
  };
};

/** Buffers to list as transferables when posting a ChunkTerrainInfo. */
export function terrainInfoTransfers(info: ChunkTerrainInfo): ArrayBuffer[] {
  const s = info.spawn;
  return [
    info.env, info.up, info.down, info.side, info.sides, info.regionId, info.regionW, info.regionEdge,
    s.pos, s.nrm, s.type, s.env, s.exposure, s.flags, s.curv, s.region, s.regionW, s.regionEdge,
  ].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

export type EnvSample = {
  kind: EnvironmentKind;
  code: number;
  /** Distances in world units (Infinity = none within range / cap). */
  up: number;
  down: number;
  side: number;
  sides: number;
  /** Macro region id (see regions.ts), its dominant weight (0.5 … 1) and distance to the nearest border. */
  region: number;
  regionKey: RegionKey;
  regionWeight: number;
  regionEdge: number;
  /** World position of the class cell that answered. */
  x: number;
  y: number;
  z: number;
};

export type SpawnCandidate = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  type: SurfaceType;
  env: EnvironmentKind | "rock";
  exposure: number;
  sheltered: boolean;
  curvature: number;
  depth: number;
  region: number;
  regionKey: RegionKey;
  regionWeight: number;
  regionEdge: number;
  /** Column and index (stable id per seed/preset: `${cx},${cz}#${index}`). */
  cx: number;
  cz: number;
  index: number;
};

// ───────────────────────── hashing / regions ─────────────────────────

/** 32-bit integer hash of (seed, a, b, c, d). */
export function hash4(seed: number, a: number, b: number, c: number, d = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const v of [a, b, c, d]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}
export const hash01 = (seed: number, a: number, b: number, c: number, d = 0) => hash4(seed, a, b, c, d) / 4294967296;

const q4 = (v: number) => (v >= 255 ? Infinity : v / 4);

// ───────────────────────── main-thread store ─────────────────────────

export type TerrainGeometry = {
  seed: number;
  boundsSize: number;
  numPointsPerAxis: number;
};

export type RegionInfo = {
  id: number;
  key: RegionKey;
  /** Weight per region id (sum 1). */
  weights: number[];
  /** Weight of the dominant region (1 = core, ≈ 0.5 = on a border). */
  dominant: number;
  /** Approximate distance to the nearest border with another region (units, ≤ 255). */
  edge: number;
};

export type Bounds = { minX: number; minY?: number; minZ: number; maxX: number; maxY?: number; maxZ: number };

/** Holds every loaded column's ChunkTerrainInfo and answers queries. */
export class TerrainInfoStore {
  private readonly cols = new Map<string, ChunkTerrainInfo>();
  private readonly g: TerrainGeometry;
  private readonly sp: number;
  private readonly regions: RegionField;
  private readonly rs = createRegionSample();
  /** Bumped whenever a column is added or removed. */
  version = 0;

  constructor(g: TerrainGeometry) {
    this.g = g;
    this.sp = g.boundsSize / (g.numPointsPerAxis - 1);
    this.regions = createRegionField(g.seed);
  }

  /** Macro region at (x, z) with blend weights (pure function of seed + position). */
  getRegionAt(x: number, z: number): RegionInfo {
    const r = this.regions.sample(x, z, this.rs);
    return { id: r.id, key: REGION_KEYS[r.id], weights: Array.from(r.w), dominant: r.dominant, edge: r.edge };
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
  getEnvAt(x: number, y: number, z: number): EnvSample | null {
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
      up: q4(info.up[best]),
      down: q4(info.down[best]),
      side: q4(info.side[best]),
      sides: info.sides[best],
      region: info.regionId[rc],
      regionKey: REGION_KEYS[info.regionId[rc]],
      regionWeight: info.regionW[rc] / 255,
      regionEdge: info.regionEdge[rc],
      x: wx,
      y: -h + (info.cj0 + iy) * S * sp,
      z: wz,
    };
  }

  /** Decode candidate `i` of a column. */
  spawnAt(info: ChunkTerrainInfo, i: number): SpawnCandidate {
    const s = info.spawn;
    return {
      x: s.pos[i * 3],
      y: s.pos[i * 3 + 1],
      z: s.pos[i * 3 + 2],
      nx: s.nrm[i * 3] / 127,
      ny: s.nrm[i * 3 + 1] / 127,
      nz: s.nrm[i * 3 + 2] / 127,
      type: SURFACE_TYPES[s.type[i]],
      env: ENV_KINDS[s.env[i]],
      exposure: s.exposure[i] / 255,
      sheltered: (s.flags[i] & 1) !== 0,
      curvature: s.curv[i] / 127,
      depth: 100 - s.pos[i * 3 + 1],
      region: s.region[i],
      regionKey: REGION_KEYS[s.region[i]],
      regionWeight: s.regionW[i] / 255,
      regionEdge: s.regionEdge[i],
      cx: info.cx,
      cz: info.cz,
      index: i,
    };
  }

  /** All loaded candidates inside bounds (y limits optional), optionally filtered. */
  getSpawnCandidates(b: Bounds, filter?: (c: SpawnCandidate) => boolean): SpawnCandidate[] {
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

  /** Visit every loaded candidate (column, index) without decoding. */
  forEachSpawn(fn: (info: ChunkTerrainInfo, i: number) => void) {
    for (const info of this.cols.values()) for (let i = 0; i < info.spawn.count; i++) fn(info, i);
  }
}
