export type RngState = { seed: number };

/** Mulberry32 step. `value` is in [0, 1). */
export function nextRng(rng: RngState): { rng: RngState; value: number } {
  let seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { rng: { seed }, value };
}

export function rngInt(rng: RngState, maxExclusive: number): { rng: RngState; value: number } {
  const next = nextRng(rng);
  const span = Math.max(1, maxExclusive);
  return { rng: next.rng, value: Math.floor(next.value * span) };
}
