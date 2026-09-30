/**
 * Binary form of a scan record (pure): what a conserve save keeps between sessions.
 *   "DMSC" · version u8 · 3 reserved · tile count u32 ·
 *   per tile: tx i16 · tz i16 · vertices u32 · triangles u32 ·
 *             vertices × (x, y, z u16) · vertices × (normal 2 × u8) · triangles × 3 × u16
 * (little endian, tileMesh.ts quantisation). Tiles go out least recently pinged first,
 * so the LRU order survives the trip. decode() returns null for anything malformed
 * or from an older version (version 1 held points): the save then starts without scans.
 */
import { SCAN_GRID } from "./scanGrid";
import { ScanRecord } from "./scanRecord";
import type { TileMesh } from "./tileMesh";

const MAGIC = [0x44, 0x4d, 0x53, 0x43]; // "DMSC"
export const SCAN_CODEC_VERSION = 2;
const HEAD = 12;
const TILE_HEAD = 12;

const tileBytes = (m: TileMesh) => TILE_HEAD + m.pos.length * 2 + m.nrm.length + m.idx.length * 2;

export function encodeScan(rec: ScanRecord): Uint8Array {
  const tiles = [...rec.tiles.values()].sort((a, b) => a.used - b.used);
  const out = new Uint8Array(HEAD + tiles.reduce((s, t) => s + tileBytes(t.mesh), 0));
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = SCAN_CODEC_VERSION;
  view.setUint32(8, tiles.length, true);
  let o = HEAD;
  for (const { tx, tz, mesh: m } of tiles) {
    view.setInt16(o, tx, true);
    view.setInt16(o + 2, tz, true);
    view.setUint32(o + 4, m.pos.length / 3, true);
    view.setUint32(o + 8, m.idx.length / 3, true);
    o += TILE_HEAD;
    for (let k = 0; k < m.pos.length; k++, o += 2) view.setUint16(o, m.pos[k], true);
    out.set(m.nrm, o);
    o += m.nrm.length;
    for (let k = 0; k < m.idx.length; k++, o += 2) view.setUint16(o, m.idx[k], true);
  }
  return out;
}

/** Bytes → a record with vertex budget `cap` (over it: the oldest tiles are dropped). Null if malformed. */
export function decodeScan(bytes: Uint8Array, cap: number): ScanRecord | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEAD) return null;
  if (MAGIC.some((m, i) => bytes[i] !== m) || bytes[4] !== SCAN_CODEC_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  const rec = new ScanRecord(cap);
  const seen = new Set<number>();
  let o = HEAD;
  for (let i = 0; i < count; i++) {
    if (o + TILE_HEAD > bytes.length) return null;
    const tx = view.getInt16(o, true), tz = view.getInt16(o + 2, true), nv = view.getUint32(o + 4, true), nt = view.getUint32(o + 8, true);
    o += TILE_HEAD;
    const key = tx * 65536 + tz;
    if (nv === 0 || nv > 65535 || nt === 0 || o + nv * 8 + nt * 6 > bytes.length || seen.has(key)) return null;
    seen.add(key);
    const pos = new Uint16Array(nv * 3), idx = new Uint16Array(nt * 3);
    for (let k = 0; k < pos.length; k++, o += 2) pos[k] = view.getUint16(o, true);
    const nrm = bytes.slice(o, o + nv * 2);
    o += nv * 2;
    for (let k = 0; k < idx.length; k++, o += 2) if ((idx[k] = view.getUint16(o, true)) >= nv) return null;
    rec.set(tx, tz, { pos, nrm, idx, area: footprint(pos, idx) }, i - count); // older than any ping of this session
  }
  if (o !== bytes.length) return null;
  rec.evict();
  return rec;
}

/** Surveyed footprint of a quantised mesh (m², x / z projection; the tile offset cancels). */
function footprint(pos: Uint16Array, idx: Uint16Array): number {
  let a = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const p = idx[k] * 3, q = idx[k + 1] * 3, r = idx[k + 2] * 3;
    a += Math.abs((pos[q] - pos[p]) * (pos[r + 2] - pos[p + 2]) - (pos[r] - pos[p]) * (pos[q + 2] - pos[p + 2]));
  }
  return a / 2 / (SCAN_GRID.xzRes * SCAN_GRID.xzRes);
}
