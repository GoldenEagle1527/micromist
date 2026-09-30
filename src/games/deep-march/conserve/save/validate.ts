/**
 * Structural check of a (migrated) raw save. The totals must be exact — they are
 * the authority. Pool vectors only need the right shape here: their values are
 * sanitized and made to conserve by reconcile.ts.
 */
import { POOL_IDS } from "../ledger/pools";
import { isCountVector, isNumberVector } from "../particles/particleVector";
import type { RawSave } from "./migrate";
import { SAVE_VERSION, type EndingA, type WorldSave } from "./schema";
import { baseProblem } from "./validateBase";
import { chaosProblem } from "./validateChaos";

export type ValidateResult = { ok: true; save: WorldSave } | { ok: false; reason: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** More than this is not a save this game wrote (it keeps CACHES.max); extra valid ones are trimmed by reconcile. */
const MAX_STORED_CACHES = 64;
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

function generationProblem(raw: RawSave): string | null {
  if (!isRecord(raw.generation)) return "generation";
  const r = raw.generation.allocInput;
  const totals = raw.totals as number[];
  if (!isCountVector(r) || r.some((n, k) => n > totals[k])) return "generation.allocInput";
  const { harvested, partial } = raw.generation;
  if (!isString(harvested) || harvested.length % 4 !== 0 || !BASE64.test(harvested)) return "generation.harvested";
  if (!Array.isArray(partial) || !partial.every((e) => Array.isArray(e) && e.length === 2 && e.every(isCount))) return "generation.partial";
  if (!isCount(raw.generation.dives)) return "generation.dives";
  return null;
}

/** Shape only: counts are fitted to the lost pool by reconcileCaches.ts. */
function cachesProblem(raw: RawSave): string | null {
  const c = raw.caches;
  if (!Array.isArray(c) || c.length > MAX_STORED_CACHES) return "caches";
  const bad = c.findIndex((x) => !isRecord(x) || !isPositiveInt(x.id) || !isPositiveInt(x.gen) || !isNumberVector(x.contents) || !Array.isArray(x.pos) || x.pos.length !== 3 || !x.pos.every((n) => typeof n === "number" && Number.isFinite(n)));
  return bad >= 0 ? `caches[${bad}]` : null;
}

function extrasProblem(raw: RawSave): string | null {
  if (!isRecord(raw.stats) || typeof raw.stats.divesStarted !== "number" || !Number.isSafeInteger(raw.stats.divesStarted) || raw.stats.divesStarted < 0) return "stats";
  if (!isRecord(raw.flags)) return "flags";
  if (raw.flags.endingA !== undefined && !isEndingA(raw.flags.endingA)) return "flags.endingA";
  if (raw.flags.endingB !== undefined && typeof raw.flags.endingB !== "boolean") return "flags.endingB";
  return null;
}

export function validateSave(raw: RawSave): ValidateResult {
  const problem = fieldProblem(raw) ?? ledgerProblem(raw) ?? generationProblem(raw) ?? cachesProblem(raw) ?? baseProblem(raw.base) ?? chaosProblem(raw.chaos) ?? extrasProblem(raw);
  if (problem) return { ok: false, reason: `invalid ${problem}` };
  return { ok: true, save: raw as unknown as WorldSave };
}
