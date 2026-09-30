/**
 * The save format migrations, keyed by the version they upgrade from (run in
 * sequence by migrate.ts). Each works on the raw stored object and must not trust
 * it: validate.ts checks the result.
 *   1 → 2 (M2): generation.allocInput = N − P − B from the stored ledger, the
 *               input the generation's site table was (implicitly) built from.
 *   2 → 3 (M4): every node still full (harvested "", partial []), no lost caches
 *               (a lost pool no cache claims is moved to S by reconcileCaches.ts).
 */
import { PARTICLE_TYPE_COUNT } from "../particles/particleTypes";

export type RawSave = Record<string, unknown>;
export type Migration = (raw: RawSave) => RawSave;

const vectorOr = (v: unknown, fallback: number[]): number[] =>
  Array.isArray(v) && v.length === PARTICLE_TYPE_COUNT && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? v : fallback;

/** R = N − P − B, clamped to [0, N] as integers; malformed input stays malformed for validate.ts. */
function allocInputOfRaw(raw: RawSave): unknown {
  const totals = raw.totals;
  if (!Array.isArray(totals)) return totals;
  const zero = new Array<number>(PARTICLE_TYPE_COUNT).fill(0);
  const ledger = typeof raw.ledger === "object" && raw.ledger !== null ? (raw.ledger as Record<string, unknown>) : {};
  const player = vectorOr(ledger.player, zero), base = vectorOr(ledger.base, zero);
  return totals.map((n: unknown, k) => (typeof n === "number" ? Math.min(n, Math.max(0, Math.floor(n - player[k] - base[k]))) : n));
}

const divesOfRaw = (raw: RawSave): unknown => (isRecord(raw.stats) ? raw.stats.divesStarted : 0);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const SAVE_MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (raw) => ({ ...raw, generation: { allocInput: allocInputOfRaw(raw) } }),
  2: (raw) => ({ ...raw, generation: isRecord(raw.generation) ? { ...raw.generation, harvested: "", partial: [] } : raw.generation, caches: [] }),
  3: (raw) => ({ ...raw, generation: isRecord(raw.generation) ? { ...raw.generation, dives: divesOfRaw(raw) } : raw.generation, base: null }),
};
