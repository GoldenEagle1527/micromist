/**
 * Region draw of a generation (§5.2): P(r) ∝ weight_r · (R_sig(r) / N_sig(r))^γ.
 * A scarce signature particle → fewer sites of its biome. Kinds absent from the
 * world (N_sig = 0, e.g. MVP's four inactive kinds) leave the factor at 1.
 */
import { BIOMES, BIOME_SIGNATURE, BIOME_WEIGHTS, SITE_TABLE } from "../config";
import { particleIndex } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";

/** Normalised draw probability per biome (BIOMES order). */
export function regionProbabilities(allocInput: ReadonlyParticleVector, totals: ReadonlyParticleVector, gamma: number = SITE_TABLE.gamma): number[] {
  const raw = BIOMES.map((b) => {
    const k = particleIndex(BIOME_SIGNATURE[b]);
    const share = totals[k] > 0 ? Math.min(1, Math.max(0, allocInput[k] / totals[k])) : 1;
    return BIOME_WEIGHTS[b] * Math.pow(share, gamma);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  // everything depleted: fall back to the plain frequencies
  if (sum <= 0) return drawFallback();
  return raw.map((p) => p / sum);
}

function drawFallback(): number[] {
  const sum = BIOMES.reduce((a, b) => a + BIOME_WEIGHTS[b], 0);
  return BIOMES.map((b) => BIOME_WEIGHTS[b] / sum);
}

/** Region index for a uniform draw u ∈ [0, 1). */
export function drawRegion(probabilities: readonly number[], u: number): number {
  let acc = 0;
  for (let r = 0; r < probabilities.length; r++) {
    acc += probabilities[r];
    if (u < acc) return r;
  }
  // rounding: the last region with any probability
  for (let r = probabilities.length - 1; r >= 0; r--) if (probabilities[r] > 0) return r;
  return 0;
}
