/**
 * Why 唤潮 is not possible yet, and what the player can do (M9; pure, from the
 * base telemetry). Numbers: BASE.tide (150 energy, 1 departure), the core's
 * capacity 100 (an energy tower adds 200) and output +0.25 / s, a lit
 * lighthouse −0.3 / s (it can be switched off in the panel).
 */
import type { BaseView, TideReadiness } from "../../conserve";

export type TideAdvice =
  /** Capacity below the tide's energy: an energy tower is needed. */
  | { kind: "cap" }
  /** The energy is not rising: switch lighthouses off. */
  | { kind: "drain" }
  /** Rising: enough in about `minutes`. */
  | { kind: "charging"; minutes: number }
  /** Energy is there, a departure is missing. */
  | { kind: "dive" };

export function tideAdvice(view: BaseView, tide: TideReadiness, tideActive: boolean): TideAdvice | null {
  if (!view.founded || tide.ready || tideActive) return null;
  const missing = tide.energyNeeded - view.energy;
  if (missing > 0) {
    if (view.energyCap < tide.energyNeeded) return { kind: "cap" };
    if (!(view.energyRate > 0) || view.brownout) return { kind: "drain" };
    return { kind: "charging", minutes: Math.max(1, Math.ceil(missing / view.energyRate / 60)) };
  }
  return tide.dives < tide.divesNeeded ? { kind: "dive" } : null;
}

export function adviceText(a: TideAdvice, labels: { cap: string; drain: string; charging: (minutes: number) => string; dive: string }): string {
  return a.kind === "charging" ? labels.charging(a.minutes) : labels[a.kind];
}
