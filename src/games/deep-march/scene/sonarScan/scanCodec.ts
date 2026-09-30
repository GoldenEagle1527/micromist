/**
 * Binary form of a scan record (pure): what a conserve save keeps between sessions.
 *   "DMSC" · version u8 · 3 reserved · tile count u32 ·
 *   per tile: tx i16 · tz i16 · n u32 · n × 7-byte points (scanGrid.ts packing, little endian)
 * Tiles go out least recently pinged first, so the LRU order survives the trip.
 * decode() returns null for anything malformed (the save then starts without scans).
 */
import { CELLS_PER_TILE, SCAN_GRID, cellKey, unpackPoint, type ScanPoint } from "./scanGrid";
import { ScanRecord } from "./scanRecord";

const MAGIC = [0x44, 0x4d, 0x53, 0x43]; // "DMSC"
export const SCAN_CODEC_VERSION = 1;
const HEAD = 12;
const TILE_HEAD = 8;
const POINT = 7;

export function encodeScan(rec: ScanRecord): Uint8Array {
  const tiles = [...rec.tiles.values()].filter((t) => t.pts.size > 0).sort((a, b) => a.used - b.used);
  const size = HEAD + tiles.reduce((s, t) => s + TILE_HEAD + POINT * t.pts.size, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = SCAN_CODEC_VERSION;
  view.setUint32(8, tiles.length, true);
  let o = HEAD;
  for (const t of tiles) {
    view.setInt16(o, t.tx, true);
    view.setInt16(o + 2, t.tz, true);
    view.setUint32(o + 4, t.pts.size, true);
    o += TILE_HEAD;
    for (const p of t.pts.values()) {
      let v = p;
      for (let b = 0; b < POINT; b++) {
        const byte = v % 256;
        out[o + b] = byte;
        v = (v - byte) / 256;
      }
      o += POINT;
    }
  }
  return out;
}

/** Bytes → a record with point budget `cap` (over it: the oldest tiles are dropped). Null if malformed. */
export function decodeScan(bytes: Uint8Array, cap: number): ScanRecord | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEAD) return null;
  if (MAGIC.some((m, i) => bytes[i] !== m) || bytes[4] !== SCAN_CODEC_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  const rec = new ScanRecord(cap);
  const pt: ScanPoint = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  let o = HEAD;
  for (let i = 0; i < count; i++) {
    if (o + TILE_HEAD > bytes.length) return null;
    const tx = view.getInt16(o, true), tz = view.getInt16(o + 2, true), n = view.getUint32(o + 4, true);
    o += TILE_HEAD;
    if (n > CELLS_PER_TILE || o + n * POINT > bytes.length || rec.tile(tx, tz, false)) return null;
    const t = rec.tile(tx, tz, true)!;
    t.used = i - count; // older than any ping of this session, in the stored order
    for (let k = 0; k < n; k++, o += POINT) {
      let p = 0;
      for (let b = POINT - 1; b >= 0; b--) p = p * 256 + bytes[o + b];
      unpackPoint(p, tx, tz, pt);
      rec.put(t, cellKey(pt.x - tx * SCAN_GRID.tile, pt.y, pt.z - tz * SCAN_GRID.tile), p);
    }
  }
  if (o !== bytes.length) return null;
  rec.evict();
  return rec;
}
