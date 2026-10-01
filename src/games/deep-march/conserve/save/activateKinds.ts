/**
 * Bring an older save's particle kinds up to this build's registry (kinds.ts):
 * every kind with a genesis total that the save has never had (total 0, every
 * pool 0) is created as it would be at genesis — all of it in the world pool W
 * and in the generation's allocation input R, so its nodes appear in this
 * generation already. Pure, idempotent, generic: a later kind activation bumps
 * SAVE_VERSION and maps the new version to `activateKinds` again (migrations.ts).
 *
 * What does not move: the kinds already in the save (their site allocation is
 * per kind, the terrain bias reads only rock, a biome whose signature was absent
 * drew with factor 1 and still does at R = N, node ids of earlier kinds keep
 * their ordinals — new kinds come later in storage order), this generation's
 * chaos (fixed until the tide). The next tide's m counts the new particles as
 * external, like a new world's.
 */
import { KINDS } from "../kinds";
import { POOL_IDS } from "../ledger/pools";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { isCountVector, isNumberVector } from "../particles/particleVector";
import type { RawSave } from "./migrations";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Storage indices of the registry kinds this save lacks. */
export function missingKinds(totals: readonly number[], pools: Readonly<Record<string, readonly number[]>>): number[] {
  return PARTICLE_TYPES.flatMap((type, k) => (KINDS[type].genesis > 0 && totals[k] === 0 && POOL_IDS.every((id) => (pools[id][k] ?? 0) === 0) ? [k] : []));
}

/** Malformed saves pass through untouched (validate.ts rejects them). */
export function activateKinds(raw: RawSave): RawSave {
  const { totals, ledger, generation } = raw;
  if (!isCountVector(totals) || !isRecord(ledger) || !isRecord(generation) || !isCountVector(generation.allocInput)) return raw;
  if (!POOL_IDS.every((id) => isNumberVector(ledger[id]))) return raw;
  const pools = ledger as Record<string, number[]>;
  const add = missingKinds(totals, pools);
  if (add.length === 0) return raw;
  const plus = (v: readonly number[]) => v.map((n, k) => (add.includes(k) ? n + KINDS[PARTICLE_TYPES[k]].genesis : n));
  return {
    ...raw,
    totals: plus(totals),
    ledger: { ...ledger, world: plus(pools.world) },
    generation: { ...generation, allocInput: plus(generation.allocInput) },
  };
}
