/**
 * The chaos a tide brings (design doc §4.1–4.3): from this generation's state
 * and the ledger at the moment of the tide, the next generation's m, stage,
 * wall thickness and cracks. The tide itself (M7) and the forecast (forecast.ts)
 * both call chaosAtTide, so the forecast is exactly what the tide will do.
 */
import type { LedgerState } from "../ledger/particleLedger";
import { particleIndex } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { allocationInput } from "../world/allocInput";
import { evolveCracks, type CrackContext } from "./cracks";
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
  const stage = chaosStage(m, input.abyssalLocked);
  const thickness = wallThickness(m);
  const cracks = evolveCracks(now.cracks, { ...input, thickness, gaze: stage === 5 });
  return { m, stage, wallThickness: thickness, cracks };
}
