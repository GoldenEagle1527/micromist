/**
 * 「若现在唤潮」(design doc §4.1, G2): what a tide would bring if called now —
 * the next generation's m, stage and wall thickness beside this generation's,
 * and which cracks would open (new or again) or heal. Exactly chaosAtTide's
 * result (tide.ts), so the forecast and the tide agree bit for bit. Pure.
 */
import type { ChaosStage, ChaosState } from "./model";
import { chaosAtTide, type TideChaosInput } from "./tide";

export type ChaosForecast = {
  /** This generation (fixed until the tide). */
  now: { m: number; stage: ChaosStage; thickness: number };
  /** The next generation's chaos. */
  next: ChaosState;
  /** Cracks the tide would open: new ones, and scars reopening. */
  opening: number;
  healing: number;
  /** Open, and through (passable), after the tide. */
  open: number;
  through: number;
};

export function forecastTide(now: ChaosState, input: TideChaosInput): ChaosForecast {
  const next = chaosAtTide(now, input);
  const wasOpen = new Set(now.cracks.filter((c) => c.open).map((c) => c.j));
  const open = next.cracks.filter((c) => c.open);
  return {
    now: { m: now.m, stage: now.stage, thickness: now.wallThickness },
    next,
    opening: open.filter((c) => !wasOpen.has(c.j)).length,
    healing: next.cracks.filter((c) => !c.open && wasOpen.has(c.j)).length,
    open: open.length,
    through: open.filter((c) => c.through).length,
  };
}
