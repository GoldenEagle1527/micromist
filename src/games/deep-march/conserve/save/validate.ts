/**
 * Structural check of a (migrated) raw save. The totals must be exact — they are
 * the authority. Pool vectors only need the right shape here: their values are
 * sanitized and made to conserve by reconcile.ts.
 */
import { POOL_IDS } from "../ledger/pools";
import { isCountVector, isNumberVector } from "../particles/particleVector";
import type { RawSave } from "./migrate";
import { SAVE_VERSION, type EndingA, type WorldSave } from "./schema";

export type ValidateResult = { ok: true; save: WorldSave } | { ok: false; reason: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEndingA = (v: unknown): v is EndingA => v === "sealed" || v === "annihilated";

function fieldProblem(raw: RawSave): string | null {
  if (raw.v !== SAVE_VERSION) return `version ${String(raw.v)}`;
  if (!isString(raw.id) || !raw.id) return "id";
  if (!isTime(raw.createdAt) || !isTime(raw.savedAt)) return "timestamps";
  if (!isString(raw.seedText) || typeof raw.seed !== "number" || !Number.isInteger(raw.seed)) return "seed";
  if (!isRecord(raw.size) || !isPositiveInt(raw.size.sitesX) || !isPositiveInt(raw.size.sitesZ)) return "size";
  if (!isPositiveInt(raw.gen)) return "gen";
  if (!isCountVector(raw.totals)) return "totals";
  return null;
}

function ledgerProblem(raw: RawSave): string | null {
  if (!isRecord(raw.ledger)) return "ledger";
  const ledger = raw.ledger;
  const bad = POOL_IDS.find((id) => !isNumberVector(ledger[id]));
  return bad ? `ledger.${bad}` : null;
}

function extrasProblem(raw: RawSave): string | null {
  if (!isRecord(raw.stats) || typeof raw.stats.divesStarted !== "number" || !Number.isSafeInteger(raw.stats.divesStarted) || raw.stats.divesStarted < 0) return "stats";
  if (!isRecord(raw.flags)) return "flags";
  if (raw.flags.endingA !== undefined && !isEndingA(raw.flags.endingA)) return "flags.endingA";
  if (raw.flags.endingB !== undefined && typeof raw.flags.endingB !== "boolean") return "flags.endingB";
  return null;
}

export function validateSave(raw: RawSave): ValidateResult {
  const problem = fieldProblem(raw) ?? ledgerProblem(raw) ?? extrasProblem(raw);
  if (problem) return { ok: false, reason: `invalid ${problem}` };
  return { ok: true, save: raw as unknown as WorldSave };
}
