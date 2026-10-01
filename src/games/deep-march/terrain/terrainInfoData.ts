/**
 * Terrain classification data (terrainInfo.ts): what a column ships to the main
 * thread and what the store's queries return.
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
 */
import type { RegionKey } from "./regions";
import type { SiteLayout } from "./siteLayout";
import type { EnvironmentKind, SurfaceType } from "./terrainCodes";

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

export type TerrainGeometry = {
  seed: number;
  boundsSize: number;
  numPointsPerAxis: number;
  /**
   * World scale S: the stored columns are base-scale (world / S) classifications;
   * queries take and return world coordinates / distances. Default 1.
   */
  scale?: number;
  /** Explicit site layout of a bounded world (siteLayout.ts); default none. */
  layout?: SiteLayout | null;
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
