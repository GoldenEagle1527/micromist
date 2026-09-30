/** Inputs for the chaos tests (plan M6): a 10 × 10 ring, crack contexts, a tide sequence. */
import { WORLD_SIZE } from "../../src/games/deep-march/conserve/config";
import type { CrackContext } from "../../src/games/deep-march/conserve/chaos/cracks";
import type { ChaosState } from "../../src/games/deep-march/conserve/chaos/model";
import { ringOf, type Ring } from "../../src/games/deep-march/conserve/chaos/ring";
import { chaosAtTide, type TideChaosInput } from "../../src/games/deep-march/conserve/chaos/tide";

export const RING10: Ring = ringOf(WORLD_SIZE);
export const SITES = WORLD_SIZE.sitesX * WORLD_SIZE.sitesZ;

/** Deterministic pseudo-random stream in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function tideInput(m: number, over: Partial<TideChaosInput> = {}): TideChaosInput {
  return { m, gen: 2, seed: 42, ring: RING10, base: { x: 0, z: 0 }, siteHarvest: new Array(SITES).fill(0), abyssalLocked: 0, ...over };
}

export function crackContext(m: number, over: Partial<CrackContext> = {}): CrackContext {
  return { ...tideInput(m), thickness: 100, gaze: false, ...over };
}

export const START: ChaosState = { m: 0.934, stage: 0, wallThickness: 155, cracks: [] };

/** Tides at the given m values from `start` (gen 2, 3, …): the state after each. */
export function tideRun(ms: readonly number[], over: Partial<TideChaosInput> = {}, start: ChaosState = START): ChaosState[] {
  const out: ChaosState[] = [];
  let now = start;
  ms.forEach((m, i) => {
    now = chaosAtTide(now, tideInput(m, { gen: 2 + i, ...over }));
    out.push(now);
  });
  return out;
}
