/**
 * Rock → terrain bias (§3.3): ρ_i = a_rock,i / ā_rock (genesis mean per site),
 * δ_i = clamp(β · ln ρ_i, −δmax, +δmax). Less rock → δ < 0 → thinner pillars,
 * lower floors, more open water. Monotone in the rock count.
 */
import { GENESIS, SITE_TABLE } from "../config";
import { particleIndex } from "../particles/particleTypes";
import { vectorFromCounts, type ReadonlyParticleVector } from "../particles/particleVector";

export type BiasParams = { beta: number; maxBias: number };

export function rockBias(rock: number, meanRock: number, p: BiasParams = SITE_TABLE): number {
  if (!(meanRock > 0)) return 0;
  if (rock <= 0) return -p.maxBias;
  const d = p.beta * Math.log(rock / meanRock);
  return Math.min(p.maxBias, Math.max(-p.maxBias, d));
}

/** ā_rock: the rock a site holds on average at genesis (totals minus the lander cargo, per site). */
export function genesisMeanRock(totals: ReadonlyParticleVector, siteCount: number): number {
  const k = particleIndex("lithic");
  const cargo = vectorFromCounts(GENESIS.landerCargo)[k];
  return Math.max(0, totals[k] - cargo) / siteCount;
}
