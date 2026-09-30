/**
 * Read / write one save slot: migrate → validate → reconcile (pools, then lost
 * caches against the lost pool) on the way in, a
 * plain object on the way out (game-store key `save/<slot id>`).
 */
import { migrateSave } from "./migrate";
import { reconcilePools, type Repair } from "./reconcile";
import { reconcileCaches } from "./reconcileCaches";
import type { SaveBackend } from "./saveBackend";
import type { WorldSave } from "./schema";
import { validateSave } from "./validate";

export type SlotRead =
  | { status: "empty" }
  | { status: "unreadable"; reason: string }
  | { status: "ok"; save: WorldSave; repairs: Repair[]; migratedFrom: number };

export function slotKey(slotId: string): string {
  return `save/${slotId}`;
}

export function readSlot(backend: SaveBackend, slotId: string): SlotRead {
  const stored = backend.read(slotKey(slotId));
  if (stored === undefined || stored === null) return { status: "empty" };
  const migrated = migrateSave(stored);
  if (!migrated.ok) return { status: "unreadable", reason: migrated.reason };
  const valid = validateSave(migrated.raw);
  if (!valid.ok) return { status: "unreadable", reason: valid.reason };
  const fixed = reconcilePools(valid.save.totals, valid.save.ledger);
  const lost = reconcileCaches(valid.save.caches, fixed.pools);
  return { status: "ok", save: { ...valid.save, ledger: lost.pools, caches: lost.caches }, repairs: [...fixed.repairs, ...lost.repairs], migratedFrom: migrated.from };
}

/** Serialized size in bytes (UTF-8 JSON; diagnostics and the < 20 KB budget). */
export function saveBytes(save: WorldSave): number {
  return new TextEncoder().encode(JSON.stringify(save)).byteLength;
}

export function writeSlot(backend: SaveBackend, save: WorldSave): void {
  backend.write(slotKey(save.id), save);
}
