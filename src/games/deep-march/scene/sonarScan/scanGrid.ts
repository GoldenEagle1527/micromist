/**
 * The sonar scan record's grid and point packing (pure, no three).
 *  - tiles: 32 m squares (all heights), the unit of storage, LRU eviction and persistence;
 *  - cells: 2 m cubes inside a tile, at most one recorded point each;
 *  - a point packs into one double (52 bits): x / z in the tile (12 bits each, 1/128 m),
 *    y (16 bits, 1/16 m over −2048 … 2048 m) and its normal (octahedral, 6 + 6 bits).
 */
export const SCAN_GRID = {
  /** Tile width (m). */
  tile: 32,
  /** Cell size (m): one point per cell. */
  cell: 2,
  /** Lowest recordable height (m) and height steps per metre. */
  yMin: -2048,
  yRes: 16,
} as const;

const XZ_RES = 128;
const XZ_MAX = 4095;
const Y_MAX = 65535;
const TILES_PER_ROW = 65536;
const CELLS_PER_ROW = SCAN_GRID.tile / SCAN_GRID.cell; // 16
/** Cells per tile (16 × 16 × 2048). */
export const CELLS_PER_TILE = CELLS_PER_ROW * CELLS_PER_ROW * ((Y_MAX + 1) / SCAN_GRID.yRes / SCAN_GRID.cell);

export const tileCoord = (v: number): number => Math.floor(v / SCAN_GRID.tile);
export const tileKey = (tx: number, tz: number): number => (tx + 32768) * TILES_PER_ROW + (tz + 32768);
export const tileX = (key: number): number => Math.floor(key / TILES_PER_ROW) - 32768;
export const tileZ = (key: number): number => (key % TILES_PER_ROW) - 32768;

const qXZ = (v: number) => Math.min(XZ_MAX, Math.max(0, Math.round(v * XZ_RES)));
const qY = (y: number) => Math.min(Y_MAX, Math.max(0, Math.round((y - SCAN_GRID.yMin) * SCAN_GRID.yRes)));

/** Cell of a point inside its tile (lx, lz: 0 … 32 m from the tile's corner), from its packed (quantised) position. */
export function cellKey(lx: number, y: number, lz: number): number {
  const c = SCAN_GRID.cell;
  const iy = Math.min(2047, Math.floor(qY(y) / SCAN_GRID.yRes / c));
  const ix = Math.min(CELLS_PER_ROW - 1, Math.floor(qXZ(lx) / XZ_RES / c));
  const iz = Math.min(CELLS_PER_ROW - 1, Math.floor(qXZ(lz) / XZ_RES / c));
  return (iy * CELLS_PER_ROW + iz) * CELLS_PER_ROW + ix;
}

const oct = (v: number) => Math.min(63, Math.max(0, Math.round((v * 0.5 + 0.5) * 63)));

/** One recorded point → one double (see the header). Position relative to the tile corner. */
export function packPoint(lx: number, y: number, lz: number, nx: number, ny: number, nz: number): number {
  const qx = qXZ(lx), qz = qXZ(lz), qy = qY(y);
  // octahedral normal
  const l1 = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let u = nx / l1, v = nz / l1;
  if (ny < 0) {
    const pu = u;
    u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1);
    v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1);
  }
  return (((qx * 4096 + qz) * 65536 + qy) * 64 + oct(u)) * 64 + oct(v);
}

export type ScanPoint = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

/** A packed point back to world space (tile tx, tz). */
export function unpackPoint(p: number, tx: number, tz: number, out: ScanPoint): ScanPoint {
  const ov = p % 64;
  let r = (p - ov) / 64;
  const ou = r % 64;
  r = (r - ou) / 64;
  const qy = r % 65536;
  r = (r - qy) / 65536;
  const qz = r % 4096;
  const qx = (r - qz) / 4096;
  out.x = tx * SCAN_GRID.tile + qx / XZ_RES;
  out.z = tz * SCAN_GRID.tile + qz / XZ_RES;
  out.y = qy / SCAN_GRID.yRes + SCAN_GRID.yMin;
  let u = (ou / 63) * 2 - 1, v = (ov / 63) * 2 - 1;
  const ny = 1 - Math.abs(u) - Math.abs(v);
  if (ny < 0) {
    const pu = u;
    u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1);
    v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1);
  }
  const l = Math.hypot(u, ny, v) || 1;
  out.nx = u / l;
  out.ny = ny / l;
  out.nz = v / l;
  return out;
}

/** Squared distance of a packed point (tile tx, tz) from (ox, oy, oz), without the normal. */
export function packedDist2(p: number, tx: number, tz: number, ox: number, oy: number, oz: number): number {
  const r = Math.floor(p / 4096);
  const qy = r % 65536;
  const q = (r - qy) / 65536;
  const qz = q % 4096;
  const qx = (q - qz) / 4096;
  const dx = tx * SCAN_GRID.tile + qx / XZ_RES - ox;
  const dy = qy / SCAN_GRID.yRes + SCAN_GRID.yMin - oy;
  const dz = tz * SCAN_GRID.tile + qz / XZ_RES - oz;
  return dx * dx + dy * dy + dz * dz;
}
