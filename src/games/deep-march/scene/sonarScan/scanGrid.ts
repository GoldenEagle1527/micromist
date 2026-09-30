/**
 * The sonar scan record's grid and vertex quantisation (pure, no three).
 *  - tiles: 32 m squares (all heights), the unit of storage, LRU eviction and saving;
 *    a recorded triangle belongs to the tile holding its centroid, so its corners may
 *    stick out of the tile by up to `pad` m;
 *  - positions snap to one absolute world grid (1/1024 m across, 1/16 m up), so the
 *    same terrain vertex is bit-identical in every tile and in every ping — the two
 *    sides of a ping's sphere cut then meet exactly (sphereClip.ts);
 *  - normals: octahedral, 8 + 8 bits.
 */
export const SCAN_GRID = {
  /** Tile width (m). */
  tile: 32,
  /** How far a tile's triangles may reach past its edges (m). */
  pad: 16,
  /** Steps per metre across (x / z) and up (y); lowest recordable height (m). */
  xzRes: 1024,
  yRes: 16,
  yMin: -2048,
} as const;

const Q_MAX = 65535;
const TILES_PER_ROW = 65536;

export const tileCoord = (v: number): number => Math.floor(v / SCAN_GRID.tile);
export const tileKey = (tx: number, tz: number): number => (tx + 32768) * TILES_PER_ROW + (tz + 32768);
export const tileX = (key: number): number => Math.floor(key / TILES_PER_ROW) - 32768;
export const tileZ = (key: number): number => (key % TILES_PER_ROW) - 32768;

const clampQ = (q: number) => (q < 0 ? 0 : q > Q_MAX ? Q_MAX : q);
/** Tile t's quantisation origin across (m): its corner minus the pad. */
const origin = (t: number) => t * SCAN_GRID.tile - SCAN_GRID.pad;

/** World x (or z) → its step in tile t (0 … 65535). */
export const quantXZ = (v: number, t: number): number => clampQ(Math.round((v - origin(t)) * SCAN_GRID.xzRes));
export const dequantXZ = (q: number, t: number): number => origin(t) + q / SCAN_GRID.xzRes;
export const quantY = (y: number): number => clampQ(Math.round((y - SCAN_GRID.yMin) * SCAN_GRID.yRes));
export const dequantY = (q: number): number => SCAN_GRID.yMin + q / SCAN_GRID.yRes;

/** Snap to the world grid (what quantising and back gives, independent of the tile). */
export const snapXZ = (v: number): number => Math.round(v * SCAN_GRID.xzRes) / SCAN_GRID.xzRes;
export const snapY = (y: number): number => SCAN_GRID.yMin + clampQ(Math.round((y - SCAN_GRID.yMin) * SCAN_GRID.yRes)) / SCAN_GRID.yRes;

const oct8 = (v: number) => Math.min(255, Math.max(0, Math.round((v * 0.5 + 0.5) * 255)));

/** Unit normal → two bytes (octahedral: u from x, v from z, folded when y < 0). */
export function encodeNormal(nx: number, ny: number, nz: number, out: Uint8Array, o: number): void {
  const l1 = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let u = nx / l1, v = nz / l1;
  if (ny < 0) {
    const pu = u;
    u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1);
    v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1);
  }
  out[o] = oct8(u);
  out[o + 1] = oct8(v);
}

/** Two bytes → unit normal, written to out[o … o + 2]. */
export function decodeNormal(a: number, b: number, out: { [i: number]: number }, o: number): void {
  let u = (a / 255) * 2 - 1, v = (b / 255) * 2 - 1;
  const ny = 1 - Math.abs(u) - Math.abs(v);
  if (ny < 0) {
    const pu = u;
    u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1);
    v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1);
  }
  const l = Math.hypot(u, ny, v) || 1;
  out[o] = u / l;
  out[o + 1] = ny / l;
  out[o + 2] = v / l;
}
