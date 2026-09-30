/**
 * Where a dive's scan record lives (pure).
 *  - free dive: this browser session only, in memory, for the last seed dived
 *    (a new seed replaces it); bounded by the record's LRU budget;
 *  - conserve: one blob per save in the game store (`scan/<slot>`), tagged with the
 *    world's creation time and seed so a new world in the slot never inherits it.
 *    The tide never touches it: an old scan stays (stale) until pinged over.
 */
import { decodeScan, encodeScan } from "./scanCodec";
import { ScanRecord } from "./scanRecord";

export type ScanStore = {
  /** The record to dive with (empty when nothing usable is stored). */
  open(cap: number): ScanRecord;
  /** Write it out (conserve); the free dive keeps it in memory. */
  save(rec: ScanRecord): void;
  readonly persistent: boolean;
};

/** A synchronous key → value store (the save backend's shape). */
export type ScanKeyValue = { read(key: string): unknown; write(key: string, value: unknown): void };

export type StoredScan = { v: 1; tag: string; bytes: Uint8Array };

let session: { seed: number; rec: ScanRecord } | null = null;

export function sessionScanStore(seed: number): ScanStore {
  return {
    persistent: false,
    open(cap) {
      if (session?.seed !== seed || session.rec.cap !== cap) session = { seed, rec: new ScanRecord(cap) };
      return session.rec;
    },
    save() {},
  };
}

/** Tests: forget the free dive's session record. */
export function resetSessionScans(): void {
  session = null;
}

export function savedScanStore(kv: ScanKeyValue, key: string, tag: string): ScanStore {
  return {
    persistent: true,
    open(cap) {
      const raw = kv.read(key) as Partial<StoredScan> | undefined;
      const ok = raw && raw.v === 1 && raw.tag === tag && raw.bytes instanceof Uint8Array;
      return (ok && decodeScan(raw.bytes!, cap)) || new ScanRecord(cap);
    },
    save(rec) {
      const value: StoredScan = { v: 1, tag, bytes: encodeScan(rec) };
      kv.write(key, value);
    },
  };
}

/** The conserve save's scan key and world tag (slot id, creation time, seed). */
export function saveScanKey(save: { id: string; createdAt: number; seed: number }): { key: string; tag: string } {
  return { key: `scan/${save.id}`, tag: `${save.createdAt}:${save.seed}` };
}
