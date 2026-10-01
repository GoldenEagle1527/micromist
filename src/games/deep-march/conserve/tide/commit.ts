/**
 * The tide's commit (design doc §5.1): the ledger moves and the save of gen + 1,
 * written before the show. Every particle moves through the ledger:
 *   for each kind, W is topped up to the plan's R' from L first (un-retrieved
 *   caches return), then from S; what is left of L goes to S (a cache lost during
 *   the warning), so after the commit  W = R',  L = 0,  S = what entered R since
 *   the call (it waits for the next tide), P and B unchanged.
 * The generation state starts fresh (no harvest, no departures, no caches); the
 * base keeps everything (all of it stands inside the dome) and pays the energy.
 * A sealing tide (封界潮) marks the save: flags.endingA = "sealed" (play goes on).
 */
import { BASE } from "../config";
import { cloneBase } from "../base/baseState";
import { cloneChaos } from "../chaos/model";
import type { ParticleLedger } from "../ledger/particleLedger";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { withLedger } from "../save/saveLedger";
import type { WorldSave } from "../save/schema";
import type { TidePlan } from "./plan";

export class TideCommitError extends Error {}

/** Moves the ledger (W = R', L = 0) and returns the save of the new generation. `save`: the session's snapshot now. */
export function commitTide(ledger: ParticleLedger, save: WorldSave, plan: TidePlan): WorldSave {
  if (save.gen !== plan.fromGen) throw new TideCommitError(`tide planned from gen ${plan.fromGen}, save is gen ${save.gen}`);
  const short = PARTICLE_TYPES.filter((type, k) => ledger.amount("world", type) + ledger.amount("lost", type) + ledger.amount("suspended", type) < plan.allocInput[k]);
  if (short.length) throw new TideCommitError(`R' no longer available: ${short.join(", ")} (absorbing must stay locked during the tide)`);
  PARTICLE_TYPES.forEach((type, k) => {
    const need = plan.allocInput[k] - ledger.amount("world", type);
    const fromLost = Math.min(Math.max(0, need), ledger.amount("lost", type));
    if (fromLost > 0) ledger.transfer("lost", "world", type, fromLost);
    const fromSuspended = need - fromLost;
    if (fromSuspended > 0) ledger.transfer("suspended", "world", type, fromSuspended);
    else if (fromSuspended < 0) ledger.transfer("world", "suspended", type, -fromSuspended);
    const leftLost = ledger.amount("lost", type);
    if (leftLost > 0) ledger.transfer("lost", "suspended", type, leftLost);
  });
  const base = save.base && { ...cloneBase(save.base), energy: Math.max(0, save.base.energy - BASE.tide.energy) };
  return withLedger(
    {
      ...save,
      gen: plan.gen,
      generation: { allocInput: plan.allocInput.slice(), harvested: "", partial: [], dives: 0 },
      caches: [],
      chaos: cloneChaos(plan.chaos),
      base,
      flags: plan.summary.sealed ? { ...save.flags, endingA: "sealed" } : save.flags,
    },
    ledger,
  );
}
