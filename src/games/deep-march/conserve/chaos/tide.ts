/**
 * The chaos a tide brings (design doc §4.1–4.3): from this generation's state
 * and the ledger at the moment of the tide, the next generation's m, stage,
 * wall thickness and cracks. The tide itself (M7) and the forecast (forecast.ts)
 * both call chaosAtTide, so the forecast is exactly what the tide will do.
 * Stage 5 (直视): the tide that turns the eye starts the gaze; while it lasts the
 * only tide there is is the sealing one (封界潮, gaze/), which ignores the
 * abyssal lock — the breach heals, the gaze ends.
 */
import type { LedgerState } from "../ledger/particleLedger";
import { particleIndex } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { allocationInput } from "../world/allocInput";
import { evolveCracks, type CrackContext } from "./cracks";
import { freshGaze } from "../gaze/model";
import { chaosStage, type ChaosState } from "./model";
import { ringOf } from "./ring";
import { externalShare, wallThickness } from "./wallModel";

export type TideChaosInput = Omit<CrackContext, "thickness" | "gaze"> & {
  /** Abyssal particles locked in the base (the gaze condition). */
  abyssalLocked: number;
};

export type TideWorld = {
  state: LedgerState;
  totals: ReadonlyParticleVector;
  seed: number;
  /** The generation now (the tide starts gen + 1). */
  gen: number;
  size: { sitesX: number; sitesZ: number };
  /** The base core's ground point (world, m), null before the founding. */
  center: readonly [number, number, number] | null;
  siteHarvest: ArrayLike<number>;
};

/** R' = N − P − B at the tide → m; the base's abyssal lock; the ring of this world. */
export function tideChaosInput(w: TideWorld): TideChaosInput {
  return {
    m: externalShare(allocationInput(w.state), w.totals),
    gen: w.gen + 1,
    seed: w.seed,
    ring: ringOf(w.size),
    base: w.center ? { x: w.center[0], z: w.center[2] } : null,
    siteHarvest: w.siteHarvest,
    abyssalLocked: w.state.pools.base[particleIndex("abyssal")] ?? 0,
  };
}

export function chaosAtTide(now: ChaosState, input: TideChaosInput): ChaosState {
  const { m } = input;
  const sealing = now.gaze !== undefined;
  const stage = chaosStage(m, sealing ? 0 : input.abyssalLocked);
  const thickness = wallThickness(m);
  const cracks = evolveCracks(now.cracks, { ...input, thickness, gaze: stage === 5 });
  const next: ChaosState = { m, stage, wallThickness: thickness, cracks };
  if (stage === 5) next.gaze = freshGaze();
  return next;
}
