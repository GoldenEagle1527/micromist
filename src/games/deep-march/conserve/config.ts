/**
 * Conserve-mode tunables, in one place (design doc v0.5, MVP plan M1–M3). Modules
 * import these; none hard-codes a number a designer might want to change.
 */
import type { PoolId } from "./ledger/pools";
import type { ParticleType } from "./particles/particleTypes";
import type { ParticleCounts } from "./particles/particleVector";

export const GENESIS = {
  /**
   * Particle totals N_k fixed at world creation. MVP: 3 active kinds, 100,000 in
   * all — rock as in the full game (so the frozen base area locks the same ~6 %),
   * the other kinds' share folded into lumen and ferro (design doc §12).
   */
  totals: { lithic: 66_000, lumen: 17_000, ferro: 17_000 } satisfies ParticleCounts,
  /** Lander cargo, moved world → base at genesis: exactly enough for the base core (§8.1). */
  landerCargo: { lithic: 600, ferro: 80 } satisfies ParticleCounts,
} as const;

/** Site grid of the bounded world (D17: 10 × 10, MVP included), centred on the origin. */
export const WORLD_SIZE = { sitesX: 10, sitesZ: 10 } as const;

/**
 * Biomes, in the terrain's region order (terrain/regions.ts REGION_KEYS — test:world
 * checks the two agree): relative frequency (REGION_WEIGHTS) and signature particle,
 * the kind whose remaining share scales the biome's draw probability (§5.2).
 */
export const BIOMES = ["sand", "reef", "canyon", "cave", "terrace", "trench"] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME_WEIGHTS: Readonly<Record<Biome, number>> = { sand: 0.25, reef: 0.27, canyon: 0.15, cave: 0.09, terrace: 0.16, trench: 0.08 };
export const BIOME_SIGNATURE: Readonly<Record<Biome, ParticleType>> = {
  sand: "silica",
  reef: "lumen",
  canyon: "ferro",
  cave: "resonite",
  terrace: "voltite",
  trench: "abyssal",
};

/** Biome × particle affinity A (§3.4): primary 1.0, secondary 0.2–0.35, else 0.05; rock 1.0 everywhere. */
export const AFFINITY: Readonly<Record<Biome, Readonly<Record<ParticleType, number>>>> = {
  sand: { lithic: 1, silica: 1, lumen: 0.2, ferro: 0.05, voltite: 0.05, resonite: 0.05, abyssal: 0 },
  reef: { lithic: 1, silica: 0.2, lumen: 1, ferro: 0.05, voltite: 0.05, resonite: 0.05, abyssal: 0 },
  canyon: { lithic: 1, silica: 0.05, lumen: 0.05, ferro: 1, voltite: 0.3, resonite: 0.05, abyssal: 0 },
  cave: { lithic: 1, silica: 0.05, lumen: 0.2, ferro: 0.05, voltite: 0.05, resonite: 1, abyssal: 0.05 },
  terrace: { lithic: 1, silica: 0.05, lumen: 0.05, ferro: 0.35, voltite: 1, resonite: 0.05, abyssal: 0 },
  trench: { lithic: 1, silica: 0, lumen: 0.05, ferro: 0.05, voltite: 0.05, resonite: 0.2, abyssal: 1 },
};

/** Site table (§3.2, §3.3, §5.2): allocation, draw and rock → terrain bias. */
export const SITE_TABLE = {
  /** Region draw: P(r) ∝ weight · (R_sig / N_sig)^gamma (kinds with N_sig = 0 leave the factor at 1). */
  gamma: 1,
  /** Per-site, per-kind allocation jitter: base + span · hash. */
  jitterBase: 0.75,
  jitterSpan: 0.5,
  /** Allocation factor e_i of sites touching the world edge. */
  edgeFactor: 0.6,
  /** δ_i = clamp(beta · ln(a_rock / ā_rock), ±maxBias), ā_rock = the genesis mean per site. */
  beta: 1.6,
  maxBias: 3,
} as const;

/** In-site split of each kind's allocation (§3.3 table): shares of terrain / nodes / creatures. */
export type SiteShares = { readonly terrain: number; readonly nodes: number; readonly creatures: number };
export const SITE_SPLIT: Readonly<Record<ParticleType, SiteShares>> = {
  lithic: { terrain: 0.85, nodes: 0.15, creatures: 0 },
  lumen: { terrain: 0, nodes: 0.55, creatures: 0.45 },
  silica: { terrain: 0, nodes: 0.9, creatures: 0.1 },
  ferro: { terrain: 0, nodes: 0.9, creatures: 0.1 },
  voltite: { terrain: 0, nodes: 0.9, creatures: 0.1 },
  resonite: { terrain: 0, nodes: 0.9, creatures: 0.1 },
  abyssal: { terrain: 0, nodes: 0.9, creatures: 0.1 },
};

/**
 * The ring wall (§4.1): external variable share m = Σ R / Σ N at the tide,
 * stability σ = clamp((m − mBreak) / (mFull − mBreak), 0, 1), thickness
 * T = minThickness + (fullThickness − minThickness) · smoothstep(σ), metres.
 */
export const WALL = {
  fullThickness: 160,
  minThickness: 24,
  mFull: 0.95,
  mBreak: 0.78,
} as const;

export const SAVE = {
  /** The single MVP save slot (G11: 1 slot until phase 4). */
  slotId: "main",
  /** Minimum time between two throttled save writes, ms (design doc §10.2). */
  throttleMs: 30_000,
} as const;

/**
 * Repairing a save that does not conserve: the totals win; a deficit is added to
 * the suspended pool, an excess is taken back from the pools in this order.
 */
export const REPAIR_TAKE_ORDER: readonly PoolId[] = ["suspended", "world", "lost", "player", "base"];
