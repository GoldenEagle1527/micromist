/**
 * The tide's stub (G3; the tide itself is M7): what the core needs before the
 * player may call it, and the forecast — the chaos it would bring if it came
 * now (chaos/forecast.ts: exactly what the tide will compute).
 */
import { BASE } from "../config";
import { forecastTide } from "../chaos/forecast";
import { genesisChaos, type ChaosState } from "../chaos/model";
import { tideChaosInput } from "../chaos/tide";
import type { LedgerState } from "../ledger/particleLedger";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { allocationInput } from "../world/allocInput";
import type { TideForecast, TideReadiness } from "./port";

/** Where the forecast's inputs come from (the session): this generation's chaos, the world, the harvest. */
export type ChaosSource = {
  now: () => ChaosState;
  seed: number;
  size: { sitesX: number; sitesZ: number };
  siteHarvest: () => readonly number[];
};

export type ForecastWorld = {
  state: LedgerState;
  totals: ReadonlyParticleVector;
  gen: number;
  center: readonly [number, number, number] | null;
  /** Without one (tests of the base alone): this generation as if it were genesis, a 1 × 1 world. */
  chaos?: ChaosSource;
};

export function tideReadiness(energy: number, dives: number): TideReadiness {
  const { energy: energyNeeded, dives: divesNeeded } = BASE.tide;
  return { energy, energyNeeded, dives, divesNeeded, ready: energy >= energyNeeded && dives >= divesNeeded };
}

/** R' = N − P − B now → the next generation's m, stage, wall and cracks, beside this one's. */
export function tideForecast(w: ForecastWorld): TideForecast {
  const src = w.chaos;
  const now = src ? src.now() : genesisChaos(allocationInput(w.state), w.totals);
  const input = tideChaosInput({
    state: w.state,
    totals: w.totals,
    seed: src?.seed ?? 0,
    gen: w.gen,
    size: src?.size ?? { sitesX: 1, sitesZ: 1 },
    center: w.center,
    siteHarvest: src ? src.siteHarvest() : [],
  });
  const f = forecastTide(now, input);
  return {
    m: f.next.m,
    stage: f.next.stage,
    thickness: f.next.wallThickness,
    now: f.now,
    cracks: { opening: f.opening, healing: f.healing, open: f.open, through: f.through },
  };
}

/** tideForecast, recomputed only when R' or the core changes (every absorb, deposit, release or build moves R'). */
export class TideForecaster {
  private key = "";
  private value: TideForecast | null = null;

  forecast(w: ForecastWorld): TideForecast {
    const key = `${allocationInput(w.state).join()}|${w.center?.join() ?? ""}`;
    if (!this.value || key !== this.key) [this.key, this.value] = [key, tideForecast(w)];
    return this.value;
  }
}
