/**
 * Save format migrations: raw stored object (any older version) → current version.
 * A migration upgrades version n to n + 1; they run in sequence. A save from a
 * newer build than this one is refused (never downgraded, never overwritten).
 */
import { SAVE_VERSION } from "./schema";

export type RawSave = Record<string, unknown>;
export type Migration = (raw: RawSave) => RawSave;

/** Keyed by the version they upgrade from. Empty while v1 is the only format. */
export const SAVE_MIGRATIONS: Readonly<Record<number, Migration>> = {};

export type MigrateFailure = "not-an-object" | "no-version" | "future-version" | "missing-migration";
export type MigrateResult = { ok: true; raw: RawSave; from: number } | { ok: false; reason: MigrateFailure };

function isRawSave(value: unknown): value is RawSave {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionOf(raw: RawSave): number | null {
  const v = raw.v;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

export function migrateSave(value: unknown, migrations: Readonly<Record<number, Migration>> = SAVE_MIGRATIONS, target: number = SAVE_VERSION): MigrateResult {
  if (!isRawSave(value)) return { ok: false, reason: "not-an-object" };
  const from = versionOf(value);
  if (from === null) return { ok: false, reason: "no-version" };
  if (from > target) return { ok: false, reason: "future-version" };
  let raw = value;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, reason: "missing-migration" };
    raw = { ...step(raw), v: v + 1 };
  }
  return { ok: true, raw, from };
}
