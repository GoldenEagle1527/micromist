/**
 * Why 唤潮 is not possible yet, and what the player can do (M9; pure, from the
 * base telemetry). Numbers: BASE.tide (150 energy, 1 departure), the core's
 * capacity 100 (an energy tower adds 200) and output +0.25 / s, a lit
 * lighthouse −0.3 / s, the volt reactor +1.2 / s on voltite from storage.
 * Energy not rising: build a reactor → fuel it → switch lighthouses off (last resort).
 */
import type { BaseView, StructureInfo, TideReadiness } from "../../conserve";
import type { AdviceDict } from "./adviceI18n";

export type TideAdvice =
  /** Capacity below the tide's energy: an energy tower is needed. */
  | { kind: "cap" }
  /** The energy is not rising and no reactor stands: build one. */
  | { kind: "reactor" }
  /** Reactors stand but their fuel is gone: deposit voltite. */
  | { kind: "fuel" }
  /** The energy is not rising even so: switch lighthouses off. */
  | { kind: "drain" }
  /** Rising: enough in about `minutes`. */
  | { kind: "charging"; minutes: number }
  /** Energy is there, a departure is missing. */
  | { kind: "dive" };

/** Kinds that produce energy from fuel (the reactor). */
function fuelledProducers(structures: readonly StructureInfo[]): StructureInfo[] {
  return structures.filter((s) => s.energy > 0 && s.fuel !== null);
}

function stalledAdvice(view: BaseView, structures: readonly StructureInfo[]): TideAdvice {
  const producers = fuelledProducers(structures);
  if (producers.length === 0) return { kind: "drain" };
  const built = producers.filter((p) => view.buildings.some((b) => b.kind === p.kind));
  if (built.length === 0) return { kind: "reactor" };
  const fuelled = built.some((p) => p.fuel && (view.storage[p.fuel.kind] ?? 0) > 0);
  return fuelled ? { kind: "drain" } : { kind: "fuel" };
}

export function tideAdvice(view: BaseView, tide: TideReadiness, tideActive: boolean, structures: readonly StructureInfo[] = []): TideAdvice | null {
  if (!view.founded || tide.ready || tideActive) return null;
  const missing = tide.energyNeeded - view.energy;
  if (missing > 0) {
    if (view.energyCap < tide.energyNeeded) return { kind: "cap" };
    if (!(view.energyRate > 0) || view.brownout) return stalledAdvice(view, structures);
    return { kind: "charging", minutes: Math.max(1, Math.ceil(missing / view.energyRate / 60)) };
  }
  return tide.dives < tide.divesNeeded ? { kind: "dive" } : null;
}

export function adviceText(a: TideAdvice, labels: AdviceDict): string {
  return a.kind === "charging" ? labels.charging(a.minutes) : labels[a.kind];
}
